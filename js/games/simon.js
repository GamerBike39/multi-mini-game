// BLOB SIMON — mémoire : quatre pads-blobs en losange, la séquence s'allonge d'une
// note à chaque manche. Regarde la démo, rejoue-la. Chaque pad a SA note (pentatonique).
// Score = longueur de la dernière séquence complétée (séquence de 7 ratée → 6).

import { BaseGame } from '../core/game.js';
import { Blob } from '../core/blob.js';
import * as UI from '../core/ui.js';

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class SimonGame extends BaseGame {
  static meta = {
    id: 'simon', name: 'BLOB SIMON', accent: '#c084fc', mood: 'simon',
    desc: 'Mémoire de blob', controls: 'Y · X · A · B (U J K L)',
    keys: "U L J K",
    hint: 'Regarde la séquence puis rejoue-la · Y X A B',
    unit: 'notes', ranks: [16, 13, 10, 7, 4],
  };

  constructor(engine) {
    super(engine);

    // losange de pads : haut=Y, gauche=X, droite=B, bas=A (MIDI 60/64/67/72)
    this.pads = [
      { x: 640, y: 190, btn: 'y', key: 'U', color: '#f97316', midi: 60, lx: 0, ly: -66 },
      { x: 430, y: 375, btn: 'x', key: 'L', color: '#22d3ee', midi: 64, lx: -80, ly: 8 },
      { x: 850, y: 375, btn: 'b', key: 'K', color: '#f472b6', midi: 67, lx: 80, ly: 8 },
      { x: 640, y: 560, btn: 'a', key: 'J', color: '#a3e635', midi: 72, lx: 0, ly: 66 },
    ].map((d) => ({ ...d, f: midiHz(d.midi), lit: 0, blob: new Blob({ x: d.x, y: d.y, r: 46, color: d.color }) }));
    this.btnPad = { y: 0, x: 1, b: 2, a: 3 };

    // le blob de BaseGame devient un petit spectateur en bas
    this.blob.x = 640; this.blob.y = 660; this.blob.r = 14;

    this.seq = [(Math.random() * 4) | 0];
    this.seq.push(this.randNote()); // séquence initiale de 2 notes (jamais deux fois la même de suite)
    this.round = 1;
    this.phase = 'show';        // 'show' | 'input' | 'roundEnd'
    this.showIdx = 0;
    this.showT = 1.1;           // temps d'avance avant la première note
    this.inputIdx = 0;
    this.idleT = 6;
    this.roundEndT = 0;
    this.winNext = false;
    this.active = -1;           // pad que tout le monde regarde

    // poussière d'ambiance
    this.dust = [];
    for (let i = 0; i < 34; i++) {
      this.dust.push({ x: Math.random() * 1280, y: Math.random() * 720, z: 0.2 + Math.random() * 0.8, s: Math.random() * 6.28 });
    }
  }

  // note au hasard, différente de la précédente (deux notes identiques d'affilée = illisibles)
  randNote() {
    let n;
    do { n = (Math.random() * 4) | 0; } while (n === this.seq[this.seq.length - 1]);
    return n;
  }

  // durée d'allumage d'une note : accélère d'une manche à l'autre (0.42 s → 0.22 s vers la manche 8)
  litDur() { return Math.max(0.22, 0.42 - (this.round - 1) * 0.028); }

  // son d'un pad : triangle + octave au-dessus en square très léger
  playNote(p, dur) {
    this.audio.tone({ f: p.f, type: 'triangle', dur, vol: 0.22 });
    this.audio.tone({ f: p.f * 2, type: 'square', dur: dur * 0.8, vol: 0.06 });
  }

  // note de la démo : pad allumé ~litDur, punch, anneau de sa couleur
  demoNote(i) {
    const p = this.pads[i];
    this.active = i;
    p.lit = this.litDur();
    p.blob.punch(0.4);
    this.blob.punch(0.12);
    this.playNote(p, 0.22);
    this.fx.ring(p.x, p.y, { r0: 18, r1: 86, color: p.color, life: 0.4, width: 4 });
  }

  onPress(idx) {
    const p = this.pads[idx];
    if (this.seq[this.inputIdx] === idx) {
      // bonne note : même son mais court, punch, mini burst
      this.active = idx;
      p.lit = 0.2;
      p.blob.punch(0.3);
      this.blob.punch(0.1);
      this.playNote(p, 0.12);
      this.fx.burst(p.x, p.y, { n: 7, speed: [40, 190], colors: [p.color, '#ffffff'], size: [2, 4], life: 0.35 });
      this.input.rumble(0.12, 0.04);
      this.inputIdx++;
      this.idleT = 6;
      if (this.inputIdx >= this.seq.length) this.roundDone();
    } else {
      this.fail(idx);
    }
  }

  roundDone() {
    this.score = this.seq.length; // manche complétée : le score monte à sa longueur
    this.audio.milestone();
    this.fx.flash(this.accent, 0.12);
    this.fx.ring(640, 375, { r0: 30, r1: 210, color: this.accent, life: 0.5, width: 5 });
    this.fx.burst(640, 375, { n: 22, speed: [80, 380], colors: [this.accent, '#ffffff', '#e9d5ff'], life: 0.6 });
    this.fx.text(640, 282, 'MANCHE ' + this.round + ' !', { color: this.accent, size: 26 });
    for (const p of this.pads) p.blob.punch(0.22);
    this.input.rumble(0.3, 0.12);
    this.phase = 'roundEnd';
    this.roundEndT = 0.55;
    this.winNext = this.seq.length >= 16; // manche de 16 notes complétée → victoire
    this.active = -1;
  }

  fail(pressedIdx) {
    const exp = this.pads[this.seq[this.inputIdx]];
    const bad = pressedIdx >= 0 ? this.pads[pressedIdx] : null;
    this.audio.miss();
    this.fx.shake(0.7);
    this.fx.stop(0.08);
    this.fx.flash('#ff5470', 0.16);
    this.input.rumble(0.8, 0.3);
    // le pad fautif panique ; le pad attendu s'allume pour montrer la bonne réponse
    (bad || exp).blob.scared = true;
    exp.lit = Math.max(exp.lit, 0.6);
    exp.blob.punch(0.4);
    this.fx.ring(exp.x, exp.y, { r0: 16, r1: 92, color: '#ffffff', life: 0.5, width: 3 });
    if (bad) this.fx.burst(bad.x, bad.y, { n: 14, speed: [60, 300], colors: ['#ff5470', '#ffffff'], life: 0.5 });
    this.fx.text(640, 282, pressedIdx >= 0 ? 'RATÉ !' : 'TROP TARD !', { color: '#ff5470', size: 28 });
    this.blob.scared = true;
    this.over();
  }

  nextRound() {
    this.round++;
    this.seq.push(this.randNote()); // +1 note à chaque manche réussie
    this.phase = 'show';
    this.showIdx = 0;
    this.showT = 0.5;
  }

  // fait regarder un blob vers un point (regard normalisé)
  watch(b, x, y) {
    const dx = x - b.x, dy = y - b.y, l = Math.hypot(dx, dy) || 1;
    b.lookX = dx / l; b.lookY = dy / l;
  }

  update(dt) {
    if (this.baseUpdate(dt)) return;
    const I = this.input;

    for (const p of this.pads) {
      p.lit = Math.max(0, p.lit - dt);
      p.blob.update(dt);
    }
    this.blob.y = 660 + Math.sin(this.time * 2.4) * 3;
    this.blob.update(dt);

    // poussière
    for (const d of this.dust) {
      d.y -= (6 + d.z * 14) * dt;
      d.x += Math.sin(this.time * 0.7 + d.s) * 8 * dt;
      if (d.y < -6) { d.y = 726; d.x = Math.random() * 1280; }
    }

    if (this.phase === 'show') {
      // démo : inputs verrouillés (un appui ne donne qu'un petit souffle)
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
      for (const btn in this.btnPad) if (I.pressed(btn)) { hit = this.btnPad[btn]; break; }
      if (hit >= 0) this.onPress(hit);
      else if (this.idleT <= 0) this.fail(-1); // timeout 6 s
    } else {
      // pause de célébration, puis manche suivante (ou victoire)
      this.roundEndT -= dt;
      if (this.roundEndT <= 0) {
        if (this.winNext) { this.over(true); return; }
        this.nextRound();
      }
    }

    // tout le monde regarde le pad actif
    const f = this.active >= 0 ? this.pads[this.active] : null;
    for (const p of this.pads) {
      if (!f) this.watch(p.blob, 640, 380);
      else if (f === p) { p.blob.lookX = 0; p.blob.lookY = 0.35; }
      else this.watch(p.blob, f.x, f.y);
    }
    this.watch(this.blob, f ? f.x : 640, f ? f.y : 430);
  }

  render(ctx) {
    ctx.fillStyle = '#0a0812';
    ctx.fillRect(0, 0, 1280, 720);

    this.fx.world(ctx);

    UI.grid(ctx, { gap: 72, alpha: 0.04 });

    // poussière d'ambiance
    ctx.fillStyle = this.accent;
    for (const d of this.dust) {
      ctx.globalAlpha = 0.04 + d.z * 0.07;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 1 + d.z * 1.6, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // losange reliant les pads
    ctx.strokeStyle = this.accent + '2b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(640, 190); ctx.lineTo(430, 375); ctx.lineTo(640, 560); ctx.lineTo(850, 375);
    ctx.closePath();
    ctx.stroke();

    // pads : halo quand allumé, blob par-dessus, étiquette bouton+touche
    for (const p of this.pads) {
      if (p.lit > 0) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, p.lit * 3) * 0.5;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 44;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.blob.r + 13, 0, 6.2832);
        ctx.fill();
        ctx.restore();
      }
      p.blob.render(ctx);
      UI.txt(ctx, p.btn.toUpperCase() + ' · ' + p.key, p.x + p.lx, p.y + p.ly, {
        size: 15, align: 'center', color: p.color, mono: true, shadow: true, alpha: 0.9,
      });
    }

    // spectateur
    this.blob.render(ctx);

    // consigne centrale + points de progression + temps restant
    if (this.state === 'play') {
      const a = 0.78 + 0.22 * Math.sin(this.time * 5);
      const msg = this.phase === 'show' ? 'REGARDE' : this.phase === 'input' ? 'À TOI' : (this.winNext ? 'BRAVO !' : 'PARFAIT !');
      const col = this.phase === 'input' ? '#ffffff' : this.accent;
      UI.txt(ctx, msg, 640, 342, { size: 40, align: 'center', weight: 900, color: col, shadow: true, alpha: a });

      const n = this.seq.length, sp = 18, x0 = 640 - ((n - 1) * sp) / 2;
      const done = this.phase === 'input' ? this.inputIdx : this.phase === 'show' ? this.showIdx : n;
      for (let i = 0; i < n; i++) {
        const x = x0 + i * sp;
        if (i < done) {
          ctx.fillStyle = this.pads[this.seq[i]].color;
          ctx.beginPath(); ctx.arc(x, 378, 4.5, 0, 6.2832); ctx.fill();
        } else if (this.phase === 'input' && i === this.inputIdx) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.globalAlpha = 0.45 + 0.45 * Math.sin(this.time * 9);
          ctx.beginPath(); ctx.arc(x, 378, 6.5, 0, 6.2832); ctx.stroke();
          ctx.globalAlpha = 1;
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.13)';
          ctx.beginPath(); ctx.arc(x, 378, 3, 0, 6.2832); ctx.fill();
        }
      }
      if (this.phase === 'input') {
        const k = Math.max(0, this.idleT / 6);
        ctx.fillStyle = 'rgba(255,255,255,0.09)';
        ctx.fillRect(580, 398, 120, 4);
        ctx.fillStyle = this.idleT < 2 ? '#ff5470' : 'rgba(255,255,255,0.4)';
        ctx.fillRect(580, 398, 120 * k, 4);
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
