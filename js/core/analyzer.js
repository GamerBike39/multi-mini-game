// Analyse audio locale (BLOB BEAT, mode playlist) : détection d'onsets par bandes
// de fréquences + estimation de BPM. Tout se passe dans le navigateur sur le PCM
// décodé — rien n'est envoyé nulle part.
//
// Méthode : mix mono → décimation ~11 kHz → 3 bandes par filtres one-pole
// (grave <140 Hz, médium 140–1200, aigu >4500) → enveloppe RMS 10 ms → flux
// d'onset (diff positive) → pics à seuil adaptatif local.

export async function analyzeBuffer(audioBuffer) {
  const sr0 = audioBuffer.sampleRate;
  const chA = audioBuffer.getChannelData(0);
  const chB = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null;

  // 1. décimation (moyennage) — la perte au-dessus de ~5,5 kHz ne gêne pas la détection
  const ds = Math.max(1, Math.floor(sr0 / 11025));
  const sr = sr0 / ds;
  const n = Math.floor(audioBuffer.length / ds);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < ds; k++) {
      const v = chA[i * ds + k];
      s += chB ? (v + chB[i * ds + k]) * 0.5 : v;
    }
    x[i] = s / ds;
  }

  // 2. bandes + enveloppes RMS par trames de 10 ms
  const onePole = (fc) => {
    const a = Math.exp((-2 * Math.PI * fc) / sr);
    const st = { y: 0 };
    return (v) => { st.y += (1 - a) * (v - st.y); return st.y; };
  };
  const fLow = onePole(140), fMid = onePole(1200), fHigh = onePole(4500);
  const frame = Math.max(1, Math.round(sr / 100));
  const frames = Math.floor(n / frame);
  const env = [new Float32Array(frames), new Float32Array(frames), new Float32Array(frames)];
  for (let f = 0; f < frames; f++) {
    let e0 = 0, e1 = 0, e2 = 0;
    const off = f * frame;
    for (let i = 0; i < frame; i++) {
      const v = x[off + i];
      const lo = fLow(v);
      const mid = fMid(v) - lo;
      const hi = v - fHigh(v);
      e0 += lo * lo; e1 += mid * mid; e2 += hi * hi;
    }
    const k = 1 / frame;
    env[0][f] = Math.sqrt(e0 * k);
    env[1][f] = Math.sqrt(e1 * k);
    env[2][f] = Math.sqrt(e2 * k);
  }

  // 3. flux d'onset par bande
  const flux = env.map((e) => {
    const fl = new Float32Array(frames);
    for (let f = 1; f < frames; f++) { const d = e[f] - e[f - 1]; fl[f] = d > 0 ? d : 0; }
    return fl;
  });

  // 4. pics à seuil adaptatif (moyenne locale ±0,6 s), maxima locaux stricts
  const onsets = [];
  const win = 60;
  for (let b = 0; b < 3; b++) {
    const fl = flux[b];
    const pre = new Float64Array(frames + 1);
    for (let f = 0; f < frames; f++) pre[f + 1] = pre[f] + fl[f];
    for (let f = 2; f < frames - 2; f++) {
      const v = fl[f];
      if (v <= 0) continue;
      const a0 = Math.max(0, f - win), a1 = Math.min(frames, f + win);
      const mean = (pre[a1] - pre[a0]) / (a1 - a0);
      if (v > mean * 1.5 + 1e-4 && v >= fl[f - 1] && v >= fl[f + 1] && v > fl[f - 2] && v > fl[f + 2]) {
        onsets.push({ t: f / 100, band: b, s: v / (mean + 1e-6) });
      }
    }
  }

  // 5. dédoublonnage par bande (garde le pic le plus fort des rapprochés < 120 ms)
  onsets.sort((a, b) => a.t - b.t);
  const lastByBand = {};
  const cleaned = [];
  for (const o of onsets) {
    const l = lastByBand[o.band];
    if (l && o.t - l.t < 0.12) {
      if (o.s > l.s) { l.t = o.t; l.s = o.s; }
      continue;
    }
    lastByBand[o.band] = o;
    cleaned.push(o);
  }

  // 6. BPM : autocorrélation du flux total (60–180 BPM), léger biais vers 120
  const tot = new Float32Array(frames);
  for (let f = 0; f < frames; f++) tot[f] = flux[0][f] + flux[1][f] + flux[2][f];
  let bestLag = 50, bestV = -1;
  for (let lag = 33; lag <= 167; lag++) {
    let s = 0;
    for (let f = 0; f + lag < frames; f++) s += tot[f] * tot[f + lag];
    s /= frames - lag;
    const bpm = 6000 / lag;
    s *= 1 - (Math.min(1, Math.abs(bpm - 120) / 240) * 0.5);
    if (s > bestV) { bestV = s; bestLag = lag; }
  }
  const bpm = bestV > 0 ? Math.round(6000 / bestLag) : 120;

  return { onsets: cleaned, bpm, duration: audioBuffer.duration };
}
