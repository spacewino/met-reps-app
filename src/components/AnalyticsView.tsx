/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { LineChart, TrendingUp, Sparkles, Coffee, Droplet, Flame, Brain, Award, AlertCircle, Dumbbell, Target, Info, X } from 'lucide-react';
import { WorkoutLog, SetEntry } from '../types';

interface AnalyticsViewProps {
  workoutLogs: WorkoutLog[];
}

export function AnalyticsView({ workoutLogs }: AnalyticsViewProps) {
  const [selectedExercise, setSelectedExercise] = useState<string>('Squat');
  const [prSearch, setPrSearch] = useState<string>('');
  const [selectedPrMuscle, setSelectedPrMuscle] = useState<string>('All');
  const [isExerciseDropdownOpen, setIsExerciseDropdownOpen] = useState(false);
  const [isMuscleDropdownOpen, setIsMuscleDropdownOpen] = useState(false);
  const [showTargetInfo, setShowTargetInfo] = useState(false);

  // Extract all unique exercises logged in history
  const uniqueExercises = useMemo(() => {
    const list = new Set<string>();
    workoutLogs.forEach(log => {
      log.exercises.forEach(ex => {
        if (ex.name && (!ex.modality || ex.modality === 'weighted')) {
          list.add(ex.name);
        }
      });
    });
    // Add default if empty
    if (list.size === 0) list.add('Squat');
    return Array.from(list);
  }, [workoutLogs]);

  useEffect(() => {
    if (uniqueExercises.length > 0 && !uniqueExercises.includes(selectedExercise)) {
      setSelectedExercise(uniqueExercises[0]);
    }
  }, [uniqueExercises, selectedExercise]);

  // Track weight history for the selected exercise (ordered chronologically)
  const exerciseHistory = useMemo(() => {
    const data: Array<{ date: string; maxWeight: number; max1RM: number; sleep: number; calories: number; rpe: number }> = [];

    // Sort logs chronologically
    const sortedLogs = [...workoutLogs].sort((a, b) => a.date.localeCompare(b.date));

    sortedLogs.forEach(log => {
      const ex = log.exercises.find(e => e.name.toLowerCase() === selectedExercise.toLowerCase() && (!e.modality || e.modality === 'weighted'));
      if (ex && ex.sets.length > 0) {
        // Find maximum weight lifted in this session
        const weights = ex.sets.map(s => s.weight || 0);
        const maxWeight = Math.max(...weights, 0);

        // Calculate peak 1RM for this session using Epley formula
        const epley1RMs = ex.sets.map(s => {
          const w = s.weight || 0;
          const r = s.reps || 0;
          if (r <= 0) return 0;
          if (r === 1) return w;
          return w * (1 + r / 30); // Epley Formula
        });
        const max1RM = Math.max(...epley1RMs, 0);

        // Find average RPE
        const rpes = ex.sets.map(s => s.rpe || 8);
        const avgRpe = rpes.length > 0 ? rpes.reduce((a, b) => a + b, 0) / rpes.length : 8;

        data.push({
          date: new Date(log.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
          maxWeight,
          max1RM: Math.round(max1RM * 10) / 10,
          sleep: log.recovery?.sleepHours || 7,
          calories: log.recovery?.nutritionCalories || 2000,
          rpe: avgRpe,
        });
      }
    });

    return data;
  }, [workoutLogs, selectedExercise]);

  // Downsample to max 10 points if there are too many logs, ensuring beautiful distribution across time
  const processedHistory = useMemo(() => {
    if (exerciseHistory.length <= 10) {
      return exerciseHistory;
    }
    const maxPoints = 10;
    const bucketSize = exerciseHistory.length / maxPoints;
    const downsampled: typeof exerciseHistory = [];

    for (let i = 0; i < maxPoints; i++) {
      const startIdx = Math.floor(i * bucketSize);
      const endIdx = Math.min(Math.floor((i + 1) * bucketSize), exerciseHistory.length);
      const slice = exerciseHistory.slice(startIdx, endIdx);

      if (slice.length > 0) {
        // Use the peak 1RM in this chronological window to accurately represent peak capacity
        let bestPoint = slice[0];
        for (let j = 1; j < slice.length; j++) {
          if (slice[j].max1RM > bestPoint.max1RM) {
            bestPoint = slice[j];
          }
        }
        downsampled.push(bestPoint);
      }
    }
    return downsampled;
  }, [exerciseHistory]);

  // Plateau Detection calculation based on 1RM standardisation
  const plateauStatus = useMemo(() => {
    if (exerciseHistory.length < 3) {
      return { status: 'Insufficient Data', desc: 'Log at least 3 sessions of this exercise to analyze trendlines.' };
    }
    const lastThree = exerciseHistory.slice(-3);
    const w1 = lastThree[0].max1RM;
    const w2 = lastThree[1].max1RM;
    const w3 = lastThree[2].max1RM;

    if (w3 > w2 && w2 >= w1) {
      return { status: 'Breaking Through', desc: 'Great job! Your standardized 1RM strength curve is actively ascending week-over-week.', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' };
    } else if (Math.abs(w3 - w2) < 1 && Math.abs(w2 - w1) < 1) {
      return { status: 'Strength Plateau', desc: 'Your estimated 1RM is stuck. Try increasing recovery, tweaking food volume, or deloading.', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' };
    } else {
      return { status: 'Stable Strength', desc: 'Your lifting weight and 1RM is steady. Focus on form optimization and high intensity.', color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20' };
    }
  }, [exerciseHistory]);

  // PR Spotlights matched with recovery stats and standardized by estimated 1RM
  const personalRecords = useMemo(() => {
    const prMap: Record<
      string,
      {
        weight: number;
        reps: number;
        est1RM: number;
        date: string;
        sleep: number;
        calories: number;
        hydration: number;
        muscleGroup: string;
      }
    > = {};

    workoutLogs.forEach(log => {
      log.exercises.forEach(ex => {
        if (!ex.modality || ex.modality === 'weighted') {
          ex.sets.forEach(s => {
            const w = s.weight || 0;
            const r = s.reps || 0;
            if (w > 0 && r > 0) {
              const est = r === 1 ? w : w * (1 + r / 30);
              const roundedEst = Math.round(est * 10) / 10;
              const existing = prMap[ex.name];
              if (!existing || roundedEst > existing.est1RM) {
                prMap[ex.name] = {
                  weight: w,
                  reps: r,
                  est1RM: roundedEst,
                  date: log.date,
                  sleep: log.recovery?.sleepHours || 7,
                  calories: log.recovery?.nutritionCalories || 2500,
                  hydration: log.recovery?.hydrationLiters || 2,
                  muscleGroup: ex.muscleGroup || 'Other',
                };
              }
            }
          });
        }
      });
    });

    return Object.entries(prMap).map(([exercise, details]) => ({
      exercise,
      ...details,
    })).sort((a, b) => b.est1RM - a.est1RM);
  }, [workoutLogs]);

  // Extract unique muscle groups from the personal records for filtering
  const uniquePrMuscles = useMemo(() => {
    const muscles = new Set<string>();
    personalRecords.forEach(pr => {
      if (pr.muscleGroup) {
        muscles.add(pr.muscleGroup);
      }
    });
    return Array.from(muscles).sort();
  }, [personalRecords]);

  // Filter personal records by search query and muscle group
  const filteredPersonalRecords = useMemo(() => {
    return personalRecords.filter(pr => {
      const matchesSearch = pr.exercise.toLowerCase().includes(prSearch.toLowerCase());
      const matchesMuscle = selectedPrMuscle === 'All' || pr.muscleGroup === selectedPrMuscle;
      return matchesSearch && matchesMuscle;
    });
  }, [personalRecords, prSearch, selectedPrMuscle]);

  // Correlation metrics: Sleep Impact & Calories fuel factor computed dynamically for the selected exercise using standardized Est. 1RM
  const correlations = useMemo(() => {
    // Find all sessions for the selected exercise
    const sessions: Array<{ est1RM: number; sleep: number; calories: number }> = [];

    // Sort logs chronologically to ensure accurate trend-line tracking
    const sortedLogs = [...workoutLogs].sort((a, b) => a.date.localeCompare(b.date));

    sortedLogs.forEach(log => {
      const sleep = log.recovery?.sleepHours ?? 7;
      const cals = log.recovery?.nutritionCalories ?? 2500;

      log.exercises.forEach(ex => {
        if (ex.name.toLowerCase() === selectedExercise.toLowerCase() && (!ex.modality || ex.modality === 'weighted')) {
          // Calculate peak 1RM for this exercise session
          const epley1RMs = ex.sets.map(s => {
            const w = s.weight || 0;
            const r = s.reps || 0;
            if (r <= 0) return 0;
            if (r === 1) return w;
            return w * (1 + r / 30);
          });
          const max1RM = Math.max(...epley1RMs, 0);
          if (max1RM > 0) {
            sessions.push({ est1RM: max1RM, sleep, calories: cals });
          }
        }
      });
    });

    if (sessions.length < 2) {
      return {
        sleepFactor: 'Needs 2+ Logs',
        calFactor: 'Needs 2+ Logs',
        sleepCount: sessions.length,
        calCount: sessions.length,
        sleepDesc: `Log at least 2 sessions of ${selectedExercise} to analyze recovery correlation.`,
        calDesc: `Log at least 2 sessions of ${selectedExercise} to analyze recovery correlation.`,
        targetSleep: null,
        targetCalories: null,
        targetMethod: "Log more data",
        isCalculated: false,
      };
    }

    // 1. SLEEP CORRELATION
    const sleepValues = sessions.map(s => s.sleep);
    const minSleep = Math.min(...sleepValues);
    const maxSleep = Math.max(...sleepValues);

    let sleepFactorStr = 'Stable (+0.0%)';
    let sleepDesc = `Your sleep duration is steady at ${avgSleep(sleepValues).toFixed(1)} hours across your logged ${selectedExercise} sessions.`;

    function avgSleep(arr: number[]) {
      return arr.reduce((a, b) => a + b, 0) / arr.length;
    }

    if (maxSleep > minSleep) {
      const avgSleepThreshold = avgSleep(sleepValues);
      const highSleepGroup = sessions.filter(s => s.sleep >= avgSleepThreshold);
      const lowSleepGroup = sessions.filter(s => s.sleep < avgSleepThreshold);

      if (highSleepGroup.length > 0 && lowSleepGroup.length > 0) {
        const avgHigh1RM = highSleepGroup.reduce((sum, s) => sum + s.est1RM, 0) / highSleepGroup.length;
        const avgLow1RM = lowSleepGroup.reduce((sum, s) => sum + s.est1RM, 0) / lowSleepGroup.length;
        
        if (avgLow1RM > 0) {
          const diff = ((avgHigh1RM - avgLow1RM) / avgLow1RM) * 100;
          const sign = diff >= 0 ? '+' : '';
          sleepFactorStr = `${sign}${diff.toFixed(1)}%`;
          sleepDesc = `When sleeping above your average of ${avgSleepThreshold.toFixed(1)} hrs, your estimated 1RM tracks ${diff >= 0 ? 'higher' : 'lower'} by average.`;
        }
      }
    } else {
      sleepFactorStr = 'Stable (0.0%)';
      sleepDesc = `Log varying sleep durations (currently all ${minSleep} hrs) to see how it affects your ${selectedExercise} performance!`;
    }

    // 2. CALORIE CORRELATION
    const calValues = sessions.map(s => s.calories);
    const minCals = Math.min(...calValues);
    const maxCals = Math.max(...calValues);

    let calFactorStr = 'Stable (+0.0%)';
    let calDesc = `Your calorie intake is steady at ${Math.round(avgCal(calValues))} kcal across your logged ${selectedExercise} sessions.`;

    function avgCal(arr: number[]) {
      return arr.reduce((a, b) => a + b, 0) / arr.length;
    }

    if (maxCals > minCals) {
      const avgCalThreshold = avgCal(calValues);
      const highCalGroup = sessions.filter(s => s.calories >= avgCalThreshold);
      const lowCalGroup = sessions.filter(s => s.calories < avgCalThreshold);

      if (highCalGroup.length > 0 && lowCalGroup.length > 0) {
        const avgHigh1RM = highCalGroup.reduce((sum, s) => sum + s.est1RM, 0) / highCalGroup.length;
        const avgLow1RM = lowCalGroup.reduce((sum, s) => sum + s.est1RM, 0) / lowCalGroup.length;

        if (avgLow1RM > 0) {
          const diff = ((avgHigh1RM - avgLow1RM) / avgLow1RM) * 100;
          const sign = diff >= 0 ? '+' : '';
          calFactorStr = `${sign}${diff.toFixed(1)}%`;
          calDesc = `When eating above your average of ${Math.round(avgCalThreshold)} kcal, your estimated 1RM tracks ${diff >= 0 ? 'higher' : 'lower'} by average.`;
        }
      }
    } else {
      calFactorStr = 'Stable (0.0%)';
      calDesc = `Log varying calories (currently all ${minCals} kcal) to see how it fuels your ${selectedExercise} sessions!`;
    }

    // 3. TARGET CALCULATIONS (Strength Optimization Formula)
    const peak1RM = Math.max(...sessions.map(s => s.est1RM));
    let targetSessions: typeof sessions = [];
    let targetMethod = "Baseline recommendation";
    let isCalculated = false;

    // A: Try to find sessions within 10%, 15%, or 20% of peak 1RM that showed an upward strength trend compared to previous session
    for (const threshold of [0.90, 0.85, 0.80]) {
      const matches: typeof sessions = [];
      for (let i = 1; i < sessions.length; i++) {
        const current = sessions[i];
        const prev = sessions[i - 1];
        if (current.est1RM >= threshold * peak1RM && current.est1RM > prev.est1RM) {
          matches.push(current);
        }
      }
      if (matches.length > 0) {
        targetSessions = matches;
        targetMethod = `Averaged from peak sessions (within ${Math.round((1 - threshold) * 100)}% of 1RM) showing upward trend`;
        isCalculated = true;
        break;
      }
    }

    // B: Fallback to any sessions showing upward strength trend if peak zone is sparse
    if (targetSessions.length === 0) {
      const matches: typeof sessions = [];
      for (let i = 1; i < sessions.length; i++) {
        if (sessions[i].est1RM > sessions[i - 1].est1RM) {
          matches.push(sessions[i]);
        }
      }
      if (matches.length > 0) {
        targetSessions = matches;
        targetMethod = "Averaged from all sessions showing upward strength trend";
        isCalculated = true;
      }
    }

    // C: Fallback to top 3 peak performance sessions if no upward trend exists
    if (targetSessions.length === 0 && sessions.length >= 1) {
      const sortedBy1RM = [...sessions].sort((a, b) => b.est1RM - a.est1RM);
      targetSessions = sortedBy1RM.slice(0, Math.min(3, sessions.length));
      targetMethod = `Averaged from your top ${targetSessions.length} peak performance sessions`;
      isCalculated = true;
    }

    let targetSleep = 8.0;
    let targetCalories = 2500;

    if (targetSessions.length > 0) {
      const avgSleepVal = targetSessions.reduce((sum, s) => sum + s.sleep, 0) / targetSessions.length;
      const avgCalVal = targetSessions.reduce((sum, s) => sum + s.calories, 0) / targetSessions.length;
      
      // Keep inside healthy bounds, round sleep to 1 decimal place and calories to integers
      targetSleep = Math.max(7.5, Math.min(9.0, Math.round(avgSleepVal * 10) / 10));
      targetCalories = Math.round(avgCalVal);
    } else {
      // General fallbacks if no logs
      const allSleep = sessions.map(s => s.sleep);
      const allCals = sessions.map(s => s.calories);
      if (allSleep.length > 0) {
        const avg = allSleep.reduce((a, b) => a + b, 0) / allSleep.length;
        targetSleep = Math.max(7.5, Math.min(8.5, Math.round((avg + 0.5) * 10) / 10));
      }
      if (allCals.length > 0) {
        const avg = allCals.reduce((a, b) => a + b, 0) / allCals.length;
        targetCalories = Math.round(avg + 200); // 200 kcal surplus buffer for growth
      }
    }

    return {
      sleepFactor: sleepFactorStr,
      calFactor: calFactorStr,
      sleepCount: sessions.length,
      calCount: sessions.length,
      sleepDesc,
      calDesc,
      targetSleep,
      targetCalories,
      targetMethod,
      isCalculated,
    };
  }, [workoutLogs, selectedExercise]);

  // Custom SVG Chart dimensions
  const chartWidth = 500;
  const chartHeight = 160;
  const padding = 24;

  const svgPaths = useMemo(() => {
    if (processedHistory.length < 2) return { linePath: '', dots: [] };

    const onesRM = processedHistory.map(d => d.max1RM);
    const minW = Math.min(...onesRM) * 0.9; // 10% lower boundary for nice scale
    const maxW = Math.max(...onesRM) * 1.1; // 10% upper boundary
    const range = maxW - minW || 10;

    const points = processedHistory.map((d, index) => {
      const x = padding + (index / (processedHistory.length - 1)) * (chartWidth - padding * 2);
      const y = chartHeight - padding - ((d.max1RM - minW) / range) * (chartHeight - padding * 2);
      return { x, y, val: d.max1RM, rawWeight: d.maxWeight, date: d.date };
    });

    let linePath = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      linePath += ` L ${points[i].x} ${points[i].y}`;
    }

    return { linePath, dots: points };
  }, [processedHistory]);

  return (
    <div className="space-y-6 pb-20">
      {/* Header Bar */}
      <div className="flex items-center gap-2 border-b border-slate-850 pb-3 px-4">
        <Dumbbell className="w-5 h-5 text-indigo-400" />
        <div>
          <h2 className="font-extrabold text-sm text-white uppercase tracking-wide">Performance & Trends</h2>
          <p className="text-[10px] text-indigo-400 font-mono uppercase tracking-widest">Progress and analytics for weighted exercises</p>
        </div>
      </div>

      {/* Selector and Chart Card */}
      <div className="w-full bg-slate-900 border-y border-x-0 border-slate-800 p-4 shadow-sm rounded-none">
        <div className="border-b border-slate-850 pb-3 mb-4 space-y-3">
          <div className="flex items-center gap-2">
            <LineChart className="w-5 h-5 text-indigo-400" />
            <div>
              <h2 className="font-extrabold text-xs text-slate-300 uppercase tracking-wide">Strength Progression</h2>
              <p className="text-[9px] text-slate-500 font-semibold uppercase tracking-wider">Standardized Est. 1RM (Epley formula)</p>
            </div>
          </div>
          
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsExerciseDropdownOpen(!isExerciseDropdownOpen)}
              className="w-full bg-slate-950 border border-slate-850 rounded-none px-3 text-sm font-bold text-slate-300 focus:outline-none focus:border-indigo-500 h-11 flex items-center justify-between cursor-pointer hover:bg-slate-900 transition"
            >
              <span>{selectedExercise}</span>
              <span className="text-[8px] text-slate-500">▼</span>
            </button>
            {isExerciseDropdownOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsExerciseDropdownOpen(false)} />
                <div className="absolute left-0 right-0 top-12 bg-slate-950 border border-slate-800 rounded-none shadow-2xl z-50 overflow-y-auto max-h-60 py-1 font-sans">
                  {uniqueExercises.map(exName => (
                    <button
                      key={exName}
                      type="button"
                      onClick={() => {
                        setSelectedExercise(exName);
                        setIsExerciseDropdownOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2.5 text-xs font-bold border-y border-transparent cursor-pointer transition ${
                        selectedExercise === exName
                          ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30'
                          : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                      }`}
                    >
                      {exName}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Dynamic SVG chart */}
        {exerciseHistory.length < 2 ? (
          <div className="h-40 flex flex-col items-center justify-center border border-dashed border-slate-800 rounded-none bg-slate-950/40 p-4 text-center">
            <AlertCircle className="w-5 h-5 text-slate-600 mb-2" />
            <p className="text-xs text-slate-500 max-w-xs font-medium font-sans">
              Not enough chronological logs for <strong className="text-slate-400">{selectedExercise}</strong> to plot regression graphs. Keep logging!
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {exerciseHistory.length > 10 && (
              <div className="text-[9px] text-indigo-400 font-bold bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-1.5 rounded-none inline-flex items-center gap-1.5 shadow-sm font-sans">
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                Showing {processedHistory.length} chronological peak points across {exerciseHistory.length} logged sessions. Hover for details!
              </div>
            )}
            <div className="relative overflow-hidden rounded-none border border-slate-850 bg-slate-950/75 p-2">
              <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-auto">
                {/* Horizontal reference lines */}
                <line x1={padding} y1={chartHeight / 2} stroke="var(--theme-border, #1E293B)" strokeDasharray="3 3" />
                
                {/* Main line path */}
                <path d={svgPaths.linePath} fill="none" stroke="url(#gradient-indigo-cyan)" strokeWidth="3" strokeLinecap="round" />
                
                {/* Dots along path */}
                {svgPaths.dots.map((dot, idx) => (
                  <g key={idx} className="group cursor-pointer">
                    <title>
                      {`Date: ${dot.date}\nStandardized Est. 1RM: ${dot.val} kg\nLogged Max Weight: ${dot.rawWeight} kg`}
                    </title>
                    <circle cx={dot.x} cy={dot.y} r="5" className="fill-slate-950 stroke-indigo-400 stroke-[2.5]" />
                    {/* Text above active dots - increased font size and brightness for maximum clarity */}
                    <text x={dot.x} y={dot.y - 12} className="fill-slate-100 text-[14px] font-mono font-black animate-pulse" textAnchor="middle">
                      {dot.val}kg
                    </text>
                    {/* Date label at bottom of chart */}
                    <text x={dot.x} y={chartHeight - 4} className="fill-slate-400 text-[8px] font-bold" textAnchor="middle">
                      {dot.date}
                    </text>
                  </g>
                ))}

                <defs>
                  <linearGradient id="gradient-indigo-cyan" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="var(--theme-accent, #6366f1)" />
                    <stop offset="100%" stopColor="var(--theme-accent-cyan, #06b6d4)" />
                  </linearGradient>
                </defs>
              </svg>
            </div>

            {/* Plateau indicator badge */}
            <div className={`p-3.5 rounded-none border flex gap-3 items-start ${plateauStatus.color || 'bg-slate-950 border-slate-850 text-slate-300'}`}>
              <TrendingUp className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-extrabold text-xs uppercase tracking-wider font-sans">{plateauStatus.status}</h4>
                <p className="text-[11px] opacity-80 leading-relaxed mt-0.5 font-sans">{plateauStatus.desc}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Correlation Insight Engine */}
      <div className="w-full bg-slate-900 border-y border-x-0 border-slate-800 p-4 space-y-4 shadow-sm rounded-none">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-850 pb-2.5">
          <h3 className="font-extrabold text-xs text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <TrendingUp className="w-4.5 h-4.5 text-indigo-400" />
            Recovery Correlations
          </h3>
          <span className="text-[10px] text-indigo-400 bg-indigo-500/10 px-2.5 py-0.5 rounded-none border border-indigo-500/20 font-bold uppercase tracking-wider self-start sm:self-auto">
            Focused: {selectedExercise}
          </span>
        </div>

        {correlations && correlations.sleepCount >= 2 ? (
          <div className="grid md:grid-cols-2 gap-3">
            {/* Left Column: Sleep Correlation & Target */}
            <div className="flex flex-col gap-1.5">
              {/* Sleep Correlation Card */}
              <div className="bg-slate-950/70 p-3.5 rounded-none border border-slate-850 space-y-3 flex flex-col justify-between flex-1">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Coffee className="w-4 h-4 text-indigo-400" />
                    <h4 className="font-bold text-xs text-white uppercase tracking-wider">The Sleep Bonus</h4>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed font-sans">
                    {correlations.sleepDesc}
                  </p>
                </div>
                
                <div className="border-t border-slate-900/50 pt-2.5">
                  <div className="text-[8px] text-slate-500 font-bold uppercase tracking-widest font-mono">1RM Correlation</div>
                  <div className="text-xl sm:text-2xl font-black text-indigo-400 font-mono">
                    {correlations.sleepFactor}
                  </div>
                </div>
              </div>

              {/* Target Sleep Card */}
              {correlations.targetSleep && (
                <div className="bg-slate-950/45 p-3.5 rounded-none border border-slate-850 space-y-2 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Target className="w-4 h-4 text-indigo-400" />
                      <h4 className="font-bold text-xs text-white uppercase tracking-wider">Target Sleep</h4>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowTargetInfo(true)}
                      className="p-1 hover:bg-slate-900 rounded-none text-slate-500 hover:text-indigo-400 transition cursor-pointer"
                      title="How is this calculated?"
                    >
                      <Info className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div>
                    <div className="text-xl sm:text-2xl font-black text-indigo-400 font-mono">
                      {correlations.targetSleep} hrs
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right Column: Calories Correlation & Target */}
            <div className="flex flex-col gap-1.5">
              {/* Calories Correlation Card */}
              <div className="bg-slate-950/70 p-3.5 rounded-none border border-slate-850 space-y-3 flex flex-col justify-between flex-1">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Flame className="w-4 h-4 text-amber-500" />
                    <h4 className="font-bold text-xs text-white uppercase tracking-wider">Caloric factor</h4>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed font-sans">
                    {correlations.calDesc}
                  </p>
                </div>

                <div className="border-t border-slate-900/50 pt-2.5">
                  <div className="text-[8px] text-slate-500 font-bold uppercase tracking-widest font-mono">1RM Correlation</div>
                  <div className="text-xl sm:text-2xl font-black text-amber-500 font-mono">
                    {correlations.calFactor}
                  </div>
                </div>
              </div>

              {/* Target Intake Card */}
              {correlations.targetCalories && (
                <div className="bg-slate-950/45 p-3.5 rounded-none border border-slate-850 space-y-2 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Target className="w-4 h-4 text-amber-500" />
                      <h4 className="font-bold text-xs text-white uppercase tracking-wider">Target Intake</h4>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowTargetInfo(true)}
                      className="p-1 hover:bg-slate-900 rounded-none text-slate-500 hover:text-amber-500 transition cursor-pointer"
                      title="How is this calculated?"
                    >
                      <Info className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div>
                    <div className="text-xl sm:text-2xl font-black text-amber-500 font-mono">
                      {correlations.targetCalories.toLocaleString()} kcal
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="p-4 bg-slate-950/40 rounded-none text-center border border-slate-950 text-[11px] text-slate-500 leading-relaxed font-sans">
            Not enough {selectedExercise} sessions logged with mixed recovery data to compute correlations. Make sure to input **Sleep** and **Calories** when saving your workouts!
          </div>
        )}
      </div>

      {/* PR Spotlight with wellness factors */}
      <div className="w-full bg-slate-900 border-y border-x-0 border-slate-800 p-4 shadow-sm rounded-none">
        <div className="border-b border-slate-850 pb-3 mb-4 space-y-3">
          <div className="flex items-center gap-2">
            <Award className="w-5 h-5 text-cyan-400" />
            <div>
              <h2 className="font-extrabold text-xs text-slate-300 uppercase tracking-wide">Personal Records</h2>
              <p className="text-[9px] text-slate-500 font-semibold uppercase tracking-wider">All-time peak lift performance & recovery tracking</p>
            </div>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              placeholder="Search exercise..."
              value={prSearch}
              onChange={e => setPrSearch(e.target.value)}
              className="w-full sm:flex-1 bg-slate-950 border border-slate-850 rounded-none px-3 text-sm font-bold text-slate-300 placeholder-slate-600 focus:outline-none focus:border-cyan-500 h-11 font-sans"
            />
            <div className="w-full sm:w-48 relative">
              <button
                type="button"
                onClick={() => setIsMuscleDropdownOpen(!isMuscleDropdownOpen)}
                className="w-full bg-slate-950 border border-slate-850 rounded-none px-3 text-sm font-bold text-slate-300 focus:outline-none focus:border-cyan-500 h-11 flex items-center justify-between cursor-pointer hover:bg-slate-900 transition"
              >
                <span>{selectedPrMuscle === 'All' ? 'All Muscles' : selectedPrMuscle}</span>
                <span className="text-[8px] text-slate-500">▼</span>
              </button>
              {isMuscleDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsMuscleDropdownOpen(false)} />
                  <div className="absolute left-0 right-0 top-12 bg-slate-950 border border-slate-800 rounded-none shadow-2xl z-50 overflow-y-auto max-h-48 py-1 font-sans">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPrMuscle('All');
                        setIsMuscleDropdownOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2.5 text-xs font-bold border-y border-transparent cursor-pointer transition ${
                        selectedPrMuscle === 'All'
                          ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30'
                          : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                      }`}
                    >
                      All Muscles
                    </button>
                    {uniquePrMuscles.map(m => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          setSelectedPrMuscle(m);
                          setIsMuscleDropdownOpen(false);
                        }}
                        className={`w-full text-left px-4 py-2.5 text-xs font-bold border-y border-transparent cursor-pointer transition ${
                          selectedPrMuscle === m
                            ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30'
                            : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {personalRecords.length === 0 ? (
          <p className="text-xs text-slate-500 italic text-center py-4 font-sans">No PR records recorded yet.</p>
        ) : filteredPersonalRecords.length === 0 ? (
          <p className="text-xs text-slate-500 italic text-center py-4 font-sans">No exercises match search or muscle filter.</p>
        ) : (
          <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
            {filteredPersonalRecords.map((pr, idx) => (
              <div key={idx} className="bg-slate-950/50 border border-slate-850 rounded-none p-3.5 flex justify-between items-center gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h4 className="font-black text-xs text-white flex items-center gap-1.5 uppercase tracking-wide font-sans">
                      <Dumbbell className="w-4 h-4 text-indigo-400" />
                      {pr.exercise}
                    </h4>
                    <span className="text-[8px] bg-indigo-500/10 text-indigo-300 px-1.5 py-0.5 rounded-none font-bold border border-indigo-500/15 uppercase tracking-wider">
                      {pr.muscleGroup}
                    </span>
                  </div>
                  {/* Matching recovery criteria on that day */}
                  <div className="flex items-center gap-2.5 text-[10px] font-bold text-slate-500 mt-2 font-mono">
                    <span className="flex items-center gap-0.5"><Coffee className="w-3 h-3" /> {pr.sleep}h sleep</span>
                    <span className="flex items-center gap-0.5"><Flame className="w-3 h-3" /> {pr.calories}kcal</span>
                    <span className="flex items-center gap-0.5"><Droplet className="w-3 h-3" /> {pr.hydration}L</span>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="text-xs font-bold text-slate-400 font-sans">
                    Est. 1RM: <span className="font-black text-emerald-400 font-mono text-sm">{pr.est1RM} kg</span>
                  </div>
                  <div className="text-[10px] text-slate-500 font-bold font-mono mt-0.5">
                    Best: {pr.weight} kg × {pr.reps} rep{pr.reps > 1 ? 's' : ''}
                  </div>
                  <div className="text-[9px] text-slate-600 font-bold font-mono">
                    {new Date(pr.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Target Info Explanation Modal */}
      {showTargetInfo && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-150" onClick={() => setShowTargetInfo(false)}>
          <div className="bg-slate-900 border border-slate-800 rounded-none w-full max-w-md p-5 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <h3 className="font-extrabold text-xs text-white uppercase tracking-wider flex items-center gap-1.5">
                <Target className="w-4 h-4 text-indigo-400 animate-pulse" />
                PR Optimizing Target Formula
              </h3>
              <button 
                type="button"
                onClick={() => setShowTargetInfo(false)}
                className="p-1 hover:bg-slate-850 rounded-none text-slate-400 hover:text-white transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="space-y-3 text-xs leading-relaxed font-sans text-slate-300">
              <p>
                <strong className="text-white">PR Optimizing Targets</strong> provide personalized guidelines designed to maximize your progressive overload potential.
              </p>
              <p>
                Rather than generic population guidelines, these values are synthesized dynamically from your own logged data:
              </p>
              <ul className="list-disc list-inside space-y-2 pl-1 font-sans text-slate-400">
                <li>We isolate your high-intensity peak zone (<strong className="text-white">workouts within 10-20% of your maximum estimated 1RM</strong>) for <strong className="text-indigo-400">{selectedExercise}</strong>.</li>
                <li>We filter for sessions where your strength followed a progressive <strong className="text-emerald-400">upward trendline</strong> compared to the previous session.</li>
                <li>We average the corresponding sleep and caloric metrics from those positive-trend, high-intensity workouts to define your ideal "fuel" conditions.</li>
              </ul>
              
              <div className="bg-slate-950 p-3 border border-slate-850 text-[10px] text-slate-400 font-mono uppercase tracking-wider space-y-1">
                <div><span className="text-slate-500">Exercise:</span> <span className="text-slate-300 font-bold">{selectedExercise}</span></div>
                <div><span className="text-slate-500">Active Model:</span> <span className="text-slate-300 font-bold">{correlations?.targetMethod || 'Standard Formula'}</span></div>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setShowTargetInfo(false)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black uppercase tracking-wider transition rounded-none cursor-pointer"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
