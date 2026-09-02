// Audio 100% synthétisé (WebAudio) : pas d'assets, tout est généré.
// - SFX : blips, thumps, noise bursts, zaps...
// - Musique : séquenceur 16 pas avec lookahead, synchronisé sur ctx.currentTime.
// - Mode "chart" pour le jeu de rythme : les events du chart SONT la batterie.

const MOODS = {
  menu:     { bpm: 100, root: 57, kick: [0, 8], snare: [], hat: 'off', bass: [0, null, 7, null, 3, null, 7, null], bassDiv: 2, pad: true },
  rhythm:   { bpm: 128, root: 45, kick: [], snare: [], hat: '8ths', bass: [0, 0, 7, 0], bassDiv: 2, pad: false },
  survival: { bpm: 122, root: 40, kick: [0, 7, 8], snare: [4, 12], hat: '8ths', bass: [0, 0, 3, 5, 0, 0, 3, 2], bassDiv: 2, pad: false },
  shooter:  { bpm: 132, root: 45, kick: [0, 4, 8, 12], snare: [4, 12], hat: '16ths', bass: [0, 0, 7, 0, 0, 0, 10, 7], bassDiv: 2, pad: false },
  runner:   { bpm: 138, root: 43, kick: [0, 8, 11], snare: [4, 12], hat: '8ths', bass: [0, 7, 0, 10], bassDiv: 2, pad: false },
  cave:     { bpm: 96,  root: 50, kick: [0, 8], snare: [], hat: 'off', bass: [0, null, 5, null, 7, null, 3, null], bassDiv: 2, pad: true },
  simon:    { bpm: 84,  root: 45, kick: [], snare: [], hat: 'off', bass: null, pad: true },
};

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.muted = false;
    // volumes réglables (0..1), persistés ; master est un facteur global
    this.vols = { master: 0.7, music: 0.9, sfx: 0.9 };
    try {
      const saved = JSON.parse(localStorage.getItem('blobArcade.audio') || '{}');
      const cl = (v, d) => Math.max(0, Math.min(1, typeof v === 'number' && isFinite(v) ? v : d));
      this.vols = { master: cl(saved.master, 0.7), music: cl(saved.music, 0.9), sfx: cl(saved.sfx, 0.9) };
      this.muted = !!saved.mute;
    } catch (e) { /* prefs absentes : défauts */ }
    this.musicOn = false;
    this.mood = null;
    this.timer = null;
    this.chart = null;
    this.chartPtr = 0;
  }

  ensure() {
    if (this.ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
    } catch (e) { return false; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = 0.6;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -18; this.comp.ratio.value = 6;
    this.master.connect(this.comp); this.comp.connect(c.destination);
    this.musicBus = c.createGain(); this.musicBus.gain.value = 0.5; this.musicBus.connect(this.master);
    this.sfxBus = c.createGain(); this.sfxBus.gain.value = 1.0; this.sfxBus.connect(this.master);
    this.trackBus = c.createGain(); this.trackBus.gain.value = 0.9; this.trackBus.connect(this.master);
    this.applyVolumes();
    // buffer de bruit blanc 1s
    const len = c.sampleRate;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  unlock() {
    if (!this.ensure()) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().then(() => {
        if (this.pendingMood) {
          const [n, o] = this.pendingMood;
          this.pendingMood = null;
          this.startMusic(n, o);
        }
      }).catch(() => {});
    } else if (this.ctx.state === 'running' && this.pendingMood) {
      const [n, o] = this.pendingMood;
      this.pendingMood = null;
      this.startMusic(n, o);
    }
  }
  suspend() { this.ctx?.suspend?.(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  // ---------- volumes ----------
  applyVolumes() {
    if (!this.master) return;
    this.master.gain.value = this.muted ? 0 : this.vols.master * 0.9;
    this.musicBus.gain.value = 0.5 * this.vols.music;
    this.sfxBus.gain.value = this.vols.sfx;
    this.trackBus.gain.value = 0.9 * this.vols.music;
  }

  setVol(k, v) {
    if (!(k in this.vols)) return;
    this.vols[k] = Math.max(0, Math.min(1, v));
    this.applyVolumes();
    this.savePrefs();
  }

  setMuted(m) {
    this.muted = m;
    this.applyVolumes();
    this.savePrefs();
  }

  savePrefs() {
    try { localStorage.setItem('blobArcade.audio', JSON.stringify({ ...this.vols, mute: this.muted })); } catch (e) { /* pas grave */ }
  }

  // ---------- primitives ----------
  tone({ f = 440, f1 = 0, type = 'square', t = 0, dur = 0.1, vol = 0.2, attack = 0.002, dest = null } = {}) {
    if (!this.ctx) return;
    const c = this.ctx;
    t = t || c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, f), t);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.sfxBus);
    o.start(t); o.stop(t + dur + 0.05);
  }

  noise({ t = 0, dur = 0.2, vol = 0.3, f = 1000, f1 = 0, type = 'lowpass', q = 1, dest = null } = {}) {
    if (!this.ctx) return;
    const c = this.ctx;
    t = t || c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filt = c.createBiquadFilter();
    filt.type = type; filt.frequency.setValueAtTime(f, t); filt.Q.value = q;
    if (f1) filt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt); filt.connect(g); g.connect(dest || this.sfxBus);
    src.start(t); src.stop(t + dur + 0.05);
  }

  thump(vol = 0.5, { f0 = 150, f1 = 40, dur = 0.18 } = {}) {
    this.tone({ f: f0, f1, type: 'sine', dur, vol });
  }

  // ---------- SFX ----------
  jump() { this.tone({ f: 300, f1: 560, type: 'square', dur: 0.12, vol: 0.14 }); }
  land() { this.noise({ dur: 0.06, f: 500, vol: 0.16 }); this.thump(0.2, { f0: 120, f1: 60, dur: 0.08 }); }
  dash() { this.noise({ dur: 0.16, f: 900, f1: 3200, type: 'bandpass', q: 2, vol: 0.22 }); this.tone({ f: 180, f1: 720, type: 'sawtooth', dur: 0.13, vol: 0.1 }); }
  shoot() { this.tone({ f: 900, f1: 320, type: 'square', dur: 0.06, vol: 0.07 }); }
  hitEnemy() { this.tone({ f: 1300, f1: 500, dur: 0.05, vol: 0.12 }); this.noise({ dur: 0.05, f: 2200, vol: 0.1 }); }
  explode(big = 1) {
    this.noise({ dur: 0.35 * big + 0.1, f: 800, f1: 120, vol: 0.34 });
    this.thump(Math.min(1, 0.65 * big), { f0: 140, f1: 28, dur: 0.3 * big + 0.1 });
  }
  hurt() { this.tone({ f: 250, f1: 90, type: 'sawtooth', dur: 0.2, vol: 0.26 }); this.noise({ dur: 0.14, f: 700, vol: 0.18 }); }
  coin(step = 0) {
    const f = 780 * Math.pow(2, Math.min(12, step) / 12);
    this.tone({ f, type: 'square', dur: 0.06, vol: 0.12 });
    this.tone({ f: f * 1.5, type: 'square', dur: 0.1, vol: 0.12, t: this.ctx ? this.ctx.currentTime + 0.06 : 0 });
  }
  perfect() { this.tone({ f: 1320, type: 'triangle', dur: 0.05, vol: 0.16 }); this.tone({ f: 1760, type: 'triangle', dur: 0.08, vol: 0.16, t: this.ctx ? this.ctx.currentTime + 0.045 : 0 }); }
  good() { this.tone({ f: 900, type: 'triangle', dur: 0.06, vol: 0.13 }); }
  miss() { this.tone({ f: 140, f1: 70, type: 'sawtooth', dur: 0.22, vol: 0.2 }); this.noise({ dur: 0.12, f: 320, vol: 0.12 }); }
  milestone() {
    const t = this.ctx ? this.ctx.currentTime : 0;
    [880, 1108, 1320].forEach((f, i) => this.tone({ f, type: 'triangle', dur: 0.09, vol: 0.12, t: t + i * 0.07 }));
  }
  uiMove() { this.tone({ f: 520, dur: 0.035, vol: 0.07 }); }
  uiOk() { this.tone({ f: 660, dur: 0.06, vol: 0.11 }); this.tone({ f: 990, dur: 0.09, vol: 0.11, t: this.ctx ? this.ctx.currentTime + 0.07 : 0 }); }
  uiBack() { this.tone({ f: 420, f1: 260, dur: 0.08, vol: 0.09 }); }
  whiff() { this.tone({ f: 300, f1: 240, type: 'triangle', dur: 0.03, vol: 0.05 }); }

  // ---------- Musique ----------
  startMusic(name, opts = {}) {
    if (!this.ensure()) return;
    // Contexte pas encore débloqué (modale d'intro pas cliquée) : on mémorise,
    // sinon la musique se cale sur une horloge gelée et ne démarre jamais proprement.
    if (this.ctx.state !== 'running') { this.pendingMood = [name, opts]; return; }
    this.stopMusic();
    const m = MOODS[name];
    if (!m) return;
    this.mood = m;
    this.musicStart = this.ctx.currentTime + 0.12;
    this.step = 0;
    this.chart = opts.chart || null;
    this.chartPtr = 0;
    this.musicOn = true;
    this.timer = setInterval(() => this.scheduleAhead(), 55);
    this.scheduleAhead();
  }

  stopMusic() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.musicOn = false;
    this.chart = null;
    this.trackMode = false;
    this.stopTrack();
  }

  // ---------- piste audio originale (playlist BLOB BEAT) ----------
  playBuffer(buffer, when, offset = 0) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.trackBus);
    src.start(when, offset);
    this.trackSource = src;
    this.trackStartAt = when;
    this.trackOffset = offset;
    this.trackBuffer = buffer;
    src.onended = () => { if (this.trackSource === src) this.trackSource = null; };
  }

  stopTrack() {
    if (this.trackSource) { try { this.trackSource.stop(); } catch (e) { /* déjà stoppée */ } }
    this.trackSource = null;
    this.trackBuffer = null;
    this.trackPausedAt = undefined;
  }

  pauseTrack() {
    if (!this.trackSource) return;
    this.trackPausedAt = this.ctx.currentTime - this.trackStartAt + this.trackOffset;
    try { this.trackSource.stop(); } catch (e) {}
    this.trackSource = null;
  }

  resumeTrack() {
    if (this.trackPausedAt === undefined || !this.trackBuffer) return;
    const pos = Math.max(0, this.trackPausedAt);
    this.playBuffer(this.trackBuffer, this.ctx.currentTime, pos);
    this.trackPausedAt = undefined;
  }

  // position de lecture (s) ; négative pendant le décompte
  trackPos() {
    if (this.trackSource) return this.ctx.currentTime - this.trackStartAt + this.trackOffset;
    return this.trackPausedAt ?? 0;
  }

  // lance une piste originale : décompte métronomique, puis le fichier lui-même
  startTrack(buffer, { countIn = 2, bpm = 120 } = {}) {
    if (!this.ensure()) return;
    this.stopMusic();
    this.musicStart = this.ctx.currentTime + 0.15;
    this.playBuffer(buffer, this.musicStart + countIn, 0);
    this.musicOn = true;
    this.trackMode = true;
    this.trackCountIn = countIn;
    this.mood = { bpm };
    for (let i = 0; i < 4; i++) this.drum('tick', this.musicStart + i * (60 / bpm));
  }

  drum(kind, t) {
    if (kind === 'kick') {
      this.tone({ f: 150, f1: 42, type: 'sine', t, dur: 0.17, vol: 0.85, dest: this.musicBus });
      this.noise({ t, dur: 0.03, f: 3000, vol: 0.1, dest: this.musicBus });
    } else if (kind === 'snare') {
      this.noise({ t, dur: 0.13, f: 1800, type: 'bandpass', q: 0.8, vol: 0.3, dest: this.musicBus });
      this.tone({ f: 190, type: 'triangle', t, dur: 0.05, vol: 0.15, dest: this.musicBus });
    } else if (kind === 'tick') {
      // métronome du décompte du jeu de rythme
      this.tone({ f: 1175, type: 'square', t, dur: 0.05, vol: 0.1, dest: this.musicBus });
    } else {
      this.hatAt(t, 0.15);
    }
  }

  hatAt(t, vol) { this.noise({ t, dur: 0.04, f: 7500, type: 'highpass', vol, dest: this.musicBus }); }

  bassAt(t, midi) {
    this.tone({ f: midiHz(midi), type: 'triangle', t, dur: 0.2, vol: 0.22, dest: this.musicBus });
    this.tone({ f: midiHz(midi + 12), type: 'square', t, dur: 0.1, vol: 0.05, dest: this.musicBus });
  }

  padAt(t, root, dur) {
    for (const iv of [0, 3, 7, 12]) {
      this.tone({ f: midiHz(root + iv), type: 'sawtooth', t, dur: dur * 0.95, vol: 0.028, attack: 0.4, dest: this.musicBus });
    }
  }

  scheduleAhead() {
    if (!this.ctx || !this.musicOn) return;
    const c = this.ctx, m = this.mood;
    const s16 = (60 / m.bpm) / 4;
    const horizon = c.currentTime + 0.2;
    if (this.chart) {
      while (this.chartPtr < this.chart.length) {
        const ev = this.chart[this.chartPtr];
        const t = this.musicStart + ev.t;
        if (t >= horizon) break;
        if (t >= c.currentTime - 0.02) this.drum(ev.drum, t);
        this.chartPtr++;
      }
    }
    while (true) {
      const t = this.musicStart + this.step * s16;
      if (t >= horizon) break;
      if (t >= c.currentTime - 0.02) {
        const s = this.step % 16;
        if (m.kick.includes(s)) this.drum('kick', t);
        if (m.snare.includes(s)) this.drum('snare', t);
        if (m.hat === '8ths' && s % 2 === 0) this.hatAt(t, s % 4 === 2 ? 0.05 : 0.09);
        else if (m.hat === '16ths') this.hatAt(t, s % 4 === 0 ? 0.09 : 0.045);
        if (m.bass && s % m.bassDiv === 0) {
          const n = m.bass[(s / m.bassDiv) % m.bass.length];
          if (n !== null && n !== undefined) this.bassAt(t, m.root + n);
        }
        if (m.pad && s === 0) this.padAt(t, m.root, (60 / m.bpm) * 4);
      }
      this.step++;
    }
  }

  // Temps musical : beat flottant depuis le début de la musique, 0 si pas de musique.
  beat() {
    if (!this.ctx || !this.musicOn) return 0;
    return (this.ctx.currentTime - this.musicStart) / (60 / this.mood.bpm);
  }
  songTime() {
    if (!this.ctx || !this.musicOn) return 0;
    return this.ctx.currentTime - this.musicStart;
  }
}
