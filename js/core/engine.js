// Moteur : boucle à pas fixe 60 Hz (accumulateur), gestion des "apps" (menu + jeux),
// hitstop/slow-mo via Fx de l'app courante, mise à l'échelle 1280x720, erreurs à l'écran.

import { Input } from './input.js';
import { AudioSys } from './audio.js';
import { Settings } from './settings.js';
import { vignette, txt, panel } from './ui.js';

const STEP = 1 / 60;

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.audio = new AudioSys();
    this.input = new Input(() => this.audio.unlock());
    this.W = 1280; this.H = 720;
    this.app = null;
    this.acc = 0;
    this.lastTs = 0;
    this.started = false;
    this.muted = false;
    this.errorMsg = null;
    this.errorT = 0;
    this.hiddenPause = false;
    this.menuFactory = null;
    this.menuBack = () => { if (this.menuFactory) this.setApp(this.menuFactory()); };
    this.settings = new Settings(this);
    this.toastMsg = null;
    this.toastT = 0;

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
        if (this.app && 'paused' in this.app) { this.app.paused = true; this.app.onPauseChange?.(true); }
      } else {
        this.hiddenPause = false;
        this.audio.resume();
        // les frappes accumulées pendant que l'onglet était gelé ne doivent pas
        // se déclencher en rafale au retour
        this.input.clearEdges();
      }
    });

    addEventListener('error', (e) => this.showError(e.message || 'Erreur'));
    addEventListener('unhandledrejection', (e) => this.showError(String(e.reason?.message || e.reason)));

    // ---------- souris ----------
    // La souris ne pilote que les interfaces (hub, pause, réglages) via les
    // handlers des apps ; en gameplay elle n'a aucun effet.
    canvas.addEventListener('pointerdown', (e) => {
      this.input.gesture();
      const p = this.gameCoords(e);
      if (p) this.app?.onPointer?.(p.x, p.y);
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = this.gameCoords(e);
      this.app?.onPointerMove?.(p ? p.x : -1, p ? p.y : -1);
      this.canvas.style.cursor = this.app?.cursor || 'default';
    });
    addEventListener('pointerup', () => this.app?.onPointerUp?.());
    canvas.addEventListener('pointerleave', () => {
      this.app?.onPointerLeave?.();
      this.canvas.style.cursor = 'default';
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('keydown', (e) => {
      // e.key plutôt que e.code : les lettres doivent marcher sur AZERTY comme QWERTY
      // (sur AZERTY, la touche M du clavier renvoie e.code 'Semicolon' — d'où l'ancien bug).
      const k = typeof e.key === 'string' ? e.key.toLowerCase() : '';
      if (e.repeat) return;
      if (k === 'm') {
        this.audio.setMuted(!this.audio.muted);
        this.muted = this.audio.muted;
        this.toast(this.muted ? 'Son coupé' : 'Son activé');
      } else if (k === 'f') {
        this.toggleFullscreen();
      }
    });
  }

  toast(m) { this.toastMsg = String(m); this.toastT = 2.2; }

  // convertit un événement pointeur en coordonnées du monde 1280×720
  gameCoords(e) {
    const r = this.canvas.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return {
      x: (e.clientX - r.left) / (r.width / this.W),
      y: (e.clientY - r.top) / (r.height / this.H),
    };
  }

  toggleFullscreen() {
    if (!document.fullscreenEnabled) { this.toast('Plein écran indisponible'); return; }
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => this.toast('Plein écran refusé'));
    }
  }

  showError(m) {
    this.errorMsg = String(m).slice(0, 200);
    this.errorT = 8;
    console.error(m);
  }

  resize() {
    const dpr = devicePixelRatio || 1;
    const s = Math.min(innerWidth / this.W, innerHeight / this.H);
    this.view = s; this.dpr = dpr;
    this.canvas.style.width = Math.floor(this.W * s) + 'px';
    this.canvas.style.height = Math.floor(this.H * s) + 'px';
    this.canvas.width = Math.round(this.W * s * dpr);
    this.canvas.height = Math.round(this.H * s * dpr);
  }

  setApp(app) {
    if (this.app && this.app.exit) { try { this.app.exit(); } catch (e) { this.showError(e.message); } }
    this.app = app;
    app.engine = this;
    this.acc = 0;
    if (app.enter) { try { app.enter(); } catch (e) { this.showError(e.message); } }
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.lastTs = performance.now();
    const loop = (ts) => { requestAnimationFrame(loop); this.tick(ts); };
    requestAnimationFrame(loop);
  }

  tick(ts) {
    const now = ts / 1000;
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
      let sdt = fx ? fx.consume(STEP) : STEP;
      if (this.hiddenPause) sdt = 0;
      if (app) {
        if (sdt > 0) {
          try { app.update(sdt); } catch (e) { this.showError(e.message); }
          if (fx) { try { fx.update(sdt); } catch (e) { this.showError(e.message); } }
          // On ne consomme les frappes QUE quand la simulation a réellement tourné :
          // un frame sans pas ou un hitstop ne doit pas manger les boutons.
          this.input.clearEdges();
        }
        if (fx) fx.cosmetic(STEP);
      }
    }

    this.render();
  }

  render() {
    const ctx = this.ctx;
    ctx.setTransform(this.view * this.dpr, 0, 0, this.view * this.dpr, 0, 0);
    ctx.fillStyle = '#05060b';
    ctx.fillRect(0, 0, this.W, this.H);

    const app = this.app;
    if (app) {
      try { app.render(ctx); } catch (e) { this.showError(e.message); }
      if (app.fx) app.fx.drawFlash(ctx);
      vignette(ctx);

      if (this.hiddenPause) {
        ctx.fillStyle = 'rgba(2, 3, 8, 0.6)';
        ctx.fillRect(0, 0, this.W, this.H);
        txt(ctx, 'FENÊTRE INACTIVE', 640, 340, { size: 34, align: 'center', color: '#8b95a8', weight: 900 });
      } else if (app.paused) {
        // l'app dessine sa propre pause ; voile générique sinon
      }
    }

    // Réglages par-dessus tout (dessinés par l'engine pour rester au sommet)
    this.settings.draw(ctx, app?.accent || '#7dd3fc');

    if (this.muted) {
      panel(ctx, 1128, 16, 124, 34, { radius: 17, fill: 'rgba(8,11,18,0.7)' });
      txt(ctx, 'MUET (M)', 1190, 39, { size: 13, align: 'center', color: '#8b95a8' });
    }

    if (this.toastT > 0 && this.toastMsg) {
      this.toastT -= 1 / 60;
      ctx.font = '800 15px "Segoe UI", system-ui, sans-serif';
      const w = ctx.measureText(this.toastMsg).width + 44;
      const a = Math.min(1, this.toastT / 0.4);
      ctx.globalAlpha = a;
      panel(ctx, 28, 662, w, 38, { radius: 19, fill: 'rgba(8,11,18,0.85)', stroke: 'rgba(125,211,252,0.35)' });
      txt(ctx, this.toastMsg, 28 + w / 2, 687, { size: 15, align: 'center', color: '#dfe6f0' });
      ctx.globalAlpha = 1;
    }

    if (this.errorT > 0 && this.errorMsg) {
      this.errorT -= 1 / 60;
      panel(ctx, 140, 16, 1000, 52, { radius: 12, fill: 'rgba(60,8,14,0.92)', stroke: '#ff5470' });
      txt(ctx, 'ERREUR : ' + this.errorMsg, 640, 48, { size: 16, align: 'center', color: '#ffb3c0' });
    }
  }
}
