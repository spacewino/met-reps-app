/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Dumbbell, Plus, Trash2, ArrowLeft, ArrowUp, ArrowDown, Clipboard, HelpCircle, Save, Info, Pencil, Check, TrendingUp, CalendarX, User, X } from 'lucide-react';
import { motion } from 'motion/react';
import { Program, ExerciseEntry, WeightUnit, TargetProgressionMode } from '../types';
import { storage, PREBUILT_TEMPLATES } from '../lib/storage';
import { resolveProgramProgressionMode } from '../lib/programProgressionMode';
import { getActiveWorkoutDraft, doesDraftMatchProgram, clearActiveWorkoutDraft } from '../lib/navigationGuard';
import { ExerciseSelectorModal } from './ExerciseSelectorModal';
import { ConfirmationModal } from './ConfirmationModal';
import { ProgramDraftConflictModal } from './ProgramDraftConflictModal';

interface ProgramBuilderProps {
  onClose: () => void;
  onSave: () => void;
  flashSave?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  themeId?: string;
}

const WEEKDAYS = [
  { value: 0, label: 'Monday', short: 'Mon' },
  { value: 1, label: 'Tuesday', short: 'Tue' },
  { value: 2, label: 'Wednesday', short: 'Wed' },
  { value: 3, label: 'Thursday', short: 'Thu' },
  { value: 4, label: 'Friday', short: 'Fri' },
  { value: 5, label: 'Saturday', short: 'Sat' },
  { value: 6, label: 'Sunday', short: 'Sun' },
];

type InfoModalKey =
  | 'periodisation_targets'
  | 'metreps_coach'
  | 'hypertrophy_linear'
  | 'hypertrophy_step'
  | 'strength_undulating'
  | 'strength_linear';

interface InfoDialogContent {
  title: string;
  secondaryHeading?: string;
  body: string;
  note?: string;
}

const INFO_DIALOG_CONTENTS: Record<InfoModalKey, InfoDialogContent> = {
  periodisation_targets: {
    title: 'Periodisation Targets',
    secondaryHeading: 'How this mode works',
    body: 'MetReps uses your recorded performance as the baseline, then applies your selected periodisation method to calculate the session’s targets. It does not use Coach rules to decide whether you have earned a progression, should hold, or should retry a target.',
  },
  metreps_coach: {
    title: 'MetReps Coach',
    secondaryHeading: 'How this mode works',
    body: 'MetReps Coach starts with the same periodisation-based targets, then compares completed workouts with previous prescribed targets. When the available evidence supports a decision, it can progress, hold, retry or adjust future weight and repetition targets.',
  },
  hypertrophy_linear: {
    title: 'Wave Volume',
    secondaryHeading: 'How this method works',
    body: 'Alternates weekly between higher-repetition waves (12–15 reps) and heavier, lower-repetition waves (6–12 reps), anchored at RPE 8.0. Rep targets adjust automatically for compound versus isolation and free-weight versus machine exercises.',
  },
  hypertrophy_step: {
    title: 'Step Loading',
    secondaryHeading: 'How this method works',
    body: 'Organises training into 4-week blocks. Target RPE rises through Weeks 1–3, then holds in Week 4 while reps increase. Each new block shifts to a heavier, lower-rep range, with rep targets adjusted for exercise type and equipment.',
  },
  strength_undulating: {
    title: 'Wave Strength',
    secondaryHeading: 'How this method works',
    body: 'Progresses designated Main Movements through changing strength rep ranges across 4, 8, or 12 weeks, finishing with an RPE 10 peak single. Other exercises remain self-directed.',
    note: 'Only mark an exercise as a Main Movement if it is suitable for low-repetition strength work and peak singles.',
  },
  strength_linear: {
    title: 'Linear Periodisation',
    secondaryHeading: 'How this method works',
    body: 'Progresses designated Main Movements across the program by gradually reducing target reps from 8 in Week 1 to 1 in the final week while increasing target RPE from 7.0 to 10.0. Other exercises remain self-directed.',
    note: 'Only mark an exercise as a Main Movement if it is suitable for low-repetition strength work and peak singles.',
  },
};

const getDefaultWeekdays = (num: number): Record<number, number> => {
  if (num === 3) {
    return { 1: 0, 2: 2, 3: 4 }; // Mon, Wed, Fri
  }
  if (num === 4) {
    return { 1: 0, 2: 1, 3: 3, 4: 4 }; // Mon, Tue, Thu, Fri
  }
  if (num === 5) {
    return { 1: 0, 2: 1, 3: 3, 4: 4, 5: 5 }; // Mon, Tue, Thu, Fri, Sat
  }
  if (num === 6) {
    return { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5 }; // Mon, Tue, Wed, Thu, Fri, Sat
  }
  if (num === 7) {
    return { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6 }; // Mon, Tue, Wed, Thu, Fri, Sat, Sun
  }
  if (num === 1) {
    return { 1: 0 };
  }
  if (num === 2) {
    return { 1: 0, 2: 3 }; // Mon, Thu
  }
  const result: Record<number, number> = {};
  for (let i = 1; i <= num; i++) {
    result[i] = (i - 1) % 7;
  }
  return result;
};

export function ProgramBuilder({ onClose, onSave, flashSave, onDirtyChange }: ProgramBuilderProps) {
  const themeId = React.useMemo(() => storage.getTheme(), []);
  const isAmber = themeId === 'amber';
  const activeProg = useState(() => storage.getCurrentProgram())[0];
  const [currentProgramId, setCurrentProgramId] = useState<string | null>(() => activeProg?.id || null);
  const [editingProgramId, setEditingProgramId] = useState<string | null>(() => activeProg?.id || null);

  const [snapshot, setSnapshot] = useState(() => {
    if (!activeProg) {
      return {
        id: null,
        name: 'My Custom Strength Program',
        daysPerWeek: 3,
        durationWeeks: 8,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        targetProgressionMode: 'performance_led' as TargetProgressionMode,
        exercisesByDay: { 1: [], 2: [], 3: [] },
        assignedWeekdays: getDefaultWeekdays(3)
      };
    }
    const dur = activeProg.programDuration;
    const durNum = dur && typeof dur === 'number' && [4, 6, 8, 12].includes(dur) ? dur : 8;
    const initObj = activeProg.objective || 'Hypertrophy';
    const initAlgo = activeProg.algorithmId || (initObj === 'Strength' ? 'strength_undulating' : 'hypertrophy_linear');
    const initProgressionMode = resolveProgramProgressionMode(activeProg);
    return {
      id: activeProg.id,
      name: activeProg.name,
      daysPerWeek: activeProg.daysPerWeek,
      durationWeeks: durNum,
      objective: initObj,
      algorithmId: initAlgo,
      targetProgressionMode: initProgressionMode,
      exercisesByDay: JSON.parse(JSON.stringify(activeProg.exercisesByDay)),
      assignedWeekdays: activeProg.assignedWeekdays ? JSON.parse(JSON.stringify(activeProg.assignedWeekdays)) : getDefaultWeekdays(activeProg.daysPerWeek)
    };
  });

  const [name, setName] = useState(() => activeProg?.name || 'My Custom Strength Program');
  const [originalName, setOriginalName] = useState(() => activeProg?.name || '');
  const [daysPerWeek, setDaysPerWeek] = useState(() => activeProg?.daysPerWeek || 3);
  const [durationWeeks, setDurationWeeks] = useState<number>(() => {
    const dur = activeProg?.programDuration;
    if (dur && typeof dur === 'number' && [4, 6, 8, 12].includes(dur)) {
      return dur;
    }
    return 8;
  });
  const [objective, setObjective] = useState<'Off' | 'Hypertrophy' | 'Strength'>(() => activeProg?.objective || 'Hypertrophy');
  const [algorithmId, setAlgorithmId] = useState<'hypertrophy_linear' | 'hypertrophy_step' | 'strength_undulating' | 'strength_linear' | 'none'>(() => {
    if (activeProg?.algorithmId) return activeProg.algorithmId;
    return activeProg?.objective === 'Strength' ? 'strength_undulating' : 'hypertrophy_linear';
  });
  const [targetProgressionMode, setTargetProgressionMode] = useState<TargetProgressionMode>(() =>
    resolveProgramProgressionMode(activeProg)
  );
  const [alertMsg, setAlertMsg] = useState<string | null>(null);
  const [savedPrograms, setSavedPrograms] = useState<Program[]>(() => storage.getPrograms());
  const [isDaysDropdownOpen, setIsDaysDropdownOpen] = useState(false);
  const [isDurationDropdownOpen, setIsDurationDropdownOpen] = useState(false);
  const [isWeekdayDropdownOpen, setIsWeekdayDropdownOpen] = useState(false);

  const daysDropdownRef = useRef<HTMLDivElement>(null);
  const durationDropdownRef = useRef<HTMLDivElement>(null);
  const weekdayDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: PointerEvent | TouchEvent) {
      if (daysDropdownRef.current && !daysDropdownRef.current.contains(event.target as Node)) {
        setIsDaysDropdownOpen(false);
      }
      if (durationDropdownRef.current && !durationDropdownRef.current.contains(event.target as Node)) {
        setIsDurationDropdownOpen(false);
      }
      if (weekdayDropdownRef.current && !weekdayDropdownRef.current.contains(event.target as Node)) {
        setIsWeekdayDropdownOpen(false);
      }
    }
    document.addEventListener('pointerdown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('pointerdown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, []);
  
  // Exercise library selector modal states
  const [isSelectorOpen, setIsSelectorOpen] = useState(false);
  const [selectorTarget, setSelectorTarget] = useState<{ dayIdx: number; exIdx: number | null } | null>(null);

  // Swap target state
  const [swapTarget, setSwapTarget] = useState<Program | null>(null);

  // Overwrite target state
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false);
  const [pendingSaveProgram, setPendingSaveProgram] = useState<Program | null>(null);

  // Active workout draft conflict state
  const [showDraftConflictModal, setShowDraftConflictModal] = useState(false);
  const [pendingDraftConflictProgram, setPendingDraftConflictProgram] = useState<Program | null>(null);

  // Progression & Periodisation Information Dialog State
  const [activeInfoModal, setActiveInfoModal] = useState<InfoModalKey | null>(null);
  const infoTriggerRef = useRef<HTMLElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  const openInfoModal = (key: InfoModalKey, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
      infoTriggerRef.current = e.currentTarget as HTMLElement;
    } else {
      infoTriggerRef.current = document.activeElement as HTMLElement | null;
    }
    setActiveInfoModal(key);
  };

  const closeInfoModal = () => {
    setActiveInfoModal(null);
    setTimeout(() => {
      if (infoTriggerRef.current) {
        infoTriggerRef.current.focus();
      }
    }, 0);
  };

  useEffect(() => {
    if (!activeInfoModal) {
      return undefined;
    }
    closeBtnRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeInfoModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeInfoModal]);

  // Unenroll state
  const [showUnenrollConfirm, setShowUnenrollConfirm] = useState(false);
  const [pendingSwitchProgram, setPendingSwitchProgram] = useState<any | null>(null);
  const [showCommencedModal, setShowCommencedModal] = useState(false);
  const [commencedProgramName, setCommencedProgramName] = useState('');
  const [showSaveChoices, setShowSaveChoices] = useState(false);
  const [pendingEnrolment, setPendingEnrolment] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [pendingBuilderNavigation, setPendingBuilderNavigation] = useState<(() => void) | null>(null);

  useEffect(() => {
    if (!showSaveChoices) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowSaveChoices(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showSaveChoices]);

  const attemptSaveProgram = (updatedProgram: Program, enrol = false) => {
    const activeDraftInfo = getActiveWorkoutDraft();
    if (activeDraftInfo && (
      doesDraftMatchProgram(activeDraftInfo.rawDraft, updatedProgram.id)
      || (enrol && currentProgramId !== updatedProgram.id)
    )) {
      setPendingDraftConflictProgram(updatedProgram);
      setPendingEnrolment(enrol);
      setShowDraftConflictModal(true);
      return;
    }
    performDirectSaveProgram(updatedProgram, false, enrol);
  };

  const performDirectSaveProgram = (updatedProgram: Program, clearMatchingDraft = false, enrol = false) => {
    let savedProgram: Program;
    try {
      savedProgram = enrol ? storage.enrolProgram(updatedProgram) : storage.saveProgramDesign(updatedProgram);
    } catch (err) {
      console.error('Failed to save program:', err);
      setAlertMsg(err instanceof Error ? err.message : 'Failed to save program. Please try again.');
      return;
    }

    if (enrol) setCurrentProgramId(savedProgram.id);
    setEditingProgramId(savedProgram.id);
    setOriginalName(savedProgram.name);
    setSavedPrograms(storage.getPrograms());

    // Update snapshot with saved values to clear the dirty state
    const dur = savedProgram.programDuration;
    const isUndulating = updatedProgram.objective === 'Strength' && (updatedProgram.algorithmId === 'strength_undulating' || !updatedProgram.algorithmId);
    const durNum = dur && typeof dur === 'number' && (isUndulating ? [4, 8, 12] : [4, 6, 8, 12]).includes(dur) ? dur : 8;
    const saveObj = updatedProgram.objective || 'Hypertrophy';
    const saveAlgo = updatedProgram.algorithmId || (saveObj === 'Strength' ? 'strength_undulating' : 'hypertrophy_linear');
    const saveProgressionMode = resolveProgramProgressionMode(updatedProgram);
    setSnapshot({
      id: savedProgram.id,
      name: savedProgram.name,
      daysPerWeek: savedProgram.daysPerWeek,
      durationWeeks: durNum,
      objective: saveObj,
      algorithmId: saveAlgo,
      targetProgressionMode: saveProgressionMode,
      exercisesByDay: JSON.parse(JSON.stringify(savedProgram.exercisesByDay)),
      assignedWeekdays: savedProgram.assignedWeekdays ? JSON.parse(JSON.stringify(savedProgram.assignedWeekdays)) : getDefaultWeekdays(savedProgram.daysPerWeek)
    });

    // Clear matching draft only when explicitly confirmed via draft conflict modal
    if (clearMatchingDraft) {
      const activeDraftInfo = getActiveWorkoutDraft();
      if (activeDraftInfo && doesDraftMatchProgram(activeDraftInfo.rawDraft, updatedProgram.id)) {
        clearActiveWorkoutDraft();
      }
    }

    if (onDirtyChange) {
      onDirtyChange(false);
    }
    setIsDirty(false);
    if (enrol) {
      setCommencedProgramName(savedProgram.name);
      setShowCommencedModal(true);
    } else {
      setAlertMsg(editingProgramId ? 'Changes saved' : 'Program saved for later');
    }
  };

  const openSelectorFor = (dayIdx: number, exIdx: number | null) => {
    setSelectorTarget({ dayIdx, exIdx });
    setIsSelectorOpen(true);
  };

  const handleSelectExercise = (selectedList: { name: string; category: string; modality?: 'weighted' | 'bodyweight' | 'assisted' | 'distance' | 'timed' | 'distance_loaded'; exerciseKey?: string }[]) => {
    if (selectedList.length === 0) return;
    if (selectorTarget) {
      const { dayIdx, exIdx } = selectorTarget;
      
      if (exIdx === null) {
        // Adding brand new exercises
        setExercisesByDay(prev => {
          const currentList = prev[dayIdx] || [];
          const additional = selectedList.map(item => ({
            name: item.name,
            muscleGroup: item.category,
            modality: item.modality || 'weighted',
            ...(item.exerciseKey ? { exerciseKey: item.exerciseKey } : {}),
            sets: [{ setNumber: 1, weight: 0, reps: 8 }]
          }));
          return {
            ...prev,
            [dayIdx]: [...currentList, ...additional]
          };
        });
      } else {
        // Editing existing exercise at exIdx
        const first = selectedList[0];
        setExercisesByDay(prev => {
          const currentList = prev[dayIdx] || [];
          const updated = currentList.map((ex, idx) => {
            if (idx === exIdx) {
              const updatedEx: any = {
                ...ex,
                name: first.name,
                muscleGroup: first.category,
                modality: first.modality || 'weighted',
                isMainMovement: false, // Reset main movement status on exercise replacement
                isSuperset: false,     // Reset superset status on exercise replacement
              };
              if (first.exerciseKey) {
                updatedEx.exerciseKey = first.exerciseKey;
              } else {
                delete updatedEx.exerciseKey;
              }
              return updatedEx;
            }
            return ex;
          });
          return { ...prev, [dayIdx]: updated };
        });

        if (selectedList.length > 1) {
          setExercisesByDay(prev => {
            const currentList = prev[dayIdx] || [];
            const additional = selectedList.slice(1).map(item => ({
              name: item.name,
              muscleGroup: item.category,
              modality: item.modality || 'weighted',
              ...(item.exerciseKey ? { exerciseKey: item.exerciseKey } : {}),
              sets: [{ setNumber: 1, weight: 0, reps: 8 }]
            }));
            return {
              ...prev,
              [dayIdx]: [...currentList, ...additional]
            };
          });
        }
      }
      setSelectorTarget(null);
    }
  };

  // Exercises state: Record<dayIndex, list of exercises>
  const [exercisesByDay, setExercisesByDay] = useState<Record<number, ExerciseEntry[]>>(() => {
    return activeProg ? JSON.parse(JSON.stringify(activeProg.exercisesByDay)) : { 1: [], 2: [], 3: [] };
  });

  // Weekday index assignment state: Record<dayIndex, weekday index>
  const [assignedWeekdays, setAssignedWeekdays] = useState<Record<number, number>>(() => {
    return activeProg?.assignedWeekdays
      ? JSON.parse(JSON.stringify(activeProg.assignedWeekdays))
      : getDefaultWeekdays(daysPerWeek);
  });

  // Current Day Tab selected in the editor
  const [activeTabDay, setActiveTabDay] = useState<number>(1);

  // Detect unsaved changes (dirty state) and report to parent
  useEffect(() => {
    let dirty = false;

    const nameChanged = name !== snapshot.name;
    const daysChanged = daysPerWeek !== snapshot.daysPerWeek;
    const durationChanged = durationWeeks !== snapshot.durationWeeks;
    const objectiveChanged = objective !== snapshot.objective;
    const algorithmChanged = algorithmId !== snapshot.algorithmId;
    const progressionModeChanged = targetProgressionMode !== snapshot.targetProgressionMode;
    const exercisesChanged = JSON.stringify(exercisesByDay) !== JSON.stringify(snapshot.exercisesByDay);
    const weekdaysChanged = JSON.stringify(assignedWeekdays) !== JSON.stringify(snapshot.assignedWeekdays);

    if (nameChanged || daysChanged || durationChanged || objectiveChanged || algorithmChanged || progressionModeChanged || exercisesChanged || weekdaysChanged) {
      dirty = true;
    }

    if (onDirtyChange) {
      onDirtyChange(dirty);
    }
    setIsDirty(dirty);
  }, [
    name,
    daysPerWeek,
    durationWeeks,
    objective,
    algorithmId,
    targetProgressionMode,
    exercisesByDay,
    assignedWeekdays,
    snapshot,
    onDirtyChange
  ]);

  const protectBuilderChanges = (action: () => void) => {
    if (!isDirty) action();
    else setPendingBuilderNavigation(() => action);
  };

  // Apply static template program (preserves current creation-form objective and algorithm)
  const handleSelectPrebuiltTemplate = (tpl: any) => {
    const tplDuration = tpl.programDuration === '∞' ? 8 : Number(tpl.programDuration);
    const tplWeekdays = tpl.assignedWeekdays ? JSON.parse(JSON.stringify(tpl.assignedWeekdays)) : getDefaultWeekdays(tpl.daysPerWeek);
    const tplProgressionMode = resolveProgramProgressionMode(tpl);

    setEditingProgramId(null);
    setName(tpl.name);
    setOriginalName('');
    setDaysPerWeek(tpl.daysPerWeek);
    setDurationWeeks(tplDuration);
    setExercisesByDay(JSON.parse(JSON.stringify(tpl.exercisesByDay)));
    setAssignedWeekdays(tplWeekdays);
    setTargetProgressionMode(tplProgressionMode);
    // Note: objective and algorithmId are intentionally preserved to honour the user's creation-form selection
    setActiveTabDay(1);

    // Update snapshot
    setSnapshot({
      id: null,
      name: tpl.name,
      daysPerWeek: tpl.daysPerWeek,
      durationWeeks: tplDuration,
      objective: objective,
      algorithmId: algorithmId,
      targetProgressionMode: tplProgressionMode,
      exercisesByDay: JSON.parse(JSON.stringify(tpl.exercisesByDay)),
      assignedWeekdays: tplWeekdays
    });
  };

  // Apply custom saved program (restores the saved program's objective and algorithm)
  const handleSelectSavedProgram = (prog: Program) => {
    const progObjective = prog.objective || 'Hypertrophy';
    const progAlgorithm = prog.algorithmId || (progObjective === 'Strength' ? 'strength_undulating' : 'hypertrophy_linear');
    const progDuration = prog.programDuration === '∞' ? 8 : Number(prog.programDuration);
    const progWeekdays = prog.assignedWeekdays ? JSON.parse(JSON.stringify(prog.assignedWeekdays)) : getDefaultWeekdays(prog.daysPerWeek);
    const progProgressionMode = resolveProgramProgressionMode(prog);

    setEditingProgramId(prog.id);
    setName(prog.name);
    setOriginalName(prog.name);
    setDaysPerWeek(prog.daysPerWeek);
    setDurationWeeks(progDuration);
    setExercisesByDay(JSON.parse(JSON.stringify(prog.exercisesByDay)));
    setAssignedWeekdays(progWeekdays);
    setObjective(progObjective);
    setAlgorithmId(progAlgorithm);
    setTargetProgressionMode(progProgressionMode);
    setActiveTabDay(1);

    // Update snapshot
    setSnapshot({
      id: prog.id,
      name: prog.name,
      daysPerWeek: prog.daysPerWeek,
      durationWeeks: progDuration,
      objective: progObjective,
      algorithmId: progAlgorithm,
      targetProgressionMode: progProgressionMode,
      exercisesByDay: JSON.parse(JSON.stringify(prog.exercisesByDay)),
      assignedWeekdays: progWeekdays
    });
  };

  const handleConfirmSwap = () => {
    if (!swapTarget) return;
    
    storage.setCurrentProgramId(swapTarget.id);
    setCurrentProgramId(swapTarget.id);
    setEditingProgramId(swapTarget.id);
    
    setName(swapTarget.name);
    setOriginalName(swapTarget.name);
    setDaysPerWeek(swapTarget.daysPerWeek);
    
    const targetDuration = swapTarget.programDuration === '∞' ? 8 : Number(swapTarget.programDuration);
    const targetWeekdays = swapTarget.assignedWeekdays ? JSON.parse(JSON.stringify(swapTarget.assignedWeekdays)) : getDefaultWeekdays(swapTarget.daysPerWeek);
    const targetObjective = swapTarget.objective || 'Hypertrophy';
    const targetAlgorithm = swapTarget.algorithmId || (targetObjective === 'Strength' ? 'strength_undulating' : 'hypertrophy_linear');
    const targetProgressionModeVal = resolveProgramProgressionMode(swapTarget);

    setDurationWeeks(targetDuration);
    setExercisesByDay(JSON.parse(JSON.stringify(swapTarget.exercisesByDay)));
    setAssignedWeekdays(targetWeekdays);
    setObjective(targetObjective);
    setAlgorithmId(targetAlgorithm);
    setTargetProgressionMode(targetProgressionModeVal);
    setActiveTabDay(1);
    
    // Update snapshot
    setSnapshot({
      id: swapTarget.id,
      name: swapTarget.name,
      daysPerWeek: swapTarget.daysPerWeek,
      durationWeeks: targetDuration,
      objective: targetObjective,
      algorithmId: targetAlgorithm,
      targetProgressionMode: targetProgressionModeVal,
      exercisesByDay: JSON.parse(JSON.stringify(swapTarget.exercisesByDay)),
      assignedWeekdays: targetWeekdays
    });

    setSwapTarget(null);
  };

  const handleConfirmUnenroll = () => {
    storage.setCurrentProgramId(null);
    setCurrentProgramId(null);
    setEditingProgramId(null);
    setShowUnenrollConfirm(false);
    onSave();
  };

  const saveOrConfirm = (updatedProgram: Program) => {
    const hasNameChanged = originalName !== '' && updatedProgram.name.trim().toLowerCase() !== originalName.trim().toLowerCase();

    // Determine if we should show overwrite confirmation
    const nameChanged = updatedProgram.name !== snapshot.name;
    const daysChanged = updatedProgram.daysPerWeek !== snapshot.daysPerWeek;
    const durationChanged = updatedProgram.programDuration !== snapshot.durationWeeks;
    const objectiveChanged = updatedProgram.objective !== snapshot.objective;
    const algorithmChanged = updatedProgram.algorithmId !== snapshot.algorithmId;
    const progressionModeChanged = resolveProgramProgressionMode(updatedProgram) !== snapshot.targetProgressionMode;
    const exercisesChanged = JSON.stringify(updatedProgram.exercisesByDay) !== JSON.stringify(snapshot.exercisesByDay);
    const weekdaysChanged = JSON.stringify(updatedProgram.assignedWeekdays) !== JSON.stringify(snapshot.assignedWeekdays);

    const isDirty = nameChanged || daysChanged || durationChanged || objectiveChanged || algorithmChanged || progressionModeChanged || exercisesChanged || weekdaysChanged;

    const isEditingCustomProgram = editingProgramId !== null && !editingProgramId.startsWith('prog-tpl-');
    const isSavingSameName = isEditingCustomProgram && originalName !== 'My Custom Strength Program' && !hasNameChanged && isDirty;
    
    const nameMatchesAnother = savedPrograms.some(
      p => p.name.trim().toLowerCase() === updatedProgram.name.trim().toLowerCase() && p.id !== updatedProgram.id
    );

    if (isSavingSameName || nameMatchesAnother) {
      setPendingSaveProgram(updatedProgram);
      setShowOverwriteConfirm(true);
    } else {
      attemptSaveProgram(updatedProgram);
    }
  };

  const handleConfirmSwitch = () => {
    if (!pendingSwitchProgram) return;
    const progToSave = pendingSwitchProgram;
    setPendingSwitchProgram(null);
    attemptSaveProgram(progToSave, true);
  };

  const requestEnrolment = (program: Program) => {
    if (currentProgramId && currentProgramId !== program.id) {
      setPendingSwitchProgram(program);
    } else {
      attemptSaveProgram(program, true);
    }
  };

  const enrolledProgramName = React.useMemo(() => {
    if (!currentProgramId) return null;
    const prebuilt = PREBUILT_TEMPLATES.find(p => p.id === currentProgramId);
    if (prebuilt) return prebuilt.name;
    const saved = savedPrograms.find(p => p.id === currentProgramId);
    if (saved) return saved.name;
    return null;
  }, [currentProgramId, savedPrograms]);

  const handleCreateNewCustom = () => {
    setEditingProgramId(null);
    setName('My Custom Strength Program');
    setOriginalName('');
    setDaysPerWeek(3);
    setDurationWeeks(8);
    setExercisesByDay({ 1: [], 2: [], 3: [] });
    setAssignedWeekdays(getDefaultWeekdays(3));
    setObjective('Hypertrophy');
    setAlgorithmId('hypertrophy_linear');
    setTargetProgressionMode('performance_led');
    setActiveTabDay(1);

    // Update snapshot
    setSnapshot({
      id: null,
      name: 'My Custom Strength Program',
      daysPerWeek: 3,
      durationWeeks: 8,
      objective: 'Hypertrophy',
      algorithmId: 'hypertrophy_linear',
      targetProgressionMode: 'performance_led',
      exercisesByDay: { 1: [], 2: [], 3: [] },
      assignedWeekdays: getDefaultWeekdays(3)
    });
  };

  const handleDaysPerWeekChange = (num: number) => {
    setDaysPerWeek(num);
    setExercisesByDay(prev => {
      const updated = { ...prev };
      // Make sure all day indexes up to num have at least a blank array
      for (let i = 1; i <= num; i++) {
        if (!updated[i]) {
          updated[i] = [];
        }
      }
      return updated;
    });
    setAssignedWeekdays(getDefaultWeekdays(num));
    if (activeTabDay > num) {
      setActiveTabDay(1);
    }
  };

  const handleAddExerciseToDayDirectly = (dayIdx: number) => {
    openSelectorFor(dayIdx, null);
  };

  const handleDeleteExerciseFromDay = (dayIdx: number, exIdx: number) => {
    setExercisesByDay(prev => {
      const currentList = prev[dayIdx] || [];
      return {
        ...prev,
        [dayIdx]: currentList.filter((_, idx) => idx !== exIdx),
      };
    });
  };

  const handleMoveExercise = (dayIdx: number, exIdx: number, direction: -1 | 1) => {
    setExercisesByDay(prev => {
      const currentList = prev[dayIdx] || [];
      const targetIdx = exIdx + direction;
      if (targetIdx < 0 || targetIdx >= currentList.length) return prev;

      const reordered = [...currentList];
      [reordered[exIdx], reordered[targetIdx]] = [reordered[targetIdx], reordered[exIdx]];
      return { ...prev, [dayIdx]: reordered };
    });
  };

  const handleUpdateExerciseField = <K extends keyof ExerciseEntry>(
    dayIdx: number,
    exIdx: number,
    key: K,
    val: ExerciseEntry[K]
  ) => {
    setExercisesByDay(prev => {
      const currentList = prev[dayIdx] || [];
      const updated = currentList.map((ex, idx) => {
        if (idx === exIdx) {
          return { ...ex, [key]: val };
        }
        return ex;
      });
      return { ...prev, [dayIdx]: updated };
    });
  };

  const handleSaveProgram = () => {
    if (!name.trim()) {
      setAlertMsg('Please enter a program name!');
      return;
    }

    // Verify all days have at least one exercise
    for (let i = 1; i <= daysPerWeek; i++) {
      if (!exercisesByDay[i] || exercisesByDay[i].length === 0) {
        setAlertMsg(`Please add at least one exercise to Day ${i} before saving!`);
        return;
      }
    }

    // Clean up any extra days beyond daysPerWeek
    const cleanedExercisesByDay: Record<number, any> = {};
    const cleanedAssignedWeekdays: Record<number, number> = {};
    for (let i = 1; i <= daysPerWeek; i++) {
      if (exercisesByDay[i]) {
        cleanedExercisesByDay[i] = exercisesByDay[i];
      }
      if (assignedWeekdays[i] !== undefined) {
        cleanedAssignedWeekdays[i] = assignedWeekdays[i];
      }
    }

    const isNewProgram = !editingProgramId || editingProgramId.startsWith('prog-tpl-');
    const targetId = isNewProgram ? `prog-${Date.now()}` : (editingProgramId as string);

    // Clean up isMainMovement flags if it's a new program to start fresh without prior selections leaking
    const finalExercisesByDay = JSON.parse(JSON.stringify(cleanedExercisesByDay));
    if (isNewProgram) {
      Object.keys(finalExercisesByDay).forEach(day => {
        finalExercisesByDay[Number(day)] = finalExercisesByDay[Number(day)].map((ex: any) => ({
          ...ex,
          isMainMovement: false
        }));
      });
    }

    const existingProg = editingProgramId
      ? (storage.getPrograms().find(p => p.id === editingProgramId) || savedPrograms.find(p => p.id === editingProgramId))
      : null;

    const savedProgressionMode: TargetProgressionMode = objective === 'Off' ? 'performance_led' : targetProgressionMode;

    const updatedProgram: Program = {
      ...(existingProg || {}),
      id: targetId,
      name: name.trim(),
      daysPerWeek: daysPerWeek,
      programDuration: durationWeeks,
      createdAt: (!isNewProgram && existingProg?.createdAt) ? existingProg.createdAt : new Date().toISOString(),
      exercisesByDay: finalExercisesByDay,
      assignedWeekdays: cleanedAssignedWeekdays,
      objective: objective,
      algorithmId: algorithmId,
      targetProgressionMode: savedProgressionMode,
      ...(existingProg?.parentProgramId !== undefined && !isNewProgram ? { parentProgramId: existingProg.parentProgramId } : {}),
      ...(existingProg?.cycleIndex !== undefined && !isNewProgram ? { cycleIndex: existingProg.cycleIndex } : {}),
      ...(existingProg?.algorithmPhaseOffset !== undefined && !isNewProgram ? { algorithmPhaseOffset: existingProg.algorithmPhaseOffset } : {}),
    };
    setPendingSaveProgram(updatedProgram);
    setShowSaveChoices(true);
  };

  return (
    <div className="pb-20">
      {/* Header Bar */}
      <div className="sticky top-[-16px] -mt-4 pt-3 pb-2.5 bg-slate-950 z-30 flex items-center justify-between border-b border-slate-850 px-4 shadow-md">
        <div className="flex items-center gap-2">
          <button
            onClick={() => protectBuilderChanges(onClose)}
            className="p-2 bg-slate-900 hover:bg-slate-800 rounded-none text-slate-400 hover:text-white border border-slate-800 transition"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h2 className="font-extrabold text-sm text-white uppercase tracking-wide">
              {editingProgramId ? 'Edit Program' : 'Create Program'}
            </h2>
            <p className="text-[10px] text-indigo-400 font-mono uppercase tracking-widest">
              {editingProgramId ? (editingProgramId === currentProgramId ? 'Active' : 'Saved') : 'New unsaved program'}
            </p>
          </div>
        </div>

        <motion.button
          onClick={handleSaveProgram}
          animate={flashSave ? {
            boxShadow: [
              "0 0 0 1px rgba(99, 102, 241, 0.3), 0 0 0px rgba(99, 102, 241, 0)",
              "0 0 0 3px rgba(99, 102, 241, 0.5), 0 0 14px rgba(99, 102, 241, 0.8)",
              "0 0 0 1px rgba(99, 102, 241, 0.3), 0 0 0px rgba(99, 102, 241, 0)"
            ]
          } : {}}
          transition={flashSave ? {
            duration: 1.8,
            repeat: Infinity,
            ease: "easeInOut"
          } : {}}
          className="bg-indigo-600 hover:bg-indigo-500 text-[#FBFAF8] font-black text-xs px-4 py-2.5 rounded-none transition flex items-center gap-1 shadow-md shadow-indigo-950/25 cursor-pointer"
        >
          <Save className="w-4 h-4 text-[#FBFAF8]" /> Save Program
        </motion.button>
      </div>

      {/* Preset Templates Slider */}
      <div className="w-full bg-slate-900/50 border-y border-x-0 border-slate-850 p-4 space-y-3 rounded-none mt-0">
        <h3 className="text-lg font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2">
          <Clipboard className="w-[18px] h-[18px]" /> My Programs
        </h3>
        <p className="text-xs text-slate-400 leading-relaxed font-sans">
          Select a <span className="font-bold text-slate-200">template</span> or one of your <span className="font-bold text-slate-200">saved custom programs</span> to quickly load its settings and exercises:
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={() => protectBuilderChanges(handleCreateNewCustom)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-none text-xs font-bold transition border cursor-pointer bg-indigo-600/20 hover:bg-indigo-600/30 border-indigo-500/50 text-indigo-300"
          >
            <Plus className="w-3.5 h-3.5" /> New Custom
          </button>
          {PREBUILT_TEMPLATES.map((tpl) => {
            const isCurrent = editingProgramId === tpl.id;
            return (
              <button
                key={`prebuilt-${tpl.id}`}
                onClick={() => protectBuilderChanges(() => handleSelectPrebuiltTemplate(tpl))}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-none text-xs font-bold transition border cursor-pointer ${
                  isCurrent
                    ? 'bg-slate-950 border-emerald-500 text-emerald-400 font-extrabold shadow-[0_0_8px_rgba(16,185,129,0.15)]'
                    : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-200 hover:text-white'
                }`}
              >
                {isCurrent ? <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> : <span className="text-slate-500 font-bold text-xs">+</span>}
                {tpl.name}
              </button>
            );
          })}
          {savedPrograms.filter(p => !p.id.startsWith('prog-tpl-')).map((prog) => {
            const isCurrent = editingProgramId === prog.id;
            return (
              <button
                key={`saved-${prog.id}`}
                onClick={() => protectBuilderChanges(() => handleSelectSavedProgram(prog))}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-none text-xs font-bold transition border cursor-pointer ${
                  isCurrent
                    ? 'bg-slate-950 border-emerald-500 text-emerald-400 font-extrabold shadow-[0_0_8px_rgba(16,185,129,0.15)]'
                    : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-200 hover:text-white'
                }`}
              >
                {isCurrent ? <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> : <User className="w-3.5 h-3.5 text-slate-500 shrink-0" />}
                {prog.name}
                <span className="text-[9px] uppercase tracking-wide opacity-75">
                  {prog.id === currentProgramId ? 'Active' : 'Saved'}
                </span>
              </button>
            );
          })}
        </div>

        {currentProgramId && (
          <div className="border-t border-slate-800/60 pt-3.5 mt-2 flex flex-col xs:flex-row items-start xs:items-center justify-between gap-3 font-sans">
            <div className="flex flex-col text-left">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                Active Program
              </span>
              <span className={`text-xs font-extrabold mt-0.5 flex items-center gap-1.5 ${isAmber ? 'text-[#B56D3E]' : 'text-emerald-400'}`}>
                <span className={`inline-block w-2 h-2 rounded-full ${isAmber ? 'bg-[#B56D3E]' : 'bg-emerald-500'} animate-pulse`} />
                {enrolledProgramName || 'Active Program'}
              </span>
            </div>
            <button
              onClick={() => setShowUnenrollConfirm(true)}
              className={`px-3 py-2.5 border text-xs font-black uppercase tracking-wider rounded-none transition flex items-center gap-2 cursor-pointer w-full xs:w-auto justify-center ${
                isAmber
                  ? 'bg-rose-50 hover:bg-rose-100 border-rose-200 text-rose-700 shadow-sm'
                  : 'bg-rose-950/20 hover:bg-rose-900/30 border-rose-900/40 text-rose-400 hover:text-rose-300'
              }`}
            >
              <CalendarX className="w-4 h-4" />
              Unenrol from selected program
            </button>
          </div>
        )}
      </div>

      {/* Form Settings */}
      <div className="w-full bg-slate-900 border-y border-x-0 border-slate-800 p-4 space-y-4 shadow-sm rounded-none mt-2">
        <h3 className="text-lg font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2">
          <Pencil className="w-[18px] h-[18px]" /> {editingProgramId ? 'Edit Program' : 'Create Program'}
        </h3>

        <div className="space-y-1.5">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide">
            Program Name
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full bg-slate-950 border border-slate-850 rounded-none px-3 h-11 text-base font-semibold text-white focus:outline-none focus:border-indigo-500 font-sans"
            placeholder="e.g., Hypertrophy Push Pull Legs"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Custom Training Days Dropdown */}
          <div ref={daysDropdownRef} className="space-y-1.5 relative">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide">
              Training Days/Week
            </label>
            <button
              type="button"
              onClick={() => {
                setIsDaysDropdownOpen(!isDaysDropdownOpen);
                setIsDurationDropdownOpen(false);
              }}
              className="w-full bg-slate-950 border border-slate-850 rounded-none px-3 text-sm font-bold text-slate-300 focus:outline-none focus:border-indigo-500 h-11 flex items-center justify-between cursor-pointer hover:bg-slate-900 transition"
            >
              <span>{daysPerWeek} Days per week</span>
              <span className="text-[8px] text-slate-500">▼</span>
            </button>
            {isDaysDropdownOpen && (
              <div className="absolute left-0 right-0 top-16 bg-slate-950 border border-slate-800 rounded-none shadow-2xl z-50 overflow-y-auto max-h-60 py-1 font-sans">
                {[1, 2, 3, 4, 5, 6, 7].map(num => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => {
                      handleDaysPerWeekChange(num);
                      setIsDaysDropdownOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2.5 text-xs font-bold border-y border-transparent cursor-pointer transition ${
                      daysPerWeek === num
                        ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30'
                        : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                    }`}
                  >
                    {num} {num === 1 ? 'Day' : 'Days'} per week
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Custom Program Duration Dropdown */}
          <div ref={durationDropdownRef} className="space-y-1.5 relative">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide">
              Program Duration
            </label>
            <button
              type="button"
              onClick={() => {
                setIsDurationDropdownOpen(!isDurationDropdownOpen);
                setIsDaysDropdownOpen(false);
              }}
              className="w-full bg-slate-950 border border-slate-850 rounded-none px-3 text-sm font-bold text-slate-300 focus:outline-none focus:border-indigo-500 h-11 flex items-center justify-between cursor-pointer hover:bg-slate-900 transition"
            >
              <span>{`${durationWeeks} Weeks`}</span>
              <span className="text-[8px] text-slate-500">▼</span>
            </button>
            {isDurationDropdownOpen && (
              <div className="absolute left-0 right-0 top-16 bg-slate-950 border border-slate-800 rounded-none shadow-2xl z-50 overflow-y-auto max-h-60 py-1 font-sans">
                {((objective === 'Strength' && (algorithmId === 'strength_undulating' || !algorithmId))
                  ? [4, 8, 12]
                  : [4, 6, 8, 12]
                ).map(opt => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => {
                      setDurationWeeks(Number(opt));
                      setIsDurationDropdownOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2.5 text-xs font-bold border-y border-transparent cursor-pointer transition ${
                      durationWeeks === opt
                        ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30'
                        : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                    }`}
                  >
                    {`${opt} Weeks`}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Progression Algorithm Card Section */}
        <div className="border-t border-slate-850 pt-4 space-y-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-indigo-400 shrink-0" />
            <h4 className="text-[15.5px] sm:text-[16.5px] font-black text-indigo-400 uppercase tracking-widest">
              Progression & Periodisation
            </h4>
          </div>

          {/* Core Objective Switcher */}
          <div className="space-y-1.5">
            <div>
              <label className="block text-xs font-bold text-slate-300 tracking-normal">
                Training Goal
              </label>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Choose the main focus for this program.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 border border-slate-850">
              {(['Hypertrophy', 'Strength', 'Off'] as const).map((obj) => {
                const isActive = objective === obj;
                return (
                  <button
                    key={obj}
                    type="button"
                    onClick={() => {
                      setObjective(obj);
                      if (obj === 'Hypertrophy') {
                        setAlgorithmId('hypertrophy_linear');
                      } else if (obj === 'Strength') {
                        setAlgorithmId('strength_undulating');
                        if (durationWeeks === 6) {
                          setDurationWeeks(8);
                        }
                      } else {
                        setAlgorithmId('none');
                        setTargetProgressionMode('performance_led');
                      }
                    }}
                    className={`py-3 px-1 text-[12px] font-black uppercase tracking-wide border cursor-pointer text-center transition-all duration-150 flex items-center justify-center ${
                      isActive
                        ? 'bg-indigo-600 text-[#FBFAF8] border-indigo-500 shadow-md'
                        : 'bg-transparent text-slate-400 border-transparent hover:text-slate-200'
                    }`}
                  >
                    {obj === 'Off' ? (
                      <span className="flex flex-col items-center justify-center leading-tight">
                        <span className="leading-none">Off</span>
                        <span className={`text-[9px] font-bold normal-case mt-1 tracking-normal leading-none ${isActive ? 'text-[#FBFAF8]/80' : 'text-slate-500'}`}>
                          (Self-Directed)
                        </span>
                      </span>
                    ) : (
                      obj
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sub-Algorithm formula picker (Only if focus is NOT Off) */}
          {objective !== 'Off' && (
            <div className="space-y-2 animate-fadeIn">
              <div>
                <label className="block text-xs font-bold text-slate-300 tracking-normal">
                  Periodisation Method
                </label>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Choose how reps and target effort are structured across the weeks of your program.
                </p>
              </div>
              
              {objective === 'Hypertrophy' ? (
                <div className="grid grid-cols-2 gap-2">
                  <div
                    onClick={() => setAlgorithmId('hypertrophy_linear')}
                    className={`flex flex-col justify-between text-left p-3.5 border rounded-none transition-all cursor-pointer h-full ${
                      algorithmId === 'hypertrophy_linear'
                        ? 'bg-indigo-950/40 border-indigo-500/80 text-indigo-200 shadow-inner'
                        : 'bg-slate-950 border-slate-850 text-slate-400 hover:border-slate-800'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => setAlgorithmId('hypertrophy_linear')}
                            className="text-[12px] font-bold text-white tracking-wide hover:text-indigo-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer rounded-none text-left"
                          >
                            Wave Volume
                          </button>
                          <button
                            type="button"
                            aria-label="About Wave Volume"
                            onClick={(e) => openInfoModal('hypertrophy_linear', e)}
                            className="p-1 text-slate-400 hover:text-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer rounded-none flex items-center justify-center min-w-[28px] min-h-[28px]"
                          >
                            <Info className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                      <span className="block text-[11px] font-normal mt-1.5 leading-relaxed text-slate-400">
                        Alternates higher-rep (12–15) and lower-rep (6–12) weeks at RPE 8.0.
                      </span>
                    </div>
                  </div>

                  <div
                    onClick={() => setAlgorithmId('hypertrophy_step')}
                    className={`flex flex-col justify-between text-left p-3.5 border rounded-none transition-all cursor-pointer h-full ${
                      algorithmId === 'hypertrophy_step'
                        ? 'bg-indigo-950/40 border-indigo-500/80 text-indigo-200 shadow-inner'
                        : 'bg-slate-950 border-slate-850 text-slate-400 hover:border-slate-800'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => setAlgorithmId('hypertrophy_step')}
                            className="text-[12px] font-bold text-white tracking-wide hover:text-indigo-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer rounded-none text-left"
                          >
                            Step Loading
                          </button>
                          <button
                            type="button"
                            aria-label="About Step Loading"
                            onClick={(e) => openInfoModal('hypertrophy_step', e)}
                            className="p-1 text-slate-400 hover:text-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer rounded-none flex items-center justify-center min-w-[28px] min-h-[28px]"
                          >
                            <Info className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                      <span className="block text-[11px] font-normal mt-1.5 leading-relaxed text-slate-400">
                        Builds RPE through each 4-week block, finishing with a higher-rep week.
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <div
                    onClick={() => {
                      setAlgorithmId('strength_undulating');
                      if (durationWeeks === 6) {
                        setDurationWeeks(8);
                      }
                    }}
                    className={`flex flex-col justify-between text-left p-3.5 border rounded-none transition-all cursor-pointer h-full ${
                      algorithmId === 'strength_undulating'
                        ? 'bg-indigo-950/40 border-indigo-500/80 text-indigo-200 shadow-inner'
                        : 'bg-slate-950 border-slate-850 text-slate-400 hover:border-slate-800'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => {
                              setAlgorithmId('strength_undulating');
                              if (durationWeeks === 6) {
                                setDurationWeeks(8);
                              }
                            }}
                            className="text-[12px] font-bold text-white tracking-wide hover:text-indigo-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer rounded-none text-left"
                          >
                            Wave Strength
                          </button>
                          <button
                            type="button"
                            aria-label="About Wave Strength"
                            onClick={(e) => openInfoModal('strength_undulating', e)}
                            className="p-1 text-slate-400 hover:text-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer rounded-none flex items-center justify-center min-w-[28px] min-h-[28px]"
                          >
                            <Info className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                      <span className="block text-[11px] font-normal mt-1.5 leading-relaxed text-slate-400">
                        Progresses Main Movements through lower-rep phases and finishes with an RPE 10 peak single.
                      </span>
                    </div>
                  </div>

                  <div
                    onClick={() => setAlgorithmId('strength_linear')}
                    className={`flex flex-col justify-between text-left p-3.5 border rounded-none transition-all cursor-pointer h-full ${
                      algorithmId === 'strength_linear'
                        ? 'bg-indigo-950/40 border-indigo-500/80 text-indigo-200 shadow-inner'
                        : 'bg-slate-950 border-slate-850 text-slate-400 hover:border-slate-800'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => setAlgorithmId('strength_linear')}
                            className="text-[12px] font-bold text-white tracking-wide hover:text-indigo-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer rounded-none text-left"
                          >
                            Linear Periodisation
                          </button>
                          <button
                            type="button"
                            aria-label="About Linear Periodisation"
                            onClick={(e) => openInfoModal('strength_linear', e)}
                            className="p-1 text-slate-400 hover:text-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer rounded-none flex items-center justify-center min-w-[28px] min-h-[28px]"
                          >
                            <Info className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                      <span className="block text-[11px] font-normal mt-1.5 leading-relaxed text-slate-400">
                        Tapers reps from 8 to 1 while increasing target RPE from 7.0 to 10.0.
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {objective === 'Off' && (
            <div className="bg-slate-950 border border-slate-850 p-3 flex gap-2.5 items-start">
              <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                  Traditional Self-Directed Logging
                </span>
                <p className="text-[11px] text-slate-500 leading-normal">
                  No automated calculations will be applied. The application will pre-fill targets exactly from your previous logged workout values, allowing for organic self-regulated training.
                </p>
              </div>
            </div>
          )}

          {/* Workout Target Mode */}
          <div className="space-y-2">
            <div>
              <label className="block text-xs font-bold text-slate-300 tracking-normal">
                Workout Target Mode
              </label>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Choose how MetReps sets weight and repetition targets for future workouts.
              </p>
            </div>

            <div
              role="radiogroup"
              aria-label="Workout Target Mode"
              className="grid grid-cols-1 sm:grid-cols-2 gap-2"
            >
              {/* Periodisation Targets */}
              <div
                onClick={() => setTargetProgressionMode('performance_led')}
                className={`relative flex flex-col justify-between p-3.5 border rounded-none transition-all cursor-pointer h-full ${
                  targetProgressionMode === 'performance_led'
                    ? 'bg-indigo-950/40 border-indigo-500/80 text-indigo-200 shadow-inner'
                    : 'bg-slate-950 border-slate-850 text-slate-400 hover:border-slate-800'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={targetProgressionMode === 'performance_led'}
                        onClick={(e) => {
                          e.stopPropagation();
                          setTargetProgressionMode('performance_led');
                        }}
                        className="text-left font-bold text-white text-[12px] tracking-wide hover:text-indigo-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer rounded-none"
                      >
                        Periodisation Targets
                      </button>
                      <button
                        type="button"
                        aria-label="About Periodisation Targets"
                        onClick={(e) => openInfoModal('periodisation_targets', e)}
                        className="p-1 text-slate-400 hover:text-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer rounded-none flex items-center justify-center min-w-[28px] min-h-[28px]"
                      >
                        <Info className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                    {targetProgressionMode === 'performance_led' && (
                      <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0" aria-hidden="true" />
                    )}
                  </div>
                  <span className="block text-[11px] font-normal mt-1.5 leading-relaxed text-slate-400">
                    Applies your periodisation method without Coach making adaptive progression decisions.
                  </span>
                </div>
              </div>

              {/* MetReps Coach */}
              <div
                onClick={() => {
                  if (objective !== 'Off') {
                    setTargetProgressionMode('metreps_guided');
                  }
                }}
                className={`relative flex flex-col justify-between p-3.5 border rounded-none transition-all h-full ${
                  objective === 'Off'
                    ? 'opacity-40 border-slate-900 bg-slate-950 text-slate-500'
                    : targetProgressionMode === 'metreps_guided'
                    ? 'bg-indigo-950/40 border-indigo-500/80 text-indigo-200 shadow-inner cursor-pointer'
                    : 'bg-slate-950 border-slate-850 text-slate-400 hover:border-slate-800 cursor-pointer'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={targetProgressionMode === 'metreps_guided'}
                        aria-disabled={objective === 'Off'}
                        disabled={objective === 'Off'}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (objective !== 'Off') {
                            setTargetProgressionMode('metreps_guided');
                          }
                        }}
                        className={`text-left font-bold text-[12px] tracking-wide focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded-none ${
                          objective === 'Off'
                            ? 'text-slate-500 cursor-not-allowed'
                            : 'text-white hover:text-indigo-200 cursor-pointer'
                        }`}
                      >
                        MetReps Coach
                      </button>
                      <button
                        type="button"
                        aria-label="About MetReps Coach"
                        onClick={(e) => openInfoModal('metreps_coach', e)}
                        className="p-1 text-slate-400 hover:text-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer rounded-none flex items-center justify-center min-w-[28px] min-h-[28px]"
                      >
                        <Info className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                    {targetProgressionMode === 'metreps_guided' && objective !== 'Off' && (
                      <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0" aria-hidden="true" />
                    )}
                  </div>
                  <span className="block text-[11px] font-normal mt-1.5 leading-relaxed text-slate-400">
                    Reviews completed workouts and can progress, hold or adjust future weight and repetition targets.
                  </span>
                </div>
              </div>
            </div>

            {objective === 'Off' && (
              <p className="text-[11px] text-amber-400/90 font-mono">
                MetReps Coach is available for Hypertrophy and Strength programs.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Program Detail Creator */}
      <div className="space-y-3 mt-[19px]">
        <div className="flex items-center justify-between px-4">
          <h3 className="text-lg font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2">
            <Dumbbell className="w-[18px] h-[18px]" /> Edit Program Exercises
          </h3>
        </div>

        {/* Day selection tabs */}
        <div className="flex flex-wrap gap-1.5 px-4">
          {Array.from({ length: daysPerWeek }).map((_, idx) => {
            const dayNum = idx + 1;
            const isActive = activeTabDay === dayNum;
            const dayLabel = WEEKDAYS.find(w => w.value === assignedWeekdays[dayNum])?.short || 'Mon';
            return (
              <button
                key={dayNum}
                onClick={() => setActiveTabDay(dayNum)}
                className={`px-3.5 py-2 rounded-none text-xs font-black transition flex-none border text-center flex flex-col items-center min-w-[76px] ${
                  isActive
                    ? 'bg-indigo-600 border-indigo-500 text-[#FBFAF8]'
                    : 'bg-slate-900 border-slate-850 text-slate-400 hover:text-[#FBFAF8]'
                }`}
              >
                <span>Day {dayNum}</span>
                <span className={`text-[9px] font-mono mt-0.5 ${isActive ? 'text-[#FBFAF8]/80 font-extrabold' : 'text-indigo-400/80 font-bold'}`}>
                  {dayLabel}
                </span>
              </button>
            );
          })}
        </div>

        {/* Day exercise cards list */}
        <div className="w-full bg-slate-900 border-y border-x-0 border-slate-800 p-4 space-y-4 shadow-inner rounded-none">
          <div className="flex justify-between items-center mb-2 gap-4">
            <div className="flex flex-col">
              <h4 className="text-xs font-black text-slate-300 uppercase tracking-wide">
                Exercises for Day {activeTabDay}
              </h4>
              <div ref={weekdayDropdownRef} className="flex items-center gap-1.5 mt-1 relative">
                <span className="text-[9px] text-slate-500 font-extrabold uppercase tracking-wide">Weekday:</span>
                <button
                  type="button"
                  onClick={() => setIsWeekdayDropdownOpen(!isWeekdayDropdownOpen)}
                  className="bg-slate-950 border border-slate-800 rounded-none px-2 py-0.5 text-[10px] font-bold text-indigo-400 focus:outline-none focus:border-indigo-500 cursor-pointer h-6 flex items-center gap-1.5 hover:bg-slate-900 transition min-w-[76px] justify-between"
                >
                  <span>{WEEKDAYS.find(w => w.value === (assignedWeekdays[activeTabDay] ?? 0))?.label || 'Monday'}</span>
                  <span className="text-[6px] text-slate-500">▼</span>
                </button>
                {isWeekdayDropdownOpen && (
                  <div className="absolute left-[54px] top-7 bg-slate-950 border border-slate-800 rounded-none shadow-2xl z-50 py-1 font-sans w-32">
                    {WEEKDAYS.map(w => (
                      <button
                        key={w.value}
                        type="button"
                        onClick={() => {
                          setAssignedWeekdays(prev => ({
                            ...prev,
                            [activeTabDay]: w.value,
                          }));
                          setIsWeekdayDropdownOpen(false);
                        }}
                        className={`w-full text-left px-3 py-1.5 text-[10px] font-bold border-y border-transparent cursor-pointer transition ${
                          (assignedWeekdays[activeTabDay] ?? 0) === w.value
                            ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30'
                            : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                        }`}
                      >
                        {w.label
                      }</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <span className="text-[10px] text-slate-500 font-bold bg-slate-950 px-2 py-1 rounded-none border border-slate-850 font-mono self-start shrink-0">
              {(exercisesByDay[activeTabDay] || []).length} Exercises
            </span>
          </div>

          {(exercisesByDay[activeTabDay] || []).length === 0 ? (
            <p className="text-xs text-slate-500 italic text-center py-8 bg-slate-950/40 border border-slate-850 rounded-none">
              No exercises added to Day {activeTabDay} yet. Click add below.
            </p>
          ) : (
            <div className="space-y-3">
              {(exercisesByDay[activeTabDay] || []).map((ex, exIdx) => (
                <div
                  key={exIdx}
                  className="bg-slate-950/70 border border-slate-850 rounded-none p-3.5 flex items-center gap-3"
                >
                  <div className="grid grid-cols-12 gap-2 flex-1 min-w-0">
                    {/* Exercise Name */}
                    <button
                      type="button"
                      onClick={() => openSelectorFor(activeTabDay, exIdx)}
                      className="col-span-8 text-left focus:outline-none group/btn cursor-pointer"
                    >
                      <label className="block text-[8px] font-extrabold text-slate-500 uppercase tracking-wider mb-1 cursor-pointer">Name</label>
                      <div className="w-full bg-slate-900 border border-slate-800 rounded-none px-2.5 h-10 text-xs font-semibold text-white flex items-center justify-between group-hover/btn:border-indigo-500/50 transition duration-150 font-sans truncate">
                        <span className="truncate">{ex.name}</span>
                      </div>
                    </button>
                    {/* Muscle */}
                    <button
                      type="button"
                      onClick={() => openSelectorFor(activeTabDay, exIdx)}
                      className="col-span-4 text-center focus:outline-none group/btn cursor-pointer"
                    >
                      <label className="block text-[8px] font-extrabold text-slate-500 uppercase tracking-wider mb-1 cursor-pointer text-center w-full">Muscle</label>
                      <div className="w-full bg-slate-900 border border-slate-800 rounded-none px-2.5 h-10 text-xs font-semibold text-slate-300 flex items-center justify-center group-hover/btn:border-indigo-500/50 transition duration-150 font-sans truncate">
                        <span className="truncate">{ex.muscleGroup}</span>
                      </div>
                    </button>
                  </div>

                  {/* Actions: Reorder, edit & remove */}
                  <div className="flex items-center gap-0.5 shrink-0 self-end pb-2">
                    <button
                      type="button"
                      onClick={() => handleMoveExercise(activeTabDay, exIdx, -1)}
                      disabled={exIdx === 0}
                      className="p-1 text-indigo-400 hover:text-indigo-300 transition cursor-pointer disabled:text-slate-700 disabled:cursor-not-allowed disabled:hover:text-slate-700"
                      title={`Move ${ex.name} up`}
                      aria-label={`Move ${ex.name} up`}
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveExercise(activeTabDay, exIdx, 1)}
                      disabled={exIdx === (exercisesByDay[activeTabDay] || []).length - 1}
                      className="p-1 text-indigo-400 hover:text-indigo-300 transition cursor-pointer disabled:text-slate-700 disabled:cursor-not-allowed disabled:hover:text-slate-700"
                      title={`Move ${ex.name} down`}
                      aria-label={`Move ${ex.name} down`}
                    >
                      <ArrowDown className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openSelectorFor(activeTabDay, exIdx)}
                      className="p-1 text-indigo-400 hover:text-indigo-300 transition cursor-pointer"
                      title="Browse Library"
                      aria-label={`Edit ${ex.name}`}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteExerciseFromDay(activeTabDay, exIdx)}
                      className="p-1 text-slate-500 hover:text-rose-400 transition cursor-pointer"
                      title="Delete exercise template"
                      aria-label={`Delete ${ex.name}`}
                    >
                      <Trash2 className="w-4.5 h-4.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => handleAddExerciseToDayDirectly(activeTabDay)}
            className="w-full bg-slate-950 hover:bg-slate-850 text-slate-300 hover:text-white border border-slate-850 rounded-none py-3.5 text-xs font-bold transition flex items-center justify-center gap-1.5 uppercase tracking-wide"
          >
            <Plus className="w-4 h-4" /> Add exercise
          </button>
        </div>
      </div>

      <ExerciseSelectorModal
        isOpen={isSelectorOpen}
        onClose={() => {
          setIsSelectorOpen(false);
          setSelectorTarget(null);
        }}
        onSelect={handleSelectExercise}
        confirmLabel={selectorTarget?.exIdx !== null ? 'Replace Exercise' : 'Add to Workout'}
      />

      {showSaveChoices && pendingSaveProgram && (
        <div className="fixed inset-0 z-[100] bg-slate-950/80 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="save-program-title" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowSaveChoices(false); }}>
          <div className="w-full max-w-sm bg-slate-900 border border-slate-700 p-5 shadow-2xl">
            <h2 id="save-program-title" className="text-base font-black text-white">Save program</h2>
            <p className="text-xs text-slate-400 mt-1 mb-4">Choose whether to keep this design for later or enrol now.</p>
            <div className="space-y-2">
              <button autoFocus className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm p-3" onClick={() => { const p = pendingSaveProgram; setShowSaveChoices(false); setPendingSaveProgram(null); attemptSaveProgram(p, false); }}>
                {editingProgramId ? 'Save Changes' : 'Save for Later'}
              </button>
              {(!editingProgramId || editingProgramId !== currentProgramId) && (
                <button className="w-full bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-sm p-3" onClick={() => { const p = pendingSaveProgram; setShowSaveChoices(false); setPendingSaveProgram(null); requestEnrolment(p); }}>
                  {editingProgramId ? 'Save Changes & Enrol' : 'Save & Enrol'}
                </button>
              )}
              <button className="w-full border border-slate-700 text-slate-200 font-bold text-sm p-3" onClick={() => setShowSaveChoices(false)}>Keep Editing</button>
              <button className="w-full text-rose-400 font-bold text-sm p-2" onClick={() => { setShowSaveChoices(false); setPendingSaveProgram(null); onClose(); }}>
                {editingProgramId ? 'Discard Changes' : 'Discard Draft'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmationModal
        visible={pendingBuilderNavigation !== null}
        title="Discard unsaved changes?"
        message="You have unsaved Program Builder changes. Keep editing, or discard them and continue."
        confirmLabel="Discard Changes"
        cancelLabel="Keep Editing"
        confirmVariant="danger"
        onConfirm={() => { const action = pendingBuilderNavigation; setPendingBuilderNavigation(null); action?.(); }}
        onCancel={() => setPendingBuilderNavigation(null)}
      />

      <ConfirmationModal
        visible={alertMsg !== null}
        title={alertMsg?.includes('saved') ? 'Program saved' : 'Program Setup Error'}
        message={alertMsg || ''}
        confirmLabel="OK"
        onConfirm={() => setAlertMsg(null)}
        onCancel={() => setAlertMsg(null)}
      />

      <ConfirmationModal
        visible={swapTarget !== null}
        title="Swap active program"
        message="Swap to alternate program? Save the program to make it the active program."
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={handleConfirmSwap}
        onCancel={() => setSwapTarget(null)}
      />

      <ConfirmationModal
        visible={showOverwriteConfirm}
        title="Overwrite Program?"
        message={`Are you sure you want to overwrite '${pendingSaveProgram?.name || name}' with these updated exercises? All of your previously completed and logged historical workout data in your diary and logs will remain 100% intact.`}
        confirmLabel="Yes, Overwrite"
        cancelLabel="No, Cancel"
        confirmVariant="primary"
        onConfirm={() => {
          const progToSave = pendingSaveProgram;
          setShowOverwriteConfirm(false);
          setPendingSaveProgram(null);
          if (progToSave) {
            attemptSaveProgram(progToSave);
          }
        }}
        onCancel={() => {
          setShowOverwriteConfirm(false);
          setPendingSaveProgram(null);
        }}
      />

      <ConfirmationModal
        visible={showUnenrollConfirm}
        title="Unenrol from Program?"
        message={`Are you sure you want to unenrol from '${enrolledProgramName || 'your active program'}'? This will remove future scheduled program workouts from your calendar, but all of your completed logs, historical workout entries, and weights are 100% safe and intact.`}
        confirmLabel="Yes, Unenrol"
        cancelLabel="No, Stay Enrolled"
        confirmVariant="danger"
        onConfirm={handleConfirmUnenroll}
        onCancel={() => setShowUnenrollConfirm(false)}
      />

      <ConfirmationModal
        visible={pendingSwitchProgram !== null}
        title="Switch Active Program?"
        message={`You are currently enrolled in an active program ('${enrolledProgramName || 'your active program'}'). Saving and commencing '${pendingSwitchProgram?.name || 'this program'}' will unenrol you from your current active program and replace future scheduled workouts on your calendar (your completed history is 100% safe). Would you like to unenrol and switch?`}
        confirmLabel="Unenrol & Switch"
        cancelLabel="Keep Current Program"
        confirmVariant="danger"
        onConfirm={handleConfirmSwitch}
        onCancel={() => setPendingSwitchProgram(null)}
      />

      <ConfirmationModal
        visible={showCommencedModal}
        title="Program saved and enrolled"
        message={`"${commencedProgramName}" is now active! We've successfully scheduled your workouts on your training calendar.`}
        confirmLabel="Let's Train!"
        showCancel={false}
        confirmVariant="primary"
        onConfirm={() => {
          setShowCommencedModal(false);
          onSave();
        }}
        onCancel={() => {
          setShowCommencedModal(false);
          onSave();
        }}
      />

      <ProgramDraftConflictModal
        isOpen={showDraftConflictModal}
        themeId={themeId}
        onKeepWorkout={() => {
          setShowDraftConflictModal(false);
          setPendingDraftConflictProgram(null);
        }}
        onDiscardAndSave={() => {
          const prog = pendingDraftConflictProgram;
          setShowDraftConflictModal(false);
          setPendingDraftConflictProgram(null);
          if (prog) {
            performDirectSaveProgram(prog, true, pendingEnrolment);
            setPendingEnrolment(false);
          }
        }}
      />

      {/* Information Dialog */}
      {activeInfoModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="progression-info-title"
          aria-describedby="progression-info-desc"
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={closeInfoModal}
        >
          <div
            className="bg-slate-900 border border-slate-800 rounded-none w-full max-w-md max-h-[90vh] overflow-y-auto flex flex-col shadow-2xl shadow-indigo-950/40 p-5 font-sans animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-850">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-none border border-indigo-500/20 bg-indigo-500/10 text-indigo-400">
                  <Info className="w-4 h-4" aria-hidden="true" />
                </div>
                <h3
                  id="progression-info-title"
                  className="text-sm font-bold text-white tracking-wide"
                >
                  {INFO_DIALOG_CONTENTS[activeInfoModal].title}
                </h3>
              </div>
              <button
                ref={closeBtnRef}
                type="button"
                aria-label="Close"
                onClick={closeInfoModal}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 transition rounded-none focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <div className="py-4 space-y-3">
              {INFO_DIALOG_CONTENTS[activeInfoModal].secondaryHeading && (
                <h4 className="text-[11px] font-black uppercase tracking-wider text-indigo-400 font-mono">
                  {INFO_DIALOG_CONTENTS[activeInfoModal].secondaryHeading}
                </h4>
              )}
              <p
                id="progression-info-desc"
                className="text-xs text-slate-300 leading-relaxed font-sans"
              >
                {INFO_DIALOG_CONTENTS[activeInfoModal].body}
              </p>
              {INFO_DIALOG_CONTENTS[activeInfoModal].note && (
                <p className="text-[11px] text-indigo-400/90 font-mono pt-1">
                  {INFO_DIALOG_CONTENTS[activeInfoModal].note}
                </p>
              )}
            </div>

            <div className="pt-3 border-t border-slate-850 flex justify-end">
              <button
                type="button"
                aria-label="Close"
                onClick={closeInfoModal}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-xs font-bold rounded-none transition focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
