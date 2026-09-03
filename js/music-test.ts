import * as UI from './core/ui';
import type { AppLike, EngineLike, InputLike, MusicLayerName } from './core/types';
import { MUSIC_STATE_KEYS, type MusicStateKey } from './core/music/state';
import type { MusicState, ReferenceMusic } from './core/music/types';

const REFERENCES: readonly ReferenceMusic[] = ['shooter', 'survival', 'fish'];
const REFERENCE_LABELS: Record<ReferenceMusic, string> = {
  shooter: 'SHOOTER V1',
  survival: 'SURVIVAL V1',
  fish: 'FISH V1',
};
const REFERENCE_KEYS: Record<ReferenceMusic, string> = {
  shooter: 'C minor · 138 BPM',
  survival: 'E minor · 142 BPM',
  fish: 'F# minor · 100 BPM · swing 8%',
};
const LAYERS: readonly MusicLayerName[] = ['drums', 'bass', 'harmony', 'arp', 'lead', 'fx'];
const LAYER_LABELS: Record<MusicLayerName, string> = {
  drums: 'DRUMS',
  bass: 'BASS',
  harmony: 'HARMONY',
  arp: 'ARP / PLUCK',
  lead: 'LEAD',
  fx: 'FX / BELL',
  brass: 'BRASS',
  vox: 'VOX / HEY',
};
const STATE_LABELS: Record<MusicStateKey, string> = {
  intensity: 'INTENSITÉ',
  tension: 'TENSION',
  danger: 'DANGER',
  momentum: 'MOMENTUM',
  complexity: 'COMPLEXITÉ',
  brightness: 'LUMINOSITÉ',
  triumph: 'TRIOMPHE',
  calm: 'CALME',
  narrativeArc: 'ARC NARRATIF',
};

const pulse = (time: number): number => 0.72 + Math.sin(time * Math.PI * 2) * 0.08;

/** Surface de validation manuelle des références, accessible via /music-test. */
export class MusicTestApp implements AppLike {
  readonly accent = '#7dd3fc';
  readonly input: InputLike;
  readonly audio: EngineLike['audio'];
  readonly engine: EngineLike;
  cursor = 'default';

  private time = 0;
  private referenceIndex = 0;
  private layerIndex = 0;
  private stateIndex = 0;
  private stateFocus = false;
  private playingReference: ReferenceMusic | null = null;
  paused = false;
  private readonly layerEnabled: Record<MusicLayerName, boolean> = {
    drums: true,
    bass: true,
    harmony: true,
    arp: true,
    lead: true,
    fx: true,
    brass: true,
    vox: true,
  };

  constructor(engine: EngineLike) {
    this.engine = engine;
    this.input = engine.input;
    this.audio = engine.audio;
  }

  update(dt: number): void {
    this.time += dt;
    const I = this.input;
    if (I.pressed('back') || I.pressed('select')) {
      this.engine.menuBack();
      return;
    }
    if (I.pressed('y')) this.stateFocus = !this.stateFocus;
    if (I.pressed('lb')) this.audio.setAdaptiveEnabled(!this.audio.isAdaptiveEnabled());
    if (I.pressed('rb')) this.audio.resetMusicState();
    if (this.stateFocus) {
      if (I.pressed('left')) this.adjustState(-0.05);
      if (I.pressed('right')) this.adjustState(0.05);
      if (I.pressed('up')) this.selectState(-1);
      if (I.pressed('down')) this.selectState(1);
    } else {
      if (I.pressed('left')) this.selectReference(-1);
      if (I.pressed('right')) this.selectReference(1);
      if (I.pressed('up')) this.selectLayer(-1);
      if (I.pressed('down')) this.selectLayer(1);
    }
    if (I.pressed('a')) this.playSelected();
    if (I.pressed('b')) this.stop();
    if (I.pressed('start')) this.togglePause();
    if (I.pressed('x')) this.toggleLayer(LAYERS[this.layerIndex]);
  }

  render(ctx: CanvasRenderingContext2D): void {
    this.drawBackdrop(ctx);
    UI.txt(ctx, 'MUSIC TEST', 70, 82, { size: 44, weight: 900, color: this.accent, shadow: true });
    UI.txt(ctx, 'RÉFÉRENCES GOLDEN V1 · LECTURE DÉTERMINISTE', 72, 112, { size: 14, mono: true, color: '#8490a5' });

    this.drawReferences(ctx);
    this.drawTransport(ctx);
    this.drawLayers(ctx);
    this.drawMusicState(ctx);
    this.drawFooter(ctx);
  }

  exit(): void {
    this.audio.setAdaptiveEnabled(false);
    this.audio.resetMusicState();
    this.audio.stopMusic();
    for (const layer of LAYERS) this.audio.setMusicLayerPresence(layer, 1);
  }

  onPointer(x: number, y: number): void {
    if (y >= 150 && y <= 252) {
      const index = Math.floor((x - 70) / 270);
      if (index >= 0 && index < REFERENCES.length) {
        this.referenceIndex = index;
        this.playSelected();
      }
      return;
    }
    if (y >= 278 && y <= 340) {
      if (x < 300) this.playSelected();
      else if (x < 520) this.togglePause();
      else this.stop();
      return;
    }
    if (y >= 425 && y <= 490) {
      const index = Math.floor((x - 70) / 180);
      if (index >= 0 && index < LAYERS.length) {
        this.layerIndex = index;
        this.toggleLayer(LAYERS[index]);
      }
      return;
    }
    if (y >= 508 && y <= 536) {
      if (x >= 1010) this.audio.setAdaptiveEnabled(!this.audio.isAdaptiveEnabled());
      return;
    }
    if (y >= 538 && y <= 636) {
      const column = Math.floor((x - 70) / 380);
      const row = Math.floor((y - 538) / 33);
      const index = row * 3 + column;
      if (column >= 0 && column < 3 && row >= 0 && row < 3 && index < MUSIC_STATE_KEYS.length) {
        this.stateIndex = index;
        this.stateFocus = true;
        const key = MUSIC_STATE_KEYS[index];
        const value = Math.max(0, Math.min(1, (x - (70 + column * 380 + 150)) / 170));
        this.setStateValue(key, value);
      }
    }
  }

  onPointerMove(x: number, y: number): void {
    this.cursor = (y >= 150 && y <= 252) || (y >= 278 && y <= 340) || (y >= 425 && y <= 490)
      || (y >= 508 && y <= 636)
      ? 'pointer'
      : 'default';
  }

  onPointerUp(): void {}
  onPointerLeave(): void { this.cursor = 'default'; }

  private playSelected(): void {
    const reference = REFERENCES[this.referenceIndex];
    if (this.playingReference !== reference || !this.audio.musicOn) {
      this.audio.startReference(reference);
    } else if (this.paused) {
      this.audio.resumeMusic();
    }
    this.playingReference = reference;
    this.paused = false;
  }

  private stop(): void {
    this.audio.stopMusic();
    this.playingReference = null;
    this.paused = false;
  }

  private togglePause(): void {
    if (!this.playingReference || !this.audio.musicOn) return;
    if (this.paused) {
      this.audio.resumeMusic();
      this.paused = false;
    } else {
      this.audio.pauseMusic();
      this.paused = true;
    }
  }

  private selectReference(delta: number): void {
    this.referenceIndex = (this.referenceIndex + delta + REFERENCES.length) % REFERENCES.length;
    if (this.playingReference) this.playSelected();
  }

  private selectLayer(delta: number): void {
    this.layerIndex = (this.layerIndex + delta + LAYERS.length) % LAYERS.length;
  }

  private selectState(delta: number): void {
    this.stateIndex = (this.stateIndex + delta + MUSIC_STATE_KEYS.length) % MUSIC_STATE_KEYS.length;
  }

  private adjustState(delta: number): void {
    const key = MUSIC_STATE_KEYS[this.stateIndex];
    const current = this.audio.getMusicTargetState()[key];
    this.setStateValue(key, current + delta);
  }

  private setStateValue(key: MusicStateKey, value: number): void {
    const state: Partial<MusicState> = {};
    state[key] = Math.max(0, Math.min(1, value));
    this.audio.setMusicState(state);
  }

  private toggleLayer(layer: MusicLayerName): void {
    this.layerEnabled[layer] = !this.layerEnabled[layer];
    this.audio.setMusicLayerPresence(layer, this.layerEnabled[layer] ? 1 : 0);
  }

  private drawBackdrop(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.055)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= 1280; x += 64) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 720); ctx.stroke();
    }
    for (let y = 0; y <= 720; y += 64) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1280, y); ctx.stroke();
    }
  }

  private drawReferences(ctx: CanvasRenderingContext2D): void {
    REFERENCES.forEach((reference, index) => {
      const x = 70 + index * 270;
      const selected = index === this.referenceIndex;
      UI.panel(ctx, x, 150, 240, 102, {
        radius: 14,
        fill: selected ? 'rgba(20, 37, 54, 0.96)' : 'rgba(8, 11, 18, 0.84)',
        stroke: selected ? this.accent : 'rgba(125, 211, 252, 0.18)',
        lineWidth: selected ? 2 : 1,
      });
      UI.txt(ctx, REFERENCE_LABELS[reference], x + 20, 185, { size: 20, weight: 900, color: selected ? '#f4f8ff' : '#aab5c7' });
      UI.txt(ctx, REFERENCE_KEYS[reference], x + 20, 213, { size: 12, mono: true, color: '#7e8ba0' });
      UI.txt(ctx, selected ? 'A · LIRE' : '← →', x + 20, 237, { size: 12, mono: true, color: selected ? this.accent : '#65738a' });
    });
  }

  private drawTransport(ctx: CanvasRenderingContext2D): void {
    const isActive = !!this.playingReference && this.audio.musicOn;
    const beat = isActive ? this.audio.musicBeat() : 0;
    const bar = isActive ? this.audio.musicBar() : 0;
    const step = isActive ? this.audio.musicStep() : 0;
    const phrase = isActive ? this.audio.musicPhrase() : 0;
    const status = !isActive ? 'ARRÊT' : this.paused ? 'PAUSE' : 'LECTURE';
    const statusColor = !isActive ? '#7e8ba0' : this.paused ? '#fbbf24' : '#86efac';
    UI.panel(ctx, 70, 278, 1140, 112, { radius: 16, fill: 'rgba(8, 11, 18, 0.88)', stroke: 'rgba(125, 211, 252, 0.18)' });
    UI.txt(ctx, status, 96, 315, { size: 18, weight: 900, color: statusColor });
    UI.txt(ctx, 'A · LIRE', 270, 315, { size: 15, mono: true, color: '#dce6f3' });
    UI.txt(ctx, 'START · PAUSE', 400, 315, { size: 15, mono: true, color: '#dce6f3' });
    UI.txt(ctx, 'B · STOP', 600, 315, { size: 15, mono: true, color: '#dce6f3' });
    UI.txt(ctx, `${this.audio.musicBpm()} BPM`, 96, 360, { size: 15, mono: true, color: '#92a0b4' });
    UI.txt(ctx, `BEAT ${beat.toFixed(2)}`, 260, 360, { size: 15, mono: true, color: '#dce6f3' });
    UI.txt(ctx, `BAR ${bar || '—'}  ·  STEP ${step || '—'}`, 470, 360, { size: 15, mono: true, color: '#dce6f3' });
    UI.txt(ctx, `PHRASE ${phrase || '—'}`, 760, 360, { size: 15, mono: true, color: '#dce6f3' });
    UI.txt(ctx, this.playingReference ? REFERENCE_LABELS[this.playingReference] : 'AUCUNE RÉFÉRENCE', 1000, 360, { size: 13, mono: true, align: 'right', color: '#8490a5' });
  }

  private drawLayers(ctx: CanvasRenderingContext2D): void {
    UI.txt(ctx, 'COUCHES · X ACTIVE/DÉSACTIVE', 72, 424, { size: 14, mono: true, color: '#8490a5' });
    LAYERS.forEach((layer, index) => {
      const x = 70 + index * 180;
      const selected = index === this.layerIndex;
      const enabled = this.layerEnabled[layer];
      UI.panel(ctx, x, 440, 160, 52, {
        radius: 12,
        fill: enabled ? 'rgba(20, 37, 54, 0.72)' : 'rgba(25, 28, 37, 0.72)',
        stroke: selected ? this.accent : enabled ? 'rgba(125, 211, 252, 0.24)' : 'rgba(125, 135, 153, 0.2)',
        lineWidth: selected ? 2 : 1,
      });
      UI.txt(ctx, `${enabled ? '●' : '○'} ${LAYER_LABELS[layer]}`, x + 14, 472, { size: 13, mono: true, color: enabled ? '#dce6f3' : '#69758a' });
    });
  }

  private drawMusicState(ctx: CanvasRenderingContext2D): void {
    const adaptive = this.audio.isAdaptiveEnabled();
    const current = this.audio.getMusicState();
    const target = this.audio.getMusicTargetState();
    UI.panel(ctx, 70, 508, 1140, 138, {
      radius: 16,
      fill: 'rgba(8, 11, 18, 0.88)',
      stroke: adaptive ? 'rgba(134, 239, 172, 0.4)' : 'rgba(125, 211, 252, 0.18)',
    });
    UI.txt(ctx, 'ÉTAT MUSICAL · Y POUR FOCALISER', 72, 530, { size: 14, mono: true, color: '#8490a5' });
    UI.panel(ctx, 1010, 514, 180, 26, {
      radius: 13,
      fill: adaptive ? 'rgba(134, 239, 172, 0.16)' : 'rgba(126, 139, 160, 0.1)',
      stroke: adaptive ? 'rgba(134, 239, 172, 0.65)' : 'rgba(126, 139, 160, 0.25)',
    });
    UI.txt(ctx, adaptive ? 'ADAPTATIF · LB' : 'REFERENCE · LB', 1100, 532, {
      size: 11,
      mono: true,
      align: 'center',
      color: adaptive ? '#bbf7d0' : '#aab5c7',
    });

    MUSIC_STATE_KEYS.forEach((key, index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      const x = 70 + column * 380;
      const y = 538 + row * 33;
      const selected = this.stateFocus && index === this.stateIndex;
      UI.panel(ctx, x, y, 360, 27, {
        radius: 8,
        fill: selected ? 'rgba(125, 211, 252, 0.12)' : 'rgba(255,255,255,0.025)',
        stroke: selected ? this.accent : 'rgba(125, 211, 252, 0.08)',
        lineWidth: selected ? 2 : 1,
      });
      UI.txt(ctx, STATE_LABELS[key], x + 12, y + 18, { size: 11, mono: true, color: selected ? '#f4f8ff' : '#a0adbf' });
      const barX = x + 150;
      const barY = y + 9;
      const barW = 158;
      ctx.fillStyle = 'rgba(125, 211, 252, 0.12)';
      ctx.fillRect(barX, barY, barW, 8);
      ctx.fillStyle = selected ? this.accent : 'rgba(125, 211, 252, 0.7)';
      ctx.fillRect(barX, barY, barW * current[key], 8);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(barX + barW * target[key] - 1, barY - 3, 2, 14);
      UI.txt(ctx, `${Math.round(current[key] * 100).toString().padStart(3, '0')}`, x + 340, y + 18, {
        size: 11,
        mono: true,
        align: 'right',
        color: '#dce6f3',
      });
    });
  }

  private drawFooter(ctx: CanvasRenderingContext2D): void {
    const beat = this.audio.musicBeat();
    const glow = pulse(this.time + beat);
    const controls = this.stateFocus
      ? 'Y quitter état   ↑ ↓ axe   ← → valeur   LB adaptatif   RB reset'
      : '← → référence   ↑ ↓ couche   Y état   X couche   LB adaptatif';
    UI.txt(ctx, controls, 70, 675, { size: 14, mono: true, color: '#a5b2c5' });
    UI.txt(ctx, 'A lire   START pause   B stop   Échap retour hub', 70, 700, { size: 13, mono: true, color: '#8490a5' });
    UI.txt(ctx, this.audio.isAdaptiveEnabled()
      ? `DIRECTION ADAPTATIVE · ${this.audio.musicSection().toUpperCase()}`
      : 'RÉFÉRENCE FIXE · DÉTERMINISTE', 1210, 700, { size: 12, mono: true, align: 'right', color: `rgba(125, 211, 252, ${glow})` });
  }
}
