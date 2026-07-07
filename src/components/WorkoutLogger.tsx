/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Dumbbell, Plus, Trash2, Check, ArrowLeft, Clock, Flame, Smile, Droplet, Coffee, Award, ChevronDown, ChevronUp, BookOpen, Pencil, History, Info, MoreVertical } from 'lucide-react';
import { Program, WorkoutLog, ExerciseEntry, SetEntry, WeightUnit, DailyRecoveryMetrics } from '../types';
import { storage } from '../lib/storage';
import { getTodayLocalDateString } from '../lib/dateUtils';
import { ExerciseSelectorModal } from './ExerciseSelectorModal';
import { ConfirmationModal } from './ConfirmationModal';

function formatDayMonYear(dateStr: string): string {
  try {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const year = parts[0];
      const monthNum = Number(parts[1]) - 1;
      const day = String(Number(parts[2])).padStart(2, '0');
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const monthName = months[monthNum] || 'Jan';
      return `${day} ${monthName} ${year}`;
    }
  } catch (e) {
    console.error('Error formatting date in formatDayMonYear:', e);
  }
  return dateStr;
}

interface WorkoutLoggerProps {
  initialParams?: {
    programId?: string | null;
    programName?: string;
    week?: string;
    day?: string;
    date?: string;
    scheduledDate?: string | null;
    isOneOff?: boolean;
  };
  onClose: () => void;
  onSave: () => void;
}

export function WorkoutLogger({ initialParams, onClose, onSave }: WorkoutLoggerProps) {
  // Configuration
  const isOneOff = !initialParams?.programId || initialParams?.isOneOff;
  const programId = initialParams?.programId || null;
  const programName = initialParams?.programName || 'One Off';
  const weekNum = initialParams?.week || '1';
  const dayNum = initialParams?.day || '1';
  const dateStr = initialParams?.date || getTodayLocalDateString();
  const scheduledDate = initialParams?.scheduledDate || null;

  // Exercises State
  const [exercises, setExercises] = useState<ExerciseEntry[]>([]);
  const [unit, setUnit] = useState<WeightUnit>(() => storage.getWeightUnit());

  // Exercise library selector modal states
  const [isSelectorOpen, setIsSelectorOpen] = useState(false);
  const [selectorTargetIdx, setSelectorTargetIdx] = useState<number | null>(null);

  const openSelectorForIdx = (idx: number) => {
    setSelectorTargetIdx(idx);
    setIsSelectorOpen(true);
  };

  const getSortedLogs = (logs: WorkoutLog[]) => {
    return [...logs].sort((a, b) => {
      const timeA = new Date(a.date).getTime();
      const timeB = new Date(b.date).getTime();
      if (timeA !== timeB) {
        return timeB - timeA;
      }
      return b.id.localeCompare(a.id);
    });
  };

  const getPreviousSetsForExercise = (exerciseName: string): SetEntry[] | null => {
    try {
      const logs = storage.getWorkoutLogs();
      if (!logs || logs.length === 0) return null;

      // Sort logs by date descending (newest first) and then by ID descending (newest first)
      const sortedLogs = getSortedLogs(logs);

      // Try program-specific logs first if we have a programId
      if (programId) {
        const programLogs = sortedLogs.filter(l => l.programId === programId);
        for (const log of programLogs) {
          const matchedEx = log.exercises.find(
            ex => ex.name.trim().toLowerCase() === exerciseName.trim().toLowerCase()
          );
          if (matchedEx && matchedEx.sets && matchedEx.sets.length > 0) {
            return matchedEx.sets.map(s => ({
              setNumber: s.setNumber,
              weight: s.weight,
              reps: s.reps,
              rpe: s.rpe,
              form: s.form,
              comment: s.comment,
              isDropSet: s.isDropSet
            }));
          }
        }
      }

      // Fallback to any program logs or one-off logs in database
      for (const log of sortedLogs) {
        const matchedEx = log.exercises.find(
          ex => ex.name.trim().toLowerCase() === exerciseName.trim().toLowerCase()
        );
        if (matchedEx && matchedEx.sets && matchedEx.sets.length > 0) {
          return matchedEx.sets.map(s => ({
            setNumber: s.setNumber,
            weight: s.weight,
            reps: s.reps,
            rpe: s.rpe,
            form: s.form,
            comment: s.comment,
            isDropSet: s.isDropSet
          }));
        }
      }
    } catch (err) {
      console.error('Error fetching previous sets:', err);
    }
    return null;
  };

  const handleSelectExercise = (selectedList: { name: string; category: string; modality?: 'weighted' | 'bodyweight' | 'assisted' | 'distance' | 'timed' }[]) => {
    if (selectedList.length === 0) return;
    if (selectorTargetIdx === -1) {
      setExercises(prev => [
        ...prev,
        ...selectedList.map(item => {
          const prevSets = getPreviousSetsForExercise(item.name);
          return {
            name: item.name,
            muscleGroup: item.category,
            modality: item.modality || 'weighted',
            sets: prevSets || [{ setNumber: 1, weight: 0, reps: 8, rpe: 8, form: 'standard' as const }],
          };
        })
      ]);
      setSelectorTargetIdx(null);
    } else if (selectorTargetIdx !== null) {
      const first = selectedList[0];
      const prevSets = getPreviousSetsForExercise(first.name);
      setExercises(prev =>
        prev.map((ex, idx) => {
          if (idx === selectorTargetIdx) {
            return {
              ...ex,
              name: first.name,
              muscleGroup: first.category,
              modality: first.modality || 'weighted',
              sets: prevSets || [{ setNumber: 1, weight: 0, reps: 8, rpe: 8, form: 'standard' as const }],
            };
          }
          return ex;
        })
      );
      setSelectorTargetIdx(null);
    }
  };
  const [duration, setDuration] = useState<number>(() => {
    try {
      const logs = storage.getWorkoutLogs();
      if (!logs || logs.length === 0) return 60;
      const sortedLogs = getSortedLogs(logs);
      if (programId) {
        const matchedLog = sortedLogs.find(l => l.programId === programId && String(l.day) === String(dayNum));
        if (matchedLog && typeof matchedLog.durationMinutes === 'number') {
          return matchedLog.durationMinutes;
        }
        const programLog = sortedLogs.find(l => l.programId === programId);
        if (programLog && typeof programLog.durationMinutes === 'number') {
          return programLog.durationMinutes;
        }
      }
      if (sortedLogs[0] && typeof sortedLogs[0].durationMinutes === 'number') {
        return sortedLogs[0].durationMinutes;
      }
    } catch (err) {
      console.error('Error fetching previous workout duration:', err);
    }
    return 60;
  });
  const [notes, setNotes] = useState<string>('');

  // Wellness & Recovery Metrics
  const [sleep, setSleep] = useState<number>(7.5);
  const [hydration, setHydration] = useState<number>(2.5);
  const [calories, setCalories] = useState<number>(2500);
  const [protein, setProtein] = useState<number>(140);
  const [soreness, setSoreness] = useState<number>(3);
  const [motivation, setMotivation] = useState<number>(4);

  const [alertMsg, setAlertMsg] = useState<string | null>(null);

  // Set-level checkbox tracking for satisfying UX
  const [checkedSets, setCheckedSets] = useState<Record<string, boolean>>({});

  // Collapsed states
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});

  // Dialog and contextual action states
  const [deleteExerciseIdx, setDeleteExerciseIdx] = useState<number | null>(null);
  const [historyExerciseName, setHistoryExerciseName] = useState<string | null>(null);
  const [activeSetAction, setActiveSetAction] = useState<{ exIdx: number; setIdx: number } | null>(null);
  const [commentEditState, setCommentEditState] = useState<{ exIdx: number; setIdx: number; text: string } | null>(null);
  const [activeExAction, setActiveExAction] = useState<number | null>(null);
  const [activeSelector, setActiveSelector] = useState<{ exIdx: number; setIdx: number; type: 'rpe' | 'form' } | null>(null);

  // Draft persistence states
  const [isDraftLoaded, setIsDraftLoaded] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [hasExistingDraft, setHasExistingDraft] = useState(() => {
    try {
      const draftStr = localStorage.getItem('metreps_workout_draft');
      if (draftStr) {
        const draft = JSON.parse(draftStr);
        const matches = isOneOff
          ? draft.isOneOff === true
          : (draft.programId === programId && String(draft.weekNum) === String(weekNum) && String(draft.dayNum) === String(dayNum));
        return !!matches;
      }
    } catch (_) {}
    return false;
  });

  useEffect(() => {
    setIsDraftLoaded(false);
    try {
      const draftStr = localStorage.getItem('metreps_workout_draft');
      if (draftStr) {
        const draft = JSON.parse(draftStr);
        const matches = isOneOff
          ? draft.isOneOff === true
          : (draft.programId === programId && String(draft.weekNum) === String(weekNum) && String(draft.dayNum) === String(dayNum));
        setHasExistingDraft(!!matches);
      } else {
        setHasExistingDraft(false);
      }
    } catch (_) {
      setHasExistingDraft(false);
    }
  }, [programId, dayNum, isOneOff, weekNum]);

  // Loaded template, active draft or setup blank
  useEffect(() => {
    // Dynamic duration lookup on load / change
    try {
      const logs = storage.getWorkoutLogs();
      if (logs && logs.length > 0) {
        const sortedLogs = getSortedLogs(logs);
        let foundDuration = 60;
        if (programId) {
          const matchedLog = sortedLogs.find(l => l.programId === programId && String(l.day) === String(dayNum));
          if (matchedLog && typeof matchedLog.durationMinutes === 'number') {
            foundDuration = matchedLog.durationMinutes;
          } else {
            const programLog = sortedLogs.find(l => l.programId === programId);
            if (programLog && typeof programLog.durationMinutes === 'number') {
              foundDuration = programLog.durationMinutes;
            }
          }
        } else {
          if (sortedLogs[0] && typeof sortedLogs[0].durationMinutes === 'number') {
            foundDuration = sortedLogs[0].durationMinutes;
          }
        }
        setDuration(foundDuration);
      } else {
        setDuration(60);
      }
    } catch (err) {
      console.error('Error fetching duration in useEffect:', err);
    }

    // Attempt to load existing matching draft
    try {
      const draftStr = localStorage.getItem('metreps_workout_draft');
      if (draftStr) {
        const draft = JSON.parse(draftStr);
        const matches = isOneOff
          ? draft.isOneOff === true
          : (draft.programId === programId && String(draft.weekNum) === String(weekNum) && String(draft.dayNum) === String(dayNum));

        if (matches) {
          setExercises(draft.exercises || []);
          setDuration(draft.duration || 60);
          setNotes(draft.notes || '');
          setSleep(draft.sleep ?? 7.5);
          setHydration(draft.hydration ?? 2.5);
          setCalories(draft.calories ?? 2500);
          setProtein(draft.protein ?? 140);
          setSoreness(draft.soreness ?? 3);
          setMotivation(draft.motivation ?? 4);
          setCheckedSets(draft.checkedSets || {});
          setCollapsed(draft.collapsed || {});
          setHasExistingDraft(true);
          setIsDraftLoaded(true);
          return;
        }
      }
    } catch (e) {
      console.error('Failed to parse or apply workout draft:', e);
    }

    if (programId) {
      const activeProg = storage.getPrograms().find(p => p.id === programId);
      if (activeProg && activeProg.exercisesByDay[Number(dayNum)]) {
        // Deep clone template exercises
        const templates: ExerciseEntry[] = JSON.parse(
          JSON.stringify(activeProg.exercisesByDay[Number(dayNum)])
        );
        // Pre-fill sets from the most recent logged session if available
        const prefilled = templates.map(ex => {
          const prevSets = getPreviousSetsForExercise(ex.name);
          if (prevSets) {
            return {
              ...ex,
              sets: prevSets
            };
          }
          return ex;
        });
        setExercises(prefilled);
        setIsDraftLoaded(true);
        return;
      }
    }

    // Default blank exercise if none loaded or is empty if isOneOff
    if (isOneOff) {
      setExercises([]);
    } else {
      const defaultName = 'Bench Press';
      const prevSets = getPreviousSetsForExercise(defaultName);
      setExercises([
        {
          name: defaultName,
          muscleGroup: 'Chest',
          modality: 'weighted',
          sets: prevSets || [{ setNumber: 1, weight: 60, reps: 8, rpe: 8, form: 'standard' }],
        },
      ]);
    }
    setIsDraftLoaded(true);
  }, [programId, dayNum, isOneOff, weekNum]);

  // Auto-save draft on every modification
  useEffect(() => {
    if (!isDraftLoaded) return;

    const draftData = {
      programId,
      programName,
      weekNum,
      dayNum,
      dateStr,
      isOneOff,
      scheduledDate,
      exercises,
      duration,
      notes,
      sleep,
      hydration,
      calories,
      protein,
      soreness,
      motivation,
      checkedSets,
      collapsed,
    };

    localStorage.setItem('metreps_workout_draft', JSON.stringify(draftData));
    setHasExistingDraft(true);
  }, [
    isDraftLoaded,
    programId,
    programName,
    weekNum,
    dayNum,
    dateStr,
    isOneOff,
    scheduledDate,
    exercises,
    duration,
    notes,
    sleep,
    hydration,
    calories,
    protein,
    soreness,
    motivation,
    checkedSets,
    collapsed,
  ]);

  const handleDiscardDraft = () => {
    localStorage.removeItem('metreps_workout_draft');
    setHasExistingDraft(false);
    setIsDraftLoaded(false);

    if (programId) {
      const activeProg = storage.getPrograms().find(p => p.id === programId);
      if (activeProg && activeProg.exercisesByDay[Number(dayNum)]) {
        const templates: ExerciseEntry[] = JSON.parse(
          JSON.stringify(activeProg.exercisesByDay[Number(dayNum)])
        );
        const prefilled = templates.map(ex => {
          const prevSets = getPreviousSetsForExercise(ex.name);
          if (prevSets) {
            return { ...ex, sets: prevSets };
          }
          return ex;
        });
        setExercises(prefilled);
      } else {
        setExercises([]);
      }
    } else if (isOneOff) {
      setExercises([]);
    } else {
      const defaultName = 'Bench Press';
      const prevSets = getPreviousSetsForExercise(defaultName);
      setExercises([
        {
          name: defaultName,
          muscleGroup: 'Chest',
          modality: 'weighted',
          sets: prevSets || [{ setNumber: 1, weight: 60, reps: 8, rpe: 8, form: 'standard' }],
        },
      ]);
    }

    setDuration(60);
    setNotes('');
    setSleep(7.5);
    setHydration(2.5);
    setCalories(2500);
    setProtein(140);
    setSoreness(3);
    setMotivation(4);
    setCheckedSets({});
    setCollapsed({});

    setTimeout(() => {
      setIsDraftLoaded(true);
    }, 50);
  };

  const toggleCollapse = (idx: number) => {
    setCollapsed(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const handleAddExercise = () => {
    setExercises(prev => [
      ...prev,
      {
        name: 'New Exercise',
        muscleGroup: 'Chest',
        modality: 'weighted',
        sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 8, form: 'standard' }],
      },
    ]);
  };

  const handleDeleteExercise = (idx: number) => {
    setExercises(prev => prev.filter((_, i) => i !== idx));
  };

  const handleToggleDropSet = (exIdx: number, setIdx: number) => {
    setExercises(prev =>
      prev.map((ex, i) => {
        if (i === exIdx) {
          const sets = ex.sets.map((s, sIdx) =>
            sIdx === setIdx ? { ...s, isDropSet: !s.isDropSet } : s
          );
          return { ...ex, sets };
        }
        return ex;
      })
    );
  };

  const handleUpdateSetComment = (exIdx: number, setIdx: number, comment: string) => {
    setExercises(prev =>
      prev.map((ex, i) => {
        if (i === exIdx) {
          const sets = ex.sets.map((s, sIdx) =>
            sIdx === setIdx ? { ...s, comment: comment || null } : s
          );
          return { ...ex, sets };
        }
        return ex;
      })
    );
  };

  const handleMoveSet = (exIdx: number, setIdx: number, direction: 'up' | 'down') => {
    setExercises(prev =>
      prev.map((ex, i) => {
        if (i === exIdx) {
          const targetIdx = direction === 'up' ? setIdx - 1 : setIdx + 1;
          if (targetIdx < 0 || targetIdx >= ex.sets.length) return ex;
          const sets = [...ex.sets];
          const temp = sets[setIdx];
          sets[setIdx] = sets[targetIdx];
          sets[targetIdx] = temp;
          const reindexed = sets.map((s, idx) => ({ ...s, setNumber: idx + 1 }));
          return { ...ex, sets: reindexed };
        }
        return ex;
      })
    );
  };

  const handleToggleSuperset = (exIdx: number) => {
    setExercises(prev =>
      prev.map((ex, i) => (i === exIdx ? { ...ex, isSuperset: !ex.isSuperset } : ex))
    );
  };

  const handleUpdateExerciseName = (idx: number, name: string) => {
    setExercises(prev =>
      prev.map((ex, i) => (i === idx ? { ...ex, name } : ex))
    );
  };

  const handleUpdateMuscleGroup = (idx: number, muscleGroup: string) => {
    setExercises(prev =>
      prev.map((ex, i) => (i === idx ? { ...ex, muscleGroup } : ex))
    );
  };

  const handleAddSet = (exIdx: number) => {
    setExercises(prev =>
      prev.map((ex, i) => {
        if (i === exIdx) {
          const nextSetNum = ex.sets.length + 1;
          const lastSet = ex.sets[ex.sets.length - 1] || { weight: 0, reps: 0, rpe: 8, form: 'standard' };
          return {
            ...ex,
            sets: [
              ...ex.sets,
              {
                setNumber: nextSetNum,
                weight: lastSet.weight,
                reps: lastSet.reps,
                rpe: lastSet.rpe,
                form: lastSet.form,
              },
            ],
          };
        }
        return ex;
      })
    );
  };

  const handleDeleteSet = (exIdx: number, setIdx: number) => {
    setExercises(prev =>
      prev.map((ex, i) => {
        if (i === exIdx) {
          const filteredSets = ex.sets.filter((_, sIdx) => sIdx !== setIdx);
          // Re-index sets
          const reindexed = filteredSets.map((s, sIdx) => ({
            ...s,
            setNumber: sIdx + 1,
          }));
          return { ...ex, sets: reindexed };
        }
        return ex;
      })
    );
  };

  const handleUpdateSet = <K extends keyof SetEntry>(
    exIdx: number,
    setIdx: number,
    key: K,
    val: SetEntry[K]
  ) => {
    setExercises(prev =>
      prev.map((ex, i) => {
        if (i === exIdx) {
          const updatedSets = ex.sets.map((s, sIdx) =>
            sIdx === setIdx ? { ...s, [key]: val } : s
          );
          return { ...ex, sets: updatedSets };
        }
        return ex;
      })
    );
  };

  const toggleSetCheck = (exIdx: number, setIdx: number) => {
    const key = `${exIdx}-${setIdx}`;
    setCheckedSets(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const getExerciseHistory = (name: string) => {
    const logs = storage.getWorkoutLogs();
    const history: Array<{ date: string; week?: number | string; day?: number | string; setNumber: number; weight: number; reps: number; rpe?: number; form?: string; modality?: string }> = [];
    const sortedLogs = getSortedLogs(logs);
    for (const log of sortedLogs) {
      const match = log.exercises.find(e => e.name.toLowerCase() === name.toLowerCase());
      if (match) {
        const isTimed = match.modality === 'timed';
        const isBw = match.modality === 'bodyweight';
        const defaultBw = storage.getBodyweight();
        for (const s of match.sets) {
          const actualWeight = typeof s.weight === 'number' ? s.weight : (isBw ? (defaultBw ?? 0) : 0);
          if (isTimed || typeof s.reps === 'number') {
            history.push({
              date: log.date,
              week: log.week,
              day: log.day,
              setNumber: s.setNumber,
              weight: actualWeight,
              reps: s.reps ?? 0,
              rpe: s.rpe ?? undefined,
              form: s.form ?? undefined,
              modality: match.modality
            });
          }
        }
      }
    }
    return history.slice(0, 50);
  };

  const handleSaveSession = () => {
    if (exercises.length === 0) {
      setAlertMsg('Please add at least one exercise before saving!');
      return;
    }

    const processedExercises = exercises.map(ex => {
      if (ex.modality === 'bodyweight') {
        const defaultBw = storage.getBodyweight();
        return {
          ...ex,
          sets: ex.sets.map(s => ({
            ...s,
            weight: s.weight !== null && s.weight !== undefined && s.weight !== 0 ? s.weight : (defaultBw ?? 0)
          }))
        };
      }
      return ex;
    });

    const newLog: WorkoutLog = {
      id: `log-${Date.now()}`,
      date: dateStr,
      scheduledDate: scheduledDate,
      programId: programId,
      program: programName,
      week: weekNum,
      day: dayNum,
      exercises: processedExercises,
      unit: unit,
      durationMinutes: duration,
      notes: notes,
      recovery: {
        sleepHours: sleep,
        hydrationLiters: hydration,
        nutritionCalories: calories,
        proteinGrams: protein,
        soreness: soreness,
        motivation: motivation,
      },
    };

    storage.saveWorkoutLog(newLog);
    localStorage.removeItem('metreps_workout_draft');
    onSave();
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Header Bar */}
      <div className="flex items-center justify-between border-b border-slate-850 pb-3 px-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={onClose}
            className="p-2 bg-slate-900 hover:bg-slate-800 rounded-none text-slate-400 hover:text-white border border-slate-800 transition shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <h2 className="font-extrabold text-sm text-white uppercase tracking-wide truncate" title={isOneOff ? 'One-Off Workout' : programName}>
              {isOneOff ? 'One-Off Workout' : programName}
            </h2>
            <p className="text-[10px] text-indigo-400 font-mono uppercase tracking-widest truncate">
              {!isOneOff && `Week ${weekNum} • Day ${dayNum} • `} {formatDayMonYear(dateStr)}
            </p>
            {hasExistingDraft && (
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                <span className="text-[8px] font-mono font-extrabold text-emerald-400 bg-emerald-950/40 border border-emerald-500/20 px-1.5 py-0.5 rounded-none flex items-center gap-1 shrink-0 uppercase tracking-wider">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                  AUTO-SAVED
                </span>
                <button
                  onClick={() => setShowDiscardConfirm(true)}
                  className="text-[8px] font-mono font-bold text-rose-400 hover:text-rose-300 bg-rose-950/20 hover:bg-rose-950/40 border border-rose-500/15 px-1.5 py-0.5 rounded-none transition shrink-0 uppercase tracking-wider cursor-pointer"
                >
                  Reset Draft
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* General Settings Row */}
      <div className="grid grid-cols-2 gap-4 w-full bg-slate-900 border-y border-x-0 border-slate-800 p-4 rounded-none">
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">
            Duration
          </label>
          <div className="relative flex items-center bg-slate-950 rounded-none border border-slate-850 px-3 h-10 focus-within:border-indigo-500 transition">
            <Clock className="w-4 h-4 text-slate-500 mr-2 shrink-0" />
            <input
              type="number"
              value={duration}
              onChange={e => setDuration(Math.max(1, Number(e.target.value)))}
              className="bg-transparent text-base font-extrabold text-white w-full focus:outline-none"
            />
            <span className="text-[10px] text-slate-400 font-black ml-1">MIN</span>
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">
            Workout Date
          </label>
          <div className="bg-slate-950 rounded-none border border-slate-850 px-3 h-10 flex items-center justify-center text-xs font-black text-slate-300 font-mono">
            {formatDayMonYear(dateStr)}
          </div>
        </div>
      </div>

      {/* Exercises Section */}
      <div className="space-y-6">

        {exercises.map((ex, exIdx) => {
          const isCollapsed = collapsed[exIdx];
          const isTimed = ex.modality === 'timed';
          const gridColsClass = isTimed
            ? 'grid-cols-[1.1fr_3.3fr_2fr_4.33fr_1.1fr]'
            : 'grid-cols-[1.15fr_2.9fr_1.65fr_1.65fr_3.55fr_1fr]';
          return (
            <div key={exIdx} className="relative pt-3.5">
              {/* Target Muscle Group Header - Popping Peeking Card */}
              <div className="absolute top-0 left-4 z-10 flex">
                <div className="bg-slate-950 border border-slate-800 border-b-0 px-3.5 py-1.5 rounded-none flex items-center gap-1.5 shadow-[0_-4px_12px_rgba(0,0,0,0.6)]">
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse shrink-0" />
                  <span className="text-[11px] sm:text-xs font-black uppercase tracking-widest text-indigo-400 font-mono leading-none">
                    {ex.muscleGroup || 'General'}
                  </span>
                </div>
              </div>

              <div
                className={`w-full bg-slate-900 border-y border-x-0 transition-all rounded-none ${
                  isCollapsed ? 'border-slate-800/80 bg-slate-900/60 overflow-hidden' : 'border-slate-800 shadow-lg shadow-indigo-950/10'
                }`}
              >
                {/* Exercise Card Title Header */}
                <div className="flex items-center justify-between gap-2 py-3.5 px-4 bg-slate-950/30 border-b border-slate-850/60 relative">
                  <h4 className="font-black text-sm sm:text-base text-indigo-300 uppercase tracking-wide">
                    {ex.name}
                  </h4>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => openSelectorForIdx(exIdx)}
                      className="p-2 hover:bg-slate-800 text-indigo-400 hover:text-indigo-300 rounded-none transition border border-slate-800 bg-slate-950/50"
                      title="Edit Exercise"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setHistoryExerciseName(ex.name)}
                      className="p-2 hover:bg-slate-800 text-cyan-400 hover:text-cyan-300 rounded-none transition border border-slate-800 bg-slate-950/50"
                      title="Lifting History"
                    >
                      <History className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setActiveExAction(exIdx)}
                      className="p-2 hover:bg-slate-800 text-slate-400 hover:text-white rounded-none transition border border-slate-800 bg-slate-950/50"
                      title="Exercise Settings"
                    >
                      <Info className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Set logging details */}
                {!isCollapsed && (
                  <div className="p-0 space-y-0">
                    {/* Sets Column Header */}
                    <div className={`grid ${gridColsClass} gap-1 px-3 py-2 bg-slate-950/50 border-b border-slate-850 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center`}>
                      <span className="text-center text-slate-500">Set</span>
                      <span>
                        {ex.modality === 'assisted'
                          ? `Assist (${unit})`
                          : ex.modality === 'timed'
                          ? 'Secs'
                          : ex.modality === 'bodyweight'
                          ? 'BODYWT'
                          : `Weight (${unit})`}
                      </span>
                      {!isTimed && <span>Reps</span>}
                      <span>RPE</span>
                      <span>Form</span>
                      <span>Opt</span>
                    </div>

                    {ex.sets.map((set, setIdx) => {
                      return (
                        <div key={setIdx} className="space-y-0 border-b border-slate-850">
                          <div
                            className={`grid ${gridColsClass} gap-1 items-center px-2 py-1.5 bg-slate-950/25`}
                          >
                            {/* Set index / Drop Set Icon */}
                            <div className="text-center text-xs font-black text-slate-300 font-mono flex flex-col items-center justify-center leading-none">
                              <span className="text-[8px] text-slate-500 uppercase font-sans font-medium tracking-normal mb-0.5">Set</span>
                              <div className="flex items-center justify-center gap-0.5">
                                <span className="text-sm font-bold">{set.setNumber}</span>
                                {set.isDropSet && (
                                  <span className="text-rose-500 font-black text-xs" title="Drop Set">↓</span>
                                )}
                              </div>
                            </div>

                            {/* Weight Input */}
                            <div>
                              {ex.modality === 'bodyweight' ? (
                                <input
                                  type="number"
                                  step="0.1"
                                  value={set.weight !== null && set.weight !== undefined && set.weight !== 0 ? set.weight : (storage.getBodyweight() ?? '')}
                                  onChange={e =>
                                    handleUpdateSet(
                                      exIdx,
                                      setIdx,
                                      'weight',
                                      e.target.value === '' ? null : Number(e.target.value)
                                    )
                                  }
                                  className="bg-slate-950 text-base font-black text-center text-white border border-slate-800 rounded-none h-10 w-full focus:outline-none focus:border-indigo-500 font-mono"
                                  placeholder={storage.getBodyweight() ? String(storage.getBodyweight()) : 'BW'}
                                />
                              ) : (
                                <input
                                  type="number"
                                  step="0.5"
                                  value={set.weight ?? ''}
                                  onChange={e =>
                                    handleUpdateSet(
                                      exIdx,
                                      setIdx,
                                      'weight',
                                      e.target.value === '' ? null : Number(e.target.value)
                                    )
                                  }
                                  className="bg-slate-950 text-base font-black text-center text-white border border-slate-800 rounded-none h-10 w-full focus:outline-none focus:border-indigo-500 font-mono"
                                  placeholder={ex.modality === 'timed' ? 'Secs' : '0'}
                                />
                              )}
                            </div>

                            {/* Reps Input */}
                            {!isTimed && (
                              <div>
                                <input
                                  type="number"
                                  value={set.reps ?? ''}
                                  onChange={e =>
                                    handleUpdateSet(
                                      exIdx,
                                      setIdx,
                                      'reps',
                                      e.target.value === '' ? null : Number(e.target.value)
                                    )
                                  }
                                  className="bg-slate-950 text-base font-black text-center text-white border border-slate-800 rounded-none h-10 w-full focus:outline-none focus:border-indigo-500 font-mono"
                                  placeholder="0"
                                />
                              </div>
                            )}

                            {/* RPE Selector */}
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => setActiveSelector(activeSelector?.exIdx === exIdx && activeSelector?.setIdx === setIdx && activeSelector?.type === 'rpe' ? null : { exIdx, setIdx, type: 'rpe' })}
                                className="bg-slate-950 text-sm font-black text-center text-slate-300 border border-slate-800 rounded-none h-10 w-full focus:outline-none focus:border-indigo-500 font-mono flex items-center justify-center cursor-pointer hover:bg-slate-900 transition"
                              >
                                {set.rpe ?? 8}
                              </button>
                              {activeSelector?.exIdx === exIdx && activeSelector?.setIdx === setIdx && activeSelector?.type === 'rpe' && (
                                <>
                                  <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setActiveSelector(null); }} />
                                  <div className="absolute left-1/2 -translate-x-1/2 bottom-11 bg-slate-950 border border-slate-800 rounded-none shadow-2xl z-50 overflow-hidden py-1 min-w-[50px] max-w-[60px]">
                                    {[5, 6, 7, 8, 9, 10].map(val => (
                                      <button
                                        key={val}
                                        type="button"
                                        onClick={() => {
                                          handleUpdateSet(exIdx, setIdx, 'rpe', val);
                                          setActiveSelector(null);
                                        }}
                                        className={`w-full text-center py-2 text-sm font-mono font-black border-y border-transparent cursor-pointer transition ${
                                          (set.rpe ?? 8) === val
                                            ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30'
                                            : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                                        }`}
                                      >
                                        {val}
                                      </button>
                                    ))}
                                  </div>
                                </>
                              )}
                            </div>

                            {/* Form Rating */}
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => setActiveSelector(activeSelector?.exIdx === exIdx && activeSelector?.setIdx === setIdx && activeSelector?.type === 'form' ? null : { exIdx, setIdx, type: 'form' })}
                                className="bg-slate-950 text-xs font-bold text-center text-slate-300 border border-slate-800 rounded-none h-10 w-full focus:outline-none focus:border-indigo-500 flex items-center justify-center cursor-pointer hover:bg-slate-900 transition capitalize truncate px-1"
                              >
                                {set.form ?? 'standard'}
                              </button>
                              {activeSelector?.exIdx === exIdx && activeSelector?.setIdx === setIdx && activeSelector?.type === 'form' && (
                                <>
                                  <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setActiveSelector(null); }} />
                                  <div className="absolute left-1/2 -translate-x-1/2 bottom-11 bg-slate-950 border border-slate-800 rounded-none shadow-2xl z-50 overflow-hidden py-1 min-w-[85px]">
                                    {(['strict', 'standard', 'loose'] as const).map(val => (
                                      <button
                                        key={val}
                                        type="button"
                                        onClick={() => {
                                          handleUpdateSet(exIdx, setIdx, 'form', val);
                                          setActiveSelector(null);
                                        }}
                                        className={`w-full text-center py-2.5 text-xs font-bold border-y border-transparent cursor-pointer transition capitalize ${
                                          (set.form ?? 'standard') === val
                                            ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30'
                                            : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                                        }`}
                                      >
                                        {val}
                                      </button>
                                    ))}
                                  </div>
                                </>
                              )}
                            </div>

                            {/* Options action menu icon */}
                            <div className="flex justify-center">
                              <button
                                onClick={() => setActiveSetAction({ exIdx, setIdx })}
                                className="p-2 hover:bg-slate-800 text-slate-400 hover:text-indigo-400 rounded-none border border-slate-800 bg-slate-950/40 transition"
                                title="Set Options"
                              >
                                <Info className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          {/* Set comment row if exists */}
                          {set.comment && (
                            <div className="px-4 py-2 text-xs text-slate-400 font-semibold italic flex items-center gap-1 bg-indigo-950/10 border-t border-indigo-950/25">
                              <span className="text-indigo-400 font-extrabold uppercase tracking-widest text-[9px] font-mono">Note:</span>
                              <span>"{set.comment}"</span>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    <div className="p-3">
                      <button
                        onClick={() => handleAddSet(exIdx)}
                        className="w-full bg-slate-950 hover:bg-slate-850 text-slate-300 hover:text-white border border-slate-850 rounded-none py-3 text-sm font-extrabold transition flex items-center justify-center gap-1"
                      >
                        <Plus className="w-4 h-4" /> Add Set
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Superset visual connector */}
              {ex.isSuperset && exIdx < exercises.length - 1 && (
                <div className="flex flex-col items-center -my-4 z-10 relative">
                  <div className="w-1 bg-indigo-500/40 h-8 border-l border-dashed border-indigo-400/60 flex items-center justify-center">
                    <div className="bg-slate-950 text-[7px] text-indigo-400 font-black px-2 py-0.5 rounded-none border border-indigo-500/30 uppercase tracking-widest font-mono">
                      Superset Link
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <div className="px-4">
          <button
            onClick={() => {
              setSelectorTargetIdx(-1);
              setIsSelectorOpen(true);
            }}
            className="w-full bg-indigo-500/5 hover:bg-indigo-500/10 border border-dashed border-indigo-500/20 hover:border-indigo-500/40 text-indigo-400 font-extrabold text-sm py-4 rounded-none transition flex items-center justify-center gap-1.5"
          >
            <Plus className="w-5 h-5" /> Add Custom Exercise
          </button>
        </div>
      </div>

      {/* Daily Recovery & Wellness Slider Section */}
      <div className="w-full bg-slate-900 border-y border-x-0 border-slate-800 p-4 space-y-4 rounded-none">
        <h3 className="font-extrabold text-xs text-slate-400 uppercase tracking-wider flex items-center gap-2 border-b border-slate-850 pb-2">
          <Award className="w-4 h-4 text-cyan-400" />
          Recovery Factors & Daily Metrics
        </h3>

        <div className="grid grid-cols-3 gap-3">
          {/* Sleep hours */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              <Coffee className="w-3.5 h-3.5 text-indigo-400" />
              Sleep QTY
            </label>
            <div className="bg-slate-950 px-2 py-2 rounded-none border border-slate-850 flex items-center justify-between gap-1 h-10">
              <input
                type="number"
                step="0.5"
                value={sleep}
                onChange={e => setSleep(Math.max(0, Number(e.target.value)))}
                className="bg-transparent font-black text-sm text-white flex-1 w-0 min-w-0 focus:outline-none font-mono text-center"
              />
              <span className="text-[9px] text-slate-500 font-black shrink-0">HRS</span>
            </div>
          </div>

          {/* Hydration */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              <Droplet className="w-3.5 h-3.5 text-cyan-400" />
              Hydration
            </label>
            <div className="bg-slate-950 px-2 py-2 rounded-none border border-slate-850 flex items-center justify-between gap-1 h-10">
              <input
                type="number"
                step="0.1"
                value={hydration}
                onChange={e => setHydration(Math.max(0, Number(e.target.value)))}
                className="bg-transparent font-black text-sm text-white flex-1 w-0 min-w-0 focus:outline-none font-mono text-center"
              />
              <span className="text-[9px] text-slate-500 font-black shrink-0">LTS</span>
            </div>
          </div>

          {/* Calories */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              <Flame className="w-3.5 h-3.5 text-amber-500" />
              Calories
            </label>
            <div className="bg-slate-950 px-2 py-2 rounded-none border border-slate-850 flex items-center justify-between gap-1 h-10">
              <input
                type="number"
                value={calories}
                onChange={e => setCalories(Math.max(0, Number(e.target.value)))}
                className="bg-transparent font-black text-sm text-white flex-1 w-0 min-w-0 focus:outline-none font-mono text-center"
              />
              <span className="text-[9px] text-slate-500 font-black shrink-0">KCAL</span>
            </div>
          </div>
        </div>

        {/* Soreness & Quality sliders */}
        <div className="space-y-3.5 pt-2">
          {/* Soreness Rating */}
          <div className="space-y-1">
            <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-wider">
              <span className="text-slate-400">Muscle Soreness (1-10)</span>
              <span className="text-indigo-400 font-mono font-extrabold">{soreness}/10</span>
            </div>
            <input
              type="range"
              min="1"
              max="10"
              value={soreness}
              onChange={e => setSoreness(Number(e.target.value))}
              className="w-full h-1.5 bg-slate-950 rounded-none appearance-none cursor-pointer accent-indigo-500"
            />
          </div>

          {/* Quality Rating */}
          <div className="space-y-1">
            <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-wider">
              <span className="text-slate-400">Workout Quality (1-10)</span>
              <span className="text-cyan-400 font-mono font-extrabold">{motivation}/10</span>
            </div>
            <input
              type="range"
              min="1"
              max="10"
              value={motivation}
              onChange={e => setMotivation(Number(e.target.value))}
              className="w-full h-1.5 bg-slate-950 rounded-none appearance-none cursor-pointer accent-cyan-500"
            />
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="w-full bg-slate-900 border-y border-x-0 border-slate-800 p-4 rounded-none">
        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
          Session Notes & Observations
        </label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="e.g., Squats felt heavy but core bracing was stable. Rest periods were 3 mins."
          rows={3}
          className="w-full bg-slate-950 border border-slate-850 rounded-none px-3 py-2.5 text-sm font-medium text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
        />
      </div>

      {/* Save Log Button at Bottom */}
      <div className="px-4 pt-2">
        <button
          onClick={handleSaveSession}
          className="w-full bg-gradient-to-r from-indigo-500 to-cyan-500 hover:from-indigo-600 hover:to-cyan-600 text-white font-black text-sm py-4 px-4 rounded-none transition shadow-md shadow-indigo-950/20 active:scale-[0.98] flex items-center justify-center gap-2 uppercase tracking-wider"
        >
          <Check className="w-5 h-5" /> Save Workout Log
        </button>
      </div>

      <ExerciseSelectorModal
        isOpen={isSelectorOpen}
        onClose={() => {
          setIsSelectorOpen(false);
          setSelectorTargetIdx(null);
        }}
        onSelect={handleSelectExercise}
      />

      <ConfirmationModal
        visible={alertMsg !== null}
        title="Lifting Entry Error"
        message={alertMsg || ''}
        confirmLabel="OK"
        onConfirm={() => setAlertMsg(null)}
        onCancel={() => setAlertMsg(null)}
      />

      <ConfirmationModal
        visible={showDiscardConfirm}
        title="Discard Draft Workout"
        message="Are you sure you want to discard your current in-progress draft and reset this workout session? This will revert everything to the start state of this session."
        confirmLabel="Discard & Reset"
        cancelLabel="Keep Workout"
        confirmVariant="danger"
        onConfirm={() => {
          handleDiscardDraft();
          setShowDiscardConfirm(false);
        }}
        onCancel={() => setShowDiscardConfirm(false)}
      />

      {/* Exercise Options Modal */}
      {activeExAction !== null && (() => {
        const ex = exercises[activeExAction];
        if (!ex) return null;
        return (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
              <div className="p-4 border-b border-slate-850 bg-slate-950/40 flex justify-between items-center">
                <h3 className="font-extrabold text-xs text-white uppercase tracking-wider">Exercise Options</h3>
                <button onClick={() => setActiveExAction(null)} className="text-slate-400 hover:text-white text-xs font-bold font-sans">CLOSE</button>
              </div>
              <div className="p-4 space-y-3">
                <p className="text-xs text-slate-400 font-semibold mb-1">Configure <span className="text-indigo-400 font-bold">"{ex.name}"</span></p>
                <button
                  onClick={() => {
                    handleToggleSuperset(activeExAction);
                    setActiveExAction(null);
                  }}
                  className="w-full text-left bg-slate-950 hover:bg-slate-850 border border-slate-850 rounded-xl p-3 text-xs font-bold text-slate-300 transition flex items-center justify-between"
                >
                  <span>Link with next exercise as Superset</span>
                  <span className={`text-[9px] px-2 py-0.5 rounded-full font-extrabold uppercase font-mono ${ex.isSuperset ? 'bg-indigo-500/20 text-indigo-400' : 'bg-slate-800 text-slate-500'}`}>
                    {ex.isSuperset ? 'ON' : 'OFF'}
                  </span>
                </button>
                <button
                  onClick={() => {
                    toggleCollapse(activeExAction);
                    setActiveExAction(null);
                  }}
                  className="w-full text-left bg-slate-950 hover:bg-slate-850 border border-slate-850 rounded-xl p-3 text-xs font-bold text-slate-300 transition flex items-center justify-between"
                >
                  <span>Collapse / Expand card</span>
                  <span className="text-slate-500 text-[10px] font-mono">
                    {collapsed[activeExAction] ? 'Collapsed' : 'Expanded'}
                  </span>
                </button>
                <button
                  onClick={() => {
                    setDeleteExerciseIdx(activeExAction);
                    setActiveExAction(null);
                  }}
                  className="w-full text-left bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 hover:border-rose-500/40 rounded-xl p-3 text-xs font-bold text-rose-400 transition flex items-center justify-between"
                >
                  <span>Delete Exercise Card</span>
                  <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Set Options Modal */}
      {activeSetAction !== null && (() => {
        const { exIdx, setIdx } = activeSetAction;
        const ex = exercises[exIdx];
        const set = ex?.sets[setIdx];
        if (!set) return null;
        return (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
              <div className="p-4 border-b border-slate-850 bg-slate-950/40 flex justify-between items-center">
                <h3 className="font-extrabold text-xs text-white uppercase tracking-wider">Set {set.setNumber} Options</h3>
                <button onClick={() => setActiveSetAction(null)} className="text-slate-400 hover:text-white text-xs font-bold font-sans">CLOSE</button>
              </div>
              <div className="p-4 space-y-3">
                {/* Comment Inline Input */}
                <div className="space-y-1.5">
                  <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider">Set Comment / Note</label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      defaultValue={set.comment || ''}
                      id="set-comment-input-field"
                      placeholder="e.g., Last rep was slow, good squeeze"
                      className="flex-1 bg-slate-950 border border-slate-850 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-sans"
                    />
                    <button
                      onClick={() => {
                        const val = (document.getElementById('set-comment-input-field') as HTMLInputElement)?.value || '';
                        handleUpdateSetComment(exIdx, setIdx, val);
                        setActiveSetAction(null);
                      }}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs px-3 py-1.5 rounded-xl transition shrink-0"
                    >
                      Save
                    </button>
                  </div>
                </div>

                <div className="border-t border-slate-850 my-2 pt-2 space-y-2">
                  <button
                    onClick={() => {
                      handleToggleDropSet(exIdx, setIdx);
                      setActiveSetAction(null);
                    }}
                    className="w-full text-left bg-slate-950 hover:bg-slate-850 border border-slate-850 rounded-xl p-2.5 text-xs font-bold text-slate-300 transition flex items-center justify-between"
                  >
                    <span>Mark as Drop Set</span>
                    <span className={`text-[8px] px-2 py-0.5 rounded-full font-extrabold uppercase font-mono ${set.isDropSet ? 'bg-rose-500/20 text-rose-400' : 'bg-slate-850 text-slate-500'}`}>
                      {set.isDropSet ? 'YES ↓' : 'NO'}
                    </span>
                  </button>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => {
                        handleMoveSet(exIdx, setIdx, 'up');
                        setActiveSetAction(null);
                      }}
                      disabled={setIdx === 0}
                      className="bg-slate-950 hover:bg-slate-850 disabled:opacity-40 border border-slate-850 rounded-xl p-2 text-xs font-bold text-slate-300 transition text-center"
                    >
                      Move Set Up ▲
                    </button>
                    <button
                      onClick={() => {
                        handleMoveSet(exIdx, setIdx, 'down');
                        setActiveSetAction(null);
                      }}
                      disabled={setIdx === ex.sets.length - 1}
                      className="bg-slate-950 hover:bg-slate-850 disabled:opacity-40 border border-slate-850 rounded-xl p-2 text-xs font-bold text-slate-300 transition text-center"
                    >
                      Move Set Down ▼
                    </button>
                  </div>

                  <button
                    onClick={() => {
                      handleDeleteSet(exIdx, setIdx);
                      setActiveSetAction(null);
                    }}
                    className="w-full text-left bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 hover:border-rose-500/40 rounded-xl p-2.5 text-xs font-bold text-rose-400 transition flex items-center justify-between"
                  >
                    <span>Delete Set</span>
                    <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Exercise History Modal */}
      {historyExerciseName !== null && (() => {
        const history = getExerciseHistory(historyExerciseName);
        const getWeekStyle = (week: any, day: any) => {
          const wNum = Number(week);
          const dNum = Number(day);
          if (isNaN(wNum)) {
            const label = isNaN(dNum) ? 'One-off' : `Day ${dNum}`;
            return {
              bgClass: 'bg-slate-950/40 hover:bg-slate-900/50',
              label: label,
              borderClass: 'border-l-2 border-slate-700/50'
            };
          }
          const label = `W${wNum} D${isNaN(dNum) ? '?' : dNum}`;
          const isEvenWeek = wNum % 2 === 0;
          if (isEvenWeek) {
            return {
              bgClass: 'bg-indigo-950/50 hover:bg-indigo-900/50',
              label: label,
              borderClass: 'border-l-2 border-indigo-400'
            };
          } else {
            return {
              bgClass: 'bg-slate-950 hover:bg-slate-900/60',
              label: label,
              borderClass: 'border-l-2 border-slate-600'
            };
          }
        };

        return (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
              <div className="p-4 border-b border-slate-850 bg-slate-950/40 flex justify-between items-center">
                <div className="flex items-center gap-1.5">
                  <History className="w-4 h-4 text-cyan-400" />
                  <h3 className="font-extrabold text-xs text-white uppercase tracking-wider">Lifting History</h3>
                </div>
                <button onClick={() => setHistoryExerciseName(null)} className="text-slate-400 hover:text-white text-xs font-bold font-sans">CLOSE</button>
              </div>
              <div className="p-4 space-y-3">
                <p className="text-xs text-slate-300 font-semibold">
                  Recent lift stats for <span className="text-cyan-400 font-bold">"{historyExerciseName}"</span>:
                </p>

                {history.length === 0 ? (
                  <div className="bg-slate-950/50 border border-dashed border-slate-850 rounded-xl p-6 text-center text-xs text-slate-500 font-bold uppercase tracking-wider font-mono">
                    No historical records found!
                  </div>
                ) : (
                  <div className="bg-slate-950 rounded-xl border border-slate-850 overflow-hidden max-h-60 overflow-y-auto">
                    {history.map((item, idx) => {
                      const weekStyle = getWeekStyle(item.week, item.day);
                      return (
                        <div
                          key={idx}
                          className={`p-2.5 flex items-center justify-between text-[11px] font-mono transition border-b border-slate-850/30 last:border-b-0 ${weekStyle.bgClass} ${weekStyle.borderClass}`}
                        >
                          <div className="flex flex-col items-start min-w-0 pr-2">
                            <span className="text-slate-300 font-extrabold">
                              {new Date(item.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })}
                            </span>
                            <span className="text-[8px] text-slate-500 font-bold uppercase tracking-wider">
                              {weekStyle.label}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 text-slate-200 shrink-0 text-right">
                            <span className="text-slate-400 font-bold">Set {item.setNumber} -</span>
                            {item.modality === 'timed' ? (
                              <span className="font-extrabold text-white">{item.weight} secs</span>
                            ) : (
                              <>
                                <span className="font-extrabold text-white">
                                  {item.modality === 'bodyweight' ? `Bodyweight (${item.weight && item.weight !== 0 ? `${item.weight}${unit.toUpperCase()}` : 'BW'})` : `${item.weight}${unit.toUpperCase()}`}
                                </span>
                                <span className="text-slate-500 font-bold">x</span>
                                <span className="font-extrabold text-indigo-400">{item.reps} reps</span>
                              </>
                            )}
                            {item.rpe && (
                              <span className="text-cyan-400 bg-cyan-950/40 px-1 py-0.5 rounded text-[8px] font-bold border border-cyan-500/15">@{item.rpe}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <p className="text-[10px] text-slate-500 font-semibold text-center mt-1">
                  Showing up to last 50 sets recorded
                </p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Delete Exercise Confirmation Modal */}
      {deleteExerciseIdx !== null && (() => {
        const ex = exercises[deleteExerciseIdx];
        if (!ex) return null;
        return (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
              <div className="p-4 border-b border-slate-850 bg-slate-950/40">
                <h3 className="font-extrabold text-xs text-white uppercase tracking-wider">Delete Exercise?</h3>
              </div>
              <div className="p-4 space-y-4">
                <p className="text-xs text-slate-300 font-semibold">
                  Are you sure you want to remove <span className="text-rose-400 font-bold">"{ex.name}"</span> and all of its recorded sets? This action cannot be undone.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setDeleteExerciseIdx(null)}
                    className="bg-slate-950 hover:bg-slate-850 border border-slate-850 rounded-xl p-2.5 text-xs font-bold text-slate-300 transition text-center"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      handleDeleteExercise(deleteExerciseIdx);
                      setDeleteExerciseIdx(null);
                    }}
                    className="bg-rose-600 hover:bg-rose-500 text-white rounded-xl p-2.5 text-xs font-bold transition text-center"
                  >
                    Confirm Delete
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
