import type { AppLike, EngineLike, GameMeta } from '../core/types';

/**
 * Contrat temporaire pour le jeu de rythme conservé en JavaScript pendant sa refonte.
 * Le fichier d'implémentation reste volontairement hors du périmètre TypeScript.
 */
export declare class RhythmGame implements AppLike {
  static meta: GameMeta;
  constructor(engine: EngineLike);
  update(dt: number): void;
  render(ctx: CanvasRenderingContext2D): void;
}
