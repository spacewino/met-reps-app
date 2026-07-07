/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Calendar, Trash2, Dumbbell, Clock, ChevronDown, ChevronUp, MessageSquare, Coffee, Droplet, Flame, Award, Info, X } from 'lucide-react';
import { WorkoutLog } from '../types';
import { storage } from '../lib/storage';
import { ConfirmationModal } from './ConfirmationModal';
import { classifyWorkout } from '../lib/workoutClassifier';

// Helper to calculate the report-card Grade of a workout log based on its intensity relative to personal records.
function calculateWorkoutGrade(log: WorkoutLog, allLogs: WorkoutLog[], userBodyweight: number | null) {
  if (!log.exercises || log.exercises.length === 0) {
    return {
      grade: 'F',
      score: 50,
      label: 'Sub-Threshold',
      desc: 'No exercises completed in this session.',
      color: 'text-slate-400 bg-slate-950 border-slate-800',
    };
  }

  // 1. Calculate all-time max 1RM or equivalent for every exercise in history
  const exerciseMaxes: Record<string, number> = {};

  allLogs.forEach(historyLog => {
    historyLog.exercises.forEach(ex => {
      if (!ex.name || !ex.sets || ex.sets.length === 0) return;
      const exName = ex.name.trim().toLowerCase();
      const modality = ex.modality || 'weighted';

      let logMax = 0;
      ex.sets.forEach(set => {
        const w = set.weight || 0;
        const r = set.reps || 0;

        if (modality === 'bodyweight') {
          if (r > logMax) logMax = r;
        } else if (modality === 'timed') {
          if (w > logMax) logMax = w;
        } else if (modality === 'assisted') {
          const bw = userBodyweight || 75;
          const effWeight = Math.max(1, bw - w);
          const epley = effWeight * (1 + r / 30);
          if (epley > logMax) logMax = epley;
        } else {
          const epley = r <= 1 ? w : w * (1 + r / 30);
          if (epley > logMax) logMax = epley;
        }
      });

      if (logMax > 0) {
        if (!exerciseMaxes[exName] || logMax > exerciseMaxes[exName]) {
          exerciseMaxes[exName] = logMax;
        }
      }
    });
  });

  // 2. Calculate the performance ratio for the current log's exercises
  let totalRatio = 0;
  let ratedExercisesCount = 0;
  let totalSetsCount = 0;
  let strictSetsCount = 0;
  let looseSetsCount = 0;
  let totalRpe = 0;
  let rpeCount = 0;

  log.exercises.forEach(ex => {
    if (!ex.name || !ex.sets || ex.sets.length === 0) return;
    const exName = ex.name.trim().toLowerCase();
    const modality = ex.modality || 'weighted';

    let sessionMax = 0;
    ex.sets.forEach(set => {
      const w = set.weight || 0;
      const r = set.reps || 0;
      totalSetsCount++;

      if (set.form === 'strict') strictSetsCount++;
      if (set.form === 'loose') looseSetsCount++;
      if (set.rpe) {
        totalRpe += set.rpe;
        rpeCount++;
      }

      if (modality === 'bodyweight') {
        if (r > sessionMax) sessionMax = r;
      } else if (modality === 'timed') {
        if (w > sessionMax) sessionMax = w;
      } else if (modality === 'assisted') {
        const bw = userBodyweight || 75;
        const effWeight = Math.max(1, bw - w);
        const epley = effWeight * (1 + r / 30);
        if (epley > sessionMax) sessionMax = epley;
      } else {
        const epley = r <= 1 ? w : w * (1 + r / 30);
        if (epley > sessionMax) sessionMax = epley;
      }
    });

    if (sessionMax > 0) {
      const allTimeMax = exerciseMaxes[exName] || sessionMax;
      const ratio = allTimeMax > 0 ? (sessionMax / allTimeMax) : 1;
      totalRatio += ratio;
      ratedExercisesCount++;
    }
  });

  const averageRatio = ratedExercisesCount > 0 ? (totalRatio / ratedExercisesCount) : 0.9;

  // 3. Apply form multipliers
  let formMultiplier = 1.0;
  if (totalSetsCount > 0) {
    const strictRatio = strictSetsCount / totalSetsCount;
    const looseRatio = looseSetsCount / totalSetsCount;
    formMultiplier += strictRatio * 0.03;
    formMultiplier -= looseRatio * 0.06;
  }

  // 4. Apply RPE effort multiplier
  let rpeMultiplier = 1.0;
  if (rpeCount > 0) {
    const avgRpe = totalRpe / rpeCount;
    if (avgRpe >= 8.5) {
      rpeMultiplier = 1.02;
    } else if (avgRpe >= 7.0) {
      rpeMultiplier = 1.00;
    } else if (avgRpe >= 5.0) {
      rpeMultiplier = 0.97;
    } else {
      rpeMultiplier = 0.93;
    }
  }

  const finalScore = Math.min(1.05, averageRatio * formMultiplier * rpeMultiplier);

  if (finalScore >= 0.95) {
    return {
      grade: 'A',
      score: Math.round(finalScore * 100),
      label: 'PR / Peak Intensity Zone',
      desc: 'Incredible peak intensity or new Personal Record session!',
      color: 'text-emerald-400 bg-slate-950 border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.15)]',
    };
  } else if (finalScore >= 0.88) {
    return {
      grade: 'B',
      score: Math.round(finalScore * 100),
      label: 'Heavy Working Volume Zone',
      desc: 'Excellent hard working sets at near-peak training threshold.',
      color: 'text-indigo-400 bg-slate-950 border-indigo-500/30',
    };
  } else if (finalScore >= 0.80) {
    return {
      grade: 'C',
      score: Math.round(finalScore * 100),
      label: 'Hypertrophy / Growth Zone',
      desc: 'Solid hypertrophy volume. Excellent for building cumulative muscle growth.',
      color: 'text-cyan-400 bg-slate-950 border-cyan-500/30',
    };
  } else if (finalScore >= 0.70) {
    return {
      grade: 'D',
      score: Math.round(finalScore * 100),
      label: 'Technique / Speed Zone',
      desc: 'Controlled technique-focused or dynamic power session.',
      color: 'text-amber-400 bg-slate-950 border-amber-500/30',
    };
  } else if (finalScore >= 0.60) {
    return {
      grade: 'E',
      score: Math.round(finalScore * 100),
      label: 'Active Recovery / Deload Zone',
      desc: 'Lighter strategic deload to allow central nervous system recovery.',
      color: 'text-orange-400 bg-slate-950 border-orange-500/30',
    };
  } else {
    return {
      grade: 'F',
      score: Math.round(finalScore * 100),
      label: 'Sub-Threshold Zone',
      desc: 'Light recovery session or incomplete tracking entry.',
      color: 'text-slate-400 bg-slate-950 border-slate-800',
    };
  }
}

interface LogsHistoryViewProps {
  workoutLogs: WorkoutLog[];
  onRefresh: () => void;
}

export function LogsHistoryView({ workoutLogs, onRefresh }: LogsHistoryViewProps) {
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [deleteLogId, setDeleteLogId] = useState<string | null>(null);
  const [showGradeInfo, setShowGradeInfo] = useState(false);
  const userBodyweight = storage.getBodyweight();

  const toggleExpand = (id: string) => {
    setExpandedLogId(prev => (prev === id ? null : id));
  };

  const handleDeleteLog = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteLogId(id);
  };

  const sortedLogs = [...workoutLogs].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="space-y-4 pb-20">
      {/* Header Bar */}
      <div className="sticky top-[-16px] -mt-4 pt-3 pb-2.5 bg-slate-950 z-30 flex items-center justify-between border-b border-slate-850 px-4 shadow-md">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-slate-900 rounded-none border border-slate-800 text-slate-400 flex items-center justify-center">
            <Calendar className="w-4 h-4 text-indigo-400" />
          </div>
          <div>
            <h2 className="font-extrabold text-sm text-white uppercase tracking-wide leading-none">
              Workout Log Book
            </h2>
            <p className="text-[10px] text-indigo-400 font-mono uppercase tracking-widest mt-1">
              Logged Training Journal
            </p>
          </div>
        </div>
      </div>

      {sortedLogs.length === 0 ? (
        <div className="text-center py-12 w-full bg-slate-900 border-y border-x-0 border-slate-800 rounded-none px-4">
          <Dumbbell className="w-10 h-10 text-slate-700 mx-auto mb-3" />
          <h3 className="text-sm font-black text-slate-300 uppercase tracking-wide">No logged sessions</h3>
          <p className="text-xs text-slate-500 max-w-xs mx-auto mt-1 leading-relaxed">
            Your workout logs will appear here once you complete and save a session.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedLogs.map(log => {
            const isExpanded = expandedLogId === log.id;
            const classification = classifyWorkout(log, workoutLogs, userBodyweight);
            const { category, categoryDesc, color, flags, fatigueScore, stats } = classification;

            return (
              <div
                key={log.id}
                onClick={() => toggleExpand(log.id)}
                className="w-full bg-slate-900 border-y border-x-0 border-slate-800 rounded-none overflow-hidden cursor-pointer hover:border-slate-700 transition"
              >
                {/* Log Row Header */}
                <div className="p-4 flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-400 font-bold font-mono uppercase bg-slate-950 px-2 py-0.5 rounded-none border border-slate-850">
                        {new Date(log.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                      </span>
                      <span className="text-sm font-black text-white truncate font-sans">
                        {log.program || 'One Off'}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-2 font-bold font-sans">
                      <span className="flex items-center gap-1">
                        <Dumbbell className="w-4 h-4 text-indigo-400" />
                        {log.exercises.length} exercises
                      </span>
                      {log.durationMinutes && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-4 h-4 text-cyan-400" />
                          {log.durationMinutes} mins
                        </span>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowGradeInfo(true);
                        }}
                        className="p-1 hover:bg-slate-800 text-slate-500 hover:text-indigo-400 rounded-full transition flex items-center justify-center ml-auto"
                        title="How are categories and flags calculated?"
                      >
                        <Info className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Third line showing computed Category and Flags */}
                    <div className="flex flex-wrap items-center gap-1.5 mt-2 font-sans">
                      <span className={`inline-flex items-center px-2 py-0.5 border text-[9px] font-black uppercase tracking-wider ${color}`}>
                        {category}
                      </span>
                      {flags.map((flag, idx) => (
                        <span key={idx} className="text-[8px] font-mono font-black text-indigo-400 bg-indigo-950/40 border border-indigo-500/15 px-1.5 py-0.2 uppercase tracking-wide">
                          {flag}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={e => handleDeleteLog(log.id, e)}
                      className="p-2 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded-none transition"
                      title="Delete log"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <button className="p-1 text-slate-400">
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Log Row Body Expanded */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-2 border-t border-slate-850/60 bg-slate-950/40 space-y-4">
                    {/* Session Training Category Analysis */}
                    <div className={`p-4 border rounded-none flex items-start gap-3 mt-1.5 ${color}`}>
                      <Award className="w-5 h-5 shrink-0 mt-0.5" />
                      <div className="space-y-1.5 min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-xs font-black uppercase tracking-wider font-sans">
                            Session Classification: {category}
                          </span>
                          <span className="text-[10px] font-bold font-mono uppercase bg-slate-950/60 px-1.5 py-0.5 border border-slate-850 opacity-90">
                            Performance Index: {classification.performanceIndex}%
                          </span>
                        </div>
                        <p className="text-[11px] leading-relaxed text-slate-300 font-sans">
                          {categoryDesc}
                        </p>
                        {flags.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-1 border-t border-slate-800/30">
                            {flags.map((flag, idx) => {
                              let flagColor = 'text-indigo-400 border-indigo-500/15 bg-indigo-950/40';
                              if (flag === 'Deload Recommended') flagColor = 'text-rose-400 border-rose-500/20 bg-rose-950/30';
                              if (flag === 'Deload Watch') flagColor = 'text-amber-400 border-amber-500/20 bg-amber-950/30';
                              if (flag === 'PR / Progressive Overload') flagColor = 'text-emerald-400 border-emerald-500/20 bg-emerald-950/30';
                              
                              return (
                                <span key={idx} className={`text-[9px] font-mono font-black border px-1.5 py-0.2 uppercase tracking-wide ${flagColor}`}>
                                  {flag}
                                </span>
                              );
                            })}
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] font-mono text-slate-400 pt-1 border-t border-slate-850/20">
                          <div>Total Volume: <strong className="text-slate-200">{stats.totalVolume} {log.unit.toUpperCase()}</strong></div>
                          <div>Average RPE: <strong className="text-slate-200">{stats.avgRpe}</strong></div>
                          <div>Hard Sets: <strong className="text-slate-200">{stats.hardSets}</strong></div>
                          <div>Form Breakdown: <strong className="text-slate-200">{stats.looseRate}% loose</strong></div>
                          <div className="col-span-2">Computed Fatigue Score: <strong className="text-slate-200">{fatigueScore}/10</strong></div>
                        </div>
                      </div>
                    </div>

                    {/* Wellness indices */}
                    {log.recovery && (
                      <div className="grid grid-cols-3 gap-2 bg-slate-950/80 p-3 rounded-none border border-slate-850">
                        <div className="text-center">
                          <span className="text-[8px] font-bold text-slate-500 uppercase tracking-wider block">Sleep</span>
                          <span className="text-xs font-black text-indigo-300 font-mono flex items-center justify-center gap-1 mt-0.5">
                            <Coffee className="w-3.5 h-3.5" /> {log.recovery.sleepHours || '—'} hrs
                          </span>
                        </div>
                        <div className="text-center border-x border-slate-850/60">
                          <span className="text-[8px] font-bold text-slate-500 uppercase tracking-wider block">Hydration</span>
                          <span className="text-xs font-black text-cyan-400 font-mono flex items-center justify-center gap-1 mt-0.5">
                            <Droplet className="w-3.5 h-3.5" /> {log.recovery.hydrationLiters || '—'} L
                          </span>
                        </div>
                        <div className="text-center">
                          <span className="text-[8px] font-bold text-slate-500 uppercase tracking-wider block">Calories</span>
                          <span className="text-xs font-black text-amber-500 font-mono flex items-center justify-center gap-1 mt-0.5">
                            <Flame className="w-3.5 h-3.5" /> {log.recovery.nutritionCalories || '—'} kcal
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Exercises lists */}
                    <div className="space-y-4">
                      {log.exercises.map((ex, exIdx) => (
                        <div key={exIdx} className="space-y-1.5">
                          <h4 className="text-xs font-extrabold text-slate-200 flex justify-between uppercase tracking-wider font-sans">
                            <span>• {ex.name}</span>
                            <span className="text-[9px] text-indigo-400 font-semibold font-mono">({ex.muscleGroup})</span>
                          </h4>

                          <div className="space-y-1.5 pl-2.5">
                            {ex.sets.map((set, sIdx) => (
                              <div
                                key={sIdx}
                                className="text-xs text-slate-400 flex items-center justify-between font-mono py-0.5"
                              >
                                <span>
                                  Set {set.setNumber}:{' '}
                                  {ex.modality === 'bodyweight' ? (
                                    <>
                                      <strong className="text-indigo-400 font-black">Bodyweight ({set.weight && set.weight !== 0 ? `${set.weight} ${log.unit.toUpperCase()}` : 'BW'})</strong> x{' '}
                                      <strong className="text-slate-200 font-black">{set.reps || 0}</strong> reps
                                    </>
                                  ) : ex.modality === 'timed' ? (
                                    <>
                                      <strong className="text-slate-200 font-black">{set.weight || 0}</strong> secs
                                    </>
                                  ) : ex.modality === 'assisted' ? (
                                    <>
                                      <strong className="text-slate-200 font-black">{set.weight || 0}</strong> {log.unit} assist x{' '}
                                      <strong className="text-slate-200 font-black">{set.reps || 0}</strong> reps
                                    </>
                                  ) : (
                                    <>
                                      <strong className="text-slate-200 font-black">{set.weight || 0}</strong> {log.unit} x{' '}
                                      <strong className="text-slate-200 font-black">{set.reps || 0}</strong> reps
                                    </>
                                  )}
                                </span>
                                <div className="flex gap-2">
                                  <span className="text-[10px] text-slate-400 font-bold bg-slate-900 px-1.5 py-0.2 rounded-none border border-slate-850/40">RPE {set.rpe || '—'}</span>
                                  {set.form && (
                                    <span className="text-[10px] font-black text-indigo-400 capitalize">{set.form}</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Notes */}
                    {log.notes && (
                      <div className="p-3 bg-slate-950/60 rounded-none border border-slate-850 flex gap-2 items-start text-xs text-slate-300 leading-relaxed font-sans">
                        <MessageSquare className="w-4.5 h-4.5 text-indigo-400 shrink-0 mt-0.5" />
                        <p className="italic">"{log.notes}"</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmationModal
        visible={deleteLogId !== null}
        title="Delete Workout Log"
        message="Are you absolutely sure you want to delete this workout log? This action is permanent and cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Keep"
        confirmVariant="danger"
        onConfirm={() => {
          if (deleteLogId) {
            storage.deleteWorkoutLog(deleteLogId);
            onRefresh();
          }
          setDeleteLogId(null);
        }}
        onCancel={() => setDeleteLogId(null)}
      />

      {/* Grade Explanation Modal */}
      {showGradeInfo && (
        <div
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setShowGradeInfo(false)}
        >
          <div
            className="bg-slate-900 border border-slate-800 rounded-none w-full max-w-xl overflow-hidden flex flex-col shadow-2xl shadow-indigo-950/40 max-h-[85vh] animate-in fade-in zoom-in-95 duration-150 font-sans"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-5 bg-slate-950 border-b border-slate-850 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Award className="w-6 h-6 text-indigo-400 shrink-0" />
                <div>
                  <h3 className="text-sm sm:text-lg font-black text-white uppercase tracking-wider leading-snug">
                    Training Classification System
                  </h3>
                  <p className="text-[10px] sm:text-xs text-indigo-400 font-mono uppercase tracking-widest leading-none mt-1">
                    Rule-Based Athlete Physiology Engine
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowGradeInfo(false)}
                className="p-1.5 text-slate-500 hover:text-white hover:bg-slate-800 transition rounded-none"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="p-6 overflow-y-auto space-y-6 text-[14px] sm:text-[15px] text-slate-300 leading-relaxed scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
              <p>
                Your workout grading is replaced with an advanced training classification engine. The app evaluates set-level and session-level metrics to assign a training Category and optional advisory Flags.
              </p>

              {/* Training Categories */}
              <div className="space-y-3">
                <h4 className="font-black text-white uppercase text-xs sm:text-sm tracking-wider font-mono">
                  Primary Categories:
                </h4>
                <div className="grid grid-cols-1 gap-3 font-sans">
                  <div className="p-3 border border-rose-900/40 bg-rose-950/20 flex flex-col gap-0.5">
                    <span className="font-black text-rose-400 text-sm">Peak / Test</span>
                    <span className="text-slate-400 text-xs">Assigned during low-rep testing (1-3 reps) at 95%+ of rolling baseline e1RM or during new high-confidence PR testing.</span>
                  </div>
                  <div className="p-3 border border-indigo-900/40 bg-indigo-950/20 flex flex-col gap-0.5">
                    <span className="font-black text-indigo-400 text-sm">Strength Builder</span>
                    <span className="text-slate-400 text-xs">Lifting focused on neural adaptations. Heavily dominated by low-rep work (1-6 reps) at 80% to 92.5% intensity of rolling baselines.</span>
                  </div>
                  <div className="p-3 border border-cyan-900/40 bg-cyan-950/20 flex flex-col gap-0.5">
                    <span className="font-black text-cyan-400 text-sm">Hypertrophy</span>
                    <span className="text-slate-400 text-xs">Lifting for muscular growth. Dominated by multiple high-RPE volume sets (5-25 reps) between 30% and 85% relative intensity.</span>
                  </div>
                  <div className="p-3 border border-amber-900/40 bg-amber-950/20 flex flex-col gap-0.5">
                    <span className="font-black text-amber-400 text-sm">Technique / Skill Practice</span>
                    <span className="text-slate-400 text-xs">Focused on biomechanical precision, tempo, or pause reps. Loads are moderate (30-75%) with low average session RPE and strict form.</span>
                  </div>
                  <div className="p-3 border border-emerald-900/40 bg-emerald-950/20 flex flex-col gap-0.5">
                    <span className="font-black text-emerald-400 text-sm">Recovery / Deload Session</span>
                    <span className="text-slate-400 text-xs">Intentional low-intensity training (40-65% load) with low RPE and strict form, designed to stimulate blood flow and joint/CNS recovery.</span>
                  </div>
                  <div className="p-3 border border-slate-800 bg-slate-950 flex flex-col gap-0.5">
                    <span className="font-black text-slate-400 text-sm">Mixed / Maintenance</span>
                    <span className="text-slate-400 text-xs">Standard training sessions with mixed reps, loads, or non-specific stimulus. Useful for maintaining base conditioning.</span>
                  </div>
                </div>
              </div>

              {/* Dynamic Fatigue Score */}
              <div className="space-y-2 bg-slate-950/50 p-4 border border-slate-850">
                <h4 className="font-bold text-slate-100 flex items-center gap-2 uppercase text-xs sm:text-sm tracking-wide font-mono">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 shrink-0" />
                  Dynamic Fatigue Score (1 - 10)
                </h4>
                <p className="text-slate-400 text-xs">
                  We calculate systemic fatigue by weighting post-workout Muscle Soreness (35%), Workout Quality/Motivation dropoffs (25%), Session Average working RPE (20%), Form Breakdown rate (10%), and Performance Index Drops (10%).
                </p>
              </div>

              {/* Training Flags */}
              <div className="space-y-3">
                <h4 className="font-black text-white uppercase text-xs sm:text-sm tracking-wider font-mono">
                  Automated Training Flags:
                </h4>
                <div className="space-y-2 text-xs text-slate-400">
                  <div className="flex items-start gap-2">
                    <strong className="text-emerald-400 shrink-0 uppercase font-mono w-40">PR / Overload:</strong>
                    <span>Applied when your top set estimated 1RM exceeds your historical 4-8 exposure rolling average baseline by 1.5%+.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <strong className="text-amber-400 shrink-0 uppercase font-mono w-40">Technical Breakdown:</strong>
                    <span>Applied when loose form is reported on 25%+ of your session working sets or on your highest-intensity set.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <strong className="text-rose-400 shrink-0 uppercase font-mono w-40">High Fatigue:</strong>
                    <span>Applied when your session average RPE exceeds 8.5, soreness is 7+, or the fatigue score passes 6.5.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <strong className="text-rose-500 shrink-0 uppercase font-mono w-40">Deload Recommended:</strong>
                    <span>Triggered only when there is both a performance decline (index below 97%) AND a high fatigue marker simultaneously.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <strong className="text-amber-500 shrink-0 uppercase font-mono w-40">Deload Watch:</strong>
                    <span>An advisory marker when fatigue is building but hasn't caused a concurrent performance decline yet.</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="bg-slate-950/40 px-5 py-4 border-t border-slate-850 flex justify-end">
              <button
                onClick={() => setShowGradeInfo(false)}
                className="w-full sm:w-auto px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs sm:text-sm uppercase tracking-wider rounded-none transition shadow"
              >
                Understood
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
