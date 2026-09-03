// BLOB SIMON — mémoire : quatre pads-blobs en losange, la séquence s'allonge d'une
// note à chaque manche. Regarde la démo, rejoue-la. Chaque pad a SA note (pentatonique).
// Score = longueur de la dernière séquence complétée (séquence de 7 ratée → 6).

import { BaseGame } from '../core/game';
import { Blob } from '../core/blob';
import * as UI from '../core/ui';
import type { Action, GameMeta, InputLike } from '../core/types';

const midiHz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);
const SIMON_ACTIONS: readonly SimonAction[] = ['y', 'x', 'b', 'a'];

type SimonAction = Extract<Action, 'a' | 'b' | 'x' | 'y'>;
type SimonPhase = 'show' | 'input' | 'roundEnd';

interface PadDefinition {
  x: number;
  y: number;
  btn: SimonAction;
  key: string;
  color: string;
  midi: number;
  lx: number;
  ly: number;
}

interface SimonPad extends PadDefinition {
  f: number;
  lit: number;
  blob: Blob;
}

interface Dust {
  x: number;
  y: number;
  z: number;
  s: number;
}

export class SimonGame extends BaseGame {
  static meta: GameMeta = {
    id: 'simon', name: 'BLOB SIMON', accent: '#c084fc', mood: 'simon',
    desc: 'Mémoire de blob', controls: 'Y · X · A · B (U J K L)',
    keys: 'U L J K',
    hint: 'Regarde la séquence puis rejoue-la · Y X A B',
    unit: 'notes', ranks: [16, 13, 10, 7, 4],
  };

  pads: SimonPad[];
  btnPad: Record<SimonAction, number>;
  seq: number[];
  round = 1;
  phase: SimonPhase = 'show';
  showIdx = 0;
  showT = 1.1;
  inputIdx = 0;
  idleT = 6;
  roundEndT = 0;
  winNext = false;
  active = -1;
  dust: Dust[] = [];

  constructor(engine: ConstructorParameters<typeof BaseGame>[0]) {
    super(engine);

    // Losange de pads : haut=Y, gauche=X, droite=B, bas=A (MIDI 60/64/67/72).
    const definitions: PadDefinition[] = [
      { x: 640, y: 190, btn: 'y', key: 'U', color: '#f97316', midi: 60, lx: 0, ly: -66 },
      { x: 430, y: 375, btn: 'x', key: 'L', color: '#22d3ee', midi: 64, lx: -80, ly: 8 },
      { x: 850, y: 375, btn: 'b', key: 'K', color: '#f472b6', midi: 67, lx: 80, ly: 8 },
      { x: 640, y: 560, btn: 'a', key: 'J', color: '#a3e635', midi: 72, lx: 0, ly: 66 },
    ];
    this.pads = definitions.map((definition) => ({
      ...definition,
      f: midiHz(definition.midi),
      lit: 0,
      blob: new Blob({ x: definition.x, y: definition.y, r: 46, color: definition.color }),
    }));
    this.btnPad = { y: 0, x: 1, b: 2, a: 3 };

    // Le blob de BaseGame devient un petit spectateur en bas.
    this.blob.x = 640;
    this.blob.y = 660;
    this.blob.r = 14;

    this.seq = [this.rng.int(0, 3)];
    this.seq.push(this.randNote()); // séquence initiale de 2 notes (jamais deux fois la même de suite)

    // Poussière d'ambiance.
    for (let i = 0; i < 34; i++) {
      this.dust.push({ x: Math.random() * 1280, y: Math.random() * 720, z: 0.2 + Math.random() * 0.8, s: Math.random() * 6.28 });
    }
  }

  // Note au hasard, différente de la précédente (deux notes identiques d'affilée = illisibles).
  randNote(): number {
    let note = 0;
    do {
      note = this.rng.int(0, 3);
    } while (note === this.seq[this.seq.length - 1]);
    return note;
  }

  // Durée d'allumage d'une note : accélère d'une manche à l'autre.
  litDur(): number {
    return Math.max(0.22, 0.42 - (this.round - 1) * 0.028);
  }

  // Son d'un pad : triangle + octave au-dessus en square très léger.
  playNote(pad: SimonPad, duration: number): void {
    this.audio.tone({ f: pad.f, type: 'triangle', dur: duration, vol: 0.22 });
    this.audio.tone({ f: pad.f * 2, type: 'square', dur: duration * 0.8, vol: 0.06 });
  }

  // Note de la démo : pad allumé ~litDur, punch, anneau de sa couleur.
  demoNote(index: number): void {
    const pad = this.pads[index];
    this.active = index;
    pad.lit = this.litDur();
    pad.blob.punch(0.4);
    this.blob.punch(0.12);
    this.playNote(pad, 0.22);
    this.fx.ring(pad.x, pad.y, { r0: 18, r1: 86, color: pad.color, life: 0.4, width: 4 });
  }

  onPress(index: number): void {
    const pad = this.pads[index];
    if (this.seq[this.inputIdx] === index) {
      // Bonne note : même son mais court, punch, mini burst.
      this.active = index;
      pad.lit = 0.2;
      pad.blob.punch(0.3);
      this.blob.punch(0.1);
      this.playNote(pad, 0.12);
      this.fx.burst(pad.x, pad.y, { n: 7, speed: [40, 190], colors: [pad.color, '#ffffff'], size: [2, 4], life: 0.35 });
      this.input.rumble(0.12, 0.04);
      this.inputIdx++;
      if (this.inputIdx >= this.seq.length) this.roundDone();
    } else {
      this.fail(index);
    }
  }

  roundDone(): void {
    this.score = this.seq.length;
    this.musicEvent('perfect', Math.min(1.2, 0.45 + this.seq.length * 0.04));
    this.musicEvent('waveComplete', 0.5);
    this.audio.milestone();
    this.fx.flash(this.accent, 0.12);
    this.fx.ring(640, 375, { r0: 30, r1: 210, color: this.accent, life: 0.5, width: 5 });
    this.fx.burst(640, 375, { n: 22, speed: [80, 380], colors: [this.accent, '#ffffff', '#e9d5ff'], life: 0.6 });
    this.fx.text(640, 282, 'MANCHE ' + this.round + ' !', { color: this.accent, size: 26 });
    for (const pad of this.pads) pad.blob.punch(0.22);
    this.input.rumble(0.3, 0.12);
    this.phase = 'roundEnd';
    this.roundEndT = 0.55;
    this.winNext = this.seq.length >= 16;
    this.active = -1;
  }

  fail(pressedIndex: number): void {
    const expected = this.pads[this.seq[this.inputIdx]];
    const bad = pressedIndex >= 0 ? this.pads[pressedIndex] : null;
    this.audio.miss();
    this.fx.shake(0.7);
    this.fx.stop(0.08);
    this.fx.flash('#ff5470', 0.16);
    this.input.rumble(0.8, 0.3);
    // Le pad fautif panique ; le pad attendu s'allume pour montrer la bonne réponse.
    (bad || expected).blob.scared = true;
    expected.lit = Math.max(expected.lit, 0.6);
    expected.blob.punch(0.4);
    this.fx.ring(expected.x, expected.y, { r0: 16, r1: 92, color: '#ffffff', life: 0.5, width: 3 });
    if (bad) this.fx.burst(bad.x, bad.y, { n: 14, speed: [60, 300], colors: ['#ff5470', '#ffffff'], life: 0.5 });
    this.fx.text(640, 282, pressedIndex >= 0 ? 'RATÉ !' : 'TROP TARD !', { color: '#ff5470', size: 28 });
    this.blob.scared = true;
    this.over();
  }

  nextRound(): void {
    this.round++;
    this.musicEvent('waveStart', 0.3);
    this.seq.push(this.randNote());
    this.phase = 'show';
    this.showIdx = 0;
    this.showT = 0.5;
  }

  // Fait regarder un blob vers un point (regard normalisé).
  watch(blob: Blob, x: number, y: number): void {
    const dx = x - blob.x;
    const dy = y - blob.y;
    const length = Math.hypot(dx, dy) || 1;
    blob.lookX = dx / length;
    blob.lookY = dy / length;
  }

  update(dt: number): void {
    if (this.baseUpdate(dt)) return;
    const I: InputLike = this.input;

    for (const pad of this.pads) {
      pad.lit = Math.max(0, pad.lit - dt);
      pad.blob.update(dt);
    }
    this.blob.y = 660 + Math.sin(this.time * 2.4) * 3;
    this.blob.update(dt);

    // Poussière.
    for (const dust of this.dust) {
      dust.y -= (6 + dust.z * 14) * dt;
      dust.x += Math.sin(this.time * 0.7 + dust.s) * 8 * dt;
      if (dust.y < -6) {
        dust.y = 726;
        dust.x = Math.random() * 1280;
      }
    }

    if (this.phase === 'show') {
      // Démo : inputs verrouillés (un appui ne donne qu'un petit souffle).
      if (I.pressed('a') || I.pressed('b') || I.pressed('x') || I.pressed('y')) this.audio.whiff();
      this.showT -= dt;
      if (this.showT <= 0) {
        if (this.showIdx < this.seq.length) {
          this.demoNote(this.seq[this.showIdx]);
          this.showIdx++;
          this.showT = this.litDur() + 0.16;
        } else {
          this.phase = 'input';
          this.inputIdx = 0;
          this.idleT = 6;
          this.active = -1;
        }
      }
    } else if (this.phase === 'input') {
      this.idleT -= dt;
      let hit = -1;
      for (const action of SIMON_ACTIONS) {
        if (I.pressed(action)) {
          hit = this.btnPad[action];
          break;
        }
      }
      if (hit >= 0) this.onPress(hit);
      else if (this.idleT <= 0) this.fail(-1);
    } else {
      // Pause de célébration, puis manche suivante (ou victoire).
      this.roundEndT -= dt;
      if (this.roundEndT <= 0) {
        if (this.winNext) {
          this.over(true);
          return;
        }
        this.nextRound();
      }
    }

    // Tout le monde regarde le pad actif.
    const focus = this.active >= 0 ? this.pads[this.active] : null;
    for (const pad of this.pads) {
      if (!focus) this.watch(pad.blob, 640, 380);
      else if (focus === pad) {
        pad.blob.lookX = 0;
        pad.blob.lookY = 0.35;
      } else this.watch(pad.blob, focus.x, focus.y);
    }
    this.watch(this.blob, focus ? focus.x : 640, focus ? focus.y : 430);
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#0a0812';
    ctx.fillRect(0, 0, 1280, 720);

    this.fx.world(ctx);
    UI.grid(ctx, { gap: 72, alpha: 0.04 });

    // Poussière d'ambiance.
    ctx.fillStyle = this.accent;
    for (const dust of this.dust) {
      ctx.globalAlpha = 0.04 + dust.z * 0.07;
      ctx.beginPath();
      ctx.arc(dust.x, dust.y, 1 + dust.z * 1.6, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Losange reliant les pads.
    ctx.strokeStyle = this.accent + '2b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(640, 190);
    ctx.lineTo(430, 375);
    ctx.lineTo(640, 560);
    ctx.lineTo(850, 375);
    ctx.closePath();
    ctx.stroke();

    // Pads : halo quand allumé, blob par-dessus, étiquette bouton+touche.
    for (const pad of this.pads) {
      if (pad.lit > 0) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, pad.lit * 3) * 0.5;
        ctx.shadowColor = pad.color;
        ctx.shadowBlur = 44;
        ctx.fillStyle = pad.color;
        ctx.beginPath();
        ctx.arc(pad.x, pad.y, pad.blob.r + 13, 0, 6.2832);
        ctx.fill();
        ctx.restore();
      }
      pad.blob.render(ctx);
      UI.txt(ctx, pad.btn.toUpperCase() + ' · ' + pad.key, pad.x + pad.lx, pad.y + pad.ly, {
        size: 15, align: 'center', color: pad.color, mono: true, shadow: true, alpha: 0.9,
      });
    }

    // Spectateur.
    this.blob.render(ctx);

    // Consigne centrale + points de progression + temps restant.
    if (this.state === 'play') {
      const alpha = 0.78 + 0.22 * Math.sin(this.time * 5);
      const message = this.phase === 'show' ? 'REGARDE' : this.phase === 'input' ? 'À TOI' : (this.winNext ? 'BRAVO !' : 'PARFAIT !');
      const color = this.phase === 'input' ? '#ffffff' : this.accent;
      UI.txt(ctx, message, 640, 342, { size: 40, align: 'center', weight: 900, color, shadow: true, alpha });

      const length = this.seq.length;
      const spacing = 18;
      const x0 = 640 - ((length - 1) * spacing) / 2;
      const done = this.phase === 'input' ? this.inputIdx : this.phase === 'show' ? this.showIdx : length;
      for (let i = 0; i < length; i++) {
        const x = x0 + i * spacing;
        if (i < done) {
          ctx.fillStyle = this.pads[this.seq[i]].color;
          ctx.beginPath();
          ctx.arc(x, 378, 4.5, 0, 6.2832);
          ctx.fill();
        } else if (this.phase === 'input' && i === this.inputIdx) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.globalAlpha = 0.45 + 0.45 * Math.sin(this.time * 9);
          ctx.beginPath();
          ctx.arc(x, 378, 6.5, 0, 6.2832);
          ctx.stroke();
          ctx.globalAlpha = 1;
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.13)';
          ctx.beginPath();
          ctx.arc(x, 378, 3, 0, 6.2832);
          ctx.fill();
        }
      }
      if (this.phase === 'input') {
        const progress = Math.max(0, this.idleT / 6);
        ctx.fillStyle = 'rgba(255,255,255,0.09)';
        ctx.fillRect(580, 398, 120, 4);
        ctx.fillStyle = this.idleT < 2 ? '#ff5470' : 'rgba(255,255,255,0.4)';
        ctx.fillRect(580, 398, 120 * progress, 4);
      }
    }

    this.fx.drawWorld(ctx);
    this.fx.endWorld(ctx);

    UI.drawHUD(ctx, {
      accent: this.accent,
      score: this.score,
      unit: this.meta.unit,
      extra: () => UI.txt(ctx, 'MANCHE ' + this.round + ' · ' + this.seq.length + ' NOTES', 28, 70, { size: 13, color: '#7c8698' }),
    });

    this.drawCommon(ctx);
  }
}
