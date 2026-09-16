/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ExerciseEntry,
  WorkoutLog,
  PrescriptionSnapshot,
  SetEntry,
} from '../types';
import {
  classifyGuidedSetOutcome,
  GuidedSetOutcome,
  GuidedSetOutcomeResult,
} from './guidedOutcomeClassifier';

export type GuidedExerciseOutcome =
  | 'success'
  | 'marginal_miss'
  | 'substantial_miss'
  | 'neutral'
  | 'ineligible';

export type GuidedExerciseOutcomeReason =
  | 'ALL_PRESCRIBED_SETS_ACHIEVED'
  | 'SINGLE_MARGINAL_MISS'
  | 'MULTIPLE_MARGINAL_MISSES'
  | 'PRESCRIBED_SET_SUBSTANTIAL_MISS'
  | 'EXERCISE_SKIPPED'
  | 'PRESCRIBED_SET_SKIPPED'
  | 'PRESCRIBED_SET_MISSING'
  | 'NO_PRESCRIBED_SETS_FOUND'
  | 'CONFLICTING_PRESCRIBED_SET_COUNTS'
  | 'INVALID_PRESCRIBED_ORDINAL'
  | 'DUPLICATE_PRESCRIBED_ORDINAL'
  | 'INCONSISTENT_PRESCRIBED_SNAPSHOTS'
  | 'INVALID_NUDGE_STEP_RELATIONSHIP'
  | 'STRUCTURALLY_CORRUPT_SET'
  | 'MULTIPLE_NUDGE_MARKERS';

export interface ClassifyGuidedExerciseOutcomeInput {
  exercise: ExerciseEntry;
  workout: WorkoutLog;
}

export interface GuidedExerciseOutcomeResult {
  outcome: GuidedExerciseOutcome;
  reason: GuidedExerciseOutcomeReason;

  expectedPrescribedSetCount: number | null;
  observedPrescribedSetCount: number;
  attemptedPrescribedSetCount: number;

  successfulPrescribedSetCount: number;
  marginalMissCount: number;
  substantialMissCount: number;
  neutralSetCount: number;
  ineligibleSetCount: number;

  missingWorkingSetOrdinals: number[];
  ignoredUnprescribedSetCount: number;

  nudgedSetPresent: boolean;
  nudgedSetAchieved: boolean | null;
  nudgedSetOutcome: GuidedSetOutcome | null;
  nudgedWorkingSetOrdinal: number | null;

  setResults: Array<{
    workingSetOrdinal: number;
    result: GuidedSetOutcomeResult;
  }>;
}

const isActivelyNudged = (snapshot: PrescriptionSnapshot): boolean => {
  return snapshot.nudgeType === 'rep_nudge' || snapshot.nudgeType === 'load_nudge';
};

/**
 * Pure, deterministic classifier evaluating exercise-level Guided progression outcomes.
 *
 * Rules:
 * 1. Calls real classifyGuidedSetOutcome for each prescribed set.
 * 2. Performs zero storage access and zero DOM/React work.
 * 3. Mutates no inputs (deep immutability preserved).
 * 4. Uses no current time or randomness.
 * 5. Returns identical results for identical inputs.
 * 6. Does not persist derived outcomes.
 */
export function classifyGuidedExerciseOutcome(
  input: ClassifyGuidedExerciseOutcomeInput
): GuidedExerciseOutcomeResult {
  const { exercise, workout } = input;

  // 1. Authoritative whole-exercise skip check short-circuits all structural evaluation
  if (exercise?.isSkipped === true) {
    return {
      outcome: 'neutral',
      reason: 'EXERCISE_SKIPPED',
      expectedPrescribedSetCount: null,
      observedPrescribedSetCount: 0,
      attemptedPrescribedSetCount: 0,
      successfulPrescribedSetCount: 0,
      marginalMissCount: 0,
      substantialMissCount: 0,
      neutralSetCount: 0,
      ineligibleSetCount: 0,
      missingWorkingSetOrdinals: [],
      ignoredUnprescribedSetCount: 0,
      nudgedSetPresent: false,
      nudgedSetAchieved: null,
      nudgedSetOutcome: null,
      nudgedWorkingSetOrdinal: null,
      setResults: [],
    };
  }

  const sets = Array.isArray(exercise?.sets) ? exercise.sets : [];

  // Partition prescribed vs unprescribed sets
  const prescribedSets: SetEntry[] = [];
  let ignoredUnprescribedSetCount = 0;

  for (const set of sets) {
    if (set && set.prescriptionSnapshot != null) {
      prescribedSets.push(set);
    } else {
      ignoredUnprescribedSetCount++;
    }
  }

  // 2. Missing-set limitation: zero snapshot-bearing sets
  if (prescribedSets.length === 0) {
    return {
      outcome: 'ineligible',
      reason: 'NO_PRESCRIBED_SETS_FOUND',
      expectedPrescribedSetCount: null,
      observedPrescribedSetCount: 0,
      attemptedPrescribedSetCount: 0,
      successfulPrescribedSetCount: 0,
      marginalMissCount: 0,
      substantialMissCount: 0,
      neutralSetCount: 0,
      ineligibleSetCount: 0,
      missingWorkingSetOrdinals: [],
      ignoredUnprescribedSetCount,
      nudgedSetPresent: false,
      nudgedSetAchieved: null,
      nudgedSetOutcome: null,
      nudgedWorkingSetOrdinal: null,
      setResults: [],
    };
  }

  // 2. Structural validation of prescribedWorkingSetCount
  let expectedPrescribedSetCount: number | null = null;
  let conflictingCounts = false;

  for (const set of prescribedSets) {
    const count = set.prescriptionSnapshot?.prescribedWorkingSetCount;
    if (
      typeof count !== 'number' ||
      !Number.isFinite(count) ||
      !Number.isInteger(count) ||
      count < 1
    ) {
      conflictingCounts = true;
      break;
    }
    if (expectedPrescribedSetCount === null) {
      expectedPrescribedSetCount = count;
    } else if (expectedPrescribedSetCount !== count) {
      conflictingCounts = true;
      break;
    }
  }

  if (conflictingCounts || expectedPrescribedSetCount === null) {
    return {
      outcome: 'ineligible',
      reason: 'CONFLICTING_PRESCRIBED_SET_COUNTS',
      expectedPrescribedSetCount: null,
      observedPrescribedSetCount: prescribedSets.length,
      attemptedPrescribedSetCount: 0,
      successfulPrescribedSetCount: 0,
      marginalMissCount: 0,
      substantialMissCount: 0,
      neutralSetCount: 0,
      ineligibleSetCount: prescribedSets.length,
      missingWorkingSetOrdinals: [],
      ignoredUnprescribedSetCount,
      nudgedSetPresent: false,
      nudgedSetAchieved: null,
      nudgedSetOutcome: null,
      nudgedWorkingSetOrdinal: null,
      setResults: [],
    };
  }

  // 3. Structural validation of workingSetOrdinal
  let invalidOrdinal = false;
  for (const set of prescribedSets) {
    const ordinal = set.prescriptionSnapshot?.workingSetOrdinal;
    if (
      typeof ordinal !== 'number' ||
      !Number.isFinite(ordinal) ||
      !Number.isInteger(ordinal) ||
      ordinal < 1 ||
      ordinal > expectedPrescribedSetCount
    ) {
      invalidOrdinal = true;
      break;
    }
  }

  if (invalidOrdinal) {
    return {
      outcome: 'ineligible',
      reason: 'INVALID_PRESCRIBED_ORDINAL',
      expectedPrescribedSetCount,
      observedPrescribedSetCount: prescribedSets.length,
      attemptedPrescribedSetCount: 0,
      successfulPrescribedSetCount: 0,
      marginalMissCount: 0,
      substantialMissCount: 0,
      neutralSetCount: 0,
      ineligibleSetCount: prescribedSets.length,
      missingWorkingSetOrdinals: [],
      ignoredUnprescribedSetCount,
      nudgedSetPresent: false,
      nudgedSetAchieved: null,
      nudgedSetOutcome: null,
      nudgedWorkingSetOrdinal: null,
      setResults: [],
    };
  }

  // 4. Duplicate ordinal validation
  const seenOrdinals = new Set<number>();
  let duplicateOrdinal = false;

  for (const set of prescribedSets) {
    const ordinal = set.prescriptionSnapshot!.workingSetOrdinal;
    if (seenOrdinals.has(ordinal)) {
      duplicateOrdinal = true;
      break;
    }
    seenOrdinals.add(ordinal);
  }

  if (duplicateOrdinal) {
    return {
      outcome: 'ineligible',
      reason: 'DUPLICATE_PRESCRIBED_ORDINAL',
      expectedPrescribedSetCount,
      observedPrescribedSetCount: prescribedSets.length,
      attemptedPrescribedSetCount: 0,
      successfulPrescribedSetCount: 0,
      marginalMissCount: 0,
      substantialMissCount: 0,
      neutralSetCount: 0,
      ineligibleSetCount: prescribedSets.length,
      missingWorkingSetOrdinals: [],
      ignoredUnprescribedSetCount,
      nudgedSetPresent: false,
      nudgedSetAchieved: null,
      nudgedSetOutcome: null,
      nudgedWorkingSetOrdinal: null,
      setResults: [],
    };
  }

  // 5. Cross-set snapshot consistency validation
  const firstSnapshot = prescribedSets[0].prescriptionSnapshot!;
  const expectedConfirmedStep = firstSnapshot.confirmedStepIndexBefore;
  const expectedPresentedStep = firstSnapshot.presentedStepIndex;
  const expectedSuccessCreditEligible = firstSnapshot.successCreditEligible;
  const expectedCoachingReasonCode = firstSnapshot.coachingReasonCode;
  const expectedSnapshotVersion = firstSnapshot.snapshotVersion;
  const expectedPolicyVersion = firstSnapshot.progressionPolicyVersion;
  const expectedAlgorithmVersion = firstSnapshot.algorithmVersion;
  const expectedExerciseKey = firstSnapshot.exerciseKey;
  const expectedExerciseRole = firstSnapshot.exerciseRole;
  const expectedModality = firstSnapshot.modality;
  const expectedLaneKey = firstSnapshot.comparableLaneKey;
  const expectedLoadBasis = firstSnapshot.loadBasis;

  let inconsistentSnapshots = false;
  for (let i = 1; i < prescribedSets.length; i++) {
    const s = prescribedSets[i].prescriptionSnapshot!;
    if (
      s.confirmedStepIndexBefore !== expectedConfirmedStep ||
      s.presentedStepIndex !== expectedPresentedStep ||
      s.successCreditEligible !== expectedSuccessCreditEligible ||
      s.coachingReasonCode !== expectedCoachingReasonCode ||
      s.snapshotVersion !== expectedSnapshotVersion ||
      s.progressionPolicyVersion !== expectedPolicyVersion ||
      s.algorithmVersion !== expectedAlgorithmVersion ||
      s.exerciseKey !== expectedExerciseKey ||
      s.exerciseRole !== expectedExerciseRole ||
      s.modality !== expectedModality ||
      s.comparableLaneKey !== expectedLaneKey ||
      s.loadBasis !== expectedLoadBasis
    ) {
      inconsistentSnapshots = true;
      break;
    }
  }

  if (inconsistentSnapshots) {
    return {
      outcome: 'ineligible',
      reason: 'INCONSISTENT_PRESCRIBED_SNAPSHOTS',
      expectedPrescribedSetCount,
      observedPrescribedSetCount: prescribedSets.length,
      attemptedPrescribedSetCount: 0,
      successfulPrescribedSetCount: 0,
      marginalMissCount: 0,
      substantialMissCount: 0,
      neutralSetCount: 0,
      ineligibleSetCount: prescribedSets.length,
      missingWorkingSetOrdinals: [],
      ignoredUnprescribedSetCount,
      nudgedSetPresent: false,
      nudgedSetAchieved: null,
      nudgedSetOutcome: null,
      nudgedWorkingSetOrdinal: null,
      setResults: [],
    };
  }

  // 6. Nudge marker and step advancement relationship validation
  const activeNudgeSets = prescribedSets.filter(s =>
    isActivelyNudged(s.prescriptionSnapshot!)
  );

  if (activeNudgeSets.length > 1) {
    return {
      outcome: 'ineligible',
      reason: 'MULTIPLE_NUDGE_MARKERS',
      expectedPrescribedSetCount,
      observedPrescribedSetCount: prescribedSets.length,
      attemptedPrescribedSetCount: 0,
      successfulPrescribedSetCount: 0,
      marginalMissCount: 0,
      substantialMissCount: 0,
      neutralSetCount: 0,
      ineligibleSetCount: prescribedSets.length,
      missingWorkingSetOrdinals: [],
      ignoredUnprescribedSetCount,
      nudgedSetPresent: true,
      nudgedSetAchieved: null,
      nudgedSetOutcome: null,
      nudgedWorkingSetOrdinal: null,
      setResults: [],
    };
  }

  const isStepAdvanced = expectedPresentedStep === expectedConfirmedStep + 1;
  const isAdvancedReason =
    expectedCoachingReasonCode === 'REP_NUDGE' ||
    expectedCoachingReasonCode === 'LOAD_NUDGE_MAIN_MOVEMENT' ||
    expectedCoachingReasonCode === 'LOAD_PROMOTION_CEILING_REACHED' ||
    expectedCoachingReasonCode === 'NUDGE_NEUTRAL_RETRY';

  const buildInvalidNudgeStepResult = (): GuidedExerciseOutcomeResult => ({
    outcome: 'ineligible',
    reason: 'INVALID_NUDGE_STEP_RELATIONSHIP',
    expectedPrescribedSetCount,
    observedPrescribedSetCount: prescribedSets.length,
    attemptedPrescribedSetCount: 0,
    successfulPrescribedSetCount: 0,
    marginalMissCount: 0,
    substantialMissCount: 0,
    neutralSetCount: 0,
    ineligibleSetCount: prescribedSets.length,
    missingWorkingSetOrdinals: [],
    ignoredUnprescribedSetCount,
    nudgedSetPresent: activeNudgeSets.length > 0,
    nudgedSetAchieved: null,
    nudgedSetOutcome: null,
    nudgedWorkingSetOrdinal: null,
    setResults: [],
  });

  if (isStepAdvanced) {
    if (!isAdvancedReason) {
      return buildInvalidNudgeStepResult();
    }
    if (activeNudgeSets.length === 0) {
      return buildInvalidNudgeStepResult();
    }
    const markerType = activeNudgeSets[0].prescriptionSnapshot!.nudgeType;
    if (expectedCoachingReasonCode === 'REP_NUDGE' && markerType !== 'rep_nudge') {
      return buildInvalidNudgeStepResult();
    }
    if (
      (expectedCoachingReasonCode === 'LOAD_NUDGE_MAIN_MOVEMENT' ||
        expectedCoachingReasonCode === 'LOAD_PROMOTION_CEILING_REACHED') &&
      markerType !== 'load_nudge'
    ) {
      return buildInvalidNudgeStepResult();
    }
    if (
      expectedCoachingReasonCode === 'NUDGE_NEUTRAL_RETRY' &&
      markerType !== 'rep_nudge' &&
      markerType !== 'load_nudge'
    ) {
      return buildInvalidNudgeStepResult();
    }
  } else {
    // Stable step
    if (isAdvancedReason) {
      return buildInvalidNudgeStepResult();
    }
    if (activeNudgeSets.length > 0) {
      return buildInvalidNudgeStepResult();
    }
  }

  // 6. Missing ordinals detection
  const missingWorkingSetOrdinals: number[] = [];
  for (let i = 1; i <= expectedPrescribedSetCount; i++) {
    if (!seenOrdinals.has(i)) {
      missingWorkingSetOrdinals.push(i);
    }
  }

  // 7. Evaluate each prescribed set with classifyGuidedSetOutcome
  const setResults: Array<{
    workingSetOrdinal: number;
    result: GuidedSetOutcomeResult;
  }> = [];

  let successfulPrescribedSetCount = 0;
  let marginalMissCount = 0;
  let substantialMissCount = 0;
  let neutralSetCount = 0;
  let ineligibleSetCount = 0;

  for (const set of prescribedSets) {
    const result = classifyGuidedSetOutcome({ set, exercise, workout });
    const workingSetOrdinal = set.prescriptionSnapshot!.workingSetOrdinal;
    setResults.push({ workingSetOrdinal, result });

    switch (result.outcome) {
      case 'success':
        successfulPrescribedSetCount++;
        break;
      case 'marginal_miss':
        marginalMissCount++;
        break;
      case 'substantial_miss':
        substantialMissCount++;
        break;
      case 'neutral':
        neutralSetCount++;
        break;
      case 'ineligible':
        ineligibleSetCount++;
        break;
    }
  }

  // Sort setResults by workingSetOrdinal ascending
  setResults.sort((a, b) => a.workingSetOrdinal - b.workingSetOrdinal);

  const attemptedPrescribedSetCount = prescribedSets.filter(
    s => !s.isSkipped && exercise.isSkipped !== true
  ).length;

  // 8. Resolve Nudge diagnostics
  let nudgedSetPresent = false;
  let nudgedSetAchieved: boolean | null = null;
  let nudgedSetOutcome: GuidedSetOutcome | null = null;
  let nudgedWorkingSetOrdinal: number | null = null;

  if (activeNudgeSets.length === 1) {
    nudgedSetPresent = true;
    nudgedWorkingSetOrdinal = activeNudgeSets[0].prescriptionSnapshot!.workingSetOrdinal;
    const nudgedEntry = setResults.find(
      sr => sr.workingSetOrdinal === nudgedWorkingSetOrdinal
    );
    if (nudgedEntry) {
      nudgedSetOutcome = nudgedEntry.result.outcome;
      if (
        nudgedEntry.result.outcome === 'success' &&
        nudgedEntry.result.targetAchieved === true
      ) {
        nudgedSetAchieved = true;
      } else if (
        nudgedEntry.result.outcome === 'marginal_miss' ||
        nudgedEntry.result.outcome === 'substantial_miss'
      ) {
        nudgedSetAchieved = false;
      } else {
        nudgedSetAchieved = null;
      }
    }
  }

  // 9. Exercise Aggregation Precedence
  let outcome: GuidedExerciseOutcome;
  let reason: GuidedExerciseOutcomeReason;

  if (ineligibleSetCount > 0) {
    outcome = 'ineligible';
    reason = 'STRUCTURALLY_CORRUPT_SET';
  } else if (neutralSetCount > 0) {
    outcome = 'neutral';
    reason = 'PRESCRIBED_SET_SKIPPED';
  } else if (missingWorkingSetOrdinals.length > 0) {
    outcome = 'neutral';
    reason = 'PRESCRIBED_SET_MISSING';
  } else if (substantialMissCount > 0) {
    outcome = 'substantial_miss';
    reason = 'PRESCRIBED_SET_SUBSTANTIAL_MISS';
  } else if (marginalMissCount >= 2) {
    outcome = 'substantial_miss';
    reason = 'MULTIPLE_MARGINAL_MISSES';
  } else if (marginalMissCount === 1) {
    outcome = 'marginal_miss';
    reason = 'SINGLE_MARGINAL_MISS';
  } else if (successfulPrescribedSetCount === expectedPrescribedSetCount) {
    outcome = 'success';
    reason = 'ALL_PRESCRIBED_SETS_ACHIEVED';
  } else {
    outcome = 'ineligible';
    reason = 'STRUCTURALLY_CORRUPT_SET';
  }

  return {
    outcome,
    reason,
    expectedPrescribedSetCount,
    observedPrescribedSetCount: prescribedSets.length,
    attemptedPrescribedSetCount,
    successfulPrescribedSetCount,
    marginalMissCount,
    substantialMissCount,
    neutralSetCount,
    ineligibleSetCount,
    missingWorkingSetOrdinals,
    ignoredUnprescribedSetCount,
    nudgedSetPresent,
    nudgedSetAchieved,
    nudgedSetOutcome,
    nudgedWorkingSetOrdinal,
    setResults,
  };
}
