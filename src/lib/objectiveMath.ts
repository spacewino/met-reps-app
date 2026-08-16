import { ExerciseEntry, SetEntry, WorkoutLog } from '../types';
import { getExerciseClassification } from './exerciseClassification';
import {
  DEFAULT_RTS_STYLE_PERCENT_1RM,
  isValidRPE,
  roundRPEToHalfStep,
  getRTSMultiplier as rpeMathGetRTSMultiplier,
  calculateE1RMForSet as rpeMathCalculateE1RMForSet,
} from './rpeMath';
import { roundToNearest25 } from './weightMath';
import {
  distributeMultiSetTargets,
  SessionAnchor,
  FatiguePriorProfile,
  MultiSetDistributionResult,
  GeneratedWorkingSetTarget,
} from './setDistribution';

// Re-export roundToNearest25 for backward compatibility with existing imports
export { roundToNearest25 } from './weightMath';

// Export RTS_RPE_PERCENT as an alias to DEFAULT_RTS_STYLE_PERCENT_1RM for compatibility
export const RTS_RPE_PERCENT = DEFAULT_RTS_STYLE_PERCENT_1RM;

interface StrengthProfileWeek {
  reps: number;
  target1RMPercent: number;
  targetRPE: number;
}

const STRENGTH_PROFILES: Record<number, Record<number, StrengthProfileWeek>> = {
  4: {
    1: { reps: 5, target1RMPercent: 0.786, targetRPE: 7.0 },
    2: { reps: 4, target1RMPercent: 0.85, targetRPE: 8.0 },
    3: { reps: 3, target1RMPercent: 0.92, targetRPE: 9.0 },
    4: { reps: 1, target1RMPercent: 1.00, targetRPE: 10.0 },
  },
  8: {
    1: { reps: 5, target1RMPercent: 0.786, targetRPE: 7.0 },
    2: { reps: 5, target1RMPercent: 0.815, targetRPE: 8.0 },
    3: { reps: 5, target1RMPercent: 0.85, targetRPE: 9.0 },
    4: { reps: 3, target1RMPercent: 0.80, targetRPE: 7.5 },
    5: { reps: 3, target1RMPercent: 0.88, targetRPE: 8.5 },
    6: { reps: 2, target1RMPercent: 0.84, targetRPE: 8.0 },
    7: { reps: 2, target1RMPercent: 0.92, targetRPE: 9.0 },
    8: { reps: 1, target1RMPercent: 1.00, targetRPE: 10.0 },
  },
  12: {
    1: { reps: 5, target1RMPercent: 0.786, targetRPE: 7.0 },
    2: { reps: 5, target1RMPercent: 0.815, targetRPE: 8.0 },
    3: { reps: 5, target1RMPercent: 0.84, targetRPE: 8.5 },
    4: { reps: 5, target1RMPercent: 0.86, targetRPE: 9.0 },
    5: { reps: 3, target1RMPercent: 0.80, targetRPE: 7.5 },
    6: { reps: 3, target1RMPercent: 0.85, targetRPE: 8.0 },
    7: { reps: 3, target1RMPercent: 0.90, targetRPE: 9.0 },
    8: { reps: 2, target1RMPercent: 0.84, targetRPE: 8.0 },
    9: { reps: 2, target1RMPercent: 0.89, targetRPE: 8.5 },
    10: { reps: 2, target1RMPercent: 0.94, targetRPE: 9.5 },
    11: { reps: 1, target1RMPercent: 0.96, targetRPE: 9.0 },
    12: { reps: 1, target1RMPercent: 1.00, targetRPE: 10.0 },
  }
};

/**
 * Resolves the weekly strength undulating profile:
 * - 4-week duration: defined 4-week profile
 * - 8-week duration or undefined: defined 8-week profile
 * - 12-week duration: defined 12-week profile
 * - Custom durations (e.g. 6, 10): 4-week profile with modulo wrapping
 */
export function getUndulatingProfileWeek(
  weekNum: number,
  programDuration?: number
): StrengthProfileWeek {
  // If undefined, default to 8-week defined profile
  if (programDuration === undefined || programDuration === null) {
    const profile = STRENGTH_PROFILES[8];
    const activeWeek = Math.max(1, Math.min(weekNum, 8));
    return profile[activeWeek] || profile[1];
  }

  // Defined durations: 4, 8, 12
  if (programDuration === 4 || programDuration === 8 || programDuration === 12) {
    const profile = STRENGTH_PROFILES[programDuration];
    const activeWeek = Math.max(1, Math.min(weekNum, programDuration));
    return profile[activeWeek] || profile[1];
  }

  // Custom durations (e.g. 6, 10): 4-week profile with modulo wrapping
  const maxWeek = Math.max(1, programDuration);
  const normalizedWeek = Math.max(1, Math.min(weekNum, maxWeek));
  const activeProfileWeek = ((normalizedWeek - 1) % 4) + 1;
  const fourWeekProfile = STRENGTH_PROFILES[4];
  return fourWeekProfile[activeProfileWeek] || fourWeekProfile[1];
}

/**
 * Helper to get the RTS multiplier percentage
 */
export function getRTSMultiplier(reps: number, rpe: number): number {
  const result = rpeMathGetRTSMultiplier(reps, rpe);
  if (result !== null) return result;
  // Fallback linear estimation if reps or rpe is invalid
  const rir = Math.max(0, 10 - rpe);
  return Math.max(0.1, 1 - (reps + rir) * 0.03);
}

/**
 * Normalizes an exercise name for case-insensitive matching.
 */
function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Extracts the user's historical baseline e1RM from previous workout logs using strict precedence:
 * 1. Match exercise names using normalized case-insensitive matching.
 * 2. Ignore skipped exercises.
 * 3. Ignore warm-up sets completely (isWarmup === true).
 * 4. Ignore sets with non-positive or invalid weight/reps.
 * 5. Collect valid sets with recorded RPE from 6.0 through 10.0.
 * 6. If any valid RPE-bearing sets exist, calculate their e1RM via rpeMath (weight / getRTSMultiplier)
 *    and select the maximum e1RM.
 * 7. If NO valid RPE-bearing sets exist, check completed working sets with missing RPE (null, undefined, 0)
 *    and calculate e1RM via pure reps-only Epley: weight * (1 + reps / 30).
 * 8. Explicitly recorded RPE below 6.0 or above 10.0 is excluded (never used).
 * 9. Never substitute RPE 8 for completed historical sets.
 * 10. Never fall back to warm-up sets.
 * Returns 0 if no valid historical baseline sets are found.
 */
export function extractHistoricalBaselineE1RM(
  exerciseName: string,
  logs: WorkoutLog[]
): number {
  if (!logs || logs.length === 0) return 0;

  const targetNorm = normalizeName(exerciseName);
  const rpeE1rms: number[] = [];
  const missingRpeE1rms: number[] = [];

  for (const log of logs) {
    if (!log.exercises) continue;
    for (const ex of log.exercises) {
      if (ex.isSkipped) continue;
      if (normalizeName(ex.name) !== targetNorm) continue;
      if (!ex.sets || ex.sets.length === 0) continue;

      for (const s of ex.sets) {
        // Exclude warmups from baseline without breaking working set sequence
        if (s.isWarmup) continue;

        // At the first working set with isSkipped === true, stop processing additional working sets for this exercise
        if (s.isSkipped === true) {
          break;
        }

        // Exclude explicitly uncompleted non-skipped sets from contributing evidence
        if (s.isCompleted === false) continue;

        const weight = s.weight;
        const reps = s.reps;
        if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) continue;
        if (typeof reps !== 'number' || !Number.isFinite(reps) || reps < 1 || !Number.isInteger(reps)) continue;

        const rpe = s.rpe;
        if (rpe === null || rpe === undefined || rpe === 0) {
          // Missing RPE candidate -> Reps-only Epley
          const e1rm = weight * (1 + reps / 30);
          missingRpeE1rms.push(e1rm);
        } else if (isValidRPE(rpe)) {
          // Valid RPE candidate -> rpeMath calculation
          const e1rm = rpeMathCalculateE1RMForSet(weight, reps, rpe);
          if (e1rm !== null && e1rm > 0) {
            rpeE1rms.push(e1rm);
          }
        }
        // Explicitly out-of-range RPE (< 6.0 or > 10.0) is completely excluded
      }
    }
  }

  // Tier 1: Valid RPE-bearing sets take highest precedence
  if (rpeE1rms.length > 0) {
    return Math.max(...rpeE1rms);
  }

  // Tier 2: Fallback to missing-RPE sets via pure Reps Epley
  if (missingRpeE1rms.length > 0) {
    return Math.max(...missingRpeE1rms);
  }

  return 0;
}

/**
 * Fetches the user's e1RM from previous workout logs.
 * Preserved for backwards compatibility, delegates to extractHistoricalBaselineE1RM.
 */
export function getPreviousE1RMForExercise(
  exerciseName: string,
  logs: WorkoutLog[]
): number {
  return extractHistoricalBaselineE1RM(exerciseName, logs);
}

/**
 * Calculates baseline e1RM from an immutable program template exercise.
 * Rules:
 * - Finds the first non-warm-up template set with positive weight and reps.
 * - If that template set has a valid RPE (6.0..10.0), calculates e1RM using that RPE.
 * - If that template set has missing RPE (null, undefined, 0), uses an explicit cold-start
 *   template assumption of RPE 8.0 (does not write it back into template/draft/logs).
 * - If that template set has explicitly invalid RPE (< 6.0 or > 10.0), rejects it (returns 0).
 * - Returns 0 if no valid template baseline set exists.
 */
export function extractTemplateBaselineE1RM(templateExercise?: ExerciseEntry): number {
  if (!templateExercise || !templateExercise.sets || templateExercise.sets.length === 0) {
    return 0;
  }

  const workingSet = templateExercise.sets.find(
    s => !s.isWarmup && typeof s.weight === 'number' && s.weight > 0 && typeof s.reps === 'number' && s.reps > 0
  );
  if (!workingSet || !workingSet.weight || !workingSet.reps) {
    return 0;
  }

  const weight = workingSet.weight;
  const reps = Math.round(workingSet.reps);
  const rpe = workingSet.rpe;

  if (rpe === null || rpe === undefined || rpe === 0) {
    // Explicit cold-start assumption of RPE 8.0 for pristine template defaults
    const multiplier = rpeMathGetRTSMultiplier(reps, 8.0);
    return multiplier ? weight / multiplier : 0;
  }

  if (isValidRPE(rpe)) {
    const e1rm = rpeMathCalculateE1RMForSet(weight, reps, rpe);
    return e1rm && e1rm > 0 ? e1rm : 0;
  }

  // Explicitly invalid RPE in template is rejected
  return 0;
}

/**
 * Safely finds a matching template exercise from program day templates:
 * 1. Inspects the template at activeIndex (if provided).
 * 2. Uses it only if its normalized exercise name matches the active exercise's normalized name (or matching stable ID if present).
 * 3. Otherwise searches the full day templates for a normalized-name match (or ID match).
 * 4. Returns undefined if no match exists.
 * 5. Never returns a differently named exercise merely because it occupies the same array index.
 */
export function findMatchingTemplateExercise(
  activeExercise: { name: string; id?: string } | ExerciseEntry,
  dayTemplates?: ExerciseEntry[] | null,
  activeIndex?: number
): ExerciseEntry | undefined {
  if (!dayTemplates || !dayTemplates.length || !activeExercise) {
    return undefined;
  }

  const rawActiveName = activeExercise.name || '';
  const activeName = rawActiveName.trim().toLowerCase();
  const activeId = (activeExercise as any).id;

  if (!activeName && !activeId) {
    return undefined;
  }

  // 1. Inspect template at same index first
  if (typeof activeIndex === 'number' && activeIndex >= 0 && activeIndex < dayTemplates.length) {
    const candidate = dayTemplates[activeIndex];
    if (candidate) {
      const candidateId = (candidate as any).id;
      if (activeId && candidateId && activeId === candidateId) {
        return candidate;
      }
      const candidateName = (candidate.name || '').trim().toLowerCase();
      if (candidateName && candidateName === activeName) {
        return candidate;
      }
    }
  }

  // 2. Search full day template: prefer ID match if available, then normalized name match
  if (activeId) {
    const idMatch = dayTemplates.find(t => (t as any).id === activeId);
    if (idMatch) return idMatch;
  }

  const nameMatch = dayTemplates.find(
    t => (t.name || '').trim().toLowerCase() === activeName
  );

  return nameMatch || undefined;
}

/**
 * Safely syncs an appended working set to a Program template's day exercises:
 * - Preserves the existing array order of dayTemplates.
 * - Preserves all existing template sets and their authored fields (weight, reps, rpe, comment, form, isWarmup, isDropSet, dropSubSets, etc.).
 * - Only increments the set count for the matching exercise by appending a sanitized structural SetEntry
 *   ({ setNumber, weight: 0, reps: 0, rpe: 8, form: 'standard' }).
 * - Never copies active generated targets, completion status, skipped status, session comments, or drop sets into the template.
 * - If no matching template exercise exists, leaves the dayTemplates unchanged.
 */
export function syncAddedSetStructureToProgramDay(
  dayTemplates: ExerciseEntry[],
  activeExercise: ExerciseEntry | { name: string; id?: string },
  activeExerciseIndex?: number
): ExerciseEntry[] {
  if (!dayTemplates || !dayTemplates.length || !activeExercise) {
    return dayTemplates || [];
  }

  const matched = findMatchingTemplateExercise(activeExercise, dayTemplates, activeExerciseIndex);
  if (!matched) {
    return dayTemplates;
  }

  return dayTemplates.map(t => {
    if (t !== matched) {
      return t;
    }

    const currentSets = t.sets || [];
    const nextSetNumber = currentSets.length + 1;
    const sanitizedNewSet: SetEntry = {
      setNumber: nextSetNumber,
      weight: 0,
      reps: 0,
      rpe: 8,
      form: 'standard',
    };

    return {
      ...t,
      sets: [
        ...currentSets.map(s => ({ ...s })),
        sanitizedNewSet,
      ],
    };
  });
}

/**
 * Resolves the effective algorithm ID following Policy B.
 */
function resolveEffectiveAlgorithm(
  objective: 'Off' | 'Hypertrophy' | 'Strength' | 'Deload',
  rawAlgorithmId?: string
): 'hypertrophy_linear' | 'hypertrophy_step' | 'strength_undulating' | 'strength_linear' | null {
  if (objective === 'Hypertrophy') {
    if (rawAlgorithmId === 'hypertrophy_linear' || rawAlgorithmId === 'hypertrophy_step') {
      return rawAlgorithmId;
    }
    if (rawAlgorithmId === undefined || rawAlgorithmId === 'none') {
      return 'hypertrophy_linear';
    }
    return null;
  }

  if (objective === 'Strength') {
    if (rawAlgorithmId === 'strength_undulating' || rawAlgorithmId === 'strength_linear') {
      return rawAlgorithmId;
    }
    if (rawAlgorithmId === undefined || rawAlgorithmId === 'none') {
      return 'strength_undulating';
    }
    return null;
  }

  return null;
}

/**
 * Computes warm-up set targets based on Set 1 working weight and reps.
 */
function calculateWarmupSetTarget(
  activeWIdx: number,
  warmupCount: number,
  workingTargetWeight: number,
  workingTargetReps: number
): { weight: number; reps: number; rpe: number } {
  let targetWeight = 0;
  let targetReps = workingTargetReps;
  let targetRPE = 4.0;

  if (workingTargetWeight > 0) {
    if (warmupCount === 1) {
      targetWeight = roundToNearest25(workingTargetWeight * 0.60);
      targetReps = workingTargetReps;
      targetRPE = 5.0;
    } else if (warmupCount === 2) {
      if (activeWIdx === 0) {
        targetWeight = roundToNearest25(workingTargetWeight * 0.50);
        targetReps = workingTargetReps;
        targetRPE = 4.0;
      } else {
        targetWeight = roundToNearest25(workingTargetWeight * 0.75);
        targetReps = Math.max(4, Math.round(workingTargetReps * 0.60));
        targetRPE = 6.0;
      }
    } else {
      if (activeWIdx === 0) {
        targetWeight = roundToNearest25(workingTargetWeight * 0.50);
        targetReps = workingTargetReps;
        targetRPE = 4.0;
      } else if (activeWIdx === 1) {
        targetWeight = roundToNearest25(workingTargetWeight * 0.70);
        targetReps = Math.max(5, Math.round(workingTargetReps * 0.70));
        targetRPE = 6.0;
      } else {
        const rampPct = Math.min(0.90, 0.85 + (activeWIdx - 2) * 0.05);
        targetWeight = roundToNearest25(workingTargetWeight * rampPct);
        targetReps = Math.max(3, Math.round(workingTargetReps * 0.35));
        targetRPE = 7.0;
      }
    }
  } else {
    if (warmupCount === 1) {
      targetReps = workingTargetReps;
      targetRPE = 5.0;
    } else if (warmupCount === 2) {
      targetReps = activeWIdx === 0 ? workingTargetReps : Math.max(4, Math.round(workingTargetReps * 0.60));
      targetRPE = activeWIdx === 0 ? 4.0 : 6.0;
    } else {
      if (activeWIdx === 0) {
        targetReps = workingTargetReps;
        targetRPE = 4.0;
      } else if (activeWIdx === 1) {
        targetReps = Math.max(5, Math.round(workingTargetReps * 0.70));
        targetRPE = 6.0;
      } else {
        targetReps = Math.max(3, Math.round(workingTargetReps * 0.35));
        targetRPE = 7.0;
      }
    }
  }

  return { weight: targetWeight, reps: targetReps, rpe: targetRPE };
}

export interface SessionDistributionResolution {
  isBypassed: boolean;
  anchor?: SessionAnchor;
  distributionResult?: MultiSetDistributionResult;
  roundedAnchorWeight?: number;
  anchorReps?: number;
  anchorRPE?: number;
}

/**
 * Pure helper to resolve the session anchor and calculate multi-set distribution targets.
 * Shared by calculateObjectiveSets and calculateAddedSetTarget to guarantee mathematical consistency.
 */
export function resolveSessionDistribution(params: {
  objective: 'Off' | 'Hypertrophy' | 'Strength' | 'Deload';
  exercise: ExerciseEntry;
  workingSetCount: number;
  weekNum: number;
  programDuration?: number;
  previousLogs?: WorkoutLog[];
  algorithmId?: 'hypertrophy_linear' | 'hypertrophy_step' | 'strength_undulating' | 'strength_linear' | 'none';
  templateExercise?: ExerciseEntry;
}): SessionDistributionResolution {
  const {
    objective,
    exercise,
    workingSetCount,
    weekNum,
    programDuration = 8,
    previousLogs = [],
    algorithmId,
    templateExercise,
  } = params;

  if (objective === 'Off' || objective === 'Deload') {
    return { isBypassed: true };
  }

  if (exercise.isSkipped) {
    return { isBypassed: true };
  }

  if (
    exercise.modality === 'bodyweight' ||
    exercise.modality === 'assisted' ||
    exercise.modality === 'timed' ||
    exercise.modality === 'distance' ||
    exercise.modality === 'distance_loaded'
  ) {
    return { isBypassed: true };
  }

  if (objective === 'Strength' && !exercise.isMainMovement) {
    return { isBypassed: true };
  }

  const historicalE1RM = extractHistoricalBaselineE1RM(exercise.name, previousLogs);
  const baselineE1RM = historicalE1RM > 0 ? historicalE1RM : extractTemplateBaselineE1RM(templateExercise);

  if (baselineE1RM <= 0) {
    return { isBypassed: true };
  }

  if (workingSetCount <= 0) {
    return { isBypassed: true };
  }

  const effectiveAlgorithmId = resolveEffectiveAlgorithm(objective, algorithmId);
  if (!effectiveAlgorithmId) {
    return { isBypassed: true };
  }

  const classification = getExerciseClassification(exercise);
  const isIsolation = classification.category === 'isolation';
  const isMachine = classification.equipment === 'machine';

  let anchorReps = 10;
  let anchorRPE = 8.0;
  let rawAnchorWeight = 0;
  let roundedAnchorWeight = 0;
  let profileType: FatiguePriorProfile = 'hypertrophy';

  if (objective === 'Hypertrophy') {
    if (effectiveAlgorithmId === 'hypertrophy_step') {
      const maxWeek = programDuration || 8;
      const activeWeek = Math.min(weekNum, maxWeek);
      const activeBlock = Math.min(2, Math.floor((activeWeek - 1) / 4));
      const stepNum = ((activeWeek - 1) % 4) + 1;

      let baseReps = 10;
      let baseRPE = 7.5;

      if (activeBlock === 0) {
        baseReps = stepNum === 4 ? 12 : 10;
        baseRPE = stepNum === 1 ? 7.0 : (stepNum === 2 ? 7.5 : 8.0);
      } else if (activeBlock === 1) {
        baseReps = stepNum === 4 ? 10 : 8;
        baseRPE = stepNum === 1 ? 7.5 : (stepNum === 2 ? 8.0 : 8.5);
      } else {
        baseReps = stepNum === 4 ? 8 : 6;
        baseRPE = stepNum === 1 ? 8.0 : (stepNum === 2 ? 8.5 : 9.0);
      }

      if (isIsolation && isMachine) {
        baseReps = Math.max(12, baseReps + 4);
      } else if (isIsolation && !isMachine) {
        baseReps = Math.max(10, baseReps + 2);
      } else if (!isIsolation && isMachine) {
        baseReps = baseReps + 2;
      }

      anchorReps = baseReps;
      anchorRPE = baseRPE;
    } else {
      // hypertrophy_linear (Wave Volume)
      const isOddWeek = weekNum % 2 !== 0;

      if (isOddWeek) {
        if (isIsolation) {
          anchorReps = 15;
        } else {
          anchorReps = 12;
        }
      } else {
        if (!isIsolation && !isMachine) {
          anchorReps = 6;
        } else if (!isIsolation && isMachine) {
          anchorReps = 8;
        } else if (isIsolation && !isMachine) {
          anchorReps = 10;
        } else {
          anchorReps = 12;
        }
      }

      anchorRPE = 8.0;
    }

    const multiplier = rpeMathGetRTSMultiplier(anchorReps, anchorRPE);
    if (multiplier === null || !Number.isFinite(multiplier) || multiplier <= 0) {
      return { isBypassed: true };
    }

    rawAnchorWeight = baselineE1RM * multiplier;
    roundedAnchorWeight = roundToNearest25(rawAnchorWeight);
    profileType = 'hypertrophy';
  } else if (objective === 'Strength') {
    let target1RMPercent = 0.786;

    if (effectiveAlgorithmId === 'strength_linear') {
      const maxWeek = programDuration || 8;
      const activeWeek = Math.min(weekNum, maxWeek);
      const progress = maxWeek > 1 ? (activeWeek - 1) / (maxWeek - 1) : 0;

      anchorReps = Math.max(1, Math.round(8 - progress * 7));
      anchorRPE = Math.round((7.0 + progress * 3.0) * 2) / 2;
      target1RMPercent = 0.70 + progress * 0.30;
    } else {
      // strength_undulating (Default)
      const weekProfile = getUndulatingProfileWeek(weekNum, programDuration);

      anchorReps = weekProfile.reps;
      anchorRPE = weekProfile.targetRPE;
      target1RMPercent = weekProfile.target1RMPercent;
    }

    rawAnchorWeight = baselineE1RM * target1RMPercent;
    roundedAnchorWeight = roundToNearest25(rawAnchorWeight);

    if (anchorReps === 1 && anchorRPE >= 9.5) {
      profileType = 'strength_post_test';
    } else {
      profileType = 'strength_normal';
    }
  }

  // Guard against invalid calculated weights
  if (
    !Number.isFinite(rawAnchorWeight) ||
    rawAnchorWeight <= 0 ||
    !Number.isFinite(roundedAnchorWeight) ||
    roundedAnchorWeight <= 0
  ) {
    return { isBypassed: true };
  }

  const anchor: SessionAnchor = {
    algorithmId: effectiveAlgorithmId,
    profileType,
    baselineE1RM,
    rawAnchorWeight,
    roundedAnchorWeight,
    anchorReps,
    anchorRPE,
    workingSetCount,
    movementCategory: classification.category,
    equipment: classification.equipment,
    modality: exercise.modality || 'weighted',
    isSkipped: exercise.isSkipped || false,
  };

  const distributionResult = distributeMultiSetTargets(
    anchor,
    exercise.name,
    previousLogs || []
  );

  return {
    isBypassed: distributionResult.isBypassed,
    anchor,
    distributionResult,
    roundedAnchorWeight,
    anchorReps,
    anchorRPE,
  };
}

export interface CalculateObjectiveSetsParams {
  objective: 'Off' | 'Hypertrophy' | 'Strength' | 'Deload';
  exercise: ExerciseEntry;
  exerciseIndex?: number;
  totalExercises?: number;
  weekNum: number;
  programDuration?: number;
  previousLogs?: WorkoutLog[];
  userTouchedSets?: Record<string, boolean>;
  checkedSets?: Record<string, boolean>;
  algorithmId?: 'hypertrophy_linear' | 'hypertrophy_step' | 'strength_undulating' | 'strength_linear' | 'none';
  templateExercise?: ExerciseEntry;
}

/**
 * Applies the Strength, Hypertrophy, or Deload algorithm to an exercise's sets.
 * Baseline Precedence:
 * 1. Historical baseline e1RM from previous completed workout logs (extractHistoricalBaselineE1RM).
 * 2. Immutable program template default (extractTemplateBaselineE1RM).
 * 3. If neither exists, baseline capacity is 0 (targets will not fabricate arbitrary weights).
 * 
 * Note: Active draft exercise.sets is NEVER used to estimate baseline capacity.
 */
export function calculateObjectiveSets(params: CalculateObjectiveSetsParams): SetEntry[] {
  const {
    objective,
    exercise,
    exerciseIndex = 0,
    weekNum,
    programDuration = 8,
    previousLogs = [],
    userTouchedSets = {},
    checkedSets = {},
    algorithmId,
    templateExercise
  } = params;

  // 1. If objective is Off, return exercise.sets unchanged
  if (objective === 'Off') {
    return exercise.sets;
  }

  // 2. If exercise is actively skipped, return exercise.sets unchanged
  if (exercise.isSkipped) {
    return exercise.sets;
  }

  // 3. Omit bodyweight, assisted, timed, distance, and distance_loaded modalities from algorithm changes
  if (
    exercise.modality === 'bodyweight' ||
    exercise.modality === 'assisted' ||
    exercise.modality === 'timed' ||
    exercise.modality === 'distance' ||
    exercise.modality === 'distance_loaded'
  ) {
    return exercise.sets;
  }

  // 4. Strength objective ONLY alters the main movement
  if (objective === 'Strength' && !exercise.isMainMovement) {
    return exercise.sets;
  }

  // 5. Baseline Extraction: Historical logs first, then pristine template fallback
  const historicalE1RM = extractHistoricalBaselineE1RM(exercise.name, previousLogs);
  const baselineE1RM = historicalE1RM > 0 ? historicalE1RM : extractTemplateBaselineE1RM(templateExercise);

  // 6. Deload Handling (Preserves existing scalar deload behavior without Phase 2A distribution)
  if (objective === 'Deload') {
    const warmupSets = exercise.sets.filter(s => s.isWarmup);
    return exercise.sets.map((set, setIdx) => {
      const key = `${exerciseIndex}-${setIdx}`;
      if (userTouchedSets[key] || checkedSets[key]) {
        return set;
      }

      let baseWeight = 0;
      if (baselineE1RM > 0) {
        baseWeight = baselineE1RM * 0.70; // ~70% of e1RM as standard load reference
      } else if (templateExercise?.sets?.[0]?.weight) {
        baseWeight = templateExercise.sets[0].weight;
      } else {
        baseWeight = set.weight || 0;
      }

      const baseReps = set.reps || 8;
      const workingTargetWeight = baseWeight > 0 ? roundToNearest25(baseWeight * 0.5) : 0;
      const workingTargetReps = Math.max(1, Math.round(baseReps * 0.6));

      if (set.isWarmup) {
        const wIdx = warmupSets.indexOf(set);
        const activeWIdx = wIdx >= 0 ? wIdx : 0;
        const targetWeight = workingTargetWeight > 0 ? roundToNearest25(workingTargetWeight * (0.5 + activeWIdx * 0.2)) : 0;
        return {
          ...set,
          reps: workingTargetReps,
          rpe: 4.0,
          weight: targetWeight,
          form: 'strict' as const
        };
      }

      return {
        ...set,
        reps: workingTargetReps,
        rpe: 5.0,
        weight: workingTargetWeight,
        form: 'strict' as const
      };
    });
  }

  // 7. Cold start guard: If no baseline capacity exists, return sets unchanged
  if (baselineE1RM <= 0) {
    return exercise.sets;
  }

  // 8. Working set count check
  const nonWarmupSets = exercise.sets.filter(s => !s.isWarmup);
  const workingSetCount = nonWarmupSets.length;
  if (workingSetCount <= 0) {
    return exercise.sets;
  }

  // 9. Multi-set distribution resolution
  const resolution = resolveSessionDistribution({
    objective,
    exercise,
    workingSetCount,
    weekNum,
    programDuration,
    previousLogs,
    algorithmId,
    templateExercise,
  });

  if (resolution.isBypassed || !resolution.distributionResult) {
    return exercise.sets;
  }

  const { distributionResult, roundedAnchorWeight = 0, anchorReps = 10 } = resolution;

  // 10. Map generated targets by ordinal
  const targetsByOrdinal = new Map<number, { weight: number; reps: number; rpe: number }>();
  for (const t of distributionResult.targets) {
    targetsByOrdinal.set(t.workingSetOrdinal, {
      weight: t.weight,
      reps: t.reps,
      rpe: t.rpe,
    });
  }

  const warmupSets = exercise.sets.filter(s => s.isWarmup);
  const warmupCount = warmupSets.length;

  let workingOrdinalCounter = 0;
  let warmupIndexCounter = 0;

  // 11. Target-only merge into exercise sets preserving all other metadata
  return exercise.sets.map((set, setIdx) => {
    const key = `${exerciseIndex}-${setIdx}`;

    // Protected sets: touched or checked sets or skipped sets remain completely unchanged
    if (userTouchedSets[key] || checkedSets[key] || set.isSkipped === true) {
      if (set.isWarmup) {
        warmupIndexCounter += 1;
      } else {
        workingOrdinalCounter += 1;
      }
      return set;
    }

    // Warm-up row generation
    if (set.isWarmup) {
      const activeWIdx = warmupIndexCounter;
      warmupIndexCounter += 1;
      const warmupTarget = calculateWarmupSetTarget(
        activeWIdx,
        warmupCount,
        roundedAnchorWeight,
        anchorReps
      );
      return {
        ...set,
        weight: warmupTarget.weight,
        reps: warmupTarget.reps,
        rpe: warmupTarget.rpe,
      };
    }

    // Working set row generation
    workingOrdinalCounter += 1;
    const ordinal = workingOrdinalCounter;

    if (ordinal >= 1 && ordinal <= 6 && targetsByOrdinal.has(ordinal)) {
      const target = targetsByOrdinal.get(ordinal)!;
      return {
        ...set,
        weight: target.weight,
        reps: target.reps,
        rpe: target.rpe,
      };
    }

    // Working sets with ordinal 7+ or unmapped: preserve unchanged
    return set;
  });
}

export interface CalculateAddedSetTargetParams {
  objective: 'Off' | 'Hypertrophy' | 'Strength' | 'Deload';
  exercise: ExerciseEntry;
  weekNum: number;
  programDuration?: number;
  previousLogs?: WorkoutLog[];
  algorithmId?: 'hypertrophy_linear' | 'hypertrophy_step' | 'strength_undulating' | 'strength_linear' | 'none';
  templateExercise?: ExerciseEntry;
}

export interface AddedSetTargetResult {
  isPrescribed: boolean;
  target?: {
    weight: number;
    reps: number;
    rpe: number;
    form: 'standard' | 'strict' | 'loose';
  };
  workingSetOrdinal: number;
}

/**
 * Calculates the prescribed target for an added working set (Phase 2B-1).
 * Uses the existing weekly prescription and multi-set distribution engine.
 * Does not mutate or recalculate existing sets.
 *
 * Rules:
 * 1. Determines the added working-set ordinal (ignores warmups).
 * 2. If ordinal > 6, returns unprescribed default (isPrescribed: false).
 * 3. If objective is Off or bypassed (skipped, non-weighted, strength accessory, invalid algorithm, cold start),
 *    returns unprescribed default (isPrescribed: false).
 * 4. In Deload mode, generates the deload target for the added set.
 * 5. In Hypertrophy / Strength mode, distributes up to ordinal N, extracting ONLY the target for ordinal N.
 */
export function calculateAddedSetTarget(params: CalculateAddedSetTargetParams): AddedSetTargetResult {
  const {
    objective,
    exercise,
    weekNum,
    programDuration = 8,
    previousLogs = [],
    algorithmId,
    templateExercise,
  } = params;

  // 1. Calculate the new working-set ordinal (warmups do not consume working-set ordinals)
  const currentWorkingSets = (exercise.sets || []).filter(s => !s.isWarmup);
  const targetWorkingOrdinal = currentWorkingSets.length + 1;

  // 2. Safe ceiling check: distribution engine supports up to 6 working sets
  if (targetWorkingOrdinal > 6) {
    return {
      isPrescribed: false,
      workingSetOrdinal: targetWorkingOrdinal,
    };
  }

  // 3. Bypass checks: Objective Off or exercise skipped
  if (objective === 'Off' || exercise.isSkipped) {
    return {
      isPrescribed: false,
      workingSetOrdinal: targetWorkingOrdinal,
    };
  }

  // 4. Modality check: non-weighted modalities are bypassed
  if (
    exercise.modality === 'bodyweight' ||
    exercise.modality === 'assisted' ||
    exercise.modality === 'timed' ||
    exercise.modality === 'distance' ||
    exercise.modality === 'distance_loaded'
  ) {
    return {
      isPrescribed: false,
      workingSetOrdinal: targetWorkingOrdinal,
    };
  }

  // 5. Strength objective: accessories that are not Main Movement are bypassed
  if (objective === 'Strength' && !exercise.isMainMovement) {
    return {
      isPrescribed: false,
      workingSetOrdinal: targetWorkingOrdinal,
    };
  }

  // 6. Baseline extraction (Authoritative inputs: history first, pristine template fallback)
  const historicalE1RM = extractHistoricalBaselineE1RM(exercise.name, previousLogs);
  const baselineE1RM = historicalE1RM > 0 ? historicalE1RM : extractTemplateBaselineE1RM(templateExercise);

  // 7. Deload mode handling
  if (objective === 'Deload') {
    let baseWeight = 0;
    if (baselineE1RM > 0) {
      baseWeight = baselineE1RM * 0.70;
    } else if (templateExercise?.sets?.[0]?.weight) {
      baseWeight = templateExercise.sets[0].weight;
    } else {
      baseWeight = 0;
    }

    if (baseWeight <= 0) {
      return {
        isPrescribed: false,
        workingSetOrdinal: targetWorkingOrdinal,
      };
    }

    const baseReps = templateExercise?.sets?.[0]?.reps || 8;
    const workingTargetWeight = roundToNearest25(baseWeight * 0.5);
    const workingTargetReps = Math.max(1, Math.round(baseReps * 0.6));

    return {
      isPrescribed: true,
      target: {
        weight: workingTargetWeight,
        reps: workingTargetReps,
        rpe: 5.0,
        form: 'strict',
      },
      workingSetOrdinal: targetWorkingOrdinal,
    };
  }

  // 8. Cold start check (if no valid baseline, added set remains unprescribed)
  if (baselineE1RM <= 0) {
    return {
      isPrescribed: false,
      workingSetOrdinal: targetWorkingOrdinal,
    };
  }

  // 9. Multi-set distribution resolution for proposed working-set count
  const resolution = resolveSessionDistribution({
    objective,
    exercise,
    workingSetCount: targetWorkingOrdinal,
    weekNum,
    programDuration,
    previousLogs,
    algorithmId,
    templateExercise,
  });

  if (resolution.isBypassed || !resolution.distributionResult) {
    return {
      isPrescribed: false,
      workingSetOrdinal: targetWorkingOrdinal,
    };
  }

  const target = resolution.distributionResult.targets.find(
    (t: GeneratedWorkingSetTarget) => t.workingSetOrdinal === targetWorkingOrdinal
  );

  if (!target) {
    return {
      isPrescribed: false,
      workingSetOrdinal: targetWorkingOrdinal,
    };
  }

  return {
    isPrescribed: true,
    target: {
      weight: target.weight,
      reps: target.reps,
      rpe: target.rpe,
      form: 'standard',
    },
    workingSetOrdinal: targetWorkingOrdinal,
  };
}
