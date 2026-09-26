import { WorkoutLog, ExerciseEntry, SetEntry, WeightUnit } from '../types';
import { resolveSetEffectiveLoad } from './effectiveLoad';
import { resolveExerciseKey } from './exerciseIdentity';
import { getLocalDateString, parseLocalDate } from './dateUtils';

export interface ExercisePRResult {
  isPR: boolean;
  est1RM: number | null;
  effectiveLoad: number | null;
  reps: number | null;
  unit: WeightUnit;
}

export type ExercisePRMap = Record<string, boolean>; // key: `${logId}_${exerciseIndex}_${setIndex}` -> isPR

/**
 * Parses an ID timestamp only if it strictly matches exactly 12+ digits or 'log-' followed by 12+ digits.
 */
function parseStrictIdTimestamp(id: string | null | undefined): number | null {
  if (!id) return null;
  const digitsOnlyMatch = id.match(/^\d{12,}$/);
  if (digitsOnlyMatch) {
    const n = Number(id);
    return Number.isFinite(n) ? n : null;
  }
  const logPrefixedMatch = id.match(/^log-(\d{12,})$/);
  if (logPrefixedMatch) {
    const n = Number(logPrefixedMatch[1]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export interface WorkoutE1RMPRCount {
  readonly originalIndex: number;
  readonly count: number;
}

/** Canonical set eligibility and two-decimal Epley value used by PR history. */
function getCanonicalSetE1RMKg(
  log: WorkoutLog,
  exercise: ExerciseEntry,
  set: SetEntry,
): number | null {
  if (!set || set.isSkipped === true || set.isWarmup === true || set.isCompleted === false) return null;
  if (typeof set.reps !== 'number' || !Number.isInteger(set.reps) || set.reps <= 0) return null;
  const load = resolveSetEffectiveLoad(set.weight, exercise.modality || 'weighted', log.unit, log.bodyweightSnapshot);
  if (load.status !== 'valid' || load.effectiveLoadKg === null || load.effectiveLoadKg <= 0) return null;
  const rawE1RM = set.reps === 1 ? load.effectiveLoadKg : load.effectiveLoadKg * (1 + set.reps / 30);
  return Math.round(rawE1RM * 100) / 100;
}

/**
 * Counts workout-level e1RM PR events using the Diary PR engine's canonical
 * effective-load, Epley, two-decimal and strict-improvement semantics.
 *
 * A single chronological pass includes history before any displayed analytics
 * window. Exercise identity uses the authoritative exercise key (with the
 * canonical legacy-name fallback). On the same local date, epoch-like log IDs
 * order sessions; legacy IDs fall back to their stable input order, matching
 * the existing Diary chronology.
 */
export function getWorkoutE1RMPRCounts(
  allLogs: readonly WorkoutLog[],
  throughDate: string,
): WorkoutE1RMPRCount[] {
  const isStrictLocalDate = (value: unknown): value is string => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return false;
    const raw = value.trim();
    return getLocalDateString(parseLocalDate(raw)) === raw;
  };
  const items = allLogs.map((log, originalIndex) => ({
    log, originalIndex, idTimestamp: parseStrictIdTimestamp(log?.id),
  })).filter(item => isStrictLocalDate(item.log?.date) && item.log.date <= throughDate);

  items.sort((a, b) => {
    if (a.log.date !== b.log.date) return a.log.date < b.log.date ? -1 : 1;
    if (a.idTimestamp !== null && b.idTimestamp !== null && a.idTimestamp !== b.idTimestamp) {
      return a.idTimestamp - b.idTimestamp;
    }
    return a.originalIndex - b.originalIndex;
  });

  const historicalBest = new Map<string, number>();
  const result: WorkoutE1RMPRCount[] = [];
  for (const { log, originalIndex } of items) {
    const workoutBest = new Map<string, number>();
    for (const exercise of log.exercises || []) {
      if (!exercise || exercise.isSkipped === true) continue;
      const identity = resolveExerciseKey(exercise);
      if (!identity) continue;
      for (const set of exercise.sets || []) {
        const roundedE1RM = getCanonicalSetE1RMKg(log, exercise, set);
        if (roundedE1RM === null) continue;
        if (roundedE1RM > (workoutBest.get(identity) ?? -Infinity)) workoutBest.set(identity, roundedE1RM);
      }
    }

    let count = 0;
    for (const [identity, best] of workoutBest) {
      const previous = historicalBest.get(identity);
      if (previous === undefined || best > previous + 0.001) count++;
      if (previous === undefined || best > previous) historicalBest.set(identity, best);
    }
    result.push({ originalIndex, count });
  }
  return result;
}

/**
 * Returns true if a date string is a valid ISO/calendar date.
 */
function isValidDate(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const epoch = Date.parse(dateStr);
  return Number.isFinite(epoch);
}

/**
 * Calculates whether a specific set in a workout log represents an all-time PR
 * considering strictly preceding workout logs in deterministic Diary chronology.
 *
 * Chronology:
 * 1. Valid calendar date.
 * 2. On the same calendar day, strict epoch-like timestamp IDs (^\d{12,}$ or ^log-\d{12,}$).
 * 3. Fallback to original array order for arbitrary same-day IDs.
 * 4. Duplicate IDs are omitted from the resulting PR map to prevent ambiguity.
 * 5. Invalid-date logs are safely isolated from valid chronological history.
 *
 * Uses Epley estimation on canonical effective load:
 * est1RM = effectiveLoadKg * (1 + reps / 30)  (when reps > 1, else effectiveLoadKg)
 */
export function generateExercisePRMap(allLogs: WorkoutLog[]): ExercisePRMap {
  const prMap: ExercisePRMap = {};
  if (!Array.isArray(allLogs) || allLogs.length === 0) {
    return prMap;
  }

  // Detect duplicate log IDs
  const idCounts = new Map<string, number>();
  allLogs.forEach(log => {
    if (log && log.id) {
      idCounts.set(log.id, (idCounts.get(log.id) || 0) + 1);
    }
  });

  interface LogItem {
    log: WorkoutLog;
    originalIndex: number;
    dateEpoch: number | null;
    idTimestamp: number | null;
  }

  const validItems: LogItem[] = [];

  allLogs.forEach((log, originalIndex) => {
    if (!log) return;
    const isDateVal = isValidDate(log.date);
    const idTime = parseStrictIdTimestamp(log.id);

    if (isDateVal || idTime !== null) {
      validItems.push({
        log,
        originalIndex,
        dateEpoch: isDateVal ? Date.parse(log.date) : null,
        idTimestamp: idTime,
      });
    }
  });

  // Sort valid items in exact deterministic chronological order
  validItems.sort((a, b) => {
    const aDateValid = a.dateEpoch !== null;
    const bDateValid = b.dateEpoch !== null;

    if (aDateValid && bDateValid) {
      if (a.dateEpoch !== b.dateEpoch) {
        return a.dateEpoch! - b.dateEpoch!;
      }
      if (a.idTimestamp !== null && b.idTimestamp !== null && a.idTimestamp !== b.idTimestamp) {
        return a.idTimestamp - b.idTimestamp;
      }
      return a.originalIndex - b.originalIndex;
    }

    const aEffectiveTime = a.idTimestamp !== null ? a.idTimestamp : a.dateEpoch!;
    const bEffectiveTime = b.idTimestamp !== null ? b.idTimestamp : b.dateEpoch!;

    if (aEffectiveTime !== bEffectiveTime) {
      return aEffectiveTime - bEffectiveTime;
    }

    return a.originalIndex - b.originalIndex;
  });

  // Track all-time best Epley e1RM in canonical kg per normalized exercise name
  const bestE1RMKgByExercise: Record<string, number> = {};

  for (const { log } of validItems) {
    const isAmbiguous = !log.id || (idCounts.get(log.id) || 0) > 1;
    const exercises = Array.isArray(log.exercises) ? log.exercises : [];

    for (let exIdx = 0; exIdx < exercises.length; exIdx++) {
      const ex = exercises[exIdx];
      if (!ex || ex.isSkipped === true) continue;

      const normName = (ex.name || '').trim().toLowerCase();
      if (!normName) continue;

      const sets = Array.isArray(ex.sets) ? ex.sets : [];

      for (let setIdx = 0; setIdx < sets.length; setIdx++) {
        const s = sets[setIdx];
        if (!s) continue;
        const roundedE1RMKg = getCanonicalSetE1RMKg(log, ex, s);
        if (roundedE1RMKg === null) continue;

        const currentBest = bestE1RMKgByExercise[normName];

        let isPR = false;
        if (currentBest === undefined) {
          // First exposure with valid mass load: is a baseline PR
          bestE1RMKgByExercise[normName] = roundedE1RMKg;
          isPR = true;
        } else if (roundedE1RMKg > currentBest + 0.001) {
          // Strictly exceeds previous all-time best
          bestE1RMKgByExercise[normName] = roundedE1RMKg;
          isPR = true;
        }

        if (isPR && !isAmbiguous) {
          prMap[`${log.id}_${exIdx}_${setIdx}`] = true;
        }
      }
    }
  }

  return prMap;
}
