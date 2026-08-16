import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RTS_STYLE_PERCENT_1RM,
  isValidRPE,
  roundRPEToHalfStep,
  getRTSMultiplier,
  calculateE1RMForSet,
} from '../rpeMath';

describe('DEFAULT_RTS_STYLE_PERCENT_1RM matrix structure & values', () => {
  it('contains exactly 12 repetition rows and 9 RPE values per row', () => {
    const repKeys = Object.keys(DEFAULT_RTS_STYLE_PERCENT_1RM).map(Number);
    expect(repKeys.length).toBe(12);
    expect(repKeys.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

    const expectedRpes = [10.0, 9.5, 9.0, 8.5, 8.0, 7.5, 7.0, 6.5, 6.0];
    for (let r = 1; r <= 12; r++) {
      const row = DEFAULT_RTS_STYLE_PERCENT_1RM[r];
      expect(row).toBeDefined();
      const rpeKeys = Object.keys(row).map(Number).sort((a, b) => b - a);
      expect(rpeKeys).toEqual(expectedRpes);
      expect(Object.keys(row).length).toBe(9);
    }
  });

  it('all 108 values exactly match the approved matrix', () => {
    const approved: Record<number, Record<number, number>> = {
      1: { 10.0: 1.000, 9.5: 0.978, 9.0: 0.955, 8.5: 0.939, 8.0: 0.922, 7.5: 0.907, 7.0: 0.892, 6.5: 0.878, 6.0: 0.863 },
      2: { 10.0: 0.955, 9.5: 0.939, 9.0: 0.922, 8.5: 0.907, 8.0: 0.892, 7.5: 0.878, 7.0: 0.863, 6.5: 0.849, 6.0: 0.835 },
      3: { 10.0: 0.922, 9.5: 0.907, 9.0: 0.892, 8.5: 0.878, 8.0: 0.863, 7.5: 0.849, 7.0: 0.835, 6.5: 0.821, 6.0: 0.807 },
      4: { 10.0: 0.892, 9.5: 0.878, 9.0: 0.863, 8.5: 0.849, 8.0: 0.835, 7.5: 0.821, 7.0: 0.807, 6.5: 0.793, 6.0: 0.779 },
      5: { 10.0: 0.863, 9.5: 0.849, 9.0: 0.835, 8.5: 0.821, 8.0: 0.807, 7.5: 0.793, 7.0: 0.779, 6.5: 0.765, 6.0: 0.751 },
      6: { 10.0: 0.835, 9.5: 0.821, 9.0: 0.807, 8.5: 0.793, 8.0: 0.779, 7.5: 0.765, 7.0: 0.751, 6.5: 0.737, 6.0: 0.723 },
      7: { 10.0: 0.807, 9.5: 0.793, 9.0: 0.779, 8.5: 0.765, 8.0: 0.751, 7.5: 0.737, 7.0: 0.723, 6.5: 0.709, 6.0: 0.694 },
      8: { 10.0: 0.786, 9.5: 0.771, 9.0: 0.757, 8.5: 0.743, 8.0: 0.728, 7.5: 0.714, 7.0: 0.699, 6.5: 0.685, 6.0: 0.670 },
      9: { 10.0: 0.762, 9.5: 0.747, 9.0: 0.732, 8.5: 0.717, 8.0: 0.702, 7.5: 0.688, 7.0: 0.673, 6.5: 0.658, 6.0: 0.643 },
      10: { 10.0: 0.739, 9.5: 0.723, 9.0: 0.707, 8.5: 0.691, 8.0: 0.680, 7.5: 0.664, 7.0: 0.649, 6.5: 0.633, 6.0: 0.617 },
      11: { 10.0: 0.707, 9.5: 0.691, 9.0: 0.675, 8.5: 0.659, 8.0: 0.644, 7.5: 0.628, 7.0: 0.613, 6.5: 0.597, 6.0: 0.582 },
      12: { 10.0: 0.680, 9.5: 0.664, 9.0: 0.649, 8.5: 0.633, 8.0: 0.618, 7.5: 0.602, 7.0: 0.587, 6.5: 0.571, 6.0: 0.556 },
    };

    for (let r = 1; r <= 12; r++) {
      for (const rpe of [10.0, 9.5, 9.0, 8.5, 8.0, 7.5, 7.0, 6.5, 6.0]) {
        expect(DEFAULT_RTS_STYLE_PERCENT_1RM[r][rpe]).toBe(approved[r][rpe]);
      }
    }
  });

  it('multipliers strictly increase as RPE increases at a fixed repetition count (row monotonicity)', () => {
    const rpes = [6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0, 9.5, 10.0];
    for (let r = 1; r <= 12; r++) {
      for (let i = 0; i < rpes.length - 1; i++) {
        const lowerRpeVal = DEFAULT_RTS_STYLE_PERCENT_1RM[r][rpes[i]];
        const higherRpeVal = DEFAULT_RTS_STYLE_PERCENT_1RM[r][rpes[i + 1]];
        expect(higherRpeVal).toBeGreaterThan(lowerRpeVal);
      }
    }
  });

  it('multipliers strictly decrease as reps increase at a fixed RPE (column monotonicity)', () => {
    const rpes = [6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0, 9.5, 10.0];
    for (const rpe of rpes) {
      for (let r = 1; r < 12; r++) {
        const lowerRepVal = DEFAULT_RTS_STYLE_PERCENT_1RM[r][rpe];
        const higherRepVal = DEFAULT_RTS_STYLE_PERCENT_1RM[r + 1][rpe];
        expect(lowerRepVal).toBeGreaterThan(higherRepVal);
      }
    }
  });
});

describe('RPE validation and half-step rounding', () => {
  it('rounds valid RPE values correctly to the nearest 0.5', () => {
    expect(roundRPEToHalfStep(8.2)).toBe(8.0);
    expect(roundRPEToHalfStep(8.3)).toBe(8.5);
    expect(roundRPEToHalfStep(8.74)).toBe(8.5);
    expect(roundRPEToHalfStep(8.75)).toBe(9.0);
    expect(roundRPEToHalfStep(10.0)).toBe(10.0);
    expect(roundRPEToHalfStep(6.0)).toBe(6.0);
  });

  it('raw RPE below 6.0 or above 10.0 is rejected before rounding', () => {
    // Below 6.0
    expect(isValidRPE(5.9)).toBe(false);
    expect(isValidRPE(5.8)).toBe(false);
    expect(isValidRPE(0)).toBe(false);
    expect(isValidRPE(-1)).toBe(false);
    expect(isValidRPE(4.0)).toBe(false);
    // Above 10.0
    expect(isValidRPE(10.1)).toBe(false);
    expect(isValidRPE(10.5)).toBe(false);
    expect(isValidRPE(12)).toBe(false);

    // Valid boundaries
    expect(isValidRPE(6.0)).toBe(true);
    expect(isValidRPE(10.0)).toBe(true);
    expect(isValidRPE(7.5)).toBe(true);

    // Missing / non-finite values
    expect(isValidRPE(null)).toBe(false);
    expect(isValidRPE(undefined)).toBe(false);
    expect(isValidRPE(NaN)).toBe(false);
    expect(isValidRPE(Infinity)).toBe(false);
  });
});

describe('getRTSMultiplier behaviour & extension', () => {
  it('returns exact values for reps 1..12 and valid RPE', () => {
    expect(getRTSMultiplier(1, 10.0)).toBe(1.000);
    expect(getRTSMultiplier(10, 8.0)).toBe(0.680);
    expect(getRTSMultiplier(8, 10.0)).toBe(0.786);
    expect(getRTSMultiplier(5, 7.5)).toBe(0.793);
  });

  it('the anchored extension matches the matrix exactly at 12 reps', () => {
    const rpes = [6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0, 9.5, 10.0];
    for (const rpe of rpes) {
      const matrixVal = DEFAULT_RTS_STYLE_PERCENT_1RM[12][rpe];
      const lookupVal = getRTSMultiplier(12, rpe);
      expect(lookupVal).toBe(matrixVal);
    }
  });

  it('the multiplier strictly decreases from 12 to 13 to 15 reps at RPE 6, RPE 8 and RPE 10', () => {
    for (const rpe of [6.0, 8.0, 10.0]) {
      const m12 = getRTSMultiplier(12, rpe);
      const m13 = getRTSMultiplier(13, rpe);
      const m14 = getRTSMultiplier(14, rpe);
      const m15 = getRTSMultiplier(15, rpe);

      expect(m12).not.toBeNull();
      expect(m13).not.toBeNull();
      expect(m14).not.toBeNull();
      expect(m15).not.toBeNull();

      expect(m12!).toBeGreaterThan(m13!);
      expect(m13!).toBeGreaterThan(m14!);
      expect(m14!).toBeGreaterThan(m15!);
    }
  });

  it('computes exact worked values for extension at RPE 8.0', () => {
    // RPE 8.0: RIR = 2, M12 = 0.618, base numerator = 30 + 12 + 2 = 44
    // 12 reps: 0.618 * (44 / 44) = 0.618
    expect(getRTSMultiplier(12, 8.0)).toBeCloseTo(0.618, 6);
    // 13 reps: 0.618 * (44 / 45) = 0.604266...
    expect(getRTSMultiplier(13, 8.0)).toBeCloseTo(0.618 * (44 / 45), 6);
    // 15 reps: 0.618 * (44 / 47) = 0.578553...
    expect(getRTSMultiplier(15, 8.0)).toBeCloseTo(0.618 * (44 / 47), 6);
  });

  it('returns null for invalid reps or invalid explicit RPE', () => {
    expect(getRTSMultiplier(0, 8.0)).toBeNull();
    expect(getRTSMultiplier(-5, 8.0)).toBeNull();
    expect(getRTSMultiplier(5.5, 8.0)).toBeNull();
    expect(getRTSMultiplier(NaN, 8.0)).toBeNull();
    expect(getRTSMultiplier(Infinity, 8.0)).toBeNull();
    expect(getRTSMultiplier(5, 5.5)).toBeNull();
    expect(getRTSMultiplier(5, 10.5)).toBeNull();
  });
});

describe('calculateE1RMForSet behaviour & worked calculations', () => {
  it('matches approved worked calculation: 100 kg for 10 reps at RPE 8 -> 147.059 kg', () => {
    const e1rm = calculateE1RMForSet(100, 10, 8.0);
    expect(e1rm).not.toBeNull();
    // 100 / 0.680 = 147.0588235...
    expect(e1rm).toBeCloseTo(100 / 0.680, 5);
  });

  it('matches approved worked calculation: 100 kg for 10 reps at RPE 10 -> 135.318 kg', () => {
    const e1rm = calculateE1RMForSet(100, 10, 10.0);
    expect(e1rm).not.toBeNull();
    // 100 / 0.739 = 135.317997...
    expect(e1rm).toBeCloseTo(100 / 0.739, 5);
  });

  it('matches approved worked calculation: 100 kg for 8 reps at RPE 10 -> 127.226 kg', () => {
    const e1rm = calculateE1RMForSet(100, 8, 10.0);
    expect(e1rm).not.toBeNull();
    // 100 / 0.786 = 127.226463...
    expect(e1rm).toBeCloseTo(100 / 0.786, 5);
  });

  it('matches approved worked calculation: 100 kg for 15 reps at RPE 8 -> 172.844 kg (via anchored extension)', () => {
    const e1rm = calculateE1RMForSet(100, 15, 8.0);
    expect(e1rm).not.toBeNull();
    // M15 = 0.618 * (44 / 47) = 0.57855319...
    // e1RM = 100 / M15 = 100 / (0.618 * (44 / 47)) = 172.84497...
    const expectedMultiplier = 0.618 * (44 / 47);
    expect(e1rm).toBeCloseTo(100 / expectedMultiplier, 5);
  });

  it('null, undefined and zero RPE use pure reps-only Epley: weight * (1 + reps / 30)', () => {
    // 100 kg x 10 reps with null/undefined/0 -> 100 * (1 + 10/30) = 133.333...
    expect(calculateE1RMForSet(100, 10, null)).toBeCloseTo(100 * (1 + 10 / 30), 5);
    expect(calculateE1RMForSet(100, 10, undefined)).toBeCloseTo(100 * (1 + 10 / 30), 5);
    expect(calculateE1RMForSet(100, 10, 0)).toBeCloseTo(100 * (1 + 10 / 30), 5);
    expect(calculateE1RMForSet(100, 10)).toBeCloseTo(100 * (1 + 10 / 30), 5);
  });

  it('returns null for invalid weight, zero weight, invalid reps, and non-integer reps', () => {
    expect(calculateE1RMForSet(0, 10, 8.0)).toBeNull();
    expect(calculateE1RMForSet(-100, 10, 8.0)).toBeNull();
    expect(calculateE1RMForSet(NaN, 10, 8.0)).toBeNull();
    expect(calculateE1RMForSet(100, 0, 8.0)).toBeNull();
    expect(calculateE1RMForSet(100, -5, 8.0)).toBeNull();
    expect(calculateE1RMForSet(100, 5.5, 8.0)).toBeNull();
    expect(calculateE1RMForSet(100, NaN, 8.0)).toBeNull();
  });

  it('returns null for explicitly invalid RPE (outside 6.0..10.0 and not missing)', () => {
    expect(calculateE1RMForSet(100, 10, 5.5)).toBeNull();
    expect(calculateE1RMForSet(100, 10, 4.0)).toBeNull();
    expect(calculateE1RMForSet(100, 10, 10.5)).toBeNull();
    expect(calculateE1RMForSet(100, 10, 12.0)).toBeNull();
    expect(calculateE1RMForSet(100, 10, -1)).toBeNull();
  });

  it('does NOT apply 2.5 kg rounding within rpeMath.ts (preserves full float precision)', () => {
    const e1rm = calculateE1RMForSet(100, 10, 8.0);
    expect(e1rm).not.toBeNull();
    // 147.0588235... should not be rounded to 147.5 or 145.0
    expect(e1rm).toBe(100 / 0.680);
    expect(e1rm! % 2.5).not.toBe(0);
  });
});
