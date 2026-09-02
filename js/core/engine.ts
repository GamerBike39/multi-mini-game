// Moteur : boucle à pas fixe 60 Hz (accumulateur), gestion des "apps" (menu + jeux),
// hitstop/slow-mo via Fx de l'app courante, mise à l'échelle 1280x720, erreurs à l'écran.

import { Input } from './input';
import { AudioSys } from './audio';
import { Settings } from './settings';
import { vignette, txt, panel } from './ui';
import { RESOLUTION_OPTIONS, type AppLike, type AudioLike, type EngineLike, type ResolutionId } from './types';

const STEP = 1 / 60;
const RESOLUTION_STORAGE_KEY = 'blobArcade.resolution';

interface Point {
  x: number;
  y: number;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function loadResolution(): ResolutionId {
  try {
    const saved = localStorage.getItem(RESOLUTION_STORAGE_KEY);
    if (RESOLUTION_OPTIONS.some((option) => option.id === saved)) return saved as ResolutionId;
  } catch {
    // Préférence indisponible : AUTO reste le meilleur défaut.
  }
  return 'auto';
}

export class Engine implements EngineLike {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly audio: AudioLike;
  readonly input: Input;
  readonly settings: Settings;
  readonly W = 1280;
  readonly H = 720;

  app: AppLike | null = null;
  menuFactory: (() => AppLike) | null = null;
  acc = 0;
  lastTs = 0;
  started = false;
  muted = false;
  errorMsg: string | null = null;
  errorT = 0;
  hiddenPause = false;
  toastMsg: string | null = null;
  toastT = 0;
  view = 1;
  dpr = 1;
  renderScale = 1;
  resolution: ResolutionId = loadResolution();
  readonly menuBack: () => void;

  get resolutionLabel(): string {
    return RESOLUTION_OPTIONS.find((option) => option.id === this.resolution)?.label || 'AUTO';
  }

  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Impossible de créer le contexte 2D du canvas.');

    this.canvas = canvas;
    this.ctx = context;
    this.audio = new AudioSys() as AudioLike;
    this.input = new Input(() => this.audio.unlock());
    this.menuBack = () => {
      if (this.menuFactory) this.setApp(this.menuFactory());
    };
    this.settings = new Settings(this);

    addEventListener('resize', () => this.resize());
    this.resize();
    document.addEventListener('fullscreenchange', () => {
      this.resize();
      this.toast(document.fullscreenElement ? 'PLEIN ÉCRAN' : 'MODE FENÊTRÉ');
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.hiddenPause = true;
        this.audio.suspend();
        if (this.app && 'paused' in this.app) {
          this.app.paused = true;
          this.app.onPauseChange?.(true);
        }
      } else {
        this.hiddenPause = false;
        this.audio.resume();
        // Les frappes accumulées pendant que l'onglet était gelé ne doivent pas
        // se déclencher en rafale au retour.
        this.input.clearEdges();
      }
    });

    addEventListener('error', (event: ErrorEvent) => this.showError(event.message || 'Erreur'));
    addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
      this.showError(errorMessage(event.reason));
    });

    // ---------- souris ----------
    // La souris ne pilote que les interfaces (hub, pause, réglages) via les
    // handlers des apps ; en gameplay elle n'a aucun effet.
    canvas.addEventListener('pointerdown', (event: PointerEvent) => {
      if (this.input.blocked) return;
      this.input.gesture();
      const point = this.gameCoords(event);
      if (point) this.app?.onPointer?.(point.x, point.y);
    });
    canvas.addEventListener('pointermove', (event: PointerEvent) => {
      const point = this.gameCoords(event);
      this.app?.onPointerMove?.(point ? point.x : -1, point ? point.y : -1);
      this.canvas.style.cursor = this.app?.cursor || 'default';
    });
    addEventListener('pointerup', () => this.app?.onPointerUp?.());
    canvas.addEventListener('pointerleave', () => {
      this.app?.onPointerLeave?.();
      this.canvas.style.cursor = 'default';
    });
    canvas.addEventListener('contextmenu', (event: MouseEvent) => event.preventDefault());
    addEventListener('keydown', (event: KeyboardEvent) => {
      if (this.input.blocked) return;
      // e.key plutôt que e.code : les lettres doivent marcher sur AZERTY comme QWERTY
      // (sur AZERTY, la touche M du clavier renvoie e.code 'Semicolon' — d'où l'ancien bug).
      const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
      if (event.repeat) return;
      if (key === 'm') {
        this.audio.setMuted(!this.audio.muted);
        this.muted = this.audio.muted;
        this.toast(this.muted ? 'Son coupé' : 'Son activé');
      } else if (key === 'f') {
        this.toggleFullscreen();
      }
    });
  }

  toast(message: unknown): void {
    this.toastMsg = String(message);
    this.toastT = 2.2;
  }

  // Convertit un événement pointeur en coordonnées du monde 1280×720.
  gameCoords(event: PointerEvent): Point | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: (event.clientX - rect.left) / (rect.width / this.W),
      y: (event.clientY - rect.top) / (rect.height / this.H),
    };
  }

  toggleFullscreen(): void {
    if (!document.fullscreenEnabled) {
      this.toast('Plein écran indisponible');
      return;
    }
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => this.toast('Plein écran refusé'));
    }
  }

  setResolution(resolution: ResolutionId): void {
    if (!RESOLUTION_OPTIONS.some((option) => option.id === resolution)) return;
    if (this.resolution === resolution) return;
    this.resolution = resolution;
    try {
      localStorage.setItem(RESOLUTION_STORAGE_KEY, resolution);
    } catch {
      // La préférence reste active pour la session courante.
    }
    this.resize();
    this.toast('Résolution : ' + this.resolutionLabel);
  }

  cycleResolution(direction: number): void {
    if (!direction) return;
    const current = Math.max(0, RESOLUTION_OPTIONS.findIndex((option) => option.id === this.resolution));
    const next = (current + (direction < 0 ? -1 : 1) + RESOLUTION_OPTIONS.length) % RESOLUTION_OPTIONS.length;
    this.setResolution(RESOLUTION_OPTIONS[next].id);
  }

  showError(message: unknown): void {
    this.errorMsg = errorMessage(message).slice(0, 200);
    this.errorT = 8;
    console.error(message);
  }

  resize(): void {
    const pixelRatio = devicePixelRatio || 1;
    const scale = Math.min(innerWidth / this.W, innerHeight / this.H);
    const resolution = RESOLUTION_OPTIONS.find((option) => option.id === this.resolution) || RESOLUTION_OPTIONS[0];
    this.view = scale;
    this.renderScale = resolution.id === 'auto' ? scale * pixelRatio : resolution.scale;
    this.dpr = this.renderScale / Math.max(scale, 1e-6);
    this.canvas.style.width = Math.floor(this.W * scale) + 'px';
    this.canvas.style.height = Math.floor(this.H * scale) + 'px';
    this.canvas.width = Math.max(1, Math.round(this.W * this.renderScale));
    this.canvas.height = Math.max(1, Math.round(this.H * this.renderScale));
  }

  setApp(app: AppLike): void {
    if (this.app?.exit) {
      try {
        this.app.exit();
      } catch (error) {
        this.showError(error);
      }
    }
    this.app = app;
    app.engine = this;
    this.acc = 0;
    if (app.enter) {
      try {
        app.enter();
      } catch (error) {
        this.showError(error);
      }
    }
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.lastTs = performance.now();
    const loop = (timestamp: number): void => {
      requestAnimationFrame(loop);
      this.tick(timestamp);
    };
    requestAnimationFrame(loop);
  }

  tick(timestamp: number): void {
    const now = timestamp / 1000;
    let dt = now - this.lastTs;
    this.lastTs = now;
    if (!(dt > 0) || dt > 0.25) dt = STEP;
    dt = Math.min(dt, 0.08);

    this.input.poll();

    const app = this.app;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < 4) {
      this.acc -= STEP;
      steps++;
      const fx = app?.fx;
      let simulationDt = fx ? fx.consume(STEP) : STEP;
      if (this.hiddenPause) simulationDt = 0;
      if (app) {
        if (simulationDt > 0) {
          try {
            app.update(simulationDt);
          } catch (error) {
            this.showError(error);
          }
          if (fx) {
            try {
              fx.update(simulationDt);
            } catch (error) {
              this.showError(error);
            }
          }
          // On ne consomme les frappes que quand la simulation a réellement tourné :
          // un frame sans pas ou un hitstop ne doit pas manger les boutons.
          this.input.clearEdges();
        }
        if (fx) fx.cosmetic(STEP);
      }
    }

    this.render();
  }

  render(): void {
    const ctx = this.ctx;
    ctx.setTransform(this.renderScale, 0, 0, this.renderScale, 0, 0);
    ctx.fillStyle = '#05060b';
    ctx.fillRect(0, 0, this.W, this.H);

    const app = this.app;
    if (app) {
      try {
        app.render(ctx);
      } catch (error) {
        this.showError(error);
      }
      if (app.fx) app.fx.drawFlash(ctx);
      vignette(ctx);

      if (this.hiddenPause) {
        ctx.fillStyle = 'rgba(2, 3, 8, 0.6)';
        ctx.fillRect(0, 0, this.W, this.H);
        txt(ctx, 'FENÊTRE INACTIVE', 640, 340, { size: 34, align: 'center', color: '#8b95a8', weight: 900 });
      }
    }

    // Réglages par-dessus tout (dessinés par l'engine pour rester au sommet).
    this.settings.draw(ctx, app?.accent || '#7dd3fc');

    if (this.toastT > 0 && this.toastMsg) {
      this.toastT -= 1 / 60;
      ctx.font = '800 15px "Segoe UI", system-ui, sans-serif';
      const width = ctx.measureText(this.toastMsg).width + 44;
      const alpha = Math.min(1, this.toastT / 0.4);
      ctx.globalAlpha = alpha;
      panel(ctx, 28, 662, width, 38, { radius: 19, fill: 'rgba(8,11,18,0.85)', stroke: 'rgba(125,211,252,0.35)' });
      txt(ctx, this.toastMsg, 28 + width / 2, 687, { size: 15, align: 'center', color: '#dfe6f0' });
      ctx.globalAlpha = 1;
    }

    if (this.errorT > 0 && this.errorMsg) {
      this.errorT -= 1 / 60;
      panel(ctx, 140, 16, 1000, 52, { radius: 12, fill: 'rgba(60,8,14,0.92)', stroke: '#ff5470' });
      txt(ctx, 'ERREUR : ' + this.errorMsg, 640, 48, { size: 16, align: 'center', color: '#ffb3c0' });
    }
  }
}
