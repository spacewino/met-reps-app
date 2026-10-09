import type { BodyweightSnapshot, ExerciseEntry, GuidedCoachingReasonCode, Program, SetEntry, WeightUnit, WorkoutLog } from '../types';
import {
  calculateObjectivePrescriptionBundle, compareLogsChronologicalDesc, extractLogEffectiveTimestampMs,
  getExerciseOccurrenceOrdinal, isCandidateLogChronologicallyEligible, normalizeExerciseName,
  resolveEffectiveAlgorithm, type PrescriptionTargetChronology,
} from './objectiveMath';
import { resolveProgramProgressionMode } from './programProgressionMode';
import { isPrescribedWorkingSet } from './guidedRuntimeAdapter';
import { orchestrateGuidedExercisePrescription, validatePrescribedSnapshotsCoherence } from './guidedWorkoutOrchestrator';
import { resolveGuidedComparisonLoad } from './adaptiveProgressionMath';
import { isValidRPE } from './rpeMath';
import { convertWeightUnit } from './assistedLoadMath';
import { isValidIsoCalendarDate } from './workoutDraftBoundary';

export interface ProgressionGoalInput {
  program: Program | null;
  programs: readonly Program[];
  exercises: readonly ExerciseEntry[];
  exerciseIndex: number;
  objective: 'Off' | 'Hypertrophy' | 'Strength' | 'Deload';
  week: number;
  day: number;
  date: string;
  unit: WeightUnit;
  bodyweightSnapshot: BodyweightSnapshot | null;
  workoutLogs: readonly WorkoutLog[];
  chronology: PrescriptionTargetChronology;
}

export interface ProgressionGoalSession {
  week: number;
  day: number;
  sets: { setNumber: number; weight: number; reps: number; rpe: number }[];
  coachingReason: GuidedCoachingReasonCode | null;
  coachingUnavailable: boolean;
}

export type ProgressionGoal = { status: 'unavailable'; reason: string } | {
  status: 'ready';
  current: ProgressionGoalSession;
  sessions: ProgressionGoalSession[];
  objective: 'Hypertrophy' | 'Strength';
  algorithm: NonNullable<ReturnType<typeof resolveEffectiveAlgorithm>>;
  guided: boolean;
  rolling: boolean;
  limited: boolean;
  endWeek: number;
};

export function progressionGoalUnavailableReason(objective: ProgressionGoalInput['objective'], exercise: ExerciseEntry, hasProgram: boolean): string | null {
  if (objective !== 'Hypertrophy' && objective !== 'Strength') return 'Prog Goal is available with a Hypertrophy or Strength goal.';
  if (!hasProgram) return 'A program is needed to project its remaining workouts.';
  if (objective === 'Strength' && !exercise.isMainMovement) return 'Strength projections apply to designated main movements only.';
  if (exercise.modality && !['weighted', 'bodyweight', 'assisted'].includes(exercise.modality)) return 'This exercise modality has no automatic progression model.';
  return null;
}

const workingSets = (exercise: ExerciseEntry) => exercise.sets.filter(set => isPrescribedWorkingSet(set) && !set.isSkipped);
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

function validSets(exercise: ExerciseEntry, unit: WeightUnit, bodyweight: BodyweightSnapshot | null): boolean {
  const sets = workingSets(exercise);
  return !exercise.isSkipped && sets.length > 0 && sets.length <= 6 && sets.every(set =>
    Number.isInteger(set.reps) && set.reps! > 0 && isValidRPE(set.rpe) &&
    resolveGuidedComparisonLoad({ modality: exercise.modality || 'weighted', weight: set.weight, unit, bodyweight }).eligible
  );
}

function sameExercise(a: ExerciseEntry, b: ExerciseEntry): boolean {
  if ((a.modality || 'weighted') !== (b.modality || 'weighted')) return false;
  if (a.exerciseKey && b.exerciseKey) return a.exerciseKey === b.exerciseKey;
  return normalizeExerciseName(a.name) === normalizeExerciseName(b.name);
}

function session(exercise: ExerciseEntry, week: number, day: number, coachingReason: GuidedCoachingReasonCode | null = null, coachingUnavailable = false): ProgressionGoalSession {
  return { week, day, coachingReason, coachingUnavailable, sets: workingSets(exercise).map(set => ({
    setNumber: set.setNumber, weight: set.weight ?? 0, reps: set.reps!, rpe: set.rpe!,
  })) };
}

/**
 * Conditional projection: complete the current targets and each future prescription
 * at its assigned RPE, then feed those completions into the existing target engines.
 * All projected history is private to this call. No storage, clock, target updates,
 * synthetic growth percentage, or durable coaching credits are used here.
 */
export function buildExerciseProgressionGoal(input: ProgressionGoalInput): ProgressionGoal {
  const selected = input.exercises[input.exerciseIndex];
  if (!selected) return { status: 'unavailable', reason: 'Exercise not found.' };
  const unavailable = progressionGoalUnavailableReason(input.objective, selected, !!input.program);
  if (unavailable) return { status: 'unavailable', reason: unavailable };
  const program = copy(input.program!);
  // Future sessions use the saved program goal, just like a newly opened workout.
  const objective = program.objective ?? 'Hypertrophy';
  if (objective !== 'Hypertrophy' && objective !== 'Strength') return { status: 'unavailable', reason: 'The saved program needs a Hypertrophy or Strength goal.' };
  const algorithm = resolveEffectiveAlgorithm(objective, program.algorithmId);
  if (!algorithm) return { status: 'unavailable', reason: 'The program algorithm does not match its saved goal.' };
  if (!isValidIsoCalendarDate(input.date) || !Number.isInteger(input.week) || input.week < 1 || !Number.isInteger(input.day) || input.day < 1) {
    return { status: 'unavailable', reason: 'Valid program week, day, and workout date are needed.' };
  }
  if (!validSets(selected, input.unit, input.bodyweightSnapshot)) {
    return { status: 'unavailable', reason: 'Enter weight, reps, and a valid RPE for the normal working sets. Bodyweight and assisted exercises also need a session bodyweight. Up to six working sets can be projected.' };
  }
  const rolling = program.programDuration === '∞';
  const duration = rolling ? 8 : program.programDuration as number;
  if (!Number.isInteger(duration) || duration < 1 || (!rolling && input.week > duration)) return { status: 'unavailable', reason: 'The workout is outside the program duration.' };
  const endWeek = rolling ? input.week + 11 : Math.min(duration, input.week + 51);
  const limited = !rolling && endWeek < duration;
  const days = Object.keys(program.exercisesByDay).map(Number).filter(day => Number.isInteger(day) && day >= 1 && day <= 7).sort((a, b) => a - b);
  if (!days.includes(input.day)) return { status: 'unavailable', reason: 'The current program day is missing from the saved schedule.' };
  if (input.exercises.filter(exercise => sameExercise(selected, exercise)).length > 1 || days.some(day =>
    (day > input.day || endWeek > input.week) && program.exercisesByDay[day].filter(exercise => sameExercise(selected, exercise)).length > 1
  )) return { status: 'unavailable', reason: 'This exercise appears more than once in a workout. A single progression pathway cannot distinguish those entries reliably.' };

  const guided = resolveProgramProgressionMode(program) === 'metreps_guided';
  const programs = copy([...input.programs.filter(p => p.id !== program.id), program]);
  // Exclude the edited workout and factual future history before simulating any
  // future sessions. Later forecast boundaries must not unlock real future logs.
  const priorLogs = input.workoutLogs.filter(log => isCandidateLogChronologicallyEligible(log, input.chronology, input.workoutLogs as WorkoutLog[]));
  const history: WorkoutLog[] = copy(priorLogs);
  let time = priorLogs.reduce((latest, log) => Math.max(latest, extractLogEffectiveTimestampMs(log) ?? 0), Date.parse(`${input.date}T23:59:00Z`));
  const currentExercises = copy(input.exercises) as ExerciseEntry[];
  currentExercises.forEach((exercise, index) => exercise.sets.forEach(set => {
    set.isCompleted = index === input.exerciseIndex && isPrescribedWorkingSet(set) && !set.isSkipped;
    if (set.isCompleted) set.form = 'standard';
  }));
  // Incomplete or corrupt current coaching snapshots cannot invent qualification.
  if (!validatePrescribedSnapshotsCoherence(currentExercises[input.exerciseIndex].sets).coherent) {
    currentExercises[input.exerciseIndex].sets.forEach(set => { delete set.prescriptionSnapshot; });
  }
  const makeLog = (exercises: ExerciseEntry[], week: number, day: number): WorkoutLog => ({
    id: `log-${time}-prog-goal-${week}-${day}`, date: new Date(time).toISOString().slice(0, 10),
    programId: program.id, program: program.name, week: String(week), day: String(day),
    objective, unit: input.unit, bodyweightSnapshot: copy(input.bodyweightSnapshot), exercises,
  });
  history.push({ ...makeLog(currentExercises, input.week, input.day), objective: input.objective });
  const sessions: ProgressionGoalSession[] = [];

  for (let week = input.week; week <= endWeek; week++) for (const day of days) {
    if (week === input.week && day <= input.day) continue;
    time += 86_400_000;
    const date = new Date(time).toISOString().slice(0, 10);
    const templates = program.exercisesByDay[day];
    const projectedExercises: ExerciseEntry[] = copy(templates).map(exercise => ({ ...exercise, sets: exercise.sets.map(set => {
      delete set.prescriptionSnapshot;
      return { ...set, isCompleted: false };
    }) }));
    let matched = false;
    for (let index = 0; index < templates.length; index++) {
      const template = templates[index];
      if (!sameExercise(selected, template) || template.isSkipped || (objective === 'Strength' && !template.isMainMovement)) continue;
      matched = true;
      // Fresh workout prefill carries the latest sets, with the new day's exercise
      // metadata. Completion and prescription snapshots are not carried forward.
      const latest = [...history].sort(compareLogsChronologicalDesc).find(log => log.programId === program.id && log.exercises.some(ex => !ex.isSkipped && sameExercise(ex, template)));
      const previous = latest?.exercises.find(ex => !ex.isSkipped && sameExercise(ex, template));
      const exercise: ExerciseEntry = { ...copy(template), sets: copy(previous?.sets ?? template.sets).map(set => {
        delete set.prescriptionSnapshot;
        const weight = typeof set.weight === 'number' && latest ? convertWeightUnit(set.weight, latest.unit, input.unit) : set.weight;
        return { ...set, weight, isCompleted: false, isSkipped: false };
      }) };
      const targetChronology: PrescriptionTargetChronology = { mode: 'active_live', sessionStartedAt: time, targetLogId: null, displayedDate: date };
      const baseParams = {
        objective, exercise, exerciseIndex: index, weekNum: week, programDuration: duration,
        previousLogs: history, templateExercise: template, algorithmId: program.algorithmId,
        activeUnit: input.unit, bodyweightSnapshot: input.bodyweightSnapshot, programId: program.id, dayNum: day,
        targetDate: date, targetChronology,
        occurrenceOrdinal: getExerciseOccurrenceOrdinal(templates, index),
        predecessorProgramId: program.parentProgramId, algorithmPhaseOffset: program.algorithmPhaseOffset,
      };
      let applied: readonly SetEntry[];
      let completeModel = false;
      let reason: GuidedCoachingReasonCode | null = null;
      let coachingUnavailable = false;
      if (guided) {
        // Use the same fresh-workout entry point and metadata plumbing as the
        // Logger. Only chronology is supplied explicitly to avoid wall-clock use.
        const result = orchestrateGuidedExercisePrescription({
          exercise, templateExercise: template, program, programs, historicalLogs: history,
          objective, weekNum: week, programDuration: duration, dayNum: day, targetDate: date,
          boundary: { sessionStartedAt: time, prescriptionTargetDate: date },
          sessionKind: { type: 'active_program_session', weekNum: week }, activeUnit: input.unit, bodyweightSnapshot: input.bodyweightSnapshot,
          lifecycleEvidence: { originProvenance: 'session_template_init', isHistoricalEdit: false, isRedoSession: false, isRestoredFromDraft: false, evaluationState: { status: 'not_evaluated' }, exerciseIndex: index },
          calculateBundleFn: params => {
            const bundle = calculateObjectivePrescriptionBundle({ ...params, targetChronology });
            completeModel = !!bundle.periodisationLane;
            return bundle;
          },
        });
        applied = result.appliedSets;
        if (result.status === 'guided_adapter_result' && result.adapterResult.status === 'guided_applied') reason = result.adapterResult.coachingReasonCode;
        else coachingUnavailable = true;
      } else {
        const bundle = calculateObjectivePrescriptionBundle(baseParams);
        completeModel = !!bundle.periodisationLane;
        applied = bundle.baseSets;
      }
      if (!completeModel || !validSets({ ...exercise, sets: [...applied] }, input.unit, input.bodyweightSnapshot)) {
        return { status: 'unavailable', reason: 'The existing target model cannot generate a complete pathway for this program and exercise.' };
      }
      const projected = { ...exercise, sets: copy(applied) as SetEntry[] };
      sessions.push(session(projected, week, day, reason, coachingUnavailable));
      projected.sets.forEach(set => { set.isCompleted = isPrescribedWorkingSet(set); set.form = 'standard'; });
      projectedExercises[index] = projected;
    }
    if (matched) {
      // Unrelated template rows are not simulated as completed evidence.
      projectedExercises.forEach((exercise, index) => {
        if (!sameExercise(selected, templates[index]) || (objective === 'Strength' && !templates[index].isMainMovement)) {
          exercise.sets.forEach(set => { set.isCompleted = false; delete set.prescriptionSnapshot; });
        }
      });
      history.push(makeLog(projectedExercises, week, day));
    }
  }
  return { status: 'ready', current: session(selected, input.week, input.day), sessions, objective, algorithm, guided, rolling, limited, endWeek };
}

export function progressionGoalSetLabel(set: ProgressionGoalSession['sets'][number], modality: ExerciseEntry['modality'], unit: WeightUnit): string {
  const weight = Number(set.weight.toFixed(2));
  const load = modality === 'bodyweight' ? 'BW' : `${weight} ${unit}${modality === 'assisted' ? ' assist' : ''}`;
  return `${load} × ${set.reps} @ ${set.rpe} RPE`;
}
