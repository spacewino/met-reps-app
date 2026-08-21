import { WeightUnit, WorkoutLog, ExerciseEntry, SetEntry, BodyweightSnapshot } from '../types';
import { convertWeightUnit, calculateAssistedEffectiveLoad } from './assistedLoadMath';

export type EffectiveLoadStatus =
  | 'valid'
  | 'unavailable'
  | 'invalid'
  | 'not_applicable';

export type EffectiveLoadReason =
  | 'missing_snapshot'
  | 'invalid_snapshot'
  | 'missing_weight'
  | 'invalid_weight'
  | 'negative_assistance'
  | 'assistance_exceeds_bodyweight'
  | 'zero_effective_load'
  | 'non_mass_modality';

export interface SetEffectiveLoadResult {
  status: EffectiveLoadStatus;
  effectiveLoadKg: number | null;
  effectiveLoadInLogUnit: number | null;
  canonicalUnit: 'kg';
  logUnit: WeightUnit;
  modality: 'weighted' | 'bodyweight' | 'assisted' | 'timed' | 'distance' | 'distance_loaded';
  requiresSnapshot: boolean;
  hasSnapshot: boolean;
  reason?: EffectiveLoadReason;
}

export interface SetWorkingVolumeResult {
  status: EffectiveLoadStatus;
  volumeKg: number | null;
  effectiveLoadKg: number | null;
  reps: number | null;
  reason?: EffectiveLoadReason | 'invalid_reps';
}

/**
 * Resolves a single set into its canonical physical effective load (in kg) and in log unit.
 * Strictly pure: never reads localStorage or Settings.
 */
export function resolveSetEffectiveLoad(
  setWeight: number | null | undefined,
  modality: ExerciseEntry['modality'],
  logUnit: WeightUnit,
  snapshot: BodyweightSnapshot | null | undefined
): SetEffectiveLoadResult {
  const normModality: SetEffectiveLoadResult['modality'] = modality || 'weighted';
  const hasSnapshot = Boolean(
    snapshot &&
    typeof snapshot.value === 'number' &&
    Number.isFinite(snapshot.value) &&
    snapshot.value > 0 &&
    (snapshot.unit === 'kg' || snapshot.unit === 'lb')
  );

  // 1. Non-mass modalities
  if (
    normModality === 'timed' ||
    normModality === 'distance' ||
    normModality === 'distance_loaded'
  ) {
    return {
      status: 'not_applicable',
      effectiveLoadKg: null,
      effectiveLoadInLogUnit: null,
      canonicalUnit: 'kg',
      logUnit,
      modality: normModality,
      requiresSnapshot: false,
      hasSnapshot,
      reason: 'non_mass_modality',
    };
  }

  // 2. Weighted (or undefined default)
  if (normModality === 'weighted') {
    if (setWeight === null || setWeight === undefined) {
      return {
        status: 'invalid',
        effectiveLoadKg: null,
        effectiveLoadInLogUnit: null,
        canonicalUnit: 'kg',
        logUnit,
        modality: 'weighted',
        requiresSnapshot: false,
        hasSnapshot,
        reason: 'missing_weight',
      };
    }
    if (typeof setWeight !== 'number' || !Number.isFinite(setWeight) || setWeight <= 0) {
      return {
        status: 'invalid',
        effectiveLoadKg: null,
        effectiveLoadInLogUnit: null,
        canonicalUnit: 'kg',
        logUnit,
        modality: 'weighted',
        requiresSnapshot: false,
        hasSnapshot,
        reason: 'invalid_weight',
      };
    }
    const loadKg = convertWeightUnit(setWeight, logUnit, 'kg');
    return {
      status: 'valid',
      effectiveLoadKg: loadKg,
      effectiveLoadInLogUnit: setWeight,
      canonicalUnit: 'kg',
      logUnit,
      modality: 'weighted',
      requiresSnapshot: false,
      hasSnapshot,
    };
  }

  // 3. Bodyweight
  if (normModality === 'bodyweight') {
    if (!snapshot || typeof snapshot.value !== 'number' || !Number.isFinite(snapshot.value) || snapshot.value <= 0) {
      return {
        status: 'unavailable',
        effectiveLoadKg: null,
        effectiveLoadInLogUnit: null,
        canonicalUnit: 'kg',
        logUnit,
        modality: 'bodyweight',
        requiresSnapshot: true,
        hasSnapshot: false,
        reason: snapshot ? 'invalid_snapshot' : 'missing_snapshot',
      };
    }
    // Effective load is the snapshot normalized to kg, ignoring raw set weight
    const bwKg = convertWeightUnit(snapshot.value, snapshot.unit, 'kg');
    const bwInLogUnit = convertWeightUnit(snapshot.value, snapshot.unit, logUnit);
    return {
      status: 'valid',
      effectiveLoadKg: bwKg,
      effectiveLoadInLogUnit: bwInLogUnit,
      canonicalUnit: 'kg',
      logUnit,
      modality: 'bodyweight',
      requiresSnapshot: true,
      hasSnapshot: true,
    };
  }

  // 4. Assisted
  if (normModality === 'assisted') {
    if (!snapshot || typeof snapshot.value !== 'number' || !Number.isFinite(snapshot.value) || snapshot.value <= 0) {
      return {
        status: 'unavailable',
        effectiveLoadKg: null,
        effectiveLoadInLogUnit: null,
        canonicalUnit: 'kg',
        logUnit,
        modality: 'assisted',
        requiresSnapshot: true,
        hasSnapshot: false,
        reason: snapshot ? 'invalid_snapshot' : 'missing_snapshot',
      };
    }

    if (setWeight === null || setWeight === undefined) {
      return {
        status: 'invalid',
        effectiveLoadKg: null,
        effectiveLoadInLogUnit: null,
        canonicalUnit: 'kg',
        logUnit,
        modality: 'assisted',
        requiresSnapshot: true,
        hasSnapshot: true,
        reason: 'missing_weight',
      };
    }

    if (typeof setWeight !== 'number' || !Number.isFinite(setWeight)) {
      return {
        status: 'invalid',
        effectiveLoadKg: null,
        effectiveLoadInLogUnit: null,
        canonicalUnit: 'kg',
        logUnit,
        modality: 'assisted',
        requiresSnapshot: true,
        hasSnapshot: true,
        reason: 'invalid_weight',
      };
    }

    if (setWeight < 0) {
      return {
        status: 'invalid',
        effectiveLoadKg: null,
        effectiveLoadInLogUnit: null,
        canonicalUnit: 'kg',
        logUnit,
        modality: 'assisted',
        requiresSnapshot: true,
        hasSnapshot: true,
        reason: 'negative_assistance',
      };
    }

    // Use canonical calculateAssistedEffectiveLoad helper from assistedLoadMath
    const assistRes = calculateAssistedEffectiveLoad(
      setWeight,
      logUnit,
      snapshot.value,
      snapshot.unit,
      logUnit
    );

    if (assistRes.status !== 'valid' || assistRes.effectiveLoad === null || assistRes.effectiveLoad <= 0) {
      let failReason: EffectiveLoadReason = 'zero_effective_load';
      if (assistRes.bypassReason === 'negative_assistance') {
        failReason = 'negative_assistance';
      } else if (assistRes.bypassReason === 'assistance_exceeds_bodyweight') {
        failReason = 'assistance_exceeds_bodyweight';
      } else if (assistRes.bypassReason === 'missing_assistance') {
        failReason = 'missing_weight';
      } else if (assistRes.bypassReason === 'invalid_assistance') {
        failReason = 'invalid_weight';
      }
      return {
        status: 'invalid',
        effectiveLoadKg: null,
        effectiveLoadInLogUnit: null,
        canonicalUnit: 'kg',
        logUnit,
        modality: 'assisted',
        requiresSnapshot: true,
        hasSnapshot: true,
        reason: failReason,
      };
    }

    const effectiveInLogUnit = assistRes.effectiveLoad;
    const effectiveKg = convertWeightUnit(effectiveInLogUnit, logUnit, 'kg');
    return {
      status: 'valid',
      effectiveLoadKg: effectiveKg,
      effectiveLoadInLogUnit: effectiveInLogUnit,
      canonicalUnit: 'kg',
      logUnit,
      modality: 'assisted',
      requiresSnapshot: true,
      hasSnapshot: true,
    };
  }

  return {
    status: 'not_applicable',
    effectiveLoadKg: null,
    effectiveLoadInLogUnit: null,
    canonicalUnit: 'kg',
    logUnit,
    modality: normModality,
    requiresSnapshot: false,
    hasSnapshot,
    reason: 'non_mass_modality',
  };
}

/**
 * Calculates working volume in kg for a set entry given its repetitions.
 * Does NOT require RPE or strict form.
 */
export function calculateSetWorkingVolume(
  setWeight: number | null | undefined,
  reps: number | null | undefined,
  modality: ExerciseEntry['modality'],
  logUnit: WeightUnit,
  snapshot: BodyweightSnapshot | null | undefined
): SetWorkingVolumeResult {
  if (reps === null || reps === undefined || !Number.isInteger(reps) || reps <= 0) {
    return {
      status: 'invalid',
      volumeKg: null,
      effectiveLoadKg: null,
      reps: null,
      reason: 'invalid_reps',
    };
  }

  const loadRes = resolveSetEffectiveLoad(setWeight, modality, logUnit, snapshot);
  if (loadRes.status !== 'valid' || loadRes.effectiveLoadKg === null) {
    return {
      status: loadRes.status,
      volumeKg: null,
      effectiveLoadKg: null,
      reps,
      reason: loadRes.reason,
    };
  }

  const volumeKg = loadRes.effectiveLoadKg * reps;
  return {
    status: 'valid',
    volumeKg,
    effectiveLoadKg: loadRes.effectiveLoadKg,
    reps,
  };
}
