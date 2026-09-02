// Analyse audio locale (BLOB BEAT, mode playlist) : détection d'onsets par bandes
// de fréquences + estimation de BPM. Tout se passe dans le navigateur sur le PCM
// décodé — rien n'est envoyé nulle part.
//
// Méthode : mix mono → décimation ~11 kHz → 3 bandes par filtres one-pole
// (grave <140 Hz, médium 140–1200, aigu >4500) → enveloppe RMS 10 ms → flux
// d'onset (diff positive) → pics à seuil adaptatif local.

export interface Onset {
  t: number;
  band: number;
  s: number;
}

export interface AudioAnalysis {
  onsets: Onset[];
  bpm: number;
  duration: number;
}

export async function analyzeBuffer(audioBuffer: AudioBuffer): Promise<AudioAnalysis> {
  const sr0 = audioBuffer.sampleRate;
  const chA = audioBuffer.getChannelData(0);
  const chB = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null;

  // 1. Décimation (moyennage) — la perte au-dessus de ~5,5 kHz ne gêne pas la détection.
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

  // 2. Bandes + enveloppes RMS par trames de 10 ms.
  const onePole = (fc: number): ((value: number) => number) => {
    const a = Math.exp((-2 * Math.PI * fc) / sr);
    const state = { y: 0 };
    return (value: number): number => {
      state.y += (1 - a) * (value - state.y);
      return state.y;
    };
  };
  const fLow = onePole(140);
  const fMid = onePole(1200);
  const fHigh = onePole(4500);
  const frame = Math.max(1, Math.round(sr / 100));
  const frames = Math.floor(n / frame);
  const env = [
    new Float32Array(frames),
    new Float32Array(frames),
    new Float32Array(frames),
  ];

  for (let f = 0; f < frames; f++) {
    let e0 = 0;
    let e1 = 0;
    let e2 = 0;
    const off = f * frame;
    for (let i = 0; i < frame; i++) {
      const v = x[off + i];
      const lo = fLow(v);
      const mid = fMid(v) - lo;
      const hi = v - fHigh(v);
      e0 += lo * lo;
      e1 += mid * mid;
      e2 += hi * hi;
    }
    const k = 1 / frame;
    env[0][f] = Math.sqrt(e0 * k);
    env[1][f] = Math.sqrt(e1 * k);
    env[2][f] = Math.sqrt(e2 * k);
  }

  // 3. Flux d'onset par bande.
  const flux = env.map((envelope) => {
    const result = new Float32Array(frames);
    for (let f = 1; f < frames; f++) {
      const d = envelope[f] - envelope[f - 1];
      result[f] = d > 0 ? d : 0;
    }
    return result;
  });

  // 4. Pics à seuil adaptatif (moyenne locale ±0,6 s), maxima locaux stricts.
  const onsets: Onset[] = [];
  const win = 60;
  for (let b = 0; b < 3; b++) {
    const bandFlux = flux[b];
    const prefix = new Float64Array(frames + 1);
    for (let f = 0; f < frames; f++) prefix[f + 1] = prefix[f] + bandFlux[f];
    for (let f = 2; f < frames - 2; f++) {
      const value = bandFlux[f];
      if (value <= 0) continue;
      const a0 = Math.max(0, f - win);
      const a1 = Math.min(frames, f + win);
      const mean = (prefix[a1] - prefix[a0]) / (a1 - a0);
      if (value > mean * 1.5 + 1e-4
        && value >= bandFlux[f - 1]
        && value >= bandFlux[f + 1]
        && value > bandFlux[f - 2]
        && value > bandFlux[f + 2]) {
        onsets.push({ t: f / 100, band: b, s: value / (mean + 1e-6) });
      }
    }
  }

  // 5. Dédoublonnage par bande (garde le pic le plus fort des rapprochés < 120 ms).
  onsets.sort((a, b) => a.t - b.t);
  const lastByBand: Partial<Record<number, Onset>> = {};
  const cleaned: Onset[] = [];
  for (const onset of onsets) {
    const last = lastByBand[onset.band];
    if (last && onset.t - last.t < 0.12) {
      if (onset.s > last.s) {
        last.t = onset.t;
        last.s = onset.s;
      }
      continue;
    }
    lastByBand[onset.band] = onset;
    cleaned.push(onset);
  }

  // 6. BPM : autocorrélation du flux total (60–180 BPM), léger biais vers 120.
  const total = new Float32Array(frames);
  for (let f = 0; f < frames; f++) total[f] = flux[0][f] + flux[1][f] + flux[2][f];
  let bestLag = 50;
  let bestValue = -1;
  for (let lag = 33; lag <= 167; lag++) {
    let value = 0;
    for (let f = 0; f + lag < frames; f++) value += total[f] * total[f + lag];
    value /= frames - lag;
    const bpm = 6000 / lag;
    value *= 1 - (Math.min(1, Math.abs(bpm - 120) / 240) * 0.5);
    if (value > bestValue) {
      bestValue = value;
      bestLag = lag;
    }
  }
  const bpm = bestValue > 0 ? Math.round(6000 / bestLag) : 120;

  return { onsets: cleaned, bpm, duration: audioBuffer.duration };
}
