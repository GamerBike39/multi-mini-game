import type { ReferenceComposition, ReferenceMusic } from '../types';
import { fishReference } from './fish-v1';
import { shooterReference } from './shooter-v1';
import { survivalReference } from './survival-v1';

export const REFERENCE_COMPOSITIONS: Readonly<Record<ReferenceMusic, ReferenceComposition>> = {
  shooter: shooterReference,
  survival: survivalReference,
  fish: fishReference,
};

export const getReferenceComposition = (reference: ReferenceMusic): ReferenceComposition =>
  REFERENCE_COMPOSITIONS[reference];

