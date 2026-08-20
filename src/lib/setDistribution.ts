import { ExerciseEntry, WorkoutLog } from '../types';
import { getRTSMultiplier, isValidRPE } from './rpeMath';
import { roundToNearest25 } from './weightMath';
import { extractSetPerformanceEvidence } from './progressionEvidence';

export type FatiguePriorProfile = 'hypertrophy' | 'strength_normal' | 'strength_post_test';

export interface SessionAnchor {
  algorithmId?: 'hypertrophy_linear' | 'hypertrophy_step' | 'strength_undulating' | 'strength_linear' | 'none';
  profileType: FatiguePriorProfile;
  baselineE1RM: number;                       // Unrounded baseline capacity (e.g. 147.0588)
  rawAnchorWeight: number;                    // Unrounded weekly algorithm weight output
  roundedAnchorWeight: number;                // Implementable load lifted in Set 1 (e.g. 147.5 or 120.0)
  anchorReps: number;                         // Prescribed reps for Set 1
  anchorRPE: number;                          // Prescribed RPE for Set 1
  workingSetCount: number;                    // Non-negative safe integer (1..6 supported for target generation)
  movementCategory?: ExerciseEntry['movementCategory']; // 'compound' | 'isolation'
  equipment?: ExerciseEntry['equipment'];               // 'freeweight' | 'machine'
  modality?: ExerciseEntry['modality'];
  isSkipped?: boolean | null;
}

export interface GeneratedWorkingSetTarget {
  workingSetOrdinal: number; // 1..6
  reps: number;
  rpe: number;
  weight: number;            // Final load rounded to nearest 2.5 kg
}

export interface ObservedSessionRatio {
  logId: string;
  date: string;
  ratiosByOrdinal: Record<number, number>; // workingSetOrdinal (1..6) -> e1RM_i / e1RM_1 clamped to [0.70, 1.00]
}

export interface LearnedFatigueRatio {
  ordinal: number;           // 1..6
  priorRatio: number;
  observedMedian: number | null;
  sampleCount: number;       // 0..3
  alpha: number;             // 0.00, 0.33, 0.66, 1.00
  blendedRatio: number;      // Final non-increasing ratio F_i
  status: 'prior_only' | 'blended' | 'fully_learned';
}

export type DistributionBypassReason =
  | 'skipped_exercise'
  | 'unsupported_modality'
  | 'invalid_anchor_inputs'
  | 'invalid_profile_configuration'
  | 'zero_working_sets';

export interface MultiSetDistributionResult {
  isBypassed: boolean;
  bypassReason?: DistributionBypassReason;
  targets: GeneratedWorkingSetTarget[]; // Generated targets for ordinals 1..min(workingSetCount, 6)
  unsupportedOrdinalRange: { from: number; to: number } | null; // Ordinals > 6 (must be preserved untouched in Phase 2A-3)
  learnedRatios: LearnedFatigueRatio[]; // Diagnostic metadata
}

/**
 * Validates whether a runtime string is a supported FatiguePriorProfile.
 */
export function isValidFatiguePriorProfile(profile: any): profile is FatiguePriorProfile {
  return profile === 'hypertrophy' || profile === 'strength_normal' || profile === 'strength_post_test';
}

/**
 * Returns the transparent default software fatigue prior array for a given profile.
 * Length is 6 (indices 0..5 corresponding to ordinals 1..6).
 */
export function getFatiguePrior(profile: FatiguePriorProfile): number[] {
  switch (profile) {
    case 'hypertrophy':
      return [1.000, 0.975, 0.950, 0.925, 0.900, 0.875];
    case 'strength_normal':
      return [1.000, 0.980, 0.960, 0.940, 0.920, 0.900];
    case 'strength_post_test':
      return [1.000, 0.950, 0.920, 0.895, 0.875, 0.855];
  }
}

/**
 * Extracts observed fatigue ratios from historical workout logs for a specific exercise and profile.
 * 
 * Rules:
 * 1. Normalized exercise name match (case-insensitive, trimmed).
 * 2. Profile classification strictly from historical log.objective:
 *    - 'Hypertrophy' -> hypertrophy
 *    - 'Strength' with Working Set 1 reps === 1 && rpe >= 9.5 -> strength_post_test
 *    - 'Strength' other -> strength_normal
 *    - 'Off', 'Deload', undefined, unrecognized -> excluded
 * 3. Exercise must not be skipped and modality must be 'weighted' or undefined.
 * 4. Filter out isWarmup === true to establish working-set ordinals (1-based).
 * 5. Working Set 1 must have isCompleted === true, valid weight (>0), integer reps (>=1),
 *    valid RPE (6.0..10.0), form !== 'loose', not a drop-set, and empty/null dropSubSets.
 *    If Working Set 1 fails, the session is discarded.
 * 6. Sets 2..6 are extracted if they meet the same validity requirements.
 * 7. Returns up to 3 most recent sessions (sorted by date descending, tie-break by log ID).
 */
export function extractObservedFatigueRatios(
  exerciseName: string,
  logs: WorkoutLog[],
  profile: FatiguePriorProfile
): ObservedSessionRatio[] {
  if (!exerciseName || !exerciseName.trim() || !Array.isArray(logs) || !isValidFatiguePriorProfile(profile)) {
    return [];
  }

  const normalizedTarget = exerciseName.trim().toLowerCase();
  const eligibleSessions: ObservedSessionRatio[] = [];

  for (const log of logs) {
    if (!log || typeof log !== 'object') continue;
    if (!log.date || isNaN(new Date(log.date).getTime())) continue;

    // Strict objective-based classification
    if (log.objective !== 'Hypertrophy' && log.objective !== 'Strength') {
      continue;
    }

    if (!Array.isArray(log.exercises)) continue;

    for (const ex of log.exercises) {
      if (!ex || typeof ex !== 'object') continue;
      if (!ex.name || ex.name.trim().toLowerCase() !== normalizedTarget) continue;
      if (ex.isSkipped === true) continue;
      if (
        ex.modality !== undefined &&
        ex.modality !== 'weighted' &&
        ex.modality !== 'bodyweight' &&
        ex.modality !== 'assisted'
      ) {
        continue;
      }
      if (!Array.isArray(ex.sets)) continue;

      // 1. Filter out warm-up rows to establish immutable working-set ordinals
      const nonWarmupSets = ex.sets.filter((s) => s && s.isWarmup !== true);
      if (nonWarmupSets.length === 0) continue;

      // 2. Validate Working Set 1
      const set1 = nonWarmupSets[0];
      if (set1.isCompleted !== true) {
        // Working Set 1 must be explicitly completed (provenance gating)
        continue;
      }

      const logUnit = log.unit || 'kg';
      const evidence1 = extractSetPerformanceEvidence({
        context: 'historical',
        modality: ex.modality,
        set: set1,
        bodyweightSnapshot: log.bodyweightSnapshot,
        targetUnit: logUnit,
        sourceUnit: logUnit,
        exerciseIsSkipped: ex.isSkipped,
      });

      if (evidence1.status !== 'valid' || evidence1.rpe === null) {
        // Working Set 1 is invalid or lacks explicit valid RPE -> entire session is dropped
        continue;
      }

      // Check profile match for Strength peak single vs normal
      if (log.objective === 'Strength') {
        const isPeakSingle = evidence1.reps === 1 && evidence1.rpe >= 9.5;
        if (profile === 'strength_post_test' && !isPeakSingle) continue;
        if (profile === 'strength_normal' && isPeakSingle) continue;
        if (profile === 'hypertrophy') continue;
      } else if (log.objective === 'Hypertrophy') {
        if (profile !== 'hypertrophy') continue;
      }

      const e1RM_1 = evidence1.e1RM;
      if (!e1RM_1 || !Number.isFinite(e1RM_1) || e1RM_1 <= 0) continue;

      const ratiosByOrdinal: Record<number, number> = { 1: 1.000 };

      // 3. Process Working Sets 2..min(length, 6)
      const maxOrdinals = Math.min(nonWarmupSets.length, 6);
      for (let ord = 2; ord <= maxOrdinals; ord++) {
        const s = nonWarmupSets[ord - 1];
        if (s.isSkipped === true) {
          // Contiguous suffix: stop learning further ratios at the first skipped set
          break;
        }
        if (s.isCompleted === true) {
          const evidence_i = extractSetPerformanceEvidence({
            context: 'historical',
            modality: ex.modality,
            set: s,
            bodyweightSnapshot: log.bodyweightSnapshot,
            targetUnit: logUnit,
            sourceUnit: logUnit,
            exerciseIsSkipped: ex.isSkipped,
          });

          if (evidence_i.status === 'valid' && evidence_i.rpe !== null) {
            const e1RM_i = evidence_i.e1RM;
            if (e1RM_i && Number.isFinite(e1RM_i) && e1RM_i > 0) {
              const rawRatio = e1RM_i / e1RM_1;
              const clampedRatio = Math.max(0.70, Math.min(1.00, rawRatio));
              ratiosByOrdinal[ord] = clampedRatio;
            }
          }
        }
      }

      eligibleSessions.push({
        logId: log.id,
        date: log.date,
        ratiosByOrdinal,
      });

      // An exercise appears at most once per workout log
      break;
    }
  }

  // Sort chronological descending by date, tie-break by logId descending
  eligibleSessions.sort((a, b) => {
    const timeA = new Date(a.date).getTime();
    const timeB = new Date(b.date).getTime();
    if (timeA !== timeB) {
      return timeB - timeA;
    }
    return (b.logId || '').localeCompare(a.logId || '');
  });

  // Take up to 3 most recent eligible sessions
  return eligibleSessions.slice(0, 3);
}

/**
 * Computes learned fatigue ratios by blending default software priors with
 * observed session ratios across the 3 most recent eligible sessions.
 * Defensively slices input to at most 3 sessions even when called directly.
 */
export function computeLearnedFatigueRatios(
  priors: number[],
  observedSessions: ObservedSessionRatio[] = []
): LearnedFatigueRatio[] {
  const result: LearnedFatigueRatio[] = [];
  const safePriors = Array.isArray(priors) ? priors : [];
  const recentSessions = Array.isArray(observedSessions) ? observedSessions.slice(0, 3) : [];

  for (let ordinal = 1; ordinal <= 6; ordinal++) {
    const priorRatio = safePriors[ordinal - 1] ?? 1.0;

    if (ordinal === 1) {
      result.push({
        ordinal: 1,
        priorRatio: 1.000,
        observedMedian: 1.000,
        sampleCount: recentSessions.length,
        alpha: recentSessions.length >= 3 ? 1.00 : recentSessions.length === 2 ? 0.66 : recentSessions.length === 1 ? 0.33 : 0.00,
        blendedRatio: 1.000,
        status: recentSessions.length >= 3 ? 'fully_learned' : recentSessions.length > 0 ? 'blended' : 'prior_only',
      });
      continue;
    }

    // Collect valid observations for this specific ordinal from recentSessions (at most 3)
    const samples: number[] = [];
    for (const session of recentSessions) {
      if (session && session.ratiosByOrdinal && typeof session.ratiosByOrdinal[ordinal] === 'number') {
        samples.push(session.ratiosByOrdinal[ordinal]);
      }
    }

    const sampleCount = samples.length;
    let observedMedian: number | null = null;
    let alpha = 0.00;

    if (sampleCount === 1) {
      observedMedian = samples[0];
      alpha = 0.33;
    } else if (sampleCount === 2) {
      observedMedian = (samples[0] + samples[1]) / 2;
      alpha = 0.66;
    } else if (sampleCount >= 3) {
      const sorted = [...samples].sort((a, b) => a - b);
      observedMedian = sorted[1]; // middle element of 3 items
      alpha = 1.00;
    }

    let blendedRatio = priorRatio;
    if (observedMedian !== null && alpha > 0) {
      blendedRatio = (1 - alpha) * priorRatio + alpha * observedMedian;
    }

    // Monotonicity enforcement with previous ordinal
    const prevBlended = result[ordinal - 2]?.blendedRatio ?? 1.000;
    blendedRatio = Math.min(blendedRatio, prevBlended);
    blendedRatio = Math.max(0.70, Math.min(1.00, blendedRatio));

    result.push({
      ordinal,
      priorRatio,
      observedMedian,
      sampleCount,
      alpha,
      blendedRatio,
      status: sampleCount >= 3 ? 'fully_learned' : sampleCount > 0 ? 'blended' : 'prior_only',
    });
  }

  return result;
}

/**
 * Validates baseline anchor parameters required for all specialized distributions.
 */
function validateAnchorBaseline(anchor: SessionAnchor): boolean {
  if (!anchor || typeof anchor !== 'object') return false;
  if (typeof anchor.baselineE1RM !== 'number' || !Number.isFinite(anchor.baselineE1RM) || anchor.baselineE1RM <= 0) return false;
  if (typeof anchor.rawAnchorWeight !== 'number' || !Number.isFinite(anchor.rawAnchorWeight) || anchor.rawAnchorWeight <= 0) return false;
  if (typeof anchor.roundedAnchorWeight !== 'number' || !Number.isFinite(anchor.roundedAnchorWeight) || anchor.roundedAnchorWeight <= 0) return false;
  if (typeof anchor.anchorReps !== 'number' || !Number.isSafeInteger(anchor.anchorReps) || anchor.anchorReps < 1) return false;
  if (typeof anchor.anchorRPE !== 'number' || !isValidRPE(anchor.anchorRPE)) return false;
  if (typeof anchor.workingSetCount !== 'number' || !Number.isSafeInteger(anchor.workingSetCount) || anchor.workingSetCount < 0) return false;
  return true;
}

/**
 * Distributes hypertrophy working sets across ordinals 1..min(workingSetCount, 6).
 * Returns null if inputs are invalid or required multipliers are null/non-positive.
 */
export function distributeHypertrophySets(
  anchor: SessionAnchor,
  fatigueRatios: number[]
): GeneratedWorkingSetTarget[] | null {
  if (!validateAnchorBaseline(anchor) || !Array.isArray(fatigueRatios)) {
    return null;
  }

  const targets: GeneratedWorkingSetTarget[] = [];
  const count = Math.min(anchor.workingSetCount, 6);
  if (count === 0) return targets;

  // Set 1: Authoritative preservation
  targets.push({
    workingSetOrdinal: 1,
    reps: anchor.anchorReps,
    rpe: anchor.anchorRPE,
    weight: anchor.roundedAnchorWeight,
  });

  if (count === 1) return targets;

  const isIsolation = anchor.movementCategory === 'isolation';
  const rpeCeiling = isIsolation ? 9.5 : 9.0;
  const repFloor = isIsolation ? 8 : 5;

  let prevWeight = anchor.roundedAnchorWeight;
  let prevReps = anchor.anchorReps;

  for (let ord = 2; ord <= count; ord++) {
    const F_i = fatigueRatios[ord - 1];
    if (typeof F_i !== 'number' || !Number.isFinite(F_i) || F_i <= 0) {
      return null;
    }
    const capacity_i = anchor.baselineE1RM * F_i;
    const targetRPE_i = Math.min(anchor.anchorRPE + 0.5 * (ord - 1), rpeCeiling);

    const repMin = Math.min(anchor.anchorReps, Math.max(anchor.anchorReps - 3, repFloor));
    const repMax = prevReps;

    const fixedLoad = anchor.roundedAnchorWeight;
    const requiredMultiplier = fixedLoad / capacity_i;

    // Search for feasible integer reps in [repMin, repMax] with fixed load
    let chosenReps: number | null = null;
    let minDiff = Infinity;
    const EPSILON = 1e-6; // Handle floating point comparison

    for (let r = repMax; r >= repMin; r--) {
      const candidateMultiplier = getRTSMultiplier(r, targetRPE_i);
      if (candidateMultiplier !== null && candidateMultiplier > 0 && candidateMultiplier + EPSILON >= requiredMultiplier) {
        const diff = candidateMultiplier - requiredMultiplier;
        if (diff >= -EPSILON && diff < minDiff) {
          minDiff = diff;
          chosenReps = r;
        }
      }
    }

    if (chosenReps !== null) {
      // Feasible at fixed load
      targets.push({
        workingSetOrdinal: ord,
        reps: chosenReps,
        rpe: targetRPE_i,
        weight: fixedLoad,
      });
      prevWeight = fixedLoad;
      prevReps = chosenReps;
    } else {
      // Fallback: drop load at repMin
      const fallbackMultiplier = getRTSMultiplier(repMin, targetRPE_i);
      if (fallbackMultiplier === null || !Number.isFinite(fallbackMultiplier) || fallbackMultiplier <= 0) {
        return null;
      }
      const rawWeight = capacity_i * fallbackMultiplier;
      let roundedWeight = roundToNearest25(rawWeight);
      roundedWeight = Math.min(roundedWeight, prevWeight);

      if (!Number.isFinite(roundedWeight) || roundedWeight <= 0) {
        return null;
      }

      targets.push({
        workingSetOrdinal: ord,
        reps: repMin,
        rpe: targetRPE_i,
        weight: roundedWeight,
      });
      prevWeight = roundedWeight;
      prevReps = repMin;
    }
  }

  return targets;
}

/**
 * Distributes normal strength working sets across ordinals 1..min(workingSetCount, 6).
 * Returns null if inputs are invalid or required multipliers are null/non-positive.
 */
export function distributeStrengthSets(
  anchor: SessionAnchor,
  fatigueRatios: number[]
): GeneratedWorkingSetTarget[] | null {
  if (!validateAnchorBaseline(anchor) || !Array.isArray(fatigueRatios)) {
    return null;
  }
  // Normal strength must not be called for peak single (1 rep @ >= 9.5)
  if (anchor.anchorReps === 1 && anchor.anchorRPE >= 9.5) {
    return null;
  }

  const targets: GeneratedWorkingSetTarget[] = [];
  const count = Math.min(anchor.workingSetCount, 6);
  if (count === 0) return targets;

  // Set 1: Authoritative preservation
  targets.push({
    workingSetOrdinal: 1,
    reps: anchor.anchorReps,
    rpe: anchor.anchorRPE,
    weight: anchor.roundedAnchorWeight,
  });

  if (count === 1) return targets;

  const backoffBaseRPE = Math.max(6.0, Math.min(8.0, anchor.anchorRPE - 1.0));
  let prevWeight = anchor.roundedAnchorWeight;

  for (let ord = 2; ord <= count; ord++) {
    const F_i = fatigueRatios[ord - 1];
    if (typeof F_i !== 'number' || !Number.isFinite(F_i) || F_i <= 0) {
      return null;
    }
    const targetRPE_i = Math.min(anchor.anchorRPE, 8.5, backoffBaseRPE + 0.5 * (ord - 2));
    const multiplier = getRTSMultiplier(anchor.anchorReps, targetRPE_i);
    if (multiplier === null || !Number.isFinite(multiplier) || multiplier <= 0) {
      return null;
    }

    const rawWeight = anchor.baselineE1RM * F_i * multiplier;
    let roundedWeight = roundToNearest25(rawWeight);
    roundedWeight = Math.min(roundedWeight, prevWeight);

    if (!Number.isFinite(roundedWeight) || roundedWeight <= 0) {
      return null;
    }

    targets.push({
      workingSetOrdinal: ord,
      reps: anchor.anchorReps,
      rpe: targetRPE_i,
      weight: roundedWeight,
    });
    prevWeight = roundedWeight;
  }

  return targets;
}

/**
 * Distributes post-test-single strength working sets across ordinals 1..min(workingSetCount, 6).
 * Preserves the single @ anchor.anchorRPE and generates safe back-off triples.
 * Returns null if inputs are invalid, not a peak single, or required multipliers are null/non-positive.
 */
export function distributePeakSingleStrengthSets(
  anchor: SessionAnchor,
  fatigueRatios: number[]
): GeneratedWorkingSetTarget[] | null {
  if (!validateAnchorBaseline(anchor) || !Array.isArray(fatigueRatios)) {
    return null;
  }
  // Strict peak-single guard
  if (anchor.anchorReps !== 1 || anchor.anchorRPE < 9.5) {
    return null;
  }

  const targets: GeneratedWorkingSetTarget[] = [];
  const count = Math.min(anchor.workingSetCount, 6);
  if (count === 0) return targets;

  // Set 1: Preserved peak single using anchor.anchorReps literally
  targets.push({
    workingSetOrdinal: 1,
    reps: anchor.anchorReps,
    rpe: anchor.anchorRPE,
    weight: anchor.roundedAnchorWeight,
  });

  if (count === 1) return targets;

  // Predefined safe back-off RPE schedule for triples:
  // Set 2: @7.5, Set 3: @8.0, Set 4: @8.0, Set 5: @8.5, Set 6: @8.5
  const backoffRPESchedule = [7.5, 8.0, 8.0, 8.5, 8.5];
  let prevWeight = anchor.roundedAnchorWeight;

  for (let ord = 2; ord <= count; ord++) {
    const F_i = fatigueRatios[ord - 1];
    if (typeof F_i !== 'number' || !Number.isFinite(F_i) || F_i <= 0) {
      return null;
    }
    const targetRPE_i = backoffRPESchedule[ord - 2] ?? 8.5;
    const multiplier = getRTSMultiplier(3, targetRPE_i);
    if (multiplier === null || !Number.isFinite(multiplier) || multiplier <= 0) {
      return null;
    }

    // Strictly uses unrounded baselineE1RM
    const capacity_i = anchor.baselineE1RM * F_i;
    const rawWeight = capacity_i * multiplier;
    let roundedWeight = roundToNearest25(rawWeight);
    roundedWeight = Math.min(roundedWeight, prevWeight);

    if (!Number.isFinite(roundedWeight) || roundedWeight <= 0) {
      return null;
    }

    targets.push({
      workingSetOrdinal: ord,
      reps: 3,
      rpe: targetRPE_i,
      weight: roundedWeight,
    });
    prevWeight = roundedWeight;
  }

  return targets;
}

/**
 * Pure top-level multi-set distribution function.
 * 
 * Validates inputs, determines bypasses, learns personalized ratios from history,
 * and generates pure target prescriptions for working sets 1..min(workingSetCount, 6).
 */
export function distributeMultiSetTargets(
  anchor: SessionAnchor,
  exerciseName: string,
  historicalLogs: WorkoutLog[] = []
): MultiSetDistributionResult {
  // 1. Skipped exercise bypass
  if (anchor?.isSkipped === true) {
    return {
      isBypassed: true,
      bypassReason: 'skipped_exercise',
      targets: [],
      unsupportedOrdinalRange: null,
      learnedRatios: [],
    };
  }

  // 2. Modality bypass
  if (
    anchor?.modality === 'bodyweight' ||
    anchor?.modality === 'assisted' ||
    anchor?.modality === 'timed' ||
    anchor?.modality === 'distance' ||
    anchor?.modality === 'distance_loaded'
  ) {
    return {
      isBypassed: true,
      bypassReason: 'unsupported_modality',
      targets: [],
      unsupportedOrdinalRange: null,
      learnedRatios: [],
    };
  }

  // 3. Validation guardrails on anchor inputs
  if (
    !anchor ||
    typeof anchor !== 'object' ||
    typeof anchor.baselineE1RM !== 'number' ||
    !Number.isFinite(anchor.baselineE1RM) ||
    anchor.baselineE1RM <= 0 ||
    typeof anchor.rawAnchorWeight !== 'number' ||
    !Number.isFinite(anchor.rawAnchorWeight) ||
    anchor.rawAnchorWeight <= 0 ||
    typeof anchor.roundedAnchorWeight !== 'number' ||
    !Number.isFinite(anchor.roundedAnchorWeight) ||
    anchor.roundedAnchorWeight <= 0 ||
    typeof anchor.anchorReps !== 'number' ||
    !Number.isSafeInteger(anchor.anchorReps) ||
    anchor.anchorReps < 1 ||
    typeof anchor.anchorRPE !== 'number' ||
    !isValidRPE(anchor.anchorRPE) ||
    typeof anchor.workingSetCount !== 'number' ||
    !Number.isSafeInteger(anchor.workingSetCount) ||
    anchor.workingSetCount < 0
  ) {
    return {
      isBypassed: true,
      bypassReason: 'invalid_anchor_inputs',
      targets: [],
      unsupportedOrdinalRange: null,
      learnedRatios: [],
    };
  }

  // 4. Runtime profile and algorithm configuration validation
  if (!isValidFatiguePriorProfile(anchor.profileType)) {
    return {
      isBypassed: true,
      bypassReason: 'invalid_profile_configuration',
      targets: [],
      unsupportedOrdinalRange: null,
      learnedRatios: [],
    };
  }

  // Profile-anchor consistency
  if (anchor.profileType === 'strength_post_test') {
    if (anchor.anchorReps !== 1 || anchor.anchorRPE < 9.5) {
      return {
        isBypassed: true,
        bypassReason: 'invalid_profile_configuration',
        targets: [],
        unsupportedOrdinalRange: null,
        learnedRatios: [],
      };
    }
  } else if (anchor.profileType === 'strength_normal') {
    if (anchor.anchorReps === 1 && anchor.anchorRPE >= 9.5) {
      return {
        isBypassed: true,
        bypassReason: 'invalid_profile_configuration',
        targets: [],
        unsupportedOrdinalRange: null,
        learnedRatios: [],
      };
    }
  }

  // Algorithm ID consistency when present
  if (anchor.algorithmId !== undefined) {
    if (anchor.algorithmId === 'none') {
      return {
        isBypassed: true,
        bypassReason: 'invalid_profile_configuration',
        targets: [],
        unsupportedOrdinalRange: null,
        learnedRatios: [],
      };
    }
    if (anchor.algorithmId === 'hypertrophy_linear' || anchor.algorithmId === 'hypertrophy_step') {
      if (anchor.profileType !== 'hypertrophy') {
        return {
          isBypassed: true,
          bypassReason: 'invalid_profile_configuration',
          targets: [],
          unsupportedOrdinalRange: null,
          learnedRatios: [],
        };
      }
    } else if (anchor.algorithmId === 'strength_undulating' || anchor.algorithmId === 'strength_linear') {
      if (anchor.profileType !== 'strength_normal' && anchor.profileType !== 'strength_post_test') {
        return {
          isBypassed: true,
          bypassReason: 'invalid_profile_configuration',
          targets: [],
          unsupportedOrdinalRange: null,
          learnedRatios: [],
        };
      }
    } else {
      // Unknown algorithm string
      return {
        isBypassed: true,
        bypassReason: 'invalid_profile_configuration',
        targets: [],
        unsupportedOrdinalRange: null,
        learnedRatios: [],
      };
    }
  }

  // 5. Zero working sets bypass
  if (anchor.workingSetCount === 0) {
    return {
      isBypassed: true,
      bypassReason: 'zero_working_sets',
      targets: [],
      unsupportedOrdinalRange: null,
      learnedRatios: [],
    };
  }

  // Bounded unsupported ordinal range representation (no memory allocation)
  const unsupportedOrdinalRange =
    anchor.workingSetCount > 6 ? { from: 7, to: anchor.workingSetCount } : null;

  // 6. Extract historical fatigue observations and compute learned ratios
  const priors = getFatiguePrior(anchor.profileType);
  const observedSessions = extractObservedFatigueRatios(exerciseName, historicalLogs, anchor.profileType);
  const learnedRatios = computeLearnedFatigueRatios(priors, observedSessions);
  const ratioScalars = learnedRatios.map((lr) => lr.blendedRatio);

  // 7. Generate distributed targets according to profile type
  let rawTargets: GeneratedWorkingSetTarget[] | null = null;
  if (anchor.profileType === 'hypertrophy') {
    rawTargets = distributeHypertrophySets(anchor, ratioScalars);
  } else if (anchor.profileType === 'strength_post_test') {
    rawTargets = distributePeakSingleStrengthSets(anchor, ratioScalars);
  } else if (anchor.profileType === 'strength_normal') {
    rawTargets = distributeStrengthSets(anchor, ratioScalars);
  }

  if (rawTargets === null) {
    return {
      isBypassed: true,
      bypassReason: 'invalid_anchor_inputs',
      targets: [],
      unsupportedOrdinalRange,
      learnedRatios,
    };
  }

  // 8. Strict post-validation on generated target objects
  const expectedCount = Math.min(anchor.workingSetCount, 6);
  if (rawTargets.length !== expectedCount) {
    return {
      isBypassed: true,
      bypassReason: 'invalid_anchor_inputs',
      targets: [],
      unsupportedOrdinalRange,
      learnedRatios,
    };
  }

  const validTargets: GeneratedWorkingSetTarget[] = [];
  for (let i = 0; i < rawTargets.length; i++) {
    const t = rawTargets[i];
    const expectedOrdinal = i + 1;

    if (
      !t ||
      typeof t !== 'object' ||
      t.workingSetOrdinal !== expectedOrdinal ||
      !Number.isSafeInteger(t.workingSetOrdinal) ||
      t.workingSetOrdinal < 1 ||
      t.workingSetOrdinal > 6 ||
      typeof t.reps !== 'number' ||
      !Number.isSafeInteger(t.reps) ||
      t.reps < 1 ||
      typeof t.rpe !== 'number' ||
      !isValidRPE(t.rpe) ||
      t.rpe < 6.0 ||
      t.rpe > 10.0 ||
      typeof t.weight !== 'number' ||
      !Number.isFinite(t.weight) ||
      t.weight <= 0
    ) {
      return {
        isBypassed: true,
        bypassReason: 'invalid_anchor_inputs',
        targets: [],
        unsupportedOrdinalRange,
        learnedRatios,
      };
    }

    // Verify weight is a valid nearest-2.5 increment within floating point tolerance
    const rem = (t.weight / 2.5) % 1;
    const isIncrement25 = Math.abs(rem) < 1e-5 || Math.abs(rem - 1) < 1e-5;
    if (!isIncrement25) {
      return {
        isBypassed: true,
        bypassReason: 'invalid_anchor_inputs',
        targets: [],
        unsupportedOrdinalRange,
        learnedRatios,
      };
    }

    // Enforce pure 4-property shape
    validTargets.push({
      workingSetOrdinal: t.workingSetOrdinal,
      reps: t.reps,
      rpe: t.rpe,
      weight: t.weight,
    });
  }

  return {
    isBypassed: false,
    targets: validTargets,
    unsupportedOrdinalRange,
    learnedRatios,
  };
}
