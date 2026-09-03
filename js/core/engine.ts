// Moteur : boucle à pas fixe 60 Hz (accumulateur), gestion des "apps" (menu + jeux),
// hitstop/slow-mo via Fx de l'app courante, mise à l'échelle 1280x720, erreurs à l'écran.

import { InputManager } from './input';
import { AudioSys } from './audio';
import { Settings } from './settings';
import { AchievementSystem } from './achievements';
import { StageOverlay, blobAnchor } from './stage';
import { FixedClock, FIXED_STEP } from './clock';
import { DevTools } from './devtools';
import { WebGLPresenter } from './presenter';
import { ReplayPlayer, ReplayRecorder, validateReplay } from './replay';
import { LocalLobbyApp } from './lobby';
import { vignette, txt, panel } from './ui';
import {
  RESOLUTION_OPTIONS,
  type AppLike,
  type AudioLike,
  type FrameMetrics,
  type GameConstructor,
  type GameSession,
  type GpuEffectsSettings,
  type EngineLike,
  type ReplayTrace,
  type ResolutionId,
  type ScreenFilterId,
  type ScreenFilters,
  type ScreenFilterSettings,
  type StartGameOptions,
  type StageWipeOptions,
} from './types';

const STEP = FIXED_STEP;
const ENGINE_BUILD_VERSION = '0.2.0';
const RESOLUTION_STORAGE_KEY = 'blobArcade.resolution';
const SCREEN_FILTER_STORAGE_KEY = 'blobArcade.screenFilters';
const GPU_EFFECTS_STORAGE_KEY = 'blobArcade.gpuEffects';
const AUTO_PIXEL_BUDGET = 2_500_000;

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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function readFilter(value: unknown, fallbackIntensity: number): ScreenFilterSettings {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const intensity = typeof source.intensity === 'number' && Number.isFinite(source.intensity)
    ? clamp01(source.intensity)
    : fallbackIntensity;
  return { enabled: source.enabled === true, intensity };
}

function loadScreenFilters(): ScreenFilters {
  try {
    const saved = JSON.parse(localStorage.getItem(SCREEN_FILTER_STORAGE_KEY) || '{}') as Record<string, unknown>;
    return {
      crt: readFilter(saved.crt, 0.45),
      noise: readFilter(saved.noise, 0.2),
    };
  } catch {
    return {
      crt: { enabled: false, intensity: 0.45 },
      noise: { enabled: false, intensity: 0.2 },
    };
  }
}

function loadGpuEffects(): GpuEffectsSettings {
  let enabled = false;
  let intensity = 0.45;
  try {
    const saved = JSON.parse(localStorage.getItem(GPU_EFFECTS_STORAGE_KEY) || '{}') as Record<string, unknown>;
    enabled = saved.enabled === true;
    if (typeof saved.intensity === 'number' && Number.isFinite(saved.intensity)) intensity = clamp01(saved.intensity);
    if (new URLSearchParams(location.search).get('gpu') === '1') enabled = true;
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) enabled = false;
  } catch {
    // Les préférences graphiques restent facultatives.
  }
  return { enabled, intensity, available: false };
}

function makeSessionId(): string {
  try {
    if (crypto.randomUUID) return crypto.randomUUID();
  } catch {
    // Fallback pour les contextes non sécurisés ou les très vieux navigateurs.
  }
  return 'session-' + Math.floor(Math.random() * 0x7fffffff).toString(36) + '-' + Date.now().toString(36);
}

function randomSeed(): number {
  try {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] || 1;
  } catch {
    return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
  }
}

export class Engine implements EngineLike {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly sceneCanvas: HTMLCanvasElement;
  readonly sceneCtx: CanvasRenderingContext2D;
  readonly audio: AudioLike;
  readonly input: InputManager;
  readonly settings: Settings;
  readonly achievements: AchievementSystem;
  readonly dev = new DevTools();
  readonly metrics: FrameMetrics = {
    fps: 60,
    frameMs: 1000 / 60,
    updateMs: 0,
    renderMs: 0,
    presentMs: 0,
    simulationSteps: 0,
    droppedSteps: 0,
    accumulator: 0,
    renderPixels: 1280 * 720,
    gpuEnabled: false,
    appId: '',
  };
  readonly W = 1280;
  readonly H = 720;

  app: AppLike | null = null;
  menuFactory: (() => AppLike) | null = null;
  readonly stage = new StageOverlay();
  readonly gpuEffects = loadGpuEffects();
  readonly presenter: WebGLPresenter;
  readonly clock = new FixedClock({ step: STEP, maxSteps: 4, maxFrameDt: 0.08 });
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
  readonly screenFilters: ScreenFilters = loadScreenFilters();
  readonly menuBack: () => void;
  session: GameSession | null = null;
  private renderTarget: CanvasRenderingContext2D;
  private debugPaused = false;
  private debugStepRequested = false;
  private faulted = false;
  private resolutionWarning = false;
  private fpsSmoothing = 60;
  private lastFrameTimestamp = 0;
  private lastReplay: ReplayTrace | null = null;
  private recording: ReplayRecorder | null = null;

  get resolutionLabel(): string {
    return RESOLUTION_OPTIONS.find((option) => option.id === this.resolution)?.label || 'AUTO';
  }

  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Impossible de créer le contexte 2D du canvas.');
    const sceneCanvas = document.createElement('canvas');
    const sceneContext = sceneCanvas.getContext('2d');
    if (!sceneContext) throw new Error('Impossible de créer le canvas de scène.');

    this.canvas = canvas;
    this.ctx = context;
    this.sceneCanvas = sceneCanvas;
    this.sceneCtx = sceneContext;
    this.renderTarget = context;
    this.audio = new AudioSys() as AudioLike;
    this.input = new InputManager(() => this.audio.unlock());
    this.achievements = new AchievementSystem({
      onUnlock: () => {
        try {
          this.audio.milestone();
        } catch {
          // Le toast visuel suffit si l'audio est indisponible.
        }
      },
    });
    this.presenter = new WebGLPresenter(canvas, () => {
      this.gpuEffects.available = false;
      this.gpuEffects.enabled = false;
      this.renderTarget = this.ctx;
      this.canvas.style.opacity = '1';
      this.metrics.gpuEnabled = false;
      this.dev.log('Contexte WebGL perdu : retour Canvas 2D');
      this.toast('Effets GPU désactivés');
    }, () => {
      this.gpuEffects.available = this.presenter.available;
      this.dev.log('Contexte WebGL restauré');
    });
    this.gpuEffects.available = this.presenter.available;
    if (this.gpuEffects.enabled && this.gpuEffects.available) {
      this.presenter.enable(true);
      if (this.presenter.active) {
        this.renderTarget = this.sceneCtx;
        this.canvas.style.opacity = '0';
        this.metrics.gpuEnabled = true;
      } else {
        this.gpuEffects.enabled = false;
      }
    }
    this.menuBack = () => {
      if (!this.menuFactory) return;
      this.faulted = false;
      this.errorMsg = null;
      this.errorT = 0;
      this.input.configureSession('solo', 1);
      this.session = null;
      this.transitionTo(this.menuFactory(), {
        accent: this.app?.accent || '#7dd3fc',
        title: 'BLOB ARCADE',
        from: blobAnchor(this.app),
        to: { x: 640, y: 92 },
      });
    };
    this.settings = new Settings(this);
    this.dev.setCommandHandler((name) => this.handleDevCommand(name));

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
      if (!point) return;
      if (this.faulted) {
        if (point.y >= 52 && point.y <= 102 && point.x < 640) this.restartAfterError();
        else if (point.y >= 52 && point.y <= 102) this.menuBack();
        return;
      }
      this.app?.onPointer?.(point.x, point.y);
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
    canvas.addEventListener('wheel', (event: WheelEvent) => {
      const app = this.app;
      if (!app?.onWheel || this.faulted) return;
      event.preventDefault();
      const delta = Number.isFinite(event.deltaY) ? event.deltaY : 0;
      if (delta !== 0) app.onWheel(delta);
    }, { passive: false });
    addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.code === 'F3') {
        event.preventDefault();
        this.dev.toggleOverlay();
        return;
      }
      if (this.dev.enabled && event.code === 'F4') {
        event.preventDefault();
        this.dev.toggleFlag('hitboxes');
        return;
      }
      if (this.dev.enabled && event.code === 'F8') {
        event.preventDefault();
        this.debugStepRequested = true;
        this.debugPaused = true;
        return;
      }
      if (this.dev.enabled && event.code === 'F5') {
        event.preventDefault();
        this.handleDevCommand('record-toggle');
        return;
      }
      if (this.dev.enabled && event.code === 'F6') {
        event.preventDefault();
        this.handleDevCommand('export-replay');
        return;
      }
      if (this.dev.enabled && event.code === 'F7') {
        event.preventDefault();
        this.handleDevCommand('replay-last');
        return;
      }
      if (this.dev.enabled && event.code === 'F9') {
        event.preventDefault();
        this.handleDevCommand('export-metrics');
        return;
      }
      if (this.dev.enabled && event.code === 'F10') {
        event.preventDefault();
        this.dev.toggleFlag('spatialHash');
        return;
      }
      if (this.faulted) {
        if (event.code === 'Space' || event.code === 'Enter') {
          event.preventDefault();
          this.restartAfterError();
        } else if (event.code === 'Escape' || event.code === 'Backspace') {
          event.preventDefault();
          this.menuBack();
        }
        return;
      }
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

  setScreenFilterEnabled(filter: ScreenFilterId, enabled: boolean): void {
    this.screenFilters[filter].enabled = enabled;
    this.saveScreenFilters();
    this.toast((enabled ? 'Filtre ' : 'Filtre ') + (filter === 'crt' ? 'CRT' : 'bruit') + (enabled ? ' activé' : ' désactivé'));
  }

  setScreenFilterIntensity(filter: ScreenFilterId, intensity: number): void {
    this.screenFilters[filter].intensity = clamp01(intensity);
    this.saveScreenFilters();
  }

  setGpuEffectsEnabled(enabled: boolean): void {
    if (enabled && typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.gpuEffects.enabled = false;
      this.toast('Effets GPU neutralisés par le mode réduit');
      return;
    }
    if (enabled && !this.presenter.available) {
      this.gpuEffects.enabled = false;
      this.toast('Effets GPU indisponibles');
      return;
    }
    this.gpuEffects.enabled = enabled;
    this.presenter.enable(enabled);
    const active = enabled && this.presenter.active;
    if (enabled && !active) {
      this.gpuEffects.enabled = false;
      this.renderTarget = this.ctx;
      this.canvas.style.opacity = '1';
      this.metrics.gpuEnabled = false;
      this.saveGpuEffects();
      this.toast('Effets GPU indisponibles');
      return;
    }
    this.renderTarget = active ? this.sceneCtx : this.ctx;
    this.canvas.style.opacity = active ? '0' : '1';
    this.metrics.gpuEnabled = active;
    this.saveGpuEffects();
    this.toast(enabled ? 'Effets GPU activés' : 'Effets GPU désactivés');
  }

  setGpuEffectsIntensity(intensity: number): void {
    this.gpuEffects.intensity = clamp01(intensity);
    this.saveGpuEffects();
  }

  exportMetrics(): void {
    if (!this.dev.enabled) {
      this.toast('Mode dev requis');
      return;
    }
    try {
      const payload = {
        exportedAt: new Date().toISOString(),
        metrics: { ...this.metrics },
        session: this.session,
        counters: Object.fromEntries(this.dev.counters),
        states: Object.fromEntries(this.dev.states),
        logs: this.dev.logs.slice(),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `blob-arcade-metrics-${Date.now()}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      this.toast('Métriques exportées');
    } catch (error) {
      this.showError(error);
    }
  }

  private saveGpuEffects(): void {
    try {
      localStorage.setItem(GPU_EFFECTS_STORAGE_KEY, JSON.stringify({
        enabled: this.gpuEffects.enabled,
        intensity: this.gpuEffects.intensity,
      }));
    } catch {
      // La préférence reste active pour la session courante.
    }
  }

  startGame(game: GameConstructor, options: StartGameOptions = {}): void {
    const players = game.meta.players || { min: 1, max: 1 as const };
    const requestedMode = options.mode || (players.max > 1 ? 'local' : 'solo');
    if (requestedMode === 'local' && players.max > 1 && !options.skipLobby && !options.replay) {
      this.input.configureLobby(players.max);
      try {
        this.audio.stinger('launch');
      } catch {
        // La transition visuelle suffit si l'audio est indisponible.
      }
      this.transitionTo(new LocalLobbyApp(this, game, options), {
        accent: game.meta.accent,
        title: game.meta.name + ' · JOUEURS',
        from: blobAnchor(this.app),
      });
      return;
    }

    const requestedCount = options.playerCount ?? (requestedMode === 'local' ? players.max : 1);
    const playerCount = Math.max(players.min, Math.min(players.max, Math.floor(requestedCount)));
    let replay = options.replay;
    if (replay) {
      try {
        replay = validateReplay(replay, {
          gameId: game.meta.id,
          buildVersion: ENGINE_BUILD_VERSION,
          playerCount,
          fixedStep: STEP,
        });
      } catch (error) {
        this.showError(error);
        return;
      }
    }

    const session: GameSession = {
      id: makeSessionId(),
      gameId: game.meta.id,
      mode: requestedMode,
      playerCount,
      seed: replay?.seed ?? options.seed ?? randomSeed(),
      buildVersion: ENGINE_BUILD_VERSION,
      replayMode: replay ? 'playback' : 'live',
      replay,
    };

    if (replay) this.lastReplay = replay;
    this.recording = null;
    this.input.setReplayRecorder(null);
    this.input.setReplayPlayer(replay ? new ReplayPlayer(replay) : null);
    this.input.configureSession(session.mode, session.playerCount);
    this.session = session;
    this.faulted = false;

    let app: AppLike;
    try {
      app = new game(this, session);
    } catch (error) {
      this.showError(error);
      return;
    }
    try {
      this.audio.stinger('launch');
    } catch {
      // La transition visuelle suffit si l'audio est indisponible.
    }
    this.transitionTo(app, {
      accent: game.meta.accent,
      title: game.meta.name,
      from: blobAnchor(this.app),
    });
  }

  beginRecording(): void {
    const session = this.session;
    if (!session || session.replayMode === 'playback') {
      this.toast('Aucune partie enregistrable');
      return;
    }
    this.recording = new ReplayRecorder(session.gameId, session.seed, session.playerCount, session.buildVersion, STEP);
    session.replayMode = 'record';
    this.input.setReplayRecorder(this.recording);
    this.toast('Replay : enregistrement');
  }

  stopRecording(): ReplayTrace | null {
    if (!this.recording) return this.lastReplay;
    this.lastReplay = this.recording.finish();
    this.recording = null;
    this.input.setReplayRecorder(null);
    if (this.session) this.session.replayMode = 'live';
    this.toast('Replay enregistré : ' + this.lastReplay.frames.length + ' frames');
    return this.lastReplay;
  }

  exportReplay(): void {
    const trace = this.stopRecording();
    if (!trace) {
      this.toast('Aucun replay à exporter');
      return;
    }
    try {
      const blob = new Blob([JSON.stringify(trace)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `blob-arcade-${trace.gameId}-${trace.seed}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      this.showError(error);
    }
  }

  private handleDevCommand(name: string): void {
    if (!this.dev.enabled) return;
    if (name === 'toggle-overlay') this.dev.toggleOverlay();
    else if (name === 'toggle-hitboxes') this.dev.toggleFlag('hitboxes');
    else if (name === 'toggle-spatial-hash') this.dev.toggleFlag('spatialHash');
    else if (name === 'pause') this.debugPaused = !this.debugPaused;
    else if (name === 'step') {
      this.debugPaused = true;
      this.debugStepRequested = true;
    } else if (name === 'toggle-gpu') {
      this.setGpuEffectsEnabled(!this.gpuEffects.enabled);
    } else if (name === 'record-toggle') {
      if (this.recording) this.stopRecording();
      else this.beginRecording();
    } else if (name === 'export-replay') this.exportReplay();
    else if (name === 'export-metrics') this.exportMetrics();
    else if (name === 'replay-last') {
      const constructor = this.app?.constructor as unknown as GameConstructor | undefined;
      if (constructor?.meta && this.lastReplay) {
        this.startGame(constructor, { replay: this.lastReplay, mode: this.lastReplay.playerCount > 1 ? 'local' : 'solo', skipLobby: true });
      } else this.toast('Aucun replay disponible');
    } else if (name === 'restart-seed') {
      const constructor = this.app?.constructor as unknown as GameConstructor | undefined;
      if (constructor?.meta && this.session) {
        this.startGame(constructor, {
          mode: this.session.mode,
          playerCount: this.session.playerCount,
          seed: this.session.seed,
          skipLobby: true,
        });
      }
    }
  }

  private saveScreenFilters(): void {
    try {
      localStorage.setItem(SCREEN_FILTER_STORAGE_KEY, JSON.stringify(this.screenFilters));
    } catch {
      // La préférence reste active pour la session courante.
    }
  }

  showError(message: unknown): void {
    this.errorMsg = errorMessage(message).slice(0, 200);
    this.errorT = 8;
    this.faulted = true;
    this.dev.log(this.errorMsg);
    console.error(message);
  }

  private restartAfterError(): void {
    const constructor = this.app?.constructor as unknown as GameConstructor | undefined;
    if (constructor?.meta && this.session) {
      this.startGame(constructor, {
        mode: this.session.mode,
        playerCount: this.session.playerCount,
        seed: this.session.seed,
        skipLobby: true,
      });
    } else {
      this.menuBack();
    }
  }

  drawScreenFilters(ctx: CanvasRenderingContext2D): void {
    const crt = this.screenFilters.crt;
    const noise = this.screenFilters.noise;
    if (!crt.enabled && !noise.enabled) return;

    ctx.save();
    if (crt.enabled) {
      const intensity = crt.intensity;
      const now = performance.now() / 1000;
      const scanOffset = (now * 34) % 4;
      ctx.fillStyle = `rgba(3, 5, 10, ${0.035 + intensity * 0.13})`;
      for (let y = scanOffset; y < 720; y += 4) ctx.fillRect(0, y, 1280, 1);

      ctx.fillStyle = `rgba(125, 211, 252, ${0.018 * intensity})`;
      ctx.fillRect(0, (now * 42) % 760 - 20, 1280, 20 + intensity * 24);

      const gradient = ctx.createRadialGradient(640, 360, 330, 640, 360, 790);
      gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
      gradient.addColorStop(1, `rgba(0, 0, 0, ${0.3 * intensity})`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 1280, 720);
    }

    if (noise.enabled) {
      const intensity = noise.intensity;
      const count = Math.floor(180 + intensity * 700);
      ctx.globalAlpha = 0.045 + intensity * 0.1;
      for (let i = 0; i < count; i++) {
        const value = 150 + Math.floor(Math.random() * 106);
        const size = Math.random() < 0.88 ? 1 : 2;
        ctx.fillStyle = `rgb(${value}, ${value}, ${value})`;
        ctx.fillRect(Math.floor(Math.random() * 1280), Math.floor(Math.random() * 720), size, size);
      }
    }
    ctx.restore();
  }

  resize(): void {
    const pixelRatio = devicePixelRatio || 1;
    const scale = Math.min(innerWidth / this.W, innerHeight / this.H);
    const resolution = RESOLUTION_OPTIONS.find((option) => option.id === this.resolution) || RESOLUTION_OPTIONS[0];
    this.view = scale;
    const requestedScale = resolution.id === 'auto' ? scale * pixelRatio : resolution.scale;
    const budgetScale = Math.sqrt(AUTO_PIXEL_BUDGET / (this.W * this.H));
    this.renderScale = resolution.id === 'auto' ? Math.min(requestedScale, budgetScale) : requestedScale;
    this.dpr = this.renderScale / Math.max(scale, 1e-6);
    this.canvas.style.width = Math.floor(this.W * scale) + 'px';
    this.canvas.style.height = Math.floor(this.H * scale) + 'px';
    this.canvas.width = Math.max(1, Math.round(this.W * this.renderScale));
    this.canvas.height = Math.max(1, Math.round(this.H * this.renderScale));
    this.sceneCanvas.width = this.canvas.width;
    this.sceneCanvas.height = this.canvas.height;
    this.presenter.resize(this.canvas.width, this.canvas.height);
    this.metrics.renderPixels = this.canvas.width * this.canvas.height;
    this.resolutionWarning = resolution.id !== 'auto' && this.metrics.renderPixels > AUTO_PIXEL_BUDGET;
  }

  setApp(app: AppLike, options?: StageWipeOptions | false): void {
    if (options === false || !this.app) {
      this.applyApp(app);
      return;
    }
    this.transitionTo(app, options);
  }

  transitionTo(app: AppLike, options: StageWipeOptions = {}): void {
    this.stage.beginWipe(app, {
      accent: options.accent || app.accent || this.app?.accent || '#7dd3fc',
      title: options.title || '',
      from: options.from || blobAnchor(this.app),
      to: options.to || { x: 640, y: 360 },
    });
  }

  applyApp(app: AppLike): void {
    if (this.app?.exit) {
      try {
        this.app.exit();
      } catch (error) {
        this.showError(error);
      }
    }
    this.app = app;
    app.engine = this;
    this.session = app.session || null;
    if (app.isLobby) this.input.configureLobby((app as { maxPlayers?: number }).maxPlayers || 2);
    else this.input.configureSession(this.session?.mode || 'solo', this.session?.playerCount || 1);
    this.clock.reset();
    this.acc = 0;
    this.faulted = false;
    this.input.absorb();
    this.metrics.appId = this.appName();
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
    const frameIntervalMs = this.lastFrameTimestamp > 0
      ? Math.max(0, timestamp - this.lastFrameTimestamp)
      : 1000 / 60;
    this.lastFrameTimestamp = timestamp;
    const now = timestamp / 1000;
    let dt = Math.max(0, now - this.lastTs);
    this.lastTs = now;
    this.dev.beginFrame();
    this.input.poll();
    let updateMs = 0;
    const emptyResult = { steps: 0, droppedSteps: 0, frameDt: dt, accumulator: this.clock.accumulator };
    let result = emptyResult;
    try {
      result = this.clock.advance(dt, (_fixedDt, step) => {
      if (this.faulted) return;
      if (this.debugPaused && !this.debugStepRequested) return;
      this.debugStepRequested = false;
      try {
        this.input.advanceStep(performance.now());
        this.input.recordStep(step);
      } catch (error) {
        this.showError(error);
        return;
      }

      const app = this.app;
      const fx = app?.fx;
      let simulationDt = STEP;
      try {
        simulationDt = fx ? fx.consume(STEP) : STEP;
      } catch (error) {
        this.showError(error);
        simulationDt = 0;
      }
      if (this.hiddenPause || this.faulted) simulationDt = 0;
      const updateStart = performance.now();
      if (simulationDt > 0) {
        const freezeOutgoing = this.stage.active && !this.stage.swapped;
        if (app && !freezeOutgoing) {
          try {
            app.update(simulationDt);
          } catch (error) {
            this.showError(error);
          }
          if (!this.faulted && fx && !this.dev.flags.noFx) {
            try {
              fx.update(simulationDt);
            } catch (error) {
              this.showError(error);
            }
          }
        }
        if (!this.faulted && !this.dev.flags.noAudio) {
          try {
            this.audio.updateMusicState(simulationDt);
          } catch (error) {
            this.showError(error);
          }
        }
        if (!this.faulted && app) {
          // Les frappes restent disponibles pendant un hitstop, mais sont
          // consommées après un pas de simulation effectif.
          this.input.clearEdges();
        }
      }
      if (!this.hiddenPause && !this.faulted) {
        try {
          this.stage.update(STEP, (next) => this.applyApp(next));
        } catch (error) {
          this.showError(error);
        }
      }
      if (!this.faulted && fx && !this.dev.flags.noFx) {
        try {
          fx.cosmetic(STEP);
        } catch (error) {
          this.showError(error);
        }
      }
      updateMs += performance.now() - updateStart;
      });
    } catch (error) {
      this.showError(error);
    }

    this.acc = this.clock.accumulator;
    this.metrics.simulationSteps = result.steps;
    this.metrics.droppedSteps = result.droppedSteps;
    this.metrics.accumulator = result.accumulator;
    this.metrics.updateMs = updateMs;
    // FRAME mesure le rythme de présentation réel, pas le temps CPU du tick.
    // Les coûts CPU restent détaillés dans UPDATE, RENDER et PRESENT.
    this.metrics.frameMs = frameIntervalMs;
    this.metrics.fps = this.fpsSmoothing;
    this.dev.count('steps', result.steps);
    this.dev.count('drops', result.droppedSteps);
    this.dev.count('input-pads', this.input.pads.size);
    this.dev.state('replay', this.recording ? `record (${this.recording.frames.length})` : this.session?.replayMode || '—');
    if (this.resolutionWarning) this.dev.state('resolution-warning', '> 2,5 Mpx · résolution manuelle');
    this.collectDevCounters();
    this.metrics.appId = this.appName();
    try {
      this.achievements.update(Math.min(0.1, Math.max(0, frameIntervalMs / 1000)));
    } catch (error) {
      this.showError(error);
    }
    this.render(timestamp / 1000);
    const observedFps = 1000 / Math.max(0.1, frameIntervalMs);
    this.fpsSmoothing += (observedFps - this.fpsSmoothing) * 0.08;
    this.metrics.fps = this.fpsSmoothing;
  }

  render(time = performance.now() / 1000): void {
    const renderStart = performance.now();
    const ctx = this.renderTarget;
    try {
      ctx.setTransform(this.renderScale, 0, 0, this.renderScale, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#05060b';
      ctx.fillRect(0, 0, this.W, this.H);

      const app = this.app;
      if (!this.faulted) {
        if (app) {
          app.render(ctx);
          if (app.fx) app.fx.drawFlash(ctx);
          vignette(ctx);

          if (this.hiddenPause) {
            ctx.fillStyle = 'rgba(2, 3, 8, 0.6)';
            ctx.fillRect(0, 0, this.W, this.H);
            txt(ctx, 'FENÊTRE INACTIVE', 640, 340, { size: 34, align: 'center', color: '#8b95a8', weight: 900 });
          }
        }

        this.stage.render(ctx);
        this.drawScreenFilters(ctx);

        // Réglages par-dessus tout (dessinés par l'engine pour rester au sommet).
        this.settings.draw(ctx, app?.accent || '#7dd3fc');
        try {
          this.achievements.draw(ctx);
        } catch (error) {
          this.showError(error);
        }
      }

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

      this.drawErrorBanner(ctx);

      if (this.dev.enabled) {
        if (!this.faulted && this.app?.debugRender && this.dev.flags.hitboxes) this.app.debugRender(ctx);
        const appSnapshot = !this.faulted ? this.app?.debugSnapshot?.() : undefined;
        this.dev.render(ctx, {
          metrics: this.metrics,
          session: this.session,
          appName: this.appName(),
          players: this.input.players,
          gpuStatus: this.presenter.available ? (this.presenter.active ? 'ON' : 'OFF') : 'N/A',
          snapshot: appSnapshot,
        });
      }
    } catch (error) {
      this.showError(error);
      this.renderFault(ctx);
    }

    this.metrics.renderMs = performance.now() - renderStart;
    const presentStart = performance.now();
    if (this.presenter.active) {
      try {
        this.presenter.present(
          this.sceneCanvas,
          time,
          this.gpuEffects.intensity,
          this.screenFilters.crt.enabled,
          this.screenFilters.noise.enabled,
        );
      } catch (error) {
        this.showError(error);
        this.presenter.enable(false);
        this.gpuEffects.available = false;
        this.gpuEffects.enabled = false;
        this.renderTarget = this.ctx;
        this.canvas.style.opacity = '1';
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.drawImage(this.sceneCanvas, 0, 0);
      }
    } else if (ctx !== this.ctx) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.drawImage(this.sceneCanvas, 0, 0);
    }
    this.metrics.presentMs = performance.now() - presentStart;
    this.metrics.gpuEnabled = this.presenter.active;
  }

  private drawErrorBanner(ctx: CanvasRenderingContext2D): void {
    if (!(this.errorT > 0) || !this.errorMsg) return;
    if (!this.faulted) this.errorT -= 1 / 60;
    panel(ctx, 120, 14, 1040, this.faulted ? 92 : 52, { radius: 12, fill: 'rgba(60,8,14,0.94)', stroke: '#ff5470' });
    txt(ctx, 'ERREUR : ' + this.errorMsg, 640, 42, { size: 16, align: 'center', color: '#ffb3c0' });
    if (this.faulted) {
      txt(ctx, 'A / ESPACE  ·  relancer avec la même seed       B / ÉCHAP  ·  retour au menu', 640, 76, {
        size: 12.5, align: 'center', color: '#ffd1d9', mono: true,
      });
    }
  }

  private renderFault(ctx: CanvasRenderingContext2D): void {
    try {
      ctx.setTransform(this.renderScale, 0, 0, this.renderScale, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#05060b';
      ctx.fillRect(0, 0, this.W, this.H);
      this.drawErrorBanner(ctx);
    } catch {
      // Dernier filet : même un renderer partiellement corrompu doit laisser
      // une surface lisible et permettre au prochain appui de redémarrer.
      const fallback = this.ctx;
      fallback.setTransform(1, 0, 0, 1, 0, 0);
      fallback.globalAlpha = 1;
      fallback.fillStyle = '#17070b';
      fallback.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  private appName(): string {
    const meta = (this.app as { meta?: { id?: string } } | null)?.meta;
    return meta?.id || this.app?.constructor.name || '—';
  }

  private collectDevCounters(): void {
    if (!this.dev.enabled || !this.app) return;
    const value = this.app as unknown as Record<string, unknown>;
    const enemies = arrayLength(value.enemies) >= 0 ? arrayLength(value.enemies) : arrayLength(value.fishes);
    if (enemies >= 0) this.dev.count('enemies', enemies);

    let projectiles = 0;
    let hasProjectiles = false;
    for (const name of ['bullets', 'pbullets', 'ebullets', 'lasers']) {
      const length = arrayLength(value[name]);
      if (length >= 0) {
        projectiles += length;
        hasProjectiles = true;
      }
    }
    if (hasProjectiles) this.dev.count('projectiles', projectiles);

    const fx = value.fx as { parts?: unknown[] } | undefined;
    if (fx && arrayLength(fx.parts) >= 0) this.dev.count('particles', arrayLength(fx.parts));
    const physics = value.physics as { bodies?: unknown[] } | undefined;
    if (physics && arrayLength(physics.bodies) >= 0) this.dev.count('physics-bodies', arrayLength(physics.bodies));
  }
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : -1;
}
