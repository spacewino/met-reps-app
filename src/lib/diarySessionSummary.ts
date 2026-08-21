import { WorkoutLog, ExerciseEntry, SetEntry, WeightUnit } from '../types';
import { resolveSetEffectiveLoad, calculateSetWorkingVolume, EffectiveLoadStatus } from './effectiveLoad';

export type VolumeCoverageStatus =
  | 'complete'
  | 'partial'
  | 'unavailable'
  | 'not_applicable';

export interface MuscleGroupSetCount {
  muscleGroup: string;
  setCount: number;
}

export interface DiarySessionSummary {
  completedExerciseCount: number;
  durationMinutes: number | null;
  completedWorkingSetCount: number;
  workingVolume: {
    valueKg: number | null;
    status: VolumeCoverageStatus;
    resolvedMassSetCount: number;
    unresolvedMassSetCount: number;
    totalMassSetCount: number;
  };
  muscleSetCounts: MuscleGroupSetCount[];
}

/**
 * Normalizes muscle group strings (trim, lowercase check, clean label)
 */
function normalizeMuscleGroupName(rawName: string | null | undefined): string {
  if (!rawName || typeof rawName !== 'string') return 'Other';
  const trimmed = rawName.trim();
  if (trimmed.length === 0) return 'Other';
  // Capitalize first letter
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Checks if a parent set is eligible as a completed working set.
 * Rules:
 * - Exercise is not skipped
 * - Set is not skipped
 * - Set is not warmup
 * - isCompleted !== false (accepts true and legacy undefined)
 * - reps is a positive finite integer
 */
export function isParentWorkingSetEligible(exercise: ExerciseEntry, set: SetEntry): boolean {
  if (exercise.isSkipped === true) return false;
  if (set.isSkipped === true) return false;
  if (set.isWarmup === true) return false;
  if (set.isCompleted === false) return false;
  if (set.reps === null || set.reps === undefined || !Number.isInteger(set.reps) || set.reps <= 0) {
    return false;
  }
  return true;
}

/**
 * Pure generator for collapsed Diary workout card summary metadata.
 * Deeply immutable, deterministic, and pure.
 */
export function generateDiarySessionSummary(log: WorkoutLog): DiarySessionSummary {
  const durationMinutes =
    typeof log.durationMinutes === 'number' && Number.isFinite(log.durationMinutes) && log.durationMinutes > 0
      ? log.durationMinutes
      : null;

  let completedWorkingSetCount = 0;
  let completedExerciseCount = 0;
  const muscleMap: Record<string, number> = {};

  let totalMassVolumeKg = 0;
  let resolvedMassCount = 0;
  let unresolvedMassCount = 0;

  const exercises = Array.isArray(log.exercises) ? log.exercises : [];

  for (const ex of exercises) {
    if (ex.isSkipped === true) continue;

    let exHasEligibleWorkingSet = false;
    const modality = ex.modality || 'weighted';
    const isMassModality = modality === 'weighted' || modality === 'bodyweight' || modality === 'assisted';

    const sets = Array.isArray(ex.sets) ? ex.sets : [];
    for (const set of sets) {
      if (!isParentWorkingSetEligible(ex, set)) continue;

      exHasEligibleWorkingSet = true;
      completedWorkingSetCount++;

      // Muscle group aggregation
      const muscleGroup = normalizeMuscleGroupName(ex.muscleGroup);
      muscleMap[muscleGroup] = (muscleMap[muscleGroup] || 0) + 1;

      // Volume aggregation for mass modalities
      if (isMassModality) {
        const parentVol = calculateSetWorkingVolume(set.weight, set.reps, modality, log.unit, log.bodyweightSnapshot);
        if (parentVol.status === 'valid' && parentVol.volumeKg !== null) {
          totalMassVolumeKg += parentVol.volumeKg;
          resolvedMassCount++;
        } else {
          unresolvedMassCount++;
        }

        // Drop sub-sets handling: contribute volume only; do not increment parent set or muscle count
        if (set.isDropSet && Array.isArray(set.dropSubSets) && set.dropSubSets.length > 0) {
          for (const sub of set.dropSubSets) {
            if (sub && typeof sub.reps === 'number' && Number.isInteger(sub.reps) && sub.reps > 0) {
              const subVol = calculateSetWorkingVolume(sub.weight, sub.reps, modality, log.unit, log.bodyweightSnapshot);
              if (subVol.status === 'valid' && subVol.volumeKg !== null) {
                totalMassVolumeKg += subVol.volumeKg;
                resolvedMassCount++;
              } else {
                unresolvedMassCount++;
              }
            }
          }
        }
      }
    }

    if (exHasEligibleWorkingSet) {
      completedExerciseCount++;
    }
  }

  // Determine coverage status
  const totalMassSetCount = resolvedMassCount + unresolvedMassCount;
  let volumeStatus: VolumeCoverageStatus;
  let finalValueKg: number | null = null;

  if (totalMassSetCount === 0) {
    volumeStatus = 'not_applicable';
    finalValueKg = null;
  } else if (unresolvedMassCount === 0 && resolvedMassCount > 0) {
    volumeStatus = 'complete';
    finalValueKg = totalMassVolumeKg;
  } else if (resolvedMassCount > 0 && unresolvedMassCount > 0) {
    volumeStatus = 'partial';
    finalValueKg = totalMassVolumeKg;
  } else {
    // resolvedMassCount === 0 && unresolvedMassCount > 0
    volumeStatus = 'unavailable';
    finalValueKg = null;
  }

  // Sort muscle groups by count descending, then alphabetically
  const muscleSetCounts: MuscleGroupSetCount[] = Object.entries(muscleMap)
    .map(([muscleGroup, setCount]) => ({ muscleGroup, setCount }))
    .sort((a, b) => {
      if (b.setCount !== a.setCount) {
        return b.setCount - a.setCount;
      }
      return a.muscleGroup.localeCompare(b.muscleGroup);
    });

  return {
    completedExerciseCount,
    durationMinutes,
    completedWorkingSetCount,
    workingVolume: {
      valueKg: finalValueKg,
      status: volumeStatus,
      resolvedMassSetCount: resolvedMassCount,
      unresolvedMassSetCount: unresolvedMassCount,
      totalMassSetCount,
    },
    muscleSetCounts,
  };
}

export interface DiaryHistoryVolumeSummary {
  valueKg: number | null;
  status: VolumeCoverageStatus;
  completeSessionCount: number;
  partialSessionCount: number;
  unavailableSessionCount: number;
}

/**
 * Pure generator for aggregating all-time Diary lifetime volume.
 * Rules:
 * - Sums known canonical kg volume from complete sessions.
 * - Includes known minimum from partial sessions.
 * - Ignores not_applicable sessions when deciding overall history coverage.
 * - If any mass history is unresolved and some known volume exists -> 'partial'
 * - If mass history exists but no volume is resolvable -> 'unavailable'
 * - If no applicable mass history exists -> 'not_applicable'
 */
export function calculateDiaryHistoryVolume(logs: WorkoutLog[]): DiaryHistoryVolumeSummary {
  if (!Array.isArray(logs) || logs.length === 0) {
    return {
      valueKg: null,
      status: 'not_applicable',
      completeSessionCount: 0,
      partialSessionCount: 0,
      unavailableSessionCount: 0,
    };
  }

  let totalKg = 0;
  let completeSessionCount = 0;
  let partialSessionCount = 0;
  let unavailableSessionCount = 0;
  let notApplicableSessionCount = 0;

  for (const log of logs) {
    const summary = generateDiarySessionSummary(log);
    const vol = summary.workingVolume;

    if (vol.status === 'complete') {
      completeSessionCount++;
      if (vol.valueKg !== null) {
        totalKg += vol.valueKg;
      }
    } else if (vol.status === 'partial') {
      partialSessionCount++;
      if (vol.valueKg !== null) {
        totalKg += vol.valueKg;
      }
    } else if (vol.status === 'unavailable') {
      unavailableSessionCount++;
    } else {
      // not_applicable
      notApplicableSessionCount++;
    }
  }

  const applicableSessionCount = completeSessionCount + partialSessionCount + unavailableSessionCount;

  if (applicableSessionCount === 0) {
    return {
      valueKg: null,
      status: 'not_applicable',
      completeSessionCount: 0,
      partialSessionCount: 0,
      unavailableSessionCount: 0,
    };
  }

  if (partialSessionCount > 0 || (completeSessionCount > 0 && unavailableSessionCount > 0)) {
    return {
      valueKg: totalKg,
      status: 'partial',
      completeSessionCount,
      partialSessionCount,
      unavailableSessionCount,
    };
  }

  if (unavailableSessionCount > 0 && completeSessionCount === 0 && partialSessionCount === 0) {
    return {
      valueKg: null,
      status: 'unavailable',
      completeSessionCount: 0,
      partialSessionCount: 0,
      unavailableSessionCount,
    };
  }

  // All applicable sessions are complete
  return {
    valueKg: totalKg,
    status: 'complete',
    completeSessionCount,
    partialSessionCount: 0,
    unavailableSessionCount: 0,
  };
}
