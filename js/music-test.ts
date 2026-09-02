import * as UI from './core/ui';
import type { AppLike, EngineLike, InputLike, MusicLayerName } from './core/types';
import type { ReferenceMusic } from './core/music/types';

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
  private playingReference: ReferenceMusic | null = null;
  paused = false;
  private readonly layerEnabled: Record<MusicLayerName, boolean> = {
    drums: true,
    bass: true,
    harmony: true,
    arp: true,
    lead: true,
    fx: true,
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
    if (I.pressed('left')) this.selectReference(-1);
    if (I.pressed('right')) this.selectReference(1);
    if (I.pressed('up')) this.selectLayer(-1);
    if (I.pressed('down')) this.selectLayer(1);
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
    this.drawFooter(ctx);
  }

  exit(): void {
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
    }
  }

  onPointerMove(x: number, y: number): void {
    this.cursor = (y >= 150 && y <= 252) || (y >= 278 && y <= 340) || (y >= 425 && y <= 490)
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

  private drawFooter(ctx: CanvasRenderingContext2D): void {
    const beat = this.audio.musicBeat();
    const glow = pulse(this.time + beat);
    UI.txt(ctx, '← → référence   ↑ ↓ couche   A lire   START pause   B stop   Échap retour hub', 70, 655, { size: 15, mono: true, color: '#a5b2c5' });
    UI.txt(ctx, 'COMPOSITION FIXE · PAS DE SEED · PAS D’ADAPTATION', 70, 682, { size: 13, mono: true, color: `rgba(125, 211, 252, ${glow})` });
  }
}
