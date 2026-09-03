// Overlay "Réglages" : volumes, résolution, muet, plein écran, vibrations.
// Navigable clavier + manette (↑↓ ←→ A B/Échap) et à la souris (clic sur les sliders).
// L'engine le dessine au-dessus de tout ; menu et jeux le manipulent via open()/update().
// La page principale garde les réglages fréquents ; les réglages d'image vivent
// dans la sous-vue Options visuelles.

import type { AudioLike, EngineLike, InputLike, ScreenFilterId, VolumeKey } from './types';
import * as UI from './ui';

const W = 660;
const H = 520;
const VOLUME_KEYS: readonly VolumeKey[] = ['master', 'music', 'sfx'];
const MAIN_VISUALS_INDEX = 6;
const MAIN_MUTE_INDEX = 3;
const MAIN_FULLSCREEN_INDEX = 4;
const MAIN_VIBRATION_INDEX = 5;
const VISUAL_RESOLUTION_INDEX = 0;
const VISUAL_GPU_INDEX = 1;
const VISUAL_GPU_INTENSITY_INDEX = 2;
const VISUAL_CRT_INDEX = 3;
const VISUAL_CRT_INTENSITY_INDEX = 4;
const VISUAL_NOISE_INDEX = 5;
const VISUAL_NOISE_INTENSITY_INDEX = 6;
const FILTER_IDS: readonly ScreenFilterId[] = ['crt', 'noise'];
type VisualControl = VolumeKey | ScreenFilterId | 'gpu';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

type SettingRow =
  | { label: string; kind: 'slider'; key: VisualControl }
  | { label: string; kind: 'choice'; value: string; hint?: string }
  | { label: string; kind: 'submenu'; hint?: string }
  | { label: string; kind: 'toggle'; on: boolean; hint?: string };

interface SettingRect {
  x: number;
  y: number;
  w: number;
  h: number;
  i: number;
  type: 'slider' | 'choice' | 'submenu' | 'toggle';
  bx?: number;
  bw?: number;
  control?: VisualControl;
}

export class Settings {
  readonly eng: EngineLike;
  readonly input: InputLike;
  readonly audio: AudioLike;
  active = false;
  page: 'main' | 'visuals' = 'main';
  sel = 0;
  rep = 0;
  t = 0;
  drag: number | null = null;
  rects: SettingRect[] = [];
  pvU = false;
  pvD = false;
  wasLR = false;
  wasRR = false;

  constructor(engine: EngineLike) {
    this.eng = engine;
    this.input = engine.input;
    this.audio = engine.audio;
  }

  get fullscreen(): boolean {
    return !!document.fullscreenElement;
  }

  open(): void {
    this.active = true;
    this.page = 'main';
    this.sel = 0;
    this.rep = 0;
    this.t = 0;
    this.input.absorb();
  }

  close(): void {
    this.active = false;
    this.page = 'main';
    this.audio.uiBack();
    this.input.absorb();
  }

  private openVisuals(): void {
    this.page = 'visuals';
    this.sel = 0;
    this.rep = 0;
    this.t = 0;
    this.audio.uiOk();
    this.input.absorb();
  }

  private backToMain(): void {
    this.page = 'main';
    this.sel = MAIN_VISUALS_INDEX;
    this.rep = 0;
    this.t = 0;
    this.audio.uiBack();
    this.input.absorb();
  }

  toggleFullscreen(): void {
    this.eng.toggleFullscreen();
  }

  count(): number {
    return this.page === 'visuals' ? 7 : 7;
  }

  update(dt: number): boolean {
    if (!this.active) return false;
    this.t += dt;
    const I = this.input;

    if (I.pressed('b') || I.pressed('back') || I.pressed('select')) {
      if (this.page === 'visuals') this.backToMain();
      else this.close();
      return true;
    }

    const U = I.down('up') || I.moveY < -0.5;
    const D = I.down('down') || I.moveY > 0.5;
    if (I.pressed('up') || (U && !this.pvU)) {
      this.sel = (this.sel + this.count() - 1) % this.count();
      this.audio.uiMove();
      this.rep = 0.34;
    }
    if (I.pressed('down') || (D && !this.pvD)) {
      this.sel = (this.sel + 1) % this.count();
      this.audio.uiMove();
      this.rep = 0.34;
    }
    this.pvU = U;
    this.pvD = D;

    const L = I.down('left') || I.moveX < -0.5;
    const R = I.down('right') || I.moveX > 0.5;
    let dir = 0;
    if (I.pressed('left')) dir = -1;
    else if (I.pressed('right')) dir = 1;
    else if ((L && !this.wasLR) || (R && !this.wasRR)) {
      dir = L ? -1 : 1;
      this.rep = 0.34;
    } else if (L || R) {
      this.rep -= dt;
      if (this.rep <= 0) {
        dir = L ? -1 : 1;
        this.rep = 0.09;
      }
    }
    this.wasLR = L;
    this.wasRR = R;

    if (this.page === 'main' && this.sel === MAIN_VISUALS_INDEX && (I.pressed('a') || I.pressed('right'))) {
      this.openVisuals();
      return true;
    }

    if (dir) {
      if (this.page === 'main') {
        const key = this.sel <= 2 ? VOLUME_KEYS[this.sel] : null;
        if (key) {
          this.audio.setVol(key, clamp01(this.audio.vols[key] + dir * 0.05));
          this.audio.uiMove();
        }
      } else if (this.sel === VISUAL_RESOLUTION_INDEX) {
        this.eng.cycleResolution(dir);
        this.audio.uiMove();
      } else if (this.sel === VISUAL_GPU_INTENSITY_INDEX) {
        this.eng.setGpuEffectsIntensity(this.eng.gpuEffects.intensity + dir * 0.05);
        this.audio.uiMove();
      } else if (this.sel === VISUAL_CRT_INTENSITY_INDEX) {
        this.eng.setScreenFilterIntensity('crt', this.eng.screenFilters.crt.intensity + dir * 0.05);
        this.audio.uiMove();
      } else if (this.sel === VISUAL_NOISE_INTENSITY_INDEX) {
        this.eng.setScreenFilterIntensity('noise', this.eng.screenFilters.noise.intensity + dir * 0.05);
        this.audio.uiMove();
      }
    }

    if (I.pressed('a')) {
      this.audio.uiOk();
      if (this.page === 'visuals') {
        if (this.sel === VISUAL_RESOLUTION_INDEX) this.eng.cycleResolution(1);
        else if (this.sel === VISUAL_GPU_INDEX) this.eng.setGpuEffectsEnabled(!this.eng.gpuEffects.enabled);
        else if (this.sel === VISUAL_CRT_INDEX) this.eng.setScreenFilterEnabled('crt', !this.eng.screenFilters.crt.enabled);
        else if (this.sel === VISUAL_NOISE_INDEX) this.eng.setScreenFilterEnabled('noise', !this.eng.screenFilters.noise.enabled);
      } else if (this.sel === MAIN_MUTE_INDEX) this.audio.setMuted(!this.audio.muted);
      else if (this.sel === MAIN_FULLSCREEN_INDEX) this.toggleFullscreen();
      else if (this.sel === MAIN_VIBRATION_INDEX) this.toggleVibration();
    }
    return true;
  }

  private toggleVibration(): void {
    this.input.vibration = !this.input.vibration;
    try {
      localStorage.setItem('blobArcade.vib', this.input.vibration ? '1' : '0');
    } catch {
      // La persistance est optionnelle (navigation privée, stockage bloqué, etc.).
    }
    this.input.rumble(0.6, 0.2);
  }

  private isFilter(control: VisualControl): control is ScreenFilterId {
    return FILTER_IDS.includes(control as ScreenFilterId);
  }

  private sliderValue(control: VisualControl): number {
    if (control === 'gpu') return this.eng.gpuEffects.intensity;
    return this.isFilter(control) ? this.eng.screenFilters[control].intensity : this.audio.vols[control];
  }

  private setSliderValue(control: VisualControl, value: number): void {
    if (control === 'gpu') this.eng.setGpuEffectsIntensity(value);
    else if (this.isFilter(control)) this.eng.setScreenFilterIntensity(control, value);
    else this.audio.setVol(control, value);
  }

  // Clic souris (coordonnées 1280×720) : slider = valeur + début de drag,
  // toggle/sous-menu = activation, clic hors du panneau = retour/fermeture.
  onPointer(x: number, y: number): boolean {
    if (!this.active) return false;
    const px = (1280 - W) / 2;
    const py = (720 - H) / 2;
    if (x < px || x > px + W || y < py || y > py + H) {
      if (this.page === 'visuals') this.backToMain();
      else this.close();
      return true;
    }
    for (const rect of this.rects) {
      if (x < rect.x || x > rect.x + rect.w || y < rect.y || y > rect.y + rect.h) continue;
      this.sel = rect.i;
      if (rect.type === 'slider') {
        const control = rect.control;
        if (!control) return true;
        this.setSliderValue(control, clamp01((x - (rect.bx ?? 0)) / (rect.bw ?? 1)));
        this.drag = rect.i;
        this.audio.uiMove();
      } else if (rect.type === 'choice') {
        const bx = rect.bx ?? rect.x;
        const bw = rect.bw ?? rect.w;
        this.eng.cycleResolution(x < bx + bw / 2 ? -1 : 1);
        this.audio.uiMove();
      } else if (rect.type === 'submenu') {
        this.openVisuals();
      } else {
        if (this.page === 'visuals' && rect.i === VISUAL_GPU_INDEX) {
          this.eng.setGpuEffectsEnabled(!this.eng.gpuEffects.enabled);
        } else if (this.page === 'visuals' && rect.i === VISUAL_CRT_INDEX) {
          this.eng.setScreenFilterEnabled('crt', !this.eng.screenFilters.crt.enabled);
        } else if (this.page === 'visuals' && rect.i === VISUAL_NOISE_INDEX) {
          this.eng.setScreenFilterEnabled('noise', !this.eng.screenFilters.noise.enabled);
        } else if (this.page === 'main' && rect.i === MAIN_MUTE_INDEX) this.audio.setMuted(!this.audio.muted);
        else if (this.page === 'main' && rect.i === MAIN_FULLSCREEN_INDEX) this.toggleFullscreen();
        else if (this.page === 'main' && rect.i === MAIN_VIBRATION_INDEX) this.toggleVibration();
        this.audio.uiOk();
      }
      return true;
    }
    return true;
  }

  // Drag en cours sur un slider + survol (curseur main au-dessus d'un contrôle).
  onPointerMove(x: number, y: number): boolean {
    if (!this.active) return false;
    if (this.drag !== null) {
      const rect = this.rects.find((candidate) => candidate.i === this.drag && candidate.type === 'slider');
      if (rect?.control) this.setSliderValue(rect.control, clamp01((x - (rect.bx ?? 0)) / (rect.bw ?? 1)));
      return true;
    }
    return this.rects.some((rect) => x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h);
  }

  onPointerUp(): void {
    this.drag = null;
  }

  draw(ctx: CanvasRenderingContext2D, accent = '#7dd3fc'): void {
    if (!this.active) return;
    const k = Math.min(1, this.t * 6);
    ctx.fillStyle = `rgba(2, 3, 8, ${0.6 * k})`;
    ctx.fillRect(0, 0, 1280, 720);

    const px = (1280 - W) / 2;
    const py = (720 - H) / 2;
    ctx.save();
    ctx.globalAlpha = k;
    ctx.translate((1 - k) * 24, 0);

    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(px, py, W, H, 20);
    else ctx.rect(px, py, W, H);
    ctx.fillStyle = 'rgba(10, 13, 21, 0.96)';
    ctx.shadowColor = '#000000aa';
    ctx.shadowBlur = 40;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = accent + '55';
    ctx.lineWidth = 2;
    ctx.stroke();

    this.rects = [];

    ctx.font = '900 27px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = accent;
    ctx.fillText(this.page === 'visuals' ? 'OPTIONS VISUELLES' : 'RÉGLAGES', px + 34, py + 52);
    ctx.font = '700 12.5px Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#5d6480';
    ctx.fillText(
      this.page === 'visuals' ? 'B / ÉCHAP RETOUR' : (this.fullscreen ? 'PLEIN ÉCRAN ACTIF' : 'FENÊTRÉ'),
      px + W - 34,
      py + 50,
    );

    const rows: SettingRow[] = this.page === 'visuals'
      ? [
        { label: 'Résolution', kind: 'choice', value: this.eng.resolutionLabel, hint: '← → pour choisir' },
        { label: 'Effets WebGL', kind: 'toggle', on: this.eng.gpuEffects.enabled, hint: this.eng.gpuEffects.available ? 'lentille / phosphore' : 'indisponible' },
        { label: 'Intensité WebGL', kind: 'slider', key: 'gpu' },
        { label: 'Filtre CRT', kind: 'toggle', on: this.eng.screenFilters.crt.enabled, hint: 'scanlines de borne' },
        { label: 'Intensité CRT', kind: 'slider', key: 'crt' },
        { label: 'Filtre grain', kind: 'toggle', on: this.eng.screenFilters.noise.enabled, hint: 'film, pas neige' },
        { label: 'Intensité grain', kind: 'slider', key: 'noise' },
      ]
      : [
        { label: 'Volume général', kind: 'slider', key: 'master' },
        { label: 'Volume musique', kind: 'slider', key: 'music' },
        { label: 'Volume effets', kind: 'slider', key: 'sfx' },
        { label: 'Muet', kind: 'toggle', on: this.audio.muted, hint: 'raccourci : M' },
        { label: 'Plein écran', kind: 'toggle', on: this.fullscreen, hint: 'raccourci : F' },
        { label: 'Vibrations manette', kind: 'toggle', on: this.input.vibration },
        { label: 'Options visuelles', kind: 'submenu', hint: 'A / → ouvrir' },
      ];

    const bx = px + 300;
    const bw = 226;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const y = py + 84 + i * 52;
      const isSel = i === this.sel;
      if (isSel) {
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(px + 18, y - 6, W - 36, 44, 11);
        else ctx.rect(px + 18, y - 6, W - 36, 44);
        ctx.fillStyle = 'rgba(255,255,255,0.055)';
        ctx.fill();
        ctx.strokeStyle = accent + '88';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      ctx.font = (isSel ? '800 ' : '700 ') + '17px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = isSel ? '#ffffff' : '#b9c2d0';
      ctx.fillText(row.label, px + 34, y + 20);

      if (row.kind === 'slider') {
        const value = this.sliderValue(row.key);
        const filterDisabled = (this.isFilter(row.key) && !this.eng.screenFilters[row.key].enabled)
          || (row.key === 'gpu' && !this.eng.gpuEffects.available);
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(bx, y + 10, bw, 10, 5);
        else ctx.rect(bx, y + 10, bw, 10);
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fill();
        const fillWidth = Math.max(6, bw * value);
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(bx, y + 10, fillWidth, 10, 5);
        else ctx.rect(bx, y + 10, fillWidth, 10);
        ctx.fillStyle = filterDisabled ? '#566176' : accent;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(bx + fillWidth, y + 15, 8.5, 0, 6.2832);
        ctx.fillStyle = '#eaf6ff';
        ctx.shadowColor = filterDisabled ? '#566176' : accent;
        ctx.shadowBlur = isSel ? 14 : 6;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.font = '700 13px Consolas, monospace';
        ctx.textAlign = 'right';
        ctx.fillStyle = isSel ? '#eaf6ff' : '#7c8698';
        ctx.fillText(Math.round(value * 100) + ' %', px + W - 34, y + 20);
        this.rects.push({ x: px + 18, y: y - 6, w: W - 36, h: 44, i, type: 'slider', bx, bw, control: row.key });
      } else if (row.kind === 'choice') {
        const choiceW = 226;
        const choiceX = bx;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(choiceX, y + 2, choiceW, 26, 13);
        else ctx.rect(choiceX, y + 2, choiceW, 26);
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fill();
        ctx.strokeStyle = isSel ? accent + 'bb' : '#ffffff1f';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        UI.txt(ctx, '‹', choiceX + 18, y + 21, { size: 23, align: 'center', color: isSel ? accent : '#8b95a8', weight: 900 });
        UI.txt(ctx, row.value, choiceX + choiceW / 2, y + 20, { size: 13, align: 'center', color: isSel ? '#eaf6ff' : '#b9c2d0', mono: true, weight: 800 });
        UI.txt(ctx, '›', choiceX + choiceW - 18, y + 21, { size: 23, align: 'center', color: isSel ? accent : '#8b95a8', weight: 900 });
        if (row.hint) {
          ctx.font = '700 11px Consolas, monospace';
          ctx.textAlign = 'right';
          ctx.fillStyle = '#5d6480';
          ctx.fillText(row.hint, px + W - 34, y + 20);
        }
        this.rects.push({ x: px + 18, y: y - 6, w: W - 36, h: 44, i, type: 'choice', bx: choiceX, bw: choiceW });
      } else if (row.kind === 'submenu') {
        const submenuW = 226;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(bx, y + 2, submenuW, 26, 13);
        else ctx.rect(bx, y + 2, submenuW, 26);
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fill();
        ctx.strokeStyle = isSel ? accent + 'bb' : '#ffffff1f';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        UI.txt(ctx, 'OUVRIR', bx + submenuW / 2 - 8, y + 20, { size: 12, align: 'center', color: isSel ? '#eaf6ff' : '#8b95a8', mono: true, weight: 800 });
        UI.txt(ctx, '›', bx + submenuW - 18, y + 21, { size: 23, align: 'center', color: isSel ? accent : '#8b95a8', weight: 900 });
        this.rects.push({ x: px + 18, y: y - 6, w: W - 36, h: 44, i, type: 'submenu', bx, bw: submenuW });
      } else {
        const tw = 96;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(bx + bw - tw, y + 2, tw, 26, 13);
        else ctx.rect(bx + bw - tw, y + 2, tw, 26);
        ctx.fillStyle = row.on ? accent : 'rgba(255,255,255,0.08)';
        ctx.fill();
        ctx.font = '800 13px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = row.on ? '#06121c' : '#8b95a8';
        ctx.fillText(row.on ? 'OUI' : 'NON', bx + bw - tw / 2, y + 19);
        if (row.hint) {
          ctx.font = '700 11px Consolas, monospace';
          ctx.textAlign = 'right';
          ctx.fillStyle = '#5d6480';
          ctx.fillText(row.hint, px + W - 34, y + 20);
        }
        this.rects.push({ x: px + 18, y: y - 6, w: W - 36, h: 44, i, type: 'toggle' });
      }
    }

    ctx.font = '700 13px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#6a7488';
    ctx.fillText(
      this.page === 'visuals'
        ? '↑ ↓  choisir      ← →  régler      A  valider      B / Échap  retour'
        : '↑ ↓  choisir      ← →  régler      A  valider      B / Échap  fermer',
      640,
      py + H - 22,
    );
    ctx.restore();
  }
}
