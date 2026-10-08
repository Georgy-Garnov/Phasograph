/**
 * Earthing of the TN-C network and underground service drops.
 *
 * Earth electrode resistances follow the Russian Electrical Installation Code (PUE 1.7.101, 1.7.103) for a 380 V
 * network: the transformer neutral ≤ 4 Ω, every repeated earthing of the PEN conductor on a pole ≤ 30 Ω.
 */
import type { SchemeLine, Underground } from './types';

export const KTP_GROUND_OHM = 4;
export const REGROUND_OHM = 30;

/** Underground drop defaults: down the pole from 6 m, laid 1.5 m deep, up the wall to 2 m at the entry. */
export const UNDERGROUND_DEFAULTS = { poleHeightM: 6, depthM: 1.5, entryHeightM: 2 } as const;

/** Positive number typed by the user, or the default. */
export function positiveOr(s: string | undefined, fallback: number): number {
  const v = Number(String(s ?? '').replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const emptyUnderground = (): Underground => ({ poleHeightM: '', depthM: '', entryHeightM: '' });

/** Vertical runs of an underground drop: down the pole and into the trench, then up out of it to the entry. */
export function undergroundExtraM(u: Underground): number {
  const depth = positiveOr(u.depthM, UNDERGROUND_DEFAULTS.depthM);
  return positiveOr(u.poleHeightM, UNDERGROUND_DEFAULTS.poleHeightM) + 2 * depth + positiveOr(u.entryHeightM, UNDERGROUND_DEFAULTS.entryHeightM);
}

export const isUnderground = (line: Pick<SchemeLine, 'kind' | 'underground'>): boolean => line.kind === 'drop' && !!line.underground;
