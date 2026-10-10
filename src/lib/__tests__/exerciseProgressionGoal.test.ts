import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExerciseEntry, Program, WorkoutLog } from '../../types';
import { buildExerciseProgressionGoal, progressionGoalSetLabel, type ProgressionGoalInput } from '../exerciseProgressionGoal';
import { orchestrateGuidedExercisePrescription } from '../guidedWorkoutOrchestrator';
import { calculateObjectiveSets } from '../objectiveMath';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const curl: ExerciseEntry = {
  name: 'Hammer Curl', muscleGroup: 'Biceps', exerciseKey: 'hammer-curl', modality: 'weighted',
  movementCategory: 'isolation', equipment: 'freeweight',
  sets: [{ setNumber: 1, weight: 12.5, reps: 15, rpe: 8 }, { setNumber: 2, weight: 12.5, reps: 13, rpe: 8.5 }, { setNumber: 3, weight: 12.5, reps: 12, rpe: 9 }],
};
const program: Program = {
  id: 'curl-program', name: 'Curl program', createdAt: '2026-01-01T00:00:00Z', daysPerWeek: 2, programDuration: 12,
  objective: 'Hypertrophy', algorithmId: 'hypertrophy_linear', targetProgressionMode: 'metreps_guided', exercisesByDay: { 1: [curl], 2: [curl] },
};
function input(overrides: Partial<ProgressionGoalInput> = {}): ProgressionGoalInput {
  return clone({ program, programs: [program], exercises: [curl], exerciseIndex: 0, objective: 'Hypertrophy', week: 1, day: 1,
    date: '2026-10-09', unit: 'kg', bodyweightSnapshot: null, workoutLogs: [],
    chronology: { mode: 'active_live', sessionStartedAt: Date.parse('2026-10-09T10:00:00Z'), targetLogId: null }, ...overrides });
}
function ready(source: ProgressionGoalInput) {
  const goal = buildExerciseProgressionGoal(source);
  expect(goal.status).toBe('ready');
  if (goal.status !== 'ready') throw new Error(goal.reason);
  return goal;
}
afterEach(() => vi.useRealTimers());

describe('read-only exercise progression goal', () => {
  it('shows all normal working sets at every remaining scheduled occurrence, excluding unrelated exercises and earlier days', () => {
    const exercises = [{ ...curl, sets: [{ setNumber: 1, weight: 5, reps: 10, isWarmup: true }, ...curl.sets.map(s => ({ ...s, setNumber: s.setNumber + 1 })), { setNumber: 5, weight: 5, reps: 10, isDropSet: true }] }];
    const p = { ...program, exercisesByDay: { 1: exercises, 2: [{ ...curl, exerciseKey: 'other', name: 'Other' }], 3: exercises } };
    const goal = ready(input({ program: p, exercises, week: 3, day: 1 }));
    expect(goal.current.sets.map(s => s.setNumber)).toEqual([2, 3, 4]);
    expect(goal.sessions.map(s => [s.week, s.day])).toEqual(Array.from({ length: 19 }, (_, i) => i === 0 ? [3, 3] : [4 + Math.floor((i - 1) / 2), (i - 1) % 2 === 0 ? 1 : 3]));
    expect(goal.sessions.every(s => s.sets.length === 3)).toBe(true);
  });

  it.each(([
    ['Hypertrophy', 'hypertrophy_linear', 12], ['Hypertrophy', 'hypertrophy_step', 12],
    ['Strength', 'strength_undulating', 4], ['Strength', 'strength_undulating', 8], ['Strength', 'strength_undulating', 12], ['Strength', 'strength_linear', 12],
  ] as const).flatMap(([objective, algorithmId, duration]) => (['metreps_guided', 'performance_led'] as const).flatMap(mode => [0, 4].map(offset => ({ objective, algorithmId, duration, mode, offset })))))('matches successive fresh workouts: $objective / $algorithmId / $duration weeks / $mode / offset $offset', ({ objective, algorithmId, duration, mode, offset }) => {
    // Independent production orchestrator, with actual completed logs between
    // fresh workouts, verifies the entire pathway rather than copied arithmetic.
    vi.useFakeTimers();
    const ex: ExerciseEntry = objective === 'Strength' ? { ...clone(curl), isMainMovement: true, movementCategory: 'compound', sets: curl.sets.map(s => ({ ...s, weight: 100, reps: 6 })) } : clone(curl);
    const p: Program = { ...program, objective, algorithmId, programDuration: duration, algorithmPhaseOffset: offset, targetProgressionMode: mode, exercisesByDay: { 1: [ex], 2: [ex] } };
    const goal = ready(input({ program: p, programs: [p], exercises: [ex], objective }));
    let time = Date.parse('2026-10-09T23:59:00Z');
    const history: WorkoutLog[] = [{ id: `log-${time}-actual-current`, date: '2026-10-09', programId: p.id, week: '1', day: '1', objective, unit: 'kg', exercises: [{ ...ex, sets: ex.sets.map(s => ({ ...s, isCompleted: true, form: 'standard' })) }] }];
    let previous = ex;
    for (const forecast of goal.sessions) {
      time += 86_400_000;
      const date = new Date(time).toISOString().slice(0, 10);
      vi.setSystemTime(time);
      const exercise = { ...ex, sets: previous.sets.map(s => ({ ...s, prescriptionSnapshot: null, isCompleted: false })) };
      const actualSets = mode === 'performance_led' ? calculateObjectiveSets({
        exercise, templateExercise: ex, objective, weekNum: forecast.week, programDuration: duration, previousLogs: history,
        activeUnit: 'kg', bodyweightSnapshot: null, programId: p.id, algorithmId, algorithmPhaseOffset: offset,
        exerciseIndex: 0, occurrenceOrdinal: 0, dayNum: forecast.day, targetDate: date,
        targetChronology: { mode: 'active_live', sessionStartedAt: time, targetLogId: null, displayedDate: date },
      }) : orchestrateGuidedExercisePrescription({
        exercise, templateExercise: ex, program: p, programs: [p], historicalLogs: history,
        lifecycleEvidence: { originProvenance: 'session_template_init', isHistoricalEdit: false, isRedoSession: false, isRestoredFromDraft: false, evaluationState: { status: 'not_evaluated' }, exerciseIndex: 0 },
        boundary: { sessionStartedAt: time, prescriptionTargetDate: date }, sessionKind: { type: 'active_program_session', weekNum: forecast.week },
        activeUnit: 'kg', bodyweightSnapshot: null, objective, weekNum: forecast.week, programDuration: duration, dayNum: forecast.day, targetDate: date,
      }).appliedSets;
      expect(forecast.sets).toEqual(actualSets.map(s => ({ setNumber: s.setNumber, weight: s.weight, reps: s.reps, rpe: s.rpe })));
      previous = { ...ex, sets: actualSets.map(s => ({ ...s, isCompleted: true, form: 'standard' })) };
      history.push({ id: `log-${time}-actual`, date, programId: p.id, objective, week: String(forecast.week), day: String(forecast.day), unit: 'kg', exercises: [previous] });
    }
  });

  it('preserves rep progression, challenge holds, and scheduled rep/RPE waves for a small curl load', () => {
    const goal = ready(input());
    expect(goal.sessions.slice(0, 3).every(s => s.coachingReason === 'BASE_PRESCRIPTION')).toBe(true);
    expect(goal.sessions.some(s => s.coachingReason === 'REP_NUDGE')).toBe(true);
    expect(goal.sessions.some(s => s.coachingReason === 'CHALLENGE_CAP_HOLD')).toBe(true);
    expect(goal.sessions.filter(s => s.week % 2 === 1).every(s => s.sets[0].reps === 15)).toBe(true);
    expect(goal.sessions.filter(s => s.week % 2 === 0).every(s => s.sets[0].reps === 10)).toBe(true);
    expect(goal.sessions.every(s => s.sets.every(set => set.weight % 2.5 === 0))).toBe(true);
    // The 15 kg low-rep week is a scheduled change, not 20% new capacity.
    expect(goal.sessions[1].sets[0]).toMatchObject({ weight: 15, reps: 10, rpe: 8 });
    expect(goal.sessions[3].sets[0]).toMatchObject({ weight: 12.5, reps: 15, rpe: 8 });
  });

  it('keeps step-out weeks and high-exertion strength holds', () => {
    const step = ready(input({ program: { ...program, algorithmId: 'hypertrophy_step' } }));
    expect(step.sessions.filter(s => s.week % 4 === 0).every(s => s.coachingReason === 'STEP_OUT_BASE_ONLY')).toBe(true);
    const ex = { ...curl, isMainMovement: true, movementCategory: 'compound' as const, sets: curl.sets.map(s => ({ ...s, weight: 100, reps: 6 })) };
    const strength = ready(input({ objective: 'Strength', exercises: [ex], program: { ...program, objective: 'Strength', algorithmId: 'strength_linear', exercisesByDay: { 1: [ex], 2: [ex] } } }));
    expect(strength.sessions.some(s => s.coachingReason === 'HIGH_EXERTION_HOLD')).toBe(true);
    expect(strength.sessions.at(-1)?.sets[0]).toMatchObject({ reps: 1, rpe: 10 });
  });

  it('leaves coaching off in performance-led programs and omits non-main Strength days', () => {
    const base = ready(input({ program: { ...program, targetProgressionMode: 'performance_led' } }));
    expect(base.guided).toBe(false);
    expect(base.sessions.every(s => s.coachingReason === null && !s.coachingUnavailable)).toBe(true);
    const main = { ...curl, isMainMovement: true, sets: curl.sets.map(s => ({ ...s, weight: 100, reps: 6 })) };
    const goal = ready(input({ objective: 'Strength', exercises: [main], program: { ...program, objective: 'Strength', algorithmId: 'strength_linear', exercisesByDay: { 1: [main], 2: [{ ...main, isMainMovement: false }] } } }));
    expect(goal.sessions).toHaveLength(11);
    expect(goal.sessions.every(s => s.day === 1)).toBe(true);
  });

  it('never unlocks factual future logs or the historical workout being edited as its virtual timeline advances', () => {
    const future: WorkoutLog = { id: 'log-1791849600000-future', date: '2026-10-13', programId: program.id, week: '2', day: '1', objective: 'Hypertrophy', unit: 'kg', exercises: [{ ...curl, sets: curl.sets.map(s => ({ ...s, weight: 1000, isCompleted: true })) }] };
    expect(ready(input({ workoutLogs: [future] }))).toEqual(ready(input()));
    const edited = { ...future, id: 'edited', date: '2026-10-09' };
    expect(ready(input({ workoutLogs: [edited, future], chronology: { mode: 'historical_edit', targetLogId: 'edited', displayedDate: edited.date } }))).toEqual(ready(input()));
  });

  it('is deterministic without clock or storage use and leaves deep-frozen inputs and snapshots untouched', () => {
    const source = input();
    const before = JSON.stringify(source);
    function freeze(value: unknown) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } }
    freeze(source);
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('Clock used'); });
    const first = ready(source);
    expect(ready(source)).toEqual(first);
    expect(JSON.stringify(source)).toBe(before);
    expect(JSON.stringify(first)).not.toContain('prescriptionSnapshot');
    clock.mockRestore();
  });

  it.each(['bodyweight', 'assisted'] as const)('uses constant bodyweight and valid %s loads', modality => {
    const ex = { ...curl, modality, equipment: 'machine' as const, sets: curl.sets.map(s => ({ ...s, weight: modality === 'bodyweight' ? 0 : 20 })) };
    const goal = ready(input({ exercises: [ex], bodyweightSnapshot: { value: 80, unit: 'kg' }, program: { ...program, exercisesByDay: { 1: [ex], 2: [ex] } } }));
    expect(goal.sessions.every(s => s.sets.every(set => modality === 'bodyweight' ? set.weight === 0 : set.weight > 0 && set.weight < 80))).toBe(true);
    expect(progressionGoalSetLabel(goal.current.sets[0], modality, 'kg')).toContain(modality === 'bodyweight' ? 'BW ×' : 'kg assist ×');
  });

  it('normalizes mixed-unit historical evidence and displays active-unit targets', () => {
    const prior: WorkoutLog = { id: 'log-1791417600000-prior', date: '2026-10-08', programId: program.id, week: '1', day: '1', objective: 'Hypertrophy', unit: 'kg', exercises: [{ ...curl, sets: curl.sets.map(s => ({ ...s, isCompleted: true, form: 'standard' })) }] };
    const lbPrior = { ...prior, unit: 'lb' as const, exercises: prior.exercises.map(ex => ({ ...ex, sets: ex.sets.map(s => ({ ...s, weight: s.weight! / 0.45359237 })) })) };
    expect(ready(input({ workoutLogs: [lbPrior] }))).toEqual(ready(input({ workoutLogs: [prior] })));
    const ex = { ...curl, sets: curl.sets.map(s => ({ ...s, weight: s.weight! / 0.45359237 })) };
    const goal = ready(input({ unit: 'lb', exercises: [ex], workoutLogs: [prior] }));
    expect(progressionGoalSetLabel(goal.sessions[0].sets[0], 'weighted', 'lb')).toContain('lb ×');
  });

  it('offers a rolling view for infinite programs and labels a limited view of long programs', () => {
    const rolling = ready(input({ program: { ...program, programDuration: '∞' }, week: 5 }));
    expect(rolling).toMatchObject({ rolling: true, limited: false, endWeek: 16 });
    const long = ready(input({ program: { ...program, programDuration: 80, targetProgressionMode: 'performance_led' } }));
    expect(long).toMatchObject({ rolling: false, limited: true, endWeek: 52 });
    expect(ready(input({ week: 12, day: 2 })).sessions).toEqual([]);
  });

  it.each([
    { objective: 'Off' }, { objective: 'Deload' }, { program: null },
    { objective: 'Strength' }, { exercises: [{ ...curl, modality: 'timed' }] },
    { exercises: [{ ...curl, sets: [{ setNumber: 1, weight: 0, reps: 12, rpe: 8 }] }] },
    { exercises: [{ ...curl, sets: [{ setNumber: 1, weight: 12.5, reps: 12 }] }] },
    { exercises: [{ ...curl, modality: 'bodyweight', sets: [{ setNumber: 1, weight: 0, reps: 12, rpe: 8 }] }] },
    { program: { ...program, objective: 'Off' } }, { program: { ...program, algorithmId: 'strength_linear' } },
    { exercises: [curl, curl] }, { program: { ...program, exercisesByDay: { 1: [curl], 2: [curl, curl] } } },
  ] as Partial<ProgressionGoalInput>[])('fails honestly when no complete unambiguous model is available: %j', overrides => {
    expect(buildExerciseProgressionGoal(input(overrides)).status).toBe('unavailable');
  });
});
