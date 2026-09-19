/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Dumbbell, Plus, Minus, Trash2, Check, ArrowLeft, Clock, Timer, Flame, Smile, Droplet, Coffee, Award, ChevronDown, ChevronUp, BookOpen, Pencil, History, Info, MoreVertical, Link, Lock, Unlock, ClipboardCheck, Gamepad2, Compass, Activity, X, AlertTriangle } from 'lucide-react';
import { Program, WorkoutLog, ExerciseEntry, SetEntry, WeightUnit, DailyRecoveryMetrics, HydrationLevel, mapHydrationToLiters, mapLitersToHydration, BodyweightSnapshot, RestInterval, RestTimerStartContext } from '../types';
import { storage, PREBUILT_TEMPLATES } from '../lib/storage';
import { saveActiveWorkoutDraft, clearActiveWorkoutDraft } from '../lib/navigationGuard';
import { getTodayLocalDateString, formatLocalDateDisplay, formatLocalTimeDisplay } from '../lib/dateUtils';
import {
  createSessionExerciseRegistry,
  clearSessionExerciseRegistry,
  appendSessionExerciseRegistryEntry,
  replaceSessionExerciseRegistryEntry,
  removeSessionExerciseRegistryEntry,
  moveSessionExerciseRegistryEntry,
  markSessionExerciseStructuralMutation,
  updateSessionExerciseEvaluationState,
  type SessionExerciseRegistry,
} from '../lib/guidedSessionExerciseRegistry';
import { resolveProgramProgressionMode } from '../lib/programProgressionMode';
import {
  orchestrateGuidedWorkoutExercises,
  type GuidedWorkoutIntegrationInput,
  type GuidedWorkoutIntegrationItem,
  type GuidedWorkoutIntegrationContext,
  type GuidedWorkoutIntegrationEntryResult,
} from '../lib/guidedWorkoutIntegration';
import { ExerciseStructuralMutationReason } from '../lib/guidedWorkoutOrchestrator';
import {
  ActivePrescriptionBoundary,
  parseActivePrescriptionBoundary,
  createFreshPrescriptionBoundary,
  resolveFreshSessionTargetDate,
} from '../lib/workoutDraftBoundary';
import { ExerciseSelectorModal } from './ExerciseSelectorModal';
import { ConfirmationModal } from './ConfirmationModal';
import { WarmupIcon } from './WarmupIcon';
import { calculateObjectiveSets, calculateAddedSetTarget, roundToNearest25, getRTSMultiplier, findMatchingTemplateExercise, syncAddedSetStructureToProgramDay, extractHistoricalBaselineE1RM, extractTemplateBaselineE1RM, getExerciseOccurrenceOrdinal, PrescriptionTargetChronology, AddedSetCommittedEvidenceEntry } from '../lib/objectiveMath';
import { generateAssistedWarmupTargets, convertWeightUnit } from '../lib/assistedLoadMath';
import {
  validateBodyweightSnapshot,
  cloneBodyweightSnapshot,
  reconcileSessionSnapshot,
  resolveSessionBodyweightInUnit,
  generateBodyweightWarmupTargets,
} from '../lib/bodyweightSessionMath';
import {
  validateAndGenerateAutoWarmup,
  AUTO_WARMUP_TOAST_DURATION_MS,
  AUTO_WARMUP_REPLACE_CONFIRMATION,
} from '../lib/autoWarmupValidation';
import {
  calculateEquivalentWorkingWeight,
  solveEquivalentRepetitions,
  isCalculatorSupportedForModality,
  VALID_CALCULATOR_RPES,
  CALCULATOR_REP_PRESETS,
  validateManualRepsEntry,
  validateManualWeightEntry,
  stepRepsValue,
  stepWeightValue,
} from '../lib/repWeightCalculator';
import { isEligibleStrengthMainMovement, getEligibleMainMovementCount, updateProgramDayMainMovement } from '../lib/programMetadata';
import { useModalHistory } from '../lib/useModalHistory';
import {
  prepareExercisesForSave,
  remapAfterExerciseDelete,
  remapAfterSetDelete,
  remapAfterExerciseReplace,
  remapAfterExerciseMove,
  remapAfterSetMove,
  remapAfterSetInsert,
  remapAfterWarmupChange,
} from '../lib/workoutCompletion';
import {
  isValidRestIntervalDuration,
  getLastCompletedWorkingSetNumber,
  createRestInterval,
  parseRestStartContext,
} from '../lib/restTimerMath';
import {
  PrescribedTargetSnapshotMap,
  CommittedLiveEvidenceMap,
  LiveAdjustedSetMap,
  capturePrescribedSnapshotsFromExercises,
  createCommittedLiveEvidenceValue,
  prepareLiveAdjustmentParams,
  applyLiveAdjustmentResult,
  canRestorePlannedTargets,
  restorePlannedTargetsForExercise,
  getWorkingSetRowIndex,
  deriveWorkingSetOrdinal,
  shouldShowLowRPEExplanation,
  scheduleToastNotification,
  cleanupToastNotification,
  ToastTimerHandle,
  LIVE_ADJUSTMENT_SUCCESS_TOAST_DURATION_MS,
  DEFAULT_TOAST_DURATION_MS,
  LOW_RPE_EXPLANATION_TOAST_DURATION_MS,
  LIVE_ADJUSTMENT_SUCCESS_MESSAGE,
  LOW_RPE_EXPLANATION_MESSAGE,
} from '../lib/liveAdjustmentSession';
import { calculateLiveSetAdjustments } from '../lib/liveAdjustmentMath';
import type { FatiguePriorProfile } from '../lib/setDistribution';
import {
  canSkipSet,
  canUnskipSet,
  isValidSkippedSuffix,
  hasSkippedWorkingSets,
} from '../lib/setSkipRules';
import {
  formatGuideRowKey,
  isRowEligibleForGuide,
  findNextEligibleGuideRow,
  reconcileGuideAfterSetDelete,
  reconcileGuideAfterExerciseDelete,
  reconcileGuideAfterSetSkip,
  reconcileGuideAfterExerciseSkip,
  reconcileGuideAfterExerciseMove,
  reconcileGuideAfterSetMove,
  reconcileGuideAfterWarmupChange,
  reconcileGuideAfterExerciseReplace,
  resolveInitialGuideKey,
} from '../lib/currentSetGuideMath';

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

export function resolveEffectiveAlgorithmPolicyB(
  objective: 'Off' | 'Hypertrophy' | 'Strength' | 'Deload',
  rawAlgorithmId?: string | null
): string {
  if (objective === 'Hypertrophy') {
    if (rawAlgorithmId === 'hypertrophy_linear' || rawAlgorithmId === 'hypertrophy_step') {
      return rawAlgorithmId;
    }
    if (rawAlgorithmId === undefined || rawAlgorithmId === null || rawAlgorithmId === 'none' || rawAlgorithmId === '') {
      return 'hypertrophy_linear';
    }
    return rawAlgorithmId;
  }

  if (objective === 'Strength') {
    if (rawAlgorithmId === 'strength_undulating' || rawAlgorithmId === 'strength_linear') {
      return rawAlgorithmId;
    }
    if (rawAlgorithmId === undefined || rawAlgorithmId === null || rawAlgorithmId === 'none' || rawAlgorithmId === '') {
      return 'strength_undulating';
    }
    return rawAlgorithmId;
  }

  return rawAlgorithmId || 'none';
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
  themeId?: string;
}

export function WorkoutLogger({ initialParams, onClose, onSave, themeId: propThemeId }: WorkoutLoggerProps) {
  // Configuration
  const themeId = propThemeId || React.useMemo(() => storage.getTheme(), []);
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
  const redoFromLogId = initialParams?.redoFromLogId || null;
  const targetDateParam = initialParams?.date || null;
  
  const [workoutDate, setWorkoutDate] = useState<string>(() => {
    try {
      const draftStr = localStorage.getItem('metreps_workout_draft');
      if (draftStr) {
        const draft = JSON.parse(draftStr);
        const matches = editLogId
          ? (draft.editLogId ? String(draft.editLogId) === String(editLogId) : false)
          : (!draft.editLogId && (isOneOff
              ? draft.isOneOff === true
              : (draft.programId === programId && String(draft.weekNum) === String(weekNum) && String(draft.dayNum) === String(dayNum))));
        if (matches && draft.dateStr) {
          return draft.dateStr;
        }
      }
    } catch (_) {}
    return existingLog ? existingLog.date : (initialParams?.date || getTodayLocalDateString());
  });
  const dateStr = workoutDate;

  const scheduledDate = existingLog ? existingLog.scheduledDate : (initialParams?.scheduledDate || null);

  const activeProg = React.useMemo(() => {
    if (!programId) return null;
    return storage.getPrograms().find(p => p.id === programId) || PREBUILT_TEMPLATES.find(p => p.id === programId) || null;
  }, [programId]);

  const algoDetails = React.useMemo(() => {
    const algoId = activeProg?.algorithmId;
    switch (algoId) {
      case 'hypertrophy_linear':
        return { short: 'WV', name: 'Wave Volume', desc: 'Alternates weekly between higher-rep (12–15) and lower-rep (6–12) sessions at RPE 8.0.' };
      case 'hypertrophy_step':
        return { short: 'SL', name: 'Step Loading', desc: 'Builds RPE through each 4-week block, finishing with a higher-rep week before the next heavier block.' };
      case 'strength_undulating':
        return { short: 'DUP', name: 'Wave Strength', desc: 'Progresses designated Main Movements through lower-rep phases and finishes with an RPE 10 peak single.' };
      case 'strength_linear':
        return { short: 'LP', name: 'Linear Periodisation', desc: 'Gradually reduces Main Movement targets from 8 reps to 1 while increasing RPE from 7.0 to 10.0.' };
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
  const [exercises, setExercises] = useState<ExerciseEntry[]>(() => {
    try {
      const draftStr = localStorage.getItem('metreps_workout_draft');
      if (draftStr) {
        const draft = JSON.parse(draftStr);
        const matches = editLogId
          ? (draft.editLogId ? String(draft.editLogId) === String(editLogId) : false)
          : (!draft.editLogId && (isOneOff
              ? draft.isOneOff === true
              : (draft.programId === programId && String(draft.weekNum) === String(weekNum) && String(draft.dayNum) === String(dayNum))));
        if (matches && draft.exercises) return draft.exercises;
      }
    } catch (_) {}

    if (existingLog && existingLog.exercises) return existingLog.exercises;
    if (!isOneOff) {
      const active = (programId ? storage.getPrograms().find(p => p.id === programId) : null) || storage.getCurrentProgram();
      if (active?.exercisesByDay?.[Number(dayNum)]) {
        return JSON.parse(JSON.stringify(active.exercisesByDay[Number(dayNum)]));
      }
    }
    return [];
  });
  const [unit, setUnit] = useState<WeightUnit>(() => storage.getWeightUnit());

  // Session Bodyweight Snapshot State (tri-state: BodyweightSnapshot | null | undefined)
  const [bodyweightSnapshot, setBodyweightSnapshot] = useState<BodyweightSnapshot | null | undefined>(() => {
    if (editLogId && existingLog) {
      return existingLog.bodyweightSnapshot !== undefined
        ? cloneBodyweightSnapshot(existingLog.bodyweightSnapshot)
        : undefined;
    }

    const settingsBw = storage.getBodyweightWithUnit();
    const prevLogs = storage.getWorkoutLogs();

    try {
      const draftStr = localStorage.getItem('metreps_workout_draft');
      if (draftStr) {
        const draft = JSON.parse(draftStr);
        const matches = editLogId
          ? (draft.editLogId ? String(draft.editLogId) === String(editLogId) : false)
          : (!draft.editLogId && (isOneOff
              ? draft.isOneOff === true
              : (draft.programId === programId && String(draft.weekNum) === String(weekNum) && String(draft.dayNum) === String(dayNum))));
        if (matches && 'bodyweightSnapshot' in draft) {
          const validatedDraft = draft.bodyweightSnapshot === null ? null : validateBodyweightSnapshot(draft.bodyweightSnapshot);
          return reconcileSessionSnapshot({
            draftSnapshot: validatedDraft,
            settingsSnapshot: settingsBw,
            isEditMode: !!(editLogId && existingLog),
            previousLogs: prevLogs,
          });
        }
      }
    } catch (_) {}

    return reconcileSessionSnapshot({
      settingsSnapshot: settingsBw,
      isEditMode: false,
      previousLogs: prevLogs,
    });
  });

  const [sessionBwInputString, setSessionBwInputString] = useState<string | null>(null);

  const sessionBodyweightInActiveUnit = React.useMemo(() => {
    return resolveSessionBodyweightInUnit(bodyweightSnapshot, unit);
  }, [bodyweightSnapshot, unit]);

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
            ex => !ex.isSkipped && ex.name.trim().toLowerCase() === exerciseName.trim().toLowerCase()
          );
          if (matchedEx && matchedEx.sets && matchedEx.sets.length > 0) {
            return matchedEx.sets.map(s => ({
              setNumber: s.setNumber,
              weight: s.weight,
              reps: s.reps,
              rpe: s.rpe,
              form: s.form,
              comment: s.comment,
              isWarmup: s.isWarmup,
              isDropSet: s.isDropSet,
              dropSubSets: s.dropSubSets ? s.dropSubSets.map(ds => ({ weight: ds.weight, reps: ds.reps })) : null
            }));
          }
        }
      }

      // Fallback to any program logs or one-off logs in database
      for (const log of sortedLogs) {
        const matchedEx = log.exercises.find(
          ex => !ex.isSkipped && ex.name.trim().toLowerCase() === exerciseName.trim().toLowerCase()
        );
        if (matchedEx && matchedEx.sets && matchedEx.sets.length > 0) {
          return matchedEx.sets.map(s => ({
            setNumber: s.setNumber,
            weight: s.weight,
            reps: s.reps,
            rpe: s.rpe,
            form: s.form,
            comment: s.comment,
            isWarmup: s.isWarmup,
            isDropSet: s.isDropSet,
            dropSubSets: s.dropSubSets ? s.dropSubSets.map(ds => ({ weight: ds.weight, reps: ds.reps })) : null
          }));
        }
      }
    } catch (err) {
      console.error('Error fetching previous sets:', err);
    }
    return null;
  };

  const handleSelectExercise = (selectedList: { name: string; category: string; modality?: 'weighted' | 'bodyweight' | 'assisted' | 'distance' | 'timed' | 'distance_loaded'; exerciseKey?: string }[]) => {
    if (selectedList.length === 0) return;

    const activeProg = programId ? storage.getPrograms().find(p => p.id === programId) : null;
    const programDuration = activeProg && activeProg.programDuration !== '∞' ? Number(activeProg.programDuration) : 8;

    if (selectorTargetIdx === -1) {
      const currentRegistry = sessionExerciseRegistryRef.current;
      if (!currentRegistry || currentRegistry.entries.length !== exercises.length) {
        return;
      }

      // Create new exercise items
      const newItems: ExerciseEntry[] = selectedList.map(item => {
        const prevSets = getPreviousSetsForExercise(item.name);
        return {
          name: item.name,
          muscleGroup: item.category,
          modality: item.modality || 'weighted',
          ...(item.exerciseKey ? { exerciseKey: item.exerciseKey } : {}),
          sets: prevSets || [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' as const }],
        };
      });

      let stagedAppendedRegistry = currentRegistry;
      for (let i = 0; i < newItems.length; i++) {
        const op = appendSessionExerciseRegistryEntry(stagedAppendedRegistry, 'user_added_library');
        if (!op.applied) return;
        stagedAppendedRegistry = op.registry;
      }

      const isEligibleGuidedAddition =
        Boolean(activeProg) &&
        resolveProgramProgressionMode(activeProg) === 'metreps_guided' &&
        (objective === 'Hypertrophy' || objective === 'Strength') &&
        !editLogId &&
        !redoFromLogId &&
        !isOneOff &&
        Boolean(activeProg?.exercisesByDay?.[Number(dayNum)]) &&
        currentRegistry.entries.length === exercises.length;

      if (isEligibleGuidedAddition && activeProg) {
        const templates: ExerciseEntry[] = activeProg.exercisesByDay[Number(dayNum)] || [];

        const storedPrograms = storage.getPrograms();
        const programsList = !storedPrograms.some(p => p.id === activeProg.id)
          ? [...storedPrograms, activeProg]
          : storedPrograms;

        const guidedContext: GuidedWorkoutIntegrationContext = {
          program: activeProg,
          programs: programsList,
          historicalLogs: storage.getWorkoutLogs(),
          boundary: activePrescriptionBoundaryRef.current,
          sessionKind: {
            type: 'active_program_session',
            scheduledDate: scheduledDate || undefined,
            weekNum: Number(weekNum),
          },
          activeUnit: unit,
          bodyweightSnapshot: bodyweightSnapshot ?? null,
          objective,
          weekNum: Number(weekNum),
          programDuration,
          dayNum: dayNum !== undefined && dayNum !== null ? String(dayNum) : null,
          targetDate: activePrescriptionBoundaryRef.current?.prescriptionTargetDate ?? dateStr ?? null,
          targetLogId: editLogId || null,
        };

        const guidedItems: GuidedWorkoutIntegrationItem[] = newItems.map((ex, i) => {
          const globalIndex = exercises.length + i;
          const stagedEntry = stagedAppendedRegistry.entries[globalIndex];
          const templateEx = findMatchingTemplateExercise(ex, templates, globalIndex);

          return {
            exercise: ex,
            exerciseIndex: globalIndex,
            templateExercise: templateEx,
            lifecycleEvidence: {
              originProvenance: stagedEntry.originProvenance,
              isHistoricalEdit: false,
              isRedoSession: false,
              isRestoredFromDraft: false,
              evaluationState: stagedEntry.evaluationState,
              userTouchedSetKeys: new Set<string>(),
              checkedSetKeys: new Set<string>(),
              skippedSetKeys: new Set<string>(),
              hasCommittedLiveEvidence: false,
              hasLiveAdjustedSets: false,
              structuralMutationReason: stagedEntry.structuralMutationReason,
              isStructurallyModified: false,
            },
          };
        });

        let guidedResults: readonly GuidedWorkoutIntegrationEntryResult[] | null = null;
        try {
          guidedResults = orchestrateGuidedWorkoutExercises({
            context: guidedContext,
            items: guidedItems,
          });
        } catch (_) {
          guidedResults = null;
        }

        let validationPassed = false;
        if (Array.isArray(guidedResults) && guidedResults.length === newItems.length) {
          validationPassed = true;
          const seenIndices = new Set<number>();
          for (let i = 0; i < guidedResults.length; i++) {
            const entry = guidedResults[i];
            const expectedGlobalIdx = exercises.length + i;
            if (
              !entry ||
              typeof entry.exerciseIndex !== 'number' ||
              !Number.isInteger(entry.exerciseIndex) ||
              entry.exerciseIndex < exercises.length ||
              entry.exerciseIndex >= exercises.length + newItems.length ||
              entry.exerciseIndex !== expectedGlobalIdx ||
              seenIndices.has(entry.exerciseIndex) ||
              !entry.result ||
              !entry.result.exercise ||
              !Array.isArray(entry.result.appliedSets)
            ) {
              validationPassed = false;
              break;
            }
            seenIndices.add(entry.exerciseIndex);
          }
          if (seenIndices.size !== newItems.length) {
            validationPassed = false;
          }
        }

        let stagedEvaluatedRegistry: SessionExerciseRegistry = stagedAppendedRegistry;
        let stagingSuccess = false;
        const nextGuidedAddedExercises: ExerciseEntry[] = [];

        if (validationPassed && guidedResults) {
          stagingSuccess = true;
          for (let i = 0; i < guidedResults.length; i++) {
            const item = guidedResults[i];
            const updateOp = updateSessionExerciseEvaluationState(
              stagedEvaluatedRegistry,
              item.exerciseIndex,
              item.result.nextEvaluationState
            );
            if (!updateOp.applied) {
              stagingSuccess = false;
              break;
            }
            stagedEvaluatedRegistry = updateOp.registry;
            nextGuidedAddedExercises.push({
              ...newItems[i],
              ...item.result.exercise,
              sets: item.result.appliedSets.map((s: SetEntry) => ({ ...s })),
            });
          }
        }

        if (validationPassed && stagingSuccess) {
          const nextExs = [...exercises, ...nextGuidedAddedExercises];
          const nextSnapshots = capturePrescribedSnapshotsFromExercises(
            nextGuidedAddedExercises,
            prescribedTargetSnapshots,
            {},
            exercises.length
          );

          sessionExerciseRegistryRef.current = stagedEvaluatedRegistry;
          setUserRawExercises(prev => {
            const base = prev || [];
            return [...base, ...newItems];
          });
          setExercises(nextExs);
          setPrescribedTargetSnapshots(nextSnapshots);
          setSelectorTargetIdx(null);
          saveWorkoutDraftImmediately({
            exercises: nextExs,
            prescribedTargetSnapshots: nextSnapshots,
          });
          return;
        }
      }

      // Fallback or performance-led calculation for the new exercises
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
          algorithmId: activeProg?.algorithmId,
          predecessorProgramId: activeProg?.parentProgramId ?? null,
          algorithmPhaseOffset: activeProg?.algorithmPhaseOffset ?? 0,
          bodyweightSnapshot,
          activeUnit: unit,
          programId: programId ? String(programId) : null,
          dayNum: dayNum !== undefined && dayNum !== null ? String(dayNum) : null,
          targetDate: dateStr || null,
          targetLogId: editLogId || null,
          targetChronology,
          sessionStartedAt: sessionStartedAtRef.current,
        });
        return { ...ex, sets: calculatedSets };
      });

      const nextExs = [...exercises, ...calculatedNewItems];
      const nextSnapshots = capturePrescribedSnapshotsFromExercises(
        calculatedNewItems,
        prescribedTargetSnapshots,
        {},
        exercises.length
      );

      sessionExerciseRegistryRef.current = stagedAppendedRegistry;

      // Update userRawExercises backup
      setUserRawExercises(prev => {
        const base = prev || [];
        return [...base, ...newItems];
      });
      setExercises(nextExs);
      setPrescribedTargetSnapshots(nextSnapshots);
      setSelectorTargetIdx(null);
      saveWorkoutDraftImmediately({
        exercises: nextExs,
        prescribedTargetSnapshots: nextSnapshots,
      });
    } else if (selectorTargetIdx !== null) {
      const currentRegistry = sessionExerciseRegistryRef.current;
      if (!currentRegistry || currentRegistry.entries.length !== exercises.length) {
        return;
      }

      if (
        typeof selectorTargetIdx !== 'number' ||
        !Number.isInteger(selectorTargetIdx) ||
        selectorTargetIdx < 0 ||
        selectorTargetIdx >= exercises.length ||
        selectorTargetIdx >= currentRegistry.entries.length
      ) {
        return;
      }

      const op = replaceSessionExerciseRegistryEntry(
        currentRegistry,
        selectorTargetIdx,
        'user_replaced_library'
      );
      if (!op.applied) return;
      const stagedReplacedRegistry = op.registry;

      const first = selectedList[0];
      const prevSets = getPreviousSetsForExercise(first.name);
      const replacedItem: ExerciseEntry = {
        name: first.name,
        muscleGroup: first.category,
        modality: first.modality || 'weighted',
        ...(first.exerciseKey ? { exerciseKey: first.exerciseKey } : {}),
        sets: prevSets || [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' as const }],
      };

      // Clean all state records for the replaced exercise index
      const cleanChecked = remapAfterExerciseReplace(checkedSets, selectorTargetIdx);
      const cleanTouched = remapAfterExerciseReplace(userTouchedSets, selectorTargetIdx);
      const cleanCompletionTouched = remapAfterExerciseReplace(completionTouchedSets, selectorTargetIdx);
      const cleanEvidence = remapAfterExerciseReplace(committedLiveEvidenceBySet, selectorTargetIdx);
      const cleanLiveAdjusted = remapAfterExerciseReplace(liveAdjustedSets, selectorTargetIdx);
      const cleanedSnapshots = remapAfterExerciseReplace(prescribedTargetSnapshots, selectorTargetIdx);

      // Proposed userRawExercises backup
      const nextUserRaw = userRawExercises
        ? userRawExercises.map((ex, idx) => idx === selectorTargetIdx ? replacedItem : ex)
        : [replacedItem];

      const isEligibleGuidedReplacement =
        Boolean(activeProg) &&
        resolveProgramProgressionMode(activeProg) === 'metreps_guided' &&
        (objective === 'Hypertrophy' || objective === 'Strength') &&
        !editLogId &&
        !redoFromLogId &&
        !isOneOff &&
        Boolean(activeProg?.exercisesByDay?.[Number(dayNum)]) &&
        currentRegistry.entries.length === exercises.length;

      if (isEligibleGuidedReplacement && activeProg) {
        const storedPrograms = storage.getPrograms();
        const programsList = !storedPrograms.some(p => p.id === activeProg.id)
          ? [...storedPrograms, activeProg]
          : storedPrograms;

        const guidedContext: GuidedWorkoutIntegrationContext = {
          program: activeProg,
          programs: programsList,
          historicalLogs: storage.getWorkoutLogs(),
          boundary: activePrescriptionBoundaryRef.current,
          sessionKind: {
            type: 'active_program_session',
            scheduledDate: scheduledDate || undefined,
            weekNum: Number(weekNum),
          },
          activeUnit: unit,
          bodyweightSnapshot: bodyweightSnapshot ?? null,
          objective,
          weekNum: Number(weekNum),
          programDuration,
          dayNum: dayNum !== undefined && dayNum !== null ? String(dayNum) : null,
          targetDate: activePrescriptionBoundaryRef.current?.prescriptionTargetDate ?? dateStr ?? null,
          targetLogId: editLogId || null,
        };

        const stagedEntry = stagedReplacedRegistry.entries[selectorTargetIdx];

        const guidedItems: GuidedWorkoutIntegrationItem[] = [
          {
            exercise: replacedItem,
            exerciseIndex: selectorTargetIdx,
            templateExercise: replacedItem,
            lifecycleEvidence: {
              originProvenance: stagedEntry.originProvenance,
              isHistoricalEdit: false,
              isRedoSession: false,
              isRestoredFromDraft: false,
              evaluationState: stagedEntry.evaluationState,
              userTouchedSetKeys: new Set<string>(),
              checkedSetKeys: new Set<string>(),
              skippedSetKeys: new Set<string>(),
              hasCommittedLiveEvidence: false,
              hasLiveAdjustedSets: false,
              structuralMutationReason: stagedEntry.structuralMutationReason,
              isStructurallyModified: false,
            },
          },
        ];

        let guidedResults: readonly GuidedWorkoutIntegrationEntryResult[] | null = null;
        try {
          guidedResults = orchestrateGuidedWorkoutExercises({
            context: guidedContext,
            items: guidedItems,
          });
        } catch (_) {
          guidedResults = null;
        }

        let validationPassed = false;
        if (Array.isArray(guidedResults) && guidedResults.length === 1) {
          const entry = guidedResults[0];
          if (
            entry &&
            entry.exerciseIndex === selectorTargetIdx &&
            entry.result &&
            entry.result.exercise &&
            Array.isArray(entry.result.appliedSets)
          ) {
            validationPassed = true;
          }
        }

        let stagedEvaluatedRegistry: SessionExerciseRegistry = stagedReplacedRegistry;
        let stagingSuccess = false;
        let guidedFinalReplaced: ExerciseEntry | null = null;

        if (validationPassed && guidedResults) {
          const resultItem = guidedResults[0];
          const updateOp = updateSessionExerciseEvaluationState(
            stagedReplacedRegistry,
            selectorTargetIdx,
            resultItem.result.nextEvaluationState
          );
          if (updateOp.applied) {
            stagingSuccess = true;
            stagedEvaluatedRegistry = updateOp.registry;
            guidedFinalReplaced = {
              ...replacedItem,
              ...resultItem.result.exercise,
              sets: resultItem.result.appliedSets.map((s: SetEntry) => ({ ...s })),
            };
          }
        }

        if (validationPassed && stagingSuccess && guidedFinalReplaced) {
          const nextSnapshots = capturePrescribedSnapshotsFromExercises(
            [guidedFinalReplaced],
            cleanedSnapshots,
            {},
            selectorTargetIdx
          );

          sessionExerciseRegistryRef.current = stagedEvaluatedRegistry;
          setCheckedSets(cleanChecked);
          setUserTouchedSets(cleanTouched);
          setCompletionTouchedSets(cleanCompletionTouched);
          setCommittedLiveEvidenceBySet(cleanEvidence);
          setLiveAdjustedSets(cleanLiveAdjusted);
          setUserRawExercises(nextUserRaw);
          setPrescribedTargetSnapshots(nextSnapshots);

          const nextExs = exercises.map((ex, idx) => (idx === selectorTargetIdx ? guidedFinalReplaced! : ex));
          const nextGuideKey = highlightCurrentSet
            ? reconcileGuideAfterExerciseReplace(currentSetGuideKey, selectorTargetIdx, nextExs)
            : null;

          setExercises(nextExs);
          setCurrentSetGuideKey(nextGuideKey);
          setSelectorTargetIdx(null);

          saveWorkoutDraftImmediately({
            exercises: nextExs,
            userRawExercises: nextUserRaw,
            checkedSets: cleanChecked,
            userTouchedSets: cleanTouched,
            completionTouchedSets: cleanCompletionTouched,
            committedLiveEvidenceBySet: cleanEvidence,
            liveAdjustedSets: cleanLiveAdjusted,
            prescribedTargetSnapshots: nextSnapshots,
            currentSetGuideKey: nextGuideKey,
          });
          return;
        }
      }

      // Fallback or performance-led calculation for the replacement
      const calculatedSets = calculateObjectiveSets({
        objective,
        exercise: replacedItem,
        exerciseIndex: selectorTargetIdx,
        totalExercises: exercises.length,
        weekNum: Number(weekNum),
        programDuration,
        previousLogs: storage.getWorkoutLogs(),
        userTouchedSets: cleanTouched,
        checkedSets: cleanChecked,
        algorithmId: activeProg?.algorithmId,
        predecessorProgramId: activeProg?.parentProgramId ?? null,
        algorithmPhaseOffset: activeProg?.algorithmPhaseOffset ?? 0,
        bodyweightSnapshot,
        activeUnit: unit,
        programId: programId ? String(programId) : null,
        dayNum: dayNum !== undefined && dayNum !== null ? String(dayNum) : null,
        targetDate: dateStr || null,
        targetLogId: editLogId || null,
        targetChronology,
        sessionStartedAt: sessionStartedAtRef.current,
      });
      const finalReplaced = { ...replacedItem, sets: calculatedSets };

      const nextSnapshots = capturePrescribedSnapshotsFromExercises([finalReplaced], cleanedSnapshots, {}, selectorTargetIdx);

      sessionExerciseRegistryRef.current = stagedReplacedRegistry;

      setCheckedSets(cleanChecked);
      setUserTouchedSets(cleanTouched);
      setCompletionTouchedSets(cleanCompletionTouched);
      setCommittedLiveEvidenceBySet(cleanEvidence);
      setLiveAdjustedSets(cleanLiveAdjusted);
      setUserRawExercises(nextUserRaw);
      setPrescribedTargetSnapshots(nextSnapshots);

      const nextExs = exercises.map((ex, idx) => (idx === selectorTargetIdx ? finalReplaced : ex));
      const nextGuideKey = highlightCurrentSet
        ? reconcileGuideAfterExerciseReplace(currentSetGuideKey, selectorTargetIdx, nextExs)
        : null;

      setExercises(nextExs);
      setCurrentSetGuideKey(nextGuideKey);
      setSelectorTargetIdx(null);

      saveWorkoutDraftImmediately({
        exercises: nextExs,
        userRawExercises: nextUserRaw,
        checkedSets: cleanChecked,
        userTouchedSets: cleanTouched,
        completionTouchedSets: cleanCompletionTouched,
        committedLiveEvidenceBySet: cleanEvidence,
        liveAdjustedSets: cleanLiveAdjusted,
        prescribedTargetSnapshots: nextSnapshots,
        currentSetGuideKey: nextGuideKey,
      });
    }
  };
  const [duration, setDuration] = useState<number | ''>(() => {
    try {
      const draftStr = localStorage.getItem('metreps_workout_draft');
      if (draftStr) {
        const draft = JSON.parse(draftStr);
        const matches = editLogId
          ? (draft.editLogId ? String(draft.editLogId) === String(editLogId) : false)
          : (!draft.editLogId && (isOneOff
              ? draft.isOneOff === true
              : (draft.programId === programId && String(draft.weekNum) === String(weekNum) && String(draft.dayNum) === String(dayNum))));
        if (matches && draft.duration !== undefined && draft.duration !== null) {
          return draft.duration;
        }
      }
    } catch (_) {}

    if (existingLog && typeof existingLog.durationMinutes === 'number') {
      return existingLog.durationMinutes;
    }

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
        const matches = editLogId
          ? (draft.editLogId ? String(draft.editLogId) === String(editLogId) : false)
          : (!draft.editLogId && (isOneOff
              ? draft.isOneOff === true
              : (draft.programId === programId && String(draft.weekNum) === String(weekNum) && String(draft.dayNum) === String(dayNum))));
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

  const activePrescriptionBoundaryRef = React.useRef<ActivePrescriptionBoundary>(null);
  const sessionStartedAtRef = React.useRef<number>(Date.now());

  const targetChronology = React.useMemo<PrescriptionTargetChronology>(() => {
    if (editLogId) {
      return {
        mode: 'historical_edit',
        targetLogId: editLogId,
        displayedDate: dateStr || null,
      };
    }
    const todayStr = getTodayLocalDateString();
    if (dateStr && dateStr < todayStr) {
      let explicitTargetTimestamp: number | null = null;
      if (startTime && /^\d{1,2}:\d{2}/.test(startTime)) {
        const combined = `${dateStr}T${startTime.length === 5 ? startTime + ':00' : startTime}`;
        const t = new Date(combined).getTime();
        if (Number.isFinite(t) && t > 0) explicitTargetTimestamp = t;
      }
      return {
        mode: 'retrospective_new',
        targetLogId: null,
        displayedDate: dateStr,
        explicitTargetTimestamp,
      };
    }
    return {
      mode: 'active_live',
      sessionStartedAt: sessionStartedAtRef.current,
      targetLogId: null,
      displayedDate: dateStr || todayStr,
    };
  }, [editLogId, dateStr, startTime]);

  const [notes, setNotes] = useState<string>(() => {
    try {
      const draftStr = localStorage.getItem('metreps_workout_draft');
      if (draftStr) {
        const draft = JSON.parse(draftStr);
        const matches = editLogId
          ? (draft.editLogId ? String(draft.editLogId) === String(editLogId) : false)
          : (!draft.editLogId && (isOneOff
              ? draft.isOneOff === true
              : (draft.programId === programId && String(draft.weekNum) === String(weekNum) && String(draft.dayNum) === String(dayNum))));
        if (matches && draft.notes !== undefined) {
          return draft.notes;
        }
      }
    } catch (_) {}
    if (existingLog && existingLog.notes) {
      return existingLog.notes;
    }
    return '';
  });

  // Wellness & Recovery Metrics
  const [sleep, setSleep] = useState<number | ''>(() => {
    try {
      const draftStr = localStorage.getItem('metreps_workout_draft');
      if (draftStr) {
        const draft = JSON.parse(draftStr);
        const matches = editLogId
          ? (draft.editLogId ? String(draft.editLogId) === String(editLogId) : false)
          : (!draft.editLogId && (isOneOff
              ? draft.isOneOff === true
              : (draft.programId === programId && String(draft.weekNum) === String(weekNum) && String(draft.dayNum) === String(dayNum))));
        if (matches && draft.sleep !== undefined && draft.sleep !== null) {
          return draft.sleep;
        }
      }
    } catch (_) {}
    if (existingLog && existingLog.recovery?.sleepHours !== undefined && existingLog.recovery?.sleepHours !== null) {
      return existingLog.recovery.sleepHours;
    }
    return 7.5;
  });

  const [hydration, setHydration] = useState<HydrationLevel>(() => {
    try {
      const draftStr = localStorage.getItem('metreps_workout_draft');
      if (draftStr) {
        const draft = JSON.parse(draftStr);
        const matches = editLogId
          ? (draft.editLogId ? String(draft.editLogId) === String(editLogId) : false)
          : (!draft.editLogId && (isOneOff
              ? draft.isOneOff === true
              : (draft.programId === programId && String(draft.weekNum) === String(weekNum) && String(draft.dayNum) === String(dayNum))));
        if (matches && draft.hydration !== undefined && draft.hydration !== null) {
          if (typeof draft.hydration === 'number') {
            return mapLitersToHydration(draft.hydration);
          }
          return draft.hydration;
        }
      }
    } catch (_) {}
    if (existingLog && existingLog.recovery) {
      if (existingLog.recovery.hydrationLevel) return existingLog.recovery.hydrationLevel;
      if (existingLog.recovery.hydrationLiters) return mapLitersToHydration(existingLog.recovery.hydrationLiters);
    }
    return 'Adequate';
  });

  const [isHydrationDropdownOpen, setIsHydrationDropdownOpen] = useState<boolean>(false);

  const [calories, setCalories] = useState<number | ''>(() => {
    try {
      const draftStr = localStorage.getItem('metreps_workout_draft');
      if (draftStr) {
        const draft = JSON.parse(draftStr);
        const matches = editLogId
          ? (draft.editLogId ? String(draft.editLogId) === String(editLogId) : false)
          : (!draft.editLogId && (isOneOff
              ? draft.isOneOff === true
              : (draft.programId === programId && String(draft.weekNum) === String(weekNum) && String(draft.dayNum) === String(dayNum))));
        if (matches && draft.calories !== undefined && draft.calories !== null) {
          return draft.calories;
        }
      }
    } catch (_) {}
    if (existingLog && existingLog.recovery?.nutritionCalories !== undefined && existingLog.recovery?.nutritionCalories !== null) {
      return existingLog.recovery.nutritionCalories;
    }
    return 2500;
  });

  const [protein, setProtein] = useState<number>(() => {
    try {
      const draftStr = localStorage.getItem('metreps_workout_draft');
      if (draftStr) {
        const draft = JSON.parse(draftStr);
        const matches = editLogId
          ? (draft.editLogId ? String(draft.editLogId) === String(editLogId) : false)
          : (!draft.editLogId && (isOneOff
              ? draft.isOneOff === true
              : (draft.programId === programId && String(draft.weekNum) === String(weekNum) && String(draft.dayNum) === String(dayNum))));
        if (matches && draft.protein !== undefined && draft.protein !== null) {
          return Number(draft.protein);
        }
      }
    } catch (_) {}
    if (existingLog && existingLog.recovery?.proteinGrams !== undefined && existingLog.recovery?.proteinGrams !== null) {
      return existingLog.recovery.proteinGrams;
    }
    return 140;
  });

  const [soreness, setSoreness] = useState<number>(() => {
    try {
      const draftStr = localStorage.getItem('metreps_workout_draft');
      if (draftStr) {
        const draft = JSON.parse(draftStr);
        const matches = editLogId
          ? (draft.editLogId ? String(draft.editLogId) === String(editLogId) : false)
          : (!draft.editLogId && (isOneOff
              ? draft.isOneOff === true
              : (draft.programId === programId && String(draft.weekNum) === String(weekNum) && String(draft.dayNum) === String(dayNum))));
        if (matches && draft.soreness !== undefined && draft.soreness !== null) {
          return Number(draft.soreness);
        }
      }
    } catch (_) {}
    if (existingLog && existingLog.recovery?.soreness !== undefined && existingLog.recovery?.soreness !== null) {
      return existingLog.recovery.soreness;
    }
    return 3;
  });

  const [motivation, setMotivation] = useState<number>(() => {
    try {
      const draftStr = localStorage.getItem('metreps_workout_draft');
      if (draftStr) {
        const draft = JSON.parse(draftStr);
        const matches = editLogId
          ? (draft.editLogId ? String(draft.editLogId) === String(editLogId) : false)
          : (!draft.editLogId && (isOneOff
              ? draft.isOneOff === true
              : (draft.programId === programId && String(draft.weekNum) === String(weekNum) && String(draft.dayNum) === String(dayNum))));
        if (matches && draft.motivation !== undefined && draft.motivation !== null) {
          return Number(draft.motivation);
        }
      }
    } catch (_) {}
    if (existingLog && existingLog.recovery?.motivation !== undefined && existingLog.recovery?.motivation !== null) {
      return existingLog.recovery.motivation;
    }
    return 5;
  });

  // Rest Timer states
  const [restSeconds, setRestSeconds] = useState<number>(0);
  const [isResting, setIsResting] = useState<boolean>(() => {
    const saved = localStorage.getItem('isResting');
    return saved === 'true';
  });
  const [restStartTime, setRestStartTime] = useState<number | null>(() => {
    const saved = localStorage.getItem('restStartTime');
    return saved ? Number(saved) : null;
  });
  const [restStartContext, setRestStartContext] = useState<RestTimerStartContext | null>(() => {
    return parseRestStartContext(localStorage.getItem('restStartContext'));
  });
  const [restIntervals, setRestIntervals] = useState<RestInterval[]>([]);

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
    if (restStartContext !== null) {
      localStorage.setItem('restStartContext', JSON.stringify(restStartContext));
    } else {
      localStorage.removeItem('restStartContext');
    }
  }, [restStartContext]);

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

  const clearActiveRestTimer = () => {
    setIsResting(false);
    setRestStartTime(null);
    setRestSeconds(0);
    setRestStartContext(null);
    localStorage.removeItem('isResting');
    localStorage.removeItem('restStartTime');
    localStorage.removeItem('restStartContext');
  };

  const handleToggleRestTimer = (startContext?: RestTimerStartContext) => {
    if (isResting) {
      // 1. Authoritative duration calculated as Math.floor((Date.now() - restStartTime) / 1000)
      const duration = restStartTime !== null ? Math.floor((Date.now() - restStartTime) / 1000) : 0;

      // 2. Storage boundary: 1-599 seconds -> append completed interval (unless in edit mode); <=0 or >=600 -> silently discard
      if (!editLogId && isValidRestIntervalDuration(duration)) {
        const completedInterval = createRestInterval({
          durationSeconds: duration,
          startContext: restStartContext,
          startTime: restStartTime,
        });
        if (completedInterval) {
          setRestIntervals(prev => [...prev, completedInterval]);
        }
      }

      // 3. Clear timer state and storage
      clearActiveRestTimer();
    } else {
      // Starting timer: Capture authoritative context
      const now = Date.now();
      const ctx: RestTimerStartContext = startContext || {
        source: 'footer',
        startedAt: new Date(now).toISOString(),
      };
      setRestStartTime(now);
      setRestSeconds(0);
      setRestStartContext(ctx);
      setIsResting(true);
      localStorage.setItem('isResting', 'true');
      localStorage.setItem('restStartTime', now.toString());
      localStorage.setItem('restStartContext', JSON.stringify(ctx));
    }
  };

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
    
    const dayIndexes = Object.keys(activeProg.exercisesByDay)
      .map(Number)
      .filter(d => d <= activeProg.daysPerWeek)
      .sort((a, b) => a - b);
    if (dayIndexes.length === 0) return false;
    const lastDay = dayIndexes[dayIndexes.length - 1];
    
    return String(weekNum) === String(totalWeeks) && String(dayNum) === String(lastDay);
  }, [isOneOff, programId, weekNum, dayNum]);

  // Objectives State
  const [objective, setObjective] = useState<'Off' | 'Hypertrophy' | 'Strength' | 'Deload'>(() => {
    try {
      const draftStr = localStorage.getItem('metreps_workout_draft');
      if (draftStr) {
        const draft = JSON.parse(draftStr);
        const matches = editLogId
          ? (draft.editLogId ? String(draft.editLogId) === String(editLogId) : false)
          : (!draft.editLogId && (isOneOff
              ? draft.isOneOff === true
              : (draft.programId === programId && String(draft.weekNum) === String(weekNum) && String(draft.dayNum) === String(dayNum))));
        if (matches && draft.objective) return draft.objective;
      }
    } catch (_) {}

    if (existingLog && existingLog.objective) return existingLog.objective;
    if (!isOneOff) {
      const activeProg = (programId ? storage.getPrograms().find(p => p.id === programId) : null) || storage.getCurrentProgram();
      if (activeProg?.objective) return activeProg.objective;
    }
    return 'Off';
  });
  const [isObjectiveLocked, setIsObjectiveLocked] = useState<boolean>(() => {
    return !isOneOff && Number(weekNum) >= 2;
  });
  const [showStrengthMainMovementPrompt, setShowStrengthMainMovementPrompt] = useState(false);
  const [userRawExercises, setUserRawExercises] = useState<ExerciseEntry[] | null>(() => {
    try {
      const draftStr = localStorage.getItem('metreps_workout_draft');
      if (draftStr) {
        const draft = JSON.parse(draftStr);
        const matches = editLogId
          ? (draft.editLogId ? String(draft.editLogId) === String(editLogId) : false)
          : (!draft.editLogId && (isOneOff
              ? draft.isOneOff === true
              : (draft.programId === programId && String(draft.weekNum) === String(weekNum) && String(draft.dayNum) === String(dayNum))));
        if (matches && (draft.userRawExercises || draft.exercises)) {
          return draft.userRawExercises || draft.exercises;
        }
      }
    } catch (_) {}

    if (existingLog && existingLog.exercises) return existingLog.exercises;
    if (!isOneOff) {
      const activeProg = (programId ? storage.getPrograms().find(p => p.id === programId) : null) || storage.getCurrentProgram();
      if (activeProg?.exercisesByDay?.[Number(dayNum)]) {
        return JSON.parse(JSON.stringify(activeProg.exercisesByDay[Number(dayNum)]));
      }
    }
    return null;
  });
  const [userTouchedSets, setUserTouchedSets] = useState<Record<string, boolean>>({});

  // Set-level checkbox tracking for UX and completion persistence
  const [checkedSets, setCheckedSets] = useState<Record<string, boolean>>(() => {
    try {
      const draftStr = localStorage.getItem('metreps_workout_draft');
      if (draftStr) {
        const draft = JSON.parse(draftStr);
        const matches = editLogId
          ? (draft.editLogId ? String(draft.editLogId) === String(editLogId) : false)
          : (!draft.editLogId && (isOneOff
              ? draft.isOneOff === true
              : (draft.programId === programId && String(draft.weekNum) === String(weekNum) && String(draft.dayNum) === String(dayNum))));
        if (matches && draft.checkedSets) {
          return draft.checkedSets;
        }
      }
    } catch (_) {}

    if (existingLog && existingLog.exercises) {
      const initialChecked: Record<string, boolean> = {};
      existingLog.exercises.forEach((ex, exIdx) => {
        ex.sets.forEach((s, sIdx) => {
          initialChecked[`${exIdx}-${sIdx}`] = s.isCompleted !== false;
        });
      });
      return initialChecked;
    }
    return {};
  });
  // Set-level explicit checkbox interaction tracking during current session
  const [completionTouchedSets, setCompletionTouchedSets] = useState<Record<string, boolean>>({});

  // Phase 2B-2A-2 Draft-only Live Adjustment session maps
  const [prescribedTargetSnapshots, setPrescribedTargetSnapshots] = useState<PrescribedTargetSnapshotMap>({});
  const [committedLiveEvidenceBySet, setCommittedLiveEvidenceBySet] = useState<CommittedLiveEvidenceMap>({});
  const [liveAdjustedSets, setLiveAdjustedSets] = useState<LiveAdjustedSetMap>({});

  // Focus tracking for target adjustment protection (internal only, no visual highlighting)
  const [focusedSetKey, setFocusedSetKey] = useState<string | null>(null);

  // Current Working Set Guide state (visual navigation aid only)
  const [currentSetGuideKey, setCurrentSetGuideKey] = useState<string | null>(null);
  const highlightCurrentSet = storage.getHighlightCurrentSet();

  // Non-intrusive live adjustment toast notification
  const [liveAdjustmentToast, setLiveAdjustmentToast] = useState<string | null>(null);
  const toastTimerRef = React.useRef<ToastTimerHandle>({ timer: null });

  useEffect(() => {
    return () => {
      cleanupToastNotification(toastTimerRef.current);
    };
  }, []);

  const showLiveAdjustmentToast = (
    message: string = LIVE_ADJUSTMENT_SUCCESS_MESSAGE,
    durationMs: number = DEFAULT_TOAST_DURATION_MS
  ) => {
    scheduleToastNotification(
      toastTimerRef.current,
      setLiveAdjustmentToast,
      message,
      durationMs
    );
  };

  // Collapsed states
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});

  // Add Set blocked warning when skipped sets exist
  const [addSetBlockedWarning, setAddSetBlockedWarning] = useState<Record<number, string | null>>({});

  // Dialog and contextual action states
  const [deleteExerciseIdx, setDeleteExerciseIdx] = useState<number | null>(null);
  const [historyExerciseName, setHistoryExerciseName] = useState<string | null>(null);
  const [activeSetAction, setActiveSetAction] = useState<{ exIdx: number; setIdx: number } | null>(null);
  const [setDrag, setSetDrag] = useState<{ exIdx: number; setIdx: number; destinationIdx: number; offsetY: number } | null>(null);
  const [pressedSetOptions, setPressedSetOptions] = useState<string | null>(null);
  const [recentlyDroppedSet, setRecentlyDroppedSet] = useState<string | null>(null);
  const setDragRef = useRef<typeof setDrag>(null);
  const setHoldRef = useRef<{ timer: ReturnType<typeof setTimeout>; pointerId: number; exIdx: number; setIdx: number; startX: number; startY: number; button: HTMLButtonElement } | null>(null);
  const suppressSetOptionsClickRef = useRef(false);
  const dropHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyOverflowBeforeDragRef = useRef<string>('');
  const [commentDraft, setCommentDraft] = useState<string>('');
  const [calcModalState, setCalcModalState] = useState<{ exIdx: number; setIdx: number } | null>(null);
  const [calcMode, setCalcMode] = useState<'find_weight' | 'find_reps'>('find_weight');
  const [calcRepsInput, setCalcRepsInput] = useState<string>('10');
  const [calcWeightInput, setCalcWeightInput] = useState<string>('');
  const [calcRpe, setCalcRpe] = useState<number>(8.0);
  const [warmupReplacementConfirmState, setWarmupReplacementConfirmState] = useState<{ exIdx: number; setIdx: number } | null>(null);

  useEffect(() => {
    if (activeSetAction !== null) {
      const { exIdx, setIdx } = activeSetAction;
      const currentComment = exercises[exIdx]?.sets[setIdx]?.comment || '';
      setCommentDraft(currentComment);
    }
  }, [activeSetAction, exercises]);

  const [commentEditState, setCommentEditState] = useState<{ exIdx: number; setIdx: number; text: string } | null>(null);
  const [activeExAction, setActiveExAction] = useState<number | null>(null);
  const [activeSelector, setActiveSelector] = useState<{ exIdx: number; setIdx: number; type: 'rpe' | 'form'; direction?: 'up' | 'down' } | null>(null);

  useEffect(() => () => {
    if (setHoldRef.current) clearTimeout(setHoldRef.current.timer);
    if (dropHighlightTimerRef.current) clearTimeout(dropHighlightTimerRef.current);
    if (setDragRef.current) document.body.style.overflow = bodyOverflowBeforeDragRef.current;
  }, []);

  const toggleSelector = (e: React.MouseEvent<HTMLButtonElement>, exIdx: number, setIdx: number, type: 'rpe' | 'form') => {
    e.stopPropagation();
    if (activeSelector?.exIdx === exIdx && activeSelector?.setIdx === setIdx && activeSelector?.type === type) {
      setActiveSelector(null);
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      const direction = rect.top < 230 ? 'down' : 'up';
      setActiveSelector({ exIdx, setIdx, type, direction });
    }
  };

  // Close popups on pointerdown outside without capturing scroll touch events
  useEffect(() => {
    if (!activeSelector && !isHydrationDropdownOpen) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.selector-popup-container')) {
        return;
      }
      setActiveSelector(null);
      setIsHydrationDropdownOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [activeSelector, isHydrationDropdownOpen]);
  const [swapMainTargetIdx, setSwapMainTargetIdx] = useState<number | null>(null);
  const [showNoMainMovementConfirm, setShowNoMainMovementConfirm] = useState(false);

  const [showSorenessInfo, setShowSorenessInfo] = useState<boolean>(false);
  const [showQualityInfo, setShowQualityInfo] = useState<boolean>(false);

  // Back button physical popstate interceptors
  useModalHistory(activeSelector !== null, () => setActiveSelector(null), 'rpe-form-selector');
  useModalHistory(isHydrationDropdownOpen, () => setIsHydrationDropdownOpen(false), 'hydration-dropdown');
  const { dismiss: dismissSetAction } = useModalHistory(activeSetAction !== null, () => setActiveSetAction(null), 'set-options');
  const { dismiss: dismissExAction } = useModalHistory(activeExAction !== null, () => setActiveExAction(null), 'exercise-actions');
  const { dismiss: dismissHistory } = useModalHistory(historyExerciseName !== null, () => setHistoryExerciseName(null), 'exercise-history');
  const { dismiss: dismissCompletion } = useModalHistory(showCompletionModal, () => setShowCompletionModal(false), 'workout-completion');
  const { dismiss: dismissSorenessInfo } = useModalHistory(showSorenessInfo, () => setShowSorenessInfo(false), 'soreness-info');
  const { dismiss: dismissQualityInfo } = useModalHistory(showQualityInfo, () => setShowQualityInfo(false), 'quality-info');

  interface HeaderInfoModalState {
    title: string;
    secondaryHeading?: string;
    body: React.ReactNode;
    note?: React.ReactNode;
  }
  const [headerInfoModal, setHeaderInfoModal] = useState<HeaderInfoModalState | null>(null);
  const headerInfoTriggerRef = useRef<HTMLButtonElement | null>(null);
  const headerInfoCloseBtnRef = useRef<HTMLButtonElement | null>(null);
  const headerInfoContainerRef = useRef<HTMLDivElement | null>(null);

  const closeHeaderInfoModal = useCallback(() => {
    setHeaderInfoModal(null);
    headerInfoTriggerRef.current?.focus();
  }, []);

  useModalHistory(headerInfoModal !== null, () => closeHeaderInfoModal(), 'header-guidance-info');

  useEffect(() => {
    if (!headerInfoModal) return undefined;
    headerInfoCloseBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeHeaderInfoModal();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [headerInfoModal, closeHeaderInfoModal]);

  const isTargetModeApplicable = Boolean(
    activeProg &&
    !isOneOff &&
    !editLogId &&
    !redoFromLogId &&
    (objective === 'Hypertrophy' || objective === 'Strength') &&
    Boolean(activeProg.exercisesByDay?.[Number(dayNum)])
  );

  const targetMode = activeProg ? resolveProgramProgressionMode(activeProg) : 'performance_led';
  const isCoached = targetMode === 'metreps_guided';

  const openPeriodisationInfo = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    headerInfoTriggerRef.current = e.currentTarget;

    let bodyText = '';
    if (objective === 'Off') {
      bodyText = 'Manual Mode: You have full control over all weights, rep ranges, and target metrics.';
    } else if (objective === 'Strength') {
      bodyText = `Strength focus [${algoDetails.short}]: ${algoDetails.desc}`;
    } else if (objective === 'Hypertrophy') {
      bodyText = `Hypertrophy focus [${algoDetails.short}]: ${algoDetails.desc}`;
    } else if (objective === 'Deload') {
      bodyText = 'Deload focus: Automatically reduces loads to 50% of peak capacity and targets strict control to promote total physical recovery.';
    }

    const hasWarning =
      objective === 'Strength' &&
      (activeProg?.algorithmId === 'strength_undulating' || !activeProg?.algorithmId) &&
      typeof totalWeeks === 'number' &&
      ![4, 8, 12].includes(totalWeeks);

    setHeaderInfoModal({
      title: algoDetails.name,
      secondaryHeading: 'How this method works',
      body: <p>{bodyText}</p>,
      note: hasWarning ? (
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <span>Strength Undulating supports 4, 8 or 12 weeks. Update the program duration to resume automatic targets.</span>
        </div>
      ) : undefined,
    });
  };

  const openTargetModeInfo = (e: React.MouseEvent<HTMLButtonElement>, mode: 'metreps_guided' | 'performance_led') => {
    e.preventDefault();
    e.stopPropagation();
    headerInfoTriggerRef.current = e.currentTarget;

    if (mode === 'metreps_guided') {
      setHeaderInfoModal({
        title: 'MetReps Coach',
        secondaryHeading: 'How this mode works',
        body: (
          <p>
            MetReps Coach starts with the same periodisation-based targets, then compares completed workouts with previous prescribed targets. When the available evidence supports a decision, it can progress, hold, retry or adjust future weight and repetition targets.
          </p>
        ),
      });
    } else {
      setHeaderInfoModal({
        title: 'Periodisation Targets',
        secondaryHeading: 'How this mode works',
        body: (
          <p>
            MetReps uses your recorded performance as the baseline, then applies your selected periodisation method to calculate the session’s targets. It does not use Coach rules to decide whether you have earned a progression, should hold, or should retry a target.
          </p>
        ),
      });
    }
  };

  // Draft persistence states
  const sessionExerciseRegistryRef = useRef<SessionExerciseRegistry | null>(null);
  const [isDraftLoaded, setIsDraftLoaded] = useState(false);
  const isDraftLoadedRef = useRef<boolean>(false);
  const latestDraftPayloadRef = useRef<Record<string, any> | null>((() => {
    try {
      const draftStr = localStorage.getItem('metreps_workout_draft');
      if (draftStr) {
        const draft = JSON.parse(draftStr);
        const matches = editLogId
          ? (draft.editLogId ? String(draft.editLogId) === String(editLogId) : false)
          : (!draft.editLogId && (isOneOff
              ? draft.isOneOff === true
              : (draft.programId === programId && String(draft.weekNum) === String(weekNum) && String(draft.dayNum) === String(dayNum))));
        if (matches) return draft;
      }
    } catch (_) {}
    return null;
  })());
  const draftFlushSuppressedRef = useRef<boolean>(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [hasExistingDraft, setHasExistingDraft] = useState(() => {
    try {
      const draftStr = localStorage.getItem('metreps_workout_draft');
      if (draftStr) {
        const draft = JSON.parse(draftStr);
        const matches = editLogId
          ? (draft.editLogId ? String(draft.editLogId) === String(editLogId) : false)
          : (!draft.editLogId && (isOneOff
              ? draft.isOneOff === true
              : (draft.programId === programId && String(draft.weekNum) === String(weekNum) && String(draft.dayNum) === String(dayNum))));
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
        const matches = editLogId
          ? (draft.editLogId ? String(draft.editLogId) === String(editLogId) : false)
          : (!draft.editLogId && (isOneOff
              ? draft.isOneOff === true
              : (draft.programId === programId && String(draft.weekNum) === String(weekNum) && String(draft.dayNum) === String(dayNum))));
        setHasExistingDraft(!!matches);
      } else {
        setHasExistingDraft(false);
      }
    } catch (_) {
      setHasExistingDraft(false);
    }
  }, [editLogId, programId, dayNum, isOneOff, weekNum]);

  // Loaded template, active draft or setup blank
  useEffect(() => {
    // 1. Attempt to load existing matching draft FIRST
    try {
      const draftStr = localStorage.getItem('metreps_workout_draft');
      if (draftStr) {
        const rawJson: unknown = JSON.parse(draftStr);
        if (rawJson && typeof rawJson === 'object' && !Array.isArray(rawJson)) {
          const draft = rawJson as Record<string, any>;
          const matches = editLogId
            ? (draft.editLogId ? String(draft.editLogId) === String(editLogId) : false)
            : (!draft.editLogId && (isOneOff
                ? draft.isOneOff === true
                : (draft.programId === programId && String(draft.weekNum) === String(weekNum) && String(draft.dayNum) === String(dayNum))));

          if (matches) {
            const rawBoundary: unknown = draft.prescriptionBoundary;
            const parsedBoundary = parseActivePrescriptionBoundary(rawBoundary);
            activePrescriptionBoundaryRef.current = parsedBoundary;
            if (parsedBoundary) {
              sessionStartedAtRef.current = parsedBoundary.sessionStartedAt;
            }
          const loadedExercises = draft.exercises || [];
          setExercises(loadedExercises);
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
          setMotivation(draft.motivation ?? 5);
          setCheckedSets(draft.checkedSets || {});
          setCompletionTouchedSets(draft.completionTouchedSets || {});
          setCollapsed(draft.collapsed || {});
          setObjective(draft.objective || 'Off');
          setUserRawExercises(draft.userRawExercises || draft.exercises || []);
          setUserTouchedSets(draft.userTouchedSets || {});
          setPrescribedTargetSnapshots(draft.prescribedTargetSnapshots || {});
          setCommittedLiveEvidenceBySet(draft.committedLiveEvidenceBySet || {});
          setLiveAdjustedSets(draft.liveAdjustedSets || {});
          setCurrentSetGuideKey(highlightCurrentSet ? resolveInitialGuideKey(draft, loadedExercises) : null);
          setRestIntervals(draft.restIntervals || []);
          if (draft.startTime) {
            setStartTime(draft.startTime);
          }
          if (draft.dateStr || draft.workoutDate) {
            setWorkoutDate(draft.dateStr || draft.workoutDate);
          }
          const draftBw = 'bodyweightSnapshot' in draft
            ? (draft.bodyweightSnapshot === null ? null : validateBodyweightSnapshot(draft.bodyweightSnapshot))
            : null;
          const settingsBw = storage.getBodyweightWithUnit();
          const prevLogs = storage.getWorkoutLogs();
          const reconciled = reconcileSessionSnapshot({
            draftSnapshot: draftBw,
            settingsSnapshot: settingsBw,
            isEditMode: !!(editLogId && existingLog),
            previousLogs: prevLogs,
            chronology: targetChronology,
          });
          setBodyweightSnapshot(reconciled);
          sessionExerciseRegistryRef.current = createSessionExerciseRegistry(
            loadedExercises.map(() => 'restored_from_draft' as const)
          );
          setHasExistingDraft(true);
          latestDraftPayloadRef.current = draft;
          setIsDraftLoaded(true);
          isDraftLoadedRef.current = true;
          return;
        }
      }
    }
  } catch (e) {
      console.error('Failed to parse or apply workout draft:', e);
    }

    // 2. Fallback to existingLog if this is a historical edit and no matching draft was found
    if (editLogId && existingLog) {
      activePrescriptionBoundaryRef.current = null;
      setExercises(existingLog.exercises || []);
      setDuration(existingLog.durationMinutes || 60);
      setNotes(existingLog.notes || '');
      setSleep(existingLog.recovery?.sleepHours ?? 7.5);
      setHydration(existingLog.recovery?.hydrationLevel ?? (existingLog.recovery?.hydrationLiters ? mapLitersToHydration(existingLog.recovery.hydrationLiters) : 'Adequate'));
      setCalories(existingLog.recovery?.nutritionCalories ?? 2500);
      setProtein(existingLog.recovery?.proteinGrams ?? 140);
      setSoreness(existingLog.recovery?.soreness ?? 3);
      setMotivation(existingLog.recovery?.motivation ?? 5);
      if (existingLog.startTime) {
        setStartTime(existingLog.startTime);
      }
      if (existingLog.date) {
        setWorkoutDate(existingLog.date);
      }
      setBodyweightSnapshot(
        existingLog.bodyweightSnapshot !== undefined
          ? cloneBodyweightSnapshot(existingLog.bodyweightSnapshot)
          : undefined
      );

      // Initialize checked sets from existingLog (completed sets checked, legacy undefined sets default checked)
      const initialChecked: Record<string, boolean> = {};
      existingLog.exercises.forEach((ex, exIdx) => {
        ex.sets.forEach((s, sIdx) => {
          initialChecked[`${exIdx}-${sIdx}`] = s.isCompleted !== false;
        });
      });
      setCheckedSets(initialChecked);
      setCompletionTouchedSets({});
      setCollapsed({});
      setObjective(existingLog.objective || 'Off');
      setUserRawExercises(existingLog.exercises || []);
      setUserTouchedSets({});
      setPrescribedTargetSnapshots({});
      setCommittedLiveEvidenceBySet({});
      setLiveAdjustedSets({});
      setCurrentSetGuideKey(null);
      setRestIntervals(existingLog.restIntervals || []);
      sessionExerciseRegistryRef.current = createSessionExerciseRegistry(
        (existingLog.exercises || []).map(() => 'historical_log_entry' as const)
      );
      setIsDraftLoaded(true);
      isDraftLoadedRef.current = true;
      return;
    }

    if (initialParams?.redoFromLogId) {
      activePrescriptionBoundaryRef.current = null;
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
              isWarmup: s.isWarmup,
              isDropSet: s.isDropSet,
              dropSubSets: s.dropSubSets ? s.dropSubSets.map(ds => ({ weight: ds.weight, reps: ds.reps })) : null
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
              bodyweightSnapshot,
              activeUnit: unit,
              targetDate: dateStr || null,
              targetLogId: null,
              targetChronology,
              sessionStartedAt: sessionStartedAtRef.current,
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
          setMotivation(5);
          setCheckedSets({});
          setCompletionTouchedSets({});
          setCollapsed({});
          setObjective('Off');
          setUserRawExercises(JSON.parse(JSON.stringify(prefilled)));
          setUserTouchedSets({});
          setPrescribedTargetSnapshots({});
          setCommittedLiveEvidenceBySet({});
          setLiveAdjustedSets({});
          setCurrentSetGuideKey(highlightCurrentSet ? resolveInitialGuideKey(null, finalPre) : null);
          const settingsBw = storage.getBodyweightWithUnit();
          setBodyweightSnapshot(settingsBw ? validateBodyweightSnapshot(settingsBw) : null);
          sessionExerciseRegistryRef.current = createSessionExerciseRegistry(
            finalPre.map(() => 'session_template_init' as const)
          );
          setIsDraftLoaded(true);
          isDraftLoadedRef.current = true;
          return;
        }
      } catch (err) {
        console.error('Error handling redoFromLogId in WorkoutLogger:', err);
      }
    }

    if (activePrescriptionBoundaryRef.current === null) {
      const freshTargetDate = resolveFreshSessionTargetDate({
        scheduledDate,
        date: initialParams?.date,
        isOneOff,
        programId,
        todayDateStr: getTodayLocalDateString(),
      });
      const freshBoundary = createFreshPrescriptionBoundary(freshTargetDate, Date.now());
      activePrescriptionBoundaryRef.current = freshBoundary;
      sessionStartedAtRef.current = freshBoundary.sessionStartedAt;
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

        const progressionMode = resolveProgramProgressionMode(activeProgLocal);
        const isEligibleGuidedSession =
          progressionMode === 'metreps_guided' &&
          (defaultObjective === 'Hypertrophy' || defaultObjective === 'Strength');

        if (isEligibleGuidedSession) {
          const initialRegistry = createSessionExerciseRegistry(
            prefilled.map(() => 'session_template_init' as const)
          );

          const storedPrograms = storage.getPrograms();
          const programsList = activeProgLocal && !storedPrograms.some(p => p.id === activeProgLocal.id)
            ? [...storedPrograms, activeProgLocal]
            : storedPrograms;

          const guidedContext: GuidedWorkoutIntegrationContext = {
            program: activeProgLocal,
            programs: programsList,
            historicalLogs: storage.getWorkoutLogs(),
            boundary: activePrescriptionBoundaryRef.current,
            sessionKind: {
              type: 'active_program_session',
              scheduledDate: scheduledDate || undefined,
              weekNum: Number(weekNum),
            },
            activeUnit: unit,
            bodyweightSnapshot: bodyweightSnapshot ?? null,
            objective: defaultObjective,
            weekNum: Number(weekNum),
            programDuration,
            dayNum: dayNum !== undefined && dayNum !== null ? String(dayNum) : null,
            targetDate: activePrescriptionBoundaryRef.current?.prescriptionTargetDate ?? dateStr ?? null,
            targetLogId: editLogId || null,
          };

          const guidedItems: GuidedWorkoutIntegrationItem[] = prefilled.map((ex, exIdx) => {
            const templateEx = findMatchingTemplateExercise(ex, templates, exIdx);
            const initialEntry = initialRegistry.entries[exIdx];
            return {
              exercise: ex,
              exerciseIndex: exIdx,
              templateExercise: templateEx,
              lifecycleEvidence: {
                originProvenance: initialEntry.originProvenance,
                isHistoricalEdit: false,
                isRedoSession: false,
                isRestoredFromDraft: false,
                evaluationState: initialEntry.evaluationState,
                userTouchedSetKeys: new Set<string>(),
                checkedSetKeys: new Set<string>(),
                skippedSetKeys: new Set<string>(),
                hasCommittedLiveEvidence: false,
                hasLiveAdjustedSets: false,
                structuralMutationReason: initialEntry.structuralMutationReason,
                isStructurallyModified: false,
              },
            };
          });

          let guidedResults: readonly GuidedWorkoutIntegrationEntryResult[] | null = null;
          try {
            guidedResults = orchestrateGuidedWorkoutExercises({
              context: guidedContext,
              items: guidedItems,
            });
          } catch (_) {
            guidedResults = null;
          }

          let validationPassed = false;
          if (Array.isArray(guidedResults) && guidedResults.length === prefilled.length) {
            validationPassed = true;
            const seenIndices = new Set<number>();
            for (let i = 0; i < guidedResults.length; i++) {
              const entry = guidedResults[i];
              if (
                !entry ||
                typeof entry.exerciseIndex !== 'number' ||
                !Number.isInteger(entry.exerciseIndex) ||
                entry.exerciseIndex < 0 ||
                entry.exerciseIndex >= prefilled.length ||
                entry.exerciseIndex !== i ||
                seenIndices.has(entry.exerciseIndex) ||
                !entry.result ||
                !entry.result.exercise ||
                !Array.isArray(entry.result.appliedSets)
              ) {
                validationPassed = false;
                break;
              }
              seenIndices.add(entry.exerciseIndex);
            }
            if (seenIndices.size !== prefilled.length) {
              validationPassed = false;
            }
          }

          let stagedRegistry: SessionExerciseRegistry = initialRegistry;
          let stagingSuccess = false;
          const nextGuidedExercises: ExerciseEntry[] = [];

          if (validationPassed && guidedResults) {
            stagingSuccess = true;
            for (let i = 0; i < guidedResults.length; i++) {
              const item = guidedResults[i];
              const updateOp = updateSessionExerciseEvaluationState(
                stagedRegistry,
                item.exerciseIndex,
                item.result.nextEvaluationState
              );
              if (!updateOp.applied) {
                stagingSuccess = false;
                break;
              }
              stagedRegistry = updateOp.registry;
              nextGuidedExercises.push({
                ...prefilled[i],
                ...item.result.exercise,
                sets: item.result.appliedSets.map((s: SetEntry) => ({ ...s })),
              });
            }
          }

          if (validationPassed && stagingSuccess) {
            const nextSnapshots = capturePrescribedSnapshotsFromExercises(nextGuidedExercises, {}, {});
            sessionExerciseRegistryRef.current = stagedRegistry;
            setExercises(nextGuidedExercises);
            setUserRawExercises(JSON.parse(JSON.stringify(prefilled)));
            setUserTouchedSets({});
            setPrescribedTargetSnapshots(nextSnapshots);
            setCommittedLiveEvidenceBySet({});
            setLiveAdjustedSets({});
            setCurrentSetGuideKey(highlightCurrentSet ? resolveInitialGuideKey(null, nextGuidedExercises) : null);
            setObjective(defaultObjective);
            setIsDraftLoaded(true);
            isDraftLoadedRef.current = true;
            return;
          }

          // Fail closed to base performance-led target result without partial updates
          const finalPre = prefilled.map((ex, exIdx) => {
            const templateEx = findMatchingTemplateExercise(ex, templates, exIdx);
            const occurrenceOrdinal = getExerciseOccurrenceOrdinal(prefilled, exIdx);
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
              predecessorProgramId: activeProgLocal.parentProgramId ?? null,
              algorithmPhaseOffset: activeProgLocal.algorithmPhaseOffset ?? 0,
              templateExercise: templateEx,
              bodyweightSnapshot,
              activeUnit: unit,
              programId: programId ? String(programId) : null,
              dayNum: dayNum !== undefined && dayNum !== null ? String(dayNum) : null,
              targetDate: dateStr || null,
              targetLogId: editLogId || null,
              targetChronology,
              sessionStartedAt: sessionStartedAtRef.current,
              occurrenceOrdinal,
            });
            return { ...ex, sets: calculated };
          });

          setExercises(finalPre);
          setUserRawExercises(JSON.parse(JSON.stringify(prefilled)));
          setUserTouchedSets({});
          setPrescribedTargetSnapshots(capturePrescribedSnapshotsFromExercises(finalPre, {}, {}));
          setCommittedLiveEvidenceBySet({});
          setLiveAdjustedSets({});
          setCurrentSetGuideKey(highlightCurrentSet ? resolveInitialGuideKey(null, finalPre) : null);
          setObjective(defaultObjective);
          sessionExerciseRegistryRef.current = initialRegistry;
          setIsDraftLoaded(true);
          isDraftLoadedRef.current = true;
          return;
        }

        const finalPre = prefilled.map((ex, exIdx) => {
          const templateEx = findMatchingTemplateExercise(ex, templates, exIdx);
          const occurrenceOrdinal = getExerciseOccurrenceOrdinal(prefilled, exIdx);
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
            predecessorProgramId: activeProgLocal.parentProgramId ?? null,
            algorithmPhaseOffset: activeProgLocal.algorithmPhaseOffset ?? 0,
            templateExercise: templateEx,
            bodyweightSnapshot,
            activeUnit: unit,
            programId: programId ? String(programId) : null,
            dayNum: dayNum !== undefined && dayNum !== null ? String(dayNum) : null,
            targetDate: dateStr || null,
            targetLogId: editLogId || null,
            targetChronology,
            sessionStartedAt: sessionStartedAtRef.current,
            occurrenceOrdinal,
          });
          return { ...ex, sets: calculated };
        });

        setExercises(finalPre);
        setUserRawExercises(JSON.parse(JSON.stringify(prefilled)));
        setUserTouchedSets({});
        setPrescribedTargetSnapshots(capturePrescribedSnapshotsFromExercises(finalPre, {}, {}));
        setCommittedLiveEvidenceBySet({});
        setLiveAdjustedSets({});
        setCurrentSetGuideKey(highlightCurrentSet ? resolveInitialGuideKey(null, finalPre) : null);
        setObjective(defaultObjective);
        sessionExerciseRegistryRef.current = createSessionExerciseRegistry(
          finalPre.map(() => 'session_template_init' as const)
        );
        setIsDraftLoaded(true);
        isDraftLoadedRef.current = true;
        return;
      }
    }

    // Default blank exercise if none loaded or is empty if isOneOff
    if (isOneOff) {
      setExercises([]);
      setUserRawExercises([]);
      setUserTouchedSets({});
      setPrescribedTargetSnapshots({});
      setCommittedLiveEvidenceBySet({});
      setLiveAdjustedSets({});
      setCurrentSetGuideKey(null);
      setObjective(defaultObjective);
      sessionExerciseRegistryRef.current = createSessionExerciseRegistry([]);
    } else {
      const defaultName = 'Barbell Bench Press (flat)';
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
          predecessorProgramId: activeProgLocal?.parentProgramId ?? null,
          algorithmPhaseOffset: activeProgLocal?.algorithmPhaseOffset ?? 0,
          bodyweightSnapshot,
          activeUnit: unit,
          targetDate: dateStr || null,
          targetLogId: editLogId || null,
          targetChronology,
          sessionStartedAt: sessionStartedAtRef.current,
        });
        return { ...ex, sets: calculated };
      });

      setExercises(finalPre);
      setUserRawExercises(JSON.parse(JSON.stringify(prefilled)));
      setUserTouchedSets({});
      setPrescribedTargetSnapshots(capturePrescribedSnapshotsFromExercises(finalPre, {}, {}));
      setCommittedLiveEvidenceBySet({});
      setLiveAdjustedSets({});
      setCurrentSetGuideKey(highlightCurrentSet ? resolveInitialGuideKey(null, finalPre) : null);
      setObjective(defaultObjective);
      sessionExerciseRegistryRef.current = createSessionExerciseRegistry(
        finalPre.map(() => 'session_template_init' as const)
      );
    }
    setIsDraftLoaded(true);
    isDraftLoadedRef.current = true;
  }, [editLogId, programId, dayNum, isOneOff, weekNum, redoFromLogId, targetDateParam]);

  const serializeWorkoutDraftPayload = (overrides?: {
    editLogId?: string | null;
    programId?: string | null;
    programName?: string;
    weekNum?: number | string;
    dayNum?: number | string;
    dateStr?: string;
    workoutDate?: string;
    startTime?: string;
    isOneOff?: boolean;
    scheduledDate?: string;
    exercises?: ExerciseEntry[];
    userRawExercises?: ExerciseEntry[] | null;
    duration?: number | '';
    notes?: string;
    sleep?: number | '';
    hydration?: HydrationLevel;
    calories?: number | '';
    protein?: number | '';
    soreness?: number;
    motivation?: number;
    checkedSets?: Record<string, boolean>;
    completionTouchedSets?: Record<string, boolean>;
    collapsed?: Record<number, boolean>;
    objective?: 'Off' | 'Hypertrophy' | 'Strength' | 'Deload';
    userTouchedSets?: Record<string, boolean>;
    prescribedTargetSnapshots?: Record<string, { weight: number | null; reps: number | null; rpe: number | null }>;
    committedLiveEvidenceBySet?: CommittedLiveEvidenceMap;
    liveAdjustedSets?: Record<string, boolean>;
    currentSetGuideKey?: string | null;
    bodyweightSnapshot?: BodyweightSnapshot | null;
    restIntervals?: RestInterval[];
    prescriptionBoundary?: {
      sessionStartedAt: number;
      prescriptionTargetDate: string;
    } | null;
  }): Record<string, any> => {
    const effectiveDate = overrides?.dateStr !== undefined ? overrides.dateStr : (overrides?.workoutDate !== undefined ? overrides.workoutDate : (workoutDate || dateStr));
    const draftData: Record<string, any> = {
      editLogId: overrides?.editLogId !== undefined ? overrides.editLogId : (editLogId || null),
      programId: overrides?.programId !== undefined ? overrides.programId : programId,
      programName: overrides?.programName !== undefined ? overrides.programName : programName,
      weekNum: overrides?.weekNum !== undefined ? overrides.weekNum : weekNum,
      dayNum: overrides?.dayNum !== undefined ? overrides.dayNum : dayNum,
      dateStr: effectiveDate,
      isOneOff: overrides?.isOneOff !== undefined ? overrides.isOneOff : isOneOff,
      scheduledDate: overrides?.scheduledDate !== undefined ? overrides.scheduledDate : scheduledDate,
      prescriptionBoundary: overrides?.prescriptionBoundary !== undefined
        ? (overrides.prescriptionBoundary
            ? {
                sessionStartedAt: overrides.prescriptionBoundary.sessionStartedAt,
                prescriptionTargetDate: overrides.prescriptionBoundary.prescriptionTargetDate,
              }
            : null)
        : (activePrescriptionBoundaryRef.current
            ? {
                sessionStartedAt: activePrescriptionBoundaryRef.current.sessionStartedAt,
                prescriptionTargetDate: activePrescriptionBoundaryRef.current.prescriptionTargetDate,
              }
            : null),
      exercises: overrides?.exercises !== undefined ? overrides.exercises : exercises,
      duration: overrides?.duration !== undefined ? overrides.duration : duration,
      notes: overrides?.notes !== undefined ? overrides.notes : notes,
      sleep: overrides?.sleep !== undefined ? overrides.sleep : sleep,
      hydration: overrides?.hydration !== undefined ? overrides.hydration : hydration,
      calories: overrides?.calories !== undefined ? overrides.calories : calories,
      protein: overrides?.protein !== undefined ? overrides.protein : protein,
      soreness: overrides?.soreness !== undefined ? overrides.soreness : soreness,
      motivation: overrides?.motivation !== undefined ? overrides.motivation : motivation,
      checkedSets: overrides?.checkedSets !== undefined ? overrides.checkedSets : checkedSets,
      completionTouchedSets: overrides?.completionTouchedSets !== undefined ? overrides.completionTouchedSets : completionTouchedSets,
      collapsed: overrides?.collapsed !== undefined ? overrides.collapsed : collapsed,
      objective: overrides?.objective !== undefined ? overrides.objective : objective,
      userRawExercises: overrides?.userRawExercises !== undefined ? overrides.userRawExercises : userRawExercises,
      userTouchedSets: overrides?.userTouchedSets !== undefined ? overrides.userTouchedSets : userTouchedSets,
      startTime: overrides?.startTime !== undefined ? overrides.startTime : startTime,
      prescribedTargetSnapshots: overrides?.prescribedTargetSnapshots !== undefined ? overrides.prescribedTargetSnapshots : prescribedTargetSnapshots,
      committedLiveEvidenceBySet: overrides?.committedLiveEvidenceBySet !== undefined ? overrides.committedLiveEvidenceBySet : committedLiveEvidenceBySet,
      liveAdjustedSets: overrides?.liveAdjustedSets !== undefined ? overrides.liveAdjustedSets : liveAdjustedSets,
      bodyweightSnapshot: overrides?.bodyweightSnapshot !== undefined ? overrides.bodyweightSnapshot : bodyweightSnapshot,
      restIntervals: overrides?.restIntervals !== undefined ? overrides.restIntervals : restIntervals,
    };

    const guideKey = overrides?.currentSetGuideKey !== undefined ? overrides.currentSetGuideKey : currentSetGuideKey;
    if (highlightCurrentSet) {
      draftData.currentSetGuideKey = guideKey;
    }

    return draftData;
  };

  const persistCurrentDraftImmediately = (overrides?: Parameters<typeof serializeWorkoutDraftPayload>[0]) => {
    if (!isDraftLoadedRef.current || draftFlushSuppressedRef.current) return;
    try {
      const payload = serializeWorkoutDraftPayload(overrides);
      latestDraftPayloadRef.current = payload;
      saveActiveWorkoutDraft(payload);
      setHasExistingDraft(true);
    } catch (e) {
      console.error('Failed to immediately save workout draft:', e);
    }
  };

  const saveWorkoutDraftImmediately = persistCurrentDraftImmediately;

  // Auto-save draft on every modification
  useEffect(() => {
    if (!isDraftLoaded || draftFlushSuppressedRef.current) return;

    const draftData = serializeWorkoutDraftPayload();
    latestDraftPayloadRef.current = draftData;
    saveActiveWorkoutDraft(draftData);
    setHasExistingDraft(true);
  }, [
    isDraftLoaded,
    editLogId,
    programId,
    programName,
    weekNum,
    dayNum,
    dateStr,
    workoutDate,
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
    completionTouchedSets,
    collapsed,
    objective,
    userRawExercises,
    userTouchedSets,
    startTime,
    prescribedTargetSnapshots,
    committedLiveEvidenceBySet,
    liveAdjustedSets,
    currentSetGuideKey,
    highlightCurrentSet,
    bodyweightSnapshot,
    restIntervals,
  ]);

  // Lifecycle flush on pagehide, visibilitychange (hidden), or unmount
  useEffect(() => {
    const handleFlush = () => {
      if (draftFlushSuppressedRef.current) return;
      if (latestDraftPayloadRef.current) {
        saveActiveWorkoutDraft(latestDraftPayloadRef.current);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        handleFlush();
      }
    };

    window.addEventListener('pagehide', handleFlush);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      handleFlush();
      window.removeEventListener('pagehide', handleFlush);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

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
      const nextDuration = Math.max(1, diffMin);
      setDuration(nextDuration);
      saveWorkoutDraftImmediately({ duration: nextDuration });
    } catch (e) {
      console.error('Error auto calculating duration:', e);
    }
  };

  const handleWorkoutDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextDate = e.target.value;
    setWorkoutDate(nextDate);
    saveWorkoutDraftImmediately({ workoutDate: nextDate, dateStr: nextDate });
  };

  const handleStartTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextTime = e.target.value;
    setStartTime(nextTime);
    saveWorkoutDraftImmediately({ startTime: nextTime });
  };

  const handleDurationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    const nextDuration = val === '' ? '' : Math.max(1, Number(val));
    setDuration(nextDuration);
    saveWorkoutDraftImmediately({ duration: nextDuration });
  };

  const handleSessionNotesChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextNotes = e.target.value;
    setNotes(nextNotes);
    saveWorkoutDraftImmediately({ notes: nextNotes });
  };

  const handleSleepChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    const nextSleep = val === '' ? '' : Math.max(0, Number(val));
    setSleep(nextSleep);
    saveWorkoutDraftImmediately({ sleep: nextSleep });
  };

  const handleHydrationChange = (level: HydrationLevel) => {
    setHydration(level);
    setIsHydrationDropdownOpen(false);
    saveWorkoutDraftImmediately({ hydration: level });
  };

  const handleCaloriesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    const nextCalories = val === '' ? '' : Math.max(0, Number(val));
    setCalories(nextCalories);
    saveWorkoutDraftImmediately({ calories: nextCalories });
  };

  const handleProteinChange = (valOrEvent: React.ChangeEvent<HTMLInputElement> | number | '') => {
    let nextProtein: number | '';
    if (typeof valOrEvent === 'number' || valOrEvent === '') {
      nextProtein = valOrEvent;
    } else {
      const val = valOrEvent.target.value;
      nextProtein = val === '' ? '' : Math.max(0, Number(val));
    }
    setProtein(nextProtein as number);
    saveWorkoutDraftImmediately({ protein: nextProtein });
  };

  const handleSorenessChange = (val: number) => {
    setSoreness(val);
    saveWorkoutDraftImmediately({ soreness: val });
  };

  const handleMotivationChange = (val: number) => {
    setMotivation(val);
    saveWorkoutDraftImmediately({ motivation: val });
  };

  const handleDiscardDraft = () => {
    draftFlushSuppressedRef.current = true;
    latestDraftPayloadRef.current = null;
    clearActiveWorkoutDraft();
    setHasExistingDraft(false);
    setIsDraftLoaded(false);
    isDraftLoadedRef.current = false;
    activePrescriptionBoundaryRef.current = null;
    setRestIntervals([]);
    clearActiveRestTimer();
    sessionExerciseRegistryRef.current = clearSessionExerciseRegistry();
    onClose();
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
    const programDayTemplates = (activeProg && activeProg.exercisesByDay?.[Number(dayNum)]) || null;

    return list.map((ex, exIdx) => {
      if (activeObj === 'Off') {
        return ex;
      }

      const templateEx = findMatchingTemplateExercise(ex, programDayTemplates, exIdx);
      const occurrenceOrdinal = getExerciseOccurrenceOrdinal(list, exIdx);

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
        predecessorProgramId: activeProg?.parentProgramId ?? null,
        algorithmPhaseOffset: activeProg?.algorithmPhaseOffset ?? 0,
        templateExercise: templateEx,
        bodyweightSnapshot,
        activeUnit: unit,
        programId: programId ? String(programId) : null,
        dayNum: dayNum !== undefined && dayNum !== null ? String(dayNum) : null,
        targetDate: dateStr || null,
        targetLogId: editLogId || null,
        targetChronology,
        sessionStartedAt: sessionStartedAtRef.current,
        occurrenceOrdinal,
      });

      return { ...ex, sets: calculated };
    });
  };

  const handleChangeObjective = (newObjective: 'Off' | 'Hypertrophy' | 'Strength' | 'Deload') => {
    if (newObjective === objective) return;

    // Apply the objective immediately
    setObjective(newObjective);
    const updated = applyObjectiveCalculationsToExercises(exercises, newObjective);
    setExercises(updated);
    setPrescribedTargetSnapshots(prevSnaps =>
      capturePrescribedSnapshotsFromExercises(updated, prevSnaps, userTouchedSets)
    );
    setCommittedLiveEvidenceBySet({});
    setLiveAdjustedSets({});

    // Show a prompt if switching to Strength with no main movement selected
    if (newObjective === 'Strength') {
      const eligibleCount = getEligibleMainMovementCount(updated);
      if (eligibleCount === 0) {
        setShowStrengthMainMovementPrompt(true);
      }
    }
  };

  const persistMainMovementMetadata = (targetIdx: number | null, activeExerciseName?: string) => {
    if (isOneOff || !programId || !dayNum) return;
    try {
      const programs = storage.getPrograms();
      const currentProg = programs.find(p => p.id === programId) || PREBUILT_TEMPLATES.find(p => p.id === programId);
      if (!currentProg) return;

      const dayInt = Number(dayNum);
      const result = updateProgramDayMainMovement(currentProg, dayInt, targetIdx, activeExerciseName);
      if (result.success && result.updatedProgram) {
        storage.saveProgram(result.updatedProgram);
      } else if (!result.success && result.error) {
        setAlertMsg(result.error);
      }
    } catch (e) {
      console.error('Failed to persist main movement metadata to program template:', e);
    }
  };

  const recordSessionExerciseStructuralMutation = (
    indexOrIndices: number | readonly number[],
    reason: ExerciseStructuralMutationReason
  ): boolean => {
    const currentRegistry = sessionExerciseRegistryRef.current;
    if (!currentRegistry || currentRegistry.entries.length !== exercises.length) {
      return false;
    }
    const rawIndices = Array.isArray(indexOrIndices) ? indexOrIndices : [indexOrIndices];
    const dedupedIndices = Array.from(new Set(rawIndices));
    if (dedupedIndices.length === 0) {
      return false;
    }
    for (const idx of dedupedIndices) {
      if (!Number.isInteger(idx) || idx < 0 || idx >= exercises.length) {
        return false;
      }
    }

    let workingRegistry = currentRegistry;
    for (const idx of dedupedIndices) {
      const result = markSessionExerciseStructuralMutation(workingRegistry, idx, reason);
      if (!result.applied) {
        return false;
      }
      workingRegistry = result.registry;
    }

    sessionExerciseRegistryRef.current = workingRegistry;
    return true;
  };

  const toggleMainMovement = (targetIdx: number) => {
    if (!Number.isInteger(targetIdx) || targetIdx < 0 || targetIdx >= exercises.length) {
      return;
    }
    const eligibleCount = getEligibleMainMovementCount(exercises);
    if (!isOneOff && Number(weekNum) > 1 && eligibleCount === 1) {
      setAlertMsg("The Main Movement is locked after Week 1 to prevent disrupting your periodised loading progression and weight recommendations.");
      return;
    }
    const targetEx = exercises[targetIdx];
    if (!targetEx) return;
    const isCurrentlyMain = !!targetEx.isMainMovement;

    if (isCurrentlyMain) {
      if (!recordSessionExerciseStructuralMutation(targetIdx, 'other_exercise_structure_changed')) {
        return;
      }
      const baseUpdated = exercises.map((ex, idx) => {
        if (idx === targetIdx) {
          return { ...ex, isMainMovement: false };
        }
        return ex;
      });

      const updated = applyObjectiveCalculationsToExercises(baseUpdated, objective);
      const nextSnaps = capturePrescribedSnapshotsFromExercises(updated, prescribedTargetSnapshots, userTouchedSets);
      setExercises(updated);
      setPrescribedTargetSnapshots(nextSnaps);
      persistMainMovementMetadata(null);
      saveWorkoutDraftImmediately({
        exercises: updated,
        prescribedTargetSnapshots: nextSnaps,
      });
    } else {
      const currentMainIdx = exercises.findIndex(ex => !!ex.isMainMovement);
      if (currentMainIdx !== -1 && eligibleCount === 1) {
        setSwapMainTargetIdx(targetIdx);
      } else {
        if (!recordSessionExerciseStructuralMutation(targetIdx, 'other_exercise_structure_changed')) {
          return;
        }
        const baseUpdated = exercises.map((ex, idx) => {
          return { ...ex, isMainMovement: idx === targetIdx };
        });

        const updated = applyObjectiveCalculationsToExercises(baseUpdated, objective);
        const nextSnaps = capturePrescribedSnapshotsFromExercises(updated, prescribedTargetSnapshots, userTouchedSets);
        setExercises(updated);
        setPrescribedTargetSnapshots(nextSnaps);
        persistMainMovementMetadata(targetIdx, targetEx.name);
        saveWorkoutDraftImmediately({
          exercises: updated,
          prescribedTargetSnapshots: nextSnaps,
        });
      }
    }
  };

  const handleConfirmSwapMainMovement = () => {
    if (swapMainTargetIdx === null) return;
    if (!Number.isInteger(swapMainTargetIdx) || swapMainTargetIdx < 0 || swapMainTargetIdx >= exercises.length) {
      setSwapMainTargetIdx(null);
      return;
    }
    const targetEx = exercises[swapMainTargetIdx];
    if (!targetEx) {
      setSwapMainTargetIdx(null);
      return;
    }
    const targetName = targetEx.name;

    const affectedIndices: number[] = [];
    exercises.forEach((ex, idx) => {
      const proposed = idx === swapMainTargetIdx;
      if (Boolean(ex.isMainMovement) !== proposed) {
        affectedIndices.push(idx);
      }
    });

    if (affectedIndices.length === 0) {
      setSwapMainTargetIdx(null);
      return;
    }

    if (!recordSessionExerciseStructuralMutation(affectedIndices, 'other_exercise_structure_changed')) {
      return;
    }

    const baseUpdated = exercises.map((ex, idx) => {
      return { ...ex, isMainMovement: idx === swapMainTargetIdx };
    });

    const updated = applyObjectiveCalculationsToExercises(baseUpdated, objective);
    const nextSnaps = capturePrescribedSnapshotsFromExercises(updated, prescribedTargetSnapshots, userTouchedSets);
    setExercises(updated);
    setPrescribedTargetSnapshots(nextSnaps);

    persistMainMovementMetadata(swapMainTargetIdx, targetName);
    setSwapMainTargetIdx(null);
    saveWorkoutDraftImmediately({
      exercises: updated,
      prescribedTargetSnapshots: nextSnaps,
    });
  };

  const handleAddExercise = () => {
    const currentRegistry = sessionExerciseRegistryRef.current;
    if (!currentRegistry || currentRegistry.entries.length !== exercises.length) {
      return;
    }

    const newItem: ExerciseEntry = {
      name: 'New Exercise',
      muscleGroup: 'Chest',
      modality: 'weighted',
      sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 8, form: 'standard' as const }],
    };

    const baseRaw = userRawExercises || [];
    const nextUserRaw = [...baseRaw, newItem];

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
      algorithmId: activeProg?.algorithmId,
      predecessorProgramId: activeProg?.parentProgramId ?? null,
      algorithmPhaseOffset: activeProg?.algorithmPhaseOffset ?? 0,
      bodyweightSnapshot,
      activeUnit: unit,
      programId: programId ? String(programId) : null,
      dayNum: dayNum !== undefined && dayNum !== null ? String(dayNum) : null,
      targetDate: dateStr || null,
      targetLogId: editLogId || null,
      targetChronology,
      sessionStartedAt: sessionStartedAtRef.current,
    });
    const finalNew = { ...newItem, sets: calculatedSets };

    const nextSnapshots = capturePrescribedSnapshotsFromExercises([finalNew], prescribedTargetSnapshots, {}, exercises.length);
    const nextExercises = [...exercises, finalNew];

    const op = appendSessionExerciseRegistryEntry(
      currentRegistry,
      'user_added_blank'
    );
    if (!op.applied) return;
    sessionExerciseRegistryRef.current = op.registry;

    setUserRawExercises(nextUserRaw);
    setPrescribedTargetSnapshots(nextSnapshots);
    setExercises(nextExercises);

    saveWorkoutDraftImmediately({
      exercises: nextExercises,
      userRawExercises: nextUserRaw,
      prescribedTargetSnapshots: nextSnapshots,
    });
  };

  const handleDeleteExercise = (idx: number) => {
    const currentRegistry = sessionExerciseRegistryRef.current;
    if (!currentRegistry || currentRegistry.entries.length !== exercises.length) {
      return;
    }

    const op = removeSessionExerciseRegistryEntry(
      currentRegistry,
      idx
    );
    if (!op.applied) return;
    sessionExerciseRegistryRef.current = op.registry;

    const nextUserRaw = userRawExercises ? userRawExercises.filter((_, i) => i !== idx) : null;
    const nextExercises = exercises.filter((_, i) => i !== idx);
    const nextGuideKey = reconcileGuideAfterExerciseDelete(currentSetGuideKey, idx, nextExercises);
    const nextChecked = remapAfterExerciseDelete(checkedSets, idx);
    const nextTouched = remapAfterExerciseDelete(userTouchedSets, idx);
    const nextCompletionTouched = remapAfterExerciseDelete(completionTouchedSets, idx);
    const nextSnapshots = remapAfterExerciseDelete(prescribedTargetSnapshots, idx);
    const nextEvidence = remapAfterExerciseDelete(committedLiveEvidenceBySet, idx);
    const nextLiveAdjusted = remapAfterExerciseDelete(liveAdjustedSets, idx);
    const nextCollapsed: Record<number, boolean> = {};
    Object.entries(collapsed).forEach(([k, v]) => {
      const i = parseInt(k, 10);
      if (i < idx) nextCollapsed[i] = v;
      else if (i > idx) nextCollapsed[i - 1] = v;
    });

    setUserRawExercises(nextUserRaw);
    setExercises(nextExercises);
    setCurrentSetGuideKey(nextGuideKey);
    setCheckedSets(nextChecked);
    setUserTouchedSets(nextTouched);
    setCompletionTouchedSets(nextCompletionTouched);
    setPrescribedTargetSnapshots(nextSnapshots);
    setCommittedLiveEvidenceBySet(nextEvidence);
    setLiveAdjustedSets(nextLiveAdjusted);
    setCollapsed(nextCollapsed);

    saveWorkoutDraftImmediately({
      exercises: nextExercises,
      userRawExercises: nextUserRaw,
      checkedSets: nextChecked,
      userTouchedSets: nextTouched,
      completionTouchedSets: nextCompletionTouched,
      prescribedTargetSnapshots: nextSnapshots,
      committedLiveEvidenceBySet: nextEvidence,
      liveAdjustedSets: nextLiveAdjusted,
      collapsed: nextCollapsed,
      currentSetGuideKey: nextGuideKey,
    });
  };

  const handleToggleSkipExercise = (idx: number) => {
    const nextExs = exercises.map((ex, i) => {
      if (i === idx) {
        return {
          ...ex,
          isSkipped: !ex.isSkipped
        };
      }
      return ex;
    });
    const isNowSkipped = !!nextExs[idx]?.isSkipped;
    const nextGuideKey = reconcileGuideAfterExerciseSkip(currentSetGuideKey, idx, isNowSkipped, nextExs);
    setExercises(nextExs);
    setCurrentSetGuideKey(nextGuideKey);
    saveWorkoutDraftImmediately({
      exercises: nextExs,
      currentSetGuideKey: nextGuideKey,
    });
  };

  const handleToggleDropSet = (exIdx: number, setIdx: number) => {
    if (!Number.isInteger(exIdx) || exIdx < 0 || exIdx >= exercises.length) {
      return;
    }
    const currentEx = exercises[exIdx];
    if (!currentEx || !currentEx.sets || !Number.isInteger(setIdx) || setIdx < 0 || setIdx >= currentEx.sets.length) {
      return;
    }
    if (!recordSessionExerciseStructuralMutation(exIdx, 'drop_set_structure_changed')) {
      return;
    }
    const nextExercises = exercises.map((ex, i) => {
      if (i === exIdx) {
        const sets = ex.sets.map((s, sIdx) => {
          if (sIdx === setIdx) {
            const nextIsDropSet = !s.isDropSet;
            let nextDropSubSets = s.dropSubSets;
            if (nextIsDropSet && (!nextDropSubSets || nextDropSubSets.length === 0)) {
              // Fetch historical drop subsets, or fall back to %-Relative Standard
              try {
                const logs = storage.getWorkoutLogs();
                const sortedLogs = logs && logs.length > 0 ? [...logs].sort((a, b) => b.date.localeCompare(a.date)) : [];
                let foundHist = false;
                for (const log of sortedLogs) {
                  const matchedEx = log.exercises.find(
                    e => e.name.trim().toLowerCase() === ex.name.trim().toLowerCase()
                  );
                  if (matchedEx && matchedEx.sets && matchedEx.sets[setIdx]) {
                    const histSet = matchedEx.sets[setIdx];
                    if (histSet.isDropSet && histSet.dropSubSets && histSet.dropSubSets.length > 0) {
                      nextDropSubSets = histSet.dropSubSets.map(ds => ({
                        weight: ds.weight,
                        reps: ds.reps
                      }));
                      foundHist = true;
                      break;
                    }
                  }
                }
                if (!foundHist) {
                  const parentWeight = s.weight || 0;
                  const parentReps = s.reps || 8;
                  const defWeight = parentWeight ? roundToNearest25(parentWeight * 0.8) : null;
                  const defReps = parentReps ? Math.max(1, Math.round(parentReps * 0.8)) : null;
                  nextDropSubSets = [{ weight: defWeight, reps: defReps }];
                }
              } catch (err) {
                console.error('Error fetching historical drop sets inside toggle:', err);
                const parentWeight = s.weight || 0;
                const parentReps = s.reps || 8;
                const defWeight = parentWeight ? roundToNearest25(parentWeight * 0.8) : null;
                const defReps = parentReps ? Math.max(1, Math.round(parentReps * 0.8)) : null;
                nextDropSubSets = [{ weight: defWeight, reps: defReps }];
              }
            }
            return { ...s, isDropSet: nextIsDropSet, isWarmup: false, dropSubSets: nextDropSubSets };
          }
          return s;
        });
        return { ...ex, sets };
      }
      return ex;
    });

    setExercises(nextExercises);
    saveWorkoutDraftImmediately({
      exercises: nextExercises,
    });
  };

  const handleAddDropSubSet = (exIdx: number, setIdx: number) => {
    if (
      !Number.isInteger(exIdx) || exIdx < 0 || exIdx >= exercises.length ||
      !Number.isInteger(setIdx) || setIdx < 0
    ) {
      return;
    }
    const currentEx = exercises[exIdx];
    if (!currentEx || !currentEx.sets || setIdx >= currentEx.sets.length) {
      return;
    }
    if (!recordSessionExerciseStructuralMutation(exIdx, 'drop_subsets_changed')) {
      return;
    }
    const nextExercises = exercises.map((ex, i) => {
      if (i === exIdx) {
        const sets = ex.sets.map((s, sIdx) => {
          if (sIdx === setIdx) {
            const currentSubs = s.dropSubSets || [];
            let newWeight = null;
            let newReps = null;
            if (currentSubs.length > 0) {
              const lastSub = currentSubs[currentSubs.length - 1];
              if (lastSub.weight) {
                newWeight = roundToNearest25(lastSub.weight * 0.8);
              }
              newReps = lastSub.reps || s.reps || 8;
            } else {
              const parentWeight = s.weight || 0;
              newWeight = parentWeight ? roundToNearest25(parentWeight * 0.8) : null;
              newReps = s.reps || 8;
            }
            const nextSubs = [...currentSubs, { weight: newWeight, reps: newReps }];
            return { ...s, dropSubSets: nextSubs };
          }
          return s;
        });
        return { ...ex, sets };
      }
      return ex;
    });

    setExercises(nextExercises);
    saveWorkoutDraftImmediately({
      exercises: nextExercises,
    });
  };

  const handleUpdateDropSubSet = (exIdx: number, setIdx: number, subIdx: number, field: 'weight' | 'reps', value: number | null) => {
    if (
      !Number.isInteger(exIdx) || exIdx < 0 || exIdx >= exercises.length ||
      !Number.isInteger(setIdx) || setIdx < 0 ||
      !Number.isInteger(subIdx) || subIdx < 0 ||
      (field !== 'weight' && field !== 'reps')
    ) {
      return;
    }
    const targetEx = exercises[exIdx];
    if (!targetEx || !targetEx.sets || setIdx >= targetEx.sets.length) {
      return;
    }
    const targetSet = targetEx.sets[setIdx];
    if (!targetSet || !targetSet.dropSubSets || subIdx >= targetSet.dropSubSets.length) {
      return;
    }
    const targetSub = targetSet.dropSubSets[subIdx];
    if (!targetSub || targetSub[field] === value) {
      return;
    }
    if (!recordSessionExerciseStructuralMutation(exIdx, 'drop_subsets_changed')) {
      return;
    }
    const nextExercises = exercises.map((ex, i) => {
      if (i === exIdx) {
        const sets = ex.sets.map((s, sIdx) => {
          if (sIdx === setIdx && s.dropSubSets) {
            const nextSubs = s.dropSubSets.map((sub, idx) =>
              idx === subIdx ? { ...sub, [field]: value } : sub
            );
            return { ...s, dropSubSets: nextSubs };
          }
          return s;
        });
        return { ...ex, sets };
      }
      return ex;
    });

    setExercises(nextExercises);
    saveWorkoutDraftImmediately({
      exercises: nextExercises,
    });
  };

  const handleRemoveDropSubSet = (exIdx: number, setIdx: number, subIdx: number) => {
    if (
      !Number.isInteger(exIdx) || exIdx < 0 || exIdx >= exercises.length ||
      !Number.isInteger(setIdx) || setIdx < 0 ||
      !Number.isInteger(subIdx) || subIdx < 0
    ) {
      return;
    }
    const currentEx = exercises[exIdx];
    if (!currentEx || !currentEx.sets || setIdx >= currentEx.sets.length) {
      return;
    }
    const targetSet = currentEx.sets[setIdx];
    if (!targetSet || !targetSet.dropSubSets || subIdx >= targetSet.dropSubSets.length) {
      return;
    }
    if (!recordSessionExerciseStructuralMutation(exIdx, 'drop_subsets_changed')) {
      return;
    }
    const nextExercises = exercises.map((ex, i) => {
      if (i === exIdx) {
        const sets = ex.sets.map((s, sIdx) => {
          if (sIdx === setIdx && s.dropSubSets) {
            const nextSubs = s.dropSubSets.filter((_, idx) => idx !== subIdx);
            const nextIsDropSet = nextSubs.length > 0 ? s.isDropSet : false;
            return { ...s, isDropSet: nextIsDropSet, dropSubSets: nextSubs };
          }
          return s;
        });
        return { ...ex, sets };
      }
      return ex;
    });

    setExercises(nextExercises);
    saveWorkoutDraftImmediately({
      exercises: nextExercises,
    });
  };

  const handleToggleWarmup = (exIdx: number, setIdx: number) => {
    if (!Number.isInteger(exIdx) || exIdx < 0 || exIdx >= exercises.length) {
      return;
    }
    const currentEx = exercises[exIdx];
    if (!currentEx || !currentEx.sets || !Number.isInteger(setIdx) || setIdx < 0 || setIdx >= currentEx.sets.length) {
      return;
    }
    const targetSet = currentEx.sets[setIdx];
    if (targetSet?.isSkipped) return;

    if (!recordSessionExerciseStructuralMutation(exIdx, 'warmup_structure_changed')) {
      return;
    }

    const nextExercises = exercises.map((ex, i) => {
      if (i === exIdx) {
        const sets = ex.sets.map((s, sIdx) =>
          sIdx === setIdx ? { ...s, isWarmup: !s.isWarmup, isDropSet: false } : s
        );
        return { ...ex, sets };
      }
      return ex;
    });

    setExercises(nextExercises);
    saveWorkoutDraftImmediately({
      exercises: nextExercises,
    });
  };

  const handleToggleSkipSet = (exIdx: number, setIdx: number) => {
    const currentEx = exercises[exIdx];
    if (!currentEx) return;
    const targetSet = currentEx.sets[setIdx];
    if (!targetSet || targetSet.isWarmup) return;

    const isSkipping = !targetSet.isSkipped;
    if (isSkipping) {
      const check = canSkipSet(currentEx.sets, setIdx);
      if (!check.allowed) {
        setAlertMsg(check.reason || 'Cannot skip set');
        return;
      }
    } else {
      const check = canUnskipSet(currentEx.sets, setIdx);
      if (!check.allowed) {
        setAlertMsg(check.reason || 'Cannot unskip set');
        return;
      }
    }

    const nextUserRaw = userRawExercises
      ? userRawExercises.map((ex, i) => {
          if (i === exIdx) {
            const sets = ex.sets.map((s, sIdx) =>
              sIdx === setIdx ? { ...s, isSkipped: isSkipping } : s
            );
            return { ...ex, sets };
          }
          return ex;
        })
      : null;

    const nextExs = exercises.map((ex, i) => {
      if (i === exIdx) {
        const sets = ex.sets.map((s, sIdx) =>
          sIdx === setIdx ? { ...s, isSkipped: isSkipping } : s
        );
        return { ...ex, sets };
      }
      return ex;
    });

    const nextGuideKey = reconcileGuideAfterSetSkip(currentSetGuideKey, exIdx, setIdx, isSkipping, nextExs);

    setUserRawExercises(nextUserRaw);
    setExercises(nextExs);
    setCurrentSetGuideKey(nextGuideKey);
    setAddSetBlockedWarning(prev => ({ ...prev, [exIdx]: null }));

    saveWorkoutDraftImmediately({
      exercises: nextExs,
      userRawExercises: nextUserRaw,
      currentSetGuideKey: nextGuideKey,
    });
  };

  const applyAutoWarmupSets = (
    exIdx: number,
    warmupTargets: Array<{ weight: number | null; reps: number; rpe?: number }>
  ) => {
    if (!Number.isInteger(exIdx) || exIdx < 0 || exIdx >= exercises.length) {
      return;
    }
    const currentEx = exercises[exIdx];
    if (!currentEx) return;

    if (!recordSessionExerciseStructuralMutation(exIdx, 'warmup_structure_changed')) {
      return;
    }

    const priorWarmupCount = currentEx.sets.filter(s => s.isWarmup).length;
    const newWarmupCount = warmupTargets.length;
    let nextCombinedSets: SetEntry[] | null = null;

    const nextExercises = exercises.map((ex, i) => {
      if (i === exIdx) {
        const workingSetsOnly = ex.sets.filter(s => !s.isWarmup);
        const autoWarmupSets: SetEntry[] = warmupTargets.map((t, tIdx) => ({
          setNumber: tIdx + 1,
          weight: t.weight,
          reps: t.reps,
          rpe: t.rpe,
          form: 'standard',
          isWarmup: true,
        }));

        const combined = [...autoWarmupSets, ...workingSetsOnly].map((s, idx) => ({
          ...s,
          setNumber: idx + 1,
        }));
        nextCombinedSets = combined;

        return { ...ex, sets: combined };
      }
      return ex;
    });

    const nextGuideKey = highlightCurrentSet && nextCombinedSets
      ? reconcileGuideAfterWarmupChange(currentSetGuideKey, exIdx, currentEx.sets, nextCombinedSets!)
      : currentSetGuideKey;

    const nextChecked = remapAfterWarmupChange(checkedSets, exIdx, priorWarmupCount, newWarmupCount);
    const nextTouched = remapAfterWarmupChange(userTouchedSets, exIdx, priorWarmupCount, newWarmupCount);
    const nextCompletionTouched = remapAfterWarmupChange(completionTouchedSets, exIdx, priorWarmupCount, newWarmupCount);
    const nextSnapshots = remapAfterWarmupChange(prescribedTargetSnapshots, exIdx, priorWarmupCount, newWarmupCount);
    const nextEvidence = remapAfterWarmupChange(committedLiveEvidenceBySet, exIdx, priorWarmupCount, newWarmupCount);
    const nextLiveAdjusted = remapAfterWarmupChange(liveAdjustedSets, exIdx, priorWarmupCount, newWarmupCount);

    setExercises(nextExercises);
    if (highlightCurrentSet && nextCombinedSets) {
      setCurrentSetGuideKey(nextGuideKey);
    }
    setCheckedSets(nextChecked);
    setUserTouchedSets(nextTouched);
    setCompletionTouchedSets(nextCompletionTouched);
    setPrescribedTargetSnapshots(nextSnapshots);
    setCommittedLiveEvidenceBySet(nextEvidence);
    setLiveAdjustedSets(nextLiveAdjusted);

    saveWorkoutDraftImmediately({
      exercises: nextExercises,
      checkedSets: nextChecked,
      userTouchedSets: nextTouched,
      completionTouchedSets: nextCompletionTouched,
      prescribedTargetSnapshots: nextSnapshots,
      committedLiveEvidenceBySet: nextEvidence,
      liveAdjustedSets: nextLiveAdjusted,
      currentSetGuideKey: nextGuideKey,
    });
  };

  const handleAutoWarmup = (exIdx: number, setIdx: number) => {
    const currentEx = exercises[exIdx];
    if (!currentEx) return;
    const targetSet = currentEx.sets[setIdx];
    if (targetSet?.isSkipped) return;

    const validationResult = validateAndGenerateAutoWarmup({
      exercise: currentEx,
      selectedSetIdx: setIdx,
      bodyweightSnapshot,
      activeUnit: unit,
    });

    if (validationResult.status === 'bypassed' || !validationResult.warmupTargets) {
      showLiveAdjustmentToast(validationResult.message, AUTO_WARMUP_TOAST_DURATION_MS);
      return;
    }

    const hasExistingWarmups = currentEx.sets.some(s => s.isWarmup);
    if (hasExistingWarmups) {
      setWarmupReplacementConfirmState({ exIdx, setIdx });
      return;
    }

    applyAutoWarmupSets(exIdx, validationResult.warmupTargets);
  };

  const handleConfirmWarmupReplacement = () => {
    if (!warmupReplacementConfirmState) return;
    const { exIdx, setIdx } = warmupReplacementConfirmState;
    const currentEx = exercises[exIdx];
    if (!currentEx) {
      setWarmupReplacementConfirmState(null);
      return;
    }

    const validationResult = validateAndGenerateAutoWarmup({
      exercise: currentEx,
      selectedSetIdx: setIdx,
      bodyweightSnapshot,
      activeUnit: unit,
    });

    if (validationResult.status === 'bypassed' || !validationResult.warmupTargets) {
      showLiveAdjustmentToast(validationResult.message, AUTO_WARMUP_TOAST_DURATION_MS);
      setWarmupReplacementConfirmState(null);
      return;
    }

    applyAutoWarmupSets(exIdx, validationResult.warmupTargets);
    setWarmupReplacementConfirmState(null);
  };

  const handleOpenCalc = (exIdx: number, setIdx: number) => {
    const targetEx = exercises[exIdx];
    if (!targetEx || !isCalculatorSupportedForModality(targetEx.modality)) return;
    const targetSet = targetEx.sets[setIdx];
    if (!targetSet || targetSet.isSkipped) return;

    setCalcMode('find_weight');
    setCalcRepsInput(
      targetSet.reps && targetSet.reps >= 1 && targetSet.reps <= 25
        ? String(targetSet.reps)
        : '10'
    );
    setCalcRpe(
      targetSet.rpe && targetSet.rpe >= 6.0 && targetSet.rpe <= 10.0
        ? targetSet.rpe
        : 8.0
    );
    setCalcWeightInput(
      targetSet.weight !== null && targetSet.weight !== undefined && !isNaN(targetSet.weight) && targetSet.weight > 0
        ? String(targetSet.weight)
        : ''
    );
    setCalcModalState({ exIdx, setIdx });
    dismissSetAction();
  };

  const handleUpdateSetComment = (exIdx: number, setIdx: number, comment: string) => {
    const nextExercises = exercises.map((ex, i) => {
      if (i === exIdx) {
        const sets = ex.sets.map((s, sIdx) =>
          sIdx === setIdx ? { ...s, comment: comment || null } : s
        );
        return { ...ex, sets };
      }
      return ex;
    });
    setExercises(nextExercises);
    saveWorkoutDraftImmediately({ exercises: nextExercises });
  };

  const handleMoveSetTo = (exIdx: number, setIdx: number, targetIdx: number) => {
    const currentEx = exercises[exIdx];
    if (!currentEx || setIdx === targetIdx || targetIdx < 0 || targetIdx >= currentEx.sets.length) return;

    // A move is an array splice, so both the dragged object and all of its
    // nested data remain intact. Skipped working sets must remain a suffix.
    const simulatedSets = [...currentEx.sets];
    const [movedSet] = simulatedSets.splice(setIdx, 1);
    simulatedSets.splice(targetIdx, 0, movedSet);
    if (!isValidSkippedSuffix(simulatedSets)) {
      setAlertMsg('Cannot move set because skipped sets must remain at the end of the exercise.');
      return;
    }

    if (!recordSessionExerciseStructuralMutation(exIdx, 'set_reordered')) {
      return;
    }

    const nextUserRaw = userRawExercises
      ? userRawExercises.map((ex, i) => {
          if (i === exIdx) {
            if (targetIdx < 0 || targetIdx >= ex.sets.length) return ex;
            const sets = [...ex.sets];
            const [moved] = sets.splice(setIdx, 1);
            sets.splice(targetIdx, 0, moved);
            const reindexed = sets.map((s, idx) => ({ ...s, setNumber: idx + 1 }));
            return { ...ex, sets: reindexed };
          }
          return ex;
        })
      : null;

    const nextExercises = exercises.map((ex, i) => {
      if (i === exIdx) {
        const sets = [...ex.sets];
        const [moved] = sets.splice(setIdx, 1);
        sets.splice(targetIdx, 0, moved);
        const reindexed = sets.map((s, idx) => ({ ...s, setNumber: idx + 1 }));
        return { ...ex, sets: reindexed };
      }
      return ex;
    });

    const nextChecked = remapAfterSetMove(checkedSets, exIdx, setIdx, targetIdx);
    const nextTouched = remapAfterSetMove(userTouchedSets, exIdx, setIdx, targetIdx);
    const nextCompletionTouched = remapAfterSetMove(completionTouchedSets, exIdx, setIdx, targetIdx);
    const nextSnapshots = remapAfterSetMove(prescribedTargetSnapshots, exIdx, setIdx, targetIdx);
    const nextEvidence = remapAfterSetMove(committedLiveEvidenceBySet, exIdx, setIdx, targetIdx);
    const nextLiveAdjusted = remapAfterSetMove(liveAdjustedSets, exIdx, setIdx, targetIdx);
    const nextGuideKey = reconcileGuideAfterSetMove(currentSetGuideKey, exIdx, setIdx, targetIdx, nextExercises);

    setUserRawExercises(nextUserRaw);
    setExercises(nextExercises);
    setCheckedSets(nextChecked);
    setUserTouchedSets(nextTouched);
    setCompletionTouchedSets(nextCompletionTouched);
    setPrescribedTargetSnapshots(nextSnapshots);
    setCommittedLiveEvidenceBySet(nextEvidence);
    setLiveAdjustedSets(nextLiveAdjusted);
    setCurrentSetGuideKey(nextGuideKey);

    saveWorkoutDraftImmediately({
      exercises: nextExercises,
      userRawExercises: nextUserRaw,
      checkedSets: nextChecked,
      userTouchedSets: nextTouched,
      completionTouchedSets: nextCompletionTouched,
      prescribedTargetSnapshots: nextSnapshots,
      committedLiveEvidenceBySet: nextEvidence,
      liveAdjustedSets: nextLiveAdjusted,
      currentSetGuideKey: nextGuideKey,
    });
  };

  const handleMoveSet = (exIdx: number, setIdx: number, direction: 'up' | 'down') => {
    handleMoveSetTo(exIdx, setIdx, direction === 'up' ? setIdx - 1 : setIdx + 1);
  };

  const endSetDrag = (commit: boolean) => {
    const drag = setDragRef.current;
    if (setHoldRef.current) {
      clearTimeout(setHoldRef.current.timer);
      setHoldRef.current = null;
    }
    setPressedSetOptions(null);
    if (!drag) return;
    document.body.style.overflow = bodyOverflowBeforeDragRef.current;
    setDragRef.current = null;
    setSetDrag(null);
    if (commit && drag.destinationIdx !== drag.setIdx) {
      handleMoveSetTo(drag.exIdx, drag.setIdx, drag.destinationIdx);
      const droppedKey = `${drag.exIdx}-${drag.destinationIdx}`;
      setRecentlyDroppedSet(droppedKey);
      if (dropHighlightTimerRef.current) clearTimeout(dropHighlightTimerRef.current);
      dropHighlightTimerRef.current = setTimeout(() => setRecentlyDroppedSet(null), 700);
    }
  };

  const handleSetOptionsPointerDown = (event: React.PointerEvent<HTMLButtonElement>, exIdx: number, setIdx: number) => {
    if (!event.isPrimary || event.button !== 0 || exercises[exIdx]?.sets[setIdx]?.isSkipped) return;
    if (setHoldRef.current) clearTimeout(setHoldRef.current.timer);
    const button = event.currentTarget;
    const hold = {
      pointerId: event.pointerId, exIdx, setIdx,
      startX: event.clientX, startY: event.clientY, button,
      timer: setTimeout(() => {
        suppressSetOptionsClickRef.current = true;
        bodyOverflowBeforeDragRef.current = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const drag = { exIdx, setIdx, destinationIdx: setIdx, offsetY: 0 };
        setDragRef.current = drag;
        setSetDrag(drag);
        setPressedSetOptions(null);
        try { button.setPointerCapture(event.pointerId); } catch { /* pointer may already have ended */ }
      }, 450),
    };
    setHoldRef.current = hold;
    setPressedSetOptions(`${exIdx}-${setIdx}`);
  };

  const handleSetOptionsPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const hold = setHoldRef.current;
    if (!hold || hold.pointerId !== event.pointerId) return;
    const dx = event.clientX - hold.startX;
    const dy = event.clientY - hold.startY;
    const drag = setDragRef.current;
    if (!drag) {
      if (Math.hypot(dx, dy) > 9) {
        clearTimeout(hold.timer);
        setHoldRef.current = null;
        setPressedSetOptions(null);
      }
      return;
    }
    event.preventDefault();
    const rows = Array.from(document.querySelectorAll<HTMLElement>(`[data-set-row-exercise="${drag.exIdx}"]`));
    const firstDraggableRow = rows.find(row => !exercises[drag.exIdx]?.sets[Number(row.dataset.setRowIndex)]?.isSkipped);
    let destinationIdx = firstDraggableRow ? Number(firstDraggableRow.dataset.setRowIndex) : drag.setIdx;
    for (const row of rows) {
      const index = Number(row.dataset.setRowIndex);
      if (exercises[drag.exIdx]?.sets[index]?.isSkipped) continue;
      const rect = row.getBoundingClientRect();
      if (event.clientY >= rect.top + rect.height / 2) destinationIdx = index;
    }
    const next = { ...drag, destinationIdx, offsetY: dy };
    setDragRef.current = next;
    setSetDrag(next);
  };

  const handleSetOptionsPointerEnd = (event: React.PointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    if (setHoldRef.current?.pointerId !== event.pointerId && setDragRef.current === null) return;
    endSetDrag(!cancelled);
  };

  const handleMoveExercise = (exIdx: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? exIdx - 1 : exIdx + 1;
    if (targetIdx < 0 || targetIdx >= exercises.length) return;

    const currentRegistry = sessionExerciseRegistryRef.current;
    if (!currentRegistry || currentRegistry.entries.length !== exercises.length) {
      return;
    }

    const op = moveSessionExerciseRegistryEntry(
      currentRegistry,
      exIdx,
      targetIdx
    );
    if (!op.applied) return;
    sessionExerciseRegistryRef.current = op.registry;

    // 1. Swap in exercises state
    const nextExercises = [...exercises];
    const tempEx = nextExercises[exIdx];
    nextExercises[exIdx] = nextExercises[targetIdx];
    nextExercises[targetIdx] = tempEx;

    // 2. Swap in userRawExercises state if present
    let nextUserRaw = userRawExercises;
    if (userRawExercises && exIdx < userRawExercises.length && targetIdx < userRawExercises.length) {
      const copyRaw = [...userRawExercises];
      const tempRaw = copyRaw[exIdx];
      copyRaw[exIdx] = copyRaw[targetIdx];
      copyRaw[targetIdx] = tempRaw;
      nextUserRaw = copyRaw;
    }

    // 3. Swap in collapsed state
    const nextCollapsed = { ...collapsed };
    const val1 = nextCollapsed[exIdx];
    const val2 = nextCollapsed[targetIdx];
    if (val1 !== undefined) nextCollapsed[targetIdx] = val1;
    else delete nextCollapsed[targetIdx];
    if (val2 !== undefined) nextCollapsed[exIdx] = val2;
    else delete nextCollapsed[exIdx];

    // 4. Remap checkedSets, userTouchedSets, and completionTouchedSets keys using shared helper
    const nextChecked = remapAfterExerciseMove(checkedSets, exIdx, targetIdx);
    const nextTouched = remapAfterExerciseMove(userTouchedSets, exIdx, targetIdx);
    const nextCompletionTouched = remapAfterExerciseMove(completionTouchedSets, exIdx, targetIdx);
    const nextSnapshots = remapAfterExerciseMove(prescribedTargetSnapshots, exIdx, targetIdx);
    const nextEvidence = remapAfterExerciseMove(committedLiveEvidenceBySet, exIdx, targetIdx);
    const nextLiveAdjusted = remapAfterExerciseMove(liveAdjustedSets, exIdx, targetIdx);
    const nextGuideKey = reconcileGuideAfterExerciseMove(currentSetGuideKey, exIdx, targetIdx);

    setExercises(nextExercises);
    setUserRawExercises(nextUserRaw);
    setCollapsed(nextCollapsed);
    setCheckedSets(nextChecked);
    setUserTouchedSets(nextTouched);
    setCompletionTouchedSets(nextCompletionTouched);
    setPrescribedTargetSnapshots(nextSnapshots);
    setCommittedLiveEvidenceBySet(nextEvidence);
    setLiveAdjustedSets(nextLiveAdjusted);
    setCurrentSetGuideKey(nextGuideKey);

    saveWorkoutDraftImmediately({
      exercises: nextExercises,
      userRawExercises: nextUserRaw,
      collapsed: nextCollapsed,
      checkedSets: nextChecked,
      userTouchedSets: nextTouched,
      completionTouchedSets: nextCompletionTouched,
      prescribedTargetSnapshots: nextSnapshots,
      committedLiveEvidenceBySet: nextEvidence,
      liveAdjustedSets: nextLiveAdjusted,
      currentSetGuideKey: nextGuideKey,
    });
  };

  const handleToggleSuperset = (exIdx: number) => {
    if (!Number.isInteger(exIdx) || exIdx < 0 || exIdx >= exercises.length) {
      return;
    }
    if (!recordSessionExerciseStructuralMutation(exIdx, 'other_exercise_structure_changed')) {
      return;
    }
    const nextExs = exercises.map((ex, i) => (i === exIdx ? { ...ex, isSuperset: !ex.isSuperset } : ex));
    setExercises(nextExs);
    saveWorkoutDraftImmediately({ exercises: nextExs });
  };

  const handleUpdateExerciseName = (idx: number, name: string) => {
    if (!Number.isInteger(idx) || idx < 0 || idx >= exercises.length) {
      return;
    }
    const currentEx = exercises[idx];
    if (!currentEx || currentEx.name === name) {
      return;
    }
    if (!recordSessionExerciseStructuralMutation(idx, 'other_exercise_structure_changed')) {
      return;
    }
    const nextUserRaw = userRawExercises ? userRawExercises.map((ex, i) => (i === idx ? { ...ex, name } : ex)) : null;
    const nextExs = exercises.map((ex, i) => (i === idx ? { ...ex, name } : ex));
    setUserRawExercises(nextUserRaw);
    setExercises(nextExs);
    saveWorkoutDraftImmediately({ exercises: nextExs, userRawExercises: nextUserRaw });
  };

  const handleUpdateMuscleGroup = (idx: number, muscleGroup: string) => {
    if (!Number.isInteger(idx) || idx < 0 || idx >= exercises.length) {
      return;
    }
    const currentEx = exercises[idx];
    if (!currentEx || currentEx.muscleGroup === muscleGroup) {
      return;
    }
    if (!recordSessionExerciseStructuralMutation(idx, 'other_exercise_structure_changed')) {
      return;
    }
    const nextUserRaw = userRawExercises ? userRawExercises.map((ex, i) => (i === idx ? { ...ex, muscleGroup } : ex)) : null;
    const nextExs = exercises.map((ex, i) => (i === idx ? { ...ex, muscleGroup } : ex));
    setUserRawExercises(nextUserRaw);
    setExercises(nextExs);
    saveWorkoutDraftImmediately({ exercises: nextExs, userRawExercises: nextUserRaw });
  };

  const handleAddSet = (exIdx: number) => {
    if (hasSkippedWorkingSets(exercises[exIdx]?.sets)) {
      setAddSetBlockedWarning(prev => ({
        ...prev,
        [exIdx]: 'Restore skipped sets before adding another set.'
      }));
      return;
    }
    setAddSetBlockedWarning(prev => ({ ...prev, [exIdx]: null }));

    const currentEx = exercises[exIdx];
    if (!currentEx) return;

    if (!recordSessionExerciseStructuralMutation(exIdx, 'set_added')) {
      return;
    }

    const nextSetNum = (currentEx.sets?.length || 0) + 1;

    // Safe lookup of active program template for this exercise
    const activeProg = programId ? storage.getPrograms().find(p => p.id === programId) : null;
    const programDuration = activeProg && activeProg.programDuration !== '∞' ? Number(activeProg.programDuration) : 8;
    const programDayTemplates = (activeProg && activeProg.exercisesByDay?.[Number(dayNum)]) || null;
    const templateEx = findMatchingTemplateExercise(currentEx, programDayTemplates, exIdx);
    const occurrenceOrdinal = getExerciseOccurrenceOrdinal(exercises, exIdx);

    const exerciseCommittedEvidence: AddedSetCommittedEvidenceEntry[] = [];
    (currentEx.sets || []).forEach((s, sIdx) => {
      const key = `${exIdx}-${sIdx}`;
      const ev = committedLiveEvidenceBySet[key];
      if (ev && typeof ev.weight === 'number' && typeof ev.reps === 'number' && typeof ev.rpe === 'number') {
        const workingOrdinal = deriveWorkingSetOrdinal(currentEx.sets, sIdx);
        if (workingOrdinal !== null) {
          exerciseCommittedEvidence.push({
            workingSetOrdinal: workingOrdinal,
            weight: ev.weight,
            reps: ev.reps,
            rpe: ev.rpe,
            form: (ev.form || undefined) as 'standard' | 'strict' | 'loose' | undefined,
          });
        }
      }
    });

    // Calculate target for newly added set using authoritative inputs and distribution engine
    const targetResult = calculateAddedSetTarget({
      objective,
      exercise: currentEx,
      weekNum: Number(weekNum),
      programDuration,
      previousLogs: storage.getWorkoutLogs(),
      algorithmId: activeProg?.algorithmId,
      predecessorProgramId: activeProg?.parentProgramId ?? null,
      algorithmPhaseOffset: activeProg?.algorithmPhaseOffset ?? 0,
      templateExercise: templateEx,
      bodyweightSnapshot,
      activeUnit: unit,
      programId: programId ? String(programId) : null,
      dayNum: dayNum !== undefined && dayNum !== null ? String(dayNum) : null,
      targetDate: dateStr || null,
      targetLogId: editLogId || null,
      targetChronology,
      sessionStartedAt: sessionStartedAtRef.current,
      occurrenceOrdinal,
      committedEvidence: exerciseCommittedEvidence,
    });

    const isPrescribed = targetResult.isPrescribed && !!targetResult.target;
    const newSetEntry: SetEntry = {
      setNumber: nextSetNum,
      weight: isPrescribed ? targetResult.target!.weight : 0,
      reps: isPrescribed ? targetResult.target!.reps : 0,
      rpe: isPrescribed ? targetResult.target!.rpe : 8,
      form: (isPrescribed ? targetResult.target!.form : 'standard') as 'standard' | 'strict' | 'loose',
    };

    let nextSnapshots = prescribedTargetSnapshots;
    if (isPrescribed && targetResult.target) {
      const newSetKey = `${exIdx}-${currentEx.sets.length}`;
      nextSnapshots = {
        ...prescribedTargetSnapshots,
        [newSetKey]: {
          weight: targetResult.target!.weight,
          reps: targetResult.target!.reps,
          rpe: targetResult.target!.rpe,
        },
      };
      setPrescribedTargetSnapshots(nextSnapshots);
    }

    const nextUserRaw = userRawExercises
      ? userRawExercises.map((ex, i) => {
          if (i === exIdx) {
            return { ...ex, sets: [...ex.sets, { ...newSetEntry }] };
          }
          return ex;
        })
      : null;

    const nextExercises = exercises.map((ex, i) => {
      if (i === exIdx) {
        return {
          ...ex,
          sets: [
            ...ex.sets,
            { ...newSetEntry },
          ],
        };
      }
      return ex;
    });

    setUserRawExercises(nextUserRaw);
    setExercises(nextExercises);

    saveWorkoutDraftImmediately({
      exercises: nextExercises,
      userRawExercises: nextUserRaw,
      prescribedTargetSnapshots: nextSnapshots,
    });
  };

  const handleDeleteSet = (exIdx: number, setIdx: number) => {
    if (!Number.isInteger(exIdx) || exIdx < 0 || exIdx >= exercises.length) {
      return;
    }
    const currentEx = exercises[exIdx];
    if (!currentEx || !currentEx.sets || !Number.isInteger(setIdx) || setIdx < 0 || setIdx >= currentEx.sets.length) {
      return;
    }
    if (!recordSessionExerciseStructuralMutation(exIdx, 'set_deleted')) {
      return;
    }

    const nextUserRaw = userRawExercises
      ? userRawExercises.map((ex, i) => {
          if (i === exIdx) {
            const filtered = ex.sets.filter((_, sIdx) => sIdx !== setIdx);
            const reindexed = filtered.map((s, sIdx) => ({ ...s, setNumber: sIdx + 1 }));
            return { ...ex, sets: reindexed };
          }
          return ex;
        })
      : null;

    const nextExercises = exercises.map((ex, i) => {
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

    const nextChecked = remapAfterSetDelete(checkedSets, exIdx, setIdx);
    const nextTouched = remapAfterSetDelete(userTouchedSets, exIdx, setIdx);
    const nextCompletionTouched = remapAfterSetDelete(completionTouchedSets, exIdx, setIdx);
    const nextSnapshots = remapAfterSetDelete(prescribedTargetSnapshots, exIdx, setIdx);
    const nextEvidence = remapAfterSetDelete(committedLiveEvidenceBySet, exIdx, setIdx);
    const nextLiveAdjusted = remapAfterSetDelete(liveAdjustedSets, exIdx, setIdx);
    const nextGuideKey = reconcileGuideAfterSetDelete(currentSetGuideKey, exIdx, setIdx, nextExercises);

    setUserRawExercises(nextUserRaw);
    setExercises(nextExercises);
    setCurrentSetGuideKey(nextGuideKey);
    setCheckedSets(nextChecked);
    setUserTouchedSets(nextTouched);
    setCompletionTouchedSets(nextCompletionTouched);
    setPrescribedTargetSnapshots(nextSnapshots);
    setCommittedLiveEvidenceBySet(nextEvidence);
    setLiveAdjustedSets(nextLiveAdjusted);

    saveWorkoutDraftImmediately({
      exercises: nextExercises,
      userRawExercises: nextUserRaw,
      checkedSets: nextChecked,
      userTouchedSets: nextTouched,
      completionTouchedSets: nextCompletionTouched,
      prescribedTargetSnapshots: nextSnapshots,
      committedLiveEvidenceBySet: nextEvidence,
      liveAdjustedSets: nextLiveAdjusted,
      currentSetGuideKey: nextGuideKey,
    });
  };

  const handleUpdateSet = <K extends keyof SetEntry>(
    exIdx: number,
    setIdx: number,
    key: K,
    val: SetEntry[K]
  ) => {
    let nextTouched = userTouchedSets;
    if (key === 'weight' || key === 'reps' || key === 'rpe' || key === 'form') {
      const setKey = `${exIdx}-${setIdx}`;
      nextTouched = { ...userTouchedSets, [setKey]: true };
      setUserTouchedSets(nextTouched);
    }

    let finalVal = val;
    if ((key === 'weight' || key === 'reps') && typeof val === 'number' && val < 0) {
      finalVal = 0 as SetEntry[K];
    }

    const nextExercises = exercises.map((ex, i) => {
      if (i === exIdx) {
        const updatedSets = ex.sets.map((s, sIdx) =>
          sIdx === setIdx ? { ...s, [key]: finalVal } : s
        );
        return { ...ex, sets: updatedSets };
      }
      return ex;
    });

    setExercises(nextExercises);
    saveWorkoutDraftImmediately({
      exercises: nextExercises,
      userTouchedSets: nextTouched,
    });
  };

  const handleUpdateSessionBodyweight = (rawString: string) => {
    setSessionBwInputString(rawString);
    const trimmed = rawString.trim();
    let nextSnapshot: BodyweightSnapshot | null = null;
    if (trimmed !== '') {
      const num = Number(trimmed);
      if (Number.isFinite(num) && num > 0) {
        nextSnapshot = {
          value: num,
          unit,
          timestamp: new Date().toISOString(),
        };
      }
    }

    setBodyweightSnapshot(nextSnapshot);

    const activeProg = programId ? storage.getPrograms().find(p => p.id === programId) : null;
    const programDuration = activeProg && activeProg.programDuration !== '∞' ? Number(activeProg.programDuration) : 8;
    const programDayTemplates = (activeProg && activeProg.exercisesByDay?.[Number(dayNum)]) || null;

    // Recalculate objective sets for bodyweight and assisted exercises that are not touched
    const nextExercises = exercises.map((ex, exIdx) => {
      if (ex.modality !== 'bodyweight' && ex.modality !== 'assisted') {
        return ex;
      }
      if (objective === 'Off') {
        return ex;
      }
      const templateEx = findMatchingTemplateExercise(ex, programDayTemplates, exIdx);
      const occurrenceOrdinal = getExerciseOccurrenceOrdinal(exercises, exIdx);

      const calculated = calculateObjectiveSets({
        objective,
        exercise: ex,
        exerciseIndex: exIdx,
        totalExercises: exercises.length,
        weekNum: Number(weekNum),
        programDuration,
        previousLogs: storage.getWorkoutLogs(),
        userTouchedSets,
        checkedSets,
        algorithmId: activeProg?.algorithmId,
        predecessorProgramId: activeProg?.parentProgramId ?? null,
        algorithmPhaseOffset: activeProg?.algorithmPhaseOffset ?? 0,
        templateExercise: templateEx,
        bodyweightSnapshot: nextSnapshot,
        activeUnit: unit,
        programId: programId ? String(programId) : null,
        dayNum: dayNum !== undefined && dayNum !== null ? String(dayNum) : null,
        targetDate: dateStr || null,
        targetLogId: editLogId || null,
        targetChronology,
        sessionStartedAt: sessionStartedAtRef.current,
        occurrenceOrdinal,
      });

      return { ...ex, sets: calculated };
    });

    setExercises(nextExercises);
    saveWorkoutDraftImmediately({
      exercises: nextExercises,
      bodyweightSnapshot: nextSnapshot,
    });
  };

  const handleCommitUserRPE = (exIdx: number, setIdx: number, newRpe: number) => {
    const setKey = `${exIdx}-${setIdx}`;
    setUserTouchedSets(prev => ({ ...prev, [setKey]: true }));
    setCompletionTouchedSets(prev => {
      const next = { ...prev };
      delete next[setKey];
      return next;
    });

    const targetEx = exercises[exIdx];
    if (!targetEx || !targetEx.sets) {
      handleUpdateSet(exIdx, setIdx, 'rpe', newRpe);
      return;
    }

    const targetSet = targetEx.sets[setIdx];
    const rawWeight = targetSet?.weight;
    const isBw = targetEx.modality === 'bodyweight';
    const effectiveWeight =
      isBw
        ? 0
        : typeof rawWeight === 'number'
        ? rawWeight
        : null;

    const newEvidence = createCommittedLiveEvidenceValue(
      effectiveWeight,
      targetSet?.reps,
      newRpe,
      targetSet?.form
    );

    const nextCommittedLiveEvidence: CommittedLiveEvidenceMap = {
      ...committedLiveEvidenceBySet,
      [setKey]: newEvidence,
    };

    // Build updated exercise with the triggering row's RPE updated
    const updatedSets = targetEx.sets.map((s, sIdx) =>
      sIdx === setIdx ? { ...s, rpe: newRpe } : s
    );
    const updatedTargetEx: ExerciseEntry = { ...targetEx, sets: updatedSets };

    // Resolve baseline e1RM from historical logs or program day template
    const activeProg = programId ? storage.getPrograms().find(p => p.id === programId) : null;
    const dayKey = Number(dayNum);
    const templateEx = activeProg?.exercisesByDay?.[dayKey]
      ? findMatchingTemplateExercise(targetEx, activeProg.exercisesByDay[dayKey], exIdx)
      : undefined;

    const previousLogs = storage.getWorkoutLogs();
    const historicalE1RM = extractHistoricalBaselineE1RM(targetEx.name, previousLogs, targetEx.modality, unit);
    const baselineE1RM = historicalE1RM > 0 ? historicalE1RM : extractTemplateBaselineE1RM(templateEx, bodyweightSnapshot, unit);

    // Resolve profile type
    let profileType: FatiguePriorProfile = 'hypertrophy';
    if (objective === 'Strength') {
      const workingSet1RowIdx = getWorkingSetRowIndex(targetEx.sets, 1);
      const ws1Key = workingSet1RowIdx !== null ? `${exIdx}-${workingSet1RowIdx}` : null;
      const prescribedSet1 = ws1Key ? prescribedTargetSnapshots[ws1Key] : undefined;
      if (prescribedSet1 && prescribedSet1.reps === 1 && prescribedSet1.rpe >= 9.5) {
        profileType = 'strength_post_test';
      } else {
        profileType = 'strength_normal';
      }
    }

    const effectiveAlgorithmId = resolveEffectiveAlgorithmPolicyB(objective, activeProg?.algorithmId);

    let finalUpdatedExercise = updatedTargetEx;
    let finalUpdatedLiveAdjustedSets = { ...liveAdjustedSets };
    delete finalUpdatedLiveAdjustedSets[setKey];

    if (
      objective === 'Hypertrophy' ||
      (objective === 'Strength' && (targetEx.isMainMovement ?? false))
    ) {
      const adapterPrep = prepareLiveAdjustmentParams({
        exercise: updatedTargetEx,
        exIdx,
        objective,
        algorithmId: effectiveAlgorithmId,
        profileType,
        baselineE1RM,
        prescribedTargetSnapshots,
        committedLiveEvidenceBySet: nextCommittedLiveEvidence,
        triggeringSetIdx: setIdx,
        bodyweightSnapshot,
        activeUnit: unit,
      });

      if (adapterPrep.success && adapterPrep.params) {
        const adjustmentResult = calculateLiveSetAdjustments(adapterPrep.params);
        const activeSelectorRowKey = activeSelector ? `${activeSelector.exIdx}-${activeSelector.setIdx}` : null;

        const applicationOutput = applyLiveAdjustmentResult({
          exercise: updatedTargetEx,
          exIdx,
          result: adjustmentResult,
          prescribedTargetSnapshots,
          currentLiveAdjustedSets: liveAdjustedSets,
          userTouchedSets: { ...userTouchedSets, [setKey]: true },
          focusedSetKey,
          activeSelectorRowKey,
          triggeringRowIndex: setIdx,
          bodyweightSnapshot,
          activeUnit: unit,
          objective,
          algorithmId: effectiveAlgorithmId,
        });

        finalUpdatedExercise = applicationOutput.updatedExercise;
        finalUpdatedLiveAdjustedSets = applicationOutput.updatedLiveAdjustedSets;

        if (applicationOutput.appliedChangeCount > 0 && adjustmentResult.shouldNotify) {
          showLiveAdjustmentToast(
            LIVE_ADJUSTMENT_SUCCESS_MESSAGE,
            LIVE_ADJUSTMENT_SUCCESS_TOAST_DURATION_MS
          );
        } else if (
          shouldShowLowRPEExplanation({
            objective,
            exercise: targetEx,
            setIdx,
            rpe: newRpe,
            bodyweightSnapshot,
          })
        ) {
          showLiveAdjustmentToast(
            LOW_RPE_EXPLANATION_MESSAGE,
            LOW_RPE_EXPLANATION_TOAST_DURATION_MS
          );
        }
      } else if (
        shouldShowLowRPEExplanation({
          objective,
          exercise: targetEx,
          setIdx,
          rpe: newRpe,
          bodyweightSnapshot,
        })
      ) {
        showLiveAdjustmentToast(
          LOW_RPE_EXPLANATION_MESSAGE,
          LOW_RPE_EXPLANATION_TOAST_DURATION_MS
        );
      }
    } else if (
      shouldShowLowRPEExplanation({
        objective,
        exercise: targetEx,
        setIdx,
        rpe: newRpe,
        bodyweightSnapshot,
      })
    ) {
      showLiveAdjustmentToast(
        LOW_RPE_EXPLANATION_MESSAGE,
        LOW_RPE_EXPLANATION_TOAST_DURATION_MS
      );
    }

    const nextExercises = exercises.map((ex, i) => i === exIdx ? finalUpdatedExercise : ex);
    setExercises(nextExercises);
    setCommittedLiveEvidenceBySet(nextCommittedLiveEvidence);
    setLiveAdjustedSets(finalUpdatedLiveAdjustedSets);

    // Settings persistence on confirmed performance:
    // If this is a current new live workout, and the confirmed set is a valid pure-bodyweight working set,
    // persist the active bodyweight snapshot through Settings storage authority.
    if (!editLogId && (!targetChronology || targetChronology.mode === 'active_live') && !existingLog) {
      if (targetEx.modality === 'bodyweight' && !targetSet?.isWarmup && !targetSet?.isSkipped) {
        const validReps = typeof targetSet?.reps === 'number' && Number.isFinite(targetSet.reps) && targetSet.reps > 0;
        const validRpe = typeof newRpe === 'number' && Number.isFinite(newRpe) && newRpe > 0;
        if (validReps && validRpe) {
          const validSnapshot = validateBodyweightSnapshot(bodyweightSnapshot);
          if (validSnapshot) {
            storage.setBodyweightWithUnit(validSnapshot.value, validSnapshot.unit);
          }
        }
      }
    }

    const nextGuideKey = highlightCurrentSet ? findNextEligibleGuideRow(nextExercises, exIdx, setIdx) : null;
    if (highlightCurrentSet) {
      setCurrentSetGuideKey(nextGuideKey);
    } else {
      setCurrentSetGuideKey(null);
    }

    saveWorkoutDraftImmediately({
      exercises: nextExercises,
      committedLiveEvidenceBySet: nextCommittedLiveEvidence,
      liveAdjustedSets: finalUpdatedLiveAdjustedSets,
      currentSetGuideKey: nextGuideKey,
      userTouchedSets: { ...userTouchedSets, [setKey]: true },
    });
  };

  const handleRestorePlannedTargets = (targetExIdx: number) => {
    const ex = exercises[targetExIdx];
    if (!ex) return;

    const activeSelectorRowKey = activeSelector ? `${activeSelector.exIdx}-${activeSelector.setIdx}` : null;

    const { updatedExercise, updatedLiveAdjustedSets, restoredRowKeys } = restorePlannedTargetsForExercise({
      exercise: ex,
      exIdx: targetExIdx,
      prescribedTargetSnapshots,
      currentLiveAdjustedSets: liveAdjustedSets,
      userTouchedSets,
      focusedSetKey,
      activeSelectorRowKey,
    });

    if (restoredRowKeys.length > 0) {
      const nextExercises = exercises.map((item, i) => i === targetExIdx ? updatedExercise : item);
      setExercises(nextExercises);
      setLiveAdjustedSets(updatedLiveAdjustedSets);
      saveWorkoutDraftImmediately({
        exercises: nextExercises,
        liveAdjustedSets: updatedLiveAdjustedSets,
      });
    }
  };

  const toggleSetCheck = (exIdx: number, setIdx: number) => {
    const key = `${exIdx}-${setIdx}`;
    const nextChecked = { ...checkedSets, [key]: !checkedSets[key] };
    const nextCompletionTouched = { ...completionTouchedSets, [key]: true };
    setCheckedSets(nextChecked);
    setCompletionTouchedSets(nextCompletionTouched);
    saveWorkoutDraftImmediately({
      checkedSets: nextChecked,
      completionTouchedSets: nextCompletionTouched,
    });
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
    const processedExercises = prepareExercisesForSave({
      exercises,
      checkedSets,
      defaultBodyweight: sessionBodyweightInActiveUnit ?? null,
      completionTouchedSets,
      isEditMode: !!(editLogId && existingLog),
    });

    const effectiveRestIntervals = editLogId && existingLog
      ? existingLog.restIntervals
      : (restIntervals.length > 0 ? restIntervals : undefined);

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
      durationMinutes: duration === '' ? 60 : Number(duration),
      notes: notes,
      objective: objective,
      startTime: startTime,
      bodyweightSnapshot: editLogId && existingLog
        ? (existingLog.bodyweightSnapshot !== undefined ? cloneBodyweightSnapshot(existingLog.bodyweightSnapshot) : (bodyweightSnapshot !== undefined ? cloneBodyweightSnapshot(bodyweightSnapshot) : undefined))
        : (bodyweightSnapshot !== undefined ? cloneBodyweightSnapshot(bodyweightSnapshot) : null),
      ...(effectiveRestIntervals ? { restIntervals: effectiveRestIntervals } : {}),
      recovery: {
        sleepHours: sleep === '' ? null : Number(sleep),
        hydrationLiters: mapHydrationToLiters(hydration),
        hydrationLevel: hydration,
        nutritionCalories: calories === '' ? null : Number(calories),
        proteinGrams: protein,
        soreness: soreness,
        motivation: motivation,
      },
    };

    storage.saveWorkoutLog(newLog);
    clearActiveRestTimer();

    // Commit confirmed exercise and working-set template structure to program
    if (programId && !editLogId) {
      try {
        const activeProg = storage.getPrograms().find(p => p.id === programId);
        const dayKey = Number(dayNum);
        if (activeProg && activeProg.exercisesByDay?.[dayKey]) {
          const templatesToSave: ExerciseEntry[] = exercises.map(ex => ({
            name: ex.name,
            muscleGroup: ex.muscleGroup,
            modality: ex.modality || 'weighted',
            isSuperset: !!ex.isSuperset,
            isMainMovement: !!ex.isMainMovement,
            sets: ex.sets.map(s => ({
              setNumber: s.setNumber,
              weight: 0,
              reps: 0,
              rpe: s.rpe || 8,
              form: s.form || 'standard',
              comment: s.comment || null,
              isWarmup: !!s.isWarmup,
              isDropSet: !!s.isDropSet,
              dropSubSets: s.dropSubSets ? s.dropSubSets.map(ds => ({ weight: ds.weight, reps: ds.reps })) : null
            })),
          }));

          activeProg.exercisesByDay[dayKey] = templatesToSave;
          storage.saveProgram(activeProg);
        }
      } catch (e) {
        console.error('Failed to sync confirmed exercises to active program template upon save:', e);
      }
    }

    draftFlushSuppressedRef.current = true;
    latestDraftPayloadRef.current = null;
    clearActiveWorkoutDraft();
    setHasExistingDraft(false);
    activePrescriptionBoundaryRef.current = null;
    sessionExerciseRegistryRef.current = clearSessionExerciseRegistry();
    if (isFinalWorkout) {
      // Unenrol the user from the current program automatically at the conclusion of the program
      storage.setCurrentProgramId(null);
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

    if (objective === 'Strength' && !isOneOff) {
      const eligibleMainCount = getEligibleMainMovementCount(exercises);
      if (eligibleMainCount === 0) {
        setShowNoMainMovementConfirm(true);
        return;
      }
      if (eligibleMainCount > 1) {
        setAlertMsg('Please select exactly one Main Movement before saving your Strength workout.');
        return;
      }
    }

    executeSaveSession();
  };

  // Render Easter Egg Rest Timer depending on theme
  const renderRestTimer = () => {
    const minutes = Math.floor(restSeconds / 60);
    const seconds = restSeconds % 60;
    const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    const handleTimerClick = () => {
      handleToggleRestTimer({ source: 'footer', startedAt: new Date().toISOString() });
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

  // Render Floating Rest Timer Widget (appears when rest timer is active)
  const renderFloatingRestTimer = () => {
    if (!isResting) return null;

    const minutes = Math.floor(restSeconds / 60);
    const seconds = restSeconds % 60;
    const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    const handleFloatingClick = () => {
      handleToggleRestTimer();
    };

    const segmentDuration = objective === 'Strength' ? 60 : 30;
    const numFilled = Math.min(4, Math.floor(restSeconds / segmentDuration));
    const emptyChar = '▱';
    const filledChar = '▰';
    const segmentsStr = filledChar.repeat(numFilled) + emptyChar.repeat(4 - numFilled);

    if (themeId === 'slate') {
      return (
        <div
          onClick={handleFloatingClick}
          className="fixed bottom-20 right-4 md:absolute md:bottom-20 md:right-4 z-40 bg-slate-950/95 border-2 border-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.4)] ring-1 ring-cyan-500/50 px-3.5 py-2 flex items-center gap-3 select-none cursor-pointer hover:scale-105 active:scale-95 transition-all duration-200 animate-in fade-in slide-in-from-bottom-3"
          title="Rest timer active. Tap to reset & dismiss"
        >
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping shrink-0" />
          <span className="text-[11.5px] text-cyan-400 font-mono tracking-wider">
            {segmentsStr}
          </span>
          <span className="text-[14px] font-black font-mono tracking-wider text-cyan-400 animate-pulse">
            {timeStr}
          </span>
        </div>
      );
    } else if (themeId === 'onyx') {
      return (
        <div
          onClick={handleFloatingClick}
          className="fixed bottom-20 right-4 md:absolute md:bottom-20 md:right-4 z-40 bg-slate-950/95 border-2 border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.4)] ring-1 ring-emerald-500/50 px-3.5 py-2 flex items-center gap-3 select-none cursor-pointer hover:scale-105 active:scale-95 transition-all duration-200 animate-in fade-in slide-in-from-bottom-3"
          title="Rest timer active. Tap to reset & dismiss"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
          <span className="text-[11.5px] text-emerald-400 font-mono tracking-wider">
            {segmentsStr}
          </span>
          <span className="text-[14px] font-black font-mono tracking-wider text-emerald-400 animate-pulse">
            {timeStr}
          </span>
        </div>
      );
    } else {
      return (
        <div
          onClick={handleFloatingClick}
          className="fixed bottom-20 right-4 md:absolute md:bottom-20 md:right-4 z-40 bg-[#FAF5F0]/95 border-2 border-amber-600 shadow-[0_0_20px_rgba(217,119,6,0.4)] ring-1 ring-amber-600/50 px-3.5 py-2 flex items-center gap-3 select-none cursor-pointer hover:scale-105 active:scale-95 transition-all duration-200 animate-in fade-in slide-in-from-bottom-3"
          title="Rest timer active. Tap to reset & dismiss"
        >
          <span className="w-2 h-2 rounded-full bg-amber-600 animate-ping shrink-0" />
          <span className="text-[11.5px] text-amber-700 font-mono tracking-wider">
            {segmentsStr}
          </span>
          <span className="text-[14px] font-black font-mono tracking-wider text-amber-800 animate-pulse">
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
                    Cancel Workout
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Row 1: Program Stage, Date & Start Time */}
        <div className="grid grid-cols-3 gap-3 p-4">
          <div>
            <label className="block text-[11px] sm:text-[12.5px] font-black text-slate-400 uppercase tracking-wider mb-1 font-mono truncate">
              Stage
            </label>
            <div className="relative flex items-center justify-center bg-slate-950 rounded-none border border-slate-850 px-2 h-10 select-none">
              <span className="text-xs sm:text-[13px] font-black text-slate-300 uppercase font-mono tracking-wider truncate">
                {isOneOff ? (
                  'ONE-OFF'
                ) : (
                  `W${weekNum} / ${totalWeeks || '8'}`
                )}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-[11px] sm:text-[12.5px] font-black text-slate-400 uppercase tracking-wider mb-1 font-mono truncate">
              Date
            </label>
            <div className="relative w-full">
              <input
                type="date"
                value={workoutDate}
                onChange={handleWorkoutDateChange}
                className="logger-date-time-input w-full bg-slate-950 text-slate-300 rounded-none border border-slate-850 px-1 sm:px-2 h-10 text-center text-xs sm:text-[13px] font-black font-mono focus:outline-none focus:border-indigo-500/85 cursor-pointer"
                style={{ textAlign: 'center' }}
              />
              <span
                aria-hidden="true"
                className="logger-date-time-display text-slate-300 text-xs sm:text-[13px] font-black font-mono tracking-tight"
              >
                {formatLocalDateDisplay(workoutDate)}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-[11px] sm:text-[12.5px] font-black text-slate-400 uppercase tracking-wider mb-1 font-mono truncate">
              Start Time
            </label>
            <div className="relative w-full">
              <input
                type="time"
                value={startTime}
                onChange={handleStartTimeChange}
                className="logger-date-time-input w-full bg-slate-950 text-slate-300 rounded-none border border-slate-850 px-1 sm:px-2 h-10 text-center text-xs sm:text-[13px] font-black font-mono focus:outline-none focus:border-indigo-500/85 cursor-pointer"
                style={{ textAlign: 'center' }}
              />
              <span
                aria-hidden="true"
                className="logger-date-time-display text-slate-300 text-xs sm:text-[13px] font-black font-mono tracking-tight"
              >
                {formatLocalTimeDisplay(startTime)}
              </span>
            </div>
          </div>
        </div>

        {/* Row 2: Workout Objective & Method */}
        <div className="p-4 bg-slate-950/20">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1.5 min-h-[20px]">
                <label className="block text-[11.5px] font-black text-slate-400 uppercase tracking-widest font-mono">
                  Training Goal
                </label>
              </div>
              <div className="bg-slate-950 border border-slate-850 px-3.5 h-10 flex items-center justify-between text-xs font-black text-white uppercase tracking-wider select-none">
                <span>{objective}</span>
                <span className="text-[9px] font-mono font-extrabold text-slate-500 uppercase tracking-wider">
                  {objective === 'Off' ? 'Manual' : 'Active'}
                </span>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5 min-h-[20px]">
                <label className="block text-[11.5px] font-black text-slate-400 uppercase tracking-widest font-mono">
                  Periodisation Method
                </label>
              </div>
              <div className="bg-slate-950 border border-slate-850 px-3.5 h-10 flex items-center gap-2 select-none min-w-0">
                <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-[9.5px] font-mono font-black bg-indigo-950 text-indigo-400 border border-indigo-500/25 uppercase tracking-widest leading-none shrink-0">
                  {algoDetails.short}
                </span>
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[11px] font-extrabold text-slate-300 uppercase tracking-wide truncate">
                    {algoDetails.name}
                  </span>
                  <button
                    type="button"
                    onClick={openPeriodisationInfo}
                    aria-label={`About ${algoDetails.name}`}
                    className="p-1 text-slate-400 hover:text-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition cursor-pointer shrink-0"
                  >
                    <Info className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {isTargetModeApplicable && (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1.5 min-h-[20px]">
                <label className="block text-[11.5px] font-black text-slate-400 uppercase tracking-widest font-mono">
                  Workout Target Mode
                </label>
              </div>
              <div
                className={`border px-3.5 h-10 flex items-center justify-between gap-2 select-none ${
                  isCoached
                    ? 'bg-indigo-950/20 border-indigo-500/40 text-indigo-300'
                    : 'bg-slate-950 border-slate-850 text-slate-300'
                }`}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-xs font-black uppercase tracking-wider font-mono truncate">
                    {isCoached ? 'METREPS COACH' : 'PERIODISATION TARGETS'}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => openTargetModeInfo(e, targetMode)}
                    aria-label={isCoached ? 'About MetReps Coach' : 'About Periodisation Targets'}
                    className="p-1 text-slate-400 hover:text-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition cursor-pointer shrink-0"
                  >
                    <Info className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
                <span
                  className={`text-[9px] font-mono font-extrabold uppercase tracking-wider px-1.5 py-0.5 border shrink-0 ${
                    isCoached
                      ? 'text-indigo-400 bg-indigo-950/60 border-indigo-500/30'
                      : 'text-slate-500 bg-slate-900 border-slate-800'
                  }`}
                >
                  {isCoached ? 'COACH' : 'TARGETS'}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Exercises Section */}
      <div className="space-y-6">

        {exercises.map((ex, exIdx) => {
          const isCollapsed = collapsed[exIdx];
          const isTimed = ex.modality === 'timed';
          const gridColsClass = isTimed
            ? 'grid-cols-[44px_3.3fr_2fr_4.33fr_54px]'
            : 'grid-cols-[44px_2.9fr_1.65fr_1.65fr_3.55fr_54px]';
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
                <div className="flex flex-col gap-1 pt-11 pb-3.5 px-4 bg-slate-950/30 border-b border-slate-850/60 relative">
                  <div className="absolute top-1.5 right-1.5 flex items-center gap-1.5 sm:gap-2 z-10">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const lastSetNum = getLastCompletedWorkingSetNumber(ex, exIdx, checkedSets);
                        handleToggleRestTimer({
                          source: 'exercise_header',
                          exerciseName: ex.name,
                          exerciseIndex: exIdx,
                          setNumber: lastSetNum,
                          startedAt: new Date().toISOString(),
                        });
                      }}
                      className={`p-2 rounded-none transition border ${
                        isResting
                          ? (themeId === 'amber'
                              ? 'border-amber-600/40 bg-amber-100/60 ring-1 ring-amber-500/20 text-amber-800 animate-pulse'
                              : (themeId === 'onyx'
                                  ? 'border-emerald-500/40 bg-slate-950/90 ring-1 ring-emerald-500/20 text-emerald-400 animate-pulse'
                                  : 'border-cyan-500/40 bg-slate-950/90 ring-1 ring-cyan-500/20 text-cyan-400 animate-pulse'
                                )
                            )
                          : (themeId === 'amber'
                              ? 'border-amber-600/20 bg-amber-50/50 hover:bg-amber-100 text-amber-700/70 hover:text-amber-800'
                              : (themeId === 'onyx'
                                  ? 'border-slate-800 bg-slate-950/50 hover:bg-slate-800 text-slate-400 hover:text-emerald-400'
                                  : 'border-slate-800 bg-slate-950/50 hover:bg-slate-800 text-slate-400 hover:text-cyan-400'
                                )
                            )
                      }`}
                      title={isResting ? 'Stop rest timer' : 'Start rest timer'}
                      aria-label={isResting ? 'Stop rest timer' : 'Start rest timer'}
                    >
                      <Timer className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openSelectorForIdx(exIdx)}
                      className="p-2 hover:bg-slate-800 text-indigo-400 hover:text-indigo-300 rounded-none transition border border-slate-800 bg-slate-950/50"
                      title="Edit Exercise"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistoryExerciseName(ex.name)}
                      className="p-2 hover:bg-slate-800 text-cyan-400 hover:text-cyan-300 rounded-none transition border border-slate-800 bg-slate-950/50"
                      title="Lifting History"
                    >
                      <History className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveExAction(exIdx)}
                      className="p-2 hover:bg-slate-800 text-slate-400 hover:text-white rounded-none transition border border-slate-800 bg-slate-950/50"
                      title="Exercise Settings"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex flex-col gap-1 min-w-0">
                    <h4 className={`font-black text-sm sm:text-base ${ex.isSkipped ? 'text-amber-400/80 line-through' : 'text-indigo-300'} uppercase tracking-wide break-words`}>
                      {ex.name}
                    </h4>
                    {objective === 'Strength' && (
                      !isOneOff && Number(weekNum) > 1 && getEligibleMainMovementCount(exercises) === 1 ? (
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
                        <label
                          className="inline-flex items-center gap-1.5 cursor-pointer select-none"
                          title="Only mark an exercise as a Main Movement if it is suitable for low-repetition strength work and peak singles."
                        >
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
                      )
                    )}
                  </div>
                </div>

                {/* Skipped Notice Banner */}
                {ex.isSkipped && (
                  <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2.5 flex items-center justify-between gap-2 font-mono">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
                      <span className="text-xs font-black text-amber-400 uppercase tracking-wider">
                        Skipped This Session
                      </span>
                      <span className="text-[11px] text-slate-400 hidden sm:inline">
                        (Preserves baseline targets for future workouts)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleSkipExercise(exIdx)}
                      className="text-xs font-black text-amber-400 hover:text-amber-300 underline cursor-pointer shrink-0"
                    >
                      UNSKIP
                    </button>
                  </div>
                )}

                {/* Set logging details */}
                {!isCollapsed && (
                  <div className={`p-0 space-y-0 transition-opacity ${ex.isSkipped ? 'opacity-30 pointer-events-none' : ''}`}>
                    {/* Sets Column Header */}
                    <div className={`grid ${gridColsClass} gap-1 px-2 py-2 bg-slate-950/50 border-b border-slate-850 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center`}>
                      <span className="text-center text-slate-500">Set</span>
                      <span>
                        {ex.modality === 'assisted'
                          ? `Assist (${unit})`
                          : (ex.modality === 'timed' || ex.modality === 'distance')
                          ? 'Secs'
                          : ex.modality === 'bodyweight'
                          ? 'BODYWT'
                          : `Weight (${unit})`}
                      </span>
                      {!isTimed && (
                        <span>
                          {(ex.modality === 'distance' || ex.modality === 'distance_loaded') ? 'Meters' : 'Reps'}
                        </span>
                      )}
                      <span>RPE</span>
                      <span>Form</span>
                      <span>Opt</span>
                    </div>

                    {ex.sets.map((set, setIdx) => {
                      const isSetSkipped = !!set.isSkipped;
                      const isCurrentGuidedSet = highlightCurrentSet && currentSetGuideKey === `${exIdx}-${setIdx}` && isRowEligibleForGuide(ex, set);
                      const rowBgClass = isSetSkipped
                        ? 'bg-amber-950/15 border-l-2 border-l-transparent'
                        : isCurrentGuidedSet
                        ? (themeId === 'amber'
                            ? 'bg-amber-600/15 border-l-2 border-l-amber-500'
                            : 'bg-indigo-950/50 border-l-2 border-l-indigo-500')
                        : 'bg-slate-950/25 border-l-2 border-l-transparent';
                      const isDraggedSet = setDrag?.exIdx === exIdx && setDrag.setIdx === setIdx;
                      const isDragDestination = setDrag?.exIdx === exIdx && setDrag.destinationIdx === setIdx && setDrag.setIdx !== setIdx;
                      const wasRecentlyDropped = recentlyDroppedSet === `${exIdx}-${setIdx}`;

                      return (
                        <div
                          key={setIdx}
                          data-set-row-exercise={exIdx}
                          data-set-row-index={setIdx}
                          className={`relative space-y-0 border-b border-slate-850 ${isSetSkipped ? 'opacity-50' : ''} ${isDraggedSet ? 'z-30 shadow-2xl ring-2 ring-indigo-400 bg-slate-900' : ''} ${wasRecentlyDropped ? 'animate-pulse ring-2 ring-emerald-400' : ''}`}
                          style={isDraggedSet ? { transform: `translateY(${setDrag.offsetY}px)`, transition: 'box-shadow 150ms ease', touchAction: 'none' } : undefined}
                        >
                          {isDragDestination && (
                            <div className="absolute -top-1 left-2 right-2 z-40 h-1 bg-indigo-400 border-y border-white shadow-lg" aria-hidden="true">
                              <span className="absolute -left-1 -top-1 w-3 h-3 rotate-45 bg-indigo-400 border border-white" />
                            </div>
                          )}
                          <div
                            className={`grid ${gridColsClass} gap-1 items-center px-2 py-1.5 transition-colors duration-150 ${rowBgClass}`}
                          >
                            {/* Set index / Drop Set Icon / Skipped indicator */}
                            <div className="text-center text-xs font-black text-slate-300 font-mono flex flex-col items-center justify-center leading-none">
                              <span className={`text-[8px] uppercase font-sans font-medium tracking-normal mb-0.5 ${isSetSkipped ? 'text-amber-500 font-bold' : 'text-slate-500'}`}>
                                {isSetSkipped ? 'SKIP' : 'Set'}
                              </span>
                              <div className="flex items-center justify-center gap-0.5">
                                <span className={`text-sm font-bold ${isSetSkipped ? 'line-through text-amber-400' : ''}`}>{set.setNumber}</span>
                                {set.isDropSet && !isSetSkipped && (
                                  <span className={`${themeId === 'amber' ? 'text-fuchsia-600' : 'text-fuchsia-400'} font-black text-xs`} title="Drop Set">↓</span>
                                )}
                                {set.isWarmup && (
                                  <WarmupIcon className="w-3.5 h-3 text-amber-500 inline-block shrink-0 align-middle ml-0.5" title="Warmup Set" />
                                )}
                              </div>
                            </div>

                            {/* Weight Input */}
                            <div>
                              {ex.modality === 'bodyweight' ? (
                                <>
                                  <label htmlFor={`bw-input-${exIdx}-${setIdx}`} className="sr-only">
                                    Session bodyweight — applies to all bodyweight exercises
                                  </label>
                                  <input
                                    id={`bw-input-${exIdx}-${setIdx}`}
                                    type="number"
                                    min="0"
                                    step="0.1"
                                    disabled={isSetSkipped}
                                    aria-label="Session bodyweight — applies to all bodyweight exercises"
                                    value={
                                      sessionBwInputString !== null
                                        ? sessionBwInputString
                                        : (sessionBodyweightInActiveUnit !== null ? String(sessionBodyweightInActiveUnit) : '')
                                    }
                                    onFocus={() => {
                                      setFocusedSetKey(`${exIdx}-${setIdx}`);
                                      if (highlightCurrentSet && isRowEligibleForGuide(ex, set)) {
                                        setCurrentSetGuideKey(`${exIdx}-${setIdx}`);
                                      }
                                    }}
                                    onBlur={() => {
                                      setFocusedSetKey(prev => prev === `${exIdx}-${setIdx}` ? null : prev);
                                      setSessionBwInputString(null);
                                    }}
                                    onChange={e => handleUpdateSessionBodyweight(e.target.value)}
                                    className={`bg-slate-950 text-base font-black text-center text-white border border-slate-800 rounded-none h-10 w-full focus:outline-none focus:border-indigo-500 font-mono ${isSetSkipped ? 'cursor-not-allowed opacity-75' : ''}`}
                                    placeholder={sessionBodyweightInActiveUnit ? String(sessionBodyweightInActiveUnit) : 'BODYWT'}
                                  />
                                </>
                              ) : (
                                <input
                                  type="number"
                                  min="0"
                                  step="0.5"
                                  disabled={isSetSkipped}
                                  value={set.weight ?? ''}
                                  onFocus={() => {
                                    setFocusedSetKey(`${exIdx}-${setIdx}`);
                                    if (highlightCurrentSet && isRowEligibleForGuide(ex, set)) {
                                      setCurrentSetGuideKey(`${exIdx}-${setIdx}`);
                                    }
                                  }}
                                  onBlur={() => setFocusedSetKey(prev => prev === `${exIdx}-${setIdx}` ? null : prev)}
                                  onChange={e =>
                                    handleUpdateSet(
                                      exIdx,
                                      setIdx,
                                      'weight',
                                      e.target.value === '' ? null : Number(e.target.value)
                                    )
                                  }
                                  className={`bg-slate-950 text-base font-black text-center text-white border border-slate-800 rounded-none h-10 w-full focus:outline-none focus:border-indigo-500 font-mono ${isSetSkipped ? 'cursor-not-allowed opacity-75' : ''}`}
                                  placeholder={(ex.modality === 'timed' || ex.modality === 'distance') ? 'Secs' : '0'}
                                />
                              )}
                            </div>

                            {/* Reps Input */}
                            {!isTimed && (
                              <div>
                                <input
                                  type="number"
                                  min="0"
                                  disabled={isSetSkipped}
                                  value={set.reps ?? ''}
                                  onFocus={() => {
                                    setFocusedSetKey(`${exIdx}-${setIdx}`);
                                    if (highlightCurrentSet && isRowEligibleForGuide(ex, set)) {
                                      setCurrentSetGuideKey(`${exIdx}-${setIdx}`);
                                    }
                                  }}
                                  onBlur={() => setFocusedSetKey(prev => prev === `${exIdx}-${setIdx}` ? null : prev)}
                                  onChange={e =>
                                    handleUpdateSet(
                                      exIdx,
                                      setIdx,
                                      'reps',
                                      e.target.value === '' ? null : Number(e.target.value)
                                    )
                                  }
                                  className={`bg-slate-950 text-base font-black text-center text-white border border-slate-800 rounded-none h-10 w-full focus:outline-none focus:border-indigo-500 font-mono ${isSetSkipped ? 'cursor-not-allowed opacity-75' : ''}`}
                                  placeholder={(ex.modality === 'distance' || ex.modality === 'distance_loaded') ? 'Mtrs' : '0'}
                                />
                              </div>
                            )}

                            {/* RPE Selector */}
                            <div className="relative">
                              <button
                                type="button"
                                disabled={isSetSkipped}
                                onClick={(e) => toggleSelector(e, exIdx, setIdx, 'rpe')}
                                className={`bg-slate-950 text-sm font-black text-center text-slate-300 border border-slate-800 rounded-none h-10 w-full focus:outline-none focus:border-indigo-500 font-mono flex items-center justify-center transition ${isSetSkipped ? 'cursor-not-allowed opacity-75' : 'cursor-pointer hover:bg-slate-900'}`}
                              >
                                {set.rpe ?? 8}
                              </button>
                              {!isSetSkipped && activeSelector?.exIdx === exIdx && activeSelector?.setIdx === setIdx && activeSelector?.type === 'rpe' && (
                                <div className={`selector-popup-container absolute left-1/2 -translate-x-1/2 bg-slate-950 border border-slate-800 rounded-none shadow-2xl z-50 overflow-hidden py-1 min-w-[75px] max-w-[85px] ${activeSelector.direction === 'down' ? 'top-11' : 'bottom-11'}`}>
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
                                          handleCommitUserRPE(exIdx, setIdx, nextRpe);
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
                                  {[4, 5, 6, 7, 8, 9, 10].map(val => {
                                    const currentRpe = set.rpe ?? 8;
                                    const isHalf = currentRpe % 1 !== 0;
                                    const targetVal = isHalf && val !== 10 ? val + 0.5 : val;
                                    const isSelected = currentRpe === targetVal;
                                    return (
                                      <button
                                        key={val}
                                        type="button"
                                        onClick={() => {
                                          handleCommitUserRPE(exIdx, setIdx, targetVal);
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
                              )}
                            </div>

                            {/* Form Rating */}
                            <div className="relative">
                              <button
                                type="button"
                                disabled={isSetSkipped}
                                onClick={(e) => toggleSelector(e, exIdx, setIdx, 'form')}
                                className={`bg-slate-950 text-xs font-bold text-center text-slate-300 border border-slate-800 rounded-none h-10 w-full focus:outline-none focus:border-indigo-500 flex items-center justify-center capitalize truncate px-1 transition ${isSetSkipped ? 'cursor-not-allowed opacity-75' : 'cursor-pointer hover:bg-slate-900'}`}
                              >
                                {set.form ?? 'standard'}
                              </button>
                              {!isSetSkipped && activeSelector?.exIdx === exIdx && activeSelector?.setIdx === setIdx && activeSelector?.type === 'form' && (
                                <div className={`selector-popup-container absolute left-1/2 -translate-x-1/2 bg-slate-950 border border-slate-800 rounded-none shadow-2xl z-50 overflow-hidden py-1 min-w-[85px] ${activeSelector.direction === 'down' ? 'top-11' : 'bottom-11'}`}>
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
                              )}
                            </div>

                            {/* Options action menu icon */}
                            <div className="flex justify-center">
                              <button
                                type="button"
                                onPointerDown={(event) => handleSetOptionsPointerDown(event, exIdx, setIdx)}
                                onPointerMove={handleSetOptionsPointerMove}
                                onPointerUp={(event) => handleSetOptionsPointerEnd(event, false)}
                                onPointerCancel={(event) => handleSetOptionsPointerEnd(event, true)}
                                onClick={() => {
                                  if (suppressSetOptionsClickRef.current) {
                                    suppressSetOptionsClickRef.current = false;
                                    return;
                                  }
                                  setActiveSetAction({ exIdx, setIdx });
                                }}
                                className={`p-2 hover:bg-slate-800 text-slate-400 hover:text-indigo-400 rounded-none border bg-slate-950/40 transition ${pressedSetOptions === `${exIdx}-${setIdx}` ? 'scale-95 border-indigo-400 bg-indigo-950/50' : 'border-slate-800'}`}
                                title="Set Options"
                                aria-label="Set options; press and hold to reorder"
                              >
                                <MoreVertical className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          {/* Drop Set Sub-Rows */}
                          {set.isDropSet && set.dropSubSets && set.dropSubSets.map((sub, subIdx) => {
                            const isDesert = themeId === 'amber';
                            const dsBgClass = isDesert
                              ? 'bg-[#B56D3E]/5 border-t border-[#B56D3E]/12'
                              : 'bg-slate-950/40 border-t border-slate-950/15';
                            const dsIndicatorTextClass = isDesert
                              ? 'text-fuchsia-600'
                              : 'text-fuchsia-500';
                            const dsSubLabelTextClass = isDesert
                              ? 'text-fuchsia-600/70 font-sans font-black tracking-normal mb-0.5'
                              : 'text-fuchsia-400/70 font-sans font-black tracking-normal mb-0.5';
                            const dsInputClass = isDesert
                              ? 'bg-[#ffffff] text-base font-black text-center text-fuchsia-800 border border-fuchsia-200 rounded-none h-10 w-full focus:outline-none focus:border-fuchsia-500 font-mono'
                              : 'bg-slate-950 text-base font-black text-center text-fuchsia-300 border border-slate-800 rounded-none h-10 w-full focus:outline-none focus:border-fuchsia-500 font-mono';
                            const dsPlusBtnClass = isDesert
                              ? 'p-1 hover:bg-fuchsia-100 text-fuchsia-600 hover:text-fuchsia-700 rounded-none border border-fuchsia-200 bg-[#ffffff] transition shrink-0'
                              : 'p-1 hover:bg-slate-800 text-fuchsia-400 hover:text-fuchsia-300 rounded-none border border-slate-800 bg-slate-950/40 transition shrink-0';
                            const dsXBtnClass = isDesert
                              ? 'p-1 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-none border border-fuchsia-200 bg-[#ffffff] transition shrink-0'
                              : 'p-1 hover:bg-slate-850 text-slate-500 hover:text-fuchsia-400 rounded-none border border-slate-850 bg-slate-950/20 transition shrink-0';

                            return (
                              <div
                                key={`sub-${setIdx}-${subIdx}`}
                                className={`grid ${gridColsClass} gap-1 items-center px-2 py-1.5 ${dsBgClass}`}
                              >
                                {/* ↳ Indicator */}
                                <div className={`text-center text-xs font-black ${dsIndicatorTextClass} font-mono flex flex-col items-center justify-center leading-none`}>
                                  <span className={`text-[7px] uppercase ${dsSubLabelTextClass}`}>Drop</span>
                                  <span className="text-xs font-bold">↳</span>
                                </div>

                                {/* Weight Input */}
                                <div>
                                  {ex.modality === 'bodyweight' ? (
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.1"
                                      value={sub.weight !== null && sub.weight !== undefined && sub.weight !== 0 ? sub.weight : (sessionBodyweightInActiveUnit ?? '')}
                                      onFocus={() => setFocusedSetKey(`${exIdx}-${setIdx}`)}
                                      onBlur={() => setFocusedSetKey(prev => prev === `${exIdx}-${setIdx}` ? null : prev)}
                                      onChange={e =>
                                        handleUpdateDropSubSet(
                                          exIdx,
                                          setIdx,
                                          subIdx,
                                          'weight',
                                          e.target.value === '' ? null : Number(e.target.value)
                                        )
                                      }
                                      className={dsInputClass}
                                      placeholder={sessionBodyweightInActiveUnit ? String(sessionBodyweightInActiveUnit) : 'BODYWT'}
                                    />
                                  ) : (
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.5"
                                      value={sub.weight ?? ''}
                                      onFocus={() => setFocusedSetKey(`${exIdx}-${setIdx}`)}
                                      onBlur={() => setFocusedSetKey(prev => prev === `${exIdx}-${setIdx}` ? null : prev)}
                                      onChange={e =>
                                        handleUpdateDropSubSet(
                                          exIdx,
                                          setIdx,
                                          subIdx,
                                          'weight',
                                          e.target.value === '' ? null : Number(e.target.value)
                                        )
                                      }
                                      className={dsInputClass}
                                      placeholder={(ex.modality === 'timed' || ex.modality === 'distance') ? 'Secs' : '0'}
                                    />
                                  )}
                                </div>

                                {/* Reps Input */}
                                {!isTimed && (
                                  <div>
                                    <input
                                      type="number"
                                      min="0"
                                      value={sub.reps ?? ''}
                                      onFocus={() => setFocusedSetKey(`${exIdx}-${setIdx}`)}
                                      onBlur={() => setFocusedSetKey(prev => prev === `${exIdx}-${setIdx}` ? null : prev)}
                                      onChange={e =>
                                        handleUpdateDropSubSet(
                                          exIdx,
                                          setIdx,
                                          subIdx,
                                          'reps',
                                          e.target.value === '' ? null : Number(e.target.value)
                                        )
                                      }
                                      className={dsInputClass}
                                      placeholder={(ex.modality === 'distance' || ex.modality === 'distance_loaded') ? 'Mtrs' : '0'}
                                    />
                                  </div>
                                )}

                                {/* RPE Column Spacer */}
                                <div />

                                {/* Form Column Spacer */}
                                <div />

                                {/* Options column with + and Trash */}
                                <div className="flex justify-center items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleAddDropSubSet(exIdx, setIdx)}
                                    className={dsPlusBtnClass}
                                    title="Add another drop set"
                                  >
                                    <Plus className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveDropSubSet(exIdx, setIdx, subIdx)}
                                    className={dsXBtnClass}
                                    title="Delete this drop set"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}

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

                    <div className="px-2 py-1.5 bg-slate-950/25 border-b border-slate-850 space-y-1.5">
                      {addSetBlockedWarning[exIdx] && (
                        <div className="px-3 py-2 text-xs text-amber-400 bg-amber-950/30 border border-amber-500/30 flex items-start gap-2 animate-fadeIn">
                          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                          <span>{addSetBlockedWarning[exIdx]}</span>
                        </div>
                      )}
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
                min="1"
                value={duration ?? ''}
                onChange={handleDurationChange}
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
                min="0"
                step="0.5"
                value={sleep ?? ''}
                onChange={handleSleepChange}
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
                <div className="selector-popup-container absolute left-0 right-0 top-11 bg-slate-950 border border-slate-800 rounded-none shadow-2xl z-50 overflow-hidden py-1 font-sans">
                    {(['Dehydrated', 'Under-hydrated', 'Adequate', 'Optimal'] as HydrationLevel[]).map(level => {
                      const isSelected = hydration === level;
                      return (
                        <button
                          key={level}
                          type="button"
                          onClick={() => handleHydrationChange(level)}
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
              )}
            </div>
          </div>

          {/* Intake */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              <Flame className="w-3.5 h-3.5 text-amber-500" />
              Intake
            </label>
            <div className="bg-slate-950 px-2 py-2 rounded-none border border-slate-850 flex items-center justify-between gap-1 h-10">
              <input
                type="number"
                min="0"
                value={calories ?? ''}
                onChange={handleCaloriesChange}
                className="bg-transparent font-black text-sm text-white flex-1 w-0 min-w-0 focus:outline-none font-mono text-center"
              />
              <span className="text-[9px] text-slate-500 font-black shrink-0">KCAL</span>
            </div>
          </div>
        </div>

        {/* Soreness & Quality 10-button selectors */}
        <div className="space-y-4 pt-2">
          {/* Soreness Rating */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-1.5">
                <span className="text-[14.5px] font-extrabold uppercase tracking-wider text-slate-300">Muscle Soreness (1-10)</span>
                <button
                  type="button"
                  onClick={() => setShowSorenessInfo(true)}
                  className={`p-1 hover:bg-slate-800 text-slate-500 ${themeId === 'amber' ? 'hover:text-amber-400' : 'hover:text-indigo-400'} rounded-full transition flex items-center justify-center cursor-pointer`}
                  title="Muscle soreness information"
                >
                  <Info className="w-3.5 h-3.5" />
                </button>
              </div>
              <span className={`${themeId === 'amber' ? 'text-amber-500' : 'text-indigo-400'} font-mono font-black text-[16px]`}>{soreness}/10</span>
            </div>
            <div className="grid grid-cols-10 gap-1 w-full pt-0.5">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(val => {
                const isSelected = soreness === val;
                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() => handleSorenessChange(val)}
                    className={`h-9 rounded-none font-mono text-xs font-bold transition-all cursor-pointer flex items-center justify-center border ${
                      isSelected
                        ? themeId === 'amber'
                          ? 'bg-amber-500 border-amber-400 text-slate-950 font-black shadow-sm'
                          : 'bg-indigo-600 border-indigo-500 text-white font-black shadow-sm shadow-indigo-600/30'
                        : 'bg-slate-950 border-slate-850 text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                    }`}
                  >
                    {val}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quality Rating */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-1.5">
                <span className="text-[14.5px] font-extrabold uppercase tracking-wider text-slate-300">Workout Quality (1-10)</span>
                <button
                  type="button"
                  onClick={() => setShowQualityInfo(true)}
                  className={`p-1 hover:bg-slate-800 text-slate-500 ${themeId === 'amber' ? 'hover:text-amber-400' : 'hover:text-cyan-400'} rounded-full transition flex items-center justify-center cursor-pointer`}
                  title="Workout quality information"
                >
                  <Info className="w-3.5 h-3.5" />
                </button>
              </div>
              <span className={`${themeId === 'amber' ? 'text-amber-500' : 'text-cyan-400'} font-mono font-black text-[16px]`}>{motivation}/10</span>
            </div>
            <div className="grid grid-cols-10 gap-1 w-full pt-0.5">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(val => {
                const isSelected = motivation === val;
                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() => handleMotivationChange(val)}
                    className={`h-9 rounded-none font-mono text-xs font-bold transition-all cursor-pointer flex items-center justify-center border ${
                      isSelected
                        ? themeId === 'amber'
                          ? 'bg-amber-500 border-amber-400 text-slate-950 font-black shadow-sm'
                          : 'bg-cyan-600 border-cyan-500 text-white font-black shadow-sm shadow-cyan-600/30'
                        : 'bg-slate-950 border-slate-850 text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                    }`}
                  >
                    {val}
                  </button>
                );
              })}
            </div>
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
          onChange={handleSessionNotesChange}
          placeholder="e.g., Squats felt heavy but core bracing was stable. Rest periods were 3 mins."
          rows={3}
          className="w-full bg-slate-950 border border-slate-850 rounded-none px-3 py-2.5 text-sm font-medium text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
        />
      </div>

      {/* Main Movement Prompt Bubble (Week 1 of Strength, or Week 2+ repair mode with 0 eligible main movements) */}
      {!isOneOff && objective === 'Strength' && getEligibleMainMovementCount(exercises) === 0 && (
        <div className="mx-4 mb-3 p-3 bg-slate-950 border border-indigo-500/30 rounded-none relative">
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-slate-950 border-r border-b border-indigo-500/30 rotate-45"></div>
          <p className="text-xs font-black text-indigo-300 uppercase tracking-widest mb-1 flex items-center gap-1.5 font-mono">
            <Info className="w-4 h-4 text-cyan-400" />
            Select Your Main Lift
          </p>
          <p className="text-[11px] text-slate-400 leading-normal font-sans">
            Please designate a <strong className="text-indigo-400 font-extrabold uppercase font-mono">Main Movement</strong> by checking the box next to your primary lift (e.g., Squat, Bench Press) before saving. This locks in your strength periodisation for your program!
          </p>
        </div>
      )}

      {/* Save Log Button at Bottom */}
      <div className="px-4 pt-2">
        <button
          onClick={handleSaveSession}
          className={`w-full ${
            themeId === 'amber'
              ? 'bg-amber-600 hover:bg-amber-500 text-[#FBFAF8] border border-amber-700 shadow-amber-950/30'
              : 'bg-gradient-to-r from-indigo-500 to-cyan-500 hover:from-indigo-600 hover:to-cyan-600 text-[#FBFAF8]'
          } font-black text-sm py-4 px-4 rounded-none transition shadow-md active:scale-[0.98] flex items-center justify-center gap-2 uppercase tracking-wider cursor-pointer`}
        >
          <Check className="w-5 h-5 text-[#FBFAF8]" /> Save Workout Log
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
          setShowDiscardConfirm(false);
          handleDiscardDraft();
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
              className="bg-slate-900 border border-slate-800 rounded-none w-full max-w-sm overflow-hidden shadow-2xl font-sans"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-4 border-b border-slate-850 bg-slate-950/40 flex justify-between items-center">
                <h3 className="font-extrabold text-xs text-white uppercase tracking-wider font-mono">
                  Configure <span className="text-indigo-400 font-semibold normal-case tracking-normal">"{ex.name}"</span>
                </h3>
                <button onClick={dismissExAction} className="text-slate-400 hover:text-white text-xs font-bold font-mono">CLOSE</button>
              </div>
              <div className="p-4 space-y-3">
                <div className="space-y-2">
                  <div>
                    <label htmlFor="modal-exercise-name-input" className="block text-[10px] font-bold text-slate-400 uppercase font-mono mb-1">Exercise Name</label>
                    <input
                      id="modal-exercise-name-input"
                      type="text"
                      value={ex.name}
                      onChange={(e) => handleUpdateExerciseName(activeExAction, e.target.value)}
                      aria-label="Rename Exercise"
                      className="w-full bg-slate-950 border border-slate-850 rounded-none px-2.5 py-1.5 text-xs font-semibold text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>
                  <div>
                    <label htmlFor="modal-muscle-group-input" className="block text-[10px] font-bold text-slate-400 uppercase font-mono mb-1">Muscle Group</label>
                    <input
                      id="modal-muscle-group-input"
                      type="text"
                      value={ex.muscleGroup || ''}
                      onChange={(e) => handleUpdateMuscleGroup(activeExAction, e.target.value)}
                      aria-label="Update Muscle Group"
                      className="w-full bg-slate-950 border border-slate-850 rounded-none px-2.5 py-1.5 text-xs font-semibold text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      handleMoveExercise(activeExAction, 'up');
                      dismissExAction();
                    }}
                    disabled={activeExAction === 0}
                    className="bg-slate-950 hover:bg-slate-850 disabled:opacity-30 border border-slate-850 rounded-none p-3 text-xs font-black text-slate-100 hover:text-white transition flex items-center justify-center gap-1.5 cursor-pointer font-mono"
                  >
                    <ChevronUp className="w-5.5 h-5.5 text-indigo-400 shrink-0 stroke-[3]" />
                    <span>MOVE UP</span>
                  </button>
                  <button
                    onClick={() => {
                      handleMoveExercise(activeExAction, 'down');
                      dismissExAction();
                    }}
                    disabled={activeExAction === exercises.length - 1}
                    className="bg-slate-950 hover:bg-slate-850 disabled:opacity-30 border border-slate-850 rounded-none p-3 text-xs font-black text-slate-100 hover:text-white transition flex items-center justify-center gap-1.5 cursor-pointer font-mono"
                  >
                    <ChevronDown className="w-5.5 h-5.5 text-indigo-400 shrink-0 stroke-[3]" />
                    <span>MOVE DOWN</span>
                  </button>
                </div>

                <button
                  onClick={() => {
                    handleToggleSuperset(activeExAction);
                    dismissExAction();
                  }}
                  className="w-full text-left bg-slate-950 hover:bg-slate-850 border border-slate-850 rounded-none p-3 text-xs font-bold text-slate-300 transition flex items-center justify-between font-mono cursor-pointer"
                >
                  <span>Superset with exercise below</span>
                  <div className={`w-4.5 h-4.5 border border-slate-700 bg-slate-950 flex items-center justify-center shrink-0 rounded-none transition-colors ${ex.isSuperset ? 'border-indigo-500 bg-indigo-500/10' : ''}`}>
                    {ex.isSuperset && <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0 stroke-[3]" />}
                  </div>
                </button>

                <button
                  onClick={() => {
                    handleToggleSkipExercise(activeExAction);
                    dismissExAction();
                  }}
                  className="w-full text-left bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 hover:border-amber-500/40 rounded-none p-3 text-xs font-bold text-amber-400 transition flex items-center justify-between font-mono cursor-pointer"
                >
                  <span>{ex.isSkipped ? 'Unskip Exercise' : 'Skip Exercise This Session'}</span>
                  <div className={`w-4.5 h-4.5 border border-amber-500/50 bg-slate-950 flex items-center justify-center shrink-0 rounded-none transition-colors ${ex.isSkipped ? 'border-amber-500 bg-amber-500/10' : ''}`}>
                    {ex.isSkipped && <Check className="w-3.5 h-3.5 text-amber-400 shrink-0 stroke-[3]" />}
                  </div>
                </button>

                <button
                  onClick={() => {
                    setDeleteExerciseIdx(activeExAction);
                    dismissExAction();
                  }}
                  className="w-full text-left bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 hover:border-rose-500/40 rounded-none p-3 text-xs font-bold text-rose-400 transition flex items-center justify-between font-mono cursor-pointer"
                >
                  <span>Remove Exercise from workout</span>
                  <Trash2 className="w-4 h-4 text-rose-400 shrink-0" />
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
                {/* Move Up / Move Down buttons at the very top */}
                <div className="grid grid-cols-2 gap-2 pb-1">
                  <button
                    onClick={() => {
                      handleMoveSet(exIdx, setIdx, 'up');
                      dismissSetAction();
                    }}
                    disabled={setIdx === 0 || set.isSkipped}
                    className="bg-slate-950 hover:bg-slate-850 disabled:opacity-30 border border-slate-850 rounded-none p-3 transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <ChevronUp className="w-5 h-5 text-indigo-400 shrink-0 stroke-[3]" />
                    <span className="text-xs sm:text-sm font-black uppercase font-mono tracking-wide text-slate-100">MOVE UP</span>
                  </button>
                  <button
                    onClick={() => {
                      handleMoveSet(exIdx, setIdx, 'down');
                      dismissSetAction();
                    }}
                    disabled={setIdx === ex.sets.length - 1 || set.isSkipped}
                    className="bg-slate-950 hover:bg-slate-850 disabled:opacity-30 border border-slate-850 rounded-none p-3 transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <ChevronDown className="w-5 h-5 text-indigo-400 shrink-0 stroke-[3]" />
                    <span className="text-xs sm:text-sm font-black uppercase font-mono tracking-wide text-slate-100">MOVE DOWN</span>
                  </button>
                </div>

                {/* Comment Inline Input */}
                {!set.isSkipped && (
                  <div className="space-y-1.5">
                    <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider font-mono">
                      Set Comment / Note
                    </label>
                    <div className="flex gap-1.5">
                      <div className="relative flex-1">
                        <input
                          type="text"
                          value={commentDraft}
                          onChange={e => setCommentDraft(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleUpdateSetComment(exIdx, setIdx, commentDraft.trim());
                              dismissSetAction();
                            }
                          }}
                          placeholder="e.g., Last rep was slow, good squeeze"
                          className="w-full bg-slate-950 border border-slate-850 rounded-none pl-3 pr-8 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-sans"
                        />
                        {commentDraft.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setCommentDraft('')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-white transition rounded-full cursor-pointer"
                            title="Clear comment text"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          handleUpdateSetComment(exIdx, setIdx, commentDraft.trim());
                          dismissSetAction();
                        }}
                        className={`${
                          themeId === 'amber'
                            ? 'bg-amber-600 hover:bg-amber-500 text-[#FBFAF8]'
                            : 'bg-indigo-600 hover:bg-indigo-500 text-[#FBFAF8]'
                        } font-extrabold text-xs px-3.5 py-1.5 rounded-none transition shrink-0 font-mono cursor-pointer`}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                )}

                <div className="border-t border-slate-850 my-2 pt-2 space-y-2">
                  {/* Skip Set and Restore Planned Targets Grid */}
                  <div className="space-y-1">
                    <div className="grid grid-cols-2 gap-2">
                      {/* Skip Set / Unskip Set Button */}
                      {(() => {
                        if (set.isWarmup) {
                          return (
                            <button
                              type="button"
                              disabled
                              className="bg-slate-950 disabled:opacity-40 border border-slate-850 rounded-none p-3 text-slate-500 font-mono text-xs sm:text-sm font-black uppercase tracking-wide cursor-not-allowed w-full text-center"
                            >
                              SKIP SET
                            </button>
                          );
                        }
                        const isSkipped = !!set.isSkipped;
                        const check = isSkipped ? canUnskipSet(ex.sets, setIdx) : canSkipSet(ex.sets, setIdx);
                        return (
                          <button
                            type="button"
                            onClick={() => {
                              if (check.allowed) {
                                handleToggleSkipSet(exIdx, setIdx);
                                dismissSetAction();
                              }
                            }}
                            disabled={!check.allowed}
                            title={check.allowed ? undefined : check.reason}
                            className={`w-full p-3 border rounded-none flex items-center justify-center gap-2 transition cursor-pointer ${
                              isSkipped
                                ? 'bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/30 text-amber-400 disabled:opacity-40'
                                : 'bg-slate-950 hover:bg-slate-850 border-slate-850 text-slate-300 hover:text-amber-400 disabled:opacity-40'
                            }`}
                          >
                            <span className="text-xs sm:text-sm font-black uppercase font-mono tracking-wide">
                              {isSkipped ? 'UNSKIP SET' : 'SKIP SET'}
                            </span>
                          </button>
                        );
                      })()}

                      {/* Restore Planned Targets Button */}
                      {(() => {
                        const canRestore = canRestorePlannedTargets({
                          exercise: ex,
                          exIdx,
                          prescribedTargetSnapshots,
                          currentLiveAdjustedSets: liveAdjustedSets,
                          userTouchedSets,
                          focusedSetKey,
                          activeSelectorRowKey: activeSelector ? `${activeSelector.exIdx}-${activeSelector.setIdx}` : null,
                        });
                        return (
                          <button
                            type="button"
                            disabled={!canRestore}
                            onClick={() => {
                              if (canRestore) {
                                handleRestorePlannedTargets(exIdx);
                                dismissSetAction();
                              }
                            }}
                            title={canRestore ? 'Restore planned targets for this exercise' : 'No restorable live targets'}
                            className={`w-full p-3 border rounded-none flex items-center justify-center gap-1.5 transition ${
                              canRestore
                                ? 'bg-indigo-950/40 hover:bg-indigo-900/60 border-indigo-500/40 text-indigo-300 hover:text-white cursor-pointer'
                                : 'bg-slate-950 border-slate-850 text-slate-600 opacity-40 cursor-not-allowed'
                            }`}
                          >
                            <span className="text-xs sm:text-sm font-black uppercase font-mono tracking-wide text-center leading-tight">
                              Restore Planned Targets
                            </span>
                          </button>
                        );
                      })()}
                    </div>

                    {!set.isWarmup && (() => {
                      const isSkipped = !!set.isSkipped;
                      const check = isSkipped ? canUnskipSet(ex.sets, setIdx) : canSkipSet(ex.sets, setIdx);
                      if (!check.allowed && check.reason) {
                        return (
                          <p className="text-[10px] text-amber-500/80 font-mono text-center px-1">
                            {check.reason}
                          </p>
                        );
                      }
                      return null;
                    })()}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={set.isSkipped}
                      onClick={() => {
                        handleToggleDropSet(exIdx, setIdx);
                        dismissSetAction();
                      }}
                      className="bg-slate-950 hover:bg-slate-850 disabled:opacity-30 border border-slate-850 rounded-none p-3 text-slate-300 transition flex items-center justify-center gap-2 cursor-pointer w-full text-center"
                    >
                      <span className="text-xs sm:text-sm font-black uppercase font-mono tracking-wide text-slate-100">Drop Set</span>
                      <div className={`w-4.5 h-4.5 border border-slate-700 bg-slate-950 flex items-center justify-center shrink-0 rounded-none transition-colors ${set.isDropSet ? (themeId === 'amber' ? 'border-fuchsia-500 bg-fuchsia-50' : 'border-fuchsia-500 bg-fuchsia-500/10') : ''}`}>
                        {set.isDropSet && <Check className={`w-3 h-3 ${themeId === 'amber' ? 'text-fuchsia-600' : 'text-fuchsia-400'} shrink-0 stroke-[3]`} />}
                      </div>
                    </button>

                    <button
                      type="button"
                      disabled={set.isSkipped}
                      onClick={() => {
                        handleToggleWarmup(exIdx, setIdx);
                        dismissSetAction();
                      }}
                      className="bg-slate-950 hover:bg-slate-850 disabled:opacity-30 border border-slate-850 rounded-none p-3 text-slate-300 transition flex items-center justify-center gap-2 cursor-pointer w-full text-center"
                    >
                      <span className="text-xs sm:text-sm font-black uppercase font-mono tracking-wide text-slate-100">Warmup Set</span>
                      <div className={`w-4.5 h-4.5 border border-slate-700 bg-slate-950 flex items-center justify-center shrink-0 rounded-none transition-colors ${set.isWarmup ? 'border-amber-500 bg-amber-500/10' : ''}`}>
                        {set.isWarmup && <Check className="w-3 h-3 text-amber-400 shrink-0 stroke-[3]" />}
                      </div>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={set.isSkipped || !isCalculatorSupportedForModality(ex.modality)}
                      onClick={() => handleOpenCalc(exIdx, setIdx)}
                      className="bg-slate-950 hover:bg-slate-850 disabled:opacity-30 border border-slate-850 rounded-none p-3 text-slate-300 transition flex items-center justify-center cursor-pointer w-full text-center"
                    >
                      <span className="text-xs sm:text-sm font-black uppercase font-mono tracking-wide text-slate-100 whitespace-nowrap">
                        Equiv Set Calc
                      </span>
                    </button>

                    <button
                      type="button"
                      disabled={set.isSkipped}
                      onClick={() => {
                        handleAutoWarmup(exIdx, setIdx);
                        dismissSetAction();
                      }}
                      className="bg-slate-950 hover:bg-slate-850 disabled:opacity-30 border border-slate-850 rounded-none p-3 text-slate-300 transition flex items-center justify-center cursor-pointer w-full text-center"
                    >
                      <span className="text-xs sm:text-sm font-black uppercase font-mono tracking-wide text-slate-100 whitespace-nowrap">
                        Auto Warmup
                      </span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      handleDeleteSet(exIdx, setIdx);
                      dismissSetAction();
                    }}
                    className="w-full text-center bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 hover:border-rose-500/40 rounded-none p-3 text-rose-400 transition flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span className="text-xs sm:text-sm font-black uppercase font-mono tracking-wide">DELETE SET</span>
                    <Trash2 className="w-4 h-4 text-rose-400 shrink-0" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Equivalent Set Calculator Modal */}
      {calcModalState !== null && (() => {
        const targetEx = exercises[calcModalState.exIdx];
        const targetSet = targetEx?.sets[calcModalState.setIdx];
        if (!targetSet) return null;

        const baseWeight = targetSet.weight;
        const baseReps = targetSet.reps;
        const baseRpe = targetSet.rpe ?? null;
        const hasValidBase =
          baseWeight !== null &&
          baseWeight !== undefined &&
          !isNaN(baseWeight) &&
          baseWeight > 0 &&
          baseReps !== null &&
          baseReps !== undefined &&
          !isNaN(baseReps) &&
          baseReps > 0;

        const repsValidation = validateManualRepsEntry(calcRepsInput);
        const weightValidation = validateManualWeightEntry(calcWeightInput);

        const weightCalcResult = repsValidation.isValid && repsValidation.value !== null
          ? calculateEquivalentWorkingWeight({
              baseWeight,
              baseReps,
              baseRpe,
              targetReps: repsValidation.value,
              targetRpe: calcRpe,
            })
          : {
              status: 'invalid' as const,
              est1RM: hasValidBase ? calculateEquivalentWorkingWeight({ baseWeight, baseReps, baseRpe, targetReps: 1, targetRpe: 10 }).est1RM : null,
              rtsMultiplier: null,
              targetPercentage: null,
              targetWeight: null,
              errorReason: repsValidation.errorReason,
            };

        const repsCalcResult = solveEquivalentRepetitions({
          baseWeight,
          baseReps,
          baseRPE: baseRpe,
          availableWeight: weightValidation.isValid && weightValidation.value !== null ? weightValidation.value : undefined,
          targetRPE: calcRpe,
          unit,
        });

        const est1RM = weightCalcResult.est1RM;

        return (
          <div
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in"
            onClick={() => setCalcModalState(null)}
            role="dialog"
            aria-modal="true"
            aria-label="Equivalent Set Calculator"
          >
            <div
              className="bg-slate-900 border border-slate-800 rounded-none w-full max-w-sm overflow-hidden shadow-2xl flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              {/* 1. Modal Title */}
              <div className="p-3.5 border-b border-slate-850 bg-slate-950/60 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-indigo-400 shrink-0" />
                  <h3 className="font-extrabold text-xs text-white uppercase tracking-wider font-mono">
                    EQUIVALENT SET CALCULATOR
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setCalcModalState(null)}
                  className="p-1 text-slate-400 hover:text-white transition rounded-full cursor-pointer"
                  aria-label="Close calculator"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 space-y-3.5">
                {/* 2. Shared Current Set card */}
                <div className="bg-slate-950 border border-slate-850 p-3 flex items-center justify-between">
                  <div className="min-w-0 pr-2">
                    <span className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider font-mono truncate">
                      CURRENT SET • Set #{targetSet.setNumber} ({targetEx.name})
                    </span>
                    {hasValidBase ? (
                      <span className="text-sm font-extrabold text-white font-mono block">
                        {baseWeight} {unit} × {baseReps} @ RPE {baseRpe !== null ? (baseRpe % 1 === 0 ? baseRpe : baseRpe.toFixed(1)) : '—'}
                      </span>
                    ) : (
                      <span className="text-xs font-bold text-amber-400 font-mono block">
                        Incomplete set (missing weight or reps)
                      </span>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <span className="block text-[9px] font-bold text-indigo-400 uppercase tracking-wider font-mono">
                      {baseRpe === null ? 'Reps-only estimate' : 'Est. 1RM'}
                    </span>
                    <span className="text-xs sm:text-sm font-extrabold text-indigo-300 font-mono">
                      {est1RM !== null ? `${Math.round(est1RM * 10) / 10} ${unit}` : '—'}
                    </span>
                  </div>
                </div>

                {/* 3. Two-mode segmented selector */}
                <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-950 border border-slate-850">
                  <button
                    type="button"
                    onClick={() => setCalcMode('find_weight')}
                    className={`py-1.5 text-[11px] font-mono font-black uppercase tracking-wider transition border cursor-pointer text-center ${
                      calcMode === 'find_weight'
                        ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                        : 'bg-transparent text-slate-400 border-transparent hover:text-slate-200'
                    }`}
                    aria-label="Mode: Find Weight"
                  >
                    FIND WEIGHT
                  </button>
                  <button
                    type="button"
                    onClick={() => setCalcMode('find_reps')}
                    className={`py-1.5 text-[11px] font-mono font-black uppercase tracking-wider transition border cursor-pointer text-center ${
                      calcMode === 'find_reps'
                        ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                        : 'bg-transparent text-slate-400 border-transparent hover:text-slate-200'
                    }`}
                    aria-label="Mode: Find Reps"
                  >
                    FIND REPS
                  </button>
                </div>

                {/* 4. Controls relevant to selected mode */}
                {calcMode === 'find_weight' ? (
                  <div className="space-y-3">
                    {/* Target Reps with Editable Input, +/- Stepper, and Presets */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">
                          Target Reps
                        </label>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            const cur = repsValidation.isValid && repsValidation.value !== null ? repsValidation.value : 10;
                            const next = stepRepsValue(cur, -1);
                            setCalcRepsInput(String(next));
                          }}
                          className="h-8 w-10 bg-slate-950 hover:bg-slate-850 border border-slate-800 text-slate-200 font-mono font-bold flex items-center justify-center cursor-pointer active:scale-95 transition"
                          aria-label="Decrease target reps"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <div className="flex-1 relative flex items-center">
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={calcRepsInput}
                            onChange={e => setCalcRepsInput(e.target.value)}
                            placeholder="1–25"
                            aria-label="Target repetitions"
                            className={`w-full h-8 bg-slate-950 border ${!repsValidation.isValid && calcRepsInput !== '' ? 'border-amber-500/80 text-amber-300' : 'border-slate-850 text-indigo-400'} px-2 pr-11 font-mono font-extrabold text-sm text-center focus:outline-none focus:border-indigo-500 transition`}
                          />
                          <span className="absolute right-2 text-[10px] font-extrabold text-slate-500 font-mono pointer-events-none uppercase">
                            REPS
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const cur = repsValidation.isValid && repsValidation.value !== null ? repsValidation.value : 10;
                            const next = stepRepsValue(cur, 1);
                            setCalcRepsInput(String(next));
                          }}
                          className="h-8 w-10 bg-slate-950 hover:bg-slate-850 border border-slate-800 text-slate-200 font-mono font-bold flex items-center justify-center cursor-pointer active:scale-95 transition"
                          aria-label="Increase target reps"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {/* Quick Rep Presets */}
                      <div className="flex justify-between gap-1 pt-0.5">
                        {CALCULATOR_REP_PRESETS.map(r => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => setCalcRepsInput(String(r))}
                            className={`flex-1 py-1 text-[10px] font-mono font-bold transition border rounded-none cursor-pointer ${
                              repsValidation.isValid && repsValidation.value === r
                                ? 'bg-indigo-600 text-white border-indigo-500'
                                : 'bg-slate-950 text-slate-400 border-slate-850 hover:bg-slate-850 hover:text-white'
                            }`}
                            aria-label={`Set target reps to ${r}`}
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Target RPE Selection */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">
                          Target RPE
                        </label>
                        <span className="text-xs font-bold text-slate-300 font-mono">
                          RPE {calcRpe.toFixed(1)}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {VALID_CALCULATOR_RPES.map(rpeVal => (
                          <button
                            key={rpeVal}
                            type="button"
                            onClick={() => setCalcRpe(rpeVal)}
                            className={`py-1.5 text-xs font-mono font-bold transition border rounded-none cursor-pointer ${
                              calcRpe === rpeVal
                                ? 'bg-indigo-600 text-white border-indigo-500'
                                : 'bg-slate-950 text-slate-400 border-slate-850 hover:bg-slate-850 hover:text-white'
                            }`}
                            aria-label={`Set target RPE to ${rpeVal.toFixed(1)}`}
                          >
                            {rpeVal % 1 === 0 ? rpeVal : rpeVal.toFixed(1)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Available Weight Input with Direct Decimal Entry and -2.5 / +2.5 Steppers */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">
                          AVAILABLE WEIGHT ({unit})
                        </label>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            const cur = weightValidation.isValid && weightValidation.value !== null ? weightValidation.value : (parseFloat(calcWeightInput) || 0);
                            const next = stepWeightValue(cur, -2.5);
                            setCalcWeightInput(String(next));
                          }}
                          className="h-8 px-2.5 bg-slate-950 hover:bg-slate-850 border border-slate-800 text-slate-200 font-mono font-bold text-xs flex items-center justify-center cursor-pointer active:scale-95 transition"
                          aria-label="Decrease available weight by 2.5"
                        >
                          −2.5
                        </button>
                        <div className="flex-1 relative flex items-center">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={calcWeightInput}
                            onChange={e => setCalcWeightInput(e.target.value)}
                            placeholder="0.0"
                            aria-label={`Available weight in ${unit}`}
                            className={`w-full h-8 bg-slate-950 border ${!weightValidation.isValid && calcWeightInput !== '' ? 'border-amber-500/80 text-amber-300' : 'border-slate-850 text-indigo-300'} px-2 pr-9 font-mono font-extrabold text-sm text-center focus:outline-none focus:border-indigo-500 transition`}
                          />
                          <span className="absolute right-2 text-[10px] font-extrabold text-slate-500 font-mono pointer-events-none uppercase">
                            {unit}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const cur = weightValidation.isValid && weightValidation.value !== null ? weightValidation.value : (parseFloat(calcWeightInput) || 0);
                            const next = stepWeightValue(cur, 2.5);
                            setCalcWeightInput(String(next));
                          }}
                          className="h-8 px-2.5 bg-slate-950 hover:bg-slate-850 border border-slate-800 text-slate-200 font-mono font-bold text-xs flex items-center justify-center cursor-pointer active:scale-95 transition"
                          aria-label="Increase available weight by 2.5"
                        >
                          +2.5
                        </button>
                      </div>
                    </div>

                    {/* Target RPE Selection */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">
                          Target RPE
                        </label>
                        <span className="text-xs font-bold text-slate-300 font-mono">
                          RPE {calcRpe.toFixed(1)}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {VALID_CALCULATOR_RPES.map(rpeVal => (
                          <button
                            key={rpeVal}
                            type="button"
                            onClick={() => setCalcRpe(rpeVal)}
                            className={`py-1.5 text-xs font-mono font-bold transition border rounded-none cursor-pointer ${
                              calcRpe === rpeVal
                                ? 'bg-indigo-600 text-white border-indigo-500'
                                : 'bg-slate-950 text-slate-400 border-slate-850 hover:bg-slate-850 hover:text-white'
                            }`}
                            aria-label={`Set target RPE to ${rpeVal.toFixed(1)}`}
                          >
                            {rpeVal % 1 === 0 ? rpeVal : rpeVal.toFixed(1)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* 5. Complete Equivalent Set result */}
                <div className="bg-gradient-to-br from-indigo-950/60 to-slate-950 border border-indigo-500/30 p-3 text-center space-y-1">
                  <span className="block text-[9px] font-bold text-indigo-300 uppercase tracking-widest font-mono">
                    EQUIVALENT SET
                  </span>
                  {calcMode === 'find_weight' ? (
                    !hasValidBase ? (
                      <div className="py-1">
                        <div className="text-lg sm:text-xl font-black text-slate-500 font-mono tracking-tight">—</div>
                        <span className="block text-[10px] text-slate-400 font-mono">
                          Enter base weight and reps to calculate equivalent set
                        </span>
                      </div>
                    ) : !repsValidation.isValid ? (
                      <div className="py-1">
                        <div className="text-lg sm:text-xl font-black text-slate-500 font-mono tracking-tight">—</div>
                        <span className="block text-[10px] text-amber-400 font-mono">
                          Enter a whole number from 1 to 25.
                        </span>
                      </div>
                    ) : weightCalcResult.targetWeight !== null ? (
                      <>
                        <div className="text-lg sm:text-xl font-black text-white font-mono tracking-tight whitespace-nowrap">
                          {weightCalcResult.targetWeight} {unit} × {repsValidation.value} @ RPE {calcRpe % 1 === 0 ? calcRpe : calcRpe.toFixed(1)}
                        </div>
                        <span className="block text-[10px] text-slate-400 font-mono">
                          {weightCalcResult.targetPercentage}% of 1RM
                        </span>
                      </>
                    ) : (
                      <div className="py-1">
                        <div className="text-lg sm:text-xl font-black text-slate-500 font-mono tracking-tight">—</div>
                        <span className="block text-[10px] text-slate-400 font-mono">
                          {weightCalcResult.errorReason || 'Unable to calculate equivalent weight'}
                        </span>
                      </div>
                    )
                  ) : (
                    !hasValidBase ? (
                      <div className="py-1">
                        <div className="text-lg sm:text-xl font-black text-slate-500 font-mono tracking-tight">—</div>
                        <span className="block text-[10px] text-slate-400 font-mono">
                          Enter base weight and reps to calculate equivalent set
                        </span>
                      </div>
                    ) : !weightValidation.isValid ? (
                      <div className="py-1">
                        <div className="text-lg sm:text-xl font-black text-slate-500 font-mono tracking-tight">—</div>
                        <span className="block text-[10px] text-amber-400 font-mono">
                          Enter an available weight greater than 0.
                        </span>
                      </div>
                    ) : repsCalcResult.status !== 'bypassed' && repsCalcResult.targetReps !== null ? (
                      <>
                        <div className="text-lg sm:text-xl font-black text-white font-mono tracking-tight whitespace-nowrap">
                          {weightValidation.value} {unit} × {repsCalcResult.targetReps} @ RPE {calcRpe % 1 === 0 ? calcRpe : calcRpe.toFixed(1)}
                        </div>
                        <span className="block text-[10px] font-mono">
                          {repsCalcResult.status === 'exact' ? (
                            <span className="text-emerald-400">Exact match</span>
                          ) : repsCalcResult.status === 'constrained' ? (
                            <span className="text-amber-400">Closest match within 1–25 reps</span>
                          ) : (
                            <span className="text-indigo-300">Approximate match</span>
                          )}
                        </span>
                      </>
                    ) : (
                      <div className="py-1">
                        <div className="text-lg sm:text-xl font-black text-slate-500 font-mono tracking-tight">—</div>
                        <span className="block text-[10px] text-slate-400 font-mono">
                          {repsCalcResult.errorReason || 'Enter valid available weight and target RPE'}
                        </span>
                      </div>
                    )
                  )}
                </div>

                {/* 6. DONE button */}
                <button
                  type="button"
                  onClick={() => setCalcModalState(null)}
                  className="w-full bg-slate-950 hover:bg-slate-850 border border-slate-800 text-white font-extrabold text-xs py-2.5 rounded-none font-mono transition cursor-pointer"
                  aria-label="Done"
                >
                  DONE
                </button>
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
                          let est = 0;
                          if (h.modality === 'distance') {
                            est = (r / w) * 100;
                          } else {
                            est = r === 1 ? w : w * (1 + r / 30);
                          }
                          return Math.round(est * 10) / 10;
                        });
                        return Math.max(...ests, 0);
                      })();

                      const isPRSet = (() => {
                        if (item.modality === 'timed') return false;
                        const w = item.weight || 0;
                        const r = item.reps || 0;
                        if (w <= 0 || r <= 0) return false;
                        let est = 0;
                        if (item.modality === 'distance') {
                          est = (r / w) * 100;
                        } else {
                          est = r === 1 ? w : w * (1 + r / 30);
                        }
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
                              {item.isWarmup && <WarmupIcon className="w-3.5 h-3 text-amber-500 inline-block ml-0.5 shrink-0 align-middle" title="Warmup Set" />}
                              {item.isDropSet && <span className="text-rose-500 font-black ml-0.5 animate-pulse" title="Drop Set">↓</span>}
                              {' '}-
                            </span>
                            {item.modality === 'timed' ? (
                              <span className="font-extrabold text-white">{item.weight} secs</span>
                            ) : item.modality === 'distance' ? (
                              <span className="font-extrabold text-indigo-400">{item.reps} meters in {item.weight} secs</span>
                            ) : item.modality === 'distance_loaded' ? (
                              <>
                                <span className="font-extrabold text-white">{item.weight}{unit.toUpperCase()}</span>
                                <span className="text-slate-500 font-bold">x</span>
                                <span className="font-extrabold text-indigo-400">{item.reps} meters</span>
                              </>
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
                              <span
                                className={`inline-flex items-center gap-0.5 text-[8px] font-extrabold px-1 py-0.5 rounded uppercase tracking-tight animate-pulse shrink-0 ${
                                  themeId === 'amber'
                                    ? 'text-[#B56D3E] bg-[#B56D3E]/10 border border-[#B56D3E]/20'
                                    : 'text-amber-400 bg-amber-500/10 border border-amber-500/20'
                                }`}
                                title={item.modality === 'distance' ? 'Personal record' : 'Estimated 1RM personal record (Epley)'}
                                aria-label={item.modality === 'distance' ? 'Personal record' : 'Estimated 1RM personal record (Epley)'}
                              >
                                <Award className={`w-2.5 h-2.5 shrink-0 ${themeId === 'amber' ? 'text-[#B56D3E]' : 'text-amber-400'}`} /> {item.modality === 'distance' ? 'PR' : 'EPLEY 1RM PR'}
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
            <div className="bg-slate-900 border border-slate-800 rounded-none w-full max-w-sm overflow-hidden shadow-2xl font-mono">
              <div className="p-4 border-b border-slate-850 bg-slate-950/40">
                <h3 className="font-extrabold text-xs text-white uppercase tracking-wider">Remove Exercise?</h3>
              </div>
              <div className="p-4 space-y-4">
                <p className="text-xs text-slate-300 font-bold leading-relaxed font-sans">
                  Are you sure you want to remove <span className="text-rose-400 font-extrabold">"{ex.name}"</span> and all of its recorded sets from this workout? This action cannot be undone.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setDeleteExerciseIdx(null)}
                    className="bg-slate-950 hover:bg-slate-850 border border-slate-850 rounded-none p-2.5 text-xs font-bold text-slate-300 transition text-center cursor-pointer font-mono"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      handleDeleteExercise(deleteExerciseIdx);
                      setDeleteExerciseIdx(null);
                    }}
                    className="bg-rose-600 hover:bg-rose-500 text-white rounded-none p-2.5 text-xs font-black transition text-center cursor-pointer font-mono"
                  >
                    Confirm Removal
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Auto Warmup Replacement Confirmation Modal */}
      <ConfirmationModal
        visible={warmupReplacementConfirmState !== null}
        title={AUTO_WARMUP_REPLACE_CONFIRMATION.TITLE}
        message={AUTO_WARMUP_REPLACE_CONFIRMATION.MESSAGE}
        cancelLabel={AUTO_WARMUP_REPLACE_CONFIRMATION.CANCEL_LABEL}
        confirmLabel={AUTO_WARMUP_REPLACE_CONFIRMATION.CONFIRM_LABEL}
        confirmVariant="primary"
        onCancel={() => setWarmupReplacementConfirmState(null)}
        onConfirm={handleConfirmWarmupReplacement}
      />

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

      {/* Muscle Soreness Explanation Modal */}
      {showSorenessInfo && (
        <div
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={dismissSorenessInfo}
        >
          <div
            className="bg-slate-900 border border-slate-800 rounded-none w-full max-w-md overflow-hidden flex flex-col shadow-2xl shadow-indigo-950/40 max-h-[85vh] animate-in fade-in zoom-in-95 duration-150 font-sans"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 bg-slate-950 border-b border-slate-850 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-black text-white uppercase tracking-wider leading-snug flex items-center gap-2">
                  <Info className="w-4 h-4 text-indigo-400 font-bold" /> Muscle Soreness Rating
                </h3>
                <p className="text-[10px] text-indigo-400 font-mono uppercase tracking-widest leading-none mt-1">
                  Physiological Recovery & Safety Guard
                </p>
              </div>
              <button
                onClick={dismissSorenessInfo}
                className="p-1.5 bg-slate-900 hover:bg-slate-800 rounded-none text-slate-400 hover:text-white border border-slate-800 transition cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 overflow-y-auto space-y-4 text-xs sm:text-sm text-slate-300 leading-relaxed scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
              <p>
                The <strong>Muscle Soreness (1-10)</strong> metric rates the level of localised muscular tightness, fatigue, or mild stiffness resulting from recovery.
              </p>

              <div className="space-y-2 bg-indigo-950/20 p-3 border border-indigo-900/30">
                <h4 className="font-extrabold text-indigo-400 uppercase text-xs tracking-wider font-mono">
                  Target Muscles Only
                </h4>
                <p className="text-slate-400 text-xs">
                  Rate soreness based specifically on the muscles worked in previous training sessions (e.g., quadriceps soreness after heavy squatting). Do not include general joints or tendons here unless fatigue-related.
                </p>
              </div>

              <div className="space-y-2 bg-rose-950/20 p-3 border border-rose-900/30">
                <h4 className="font-extrabold text-rose-400 uppercase text-xs tracking-wider font-mono">
                  ⚠️ Soreness vs. Pain
                </h4>
                <p className="text-slate-400 text-xs">
                  Soreness is normal, but <strong>sharp joint pain, tendon irritation, or deep discomfort is NOT</strong>. If you feel actual physical injury or pain, cease your workout immediately and consult a medical professional.
                </p>
              </div>

              <div className="space-y-1 bg-slate-950/30 p-3 border border-slate-850">
                <h4 className="font-extrabold text-slate-400 uppercase text-xs tracking-wider font-mono">
                  How it factors into the algorithm
                </h4>
                <p className="text-slate-400 text-xs leading-normal">
                  Our progression engine cross-references this rating with other recovery signals to adjust your upcoming targets. Elevated soreness flags localised recovery deficits, prompting conservative target calculations to protect you from overtraining.
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="p-3 bg-slate-950 border-t border-slate-850 flex justify-end">
              <button
                onClick={dismissSorenessInfo}
                className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-2 px-4 rounded-none border border-slate-800 transition cursor-pointer"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Workout Quality Explanation Modal */}
      {showQualityInfo && (
        <div
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={dismissQualityInfo}
        >
          <div
            className="bg-slate-900 border border-slate-800 rounded-none w-full max-w-md overflow-hidden flex flex-col shadow-2xl shadow-indigo-950/40 max-h-[85vh] animate-in fade-in zoom-in-95 duration-150 font-sans"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 bg-slate-950 border-b border-slate-850 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-black text-white uppercase tracking-wider leading-snug flex items-center gap-2">
                  <Info className="w-4 h-4 text-cyan-400 font-bold" /> Workout Quality Rating
                </h3>
                <p className="text-[10px] text-cyan-400 font-mono uppercase tracking-widest leading-none mt-1">
                  Subjective Performance & stimulative load
                </p>
              </div>
              <button
                onClick={dismissQualityInfo}
                className="p-1.5 bg-slate-900 hover:bg-slate-800 rounded-none text-slate-400 hover:text-white border border-slate-800 transition cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 overflow-y-auto space-y-4 text-xs sm:text-sm text-slate-300 leading-relaxed scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
              <p>
                The <strong>Workout Quality (1-10)</strong> rating captures your subjective feedback on your mental focus, physical execution, and technical standard during today's workout.
              </p>

              <div className="space-y-2 bg-cyan-950/20 p-3 border border-cyan-900/30">
                <h4 className="font-extrabold text-cyan-400 uppercase text-xs tracking-wider font-mono">
                  Subjective Performance Factors
                </h4>
                <ul className="text-slate-400 text-xs list-disc pl-4 space-y-1">
                  <li><strong>Mind-Muscle Connection</strong>: How well you felt the target muscles contracting.</li>
                  <li><strong>Form Integrity</strong>: Your movement mechanics, stability, and lack of "cheating" reps.</li>
                  <li><strong>Focus & Drive</strong>: Your mental focus, intensity, and general energy state during the training session.</li>
                </ul>
              </div>

              <div className="space-y-1 bg-slate-950/30 p-3 border border-slate-850">
                <h4 className="font-extrabold text-slate-400 uppercase text-xs tracking-wider font-mono">
                  How it factors into the algorithm
                </h4>
                <p className="text-slate-400 text-xs leading-normal">
                  Our progression engine pairs this rating with raw data points (weight, repetitions, and RPE) to evaluate today's workout. High quality and high performance validate and secure faster target progressions, while lower quality acts as an automated safety throttle, letting you build confidence and form mastery before stepping up in weight.
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="p-3 bg-slate-950 border-t border-slate-850 flex justify-end">
              <button
                onClick={dismissQualityInfo}
                className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-2 px-4 rounded-none border border-slate-800 transition cursor-pointer"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live Adjustment Notification Toast */}
      {liveAdjustmentToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none animate-fade-in max-w-[90vw]">
          <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700/80 text-slate-100 text-xs font-mono px-4 py-2 shadow-2xl tracking-wide flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
            <span>{liveAdjustmentToast}</span>
          </div>
        </div>
      )}

      {/* Floating Rest Timer Widget */}
      {renderFloatingRestTimer()}

      {/* Header Guidance Info Modal */}
      {headerInfoModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150 font-sans"
          onClick={closeHeaderInfoModal}
        >
          <div
            ref={headerInfoContainerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="header-guidance-dialog-title"
            aria-describedby="header-guidance-dialog-desc"
            tabIndex={-1}
            className="bg-slate-900 border border-slate-800 rounded-none w-full max-w-md max-h-[90vh] overflow-y-auto p-5 text-slate-300 shadow-2xl flex flex-col gap-4 focus:outline-none"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <h3
                  id="header-guidance-dialog-title"
                  className="text-base font-black text-white uppercase tracking-wider font-mono flex items-center gap-2"
                >
                  <Info className="w-4 h-4 text-indigo-400 shrink-0" aria-hidden="true" />
                  {headerInfoModal.title}
                </h3>
                {headerInfoModal.secondaryHeading && (
                  <p className="text-[11px] font-mono text-indigo-400/90 uppercase tracking-widest mt-1">
                    {headerInfoModal.secondaryHeading}
                  </p>
                )}
              </div>
              <button
                ref={headerInfoCloseBtnRef}
                type="button"
                onClick={closeHeaderInfoModal}
                aria-label="Close dialog"
                className="p-1.5 bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <div id="header-guidance-dialog-desc" className="text-xs leading-relaxed text-slate-300 space-y-3">
              {headerInfoModal.body}
              {headerInfoModal.note && (
                <div className="mt-2">{headerInfoModal.note}</div>
              )}
            </div>

            <div className="pt-2 border-t border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={closeHeaderInfoModal}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-bold text-white uppercase tracking-wider border border-slate-700 transition cursor-pointer"
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
