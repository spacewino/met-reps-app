import { WorkoutLog, ExerciseEntry, SetEntry, WeightUnit, BodyweightSnapshot } from '../types';
import { calculateE1RMForSet, isValidRPE } from './rpeMath';
import { resolveSetEffectiveLoad, calculateSetWorkingVolume } from './effectiveLoad';

export type DiaryPrimaryCategoryId =
  | 'peak_test'
  | 'strength_focus'
  | 'hypertrophy_focus'
  | 'technique_practice'
  | 'recovery_deload'
  | 'conditioning_capacity'
  | 'mixed_session';

export type DiaryInsightId =
  | 'new_strength_ceiling'
  | 'load_pr'
  | 'rep_pr'
  | 'exercise_tonnage_pr'
  | 'quiet_progress'
  | 'back_in_action'
  | 'heavy_exposure'
  | 'consistent_output'
  | 'steep_fatigue_drop'
  | 'recovery_strain'
  | 'form_drift'
  | 'high_exertion'
  | 'against_the_odds'
  | 'muscle_focus'
  | 'minimalist_session'
  | 'compound_dominant';

export type DiaryInsightDomain =
  | 'progression'
  | 'stimulus'
  | 'execution_fatigue'
  | 'recovery_context'
  | 'session_signature';

export type DiaryInsightTone = 'celebratory' | 'neutral' | 'cautionary';

export type DiaryRarity = 'personal_first' | 'rare' | 'notable' | 'common' | null;

export interface DiaryInsightResult {
  id: DiaryInsightId;
  label: string;
  explanation: string;
  domain: DiaryInsightDomain;
  tone: DiaryInsightTone;
  priority: number;
  exerciseName?: string;
  muscleGroup?: string;
  rarity: DiaryRarity;
  numericEvidence?: Record<string, number>;
}

export interface DiaryPrimaryCategoryResult {
  id: DiaryPrimaryCategoryId;
  label: string;
  explanation: string;
  provisional: boolean;
}

export interface DiaryScorecardResult {
  primaryCategory: DiaryPrimaryCategoryResult;
  insights: DiaryInsightResult[];
  collapsedInsights: DiaryInsightResult[];
  overflowInsightCount: number;
  hasSufficientPerformanceHistory: boolean;
  sessionPerformanceIndex: number | null;
}

export type DiaryScorecardMap = Record<string, DiaryScorecardResult>;

const INSIGHT_PRIORITY: Record<DiaryInsightId, number> = {
  recovery_strain: 1,
  new_strength_ceiling: 2,
  load_pr: 3,
  rep_pr: 4,
  steep_fatigue_drop: 5,
  form_drift: 6,
  quiet_progress: 7,
  against_the_odds: 8,
  heavy_exposure: 9,
  consistent_output: 10,
  exercise_tonnage_pr: 11,
  back_in_action: 12,
  high_exertion: 13,
  muscle_focus: 14,
  compound_dominant: 15,
  minimalist_session: 16,
};

const INSIGHT_META: Record<
  DiaryInsightId,
  { label: string; domain: DiaryInsightDomain; tone: DiaryInsightTone }
> = {
  recovery_strain: {
    label: 'Recovery Strain',
    domain: 'recovery_context',
    tone: 'cautionary',
  },
  new_strength_ceiling: {
    label: 'New Strength Ceiling',
    domain: 'progression',
    tone: 'celebratory',
  },
  load_pr: {
    label: 'Load PR',
    domain: 'progression',
    tone: 'celebratory',
  },
  rep_pr: {
    label: 'Rep PR',
    domain: 'progression',
    tone: 'celebratory',
  },
  steep_fatigue_drop: {
    label: 'Steep Fatigue Drop',
    domain: 'execution_fatigue',
    tone: 'cautionary',
  },
  form_drift: {
    label: 'Form Drift',
    domain: 'execution_fatigue',
    tone: 'neutral',
  },
  quiet_progress: {
    label: 'Quiet Progress',
    domain: 'progression',
    tone: 'celebratory',
  },
  against_the_odds: {
    label: 'Against the Odds',
    domain: 'recovery_context',
    tone: 'celebratory',
  },
  heavy_exposure: {
    label: 'Heavy Exposure',
    domain: 'stimulus',
    tone: 'neutral',
  },
  consistent_output: {
    label: 'Consistent Output',
    domain: 'execution_fatigue',
    tone: 'celebratory',
  },
  exercise_tonnage_pr: {
    label: 'Exercise Tonnage PR',
    domain: 'progression',
    tone: 'celebratory',
  },
  back_in_action: {
    label: 'Back in Action',
    domain: 'progression',
    tone: 'celebratory',
  },
  high_exertion: {
    label: 'High Exertion',
    domain: 'execution_fatigue',
    tone: 'neutral',
  },
  muscle_focus: {
    label: 'Muscle Focus',
    domain: 'session_signature',
    tone: 'neutral',
  },
  compound_dominant: {
    label: 'Compound Dominant',
    domain: 'session_signature',
    tone: 'neutral',
  },
  minimalist_session: {
    label: 'Minimalist Session',
    domain: 'session_signature',
    tone: 'neutral',
  },
};

const LB_TO_KG = 0.45359237;

/**
 * Normalizes weight in kg or lb to kilograms.
 */
export function normalizeWeightToKg(weight: number | null | undefined, unit: WeightUnit): number {
  if (weight === null || weight === undefined || !Number.isFinite(weight)) {
    return 0;
  }
  return unit === 'lb' ? weight * LB_TO_KG : weight;
}

/**
 * Normalizes exercise name by trimming, lowercasing, and collapsing whitespace.
 */
export function normalizeExerciseName(name: string | null | undefined): string {
  if (!name) return '';
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Returns true if a set meets high-confidence performance eligibility criteria (legacy standalone weighted signature).
 */
export function isHighConfidencePerformanceSetEligible(
  exercise: ExerciseEntry,
  set: SetEntry
): boolean {
  const modality = exercise.modality;
  if (modality !== undefined && modality !== 'weighted') {
    return false;
  }
  if (exercise.isSkipped === true) {
    return false;
  }
  if (set.isCompleted !== true) {
    return false;
  }
  if (set.isSkipped === true || set.isWarmup === true) {
    return false;
  }
  if (set.weight === null || set.weight === undefined || !Number.isFinite(set.weight) || set.weight <= 0) {
    return false;
  }
  if (set.reps === null || set.reps === undefined || !Number.isInteger(set.reps) || set.reps <= 0) {
    return false;
  }
  if (set.rpe === null || set.rpe === undefined || !isValidRPE(set.rpe)) {
    return false;
  }
  if (set.form === 'loose') {
    return false;
  }
  return true;
}

export interface PerformanceSetLoadResolution {
  status: 'valid' | 'invalid' | 'unavailable' | 'not_applicable';
  effectiveLoadKg: number | null;
  e1rmKg: number | null;
}

/**
 * Resolves performance set evidence using canonical effective load math and e1RM.
 * Separates quality eligibility from load eligibility.
 */
export function resolvePerformanceSetEvidence(
  exercise: ExerciseEntry,
  set: SetEntry,
  logUnit: WeightUnit,
  snapshot: BodyweightSnapshot | null | undefined
): PerformanceSetLoadResolution {
  // 1. Quality Eligibility
  if (exercise.isSkipped === true) {
    return { status: 'invalid', effectiveLoadKg: null, e1rmKg: null };
  }
  if (set.isCompleted !== true) {
    return { status: 'invalid', effectiveLoadKg: null, e1rmKg: null };
  }
  if (set.isSkipped === true || set.isWarmup === true) {
    return { status: 'invalid', effectiveLoadKg: null, e1rmKg: null };
  }
  if (set.reps === null || set.reps === undefined || !Number.isInteger(set.reps) || set.reps <= 0) {
    return { status: 'invalid', effectiveLoadKg: null, e1rmKg: null };
  }
  if (set.rpe === null || set.rpe === undefined || !isValidRPE(set.rpe)) {
    return { status: 'invalid', effectiveLoadKg: null, e1rmKg: null };
  }
  if (set.form === 'loose') {
    return { status: 'invalid', effectiveLoadKg: null, e1rmKg: null };
  }

  // 2. Load Eligibility via resolveSetEffectiveLoad
  const loadRes = resolveSetEffectiveLoad(set.weight, exercise.modality, logUnit, snapshot);
  if (loadRes.status !== 'valid' || loadRes.effectiveLoadKg === null || loadRes.effectiveLoadKg <= 0) {
    return { status: loadRes.status, effectiveLoadKg: null, e1rmKg: null };
  }

  // 3. E1RM Calculation
  const e1rm = calculateE1RMForSet(loadRes.effectiveLoadKg, set.reps, set.rpe);
  if (e1rm === null || e1rm <= 0) {
    return { status: 'invalid', effectiveLoadKg: loadRes.effectiveLoadKg, e1rmKg: null };
  }

  return {
    status: 'valid',
    effectiveLoadKg: loadRes.effectiveLoadKg,
    e1rmKg: e1rm,
  };
}

/**
 * Parses an ID timestamp only if it strictly matches exactly 12+ digits or 'log-' followed by 12+ digits.
 */
function parseStrictIdTimestamp(id: string | null | undefined): number | null {
  if (!id) return null;
  const digitsOnlyMatch = id.match(/^\d{12,}$/);
  if (digitsOnlyMatch) {
    const n = Number(id);
    return Number.isFinite(n) ? n : null;
  }
  const logPrefixedMatch = id.match(/^log-(\d{12,})$/);
  if (logPrefixedMatch) {
    const n = Number(logPrefixedMatch[1]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Returns true if a date string is a valid ISO/calendar date.
 */
function isValidDate(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const epoch = Date.parse(dateStr);
  return Number.isFinite(epoch);
}

/**
 * Returns strictly preceding logs for targetLog from allLogs.
 */
export function getStrictlyPrecedingLogs(
  targetLog: WorkoutLog,
  allLogs: WorkoutLog[]
): WorkoutLog[] {
  let targetIndex = allLogs.indexOf(targetLog);
  if (targetIndex === -1) {
    if (targetLog.id) {
      const matchingIndices: number[] = [];
      allLogs.forEach((log, idx) => {
        if (log.id === targetLog.id) {
          matchingIndices.push(idx);
        }
      });
      if (matchingIndices.length === 1) {
        targetIndex = matchingIndices[0];
      } else {
        return [];
      }
    } else {
      return [];
    }
  }

  const targetDateValid = isValidDate(targetLog.date);
  const targetIdTime = parseStrictIdTimestamp(targetLog.id);

  // If the target has neither a valid date nor a valid epoch-like ID, no historical chronology can be established.
  if (!targetDateValid && targetIdTime === null) {
    return [];
  }

  return allLogs.filter((candidate, candidateIndex) => {
    if (candidateIndex === targetIndex || candidate === targetLog) {
      return false;
    }

    const candDateValid = isValidDate(candidate.date);
    const candIdTime = parseStrictIdTimestamp(candidate.id);

    // A historical candidate with neither a valid date nor a valid epoch-like ID must not enter comparative history.
    if (!candDateValid && candIdTime === null) {
      return false;
    }

    // When both possess valid calendar dates:
    if (candDateValid && targetDateValid) {
      const candDateEpoch = Date.parse(candidate.date);
      const targetDateEpoch = Date.parse(targetLog.date);

      if (candDateEpoch !== targetDateEpoch) {
        return candDateEpoch < targetDateEpoch;
      }

      // Same calendar day:
      if (candIdTime !== null && targetIdTime !== null && candIdTime !== targetIdTime) {
        return candIdTime < targetIdTime;
      }
      return candidateIndex < targetIndex;
    }

    // Fallback when one or both dates are invalid using epoch-like timestamp IDs:
    const candEffectiveTime = candIdTime !== null ? candIdTime : Date.parse(candidate.date);
    const targetEffectiveTime = targetIdTime !== null ? targetIdTime : Date.parse(targetLog.date);

    if (candEffectiveTime !== targetEffectiveTime) {
      return candEffectiveTime < targetEffectiveTime;
    }

    return candidateIndex < targetIndex;
  });
}

/**
 * Calculates the exercise tonnage in kilograms for an exercise within a workout.
 */
export function calculateExerciseTonnageKg(
  exercise: ExerciseEntry,
  unit: WeightUnit,
  snapshot?: BodyweightSnapshot | null
): number {
  if (exercise.isSkipped === true) return 0;
  const modality = exercise.modality || 'weighted';
  if (modality !== 'weighted' && modality !== 'bodyweight' && modality !== 'assisted') {
    return 0;
  }

  let totalTonnageKg = 0;
  for (const set of exercise.sets) {
    if (set.isSkipped === true || set.isWarmup === true || set.isCompleted !== true) {
      continue;
    }
    const volRes = calculateSetWorkingVolume(set.weight, set.reps, exercise.modality, unit, snapshot);
    if (volRes.status !== 'valid' || volRes.volumeKg === null) {
      return 0;
    }
    totalTonnageKg += volRes.volumeKg;

    if (set.isDropSet === true && Array.isArray(set.dropSubSets)) {
      for (const sub of set.dropSubSets) {
        const subVol = calculateSetWorkingVolume(sub.weight, sub.reps, exercise.modality, unit, snapshot);
        if (subVol.status !== 'valid' || subVol.volumeKg === null) {
          return 0;
        }
        totalTonnageKg += subVol.volumeKg;
      }
    }
  }

  return totalTonnageKg;
}

/**
 * Calculates the session performance index comparing the target workout to historical baselines.
 */
export function calculateSessionPerformanceIndex(
  targetLog: WorkoutLog,
  allLogs: WorkoutLog[]
): number | null {
  const precedingLogs = getStrictlyPrecedingLogs(targetLog, allLogs);

  const targetExercises = new Map<string, { todayBestE1RM: number; isMain: boolean }>();

  targetLog.exercises.forEach(ex => {
    if (ex.isSkipped === true) return;
    const mod = ex.modality || 'weighted';
    if (mod !== 'weighted' && mod !== 'bodyweight' && mod !== 'assisted') return;

    const normName = normalizeExerciseName(ex.name);
    if (!normName) return;

    let bestE1RM = 0;
    ex.sets.forEach(set => {
      const ev = resolvePerformanceSetEvidence(ex, set, targetLog.unit, targetLog.bodyweightSnapshot);
      if (ev.status === 'valid' && ev.e1rmKg !== null && ev.e1rmKg > bestE1RM) {
        bestE1RM = ev.e1rmKg;
      }
    });

    if (bestE1RM > 0) {
      const existing = targetExercises.get(normName);
      if (!existing || bestE1RM > existing.todayBestE1RM) {
        targetExercises.set(normName, {
          todayBestE1RM: bestE1RM,
          isMain: ex.isMainMovement === true,
        });
      }
    }
  });

  if (targetExercises.size === 0) return null;

  const exerciseRatios: number[] = [];
  let singleMainEligible = false;

  targetExercises.forEach(({ todayBestE1RM, isMain }, normName) => {
    const historicalExposureE1RMs: number[] = [];

    precedingLogs.forEach(pastLog => {
      let pastBestE1RM = 0;
      pastLog.exercises.forEach(pastEx => {
        if (pastEx.isSkipped === true) return;
        if (normalizeExerciseName(pastEx.name) !== normName) return;
        const mod = pastEx.modality || 'weighted';
        if (mod !== 'weighted' && mod !== 'bodyweight' && mod !== 'assisted') return;

        pastEx.sets.forEach(set => {
          const pastEv = resolvePerformanceSetEvidence(pastEx, set, pastLog.unit, pastLog.bodyweightSnapshot);
          if (pastEv.status === 'valid' && pastEv.e1rmKg !== null && pastEv.e1rmKg > pastBestE1RM) {
            pastBestE1RM = pastEv.e1rmKg;
          }
        });
      });

      if (pastBestE1RM > 0) {
        historicalExposureE1RMs.push(pastBestE1RM);
      }
    });

    if (targetExercises.size === 1 && isMain) {
      if (historicalExposureE1RMs.length >= 3) {
        const last3 = historicalExposureE1RMs.slice(-3).sort((a, b) => a - b);
        const baseline = last3[1];
        if (baseline > 0) {
          exerciseRatios.push(todayBestE1RM / baseline);
          singleMainEligible = true;
        }
      }
    } else {
      if (historicalExposureE1RMs.length >= 2) {
        const last3 = historicalExposureE1RMs.slice(-3).sort((a, b) => a - b);
        const baseline =
          last3.length === 2
            ? (last3[0] + last3[1]) / 2
            : last3[1];
        if (baseline > 0) {
          exerciseRatios.push(todayBestE1RM / baseline);
        }
      }
    }
  });

  if (targetExercises.size === 1) {
    if (!singleMainEligible || exerciseRatios.length === 0) return null;
    return exerciseRatios[0];
  }

  if (exerciseRatios.length < 2) {
    return null;
  }

  exerciseRatios.sort((a, b) => a - b);
  const mid = Math.floor(exerciseRatios.length / 2);
  const medianRatio =
    exerciseRatios.length % 2 !== 0
      ? exerciseRatios[mid]
      : (exerciseRatios[mid - 1] + exerciseRatios[mid]) / 2;

  return medianRatio;
}

/**
 * Returns true if a set is a valid structural working set.
 */
function isStructuralWorkingSet(exercise: ExerciseEntry, set: SetEntry): boolean {
  if (exercise.isSkipped === true) return false;
  if (set.isSkipped === true || set.isWarmup === true) return false;
  if (set.isCompleted === false) return false;

  const mod = exercise.modality || 'weighted';
  if (mod === 'weighted') {
    return (set.weight !== null && set.weight !== undefined && set.weight > 0 &&
            set.reps !== null && set.reps !== undefined && set.reps > 0);
  }
  if (mod === 'bodyweight' || mod === 'assisted') {
    return set.reps !== null && set.reps !== undefined && set.reps > 0;
  }
  if (mod === 'timed') {
    return (set.weight !== null && set.weight !== undefined && set.weight > 0) ||
           (set.reps !== null && set.reps !== undefined && set.reps > 0);
  }
  if (mod === 'distance') {
    return (set.reps !== null && set.reps !== undefined && set.reps > 0) ||
           (set.weight !== null && set.weight !== undefined && set.weight > 0);
  }
  if (mod === 'distance_loaded') {
    return (set.weight !== null && set.weight !== undefined && set.weight > 0 &&
            set.reps !== null && set.reps !== undefined && set.reps > 0);
  }
  return false;
}

/**
 * Classifies the workout into its primary category.
 */
export function classifyDiaryWorkout(targetLog: WorkoutLog): DiaryPrimaryCategoryResult {
  interface WorkingSetEntryMeta {
    set: SetEntry;
    isConditioning: boolean;
    isResistance: boolean;
    isWeighted: boolean;
    isCompound: boolean;
    reps: number;
    rpe: number | null;
    hasValidRpe: boolean;
    isPeakCompound: boolean;
    isPeakMaximalSingle: boolean;
    isWeightedStrength: boolean;
    isResistanceStrength: boolean;
    isResistanceHypertrophy: boolean;
    isResistanceTechnique: boolean;
  }

  const workingSetEntries: WorkingSetEntryMeta[] = [];

  let totalWorkingSets = 0;
  let conditioningWorkingSets = 0;
  let resistanceWorkingSets = 0;

  let strengthSets = 0;
  let hypertrophySets = 0;
  let techniqueSets = 0;

  let rpeSum = 0;
  let rpeCount = 0;
  let hasSetRpe8OrAbove = false;
  let hasSetRpeAbove7_5 = false;

  targetLog.exercises.forEach(ex => {
    if (ex.isSkipped === true) return;
    const mod = ex.modality || 'weighted';
    const isConditioningMod = mod === 'timed' || mod === 'distance' || mod === 'distance_loaded';
    const isWeighted = mod === 'weighted';
    const isCompound = ex.movementCategory === 'compound';

    ex.sets.forEach(set => {
      if (!isStructuralWorkingSet(ex, set)) return;

      totalWorkingSets += 1;

      if (isConditioningMod) {
        conditioningWorkingSets += 1;
        workingSetEntries.push({
          set,
          isConditioning: true,
          isResistance: false,
          isWeighted: false,
          isCompound: false,
          reps: 0,
          rpe: null,
          hasValidRpe: false,
          isPeakCompound: false,
          isPeakMaximalSingle: false,
          isWeightedStrength: false,
          isResistanceStrength: false,
          isResistanceHypertrophy: false,
          isResistanceTechnique: false,
        });
        return;
      }

      resistanceWorkingSets += 1;

      const reps = set.reps || 0;
      const rpe = set.rpe;
      const hasValidRpe = rpe !== null && rpe !== undefined && isValidRPE(rpe);

      if (hasValidRpe) {
        rpeSum += rpe;
        rpeCount += 1;
        if (rpe >= 8.0) hasSetRpe8OrAbove = true;
        if (rpe > 7.5) hasSetRpeAbove7_5 = true;
      }

      const isPeakCompound = isWeighted && isCompound && reps >= 1 && reps <= 3 && hasValidRpe && rpe >= 9.0;
      const isPeakMaximalSingle = isWeighted && isCompound && reps === 1 && hasValidRpe && rpe >= 9.5;
      const isWeightedStrength = isWeighted && reps >= 1 && reps <= 5 && hasValidRpe && rpe >= 7.0;
      const isResistanceStrength = reps >= 1 && reps <= 5 && hasValidRpe && rpe >= 7.0;
      const isResistanceHypertrophy = reps >= 6 && reps <= 30 && hasValidRpe && rpe >= 7.0;
      const isResistanceTechnique = hasValidRpe && rpe <= 6.5 && set.form === 'strict';

      if (isResistanceStrength) {
        strengthSets += 1;
      } else if (isResistanceHypertrophy) {
        hypertrophySets += 1;
      } else if (isResistanceTechnique) {
        techniqueSets += 1;
      }

      workingSetEntries.push({
        set,
        isConditioning: false,
        isResistance: true,
        isWeighted,
        isCompound,
        reps,
        rpe: rpe ?? null,
        hasValidRpe,
        isPeakCompound,
        isPeakMaximalSingle,
        isWeightedStrength,
        isResistanceStrength,
        isResistanceHypertrophy,
        isResistanceTechnique,
      });
    });
  });

  if (totalWorkingSets === 0) {
    return {
      id: 'mixed_session',
      label: 'Mixed Session',
      explanation: 'No completed working sets were recorded in this workout.',
      provisional: false,
    };
  }

  // 1. Peak / Test
  // Path A: At least 2 completed weighted compound working sets with reps 1-3 at RPE >= 9.0
  const peakCompoundSetsCount = workingSetEntries.filter(s => s.isPeakCompound).length;
  const peakMaximalSingles = workingSetEntries.filter(s => s.isPeakMaximalSingle);

  // Path B: Exactly 1 completed weighted compound single with reps 1 at RPE >= 9.5, plus >= 2 ADDITIONAL completed weighted strength-style working sets
  let satisfiesPathB = false;
  if (peakMaximalSingles.length === 1) {
    const singleSetMeta = peakMaximalSingles[0];
    const otherSupportingStrengthSets = workingSetEntries.filter(
      s => s !== singleSetMeta && s.isWeightedStrength
    ).length;
    if (otherSupportingStrengthSets >= 2) {
      satisfiesPathB = true;
    }
  }

  if (peakCompoundSetsCount >= 2 || satisfiesPathB) {
    return {
      id: 'peak_test',
      label: 'Peak / Test',
      explanation: 'High-intensity testing or near-maximal singles formed the dominant training character.',
      provisional: false,
    };
  }

  // 2. Conditioning / Capacity
  if (conditioningWorkingSets / totalWorkingSets > 0.5) {
    return {
      id: 'conditioning_capacity',
      label: 'Conditioning / Capacity',
      explanation: 'Timed intervals, distance endurance, or loaded carries formed the majority of working sets.',
      provisional: false,
    };
  }

  // 3. Recovery / Deload
  const meanRpe = rpeCount > 0 ? rpeSum / rpeCount : 0;
  const rpeCoverage = rpeCount / totalWorkingSets;

  if (targetLog.objective === 'Deload') {
    if ((rpeCount === 0 || meanRpe <= 7.0) && !hasSetRpe8OrAbove) {
      return {
        id: 'recovery_deload',
        label: 'Recovery / Deload',
        explanation: 'Planned deload session executed with controlled submaximal exertion.',
        provisional: false,
      };
    }
  } else {
    if (
      totalWorkingSets <= 8 &&
      rpeCoverage >= 0.6 &&
      meanRpe <= 6.5 &&
      !hasSetRpe8OrAbove
    ) {
      return {
        id: 'recovery_deload',
        label: 'Recovery / Deload',
        explanation: 'Truncated session volume and low exertion facilitated recovery.',
        provisional: false,
      };
    }
  }

  // 4. Technique / Practice
  if (
    resistanceWorkingSets > 0 &&
    techniqueSets / resistanceWorkingSets >= 0.6 &&
    !hasSetRpeAbove7_5
  ) {
    return {
      id: 'technique_practice',
      label: 'Technique / Practice',
      explanation: 'Submaximal practice performed with strict form and ample reserve.',
      provisional: false,
    };
  }

  // 5. Strength Focus
  if (resistanceWorkingSets > 0 && strengthSets / resistanceWorkingSets > 0.5) {
    return {
      id: 'strength_focus',
      label: 'Strength Focus',
      explanation: 'Heavy compound loading in low-to-moderate repetition ranges dominated the session.',
      provisional: false,
    };
  }

  // 6. Hypertrophy Focus
  if (resistanceWorkingSets > 0 && hypertrophySets / resistanceWorkingSets > 0.5) {
    return {
      id: 'hypertrophy_focus',
      label: 'Hypertrophy Focus',
      explanation: 'Accumulation of working sets in moderate-to-high repetition ranges dominated the session.',
      provisional: false,
    };
  }

  // 7. Exact 50/50 Strength and Hypertrophy tie
  if (
    resistanceWorkingSets > 0 &&
    strengthSets > 0 &&
    hypertrophySets > 0 &&
    strengthSets === hypertrophySets &&
    (strengthSets + hypertrophySets) === resistanceWorkingSets
  ) {
    if (targetLog.objective === 'Strength') {
      return {
        id: 'strength_focus',
        label: 'Strength Focus',
        explanation: 'Balanced loading aligned with planned strength objective.',
        provisional: false,
      };
    }
    if (targetLog.objective === 'Hypertrophy') {
      return {
        id: 'hypertrophy_focus',
        label: 'Hypertrophy Focus',
        explanation: 'Balanced loading aligned with planned hypertrophy objective.',
        provisional: false,
      };
    }
    return {
      id: 'mixed_session',
      label: 'Mixed Session',
      explanation: 'Working sets were evenly split across strength and hypertrophy loading zones.',
      provisional: false,
    };
  }

  // 8. Mixed Session
  return {
    id: 'mixed_session',
    label: 'Mixed Session',
    explanation: 'Training was balanced across multiple loading zones and accessory movements.',
    provisional: false,
  };
}

interface RawInsightCandidate {
  id: DiaryInsightId;
  label: string;
  explanation: string;
  domain: DiaryInsightDomain;
  tone: DiaryInsightTone;
  priority: number;
  exerciseName?: string;
  muscleGroup?: string;
  numericEvidence?: Record<string, number>;
}

/**
 * Generates raw candidate insights for a target workout given all workout logs.
 */
function evaluateRawInsights(
  targetLog: WorkoutLog,
  allLogs: WorkoutLog[]
): RawInsightCandidate[] {
  const precedingLogs = getStrictlyPrecedingLogs(targetLog, allLogs);
  const candidates: RawInsightCandidate[] = [];

  const newStrengthCeilingExercises = new Set<string>();
  const consistentOutputExercises = new Set<string>();
  const steepFatigueDropExercises = new Set<string>();

  // --- Insight 1: New Strength Ceiling & Insight 2: Load PR & Insight 3: Rep PR & Insight 4: Tonnage PR ---
  const performanceExercisesToday = new Map<
    string,
    { originalName: string; exercise: ExerciseEntry }
  >();

  targetLog.exercises.forEach(ex => {
    if (ex.isSkipped === true) return;
    const mod = ex.modality || 'weighted';
    if (mod !== 'weighted' && mod !== 'bodyweight' && mod !== 'assisted') return;
    const norm = normalizeExerciseName(ex.name);
    if (!norm) return;
    if (!performanceExercisesToday.has(norm)) {
      performanceExercisesToday.set(norm, { originalName: ex.name, exercise: ex });
    }
  });

  performanceExercisesToday.forEach(({ originalName, exercise }, normName) => {
    let todayBestE1RM = 0;
    let todayMaxWeightKg = 0;
    const todayExactRepsByWeightKg = new Map<number, number>();

    exercise.sets.forEach(set => {
      const ev = resolvePerformanceSetEvidence(exercise, set, targetLog.unit, targetLog.bodyweightSnapshot);
      if (ev.status !== 'valid' || ev.effectiveLoadKg === null || ev.e1rmKg === null) return;

      if (ev.e1rmKg > todayBestE1RM) {
        todayBestE1RM = ev.e1rmKg;
      }
      if (ev.effectiveLoadKg > todayMaxWeightKg) {
        todayMaxWeightKg = ev.effectiveLoadKg;
      }

      const quantizedLoad = Math.round(ev.effectiveLoadKg * 100) / 100;
      const currentReps = todayExactRepsByWeightKg.get(quantizedLoad) || 0;
      if (set.reps! > currentReps) {
        todayExactRepsByWeightKg.set(quantizedLoad, set.reps!);
      }
    });

    let pastMaxE1RM = 0;
    let pastMaxWeightKg = 0;
    const pastExactMaxRepsByWeightKg = new Map<number, number>();
    let historicalExposureCount = 0;

    precedingLogs.forEach(pastLog => {
      let pastExFound = false;
      pastLog.exercises.forEach(pastEx => {
        if (pastEx.isSkipped === true) return;
        if (normalizeExerciseName(pastEx.name) !== normName) return;
        const mod = pastEx.modality || 'weighted';
        if (mod !== 'weighted' && mod !== 'bodyweight' && mod !== 'assisted') return;

        pastEx.sets.forEach(set => {
          const pastEv = resolvePerformanceSetEvidence(pastEx, set, pastLog.unit, pastLog.bodyweightSnapshot);
          if (pastEv.status !== 'valid' || pastEv.effectiveLoadKg === null || pastEv.e1rmKg === null) return;
          pastExFound = true;

          if (pastEv.e1rmKg > pastMaxE1RM) {
            pastMaxE1RM = pastEv.e1rmKg;
          }
          if (pastEv.effectiveLoadKg > pastMaxWeightKg) {
            pastMaxWeightKg = pastEv.effectiveLoadKg;
          }

          const quantizedLoad = Math.round(pastEv.effectiveLoadKg * 100) / 100;
          const prevMax = pastExactMaxRepsByWeightKg.get(quantizedLoad) || 0;
          if (set.reps! > prevMax) {
            pastExactMaxRepsByWeightKg.set(quantizedLoad, set.reps!);
          }
        });
      });
      if (pastExFound) {
        historicalExposureCount += 1;
      }
    });

    // 1. New Strength Ceiling
    if (historicalExposureCount >= 1 && todayBestE1RM > 0) {
      const roundedTodayE1RM = Math.round(todayBestE1RM * 10) / 10;
      const roundedPastE1RM = Math.round(pastMaxE1RM * 10) / 10;
      if (roundedTodayE1RM > roundedPastE1RM) {
        newStrengthCeilingExercises.add(normName);
        candidates.push({
          id: 'new_strength_ceiling',
          label: INSIGHT_META.new_strength_ceiling.label,
          explanation: `You established an all-time personal best estimated 1RM on ${originalName}.`,
          domain: INSIGHT_META.new_strength_ceiling.domain,
          tone: INSIGHT_META.new_strength_ceiling.tone,
          priority: INSIGHT_PRIORITY.new_strength_ceiling,
          exerciseName: originalName,
          numericEvidence: {
            todayBestE1RM: roundedTodayE1RM,
            previousMaxE1RM: roundedPastE1RM,
          },
        });
      }
    }

    // 2. Load PR
    if (historicalExposureCount >= 1 && todayMaxWeightKg > 0) {
      const quantTodayWeight = Math.round(todayMaxWeightKg * 100) / 100;
      const quantPastWeight = Math.round(pastMaxWeightKg * 100) / 100;
      if (quantTodayWeight > quantPastWeight) {
        candidates.push({
          id: 'load_pr',
          label: INSIGHT_META.load_pr.label,
          explanation: `Heaviest absolute external weight you have recorded on ${originalName}.`,
          domain: INSIGHT_META.load_pr.domain,
          tone: INSIGHT_META.load_pr.tone,
          priority: INSIGHT_PRIORITY.load_pr,
          exerciseName: originalName,
          numericEvidence: {
            todayMaxWeightKg: quantTodayWeight,
            previousMaxWeightKg: quantPastWeight,
          },
        });
      }
    }

    // 3. Rep PR
    todayExactRepsByWeightKg.forEach((todayReps, loadKey) => {
      if (pastExactMaxRepsByWeightKg.has(loadKey)) {
        const pastReps = pastExactMaxRepsByWeightKg.get(loadKey)!;
        if (todayReps > pastReps) {
          candidates.push({
            id: 'rep_pr',
            label: INSIGHT_META.rep_pr.label,
            explanation: `Most repetitions you have performed on ${originalName} at this exact weight.`,
            domain: INSIGHT_META.rep_pr.domain,
            tone: INSIGHT_META.rep_pr.tone,
            priority: INSIGHT_PRIORITY.rep_pr,
            exerciseName: originalName,
            numericEvidence: {
              loadKg: loadKey,
              todayReps,
              previousReps: pastReps,
            },
          });
        }
      }
    });

    // 4. Exercise Tonnage PR
    const todayTonnageKg = calculateExerciseTonnageKg(exercise, targetLog.unit, targetLog.bodyweightSnapshot);
    if (todayTonnageKg > 0) {
      let pastSessionCount = 0;
      let pastMaxTonnageKg = 0;

      precedingLogs.forEach(pastLog => {
        pastLog.exercises.forEach(pastEx => {
          if (pastEx.isSkipped === true) return;
          if (normalizeExerciseName(pastEx.name) !== normName) return;
          const t = calculateExerciseTonnageKg(pastEx, pastLog.unit, pastLog.bodyweightSnapshot);
          if (t > 0) {
            pastSessionCount += 1;
            if (t > pastMaxTonnageKg) {
              pastMaxTonnageKg = t;
            }
          }
        });
      });

      if (pastSessionCount >= 2) {
        const roundedTodayTonnage = Math.round(todayTonnageKg * 10) / 10;
        const roundedPastTonnage = Math.round(pastMaxTonnageKg * 10) / 10;
        if (roundedTodayTonnage > roundedPastTonnage) {
          candidates.push({
            id: 'exercise_tonnage_pr',
            label: INSIGHT_META.exercise_tonnage_pr.label,
            explanation: `Highest total weight-volume recorded on ${originalName} in a single session.`,
            domain: INSIGHT_META.exercise_tonnage_pr.domain,
            tone: INSIGHT_META.exercise_tonnage_pr.tone,
            priority: INSIGHT_PRIORITY.exercise_tonnage_pr,
            exerciseName: originalName,
            numericEvidence: {
              todayTonnageKg: roundedTodayTonnage,
              previousMaxTonnageKg: roundedPastTonnage,
            },
          });
        }
      }
    }
  });

  // --- Insight 5: Quiet Progress ---
  const todayDateEpoch = isValidDate(targetLog.date) ? Date.parse(targetLog.date) : null;

  performanceExercisesToday.forEach(({ originalName, exercise }, normName) => {
    if (newStrengthCeilingExercises.has(normName)) return;

    let todayBestE1RM = 0;
    exercise.sets.forEach(set => {
      const ev = resolvePerformanceSetEvidence(exercise, set, targetLog.unit, targetLog.bodyweightSnapshot);
      if (ev.status === 'valid' && ev.e1rmKg !== null && ev.e1rmKg > todayBestE1RM) {
        todayBestE1RM = ev.e1rmKg;
      }
    });

    if (todayBestE1RM <= 0 || todayDateEpoch === null) return;

    const past28DayExposures: number[] = [];

    precedingLogs.forEach(pastLog => {
      if (!isValidDate(pastLog.date)) return;
      const pastEpoch = Date.parse(pastLog.date);
      const daysDiff = (todayDateEpoch - pastEpoch) / (1000 * 60 * 60 * 24);
      if (daysDiff < 0 || daysDiff > 28) return;

      let pastBest = 0;
      pastLog.exercises.forEach(pastEx => {
        if (pastEx.isSkipped === true) return;
        if (normalizeExerciseName(pastEx.name) !== normName) return;
        const mod = pastEx.modality || 'weighted';
        if (mod !== 'weighted' && mod !== 'bodyweight' && mod !== 'assisted') return;

        pastEx.sets.forEach(set => {
          const pastEv = resolvePerformanceSetEvidence(pastEx, set, pastLog.unit, pastLog.bodyweightSnapshot);
          if (pastEv.status === 'valid' && pastEv.e1rmKg !== null && pastEv.e1rmKg > pastBest) {
            pastBest = pastEv.e1rmKg;
          }
        });
      });

      if (pastBest > 0) {
        past28DayExposures.push(pastBest);
      }
    });

    if (past28DayExposures.length >= 3) {
      const last3 = past28DayExposures.slice(-3).sort((a, b) => a - b);
      const medianBaseline = last3[1];
      if (medianBaseline > 0 && todayBestE1RM >= 1.025 * medianBaseline) {
        candidates.push({
          id: 'quiet_progress',
          label: INSIGHT_META.quiet_progress.label,
          explanation: `Exercise performance on ${originalName} exceeded your recent 4-week rolling average without setting an all-time PR.`,
          domain: INSIGHT_META.quiet_progress.domain,
          tone: INSIGHT_META.quiet_progress.tone,
          priority: INSIGHT_PRIORITY.quiet_progress,
          exerciseName: originalName,
          numericEvidence: {
            todayBestE1RM: Math.round(todayBestE1RM * 10) / 10,
            rollingMedianE1RM: Math.round(medianBaseline * 10) / 10,
          },
        });
      }
    }
  });

  // --- Insight 6: Back in Action ---
  let hasExplicitlyCompletedSet = false;
  targetLog.exercises.forEach(ex => {
    if (ex.isSkipped === true) return;
    ex.sets.forEach(set => {
      if (set.isCompleted === true && set.isSkipped !== true) {
        hasExplicitlyCompletedSet = true;
      }
    });
  });

  if (hasExplicitlyCompletedSet && isValidDate(targetLog.date)) {
    const validPrecedingLogs = precedingLogs.filter(l => isValidDate(l.date));
    if (validPrecedingLogs.length > 0) {
      const lastLog = validPrecedingLogs[validPrecedingLogs.length - 1];
      const gapDays =
        (Date.parse(targetLog.date) - Date.parse(lastLog.date)) /
        (1000 * 60 * 60 * 24);
      if (gapDays >= 14) {
        candidates.push({
          id: 'back_in_action',
          label: INSIGHT_META.back_in_action.label,
          explanation: 'First completed workout recorded after a gap of 14 or more days.',
          domain: INSIGHT_META.back_in_action.domain,
          tone: INSIGHT_META.back_in_action.tone,
          priority: INSIGHT_PRIORITY.back_in_action,
          numericEvidence: {
            gapDays: Math.round(gapDays),
          },
        });
      }
    }
  }

  // --- Insight 7: Heavy Exposure ---
  let qualifyingHeavySetsCount = 0;
  targetLog.exercises.forEach(ex => {
    if (ex.isSkipped === true) return;
    const mod = ex.modality || 'weighted';
    if (mod !== 'weighted' && mod !== 'bodyweight' && mod !== 'assisted') return;
    const normName = normalizeExerciseName(ex.name);
    if (!normName) return;

    const historicalExposures: number[] = [];
    precedingLogs.forEach(pastLog => {
      let pastBest = 0;
      pastLog.exercises.forEach(pastEx => {
        if (pastEx.isSkipped === true) return;
        if (normalizeExerciseName(pastEx.name) !== normName) return;
        const pMod = pastEx.modality || 'weighted';
        if (pMod !== 'weighted' && pMod !== 'bodyweight' && pMod !== 'assisted') return;

        pastEx.sets.forEach(set => {
          const pastEv = resolvePerformanceSetEvidence(pastEx, set, pastLog.unit, pastLog.bodyweightSnapshot);
          if (pastEv.status === 'valid' && pastEv.e1rmKg !== null && pastEv.e1rmKg > pastBest) {
            pastBest = pastEv.e1rmKg;
          }
        });
      });
      if (pastBest > 0) historicalExposures.push(pastBest);
    });

    if (historicalExposures.length >= 3) {
      const last3 = historicalExposures.slice(-3).sort((a, b) => a - b);
      const baselineE1RM = last3[1];
      if (baselineE1RM > 0) {
        ex.sets.forEach(set => {
          const ev = resolvePerformanceSetEvidence(ex, set, targetLog.unit, targetLog.bodyweightSnapshot);
          if (ev.status === 'valid' && ev.effectiveLoadKg !== null) {
            if (set.reps! <= 5 && ev.effectiveLoadKg / baselineE1RM >= 0.85) {
              qualifyingHeavySetsCount += 1;
            }
          }
        });
      }
    }
  });

  if (qualifyingHeavySetsCount >= 3) {
    candidates.push({
      id: 'heavy_exposure',
      label: INSIGHT_META.heavy_exposure.label,
      explanation: 'Recorded multiple working sets at or above 85% of your estimated 1RM.',
      domain: INSIGHT_META.heavy_exposure.domain,
      tone: INSIGHT_META.heavy_exposure.tone,
      priority: INSIGHT_PRIORITY.heavy_exposure,
      numericEvidence: {
        heavySetsCount: qualifyingHeavySetsCount,
      },
    });
  }

  // --- Insight 8: Consistent Output & Insight 9: Steep Fatigue Drop ---
  targetLog.exercises.forEach(ex => {
    if (ex.isSkipped === true) return;
    const mod = ex.modality || 'weighted';
    if (mod !== 'weighted' && mod !== 'bodyweight' && mod !== 'assisted') return;

    const contiguousBlocks: Array<Array<{ weightKg: number; reps: number; rpe: number; e1rm: number }>> = [];
    let currentBlock: Array<{ weightKg: number; reps: number; rpe: number; e1rm: number }> = [];
    let currentBlockQuantLoad: number | null = null;

    ex.sets.forEach(set => {
      const ev = resolvePerformanceSetEvidence(ex, set, targetLog.unit, targetLog.bodyweightSnapshot);
      const isEligible =
        ev.status === 'valid' &&
        ev.effectiveLoadKg !== null &&
        ev.e1rmKg !== null &&
        set.isDropSet !== true;

      if (!isEligible) {
        if (currentBlock.length >= 3) {
          contiguousBlocks.push(currentBlock);
        }
        currentBlock = [];
        currentBlockQuantLoad = null;
        return;
      }

      const weightKg = ev.effectiveLoadKg!;
      const quantLoad = Math.round(weightKg * 100) / 100;
      const e1rm = ev.e1rmKg!;

      if (currentBlockQuantLoad === null) {
        currentBlockQuantLoad = quantLoad;
        currentBlock.push({ weightKg, reps: set.reps!, rpe: set.rpe!, e1rm });
      } else if (currentBlockQuantLoad === quantLoad) {
        currentBlock.push({ weightKg, reps: set.reps!, rpe: set.rpe!, e1rm });
      } else {
        if (currentBlock.length >= 3) {
          contiguousBlocks.push(currentBlock);
        }
        currentBlock = [{ weightKg, reps: set.reps!, rpe: set.rpe!, e1rm }];
        currentBlockQuantLoad = quantLoad;
      }
    });

    if (currentBlock.length >= 3) {
      contiguousBlocks.push(currentBlock);
    }

    const normName = normalizeExerciseName(ex.name);

    contiguousBlocks.forEach(block => {
      const e1rms = block.map(b => b.e1rm);
      const mean = e1rms.reduce((sum, v) => sum + v, 0) / e1rms.length;
      const variance =
        e1rms.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / e1rms.length;
      const stdDev = Math.sqrt(variance);
      const cv = mean > 0 ? stdDev / mean : 1;

      const firstSet = block[0];
      const lastSet = block[block.length - 1];

      // Check Steep Fatigue Drop
      if (lastSet.e1rm < 0.88 * firstSet.e1rm && lastSet.rpe >= firstSet.rpe) {
        steepFatigueDropExercises.add(normName);
        candidates.push({
          id: 'steep_fatigue_drop',
          label: INSIGHT_META.steep_fatigue_drop.label,
          explanation: `Estimated performance declined by over 12% across straight working sets on ${ex.name}.`,
          domain: INSIGHT_META.steep_fatigue_drop.domain,
          tone: INSIGHT_META.steep_fatigue_drop.tone,
          priority: INSIGHT_PRIORITY.steep_fatigue_drop,
          exerciseName: ex.name,
          numericEvidence: {
            firstSetE1RM: Math.round(firstSet.e1rm * 10) / 10,
            lastSetE1RM: Math.round(lastSet.e1rm * 10) / 10,
            dropPercentage: Math.round(((firstSet.e1rm - lastSet.e1rm) / firstSet.e1rm) * 100),
          },
        });
      } else if (cv < 0.025 && !steepFatigueDropExercises.has(normName) && !consistentOutputExercises.has(normName)) {
        // Consistent Output
        consistentOutputExercises.add(normName);
        candidates.push({
          id: 'consistent_output',
          label: INSIGHT_META.consistent_output.label,
          explanation: `Estimated performance remained within 2.5% across 3 or more working sets on ${ex.name}.`,
          domain: INSIGHT_META.consistent_output.domain,
          tone: INSIGHT_META.consistent_output.tone,
          priority: INSIGHT_PRIORITY.consistent_output,
          exerciseName: ex.name,
          numericEvidence: {
            coefficientOfVariation: Math.round(cv * 1000) / 1000,
          },
        });
      }
    });
  });

  // --- Insight 10: Recovery Strain & Insight 13: Against the Odds ---
  const sessionPerfIndex = calculateSessionPerformanceIndex(targetLog, allLogs);

  const recovery = targetLog.recovery;
  const sleepHours = recovery && typeof recovery.sleepHours === 'number' && Number.isFinite(recovery.sleepHours)
    ? recovery.sleepHours
    : null;
  const soreness = recovery && typeof recovery.soreness === 'number' && Number.isFinite(recovery.soreness)
    ? recovery.soreness
    : null;

  // Verified 1-to-10 scale check (must be integer between 1 and 10)
  const isSoreness1to10 = soreness !== null && soreness >= 1 && soreness <= 10;
  const isLowSleepOrHighSoreness =
    (sleepHours !== null && sleepHours <= 5.5) ||
    (isSoreness1to10 && soreness >= 7);

  if (sessionPerfIndex !== null && isLowSleepOrHighSoreness) {
    if (sessionPerfIndex < 0.96) {
      candidates.push({
        id: 'recovery_strain',
        label: INSIGHT_META.recovery_strain.label,
        explanation: 'Lower exercise-matched output coincided with low reported sleep or elevated soreness.',
        domain: INSIGHT_META.recovery_strain.domain,
        tone: INSIGHT_META.recovery_strain.tone,
        priority: INSIGHT_PRIORITY.recovery_strain,
        numericEvidence: {
          sessionPerformanceIndex: Math.round(sessionPerfIndex * 1000) / 1000,
          ...(sleepHours !== null ? { sleepHours } : {}),
          ...(soreness !== null ? { soreness } : {}),
        },
      });
    } else if (sessionPerfIndex >= 1.00) {
      candidates.push({
        id: 'against_the_odds',
        label: INSIGHT_META.against_the_odds.label,
        explanation: 'Matched or exceeded recent exercise performance alongside low reported sleep or elevated soreness.',
        domain: INSIGHT_META.against_the_odds.domain,
        tone: INSIGHT_META.against_the_odds.tone,
        priority: INSIGHT_PRIORITY.against_the_odds,
        numericEvidence: {
          sessionPerformanceIndex: Math.round(sessionPerfIndex * 1000) / 1000,
          ...(sleepHours !== null ? { sleepHours } : {}),
          ...(soreness !== null ? { soreness } : {}),
        },
      });
    }
  }

  // --- Insight 11: Form Drift ---
  targetLog.exercises.forEach(ex => {
    if (ex.isSkipped === true) return;
    const completedSets = ex.sets.filter(
      s => s.isCompleted === true && s.isSkipped !== true && s.isWarmup !== true
    );
    if (completedSets.length < 3) return;

    const firstSetForm = completedSets[0].form;
    if (firstSetForm === 'strict' || firstSetForm === 'standard' || firstSetForm === null || firstSetForm === undefined) {
      let laterLooseCount = 0;
      for (let i = 1; i < completedSets.length; i++) {
        if (completedSets[i].form === 'loose') {
          laterLooseCount += 1;
        }
      }
      if (laterLooseCount >= 2) {
        candidates.push({
          id: 'form_drift',
          label: INSIGHT_META.form_drift.label,
          explanation: 'Later working sets were logged with looser form.',
          domain: INSIGHT_META.form_drift.domain,
          tone: INSIGHT_META.form_drift.tone,
          priority: INSIGHT_PRIORITY.form_drift,
          exerciseName: ex.name,
        });
      }
    }
  });

  // --- Insight 12: High Exertion ---
  let highExertionSetsCount = 0;
  targetLog.exercises.forEach(ex => {
    if (ex.isSkipped === true) return;
    const mod = ex.modality || 'weighted';
    if (mod !== 'weighted' && mod !== 'bodyweight') return;

    ex.sets.forEach(set => {
      if (set.isCompleted !== true || set.isSkipped === true || set.isWarmup === true) return;
      if (set.rpe !== null && set.rpe !== undefined && isValidRPE(set.rpe) && set.rpe >= 9.0) {
        highExertionSetsCount += 1;
      }
    });
  });

  if (highExertionSetsCount >= 3) {
    candidates.push({
      id: 'high_exertion',
      label: INSIGHT_META.high_exertion.label,
      explanation: 'Recorded 3 or more working sets within 1 repetition of failure (RPE 9.0 to 10.0).',
      domain: INSIGHT_META.high_exertion.domain,
      tone: INSIGHT_META.high_exertion.tone,
      priority: INSIGHT_PRIORITY.high_exertion,
      numericEvidence: {
        highExertionSetsCount,
      },
    });
  }

  // --- Insight 14: Muscle Focus ---
  let totalExplicitWorkingSets = 0;
  const setsByMuscleGroup = new Map<string, { count: number; originalSpelling: string }>();

  targetLog.exercises.forEach(ex => {
    if (ex.isSkipped === true) return;
    ex.sets.forEach(set => {
      if (set.isCompleted !== true || set.isSkipped === true || set.isWarmup === true) return;
      totalExplicitWorkingSets += 1;

      if (ex.muscleGroup && ex.muscleGroup.trim().length > 0) {
        const norm = ex.muscleGroup.trim().toLowerCase();
        const existing = setsByMuscleGroup.get(norm);
        if (existing) {
          existing.count += 1;
        } else {
          setsByMuscleGroup.set(norm, { count: 1, originalSpelling: ex.muscleGroup.trim() });
        }
      }
    });
  });

  if (totalExplicitWorkingSets >= 6) {
    let labeledSets = 0;
    setsByMuscleGroup.forEach(g => {
      labeledSets += g.count;
    });

    if (labeledSets / totalExplicitWorkingSets >= 0.8) {
      setsByMuscleGroup.forEach(({ count, originalSpelling }) => {
        if (count / labeledSets >= 0.6) {
          candidates.push({
            id: 'muscle_focus',
            label: INSIGHT_META.muscle_focus.label,
            explanation: `Over 60% of today's working sets were recorded for ${originalSpelling}.`,
            domain: INSIGHT_META.muscle_focus.domain,
            tone: INSIGHT_META.muscle_focus.tone,
            priority: INSIGHT_PRIORITY.muscle_focus,
            muscleGroup: originalSpelling,
            numericEvidence: {
              muscleGroupSets: count,
              totalWorkingSets: totalExplicitWorkingSets,
            },
          });
        }
      });
    }
  }

  // --- Insight 15: Minimalist Session ---
  let totalCompletedWorkingSetsAll = 0;
  targetLog.exercises.forEach(ex => {
    if (ex.isSkipped === true) return;
    ex.sets.forEach(set => {
      if (set.isCompleted === true && set.isSkipped !== true && set.isWarmup !== true) {
        totalCompletedWorkingSetsAll += 1;
      }
    });
  });

  if (totalCompletedWorkingSetsAll >= 3 && totalCompletedWorkingSetsAll <= 6) {
    candidates.push({
      id: 'minimalist_session',
      label: INSIGHT_META.minimalist_session.label,
      explanation: 'Completed between 3 and 6 total working sets.',
      domain: INSIGHT_META.minimalist_session.domain,
      tone: INSIGHT_META.minimalist_session.tone,
      priority: INSIGHT_PRIORITY.minimalist_session,
      numericEvidence: {
        totalWorkingSets: totalCompletedWorkingSetsAll,
      },
    });
  }

  // --- Insight 16: Compound Dominant ---
  let resistanceSetsWithCategory = 0;
  let compoundSetsCount = 0;
  let totalExplicitResistanceWorkingSets = 0;

  targetLog.exercises.forEach(ex => {
    if (ex.isSkipped === true) return;
    const mod = ex.modality || 'weighted';
    if (mod !== 'weighted' && mod !== 'bodyweight') return;

    ex.sets.forEach(set => {
      if (set.isCompleted !== true || set.isSkipped === true || set.isWarmup === true) return;
      totalExplicitResistanceWorkingSets += 1;
      if (ex.movementCategory) {
        resistanceSetsWithCategory += 1;
        if (ex.movementCategory === 'compound') {
          compoundSetsCount += 1;
        }
      }
    });
  });

  if (
    totalExplicitResistanceWorkingSets >= 5 &&
    resistanceSetsWithCategory / totalExplicitResistanceWorkingSets >= 0.8 &&
    compoundSetsCount / resistanceSetsWithCategory >= 0.7
  ) {
    candidates.push({
      id: 'compound_dominant',
      label: INSIGHT_META.compound_dominant.label,
      explanation: "Over 70% of today's working sets were multi-joint compound movements.",
      domain: INSIGHT_META.compound_dominant.domain,
      tone: INSIGHT_META.compound_dominant.tone,
      priority: INSIGHT_PRIORITY.compound_dominant,
      numericEvidence: {
        compoundSets: compoundSetsCount,
        totalResistanceSets: totalExplicitResistanceWorkingSets,
      },
    });
  }

  return candidates;
}

/**
 * Calculates rarity for an insight ID based strictly on preceding workout logs.
 */
function calculateRarity(
  insightId: DiaryInsightId,
  precedingLogs: WorkoutLog[],
  allLogs: WorkoutLog[]
): DiaryRarity {
  if (precedingLogs.length === 0) {
    return null;
  }

  let priorOccurrenceCount = 0;

  precedingLogs.forEach(pastLog => {
    const pastRawInsights = evaluateRawInsights(pastLog, allLogs);
    if (pastRawInsights.some(ins => ins.id === insightId)) {
      priorOccurrenceCount += 1;
    }
  });

  if (priorOccurrenceCount === 0) {
    return 'personal_first';
  }

  if (precedingLogs.length < 20) {
    return null;
  }

  const rate = priorOccurrenceCount / precedingLogs.length;
  if (rate < 0.05) {
    return 'rare';
  }
  if (rate <= 0.2) {
    return 'notable';
  }
  return 'common';
}

/**
 * Generates all earned Diary insights for a target workout.
 */
export function generateDiaryInsights(
  targetLog: WorkoutLog,
  allLogs: WorkoutLog[]
): DiaryInsightResult[] {
  const precedingLogs = getStrictlyPrecedingLogs(targetLog, allLogs);
  const rawInsights = evaluateRawInsights(targetLog, allLogs);

  const results: DiaryInsightResult[] = rawInsights.map(candidate => {
    const rarity = calculateRarity(candidate.id, precedingLogs, allLogs);
    return {
      ...candidate,
      rarity,
    };
  });

  results.sort((a, b) => a.priority - b.priority);

  return results;
}

/**
 * Generates the full Diary Scorecard for a target workout.
 */
export function generateDiaryScorecard(
  targetLog: WorkoutLog,
  allLogs: WorkoutLog[]
): DiaryScorecardResult {
  const primaryCategory = classifyDiaryWorkout(targetLog);
  const insights = generateDiaryInsights(targetLog, allLogs);
  const precedingLogs = getStrictlyPrecedingLogs(targetLog, allLogs);
  const sessionPerformanceIndex = calculateSessionPerformanceIndex(targetLog, allLogs);

  const collapsedInsights = insights.slice(0, 2);
  const overflowInsightCount = Math.max(0, insights.length - collapsedInsights.length);

  const hasSufficientPerformanceHistory = precedingLogs.length >= 2;

  return {
    primaryCategory,
    insights,
    collapsedInsights,
    overflowInsightCount,
    hasSufficientPerformanceHistory,
    sessionPerformanceIndex,
  };
}

/**
 * Historical index maintained incrementally during chronological batch processing.
 */
interface BatchHistoricalIndex {
  validPrecedingLogs: WorkoutLog[];
  lastValidDateEpoch: number | null;
  insightOccurrenceCounts: Map<DiaryInsightId, number>;
  // Exercise performance index map: normName -> list of exposure best E1RMs in chronological order
  exerciseExposureE1RMs: Map<string, number[]>;
  // Exercise all-time bests
  exerciseMaxE1RM: Map<string, number>;
  exerciseMaxWeightKg: Map<string, number>;
  exerciseExactMaxRepsByWeightKg: Map<string, Map<number, number>>;
  exerciseTonnageHistory: Map<string, number[]>; // list of non-zero session tonnages
  exerciseMaxTonnageKg: Map<string, number>;
  // 28-day rolling exposures: normName -> list of { dateEpoch: number, bestE1RM: number }
  exerciseDateExposures: Map<string, Array<{ dateEpoch: number; bestE1RM: number }>>;
}

function createEmptyBatchHistoricalIndex(): BatchHistoricalIndex {
  return {
    validPrecedingLogs: [],
    lastValidDateEpoch: null,
    insightOccurrenceCounts: new Map<DiaryInsightId, number>(),
    exerciseExposureE1RMs: new Map<string, number[]>(),
    exerciseMaxE1RM: new Map<string, number>(),
    exerciseMaxWeightKg: new Map<string, number>(),
    exerciseExactMaxRepsByWeightKg: new Map<string, Map<number, number>>(),
    exerciseTonnageHistory: new Map<string, number[]>(),
    exerciseMaxTonnageKg: new Map<string, number>(),
    exerciseDateExposures: new Map<string, Array<{ dateEpoch: number; bestE1RM: number }>>(),
  };
}

/**
 * Evaluates session performance index against accumulated historical indexes.
 */
function calculateBatchSessionPerformanceIndex(
  targetLog: WorkoutLog,
  history: BatchHistoricalIndex
): number | null {
  const targetExercises = new Map<string, { todayBestE1RM: number; isMain: boolean }>();

  targetLog.exercises.forEach(ex => {
    if (ex.isSkipped === true) return;
    const mod = ex.modality || 'weighted';
    if (mod !== 'weighted' && mod !== 'bodyweight' && mod !== 'assisted') return;

    const normName = normalizeExerciseName(ex.name);
    if (!normName) return;

    let bestE1RM = 0;
    ex.sets.forEach(set => {
      const ev = resolvePerformanceSetEvidence(ex, set, targetLog.unit, targetLog.bodyweightSnapshot);
      if (ev.status === 'valid' && ev.e1rmKg !== null && ev.e1rmKg > bestE1RM) {
        bestE1RM = ev.e1rmKg;
      }
    });

    if (bestE1RM > 0) {
      const existing = targetExercises.get(normName);
      if (!existing || bestE1RM > existing.todayBestE1RM) {
        targetExercises.set(normName, {
          todayBestE1RM: bestE1RM,
          isMain: ex.isMainMovement === true,
        });
      }
    }
  });

  if (targetExercises.size === 0) return null;

  const exerciseRatios: number[] = [];
  let singleMainEligible = false;

  targetExercises.forEach(({ todayBestE1RM, isMain }, normName) => {
    const historicalExposureE1RMs = history.exerciseExposureE1RMs.get(normName) || [];

    if (targetExercises.size === 1 && isMain) {
      if (historicalExposureE1RMs.length >= 3) {
        const last3 = historicalExposureE1RMs.slice(-3).sort((a, b) => a - b);
        const baseline = last3[1];
        if (baseline > 0) {
          exerciseRatios.push(todayBestE1RM / baseline);
          singleMainEligible = true;
        }
      }
    } else {
      if (historicalExposureE1RMs.length >= 2) {
        const last3 = historicalExposureE1RMs.slice(-3).sort((a, b) => a - b);
        const baseline =
          last3.length === 2
            ? (last3[0] + last3[1]) / 2
            : last3[1];
        if (baseline > 0) {
          exerciseRatios.push(todayBestE1RM / baseline);
        }
      }
    }
  });

  if (targetExercises.size === 1) {
    if (!singleMainEligible || exerciseRatios.length === 0) return null;
    return exerciseRatios[0];
  }

  if (exerciseRatios.length < 2) {
    return null;
  }

  exerciseRatios.sort((a, b) => a - b);
  const mid = Math.floor(exerciseRatios.length / 2);
  const medianRatio =
    exerciseRatios.length % 2 !== 0
      ? exerciseRatios[mid]
      : (exerciseRatios[mid - 1] + exerciseRatios[mid]) / 2;

  return medianRatio;
}

/**
 * Evaluates raw insights for a target log against the current accumulated historical index.
 */
function evaluateBatchRawInsights(
  targetLog: WorkoutLog,
  history: BatchHistoricalIndex
): RawInsightCandidate[] {
  const candidates: RawInsightCandidate[] = [];

  const newStrengthCeilingExercises = new Set<string>();
  const consistentOutputExercises = new Set<string>();
  const steepFatigueDropExercises = new Set<string>();

  const performanceExercisesToday = new Map<
    string,
    { originalName: string; exercise: ExerciseEntry }
  >();

  targetLog.exercises.forEach(ex => {
    if (ex.isSkipped === true) return;
    const mod = ex.modality || 'weighted';
    if (mod !== 'weighted' && mod !== 'bodyweight' && mod !== 'assisted') return;
    const norm = normalizeExerciseName(ex.name);
    if (!norm) return;
    if (!performanceExercisesToday.has(norm)) {
      performanceExercisesToday.set(norm, { originalName: ex.name, exercise: ex });
    }
  });

  // --- Insight 1: New Strength Ceiling & Insight 2: Load PR & Insight 3: Rep PR & Insight 4: Tonnage PR ---
  performanceExercisesToday.forEach(({ originalName, exercise }, normName) => {
    let todayBestE1RM = 0;
    let todayMaxWeightKg = 0;
    const todayExactRepsByWeightKg = new Map<number, number>();

    exercise.sets.forEach(set => {
      const ev = resolvePerformanceSetEvidence(exercise, set, targetLog.unit, targetLog.bodyweightSnapshot);
      if (ev.status !== 'valid' || ev.effectiveLoadKg === null || ev.e1rmKg === null) return;

      if (ev.e1rmKg > todayBestE1RM) {
        todayBestE1RM = ev.e1rmKg;
      }
      if (ev.effectiveLoadKg > todayMaxWeightKg) {
        todayMaxWeightKg = ev.effectiveLoadKg;
      }

      const quantizedLoad = Math.round(ev.effectiveLoadKg * 100) / 100;
      const currentReps = todayExactRepsByWeightKg.get(quantizedLoad) || 0;
      if (set.reps! > currentReps) {
        todayExactRepsByWeightKg.set(quantizedLoad, set.reps!);
      }
    });

    const historicalExposureCount = (history.exerciseExposureE1RMs.get(normName) || []).length;
    const pastMaxE1RM = history.exerciseMaxE1RM.get(normName) || 0;
    const pastMaxWeightKg = history.exerciseMaxWeightKg.get(normName) || 0;
    const pastExactMaxRepsByWeightKg =
      history.exerciseExactMaxRepsByWeightKg.get(normName) || new Map<number, number>();

    // 1. New Strength Ceiling
    if (historicalExposureCount >= 1 && todayBestE1RM > 0) {
      const roundedTodayE1RM = Math.round(todayBestE1RM * 10) / 10;
      const roundedPastE1RM = Math.round(pastMaxE1RM * 10) / 10;
      if (roundedTodayE1RM > roundedPastE1RM) {
        newStrengthCeilingExercises.add(normName);
        candidates.push({
          id: 'new_strength_ceiling',
          label: INSIGHT_META.new_strength_ceiling.label,
          explanation: `You established an all-time personal best estimated 1RM on ${originalName}.`,
          domain: INSIGHT_META.new_strength_ceiling.domain,
          tone: INSIGHT_META.new_strength_ceiling.tone,
          priority: INSIGHT_PRIORITY.new_strength_ceiling,
          exerciseName: originalName,
          numericEvidence: {
            todayBestE1RM: roundedTodayE1RM,
            previousMaxE1RM: roundedPastE1RM,
          },
        });
      }
    }

    // 2. Load PR
    if (historicalExposureCount >= 1 && todayMaxWeightKg > 0) {
      const quantTodayWeight = Math.round(todayMaxWeightKg * 100) / 100;
      const quantPastWeight = Math.round(pastMaxWeightKg * 100) / 100;
      if (quantTodayWeight > quantPastWeight) {
        candidates.push({
          id: 'load_pr',
          label: INSIGHT_META.load_pr.label,
          explanation: `Heaviest absolute external weight you have recorded on ${originalName}.`,
          domain: INSIGHT_META.load_pr.domain,
          tone: INSIGHT_META.load_pr.tone,
          priority: INSIGHT_PRIORITY.load_pr,
          exerciseName: originalName,
          numericEvidence: {
            todayMaxWeightKg: quantTodayWeight,
            previousMaxWeightKg: quantPastWeight,
          },
        });
      }
    }

    // 3. Rep PR
    todayExactRepsByWeightKg.forEach((todayReps, loadKey) => {
      if (pastExactMaxRepsByWeightKg.has(loadKey)) {
        const pastReps = pastExactMaxRepsByWeightKg.get(loadKey)!;
        if (todayReps > pastReps) {
          candidates.push({
            id: 'rep_pr',
            label: INSIGHT_META.rep_pr.label,
            explanation: `Most repetitions you have performed on ${originalName} at this exact weight.`,
            domain: INSIGHT_META.rep_pr.domain,
            tone: INSIGHT_META.rep_pr.tone,
            priority: INSIGHT_PRIORITY.rep_pr,
            exerciseName: originalName,
            numericEvidence: {
              loadKg: loadKey,
              todayReps,
              previousReps: pastReps,
            },
          });
        }
      }
    });

    // 4. Exercise Tonnage PR
    const todayTonnageKg = calculateExerciseTonnageKg(exercise, targetLog.unit, targetLog.bodyweightSnapshot);
    if (todayTonnageKg > 0) {
      const pastTonnages = history.exerciseTonnageHistory.get(normName) || [];
      const pastSessionCount = pastTonnages.length;
      const pastMaxTonnageKg = history.exerciseMaxTonnageKg.get(normName) || 0;

      if (pastSessionCount >= 2) {
        const roundedTodayTonnage = Math.round(todayTonnageKg * 10) / 10;
        const roundedPastTonnage = Math.round(pastMaxTonnageKg * 10) / 10;
        if (roundedTodayTonnage > roundedPastTonnage) {
          candidates.push({
            id: 'exercise_tonnage_pr',
            label: INSIGHT_META.exercise_tonnage_pr.label,
            explanation: `Highest total weight-volume recorded on ${originalName} in a single session.`,
            domain: INSIGHT_META.exercise_tonnage_pr.domain,
            tone: INSIGHT_META.exercise_tonnage_pr.tone,
            priority: INSIGHT_PRIORITY.exercise_tonnage_pr,
            exerciseName: originalName,
            numericEvidence: {
              todayTonnageKg: roundedTodayTonnage,
              previousMaxTonnageKg: roundedPastTonnage,
            },
          });
        }
      }
    }
  });

  // --- Insight 5: Quiet Progress ---
  const todayDateEpoch = isValidDate(targetLog.date) ? Date.parse(targetLog.date) : null;

  performanceExercisesToday.forEach(({ originalName, exercise }, normName) => {
    if (newStrengthCeilingExercises.has(normName)) return;

    let todayBestE1RM = 0;
    exercise.sets.forEach(set => {
      const ev = resolvePerformanceSetEvidence(exercise, set, targetLog.unit, targetLog.bodyweightSnapshot);
      if (ev.status === 'valid' && ev.e1rmKg !== null && ev.e1rmKg > todayBestE1RM) {
        todayBestE1RM = ev.e1rmKg;
      }
    });

    if (todayBestE1RM <= 0 || todayDateEpoch === null) return;

    const dateExposures = history.exerciseDateExposures.get(normName) || [];
    const past28DayExposures: number[] = [];

    for (let i = 0; i < dateExposures.length; i++) {
      const exp = dateExposures[i];
      const daysDiff = (todayDateEpoch - exp.dateEpoch) / (1000 * 60 * 60 * 24);
      if (daysDiff >= 0 && daysDiff <= 28) {
        past28DayExposures.push(exp.bestE1RM);
      }
    }

    if (past28DayExposures.length >= 3) {
      const last3 = past28DayExposures.slice(-3).sort((a, b) => a - b);
      const medianBaseline = last3[1];
      if (medianBaseline > 0 && todayBestE1RM >= 1.025 * medianBaseline) {
        candidates.push({
          id: 'quiet_progress',
          label: INSIGHT_META.quiet_progress.label,
          explanation: `Exercise performance on ${originalName} exceeded your recent 4-week rolling average without setting an all-time PR.`,
          domain: INSIGHT_META.quiet_progress.domain,
          tone: INSIGHT_META.quiet_progress.tone,
          priority: INSIGHT_PRIORITY.quiet_progress,
          exerciseName: originalName,
          numericEvidence: {
            todayBestE1RM: Math.round(todayBestE1RM * 10) / 10,
            rollingMedianE1RM: Math.round(medianBaseline * 10) / 10,
          },
        });
      }
    }
  });

  // --- Insight 6: Back in Action ---
  let hasExplicitlyCompletedSet = false;
  targetLog.exercises.forEach(ex => {
    if (ex.isSkipped === true) return;
    ex.sets.forEach(set => {
      if (set.isCompleted === true && set.isSkipped !== true) {
        hasExplicitlyCompletedSet = true;
      }
    });
  });

  if (hasExplicitlyCompletedSet && todayDateEpoch !== null && history.lastValidDateEpoch !== null) {
    const gapDays = (todayDateEpoch - history.lastValidDateEpoch) / (1000 * 60 * 60 * 24);
    if (gapDays >= 14) {
      candidates.push({
        id: 'back_in_action',
        label: INSIGHT_META.back_in_action.label,
        explanation: 'First completed workout recorded after a gap of 14 or more days.',
        domain: INSIGHT_META.back_in_action.domain,
        tone: INSIGHT_META.back_in_action.tone,
        priority: INSIGHT_PRIORITY.back_in_action,
        numericEvidence: {
          gapDays: Math.round(gapDays),
        },
      });
    }
  }

  // --- Insight 7: Heavy Exposure ---
  let qualifyingHeavySetsCount = 0;
  targetLog.exercises.forEach(ex => {
    if (ex.isSkipped === true) return;
    const mod = ex.modality || 'weighted';
    if (mod !== 'weighted' && mod !== 'bodyweight' && mod !== 'assisted') return;
    const normName = normalizeExerciseName(ex.name);
    if (!normName) return;

    const historicalExposures = history.exerciseExposureE1RMs.get(normName) || [];

    if (historicalExposures.length >= 3) {
      const last3 = historicalExposures.slice(-3).sort((a, b) => a - b);
      const baselineE1RM = last3[1];
      if (baselineE1RM > 0) {
        ex.sets.forEach(set => {
          const ev = resolvePerformanceSetEvidence(ex, set, targetLog.unit, targetLog.bodyweightSnapshot);
          if (ev.status === 'valid' && ev.effectiveLoadKg !== null) {
            if (set.reps! <= 5 && ev.effectiveLoadKg / baselineE1RM >= 0.85) {
              qualifyingHeavySetsCount += 1;
            }
          }
        });
      }
    }
  });

  if (qualifyingHeavySetsCount >= 3) {
    candidates.push({
      id: 'heavy_exposure',
      label: INSIGHT_META.heavy_exposure.label,
      explanation: 'Recorded multiple working sets at or above 85% of your estimated 1RM.',
      domain: INSIGHT_META.heavy_exposure.domain,
      tone: INSIGHT_META.heavy_exposure.tone,
      priority: INSIGHT_PRIORITY.heavy_exposure,
      numericEvidence: {
        heavySetsCount: qualifyingHeavySetsCount,
      },
    });
  }

  // --- Insight 8: Consistent Output & Insight 9: Steep Fatigue Drop ---
  targetLog.exercises.forEach(ex => {
    if (ex.isSkipped === true) return;
    const mod = ex.modality || 'weighted';
    if (mod !== 'weighted' && mod !== 'bodyweight' && mod !== 'assisted') return;

    const contiguousBlocks: Array<Array<{ weightKg: number; reps: number; rpe: number; e1rm: number }>> = [];
    let currentBlock: Array<{ weightKg: number; reps: number; rpe: number; e1rm: number }> = [];
    let currentBlockQuantLoad: number | null = null;

    ex.sets.forEach(set => {
      const ev = resolvePerformanceSetEvidence(ex, set, targetLog.unit, targetLog.bodyweightSnapshot);
      const isEligible =
        ev.status === 'valid' &&
        ev.effectiveLoadKg !== null &&
        ev.e1rmKg !== null &&
        set.isDropSet !== true;

      if (!isEligible) {
        if (currentBlock.length >= 3) {
          contiguousBlocks.push(currentBlock);
        }
        currentBlock = [];
        currentBlockQuantLoad = null;
        return;
      }

      const weightKg = ev.effectiveLoadKg!;
      const quantLoad = Math.round(weightKg * 100) / 100;
      const e1rm = ev.e1rmKg!;

      if (currentBlockQuantLoad === null) {
        currentBlockQuantLoad = quantLoad;
        currentBlock.push({ weightKg, reps: set.reps!, rpe: set.rpe!, e1rm });
      } else if (currentBlockQuantLoad === quantLoad) {
        currentBlock.push({ weightKg, reps: set.reps!, rpe: set.rpe!, e1rm });
      } else {
        if (currentBlock.length >= 3) {
          contiguousBlocks.push(currentBlock);
        }
        currentBlock = [{ weightKg, reps: set.reps!, rpe: set.rpe!, e1rm }];
        currentBlockQuantLoad = quantLoad;
      }
    });

    if (currentBlock.length >= 3) {
      contiguousBlocks.push(currentBlock);
    }

    const normName = normalizeExerciseName(ex.name);

    contiguousBlocks.forEach(block => {
      const e1rms = block.map(b => b.e1rm);
      const mean = e1rms.reduce((sum, v) => sum + v, 0) / e1rms.length;
      const variance =
        e1rms.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / e1rms.length;
      const stdDev = Math.sqrt(variance);
      const cv = mean > 0 ? stdDev / mean : 1;

      const firstSet = block[0];
      const lastSet = block[block.length - 1];

      // Check Steep Fatigue Drop
      if (lastSet.e1rm < 0.88 * firstSet.e1rm && lastSet.rpe >= firstSet.rpe) {
        steepFatigueDropExercises.add(normName);
        candidates.push({
          id: 'steep_fatigue_drop',
          label: INSIGHT_META.steep_fatigue_drop.label,
          explanation: `Estimated performance declined by over 12% across straight working sets on ${ex.name}.`,
          domain: INSIGHT_META.steep_fatigue_drop.domain,
          tone: INSIGHT_META.steep_fatigue_drop.tone,
          priority: INSIGHT_PRIORITY.steep_fatigue_drop,
          exerciseName: ex.name,
          numericEvidence: {
            firstSetE1RM: Math.round(firstSet.e1rm * 10) / 10,
            lastSetE1RM: Math.round(lastSet.e1rm * 10) / 10,
            dropPercentage: Math.round(((firstSet.e1rm - lastSet.e1rm) / firstSet.e1rm) * 100),
          },
        });
      } else if (cv < 0.025 && !steepFatigueDropExercises.has(normName) && !consistentOutputExercises.has(normName)) {
        // Consistent Output
        consistentOutputExercises.add(normName);
        candidates.push({
          id: 'consistent_output',
          label: INSIGHT_META.consistent_output.label,
          explanation: `Estimated performance remained within 2.5% across 3 or more working sets on ${ex.name}.`,
          domain: INSIGHT_META.consistent_output.domain,
          tone: INSIGHT_META.consistent_output.tone,
          priority: INSIGHT_PRIORITY.consistent_output,
          exerciseName: ex.name,
          numericEvidence: {
            coefficientOfVariation: Math.round(cv * 1000) / 1000,
          },
        });
      }
    });
  });

  // --- Insight 10: Recovery Strain & Insight 13: Against the Odds ---
  const sessionPerfIndex = calculateBatchSessionPerformanceIndex(targetLog, history);

  const recovery = targetLog.recovery;
  const sleepHours = recovery && typeof recovery.sleepHours === 'number' && Number.isFinite(recovery.sleepHours)
    ? recovery.sleepHours
    : null;
  const soreness = recovery && typeof recovery.soreness === 'number' && Number.isFinite(recovery.soreness)
    ? recovery.soreness
    : null;

  const isSoreness1to10 = soreness !== null && soreness >= 1 && soreness <= 10;
  const isLowSleepOrHighSoreness =
    (sleepHours !== null && sleepHours <= 5.5) ||
    (isSoreness1to10 && soreness >= 7);

  if (sessionPerfIndex !== null && isLowSleepOrHighSoreness) {
    if (sessionPerfIndex < 0.96) {
      candidates.push({
        id: 'recovery_strain',
        label: INSIGHT_META.recovery_strain.label,
        explanation: 'Lower exercise-matched output coincided with low reported sleep or elevated soreness.',
        domain: INSIGHT_META.recovery_strain.domain,
        tone: INSIGHT_META.recovery_strain.tone,
        priority: INSIGHT_PRIORITY.recovery_strain,
        numericEvidence: {
          sessionPerformanceIndex: Math.round(sessionPerfIndex * 1000) / 1000,
          ...(sleepHours !== null ? { sleepHours } : {}),
          ...(soreness !== null ? { soreness } : {}),
        },
      });
    } else if (sessionPerfIndex >= 1.00) {
      candidates.push({
        id: 'against_the_odds',
        label: INSIGHT_META.against_the_odds.label,
        explanation: 'Matched or exceeded recent exercise performance alongside low reported sleep or elevated soreness.',
        domain: INSIGHT_META.against_the_odds.domain,
        tone: INSIGHT_META.against_the_odds.tone,
        priority: INSIGHT_PRIORITY.against_the_odds,
        numericEvidence: {
          sessionPerformanceIndex: Math.round(sessionPerfIndex * 1000) / 1000,
          ...(sleepHours !== null ? { sleepHours } : {}),
          ...(soreness !== null ? { soreness } : {}),
        },
      });
    }
  }

  // --- Insight 11: Form Drift ---
  targetLog.exercises.forEach(ex => {
    if (ex.isSkipped === true) return;
    const completedSets = ex.sets.filter(
      s => s.isCompleted === true && s.isSkipped !== true && s.isWarmup !== true
    );
    if (completedSets.length < 3) return;

    const firstSetForm = completedSets[0].form;
    if (firstSetForm === 'strict' || firstSetForm === 'standard' || firstSetForm === null || firstSetForm === undefined) {
      let laterLooseCount = 0;
      for (let i = 1; i < completedSets.length; i++) {
        if (completedSets[i].form === 'loose') {
          laterLooseCount += 1;
        }
      }
      if (laterLooseCount >= 2) {
        candidates.push({
          id: 'form_drift',
          label: INSIGHT_META.form_drift.label,
          explanation: 'Later working sets were logged with looser form.',
          domain: INSIGHT_META.form_drift.domain,
          tone: INSIGHT_META.form_drift.tone,
          priority: INSIGHT_PRIORITY.form_drift,
          exerciseName: ex.name,
        });
      }
    }
  });

  // --- Insight 12: High Exertion ---
  let highExertionSetsCount = 0;
  targetLog.exercises.forEach(ex => {
    if (ex.isSkipped === true) return;
    const mod = ex.modality || 'weighted';
    if (mod !== 'weighted' && mod !== 'bodyweight') return;

    ex.sets.forEach(set => {
      if (set.isCompleted !== true || set.isSkipped === true || set.isWarmup === true) return;
      if (set.rpe !== null && set.rpe !== undefined && isValidRPE(set.rpe) && set.rpe >= 9.0) {
        highExertionSetsCount += 1;
      }
    });
  });

  if (highExertionSetsCount >= 3) {
    candidates.push({
      id: 'high_exertion',
      label: INSIGHT_META.high_exertion.label,
      explanation: 'Recorded 3 or more working sets within 1 repetition of failure (RPE 9.0 to 10.0).',
      domain: INSIGHT_META.high_exertion.domain,
      tone: INSIGHT_META.high_exertion.tone,
      priority: INSIGHT_PRIORITY.high_exertion,
      numericEvidence: {
        highExertionSetsCount,
      },
    });
  }

  // --- Insight 14: Muscle Focus ---
  let totalExplicitWorkingSets = 0;
  const setsByMuscleGroup = new Map<string, { count: number; originalSpelling: string }>();

  targetLog.exercises.forEach(ex => {
    if (ex.isSkipped === true) return;
    ex.sets.forEach(set => {
      if (set.isCompleted !== true || set.isSkipped === true || set.isWarmup === true) return;
      totalExplicitWorkingSets += 1;

      if (ex.muscleGroup && ex.muscleGroup.trim().length > 0) {
        const norm = ex.muscleGroup.trim().toLowerCase();
        const existing = setsByMuscleGroup.get(norm);
        if (existing) {
          existing.count += 1;
        } else {
          setsByMuscleGroup.set(norm, { count: 1, originalSpelling: ex.muscleGroup.trim() });
        }
      }
    });
  });

  if (totalExplicitWorkingSets >= 6) {
    let labeledSets = 0;
    setsByMuscleGroup.forEach(g => {
      labeledSets += g.count;
    });

    if (labeledSets / totalExplicitWorkingSets >= 0.8) {
      setsByMuscleGroup.forEach(({ count, originalSpelling }) => {
        if (count / labeledSets >= 0.6) {
          candidates.push({
            id: 'muscle_focus',
            label: INSIGHT_META.muscle_focus.label,
            explanation: `Over 60% of today's working sets were recorded for ${originalSpelling}.`,
            domain: INSIGHT_META.muscle_focus.domain,
            tone: INSIGHT_META.muscle_focus.tone,
            priority: INSIGHT_PRIORITY.muscle_focus,
            muscleGroup: originalSpelling,
            numericEvidence: {
              muscleGroupSets: count,
              totalWorkingSets: totalExplicitWorkingSets,
            },
          });
        }
      });
    }
  }

  // --- Insight 15: Minimalist Session ---
  let totalCompletedWorkingSetsAll = 0;
  targetLog.exercises.forEach(ex => {
    if (ex.isSkipped === true) return;
    ex.sets.forEach(set => {
      if (set.isCompleted === true && set.isSkipped !== true && set.isWarmup !== true) {
        totalCompletedWorkingSetsAll += 1;
      }
    });
  });

  if (totalCompletedWorkingSetsAll >= 3 && totalCompletedWorkingSetsAll <= 6) {
    candidates.push({
      id: 'minimalist_session',
      label: INSIGHT_META.minimalist_session.label,
      explanation: 'Completed between 3 and 6 total working sets.',
      domain: INSIGHT_META.minimalist_session.domain,
      tone: INSIGHT_META.minimalist_session.tone,
      priority: INSIGHT_PRIORITY.minimalist_session,
      numericEvidence: {
        totalWorkingSets: totalCompletedWorkingSetsAll,
      },
    });
  }

  // --- Insight 16: Compound Dominant ---
  let resistanceSetsWithCategory = 0;
  let compoundSetsCount = 0;
  let totalExplicitResistanceWorkingSets = 0;

  targetLog.exercises.forEach(ex => {
    if (ex.isSkipped === true) return;
    const mod = ex.modality || 'weighted';
    if (mod !== 'weighted' && mod !== 'bodyweight') return;

    ex.sets.forEach(set => {
      if (set.isCompleted !== true || set.isSkipped === true || set.isWarmup === true) return;
      totalExplicitResistanceWorkingSets += 1;
      if (ex.movementCategory) {
        resistanceSetsWithCategory += 1;
        if (ex.movementCategory === 'compound') {
          compoundSetsCount += 1;
        }
      }
    });
  });

  if (
    totalExplicitResistanceWorkingSets >= 5 &&
    resistanceSetsWithCategory / totalExplicitResistanceWorkingSets >= 0.8 &&
    compoundSetsCount / resistanceSetsWithCategory >= 0.7
  ) {
    candidates.push({
      id: 'compound_dominant',
      label: INSIGHT_META.compound_dominant.label,
      explanation: "Over 70% of today's working sets were multi-joint compound movements.",
      domain: INSIGHT_META.compound_dominant.domain,
      tone: INSIGHT_META.compound_dominant.tone,
      priority: INSIGHT_PRIORITY.compound_dominant,
      numericEvidence: {
        compoundSets: compoundSetsCount,
        totalResistanceSets: totalExplicitResistanceWorkingSets,
      },
    });
  }

  return candidates;
}

/**
 * Calculates rarity from accumulated occurrence counters in O(1).
 */
function calculateBatchRarity(
  insightId: DiaryInsightId,
  precedingLogsCount: number,
  occurrenceCounts: Map<DiaryInsightId, number>
): DiaryRarity {
  if (precedingLogsCount === 0) {
    return null;
  }

  const priorOccurrenceCount = occurrenceCounts.get(insightId) || 0;

  if (priorOccurrenceCount === 0) {
    return 'personal_first';
  }

  if (precedingLogsCount < 20) {
    return null;
  }

  const rate = priorOccurrenceCount / precedingLogsCount;
  if (rate < 0.05) {
    return 'rare';
  }
  if (rate <= 0.2) {
    return 'notable';
  }
  return 'common';
}

/**
 * Updates the historical index with information from a completed valid workout.
 */
function updateBatchHistoricalIndex(
  log: WorkoutLog,
  rawInsights: RawInsightCandidate[],
  history: BatchHistoricalIndex
): void {
  history.validPrecedingLogs.push(log);

  if (isValidDate(log.date)) {
    history.lastValidDateEpoch = Date.parse(log.date);
  }

  // Update insight occurrence counters (counted at most once per workout per insight ID)
  const encounteredInsightIds = new Set<DiaryInsightId>();
  rawInsights.forEach(ins => {
    encounteredInsightIds.add(ins.id);
  });
  encounteredInsightIds.forEach(id => {
    const current = history.insightOccurrenceCounts.get(id) || 0;
    history.insightOccurrenceCounts.set(id, current + 1);
  });

  const logDateEpoch = isValidDate(log.date) ? Date.parse(log.date) : null;

  // Update exercise indexes
  log.exercises.forEach(ex => {
    if (ex.isSkipped === true) return;
    const mod = ex.modality || 'weighted';
    if (mod !== 'weighted' && mod !== 'bodyweight' && mod !== 'assisted') return;

    const normName = normalizeExerciseName(ex.name);
    if (!normName) return;

    let sessionBestE1RM = 0;
    let sessionMaxWeightKg = 0;
    let hasEligiblePerformanceSet = false;

    ex.sets.forEach(set => {
      const ev = resolvePerformanceSetEvidence(ex, set, log.unit, log.bodyweightSnapshot);
      if (ev.status !== 'valid' || ev.effectiveLoadKg === null || ev.e1rmKg === null) return;
      hasEligiblePerformanceSet = true;
      const weightKg = ev.effectiveLoadKg;
      const e1rm = ev.e1rmKg;

      if (e1rm > sessionBestE1RM) {
        sessionBestE1RM = e1rm;
      }
      if (weightKg > sessionMaxWeightKg) {
        sessionMaxWeightKg = weightKg;
      }

      // Exact max reps by quantized load
      const quantizedLoad = Math.round(weightKg * 100) / 100;
      let loadRepsMap = history.exerciseExactMaxRepsByWeightKg.get(normName);
      if (!loadRepsMap) {
        loadRepsMap = new Map<number, number>();
        history.exerciseExactMaxRepsByWeightKg.set(normName, loadRepsMap);
      }
      const prevMaxReps = loadRepsMap.get(quantizedLoad) || 0;
      if (set.reps! > prevMaxReps) {
        loadRepsMap.set(quantizedLoad, set.reps!);
      }
    });

    if (hasEligiblePerformanceSet && sessionBestE1RM > 0) {
      let exposures = history.exerciseExposureE1RMs.get(normName);
      if (!exposures) {
        exposures = [];
        history.exerciseExposureE1RMs.set(normName, exposures);
      }
      exposures.push(sessionBestE1RM);

      const currentMaxE1RM = history.exerciseMaxE1RM.get(normName) || 0;
      if (sessionBestE1RM > currentMaxE1RM) {
        history.exerciseMaxE1RM.set(normName, sessionBestE1RM);
      }

      if (logDateEpoch !== null) {
        let dateExposures = history.exerciseDateExposures.get(normName);
        if (!dateExposures) {
          dateExposures = [];
          history.exerciseDateExposures.set(normName, dateExposures);
        }
        dateExposures.push({ dateEpoch: logDateEpoch, bestE1RM: sessionBestE1RM });
      }
    }

    if (sessionMaxWeightKg > 0) {
      const currentMaxWeightKg = history.exerciseMaxWeightKg.get(normName) || 0;
      if (sessionMaxWeightKg > currentMaxWeightKg) {
        history.exerciseMaxWeightKg.set(normName, sessionMaxWeightKg);
      }
    }

    const sessionTonnageKg = calculateExerciseTonnageKg(ex, log.unit, log.bodyweightSnapshot);
    if (sessionTonnageKg > 0) {
      let tonnages = history.exerciseTonnageHistory.get(normName);
      if (!tonnages) {
        tonnages = [];
        history.exerciseTonnageHistory.set(normName, tonnages);
      }
      tonnages.push(sessionTonnageKg);

      const currentMaxTonnage = history.exerciseMaxTonnageKg.get(normName) || 0;
      if (sessionTonnageKg > currentMaxTonnage) {
        history.exerciseMaxTonnageKg.set(normName, sessionTonnageKg);
      }
    }
  });
}

/**
 * Generates scorecards for all logs in a single deterministic O(N log N) chronological pass.
 */
export function generateDiaryScorecardMap(allLogs: WorkoutLog[]): DiaryScorecardMap {
  const scorecardMap: DiaryScorecardMap = {};
  if (!allLogs || allLogs.length === 0) {
    return scorecardMap;
  }

  // Detect duplicate log IDs
  const idCounts = new Map<string, number>();
  allLogs.forEach(log => {
    if (log.id) {
      idCounts.set(log.id, (idCounts.get(log.id) || 0) + 1);
    }
  });

  // Separate valid historical logs from invalid logs
  interface LogItem {
    log: WorkoutLog;
    originalIndex: number;
    isValidHistorical: boolean;
    dateEpoch: number | null;
    idTimestamp: number | null;
  }

  const validItems: LogItem[] = [];
  const invalidItems: LogItem[] = [];

  allLogs.forEach((log, originalIndex) => {
    const isDateVal = isValidDate(log.date);
    const idTime = parseStrictIdTimestamp(log.id);

    if (isDateVal || idTime !== null) {
      validItems.push({
        log,
        originalIndex,
        isValidHistorical: true,
        dateEpoch: isDateVal ? Date.parse(log.date) : null,
        idTimestamp: idTime,
      });
    } else {
      invalidItems.push({
        log,
        originalIndex,
        isValidHistorical: false,
        dateEpoch: null,
        idTimestamp: null,
      });
    }
  });

  // Sort valid items in exact deterministic chronological order matching getStrictlyPrecedingLogs
  validItems.sort((a, b) => {
    const aDateValid = a.dateEpoch !== null;
    const bDateValid = b.dateEpoch !== null;

    if (aDateValid && bDateValid) {
      if (a.dateEpoch !== b.dateEpoch) {
        return a.dateEpoch! - b.dateEpoch!;
      }
      if (a.idTimestamp !== null && b.idTimestamp !== null && a.idTimestamp !== b.idTimestamp) {
        return a.idTimestamp - b.idTimestamp;
      }
      return a.originalIndex - b.originalIndex;
    }

    const aEffectiveTime = a.idTimestamp !== null ? a.idTimestamp : a.dateEpoch!;
    const bEffectiveTime = b.idTimestamp !== null ? b.idTimestamp : b.dateEpoch!;

    if (aEffectiveTime !== bEffectiveTime) {
      return aEffectiveTime - bEffectiveTime;
    }

    return a.originalIndex - b.originalIndex;
  });

  // Maintain chronological batch historical index
  const history = createEmptyBatchHistoricalIndex();

  for (let i = 0; i < validItems.length; i++) {
    const { log } = validItems[i];

    const primaryCategory = classifyDiaryWorkout(log);
    const rawInsights = evaluateBatchRawInsights(log, history);
    const sessionPerformanceIndex = calculateBatchSessionPerformanceIndex(log, history);

    const insights: DiaryInsightResult[] = rawInsights.map(candidate => {
      const rarity = calculateBatchRarity(
        candidate.id,
        history.validPrecedingLogs.length,
        history.insightOccurrenceCounts
      );
      return {
        ...candidate,
        rarity,
      };
    });

    insights.sort((a, b) => a.priority - b.priority);

    const collapsedInsights = insights.slice(0, 2);
    const overflowInsightCount = Math.max(0, insights.length - collapsedInsights.length);
    const hasSufficientPerformanceHistory = history.validPrecedingLogs.length >= 2;

    const scorecard: DiaryScorecardResult = {
      primaryCategory,
      insights,
      collapsedInsights,
      overflowInsightCount,
      hasSufficientPerformanceHistory,
      sessionPerformanceIndex,
    };

    if (log.id) {
      // If duplicate IDs exist for this ID, omit ambiguous entry from the map
      if (idCounts.get(log.id) === 1) {
        scorecardMap[log.id] = scorecard;
      }
    }

    // Update historical index only AFTER the current scorecard is complete
    updateBatchHistoricalIndex(log, rawInsights, history);
  }

  // Process invalid items (they receive current-session structural classifications with empty history)
  const emptyHistory = createEmptyBatchHistoricalIndex();
  for (let j = 0; j < invalidItems.length; j++) {
    const { log } = invalidItems[j];
    const primaryCategory = classifyDiaryWorkout(log);
    const rawInsights = evaluateBatchRawInsights(log, emptyHistory);
    const sessionPerformanceIndex = null;

    const insights: DiaryInsightResult[] = rawInsights.map(candidate => ({
      ...candidate,
      rarity: null,
    }));

    insights.sort((a, b) => a.priority - b.priority);
    const collapsedInsights = insights.slice(0, 2);
    const overflowInsightCount = Math.max(0, insights.length - collapsedInsights.length);

    const scorecard: DiaryScorecardResult = {
      primaryCategory,
      insights,
      collapsedInsights,
      overflowInsightCount,
      hasSufficientPerformanceHistory: false,
      sessionPerformanceIndex,
    };

    if (log.id) {
      if (idCounts.get(log.id) === 1) {
        scorecardMap[log.id] = scorecard;
      }
    }
  }

  return scorecardMap;
}
