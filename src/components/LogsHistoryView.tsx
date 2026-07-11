/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Calendar, Trash2, Dumbbell, Clock, ChevronDown, ChevronUp, MessageSquare, Coffee, Droplet, Flame, Award, Info, X, Pencil, ArrowLeft } from 'lucide-react';
import { WorkoutLog, mapLitersToHydration } from '../types';
import { storage } from '../lib/storage';
import { ConfirmationModal } from './ConfirmationModal';
import { classifyWorkout } from '../lib/workoutClassifier';
import { parseLocalDate } from '../lib/dateUtils';
import { useModalHistory } from '../lib/useModalHistory';

// Format date to: TUE 9 JUN 26 format
const formatDateWithTwoDigitYear = (dateStr: string) => {
  const d = parseLocalDate(dateStr);
  const weekdays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  
  const weekday = weekdays[d.getDay()];
  const day = d.getDate();
  const month = months[d.getMonth()];
  const year2digit = String(d.getFullYear()).slice(-2);
  
  return `${weekday} ${day} ${month} ${year2digit}`;
};

function getCategoryStyles(category: string, themeId?: string) {
  const isDesert = themeId === 'amber';
  const cleanCategory = (category || '').toLowerCase();
  
  if (cleanCategory.includes('peak') || cleanCategory.includes('test')) {
    if (isDesert) {
      return {
        badge: 'text-[#9B1C1C] bg-[#FDF2F2] border-[#E05A47] shadow-sm font-extrabold',
        card: 'bg-[#FAF5F0] border-[#E05A47] text-[#252320]',
      };
    }
    return {
      badge: 'text-rose-100 bg-rose-950/80 border-rose-500/50 shadow-[0_0_12px_rgba(244,63,94,0.12)] font-black',
      card: 'bg-rose-950/40 border-rose-500/50 text-rose-100',
    };
  }
  
  if (cleanCategory.includes('recovery') || cleanCategory.includes('deload')) {
    if (isDesert) {
      return {
        badge: 'text-[#065F46] bg-[#ECFDF5] border-emerald-400/80 shadow-sm font-extrabold',
        card: 'bg-[#FAF5F0] border-emerald-400/80 text-[#252320]',
      };
    }
    return {
      badge: 'text-emerald-100 bg-emerald-950/80 border-emerald-500/50 font-black',
      card: 'bg-emerald-950/40 border-emerald-500/50 text-emerald-100',
    };
  }
  
  if (cleanCategory.includes('strength')) {
    if (isDesert) {
      return {
        badge: 'text-[#3730A3] bg-[#EEF2FF] border-indigo-400/80 shadow-sm font-extrabold',
        card: 'bg-[#FAF5F0] border-indigo-400/80 text-[#252320]',
      };
    }
    return {
      badge: 'text-indigo-100 bg-indigo-950/80 border-indigo-500/50 font-black',
      card: 'bg-indigo-950/40 border-indigo-500/50 text-indigo-100',
    };
  }
  
  if (cleanCategory.includes('hypertrophy')) {
    if (isDesert) {
      return {
        badge: 'text-[#155E75] bg-[#ECFEFF] border-cyan-400/80 shadow-sm font-extrabold',
        card: 'bg-[#FAF5F0] border-cyan-400/80 text-[#252320]',
      };
    }
    return {
      badge: 'text-cyan-100 bg-cyan-950/80 border-cyan-500/50 font-black',
      card: 'bg-cyan-950/40 border-cyan-500/50 text-cyan-100',
    };
  }
  
  if (cleanCategory.includes('technique') || cleanCategory.includes('skill')) {
    if (isDesert) {
      return {
        badge: 'text-[#92400E] bg-[#FFFBEB] border-amber-400/80 shadow-sm font-extrabold',
        card: 'bg-[#FAF5F0] border-amber-400/80 text-[#252320]',
      };
    }
    return {
      badge: 'text-amber-100 bg-amber-950/80 border-amber-500/50 font-black',
      card: 'bg-amber-950/40 border-amber-500/50 text-amber-100',
    };
  }
  
  // Mixed / Maintenance / Default
  if (isDesert) {
    return {
      badge: 'text-[#475569] bg-[#EDE8E0] border-slate-300 shadow-sm font-extrabold',
      card: 'bg-[#FAF5F0] border-slate-300 text-[#252320]',
    };
  }
  return {
    badge: 'text-slate-200 bg-slate-900 border-slate-700 shadow-sm font-black',
    card: 'bg-slate-900/40 border-slate-800 text-slate-200',
  };
}

function getFlagStyles(flag: string, themeId?: string) {
  const isDesert = themeId === 'amber';
  
  if (flag === 'Deload Recommended') {
    if (isDesert) {
      return 'text-[#9B1C1C] bg-[#FDF2F2] border-red-300 shadow-sm';
    }
    return 'text-rose-100 border-rose-500/50 bg-rose-950/80 shadow-[0_0_10px_rgba(244,63,94,0.25)]';
  }
  
  if (flag === 'Deload Watch') {
    if (isDesert) {
      return 'text-[#92400E] bg-[#FFFBEB] border-amber-300 shadow-sm';
    }
    return 'text-amber-100 border-amber-500/50 bg-amber-950/80 shadow-sm';
  }
  
  if (flag === 'PR / Progressive Overload') {
    if (isDesert) {
      return 'text-[#065F46] bg-[#ECFDF5] border-emerald-300 shadow-sm';
    }
    return 'text-emerald-100 border-emerald-500/50 bg-emerald-950/80 shadow-[0_0_10px_rgba(16,185,129,0.25)]';
  }
  
  // Default/general flags like "High Fatigue"
  if (isDesert) {
    return 'text-[#3730A3] bg-[#EEF2FF] border-indigo-300 shadow-sm';
  }
  return 'text-indigo-300 border-indigo-500/30 bg-indigo-950/70 shadow-sm';
}

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

        if (modality === 'bodyweight' || modality === 'distance' || modality === 'distance_loaded') {
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

      if (modality === 'bodyweight' || modality === 'distance' || modality === 'distance_loaded') {
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

interface TagInfo {
  title: string;
  description: string;
}

function getTagInfo(tagName: string): TagInfo {
  const clean = (tagName || '').trim().toLowerCase();
  
  // Categories
  if (clean.includes('peak') || clean.includes('test')) {
    return {
      title: 'Peak / Test',
      description: 'Assigned during low-rep testing (1-3 reps) at 95%+ of rolling baseline e1RM or during new high-confidence PR testing.'
    };
  }
  if (clean.includes('strength')) {
    return {
      title: 'Strength Builder',
      description: 'Lifting focused on neural adaptations. Heavily dominated by low-rep work (1-6 reps) at 80% to 92.5% intensity of rolling baselines.'
    };
  }
  if (clean.includes('hypertrophy')) {
    return {
      title: 'Hypertrophy',
      description: 'Lifting for muscular growth. Dominated by multiple high-RPE volume sets (5-25 reps) between 30% and 85% relative intensity.'
    };
  }
  if (clean.includes('technique') || clean.includes('skill')) {
    return {
      title: 'Technique / Skill Practice',
      description: 'Focused on biomechanical precision, tempo, or pause reps. Loads are moderate (30-75%) with low average session RPE and strict form.'
    };
  }
  if (clean.includes('recovery') || clean.includes('deload')) {
    return {
      title: 'Recovery / Deload Session',
      description: 'Intentional low-intensity training (40-65% load) with low RPE and strict form, designed to stimulate blood flow and joint/CNS recovery.'
    };
  }
  if (clean.includes('mixed') || clean.includes('maintenance')) {
    return {
      title: 'Mixed / Maintenance',
      description: 'Standard training sessions with mixed reps, loads, or non-specific stimulus. Useful for maintaining base conditioning.'
    };
  }

  // Flags
  if (clean.includes('progressive overload') || clean.includes('pr')) {
    return {
      title: 'PR / Progressive Overload',
      description: 'Applied when your top set estimated 1RM exceeds your historical 4-8 exposure rolling average baseline by 1.5%+.'
    };
  }
  if (clean.includes('technical breakdown')) {
    return {
      title: 'Technical Breakdown',
      description: 'Applied when loose form is reported on 25%+ of your session working sets or on your highest-intensity set.'
    };
  }
  if (clean.includes('high fatigue')) {
    return {
      title: 'High Fatigue',
      description: 'Applied when your session average RPE exceeds 8.5, soreness is 7+, or the fatigue score passes 6.5.'
    };
  }
  if (clean.includes('deload recommended')) {
    return {
      title: 'Deload Recommended',
      description: 'Triggered only when there is both a performance decline (index below 97%) AND a high fatigue marker simultaneously.'
    };
  }
  if (clean.includes('deload watch')) {
    return {
      title: 'Deload Watch',
      description: 'An advisory marker when fatigue is building but hasn\'t caused a concurrent performance decline yet.'
    };
  }

  return {
    title: tagName,
    description: 'Automated diagnostic marker from your set-level performance and systemic recovery metrics.'
  };
}

function getDynamicTagInfo(
  tagName: string,
  classification: any,
  log: WorkoutLog
): TagInfo {
  const clean = (tagName || '').trim().toLowerCase();
  
  // Custom Dynamic Message for "Deload Recommended"
  if (clean.includes('deload recommended')) {
    const performanceIndex = classification.performanceIndex;
    const stats = classification.stats;
    const soreness = log.recovery?.soreness || 5;
    const motivation = log.recovery?.motivation || 5;
    
    return {
      title: 'Deload Recommended',
      description: `We detected a performance decline (Performance Index dropped to ${performanceIndex}% of your baseline) alongside elevated fatigue markers: soreness at ${soreness}/10, average RPE at ${stats.avgRpe}, and motivation at ${motivation}/10. A deload week is highly recommended to prevent injury and restore neural drive.`
    };
  }

  // Custom Dynamic Message for "Deload Watch"
  if (clean.includes('deload watch')) {
    const performanceIndex = classification.performanceIndex;
    const fatigueScore = classification.fatigueScore;
    const soreness = log.recovery?.soreness || 5;
    
    return {
      title: 'Deload Watch',
      description: `Your fatigue is building (Fatigue Score: ${fatigueScore}/10, Soreness: ${soreness}/10) while performance is at ${performanceIndex}%. You're in a safe zone, but track recovery closely to avoid cumulative overreaching.`
    };
  }

  // Use the standard static lookup for everything else
  return getTagInfo(tagName);
}

interface LogsHistoryViewProps {
  workoutLogs: WorkoutLog[];
  onRefresh: () => void;
  themeId?: string;
  onNavigate?: (view: string, params?: any) => void;
}

export function LogsHistoryView({ workoutLogs, onRefresh, themeId, onNavigate }: LogsHistoryViewProps) {
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [expandedDropSets, setExpandedDropSets] = useState<Record<string, boolean>>({});
  const [deleteLogId, setDeleteLogId] = useState<string | null>(null);
  const [showGradeInfo, setShowGradeInfo] = useState(false);
  const { dismiss: dismissGradeInfo } = useModalHistory(
    showGradeInfo,
    () => setShowGradeInfo(false),
    'training-classification-system'
  );
  const [activeTag, setActiveTag] = useState<{
    logId: string;
    tagId: string;
    text: string;
    title: string;
    tagRect?: { left: number; top: number; width: number; height: number };
    cardRect?: { left: number; top: number; width: number; height: number };
  } | null>(null);
  const userBodyweight = storage.getBodyweight();

  // PR Spotlights standardisation map
  const prMap = React.useMemo(() => {
    const map: Record<string, number> = {};
    workoutLogs.forEach(log => {
      log.exercises.forEach(ex => {
        const isWeighted = !ex.modality || ex.modality === 'weighted';
        const isBw = ex.modality === 'bodyweight';
        const isAssisted = ex.modality === 'assisted';
        const isDistanceLoaded = ex.modality === 'distance_loaded';
        const isDistance = ex.modality === 'distance';
        if (isWeighted || isBw || isAssisted || isDistanceLoaded || isDistance) {
          ex.sets.forEach(s => {
            const w = s.weight || 0;
            const r = s.reps || 0;
            if (w > 0 && r > 0) {
              let est = 0;
              if (isDistance) {
                est = (r / w) * 100;
              } else {
                est = r === 1 ? w : w * (1 + r / 30);
              }
              const roundedEst = Math.round(est * 10) / 10;
              const existing = map[ex.name];
              if (!existing || roundedEst > existing) {
                map[ex.name] = roundedEst;
              }
            }
          });
        }
      });
    });
    return map;
  }, [workoutLogs]);

  const toggleExpand = (id: string) => {
    setExpandedLogId(prev => (prev === id ? null : id));
  };

  useEffect(() => {
    if (expandedLogId) {
      const timer = setTimeout(() => {
        const element = document.getElementById(`log-card-${expandedLogId}`);
        if (element) {
          element.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          });
        }
      }, 150);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [expandedLogId]);

  useEffect(() => {
    if (activeTag === null) return;

    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target && target.closest && target.closest('[data-tag-button="true"]')) {
        return;
      }
      setActiveTag(null);
    };

    document.addEventListener('click', handleOutsideClick, { passive: true });
    return () => {
      document.removeEventListener('click', handleOutsideClick);
    };
  }, [activeTag]);

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
            const uniqueMuscles = Array.from(new Set(log.exercises.map(ex => ex.muscleGroup).filter(Boolean)));

            const isDesert = themeId === 'amber';
            const popoverBg = isDesert ? 'bg-[#FAF5F0]' : 'bg-slate-950';
            const popoverBorder = isDesert ? 'border-[#E05A47]' : 'border-indigo-500/85';
            const popoverTitleColor = isDesert ? 'text-[#9B1C1C]' : 'text-indigo-400';
            const popoverTextColor = isDesert ? 'text-[#252320]' : 'text-slate-300';
            const popoverArrowBorder = isDesert ? 'border-t-[#E05A47]' : 'border-t-indigo-500/85';
            const popoverArrowBg = isDesert ? 'border-t-[#FAF5F0]' : 'border-t-slate-950';

            return (
              <div
                key={log.id}
                id={`log-card-${log.id}`}
                className="w-full bg-slate-900 border-y border-x-0 border-slate-800 rounded-none relative hover:border-slate-700 transition scroll-mt-14"
              >
                {/* Log Row Header */}
                <div className="p-4 flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-400 font-bold font-mono uppercase bg-slate-950 px-2 py-0.5 rounded-none border border-slate-850 whitespace-nowrap shrink-0">
                        {formatDateWithTwoDigitYear(log.date)}
                      </span>
                      <span className="text-sm font-black text-white truncate font-sans">
                        {log.program || 'One Off'}
                      </span>
                    </div>
 
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400 mt-2 font-bold font-sans">
                      <span className="flex items-center gap-1">
                        <Dumbbell className="w-3.5 h-3.5 text-indigo-400" />
                        {log.exercises.length} exercises
                      </span>
                      {log.durationMinutes && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-cyan-400" />
                          {log.durationMinutes} mins
                        </span>
                      )}
                      {uniqueMuscles.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Flame className="w-3.5 h-3.5 text-orange-400" />
                          {uniqueMuscles.join(', ')}
                        </span>
                      )}
                    </div>
 
                    {/* Rating and Flags Layout */}
                    <div className="flex flex-col gap-2 mt-2.5 font-sans">
                      <div className="flex items-center gap-2 text-[11px] font-bold text-slate-400">
                        <span className="uppercase tracking-wider">Rating:</span>
                        {/* Interactive Category Tag */}
                        <div className="relative inline-block">
                          <button
                            type="button"
                            data-tag-button="true"
                            onClick={(e) => {
                              e.stopPropagation();
                              const info = getDynamicTagInfo(category, classification, log);
                              if (activeTag?.logId === log.id && activeTag?.tagId === 'category') {
                                setActiveTag(null);
                              } else {
                                const rect = e.currentTarget.getBoundingClientRect();
                                const cardEl = document.getElementById(`log-card-${log.id}`);
                                const cardRect = cardEl ? cardEl.getBoundingClientRect() : null;
                                setActiveTag({
                                  logId: log.id,
                                  tagId: 'category',
                                  title: info.title,
                                  text: info.description,
                                  tagRect: {
                                    left: rect.left,
                                    top: rect.top,
                                    width: rect.width,
                                    height: rect.height,
                                  },
                                  cardRect: cardRect ? {
                                    left: cardRect.left,
                                    top: cardRect.top,
                                    width: cardRect.width,
                                    height: cardRect.height,
                                  } : undefined,
                                });
                              }
                            }}
                            className={`inline-flex items-center px-3 py-1 border-2 text-[12px] font-extrabold uppercase tracking-wider rounded-none cursor-pointer transition hover:scale-[1.02] active:scale-[0.98] ${getCategoryStyles(category, themeId).badge}`}
                          >
                            {category}
                          </button>
                        </div>
                      </div>

                      {/* Interactive Flag Tags */}
                      {flags.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-400">
                          <span className="uppercase tracking-wider shrink-0">Flags:</span>
                          {flags.map((flag, idx) => (
                            <div key={idx} className="relative inline-block">
                              <button
                                type="button"
                                data-tag-button="true"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const info = getDynamicTagInfo(flag, classification, log);
                                  if (activeTag?.logId === log.id && activeTag?.tagId === `flag-${idx}`) {
                                    setActiveTag(null);
                                  } else {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const cardEl = document.getElementById(`log-card-${log.id}`);
                                    const cardRect = cardEl ? cardEl.getBoundingClientRect() : null;
                                    setActiveTag({
                                      logId: log.id,
                                      tagId: `flag-${idx}`,
                                      title: info.title,
                                      text: info.description,
                                      tagRect: {
                                        left: rect.left,
                                        top: rect.top,
                                        width: rect.width,
                                        height: rect.height,
                                      },
                                      cardRect: cardRect ? {
                                        left: cardRect.left,
                                        top: cardRect.top,
                                        width: cardRect.width,
                                        height: cardRect.height,
                                      } : undefined,
                                    });
                                  }
                                }}
                                className={`text-[11.5px] font-mono font-black border-2 px-3 py-0.5 uppercase tracking-wide rounded-none shrink-0 cursor-pointer transition hover:scale-[1.02] active:scale-[0.98] ${getFlagStyles(flag, themeId)}`}
                              >
                                {flag}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-center gap-1.5 shrink-0 self-start mt-0.5">
                    {/* 1. Dropdown hat to expand (top) */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpand(log.id);
                      }}
                      className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-none transition cursor-pointer flex items-center justify-center"
                      title={isExpanded ? "Collapse workout log" : "Expand workout log"}
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>

                    {/* 2. Pencil icon to edit (second) */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onNavigate?.('logger', { editLogId: log.id });
                      }}
                      className="p-1.5 text-slate-500 hover:text-indigo-400 hover:bg-slate-800 rounded-none transition"
                      title="Edit workout log"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>

                    {/* 3. Delete icon (third) */}
                    <button
                      onClick={e => handleDeleteLog(log.id, e)}
                      className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded-none transition"
                      title="Delete log"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>

                    {/* 4. Info icon (bottom) */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowGradeInfo(true);
                      }}
                      className="p-1 hover:bg-slate-800 text-slate-500 hover:text-indigo-400 rounded-full transition flex items-center justify-center mt-0.5"
                      title="How are categories and flags calculated?"
                    >
                      <Info className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
 
                {/* Log Row Body Expanded */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-2 border-t border-slate-850/60 bg-slate-950/40 space-y-4">
                    {/* Session Training Category Analysis */}
                    <div className={`p-4 border-2 rounded-none mt-1.5 ${getCategoryStyles(category, themeId).card} space-y-3`}>
                      <div className="flex items-center gap-2 pb-2 border-b border-slate-800/20">
                        <Award className="w-5 h-5 shrink-0 text-inherit" />
                        <span className="text-[14px] sm:text-[15.5px] font-black uppercase tracking-wider font-sans truncate text-inherit">
                          {category}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-[12px] font-bold font-sans pt-1 border-b border-slate-850/20 pb-2.5 text-inherit animate-fade-in">
                        <div className="text-inherit">Workout Objective: <span className="font-mono text-xs text-white bg-slate-950/40 px-2 py-0.5 ml-1 border border-slate-800/30">{log.objective && log.objective !== 'Off' ? log.objective : 'None'}</span></div>
                        <div className="text-inherit">Performance Index: <span className="font-mono text-xs text-white bg-slate-950/40 px-2 py-0.5 ml-1 border border-slate-800/30">{classification.performanceIndex}%</span></div>
                      </div>
                      
                      <p className="text-[11.5px] leading-relaxed opacity-95 font-sans font-medium text-inherit">
                        {categoryDesc}
                      </p>
                      
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] font-mono text-slate-400 pt-2 border-t border-slate-850/20">
                        <div>Working Volume: <strong className="text-cyan-400">{stats.workingVolume ?? stats.totalVolume} {log.unit.toUpperCase()}</strong></div>
                        <div>Total Volume: <strong className="text-slate-200">{stats.totalVolume} {log.unit.toUpperCase()}</strong></div>
                        <div>Average RPE: <strong className="text-slate-200">{stats.avgRpe}</strong></div>
                        <div>Hard Sets: <strong className="text-slate-200">{stats.hardSets}</strong></div>
                        <div>Form Breakdown: <strong className="text-slate-200">{stats.looseRate}% loose</strong></div>
                        <div>Fatigue Score: <strong className="text-slate-200">{fatigueScore}/10</strong></div>
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
                          <span className="text-[10px] sm:text-xs font-black text-cyan-400 font-sans flex items-center justify-center gap-1 mt-0.5 uppercase">
                            <Droplet className="w-3.5 h-3.5" /> {log.recovery.hydrationLevel || (log.recovery.hydrationLiters ? mapLitersToHydration(log.recovery.hydrationLiters) : '—')}
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
                            <span className="flex items-center gap-1">
                              • {ex.name}
                              {ex.isMainMovement && (
                                <sup className="text-[9px] text-indigo-400 font-black tracking-normal align-super bg-indigo-500/10 px-1 border border-indigo-500/20 rounded-sm">MM</sup>
                              )}
                            </span>
                            <span className="text-[9px] text-indigo-400 font-semibold font-mono">({ex.muscleGroup})</span>
                          </h4>

                          <div className="space-y-1.5 pl-2.5">
                            {ex.sets.map((set, sIdx) => {
                              const isPR = (() => {
                                const isWeighted = !ex.modality || ex.modality === 'weighted';
                                const isBw = ex.modality === 'bodyweight';
                                const isAssisted = ex.modality === 'assisted';
                                const isDistanceLoaded = ex.modality === 'distance_loaded';
                                const isDistance = ex.modality === 'distance';
                                if (!isWeighted && !isBw && !isAssisted && !isDistanceLoaded && !isDistance) return false;
                                const w = set.weight || 0;
                                const r = set.reps || 0;
                                if (w <= 0 || r <= 0) return false;
                                let est = 0;
                                if (isDistance) {
                                  est = (r / w) * 100;
                                } else {
                                  est = r === 1 ? w : w * (1 + r / 30);
                                }
                                const roundedEst = Math.round(est * 10) / 10;
                                const prVal = prMap[ex.name];
                                return prVal && Math.abs(roundedEst - prVal) < 0.05;
                              })();

                              return (
                                <div key={sIdx} className="space-y-1">
                                  <div
                                    className="text-xs text-slate-400 flex items-center justify-between font-mono py-0.5"
                                  >
                                    <span>
                                      Set {set.setNumber}
                                      {set.isWarmup && (
                                        <span className="text-amber-500 font-extrabold ml-1" title="Warmup Set">⌇⌇⌇</span>
                                      )}
                                      {set.isDropSet && (
                                        <span className={`${themeId === 'amber' ? 'text-fuchsia-600' : 'text-fuchsia-400'} font-extrabold ml-1 animate-pulse`} title="Drop Set">↓</span>
                                      )}
                                      :{' '}
                                      {ex.modality === 'bodyweight' ? (
                                        <>
                                          <strong className="text-indigo-400 font-black">Bodyweight ({set.weight && set.weight !== 0 ? `${set.weight} ${log.unit.toUpperCase()}` : 'BW'})</strong> x{' '}
                                          <strong className="text-slate-200 font-black">{set.reps || 0}</strong> reps
                                        </>
                                      ) : ex.modality === 'timed' ? (
                                        <>
                                          <strong className="text-slate-200 font-black">{set.weight || 0}</strong> secs
                                        </>
                                      ) : ex.modality === 'distance' ? (
                                        <>
                                          <strong className="text-slate-200 font-black">{set.reps || 0}</strong> meters in <strong className="text-slate-200 font-black">{set.weight || 0}</strong> secs
                                        </>
                                      ) : ex.modality === 'distance_loaded' ? (
                                        <>
                                          <strong className="text-slate-200 font-black">{set.weight || 0}</strong> {log.unit} x <strong className="text-slate-200 font-black">{set.reps || 0}</strong> meters
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
                                      {isPR && (
                                        <span className={`inline-flex items-center gap-0.5 text-[8px] font-extrabold px-1 py-0.5 rounded uppercase tracking-tight animate-pulse shrink-0 ml-1.5 ${
                                          themeId === 'amber'
                                            ? 'text-[#B56D3E] bg-[#B56D3E]/10 border border-[#B56D3E]/20'
                                            : 'text-amber-400 bg-amber-500/10 border border-amber-500/20'
                                        }`} title="Personal Record!">
                                          <Award className={`w-2.5 h-2.5 shrink-0 ${themeId === 'amber' ? 'text-[#B56D3E]' : 'text-amber-400'}`} /> PR
                                        </span>
                                      )}
                                      {set.isDropSet && set.dropSubSets && set.dropSubSets.length > 0 && (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const key = `${log.id}-${exIdx}-${sIdx}`;
                                            setExpandedDropSets(prev => ({ ...prev, [key]: !prev[key] }));
                                          }}
                                          className={`ml-2 text-[9px] font-black px-1.5 py-0.5 rounded cursor-pointer transition flex items-center gap-1 inline-flex font-sans ${
                                            themeId === 'amber'
                                              ? 'text-fuchsia-700 bg-fuchsia-50/70 hover:bg-fuchsia-100 border border-fuchsia-200/50'
                                              : 'text-fuchsia-400 hover:text-fuchsia-300 bg-fuchsia-950/40 hover:bg-fuchsia-950/60 border border-fuchsia-900/40'
                                          }`}
                                        >
                                          <span>Drops ({set.dropSubSets.length})</span>
                                          <span className="text-[8px]">{expandedDropSets[`${log.id}-${exIdx}-${sIdx}`] ? '▲' : '▼'}</span>
                                        </button>
                                      )}
                                    </span>
                                    <div className="flex gap-2">
                                      <span className="text-[10px] text-slate-400 font-bold bg-slate-900 px-1.5 py-0.2 rounded-none border border-slate-850/40">RPE {set.rpe || '—'}</span>
                                      {set.form && (
                                        <span className="text-[10px] font-black text-indigo-400 capitalize">{set.form}</span>
                                      )}
                                    </div>
                                  </div>
 
                                  {/* Render Expanded Drop Sub-sets */}
                                  {set.isDropSet && expandedDropSets[`${log.id}-${exIdx}-${sIdx}`] && set.dropSubSets && set.dropSubSets.length > 0 && (
                                    <div className={`pl-4 pr-3 py-1.5 space-y-1 rounded-none mt-0.5 text-slate-400 text-xs w-full max-w-md border ${
                                      themeId === 'amber'
                                        ? 'bg-fuchsia-50/40 border-fuchsia-100/60'
                                        : 'bg-fuchsia-950/5 border-fuchsia-950/15'
                                    }`}>
                                      {set.dropSubSets.map((sub, subIdx) => (
                                        <div key={subIdx} className="flex justify-between items-center py-0.5 font-mono text-[11px]">
                                          <span className="text-slate-500">└ Drop {subIdx + 1}:</span>
                                          <span className={`font-bold ${themeId === 'amber' ? 'text-fuchsia-700' : 'text-fuchsia-400'}`}>
                                            {ex.modality === 'bodyweight' ? (
                                              <>BW ({sub.weight || 'BW'}) x {sub.reps || 0} reps</>
                                            ) : ex.modality === 'timed' ? (
                                              <>{sub.weight || 0} secs</>
                                            ) : ex.modality === 'distance' ? (
                                              <>{sub.reps || 0} meters in {sub.weight || 0} secs</>
                                            ) : ex.modality === 'distance_loaded' ? (
                                              <>{sub.weight || 0} {log.unit} x {sub.reps || 0} meters</>
                                            ) : ex.modality === 'assisted' ? (
                                              <>{sub.weight || 0} assist x {sub.reps || 0} reps</>
                                            ) : (
                                              <>{sub.weight || 0} {log.unit} x {sub.reps || 0} reps</>
                                            )}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
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

                {activeTag && activeTag.logId === log.id && activeTag.tagRect && activeTag.cardRect && (() => {
                  const isDesert = themeId === 'amber';
                  const popoverBg = isDesert ? 'bg-[#FAF5F0]' : 'bg-slate-950';
                  const popoverBorder = isDesert ? 'border-[#E05A47]' : 'border-indigo-500/85';
                  const popoverTitleColor = isDesert ? 'text-[#9B1C1C]' : 'text-indigo-400';
                  const popoverTextColor = isDesert ? 'text-[#252320]' : 'text-slate-300';

                  const { tagRect, cardRect } = activeTag;
                  const topPos = tagRect.top - cardRect.top - 8;
                  const tagCenterRel = (tagRect.left - cardRect.left) + (tagRect.width / 2);
                  const arrowLeft = tagCenterRel;
                  const arrowLeftClamped = Math.max(16, Math.min(cardRect.width - 16, arrowLeft));

                  return (
                    <div
                      style={{
                        position: 'absolute',
                        top: `${topPos}px`,
                        left: '16px',
                        right: '16px',
                        transform: 'translateY(-100%)',
                      }}
                      className={`border-2 p-3.5 shadow-2xl z-50 font-sans text-left animate-in fade-in slide-in-from-bottom-2 duration-150 ${popoverBg} ${popoverBorder}`}
                    >
                      <div className={`flex items-center justify-between border-b ${isDesert ? 'border-slate-300/40' : 'border-slate-800/40'} pb-1.5 mb-1.5`}>
                        <span className={`text-[10px] font-extrabold uppercase tracking-widest ${popoverTitleColor}`}>
                          {activeTag.title}
                        </span>
                      </div>
                      <p className={`text-[11px] font-medium leading-relaxed font-sans ${popoverTextColor}`}>
                        {activeTag.text}
                      </p>
                      {/* Little arrow aligned to clicked tag/category button */}
                      <div 
                        style={{ left: `${arrowLeftClamped}px` }}
                        className={`absolute top-full -translate-x-1/2 w-0 h-0 border-x-[6px] border-x-transparent border-t-[6px] ${
                          isDesert ? 'border-t-[#E05A47]' : 'border-t-indigo-500/85'
                        }`} 
                      />
                      <div 
                        style={{ left: `${arrowLeftClamped}px` }}
                        className={`absolute top-full -translate-x-1/2 w-0 h-0 border-x-[5px] border-x-transparent border-t-[5px] ${
                          isDesert ? 'border-t-[#FAF5F0]' : 'border-t-slate-950'
                        }`} 
                      />
                    </div>
                  );
                })()}
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
          onClick={dismissGradeInfo}
        >
          <div
            className="bg-slate-900 border border-slate-800 rounded-none w-full max-w-xl overflow-hidden flex flex-col shadow-2xl shadow-indigo-950/40 max-h-[85vh] animate-in fade-in zoom-in-95 duration-150 font-sans"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-5 bg-slate-950 border-b border-slate-850 flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center">
                  <h3 className="text-sm sm:text-lg font-black text-white uppercase tracking-wider leading-snug">
                    Training Classification System
                  </h3>
                </div>
                <p className="text-[10px] sm:text-xs text-indigo-400 font-mono uppercase tracking-widest leading-none mt-1">
                  Rule-Based Athlete Physiology Engine
                </p>
              </div>
              <button
                onClick={dismissGradeInfo}
                className="p-2 bg-slate-900 hover:bg-slate-800 rounded-none text-slate-400 hover:text-white border border-slate-800 transition cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="p-6 overflow-y-auto space-y-6 text-[14px] sm:text-[15px] text-slate-300 leading-relaxed scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
              <p>
                To help you understand how you trained, MetReps auto-labels each session with a <strong>Category</strong> (like Overload, Volume, or Recovery) and attaches <strong>Flags</strong> to call out important milestones, technique alerts, or fatigue levels.
              </p>

              {/* Performance Index Explanation */}
              <div className="space-y-2 bg-indigo-950/30 p-4 border border-indigo-900/30">
                <h4 className="font-bold text-indigo-300 flex items-center gap-2 uppercase text-xs sm:text-sm tracking-wide font-mono">
                  <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />
                  Performance Index (PI)
                </h4>
                <p className="text-slate-400 text-xs">
                  Your Performance Index measures your actual capacity in today's session relative to your historical rolling baseline. 
                  A score of <strong>100%</strong> means you perfectly matched your current baseline strength. Scores <strong>&gt;100%</strong> indicate progressive overload or new peak achievements, while scores <strong>&lt;100%</strong> indicate fatigue-induced performance decline or intentional recovery work.
                </p>
              </div>

              {/* Fatigue Score */}
              <div className="space-y-2 bg-slate-950/50 p-4 border border-slate-850">
                <h4 className="font-bold text-slate-100 flex items-center gap-2 uppercase text-xs sm:text-sm tracking-wide font-mono">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 shrink-0" />
                  Fatigue Score (1 - 10)
                </h4>
                <p className="text-slate-400 text-xs">
                  We calculate systemic fatigue by weighting post-workout Muscle Soreness (35%), Workout Quality/Motivation dropoffs (25%), Session Average working RPE (20%), Form Breakdown rate (10%), and Performance Index Drops (10%).
                </p>
              </div>

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

          </div>
        </div>
      )}


    </div>
  );
}
