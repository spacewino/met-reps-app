/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Calendar, Trash2, Dumbbell, Clock, ChevronDown, ChevronUp, MessageSquare, Coffee, Droplet, Flame, Award, Info, X, Pencil, ArrowLeft, Trophy, Zap } from 'lucide-react';
import { WorkoutLog, mapLitersToHydration } from '../types';
import { storage } from '../lib/storage';
import { ConfirmationModal } from './ConfirmationModal';
import { AchievementsModal } from './AchievementsModal';
import { WarmupIcon } from './WarmupIcon';
import { evaluateAchievements, getSelectedFeaturedTitleId, setSelectedFeaturedTitleId } from '../lib/achievements';
import { parseLocalDate } from '../lib/dateUtils';
import { useModalHistory } from '../lib/useModalHistory';
import { getHistoricalSetDisplayState } from '../lib/historicalDisplay';
import {
  generateDiaryScorecardMap,
  DiaryScorecardResult,
  DiaryInsightResult,
  DiaryInsightTone,
  DiaryRarity,
} from '../lib/diaryInsights';
import {
  groupDiaryInsights,
  getVisibleExpandedInsights,
  getDiaryRarityLabel,
  getDiaryRarityDescription,
  getCollapsedInsightBadgeLabel,
  formatDiaryNumericEvidence,
} from '../lib/diaryInsightPresentation';

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

function getPrimaryCategoryStyles(categoryId: string, themeId?: string) {
  const isDesert = themeId === 'amber';
  const clean = (categoryId || '').toLowerCase();

  if (clean.includes('peak') || clean.includes('test')) {
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

  if (clean.includes('recovery') || clean.includes('deload')) {
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

  if (clean.includes('strength')) {
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

  if (clean.includes('hypertrophy')) {
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

  if (clean.includes('technique') || clean.includes('practice') || clean.includes('skill')) {
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

  if (clean.includes('conditioning') || clean.includes('capacity')) {
    if (isDesert) {
      return {
        badge: 'text-[#115E59] bg-[#CCFBF1] border-teal-400/80 shadow-sm font-extrabold',
        card: 'bg-[#FAF5F0] border-teal-400/80 text-[#252320]',
      };
    }
    return {
      badge: 'text-teal-100 bg-teal-950/80 border-teal-500/50 font-black',
      card: 'bg-teal-950/40 border-teal-500/50 text-teal-100',
    };
  }

  // Mixed / Unavailable / Default
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

function getInsightToneStyles(tone: DiaryInsightTone, themeId?: string) {
  const isDesert = themeId === 'amber';

  if (tone === 'celebratory') {
    if (isDesert) {
      return 'text-[#065F46] bg-[#ECFDF5] border-emerald-300 shadow-sm';
    }
    return 'text-emerald-100 border-emerald-500/50 bg-emerald-950/80 shadow-[0_0_10px_rgba(16,185,129,0.25)]';
  }

  if (tone === 'cautionary') {
    if (isDesert) {
      return 'text-[#9B1C1C] bg-[#FDF2F2] border-red-300 shadow-sm';
    }
    return 'text-rose-100 border-rose-500/50 bg-rose-950/80 shadow-[0_0_10px_rgba(244,63,94,0.25)]';
  }

  // neutral
  if (isDesert) {
    return 'text-[#3730A3] bg-[#EEF2FF] border-indigo-300 shadow-sm';
  }
  return 'text-indigo-300 border-indigo-500/30 bg-indigo-950/70 shadow-sm';
}

function getRarityBadgeStyles(rarity: DiaryRarity, themeId?: string) {
  const isDesert = themeId === 'amber';

  if (rarity === 'personal_first') {
    if (isDesert) {
      return 'text-[#92400E] bg-[#FEF3C7] border-amber-400 font-extrabold';
    }
    return 'text-amber-300 bg-amber-950/90 border-amber-500/60 shadow-[0_0_8px_rgba(245,158,11,0.2)] font-black';
  }

  if (rarity === 'rare') {
    if (isDesert) {
      return 'text-[#5B21B6] bg-[#EDE9FE] border-purple-300 font-extrabold';
    }
    return 'text-purple-300 bg-purple-950/80 border-purple-500/50 font-black';
  }

  if (rarity === 'notable') {
    if (isDesert) {
      return 'text-[#3730A3] bg-[#EEF2FF] border-indigo-300 font-extrabold';
    }
    return 'text-indigo-300 bg-indigo-950/80 border-indigo-500/40 font-bold';
  }

  // common
  if (isDesert) {
    return 'text-[#6F6A63] bg-[#F5EBE0] border-slate-300 font-semibold';
  }
  return 'text-slate-400 bg-slate-900/80 border-slate-800 font-semibold';
}
interface LogsHistoryViewProps {
  workoutLogs: WorkoutLog[];
  onRefresh: () => void;
  themeId?: string;
  onNavigate?: (view: string, params?: any) => void;
}

export function LogsHistoryView({ workoutLogs, onRefresh, themeId, onNavigate }: LogsHistoryViewProps) {
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const { dismiss: collapseLog } = useModalHistory(
    expandedLogId !== null,
    () => setExpandedLogId(null),
    'diary-expanded-log'
  );
  const [expandedDropSets, setExpandedDropSets] = useState<Record<string, boolean>>({});
  const [deleteLogId, setDeleteLogId] = useState<string | null>(null);
  const [showGradeInfo, setShowGradeInfo] = useState(false);
  const { dismiss: dismissGradeInfo } = useModalHistory(
    showGradeInfo,
    () => setShowGradeInfo(false),
    'training-classification-system'
  );
  const [showAllMap, setShowAllMap] = useState<Record<string, boolean>>({});

  const scorecardMap = React.useMemo(
    () => generateDiaryScorecardMap(workoutLogs),
    [workoutLogs]
  );
  const [activeTag, setActiveTag] = useState<{
    logId: string;
    tagId: string;
    text: string;
    title: string;
    tagRect?: { left: number; top: number; width: number; height: number };
    cardRect?: { left: number; top: number; width: number; height: number };
  } | null>(null);
  const { dismiss: dismissActiveTag } = useModalHistory(
    activeTag !== null,
    () => setActiveTag(null),
    'diary-active-tag'
  );
  const userBodyweight = storage.getBodyweight();

  const [isAchievementsModalOpen, setIsAchievementsModalOpen] = useState(false);
  const [selectedTitleId, setSelectedTitleIdState] = useState<string>(
    () => getSelectedFeaturedTitleId() || 'iron-initiate'
  );

  const achievementsList = React.useMemo(() => {
    return evaluateAchievements(workoutLogs, userBodyweight);
  }, [workoutLogs, userBodyweight]);

  const featuredTitle = React.useMemo(() => {
    const chosen = achievementsList.find(a => a.id === selectedTitleId);
    if (chosen && chosen.unlocked) {
      return chosen.title;
    }
    const highestUnlocked = [...achievementsList].reverse().find(a => a.unlocked);
    return highestUnlocked ? highestUnlocked.title : 'IRON INITIATE';
  }, [achievementsList, selectedTitleId]);

  const handleSelectTitle = (id: string) => {
    setSelectedFeaturedTitleId(id);
    setSelectedTitleIdState(id);
  };

  // PR Spotlights standardisation map
  const prMap = React.useMemo(() => {
    const map: Record<string, number> = {};
    workoutLogs.forEach(log => {
      log.exercises.forEach(ex => {
        if (ex.isSkipped) return;
        const isWeighted = !ex.modality || ex.modality === 'weighted';
        const isBw = ex.modality === 'bodyweight';
        const isAssisted = ex.modality === 'assisted';
        const isDistanceLoaded = ex.modality === 'distance_loaded';
        const isDistance = ex.modality === 'distance';
        if (isWeighted || isBw || isAssisted || isDistanceLoaded || isDistance) {
          ex.sets.forEach(s => {
            if (s.isSkipped || s.isCompleted === false || s.isWarmup) return;
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

  const prevExpandedLogIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (expandedLogId) {
      prevExpandedLogIdRef.current = expandedLogId;
      const timer = setTimeout(() => {
        const element = document.getElementById(`log-card-${expandedLogId}`);
        if (element) {
          element.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          });
        }
      }, 100);
      return () => clearTimeout(timer);
    } else if (prevExpandedLogIdRef.current) {
      const closedId = prevExpandedLogIdRef.current;
      prevExpandedLogIdRef.current = null;
      const timer = setTimeout(() => {
        const element = document.getElementById(`log-card-${closedId}`);
        if (element) {
          element.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          });
        }
      }, 60);
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

  const sortedLogs = React.useMemo(
    () => [...workoutLogs].sort((a, b) => b.date.localeCompare(a.date)),
    [workoutLogs]
  );

  // Lifetime master metrics calculations
  const masterStats = React.useMemo(() => {
    if (workoutLogs.length === 0) return null;

    let totalWorkouts = workoutLogs.length;
    let totalVolumeKg = 0;
    let totalSets = 0;
    let totalReps = 0;
    let totalMinutes = 0;

    const muscleSetsMap: Record<string, number> = {
      'Delts': 0, 'Traps': 0, 'Biceps': 0, 'Triceps': 0,
      'Pecs': 0, 'Back': 0, 'Abs': 0, 'Quads': 0,
      'Hams': 0, 'Calves': 0, 'Glutes': 0, 'Forearms': 0
    };

    workoutLogs.forEach(log => {
      if (log.durationMinutes) totalMinutes += log.durationMinutes;

      log.exercises.forEach(ex => {
        const mg = (ex.muscleGroup || '').trim();
        // Match standard or fuzzy muscle group names
        let mappedMg: string | null = null;
        if (/delt|shoulder/i.test(mg)) mappedMg = 'Delts';
        else if (/trap/i.test(mg)) mappedMg = 'Traps';
        else if (/bicep/i.test(mg)) mappedMg = 'Biceps';
        else if (/tricep/i.test(mg)) mappedMg = 'Triceps';
        else if (/chest|pec/i.test(mg)) mappedMg = 'Pecs';
        else if (/back|lats|rhomboid/i.test(mg)) mappedMg = 'Back';
        else if (/abs|core|abdominal/i.test(mg)) mappedMg = 'Abs';
        else if (/quad/i.test(mg)) mappedMg = 'Quads';
        else if (/ham|hamstring/i.test(mg)) mappedMg = 'Hams';
        else if (/calf|calves/i.test(mg)) mappedMg = 'Calves';
        else if (/glute/i.test(mg)) mappedMg = 'Glutes';
        else if (/forearm/i.test(mg)) mappedMg = 'Forearms';

        if (ex.isSkipped) return;

        if (ex.sets) {
          const validSets = ex.sets.filter(s => !s.isSkipped && s.isCompleted !== false && ((s.reps || 0) > 0 || (s.weight || 0) > 0));
          const validSetsCount = validSets.length;
          totalSets += validSetsCount;

          if (mappedMg) {
            muscleSetsMap[mappedMg] += validSetsCount;
          }

          validSets.forEach(s => {
            const r = s.reps || 0;
            const w = s.weight || 0;
            totalReps += r;

            // Volume in Kg (convert if log unit is lb)
            const weightInKg = log.unit === 'lb' ? w * 0.453592 : w;
            if (ex.modality === 'assisted') {
              const bw = userBodyweight || 75;
              const netWeight = Math.max(1, bw - weightInKg);
              totalVolumeKg += netWeight * r;
            } else if (ex.modality !== 'bodyweight' && ex.modality !== 'distance' && ex.modality !== 'timed') {
              totalVolumeKg += weightInKg * r;
            } else if (ex.modality === 'bodyweight') {
              const bw = userBodyweight || 75;
              totalVolumeKg += bw * r;
            }
          });
        }
      });
    });

    const formatVolume = (kg: number) => {
      if (kg >= 1000000) return `${(kg / 1000000).toFixed(1)}M kg`;
      if (kg >= 1000) return `${(kg / 1000).toFixed(0)}K kg`;
      return `${Math.round(kg)} kg`;
    };

    // Calculate top muscle group
    let topMuscle = '';
    let topMuscleSets = 0;
    Object.entries(muscleSetsMap).forEach(([mg, count]) => {
      if (count > topMuscleSets) {
        topMuscleSets = count;
        topMuscle = mg;
      }
    });

    // Gamification titles
    let title = 'IRON INITIATE';
    if (totalWorkouts >= 100) title = 'WARLORD OF IRON';
    else if (totalWorkouts >= 50) title = 'VETERAN LIFTER';
    else if (totalWorkouts >= 25) title = 'APEX ATHLETE';
    else if (totalWorkouts >= 10) title = 'DEDICATED STRIKER';

    return {
      totalWorkouts,
      totalVolumeFormatted: formatVolume(totalVolumeKg),
      totalSets,
      totalReps,
      totalHours: Math.round(totalMinutes / 60),
      topMuscle: topMuscle || 'Pecs',
      title,
      muscleSetsMap,
    };
  }, [workoutLogs, userBodyweight]);

  // Group workout logs by month (YYYY, MonthName)
  const groupedLogs = React.useMemo(() => {
    const MONTH_NAMES = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const monthMap: Record<string, WorkoutLog[]> = {};
    const monthOrder: string[] = [];

    sortedLogs.forEach(log => {
      const d = parseLocalDate(log.date);
      const year = d.getFullYear();
      const monthIdx = d.getMonth();
      const key = `${year}-${String(monthIdx + 1).padStart(2, '0')}`;

      if (!monthMap[key]) {
        monthMap[key] = [];
        monthOrder.push(key);
      }
      monthMap[key].push(log);
    });

    return monthOrder.map(key => {
      const d = parseLocalDate(monthMap[key][0].date);
      const year = d.getFullYear();
      const monthIdx = d.getMonth();
      const label = `${year}, ${MONTH_NAMES[monthIdx]}`;
      return {
        key,
        label,
        logs: monthMap[key],
      };
    });
  }, [sortedLogs]);

  // Expand the first/latest month by default on initial load
  const [expandedMonthKey, setExpandedMonthKey] = useState<string | null>(null);
  const initializedMonthRef = useRef(false);

  useEffect(() => {
    if (groupedLogs.length > 0) {
      if (!initializedMonthRef.current) {
        setExpandedMonthKey(groupedLogs[0].key);
        initializedMonthRef.current = true;
      } else if (expandedMonthKey && !groupedLogs.some(g => g.key === expandedMonthKey)) {
        setExpandedMonthKey(groupedLogs[0].key);
      }
    } else {
      setExpandedMonthKey(null);
    }
  }, [groupedLogs]);

  // Sync expanded month with hardware/browser back button
  useModalHistory(
    expandedMonthKey !== null,
    () => setExpandedMonthKey(null),
    'diary-expanded-month'
  );

  const prevExpandedMonthKeyRef = useRef<string | null>(null);
  const userMonthActionRef = useRef(false);

  // Always reset window scroll to top when mounting LogsHistoryView
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, []);

  useEffect(() => {
    if (!userMonthActionRef.current) {
      if (expandedMonthKey) {
        prevExpandedMonthKeyRef.current = expandedMonthKey;
      }
      return;
    }

    if (expandedMonthKey) {
      prevExpandedMonthKeyRef.current = expandedMonthKey;
      const timer = setTimeout(() => {
        const element = document.getElementById(`month-header-${expandedMonthKey}`);
        if (element) {
          element.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          });
        }
      }, 60);
      return () => clearTimeout(timer);
    } else if (prevExpandedMonthKeyRef.current) {
      prevExpandedMonthKeyRef.current = null;
      const timer = setTimeout(() => {
        const element = document.getElementById('journal-mastery-card');
        if (element) {
          element.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          });
        } else {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }, 60);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [expandedMonthKey]);

  const toggleMonth = (key: string) => {
    userMonthActionRef.current = true;
    if (expandedMonthKey === key) {
      setExpandedMonthKey(null);
    } else {
      setExpandedMonthKey(key);
    }
  };

  const isDesertTheme = themeId === 'amber';

  return (
    <div className="space-y-4 pb-20">
      {/* Header Bar */}
      <div className={`sticky top-[-16px] -mt-4 pt-3 pb-2.5 z-30 flex items-center justify-between border-b px-4 shadow-md ${
        isDesertTheme ? 'bg-[#FAF5F0] border-[#E05A47]/30' : 'bg-slate-950 border-slate-850'
      }`}>
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-none border flex items-center justify-center ${
            isDesertTheme ? 'bg-[#F5EBE0] border-[#E05A47]/40 text-[#9B1C1C]' : 'bg-slate-900 border-slate-800 text-indigo-400'
          }`}>
            <Calendar className="w-4 h-4" />
          </div>
          <div>
            <h2 className={`font-extrabold text-sm uppercase tracking-wide leading-none ${
              isDesertTheme ? 'text-[#252320]' : 'text-white'
            }`}>
              Workout Log Book
            </h2>
            <p className={`text-[10px] font-mono uppercase tracking-widest mt-1 ${
              isDesertTheme ? 'text-[#9B1C1C]' : 'text-indigo-400'
            }`}>
              Logged Training Journal
            </p>
          </div>
        </div>
      </div>

      {/* Lifetime Master Summary Banner */}
      {masterStats && (
        <div
          id="journal-mastery-card"
          className={`-mt-4 border-b p-3.5 space-y-3 transition-colors scroll-mt-14 ${
            isDesertTheme
              ? 'bg-[#FAF5F0] border-[#E05A47]/40 text-[#252320]'
              : 'bg-slate-900/95 border-slate-800 text-slate-100'
          }`}
        >
          {/* Top Line: Title Badge + Core Big Metrics */}
          <div className="flex items-center justify-between gap-2 border-b pb-2.5 border-dashed border-slate-800/80">
            <div className="min-w-0 flex-1">
              <span className={`block text-xs font-mono font-black uppercase tracking-widest ${
                isDesertTheme ? 'text-[#252320]' : 'text-slate-100'
              }`}>
                Journal Summary
              </span>
              <div className="flex items-center gap-1.5 mt-1">
                <div className={`p-0.5 border text-[10px] shrink-0 ${
                  isDesertTheme
                    ? 'bg-[#FDF2F2] border-[#E05A47]/40 text-[#9B1C1C]'
                    : 'bg-indigo-950/80 border-indigo-500/40 text-indigo-300'
                }`}>
                  <Trophy className="w-3.5 h-3.5" />
                </div>
                <span className={`text-xs font-black font-mono tracking-wider truncate ${
                  isDesertTheme ? 'text-[#9B1C1C]' : 'text-indigo-300'
                }`}>
                  {featuredTitle}
                </span>
                <button
                  onClick={() => setIsAchievementsModalOpen(true)}
                  className={`p-1 rounded transition-colors flex items-center justify-center shrink-0 ${
                    isDesertTheme
                      ? 'text-[#9B1C1C] hover:bg-[#E05A47]/15'
                      : 'text-indigo-400 hover:text-indigo-300 hover:bg-slate-800/60'
                  }`}
                  title="View Journal Achievements & Titles"
                >
                  <Info className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Core Stats Chips */}
            <div className="flex items-center gap-2 shrink-0">
              <div className={`px-2 py-1 border text-center ${
                isDesertTheme
                  ? 'bg-[#F5EBE0] border-[#E05A47]/30'
                  : 'bg-slate-950 border-slate-800'
              }`}>
                <span className={`block text-[8px] font-mono font-bold uppercase tracking-tight ${
                  isDesertTheme ? 'text-[#6F6A63]' : 'text-slate-500'
                }`}>WORKOUTS</span>
                <span className={`text-xs font-black font-mono ${
                  isDesertTheme ? 'text-[#252320]' : 'text-white'
                }`}>{masterStats.totalWorkouts}</span>
              </div>

              <div className={`px-2 py-1 border text-center ${
                isDesertTheme
                  ? 'bg-[#F5EBE0] border-[#E05A47]/30'
                  : 'bg-slate-950 border-slate-800'
              }`}>
                <span className={`block text-[8px] font-mono font-bold uppercase tracking-tight ${
                  isDesertTheme ? 'text-[#6F6A63]' : 'text-slate-500'
                }`}>VOL. MOVED</span>
                <span className={`text-xs font-black font-mono ${
                  isDesertTheme ? 'text-[#9B1C1C]' : 'text-emerald-400'
                }`}>{masterStats.totalVolumeFormatted}</span>
              </div>
            </div>
          </div>

          {/* Muscle Group Lifetime Set Matrix */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className={`text-[9px] font-mono font-bold uppercase tracking-widest ${
                isDesertTheme ? 'text-[#6F6A63]' : 'text-slate-400'
              }`}>
                LIFETIME SETS BY MUSCLE GROUP
              </span>
              <span className={`text-[9px] font-mono font-bold ${
                isDesertTheme ? 'text-[#9B1C1C]' : 'text-indigo-400'
              }`}>
                TOTAL: {masterStats.totalSets} SETS
              </span>
            </div>

            {/* Responsive grid of all 12 muscle groups */}
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-1">
              {Object.entries(masterStats.muscleSetsMap).map(([muscle, count]) => {
                const isZero = count === 0;
                return (
                  <div
                    key={muscle}
                    className={`px-1.5 py-1 border text-center transition-all ${
                      isDesertTheme
                        ? isZero
                          ? 'bg-[#FAF5F0]/50 border-gray-200/50 text-[#A49D95]'
                          : 'bg-[#F5EBE0] border-[#E05A47]/30 text-[#252320]'
                        : isZero
                          ? 'bg-slate-950/40 border-slate-900 text-slate-600'
                          : 'bg-slate-950 border-slate-800 text-slate-200'
                    }`}
                  >
                    <span className="block text-[8px] font-mono font-semibold uppercase tracking-tight truncate">
                      {muscle}
                    </span>
                    <span className={`block text-[10px] font-black font-mono ${
                      isZero
                        ? isDesertTheme ? 'text-[#A49D95]' : 'text-slate-600'
                        : isDesertTheme ? 'text-[#9B1C1C]' : 'text-indigo-400'
                    }`}>
                      {count}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

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
          {groupedLogs.map(group => {
            const isMonthExpanded = expandedMonthKey === group.key;
            const isDesertTheme = themeId === 'amber';

            return (
              <div key={group.key} className="space-y-2.5">
                {/* Discrete Month Section Header */}
                <button
                  type="button"
                  id={`month-header-${group.key}`}
                  onClick={() => toggleMonth(group.key)}
                  className={`w-full flex items-center justify-between px-4 py-2.5 transition-all text-left border-y scroll-mt-14 ${
                    isDesertTheme
                      ? 'bg-[#FAF5F0] border-[#E05A47]/40 hover:bg-[#F5EBE0] text-[#252320]'
                      : 'bg-slate-900/90 border-slate-800 hover:bg-slate-850 text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Calendar className={`w-3.5 h-3.5 ${isDesertTheme ? 'text-[#9B1C1C]' : 'text-indigo-400'}`} />
                    <span className={`text-xs font-black font-mono uppercase tracking-widest ${isDesertTheme ? 'text-[#252320]' : 'text-slate-100'}`}>
                      {group.label}
                    </span>
                    <span className={`text-[10px] font-bold font-mono px-2 py-0.5 border ${
                      isDesertTheme
                        ? 'text-[#9B1C1C] bg-[#FDF2F2] border-[#E05A47]/40'
                        : 'text-indigo-400 bg-indigo-950/80 border-indigo-800/60'
                    }`}>
                      {group.logs.length} {group.logs.length === 1 ? 'SESSION' : 'SESSIONS'}
                    </span>
                  </div>
                  <div className={isDesertTheme ? 'text-[#9B1C1C]' : 'text-indigo-400'}>
                    {isMonthExpanded ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-500" />
                    )}
                  </div>
                </button>

                {/* Workout Cards for this Month */}
                {isMonthExpanded && (
                  <div className="space-y-3">
                    {group.logs.map(log => {
                      const isExpanded = expandedLogId === log.id;
                      const scorecard: DiaryScorecardResult | undefined = scorecardMap[log.id];
                      const uniqueMuscles = Array.from(new Set(log.exercises.map(ex => ex.muscleGroup).filter(Boolean)));
                      const isShowAllInsights = !!showAllMap[log.id];

                      const isDesert = themeId === 'amber';
                      const popoverBg = isDesert ? 'bg-[#FAF5F0]' : 'bg-slate-950';
                      const popoverBorder = isDesert ? 'border-[#E05A47]' : 'border-indigo-500/85';
                      const popoverTitleColor = isDesert ? 'text-[#9B1C1C]' : 'text-indigo-400';
                      const popoverTextColor = isDesert ? 'text-[#252320]' : 'text-slate-300';

                      // Collapsed view insight badges: pick top 3
                      const collapsedInsights = scorecard?.insights ? scorecard.insights.slice(0, 3) : [];
                      const remainingInsightsCount = scorecard?.insights
                        ? Math.max(0, scorecard.insights.length - 3)
                        : 0;

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

                              {/* Rating and Insights Layout */}
                              <div className="flex flex-col gap-2 mt-2.5 font-sans">
                                <div className="flex items-center gap-2 text-[11px] font-bold text-slate-400">
                                  <span className="uppercase tracking-wider">Rating:</span>
                                  {scorecard ? (
                                    <div className="relative inline-block">
                                      <button
                                        type="button"
                                        data-tag-button="true"
                                        aria-label={`Rating: ${scorecard.primaryCategory.label}`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (activeTag?.logId === log.id && activeTag?.tagId === 'category') {
                                            setActiveTag(null);
                                          } else {
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            const cardEl = document.getElementById(`log-card-${log.id}`);
                                            const cardRect = cardEl ? cardEl.getBoundingClientRect() : null;
                                            setActiveTag({
                                              logId: log.id,
                                              tagId: 'category',
                                              title: scorecard.primaryCategory.label,
                                              text: scorecard.primaryCategory.explanation,
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
                                        className={`inline-flex items-center px-3 py-1 border-2 text-[12px] font-extrabold uppercase tracking-wider rounded-none cursor-pointer transition hover:scale-[1.02] active:scale-[0.98] ${getPrimaryCategoryStyles(scorecard.primaryCategory.id, themeId).badge}`}
                                      >
                                        {scorecard.primaryCategory.label}
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="text-[11px] font-bold font-mono px-2.5 py-0.5 border border-slate-700 bg-slate-950 text-slate-400 uppercase tracking-wide">
                                      RATING: UNAVAILABLE
                                    </span>
                                  )}
                                </div>

                                {/* Interactive Insight Badges in Collapsed View */}
                                {scorecard && scorecard.insights.length > 0 && (
                                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-400">
                                    <span className="uppercase tracking-wider shrink-0">Insights:</span>
                                    {scorecard.collapsedInsights.map((insight, idx) => {
                                      const badgeLabel = getCollapsedInsightBadgeLabel(insight);
                                      const evidenceItems = formatDiaryNumericEvidence(insight, log.unit);
                                      const evidenceStr = evidenceItems.length > 0
                                        ? evidenceItems.map(i => `${i.label}: ${i.value}`).join(', ')
                                        : '';

                                      return (
                                        <div key={insight.id || idx} className="relative inline-block">
                                          <button
                                            type="button"
                                            data-tag-button="true"
                                            aria-label={`Insight: ${insight.label}`}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (activeTag?.logId === log.id && activeTag?.tagId === `insight-${idx}`) {
                                                setActiveTag(null);
                                              } else {
                                                const rect = e.currentTarget.getBoundingClientRect();
                                                const cardEl = document.getElementById(`log-card-${log.id}`);
                                                const cardRect = cardEl ? cardEl.getBoundingClientRect() : null;
                                                setActiveTag({
                                                  logId: log.id,
                                                  tagId: `insight-${idx}`,
                                                  title: insight.label,
                                                  text: `${insight.explanation}${evidenceStr ? ` (${evidenceStr})` : ''}`,
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
                                            className={`text-[11.5px] font-mono font-black border-2 px-3 py-0.5 uppercase tracking-wide rounded-none shrink-0 cursor-pointer transition hover:scale-[1.02] active:scale-[0.98] ${getInsightToneStyles(insight.tone, themeId)}`}
                                          >
                                            {badgeLabel}
                                          </button>
                                        </div>
                                      );
                                    })}

                                    {/* +N INSIGHTS Button */}
                                    {scorecard.overflowInsightCount > 0 && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setExpandedLogId(log.id);
                                          setShowAllMap(prev => ({ ...prev, [log.id]: true }));
                                        }}
                                        className={`text-[11px] font-mono font-black border px-2.5 py-0.5 uppercase tracking-wide transition cursor-pointer ${
                                          isDesert
                                            ? 'text-[#B56D3E] bg-[#FAF5F0] border-[#B56D3E]/40 hover:bg-[#F5EBE0]'
                                            : 'text-indigo-300 bg-slate-950 border-indigo-500/40 hover:bg-indigo-950/50'
                                        }`}
                                        title={`Expand workout to see all ${scorecard.insights.length} insights`}
                                      >
                                        +{scorecard.overflowInsightCount} INSIGHTS
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="flex flex-col items-center gap-1.5 shrink-0 self-start mt-0.5">
                              {/* 1. Dropdown arrow to expand */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleExpand(log.id);
                                }}
                                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-none transition cursor-pointer flex items-center justify-center"
                                title={isExpanded ? "Collapse workout log" : "Expand workout log"}
                                aria-label={isExpanded ? "Collapse workout log" : "Expand workout log"}
                              >
                                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              </button>

                              {/* 2. Pencil icon to edit */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onNavigate?.('logger', { editLogId: log.id });
                                }}
                                className="p-1.5 text-slate-500 hover:text-indigo-400 hover:bg-slate-800 rounded-none transition cursor-pointer"
                                title="Edit workout log"
                                aria-label="Edit workout log"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>

                              {/* 3. Delete icon */}
                              <button
                                onClick={e => handleDeleteLog(log.id, e)}
                                className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded-none transition cursor-pointer"
                                title="Delete log"
                                aria-label="Delete workout log"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>

                              {/* 4. Info icon */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowGradeInfo(true);
                                }}
                                className="p-1 hover:bg-slate-800 text-slate-500 hover:text-indigo-400 rounded-full transition flex items-center justify-center mt-0.5 cursor-pointer"
                                title="How are scorecards and insights calculated?"
                                aria-label="How are scorecards and insights calculated?"
                              >
                                <Info className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {/* Log Row Body Expanded */}
                          {isExpanded && (
                            <div className="px-4 pb-4 pt-2 border-t border-slate-850/60 bg-slate-950/40 space-y-4">
                              {/* Session Training Category & Scorecard Analysis */}
                              {scorecard ? (
                                <div className={`p-4 border-2 rounded-none mt-1.5 ${getPrimaryCategoryStyles(scorecard.primaryCategory.id, themeId).card} space-y-3`}>
                                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-800/20">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <Award className="w-5 h-5 shrink-0 text-inherit" />
                                      <span className="text-[14px] sm:text-[15.5px] font-black uppercase tracking-wider font-sans truncate text-inherit">
                                        {scorecard.primaryCategory.label}
                                      </span>
                                    </div>
                                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 border border-current opacity-80 uppercase tracking-widest shrink-0">
                                      DIARY SCORECARD
                                    </span>
                                  </div>

                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-[12px] font-bold font-sans pt-1 border-b border-slate-850/20 pb-2.5 text-inherit animate-fade-in">
                                    <div className="text-inherit">
                                      Workout Objective:{' '}
                                      <span className="font-mono text-xs text-white bg-slate-950/40 px-2 py-0.5 ml-1 border border-slate-800/30">
                                        {log.objective && log.objective !== 'Off' ? log.objective : 'None'}
                                      </span>
                                    </div>
                                    <div className="text-inherit">
                                      Performance Index:{' '}
                                      <span className="font-mono text-xs text-white bg-slate-950/40 px-2 py-0.5 ml-1 border border-slate-800/30">
                                        {scorecard.sessionPerformanceIndex !== null ? `${scorecard.sessionPerformanceIndex.toFixed(1)}%` : '—'}
                                      </span>
                                      <span className="text-[10px] font-normal opacity-75 ml-1 font-mono">
                                        ({scorecard.hasSufficientPerformanceHistory ? 'Rolling Baseline' : 'Provisional'})
                                      </span>
                                    </div>
                                  </div>

                                  <p className="text-[11.5px] leading-relaxed opacity-95 font-sans font-medium text-inherit">
                                    {scorecard.primaryCategory.explanation}
                                  </p>

                                  {/* Expanded Insights Breakdown */}
                                  {scorecard.insights.length > 0 && (() => {
                                    const visibleResult = getVisibleExpandedInsights(scorecard.insights, isShowAllInsights, 8);
                                    const groupedInsights = groupDiaryInsights(visibleResult.visibleInsights);

                                    return (
                                      <div className="pt-2 border-t border-slate-850/20 space-y-2.5">
                                        <div className="flex items-center justify-between text-[11px] font-mono font-bold uppercase tracking-wider text-inherit opacity-90">
                                          <span>Detected Session Insights ({scorecard.insights.length})</span>
                                          {scorecard.insights.length > 8 && (
                                            <button
                                              type="button"
                                              onClick={() => setShowAllMap(prev => ({ ...prev, [log.id]: !prev[log.id] }))}
                                              className="text-[10px] font-bold underline hover:opacity-100 cursor-pointer"
                                              aria-label={isShowAllInsights ? 'Show fewer insights' : `Show all ${scorecard.insights.length} insights`}
                                            >
                                              {isShowAllInsights ? 'Show fewer insights' : `Show all insights (${scorecard.insights.length})`}
                                            </button>
                                          )}
                                        </div>

                                        <div className="space-y-3">
                                          {groupedInsights.map((group) => (
                                            <div key={group.domain} className="space-y-1.5">
                                              <div className={`text-[10px] font-mono font-black uppercase tracking-widest px-1 py-0.5 border-b ${
                                                isDesert ? 'text-[#8C4A2F] border-[#E6D7C3]' : 'text-slate-400 border-slate-850'
                                              }`}>
                                                {group.domainLabel}
                                              </div>
                                              <div className="space-y-1.5">
                                                {group.insights.map((insight) => {
                                                  const evidenceItems = formatDiaryNumericEvidence(insight, log.unit);
                                                  const rarityLabel = getDiaryRarityLabel(insight.rarity);
                                                  const rarityDesc = getDiaryRarityDescription(insight.rarity) || undefined;

                                                  return (
                                                    <div
                                                      key={insight.id}
                                                      className={`p-2.5 border rounded-none flex flex-col gap-1 text-[11.5px] ${
                                                        isDesert ? 'bg-[#FAF5F0] border-slate-300/80' : 'bg-slate-950/70 border-slate-800/80'
                                                      }`}
                                                    >
                                                      <div className="flex items-center justify-between gap-2 flex-wrap">
                                                        <div className="flex items-center gap-1.5 min-w-0">
                                                          {rarityLabel && (
                                                            <span className={`text-[10px] font-black font-mono uppercase px-2 py-0.5 border ${getRarityBadgeStyles(insight.rarity, themeId)}`} title={rarityDesc}>
                                                              {rarityLabel}
                                                            </span>
                                                          )}
                                                          <span className="font-bold text-white uppercase tracking-wide truncate">
                                                            {insight.label}
                                                          </span>
                                                        </div>
                                                        <span className={`text-[9.5px] font-mono font-bold uppercase px-1.5 py-0.2 border ${getInsightToneStyles(insight.tone, themeId)}`}>
                                                          {insight.tone}
                                                        </span>
                                                      </div>

                                                      <p className={`text-[11px] font-medium leading-relaxed ${isDesert ? 'text-[#3B3835]' : 'text-slate-300'}`}>
                                                        {insight.explanation}
                                                      </p>

                                                      {evidenceItems.length > 0 && (
                                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] font-mono pt-0.5">
                                                          <span className="text-slate-500 uppercase">Evidence:</span>
                                                          {evidenceItems.map(item => (
                                                            <span key={item.key} className="text-slate-300">
                                                              <span className="opacity-70">{item.label}:</span>{' '}
                                                              <span className="font-bold text-cyan-300">{item.value}</span>
                                                            </span>
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
                                      </div>
                                    );
                                  })()}
                                </div>
                              ) : (
                                <div className="p-3 border border-slate-800 bg-slate-950/60 text-slate-400 text-xs font-mono">
                                  DIARY SCORECARD: UNAVAILABLE FOR THIS SESSION
                                </div>
                              )}

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
                                    <span className="text-[8px] font-bold text-slate-500 uppercase tracking-wider block">Intake</span>
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
                                    <h4 className={`text-xs font-extrabold flex justify-between uppercase tracking-wider font-sans ${
                                      ex.isSkipped ? 'text-amber-400/80' : 'text-slate-200'
                                    }`}>
                                      <span className="flex items-center gap-1">
                                        <span className={ex.isSkipped ? 'line-through text-slate-400' : ''}>• {ex.name}</span>
                                        {ex.isMainMovement && (
                                          <sup className="text-[9px] text-indigo-400 font-black tracking-normal align-super bg-indigo-500/10 px-1 border border-indigo-500/20 rounded-sm">MM</sup>
                                        )}
                                        {ex.isSkipped && (
                                          <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded-none uppercase tracking-wide ml-1 ${
                                            themeId === 'amber'
                                              ? 'text-[#B56D3E] bg-[#B56D3E]/10 border border-[#B56D3E]/20'
                                              : 'text-amber-400 bg-amber-500/10 border border-amber-500/20'
                                          }`}>
                                            Skipped
                                          </span>
                                        )}
                                      </span>
                                      <span className="text-[9px] text-indigo-400 font-semibold font-mono">({ex.muscleGroup})</span>
                                    </h4>

                                    <div className="space-y-1.5 pl-2.5">
                                      {ex.sets.map((set, sIdx) => {
                                        const displayState = getHistoricalSetDisplayState(set, !!ex.isSkipped);
                                        const isPR = (() => {
                                          if (displayState.isSkipped || ex.isSkipped) return false;
                                          const isWeighted = !ex.modality || ex.modality === 'weighted';
                                          const isBw = ex.modality === 'bodyweight';
                                          const isAssisted = ex.modality === 'assisted';
                                          const isDistanceLoaded = ex.modality === 'distance_loaded';
                                          const isDistance = ex.modality === 'distance';
                                          if (!isWeighted && !isBw && !isAssisted && !isDistanceLoaded && !isDistance) return false;
                                          const w = displayState.weight;
                                          const r = displayState.reps;
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

                                        const isDesert = themeId === 'amber';

                                        return (
                                          <div key={sIdx} className="space-y-1">
                                            <div
                                              className={`text-xs flex items-center justify-between font-mono py-0.5 ${
                                                displayState.isRowMuted ? 'text-slate-500 opacity-80' : 'text-slate-400'
                                              }`}
                                            >
                                              <span className="flex items-center flex-wrap gap-1">
                                                <span>Set {set.setNumber}</span>
                                                {displayState.isWarmup && (
                                                  <WarmupIcon className="w-3.5 h-3 text-amber-500 inline-block shrink-0 align-middle ml-0.5" title="Warmup Set" />
                                                )}
                                                {displayState.isDropSet && (
                                                  <span className={`${isDesert ? 'text-fuchsia-600' : 'text-fuchsia-400'} font-extrabold ml-0.5 animate-pulse`} title="Drop Set">↓</span>
                                                )}
                                                {displayState.showSkippedBadge && (
                                                  <span
                                                    className={`inline-flex items-center text-[9px] font-extrabold px-1.5 py-0.2 rounded-none uppercase tracking-wider ml-1 ${
                                                      isDesert
                                                        ? 'text-[#B56D3E] bg-[#B56D3E]/10 border border-[#B56D3E]/20'
                                                        : 'text-amber-400 bg-amber-500/10 border border-amber-500/20'
                                                    }`}
                                                    title="Skipped Set (Target Not Performed)"
                                                  >
                                                    Skipped
                                                  </span>
                                                )}
                                                <span>:</span>{' '}
                                                {ex.modality === 'bodyweight' ? (
                                                  <>
                                                    <strong className={`${displayState.isRowMuted ? 'text-indigo-400/80 font-semibold' : 'text-indigo-400 font-black'}`}>Bodyweight ({displayState.weight && displayState.weight !== 0 ? `${displayState.weight} ${log.unit.toUpperCase()}` : 'BW'})</strong> x{' '}
                                                    <strong className={`${displayState.isRowMuted ? 'text-slate-400 font-semibold' : 'text-slate-200 font-black'}`}>{displayState.reps}</strong> reps
                                                  </>
                                                ) : ex.modality === 'timed' ? (
                                                  <>
                                                    <strong className={`${displayState.isRowMuted ? 'text-slate-400 font-semibold' : 'text-slate-200 font-black'}`}>{displayState.weight}</strong> secs
                                                  </>
                                                ) : ex.modality === 'distance' ? (
                                                  <>
                                                    <strong className={`${displayState.isRowMuted ? 'text-slate-400 font-semibold' : 'text-slate-200 font-black'}`}>{displayState.reps}</strong> meters in <strong className={`${displayState.isRowMuted ? 'text-slate-400 font-semibold' : 'text-slate-200 font-black'}`}>{displayState.weight}</strong> secs
                                                  </>
                                                ) : ex.modality === 'distance_loaded' ? (
                                                  <>
                                                    <strong className={`${displayState.isRowMuted ? 'text-slate-400 font-semibold' : 'text-slate-200 font-black'}`}>{displayState.weight}</strong> {log.unit} x <strong className={`${displayState.isRowMuted ? 'text-slate-400 font-semibold' : 'text-slate-200 font-black'}`}>{displayState.reps}</strong> meters
                                                  </>
                                                ) : ex.modality === 'assisted' ? (
                                                  <>
                                                    <strong className={`${displayState.isRowMuted ? 'text-slate-400 font-semibold' : 'text-slate-200 font-black'}`}>{displayState.weight}</strong> {log.unit} assist x{' '}
                                                    <strong className={`${displayState.isRowMuted ? 'text-slate-400 font-semibold' : 'text-slate-200 font-black'}`}>{displayState.reps}</strong> reps
                                                  </>
                                                ) : (
                                                  <>
                                                    <strong className={`${displayState.isRowMuted ? 'text-slate-400 font-semibold' : 'text-slate-200 font-black'}`}>{displayState.weight}</strong> {log.unit} x{' '}
                                                    <strong className={`${displayState.isRowMuted ? 'text-slate-400 font-semibold' : 'text-slate-200 font-black'}`}>{displayState.reps}</strong> reps
                                                  </>
                                                )}
                                                {isPR && (
                                                  <span className={`inline-flex items-center gap-0.5 text-[8px] font-extrabold px-1 py-0.5 rounded uppercase tracking-tight animate-pulse shrink-0 ml-1.5 ${
                                                    isDesert
                                                      ? 'text-[#B56D3E] bg-[#B56D3E]/10 border border-[#B56D3E]/20'
                                                      : 'text-amber-400 bg-amber-500/10 border border-amber-500/20'
                                                  }`} title="Personal Record!">
                                                    <Award className={`w-2.5 h-2.5 shrink-0 ${isDesert ? 'text-[#B56D3E]' : 'text-amber-400'}`} /> PR
                                                  </span>
                                                )}
                                                {displayState.isDropSet && set.dropSubSets && set.dropSubSets.length > 0 && (
                                                  <button
                                                    type="button"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      const key = `${log.id}-${exIdx}-${sIdx}`;
                                                      setExpandedDropSets(prev => ({ ...prev, [key]: !prev[key] }));
                                                    }}
                                                    className={`ml-2 text-[9px] font-black px-1.5 py-0.5 rounded cursor-pointer transition flex items-center gap-1 inline-flex font-sans ${
                                                      isDesert
                                                        ? 'text-fuchsia-700 bg-fuchsia-50/70 hover:bg-fuchsia-100 border border-fuchsia-200/50'
                                                        : 'text-fuchsia-400 hover:text-fuchsia-300 bg-fuchsia-950/40 hover:bg-fuchsia-950/60 border border-fuchsia-900/40'
                                                    }`}
                                                  >
                                                    <span>Drops ({set.dropSubSets.length})</span>
                                                    <span className="text-[8px]">{expandedDropSets[`${log.id}-${exIdx}-${sIdx}`] ? '▲' : '▼'}</span>
                                                  </button>
                                                )}
                                              </span>
                                              <div className="flex gap-2 items-center shrink-0">
                                                <span className={`text-[10px] font-bold bg-slate-900 px-1.5 py-0.2 rounded-none border border-slate-850/40 ${
                                                  displayState.isRowMuted ? 'text-slate-500' : 'text-slate-400'
                                                }`}>
                                                  RPE {displayState.rpe}
                                                </span>
                                                {displayState.form && (
                                                  <span className={`text-[10px] font-black capitalize ${
                                                    displayState.isRowMuted ? 'text-indigo-400/70' : 'text-indigo-400'
                                                  }`}>
                                                    {displayState.form}
                                                  </span>
                                                )}
                                              </div>
                                            </div>

                                            {displayState.comment && (
                                              <div className="text-[10px] text-slate-400/80 italic flex items-center gap-1 pl-2 font-sans">
                                                <MessageSquare className="w-2.5 h-2.5 text-indigo-400/70 shrink-0" />
                                                <span>"{displayState.comment}"</span>
                                              </div>
                                            )}

                                            {/* Render Expanded Drop Sub-sets */}
                                            {displayState.isDropSet && expandedDropSets[`${log.id}-${exIdx}-${sIdx}`] && set.dropSubSets && set.dropSubSets.length > 0 && (
                                              <div className={`pl-4 pr-3 py-1.5 space-y-1 rounded-none mt-0.5 text-slate-400 text-xs w-full max-w-md border ${
                                                isDesert
                                                  ? 'bg-fuchsia-50/40 border-fuchsia-100/60'
                                                  : 'bg-fuchsia-950/5 border-fuchsia-950/15'
                                              }`}>
                                                {set.dropSubSets.map((sub, subIdx) => (
                                                  <div key={subIdx} className="flex justify-between items-center py-0.5 font-mono text-[11px]">
                                                    <span className="text-slate-500">└ Drop {subIdx + 1}:</span>
                                                    <span className={`font-bold ${isDesert ? 'text-fuchsia-700' : 'text-fuchsia-400'}`}>
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

      {/* Grade / Scorecard Explanation Modal */}
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
                    Diary Scorecard & Insights
                  </h3>
                </div>
                <p className="text-[10px] sm:text-xs text-indigo-400 font-mono uppercase tracking-widest leading-none mt-1">
                  Deterministic Physiology & Performance Engine
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
                MetReps automatically computes a <strong>Diary Scorecard</strong> for each completed session using strictly preceding historical exposures. Each workout receives a primary training stimulus rating and actionable diagnostic insights with explicit numeric evidence.
              </p>

              {/* Performance Index Explanation */}
              <div className="space-y-2 bg-indigo-950/30 p-4 border border-indigo-900/30">
                <h4 className="font-bold text-indigo-300 flex items-center gap-2 uppercase text-xs sm:text-sm tracking-wide font-mono">
                  <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />
                  Performance Index (PI)
                </h4>
                <p className="text-slate-400 text-xs leading-relaxed">
                  Your Performance Index compares your actual session capacity to your recent exercise-matched benchmark. 
                  A score of <strong>100%</strong> means the workout broadly matched your recent benchmark. Scores <strong>&gt;100%</strong> mean performance was above that recent benchmark, while scores <strong>&lt;100%</strong> mean performance was below it.
                </p>
                <p className="text-slate-400 text-xs leading-relaxed">
                  A lower result may reflect planned lighter training, exercise selection, reduced readiness, fatigue, recovery circumstances, or ordinary performance variation. Performance Index is a contextual comparison, not a medical or recovery diagnosis.
                </p>
              </div>

              {/* Rarity Tiers */}
              <div className="space-y-3">
                <h4 className="font-black text-white uppercase text-xs sm:text-sm tracking-wider font-mono">
                  Insight Rarity Tiers:
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
                  <div className="p-2.5 border border-amber-500/40 bg-amber-950/30">
                    <span className="font-black text-amber-300 uppercase">Personal First</span>
                    <p className="text-slate-400 text-[11px] font-sans mt-0.5">First time this milestone has appeared across your logged history.</p>
                  </div>
                  <div className="p-2.5 border border-purple-500/40 bg-purple-950/30">
                    <span className="font-black text-purple-300 uppercase">Rare</span>
                    <p className="text-slate-400 text-[11px] font-sans mt-0.5">Occurs in under 5% of eligible preceding workout sessions.</p>
                  </div>
                  <div className="p-2.5 border border-indigo-500/40 bg-indigo-950/30">
                    <span className="font-black text-indigo-300 uppercase">Notable</span>
                    <p className="text-slate-400 text-[11px] font-sans mt-0.5">Occurs in 5% to 15% of eligible preceding workout sessions.</p>
                  </div>
                  <div className="p-2.5 border border-slate-700 bg-slate-950/60">
                    <span className="font-black text-slate-300 uppercase">Common</span>
                    <p className="text-slate-400 text-[11px] font-sans mt-0.5">Occurs in over 15% of eligible preceding workout sessions.</p>
                  </div>
                </div>
              </div>

              {/* Insight Domains */}
              <div className="space-y-3">
                <h4 className="font-black text-white uppercase text-xs sm:text-sm tracking-wider font-mono">
                  Insight Domains:
                </h4>
                <div className="grid grid-cols-1 gap-2 text-xs">
                  <div className="p-2.5 border border-slate-800 bg-slate-950 flex flex-col gap-0.5">
                    <span className="font-bold text-emerald-400 font-mono uppercase">Progression</span>
                    <span className="text-slate-400 text-[11.5px]">Changes in strength, load, repetitions, or exercise tonnage.</span>
                  </div>
                  <div className="p-2.5 border border-slate-800 bg-slate-950 flex flex-col gap-0.5">
                    <span className="font-bold text-indigo-400 font-mono uppercase">Stimulus</span>
                    <span className="text-slate-400 text-[11.5px]">The training demand created by the session.</span>
                  </div>
                  <div className="p-2.5 border border-slate-800 bg-slate-950 flex flex-col gap-0.5">
                    <span className="font-bold text-amber-400 font-mono uppercase">Execution & Fatigue</span>
                    <span className="text-slate-400 text-[11.5px]">Consistency, fatigue drop-off, exertion, and form changes.</span>
                  </div>
                  <div className="p-2.5 border border-slate-800 bg-slate-950 flex flex-col gap-0.5">
                    <span className="font-bold text-cyan-400 font-mono uppercase">Recovery Context</span>
                    <span className="text-slate-400 text-[11.5px]">How recorded recovery circumstances relate to session performance.</span>
                  </div>
                  <div className="p-2.5 border border-slate-800 bg-slate-950 flex flex-col gap-0.5">
                    <span className="font-bold text-purple-400 font-mono uppercase">Session Signature</span>
                    <span className="text-slate-400 text-[11.5px]">The distinctive structure or character of the workout.</span>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}


      <AchievementsModal
        visible={isAchievementsModalOpen}
        onClose={() => setIsAchievementsModalOpen(false)}
        achievements={achievementsList}
        selectedTitleId={selectedTitleId}
        onSelectTitle={handleSelectTitle}
        themeId={themeId}
      />

    </div>
  );
}
