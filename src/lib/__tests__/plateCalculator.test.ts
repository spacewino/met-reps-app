import { describe, expect, it } from 'vitest';
import { BAR_WEIGHTS_KG, PLATE_WEIGHTS_KG, calculatePlateLoad, type BarWeightKg } from '../plateCalculator';

describe('barbell plate calculation', () => {
  it('loads 87.5 kg with a 15 kg bar using the fewest plates', () => {
    expect(calculatePlateLoad(87.5, 15)).toEqual({
      plates: [{ weightKg: 20, count: 1 }, { weightKg: 15, count: 1 }, { weightKg: 1.25, count: 1 }],
      perSideKg: 36.25, totalKg: 87.5, differenceKg: 0,
    });
  });

  it.each([
    [81, 80, -1], [81.25, 80, -1.25], [81.26, 82.5, 1.24], [81.9, 82.5, 0.6],
  ])('rounds %s kg to %s kg and reports the signed difference', (target, total, difference) => {
    for (const bar of BAR_WEIGHTS_KG) {
      const result = calculatePlateLoad(target, bar)!;
      expect(result.totalKg).toBe(total);
      expect(result.differenceKg).toBeCloseTo(difference, 10);
      expect(result.plates.reduce((sum, plate) => sum + plate.weightKg * plate.count, 0)).toBe(result.perSideKg);
      expect(result.perSideKg * 2 + bar).toBe(total);
    }
  });

  it('uses a bare bar for targets at or below bar weight', () => {
    for (const bar of BAR_WEIGHTS_KG) {
      expect(calculatePlateLoad(bar, bar)).toMatchObject({ plates: [], totalKg: bar, differenceKg: 0 });
      expect(calculatePlateLoad(0, bar)).toMatchObject({ plates: [], perSideKg: 0, totalKg: bar, differenceKg: bar });
    }
  });

  it.each([NaN, Infinity, -Infinity, -1, Number.MAX_VALUE])('rejects invalid or unrepresentable targets (%s)', target => {
    expect(calculatePlateLoad(target, 20)).toBeNull();
  });
  it('rejects an unsupported bar', () => {
    expect(calculatePlateLoad(100, 12 as BarWeightKg)).toBeNull();
  });

  it('agrees with an independent exhaustive minimum-plate oracle across all totals up to 1,000 kg per side', () => {
    const minimumCounts = [0];
    const denominations = PLATE_WEIGHTS_KG.map(weight => weight / 1.25);
    for (let amount = 1; amount <= 800; amount++) {
      minimumCounts[amount] = Math.min(...denominations.filter(value => value <= amount).map(value => minimumCounts[amount - value] + 1));
    }
    for (const bar of BAR_WEIGHTS_KG) for (let amount = 0; amount <= 800; amount++) {
      const result = calculatePlateLoad(bar + amount * 2.5, bar)!;
      expect(result.plates.reduce((sum, plate) => sum + plate.count, 0)).toBe(minimumCounts[amount]);
      expect(result.plates.reduce((sum, plate) => sum + plate.weightKg * plate.count, 0)).toBe(amount * 1.25);
      expect(result.differenceKg).toBe(0);
    }
  });

  it('favours larger plates when two minimum-count solutions exist', () => {
    expect(calculatePlateLoad(80, 20)?.plates).toEqual([{ weightKg: 20, count: 1 }, { weightKg: 10, count: 1 }]);
  });

  it('handles large targets without a target-sized loop or array', () => {
    expect(calculatePlateLoad(1_000_000_020, 20)).toMatchObject({
      plates: [{ weightKg: 20, count: 25_000_000 }], totalKg: 1_000_000_020, differenceKg: 0,
    });
  });
});
