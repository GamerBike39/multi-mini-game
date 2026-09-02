// Helpers de rendu UI + persistance des records + écrans communs (pause / game over).

const SANS = '"Segoe UI", system-ui, sans-serif';
const MONO = 'Consolas, "Courier New", monospace';

export function txt(ctx, str, x, y, o = {}) {
  const size = o.size ?? 24;
  ctx.font = `${o.weight ?? 800} ${size}px ${o.mono ? MONO : SANS}`;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = o.baseline ?? 'alphabetic';
  ctx.globalAlpha = o.alpha ?? 1;
  if (o.shadow) { ctx.fillStyle = '#00000066'; ctx.fillText(str, x + 2, y + 2); }
  ctx.fillStyle = o.color ?? '#e8ecf2';
  ctx.fillText(str, x, y);
  ctx.globalAlpha = 1;
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function panel(ctx, x, y, w, h, o = {}) {
  roundRect(ctx, x, y, w, h, o.radius ?? 16);
  ctx.fillStyle = o.fill ?? 'rgba(8, 11, 18, 0.85)';
  ctx.fill();
  if (o.stroke) {
    ctx.strokeStyle = o.stroke;
    ctx.lineWidth = o.lineWidth ?? 2;
    ctx.stroke();
  }
}

export function grid(ctx, { gap = 64, off = 0, offY = 0, alpha = 0.05, color = '#8ab4ff' } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = -(off % gap); x < 1280; x += gap) { ctx.moveTo(x, 0); ctx.lineTo(x, 720); }
  for (let y = -(offY % gap); y < 720; y += gap) { ctx.moveTo(0, y); ctx.lineTo(1280, y); }
  ctx.stroke();
  ctx.restore();
}

export function vignette(ctx) {
  const g = ctx.createRadialGradient(640, 360, 340, 640, 360, 780);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1280, 720);
}

// ---------- records ----------
export function getBest(id) {
  try { return +localStorage.getItem('blobArcade.best.' + id) || 0; } catch (e) { return 0; }
}
export function saveBest(id, val) {
  const prev = getBest(id);
  const isNew = val > prev;
  if (isNew) { try { localStorage.setItem('blobArcade.best.' + id, String(Math.floor(val))); } catch (e) {} }
  return { best: Math.max(prev, val), isNew };
}

// ---------- statistiques de jeu (par jeu, persistées) ----------
// { plays: parties terminées, time: secondes jouées, total: somme des scores,
//   last: dernier score, wins: parties gagnées }
export function getStats(id) {
  try { return JSON.parse(localStorage.getItem('blobArcade.stat.' + id)) || {}; } catch (e) { return {}; }
}
function saveStats(id, st) {
  try { localStorage.setItem('blobArcade.stat.' + id, JSON.stringify(st)); } catch (e) { /* pas grave */ }
}
export function addStat(id, { score = 0, time = 0, win = false } = {}) {
  const st = getStats(id);
  st.plays = (st.plays || 0) + 1;
  st.time = (st.time || 0) + Math.max(0, time || 0);
  st.total = (st.total || 0) + Math.max(0, score || 0);
  st.last = Math.floor(score || 0);
  if (win) st.wins = (st.wins || 0) + 1;
  saveStats(id, st);
  return st;
}
export function addTime(id, t) {
  if (!(t > 0)) return;
  const st = getStats(id);
  st.time = (st.time || 0) + t;
  saveStats(id, st);
}

export function fmtTime(s) {
  s = Math.max(0, Math.round(s));
  if (s < 60) return s + ' s';
  const m = Math.round(s / 60);
  if (m < 60) return m + ' min';
  return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0');
}

// découpe un texte en lignes tenant sur maxW (à appeler avec la police déjà définie)
export function wrap(ctx, str, maxW) {
  const words = String(str).split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

const RANK_COLORS = { S: '#ffd166', A: '#a3e635', B: '#38bdf8', C: '#94a3b8', D: '#64748b' };
export function rank(table, val) {
  const letters = ['S', 'A', 'B', 'C', 'D'];
  for (let i = 0; i < letters.length; i++) if (val >= (table[i] ?? 0)) return letters[i];
  return 'D';
}

export function fmt(n) { return String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

// ---------- écrans communs ----------
export function drawGameOver(ctx, { accent, title = 'GAME OVER', score, unit = 'pts', best, isNew, rankLabel }) {
  ctx.fillStyle = 'rgba(2, 3, 8, 0.62)';
  ctx.fillRect(0, 0, 1280, 720);
  panel(ctx, 330, 190, 620, 330, { radius: 22, stroke: accent + '66', lineWidth: 2 });

  txt(ctx, title, 640, 252, { size: 44, align: 'center', color: accent, weight: 900 });
  txt(ctx, 'SCORE', 640, 292, { size: 14, align: 'center', color: '#8b95a8' });
  txt(ctx, fmt(score) + ' ' + unit, 640, 352, { size: 56, align: 'center', mono: true, weight: 700 });

  // rang
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

export function drawPause(ctx, accent, sel = 0) {
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
      size: isSel ? 24 : 19, align: 'center', color: isSel ? '#ffffff' : '#8b95a8', weight: isSel ? 900 : 700,
    });
  }
  txt(ctx, '↑ ↓  choisir      A  valider      B / Échap  reprendre      Backspace  quitter', 640, 560, {
    size: 14, align: 'center', color: '#6a7488',
  });
}

// Glyphe vectoriel d'un jeu (utilisé par le menu, la fiche et les vignettes)
export function gameGlyph(ctx, id, x, y, col) {
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
    // losange de 4 pads, celui du haut allumé
    const p = [[0, -15], [-15, 0], [15, 0], [0, 15]];
    for (let i = 0; i < 4; i++) {
      ctx.beginPath(); ctx.arc(p[i][0], p[i][1], 8, 0, 6.2832);
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
  }
  ctx.restore();
}

export function drawHint(ctx, str, t) {
  const a = Math.min(1, t / 0.8);
  ctx.globalAlpha = a * 0.92;
  const w = ctx.measureText(str).width;
  ctx.font = '800 19px ' + SANS;
  const wpx = ctx.measureText(str).width + 56;
  panel(ctx, 640 - wpx / 2, 636, wpx, 46, { radius: 23 });
  txt(ctx, str, 640, 666, { size: 19, align: 'center', color: '#dfe6f0' });
  ctx.globalAlpha = 1;
}

export function drawHUD(ctx, { accent, score, unit = 'pts', time = null, extra = null }) {
  txt(ctx, fmt(score), 1252, 44, { size: 26, align: 'right', mono: true, weight: 700, shadow: true });
  txt(ctx, unit, 1252, 64, { size: 12, align: 'right', color: '#7c8698' });
  if (time !== null) {
    txt(ctx, Math.floor(time) + 's', 28, 44, { size: 22, mono: true, color: accent, shadow: true });
  }
  if (extra) extra();
}
