import React from 'react';
import type { ExerciseEntry, WeightUnit, WorkoutLog } from '../types';
import { buildExercisePRReport, PRSession } from '../lib/exercisePRReport';
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
  if (unsupported) return <div className="p-4 space-y-2"><p>Saved history · {exercise.name}</p><p>This exercise modality does not support estimated 1RM.</p></div>;
  const log = record?.log;
  const occurrence = log && record?.exerciseIndex !== null ? log.exercises[record!.exerciseIndex!] : null;
  return <div className="p-4 space-y-4 text-slate-100 break-words">
    <p className="text-sm text-slate-400">Saved history · {exercise.name}</p>
    <section className={panel} aria-labelledby="pr-history-title">
      <h3 id="pr-history-title" className="font-bold">Historical PR workout</h3>
      {!record || !log || !occurrence ? <p>No qualifying saved record.</p> : <>
        <p className="font-bold">{occurrence.name} · {log.date}</p>
        <p>All-time e1RM: <strong>{valueInUnit(record.bestKg!, unit)} {unit}</strong></p>
        <p className="text-sm text-slate-400">{[log.program, log.programId && `Program ID: ${log.programId}`, log.week && `Week ${log.week}`, log.day && `Day ${log.day}`, `Workout ID: ${log.id}`].filter(Boolean).join(' · ')}</p>
        <ol className="space-y-2">{occurrence.sets.map((set, i) => <li key={i} className={`border p-2 space-y-1 ${i === record.setIndex ? 'bg-selected-surface border-indigo-400' : 'border-slate-800'}`}>
          <div className="flex flex-wrap items-center gap-2"><strong>{set.isWarmup ? 'Warm-up' : 'Set'} {set.setNumber}</strong>{i === record.setIndex && <span className={badge}>PR</span>}</div>
          <p className="text-sm">Weight: {saved(set.weight)} {log.unit} · Reps: {saved(set.reps)} · RPE: {saved(set.rpe)}</p>
          <p className="text-sm">Status: {set.isSkipped ? 'Skipped' : set.isCompleted === false ? 'Incomplete' : set.isCompleted ? 'Completed' : 'Completion not recorded'}</p>
          {set.form && <p className="text-sm">Form: {set.form}</p>}
          {set.comment && <p className="text-sm whitespace-pre-wrap">Comment: {set.comment}</p>}
          {(set.isDropSet || !!set.dropSubSets?.length) && <div className="border-l border-slate-800 pl-3 text-sm"><strong>Drop-set technique</strong><ol>{set.dropSubSets?.map((drop, d) => <li key={d}>Drop {d + 1}: {saved(drop.weight)} {log.unit} · {saved(drop.reps)} reps</li>)}</ol></div>}
        </li>)}</ol>
        {log.notes && <div><h4 className="font-bold">Workout notes</h4><p className="text-sm whitespace-pre-wrap">{log.notes}</p></div>}
      </>}
    </section>
    <section className={panel} aria-labelledby="pr-order-title"><h3 id="pr-order-title" className="font-bold">Exercise order</h3><p className="text-sm text-slate-400">Saved exercise order.</p>
      {!log ? <p>No PR workout available.</p> : <ol className="space-y-2">{log.exercises.map((entry, i) => <li key={i} className={`border p-2 ${i === record!.exerciseIndex ? 'bg-selected-surface border-indigo-400 font-bold' : 'border-slate-800'}`}>
        <span>{i + 1}. {entry.name} · {entry.muscleGroup || 'Muscle not recorded'}</span>{entry.isSkipped && <span> · Skipped</span>}{i === record!.exerciseIndex && <span className={`${badge} ml-2`}>PR exercise</span>}
      </li>)}</ol>}
    </section>
    <section className={panel} aria-labelledby="pr-graph-title"><h3 id="pr-graph-title" className="font-bold">Last six workouts versus the PR</h3><ComparisonGraph sessions={recent} prKg={record?.bestKg ?? null} unit={unit} /></section>
  </div>;
}
