import React, { useMemo, useState } from 'react';
import type { GuidedCoachingReasonCode } from '../types';
import { storage } from '../lib/storage';
import { buildExerciseProgressionGoal, progressionGoalSetLabel, type ProgressionGoalInput, type ProgressionGoalSession } from '../lib/exerciseProgressionGoal';

const algorithmNames = { hypertrophy_linear: 'Wave Volume', hypertrophy_step: 'Step Loading', strength_undulating: 'Wave Strength', strength_linear: 'Linear Periodisation' };
const coachingCopy: Record<GuidedCoachingReasonCode, string> = {
  BASE_PRESCRIPTION: 'Program targets; building or maintaining qualification.',
  REP_NUDGE: 'Coaching adds a repetition.',
  LOAD_NUDGE_MAIN_MOVEMENT: 'Coaching increases the main movement load.',
  LOAD_PROMOTION_CEILING_REACHED: 'Coaching promotes the load after the rep ceiling.',
  CHALLENGE_CAP_HOLD: 'Coaching holds the target within its challenge limit.',
  HIGH_EXERTION_HOLD: 'High-RPE phase; coaching holds further increases.',
  STEP_OUT_BASE_ONLY: 'Planned step-out week; program targets only.',
  BODYWEIGHT_CEILING_HOLD: 'Bodyweight rep ceiling reached.',
  BODYWEIGHT_MAIN_LOAD_HOLD: 'Bodyweight main movement; load increase unavailable.',
  MINIMUM_ASSISTANCE_REACHED: 'Minimum assistance reached.',
  MISSING_BODYWEIGHT_HOLD: 'Coaching needs a session bodyweight.',
  INVALID_ASSISTANCE_HOLD: 'Coaching cannot use this assistance value.',
  ZERO_NET_LOAD_HOLD: 'Coaching needs a positive effective load.',
  MARGINAL_MISS_TARGET_HELD: 'Previous performance requires a hold.',
  NUDGE_NEUTRAL_RETRY: 'Coaching retries the previous increase.',
  NUDGE_MARGINAL_FAILURE_ROLLBACK: 'Coaching returns to the previous target.',
  NUDGE_SUBSTANTIAL_FAILURE_ROLLBACK: 'Coaching returns to the previous target.',
  DEGRADED_HISTORY_HOLD: 'Coaching is rebuilding qualification from usable history.',
  INCONSISTENT_HISTORY_HOLD: 'Coaching holds while its history is inconsistent.',
};

export function ExerciseProgressionGoal(props: Omit<ProgressionGoalInput, 'programs'>) {
  // Snapshot saved metadata once on opening, including main-movement changes made
  // during this workout. Timer rerenders must not recalculate the whole pathway.
  const [programs] = useState(() => storage.getPrograms());
  const program = programs.find(p => p.id === props.program?.id) ?? props.program;
  const goal = useMemo(() => buildExerciseProgressionGoal({ ...props, program, programs }), [
    program, programs, props.exercises, props.exerciseIndex, props.objective, props.week, props.day,
    props.date, props.unit, props.bodyweightSnapshot, props.workoutLogs, props.chronology,
  ]);
  const exercise = props.exercises[props.exerciseIndex];
  if (goal.status === 'unavailable') return <div className="p-4 space-y-3 text-slate-100"><h3 className="font-bold break-words">{exercise?.name}</h3><p className="text-sm text-slate-400">{goal.reason}</p></div>;
  const endpoint = goal.sessions.at(-1) ?? goal.current;
  const setLabel = (set: ProgressionGoalSession['sets'][number]) => progressionGoalSetLabel(set, exercise.modality, props.unit);
  const renderSets = (entry: ProgressionGoalSession) => <ol className="space-y-1 text-sm font-mono" aria-label={`Working sets for week ${entry.week} day ${entry.day}`}>
    {entry.sets.map(set => <li key={set.setNumber} className="flex flex-wrap gap-x-2"><span className="text-slate-400">Set {set.setNumber}</span><span>{setLabel(set)}</span></li>)}
  </ol>;
  return <div className="p-4 space-y-5 text-slate-100 break-words">
    <section className="space-y-2">
      <h3 className="font-bold leading-snug">{exercise.name}</h3>
      <p className="text-xs text-slate-400">{goal.objective} · {algorithmNames[goal.algorithm]} · {goal.guided ? 'Coaching on' : 'Performance-led'}</p>
      <p className="text-sm text-slate-300">Assuming consistent recovery and technique, and every working set completed at its assigned RPE.</p>
      <p className="text-xs text-slate-400">These are conditional program targets. Actual performance can change the pathway.</p>
      {props.objective !== goal.objective && <p className="text-xs text-slate-400">Future workouts follow the saved program’s {goal.objective} goal.</p>}
    </section>

    <section className="border-y border-slate-800 py-3 space-y-1" aria-labelledby="progression-goal-endpoint">
      <h3 id="progression-goal-endpoint" className="text-xs font-bold uppercase tracking-wide text-slate-400">{goal.sessions.length === 0 ? 'This workout target' : goal.rolling || goal.limited ? 'At the end of this view' : 'Final workout target'}</h3>
      <p className="font-mono font-bold text-indigo-300">{setLabel(endpoint.sets[0])}</p>
      <p className="text-xs text-slate-400">Week {endpoint.week} · Day {endpoint.day} · First working set</p>
    </section>

    <section className="space-y-2" aria-labelledby="progression-goal-current">
      <h3 id="progression-goal-current" className="text-sm font-bold">This workout · Week {goal.current.week} · Day {goal.current.day}</h3>
      {renderSets(goal.current)}
    </section>

    <section className="space-y-3" aria-labelledby="progression-goal-road">
      <h3 id="progression-goal-road" className="text-sm font-bold">{goal.rolling ? '12-week rolling view' : goal.limited ? `Road ahead through week ${goal.endWeek}` : 'Remaining program workouts'}</h3>
      {goal.rolling && <p className="text-xs text-slate-400">This program has no end date. The view covers this week and the next 11 program weeks.</p>}
      {goal.limited && <p className="text-xs text-slate-400">Showing up to 52 program weeks. This is not the program’s final target.</p>}
      {goal.sessions.length === 0 ? <p className="text-sm text-slate-400">No further workouts for this exercise are scheduled.</p> : goal.sessions.map((entry, index) => <div key={index} className="border-t border-slate-800 pt-3 space-y-1.5">
        <h4 className="text-xs font-bold text-indigo-300">Week {entry.week} · Day {entry.day}</h4>
        {renderSets(entry)}
        {entry.coachingReason && <p className="text-xs text-slate-400">{coachingCopy[entry.coachingReason]}</p>}
        {entry.coachingUnavailable && <p className="text-xs text-slate-400">Program targets shown; coaching could not qualify this exercise.</p>}
      </div>)}
    </section>

    <p className="text-xs leading-relaxed text-slate-400">{goal.guided
      ? 'Rep and load increases follow the existing coaching qualification, rep ceilings and challenge limits.'
      : 'Performance-led targets follow your current estimated capacity and the program’s rep and RPE schedule.'} Weights can decrease on higher-rep or lower-RPE weeks.</p>
    {(exercise.modality === 'bodyweight' || exercise.modality === 'assisted') && <p className="text-xs text-slate-400">The projection holds session bodyweight constant.</p>}
  </div>;
}
