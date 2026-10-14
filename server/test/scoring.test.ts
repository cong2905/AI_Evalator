import { describe, expect, it } from 'vitest';
import { computeMatchScore, type ScorableItem } from '../src/services/scoring.js';

const item = (importance: 'must' | 'nice', status: 'met' | 'partial' | 'missing'): ScorableItem => ({
  importance,
  status,
});

describe('computeMatchScore', () => {
  it('scores 100 when everything is met', () => {
    expect(computeMatchScore([item('must', 'met'), item('nice', 'met')])).toBe(100);
  });

  it('scores 0 when everything is missing', () => {
    expect(computeMatchScore([item('must', 'missing'), item('nice', 'missing')])).toBe(0);
  });

  it('matches the mockup example (3 must: met, met, partial; 2 nice: missing, met) = 75', () => {
    const items = [
      item('must', 'met'),
      item('must', 'met'),
      item('must', 'partial'),
      item('nice', 'missing'),
      item('nice', 'met'),
    ];
    // 100 * (2 + 2 + 1 + 0 + 1) / (2 + 2 + 2 + 1 + 1)
    expect(computeMatchScore(items)).toBe(75);
  });

  it('weights a must at twice a nice', () => {
    expect(computeMatchScore([item('must', 'met'), item('nice', 'missing')])).toBe(67);
    expect(computeMatchScore([item('must', 'missing'), item('nice', 'met')])).toBe(33);
  });

  it('counts partial as half', () => {
    expect(computeMatchScore([item('must', 'partial')])).toBe(50);
    expect(computeMatchScore([item('nice', 'partial')])).toBe(50);
  });

  it('rounds to a whole percent', () => {
    // 100 * 2/3 = 66.67
    expect(computeMatchScore([item('must', 'met'), item('must', 'missing'), item('nice', 'met')])).toBe(
      60,
    );
    expect(Number.isInteger(computeMatchScore([item('must', 'partial'), item('nice', 'met')]))).toBe(
      true,
    );
  });

  it('always lands between 0 and 100', () => {
    const statuses = ['met', 'partial', 'missing'] as const;
    for (const a of statuses) {
      for (const b of statuses) {
        const score = computeMatchScore([item('must', a), item('nice', b)]);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }
    }
  });

  it('refuses an empty list rather than reporting 0%', () => {
    expect(() => computeMatchScore([])).toThrow(RangeError);
  });
});
