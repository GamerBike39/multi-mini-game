/** Porte à seuils séparés : elle évite les bascules répétées autour d'un seuil. */
export class HysteresisGate {
  active = false;

  constructor(
    readonly onThreshold: number,
    readonly offThreshold: number,
  ) {
    if (offThreshold > onThreshold) throw new Error('Le seuil de sortie doit être inférieur au seuil d’entrée.');
  }

  update(value: number): boolean {
    const safeValue = Number.isFinite(value) ? value : 0;
    if (!this.active && safeValue >= this.onThreshold) this.active = true;
    else if (this.active && safeValue <= this.offThreshold) this.active = false;
    return this.active;
  }

  reset(active = false): void {
    this.active = active;
  }
}
