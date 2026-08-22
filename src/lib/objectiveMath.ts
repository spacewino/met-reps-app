import { ExerciseEntry, SetEntry, WorkoutLog, BodyweightSnapshot, WeightUnit } from '../types';
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
  getFatiguePrior,
  SessionAnchor,
  FatiguePriorProfile,
  MultiSetDistributionResult,
  GeneratedWorkingSetTarget,
} from './setDistribution';
import { extractSetPerformanceEvidence } from './progressionEvidence';
import { projectAssistedTarget, solveBodyweightRepTarget } from './modalityTargetMath';
import { resolveSessionBodyweightInUnit, validateBodyweightSnapshot } from './bodyweightSessionMath';

// Re-export roundToNearest25 for backward compatibility with existing imports
export { roundToNearest25 } from './weightMath';

// Export RTS_RPE_PERCENT as an alias to DEFAULT_RTS_STYLE_PERCENT_1RM for compatibility
export const RTS_RPE_PERCENT = DEFAULT_RTS_STYLE_PERCENT_1RM;

interface StrengthProfileWeek {
  reps: number;
  target1RMPercent: number;
  targetRPE: number;
}

/**
 * Approved bodyweight-projection repetition envelopes policy derived from the existing algorithm profiles:
 * - Hypertrophy compound: [5, 15]
 * - Hypertrophy isolation: [8, 20]
 * - Strength Undulating main movement: [1, 6]
 * - Strength Linear main movement: [1, 8]
 * - Deload: [1, 15]
 * - Machine/isolation modifiers alter anchor reps before projection but do not create an unbounded range.
 * - Strength non-main accessories remain bypassed.
 */
export function getPermittedRepetitionBounds(params: {
  objective: 'Hypertrophy' | 'Strength' | 'Deload';
  algorithmId?: 'hypertrophy_linear' | 'hypertrophy_step' | 'strength_undulating' | 'strength_linear' | 'none';
  isIsolation: boolean;
  isMachine: boolean;
  anchorReps: number;
}): { minReps: number; maxReps: number } {
  const { objective, algorithmId, isIsolation, anchorReps } = params;
  if (objective === 'Hypertrophy') {
    if (isIsolation) {
      return {
        minReps: Math.min(8, anchorReps),
        maxReps: Math.max(20, anchorReps),
      };
    } else {
      return {
        minReps: Math.min(5, anchorReps),
        maxReps: Math.max(15, anchorReps),
      };
    }
  } else if (objective === 'Strength') {
    if (algorithmId === 'strength_linear') {
      return {
        minReps: 1,
        maxReps: Math.max(8, anchorReps),
      };
    } else {
      // strength_undulating
      return {
        minReps: 1,
        maxReps: Math.max(6, anchorReps),
      };
    }
  } else {
    // Deload
    return {
      minReps: 1,
      maxReps: Math.max(15, anchorReps),
    };
  }
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
 * Normalizes an exercise name for case-insensitive and whitespace-trimmed matching.
 */
export function normalizeExerciseName(name: string): string {
  return (name || '').trim().toLowerCase();
}

function normalizeName(name: string): string {
  return normalizeExerciseName(name);
}

/**
 * Pure deterministic helper to calculate the 0-indexed occurrence ordinal of an exercise within a list.
 * Counts only matching normalized exercise names appearing strictly before exerciseIndex.
 * Returns 0 for the first occurrence, 1 for the second, 2 for the third, and so on.
 * Handles invalid indexes or empty inputs safely without throwing.
 */
export function getExerciseOccurrenceOrdinal(
  exercises: { name: string }[] | ExerciseEntry[] | null | undefined,
  exerciseIndex: number
): number {
  if (!exercises || !Array.isArray(exercises) || exerciseIndex <= 0 || exerciseIndex >= exercises.length) {
    return 0;
  }
  const targetEx = exercises[exerciseIndex];
  if (!targetEx || !targetEx.name) {
    return 0;
  }
  const targetNorm = normalizeExerciseName(targetEx.name);
  let count = 0;
  for (let i = 0; i < exerciseIndex; i++) {
    const currentEx = exercises[i];
    if (currentEx && currentEx.name && normalizeExerciseName(currentEx.name) === targetNorm) {
      count++;
    }
  }
  return count;
}

/**
 * Extracts historical baseline e1RM from previous completed workout logs.
 * Integrates canonical extractSetPerformanceEvidence for weighted, assisted, and bodyweight modalities.
 */
export function extractHistoricalBaselineE1RM(
  exerciseName: string,
  logs: WorkoutLog[],
  modality?: ExerciseEntry['modality'],
  activeUnit: WeightUnit = 'kg'
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

        // Validate snapshot to normalize unit ('lbs' -> 'lb') and verify bounds
        const validatedSnapshot = log.bodyweightSnapshot
          ? validateBodyweightSnapshot(log.bodyweightSnapshot)
          : null;

        // Normalize source unit ('lbs' -> 'lb')
        const rawLogUnit = log.unit || 'kg';
        const sourceUnit: WeightUnit = ((rawLogUnit as unknown as string) === 'lbs' ? 'lb' : rawLogUnit) as WeightUnit;

        const evidence = extractSetPerformanceEvidence({
          context: 'historical',
          modality: ex.modality || 'weighted',
          set: s,
          bodyweightSnapshot: validatedSnapshot,
          targetUnit: ((activeUnit as unknown as string) === 'lbs' ? 'lb' : activeUnit) as WeightUnit,
          exerciseIsSkipped: ex.isSkipped,
          sourceUnit,
        });

        if (evidence.status === 'valid') {
          if (evidence.rpe !== null) {
            rpeE1rms.push(evidence.e1RM);
          } else {
            missingRpeE1rms.push(evidence.e1RM);
          }
        }
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

export interface ContextualPrescriptionBaselineOptions {
  programId?: string | null;
  targetDay?: number | string | null;
  targetDate?: string | null;
  occurrenceOrdinal?: number;
  modality?: ExerciseEntry['modality'];
  activeUnit?: WeightUnit;
}

/**
 * Resolves the session capacity (maximum valid working-set e1RM) for an exercise exposure in a workout log.
 * Returns null if no valid working sets exist or if the exercise is skipped.
 */
export function extractExposureSessionCapacity(
  ex: ExerciseEntry,
  log: WorkoutLog,
  activeUnit: WeightUnit = 'kg'
): number | null {
  if (!ex || ex.isSkipped || !ex.sets || ex.sets.length === 0) {
    return null;
  }

  const validatedSnapshot = log.bodyweightSnapshot
    ? validateBodyweightSnapshot(log.bodyweightSnapshot)
    : null;

  const rawLogUnit = log.unit || 'kg';
  const sourceUnit: WeightUnit = ((rawLogUnit as unknown as string) === 'lbs' ? 'lb' : rawLogUnit) as WeightUnit;
  const targetUnit: WeightUnit = ((activeUnit as unknown as string) === 'lbs' ? 'lb' : activeUnit) as WeightUnit;

  const validWorkingE1RMs: number[] = [];

  for (const s of ex.sets) {
    // Exclude warmups
    if (s.isWarmup) continue;

    // Stop processing working sets upon first skipped working set
    if (s.isSkipped === true) {
      break;
    }

    // Exclude explicitly uncompleted non-skipped sets (null/undefined treated as completed for legacy compatibility)
    if (s.isCompleted === false) continue;

    const evidence = extractSetPerformanceEvidence({
      context: 'historical',
      modality: ex.modality || 'weighted',
      set: s,
      bodyweightSnapshot: validatedSnapshot,
      targetUnit,
      exerciseIsSkipped: ex.isSkipped,
      sourceUnit,
    });

    if (evidence.status === 'valid' && typeof evidence.e1RM === 'number' && Number.isFinite(evidence.e1RM) && evidence.e1RM > 0) {
      validWorkingE1RMs.push(evidence.e1RM);
    }
  }

  if (validWorkingE1RMs.length === 0) {
    return null;
  }

  return Math.max(...validWorkingE1RMs);
}

/**
 * Calculates the mathematical median of an array of numbers.
 */
export function calculateMedian(values: number[]): number {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Resolves the contextual prescription baseline e1RM across the 4-tier hierarchy:
 * Tier 1: Same program, same day (weeks < targetWeek)
 * Tier 2: Same program, day-agnostic fallback (weeks < targetWeek)
 * Tier 3: Cross-program bootstrap (up to 3 most recent sessions prior to target session)
 * Tier 4: Template / manual fallback (returns 0)
 */
export function resolveContextualPrescriptionBaselineE1RM(
  exerciseName: string,
  targetWeek: number | string,
  logs: WorkoutLog[],
  options?: ContextualPrescriptionBaselineOptions
): number {
  if (!logs || logs.length === 0 || !exerciseName) return 0;

  const targetNorm = normalizeName(exerciseName);
  const rawTargetWeekStr = String(targetWeek).trim();
  const parsedTargetWeekNum = parseInt(rawTargetWeekStr.replace(/\D/g, ''), 10);
  const targetWeekNum = Number.isFinite(parsedTargetWeekNum) && parsedTargetWeekNum > 0 ? parsedTargetWeekNum : 1;

  const targetProgramId = options?.programId ? String(options.programId).trim() : null;
  const targetDay = options?.targetDay !== undefined && options?.targetDay !== null ? String(options.targetDay).trim() : null;
  const targetOccurrenceOrdinal = options?.occurrenceOrdinal ?? 0;
  const targetDate = options?.targetDate ? String(options.targetDate).trim() : null;
  const activeUnit = options?.activeUnit || 'kg';

  // Helper to safely parse week number from a log
  const parseLogWeek = (rawWeek: string | number | undefined): number | null => {
    if (rawWeek === undefined || rawWeek === null) return null;
    const s = String(rawWeek).trim();
    const num = parseInt(s.replace(/\D/g, ''), 10);
    if (Number.isFinite(num) && num > 0) {
      return num;
    }
    return null;
  };

  // Helper for deterministic sorting of logs (newest first)
  const compareLogsChronologicalDesc = (a: WorkoutLog, b: WorkoutLog): number => {
    const dateComp = (b.date || '').localeCompare(a.date || '');
    if (dateComp !== 0) return dateComp;

    const schedComp = (b.scheduledDate || '').localeCompare(a.scheduledDate || '');
    if (schedComp !== 0) return schedComp;

    const idComp = (b.id || '').localeCompare(a.id || '');
    if (idComp !== 0) return idComp;

    return 0;
  };

  // TIER 1 & TIER 2: Same-program matching
  if (targetProgramId) {
    const sameProgramLogs = logs.filter(l => {
      if (!l.programId || String(l.programId).trim() !== targetProgramId) return false;
      const logW = parseLogWeek(l.week);
      return logW !== null && logW < targetWeekNum;
    });

    // Helper to find matching exercise entry in a log based on normalized name & occurrence ordinal
    const findMatchingExerciseInLog = (log: WorkoutLog): ExerciseEntry | null => {
      if (!log.exercises || log.exercises.length === 0) return null;
      const matchingExs = log.exercises.filter(
        e => !e.isSkipped && normalizeName(e.name) === targetNorm
      );
      if (matchingExs.length === 0) return null;
      if (targetOccurrenceOrdinal < matchingExs.length) {
        return matchingExs[targetOccurrenceOrdinal];
      }
      return matchingExs[0];
    };

    // Tier 1: Same program AND same day
    if (targetDay !== null) {
      const tier1Logs = sameProgramLogs.filter(
        l => l.day !== undefined && String(l.day).trim() === targetDay
      );

      const weekExposuresMap = new Map<number, { week: number; capacity: number; date: string }>();
      const sortedTier1Logs = [...tier1Logs].sort(compareLogsChronologicalDesc);

      for (const log of sortedTier1Logs) {
        const logW = parseLogWeek(log.week)!;
        if (weekExposuresMap.has(logW)) continue; // already have newest for this week

        const matchedEx = findMatchingExerciseInLog(log);
        if (!matchedEx) continue;

        const cap = extractExposureSessionCapacity(matchedEx, log, activeUnit);
        if (cap !== null && cap > 0) {
          weekExposuresMap.set(logW, { week: logW, capacity: cap, date: log.date || '' });
        }
      }

      if (weekExposuresMap.size > 0) {
        const sortedExposures = Array.from(weekExposuresMap.values()).sort((a, b) => a.week - b.week);
        if (sortedExposures.length === 1) {
          return sortedExposures[0].capacity;
        }
        // 2 or more earlier exposures
        const previousCapacity = sortedExposures[sortedExposures.length - 1].capacity;
        const programMedian = calculateMedian(sortedExposures.map(e => e.capacity));
        return 0.75 * previousCapacity + 0.25 * programMedian;
      }
    }

    // Tier 2: Same program, day-agnostic fallback
    const sortedTier2Logs = [...sameProgramLogs].sort(compareLogsChronologicalDesc);
    const weekExposuresMap = new Map<number, { week: number; capacity: number; date: string }>();

    for (const log of sortedTier2Logs) {
      const logW = parseLogWeek(log.week)!;
      if (weekExposuresMap.has(logW)) continue;

      const matchedEx = findMatchingExerciseInLog(log);
      if (!matchedEx) continue;

      const cap = extractExposureSessionCapacity(matchedEx, log, activeUnit);
      if (cap !== null && cap > 0) {
        weekExposuresMap.set(logW, { week: logW, capacity: cap, date: log.date || '' });
      }
    }

    if (weekExposuresMap.size > 0) {
      const sortedExposures = Array.from(weekExposuresMap.values()).sort((a, b) => a.week - b.week);
      if (sortedExposures.length === 1) {
        return sortedExposures[0].capacity;
      }
      const previousCapacity = sortedExposures[sortedExposures.length - 1].capacity;
      const programMedian = calculateMedian(sortedExposures.map(e => e.capacity));
      return 0.75 * previousCapacity + 0.25 * programMedian;
    }
  }

  // TIER 3: Cross-program bootstrap
  // Filter eligible logs that predate the target session
  const eligibleCrossProgramLogs = logs.filter(log => {
    // Exclude logs from current program if week is >= targetWeek
    if (targetProgramId && log.programId && String(log.programId).trim() === targetProgramId) {
      const logW = parseLogWeek(log.week);
      if (logW === null || logW >= targetWeekNum) return false;
    }

    // Strictly predate targetDate if targetDate is provided
    if (targetDate && log.date) {
      if (log.date >= targetDate) return false;
    }

    return true;
  });

  const sortedCrossLogs = [...eligibleCrossProgramLogs].sort(compareLogsChronologicalDesc);
  const crossCapacities: number[] = [];

  for (const log of sortedCrossLogs) {
    if (!log.exercises || log.exercises.length === 0) continue;
    const matchingExs = log.exercises.filter(
      e => !e.isSkipped && normalizeName(e.name) === targetNorm
    );
    if (matchingExs.length === 0) continue;

    const matchedEx = targetOccurrenceOrdinal < matchingExs.length
      ? matchingExs[targetOccurrenceOrdinal]
      : matchingExs[0];

    const cap = extractExposureSessionCapacity(matchedEx, log, activeUnit);
    if (cap !== null && cap > 0) {
      crossCapacities.push(cap);
      if (crossCapacities.length >= 3) break;
    }
  }

  if (crossCapacities.length === 1) {
    return crossCapacities[0];
  }
  if (crossCapacities.length === 2) {
    return (crossCapacities[0] + crossCapacities[1]) / 2;
  }
  if (crossCapacities.length >= 3) {
    const top3 = crossCapacities.slice(0, 3).sort((a, b) => a - b);
    return top3[1];
  }

  // TIER 4: Fallback (returns 0 so caller uses template baseline or manual entry)
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
 * - For weighted: finds the first non-warm-up template set with positive weight and reps.
 * - For bodyweight: finds first non-warm-up template set with positive reps; uses active session bodyweight snapshot.
 * - For assisted: finds first non-warm-up template set with non-negative assistance and positive reps; uses active session bodyweight snapshot.
 * - If that template set has a valid RPE (6.0..10.0), calculates e1RM using that RPE.
 * - If that template set has missing RPE (null, undefined, 0), uses an explicit cold-start
 *   template assumption of RPE 8.0 (does not write it back into template/draft/logs).
 * - If that template set has explicitly invalid RPE (< 6.0 or > 10.0), rejects it (returns 0).
 * - Returns 0 if no valid template baseline set exists or if required snapshot is missing/invalid.
 */
export function extractTemplateBaselineE1RM(
  templateExercise?: ExerciseEntry,
  bodyweightSnapshot?: BodyweightSnapshot | null,
  activeUnit: WeightUnit = 'kg'
): number {
  if (!templateExercise || !templateExercise.sets || templateExercise.sets.length === 0) {
    return 0;
  }

  const mod = templateExercise.modality || 'weighted';

  if (mod === 'weighted') {
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
      const multiplier = rpeMathGetRTSMultiplier(reps, 8.0);
      return multiplier ? weight / multiplier : 0;
    }

    if (isValidRPE(rpe)) {
      const e1rm = rpeMathCalculateE1RMForSet(weight, reps, rpe);
      return e1rm && e1rm > 0 ? e1rm : 0;
    }

    return 0;
  }

  if (mod === 'bodyweight') {
    if (!bodyweightSnapshot || !validateBodyweightSnapshot(bodyweightSnapshot)) {
      return 0;
    }
    const sessionBW = resolveSessionBodyweightInUnit(bodyweightSnapshot, activeUnit);
    if (!sessionBW || sessionBW <= 0) {
      return 0;
    }

    const workingSet = templateExercise.sets.find(
      s => !s.isWarmup && typeof s.reps === 'number' && s.reps > 0
    );
    if (!workingSet || !workingSet.reps) {
      return 0;
    }

    const reps = Math.round(workingSet.reps);
    const rpe = workingSet.rpe;

    if (rpe === null || rpe === undefined || rpe === 0) {
      const multiplier = rpeMathGetRTSMultiplier(reps, 8.0);
      return multiplier ? sessionBW / multiplier : 0;
    }

    if (isValidRPE(rpe)) {
      const e1rm = rpeMathCalculateE1RMForSet(sessionBW, reps, rpe);
      return e1rm && e1rm > 0 ? e1rm : 0;
    }

    return 0;
  }

  if (mod === 'assisted') {
    if (!bodyweightSnapshot || !validateBodyweightSnapshot(bodyweightSnapshot)) {
      return 0;
    }
    const sessionBW = resolveSessionBodyweightInUnit(bodyweightSnapshot, activeUnit);
    if (!sessionBW || sessionBW <= 0) {
      return 0;
    }

    const workingSet = templateExercise.sets.find(
      s => !s.isWarmup && typeof s.weight === 'number' && s.weight >= 0 && typeof s.reps === 'number' && s.reps > 0
    );
    if (!workingSet || workingSet.weight === undefined || workingSet.weight === null || !workingSet.reps) {
      return 0;
    }

    const assistance: number = workingSet.weight;
    if (assistance >= sessionBW) {
      return 0;
    }
    const effectiveLoad = sessionBW - assistance;
    if (effectiveLoad <= 0) {
      return 0;
    }

    const reps = Math.round(workingSet.reps);
    const rpe = workingSet.rpe;

    if (rpe === null || rpe === undefined || rpe === 0) {
      const multiplier = rpeMathGetRTSMultiplier(reps, 8.0);
      return multiplier ? effectiveLoad / multiplier : 0;
    }

    if (isValidRPE(rpe)) {
      const e1rm = rpeMathCalculateE1RMForSet(effectiveLoad, reps, rpe);
      return e1rm && e1rm > 0 ? e1rm : 0;
    }

    return 0;
  }

  return 0;
}

/**
 * Safely finds the matching template exercise index from program day templates:
 * 1. Inspects the template at activeIndex (if provided).
 * 2. Uses it only if its normalized exercise name matches the active exercise's normalized name (or matching stable ID if present).
 * 3. Otherwise searches by matching stable ID if present.
 * 4. Otherwise searches by normalized name; if exactly one match exists, uses it.
 * 5. Returns -1 if no match exists or if duplicate matches exist without a disambiguating ID/index.
 */
export function findMatchingTemplateExerciseIndex(
  activeExercise: { name: string; id?: string } | ExerciseEntry,
  dayTemplates?: ExerciseEntry[] | null,
  activeIndex?: number
): number {
  if (!dayTemplates || !dayTemplates.length || !activeExercise) {
    return -1;
  }

  const rawActiveName = activeExercise.name || '';
  const activeName = rawActiveName.trim().toLowerCase();
  const activeId = (activeExercise as any).id;

  if (!activeName && !activeId) {
    return -1;
  }

  // 1. Inspect template at same index first
  if (typeof activeIndex === 'number' && activeIndex >= 0 && activeIndex < dayTemplates.length) {
    const candidate = dayTemplates[activeIndex];
    if (candidate) {
      const candidateId = (candidate as any).id;
      if (activeId && candidateId && activeId === candidateId) {
        return activeIndex;
      }
      const candidateName = (candidate.name || '').trim().toLowerCase();
      if (candidateName && candidateName === activeName) {
        return activeIndex;
      }
    }
  }

  // 2. Search by activeId if provided
  if (activeId) {
    const idIndex = dayTemplates.findIndex(t => (t as any).id === activeId);
    if (idIndex !== -1) return idIndex;
  }

  // 3. Search by normalized name
  const nameIndices: number[] = [];
  dayTemplates.forEach((t, i) => {
    if ((t.name || '').trim().toLowerCase() === activeName) {
      nameIndices.push(i);
    }
  });

  if (nameIndices.length === 1) {
    return nameIndices[0];
  }

  return -1;
}

/**
 * Safely finds a matching template exercise from program day templates.
 */
export function findMatchingTemplateExercise(
  activeExercise: { name: string; id?: string } | ExerciseEntry,
  dayTemplates?: ExerciseEntry[] | null,
  activeIndex?: number
): ExerciseEntry | undefined {
  const idx = findMatchingTemplateExerciseIndex(activeExercise, dayTemplates, activeIndex);
  return idx !== -1 && dayTemplates ? dayTemplates[idx] : undefined;
}

/**
 * Safely syncs an appended working set to a Program template's day exercises:
 * - Preserves the existing array order of dayTemplates.
 * - Preserves all existing template sets and their authored fields (weight, reps, rpe, comment, form, isWarmup, isDropSet, dropSubSets, etc.).
 * - Only increments the set count for the matching exercise by appending a sanitized structural SetEntry
 *   ({ setNumber, weight: 0, reps: 0, rpe: 8, form: 'standard' }).
 * - Never copies active generated targets, completion status, skipped status, session comments, or drop sets into the template.
 * - If no matching template exercise exists (or multiple ambiguous matches without ID/index), leaves the dayTemplates unchanged.
 */
export function syncAddedSetStructureToProgramDay(
  dayTemplates: ExerciseEntry[],
  activeExercise: ExerciseEntry | { name: string; id?: string },
  activeExerciseIndex?: number
): ExerciseEntry[] {
  if (!dayTemplates || !dayTemplates.length || !activeExercise) {
    return dayTemplates || [];
  }

  const targetIndex = findMatchingTemplateExerciseIndex(activeExercise, dayTemplates, activeExerciseIndex);
  if (targetIndex === -1 || targetIndex >= dayTemplates.length) {
    return dayTemplates;
  }

  return dayTemplates.map((t, idx) => {
    if (idx !== targetIndex) {
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

export interface ResolveSessionDistributionParams {
  objective: 'Off' | 'Hypertrophy' | 'Strength' | 'Deload';
  exercise: ExerciseEntry;
  workingSetCount: number;
  weekNum: number;
  programDuration?: number;
  previousLogs?: WorkoutLog[];
  algorithmId?: 'hypertrophy_linear' | 'hypertrophy_step' | 'strength_undulating' | 'strength_linear' | 'none';
  templateExercise?: ExerciseEntry;
  bodyweightSnapshot?: BodyweightSnapshot | null;
  activeUnit?: WeightUnit;
  programId?: string | null;
  dayNum?: number | string | null;
  targetDate?: string | null;
  occurrenceOrdinal?: number;
}

/**
 * Pure helper to resolve the session anchor and calculate multi-set distribution targets.
 * Shared by calculateObjectiveSets and calculateAddedSetTarget to guarantee mathematical consistency.
 */
export function resolveSessionDistribution(params: ResolveSessionDistributionParams): SessionDistributionResolution {
  const {
    objective,
    exercise,
    workingSetCount,
    weekNum,
    programDuration = 8,
    previousLogs = [],
    algorithmId,
    templateExercise,
    bodyweightSnapshot,
    activeUnit = 'kg',
    programId,
    dayNum,
    targetDate,
    occurrenceOrdinal,
  } = params;

  if (objective === 'Off' || objective === 'Deload') {
    return { isBypassed: true };
  }

  if (exercise.isSkipped) {
    return { isBypassed: true };
  }

  if (
    exercise.modality === 'timed' ||
    exercise.modality === 'distance' ||
    exercise.modality === 'distance_loaded'
  ) {
    return { isBypassed: true };
  }

  if (exercise.modality === 'bodyweight' || exercise.modality === 'assisted') {
    if (!bodyweightSnapshot || !validateBodyweightSnapshot(bodyweightSnapshot)) {
      return { isBypassed: true };
    }
  }

  if (objective === 'Strength' && !exercise.isMainMovement) {
    return { isBypassed: true };
  }

  const historicalE1RM = resolveContextualPrescriptionBaselineE1RM(
    exercise.name,
    weekNum,
    previousLogs,
    {
      programId,
      targetDay: dayNum,
      targetDate,
      occurrenceOrdinal,
      modality: exercise.modality,
      activeUnit,
    }
  );
  const baselineE1RM = historicalE1RM > 0 ? historicalE1RM : extractTemplateBaselineE1RM(templateExercise, bodyweightSnapshot, activeUnit);

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
    modality: 'weighted', // Execute multi-set distribution in effective-load space
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

export interface CanonicalTargetEntry {
  weight: number;
  reps: number;
  rpe: number;
  form: 'standard' | 'strict';
}

export interface GenerateSessionTargetMapParams {
  objective: 'Off' | 'Hypertrophy' | 'Strength' | 'Deload';
  exercise: ExerciseEntry;
  workingSetCount: number;
  weekNum: number;
  programDuration?: number;
  previousLogs?: WorkoutLog[];
  algorithmId?: 'hypertrophy_linear' | 'hypertrophy_step' | 'strength_undulating' | 'strength_linear' | 'none';
  templateExercise?: ExerciseEntry | null;
  bodyweightSnapshot?: BodyweightSnapshot | null;
  activeUnit?: WeightUnit;
  programId?: string | null;
  dayNum?: number | string | null;
  targetDate?: string | null;
  occurrenceOrdinal?: number;
}

/**
 * Pure helper to generate canonical ordinal target mappings for 1..workingSetCount.
 * Shared by calculateObjectiveSets and calculateAddedSetTarget to guarantee single-authority consistency.
 */
export function generateSessionTargetMap(params: GenerateSessionTargetMapParams): Map<number, CanonicalTargetEntry> | null {
  const {
    objective,
    exercise,
    workingSetCount,
    weekNum,
    programDuration = 8,
    previousLogs = [],
    algorithmId,
    templateExercise,
    bodyweightSnapshot,
    activeUnit = 'kg',
    programId,
    dayNum,
    targetDate,
    occurrenceOrdinal,
  } = params;

  // 1. Objective Off or skipped exercise returns unprescribed
  if (objective === 'Off' || exercise.isSkipped) {
    return null;
  }

  // 2. Modality support check: unsupported non-weighted and corrupted modalities are bypassed
  const mod = exercise.modality;
  const isSupported = mod === undefined || mod === 'weighted' || mod === 'assisted' || mod === 'bodyweight';
  if (!isSupported) {
    return null;
  }

  // 3. Assisted and bodyweight modalities strictly require a valid active session bodyweight snapshot
  if (mod === 'assisted' || mod === 'bodyweight') {
    if (!bodyweightSnapshot || !validateBodyweightSnapshot(bodyweightSnapshot)) {
      return null;
    }
  }

  // 4. For Strength objective, only main movements receive prescribed progression
  if (objective === 'Strength' && !exercise.isMainMovement) {
    return null;
  }

  if (workingSetCount <= 0) {
    return null;
  }

  // 5. Baseline Extraction: Contextual resolver first (with log's own snapshot), then pristine template fallback (with active snapshot)
  const historicalE1RM = resolveContextualPrescriptionBaselineE1RM(
    exercise.name,
    weekNum,
    previousLogs,
    {
      programId,
      targetDay: dayNum,
      targetDate,
      occurrenceOrdinal,
      modality: mod,
      activeUnit,
    }
  );
  const baselineE1RM = historicalE1RM > 0 ? historicalE1RM : extractTemplateBaselineE1RM(templateExercise || undefined, bodyweightSnapshot, activeUnit);

  if (baselineE1RM <= 0) {
    return null;
  }

  // 6. Deload Handling
  if (objective === 'Deload') {
    const templateReps = templateExercise?.sets?.find(s => !s.isWarmup && typeof s.reps === 'number' && s.reps > 0)?.reps;
    const firstSet = (exercise.sets || []).filter(s => !s.isWarmup)[0];
    const workingTargetReps = templateReps
      ? Math.max(1, Math.round(templateReps * 0.6))
      : (firstSet && (firstSet.form === 'strict' || firstSet.rpe === 5.0) && typeof firstSet.reps === 'number' && firstSet.reps > 0)
      ? firstSet.reps
      : Math.max(1, Math.round(((firstSet && typeof firstSet.reps === 'number' && firstSet.reps > 0 ? firstSet.reps : 8)) * 0.6));

    if (mod === 'assisted') {
      const sessionBW = resolveSessionBodyweightInUnit(bodyweightSnapshot, activeUnit);
      if (!sessionBW || sessionBW <= 0) {
        return null;
      }
      const baseEffectiveLoad = baselineE1RM * 0.70;
      const targetEffectiveLoad = baseEffectiveLoad * 0.5;

      const proj = projectAssistedTarget({
        targetEffectiveLoad,
        sessionBodyweight: sessionBW,
        targetReps: workingTargetReps,
        targetRPE: 6.0,
        unit: activeUnit,
        increment: 2.5,
      });

      if (proj.status === 'bypassed') {
        return null;
      }

      const map = new Map<number, CanonicalTargetEntry>();
      for (let ord = 1; ord <= workingSetCount; ord++) {
        map.set(ord, {
          weight: proj.assistanceWeight,
          reps: proj.reps,
          rpe: 5.0,
          form: 'strict',
        });
      }
      return map;
    }

    if (mod === 'bodyweight') {
      const sessionBW = resolveSessionBodyweightInUnit(bodyweightSnapshot, activeUnit);
      if (!sessionBW || sessionBW <= 0) {
        return null;
      }
      const baseEffectiveLoad = baselineE1RM * 0.70;
      const targetEffectiveLoad = baseEffectiveLoad * 0.5;

      const multiplier = rpeMathGetRTSMultiplier(workingTargetReps, 6.0) ?? 1;
      const targetE1RM = targetEffectiveLoad / multiplier;

      const bounds = getPermittedRepetitionBounds({
        objective: 'Deload',
        algorithmId,
        isIsolation: false,
        isMachine: false,
        anchorReps: workingTargetReps,
      });

      const solved = solveBodyweightRepTarget({
        targetE1RM,
        sessionBodyweight: sessionBW,
        targetRPE: 6.0,
        anchorReps: workingTargetReps,
        minReps: bounds.minReps,
        maxReps: bounds.maxReps,
        unit: activeUnit,
      });

      if (solved.status === 'bypassed') {
        return null;
      }

      const map = new Map<number, CanonicalTargetEntry>();
      for (let ord = 1; ord <= workingSetCount; ord++) {
        map.set(ord, {
          weight: 0,
          reps: solved.reps,
          rpe: 5.0,
          form: 'strict',
        });
      }
      return map;
    }

    // Weighted modality Deload
    let baseWeight = 0;
    if (baselineE1RM > 0) {
      baseWeight = baselineE1RM * 0.70;
    } else if (templateExercise?.sets?.[0]?.weight) {
      baseWeight = templateExercise.sets[0].weight;
    } else {
      baseWeight = (exercise.sets || [])[0]?.weight || 0;
    }

    const workingTargetWeight = baseWeight > 0 ? roundToNearest25(baseWeight * 0.5) : 0;
    const map = new Map<number, CanonicalTargetEntry>();
    for (let ord = 1; ord <= workingSetCount; ord++) {
      map.set(ord, {
        weight: workingTargetWeight,
        reps: workingTargetReps,
        rpe: 5.0,
        form: 'strict',
      });
    }
    return map;
  }

  // 7. Non-Deload resolution via resolveSessionDistribution
  const resolution = resolveSessionDistribution({
    objective,
    exercise,
    workingSetCount,
    weekNum,
    programDuration,
    previousLogs,
    algorithmId,
    templateExercise: templateExercise || undefined,
    bodyweightSnapshot,
    activeUnit,
    programId,
    dayNum,
    targetDate,
    occurrenceOrdinal,
  });

  if (resolution.isBypassed || !resolution.distributionResult || !resolution.anchor) {
    return null;
  }

  const { distributionResult, anchor } = resolution;
  const targetsByOrdinal = new Map<number, CanonicalTargetEntry>();
  const learnedRatios = distributionResult.learnedRatios || [];
  const defaultPriors = getFatiguePrior(anchor.profileType);

  for (const t of distributionResult.targets) {
    const ord = t.workingSetOrdinal;
    const targetReps = t.reps;
    const targetRPE = t.rpe;

    const Fi = learnedRatios[ord - 1]?.blendedRatio ?? (defaultPriors[ord - 1] ?? 1.0);
    const capacity_i = baselineE1RM * Fi;

    let rawEffectiveLoad_i = 0;
    if (ord === 1) {
      rawEffectiveLoad_i = anchor.rawAnchorWeight;
    } else {
      const mult = rpeMathGetRTSMultiplier(targetReps, targetRPE) ?? 1;
      rawEffectiveLoad_i = capacity_i * mult;
    }

    if (mod === 'assisted') {
      const sessionBW = resolveSessionBodyweightInUnit(bodyweightSnapshot, activeUnit);
      if (!sessionBW || sessionBW <= 0) {
        return null;
      }
      const proj = projectAssistedTarget({
        targetEffectiveLoad: rawEffectiveLoad_i,
        sessionBodyweight: sessionBW,
        targetReps,
        targetRPE,
        unit: activeUnit,
        increment: 2.5,
      });

      if (proj.status === 'bypassed') {
        return null;
      }

      targetsByOrdinal.set(ord, {
        weight: proj.assistanceWeight,
        reps: proj.reps,
        rpe: proj.rpe,
        form: 'standard',
      });
    } else if (mod === 'bodyweight') {
      const sessionBW = resolveSessionBodyweightInUnit(bodyweightSnapshot, activeUnit);
      if (!sessionBW || sessionBW <= 0) {
        return null;
      }
      const mult = rpeMathGetRTSMultiplier(targetReps, targetRPE) ?? 1;
      const targetE1RM_i = rawEffectiveLoad_i / mult;

      const bounds = getPermittedRepetitionBounds({
        objective,
        algorithmId: anchor.algorithmId,
        isIsolation: anchor.movementCategory === 'isolation',
        isMachine: anchor.equipment === 'machine',
        anchorReps: targetReps,
      });

      const solved = solveBodyweightRepTarget({
        targetE1RM: targetE1RM_i,
        sessionBodyweight: sessionBW,
        targetRPE,
        anchorReps: targetReps,
        minReps: bounds.minReps,
        maxReps: bounds.maxReps,
        unit: activeUnit,
      });

      if (solved.status === 'bypassed') {
        return null;
      }

      targetsByOrdinal.set(ord, {
        weight: 0,
        reps: solved.reps,
        rpe: solved.rpe,
        form: 'standard',
      });
    } else {
      // Weighted modality
      targetsByOrdinal.set(ord, {
        weight: t.weight,
        reps: t.reps,
        rpe: t.rpe,
        form: 'standard',
      });
    }
  }

  return targetsByOrdinal;
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
  bodyweightSnapshot?: BodyweightSnapshot | null;
  activeUnit?: WeightUnit;
  programId?: string | null;
  dayNum?: number | string | null;
  targetDate?: string | null;
  occurrenceOrdinal?: number;
}

/**
 * Applies the Strength, Hypertrophy, or Deload algorithm to an exercise's sets.
 * Baseline Precedence:
 * 1. Contextual baseline e1RM from previous completed workout logs (resolveContextualPrescriptionBaselineE1RM).
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
    templateExercise,
    bodyweightSnapshot,
    activeUnit = 'kg',
    programId,
    dayNum,
    targetDate,
    occurrenceOrdinal,
  } = params;

  if (objective === 'Off' || exercise.isSkipped) {
    return exercise.sets;
  }

  const nonWarmupSets = (exercise.sets || []).filter(s => !s.isWarmup);
  const workingSetCount = nonWarmupSets.length;
  if (workingSetCount <= 0) {
    return exercise.sets;
  }

  const targetsByOrdinal = generateSessionTargetMap({
    objective,
    exercise,
    workingSetCount,
    weekNum,
    programDuration,
    previousLogs,
    algorithmId,
    templateExercise,
    bodyweightSnapshot,
    activeUnit,
    programId,
    dayNum,
    targetDate,
    occurrenceOrdinal,
  });

  if (!targetsByOrdinal) {
    return exercise.sets;
  }

  // Derive anchor information for warmup calculation on weighted exercises
  const resolution = objective !== 'Deload' ? resolveSessionDistribution({
    objective,
    exercise,
    workingSetCount,
    weekNum,
    programDuration,
    previousLogs,
    algorithmId,
    templateExercise,
    bodyweightSnapshot,
    activeUnit,
    programId,
    dayNum,
    targetDate,
    occurrenceOrdinal,
  }) : null;
  const roundedAnchorWeight = resolution?.roundedAnchorWeight || (targetsByOrdinal.get(1)?.weight || 0);
  const anchorReps = resolution?.anchorReps || (targetsByOrdinal.get(1)?.reps || 10);

  const warmupSets = exercise.sets.filter(s => s.isWarmup);
  const warmupCount = warmupSets.length;

  let workingOrdinalCounter = 0;
  let warmupIndexCounter = 0;

  // Target-only merge into exercise sets preserving all other metadata
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

      if (exercise.modality === 'bodyweight' || exercise.modality === 'assisted') {
        // Keep warmups ordinal-neutral
        return set;
      }

      if (objective === 'Deload') {
        const workingTargetWeight = targetsByOrdinal.get(1)?.weight || 0;
        const workingTargetReps = targetsByOrdinal.get(1)?.reps || 8;
        const targetWeight = workingTargetWeight > 0 ? roundToNearest25(workingTargetWeight * (0.5 + activeWIdx * 0.2)) : 0;
        return {
          ...set,
          reps: workingTargetReps,
          rpe: 4.0,
          weight: targetWeight,
          form: 'strict' as const,
        };
      }

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
        form: objective === 'Deload' ? 'strict' : set.form,
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
  templateExercise?: ExerciseEntry | null;
  bodyweightSnapshot?: BodyweightSnapshot | null;
  activeUnit?: WeightUnit;
  programId?: string | null;
  dayNum?: number | string | null;
  targetDate?: string | null;
  occurrenceOrdinal?: number;
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
 * Calculates the prescribed target for an added working set (Phase 2B-1 / Stage 2B).
 * Delegates directly to canonical Stage 2A target generation path to guarantee parity.
 * Does not mutate or recalculate existing sets.
 *
 * Rules:
 * 1. Determines the added working-set ordinal (ignores warmups).
 * 2. If ordinal > 6, returns unprescribed default (isPrescribed: false).
 * 3. Asks canonical target generation path for target sequence up through targetWorkingOrdinal.
 * 4. Extracts ONLY the target for targetWorkingOrdinal.
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
    bodyweightSnapshot,
    activeUnit = 'kg',
    programId,
    dayNum,
    targetDate,
    occurrenceOrdinal,
  } = params;

  // 1. Calculate the new working-set ordinal (warmups do not consume working-set ordinals)
  const currentWorkingSets = (exercise.sets || []).filter(s => !s.isWarmup);
  const targetWorkingOrdinal = currentWorkingSets.length + 1;

  // 2. Safe ceiling check: maximum 6 prescribed working sets
  if (targetWorkingOrdinal > 6) {
    return {
      isPrescribed: false,
      workingSetOrdinal: targetWorkingOrdinal,
    };
  }

  // 3. Delegate directly to the canonical Stage 2A target generation path
  const targetMap = generateSessionTargetMap({
    objective,
    exercise,
    workingSetCount: targetWorkingOrdinal,
    weekNum,
    programDuration,
    previousLogs,
    algorithmId,
    templateExercise,
    bodyweightSnapshot,
    activeUnit,
    programId,
    dayNum,
    targetDate,
    occurrenceOrdinal,
  });

  if (!targetMap) {
    return {
      isPrescribed: false,
      workingSetOrdinal: targetWorkingOrdinal,
    };
  }

  const target = targetMap.get(targetWorkingOrdinal);
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
      form: target.form,
    },
    workingSetOrdinal: targetWorkingOrdinal,
  };
}
