import type { Importance, JobItem, Status } from '@app/shared';

/** SPEC.md section 6. Weights and values are the open decisions in section 12. */
const WEIGHT: Record<Importance, number> = { must: 2, nice: 1 };
const VALUE: Record<Status, number> = { met: 1, partial: 0.5, missing: 0 };

export type ScorableItem = Pick<JobItem, 'importance' | 'status'>;

/**
 * score = round(100 * sum(w*s) / sum(w))
 *
 * Callers must reject an empty requirement list before this point (that is a
 * 502 AI_BAD_OUTPUT, not a 0% match).
 */
export function computeMatchScore(items: readonly ScorableItem[]): number {
  if (items.length === 0) {
    throw new RangeError('computeMatchScore needs at least one requirement');
  }

  let earned = 0;
  let possible = 0;

  for (const item of items) {
    const weight = WEIGHT[item.importance];
    earned += weight * VALUE[item.status];
    possible += weight;
  }

  return Math.round((100 * earned) / possible);
}
