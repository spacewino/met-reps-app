/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Dumbbell, Plus, Trash2, Check, ArrowLeft, Clock, Flame, Smile, Droplet, Coffee, Award, ChevronDown, ChevronUp, BookOpen, Pencil, History, Info, MoreVertical, Link, Lock, Unlock, ClipboardCheck, Gamepad2, Compass, Activity } from 'lucide-react';
import { Program, WorkoutLog, ExerciseEntry, SetEntry, WeightUnit, DailyRecoveryMetrics, HydrationLevel, mapHydrationToLiters, mapLitersToHydration } from '../types';
import { storage, PREBUILT_TEMPLATES } from '../lib/storage';
import { getTodayLocalDateString } from '../lib/dateUtils';
import { ExerciseSelectorModal } from './ExerciseSelectorModal';
import { ConfirmationModal } from './ConfirmationModal';
import { calculateObjectiveSets } from '../lib/objectiveMath';
import { useModalHistory } from '../lib/useModalHistory';

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
    editLogId?: string | null;
    redoFromLogId?: string | null;
  };
  onClose: () => void;
  onSave: (targetView?: string, params?: any) => void;
}

export function WorkoutLogger({ initialParams, onClose, onSave }: WorkoutLoggerProps) {
  // Configuration
  const themeId = React.useMemo(() => storage.getTheme(), []);
  const editLogId = initialParams?.editLogId || null;
  const existingLog = React.useMemo(() => {
    if (!editLogId) return null;
    return storage.getWorkoutLogs().find(l => l.id === editLogId) || null;
  }, [editLogId]);

  const isOneOff = existingLog ? !existingLog.programId : (!initialParams?.programId || initialParams?.isOneOff);
  const programId = existingLog ? existingLog.programId : (initialParams?.programId || null);
  const programName = existingLog ? (existingLog.program || 'One Off') : (initialParams?.programName || 'One Off');
  const weekNum = existingLog ? (existingLog.week || '1') : (initialParams?.week || '1');
  const dayNum = existingLog ? (existingLog.day || '1') : (initialParams?.day || '1');
  const dateStr = existingLog ? existingLog.date : (initialParams?.date || getTodayLocalDateString());
  const scheduledDate = existingLog ? existingLog.scheduledDate : (initialParams?.scheduledDate || null);

  const activeProg = React.useMemo(() => {
    if (!programId) return null;
    return storage.getPrograms().find(p => p.id === programId) || PREBUILT_TEMPLATES.find(p => p.id === programId) || null;
  }, [programId]);

  const algoDetails = React.useMemo(() => {
    const algoId = activeProg?.algorithmId;
    switch (algoId) {
      case 'hypertrophy_linear':
        return { short: 'LV', name: 'Linear Volume', desc: 'Alternates weekly between Light (15 reps) and Heavy (6-10 reps) sessions.' };
      case 'hypertrophy_step':
        return { short: 'SL', name: 'Step Loading', desc: '4-week blocks holding reps stable while ramping intensity (RPE) weekly.' };
      case 'strength_undulating':
        return { short: 'DUP', name: 'Daily Undulating', desc: 'Alternates high-tension target profiles based on clinical powerlifting models. Exclusively applied to the designated Main Movement.' };
      case 'strength_linear':
        return { short: 'LP', name: 'Linear Periodisation', desc: 'Continuous taper reducing reps (8 down to 1) while ramping intensity. Exclusively applied to the designated Main Movement.' };
      default:
        return { short: 'SD', name: 'Self-Directed', desc: 'Manual logging mode with full self-regulation.' };
    }
  }, [activeProg]);

  const totalWeeks = React.useMemo(() => {
    if (!programId) return null;
    const programs = storage.getPrograms();
    const saved = programs.find(p => p.id === programId);
    if (saved) return saved.programDuration;
    const prebuilt = PREBUILT_TEMPLATES.find(p => p.id === programId);
    if (prebuilt) return prebuilt.programDuration;
    return null;
  }, [programId]);

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

    const activeProg = programId ? storage.getPrograms().find(p => p.id === programId) : null;
    const programDuration = activeProg && activeProg.programDuration !== '∞' ? Number(activeProg.programDuration) : 8;

    if (selectorTargetIdx === -1) {
      // Create new exercise items
      const newItems: ExerciseEntry[] = selectedList.map(item => {
        const prevSets = getPreviousSetsForExercise(item.name);
        return {
          name: item.name,
          muscleGroup: item.category,
          modality: item.modality || 'weighted',
          sets: prevSets || [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' as const }],
        };
      });

      // Update userRawExercises backup
      setUserRawExercises(prev => {
        const base = prev || [];
        return [...base, ...newItems];
      });

      // Calculate calculated new items
      const calculatedNewItems = newItems.map((ex, idx) => {
        const calculatedSets = calculateObjectiveSets({
          objective,
          exercise: ex,
          exerciseIndex: (exercises.length + idx),
          totalExercises: exercises.length + newItems.length,
          weekNum: Number(weekNum),
          programDuration,
          previousLogs: storage.getWorkoutLogs(),
          userTouchedSets,
          checkedSets,
        });
        return { ...ex, sets: calculatedSets };
      });

      const nextExs = [...exercises, ...calculatedNewItems];
      setExercises(nextExs);
      syncExercisesToActiveProgram(nextExs);
      setSelectorTargetIdx(null);
    } else if (selectorTargetIdx !== null) {
      const first = selectedList[0];
      const prevSets = getPreviousSetsForExercise(first.name);
      const replacedItem: ExerciseEntry = {
        name: first.name,
        muscleGroup: first.category,
        modality: first.modality || 'weighted',
        sets: prevSets || [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' as const }],
      };

      // Update userRawExercises backup
      setUserRawExercises(prev => {
        if (!prev) return [replacedItem];
        return prev.map((ex, idx) => idx === selectorTargetIdx ? replacedItem : ex);
      });

      // Calculate the replacement sets
      const calculatedSets = calculateObjectiveSets({
        objective,
        exercise: replacedItem,
        exerciseIndex: selectorTargetIdx,
        totalExercises: exercises.length,
        weekNum: Number(weekNum),
        programDuration,
        previousLogs: storage.getWorkoutLogs(),
        userTouchedSets,
        checkedSets,
        algorithmId: activeProg?.algorithmId,
      });
      const finalReplaced = { ...replacedItem, sets: calculatedSets };

      const nextExs = exercises.map((ex, idx) => (idx === selectorTargetIdx ? finalReplaced : ex));
      setExercises(nextExs);
      syncExercisesToActiveProgram(nextExs);
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
  const [startTime, setStartTime] = useState<string>(() => {
    try {
      const draftStr = localStorage.getItem('metreps_workout_draft');
      if (draftStr) {
        const draft = JSON.parse(draftStr);
        const matches = isOneOff
          ? draft.isOneOff === true
          : (draft.programId === programId && String(draft.weekNum) === String(weekNum) && String(draft.dayNum) === String(dayNum));
        if (matches && draft.startTime) {
          return draft.startTime;
        }
      }
    } catch (_) {}

    if (existingLog && existingLog.startTime) {
      return existingLog.startTime;
    }

    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  });

  const handleAutoCalculateDuration = () => {
    if (!startTime) return;
    try {
      const [startHours, startMinutes] = startTime.split(':').map(Number);
      const now = new Date();
      const currentHours = now.getHours();
      const currentMinutes = now.getMinutes();

      let startTotalMin = startHours * 60 + startMinutes;
      let currentTotalMin = currentHours * 60 + currentMinutes;

      if (currentTotalMin < startTotalMin) {
        currentTotalMin += 24 * 60;
      }

      const diffMin = currentTotalMin - startTotalMin;
      setDuration(Math.max(1, diffMin));
    } catch (e) {
      console.error('Error auto calculating duration:', e);
    }
  };

  const [notes, setNotes] = useState<string>('');

  // Wellness & Recovery Metrics
  const [sleep, setSleep] = useState<number>(7.5);
  const [hydration, setHydration] = useState<HydrationLevel>('Adequate');
  const [isHydrationDropdownOpen, setIsHydrationDropdownOpen] = useState<boolean>(false);
  const [calories, setCalories] = useState<number>(2500);
  const [protein, setProtein] = useState<number>(140);
  const [soreness, setSoreness] = useState<number>(3);
  const [motivation, setMotivation] = useState<number>(4);

  // Easter Egg Rest Timer states
  const [restSeconds, setRestSeconds] = useState<number>(0);
  const [isResting, setIsResting] = useState<boolean>(() => {
    const saved = localStorage.getItem('isResting');
    return saved === 'true';
  });
  const [restStartTime, setRestStartTime] = useState<number | null>(() => {
    const saved = localStorage.getItem('restStartTime');
    return saved ? Number(saved) : null;
  });

  useEffect(() => {
    if (isResting) {
      localStorage.setItem('isResting', 'true');
    } else {
      localStorage.removeItem('isResting');
    }
  }, [isResting]);

  useEffect(() => {
    if (restStartTime !== null) {
      localStorage.setItem('restStartTime', restStartTime.toString());
    } else {
      localStorage.removeItem('restStartTime');
    }
  }, [restStartTime]);

  useEffect(() => {
    let interval: any = null;
    if (isResting && restStartTime !== null) {
      // Immediately calculate the correct elapsed seconds on startup/resume
      const elapsed = Math.floor((Date.now() - restStartTime) / 1000);
      setRestSeconds(elapsed);

      interval = setInterval(() => {
        const elapsedNow = Math.floor((Date.now() - restStartTime) / 1000);
        setRestSeconds(elapsedNow);
      }, 250);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isResting, restStartTime]);

  const [alertMsg, setAlertMsg] = useState<string | null>(null);

  // Completion and Program End check states
  const [showCompletionModal, setShowCompletionModal] = useState<boolean>(false);
  const isFinalWorkout = React.useMemo(() => {
    if (isOneOff || !programId) return false;
    const activeProg = storage.getPrograms().find(p => p.id === programId) || storage.getCurrentProgram();
    if (!activeProg) return false;
    if (activeProg.programDuration === '∞') return false;
    
    const totalWeeks = Number(activeProg.programDuration);
    if (isNaN(totalWeeks)) return false;
    
    const dayIndexes = Object.keys(activeProg.exercisesByDay).map(Number).sort((a, b) => a - b);
    if (dayIndexes.length === 0) return false;
    const lastDay = dayIndexes[dayIndexes.length - 1];
    
    return String(weekNum) === String(totalWeeks) && String(dayNum) === String(lastDay);
  }, [isOneOff, programId, weekNum, dayNum]);

  // Objectives State
  const [objective, setObjective] = useState<'Off' | 'Hypertrophy' | 'Strength' | 'Deload'>('Off');
  const [isObjectiveLocked, setIsObjectiveLocked] = useState<boolean>(() => {
    return !isOneOff && Number(weekNum) >= 2;
  });
  const [showStrengthMainMovementPrompt, setShowStrengthMainMovementPrompt] = useState(false);
  const [userRawExercises, setUserRawExercises] = useState<ExerciseEntry[] | null>(null);
  const [userTouchedSets, setUserTouchedSets] = useState<Record<string, boolean>>({});

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
  const [swapMainTargetIdx, setSwapMainTargetIdx] = useState<number | null>(null);
  const [showNoMainMovementConfirm, setShowNoMainMovementConfirm] = useState(false);

  // Back button physical popstate interceptors
  const { dismiss: dismissSetAction } = useModalHistory(activeSetAction !== null, () => setActiveSetAction(null), 'set-options');
  const { dismiss: dismissExAction } = useModalHistory(activeExAction !== null, () => setActiveExAction(null), 'exercise-actions');
  const { dismiss: dismissHistory } = useModalHistory(historyExerciseName !== null, () => setHistoryExerciseName(null), 'exercise-history');
  const { dismiss: dismissCompletion } = useModalHistory(showCompletionModal, () => setShowCompletionModal(false), 'workout-completion');

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
    if (editLogId && existingLog) {
      setExercises(existingLog.exercises || []);
      setDuration(existingLog.durationMinutes || 60);
      setNotes(existingLog.notes || '');
      setSleep(existingLog.recovery?.sleepHours ?? 7.5);
      setHydration(existingLog.recovery?.hydrationLevel ?? mapLitersToHydration(existingLog.recovery?.hydrationLiters));
      setCalories(existingLog.recovery?.nutritionCalories ?? 2500);
      setProtein(existingLog.recovery?.proteinGrams ?? 140);
      setSoreness(existingLog.recovery?.soreness ?? 3);
      setMotivation(existingLog.recovery?.motivation ?? 4);
      if (existingLog.startTime) {
        setStartTime(existingLog.startTime);
      }

      // Pre-check all sets so they show as checked in edit mode
      const initialChecked: Record<string, boolean> = {};
      existingLog.exercises.forEach((ex, exIdx) => {
        ex.sets.forEach((_, sIdx) => {
          initialChecked[`${exIdx}-${sIdx}`] = true;
        });
      });
      setCheckedSets(initialChecked);
      setCollapsed({});
      setObjective(existingLog.objective || 'Off');
      setUserRawExercises(existingLog.exercises || []);
      setUserTouchedSets({});
      setIsDraftLoaded(true);
      return;
    }

    if (initialParams?.redoFromLogId) {
      try {
        const sourceLog = storage.getWorkoutLogs().find(l => l.id === initialParams.redoFromLogId);
        if (sourceLog) {
          const prefilled = sourceLog.exercises.map(ex => {
            const targetSets = ex.sets.map(s => ({
              setNumber: s.setNumber,
              weight: s.weight,
              reps: s.reps,
              rpe: s.rpe,
              form: s.form || 'standard',
              comment: s.comment,
              isDropSet: s.isDropSet,
            }));
            return {
              name: ex.name,
              muscleGroup: ex.muscleGroup,
              modality: ex.modality || 'weighted',
              isMainMovement: !!ex.isMainMovement,
              sets: targetSets,
            };
          });

          const finalPre = prefilled.map((ex, exIdx) => {
            const calculated = calculateObjectiveSets({
              objective: 'Off',
              exercise: ex,
              exerciseIndex: exIdx,
              totalExercises: prefilled.length,
              weekNum: 1,
              programDuration: 8,
              previousLogs: storage.getWorkoutLogs(),
              userTouchedSets: {},
              checkedSets: {},
            });
            return { ...ex, sets: calculated };
          });

          setExercises(finalPre);
          setDuration(sourceLog.durationMinutes || 60);
          setNotes(`Redo of workout from ${sourceLog.date}`);
          setSleep(7.5);
          setHydration('Adequate');
          setCalories(2500);
          setProtein(140);
          setSoreness(3);
          setMotivation(4);
          setCheckedSets({});
          setCollapsed({});
          setObjective('Off');
          setUserRawExercises(JSON.parse(JSON.stringify(prefilled)));
          setUserTouchedSets({});
          setIsDraftLoaded(true);
          return;
        }
      } catch (err) {
        console.error('Error handling redoFromLogId in WorkoutLogger:', err);
      }
    }

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
          const loadedHyd = draft.hydration;
          if (typeof loadedHyd === 'number') {
            setHydration(mapLitersToHydration(loadedHyd));
          } else {
            setHydration(loadedHyd ?? 'Adequate');
          }
          setCalories(draft.calories ?? 2500);
          setProtein(draft.protein ?? 140);
          setSoreness(draft.soreness ?? 3);
          setMotivation(draft.motivation ?? 4);
          setCheckedSets(draft.checkedSets || {});
          setCollapsed(draft.collapsed || {});
          setObjective(draft.objective || 'Off');
          setUserRawExercises(draft.userRawExercises || draft.exercises || []);
          setUserTouchedSets(draft.userTouchedSets || {});
          if (draft.startTime) {
            setStartTime(draft.startTime);
          }
          setHasExistingDraft(true);
          setIsDraftLoaded(true);
          return;
        }
      }
    } catch (e) {
      console.error('Failed to parse or apply workout draft:', e);
    }

    // Determine the default starting objective directly from the saved Program definition
    let defaultObjective: 'Off' | 'Hypertrophy' | 'Strength' | 'Deload' = 'Off';
    const activeProgLocal = programId
      ? (storage.getPrograms().find(p => p.id === programId) || PREBUILT_TEMPLATES.find(p => p.id === programId))
      : null;

    if (activeProgLocal) {
      defaultObjective = activeProgLocal.objective || 'Hypertrophy';
    }

    if (programId && activeProgLocal) {
      if (activeProgLocal.exercisesByDay[Number(dayNum)]) {
        // Deep clone template exercises
        const templates: ExerciseEntry[] = JSON.parse(
          JSON.stringify(activeProgLocal.exercisesByDay[Number(dayNum)])
        );
        // Pre-fill sets from the most recent logged session if available
        const prefilled = templates.map(ex => {
          const prevSets = getPreviousSetsForExercise(ex.name);
          if (prevSets) {
            return {
              ...ex,
              isMainMovement: !!ex.isMainMovement, // Restore designated main movement state
              sets: prevSets
            };
          }
          // If no previous history exists, reset sets to weight: 0, reps: 0, RPE: 0, form: 'standard'
          return {
            ...ex,
            isMainMovement: !!ex.isMainMovement, // Restore designated main movement state
            sets: ex.sets.map(s => ({
              ...s,
              weight: 0,
              reps: 0,
              rpe: 0,
              form: 'standard' as const,
              comment: '',
              isDropSet: false
            }))
          };
        });

        // Apply objective calculations if defaultObjective is not 'Off'
        const programDuration = activeProgLocal.programDuration !== '∞' ? Number(activeProgLocal.programDuration) : 8;
        const finalPre = prefilled.map((ex, exIdx) => {
          const calculated = calculateObjectiveSets({
            objective: defaultObjective,
            exercise: ex,
            exerciseIndex: exIdx,
            totalExercises: prefilled.length,
            weekNum: Number(weekNum),
            programDuration,
            previousLogs: storage.getWorkoutLogs(),
            userTouchedSets: {},
            checkedSets: {},
            algorithmId: activeProgLocal.algorithmId,
          });
          return { ...ex, sets: calculated };
        });

        setExercises(finalPre);
        setUserRawExercises(JSON.parse(JSON.stringify(prefilled)));
        setUserTouchedSets({});
        setObjective(defaultObjective);
        setIsDraftLoaded(true);
        return;
      }
    }

    // Default blank exercise if none loaded or is empty if isOneOff
    if (isOneOff) {
      setExercises([]);
      setUserRawExercises([]);
      setUserTouchedSets({});
      setObjective(defaultObjective);
    } else {
      const defaultName = 'Bench Press (Barbell, Flat)';
      const prevSets = getPreviousSetsForExercise(defaultName);
      const prefilled = [
        {
          name: defaultName,
          muscleGroup: 'Pecs',
          modality: 'weighted' as const,
          sets: prevSets || [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' as const }],
        },
      ];

      const finalPre = prefilled.map((ex, exIdx) => {
        const calculated = calculateObjectiveSets({
          objective: defaultObjective,
          exercise: ex,
          exerciseIndex: exIdx,
          totalExercises: prefilled.length,
          weekNum: Number(weekNum),
          programDuration: 8,
          previousLogs: storage.getWorkoutLogs(),
          userTouchedSets: {},
          checkedSets: {},
        });
        return { ...ex, sets: calculated };
      });

      setExercises(finalPre);
      setUserRawExercises(JSON.parse(JSON.stringify(prefilled)));
      setUserTouchedSets({});
      setObjective(defaultObjective);
    }
    setIsDraftLoaded(true);
  }, [programId, dayNum, isOneOff, weekNum, initialParams]);

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
      objective,
      userRawExercises,
      userTouchedSets,
      startTime,
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
    objective,
    userRawExercises,
    userTouchedSets,
    startTime,
  ]);

  const handleDiscardDraft = () => {
    localStorage.removeItem('metreps_workout_draft');
    setHasExistingDraft(false);
    setIsDraftLoaded(false);

    let defaultObjective: 'Off' | 'Hypertrophy' | 'Strength' | 'Deload' = 'Off';
    const activeProgLocal = programId
      ? (storage.getPrograms().find(p => p.id === programId) || PREBUILT_TEMPLATES.find(p => p.id === programId))
      : null;

    if (activeProgLocal) {
      defaultObjective = activeProgLocal.objective || 'Hypertrophy';
    }

    if (programId && activeProgLocal) {
      if (activeProgLocal.exercisesByDay[Number(dayNum)]) {
        const templates: ExerciseEntry[] = JSON.parse(
          JSON.stringify(activeProgLocal.exercisesByDay[Number(dayNum)])
        );
        const prefilled = templates.map(ex => {
          const prevSets = getPreviousSetsForExercise(ex.name);
          if (prevSets) {
            return {
              ...ex,
              isMainMovement: !!ex.isMainMovement, // Restore designated main movement state
              sets: prevSets
            };
          }
          return {
            ...ex,
            isMainMovement: !!ex.isMainMovement, // Restore designated main movement state
            sets: ex.sets.map(s => ({
              ...s,
              weight: 0,
              reps: 0,
              rpe: 0,
              form: 'standard' as const,
              comment: '',
              isDropSet: false
            }))
          };
        });

        // Apply objective calculations if defaultObjective is not 'Off'
        const programDuration = activeProgLocal.programDuration !== '∞' ? Number(activeProgLocal.programDuration) : 8;
        const finalPre = prefilled.map((ex, exIdx) => {
          const calculated = calculateObjectiveSets({
            objective: defaultObjective,
            exercise: ex,
            exerciseIndex: exIdx,
            totalExercises: prefilled.length,
            weekNum: Number(weekNum),
            programDuration,
            previousLogs: storage.getWorkoutLogs(),
            userTouchedSets: {},
            checkedSets: {},
            algorithmId: activeProgLocal.algorithmId,
          });
          return { ...ex, sets: calculated };
        });

        setExercises(finalPre);
        setUserRawExercises(JSON.parse(JSON.stringify(prefilled)));
        setUserTouchedSets({});
        setObjective(defaultObjective);
      } else {
        setExercises([]);
        setUserRawExercises([]);
        setUserTouchedSets({});
        setObjective(defaultObjective);
      }
    } else if (isOneOff) {
      setExercises([]);
      setUserRawExercises([]);
      setUserTouchedSets({});
      setObjective(defaultObjective);
    } else {
      const defaultName = 'Bench Press (Barbell, Flat)';
      const prevSets = getPreviousSetsForExercise(defaultName);
      const prefilled = [
        {
          name: defaultName,
          muscleGroup: 'Pecs',
          modality: 'weighted' as const,
          sets: prevSets || [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' as const }],
        },
      ];

      const finalPre = prefilled.map((ex, exIdx) => {
        const calculated = calculateObjectiveSets({
          objective: defaultObjective,
          exercise: ex,
          exerciseIndex: exIdx,
          totalExercises: prefilled.length,
          weekNum: Number(weekNum),
          programDuration: 8,
          previousLogs: storage.getWorkoutLogs(),
          userTouchedSets: {},
          checkedSets: {},
        });
        return { ...ex, sets: calculated };
      });

      setExercises(finalPre);
      setUserRawExercises(JSON.parse(JSON.stringify(prefilled)));
      setUserTouchedSets({});
      setObjective(defaultObjective);
    }

    setDuration(60);
    setNotes('');
    setSleep(7.5);
    setHydration('Adequate');
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

  const applyObjectiveCalculationsToExercises = (
    list: ExerciseEntry[],
    activeObj: 'Off' | 'Hypertrophy' | 'Strength' | 'Deload',
    customTouched?: Record<string, boolean>
  ): ExerciseEntry[] => {
    const activeProg = programId ? storage.getPrograms().find(p => p.id === programId) : null;
    const programDuration = activeProg && activeProg.programDuration !== '∞' ? Number(activeProg.programDuration) : 8;
    const touched = customTouched || userTouchedSets;

    return list.map((ex, exIdx) => {
      if (activeObj === 'Off') {
        return ex;
      }

      const calculated = calculateObjectiveSets({
        objective: activeObj,
        exercise: ex,
        exerciseIndex: exIdx,
        totalExercises: list.length,
        weekNum: Number(weekNum),
        programDuration,
        previousLogs: storage.getWorkoutLogs(),
        userTouchedSets: touched,
        checkedSets,
        algorithmId: activeProg?.algorithmId,
      });

      return { ...ex, sets: calculated };
    });
  };

  const handleChangeObjective = (newObjective: 'Off' | 'Hypertrophy' | 'Strength' | 'Deload') => {
    if (newObjective === objective) return;

    // Apply the objective immediately
    setObjective(newObjective);
    setExercises(prev => {
      return applyObjectiveCalculationsToExercises(prev, newObjective);
    });

    // Show a prompt if switching to Strength with no main movement selected
    if (newObjective === 'Strength') {
      const hasMainMovement = exercises.some(ex => !!ex.isMainMovement);
      if (!hasMainMovement) {
        setShowStrengthMainMovementPrompt(true);
      }
    }
  };

  const toggleMainMovement = (targetIdx: number) => {
    if (!isOneOff && Number(weekNum) > 1) {
      setAlertMsg("The Main Movement is locked after Week 1 to prevent disrupting your periodised loading progression and weight recommendations.");
      return;
    }
    const targetEx = exercises[targetIdx];
    const isCurrentlyMain = !!targetEx.isMainMovement;

    if (isCurrentlyMain) {
      setExercises(prev => {
        const baseUpdated = prev.map((ex, idx) => {
          if (idx === targetIdx) {
            return { ...ex, isMainMovement: false };
          }
          return ex;
        });

        const updated = applyObjectiveCalculationsToExercises(baseUpdated, objective);
        return updated;
      });
    } else {
      const currentMainIdx = exercises.findIndex(ex => !!ex.isMainMovement);
      if (currentMainIdx !== -1) {
        setSwapMainTargetIdx(targetIdx);
      } else {
        setExercises(prev => {
          const baseUpdated = prev.map((ex, idx) => {
            return { ...ex, isMainMovement: idx === targetIdx };
          });

          const updated = applyObjectiveCalculationsToExercises(baseUpdated, objective);
          return updated;
        });
      }
    }
  };

  const handleConfirmSwapMainMovement = () => {
    if (swapMainTargetIdx === null) return;
    const targetEx = exercises[swapMainTargetIdx];

    setExercises(prev => {
      const baseUpdated = prev.map((ex, idx) => {
        return { ...ex, isMainMovement: idx === swapMainTargetIdx };
      });

      const updated = applyObjectiveCalculationsToExercises(baseUpdated, objective);
      return updated;
    });

    setSwapMainTargetIdx(null);
  };

  const syncExercisesToActiveProgram = (currentExercises: ExerciseEntry[]) => {
    if (!programId) return;
    try {
      const activeProg = storage.getPrograms().find(p => p.id === programId);
      if (activeProg && activeProg.exercisesByDay[Number(dayNum)]) {
        const templatesToSave: ExerciseEntry[] = currentExercises.map(ex => ({
          name: ex.name,
          muscleGroup: ex.muscleGroup,
          modality: ex.modality || 'weighted',
          isSuperset: !!ex.isSuperset,
          isMainMovement: !!ex.isMainMovement, // Persist designated main movement state to the program template
          sets: ex.sets.map(s => ({
            setNumber: s.setNumber,
            weight: 0,
            reps: 0,
            rpe: s.rpe || 8,
            form: s.form || 'standard',
            comment: s.comment || null,
            isDropSet: !!s.isDropSet,
          })),
        }));

        activeProg.exercisesByDay[Number(dayNum)] = templatesToSave;
        storage.saveProgram(activeProg);
      }
    } catch (e) {
      console.error('Failed to sync exercises to active program:', e);
    }
  };

  const handleAddExercise = () => {
    const newItem: ExerciseEntry = {
      name: 'New Exercise',
      muscleGroup: 'Chest',
      modality: 'weighted',
      sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 8, form: 'standard' as const }],
    };

    setUserRawExercises(prev => {
      const base = prev || [];
      return [...base, newItem];
    });

    const activeProg = programId ? storage.getPrograms().find(p => p.id === programId) : null;
    const programDuration = activeProg && activeProg.programDuration !== '∞' ? Number(activeProg.programDuration) : 8;

    const calculatedSets = calculateObjectiveSets({
      objective,
      exercise: newItem,
      exerciseIndex: exercises.length,
      totalExercises: exercises.length + 1,
      weekNum: Number(weekNum),
      programDuration,
      previousLogs: storage.getWorkoutLogs(),
      userTouchedSets,
      checkedSets,
    });
    const finalNew = { ...newItem, sets: calculatedSets };

    setExercises(prev => {
      const nextExs = [...prev, finalNew];
      syncExercisesToActiveProgram(nextExs);
      return nextExs;
    });
  };

  const handleDeleteExercise = (idx: number) => {
    setUserRawExercises(prev => {
      if (!prev) return null;
      return prev.filter((_, i) => i !== idx);
    });
    setExercises(prev => {
      const nextExs = prev.filter((_, i) => i !== idx);
      syncExercisesToActiveProgram(nextExs);
      return nextExs;
    });
  };

  const handleToggleDropSet = (exIdx: number, setIdx: number) => {
    setExercises(prev =>
      prev.map((ex, i) => {
        if (i === exIdx) {
          const sets = ex.sets.map((s, sIdx) =>
            sIdx === setIdx ? { ...s, isDropSet: !s.isDropSet, isWarmup: false } : s
          );
          return { ...ex, sets };
        }
        return ex;
      })
    );
  };

  const handleToggleWarmup = (exIdx: number, setIdx: number) => {
    setExercises(prev =>
      prev.map((ex, i) => {
        if (i === exIdx) {
          const sets = ex.sets.map((s, sIdx) =>
            sIdx === setIdx ? { ...s, isWarmup: !s.isWarmup, isDropSet: false } : s
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
    setUserRawExercises(prev => {
      if (!prev) return null;
      return prev.map((ex, i) => {
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
      });
    });

    setExercises(prev => {
      const nextExs = prev.map((ex, i) => {
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
      });
      syncExercisesToActiveProgram(nextExs);
      return nextExs;
    });
  };

  const handleMoveExercise = (exIdx: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? exIdx - 1 : exIdx + 1;
    if (targetIdx < 0 || targetIdx >= exercises.length) return;

    // 1. Swap in exercises state
    setExercises(prev => {
      const copy = [...prev];
      const temp = copy[exIdx];
      copy[exIdx] = copy[targetIdx];
      copy[targetIdx] = temp;
      return copy;
    });

    // 2. Swap in userRawExercises state if present
    setUserRawExercises(prev => {
      if (!prev) return null;
      const copy = [...prev];
      if (exIdx >= copy.length || targetIdx >= copy.length) return prev;
      const temp = copy[exIdx];
      copy[exIdx] = copy[targetIdx];
      copy[targetIdx] = temp;
      return copy;
    });

    // 3. Swap in collapsed state
    setCollapsed(prev => {
      const copy = { ...prev };
      const val1 = copy[exIdx];
      const val2 = copy[targetIdx];
      if (val1 !== undefined) copy[targetIdx] = val1;
      else delete copy[targetIdx];
      if (val2 !== undefined) copy[exIdx] = val2;
      else delete copy[exIdx];
      return copy;
    });

    // 4. Remap checkedSets and userTouchedSets keys because the exercise index changed
    const remapKeys = (prevRecord: Record<string, any>) => {
      const nextRecord: Record<string, any> = {};
      Object.entries(prevRecord).forEach(([key, val]) => {
        const parts = key.split('-');
        if (parts.length === 2) {
          const keyExIdx = parseInt(parts[0], 10);
          const setIdx = parts[1];
          if (keyExIdx === exIdx) {
            nextRecord[`${targetIdx}-${setIdx}`] = val;
          } else if (keyExIdx === targetIdx) {
            nextRecord[`${exIdx}-${setIdx}`] = val;
          } else {
            nextRecord[key] = val;
          }
        } else {
          nextRecord[key] = val;
        }
      });
      return nextRecord;
    };
    setCheckedSets(prev => remapKeys(prev));
    setUserTouchedSets(prev => remapKeys(prev));

    // 5. Persist to active program (exercisesByDay) if inside a program workout
    if (programId) {
      try {
        const activeProg = storage.getPrograms().find(p => p.id === programId);
        if (activeProg && activeProg.exercisesByDay[Number(dayNum)]) {
          const progExercises = [...activeProg.exercisesByDay[Number(dayNum)]];
          if (exIdx < progExercises.length && targetIdx < progExercises.length) {
            const temp = progExercises[exIdx];
            progExercises[exIdx] = progExercises[targetIdx];
            progExercises[targetIdx] = temp;
            activeProg.exercisesByDay[Number(dayNum)] = progExercises;
            storage.saveProgram(activeProg);
          }
        }
      } catch (e) {
        console.error('Failed to update exercise order in program:', e);
      }
    }
  };

  const handleToggleSuperset = (exIdx: number) => {
    setExercises(prev => {
      const nextExs = prev.map((ex, i) => (i === exIdx ? { ...ex, isSuperset: !ex.isSuperset } : ex));
      syncExercisesToActiveProgram(nextExs);
      return nextExs;
    });
  };

  const handleUpdateExerciseName = (idx: number, name: string) => {
    setUserRawExercises(prev => {
      if (!prev) return null;
      return prev.map((ex, i) => (i === idx ? { ...ex, name } : ex));
    });
    setExercises(prev => {
      const nextExs = prev.map((ex, i) => (i === idx ? { ...ex, name } : ex));
      syncExercisesToActiveProgram(nextExs);
      return nextExs;
    });
  };

  const handleUpdateMuscleGroup = (idx: number, muscleGroup: string) => {
    setUserRawExercises(prev => {
      if (!prev) return null;
      return prev.map((ex, i) => (i === idx ? { ...ex, muscleGroup } : ex));
    });
    setExercises(prev => {
      const nextExs = prev.map((ex, i) => (i === idx ? { ...ex, muscleGroup } : ex));
      syncExercisesToActiveProgram(nextExs);
      return nextExs;
    });
  };

  const handleAddSet = (exIdx: number) => {
    const nextSetNum = (exercises[exIdx]?.sets?.length || 0) + 1;
    const lastSet = exercises[exIdx]?.sets[exercises[exIdx].sets.length - 1] || { weight: 0, reps: 0, rpe: 8, form: 'standard' as const };
    const rawSetEntry = {
      setNumber: nextSetNum,
      weight: lastSet.weight,
      reps: lastSet.reps,
      rpe: lastSet.rpe,
      form: lastSet.form,
    };

    setUserRawExercises(prev => {
      if (!prev) return null;
      return prev.map((ex, i) => {
        if (i === exIdx) {
          return { ...ex, sets: [...ex.sets, { ...rawSetEntry }] };
        }
        return ex;
      });
    });

    setExercises(prev => {
      const nextExs = prev.map((ex, i) => {
        if (i === exIdx) {
          return {
            ...ex,
            sets: [
              ...ex.sets,
              { ...rawSetEntry },
            ],
          };
        }
        return ex;
      });
      syncExercisesToActiveProgram(nextExs);
      return nextExs;
    });
  };

  const handleDeleteSet = (exIdx: number, setIdx: number) => {
    setUserRawExercises(prev => {
      if (!prev) return null;
      return prev.map((ex, i) => {
        if (i === exIdx) {
          const filtered = ex.sets.filter((_, sIdx) => sIdx !== setIdx);
          const reindexed = filtered.map((s, sIdx) => ({ ...s, setNumber: sIdx + 1 }));
          return { ...ex, sets: reindexed };
        }
        return ex;
      });
    });

    setExercises(prev => {
      const nextExs = prev.map((ex, i) => {
        if (i === exIdx) {
          const filteredSets = ex.sets.filter((_, sIdx) => sIdx !== setIdx);
          const reindexed = filteredSets.map((s, sIdx) => ({
            ...s,
            setNumber: sIdx + 1,
          }));
          return { ...ex, sets: reindexed };
        }
        return ex;
      });
      syncExercisesToActiveProgram(nextExs);
      return nextExs;
    });
  };

  const handleUpdateSet = <K extends keyof SetEntry>(
    exIdx: number,
    setIdx: number,
    key: K,
    val: SetEntry[K]
  ) => {
    if (key === 'weight' || key === 'reps' || key === 'rpe' || key === 'form') {
      const setKey = `${exIdx}-${setIdx}`;
      setUserTouchedSets(prev => ({ ...prev, [setKey]: true }));
    }

    let finalVal = val;
    if ((key === 'weight' || key === 'reps') && typeof val === 'number' && val < 0) {
      finalVal = 0 as SetEntry[K];
    }

    setExercises(prev =>
      prev.map((ex, i) => {
        if (i === exIdx) {
          const updatedSets = ex.sets.map((s, sIdx) =>
            sIdx === setIdx ? { ...s, [key]: finalVal } : s
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
    const history: Array<{
      logId?: string;
      objective?: string;
      date: string;
      week?: number | string;
      day?: number | string;
      setNumber: number;
      weight: number;
      reps: number;
      rpe?: number;
      form?: string;
      modality?: string;
      isWarmup?: boolean;
      isDropSet?: boolean;
    }> = [];
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
              logId: log.id,
              objective: log.objective,
              date: log.date,
              week: log.week,
              day: log.day,
              setNumber: s.setNumber,
              weight: actualWeight,
              reps: s.reps ?? 0,
              rpe: s.rpe ?? undefined,
              form: s.form ?? undefined,
              modality: match.modality,
              isWarmup: !!s.isWarmup,
              isDropSet: !!s.isDropSet
            });
          }
        }
      }
    }
    return history.slice(0, 50);
  };

  const executeSaveSession = () => {
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
      id: editLogId || `log-${Date.now()}`,
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
      objective: objective,
      startTime: startTime,
      recovery: {
        sleepHours: sleep,
        hydrationLiters: mapHydrationToLiters(hydration),
        hydrationLevel: hydration,
        nutritionCalories: calories,
        proteinGrams: protein,
        soreness: soreness,
        motivation: motivation,
      },
    };

    storage.saveWorkoutLog(newLog);
    localStorage.removeItem('metreps_workout_draft');
    if (isFinalWorkout) {
      setShowCompletionModal(true);
    } else {
      onSave();
    }
  };

  const handleSaveSession = () => {
    if (exercises.length === 0) {
      setAlertMsg('Please add at least one exercise before saving!');
      return;
    }

    const hasMainMovement = exercises.some(ex => !!ex.isMainMovement);
    if (objective === 'Strength' && !hasMainMovement) {
      setShowNoMainMovementConfirm(true);
      return;
    }

    executeSaveSession();
  };

  // Render Easter Egg Rest Timer depending on theme
  const renderRestTimer = () => {
    const minutes = Math.floor(restSeconds / 60);
    const seconds = restSeconds % 60;
    const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    const handleTimerClick = () => {
      if (isResting) {
        setIsResting(false);
        setRestSeconds(0);
        setRestStartTime(null);
      } else {
        const now = Date.now();
        setRestStartTime(now);
        setRestSeconds(0);
        setIsResting(true);
      }
    };

    const segmentDuration = objective === 'Strength' ? 60 : 30;
    const numFilled = Math.min(4, Math.floor(restSeconds / segmentDuration));
    const emptyChar = '▱';
    const filledChar = '▰';
    const segmentsStr = filledChar.repeat(numFilled) + emptyChar.repeat(4 - numFilled);

    if (themeId === 'slate') {
      // Subnautic (Blue Slate) -> O2 Gauge
      return (
        <div 
          onClick={handleTimerClick}
          className={`w-full bg-slate-950 border border-slate-850 hover:border-cyan-500/45 px-3 flex items-center justify-center gap-3 select-none cursor-pointer group transition-all duration-300 h-10 ${
            isResting ? 'ring-1 ring-cyan-500/20 border-cyan-500/40 shadow-[0_0_12px_rgba(6,182,212,0.15)] bg-slate-950/90' : ''
          }`}
          title="Click to toggle O₂ Supply Rest Timer"
        >
          <span className="text-[11.5px] text-cyan-500 font-mono tracking-wider">
            {segmentsStr}
          </span>
          <span className={`text-[14px] font-black font-mono tracking-wider transition-colors ${isResting ? 'text-cyan-400 animate-pulse' : 'text-slate-400'}`}>
            {timeStr}
          </span>
        </div>
      );
    } else if (themeId === 'onyx') {
      // Feralas (Forest Green) -> ATB Stamina Gauge
      return (
        <div 
          onClick={handleTimerClick}
          className={`w-full bg-slate-950 border border-slate-850 hover:border-emerald-500/45 px-3 flex items-center justify-center gap-3 select-none cursor-pointer group transition-all duration-300 h-10 ${
            isResting ? 'ring-1 ring-emerald-500/20 border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.15)] bg-slate-950/90' : ''
          }`}
          title="Click to toggle ATB Rest Timer"
        >
          <span className="text-[11.5px] text-emerald-500 font-mono tracking-wider">
            {segmentsStr}
          </span>
          <span className={`text-[14px] font-black font-mono tracking-wider transition-colors ${isResting ? 'text-emerald-400' : 'text-slate-400'}`}>
            {timeStr}
          </span>
        </div>
      );
    } else {
      // Amber (Crimson Desert) -> Bonfire Estus Rest
      return (
        <div 
          onClick={handleTimerClick}
          className={`w-full bg-amber-50/50 border border-amber-600/20 hover:border-amber-600/45 px-3 flex items-center justify-center gap-3 select-none cursor-pointer group transition-all duration-300 h-10 ${
            isResting ? 'ring-1 ring-amber-500/20 border-amber-600/40 shadow-[0_0_12px_rgba(180,109,62,0.15)] bg-amber-100/50' : ''
          }`}
          title="Click to toggle Campfire Rest Timer"
        >
          <span className="text-[11.5px] text-amber-600 font-mono tracking-wider">
            {segmentsStr}
          </span>
          <span className={`text-[14px] font-black font-mono tracking-wider transition-colors ${isResting ? 'text-amber-800 animate-pulse' : 'text-amber-700/70'}`}>
            {timeStr}
          </span>
        </div>
      );
    }
  };

  return (
    <div className="pb-20">
      {/* Combined Header, General Settings, and Objective Panel */}
      <div className="w-full bg-slate-900 border-b border-slate-850 rounded-none divide-y divide-slate-800/60 mb-8">
        {/* Header Row */}
        <div className="flex items-center justify-between p-4">
          <div className="flex items-start gap-2.5 min-w-0">
            <button
              onClick={onClose}
              className="p-2 bg-slate-950 hover:bg-slate-900 rounded-none text-slate-400 hover:text-white border border-slate-800 transition shrink-0 mt-0.5"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <h2 className="font-black text-xl sm:text-[25px] leading-tight text-white uppercase tracking-tight truncate" title={isOneOff ? 'One-Off Workout' : programName}>
                {isOneOff ? 'One-Off Workout' : programName}
              </h2>
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

        {/* Row 1: Program Stage & Date */}
        <div className="grid grid-cols-2 gap-4 p-4">
          <div>
            <label className="block text-[12.5px] font-black text-slate-400 uppercase tracking-wider mb-1 font-mono">
              Program Stage
            </label>
            <div className="relative flex items-center justify-center bg-slate-950 rounded-none border border-slate-850 px-3 h-10 select-none">
              <span className="text-[13px] font-black text-slate-300 uppercase font-mono tracking-wider">
                {isOneOff ? (
                  'ONE-OFF'
                ) : (
                  `WEEK ${weekNum} / ${totalWeeks || '8'}`
                )}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-[12.5px] font-black text-slate-400 uppercase tracking-wider mb-1 font-mono">
              Start Time
            </label>
            <input
              type="time"
              value={startTime}
              onChange={e => setStartTime(e.target.value)}
              className="w-full bg-slate-950 text-slate-300 rounded-none border border-slate-850 px-2 h-10 text-center text-[13px] font-black font-mono focus:outline-none focus:border-indigo-500/85 cursor-pointer"
              style={{ textAlign: 'center' }}
            />
          </div>
        </div>

        {/* Row 2: Workout Objective */}
        <div className="p-4 bg-slate-950/20">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11.5px] font-black text-slate-400 uppercase tracking-widest mb-1.5 font-mono">
                Program Objective
              </label>
              <div className="bg-slate-950 border border-slate-850 px-3.5 h-10 flex items-center justify-between text-xs font-black text-white uppercase tracking-wider select-none">
                <span>{objective}</span>
                <span className="text-[9px] font-mono font-extrabold text-slate-500 uppercase tracking-wider">
                  {objective === 'Off' ? 'Manual' : 'Active'}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-[11.5px] font-black text-slate-400 uppercase tracking-widest mb-1.5 font-mono">
                Progression Engine
              </label>
              <div className="bg-slate-950 border border-slate-850 px-3.5 h-10 flex items-center gap-2 select-none">
                <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-[9.5px] font-mono font-black bg-indigo-950 text-indigo-400 border border-indigo-500/25 uppercase tracking-widest leading-none">
                  {algoDetails.short}
                </span>
                <span className="text-[11px] font-extrabold text-slate-300 uppercase tracking-wide truncate">
                  {algoDetails.name}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-3 bg-slate-950/45 border border-slate-850/50 p-3">
            <p className="text-xs text-slate-400 leading-normal font-sans">
              <span className="font-mono text-[9px] font-black text-indigo-400 uppercase tracking-widest block mb-1">
                Periodisation algorithm
              </span>
              {objective === 'Off' && "Manual Mode: You have full control over all weights, rep ranges, and target metrics."}
              {objective === 'Strength' && `Strength focus [${algoDetails.short}]: ${algoDetails.desc}`}
              {objective === 'Hypertrophy' && `Hypertrophy focus [${algoDetails.short}]: ${algoDetails.desc}`}
              {objective === 'Deload' && "Deload focus: Automatically reduces loads to 50% of peak capacity and targets strict control to promote total physical recovery."}
            </p>
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
                <div className="flex flex-col gap-1 pt-10 pb-3.5 px-4 bg-slate-950/30 border-b border-slate-850/60 relative">
                  <div className="absolute top-1.5 right-1.5 flex items-center gap-2 z-10">
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
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex flex-col gap-1 min-w-0">
                    <h4 className="font-black text-sm sm:text-base text-indigo-300 uppercase tracking-wide break-words">
                      {ex.name}
                    </h4>
                    {!isOneOff && Number(weekNum) > 1 ? (
                      <div className="flex items-center gap-1.5 py-0.5 select-none" title="Main Movement designation is locked after Week 1">
                        {ex.isMainMovement ? (
                          <>
                            <Lock className="w-3 h-3 text-indigo-400" />
                            <span className="text-[9px] font-mono tracking-widest uppercase font-black text-indigo-400">
                              Locked Main Movement
                            </span>
                          </>
                        ) : (
                          <span className="text-[9px] font-mono tracking-widest uppercase font-black text-slate-600">
                            Accessory Movement
                          </span>
                        )}
                      </div>
                    ) : (
                      <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={!!ex.isMainMovement}
                          onChange={() => toggleMainMovement(exIdx)}
                          className="w-3.5 h-3.5 rounded-none border-2 border-slate-700 bg-slate-950 text-indigo-500 focus:ring-0 focus:ring-offset-0 transition cursor-pointer accent-indigo-600"
                        />
                        <span className={`text-[10px] font-mono tracking-widest uppercase font-extrabold transition-colors duration-150 ${
                          ex.isMainMovement ? 'text-indigo-400' : 'text-slate-500 hover:text-slate-400'
                        }`}>
                          Main Movement
                        </span>
                      </label>
                    )}
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
                                {set.isWarmup && (
                                  <span className="text-amber-500 font-black text-xs" title="Warmup Set">⌇⌇⌇</span>
                                )}
                              </div>
                            </div>

                            {/* Weight Input */}
                            <div>
                              {ex.modality === 'bodyweight' ? (
                                <input
                                  type="number"
                                  min="0"
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
                                  min="0"
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
                                  min="0"
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
                                  <div className="absolute left-1/2 -translate-x-1/2 bottom-11 bg-slate-950 border border-slate-800 rounded-none shadow-2xl z-50 overflow-hidden py-1 min-w-[75px] max-w-[85px]">
                                    {(() => {
                                      const currentRpe = set.rpe ?? 8;
                                      const isHalf = currentRpe % 1 !== 0;
                                      return (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const nextRpe = isHalf 
                                              ? Math.floor(currentRpe) 
                                              : Math.min(9.5, currentRpe + 0.5);
                                            handleUpdateSet(exIdx, setIdx, 'rpe', nextRpe);
                                          }}
                                          className={`w-full text-center py-1.5 text-[9px] font-black tracking-wider uppercase border-b border-slate-850 cursor-pointer transition flex items-center justify-center gap-1 ${
                                            isHalf 
                                              ? 'bg-amber-500/20 text-amber-400 font-bold' 
                                              : 'text-slate-500 hover:text-slate-300'
                                          }`}
                                        >
                                          {isHalf && <span className="w-1 h-1 rounded-full bg-amber-500 animate-pulse" />}
                                          +0.5 RPE
                                        </button>
                                      );
                                    })()}
                                    {[5, 6, 7, 8, 9, 10].map(val => {
                                      const currentRpe = set.rpe ?? 8;
                                      const isHalf = currentRpe % 1 !== 0;
                                      const targetVal = isHalf && val !== 10 ? val + 0.5 : val;
                                      const isSelected = currentRpe === targetVal;
                                      return (
                                        <button
                                          key={val}
                                          type="button"
                                          onClick={() => {
                                            handleUpdateSet(exIdx, setIdx, 'rpe', targetVal);
                                            setActiveSelector(null);
                                          }}
                                          className={`w-full text-center py-2 text-sm font-mono font-black border-y border-transparent cursor-pointer transition ${
                                            isSelected
                                              ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30 font-extrabold'
                                              : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                                          }`}
                                        >
                                          {targetVal}
                                        </button>
                                      );
                                    })}
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
                                <MoreVertical className="w-4 h-4" />
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

                    <div className="px-2 py-1.5 bg-slate-950/25 border-b border-slate-850">
                      <button
                        type="button"
                        onClick={() => handleAddSet(exIdx)}
                        className="w-full bg-slate-950/15 hover:bg-slate-950/35 border border-dashed border-slate-800 hover:border-slate-700 rounded-none h-10 px-3.5 flex items-center gap-2 text-xs transition cursor-pointer group"
                      >
                        <Plus className="w-3.5 h-3.5 text-indigo-400 group-hover:scale-110 transition-transform shrink-0" />
                        <span className="text-[13px] text-slate-400 group-hover:text-slate-300 font-sans font-medium">
                          Add set {ex.sets.length + 1}
                        </span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Superset visual connector */}
              {ex.isSuperset && exIdx < exercises.length - 1 && (
                <div className="flex flex-col items-center z-10 relative -mb-9">
                  <div className="w-0.5 bg-indigo-500/40 h-4 border-l border-dashed border-indigo-400/50" />
                  <div className="bg-indigo-950/90 border border-indigo-500/50 text-[11px] text-indigo-400 font-extrabold px-4 py-2.5 rounded-none uppercase tracking-widest font-sans flex items-center gap-2 shadow-lg shadow-black/80">
                    <Link className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    <span>SUPERSETTED</span>
                    <Link className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  </div>
                  <div className="w-0.5 bg-indigo-500/40 h-6 border-l border-dashed border-indigo-500/50" />
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

      {/* Daily Recovery & Wellness Slider Section with mt-6 for spacing */}
      <div className="w-full bg-slate-900 border-y border-x-0 border-slate-800 p-4 space-y-4 rounded-none mt-6">
        <h3 className="font-extrabold text-xs text-slate-400 uppercase tracking-wider border-b border-slate-850 pb-2 block">
          Key Metrics
        </h3>

        {/* Workout Duration and Easter Egg Game Rest Timer row */}
        <div className="grid grid-cols-2 gap-3 w-full items-end">
          <div className="space-y-1.5 w-full">
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Workout Duration
            </label>
            <div className="bg-slate-950 rounded-none border border-slate-850 flex items-center justify-between h-10 overflow-hidden">
              <input
                type="number"
                value={duration}
                onChange={e => setDuration(Math.max(1, Number(e.target.value)))}
                className="bg-transparent font-black text-sm text-white flex-1 w-0 min-w-0 focus:outline-none font-mono text-center pl-3"
              />
              <span className="text-[9px] text-slate-500 font-black shrink-0 pr-2">MIN</span>
              <button
                type="button"
                onClick={handleAutoCalculateDuration}
                className={`bg-indigo-600 hover:bg-indigo-500 ${themeId === 'amber' ? 'text-[#FBFAF8]' : 'text-white'} text-[10px] font-black uppercase tracking-widest h-full px-3.5 transition cursor-pointer border-l border-slate-850 shrink-0 flex items-center gap-1 group`}
                title="Calculate duration from start time to now"
              >
                <Clock className={`w-3 h-3 ${themeId === 'amber' ? 'text-[#FBFAF8]/80' : 'text-white/80'} group-hover:scale-110 transition-transform`} />
                <span>Calc</span>
              </button>
            </div>
          </div>

          <div className="space-y-1.5 w-full">
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Rest timer (Tap)
            </label>
            {renderRestTimer()}
          </div>
        </div>

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
            <div className="relative w-full">
              <button
                type="button"
                onClick={() => setIsHydrationDropdownOpen(!isHydrationDropdownOpen)}
                className="w-full bg-slate-950 font-black text-xs text-white px-3 py-2 rounded-none border border-slate-850 focus:outline-none font-sans uppercase h-10 cursor-pointer hover:bg-slate-900 transition flex items-center justify-between relative"
              >
                <span className="text-center w-full">{hydration}</span>
                <span className="text-[8px] text-slate-500 shrink-0 select-none absolute right-3">▼</span>
              </button>
              {isHydrationDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsHydrationDropdownOpen(false)} />
                  <div className="absolute left-0 right-0 top-11 bg-slate-950 border border-slate-800 rounded-none shadow-2xl z-50 overflow-hidden py-1 font-sans">
                    {(['Dehydrated', 'Under-hydrated', 'Adequate', 'Optimal'] as HydrationLevel[]).map(level => {
                      const isSelected = hydration === level;
                      return (
                        <button
                          key={level}
                          type="button"
                          onClick={() => {
                            setHydration(level);
                            setIsHydrationDropdownOpen(false);
                          }}
                          className={`w-full text-center py-2.5 text-xs font-bold border-y border-transparent cursor-pointer transition uppercase font-sans ${
                            isSelected
                              ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30'
                              : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                          }`}
                        >
                          {level}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
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
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <span className="text-[14.5px] font-extrabold uppercase tracking-wider text-slate-300">Muscle Soreness (1-10)</span>
              <span className="text-indigo-400 font-mono font-black text-[16px]">{soreness}/10</span>
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
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <span className="text-[14.5px] font-extrabold uppercase tracking-wider text-slate-300">Workout Quality (1-10)</span>
              <span className="text-cyan-400 font-mono font-black text-[16px]">{motivation}/10</span>
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

      {/* Main Movement Prompt Bubble (Week 1 of Strength) */}
      {!isOneOff && Number(weekNum) === 1 && objective === 'Strength' && !exercises.some(ex => !!ex.isMainMovement) && (
        <div className="mx-4 mb-3 p-3 bg-slate-950 border border-indigo-500/30 rounded-none relative">
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-slate-950 border-r border-b border-indigo-500/30 rotate-45"></div>
          <p className="text-xs font-black text-indigo-300 uppercase tracking-widest mb-1 flex items-center gap-1.5 font-mono">
            <Info className="w-4 h-4 text-cyan-400" />
            Select Your Main Lift
          </p>
          <p className="text-[11px] text-slate-400 leading-normal font-sans">
            Please designate a <strong className="text-indigo-400 font-extrabold uppercase font-mono">Main Movement</strong> by checking the box next to your primary lift (e.g., Squat, Bench Press) before saving. This locks in your strength periodisation for Week 2 and beyond!
          </p>
        </div>
      )}

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
        confirmLabel={selectorTargetIdx !== null && selectorTargetIdx >= 0 ? 'Replace Exercise' : 'Add to Workout'}
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

      <ConfirmationModal
        visible={swapMainTargetIdx !== null}
        title={`Swap main movement to: ${swapMainTargetIdx !== null && exercises[swapMainTargetIdx] ? exercises[swapMainTargetIdx].name : ''}?`}
        message="This will impact target calculations for this exercise in line with your program objective"
        confirmLabel="Swap"
        cancelLabel="Cancel"
        confirmVariant="primary"
        onConfirm={handleConfirmSwapMainMovement}
        onCancel={() => setSwapMainTargetIdx(null)}
      />

      <ConfirmationModal
        visible={showStrengthMainMovementPrompt}
        title="Designate a Main Movement"
        message="You have selected the Strength objective. Please select a 'Main Movement' by checking the box next to any of your exercises to calculate custom target weights, reps, and RPE for that movement."
        confirmLabel="Select Main Movement"
        cancelLabel="Dismiss"
        confirmVariant="primary"
        onConfirm={() => setShowStrengthMainMovementPrompt(false)}
        onCancel={() => setShowStrengthMainMovementPrompt(false)}
      />

      <ConfirmationModal
        visible={showNoMainMovementConfirm}
        title="No Main Movement Selected"
        message="You have selected the Strength objective but have not designated a Main Movement. Setting a Main Movement calculates custom periodised rep counts, target RPE levels, and estimated 1RM targets specifically for that movement."
        confirmLabel="Save Anyway"
        cancelLabel="Select One Now"
        confirmVariant="primary"
        onConfirm={() => {
          setShowNoMainMovementConfirm(false);
          executeSaveSession();
        }}
        onCancel={() => {
          setShowNoMainMovementConfirm(false);
        }}
      />

      {/* Exercise Options Modal */}
      {activeExAction !== null && (() => {
        const ex = exercises[activeExAction];
        if (!ex) return null;
        return (
          <div 
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in"
            onClick={dismissExAction}
          >
            <div 
              className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-4 border-b border-slate-850 bg-slate-950/40 flex justify-between items-center">
                <h3 className="font-extrabold text-xs text-white uppercase tracking-wider">
                  Configure <span className="text-indigo-400 font-semibold normal-case tracking-normal">"{ex.name}"</span>
                </h3>
                <button onClick={dismissExAction} className="text-slate-400 hover:text-white text-xs font-bold font-sans">CLOSE</button>
              </div>
              <div className="p-4 space-y-3">
                
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      handleMoveExercise(activeExAction, 'up');
                      dismissExAction();
                    }}
                    disabled={activeExAction === 0}
                    className="bg-slate-950 hover:bg-slate-850 disabled:opacity-40 border border-slate-850 rounded-xl p-2.5 text-xs font-bold text-slate-300 transition text-center cursor-pointer"
                  >
                    Move Exercise Up ▲
                  </button>
                  <button
                    onClick={() => {
                      handleMoveExercise(activeExAction, 'down');
                      dismissExAction();
                    }}
                    disabled={activeExAction === exercises.length - 1}
                    className="bg-slate-950 hover:bg-slate-850 disabled:opacity-40 border border-slate-850 rounded-xl p-2.5 text-xs font-bold text-slate-300 transition text-center cursor-pointer"
                  >
                    Move Exercise Down ▼
                  </button>
                </div>

                <button
                  onClick={() => {
                    handleToggleSuperset(activeExAction);
                    dismissExAction();
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
                    dismissExAction();
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
                    dismissExAction();
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
          <div 
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in"
            onClick={dismissSetAction}
          >
            <div 
              className="bg-slate-900 border border-slate-800 rounded-none w-full max-w-sm overflow-hidden shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-4 border-b border-slate-850 bg-slate-950/40 flex justify-between items-center">
                <h3 className="font-extrabold text-xs text-white uppercase tracking-wider font-mono">Set {set.setNumber} Options</h3>
                <button onClick={dismissSetAction} className="text-slate-400 hover:text-white text-xs font-bold font-mono">CLOSE</button>
              </div>
              <div className="p-4 space-y-3">
                {/* Comment Inline Input */}
                <div className="space-y-1.5">
                  <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider font-mono">Set Comment / Note</label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      defaultValue={set.comment || ''}
                      id="set-comment-input-field"
                      placeholder="e.g., Last rep was slow, good squeeze"
                      className="flex-1 bg-slate-950 border border-slate-850 rounded-none px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-sans"
                    />
                    <button
                      onClick={() => {
                        const val = (document.getElementById('set-comment-input-field') as HTMLInputElement)?.value || '';
                        handleUpdateSetComment(exIdx, setIdx, val);
                        dismissSetAction();
                      }}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs px-3 py-1.5 rounded-none transition shrink-0 font-mono"
                    >
                      Save
                    </button>
                  </div>
                </div>

                <div className="border-t border-slate-850 my-2 pt-2 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => {
                        handleToggleDropSet(exIdx, setIdx);
                        dismissSetAction();
                      }}
                      className="bg-slate-950 hover:bg-slate-850 border border-slate-850 rounded-none p-2.5 text-xs font-bold text-slate-300 transition flex flex-col items-center justify-center gap-1.5"
                    >
                      <span>Drop Set</span>
                      <span className={`text-[8px] px-2 py-0.5 rounded-none font-extrabold uppercase font-mono ${set.isDropSet ? 'bg-rose-500/20 text-rose-400' : 'bg-slate-850 text-slate-500'}`}>
                        {set.isDropSet ? 'YES ↓' : 'NO'}
                      </span>
                    </button>

                    <button
                      onClick={() => {
                        handleToggleWarmup(exIdx, setIdx);
                        dismissSetAction();
                      }}
                      className="bg-slate-950 hover:bg-slate-850 border border-slate-850 rounded-none p-2.5 text-xs font-bold text-slate-300 transition flex flex-col items-center justify-center gap-1.5"
                    >
                      <span>Warmup Set</span>
                      <span className={`text-[8px] px-2 py-0.5 rounded-none font-extrabold uppercase font-mono ${set.isWarmup ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-850 text-slate-500'}`}>
                        {set.isWarmup ? 'YES ⌇⌇⌇' : 'NO'}
                      </span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => {
                        handleMoveSet(exIdx, setIdx, 'up');
                        dismissSetAction();
                      }}
                      disabled={setIdx === 0}
                      className="bg-slate-950 hover:bg-slate-850 disabled:opacity-40 border border-slate-850 rounded-none p-2 text-xs font-bold text-slate-300 transition text-center font-mono"
                    >
                      Move Up ▲
                    </button>
                    <button
                      onClick={() => {
                        handleMoveSet(exIdx, setIdx, 'down');
                        dismissSetAction();
                      }}
                      disabled={setIdx === ex.sets.length - 1}
                      className="bg-slate-950 hover:bg-slate-850 disabled:opacity-40 border border-slate-850 rounded-none p-2 text-xs font-bold text-slate-300 transition text-center font-mono"
                    >
                      Move Down ▼
                    </button>
                  </div>

                  <button
                    onClick={() => {
                      handleDeleteSet(exIdx, setIdx);
                      dismissSetAction();
                    }}
                    className="w-full text-left bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 hover:border-rose-500/40 rounded-none p-2.5 text-xs font-bold text-rose-400 transition flex items-center justify-between"
                  >
                    <span className="font-mono">DELETE SET</span>
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
          <div 
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center px-0 py-6 z-50 animate-fade-in"
            onClick={dismissHistory}
          >
            <div 
              className="bg-slate-900 border-y border-slate-800 rounded-none w-full max-w-sm overflow-hidden shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-4 border-b border-slate-850 bg-slate-950/40 flex justify-between items-center">
                <div className="flex items-center gap-1.5">
                  <History className="w-4 h-4 text-cyan-400" />
                  <h3 className="font-extrabold text-xs text-white uppercase tracking-wider">Lifting History</h3>
                </div>
                <button onClick={dismissHistory} className="text-slate-400 hover:text-white text-xs font-bold font-sans">CLOSE</button>
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
                  <div className="bg-slate-950 rounded-xl border border-slate-850 overflow-hidden min-h-[280px] max-h-[380px] overflow-y-auto">
                    {history.map((item, idx) => {
                      const weekStyle = getWeekStyle(item.week, item.day);
                      const isCurrentEditRow = editLogId && item.logId === editLogId;
                      const isLatestRow = idx === 0;

                      let bgClass = weekStyle.bgClass;
                      let borderClass = weekStyle.borderClass;

                      if (isCurrentEditRow) {
                        bgClass = 'bg-amber-500/10 hover:bg-amber-500/15';
                        borderClass = 'border-l-2 border-amber-500';
                      } else if (isLatestRow) {
                        bgClass = 'bg-cyan-500/10 hover:bg-cyan-500/15';
                        borderClass = 'border-l-2 border-cyan-400';
                      }

                      // Check if this is the final set of a workout
                      const nextItem = history[idx + 1];
                      const isLastSetOfWorkout = nextItem && item.logId !== nextItem.logId;

                      const maxEst1RMInHistory = (() => {
                        const ests = history.map(h => {
                          if (h.modality === 'timed') return 0;
                          const w = h.weight || 0;
                          const r = h.reps || 0;
                          if (w <= 0 || r <= 0) return 0;
                          const est = r === 1 ? w : w * (1 + r / 30);
                          return Math.round(est * 10) / 10;
                        });
                        return Math.max(...ests, 0);
                      })();

                      const isPRSet = (() => {
                        if (item.modality === 'timed') return false;
                        const w = item.weight || 0;
                        const r = item.reps || 0;
                        if (w <= 0 || r <= 0) return false;
                        const est = r === 1 ? w : w * (1 + r / 30);
                        const roundedEst = Math.round(est * 10) / 10;
                        return maxEst1RMInHistory > 0 && Math.abs(roundedEst - maxEst1RMInHistory) < 0.05;
                      })();

                      return (
                        <div
                          key={idx}
                          className={`p-2.5 flex items-center justify-between text-[11px] font-mono transition border-b border-slate-850/30 last:border-b-0 ${bgClass} ${borderClass}`}
                          style={isLastSetOfWorkout ? { borderBottom: '2.5px solid var(--theme-accent)' } : undefined}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="flex flex-col items-start shrink-0">
                              <span className="text-slate-300 font-extrabold whitespace-nowrap">
                                {new Date(item.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })}
                              </span>
                              <span className="text-[8px] text-slate-500 font-bold uppercase tracking-wider">
                                {weekStyle.label}
                              </span>
                            </div>

                            {/* Abbreviated objective tag */}
                            {item.objective && (() => {
                              const mapping: Record<string, string> = {
                                'Hypertrophy': '[hyp]',
                                'Strength': '[str]',
                                'Deload': '[dld]',
                                'Off': '[off]',
                              };
                              const label = mapping[item.objective] || `[${item.objective.toLowerCase().slice(0, 3)}]`;
                              let colorClass = 'text-slate-500';
                              if (item.objective === 'Hypertrophy') colorClass = 'text-pink-400 font-bold';
                              else if (item.objective === 'Strength') colorClass = 'text-amber-400 font-bold';
                              else if (item.objective === 'Deload') colorClass = 'text-teal-400 font-bold';
                              return (
                                <span className={`${colorClass} text-[9px] font-mono select-none tracking-tight shrink-0`} title={`Objective: ${item.objective}`}>
                                  {label}
                                </span>
                              );
                            })()}
                          </div>
                          <div className="flex items-center gap-1.5 text-slate-200 shrink-0 text-right">
                            <span className="text-slate-400 font-bold">
                              Set {item.setNumber}
                              {item.isWarmup && <span className="text-amber-500 font-black ml-0.5" title="Warmup Set">⌇⌇⌇</span>}
                              {item.isDropSet && <span className="text-rose-500 font-black ml-0.5 animate-pulse" title="Drop Set">↓</span>}
                              {' '}-
                            </span>
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
                            {isPRSet && (
                              <span className={`inline-flex items-center gap-0.5 text-[8px] font-extrabold px-1 py-0.5 rounded uppercase tracking-tight animate-pulse shrink-0 ${
                                themeId === 'amber'
                                  ? 'text-[#B56D3E] bg-[#B56D3E]/10 border border-[#B56D3E]/20'
                                  : 'text-amber-400 bg-amber-500/10 border border-amber-500/20'
                              }`} title="Personal Record!">
                                <Award className={`w-2.5 h-2.5 shrink-0 ${themeId === 'amber' ? 'text-[#B56D3E]' : 'text-amber-400'}`} /> PR
                              </span>
                            )}
                            {item.rpe && (
                              <span className={`px-1 py-0.5 rounded text-[10px] font-bold ${
                                themeId === 'amber'
                                  ? 'text-cyan-400 bg-cyan-400/10 border border-cyan-400/20'
                                  : 'text-cyan-400 bg-cyan-950/40 border border-cyan-500/15'
                              }`}>@{item.rpe}</span>
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

      {/* Program Completed Congratulatory Modal */}
      {showCompletionModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[60] flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-300">
          <div className="w-full max-w-sm bg-[var(--theme-card)] border-2 border-[var(--theme-accent)] p-6 shadow-2xl space-y-6 flex flex-col items-center">
            <div className="w-16 h-16 bg-[var(--theme-accent)]/10 border-2 border-[var(--theme-accent)] text-[var(--theme-accent)] rounded-full flex items-center justify-center animate-bounce">
              <Award className="w-8 h-8" />
            </div>
            
            <div className="space-y-2">
              <h3 className="text-xl font-black text-[var(--theme-text-primary)] uppercase tracking-wider">
                Program Completed!
              </h3>
              <p className="text-xs text-[var(--theme-accent)] font-mono tracking-widest font-bold uppercase">
                {programName}
              </p>
              <p className="text-xs text-[var(--theme-text-secondary)] leading-relaxed pt-2">
                Outstanding effort! You have successfully completed the final programmed session of your training plan.
              </p>
            </div>

            <div className="w-full bg-[var(--theme-bg)]/60 p-4 border border-[var(--theme-border)] space-y-2 text-left font-mono">
              <div className="flex justify-between text-[11px] text-[var(--theme-text-muted)] font-bold">
                <span>DURATION:</span>
                <span className="text-[var(--theme-text-primary)] font-black">{weekNum} WEEKS</span>
              </div>
              <div className="flex justify-between text-[11px] text-[var(--theme-text-muted)] font-bold">
                <span>TOTAL EXERCISES:</span>
                <span className="text-[var(--theme-text-primary)] font-black">{exercises.length}</span>
              </div>
              <div className="flex justify-between text-[11px] text-[var(--theme-text-muted)] font-bold">
                <span>STATUS:</span>
                <span className="text-[var(--theme-success)] font-black">FINISHED SUCCESSFULLY</span>
              </div>
            </div>

            <div className="w-full space-y-2.5">
              <button
                onClick={() => onSave('analytics', { programId })}
                style={{ backgroundColor: 'var(--theme-accent)', color: 'white' }}
                className="w-full hover:opacity-90 active:opacity-80 text-white font-extrabold text-sm py-3 px-4 rounded-none transition uppercase tracking-wider cursor-pointer flex items-center justify-center gap-2 shadow-md font-sans"
              >
                <Award className="w-4 h-4" />
                View Report Card
              </button>
              <button
                onClick={() => onSave()}
                style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-secondary)' }}
                className="w-full bg-transparent border hover:bg-[var(--theme-bg)] text-xs py-2.5 px-4 rounded-none transition uppercase tracking-wider cursor-pointer font-sans font-bold"
              >
                Back to Home
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
