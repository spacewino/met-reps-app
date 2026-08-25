import { ExerciseEntry, SetEntry, WorkoutLog, BodyweightSnapshot, WeightUnit } from '../types';
import { getExerciseClassification } from './exerciseClassification';
import { getTodayLocalDateString } from './dateUtils';
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
import {
  deriveColdStartPlannedCapacityE1RM,
  deriveColdStartObservedCapacityE1RM,
  deriveColdStartOrdinalShape,
} from './coldStartCalibration';

// Re-export roundToNearest25 for backward compatibility with existing imports
export { roundToNearest25 } from './weightMath';

// Export RTS_RPE_PERCENT as an alias to DEFAULT_RTS_STYLE_PERCENT_1RM for compatibility
export const RTS_RPE_PERCENT = DEFAULT_RTS_STYLE_PERCENT_1RM;

interface StrengthProfileWeek {
  reps: number;
  targetRPE: number;
  target1RMPercent?: number;
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

const STRENGTH_PROFILES: Record<number, Record<number, { reps: number; targetRPE: number }>> = {
  4: {
    1: { reps: 5, targetRPE: 7.0 },
    2: { reps: 4, targetRPE: 8.0 },
    3: { reps: 3, targetRPE: 9.0 },
    4: { reps: 1, targetRPE: 10.0 },
  },
  8: {
    1: { reps: 5, targetRPE: 7.0 },
    2: { reps: 5, targetRPE: 8.0 },
    3: { reps: 5, targetRPE: 9.0 },
    4: { reps: 3, targetRPE: 7.5 },
    5: { reps: 3, targetRPE: 8.5 },
    6: { reps: 2, targetRPE: 8.0 },
    7: { reps: 2, targetRPE: 9.0 },
    8: { reps: 1, targetRPE: 10.0 },
  },
  12: {
    1: { reps: 5, targetRPE: 7.0 },
    2: { reps: 5, targetRPE: 8.0 },
    3: { reps: 5, targetRPE: 8.5 },
    4: { reps: 5, targetRPE: 9.0 },
    5: { reps: 3, targetRPE: 7.5 },
    6: { reps: 3, targetRPE: 8.0 },
    7: { reps: 3, targetRPE: 9.0 },
    8: { reps: 2, targetRPE: 8.0 },
    9: { reps: 2, targetRPE: 8.5 },
    10: { reps: 2, targetRPE: 9.5 },
    11: { reps: 1, targetRPE: 9.0 },
    12: { reps: 1, targetRPE: 10.0 },
  }
};

/**
 * Resolves the weekly strength undulating profile:
 * - 4-week duration: defined 4-week profile
 * - 8-week duration or undefined: defined 8-week profile
 * - 12-week duration: defined 12-week profile
 * - Unsupported custom durations (e.g. 6, 10): returns null to safely bypass automatic target generation
 */
export function getUndulatingProfileWeek(
  weekNum: number,
  programDuration?: number
): StrengthProfileWeek | null {
  // If undefined or null, default to 8-week defined profile
  const effectiveDuration = (programDuration === undefined || programDuration === null) ? 8 : programDuration;

  // Supported defined durations: 4, 8, 12
  if (effectiveDuration === 4 || effectiveDuration === 8 || effectiveDuration === 12) {
    const profile = STRENGTH_PROFILES[effectiveDuration];
    const activeWeek = Math.max(1, Math.min(weekNum, effectiveDuration));
    const base = profile[activeWeek] || profile[1];
    const target1RMPercent = rpeMathGetRTSMultiplier(base.reps, base.targetRPE) ?? 1.0;
    return {
      reps: base.reps,
      targetRPE: base.targetRPE,
      target1RMPercent,
    };
  }

  // Unsupported custom durations (e.g. 6, 10):
  // Do NOT modulo-wrap. Safely bypass automatic transformation.
  return null;
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

export type PrescriptionTargetChronology =
  | {
      mode: 'active_live';
      sessionStartedAt: number;
      targetLogId: null;
      displayedDate?: string | null;
    }
  | {
      mode: 'historical_edit';
      targetLogId: string;
      displayedDate?: string | null;
    }
  | {
      mode: 'retrospective_new';
      targetLogId: null;
      displayedDate: string;
      explicitTargetTimestamp?: number | null;
    };

export interface ContextualPrescriptionBaselineOptions {
  programId?: string | null;
  targetDay?: number | string | null;
  targetDate?: string | null;
  targetLogId?: string | null;
  targetChronology?: PrescriptionTargetChronology | null;
  sessionStartedAt?: number | null;
  explicitTargetTimestamp?: number | null;
  occurrenceOrdinal?: number;
  modality?: ExerciseEntry['modality'];
  activeUnit?: WeightUnit;
  bodyweightSnapshot?: BodyweightSnapshot | null;
}

/**
 * Resolves a unified PrescriptionTargetChronology descriptor from options.
 */
export function resolveTargetChronology(
  optionsOrTargetLogId?: ContextualPrescriptionBaselineOptions | string | null,
  targetDateParam?: string | null,
  sessionStartedAtParam?: number | null,
  explicitTargetTimestampParam?: number | null
): PrescriptionTargetChronology {
  let targetChronology: PrescriptionTargetChronology | null | undefined = null;
  let targetLogId: string | null = null;
  let displayedDate: string | null = null;
  let sessionStartedAt: number | null = null;
  let explicitTargetTimestamp: number | null = null;

  if (typeof optionsOrTargetLogId === 'object' && optionsOrTargetLogId !== null) {
    targetChronology = optionsOrTargetLogId.targetChronology;
    targetLogId = optionsOrTargetLogId.targetLogId ? String(optionsOrTargetLogId.targetLogId).trim() : null;
    displayedDate = optionsOrTargetLogId.targetDate ? String(optionsOrTargetLogId.targetDate).trim() : null;
    sessionStartedAt = optionsOrTargetLogId.sessionStartedAt ?? null;
    explicitTargetTimestamp = optionsOrTargetLogId.explicitTargetTimestamp ?? null;
  } else {
    targetLogId = optionsOrTargetLogId ? String(optionsOrTargetLogId).trim() : null;
    displayedDate = targetDateParam ? String(targetDateParam).trim() : null;
    sessionStartedAt = sessionStartedAtParam ?? null;
    explicitTargetTimestamp = explicitTargetTimestampParam ?? null;
  }

  if (targetChronology) {
    return targetChronology;
  }

  if (targetLogId) {
    return {
      mode: 'historical_edit',
      targetLogId,
      displayedDate,
    };
  }

  const todayStr = getTodayLocalDateString();
  const effectiveSessionStart = sessionStartedAt ?? Date.now();

  if (displayedDate && displayedDate < todayStr) {
    return {
      mode: 'retrospective_new',
      targetLogId: null,
      displayedDate,
      explicitTargetTimestamp,
    };
  }

  return {
    mode: 'active_live',
    sessionStartedAt: effectiveSessionStart,
    targetLogId: null,
    displayedDate: displayedDate || todayStr,
  };
}

/**
 * Safely extracts a numeric millisecond timestamp from a log's explicit time, full ISO datetime, or numeric ID.
 * Returns null if the log has only a plain date (YYYY-MM-DD) without time-of-day evidence or if the time is invalid.
 */
export function extractLogEffectiveTimestampMs(
  log?: { id?: string | null; date?: string | null; startTime?: string | null } | null
): number | null {
  if (!log) return null;

  // 1. Strict startTime validation and extraction
  if (log.startTime && typeof log.startTime === 'string') {
    const rawTime = log.startTime.trim();
    const timeMatch = rawTime.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (timeMatch) {
      const hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);
      const seconds = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;

      // Strict range validation: hours 0-23, minutes 0-59, seconds 0-59 (values like 25:90 must NOT roll over)
      if (
        hours >= 0 && hours <= 23 &&
        minutes >= 0 && minutes <= 59 &&
        seconds >= 0 && seconds <= 59
      ) {
        if (log.date && typeof log.date === 'string') {
          const dateTrimmed = log.date.trim();
          // Plain date format YYYY-MM-DD
          if (/^\d{4}-\d{2}-\d{2}$/.test(dateTrimmed)) {
            const pad = (n: number) => n.toString().padStart(2, '0');
            const isoCombined = `${dateTrimmed}T${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
            const d = new Date(isoCombined);
            const ts = d.getTime();
            if (Number.isFinite(ts) && ts > 0) {
              return ts;
            }
          }
        }
      }
    }
  }

  // 2. Timestamp-bearing MetReps ID extraction (e.g. 'log-1724400000000', '1724400000000', 'log-1724400000000-abc')
  if (log.id && typeof log.id === 'string') {
    const str = log.id.trim();
    const match = str.match(/^(?:log-)?(\d{10,16})/);
    if (match) {
      const parsed = parseInt(match[1], 10);
      // Valid epoch timestamp in ms between year 2020 (1577836800000) and year 2100 (4102444800000)
      if (Number.isFinite(parsed) && parsed > 1577836800000 && parsed < 4102444800000) {
        return parsed;
      }
    }
  }

  // 3. Full ISO datetime parsing ONLY when date contains an explicit time component (e.g. "2026-08-23T14:30:00.000Z")
  if (log.date && typeof log.date === 'string') {
    const dateTrimmed = log.date.trim();
    const isoDateTimeMatch = dateTrimmed.match(/^\d{4}-\d{2}-\d{2}[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (isoDateTimeMatch) {
      const hours = parseInt(isoDateTimeMatch[1], 10);
      const minutes = parseInt(isoDateTimeMatch[2], 10);
      const seconds = isoDateTimeMatch[3] ? parseInt(isoDateTimeMatch[3], 10) : 0;
      if (
        hours >= 0 && hours <= 23 &&
        minutes >= 0 && minutes <= 59 &&
        seconds >= 0 && seconds <= 59
      ) {
        const parsed = Date.parse(dateTrimmed);
        if (Number.isFinite(parsed) && parsed > 1577836800000) {
          return parsed;
        }
      }
    }
  }

  // Plain dates (e.g. "2026-08-23") without startTime or timestamp ID return null
  return null;
}

/**
 * Pure helper to determine whether a candidate WorkoutLog occurred prior to the target workout session.
 * Consistently applied to Tier 1, Tier 2, and Tier 3 contextual baseline evaluation.
 */
export function isCandidateLogChronologicallyEligible(
  candidate: WorkoutLog,
  chronology?: PrescriptionTargetChronology | null,
  logs: WorkoutLog[] = []
): boolean {
  if (!candidate || !candidate.date) {
    return false;
  }

  if (!chronology) {
    return true; // Backward compatibility fallback
  }

  const candidateDate = candidate.date.trim();
  const targetDate = (chronology.displayedDate || '').trim();

  // Case 1: Candidate is on a strictly FUTURE calendar date relative to target date
  if (candidateDate > targetDate) {
    return false;
  }

  // Case 2: Candidate is on a strictly EARLIER calendar date relative to target date
  if (candidateDate < targetDate) {
    return true;
  }

  // Case 3: Candidate is on the EXACT SAME calendar date as target date
  // Mode A: historical_edit
  if (chronology.mode === 'historical_edit') {
    // 1. Self-exclusion: target workout itself is never eligible baseline evidence
    if (candidate.id && candidate.id === chronology.targetLogId) {
      return false;
    }

    // 2. Resolve the unique permanent target log in logs
    const matchingTargets = logs.filter(l => l && l.id && l.id === chronology.targetLogId);
    if (matchingTargets.length !== 1) {
      // Missing target log (0) or duplicate target IDs (> 1) -> fail closed
      return false;
    }

    const targetLog = matchingTargets[0];
    const targetTs = extractLogEffectiveTimestampMs(targetLog);
    if (targetTs === null) {
      // Historical target without resolvable time -> fail closed for same-day
      return false;
    }

    const candidateTs = extractLogEffectiveTimestampMs(candidate);
    if (candidateTs === null) {
      // Same-day candidate without resolvable time -> fail closed
      return false;
    }

    return candidateTs < targetTs;
  }

  // Mode B: active_live
  if (chronology.mode === 'active_live') {
    const candidateTs = extractLogEffectiveTimestampMs(candidate);
    if (candidateTs !== null) {
      return candidateTs < chronology.sessionStartedAt;
    }
    // Candidate with date only or unresolvable timestamp -> fail closed on same day to prevent unverified leakage
    return false;
  }

  // Mode C: retrospective_new
  if (chronology.mode === 'retrospective_new') {
    if (chronology.explicitTargetTimestamp !== undefined && chronology.explicitTargetTimestamp !== null) {
      const candidateTs = extractLogEffectiveTimestampMs(candidate);
      if (candidateTs !== null) {
        return candidateTs < chronology.explicitTargetTimestamp;
      }
      return false;
    }
    // Without explicit target timestamp for retrospective entry, same-day logs cannot be proven earlier -> fail closed
    return false;
  }

  return false;
}

/**
 * Safely extracts a numeric timestamp from a log ID (e.g. 'log-1724398123456', '1724398123456', 'log-1724398123456-abc' -> 1724398123456).
 */
export function extractTimestampFromLogId(id?: string | null): number | null {
  return extractLogEffectiveTimestampMs({ id: id || undefined });
}

/**
 * Safely extracts a numeric timestamp from a log's startTime or createdAt ISO string/timestamp.
 */
export function extractTimestampFromLogTime(log: WorkoutLog): number | null {
  return extractLogEffectiveTimestampMs(log);
}

/**
 * Deterministically compares logs chronologically descending (newest first).
 */
export const compareLogsChronologicalDesc = (a: WorkoutLog, b: WorkoutLog): number => {
  const dateComp = (b.date || '').localeCompare(a.date || '');
  if (dateComp !== 0) return dateComp;

  const timeA = extractLogEffectiveTimestampMs(a);
  const timeB = extractLogEffectiveTimestampMs(b);
  if (timeA !== null && timeB !== null && timeA !== timeB) {
    return timeB - timeA;
  }

  const schedComp = (b.scheduledDate || '').localeCompare(a.scheduledDate || '');
  if (schedComp !== 0) return schedComp;

  const idComp = (b.id || '').localeCompare(a.id || '');
  if (idComp !== 0) return idComp;

  return 0;
};

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
  const activeUnit = options?.activeUnit || 'kg';

  const targetChronology = resolveTargetChronology(options);

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

  // TIER 1 & TIER 2: Same-program matching
  if (targetProgramId) {
    const sameProgramLogs = logs.filter(l => {
      if (!isCandidateLogChronologicallyEligible(l, targetChronology, logs)) return false;
      if (!l.programId || String(l.programId).trim() !== targetProgramId) return false;
      const logW = parseLogWeek(l.week);
      return logW !== null && logW < targetWeekNum;
    });

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
  const eligibleCrossProgramLogs = logs.filter(log => {
    if (!isCandidateLogChronologicallyEligible(log, targetChronology, logs)) return false;

    // Exclude logs from current program if week is >= targetWeek
    if (targetProgramId && log.programId && String(log.programId).trim() === targetProgramId) {
      const logW = parseLogWeek(log.week);
      if (logW === null || logW >= targetWeekNum) return false;
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
export function resolveEffectiveAlgorithm(
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
  targetLogId?: string | null;
  targetChronology?: PrescriptionTargetChronology | null;
  sessionStartedAt?: number | null;
  explicitTargetTimestamp?: number | null;
  occurrenceOrdinal?: number;
}

export interface PrescriptionShape {
  anchorReps: number;
  anchorRPE: number;
  profileType: FatiguePriorProfile;
}

/**
 * Pure helper to derive the canonical algorithm prescription shape (reps, RPE, and fatigue profile)
 * for Hypertrophy and Strength objectives across supported program weeks and durations.
 * Does not require or fabricate baseline load or e1RM.
 */
export function deriveCanonicalPrescriptionShape(params: {
  objective: 'Hypertrophy' | 'Strength';
  effectiveAlgorithmId: 'hypertrophy_linear' | 'hypertrophy_step' | 'strength_undulating' | 'strength_linear';
  exercise: ExerciseEntry;
  weekNum: number;
  programDuration?: number;
}): PrescriptionShape | null {
  const { objective, effectiveAlgorithmId, exercise, weekNum, programDuration = 8 } = params;
  const classification = getExerciseClassification(exercise);
  const isIsolation = classification.category === 'isolation';
  const isMachine = classification.equipment === 'machine';

  let anchorReps = 10;
  let anchorRPE = 8.0;
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
    profileType = 'hypertrophy';
  } else if (objective === 'Strength') {
    if (effectiveAlgorithmId === 'strength_linear') {
      const maxWeek = programDuration || 8;
      const activeWeek = Math.min(weekNum, maxWeek);
      const progress = maxWeek > 1 ? (activeWeek - 1) / (maxWeek - 1) : 0;

      anchorReps = Math.max(1, Math.round(8 - progress * 7));
      anchorRPE = Math.round((7.0 + progress * 3.0) * 2) / 2;
    } else {
      // strength_undulating (Default)
      const weekProfile = getUndulatingProfileWeek(weekNum, programDuration);
      if (!weekProfile) {
        return null;
      }

      anchorReps = weekProfile.reps;
      anchorRPE = weekProfile.targetRPE;
    }

    if (anchorReps === 1 && anchorRPE >= 9.5) {
      profileType = 'strength_post_test';
    } else {
      profileType = 'strength_normal';
    }
  }

  return { anchorReps, anchorRPE, profileType };
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
    targetLogId,
    targetChronology,
    sessionStartedAt,
    explicitTargetTimestamp,
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
      targetLogId,
      targetChronology,
      sessionStartedAt,
      explicitTargetTimestamp,
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

  const shape = deriveCanonicalPrescriptionShape({
    objective: objective as 'Hypertrophy' | 'Strength',
    effectiveAlgorithmId,
    exercise,
    weekNum,
    programDuration,
  });

  if (!shape) {
    return { isBypassed: true };
  }

  const { anchorReps, anchorRPE, profileType } = shape;
  let rawAnchorWeight = 0;
  let roundedAnchorWeight = 0;

  const multiplier = rpeMathGetRTSMultiplier(anchorReps, anchorRPE);
  if (multiplier === null || !Number.isFinite(multiplier) || multiplier <= 0) {
    return { isBypassed: true };
  }

  rawAnchorWeight = baselineE1RM * multiplier;
  roundedAnchorWeight = roundToNearest25(rawAnchorWeight);

  if (objective === 'Strength') {
    // Boundary check against canonical RPE-10 capacity:
    const max10Multiplier = rpeMathGetRTSMultiplier(anchorReps, 10.0) ?? 1.0;
    const max10Weight = baselineE1RM * max10Multiplier;
    if (roundedAnchorWeight > max10Weight + 1e-6) {
      roundedAnchorWeight = Math.floor((max10Weight + 1e-6) / 2.5) * 2.5;
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

  const classification = getExerciseClassification(exercise);
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
  targetLogId?: string | null;
  targetChronology?: PrescriptionTargetChronology | null;
  sessionStartedAt?: number | null;
  explicitTargetTimestamp?: number | null;
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
    targetLogId,
    targetChronology,
    sessionStartedAt,
    explicitTargetTimestamp,
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
      targetLogId,
      targetChronology,
      sessionStartedAt,
      explicitTargetTimestamp,
      occurrenceOrdinal,
      modality: mod,
      activeUnit,
    }
  );
  const baselineE1RM = historicalE1RM > 0 ? historicalE1RM : extractTemplateBaselineE1RM(templateExercise || undefined, bodyweightSnapshot, activeUnit);

  if (baselineE1RM <= 0) {
    // Stage 1: Zero-Baseline Algorithm Guidance
    // Only weighted modality (or undefined) is eligible
    if (mod !== undefined && mod !== 'weighted') {
      return null;
    }

    if (objective !== 'Hypertrophy' && objective !== 'Strength') {
      return null;
    }

    if (objective === 'Strength' && !exercise.isMainMovement) {
      return null;
    }

    const effectiveAlgorithmId = resolveEffectiveAlgorithm(objective, algorithmId);
    if (!effectiveAlgorithmId) {
      return null;
    }

    const shape = deriveCanonicalPrescriptionShape({
      objective,
      effectiveAlgorithmId,
      exercise,
      weekNum,
      programDuration,
    });

    if (!shape) {
      return null;
    }

    const { anchorReps, anchorRPE, profileType } = shape;
    const count = Math.min(workingSetCount, 6);
    const zeroMap = new Map<number, CanonicalTargetEntry>();

    if (profileType === 'hypertrophy') {
      for (let ord = 1; ord <= count; ord++) {
        zeroMap.set(ord, {
          weight: 0,
          reps: anchorReps,
          rpe: anchorRPE,
          form: 'standard',
        });
      }
    } else if (profileType === 'strength_post_test') {
      zeroMap.set(1, {
        weight: 0,
        reps: 1,
        rpe: anchorRPE,
        form: 'standard',
      });
      const backoffRPESchedule = [7.5, 8.0, 8.0, 8.5, 8.5];
      for (let ord = 2; ord <= count; ord++) {
        zeroMap.set(ord, {
          weight: 0,
          reps: 3,
          rpe: backoffRPESchedule[ord - 2] ?? 8.5,
          form: 'standard',
        });
      }
    } else {
      // strength_normal
      zeroMap.set(1, {
        weight: 0,
        reps: anchorReps,
        rpe: anchorRPE,
        form: 'standard',
      });
      const backoffBaseRPE = Math.max(6.0, Math.min(8.0, anchorRPE - 1.0));
      for (let ord = 2; ord <= count; ord++) {
        const targetRPE_i = Math.min(anchorRPE, 8.5, backoffBaseRPE + 0.5 * (ord - 2));
        zeroMap.set(ord, {
          weight: 0,
          reps: anchorReps,
          rpe: targetRPE_i,
          form: 'standard',
        });
      }
    }

    return zeroMap;
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
    targetLogId,
    targetChronology,
    sessionStartedAt,
    explicitTargetTimestamp,
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
  targetLogId?: string | null;
  targetChronology?: PrescriptionTargetChronology | null;
  sessionStartedAt?: number | null;
  explicitTargetTimestamp?: number | null;
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
    targetLogId,
    targetChronology,
    sessionStartedAt,
    explicitTargetTimestamp,
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
    targetLogId,
    targetChronology,
    sessionStartedAt,
    explicitTargetTimestamp,
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
    targetLogId,
    targetChronology,
    sessionStartedAt,
    explicitTargetTimestamp,
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

export interface AddedSetCommittedEvidenceEntry {
  workingSetOrdinal: number;
  weight: number;
  reps: number;
  rpe: number;
  form?: 'standard' | 'strict' | 'loose';
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
  targetLogId?: string | null;
  targetChronology?: PrescriptionTargetChronology | null;
  sessionStartedAt?: number | null;
  explicitTargetTimestamp?: number | null;
  occurrenceOrdinal?: number;
  committedEvidence?: AddedSetCommittedEvidenceEntry[];
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
 * 4. If baselineE1RM <= 0, applies the 4-tier Cold-Start Active-Session Authority:
 *    Tier 1: Explicitly committed same-exercise evidence on Working Set 1
 *    Tier 2: Positive provisional current-session planning anchor on Working Set 1
 *    Tier 3: Zero-load canonical prescription shape
 *    Tier 4: Unprescribed fallback
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
    targetLogId,
    targetChronology,
    sessionStartedAt,
    explicitTargetTimestamp,
    occurrenceOrdinal,
    committedEvidence = [],
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

  // 3. Baseline extraction check
  const historicalE1RM = resolveContextualPrescriptionBaselineE1RM(
    exercise.name,
    weekNum,
    previousLogs,
    {
      programId,
      targetDay: dayNum,
      targetDate,
      targetLogId,
      targetChronology,
      sessionStartedAt,
      explicitTargetTimestamp,
      occurrenceOrdinal,
      modality: exercise.modality,
      activeUnit,
    }
  );
  const baselineE1RM = historicalE1RM > 0 ? historicalE1RM : extractTemplateBaselineE1RM(templateExercise || undefined, bodyweightSnapshot, activeUnit);

  if (baselineE1RM > 0) {
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
      targetLogId,
      targetChronology,
      sessionStartedAt,
      explicitTargetTimestamp,
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

  // 4. Cold-Start Active-Session Calibration Authority (when baselineE1RM <= 0)
  // Gated to weighted modality (or undefined) for Hypertrophy and Strength (main movement only)
  const mod = exercise.modality;
  if (mod !== undefined && mod !== 'weighted') {
    return {
      isPrescribed: false,
      workingSetOrdinal: targetWorkingOrdinal,
    };
  }

  if (objective !== 'Hypertrophy' && objective !== 'Strength') {
    return {
      isPrescribed: false,
      workingSetOrdinal: targetWorkingOrdinal,
    };
  }

  if (objective === 'Strength' && !exercise.isMainMovement) {
    return {
      isPrescribed: false,
      workingSetOrdinal: targetWorkingOrdinal,
    };
  }

  const effectiveAlgorithmId = resolveEffectiveAlgorithm(objective, algorithmId);
  if (!effectiveAlgorithmId) {
    return {
      isPrescribed: false,
      workingSetOrdinal: targetWorkingOrdinal,
    };
  }

  const ordinalShape = deriveColdStartOrdinalShape({
    objective,
    algorithmId: effectiveAlgorithmId,
    exercise,
    weekNum,
    programDuration,
    ordinal: targetWorkingOrdinal,
  });

  if (!ordinalShape) {
    return {
      isPrescribed: false,
      workingSetOrdinal: targetWorkingOrdinal,
    };
  }

  const fatiguePriors = getFatiguePrior(ordinalShape.profileType);
  const fatigueFactor = fatiguePriors[targetWorkingOrdinal - 1] ?? 1.0;
  const ordinalMult = rpeMathGetRTSMultiplier(ordinalShape.reps, ordinalShape.rpe);

  // Tier 1: Valid explicitly committed same-exercise evidence on Working Set 1
  const ev1 = committedEvidence.find(e => e.workingSetOrdinal === 1);
  if (
    ev1 &&
    typeof ev1.weight === 'number' &&
    ev1.weight > 0 &&
    typeof ev1.reps === 'number' &&
    ev1.reps > 0 &&
    typeof ev1.rpe === 'number' &&
    ev1.rpe >= 6.0 &&
    ev1.rpe <= 10.0 &&
    ev1.form !== 'loose'
  ) {
    const observedCap = deriveColdStartObservedCapacityE1RM(ev1.weight, ev1.reps, ev1.rpe);
    if (observedCap && observedCap > 0 && ordinalMult && ordinalMult > 0) {
      const rawTargetLoad = observedCap * fatigueFactor * ordinalMult;
      const roundedTargetLoad = roundToNearest25(rawTargetLoad);
      return {
        isPrescribed: true,
        target: {
          weight: roundedTargetLoad,
          reps: ordinalShape.reps,
          rpe: ordinalShape.rpe,
          form: ordinalShape.form,
        },
        workingSetOrdinal: targetWorkingOrdinal,
      };
    }
  }

  // Tier 2: Valid positive provisional current-session planning anchor on Working Set 1
  const ws1 = currentWorkingSets[0];
  if (
    ws1 &&
    typeof ws1.weight === 'number' &&
    ws1.weight > 0 &&
    typeof ws1.reps === 'number' &&
    ws1.reps > 0 &&
    typeof ws1.rpe === 'number' &&
    ws1.rpe >= 6.0 &&
    ws1.rpe <= 10.0
  ) {
    const ws1Shape = deriveColdStartOrdinalShape({
      objective,
      algorithmId: effectiveAlgorithmId,
      exercise,
      weekNum,
      programDuration,
      ordinal: 1,
    });
    if (ws1Shape) {
      const plannedCap = deriveColdStartPlannedCapacityE1RM(ws1.weight, ws1Shape.reps, ws1Shape.rpe);
      if (plannedCap && plannedCap > 0 && ordinalMult && ordinalMult > 0) {
        const rawTargetLoad = plannedCap * fatigueFactor * ordinalMult;
        const roundedTargetLoad = roundToNearest25(rawTargetLoad);
        return {
          isPrescribed: true,
          target: {
            weight: roundedTargetLoad,
            reps: ordinalShape.reps,
            rpe: ordinalShape.rpe,
            form: ordinalShape.form,
          },
          workingSetOrdinal: targetWorkingOrdinal,
        };
      }
    }
  }

  // Tier 3: Zero-load canonical prescription shape
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
    targetLogId,
    targetChronology,
    sessionStartedAt,
    explicitTargetTimestamp,
    occurrenceOrdinal,
  });

  if (targetMap) {
    const target = targetMap.get(targetWorkingOrdinal);
    if (target) {
      return {
        isPrescribed: true,
        target: {
          weight: 0,
          reps: target.reps,
          rpe: target.rpe,
          form: target.form,
        },
        workingSetOrdinal: targetWorkingOrdinal,
      };
    }
  }

  // Tier 4: Unprescribed fallback
  return {
    isPrescribed: false,
    workingSetOrdinal: targetWorkingOrdinal,
  };
}

