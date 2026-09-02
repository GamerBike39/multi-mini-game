// Menu principal, deux vues :
//  - FICHE (défaut)  : plein écran pour le jeu sélectionné — démo simulée en fond,
//                      détails (contrôles, astuce), statistiques, rangs, et en bas le
//                      bandeau de vignettes pour naviguer de jeu en jeu.
//  - GRILLE (globale): la grille de cartes d'origine, conservée pour la vue d'ensemble.
// A lance depuis les deux vues ; X / clic ouvre la fiche ; B/Échap revient à la grille.

import { Fx } from './core/fx.js';
import { Blob } from './core/blob.js';
import { Demo } from './demos.js';
import * as UI from './core/ui.js';

// grille (vue globale)
const COLS = 5;
const CARD_W = 170, CARD_H = 205, GAP_X = 22, GAP_Y = 26;
const START_X = (1280 - (COLS * CARD_W + (COLS - 1) * GAP_X)) / 2;
const ROW0_Y = 178;
const DIGIT_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'];

// bandeau de vignettes (fiche)
const TH_W = 108, TH_H = 74, TH_GAP = 12;
const TH_X0 = (1280 - (10 * TH_W + 9 * TH_GAP)) / 2;
const TH_Y = 626;

// bouton lancer (fiche) : zone de clic fixe, le dessin pulse autour
const PILL = { x: 878 - 116, y: 566, w: 232, h: 46 };

const SWAP_T = 0.38;          // fondu de changement de jeu
const VIEW_T = 0.4;           // transition d'entrée de vue

const ease = (k) => k * k * (3 - 2 * k);

export class Menu {
  constructor(engine, games) {
    this.eng = engine;
    this.games = games;
    this.input = engine.input;
    this.audio = engine.audio;
    this.fx = new Fx();
    this.accent = '#7dd3fc';
    this.sel = 0;
    this.view = 'detail';       // 'detail' | 'grid' — la fiche est la porte d'entrée
    this.viewT = 1;
    this.rep = 0;
    this.wasL = false; this.wasR = false;
    this.wasU = false; this.wasD = false;
    this.t = 0;
    this.lastBeat = 0;
    this.hop = 0;
    this.swapT = 0;
    this.pendingDemo = null;
    this.hover = -1;            // élément survolé : index (vignette/carte) ou 'pill'
    this.cursor = 'default';
    this.demo = new Demo(games[0].meta.id, games[0].meta.accent);
    this.blob = new Blob({ x: 0, y: 0, r: 13, color: '#7dd3fc' });
    this.dots = [];
    for (let i = 0; i < 46; i++) this.dots.push({ x: Math.random() * 1280, y: Math.random() * 720, z: 0.2 + Math.random() * 0.8, s: Math.random() * 6.28 });
  }

  enter() { this.audio.startMusic('menu'); }
  exit() { this.audio.stopMusic(); }

  // ---------- navigation ----------
  move(d) {
    this.sel = (this.sel + d + this.games.length) % this.games.length;
    this.audio.uiMove();
  }

  setGame(i) {
    if (i === this.sel || i < 0 || i >= this.games.length) return;
    this.sel = i;
    this.swapT = SWAP_T;
    this.pendingDemo = i;
    this.audio.uiMove();
  }

  openDetail() {
    if (this.view === 'detail') return;
    this.view = 'detail';
    this.viewT = 0;
    this.audio.uiOk();
  }

  openGrid() {
    if (this.view === 'grid') return;
    this.view = 'grid';
    this.viewT = 0;
    this.audio.uiBack();
  }

  launch() {
    const g = this.games[this.sel];
    this.audio.uiOk();
    this.fx.flash(g.meta.accent, 0.22);
    this.eng.setApp(new g(this.eng));
  }

  cardPos(i) {
    const col = i % COLS, row = Math.floor(i / COLS);
    return { x: START_X + col * (CARD_W + GAP_X), y: ROW0_Y + row * (CARD_H + GAP_Y) };
  }

  thumbRect(i) {
    return { x: TH_X0 + i * (TH_W + TH_GAP), y: TH_Y, w: TH_W, h: TH_H };
  }

  // ---------- souris (interface uniquement) ----------
  hitThumb(x, y) {
    for (let i = 0; i < this.games.length; i++) {
      const r = this.thumbRect(i);
      if (x >= r.x && x <= r.x + r.w && y >= r.y - 8 && y <= r.y + r.h) return i;
    }
    return -1;
  }

  hitCard(x, y) {
    for (let i = 0; i < this.games.length; i++) {
      const p = this.cardPos(i);
      if (x >= p.x && x <= p.x + CARD_W && y >= p.y && y <= p.y + CARD_H) return i;
    }
    return -1;
  }

  hitPill(x, y) {
    return x >= PILL.x && x <= PILL.x + PILL.w && y >= PILL.y && y <= PILL.y + PILL.h;
  }

  // clic : vignette/carte = sélectionner (relancer le clic sur l'élément déjà
  // actif ou sur le bouton = lancer) ; ailleurs, aucun effet
  onPointer(x, y) {
    if (this.eng.settings.active) { this.eng.settings.onPointer(x, y); return; }
    if (this.view === 'detail') {
      const i = this.hitThumb(x, y);
      if (i >= 0) { i === this.sel ? this.launch() : this.setGame(i); return; }
      if (this.hitPill(x, y)) this.launch();
      return;
    }
    const i = this.hitCard(x, y);
    if (i >= 0) {
      if (i === this.sel) this.launch();
      else { this.sel = i; this.openDetail(); }
    }
  }

  // survol : surlignage + curseur main sur les éléments actifs
  onPointerMove(x, y) {
    this.cursor = 'default';
    if (this.eng.settings.active) {
      this.hover = -1;
      if (this.eng.settings.onPointerMove(x, y)) this.cursor = 'pointer';
      return;
    }
    if (this.view === 'detail') {
      this.hover = this.hitThumb(x, y);
      if (this.hover < 0 && this.hitPill(x, y)) this.hover = 'pill';
      if (this.hover !== -1) this.cursor = 'pointer';
    } else {
      this.hover = this.hitCard(x, y);
      if (this.hover >= 0) this.cursor = 'pointer';
    }
  }

  onPointerUp() {
    this.eng.settings.onPointerUp?.();
  }

  onPointerLeave() {
    this.hover = -1;
    this.cursor = 'default';
  }

  // ---------- update ----------
  update(dt) {
    this.t += dt;
    this.viewT = Math.min(1, this.viewT + dt / VIEW_T);
    const I = this.input;

    if (this.eng.settings.active) {
      this.eng.settings.update(dt);
    } else if (this.view === 'detail') {
      this.updateDetail(dt, I);
    } else {
      this.updateGrid(dt, I);
    }

    // démo : fondu au changement de jeu
    if (this.swapT > 0) {
      this.swapT -= dt;
      if (this.pendingDemo !== null && this.swapT <= SWAP_T / 2) {
        const g = this.games[this.pendingDemo];
        this.demo.reset(g.meta.id, g.meta.accent);
        this.pendingDemo = null;
      }
    }
    this.demo.update(dt);

    // blob : rebond sur le beat, perché sur l'élément sélectionné
    const beat = this.audio.beat();
    const bi = Math.floor(Math.max(0, beat));
    if (bi !== this.lastBeat && beat > 0) { this.lastBeat = bi; this.hop = 0.26; }
    this.hop = Math.max(0, this.hop - dt);

    let pos;
    if (this.view === 'detail') pos = this.thumbRect(this.sel);
    else pos = this.cardPos(this.sel);
    const cx = pos.x + (this.view === 'detail' ? TH_W : CARD_W) / 2;
    const hopH = this.hop > 0 ? Math.sin((1 - this.hop / 0.26) * Math.PI) * 16 : 0;
    const prevX = this.blob.x, prevY = this.blob.y;
    this.blob.x += (cx - this.blob.x) * Math.min(1, dt * 10);
    this.blob.y = pos.y - 2 - hopH;
    this.blob.vx = (this.blob.x - prevX) / Math.max(dt, 1e-4);
    this.blob.vy = (prevY - this.blob.y) / Math.max(dt, 1e-4);
    this.blob.update(dt);

    for (const d of this.dots) {
      d.x -= (8 + d.z * 22) * dt;
      d.y += Math.sin(this.t * 0.8 + d.s) * 6 * dt;
      if (d.x < -4) { d.x = 1284; d.y = Math.random() * 720; }
    }

    this.fx.zoom = 1;
  }

  updateDetail(dt, I) {
    const L = I.down('left') || I.moveX < -0.5;
    const R = I.down('right') || I.moveX > 0.5;
    if ((I.pressed('left') || (L && !this.wasL))) { this.setGame(this.sel - 1); this.rep = 0.34; }
    else if ((I.pressed('right') || (R && !this.wasR))) { this.setGame(this.sel + 1); this.rep = 0.34; }
    else if (L || R) {
      this.rep -= dt;
      if (this.rep <= 0) { this.setGame(this.sel + (L ? -1 : 1)); this.rep = 0.14; }
    }
    this.wasL = L; this.wasR = R;

    if (I.pressed('a') || I.pressed('start')) this.launch();
    if (I.pressed('b') || I.pressed('back')) this.openGrid();
    if (I.pressed('select')) { this.audio.uiOk(); this.eng.settings.open(); }
    for (let i = 0; i < DIGIT_KEYS.length && i < this.games.length; i++) {
      if (I.key(DIGIT_KEYS[i])) { this.sel = i; this.launch(); break; }
    }
  }

  updateGrid(dt, I) {
    const L = I.down('left') || I.moveX < -0.5;
    const R = I.down('right') || I.moveX > 0.5;
    if ((I.pressed('left') || (L && !this.wasL))) { this.move(-1); this.rep = 0.34; }
    else if ((I.pressed('right') || (R && !this.wasR))) { this.move(1); this.rep = 0.34; }
    else if (L || R) {
      this.rep -= dt;
      if (this.rep <= 0) { this.move(L ? -1 : 1); this.rep = 0.12; }
    }
    this.wasL = L; this.wasR = R;

    // vertical : saute de ligne (grille petite, pas besoin de répétition auto)
    const U = I.down('up') || I.moveY < -0.5;
    const D = I.down('down') || I.moveY > 0.5;
    if (I.pressed('up') || (U && !this.wasU)) this.move(-COLS);
    if (I.pressed('down') || (D && !this.wasD)) this.move(COLS);
    this.wasU = U; this.wasD = D;

    if (I.pressed('a') || I.pressed('start')) this.launch();
    // fiche détaillée : bouton X (manette) ou touche X (clavier)
    if (I.pressed('x') || I.key('KeyX')) this.openDetail();
    if (I.pressed('select') || I.pressed('back')) { this.audio.uiOk(); this.eng.settings.open(); }
    for (let i = 0; i < DIGIT_KEYS.length && i < this.games.length; i++) {
      if (I.key(DIGIT_KEYS[i])) { this.sel = i; this.launch(); break; }
    }
  }

  // ---------- rendu ----------
  glyph(ctx, id, x, y, col) { UI.gameGlyph(ctx, id, x, y, col); }

  render(ctx) {
    ctx.fillStyle = '#070910';
    ctx.fillRect(0, 0, 1280, 720);
    this.fx.world(ctx);

    UI.grid(ctx, { gap: 72, off: this.t * 8, alpha: 0.035 });
    for (const d of this.dots) {
      ctx.globalAlpha = 0.05 + d.z * 0.1;
      ctx.fillStyle = '#7dd3fc';
      ctx.beginPath();
      ctx.arc(d.x, d.y, 1.2 + d.z * 1.8, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (this.view === 'detail') this.renderDetail(ctx);
    else this.renderGrid(ctx);

    this.blob.render(ctx);
    this.fx.drawWorld(ctx);
    this.fx.endWorld(ctx);

    if (!this.audio.ctx) {
      UI.txt(ctx, 'Appuie sur une touche pour activer le son', 640, 610, { size: 12, align: 'center', color: '#5d6480' });
    }
  }

  // ----- vue fiche : plein écran pour le jeu sélectionné -----
  renderDetail(ctx) {
    const g = this.games[this.sel];
    const meta = g.meta;
    const acc = meta.accent;
    const e = ease(this.viewT);
    const slide = (1 - e) * 34;

    // ----- écran dédié de la démo (à droite) -----
    // Les démos sont dessinées dans leur espace logique (x 430..960, y 140..630,
    // centre 695/385) puis projetées dans le cadre : centre (878,343), échelle 0.886.
    const SX = 540, SY = 88, SW = 676, SH = 472;
    const IX = SX + 12, IY = SY + 38, IW = SW - 24, IH = SH - 50;
    ctx.save();
    ctx.globalAlpha = e;
    ctx.translate(-slide * 0.4, 0);
    UI.panel(ctx, SX, SY, SW, SH, { radius: 18, fill: 'rgba(9,12,19,0.94)', stroke: acc + '55', lineWidth: 2 });
    UI.txt(ctx, 'APERÇU · DÉMO', SX + 18, SY + 25, { size: 11, mono: true, color: acc });
    if (Math.sin(this.t * 3.2) > -0.3) {
      ctx.fillStyle = '#ff5470';
      ctx.beginPath();
      ctx.arc(SX + SW - 24, SY + 20, 5, 0, 6.2832);
      ctx.fill();
    }
    UI.txt(ctx, 'SIMULÉ EN BOUCLE', SX + SW - 38, SY + 25, { size: 10, align: 'right', mono: true, color: '#5d6480' });

    ctx.save();
    UI.roundRect(ctx, IX, IY, IW, IH, 10);
    ctx.clip();
    ctx.fillStyle = '#05070d';
    ctx.fillRect(IX, IY, IW, IH);
    UI.grid(ctx, { gap: 56, off: this.t * 6, alpha: 0.05, color: acc });
    ctx.save();
    ctx.translate(878, 343);
    ctx.scale(0.886, 0.886);
    ctx.translate(-695, -385);
    this.demo.draw(ctx);
    ctx.restore();
    // scanlines discrètes, façon borne d'arcade
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = '#000000';
    for (let y = IY + 2; y < IY + IH; y += 4) ctx.fillRect(IX, y, IW, 1);
    ctx.globalAlpha = 1;
    // fondu de changement de jeu, limité à l'écran
    if (this.swapT > 0) {
      ctx.fillStyle = `rgba(5, 7, 13, ${Math.sin(Math.PI * (1 - this.swapT / SWAP_T)) * 0.85})`;
      ctx.fillRect(IX, IY, IW, IH);
    }
    ctx.restore();
    ctx.restore();

    // ----- colonne gauche : titre, détails, stats, rangs -----
    ctx.save();
    ctx.globalAlpha = e;
    ctx.translate(-slide, 0);

    // titre
    UI.panel(ctx, 46, 62, 26, 26, { radius: 8, fill: acc + '22', stroke: acc + '66' });
    UI.txt(ctx, String(this.sel + 1), 59, 80, { size: 13, align: 'center', mono: true, color: acc });
    UI.txt(ctx, '/ ' + this.games.length, 108, 80, { size: 12, mono: true, color: '#5d6480' });
    ctx.font = '900 46px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = acc;
    ctx.shadowBlur = 22;
    ctx.fillStyle = '#eaf6ff';
    ctx.fillText(meta.name, 64, 140);
    ctx.shadowBlur = 0;
    UI.txt(ctx, meta.desc, 64, 172, { size: 17, color: '#b9c2d0' });

    // ----- panneau détails -----
    const dx = 64, dw = 430;
    const dy = 194, dh = 190;
    UI.panel(ctx, dx, dy, dw, dh, { radius: 16, fill: 'rgba(9,12,19,0.88)', stroke: 'rgba(255,255,255,0.07)' });
    UI.txt(ctx, 'DÉTAILS', dx + 20, dy + 28, { size: 11, color: acc, mono: true });

    UI.txt(ctx, 'MANETTE', dx + 20, dy + 54, { size: 10.5, color: '#6a7488', mono: true });
    UI.txt(ctx, meta.controls, dx + 96, dy + 54, { size: 14, color: '#e8ecf2' });
    UI.txt(ctx, 'CLAVIER', dx + 20, dy + 82, { size: 10.5, color: '#6a7488', mono: true });
    UI.txt(ctx, meta.keys || '—', dx + 96, dy + 82, { size: 14, color: '#e8ecf2' });
    UI.txt(ctx, 'ASTUCE', dx + 20, dy + 110, { size: 10.5, color: '#6a7488', mono: true });
    ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
    const lines = UI.wrap(ctx, meta.hint, dw - 118);
    let ly = dy + 128;
    for (const ln of lines.slice(0, 2)) {
      UI.txt(ctx, ln, dx + 20, ly, { size: 13, color: '#aeb8c8', weight: 600 });
      ly += 19;
    }

    // ----- panneau statistiques -----
    const st = UI.getStats(meta.id);
    const best = UI.getBest(meta.id);
    const sy = 396, sh = 168;
    UI.panel(ctx, dx, sy, dw, sh, { radius: 16, fill: 'rgba(9,12,19,0.88)', stroke: 'rgba(255,255,255,0.07)' });
    UI.txt(ctx, 'STATISTIQUES', dx + 20, sy + 26, { size: 11, color: acc, mono: true });

    // record en évidence
    UI.txt(ctx, best > 0 ? UI.fmt(best) : '—', dx + 20, sy + 62, { size: 30, mono: true, weight: 700, color: '#eaf6ff' });
    UI.txt(ctx, (best > 0 ? meta.unit : 'aucun record'), dx + 20, sy + 82, { size: 11, color: '#7c8698' });

    const cellW = (dw - 40) / 3;
    const cells = [
      ['PARTIES', st.plays ? String(st.plays) : '—'],
      ['TEMPS', st.time ? UI.fmtTime(st.time) : '—'],
      ['MOYENNE', st.plays ? UI.fmt(st.total / st.plays) : '—'],
      ['DERNIER', st.last !== undefined ? UI.fmt(st.last) : '—'],
      ['GAGNÉES', st.wins ? String(st.wins) : '—'],
    ];
    // 2 lignes : 3 cellules puis 2
    for (let i = 0; i < 3; i++) {
      const cxx = dx + 20 + i * cellW;
      UI.txt(ctx, cells[i][1], cxx, sy + 116, { size: 17, mono: true, weight: 700, color: '#dfe6f0' });
      UI.txt(ctx, cells[i][0], cxx, sy + 130, { size: 9.5, color: '#5d6480', mono: true });
    }
    for (let i = 3; i < 5; i++) {
      const cxx = dx + 20 + (i - 3) * cellW;
      UI.txt(ctx, cells[i][1], cxx, sy + 148, { size: 17, mono: true, weight: 700, color: '#dfe6f0' });
      UI.txt(ctx, cells[i][0], cxx, sy + 162, { size: 9.5, color: '#5d6480', mono: true });
    }

    // ----- échelle de rangs (rangée compacte sous les stats) -----
    UI.txt(ctx, 'RANGS', dx, sy + 202, { size: 11, color: '#6a7488', mono: true });
    const letters = ['S', 'A', 'B', 'C', 'D'];
    const RANK_COLORS = { S: '#ffd166', A: '#a3e635', B: '#38bdf8', C: '#94a3b8', D: '#64748b' };
    for (let i = 0; i < 5; i++) {
      const thr = meta.ranks[i];
      const reached = best >= thr;
      const x = dx + 64 + i * 71;
      UI.panel(ctx, x, sy + 180, 64, 34, { radius: 9, fill: reached ? (RANK_COLORS[letters[i]] + '22') : 'rgba(255,255,255,0.04)', stroke: reached ? RANK_COLORS[letters[i]] + '99' : 'rgba(255,255,255,0.08)' });
      UI.txt(ctx, letters[i], x + 13, sy + 203, { size: 15, weight: 900, color: reached ? RANK_COLORS[letters[i]] : '#3d4454' });
      UI.txt(ctx, UI.fmt(thr), x + 56, sy + 203, { size: 9, align: 'right', mono: true, color: reached ? '#aeb8c8' : '#3d4454' });
    }
    ctx.restore();

    // ----- bouton lancer, sous l'écran de démo -----
    const beat = Math.max(0, this.audio.beat());
    const pulse = Math.max(0, 1 - (beat % 1) * 2.4);
    const pw = 224 + pulse * 6 + (this.hover === 'pill' ? 10 : 0);
    const pcx = SX + SW / 2, pcy = 589;
    ctx.save();
    ctx.globalAlpha = e;
    UI.panel(ctx, pcx - pw / 2, pcy - 23 - pulse * 2, pw, 46, { radius: 23, fill: acc + (this.hover === 'pill' ? 'ff' : 'e6'), stroke: '#ffffff55' });
    UI.txt(ctx, '▶  LANCER', pcx, pcy + 7, { size: 19, align: 'center', color: '#06121c', weight: 900 });
    UI.txt(ctx, 'A', pcx + pw / 2 + 18, pcy + 7, { size: 12, align: 'center', mono: true, color: '#5d6480' });
    ctx.restore();

    // ----- bandeau de vignettes -----
    ctx.save();
    ctx.globalAlpha = e;
    for (let i = 0; i < this.games.length; i++) {
      const gm = this.games[i].meta;
      const isSel = i === this.sel;
      const isHov = this.hover === i && !isSel;
      const r = this.thumbRect(i);
      const lift = isSel ? -6 : isHov ? -3 : 0;
      ctx.save();
      if (isSel) {
        ctx.shadowColor = gm.accent;
        ctx.shadowBlur = 20;
      }
      UI.roundRect(ctx, r.x, r.y + lift, r.w, r.h, 12);
      ctx.fillStyle = isSel ? 'rgba(16,21,32,0.96)' : isHov ? 'rgba(13,17,26,0.9)' : 'rgba(9,12,19,0.82)';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = isSel ? gm.accent : isHov ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.08)';
      ctx.lineWidth = isSel ? 2.5 : isHov ? 2 : 1.5;
      ctx.stroke();

      ctx.save();
      ctx.translate(r.x + r.w / 2, r.y + lift + 27);
      ctx.scale(0.52, 0.52);
      this.glyph(ctx, gm.id, 0, 0, isSel ? gm.accent : isHov ? gm.accent + 'aa' : gm.accent + '77');
      ctx.restore();
      UI.txt(ctx, gm.name, r.x + r.w / 2, r.y + lift + 52, { size: 9, align: 'center', color: isSel ? '#ffffff' : '#8b95a8' });
      const b = UI.getBest(gm.id);
      UI.txt(ctx, b > 0 ? UI.fmt(b) : '·', r.x + r.w / 2, r.y + lift + 65, { size: 8.5, align: 'center', mono: true, color: isSel ? gm.accent : '#566072' });
      ctx.restore();
    }
    ctx.restore();

    // pied de page
    ctx.save();
    ctx.globalAlpha = e;
    UI.txt(ctx, '← →  changer de jeu      A  lancer      B / Échap  vue d\'ensemble      Sélect  réglages', 640, 716, {
      size: 12.5, align: 'center', color: '#7c8698',
    });
    const padOk = this.input.padConnected;
    UI.txt(ctx, padOk ? '● MANETTE' : '○ CLAVIER', 1252, 716, {
      size: 11, align: 'right', color: padOk ? '#34d399' : '#5d6480', mono: true,
    });
    ctx.restore();
  }

  // ----- vue grille : la vue d'ensemble d'origine -----
  renderGrid(ctx) {
    const e = ease(this.viewT);
    const beat = Math.max(0, this.audio.beat());
    const pulse = Math.max(0, 1 - (beat % 1) * 2.8);

    // titre
    ctx.save();
    ctx.translate(640, 92);
    const ts = 1 + pulse * 0.025;
    ctx.scale(ts, ts);
    ctx.font = '900 64px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = '#7dd3fc';
    ctx.shadowBlur = 26;
    ctx.fillStyle = '#eaf6ff';
    ctx.fillText('BLOB ARCADE', 0, 0);
    ctx.shadowBlur = 0;
    ctx.restore();
    UI.txt(ctx, `${this.games.length} mini-jeux · manette recommandée · vue d'ensemble`, 640, 126, { size: 15, align: 'center', color: '#8b95a8' });

    ctx.save();
    ctx.globalAlpha = e;
    // cartes
    for (let i = 0; i < this.games.length; i++) {
      const g = this.games[i];
      const meta = g.meta;
      const isSel = i === this.sel;
      const isHov = this.hover === i && !isSel;
      const pos = this.cardPos(i);
      const x = pos.x, y = pos.y;

      ctx.save();
      if (isSel) {
        ctx.translate(x + CARD_W / 2, y + CARD_H / 2);
        ctx.scale(1.05, 1.05);
        ctx.translate(-(x + CARD_W / 2), -(y + CARD_H / 2));
      }
      UI.roundRect(ctx, x, y, CARD_W, CARD_H, 16);
      ctx.fillStyle = isSel ? 'rgba(18, 24, 36, 0.95)' : isHov ? 'rgba(14, 18, 28, 0.9)' : 'rgba(12, 15, 22, 0.85)';
      ctx.fill();
      ctx.strokeStyle = isSel ? meta.accent : isHov ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.09)';
      ctx.lineWidth = isSel ? 3 : isHov ? 2 : 1.5;
      if (isSel) { ctx.shadowColor = meta.accent; ctx.shadowBlur = 22; }
      ctx.stroke();
      ctx.shadowBlur = 0;

      this.glyph(ctx, meta.id, x + CARD_W / 2, y + 66, isSel ? meta.accent : isHov ? meta.accent + 'aa' : meta.accent + '88');

      UI.txt(ctx, meta.name, x + CARD_W / 2, y + 128, { size: 16, align: 'center', color: isSel ? '#ffffff' : '#b9c2d0' });
      const best = UI.getBest(meta.id);
      UI.txt(ctx, best > 0 ? UI.fmt(best) + ' ' + meta.unit : '—', x + CARD_W / 2, y + 156, { size: 13, align: 'center', mono: true, color: '#7c8698' });
      const st = UI.getStats(meta.id);
      if (st.plays) UI.txt(ctx, '▸ ' + st.plays + (st.plays > 1 ? ' parties' : ' partie'), x + CARD_W / 2, y + 178, { size: 10.5, align: 'center', color: '#566072' });
      UI.txt(ctx, String((i + 1) % 10), x + 12, y + 24, { size: 12, color: '#4a5264', mono: true });
      ctx.restore();
    }

    // infos du jeu sélectionné
    const rows = Math.ceil(this.games.length / COLS);
    const bottom = ROW0_Y + rows * CARD_H + (rows - 1) * GAP_Y;
    const meta = this.games[this.sel].meta;
    const descY = bottom + 40;
    UI.txt(ctx, meta.desc, 640, descY, { size: 16, align: 'center', color: '#c3cbd8' });
    UI.txt(ctx, meta.controls, 640, descY + 25, { size: 13, align: 'center', color: meta.accent });
    ctx.restore();

    // pied de page
    UI.txt(ctx, '← → ↑ ↓  choisir      A  lancer      X  fiche détaillée      Sélect  réglages      F  plein écran      M  son', 640, 700, { size: 13, align: 'center', color: '#7c8698' });
    const padOk = this.input.padConnected;
    UI.txt(ctx, padOk ? '● MANETTE OK' : '○ CLAVIER (flèches / ZQSD)', 1252, 700, {
      size: 12, align: 'right', color: padOk ? '#34d399' : '#5d6480', mono: true,
    });
  }
}
