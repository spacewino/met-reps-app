import React from 'react';
import type { ExerciseEntry, WeightUnit, WorkoutLog } from '../types';
import { buildExercisePRReport, PRSession } from '../lib/exercisePRReport';
import { WarmupIcon } from './WarmupIcon';
import { convertWeightUnit } from '../lib/assistedLoadMath';

const saved = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? String(value) : 'Unavailable';
const panel = 'border border-slate-800 p-3 space-y-3 min-w-0';
const badge = 'inline-block bg-selected-surface text-indigo-300 border border-indigo-400 px-2 py-0.5 text-xs font-bold';
const valueInUnit = (kg: number, unit: WeightUnit) => convertWeightUnit(kg, 'kg', unit).toFixed(2);
const sessionLabel = (s: PRSession) => `${s.log.date} · session ${s.sameDayOrdinal}`;

function ComparisonGraph({ sessions, prKg, unit }: { sessions: PRSession[]; prKg: number | null; unit: WeightUnit }) {
  const maximum = Math.max(prKg || 0, ...sessions.map(s => s.bestKg || 0));
  const y = (kg: number) => 140 - (maximum ? kg / maximum * 110 : 0);
  const x = (i: number) => sessions.length === 1 ? 160 : 30 + i * 260 / Math.max(1, sessions.length - 1);
  return <div className="space-y-2">
    <p className="text-sm text-slate-400">Best eligible e1RM per saved session ({unit}). Gaps mean unavailable.</p>
    {prKg !== null && <p className="text-sm font-bold text-indigo-300">Dashed line: all-time PR {valueInUnit(prKg, unit)} {unit}</p>}
    {sessions.length === 0 ? <p>No saved sessions.</p> : <>
      <svg viewBox="0 0 320 165" role="img" aria-label={`Last ${sessions.length} saved workouts compared with the all-time PR in ${unit}`} className="w-full text-indigo-300">
        <title>Saved session e1RM and all-time PR ({unit})</title>
        {prKg !== null && <g><line x1="20" x2="300" y1={y(prKg)} y2={y(prKg)} stroke="currentColor" strokeDasharray="5 4" /><text x="20" y={y(prKg) - 8} fill="currentColor" fontSize="11">PR {valueInUnit(prKg, unit)} {unit}</text></g>}
        {sessions.map((s, i) => <g key={s.logIndex}>
          {s.bestKg !== null && <>
            {i > 0 && sessions[i - 1].bestKg !== null && <line x1={x(i - 1)} y1={y(sessions[i - 1].bestKg!)} x2={x(i)} y2={y(s.bestKg)} stroke="currentColor" />}
            <circle cx={x(i)} cy={y(s.bestKg)} r="4" fill="currentColor"><title>{sessionLabel(s)}: {valueInUnit(s.bestKg, unit)} {unit}</title></circle>
          </>}
          <text x={x(i)} y="158" textAnchor="middle" fontSize="11" fill="currentColor">{i + 1}</text>
        </g>)}
      </svg>
      <ol className="text-xs space-y-1 text-slate-400 list-decimal pl-5">{sessions.map(s => <li key={s.logIndex}>{sessionLabel(s)}: <strong className="text-slate-100">{s.bestKg === null ? 'Unavailable' : `${valueInUnit(s.bestKg, unit)} ${unit}`}</strong></li>)}</ol>
    </>}
  </div>;
}

export function ExercisePRReport({ exercise, workoutLogs, unit }: { exercise: ExerciseEntry; workoutLogs: readonly WorkoutLog[]; unit: WeightUnit }) {
  const { record, recent, unsupported } = React.useMemo(() => buildExercisePRReport(workoutLogs, exercise), [workoutLogs, exercise.name, exercise.exerciseKey, exercise.modality]);
  if (unsupported) return <div className="p-4 space-y-2"><h3 className="font-bold">{exercise.name}</h3><p>This exercise modality does not support estimated 1RM.</p></div>;
  const log = record?.log;
  const occurrence = log && record?.exerciseIndex !== null ? log.exercises[record!.exerciseIndex!] : null;
  const headlineValue = record?.bestKg !== null && record?.bestKg !== undefined
    ? String(Number(valueInUnit(record.bestKg, unit))) : null;
  const workoutContext = log && (log.programId
    ? [log.program, log.week && `Week ${log.week}`, log.day && `Day ${log.day}`].filter(Boolean).join(' · ')
    : 'One-off workout');
  return <div className="p-4 space-y-5 text-slate-100 break-words">
    <section className="space-y-2 min-w-0" aria-labelledby="pr-history-title">
      <h3 id="pr-history-title" className="font-bold leading-snug">{occurrence?.name || exercise.name}{headlineValue !== null && ` · e1RM PR: ${headlineValue} ${unit}`}</h3>
      {!record || !log || !occurrence ? <p>No qualifying saved record.</p> : <>
        <p className="text-xs text-slate-400">{[log.date, workoutContext].filter(Boolean).join(' · ')}</p>
        <ol className="space-y-2 text-sm font-sans">{occurrence.sets.map((set, i) => {
          // Presentation only: retain original indices/numbering for the PR badge.
          if (set.isSkipped || set.isCompleted === false) return null;
          return <li key={i} className="space-y-0.5">
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <span>Set {set.setNumber}: {saved(set.weight)} {log.unit} × {saved(set.reps)} @{saved(set.rpe)} RPE</span>
              {set.isWarmup && <WarmupIcon className="w-3.5 h-3 text-amber-500 inline-block shrink-0" title={`Warm-up set ${set.setNumber}`} />}
              {i === record.setIndex && <span className={badge}>PR</span>}
            </div>
            {set.comment && <p className="text-xs text-slate-400 whitespace-pre-wrap">{set.comment}</p>}
            {!!set.dropSubSets?.length && <ol className="pl-3 text-xs text-slate-400 space-y-0.5" aria-label={`Drop subsets for set ${set.setNumber}`}>
              {set.dropSubSets.map((drop, d) => <li key={d}>Drop {d + 1}: {saved(drop.weight)} {log.unit} × {saved(drop.reps)}</li>)}
            </ol>}
          </li>;
        })}</ol>
        {log.notes && <div className="pt-1"><h4 className="text-sm font-bold">Workout notes</h4><p className="text-xs text-slate-400 whitespace-pre-wrap">{log.notes}</p></div>}
      </>}
    </section>
    <section className="space-y-2 min-w-0" aria-labelledby="pr-order-title">
      <h3 id="pr-order-title" className="font-bold">Exercise order</h3>
      {!log ? <p>No PR workout available.</p> : <ol className="space-y-1 text-sm font-sans">{log.exercises.map((entry, i) => <li key={i} className={`px-1 py-0.5 ${i === record!.exerciseIndex ? 'bg-selected-surface text-indigo-300 font-bold' : ''}`}>
        <span>{i + 1}. {entry.name} · {entry.muscleGroup || 'Muscle not recorded'}</span>{entry.isSkipped && <span> · Skipped</span>}{i === record!.exerciseIndex && <span className="text-xs ml-2">PR exercise</span>}
      </li>)}</ol>}
    </section>
    <section className={panel} aria-labelledby="pr-graph-title"><h3 id="pr-graph-title" className="font-bold">Last six workouts versus the PR</h3><ComparisonGraph sessions={recent} prKg={record?.bestKg ?? null} unit={unit} /></section>
  </div>;
}
