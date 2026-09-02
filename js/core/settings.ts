// Overlay "Réglages" : volumes, résolution, muet, plein écran, vibrations.
// Navigable clavier + manette (↑↓ ←→ A B/Échap) et à la souris (clic sur les sliders).
// L'engine le dessine au-dessus de tout ; menu et jeux le manipulent via open()/update().

import type { AudioLike, EngineLike, InputLike, VolumeKey } from './types';
import * as UI from './ui';

const W = 660;
const H = 520;
const VOLUME_KEYS: readonly VolumeKey[] = ['master', 'music', 'sfx'];
const RESOLUTION_INDEX = 3;
const MUTE_INDEX = 4;
const FULLSCREEN_INDEX = 5;
const VIBRATION_INDEX = 6;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

type SettingRow =
  | { label: string; kind: 'slider'; key: VolumeKey }
  | { label: string; kind: 'choice'; value: string; hint?: string }
  | { label: string; kind: 'toggle'; on: boolean; hint?: string };

interface SettingRect {
  x: number;
  y: number;
  w: number;
  h: number;
  i: number;
  type: 'slider' | 'choice' | 'toggle';
  bx?: number;
  bw?: number;
}

export class Settings {
  readonly eng: EngineLike;
  readonly input: InputLike;
  readonly audio: AudioLike;
  active = false;
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
    this.sel = 0;
    this.rep = 0;
    this.t = 0;
    this.input.absorb();
  }

  close(): void {
    this.active = false;
    this.audio.uiBack();
    this.input.absorb();
  }

  toggleFullscreen(): void {
    this.eng.toggleFullscreen();
  }

  count(): number {
    return 7;
  }

  update(dt: number): boolean {
    if (!this.active) return false;
    this.t += dt;
    const I = this.input;

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
    if (dir) {
      const key = this.sel <= 2 ? VOLUME_KEYS[this.sel] : null;
      if (key) {
        this.audio.setVol(key, clamp01(this.audio.vols[key] + dir * 0.05));
        this.audio.uiMove();
      } else if (this.sel === RESOLUTION_INDEX) {
        this.eng.cycleResolution(dir);
        this.audio.uiMove();
      }
    }

    if (I.pressed('a')) {
      this.audio.uiOk();
      if (this.sel === RESOLUTION_INDEX) this.eng.cycleResolution(1);
      else if (this.sel === MUTE_INDEX) this.audio.setMuted(!this.audio.muted);
      else if (this.sel === FULLSCREEN_INDEX) this.toggleFullscreen();
      else if (this.sel === VIBRATION_INDEX) this.toggleVibration();
    }
    if (I.pressed('b') || I.pressed('back') || I.pressed('select')) this.close();
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

  // Clic souris (coordonnées 1280×720) : slider = valeur + début de drag,
  // toggle/action = activation, clic hors du panneau = fermeture.
  onPointer(x: number, y: number): boolean {
    if (!this.active) return false;
    const px = (1280 - W) / 2;
    const py = (720 - H) / 2;
    if (x < px || x > px + W || y < py || y > py + H) {
      this.close();
      return true;
    }
    for (const rect of this.rects) {
      if (x < rect.x || x > rect.x + rect.w || y < rect.y || y > rect.y + rect.h) continue;
      this.sel = rect.i;
      if (rect.type === 'slider') {
        const key = VOLUME_KEYS[rect.i];
        this.audio.setVol(key, clamp01((x - (rect.bx ?? 0)) / (rect.bw ?? 1)));
        this.drag = rect.i;
        this.audio.uiMove();
      } else if (rect.type === 'choice') {
        const bx = rect.bx ?? rect.x;
        const bw = rect.bw ?? rect.w;
        this.eng.cycleResolution(x < bx + bw / 2 ? -1 : 1);
        this.audio.uiMove();
      } else {
        if (rect.i === MUTE_INDEX) this.audio.setMuted(!this.audio.muted);
        else if (rect.i === FULLSCREEN_INDEX) this.toggleFullscreen();
        else if (rect.i === VIBRATION_INDEX) this.toggleVibration();
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
      if (rect) {
        const key = VOLUME_KEYS[this.drag];
        this.audio.setVol(key, clamp01((x - (rect.bx ?? 0)) / (rect.bw ?? 1)));
      }
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
    ctx.fillText('RÉGLAGES', px + 34, py + 52);
    ctx.font = '700 12.5px Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#5d6480';
    ctx.fillText(this.fullscreen ? 'PLEIN ÉCRAN ACTIF' : 'FENÊTRÉ', px + W - 34, py + 50);

    const rows: SettingRow[] = [
      { label: 'Volume général', kind: 'slider', key: 'master' },
      { label: 'Volume musique', kind: 'slider', key: 'music' },
      { label: 'Volume effets', kind: 'slider', key: 'sfx' },
      { label: 'Résolution', kind: 'choice', value: this.eng.resolutionLabel, hint: '← → pour choisir' },
      { label: 'Muet', kind: 'toggle', on: this.audio.muted, hint: 'raccourci : M' },
      { label: 'Plein écran', kind: 'toggle', on: this.fullscreen, hint: 'raccourci : F' },
      { label: 'Vibrations manette', kind: 'toggle', on: this.input.vibration },
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
        const value = this.audio.vols[row.key];
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(bx, y + 10, bw, 10, 5);
        else ctx.rect(bx, y + 10, bw, 10);
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fill();
        const fillWidth = Math.max(6, bw * value);
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(bx, y + 10, fillWidth, 10, 5);
        else ctx.rect(bx, y + 10, fillWidth, 10);
        ctx.fillStyle = accent;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(bx + fillWidth, y + 15, 8.5, 0, 6.2832);
        ctx.fillStyle = '#eaf6ff';
        ctx.shadowColor = accent;
        ctx.shadowBlur = isSel ? 14 : 6;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.font = '700 13px Consolas, monospace';
        ctx.textAlign = 'right';
        ctx.fillStyle = isSel ? '#eaf6ff' : '#7c8698';
        ctx.fillText(Math.round(value * 100) + ' %', px + W - 34, y + 20);
        this.rects.push({ x: px + 18, y: y - 6, w: W - 36, h: 44, i, type: 'slider', bx, bw });
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
    ctx.fillText('↑ ↓  choisir      ← →  régler      A  valider      B / Échap  fermer', 640, py + H - 22);
    ctx.restore();
  }
}
