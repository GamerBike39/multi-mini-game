// Helpers de rendu UI + persistance des records + écrans communs (pause / game over).

const SANS = '"Segoe UI", system-ui, sans-serif';
const MONO = 'Consolas, "Courier New", monospace';

interface TextOptions {
  size?: number;
  weight?: number;
  mono?: boolean;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  alpha?: number;
  shadow?: boolean;
  color?: string;
}

interface PanelOptions {
  radius?: number;
  fill?: string;
  stroke?: string;
  lineWidth?: number;
}

interface GridOptions {
  gap?: number;
  off?: number;
  offY?: number;
  alpha?: number;
  color?: string;
}

export interface GameStats {
  plays?: number;
  time?: number;
  total?: number;
  last?: number;
  wins?: number;
}

export interface SaveBestResult {
  best: number;
  isNew: boolean;
}

interface GameOverOptions {
  accent: string;
  title?: string;
  score: number;
  unit?: string;
  best: number;
  isNew?: boolean;
  rankLabel: string;
}

interface HudOptions {
  accent: string;
  score: number;
  unit?: string;
  time?: number | null;
  extra?: (() => void) | null;
}

export function txt(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, options: TextOptions = {}): void {
  const size = options.size ?? 24;
  ctx.font = `${options.weight ?? 800} ${size}px ${options.mono ? MONO : SANS}`;
  ctx.textAlign = options.align ?? 'left';
  ctx.textBaseline = options.baseline ?? 'alphabetic';
  ctx.globalAlpha = options.alpha ?? 1;
  if (options.shadow) {
    ctx.fillStyle = '#00000066';
    ctx.fillText(str, x + 2, y + 2);
  }
  ctx.fillStyle = options.color ?? '#e8ecf2';
  ctx.fillText(str, x, y);
  ctx.globalAlpha = 1;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, options: PanelOptions = {}): void {
  roundRect(ctx, x, y, w, h, options.radius ?? 16);
  ctx.fillStyle = options.fill ?? 'rgba(8, 11, 18, 0.85)';
  ctx.fill();
  if (options.stroke) {
    ctx.strokeStyle = options.stroke;
    ctx.lineWidth = options.lineWidth ?? 2;
    ctx.stroke();
  }
}

export function grid(ctx: CanvasRenderingContext2D, { gap = 64, off = 0, offY = 0, alpha = 0.05, color = '#8ab4ff' }: GridOptions = {}): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = -(off % gap); x < 1280; x += gap) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 720);
  }
  for (let y = -(offY % gap); y < 720; y += gap) {
    ctx.moveTo(0, y);
    ctx.lineTo(1280, y);
  }
  ctx.stroke();
  ctx.restore();
}

export function vignette(ctx: CanvasRenderingContext2D): void {
  let gradient = vignetteCache.get(ctx);
  if (!gradient) {
    gradient = ctx.createRadialGradient(640, 360, 340, 640, 360, 780);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.42)');
    vignetteCache.set(ctx, gradient);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1280, 720);
}

const vignetteCache = new WeakMap<CanvasRenderingContext2D, CanvasGradient>();

// ---------- records ----------
const bestCache = new Map<string, number>();
const statsCache = new Map<string, GameStats>();
const dirtyBest = new Set<string>();
const dirtyStats = new Set<string>();
let profileLoaded = false;
let profileFlushTimer: number | null = null;

function loadProfileOnce(): void {
  if (profileLoaded) return;
  profileLoaded = true;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith('blobArcade.best.')) {
        const id = key.slice('blobArcade.best.'.length);
        const value = Number(localStorage.getItem(key) || 0);
        bestCache.set(id, Number.isFinite(value) ? value : 0);
      } else if (key.startsWith('blobArcade.stat.')) {
        const id = key.slice('blobArcade.stat.'.length);
        try {
          const value = JSON.parse(localStorage.getItem(key) || '{}') as GameStats;
          statsCache.set(id, value && typeof value === 'object' ? value : {});
        } catch {
          statsCache.set(id, {});
        }
      }
    }
  } catch {
    // Le profil reste en mémoire même si le stockage est indisponible.
  }
}

function scheduleProfileFlush(): void {
  if (profileFlushTimer !== null) return;
  if (typeof window === 'undefined') return;
  profileFlushTimer = window.setTimeout(() => {
    profileFlushTimer = null;
    try {
      for (const id of dirtyBest) localStorage.setItem('blobArcade.best.' + id, String(bestCache.get(id) || 0));
      for (const id of dirtyStats) localStorage.setItem('blobArcade.stat.' + id, JSON.stringify(statsCache.get(id) || {}));
    } catch {
      // La session continue normalement avec le cache mémoire.
    }
    dirtyBest.clear();
    dirtyStats.clear();
  }, 120);
}

if (typeof addEventListener === 'function') addEventListener('pagehide', () => {
  if (profileFlushTimer !== null) window.clearTimeout(profileFlushTimer);
  profileFlushTimer = null;
  try {
    for (const id of dirtyBest) localStorage.setItem('blobArcade.best.' + id, String(bestCache.get(id) || 0));
    for (const id of dirtyStats) localStorage.setItem('blobArcade.stat.' + id, JSON.stringify(statsCache.get(id) || {}));
  } catch {
    // Rien à faire si le stockage est fermé au moment de quitter la page.
  }
  dirtyBest.clear();
  dirtyStats.clear();
});

export function getBest(id: string): number {
  loadProfileOnce();
  return bestCache.get(id) || 0;
}

export function saveBest(id: string, val: number): SaveBestResult {
  const prev = getBest(id);
  const isNew = val > prev;
  if (isNew) {
    bestCache.set(id, Math.floor(val));
    dirtyBest.add(id);
    scheduleProfileFlush();
  }
  return { best: Math.max(prev, val), isNew };
}

// ---------- statistiques de jeu (par jeu, persistées) ----------
// { plays: parties terminées, time: secondes jouées, total: somme des scores,
//   last: dernier score, wins: parties gagnées }
export function getStats(id: string): GameStats {
  loadProfileOnce();
  let stats = statsCache.get(id);
  if (!stats) {
    stats = {};
    statsCache.set(id, stats);
  }
  return stats;
}

function saveStats(id: string, stats: GameStats): void {
  statsCache.set(id, stats);
  dirtyStats.add(id);
  scheduleProfileFlush();
}

export function addStat(id: string, { score = 0, time = 0, win = false }: { score?: number; time?: number; win?: boolean } = {}): GameStats {
  const stats = getStats(id);
  stats.plays = (stats.plays || 0) + 1;
  stats.time = (stats.time || 0) + Math.max(0, time || 0);
  stats.total = (stats.total || 0) + Math.max(0, score || 0);
  stats.last = Math.floor(score || 0);
  if (win) stats.wins = (stats.wins || 0) + 1;
  saveStats(id, stats);
  return stats;
}

export function addTime(id: string, time: number): void {
  if (!(time > 0)) return;
  const stats = getStats(id);
  stats.time = (stats.time || 0) + time;
  saveStats(id, stats);
}

export function fmtTime(seconds: number): string {
  seconds = Math.max(0, Math.round(seconds));
  if (seconds < 60) return seconds + ' s';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes + ' min';
  return Math.floor(minutes / 60) + ' h ' + String(minutes % 60).padStart(2, '0');
}

// Découpe un texte en lignes tenant sur maxW (à appeler avec la police déjà définie).
export function wrap(ctx: CanvasRenderingContext2D, str: string, maxW: number): string[] {
  const words = String(str).split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const test = current ? current + ' ' + word : word;
    if (ctx.measureText(test).width > maxW && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

const RANK_COLORS: Record<string, string> = { S: '#ffd166', A: '#a3e635', B: '#38bdf8', C: '#94a3b8', D: '#64748b' };

export function rank(table: readonly number[], val: number): string {
  const letters = ['S', 'A', 'B', 'C', 'D'];
  for (let i = 0; i < letters.length; i++) {
    if (val >= (table[i] ?? 0)) return letters[i];
  }
  return 'D';
}

export function fmt(n: number): string {
  return String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// ---------- écrans communs ----------
export function drawGameOver(ctx: CanvasRenderingContext2D, { accent, title = 'GAME OVER', score, unit = 'pts', best, isNew, rankLabel }: GameOverOptions): void {
  ctx.fillStyle = 'rgba(2, 3, 8, 0.62)';
  ctx.fillRect(0, 0, 1280, 720);
  panel(ctx, 330, 190, 620, 330, { radius: 22, stroke: accent + '66', lineWidth: 2 });

  txt(ctx, title, 640, 252, { size: 44, align: 'center', color: accent, weight: 900 });
  txt(ctx, 'SCORE', 640, 292, { size: 14, align: 'center', color: '#8b95a8' });
  txt(ctx, fmt(score) + ' ' + unit, 640, 352, { size: 56, align: 'center', mono: true, weight: 700 });

  ctx.beginPath();
  ctx.arc(878, 330, 46, 0, 6.2832);
  ctx.strokeStyle = RANK_COLORS[rankLabel] ?? '#fff';
  ctx.lineWidth = 3;
  ctx.stroke();
  txt(ctx, rankLabel, 878, 348, { size: 48, align: 'center', color: RANK_COLORS[rankLabel] ?? '#fff', weight: 900 });

  txt(ctx, 'Record : ' + fmt(best) + ' ' + unit, 640, 408, { size: 18, align: 'center', color: '#aeb8c8' });
  if (isNew) {
    const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 120);
    ctx.globalAlpha = pulse;
    txt(ctx, '★ NOUVEAU RECORD ★', 640, 442, { size: 20, align: 'center', color: accent, weight: 900 });
    ctx.globalAlpha = 1;
  }
  txt(ctx, 'A  Rejouer        B  Menu', 640, 478, { size: 17, align: 'center', color: '#aeb8c8' });
  txt(ctx, 'clavier : Espace rejouer · K menu · Échap ou Backspace menu', 640, 504, { size: 12.5, align: 'center', color: '#5d6480' });
}

const PAUSE_ITEMS = ['Reprendre', 'Rejouer', 'Réglages', 'Quitter'];

export function drawPause(ctx: CanvasRenderingContext2D, accent: string, sel = 0): void {
  ctx.fillStyle = 'rgba(2, 3, 8, 0.68)';
  ctx.fillRect(0, 0, 1280, 720);
  txt(ctx, 'PAUSE', 640, 248, { size: 50, align: 'center', color: accent, weight: 900 });
  for (let i = 0; i < PAUSE_ITEMS.length; i++) {
    const y = 330 + i * 58;
    const isSel = i === sel;
    if (isSel) {
      panel(ctx, 640 - 150, y - 26, 300, 44, { radius: 12, fill: 'rgba(255,255,255,0.07)', stroke: accent + 'aa' });
    }
    txt(ctx, (isSel ? '▸  ' : '') + PAUSE_ITEMS[i], 640, y + 4, {
      size: isSel ? 24 : 19,
      align: 'center',
      color: isSel ? '#ffffff' : '#8b95a8',
      weight: isSel ? 900 : 700,
    });
  }
  txt(ctx, '↑ ↓  choisir      A  valider      B / Échap / Select  reprendre', 640, 560, {
    size: 14,
    align: 'center',
    color: '#6a7488',
  });
}

// Glyphe vectoriel d'un jeu (utilisé par le menu, la fiche et les vignettes).
export function gameGlyph(ctx: CanvasRenderingContext2D, id: string, x: number, y: number, col: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.lineWidth = 3;
  ctx.shadowColor = col;
  ctx.shadowBlur = 12;
  if (id === 'beat') {
    ctx.beginPath(); ctx.ellipse(-8, 10, 9, 7, -0.4, 0, 6.2832); ctx.fill();
    ctx.beginPath(); ctx.moveTo(1, 8); ctx.lineTo(1, -16); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(1, -16); ctx.quadraticCurveTo(12, -14, 14, -4); ctx.stroke();
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(26 + i * 10, 10, 3.5, 0, 6.2832); ctx.fill(); }
  } else if (id === 'surv') {
    ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-11, 11); ctx.lineTo(-11, -11); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.arc(-20, 0, 7, 0, 6.2832); ctx.fill();
  } else if (id === 'shoot') {
    ctx.beginPath(); ctx.arc(0, 0, 15, 0, 6.2832); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-23, 0); ctx.lineTo(-9, 0); ctx.moveTo(9, 0); ctx.lineTo(23, 0);
    ctx.moveTo(0, -23); ctx.lineTo(0, -9); ctx.moveTo(0, 9); ctx.lineTo(0, 23);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 3, 0, 6.2832); ctx.fill();
  } else if (id === 'run') {
    ctx.beginPath(); ctx.moveTo(-26, 14); ctx.lineTo(26, 14); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-16, 14); ctx.lineTo(-8, -8); ctx.lineTo(0, 14); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(2, 14); ctx.lineTo(10, -8); ctx.lineTo(18, 14); ctx.closePath(); ctx.fill();
  } else if (id === 'cave') {
    ctx.beginPath(); ctx.arc(0, 26, 30, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, -26, 30, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 5, 0, 6.2832); ctx.fill();
  } else if (id === 'simon') {
    const points: readonly (readonly [number, number])[] = [[0, -15], [-15, 0], [15, 0], [0, 15]];
    for (let i = 0; i < 4; i++) {
      ctx.beginPath(); ctx.arc(points[i][0], points[i][1], 8, 0, 6.2832);
      if (i === 0) ctx.fill(); else ctx.stroke();
    }
  } else if (id === 'snake') {
    ctx.beginPath();
    ctx.moveTo(-24, 10);
    ctx.quadraticCurveTo(-12, -14, 0, 0);
    ctx.quadraticCurveTo(12, 14, 22, -8);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(22, -10, 5, 0, 6.2832); ctx.fill();
  } else if (id === 'breaker') {
    for (let i = 0; i < 3; i++) ctx.strokeRect(-21 + i * 15, -17, 12, 9);
    ctx.beginPath(); ctx.moveTo(-17, 14); ctx.lineTo(17, 14); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 4, 0, 6.2832); ctx.fill();
  } else if (id === 'golf') {
    ctx.beginPath(); ctx.moveTo(8, 10); ctx.lineTo(8, -20); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(8, -20); ctx.lineTo(22, -14); ctx.lineTo(8, -8); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-2, 13, 14, 5, 0, 0, Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.arc(-18, 11, 4, 0, 6.2832); ctx.fill();
  } else if (id === 'fish') {
    ctx.beginPath(); ctx.ellipse(-4, 0, 15, 9, 0, 0, 6.2832); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(22, -8); ctx.lineTo(22, 8); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.arc(-10, -3, 2, 0, 6.2832); ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.arc(-4, -17, 3, 0, 6.2832); ctx.fill();
    ctx.beginPath(); ctx.arc(4, -24, 2, 0, 6.2832); ctx.fill();
  } else if (id === 'pong') {
    ctx.beginPath(); ctx.moveTo(-23, -18); ctx.lineTo(-23, 18); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(23, -18); ctx.lineTo(23, 18); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 6, 0, 6.2832); ctx.fill();
    ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.moveTo(0, -25); ctx.lineTo(0, 25); ctx.stroke();
    ctx.setLineDash([]);
  } else if (id === 'columns') {
    // Trio vertical + éclat : trois pastilles empilées, celle du milieu en halo.
    ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.arc(0, -15, 7, 0, 6.2832); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 15, 7, 0, 6.2832); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = '#ffffff88';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 12, Math.sin(a) * 12);
      ctx.lineTo(Math.cos(a) * 18, Math.sin(a) * 18);
      ctx.stroke();
    }
  } else if (id === 'bubble') {
    // Bulle + satellite + viseur : le tir à l'unité façon Puzzle-Bobble.
    ctx.beginPath(); ctx.arc(-4, 6, 12, 0, 6.2832); ctx.stroke();
    ctx.beginPath(); ctx.arc(-4, 6, 4, 0, 6.2832); ctx.fill();
    ctx.beginPath(); ctx.arc(13, -9, 6, 0, 6.2832); ctx.stroke();
    ctx.globalAlpha = 0.6;
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(-4, -6); ctx.lineTo(13, -15); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

export function drawHint(ctx: CanvasRenderingContext2D, str: string, time: number): void {
  const alpha = Math.min(1, time / 0.8);
  ctx.globalAlpha = alpha * 0.92;
  ctx.font = '800 19px ' + SANS;
  const width = ctx.measureText(str).width + 56;
  panel(ctx, 640 - width / 2, 636, width, 46, { radius: 23 });
  txt(ctx, str, 640, 666, { size: 19, align: 'center', color: '#dfe6f0' });
  ctx.globalAlpha = 1;
}

export function drawHUD(ctx: CanvasRenderingContext2D, { accent, score, unit = 'pts', time = null, extra = null }: HudOptions): void {
  // Cartes discrètes : elles donnent une ancre stable au HUD sans masquer le jeu.
  panel(ctx, 1088, 14, 176, 58, {
    radius: 14,
    fill: 'rgba(7, 10, 17, 0.68)',
    stroke: accent + '38',
    lineWidth: 1.25,
  });
  txt(ctx, 'SCORE', 1106, 31, { size: 9, mono: true, color: accent, weight: 900 });
  txt(ctx, fmt(score), 1252, 48, { size: 26, align: 'right', mono: true, weight: 700, shadow: true });
  txt(ctx, unit, 1252, 64, { size: 12, align: 'right', color: '#7c8698' });
  if (time !== null) {
    panel(ctx, 16, 14, 142, 58, {
      radius: 14,
      fill: 'rgba(7, 10, 17, 0.68)',
      stroke: accent + '38',
      lineWidth: 1.25,
    });
    txt(ctx, 'TEMPS', 32, 31, { size: 9, mono: true, color: accent, weight: 900 });
    txt(ctx, Math.floor(time) + 's', 32, 57, { size: 22, mono: true, color: accent, shadow: true });
  }
  if (extra) extra();
}
