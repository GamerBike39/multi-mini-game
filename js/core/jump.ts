// Saut variable partagé : le « nuancier » du runner, prêt pour les futurs
// jeux de plateforme et de saut.
//
// Le principe : le tap coupe la montée, le maintien prolonge une fenêtre de
// faible gravité. Chaque durée d'appui produit une hauteur clairement
// différente — plus lisible qu'un simple multiplicateur de gravité.
//
// Le module ne gère que les minuteurs et le choix de la gravité ; le jeu
// garde la détection des supports, l'intégration de la vitesse et les FX.
// Ordre d'appel recommandé par frame (identique au runner) :
//   1. pressJumpButton() si front d'appui
//   2. decayJumpTimers()
//   3. tryLaunch() -> lancer l'impulsion + FX si 'ground' / 'air'
//   4. si en l'air : advanceJumpAir() puis releaseJump(held)
//   5. vy = applyJumpCut() puis vy += jumpGravity() * dt
//   6. résoudre les supports -> landJump() si posé, sinon armCoyote()
//      quand on quitte le sol sans sauter.

export interface JumpTuning {
  jumpSpeed: number;     // impulsion verticale (px/s, vers le haut = négatif en jeu)
  holdGravity: number;   // gravité pendant le maintien (montée retenue)
  riseGravity: number;   // gravité de montée, bouton relâché
  fallGravity: number;   // gravité de chute
  fastFallExtra: number; // gravité bonus (ex : touche bas en l'air)
  cutSpeed: number;      // vitesse de montée imposée quand le tap coupe
  minTime: number;       // le cut ne s'applique qu'après ce temps de vol
  holdTime: number;      // fin de la fenêtre de maintien
  coyoteTime: number;    // délai de grâce après avoir quitté un support
  bufferTime: number;    // l'appui reste valable ce temps-là
  maxJumps: number;      // 1 = saut simple, 2 = double saut...
}

// Réglage historique du runner, inchangé : toute modification retune le jeu.
export const RUNNER_JUMP: JumpTuning = {
  jumpSpeed: 1080,
  holdGravity: 1700,
  riseGravity: 3150,
  fallGravity: 3600,
  fastFallExtra: 4200,
  cutSpeed: 430,
  minTime: 0.07,
  holdTime: 0.18,
  coyoteTime: 0.11,
  bufferTime: 0.13,
  maxJumps: 2,
};

export interface JumpState {
  buffer: number;    // temps restant de l'appui mémorisé
  coyote: number;    // temps restant du coyote time
  jumpT: number;     // temps depuis le décollage
  released: boolean; // le bouton a été relâché pendant ce vol
  jumps: number;     // sauts consommés sur ce vol (1 après un saut au sol)
}

export function createJumpState(): JumpState {
  return { buffer: 0, coyote: 0, jumpT: 0, released: false, jumps: 0 };
}

// 1. Mémorise un front d'appui (appeler avant decayJumpTimers la même frame).
export function pressJumpButton(s: JumpState, t: JumpTuning): void {
  s.buffer = t.bufferTime;
}

// 2. Fait vieillir l'appui mémorisé et le coyote time.
export function decayJumpTimers(s: JumpState, dt: number): void {
  s.buffer = Math.max(0, s.buffer - dt);
  s.coyote = Math.max(0, s.coyote - dt);
}

export type JumpLaunch = 'ground' | 'air';

// 3. Tente un décollage : au sol (ou coyote) en priorité, sinon saut aérien
// si le compteur le permet. Consomme l'appui et arme le vol. Sans appui en
// attente, ou compteur épuisé en l'air : null (l'appui reste mémorisé).
export function tryLaunch(s: JumpState, t: JumpTuning, grounded: boolean): JumpLaunch | null {
  if (s.buffer <= 0) return null;
  if (grounded || s.coyote > 0) {
    launchJump(s, false, t.maxJumps);
    return 'ground';
  }
  if (s.jumps < t.maxJumps) {
    launchJump(s, true, t.maxJumps);
    return 'air';
  }
  return null;
}

export function launchJump(s: JumpState, air: boolean, maxJumps: number): void {
  s.buffer = 0;
  s.coyote = 0;
  s.jumpT = 0;
  s.released = false;
  s.jumps = air ? maxJumps : 1;
}

// 4a. Fait vieillir le vol (appeler quand l'état sol de la frame dit en l'air).
export function advanceJumpAir(s: JumpState, dt: number): void {
  s.jumpT += dt;
}

// 4b. Marque le bouton comme relâché pour ce vol (held = bouton tenu).
export function releaseJump(s: JumpState, held: boolean): void {
  if (!held) s.released = true;
}

// Réinitialise le minuteur de vol sans toucher au compteur (ex : flap :
// chaque battement est un nouveau vol d'un seul saut).
export function resetJumpAir(s: JumpState): void {
  s.jumpT = 0;
  s.released = false;
}

// 5a. Le tap coupe la montée : impose la vitesse de coupe dans la fenêtre.
export function applyJumpCut(s: JumpState, t: JumpTuning, vy: number): number {
  if (s.released && s.jumpT >= t.minTime && s.jumpT < t.holdTime && vy < -t.cutSpeed) {
    return -t.cutSpeed;
  }
  return vy;
}

// Courbe du « nuancier » : gravité de montée selon le maintien.
export function riseGravity(
  held: boolean, released: boolean, age: number,
  holdTime: number, holdGravity: number, riseGravityValue: number,
): number {
  return held && !released && age < holdTime ? holdGravity : riseGravityValue;
}

// 5b. Gravité en trois temps : montée retenue, montée relâchée, chute lourde.
export function jumpGravity(
  s: JumpState, t: JumpTuning, vy: number, held: boolean, fastFall: boolean,
): number {
  let g = vy < 0
    ? riseGravity(held, s.released, s.jumpT, t.holdTime, t.holdGravity, t.riseGravity)
    : t.fallGravity;
  if (fastFall) g += t.fastFallExtra;
  return g;
}

// 6a. Atterrissage : le prochain appui repart d'un compteur plein.
export function landJump(s: JumpState): void {
  s.jumpT = 0;
  s.released = false;
  s.coyote = 0;
  s.jumps = 0;
}

// 6b. Quitte un support sans sauter (marche dans le vide) : arme le coyote.
export function armCoyote(s: JumpState, t: JumpTuning): void {
  s.coyote = t.coyoteTime;
}
