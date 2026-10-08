import type { ExerciseEntry, WorkoutLog } from '../types';
import { resolveExerciseKey } from './exerciseIdentity';
import { getCanonicalSetE1RMKg, parseStrictIdTimestamp } from './diaryExercisePRs';
import { getLocalDateString, parseLocalDate } from './dateUtils';

export interface PRSession {
  log: WorkoutLog;
  logIndex: number;
  bestKg: number | null;
  exerciseIndex: number | null;
  setIndex: number | null;
  sameDayOrdinal: number;
}
export interface ExercisePRReportData {
  unsupported: boolean;
  record: PRSession | null;
  recent: PRSession[];
}

/** Saved history only. Array indices, never IDs/names, identify exact provenance. */
export function buildExercisePRReport(
  logs: readonly WorkoutLog[], target: Pick<ExerciseEntry, 'name' | 'exerciseKey' | 'modality'>,
  throughDate = getLocalDateString(new Date()),
): ExercisePRReportData {
  const unsupported = ['timed', 'distance', 'distance_loaded'].includes(target.modality || 'weighted');
  const key = resolveExerciseKey(target);
  if (unsupported || !key) return { unsupported, record: null, recent: [] };
  const sessions = logs.map((log, logIndex) => ({ log, logIndex }))
    .filter(({ log }) => log && /^\d{4}-\d{2}-\d{2}$/.test(log.date)
      && getLocalDateString(parseLocalDate(log.date)) === log.date && log.date <= throughDate)
    .sort((a, b) => {
      if (a.log.date !== b.log.date) return a.log.date < b.log.date ? -1 : 1;
      const at = parseStrictIdTimestamp(a.log.id), bt = parseStrictIdTimestamp(b.log.id);
      return at !== null && bt !== null && at !== bt ? at - bt : a.logIndex - b.logIndex;
    });
  const matching: PRSession[] = [];
  const ordinals = new Map<string, number>();
  let record: PRSession | null = null;
  for (const { log, logIndex } of sessions) {
    const session: PRSession = { log, logIndex, bestKg: null, exerciseIndex: null, setIndex: null, sameDayOrdinal: 1 };
    let contains = false;
    (log.exercises || []).forEach((exercise, exerciseIndex) => {
      if (!exercise || resolveExerciseKey(exercise) !== key) return;
      contains = true;
      if (exercise.isSkipped) return;
      (exercise.sets || []).forEach((set, setIndex) => {
        const value = getCanonicalSetE1RMKg(log, exercise, set);
        if (value !== null && (session.bestKg === null || value > session.bestKg + 0.001)) {
          session.bestKg = value; session.exerciseIndex = exerciseIndex; session.setIndex = setIndex;
        }
      });
    });
    if (!contains) continue;
    session.sameDayOrdinal = (ordinals.get(log.date) || 0) + 1;
    ordinals.set(log.date, session.sameDayOrdinal);
    matching.push(session);
    if (session.bestKg !== null && (record === null || session.bestKg > record.bestKg! + 0.001)) record = session;
  }
  return { unsupported, record, recent: matching.slice(-6) };
}
