/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { Dumbbell, Feather, Settings, ChevronLeft, ChevronRight, CheckCircle2, Play, Calendar as CalendarIcon, Info, Pencil, Repeat, Check, Plus, X } from 'lucide-react';
import { Program, WorkoutLog } from '../types';
import { storage } from '../lib/storage';
import { getLocalDateString, getTodayLocalDateString, parseLocalDate } from '../lib/dateUtils';
import { MetRepsLogo } from './MetRepsLogo';
import { useModalHistory } from '../lib/useModalHistory';

interface HomeViewProps {
  currentProgram: Program | null;
  workoutLogs: WorkoutLog[];
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  onNavigate: (view: string, params?: any) => void;
}

export function HomeView({
  currentProgram,
  workoutLogs,
  selectedDate,
  setSelectedDate,
  onNavigate,
}: HomeViewProps) {
  const themeId = storage.getTheme();
  const isAmber = themeId === 'amber';
  const isTodaySelected = selectedDate === getTodayLocalDateString();
  const [displayedMonth, setDisplayedMonth] = useState(new Date());

  // Conflict popup state
  const [conflictingDraft, setConflictingDraft] = useState<any>(null);

  const { dismiss: dismissConflictPopup } = useModalHistory(
    conflictingDraft !== null,
    () => setConflictingDraft(null),
    'draft-conflict-popup'
  );

  const handleStartWorkout = (params: any) => {
    try {
      const draftStr = localStorage.getItem('metreps_workout_draft');
      if (draftStr) {
        const draft = JSON.parse(draftStr);
        let isSame = false;
        
        if (params.isOneOff) {
          if (draft.isOneOff) {
            isSame = true;
          }
        } else if (params.redoFromLogId || params.editLogId) {
          isSame = false;
        } else {
          if (!draft.isOneOff &&
              draft.programId === params.programId &&
              String(draft.weekNum) === String(params.week) &&
              String(draft.dayNum) === String(params.day)) {
            isSame = true;
          }
        }

        if (!isSame) {
          setConflictingDraft({
            draft,
            targetParams: params
          });
          return;
        }
      }
    } catch (e) {
      console.error('Error checking draft conflict:', e);
    }

    onNavigate('logger', params);
  };

  // Week helper calculations
  const mondayOf = (date: Date): Date => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = (day + 6) % 7; // days since Monday
    d.setDate(d.getDate() - diff);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  const endOfSundayFor = (date: Date): Date => {
    const mon = mondayOf(date);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    sun.setHours(23, 59, 59, 999);
    return sun;
  };

  // Completed workouts per date
  const completedByDate = useMemo(() => {
    const map = new Map<string, number>();
    workoutLogs.forEach((l) => {
      const key = l.date.slice(0, 10);
      if (!key) return;
      const isCurrent = currentProgram && (
        l.programId 
          ? l.programId === currentProgram.id 
          : l.program === currentProgram.name
      );
      const isOneOff = l.program === 'One Off';
      if (isCurrent || isOneOff) {
        map.set(key, (map.get(key) || 0) + 1);
      }
    });
    return map;
  }, [workoutLogs, currentProgram]);

  // Planned workouts map
  const plannedByDate = useMemo(() => {
    if (!currentProgram) return {};
    return storage.getPlannedSessions(currentProgram.id);
  }, [currentProgram, workoutLogs]);

  // Current program weekly text
  const currentProgramInfo = useMemo(() => {
    if (!currentProgram) return null;
    const now = new Date();
    const start = new Date(currentProgram.createdAt);
    const startMon = mondayOf(start);
    const nowMon = mondayOf(now);
    const weeksSinceStart = Math.floor((nowMon.getTime() - startMon.getTime()) / (7 * 24 * 60 * 60 * 1000));
    const currentWeekNum = Math.max(1, weeksSinceStart + 1);
    const totalWeeks = currentProgram.programDuration;
    const weekDisplay =
      totalWeeks === '∞'
        ? `Continuous`
        : `Week ${Math.min(currentWeekNum, Number(totalWeeks))} of ${totalWeeks}`;

    return {
      name: currentProgram.name,
      daysPerWeek: currentProgram.daysPerWeek,
      weekDisplay,
    };
  }, [currentProgram]);

  // Weekly progress tracker (Monday - Sunday of CURRENT week)
  const weeklyCompleted = useMemo(() => {
    if (!currentProgram) return 0;
    const now = new Date();
    const mon = mondayOf(now);
    const sun = endOfSundayFor(now);

    return workoutLogs.filter((l) => {
      const d = new Date(l.date);
      const isCurrent = l.programId 
        ? l.programId === currentProgram.id 
        : l.program === currentProgram.name;
      const isOneOff = l.program === 'One Off';
      return (isCurrent || isOneOff) && d >= mon && d <= sun;
    }).length;
  }, [workoutLogs, currentProgram]);

  // Current selected day's logs
  const logsForSelected = useMemo(() => {
    const matches = workoutLogs.filter((l) => l.date.slice(0, 10) === selectedDate);
    return matches.sort((a, b) => b.id.localeCompare(a.id));
  }, [workoutLogs, selectedDate]);

  // Calendar dates renderer
  const calendarDays = useMemo(() => {
    const year = displayedMonth.getFullYear();
    const month = displayedMonth.getMonth();
    
    // First day of month
    const firstDay = new Date(year, month, 1);
    // Find previous Monday or padding
    const startDayOffset = (firstDay.getDay() + 6) % 7; // Mon=0, Sun=6
    
    const days: Date[] = [];
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - startDayOffset);

    // Total 42 cells (6 weeks) to maintain standard grid height
    for (let i = 0; i < 42; i++) {
      days.push(new Date(startDate));
      startDate.setDate(startDate.getDate() + 1);
    }
    return days;
  }, [displayedMonth]);

  const handleMonthChange = (offset: number) => {
    const newMonth = new Date(displayedMonth);
    newMonth.setMonth(newMonth.getMonth() + offset);
    setDisplayedMonth(newMonth);
  };

  const getWeekAndDayForDate = (dateKey: string) => {
    if (!currentProgram) return { week: '1', day: '1' };
    
    // Check if we have a generated planned session for this specific date
    const planned = plannedByDate?.[dateKey];
    if (planned) {
      return { 
        week: String(planned.week || '1'), 
        day: String(planned.dayIndex) 
      };
    }

    const start = new Date(currentProgram.createdAt);
    const target = parseLocalDate(dateKey);
    const weeksSinceStart = Math.floor((mondayOf(target).getTime() - mondayOf(start).getTime()) / (7 * 24 * 60 * 60 * 1000));
    const week = Math.max(1, weeksSinceStart + 1);
    const weekdayMon1 = ((target.getDay() + 6) % 7) + 1;
    const dpw = currentProgram.daysPerWeek;
    const day = ((weekdayMon1 - 1) % dpw) + 1;
    return { week: String(week), day: String(day) };
  };

  return (
    <div className="space-y-1.5">
      {/* Banner Card */}
      <div className="sticky top-[-16px] -mt-4 pt-3 pb-2.5 bg-slate-900 border-b-2 border-indigo-500 w-full px-4 flex items-center justify-between shadow-lg rounded-none z-30">
        <div className="flex items-center gap-3">
          <div className="shrink-0 flex items-center justify-center">
            <MetRepsLogo size={45} />
          </div>
          <div>
            <h2 className="font-black text-xl text-white tracking-wide font-sans leading-none">MetReps</h2>
            {currentProgramInfo ? (
              <div className="mt-1.5 space-y-1">
                <p className="text-[10px] text-slate-300 uppercase tracking-widest font-extrabold font-sans">
                  Current Program:
                </p>
                <p className={`text-xs sm:text-sm font-black leading-tight truncate max-w-[200px] xs:max-w-[240px] sm:max-w-xs md:max-w-none block ${
                  isAmber ? 'text-indigo-600' : 'text-indigo-400'
                }`} title={currentProgramInfo.name}>
                  {currentProgramInfo.name}
                </p>
                <p className={`text-[10px] font-bold uppercase tracking-widest font-mono ${
                  isAmber ? 'text-indigo-600/90' : 'text-indigo-400/90'
                }`}>
                  {currentProgramInfo.weekDisplay}
                </p>
              </div>
            ) : null}
          </div>
        </div>
        <div className="self-start flex items-center gap-1 sm:gap-1.5 shrink-0 -mr-2.5 -mt-1 pt-0.5">
          <button
            onClick={() => onNavigate('info')}
            className="p-1 hover:bg-slate-800 rounded-none border border-transparent hover:border-slate-750 transition text-slate-400 hover:text-white flex items-center justify-center cursor-pointer"
            title="Information"
          >
            <Info className="w-6 h-6" />
          </button>
          <button
            onClick={() => onNavigate('settings')}
            className="p-1 hover:bg-slate-800 rounded-none border border-transparent hover:border-slate-750 transition text-slate-400 hover:text-white flex items-center justify-center cursor-pointer"
            title="Settings & JSON Import"
          >
            <Settings className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Calendar Section */}
      <div className="w-full bg-slate-900 border-y border-x-0 border-slate-800 p-4 shadow-md rounded-none">
        {/* Calendar Header */}
        <div className="flex items-center justify-between mb-4 px-1">
          <h3 className="font-extrabold text-base tracking-wide text-white uppercase">
            {displayedMonth.toLocaleDateString('default', { month: 'long', year: 'numeric' })}
          </h3>
          <div className="flex items-center gap-1">
            <button
              onClick={() => handleMonthChange(-1)}
              className="p-2 bg-slate-950 border border-slate-850 text-slate-400 hover:text-white transition rounded-none"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => handleMonthChange(1)}
              className="p-2 bg-slate-950 border border-slate-850 text-slate-400 hover:text-white transition rounded-none"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Weekdays */}
        <div className="grid grid-cols-7 gap-1 text-center mb-1">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, idx) => (
            <span key={idx} className="text-[10px] font-bold text-slate-500 uppercase tracking-wider py-1">
              {day}
            </span>
          ))}
        </div>

        {/* Calendar Days */}
        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((day, index) => {
            const dateStr = getLocalDateString(day);
            const isSelected = dateStr === selectedDate;
            const isToday = day.toDateString() === new Date().toDateString();
            const isCurrentMonth = day.getMonth() === displayedMonth.getMonth();

            const planned = plannedByDate?.[dateStr];
            const completedCount = completedByDate.get(dateStr) || 0;

            return (
              <button
                key={index}
                onClick={() => setSelectedDate(dateStr)}
                className={`p-2 rounded-none flex flex-col items-center justify-between transition min-h-[52px] border relative ${
                  isSelected
                    ? `bg-indigo-600 ${isAmber ? 'text-[#FBFAF8]' : 'text-white'} border-indigo-500`
                    : isToday
                    ? isAmber
                      ? 'bg-[#252320]/80 text-[#FBFAF8] border-[#B56D3E]'
                      : 'bg-slate-800/80 text-white border-indigo-500/40'
                    : 'bg-slate-950/40 hover:bg-slate-800/30 text-slate-300 border-transparent'
                } ${!isCurrentMonth ? 'opacity-30' : ''}`}
              >
                <span className="text-sm font-bold">{day.getDate()}</span>
                
                {/* Dots / Squares indicator */}
                <div className="h-4 flex items-center justify-center w-full mt-0.5">
                  {completedCount > 1 ? (
                    <div className="flex gap-0.5 max-w-full overflow-hidden px-0.5">
                      {Array.from({ length: Math.min(completedCount, 3) }).map((_, i) => (
                        <div key={i} className="w-1 h-1 rounded-full bg-emerald-400" />
                      ))}
                      {completedCount > 3 && <span className="text-[7px] text-emerald-400 font-bold font-mono">+</span>}
                    </div>
                  ) : completedCount === 1 ? (
                    <Check size={14} strokeWidth={3.5} className="text-emerald-400" />
                  ) : planned ? (
                    planned.status === 'completed' ? (
                      planned.completedDate && planned.completedDate !== dateStr ? (
                        /* Completed on a different day (early or late)! Show orange check */
                        <span title={`Completed ${planned.completedDate < dateStr ? 'early' : 'late'} on ${planned.completedDate}`}>
                          <Check size={14} strokeWidth={3.5} className="text-amber-500" />
                        </span>
                      ) : (
                        /* Completed on this day: already handled by completedCount === 1 (green check) */
                        <div className="w-1.5 h-1.5" />
                      )
                    ) : (
                      /* Planned but not completed: show red dot */
                      <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
                    )
                  ) : (
                    <div className="w-1.5 h-1.5" />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Weekly Progress Bar */}
      {currentProgram && (
        <div className="w-full bg-slate-900 border-y border-x-0 border-slate-800 p-4 shadow-sm rounded-none">
          <div className="flex justify-between items-center mb-2">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide">
              Weekly Consistency Gauge
            </h4>
            <span className="text-xs font-bold text-white bg-slate-950 px-2 py-0.5 rounded-none border border-slate-800">
              {weeklyCompleted} of {currentProgram.daysPerWeek} days
            </span>
          </div>
          <div className="w-full bg-slate-950 rounded-full h-3 border border-slate-800 overflow-hidden relative">
            <div
              className="bg-gradient-to-r from-indigo-500 via-indigo-400 to-cyan-400 h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.min((weeklyCompleted / currentProgram.daysPerWeek) * 100, 100)}%` }}
            />
          </div>
        </div>
      )}
          {/* Exercise Summary / Plan Preview */}
      <div className="w-full bg-slate-900 border-y border-x-0 border-slate-800 p-4 shadow-sm rounded-none">
        <h3 className="font-extrabold text-sm text-white border-b border-slate-850 pb-2.5 mb-3 flex items-center gap-1.5">
          <CalendarIcon className="w-4.5 h-4.5 text-indigo-400" />
          Agenda: {new Date(selectedDate).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
        </h3>

        {/* Completed Logs list for this date, if any */}
        {logsForSelected.length > 0 && (
          <div className="space-y-4 mb-4">
            <div className="flex items-center gap-2 bg-emerald-500/10 text-emerald-400 px-3 py-2 rounded-none border border-emerald-500/20 text-sm font-semibold">
              <CheckCircle2 className="w-4 h-4" />
              Completed {logsForSelected.length} Session{logsForSelected.length > 1 ? 's' : ''}!
            </div>

            {logsForSelected.map((log, lIdx) => (
              <div key={log.id} className="bg-slate-950/60 rounded-none p-3 border border-slate-800">
                <div className="flex justify-between items-center mb-2">
                  <span className={`text-sm font-bold font-mono ${isAmber ? 'text-indigo-600' : 'text-indigo-400'}`}>
                    {log.program || 'One Off'} • Week {log.week || '—'}, Day {log.day || '—'}
                  </span>
                  <span className="text-[11px] text-slate-400 font-mono font-bold">
                    {log.durationMinutes ? `${log.durationMinutes} min` : ''}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {log.exercises.map((ex, exIdx) => (
                    <div key={exIdx} className="text-sm text-slate-300 flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        • {ex.name}
                        {ex.isMainMovement && (
                          <sup className={`text-[9px] font-black tracking-normal align-super px-1 border rounded-sm ${
                            isAmber 
                              ? 'text-indigo-600 bg-indigo-500/5 border-indigo-600/20' 
                              : 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20'
                          }`}>MM</sup>
                        )}
                      </span>
                      <span className="text-slate-400 font-mono text-[11px] bg-slate-900 px-1.5 py-0.5 rounded-none border border-slate-800">
                        {ex.sets.length} sets ({ex.muscleGroup})
                      </span>
                    </div>
                  ))}
                </div>
                {log.notes && (
                  <p className="text-[11px] text-slate-400 italic mt-2 border-t border-slate-800/50 pt-1.5">
                    "{log.notes}"
                  </p>
                )}
                <div className="flex justify-between items-center mt-2 pt-1.5 border-t border-slate-800/30">
                  <button
                    onClick={() => handleStartWorkout({ redoFromLogId: log.id })}
                    className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded-none border border-slate-800 bg-slate-900/60 transition flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider cursor-pointer"
                    title="Redo Same Workout Today"
                  >
                    <Repeat className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Redo Workout Today</span>
                  </button>
                  <button
                    onClick={() => handleStartWorkout({ editLogId: log.id })}
                    className="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-slate-800 rounded-none border border-slate-800 bg-slate-900/60 transition flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider cursor-pointer"
                    title="Edit Completed Workout"
                  >
                    <Pencil className="w-3 h-3 text-indigo-400" />
                    <span>Edit Workout</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Current Active Program Plan schedule for this date */}
        {currentProgram ? (
          <div>
            {(() => {
              const planned = plannedByDate?.[selectedDate];

              if (!planned) {
                if (logsForSelected.length === 0) {
                  return (
                    <p className="text-sm text-slate-500 text-center flex items-center justify-center gap-1 py-4 bg-slate-950/20 rounded-none border border-slate-950/50">
                      <Info className="w-3.5 h-3.5 text-slate-400" /> Rest day according to plan schedule.
                    </p>
                  );
                }
                return null;
              }

              if (planned.status === 'completed') {
                const { week } = getWeekAndDayForDate(selectedDate);
                const isDifferentDate = planned.completedDate && planned.completedDate !== selectedDate;

                if (isDifferentDate) {
                  return (
                    <div className="bg-slate-950/40 rounded-none p-3 border border-slate-900 text-center">
                      <p className="text-sm text-slate-400 italic leading-relaxed">
                        Scheduled <span className="font-semibold text-slate-300">Day {planned.dayIndex} Workout</span> was completed early/late on{' '}
                        <span className="text-indigo-400 font-bold">
                          {(() => {
                            const parsed = parseLocalDate(planned.completedDate!);
                            return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                          })()}
                        </span>.
                      </p>
                    </div>
                  );
                } else {
                  return (
                    <div className="bg-slate-950/40 rounded-none p-2.5 border border-slate-900/40 flex items-center justify-center gap-1.5 text-sm text-emerald-400 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      Day {planned.dayIndex} Workout completed today!
                    </div>
                  );
                }
              }

              // Planned workout not yet completed - show Start Card
              const dayIndex = planned.dayIndex;
              const exercises = currentProgram.exercisesByDay?.[dayIndex] || [];

              return (
                <div className="bg-slate-950/60 rounded-none p-3.5 border border-slate-800">
                  <div className="flex justify-between items-center mb-3">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-red-400 animate-pulse" />
                      <span className="text-sm font-bold text-white">
                        Planned: Day {dayIndex} Workout
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono uppercase tracking-wider bg-slate-900 px-2 py-0.5 rounded-none border border-slate-800 font-bold">
                      REST TO WORK
                    </span>
                  </div>

                  {exercises.length > 0 && (
                    <div className="space-y-1.5 mb-4">
                      {exercises.slice(0, 3).map((e, idx) => (
                        <p key={idx} className="text-sm text-slate-300 flex justify-between">
                          <span>• {e.name}</span>
                          <span className="text-indigo-400 font-medium">({e.muscleGroup})</span>
                        </p>
                      ))}
                      {exercises.length > 3 && (
                        <p className="text-xs text-slate-500 italic pl-3 font-semibold">
                          + {exercises.length - 3} more exercises planned...
                        </p>
                      )}
                    </div>
                  )}

                  <button
                    onClick={() => {
                      const { week } = getWeekAndDayForDate(selectedDate);
                      handleStartWorkout({
                        programId: currentProgram.id,
                        programName: currentProgram.name,
                        week,
                        day: String(dayIndex),
                        scheduledDate: selectedDate,
                        date: getTodayLocalDateString(),
                      });
                    }}
                    className={`w-full bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 ${isAmber ? 'text-[#FBFAF8]' : 'text-white'} font-extrabold text-sm py-3 px-3 rounded-none transition flex items-center justify-center gap-1.5 shadow`}
                  >
                    <Play className="w-4 h-4 fill-current" />
                    Start this workout
                  </button>
                </div>
              );
            })()}
          </div>
        ) : (
          logsForSelected.length === 0 && (
            <p className="text-sm text-slate-400 italic text-center py-4 bg-slate-950/40 rounded-none border border-slate-950">
              No workout logs found for this date.
            </p>
          )
        )}

        {/* Log One-Off Workout Today Option - Only visible on today's agenda */}
        {isTodaySelected && (
          <div className="mt-4 border-t border-slate-850 pt-4">
            <button
              onClick={() => handleStartWorkout({ isOneOff: true })}
              className={`w-full bg-slate-950 hover:bg-slate-850 active:bg-slate-900 text-indigo-400 hover:text-indigo-300 font-extrabold text-xs py-2.5 px-3 rounded-none transition flex items-center justify-center gap-1.5 border border-slate-800 shadow cursor-pointer`}
            >
              <Plus className="w-4 h-4" />
              Log one-off workout today
            </button>
          </div>
        )}
      </div>

      {/* Draft Conflict Safety Warning Modal */}
      {conflictingDraft && (
        <div
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150 font-sans text-left"
          onClick={dismissConflictPopup}
        >
          <div
            className={`w-full max-w-md overflow-hidden flex flex-col shadow-2xl rounded-none border transition-all duration-150 animate-in fade-in zoom-in-95 ${
              isAmber 
                ? 'bg-[#FAF5F0] border-amber-600/60 text-slate-900 shadow-amber-950/10' 
                : 'bg-slate-900 border-slate-800 text-slate-100 shadow-indigo-950/40'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className={`p-4 border-b flex items-center justify-between gap-3 ${
              isAmber ? 'bg-[#F2EAE1] border-amber-200/50' : 'bg-slate-950 border-slate-850'
            }`}>
              <div>
                <h3 className="text-sm font-black uppercase tracking-wider leading-snug flex items-center gap-2">
                  <Info className={`w-4 h-4 font-bold ${isAmber ? 'text-amber-700' : 'text-indigo-400'}`} /> 
                  Workout In Progress
                </h3>
                <p className={`text-[10px] font-mono uppercase tracking-widest leading-none mt-1 ${
                  isAmber ? 'text-amber-700/80' : 'text-indigo-400'
                }`}>
                  Unsaved Draft Protection
                </p>
              </div>
              <button
                onClick={dismissConflictPopup}
                className={`p-1.5 rounded-none border transition cursor-pointer shrink-0 text-slate-300 ${
                  isAmber 
                    ? 'bg-[#FDFCFB] hover:bg-amber-100/50 border-amber-200' 
                    : 'bg-slate-900 hover:bg-slate-800 border-slate-800'
                }`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 space-y-4 text-xs sm:text-sm leading-relaxed">
              <p className="text-slate-300 font-semibold leading-relaxed">
                You must finish and save your current workout in progress before commencing a new one today.
              </p>

              <div className={`p-3.5 border ${
                isAmber 
                  ? 'bg-amber-500/5 border-amber-200/60' 
                  : 'bg-indigo-950/20 border-indigo-900/30'
              }`}>
                <h4 className={`font-extrabold uppercase text-xs tracking-wider font-mono mb-1 ${
                  isAmber ? 'text-amber-800' : 'text-indigo-400'
                }`}>
                  Current Active Draft:
                </h4>
                <p className="text-xs text-slate-300">
                  {conflictingDraft.draft.isOneOff ? (
                    <span className="font-bold flex items-center gap-1">
                      <Plus className="w-3.5 h-3.5 inline text-indigo-400" /> One-Off Workout
                    </span>
                  ) : (
                    <span className="font-bold">
                      {conflictingDraft.draft.programName || 'Programmed Workout'}
                      <span className="block text-[11px] font-mono text-slate-400 mt-0.5">
                        Week {conflictingDraft.draft.weekNum}, Day {conflictingDraft.draft.dayNum}
                      </span>
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className={`p-3 border-t flex flex-col sm:flex-row gap-2 justify-end ${
              isAmber ? 'bg-[#F2EAE1] border-amber-200/50' : 'bg-slate-950 border-slate-850'
            }`}>
              <button
                onClick={dismissConflictPopup}
                className={`font-extrabold text-xs py-2 px-4 rounded-none border transition cursor-pointer text-slate-300 ${
                  isAmber 
                    ? 'bg-[#FDFCFB] hover:bg-amber-100/50 border-amber-200' 
                    : 'bg-slate-900 hover:bg-slate-800 border-slate-800'
                }`}
              >
                Go Back
              </button>
              <button
                onClick={() => {
                  dismissConflictPopup();
                  // Navigate directly to the draft
                  const draft = conflictingDraft.draft;
                  if (draft.isOneOff) {
                    onNavigate('logger', { isOneOff: true });
                  } else {
                    onNavigate('logger', {
                      programId: draft.programId,
                      programName: draft.programName,
                      week: String(draft.weekNum),
                      day: String(draft.dayNum),
                      scheduledDate: draft.scheduledDate,
                      date: draft.dateStr || getTodayLocalDateString(),
                    });
                  }
                }}
                className={`font-extrabold text-xs py-2 px-4 rounded-none border transition cursor-pointer text-white shadow ${
                  isAmber 
                    ? 'bg-amber-600 hover:bg-amber-500 border-amber-700 shadow-amber-900/10' 
                    : 'bg-indigo-600 hover:bg-indigo-500 border-indigo-700 shadow-indigo-900/20'
                }`}
              >
                Resume Active Draft
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
