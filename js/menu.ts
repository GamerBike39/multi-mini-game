// Menu principal, deux vues :
//  - FICHE (défaut)  : plein écran pour le jeu sélectionné — démo simulée en fond,
//                      détails (contrôles, astuce), statistiques, rangs, et en bas le
//                      bandeau de vignettes pour naviguer de jeu en jeu.
//  - GRILLE (globale): la grille de cartes d'origine, conservée pour la vue d'ensemble.
// A lance depuis les deux vues ; X / clic ouvre la fiche ; B/Échap revient à la grille.

import { Fx } from './core/fx';
import { Blob } from './core/blob';
import { Demo } from './demos';
import * as UI from './core/ui';
import type { GameConstructor, GameMeta, InputLike, EngineLike, AudioLike } from './core/types';

// Grille (vue globale).
const COLS = 5;
const CARD_W = 170;
const CARD_H = 205;
const GAP_X = 22;
const GAP_Y = 26;
const START_X = (1280 - (COLS * CARD_W + (COLS - 1) * GAP_X)) / 2;
const ROW0_Y = 178;
const DIGIT_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'] as const;

// Bandeau de vignettes (fiche).
const TH_W = 108;
const TH_H = 74;
const TH_GAP = 12;
const TH_X0 = (1280 - (10 * TH_W + 9 * TH_GAP)) / 2;
const TH_Y = 626;

// Bouton lancer (fiche) : zone de clic fixe, le dessin pulse autour.
const PILL = { x: 878 - 116, y: 566, w: 232, h: 46 } as const;

const SWAP_T = 0.38;
const VIEW_T = 0.4;

type MenuView = 'detail' | 'grid';
type HoverTarget = number | 'pill' | -1;

interface Point {
  x: number;
  y: number;
}

interface Dot extends Point {
  z: number;
  s: number;
}

interface DemoLike {
  reset(id: string, accent: string): void;
  update(dt: number): void;
  draw(ctx: CanvasRenderingContext2D): void;
}

const ease = (k: number): number => k * k * (3 - 2 * k);

export class Menu {
  engine?: EngineLike;
  readonly eng: EngineLike;
  readonly games: GameConstructor[];
  readonly input: InputLike;
  readonly audio: AudioLike;
  readonly fx: Fx;
  accent = '#7dd3fc';
  sel = 0;
  view: MenuView = 'detail';
  viewT = 1;
  rep = 0;
  wasL = false;
  wasR = false;
  wasU = false;
  wasD = false;
  t = 0;
  lastBeat = 0;
  hop = 0;
  swapT = 0;
  pendingDemo: number | null = null;
  hover: HoverTarget = -1;
  cursor = 'default';
  readonly demo: DemoLike;
  readonly blob: Blob;
  readonly dots: Dot[] = [];

  constructor(engine: EngineLike, games: GameConstructor[]) {
    this.eng = engine;
    this.games = games;
    this.input = engine.input;
    this.audio = engine.audio;
    this.fx = new Fx();
    this.demo = new Demo(games[0].meta.id, games[0].meta.accent);
    this.blob = new Blob({ x: 0, y: 0, r: 13, color: '#7dd3fc' });
    for (let i = 0; i < 46; i++) {
      this.dots.push({ x: Math.random() * 1280, y: Math.random() * 720, z: 0.2 + Math.random() * 0.8, s: Math.random() * 6.28 });
    }
  }

  enter(): void { this.audio.startMusic('menu'); }
  exit(): void { this.audio.stopMusic(); }

  // ---------- navigation ----------
  move(delta: number): void {
    this.sel = (this.sel + delta + this.games.length) % this.games.length;
    this.audio.uiMove();
  }

  setGame(index: number): void {
    if (index === this.sel || index < 0 || index >= this.games.length) return;
    this.sel = index;
    this.swapT = SWAP_T;
    this.pendingDemo = index;
    this.audio.uiMove();
  }

  openDetail(): void {
    if (this.view === 'detail') return;
    this.view = 'detail';
    this.viewT = 0;
    this.audio.uiOk();
  }

  openGrid(): void {
    if (this.view === 'grid') return;
    this.view = 'grid';
    this.viewT = 0;
    this.audio.uiBack();
  }

  launch(): void {
    const game = this.games[this.sel];
    this.audio.uiOk();
    this.fx.flash(game.meta.accent, 0.22);
    this.eng.setApp(new game(this.eng));
  }

  cardPos(index: number): Point {
    const col = index % COLS;
    const row = Math.floor(index / COLS);
    return { x: START_X + col * (CARD_W + GAP_X), y: ROW0_Y + row * (CARD_H + GAP_Y) };
  }

  thumbRect(index: number): { x: number; y: number; w: number; h: number } {
    return { x: TH_X0 + index * (TH_W + TH_GAP), y: TH_Y, w: TH_W, h: TH_H };
  }

  // ---------- souris (interface uniquement) ----------
  hitThumb(x: number, y: number): number {
    for (let i = 0; i < this.games.length; i++) {
      const rect = this.thumbRect(i);
      if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y - 8 && y <= rect.y + rect.h) return i;
    }
    return -1;
  }

  hitCard(x: number, y: number): number {
    for (let i = 0; i < this.games.length; i++) {
      const pos = this.cardPos(i);
      if (x >= pos.x && x <= pos.x + CARD_W && y >= pos.y && y <= pos.y + CARD_H) return i;
    }
    return -1;
  }

  hitPill(x: number, y: number): boolean {
    return x >= PILL.x && x <= PILL.x + PILL.w && y >= PILL.y && y <= PILL.y + PILL.h;
  }

  // Clic : vignette/carte = sélectionner (relancer le clic sur l'élément déjà
  // actif ou sur le bouton = lancer) ; ailleurs, aucun effet.
  onPointer(x: number, y: number): void {
    if (this.eng.settings.active) {
      this.eng.settings.onPointer(x, y);
      return;
    }
    if (this.view === 'detail') {
      const index = this.hitThumb(x, y);
      if (index >= 0) {
        if (index === this.sel) this.launch();
        else this.setGame(index);
        return;
      }
      if (this.hitPill(x, y)) this.launch();
      return;
    }
    const index = this.hitCard(x, y);
    if (index >= 0) {
      if (index === this.sel) this.launch();
      else {
        this.sel = index;
        this.openDetail();
      }
    }
  }

  // Survol : surlignage + curseur main sur les éléments actifs.
  onPointerMove(x: number, y: number): void {
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

  onPointerUp(): void {
    this.eng.settings.onPointerUp();
  }

  onPointerLeave(): void {
    this.hover = -1;
    this.cursor = 'default';
  }

  // ---------- update ----------
  update(dt: number): void {
    this.t += dt;
    this.viewT = Math.min(1, this.viewT + dt / VIEW_T);
    const input = this.input;

    if (this.eng.settings.active) this.eng.settings.update(dt);
    else if (this.view === 'detail') this.updateDetail(dt, input);
    else this.updateGrid(dt, input);

    // Démo : fondu au changement de jeu.
    if (this.swapT > 0) {
      this.swapT -= dt;
      if (this.pendingDemo !== null && this.swapT <= SWAP_T / 2) {
        const game = this.games[this.pendingDemo];
        this.demo.reset(game.meta.id, game.meta.accent);
        this.pendingDemo = null;
      }
    }
    this.demo.update(dt);

    // Blob : rebond sur le beat, perché sur l'élément sélectionné.
    const beat = this.audio.beat();
    const beatIndex = Math.floor(Math.max(0, beat));
    if (beatIndex !== this.lastBeat && beat > 0) {
      this.lastBeat = beatIndex;
      this.hop = 0.26;
    }
    this.hop = Math.max(0, this.hop - dt);

    const pos = this.view === 'detail' ? this.thumbRect(this.sel) : this.cardPos(this.sel);
    const cx = pos.x + (this.view === 'detail' ? TH_W : CARD_W) / 2;
    const hopH = this.hop > 0 ? Math.sin((1 - this.hop / 0.26) * Math.PI) * 16 : 0;
    const prevX = this.blob.x;
    const prevY = this.blob.y;
    this.blob.x += (cx - this.blob.x) * Math.min(1, dt * 10);
    this.blob.y = pos.y - 2 - hopH;
    this.blob.vx = (this.blob.x - prevX) / Math.max(dt, 1e-4);
    this.blob.vy = (prevY - this.blob.y) / Math.max(dt, 1e-4);
    this.blob.update(dt);

    for (const dot of this.dots) {
      dot.x -= (8 + dot.z * 22) * dt;
      dot.y += Math.sin(this.t * 0.8 + dot.s) * 6 * dt;
      if (dot.x < -4) {
        dot.x = 1284;
        dot.y = Math.random() * 720;
      }
    }

    this.fx.zoom = 1;
  }

  updateDetail(dt: number, input: InputLike): void {
    const left = input.down('left') || input.moveX < -0.5;
    const right = input.down('right') || input.moveX > 0.5;
    if (input.pressed('left') || (left && !this.wasL)) {
      this.setGame(this.sel - 1);
      this.rep = 0.34;
    } else if (input.pressed('right') || (right && !this.wasR)) {
      this.setGame(this.sel + 1);
      this.rep = 0.34;
    } else if (left || right) {
      this.rep -= dt;
      if (this.rep <= 0) {
        this.setGame(this.sel + (left ? -1 : 1));
        this.rep = 0.14;
      }
    }
    this.wasL = left;
    this.wasR = right;

    if (input.pressed('a') || input.pressed('start')) this.launch();
    if (input.pressed('b') || input.pressed('back')) this.openGrid();
    if (input.pressed('select')) {
      this.audio.uiOk();
      this.eng.settings.open();
    }
    for (let i = 0; i < DIGIT_KEYS.length && i < this.games.length; i++) {
      if (input.key(DIGIT_KEYS[i])) {
        this.sel = i;
        this.launch();
        break;
      }
    }
  }

  updateGrid(dt: number, input: InputLike): void {
    const left = input.down('left') || input.moveX < -0.5;
    const right = input.down('right') || input.moveX > 0.5;
    if (input.pressed('left') || (left && !this.wasL)) {
      this.move(-1);
      this.rep = 0.34;
    } else if (input.pressed('right') || (right && !this.wasR)) {
      this.move(1);
      this.rep = 0.34;
    } else if (left || right) {
      this.rep -= dt;
      if (this.rep <= 0) {
        this.move(left ? -1 : 1);
        this.rep = 0.12;
      }
    }
    this.wasL = left;
    this.wasR = right;

    // Vertical : saute de ligne (grille petite, pas besoin de répétition auto).
    const up = input.down('up') || input.moveY < -0.5;
    const down = input.down('down') || input.moveY > 0.5;
    if (input.pressed('up') || (up && !this.wasU)) this.move(-COLS);
    if (input.pressed('down') || (down && !this.wasD)) this.move(COLS);
    this.wasU = up;
    this.wasD = down;

    if (input.pressed('a') || input.pressed('start')) this.launch();
    // Fiche détaillée : bouton X (manette) ou touche X (clavier).
    if (input.pressed('x') || input.key('KeyX')) this.openDetail();
    if (input.pressed('select') || input.pressed('back')) {
      this.audio.uiOk();
      this.eng.settings.open();
    }
    for (let i = 0; i < DIGIT_KEYS.length && i < this.games.length; i++) {
      if (input.key(DIGIT_KEYS[i])) {
        this.sel = i;
        this.launch();
        break;
      }
    }
  }

  // ---------- rendu ----------
  glyph(ctx: CanvasRenderingContext2D, id: string, x: number, y: number, color: string): void {
    UI.gameGlyph(ctx, id, x, y, color);
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#070910';
    ctx.fillRect(0, 0, 1280, 720);
    this.fx.world(ctx);

    UI.grid(ctx, { gap: 72, off: this.t * 8, alpha: 0.035 });
    for (const dot of this.dots) {
      ctx.globalAlpha = 0.05 + dot.z * 0.1;
      ctx.fillStyle = '#7dd3fc';
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, 1.2 + dot.z * 1.8, 0, 6.2832);
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
  renderDetail(ctx: CanvasRenderingContext2D): void {
    const game = this.games[this.sel];
    const meta = game.meta;
    const accent = meta.accent;
    const entry = ease(this.viewT);
    const slide = (1 - entry) * 34;

    // ----- écran dédié de la démo (à droite) -----
    const SX = 540;
    const SY = 88;
    const SW = 676;
    const SH = 472;
    const IX = SX + 12;
    const IY = SY + 38;
    const IW = SW - 24;
    const IH = SH - 50;
    ctx.save();
    ctx.globalAlpha = entry;
    ctx.translate(-slide * 0.4, 0);
    UI.panel(ctx, SX, SY, SW, SH, { radius: 18, fill: 'rgba(9,12,19,0.94)', stroke: accent + '55', lineWidth: 2 });
    UI.txt(ctx, 'APERÇU · DÉMO', SX + 18, SY + 25, { size: 11, mono: true, color: accent });
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
    UI.grid(ctx, { gap: 56, off: this.t * 6, alpha: 0.05, color: accent });
    ctx.save();
    ctx.translate(878, 343);
    ctx.scale(0.886, 0.886);
    ctx.translate(-695, -385);
    this.demo.draw(ctx);
    ctx.restore();
    // Scanlines discrètes, façon borne d'arcade.
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = '#000000';
    for (let y = IY + 2; y < IY + IH; y += 4) ctx.fillRect(IX, y, IW, 1);
    ctx.globalAlpha = 1;
    // Fondu de changement de jeu, limité à l'écran.
    if (this.swapT > 0) {
      ctx.fillStyle = `rgba(5, 7, 13, ${Math.sin(Math.PI * (1 - this.swapT / SWAP_T)) * 0.85})`;
      ctx.fillRect(IX, IY, IW, IH);
    }
    ctx.restore();
    ctx.restore();

    // ----- colonne gauche : titre, détails, stats, rangs -----
    ctx.save();
    ctx.globalAlpha = entry;
    ctx.translate(-slide, 0);

    UI.panel(ctx, 46, 62, 26, 26, { radius: 8, fill: accent + '22', stroke: accent + '66' });
    UI.txt(ctx, String(this.sel + 1), 59, 80, { size: 13, align: 'center', mono: true, color: accent });
    UI.txt(ctx, '/ ' + this.games.length, 108, 80, { size: 12, mono: true, color: '#5d6480' });
    ctx.font = '900 46px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = accent;
    ctx.shadowBlur = 22;
    ctx.fillStyle = '#eaf6ff';
    ctx.fillText(meta.name, 64, 140);
    ctx.shadowBlur = 0;
    UI.txt(ctx, meta.desc, 64, 172, { size: 17, color: '#b9c2d0' });

    // ----- panneau détails -----
    const dx = 64;
    const dw = 430;
    const dy = 194;
    const dh = 190;
    UI.panel(ctx, dx, dy, dw, dh, { radius: 16, fill: 'rgba(9,12,19,0.88)', stroke: 'rgba(255,255,255,0.07)' });
    UI.txt(ctx, 'DÉTAILS', dx + 20, dy + 28, { size: 11, color: accent, mono: true });
    UI.txt(ctx, 'MANETTE', dx + 20, dy + 54, { size: 10.5, color: '#6a7488', mono: true });
    UI.txt(ctx, meta.controls, dx + 96, dy + 54, { size: 14, color: '#e8ecf2' });
    UI.txt(ctx, 'CLAVIER', dx + 20, dy + 82, { size: 10.5, color: '#6a7488', mono: true });
    UI.txt(ctx, meta.keys || '—', dx + 96, dy + 82, { size: 14, color: '#e8ecf2' });
    UI.txt(ctx, 'ASTUCE', dx + 20, dy + 110, { size: 10.5, color: '#6a7488', mono: true });
    ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
    const lines = UI.wrap(ctx, meta.hint, dw - 118);
    let lineY = dy + 128;
    for (const line of lines.slice(0, 2)) {
      UI.txt(ctx, line, dx + 20, lineY, { size: 13, color: '#aeb8c8', weight: 600 });
      lineY += 19;
    }

    // ----- panneau statistiques -----
    const stats = UI.getStats(meta.id);
    const best = UI.getBest(meta.id);
    const sy = 396;
    const sh = 168;
    UI.panel(ctx, dx, sy, dw, sh, { radius: 16, fill: 'rgba(9,12,19,0.88)', stroke: 'rgba(255,255,255,0.07)' });
    UI.txt(ctx, 'STATISTIQUES', dx + 20, sy + 26, { size: 11, color: accent, mono: true });
    UI.txt(ctx, best > 0 ? UI.fmt(best) : '—', dx + 20, sy + 62, { size: 30, mono: true, weight: 700, color: '#eaf6ff' });
    UI.txt(ctx, best > 0 ? meta.unit : 'aucun record', dx + 20, sy + 82, { size: 11, color: '#7c8698' });

    const cellW = (dw - 40) / 3;
    const cells: Array<[string, string]> = [
      ['PARTIES', stats.plays ? String(stats.plays) : '—'],
      ['TEMPS', stats.time ? UI.fmtTime(stats.time) : '—'],
      ['MOYENNE', stats.plays ? UI.fmt((stats.total || 0) / stats.plays) : '—'],
      ['DERNIER', stats.last !== undefined ? UI.fmt(stats.last) : '—'],
      ['GAGNÉES', stats.wins ? String(stats.wins) : '—'],
    ];
    for (let i = 0; i < 3; i++) {
      const cellX = dx + 20 + i * cellW;
      UI.txt(ctx, cells[i][1], cellX, sy + 116, { size: 17, mono: true, weight: 700, color: '#dfe6f0' });
      UI.txt(ctx, cells[i][0], cellX, sy + 130, { size: 9.5, color: '#5d6480', mono: true });
    }
    for (let i = 3; i < 5; i++) {
      const cellX = dx + 20 + (i - 3) * cellW;
      UI.txt(ctx, cells[i][1], cellX, sy + 148, { size: 17, mono: true, weight: 700, color: '#dfe6f0' });
      UI.txt(ctx, cells[i][0], cellX, sy + 162, { size: 9.5, color: '#5d6480', mono: true });
    }

    // ----- échelle de rangs -----
    UI.txt(ctx, 'RANGS', dx, sy + 202, { size: 11, color: '#6a7488', mono: true });
    const letters = ['S', 'A', 'B', 'C', 'D'] as const;
    const rankColors: Record<(typeof letters)[number], string> = { S: '#ffd166', A: '#a3e635', B: '#38bdf8', C: '#94a3b8', D: '#64748b' };
    for (let i = 0; i < 5; i++) {
      const threshold = meta.ranks[i];
      const reached = best >= threshold;
      const x = dx + 64 + i * 71;
      const rankColor = rankColors[letters[i]];
      UI.panel(ctx, x, sy + 180, 64, 34, { radius: 9, fill: reached ? rankColor + '22' : 'rgba(255,255,255,0.04)', stroke: reached ? rankColor + '99' : 'rgba(255,255,255,0.08)' });
      UI.txt(ctx, letters[i], x + 13, sy + 203, { size: 15, weight: 900, color: reached ? rankColor : '#3d4454' });
      UI.txt(ctx, UI.fmt(threshold), x + 56, sy + 203, { size: 9, align: 'right', mono: true, color: reached ? '#aeb8c8' : '#3d4454' });
    }
    ctx.restore();

    // ----- bouton lancer, sous l'écran de démo -----
    const beat = Math.max(0, this.audio.beat());
    const pulse = Math.max(0, 1 - (beat % 1) * 2.4);
    const pillWidth = 224 + pulse * 6 + (this.hover === 'pill' ? 10 : 0);
    const pillCenterX = SX + SW / 2;
    const pillCenterY = 589;
    ctx.save();
    ctx.globalAlpha = entry;
    UI.panel(ctx, pillCenterX - pillWidth / 2, pillCenterY - 23 - pulse * 2, pillWidth, 46, { radius: 23, fill: accent + (this.hover === 'pill' ? 'ff' : 'e6'), stroke: '#ffffff55' });
    UI.txt(ctx, '▶  LANCER', pillCenterX, pillCenterY + 7, { size: 19, align: 'center', color: '#06121c', weight: 900 });
    UI.txt(ctx, 'A', pillCenterX + pillWidth / 2 + 18, pillCenterY + 7, { size: 12, align: 'center', mono: true, color: '#5d6480' });
    ctx.restore();

    // ----- bandeau de vignettes -----
    ctx.save();
    ctx.globalAlpha = entry;
    for (let i = 0; i < this.games.length; i++) {
      const gameMeta = this.games[i].meta;
      const isSelected = i === this.sel;
      const isHovered = this.hover === i && !isSelected;
      const rect = this.thumbRect(i);
      const lift = isSelected ? -6 : isHovered ? -3 : 0;
      ctx.save();
      if (isSelected) {
        ctx.shadowColor = gameMeta.accent;
        ctx.shadowBlur = 20;
      }
      UI.roundRect(ctx, rect.x, rect.y + lift, rect.w, rect.h, 12);
      ctx.fillStyle = isSelected ? 'rgba(16,21,32,0.96)' : isHovered ? 'rgba(13,17,26,0.9)' : 'rgba(9,12,19,0.82)';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = isSelected ? gameMeta.accent : isHovered ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.08)';
      ctx.lineWidth = isSelected ? 2.5 : isHovered ? 2 : 1.5;
      ctx.stroke();

      ctx.save();
      ctx.translate(rect.x + rect.w / 2, rect.y + lift + 27);
      ctx.scale(0.52, 0.52);
      this.glyph(ctx, gameMeta.id, 0, 0, isSelected ? gameMeta.accent : isHovered ? gameMeta.accent + 'aa' : gameMeta.accent + '77');
      ctx.restore();
      UI.txt(ctx, gameMeta.name, rect.x + rect.w / 2, rect.y + lift + 52, { size: 9, align: 'center', color: isSelected ? '#ffffff' : '#8b95a8' });
      const gameBest = UI.getBest(gameMeta.id);
      UI.txt(ctx, gameBest > 0 ? UI.fmt(gameBest) : '·', rect.x + rect.w / 2, rect.y + lift + 65, { size: 8.5, align: 'center', mono: true, color: isSelected ? gameMeta.accent : '#566072' });
      ctx.restore();
    }
    ctx.restore();

    // Pied de page.
    ctx.save();
    ctx.globalAlpha = entry;
    UI.txt(ctx, '← →  changer de jeu      A  lancer      B / Échap  vue d\'ensemble      Sélect  réglages', 640, 716, {
      size: 12.5, align: 'center', color: '#7c8698',
    });
    const padConnected = this.input.padConnected;
    UI.txt(ctx, padConnected ? '● MANETTE' : '○ CLAVIER', 1252, 716, {
      size: 11, align: 'right', color: padConnected ? '#34d399' : '#5d6480', mono: true,
    });
    ctx.restore();
  }

  // ----- vue grille : la vue d'ensemble d'origine -----
  renderGrid(ctx: CanvasRenderingContext2D): void {
    const entry = ease(this.viewT);
    const beat = Math.max(0, this.audio.beat());
    const pulse = Math.max(0, 1 - (beat % 1) * 2.8);

    ctx.save();
    ctx.translate(640, 92);
    const titleScale = 1 + pulse * 0.025;
    ctx.scale(titleScale, titleScale);
    ctx.font = '900 64px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = '#7dd3fc';
    ctx.shadowBlur = 26;
    ctx.fillStyle = '#eaf6ff';
    ctx.fillText('BLOB ARCADE', 0, 0);
    ctx.shadowBlur = 0;
    ctx.restore();
    UI.txt(ctx, `${this.games.length} mini-jeux · manette recommandée · vue d'ensemble`, 640, 126, { size: 15, align: 'center', color: '#8b95a8' });

    ctx.save();
    ctx.globalAlpha = entry;
    for (let i = 0; i < this.games.length; i++) {
      const game = this.games[i];
      const meta = game.meta;
      const isSelected = i === this.sel;
      const isHovered = this.hover === i && !isSelected;
      const pos = this.cardPos(i);
      const x = pos.x;
      const y = pos.y;

      ctx.save();
      if (isSelected) {
        ctx.translate(x + CARD_W / 2, y + CARD_H / 2);
        ctx.scale(1.05, 1.05);
        ctx.translate(-(x + CARD_W / 2), -(y + CARD_H / 2));
      }
      UI.roundRect(ctx, x, y, CARD_W, CARD_H, 16);
      ctx.fillStyle = isSelected ? 'rgba(18, 24, 36, 0.95)' : isHovered ? 'rgba(14, 18, 28, 0.9)' : 'rgba(12, 15, 22, 0.85)';
      ctx.fill();
      ctx.strokeStyle = isSelected ? meta.accent : isHovered ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.09)';
      ctx.lineWidth = isSelected ? 3 : isHovered ? 2 : 1.5;
      if (isSelected) {
        ctx.shadowColor = meta.accent;
        ctx.shadowBlur = 22;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      this.glyph(ctx, meta.id, x + CARD_W / 2, y + 66, isSelected ? meta.accent : isHovered ? meta.accent + 'aa' : meta.accent + '88');
      UI.txt(ctx, meta.name, x + CARD_W / 2, y + 128, { size: 16, align: 'center', color: isSelected ? '#ffffff' : '#b9c2d0' });
      const best = UI.getBest(meta.id);
      UI.txt(ctx, best > 0 ? UI.fmt(best) + ' ' + meta.unit : '—', x + CARD_W / 2, y + 156, { size: 13, align: 'center', mono: true, color: '#7c8698' });
      const stats = UI.getStats(meta.id);
      if (stats.plays) UI.txt(ctx, '▸ ' + stats.plays + (stats.plays > 1 ? ' parties' : ' partie'), x + CARD_W / 2, y + 178, { size: 10.5, align: 'center', color: '#566072' });
      UI.txt(ctx, String((i + 1) % 10), x + 12, y + 24, { size: 12, color: '#4a5264', mono: true });
      ctx.restore();
    }

    const rows = Math.ceil(this.games.length / COLS);
    const bottom = ROW0_Y + rows * CARD_H + (rows - 1) * GAP_Y;
    const meta = this.games[this.sel].meta;
    const descY = bottom + 40;
    UI.txt(ctx, meta.desc, 640, descY, { size: 16, align: 'center', color: '#c3cbd8' });
    UI.txt(ctx, meta.controls, 640, descY + 25, { size: 13, align: 'center', color: meta.accent });
    ctx.restore();

    UI.txt(ctx, '← → ↑ ↓  choisir      A  lancer      X  fiche détaillée      Sélect  réglages      F  plein écran      M  son', 640, 700, { size: 13, align: 'center', color: '#7c8698' });
    const padConnected = this.input.padConnected;
    UI.txt(ctx, padConnected ? '● MANETTE OK' : '○ CLAVIER (flèches / ZQSD)', 1252, 700, {
      size: 12, align: 'right', color: padConnected ? '#34d399' : '#5d6480', mono: true,
    });
  }
}
