import React, { KeyboardEvent, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { WorkoutLog } from '../types';
import {
  aggregateTrainingWeeks, hydrationMeanLabel, RESISTANCE_MUSCLE_GROUPS,
  ResistanceMuscleGroup, WeeklyTrainingSummary,
} from '../lib/trainingAverages';
import { parseLocalDate } from '../lib/dateUtils';

type View = 'load' | 'context';
type Row = { label: string; description: string; value: (week: WeeklyTrainingSummary) => React.ReactNode };

const Empty = ({ noLogs = false }: { noLogs?: boolean }) => (
  <span aria-label={noLogs ? 'No workouts logged' : 'No recorded value'} title={noLogs ? 'No workouts logged' : 'No recorded value'}>—</span>
);
const sample = (count: number, total?: number) => <span className="block text-[9px] text-slate-500 font-sans">n={count}{total !== undefined ? `/${total}` : ''}</span>;
const observation = (week: WeeklyTrainingSummary, key: 'sleep' | 'calories' | 'hydration' | 'soreness' | 'workoutQuality' | 'workingSetRpe') => {
  if (!week.workouts) return <Empty noLogs />;
  const item = week[key];
  if (item.average === null) return <Empty />;
  const value = key === 'sleep' ? `${item.average.toFixed(1)} hr` :
    key === 'calories' ? `${Math.round(item.average).toLocaleString()} kcal` :
    key === 'hydration' ? hydrationMeanLabel(item.average) :
    `${item.average.toFixed(1)}/10`;
  return <>{value}{sample(item.count)}</>;
};
const duration = (minutes: number) => {
  const rounded = Math.round(minutes);
  return rounded >= 60 ? `${Math.floor(rounded / 60)}h ${rounded % 60}m` : `${rounded}m`;
};

export function TrainingAverages({ workoutLogs, now = new Date() }: { workoutLogs: readonly WorkoutLog[]; now?: Date }) {
  const [weeks, setWeeks] = useState<4 | 8 | 12>(4);
  const [windowOffset, setWindowOffset] = useState(0);
  const [view, setView] = useState<View>('load');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const summaries = useMemo(
    () => aggregateTrainingWeeks(workoutLogs, { weeks, windowOffset, now }),
    [workoutLogs, weeks, windowOffset, now],
  );

  const muscleRows: Row[] = [...RESISTANCE_MUSCLE_GROUPS, 'Other'].map(muscle => ({
    label: `${muscle} sets`, description: `Eligible resistance working sets attributed to ${muscle}`,
    value: (week: WeeklyTrainingSummary) => week.workouts ? week.setsByMuscle[muscle as ResistanceMuscleGroup] : <Empty noLogs />,
  })).filter(row => row.label !== 'Other sets' || summaries.some(w => w.setsByMuscle.Other > 0));
  const rows: Row[] = view === 'load' ? [
    { label: 'Completed workouts', description: 'Separate saved workout logs', value: w => w.workouts || <Empty noLogs /> },
    { label: 'Total gym time', description: 'Sum of valid positive saved durations', value: w => w.totalDurationMinutes === null ? <Empty noLogs={!w.workouts} /> : <>{duration(w.totalDurationMinutes)}{sample(w.durationCount, w.workouts)}</> },
    { label: 'Avg duration', description: 'Average of valid positive saved workout durations', value: w => w.averageDurationMinutes === null ? <Empty noLogs={!w.workouts} /> : <>{duration(w.averageDurationMinutes)}{sample(w.durationCount, w.workouts)}</> },
    { label: 'Total sets', description: 'Eligible resistance working sets; Conditioning excluded', value: w => w.workouts ? w.resistanceWorkingSets : <Empty noLogs /> },
    ...muscleRows,
  ] : [
    { label: 'Avg sleep', description: 'Average sleep the night before logged workouts', value: w => observation(w, 'sleep') },
    { label: 'Avg calories', description: 'Average reported nutrition intake attached to logged workouts', value: w => observation(w, 'calories') },
    { label: 'Avg hydration', description: 'Average logged hydration score/category, not a clinical measurement', value: w => observation(w, 'hydration') },
    { label: 'Target-muscle soreness', description: 'Average session-level soreness for muscles trained in the workout', value: w => observation(w, 'soreness') },
    { label: 'Workout Quality', description: 'Average workout quality logged with workouts', value: w => observation(w, 'workoutQuality') },
    { label: 'Avg working-set RPE', description: 'Set-weighted average RPE for eligible resistance working sets', value: w => observation(w, 'workingSetRpe') },
  ];

  const setRange = (next: 4 | 8 | 12) => { setWeeks(next); setWindowOffset(0); };
  const selectTab = (next: View) => { setView(next); tabRefs.current[next === 'load' ? 0 : 1]?.focus(); };
  const onTabKey = (event: KeyboardEvent, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    selectTab(event.key === 'ArrowLeft' || event.key === 'Home' ? 'load' : event.key === 'ArrowRight' || event.key === 'End' ? 'context' : index ? 'load' : 'context');
  };

  return <section aria-labelledby="training-averages-heading" className="w-full bg-slate-900 border-y border-x-0 border-slate-800 p-4 shadow-sm rounded-none">
    <div className="border-b border-slate-850 pb-3 mb-3 space-y-3">
      <div>
        <h2 id="training-averages-heading" className="font-extrabold text-[18px] text-slate-300 uppercase tracking-wide">Training Averages</h2>
        <p className="max-w-full text-[11px] leading-relaxed text-slate-500 font-medium break-words">Compare weekly training load and recovery metrics. Choose 4, 8 or 12 weeks, then use the arrows to move between date blocks.</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div aria-label="Training averages range" className="inline-flex border border-slate-800" role="group">
          {([4, 8, 12] as const).map(count => <button key={count} type="button" aria-pressed={weeks === count} onClick={() => setRange(count)} className={`min-h-9 px-3 text-xs font-black focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${weeks === count ? 'bg-indigo-500 text-on-accent' : 'bg-slate-950 text-slate-400 hover:text-slate-200'}`}>{count}W</button>)}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" aria-label={`Previous ${weeks} weeks`} onClick={() => setWindowOffset(v => v + 1)} className="min-h-9 min-w-9 border border-slate-800 bg-slate-950 text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"><ChevronLeft aria-hidden="true" className="w-4 h-4 mx-auto" /></button>
          <button type="button" aria-label={`Next ${weeks} weeks`} disabled={!windowOffset} onClick={() => setWindowOffset(v => Math.max(0, v - 1))} className="min-h-9 min-w-9 border border-slate-800 bg-slate-950 text-slate-300 disabled:text-slate-600 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"><ChevronRight aria-hidden="true" className="w-4 h-4 mx-auto" /></button>
        </div>
      </div>
      <div role="tablist" aria-label="Training averages view" className="grid grid-cols-2 border border-slate-800">
        {(['load', 'context'] as const).map((tab, index) => <button key={tab} ref={node => { tabRefs.current[index] = node; }} type="button" role="tab" aria-selected={view === tab} tabIndex={view === tab ? 0 : -1} onKeyDown={e => onTabKey(e, index)} onClick={() => selectTab(tab)} className={`min-h-10 px-2 text-xs font-extrabold focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400 ${view === tab ? 'bg-selected-surface text-indigo-400 border-b-2 border-indigo-500' : 'bg-slate-950 text-slate-400'}`}>{tab === 'load' ? 'Training Load' : 'Recovery Metrics'}</button>)}
      </div>
    </div>
    <p className="mb-2 text-[10px] text-slate-500 sm:hidden" aria-hidden="true">Swipe sideways to compare weeks →</p>
    <div className="training-averages-scroll overflow-x-auto border border-slate-850" tabIndex={0} aria-label={`${weeks}-week training averages comparison table`}>
      <table className="min-w-max w-full border-collapse text-left text-xs">
        <thead><tr>
          <th scope="col" className="training-averages-sticky sticky left-0 z-20 min-w-36 bg-slate-900 p-2 border-b border-r border-slate-850 text-slate-400">Metric</th>
          {summaries.map((week, index) => {
            const distance = summaries.length - 1 - index + windowOffset * weeks;
            const relative = !windowOffset && distance === 0 ? 'This wk' : !windowOffset && distance === 1 ? 'Last wk' : !windowOffset ? `${distance}W ago` : null;
            const fmt = (raw: string) => parseLocalDate(raw).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            return <th key={week.weekStart} scope="col" className="min-w-24 p-2 border-b border-slate-850 text-center text-slate-300">
              {relative && <span className="block font-extrabold">{relative}</span>}
              <span className="block text-[9px] text-slate-500 whitespace-nowrap">{fmt(week.weekStart)}–{fmt(week.weekEnd)}</span>
              {week.isCurrentWeek && <span className="block text-[9px] text-indigo-400">So far</span>}
              {!week.workouts && <span className="block text-[9px] text-slate-500">No logs</span>}
            </th>;
          })}
        </tr></thead>
        <tbody>{rows.map(row => <tr key={row.label}>
          <th scope="row" title={row.description} aria-label={`${row.label}: ${row.description}`} className="training-averages-sticky sticky left-0 z-10 bg-slate-900 p-2 border-r border-b border-slate-850 text-slate-300 whitespace-normal">{row.label}</th>
          {summaries.map(week => <td key={week.weekStart} className="p-2 border-b border-slate-850 text-center text-slate-300 font-mono whitespace-nowrap align-top">{row.value(week)}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}
