// Helpers mélodiques purs ( DAG déterministe, testables sans AudioContext ).
//
// Une "mood" mélodique porte une tonique (MIDI), une progression d'accords
// cyclée par mesure de 16 pas, et un arpège optionnel (offsets en demi-tons
// depuis tonique + 12, `null` = silence sur le pas).

export interface MelodicMood {
  root: number;
  progression?: readonly number[] | null;
  arp?: readonly (number | null)[] | null;
  brass?: readonly (number | null)[] | null;
  vox?: readonly (number | null)[] | null;
  lead?: readonly (number | null)[] | null;
}

/** Remplissage de fin de phrase : discret (2 coups) ou appuyé (roulement). */
export type FillKind = 'off' | 'light' | 'full';

/** Voyelles de fête : le cycle suit les mesures paires (I, IV, I, ...). */
export type VoxVowel = 'hey' | 'oh' | 'ah';

const VOX_VOWELS: readonly VoxVowel[] = ['hey', 'oh'];

/** Tonique effective pour un pas absolu (la progression boucle par mesure). */
export function progressionRoot(mood: MelodicMood, absoluteStep: number): number {
  const steps = mood.progression;
  if (!steps || steps.length === 0) return mood.root;
  const bar = Math.floor(Math.max(0, absoluteStep) / 16);
  const offset = steps[((bar % steps.length) + steps.length) % steps.length];
  return mood.root + (Number.isFinite(offset) ? offset : 0);
}

/** Offset d'arpège pour un pas absolu, ou `null` si silence / pas d'arpège. */
export function arpOffsetAt(mood: MelodicMood, absoluteStep: number): number | null {
  return patternStepAt(mood.arp, absoluteStep);
}

/** Offset de cuivre (stab) pour un pas absolu, ou `null` si silence. */
export function brassOffsetAt(mood: MelodicMood, absoluteStep: number): number | null {
  return patternStepAt(mood.brass, absoluteStep);
}

/** Note de leitmotiv pour un pas absolu (ne chante que sur les peaks). */
export function leadOffsetAt(mood: MelodicMood, absoluteStep: number): number | null {
  return patternStepAt(mood.lead, absoluteStep);
}

/** Durée d'une croche pointée (delay synchronisé) pour un tempo donné. */
export function dottedEighth(bpm: number): number {
  const safe = Number.isFinite(bpm) && bpm > 0 ? bpm : 120;
  return (60 / safe) * 0.75;
}

/** Décalage swing des contretemps (pas 2, 6, 10, 14), comme les références. */
export function swingOffsetAt(step16: number, swing: number, bpm: number): number {
  if (!Number.isFinite(swing) || swing <= 0) return 0;
  const step = ((Math.floor(step16) % 16) + 16) % 16;
  if ((step - 2) % 4 !== 0) return 0;
  const safeBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : 120;
  return Math.min(0.25, swing) * (60 / safeBpm / 2);
}

/** Coups de fill ajoutés sur le dernier temps d'une phrase de 4 mesures. */
export function fillDrumsAt(fill: FillKind | null | undefined, absoluteStep: number): ReadonlyArray<'kick' | 'snare' | 'tom'> {
  if (fill !== 'light' && fill !== 'full') return [];
  const inPhrase = ((Math.floor(Math.max(0, absoluteStep)) % 64) + 64) % 64;
  if (inPhrase < 60) return [];
  if (fill === 'full') return inPhrase === 60 ? ['kick', 'snare'] : ['snare'];
  return inPhrase >= 62 ? ['snare'] : [];
}

/** Mesure de respiration : batterie en retrait (hats seuls), tous les N bars. */
export function isBreakBar(breaks: number | null | undefined, absoluteStep: number): boolean {
  if (!Number.isFinite(breaks) || (breaks as number) < 4) return false;
  const period = Math.floor(breaks as number);
  const bar = Math.floor(Math.max(0, absoluteStep) / 16);
  return bar > 0 && bar % period === period - 1;
}

/**
 * Cri de fête pour un pas absolu : un "hey!"/"oh!" toutes les deux mesures
 * (I puis IV), la voyelle alternant. `null` le reste du temps.
 */
export function voxStepAt(mood: MelodicMood, absoluteStep: number): { offset: number; vowel: VoxVowel } | null {
  if (!mood.vox || mood.vox.length === 0) return null;
  const bar = Math.floor(Math.max(0, absoluteStep) / 16);
  if (bar % 2 === 1) return null;
  const offset = patternStepAt(mood.vox, absoluteStep);
  if (offset === null) return null;
  return { offset, vowel: VOX_VOWELS[(bar / 2) % VOX_VOWELS.length] };
}

function patternStepAt(pattern: readonly (number | null)[] | null | undefined, absoluteStep: number): number | null {
  if (!pattern || pattern.length === 0) return null;
  const index = ((Math.floor(Math.max(0, absoluteStep)) % pattern.length) + pattern.length) % pattern.length;
  const offset = pattern[index];
  return typeof offset === 'number' && Number.isFinite(offset) ? offset : null;
}
