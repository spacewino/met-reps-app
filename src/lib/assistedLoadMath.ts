/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { WeightUnit } from '../types';

export type AssistedWarmupBypassReason =
  | 'missing_bodyweight'
  | 'invalid_bodyweight'
  | 'missing_bodyweight_unit'
  | 'missing_assistance'
  | 'invalid_assistance'
  | 'negative_assistance'
  | 'zero_effective_load'
  | 'assistance_exceeds_bodyweight'
  | 'invalid_working_reps'
  | 'insufficient_assistance_resolution';

export interface AssistedWarmupInput {
  workingAssistance: number | null | undefined;
  assistanceUnit: WeightUnit;
  bodyweight: number | null | undefined;
  bodyweightUnit: WeightUnit | null | undefined;
  workingReps: number | null | undefined;
}

export interface AssistedWarmupTarget {
  setNumber: number;
  assistance: number; // In assistanceUnit, rounded to nearest 2.5
  reps: number;
  rpe: number;
  isWarmup: true;
}

export interface AssistedWarmupResult {
  status: 'valid' | 'bypassed';
  warmupTargets: [AssistedWarmupTarget, AssistedWarmupTarget, AssistedWarmupTarget] | null;
  bypassReason?: AssistedWarmupBypassReason;
}

export interface AssistedEffectiveLoadResult {
  status: 'valid' | 'bypassed';
  effectiveLoad: number | null; // in targetUnit
  unit: WeightUnit;
  bypassReason?: AssistedWarmupBypassReason;
}

// Canonical conversion constants:
// 1 kg = 2.2046226218 lb
// 1 lb = 0.45359237 kg
export const KG_TO_LB = 2.2046226218;
export const LB_TO_KG = 0.45359237;

/**
 * Pure conversion between kg and lb using canonical constants.
 */
export function convertWeightUnit(
  value: number,
  fromUnit: WeightUnit,
  toUnit: WeightUnit
): number {
  if (fromUnit === toUnit) {
    return value;
  }
  if (fromUnit === 'kg' && toUnit === 'lb') {
    return value * KG_TO_LB;
  }
  if (fromUnit === 'lb' && toUnit === 'kg') {
    return value * LB_TO_KG;
  }
  return value;
}

/**
 * Rounds a value to the nearest 2.5 increment in the active unit.
 */
export function roundToNearest2Point5(val: number): number {
  return Math.round(val / 2.5) * 2.5;
}

/**
 * Calculates estimated effective load (bodyweight minus assistance) converted to targetUnit.
 */
export function calculateAssistedEffectiveLoad(
  assistance: number | null | undefined,
  assistanceUnit: WeightUnit,
  bodyweight: number | null | undefined,
  bodyweightUnit: WeightUnit | null | undefined,
  targetUnit: WeightUnit = assistanceUnit
): AssistedEffectiveLoadResult {
  // Validate Bodyweight
  if (bodyweight === null || bodyweight === undefined) {
    return { status: 'bypassed', effectiveLoad: null, unit: targetUnit, bypassReason: 'missing_bodyweight' };
  }
  if (typeof bodyweight !== 'number' || !Number.isFinite(bodyweight) || isNaN(bodyweight) || bodyweight <= 0) {
    return { status: 'bypassed', effectiveLoad: null, unit: targetUnit, bypassReason: 'invalid_bodyweight' };
  }
  if (!bodyweightUnit || (bodyweightUnit !== 'kg' && bodyweightUnit !== 'lb')) {
    return { status: 'bypassed', effectiveLoad: null, unit: targetUnit, bypassReason: 'missing_bodyweight_unit' };
  }

  // Validate Assistance
  if (assistance === null || assistance === undefined) {
    return { status: 'bypassed', effectiveLoad: null, unit: targetUnit, bypassReason: 'missing_assistance' };
  }
  if (typeof assistance !== 'number' || !Number.isFinite(assistance) || isNaN(assistance)) {
    return { status: 'bypassed', effectiveLoad: null, unit: targetUnit, bypassReason: 'invalid_assistance' };
  }
  if (assistance < 0) {
    return { status: 'bypassed', effectiveLoad: null, unit: targetUnit, bypassReason: 'negative_assistance' };
  }

  // Convert bodyweight to assistanceUnit
  const bwInAssistanceUnit = convertWeightUnit(bodyweight, bodyweightUnit, assistanceUnit);

  if (assistance > bwInAssistanceUnit + 1e-7) {
    return { status: 'bypassed', effectiveLoad: null, unit: targetUnit, bypassReason: 'assistance_exceeds_bodyweight' };
  }

  if (Math.abs(assistance - bwInAssistanceUnit) < 1e-7) {
    return { status: 'bypassed', effectiveLoad: null, unit: targetUnit, bypassReason: 'zero_effective_load' };
  }

  const effectiveInAssistanceUnit = bwInAssistanceUnit - assistance;
  const effectiveInTargetUnit = convertWeightUnit(effectiveInAssistanceUnit, assistanceUnit, targetUnit);

  return {
    status: 'valid',
    effectiveLoad: effectiveInTargetUnit,
    unit: targetUnit,
  };
}

/**
 * Generates three progressive warm-up targets for an assisted exercise.
 *
 * Warm-up 1: 50% of working effective load x working reps @ RPE 4.0
 * Warm-up 2: 70% of working effective load x max(5, round(working reps * 0.70)) @ RPE 6.0
 * Warm-up 3: 85% of working effective load x max(3, round(working reps * 0.35)) @ RPE 7.0
 *
 * Target assistance = Bodyweight - Target Effective Load (rounded to nearest 2.5 in assistanceUnit).
 */
export function generateAssistedWarmupTargets(
  input: AssistedWarmupInput
): AssistedWarmupResult {
  const {
    workingAssistance,
    assistanceUnit,
    bodyweight,
    bodyweightUnit,
    workingReps,
  } = input;

  // 1. Validate Bodyweight
  if (bodyweight === null || bodyweight === undefined) {
    return { status: 'bypassed', warmupTargets: null, bypassReason: 'missing_bodyweight' };
  }
  if (typeof bodyweight !== 'number' || !Number.isFinite(bodyweight) || isNaN(bodyweight) || bodyweight <= 0) {
    return { status: 'bypassed', warmupTargets: null, bypassReason: 'invalid_bodyweight' };
  }
  if (!bodyweightUnit || (bodyweightUnit !== 'kg' && bodyweightUnit !== 'lb')) {
    return { status: 'bypassed', warmupTargets: null, bypassReason: 'missing_bodyweight_unit' };
  }

  // 2. Validate Assistance
  if (workingAssistance === null || workingAssistance === undefined) {
    return { status: 'bypassed', warmupTargets: null, bypassReason: 'missing_assistance' };
  }
  if (typeof workingAssistance !== 'number' || !Number.isFinite(workingAssistance) || isNaN(workingAssistance)) {
    return { status: 'bypassed', warmupTargets: null, bypassReason: 'invalid_assistance' };
  }
  if (workingAssistance < 0) {
    return { status: 'bypassed', warmupTargets: null, bypassReason: 'negative_assistance' };
  }

  // 3. Validate Reps
  if (
    workingReps === null ||
    workingReps === undefined ||
    typeof workingReps !== 'number' ||
    !Number.isFinite(workingReps) ||
    !Number.isInteger(workingReps) ||
    workingReps <= 0
  ) {
    return { status: 'bypassed', warmupTargets: null, bypassReason: 'invalid_working_reps' };
  }

  // 4. Calculate effective working load in the assistance unit
  const bwInAssistanceUnit = convertWeightUnit(bodyweight, bodyweightUnit, assistanceUnit);

  if (workingAssistance > bwInAssistanceUnit + 1e-7) {
    return { status: 'bypassed', warmupTargets: null, bypassReason: 'assistance_exceeds_bodyweight' };
  }

  if (Math.abs(workingAssistance - bwInAssistanceUnit) < 1e-7) {
    return { status: 'bypassed', warmupTargets: null, bypassReason: 'zero_effective_load' };
  }

  const workingEffectiveLoad = bwInAssistanceUnit - workingAssistance;

  // Safe representable 2.5-unit bounds:
  // - Lower bound: first 2.5-unit value strictly greater than working assistance
  // - Upper bound: greatest 2.5-unit value strictly below converted bodyweight
  const minSafeAssistance = (Math.floor((workingAssistance + 1e-9) / 2.5) + 1) * 2.5;
  const maxSafeAssistance = (Math.ceil((bwInAssistanceUnit - 1e-9) / 2.5) - 1) * 2.5;

  if (minSafeAssistance > maxSafeAssistance + 1e-9) {
    return { status: 'bypassed', warmupTargets: null, bypassReason: 'insufficient_assistance_resolution' };
  }

  // 5. Compute warm-up effective loads
  const w1Effective = workingEffectiveLoad * 0.50;
  const w2Effective = workingEffectiveLoad * 0.70;
  const w3Effective = workingEffectiveLoad * 0.85;

  const w1AssistanceRaw = bwInAssistanceUnit - w1Effective;
  const w2AssistanceRaw = bwInAssistanceUnit - w2Effective;
  const w3AssistanceRaw = bwInAssistanceUnit - w3Effective;

  const w1AssistanceRounded = roundToNearest2Point5(w1AssistanceRaw);
  const w2AssistanceRounded = roundToNearest2Point5(w2AssistanceRaw);
  const w3AssistanceRounded = roundToNearest2Point5(w3AssistanceRaw);

  const clampToSafeRange = (val: number) => Math.min(Math.max(val, minSafeAssistance), maxSafeAssistance);

  const w1Assistance = clampToSafeRange(w1AssistanceRounded);
  const w2Assistance = clampToSafeRange(w2AssistanceRounded);
  const w3Assistance = clampToSafeRange(w3AssistanceRounded);

  // Invariant verification on all targets
  const targetAssistances = [w1Assistance, w2Assistance, w3Assistance];
  for (const ast of targetAssistances) {
    const eff = bwInAssistanceUnit - ast;
    if (
      ast <= workingAssistance ||
      ast >= bwInAssistanceUnit ||
      eff <= 0 ||
      eff >= workingEffectiveLoad
    ) {
      return { status: 'bypassed', warmupTargets: null, bypassReason: 'insufficient_assistance_resolution' };
    }
  }

  if (w1Assistance < w2Assistance || w2Assistance < w3Assistance) {
    return { status: 'bypassed', warmupTargets: null, bypassReason: 'insufficient_assistance_resolution' };
  }

  const w1Reps = workingReps;
  const w2Reps = Math.max(5, Math.round(workingReps * 0.70));
  const w3Reps = Math.max(3, Math.round(workingReps * 0.35));

  const target1: AssistedWarmupTarget = {
    setNumber: 1,
    assistance: w1Assistance,
    reps: w1Reps,
    rpe: 4.0,
    isWarmup: true,
  };

  const target2: AssistedWarmupTarget = {
    setNumber: 2,
    assistance: w2Assistance,
    reps: w2Reps,
    rpe: 6.0,
    isWarmup: true,
  };

  const target3: AssistedWarmupTarget = {
    setNumber: 3,
    assistance: w3Assistance,
    reps: w3Reps,
    rpe: 7.0,
    isWarmup: true,
  };

  return {
    status: 'valid',
    warmupTargets: [target1, target2, target3],
  };
}
