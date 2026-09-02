// Overlay "Réglages" : volumes (général / musique / effets), muet, plein écran, vibrations.
// Navigable clavier + manette (↑↓ ←→ A B/Échap) et à la souris (clic sur les sliders).
// L'engine le dessine au-dessus de tout ; menu et jeux le manipulent via open()/update().

const W = 660, H = 452;

const clamp01 = (v) => Math.max(0, Math.min(1, v));

export class Settings {
  constructor(engine) {
    this.eng = engine;
    this.input = engine.input;
    this.audio = engine.audio;
    this.active = false;
    this.sel = 0;
    this.rep = 0;                 // répétition ←→ sur un slider
    this.t = 0;
    this.drag = null;             // index du slider en cours de drag souris
    this.rects = [];              // zones cliquables (refresh à chaque draw)
    this.pvU = false; this.pvD = false;
  }

  get fullscreen() { return !!document.fullscreenElement; }

  open() {
    this.active = true;
    this.sel = 0;
    this.rep = 0;
    this.t = 0;
    this.input.absorb();          // la frappe qui ouvre ne doit pas re-déclencher ici
  }

  close() {
    this.active = false;
    this.audio.uiBack();
    this.input.absorb();          // ni là : la frappe qui ferme ne traverse pas derrière
  }

  toggleFullscreen() { this.eng.toggleFullscreen(); }

  // Nombre d'items : 3 sliders + 3 toggles
  count() { return 6; }

  update(dt) {
    if (!this.active) return false;
    this.t += dt;
    const I = this.input;

    const U = I.down('up') || I.moveY < -0.5;
    const D = I.down('down') || I.moveY > 0.5;
    if (I.pressed('up') || (U && !this.pvU)) { this.sel = (this.sel + this.count() - 1) % this.count(); this.audio.uiMove(); this.rep = 0.34; }
    if (I.pressed('down') || (D && !this.pvD)) { this.sel = (this.sel + 1) % this.count(); this.audio.uiMove(); this.rep = 0.34; }
    this.pvU = U; this.pvD = D;

    // ←→ : règle les sliders, avec répétition auto
    const L = I.down('left') || I.moveX < -0.5;
    const R = I.down('right') || I.moveX > 0.5;
    let dir = 0;
    if (I.pressed('left')) dir = -1;
    else if (I.pressed('right')) dir = 1;
    else if ((L && !this.wasLR) || (R && !this.wasRR)) { dir = L ? -1 : 1; this.rep = 0.34; }
    else if (L || R) { this.rep -= dt; if (this.rep <= 0) { dir = L ? -1 : 1; this.rep = 0.09; } }
    this.wasLR = L; this.wasRR = R;
    if (dir) {
      const k = this.sel <= 2 ? ['master', 'music', 'sfx'][this.sel] : null;
      if (k) { this.audio.setVol(k, clamp01(this.audio.vols[k] + dir * 0.05)); this.audio.uiMove(); }
    }

    if (I.pressed('a')) {
      this.audio.uiOk();
      if (this.sel === 3) this.audio.setMuted(!this.audio.muted);
      else if (this.sel === 4) this.toggleFullscreen();
      else if (this.sel === 5) {
        const inp = this.input;
        inp.vibration = !inp.vibration;
        try { localStorage.setItem('blobArcade.vib', inp.vibration ? '1' : '0'); } catch (e) { /* pas grave */ }
        inp.rumble(0.6, 0.2);
      }
    }
    if (I.pressed('b') || I.pressed('back') || I.pressed('select')) this.close();
    return true;
  }

  // Clic souris (coordonnées 1280×720) : slider = valeur + début de drag,
  // toggle/action = activation, clic hors du panneau = fermeture.
  onPointer(x, y) {
    if (!this.active) return false;
    const px = (1280 - W) / 2, py = (720 - H) / 2;
    if (x < px || x > px + W || y < py || y > py + H) { this.close(); return true; }
    for (const r of this.rects) {
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        this.sel = r.i;
        if (r.type === 'slider') {
          const k = ['master', 'music', 'sfx'][r.i];
          this.audio.setVol(k, clamp01((x - r.bx) / r.bw));
          this.drag = r.i;
          this.audio.uiMove();
        } else {
          // simule A sur un toggle / action
          if (r.i === 3) this.audio.setMuted(!this.audio.muted);
          else if (r.i === 4) this.toggleFullscreen();
          else if (r.i === 5) {
            const inp = this.input;
            inp.vibration = !inp.vibration;
            try { localStorage.setItem('blobArcade.vib', inp.vibration ? '1' : '0'); } catch (e) { /* pas grave */ }
            inp.rumble(0.6, 0.2);
          }
          this.audio.uiOk();
        }
        return true;
      }
    }
    return true;
  }

  // drag en cours sur un slider + survol (curseur main au-dessus d'un contrôle)
  onPointerMove(x, y) {
    if (!this.active) return false;
    if (this.drag !== null) {
      const r = this.rects.find((q) => q.i === this.drag && q.type === 'slider');
      if (r) this.audio.setVol(['master', 'music', 'sfx'][this.drag], clamp01((x - r.bx) / r.bw));
      return true;
    }
    return this.rects.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  }

  onPointerUp() { this.drag = null; }

  draw(ctx, accent = '#7dd3fc') {
    if (!this.active) return;
    const k = Math.min(1, this.t * 6);          // entrée rapide
    ctx.fillStyle = `rgba(2, 3, 8, ${0.6 * k})`;
    ctx.fillRect(0, 0, 1280, 720);

    const px = (1280 - W) / 2, py = (720 - H) / 2;
    ctx.save();
    ctx.globalAlpha = k;
    ctx.translate((1 - k) * 24, 0);

    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(px, py, W, H, 20); else ctx.rect(px, py, W, H);
    ctx.fillStyle = 'rgba(10, 13, 21, 0.96)';
    ctx.shadowColor = '#000000aa'; ctx.shadowBlur = 40;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = accent + '55'; ctx.lineWidth = 2;
    ctx.stroke();

    this.rects = [];

    // titre + état
    ctx.font = '900 27px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = accent;
    ctx.fillText('RÉGLAGES', px + 34, py + 52);
    ctx.font = '700 12.5px Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#5d6480';
    ctx.fillText(this.fullscreen ? 'PLEIN ÉCRAN ACTIF' : 'FENÊTRÉ', px + W - 34, py + 50);

    const rows = [
      { label: 'Volume général', kind: 'slider', key: 'master' },
      { label: 'Volume musique', kind: 'slider', key: 'music' },
      { label: 'Volume effets', kind: 'slider', key: 'sfx' },
      { label: 'Muet', kind: 'toggle', on: this.audio.muted, hint: 'raccourci : M' },
      { label: 'Plein écran', kind: 'toggle', on: this.fullscreen, hint: 'raccourci : F' },
      { label: 'Vibrations manette', kind: 'toggle', on: this.input.vibration },
    ];

    const bx = px + 300, bw = 226;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const y = py + 84 + i * 52;
      const isSel = i === this.sel;
      if (isSel) {
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(px + 18, y - 6, W - 36, 44, 11); else ctx.rect(px + 18, y - 6, W - 36, 44);
        ctx.fillStyle = 'rgba(255,255,255,0.055)';
        ctx.fill();
        ctx.strokeStyle = accent + '88'; ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      ctx.font = (isSel ? '800 ' : '700 ') + '17px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = isSel ? '#ffffff' : '#b9c2d0';
      ctx.fillText(r.label, px + 34, y + 20);

      if (r.kind === 'slider') {
        const v = this.audio.vols[r.key];
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(bx, y + 10, bw, 10, 5); else ctx.rect(bx, y + 10, bw, 10);
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fill();
        const fw = Math.max(6, bw * v);
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(bx, y + 10, fw, 10, 5); else ctx.rect(bx, y + 10, fw, 10);
        ctx.fillStyle = accent;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(bx + fw, y + 15, 8.5, 0, 6.2832);
        ctx.fillStyle = '#eaf6ff';
        ctx.shadowColor = accent; ctx.shadowBlur = isSel ? 14 : 6;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.font = '700 13px Consolas, monospace';
        ctx.textAlign = 'right';
        ctx.fillStyle = isSel ? '#eaf6ff' : '#7c8698';
        ctx.fillText(Math.round(v * 100) + ' %', px + W - 34, y + 20);
        this.rects.push({ x: px + 18, y: y - 6, w: W - 36, h: 44, i, type: 'slider', bx, bw });
      } else {
        const tw = 96;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(bx + bw - tw, y + 2, tw, 26, 13); else ctx.rect(bx + bw - tw, y + 2, tw, 26);
        ctx.fillStyle = r.on ? accent : 'rgba(255,255,255,0.08)';
        ctx.fill();
        ctx.font = '800 13px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = r.on ? '#06121c' : '#8b95a8';
        ctx.fillText(r.on ? 'OUI' : 'NON', bx + bw - tw / 2, y + 19);
        if (r.hint) {
          ctx.font = '700 11px Consolas, monospace';
          ctx.textAlign = 'right';
          ctx.fillStyle = '#5d6480';
          ctx.fillText(r.hint, px + W - 34, y + 20);
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
