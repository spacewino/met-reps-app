/** Plate sizes are in kg; each plate is loaded symmetrically on both sides. */
export const PLATE_WEIGHTS_KG = [20, 15, 10, 5, 2.5, 1.25] as const;
export const BAR_WEIGHTS_KG = [20, 15, 10] as const;
export type BarWeightKg = typeof BAR_WEIGHTS_KG[number];

export interface PlateLoad {
  plates: { weightKg: typeof PLATE_WEIGHTS_KG[number]; count: number }[];
  perSideKg: number;
  totalKg: number;
  differenceKg: number;
}

/**
 * Find the closest total, preferring the lower total on a tie, then use the
 * fewest plates per side. Equal-count solutions favour larger plates.
 * Counts are unlimited; collars are not included in the bar weight.
 */
export function calculatePlateLoad(targetKg: number, barKg: BarWeightKg): PlateLoad | null {
  if (!Number.isFinite(targetKg) || targetKg < 0 || !BAR_WEIGHTS_KG.includes(barKg)) return null;
  // A symmetric pair of the smallest plates adds 2.5 kg to the total.
  const requestedPairs = Math.max(0, (targetKg - barKg) / 2.5);
  const lower = Math.floor(requestedPairs);
  const tolerance = Number.EPSILON * Math.max(1, requestedPairs) * 4;
  const pairs = requestedPairs - lower > 0.5 + tolerance ? lower + 1 : lower;
  if (!Number.isSafeInteger(pairs)) return null;

  // In 1.25 kg units, every optimal solution has at most three 15 kg
  // plates: four can be replaced by three 20 kg plates. For each possible
  // count, the other denominations are powers of two, so greedy is optimal.
  let bestCounts: number[] | null = null;
  let bestCount = Infinity;
  for (let fifteens = 0; fifteens <= Math.min(3, Math.floor(pairs / 12)); fifteens++) {
    let remaining = pairs - fifteens * 12;
    const counts = PLATE_WEIGHTS_KG.map(weight => {
      if (weight === 15) return fifteens;
      const units = weight / 1.25;
      const count = Math.floor(remaining / units);
      remaining -= count * units;
      return count;
    });
    const count = counts.reduce((sum, value) => sum + value, 0);
    if (count < bestCount) {
      bestCounts = counts;
      bestCount = count;
    }
  }
  const totalKg = barKg + pairs * 2.5;
  return {
    plates: PLATE_WEIGHTS_KG.flatMap((weightKg, i) => bestCounts![i] ? [{ weightKg, count: bestCounts![i] }] : []),
    perSideKg: pairs * 1.25,
    totalKg,
    differenceKg: totalKg - targetKg,
  };
}
