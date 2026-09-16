/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateGuidedCandidateComparison,
  extractUsableCompletedPerformance,
  findMostRecentCompletedPerformanceForOrdinal,
  CandidateSetTarget,
} from '../guidedCandidateComparison';

// Alias representing the real production candidate comparison authority
const compareGuidedCandidatesToHistory = evaluateGuidedCandidateComparison;
import {
  ComparableGuidedExposure,
  ComparableGuidedSetDetail,
} from '../guidedHistoryCollector';
import {
  PrescriptionSnapshot,
  SetEntry,
  ExerciseModality,
  WeightUnit,
} from '../../types';
import { convertWeightUnit } from '../adaptiveProgressionMath';

describe('guidedCandidateComparison', () => {
  // Helper to build a test snapshot
  const createSnapshot = (
    ordinal: number,
    overrides?: Partial<PrescriptionSnapshot>
  ): PrescriptionSnapshot => ({
    snapshotVersion: 2,
    progressionPolicyVersion: 1,
    algorithmVersion: 1,
    progressionMode: 'metreps_guided',
    algorithmId: 'hypertrophy_linear',
    exerciseKey: 'bench_press_standard',
    exerciseRole: 'accessory',
    modality: 'weighted',
    comparableLaneKey: 'bench_press_flat_standard',
    workingSetOrdinal: ordinal,
    prescribedWorkingSetCount: 3,
    baseWeight: 100,
    baseReps: 8,
    baseRpe: 8.0,
    presentedWeight: 100,
    presentedReps: 8,
    presentedRpe: 8.0,
    bodyweightSnapshot: null,
    weightUnit: 'kg',
    comparisonLoadKg: 100,
    loadBasis: 'external_weight_v1',
    loadIncrement: 2.5,
    nudgeType: 'none',
    coachingReasonCode: 'BASE_PRESCRIPTION',
    confirmedStepIndexBefore: 0,
    presentedStepIndex: 0,
    successCreditEligible: true,
    rollbackTarget: null,
    ...overrides,
  });

  // Helper to build a test set detail
  const createSetDetail = (
    ordinal: number,
    setEntryOverrides?: Partial<SetEntry>,
    snapshotOverrides?: Partial<PrescriptionSnapshot>
  ): ComparableGuidedSetDetail => {
    const snapshot = createSnapshot(ordinal, snapshotOverrides);
    const setEntry: SetEntry = {
      setNumber: ordinal,
      weight: 100,
      reps: 8,
      rpe: 8.0,
      isCompleted: true,
      isSkipped: false,
      isWarmup: false,
      isDropSet: false,
      form: 'standard',
      ...setEntryOverrides,
    };

    return {
      workingSetOrdinal: ordinal,
      snapshot,
      setEntry,
      setResult: {
        outcome: 'success',
        reason: 'TARGET_ACHIEVED_EXACT',
        targetAchieved: true,
        extraCapacityCreditEligible: false,
        rpeSource: 'explicit',
        actualComparisonLoadKg: setEntry.weight ?? null,
        presentedComparisonLoadKg: snapshot.comparisonLoadKg,
        presentedCapacityIndex: null,
        actualCapacityIndex: null,
        relativePerformance: null,
      },
    };
  };

  // Helper to build a test exposure
  const createExposure = (options: {
    workoutLogId: string;
    workoutDate: string;
    workoutTimestampMs?: number | null;
    modality?: ExerciseModality;
    weightUnit?: WeightUnit;
    sets?: ComparableGuidedSetDetail[];
  }): ComparableGuidedExposure => {
    const modality = options.modality ?? 'weighted';
    const weightUnit = options.weightUnit ?? 'kg';
    const sets =
      options.sets ??
      [1, 2, 3].map(ord =>
        createSetDetail(ord, {}, { modality, weightUnit })
      );

    return {
      workoutLogId: options.workoutLogId,
      workoutDate: options.workoutDate,
      workoutTimestampMs: options.workoutTimestampMs ?? null,
      scheduledDate: null,
      programId: 'prog-1',
      cycleIndex: 0,
      lineagePosition: 0,
      week: 1,
      day: 1,
      exerciseIndex: 0,
      exerciseKey: 'bench_press_standard',
      exerciseRole: 'accessory',
      modality,
      comparableLaneKey: 'bench_press_flat_standard',
      prescribedWorkingSetCount: sets.length,
      weightUnit,
      sets,
      nudgedWorkingSetOrdinal: null,
      nudgedSetOutcome: null,
      nudgedSetAchieved: null,
      classification: {
        outcome: 'success',
        reason: 'ALL_PRESCRIBED_SETS_ACHIEVED',
        expectedPrescribedSetCount: sets.length,
        observedPrescribedSetCount: sets.length,
        attemptedPrescribedSetCount: sets.length,
        successfulPrescribedSetCount: sets.length,
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
      },
    };
  };

  describe('Requirement 6A: Actual Performance Authority', () => {
    it('uses actual performed weight and reps instead of snapshot targets', () => {
      // Snapshot target prescribed 100 kg x 8, but user performed 95 kg x 7
      const set1 = createSetDetail(
        1,
        { weight: 95, reps: 7, rpe: 8.0, isCompleted: true },
        { presentedWeight: 100, presentedReps: 8, baseWeight: 100, baseReps: 8 }
      );
      const exposure = createExposure({
        workoutLogId: 'w-1',
        workoutDate: '2026-08-01',
        sets: [set1],
      });

      const cand: CandidateSetTarget = {
        workingSetOrdinal: 1,
        weight: 95,
        reps: 7,
        rpe: 8.0,
      };

      const result = evaluateGuidedCandidateComparison({
        candidateTargets: [cand],
        history: [exposure],
      });

      expect(result.status).toBe('pass');
      const ordRes = result.ordinalResults[0];
      expect(ordRes.referenceProvenance).not.toBeNull();
      expect(ordRes.referenceProvenance?.performedWeight).toBe(95);
      expect(ordRes.referenceProvenance?.performedReps).toBe(7);
      expect(ordRes.referenceComparisonLoadKg).toBe(95);
      // Challenge against performed 95kg x 7 is 0.0, NOT measured against 100kg x 8
      expect(ordRes.relativeChallenge).toBeCloseTo(0.0, 6);
    });

    it('proves that uncompleted targets or uncompleted sets cannot become factual references', () => {
      // Set 1 in w-2 was NOT completed (isCompleted: false)
      const setUncompleted = createSetDetail(
        1,
        { weight: 110, reps: 8, rpe: 8.0, isCompleted: false },
        { presentedWeight: 110 }
      );
      const expUncompleted = createExposure({
        workoutLogId: 'w-2',
        workoutDate: '2026-08-05',
        sets: [setUncompleted],
      });

      // Set 1 in w-1 was completed (isCompleted: true) with 100 kg x 8
      const setCompleted = createSetDetail(
        1,
        { weight: 100, reps: 8, rpe: 8.0, isCompleted: true },
        { presentedWeight: 100 }
      );
      const expCompleted = createExposure({
        workoutLogId: 'w-1',
        workoutDate: '2026-08-01',
        sets: [setCompleted],
      });

      const cand: CandidateSetTarget = {
        workingSetOrdinal: 1,
        weight: 102.5,
        reps: 8,
        rpe: 8.0,
      };

      // When searching history, w-2 is newer, but must be skipped because it is uncompleted.
      // Provenance must fall back to w-1 (100 kg), NOT w-2 (110 kg uncompleted target).
      const result = evaluateGuidedCandidateComparison({
        candidateTargets: [cand],
        history: [expUncompleted, expCompleted],
      });

      expect(result.status).toBe('pass');
      expect(result.ordinalResults[0].referenceProvenance?.workoutLogId).toBe('w-1');
      expect(result.ordinalResults[0].referenceComparisonLoadKg).toBe(100);
      expect(result.ordinalResults[0].relativeChallenge).toBeCloseTo(0.025, 4); // (102.5 - 100) / 100 = +2.5%
    });
  });

  describe('Requirement 6B: Different Repetitions (20kg x 12 @ 8 vs 22.5kg x 8 @ 8)', () => {
    it('measures capacity challenge of approximately -4.4986%, passing the cap despite 12.5% load increase', () => {
      // Reference: 20 kg x 12 @ RPE 8
      // RTS multiplier for 12 reps @ RPE 8.0 = 0.618
      // Reference capacity = 20 / 0.618 = 32.362459...
      const set1 = createSetDetail(1, { weight: 20, reps: 12, rpe: 8.0, isCompleted: true });
      const exposure = createExposure({
        workoutLogId: 'w-1',
        workoutDate: '2026-08-01',
        sets: [set1],
      });

      // Candidate: 22.5 kg x 8 @ RPE 8
      // RTS multiplier for 8 reps @ RPE 8.0 = 0.728
      // Candidate capacity = 22.5 / 0.728 = 30.906593...
      const candidate: CandidateSetTarget = {
        workingSetOrdinal: 1,
        weight: 22.5,
        reps: 8,
        rpe: 8.0,
      };

      const result = evaluateGuidedCandidateComparison({
        candidateTargets: [candidate],
        history: [exposure],
      });

      expect(result.status).toBe('pass');
      expect(result.rawAggregatePassed).toBe(true);

      const ordRes = result.ordinalResults[0];
      expect(ordRes.isWithinRawCap).toBe(true);
      expect(ordRes.status).toBe('pass');
      // Relative challenge = (30.906593... - 32.362459...) / 32.362459... = -0.04498626...
      expect(ordRes.relativeChallenge).toBeCloseTo(-0.044986, 5);
      expect(ordRes.relativeChallenge).toBeLessThan(0);
    });
  });

  describe('Requirement 6C: Hypothetical-Base Substitution (100kg factual vs 112.5kg candidate)', () => {
    it('fails the 5% factual challenge cap at +12.5% and rejects hypothetical base substitution', () => {
      // Factual completed load: 100 kg x 8 @ RPE 8
      const set1 = createSetDetail(
        1,
        { weight: 100, reps: 8, rpe: 8.0, isCompleted: true },
        // Even if snapshot had an uncompleted base proposal of 110 kg:
        { baseWeight: 110, presentedWeight: 110 }
      );
      const exposure = createExposure({
        workoutLogId: 'w-1',
        workoutDate: '2026-08-01',
        sets: [set1],
      });

      // Candidate: 112.5 kg x 8 @ RPE 8
      // Candidate vs factual (100 kg): +12.5% (FAIL)
      // Candidate vs hypothetical base (110 kg): would be +2.27% (BANNED SUBSTITUTION)
      const candidate: CandidateSetTarget = {
        workingSetOrdinal: 1,
        weight: 112.5,
        reps: 8,
        rpe: 8.0,
      };

      const result = evaluateGuidedCandidateComparison({
        candidateTargets: [candidate],
        history: [exposure],
      });

      expect(result.status).toBe('fail');
      expect(result.rawAggregatePassed).toBe(false);

      const ordRes = result.ordinalResults[0];
      expect(ordRes.status).toBe('fail');
      expect(ordRes.isWithinRawCap).toBe(false);
      expect(ordRes.referenceComparisonLoadKg).toBe(100); // Must be 100, NOT 110
      expect(ordRes.relativeChallenge).toBeCloseTo(0.125, 6); // Exactly +12.5%
    });
  });

  describe('Requirement 6D: Combined Changes', () => {
    it('rejects candidate 102.5kg x 9 @ 8 when compared against factual 100kg x 8 @ 8 (+6.2963%)', () => {
      // Reference: 100 kg x 8 @ RPE 8
      // RTS[8][8.0] = 0.728 -> refCapacity = 100 / 0.728 = 137.3626...
      const set1 = createSetDetail(1, { weight: 100, reps: 8, rpe: 8.0, isCompleted: true });
      const exposure = createExposure({
        workoutLogId: 'w-1',
        workoutDate: '2026-08-01',
        sets: [set1],
      });

      // Candidate: 102.5 kg x 9 @ RPE 8
      // RTS[9][8.0] = 0.702 -> candCapacity = 102.5 / 0.702 = 146.01139...
      // Challenge = (146.01139 - 137.3626) / 137.3626 = +0.062963 (+6.2963%)
      const candidate: CandidateSetTarget = {
        workingSetOrdinal: 1,
        weight: 102.5,
        reps: 9,
        rpe: 8.0,
      };

      const result = evaluateGuidedCandidateComparison({
        candidateTargets: [candidate],
        history: [exposure],
      });

      expect(result.status).toBe('fail');
      expect(result.rawAggregatePassed).toBe(false);
      const ordRes = result.ordinalResults[0];
      expect(ordRes.status).toBe('fail');
      expect(ordRes.isWithinRawCap).toBe(false);
      expect(ordRes.relativeChallenge).toBeCloseTo(0.062963, 5);
    });

    it('passes candidate 102.5kg x 9 @ 8 when compared against factual 100kg x 9 @ 8 (+2.5%)', () => {
      // Contrast: Reference already completed 100 kg x 9 @ RPE 8
      const set1 = createSetDetail(1, { weight: 100, reps: 9, rpe: 8.0, isCompleted: true });
      const exposure = createExposure({
        workoutLogId: 'w-1',
        workoutDate: '2026-08-01',
        sets: [set1],
      });

      const candidate: CandidateSetTarget = {
        workingSetOrdinal: 1,
        weight: 102.5,
        reps: 9,
        rpe: 8.0,
      };

      const result = evaluateGuidedCandidateComparison({
        candidateTargets: [candidate],
        history: [exposure],
      });

      expect(result.status).toBe('pass');
      expect(result.rawAggregatePassed).toBe(true);
      const ordRes = result.ordinalResults[0];
      expect(ordRes.status).toBe('pass');
      expect(ordRes.isWithinRawCap).toBe(true);
      expect(ordRes.relativeChallenge).toBeCloseTo(0.025, 6); // +2.5%
    });
  });

  describe('Requirement 6E: Per-Set Independence', () => {
    it('evaluates each ordinal independently without leaking Set 1 to other sets', () => {
      // Factual history: Set 1 = 100 kg, Set 2 = 50 kg, Set 3 = 25 kg (all 8 reps @ RPE 8)
      const sets = [
        createSetDetail(1, { weight: 100, reps: 8, rpe: 8.0 }),
        createSetDetail(2, { weight: 50, reps: 8, rpe: 8.0 }),
        createSetDetail(3, { weight: 25, reps: 8, rpe: 8.0 }),
      ];
      const exposure = createExposure({
        workoutLogId: 'w-1',
        workoutDate: '2026-08-01',
        sets,
      });

      // Candidates: Set 1 = 102.5 (+2.5%), Set 2 = 52.5 (+5.0%), Set 3 = 27.5 (+10.0%)
      const candidates: CandidateSetTarget[] = [
        { workingSetOrdinal: 1, weight: 102.5, reps: 8, rpe: 8.0 },
        { workingSetOrdinal: 2, weight: 52.5, reps: 8, rpe: 8.0 },
        { workingSetOrdinal: 3, weight: 27.5, reps: 8, rpe: 8.0 },
      ];

      const result = evaluateGuidedCandidateComparison({
        candidateTargets: candidates,
        history: [exposure],
      });

      expect(result.allComparisonsValid).toBe(true);
      expect(result.rawAggregatePassed).toBe(false);
      expect(result.status).toBe('fail');

      // Set 1: (102.5 - 100) / 100 = +2.5% -> PASS
      expect(result.ordinalResults[0].workingSetOrdinal).toBe(1);
      expect(result.ordinalResults[0].relativeChallenge).toBeCloseTo(0.025, 4);
      expect(result.ordinalResults[0].isWithinRawCap).toBe(true);
      expect(result.ordinalResults[0].status).toBe('pass');

      // Set 2: (52.5 - 50) / 50 = +5.0% -> PASS (exact cap boundary)
      expect(result.ordinalResults[1].workingSetOrdinal).toBe(2);
      expect(result.ordinalResults[1].relativeChallenge).toBeCloseTo(0.05, 4);
      expect(result.ordinalResults[1].isWithinRawCap).toBe(true);
      expect(result.ordinalResults[1].status).toBe('pass');

      // Set 3: (27.5 - 25) / 25 = +10.0% -> FAIL (exceeds 5%)
      expect(result.ordinalResults[2].workingSetOrdinal).toBe(3);
      expect(result.ordinalResults[2].relativeChallenge).toBeCloseTo(0.10, 4);
      expect(result.ordinalResults[2].isWithinRawCap).toBe(false);
      expect(result.ordinalResults[2].status).toBe('fail');
    });
  });

  describe('Requirement 6F: Modalities and Units', () => {
    it('handles canonical lb to kg unit conversion accurately', () => {
      // Reference: 220.46226218 lb (= 100 kg) x 8 @ RPE 8
      const lbWeight = 220.46226218;
      const set1 = createSetDetail(
        1,
        { weight: lbWeight, reps: 8, rpe: 8.0 },
        { weightUnit: 'lb', comparisonLoadKg: 100 }
      );
      const exposure = createExposure({
        workoutLogId: 'w-lb',
        workoutDate: '2026-08-01',
        weightUnit: 'lb',
        sets: [set1],
      });

      // Candidate specified in kg: 102.5 kg x 8 @ RPE 8 (+2.5%)
      const candidate: CandidateSetTarget = {
        workingSetOrdinal: 1,
        weight: 102.5,
        reps: 8,
        rpe: 8.0,
        unit: 'kg',
      };

      const result = evaluateGuidedCandidateComparison({
        candidateTargets: [candidate],
        history: [exposure],
      });

      expect(result.status).toBe('pass');
      expect(result.ordinalResults[0].referenceComparisonLoadKg).toBeCloseTo(100.0, 4);
      expect(result.ordinalResults[0].candidateComparisonLoadKg).toBeCloseTo(102.5, 4);
      expect(result.ordinalResults[0].relativeChallenge).toBeCloseTo(0.025, 4);
    });

    it('handles bodyweight modality using historical bodyweight, not current bodyweight', () => {
      // Historical bodyweight was 75 kg
      const set1 = createSetDetail(
        1,
        { weight: 0, reps: 10, rpe: 8.0 },
        { modality: 'bodyweight', bodyweightSnapshot: 75, loadBasis: 'bodyweight_normalized_v1', comparisonLoadKg: 75 }
      );
      const exposure = createExposure({
        workoutLogId: 'w-bw',
        workoutDate: '2026-08-01',
        modality: 'bodyweight',
        sets: [set1],
      });

      // Current candidate on 80 kg bodyweight (user gained weight or current BW differs)
      // Candidate: bodyweight with candidate bodyweight 76.5 kg (+2.0% challenge)
      const candidate: CandidateSetTarget = {
        workingSetOrdinal: 1,
        weight: 0,
        reps: 10,
        rpe: 8.0,
        modality: 'bodyweight',
        bodyweight: 76.5,
      };

      const result = evaluateGuidedCandidateComparison({
        candidateTargets: [candidate],
        history: [exposure],
        laneMetadata: {
          modality: 'bodyweight',
          currentBodyweight: 85, // Even if current bodyweight in metadata is 85
        },
      });

      expect(result.status).toBe('pass');
      const ordRes = result.ordinalResults[0];
      expect(ordRes.referenceComparisonLoadKg).toBe(75); // Historical bodyweight preserved!
      expect(ordRes.candidateComparisonLoadKg).toBe(76.5);
      expect(ordRes.relativeChallenge).toBeCloseTo((76.5 - 75) / 75, 4);
    });

    it('handles assisted exercise: net load = bodyweight - assistance', () => {
      // Historical: BW 80 kg, assistance 20 kg -> net load = 60 kg x 8 @ RPE 8
      const set1 = createSetDetail(
        1,
        { weight: 20, reps: 8, rpe: 8.0 },
        { modality: 'assisted', bodyweightSnapshot: 80, loadBasis: 'assisted_net_normalized_v1', comparisonLoadKg: 60 }
      );
      const exposure = createExposure({
        workoutLogId: 'w-assist',
        workoutDate: '2026-08-01',
        modality: 'assisted',
        sets: [set1],
      });

      // Candidate: lower assistance to 17.5 kg (increasing net load to 62.5 kg)
      // Challenge = (62.5 - 60) / 60 = +2.5 / 60 = +4.1666% (<= 5% PASS)
      const candidate: CandidateSetTarget = {
        workingSetOrdinal: 1,
        weight: 17.5,
        reps: 8,
        rpe: 8.0,
        modality: 'assisted',
        bodyweight: 80,
      };

      const result = evaluateGuidedCandidateComparison({
        candidateTargets: [candidate],
        history: [exposure],
        laneMetadata: { modality: 'assisted', currentBodyweight: 80 },
      });

      expect(result.status).toBe('pass');
      const ordRes = result.ordinalResults[0];
      expect(ordRes.referenceComparisonLoadKg).toBe(60);
      expect(ordRes.candidateComparisonLoadKg).toBe(62.5);
      expect(ordRes.relativeChallenge).toBeCloseTo(0.041667, 5);
      expect(ordRes.isWithinRawCap).toBe(true);
    });

    it('rejects invalid candidate assistance (assistance >= bodyweight)', () => {
      const set1 = createSetDetail(
        1,
        { weight: 20, reps: 8, rpe: 8.0 },
        { modality: 'assisted', bodyweightSnapshot: 80, comparisonLoadKg: 60 }
      );
      const exposure = createExposure({
        workoutLogId: 'w-assist',
        workoutDate: '2026-08-01',
        modality: 'assisted',
        sets: [set1],
      });

      // Invalid candidate assistance: 85 kg on 80 kg BW
      const candidate: CandidateSetTarget = {
        workingSetOrdinal: 1,
        weight: 85,
        reps: 8,
        rpe: 8.0,
        modality: 'assisted',
        bodyweight: 80,
      };

      const result = evaluateGuidedCandidateComparison({
        candidateTargets: [candidate],
        history: [exposure],
      });

      expect(result.status).toBe('invalid_input');
      expect(result.ordinalResults[0].status).toBe('invalid_candidate');
      expect(result.ordinalResults[0].diagnosticCode).toBe('INVALID_CANDIDATE_LOAD');
    });

    it('verifies equivalent physical resistance for weighted modality: factual 100 lb vs candidate 45.359237 kg', () => {
      const lbWeight = 100;
      const kgWeight = 45.359237;
      const set1 = createSetDetail(
        1,
        { weight: lbWeight, reps: 8, rpe: 8.0 },
        { weightUnit: 'lb', comparisonLoadKg: kgWeight }
      );
      const exposure = createExposure({
        workoutLogId: 'w-weighted-cross-lb',
        workoutDate: '2026-08-01',
        weightUnit: 'lb',
        sets: [set1],
      });

      const candidate: CandidateSetTarget = {
        workingSetOrdinal: 1,
        weight: kgWeight,
        reps: 8,
        rpe: 8.0,
        unit: 'kg',
      };

      const result = compareGuidedCandidatesToHistory({
        candidateTargets: [candidate],
        history: [exposure],
      });

      expect(result.status).toBe('pass');
      expect(result.rawAggregatePassed).toBe(true);
      expect(result.allComparisonsValid).toBe(true);
      const ordRes = result.ordinalResults[0];
      expect(ordRes.status).toBe('pass');
      expect(ordRes.referenceProvenance?.workoutLogId).toBe('w-weighted-cross-lb');
      expect(ordRes.referenceProvenance?.workingSetOrdinal).toBe(1);
      expect(ordRes.referenceComparisonLoadKg).toBeCloseTo(kgWeight, 5);
      expect(ordRes.candidateComparisonLoadKg).toBeCloseTo(kgWeight, 5);
      expect(Math.abs(ordRes.candidateComparisonLoadKg! - ordRes.referenceComparisonLoadKg!)).toBeLessThan(1e-5);
      expect(ordRes.candidateLoadEqualsReference).toBe(true);
      expect(ordRes.relativeChallenge).toBeCloseTo(0, 5);
      expect(ordRes.isWithinRawCap).toBe(true);
    });

    it('verifies equivalent physical resistance for weighted modality: factual 45.359237 kg vs candidate 100 lb', () => {
      const kgWeight = 45.359237;
      const lbWeight = 100;
      const set1 = createSetDetail(
        1,
        { weight: kgWeight, reps: 8, rpe: 8.0 },
        { weightUnit: 'kg', comparisonLoadKg: kgWeight }
      );
      const exposure = createExposure({
        workoutLogId: 'w-weighted-cross-kg',
        workoutDate: '2026-08-01',
        weightUnit: 'kg',
        sets: [set1],
      });

      const candidate: CandidateSetTarget = {
        workingSetOrdinal: 1,
        weight: lbWeight,
        reps: 8,
        rpe: 8.0,
        unit: 'lb',
      };

      const result = compareGuidedCandidatesToHistory({
        candidateTargets: [candidate],
        history: [exposure],
      });

      expect(result.status).toBe('pass');
      expect(result.rawAggregatePassed).toBe(true);
      expect(result.allComparisonsValid).toBe(true);
      const ordRes = result.ordinalResults[0];
      expect(ordRes.status).toBe('pass');
      expect(ordRes.referenceProvenance?.workoutLogId).toBe('w-weighted-cross-kg');
      expect(ordRes.referenceProvenance?.workingSetOrdinal).toBe(1);
      expect(ordRes.referenceComparisonLoadKg).toBeCloseTo(kgWeight, 5);
      expect(ordRes.candidateComparisonLoadKg).toBeCloseTo(kgWeight, 5);
      expect(Math.abs(ordRes.candidateComparisonLoadKg! - ordRes.referenceComparisonLoadKg!)).toBeLessThan(1e-5);
      expect(ordRes.candidateLoadEqualsReference).toBe(true);
      expect(ordRes.relativeChallenge).toBeCloseTo(0, 5);
      expect(ordRes.isWithinRawCap).toBe(true);
    });

    it('verifies equivalent physical resistance for bodyweight modality: factual 150 lb vs candidate kg', () => {
      const bwLb = 150;
      const expectedBwKg = convertWeightUnit(bwLb, 'lb', 'kg');
      const set1 = createSetDetail(
        1,
        { weight: 0, reps: 10, rpe: 8.0 },
        { modality: 'bodyweight', weightUnit: 'lb', bodyweightSnapshot: bwLb, comparisonLoadKg: expectedBwKg }
      );
      const exposure = createExposure({
        workoutLogId: 'w-bw-cross-lb',
        workoutDate: '2026-08-01',
        modality: 'bodyweight',
        weightUnit: 'lb',
        sets: [set1],
      });

      const candidate: CandidateSetTarget = {
        workingSetOrdinal: 1,
        weight: 0,
        reps: 10,
        rpe: 8.0,
        modality: 'bodyweight',
        unit: 'kg',
        bodyweight: expectedBwKg,
      };

      const result = compareGuidedCandidatesToHistory({
        candidateTargets: [candidate],
        history: [exposure],
      });

      expect(result.status).toBe('pass');
      expect(result.rawAggregatePassed).toBe(true);
      const ordRes = result.ordinalResults[0];
      expect(ordRes.status).toBe('pass');
      expect(ordRes.referenceProvenance?.workoutLogId).toBe('w-bw-cross-lb');
      expect(ordRes.referenceProvenance?.performedWeight).toBe(0);
      expect(candidate.weight).toBe(0);
      expect(ordRes.referenceComparisonLoadKg).toBeCloseTo(expectedBwKg, 5);
      expect(ordRes.candidateComparisonLoadKg).toBeCloseTo(expectedBwKg, 5);
      expect(Math.abs(ordRes.candidateComparisonLoadKg! - ordRes.referenceComparisonLoadKg!)).toBeLessThan(1e-5);
      expect(ordRes.candidateLoadEqualsReference).toBe(true);
      expect(ordRes.relativeChallenge).toBeCloseTo(0, 5);
      expect(ordRes.isWithinRawCap).toBe(true);
    });

    it('verifies equivalent physical resistance for bodyweight modality: factual 70 kg vs candidate lb', () => {
      const bwKg = 70;
      const bwLb = convertWeightUnit(bwKg, 'kg', 'lb');
      const set1 = createSetDetail(
        1,
        { weight: 0, reps: 10, rpe: 8.0 },
        { modality: 'bodyweight', weightUnit: 'kg', bodyweightSnapshot: bwKg, comparisonLoadKg: bwKg }
      );
      const exposure = createExposure({
        workoutLogId: 'w-bw-cross-kg',
        workoutDate: '2026-08-01',
        modality: 'bodyweight',
        weightUnit: 'kg',
        sets: [set1],
      });

      const candidate: CandidateSetTarget = {
        workingSetOrdinal: 1,
        weight: 0,
        reps: 10,
        rpe: 8.0,
        modality: 'bodyweight',
        unit: 'lb',
        bodyweight: bwLb,
      };

      const result = compareGuidedCandidatesToHistory({
        candidateTargets: [candidate],
        history: [exposure],
      });

      expect(result.status).toBe('pass');
      expect(result.rawAggregatePassed).toBe(true);
      const ordRes = result.ordinalResults[0];
      expect(ordRes.status).toBe('pass');
      expect(ordRes.referenceProvenance?.workoutLogId).toBe('w-bw-cross-kg');
      expect(ordRes.referenceProvenance?.performedWeight).toBe(0);
      expect(candidate.weight).toBe(0);
      expect(ordRes.referenceComparisonLoadKg).toBeCloseTo(bwKg, 5);
      expect(ordRes.candidateComparisonLoadKg).toBeCloseTo(bwKg, 5);
      expect(Math.abs(ordRes.candidateComparisonLoadKg! - ordRes.referenceComparisonLoadKg!)).toBeLessThan(1e-5);
      expect(ordRes.candidateLoadEqualsReference).toBe(true);
      expect(ordRes.relativeChallenge).toBeCloseTo(0, 5);
      expect(ordRes.isWithinRawCap).toBe(true);
    });

    it('verifies equivalent physical resistance for assisted modality: factual lb vs candidate kg', () => {
      const bwLb = 180;
      const assistanceLb = 40;
      const bwKg = convertWeightUnit(bwLb, 'lb', 'kg');
      const assistanceKg = convertWeightUnit(assistanceLb, 'lb', 'kg');
      const expectedNetKg = convertWeightUnit(140, 'lb', 'kg');

      const set1 = createSetDetail(
        1,
        { weight: assistanceLb, reps: 8, rpe: 8.0 },
        { modality: 'assisted', weightUnit: 'lb', bodyweightSnapshot: bwLb, comparisonLoadKg: expectedNetKg }
      );
      const exposure = createExposure({
        workoutLogId: 'w-assisted-cross-lb',
        workoutDate: '2026-08-01',
        modality: 'assisted',
        weightUnit: 'lb',
        sets: [set1],
      });

      const candidate: CandidateSetTarget = {
        workingSetOrdinal: 1,
        weight: assistanceKg,
        reps: 8,
        rpe: 8.0,
        modality: 'assisted',
        unit: 'kg',
        bodyweight: bwKg,
      };

      const result = compareGuidedCandidatesToHistory({
        candidateTargets: [candidate],
        history: [exposure],
      });

      expect(result.status).toBe('pass');
      expect(result.rawAggregatePassed).toBe(true);
      const ordRes = result.ordinalResults[0];
      expect(ordRes.status).toBe('pass');
      expect(ordRes.referenceProvenance?.workoutLogId).toBe('w-assisted-cross-lb');
      expect(ordRes.referenceComparisonLoadKg).toBeCloseTo(expectedNetKg, 5);
      expect(ordRes.candidateComparisonLoadKg).toBeCloseTo(expectedNetKg, 5);
      expect(Math.abs(ordRes.candidateComparisonLoadKg! - ordRes.referenceComparisonLoadKg!)).toBeLessThan(1e-5);
      expect(ordRes.candidateLoadEqualsReference).toBe(true);
      expect(ordRes.relativeChallenge).toBeCloseTo(0, 5);
      expect(ordRes.isWithinRawCap).toBe(true);
    });

    it('verifies equivalent physical resistance for assisted modality: factual kg vs candidate lb', () => {
      const bwKg = 80;
      const assistanceKg = 20;
      const expectedNetKg = 60;
      const bwLb = convertWeightUnit(bwKg, 'kg', 'lb');
      const assistanceLb = convertWeightUnit(assistanceKg, 'kg', 'lb');

      const set1 = createSetDetail(
        1,
        { weight: assistanceKg, reps: 8, rpe: 8.0 },
        { modality: 'assisted', weightUnit: 'kg', bodyweightSnapshot: bwKg, comparisonLoadKg: expectedNetKg }
      );
      const exposure = createExposure({
        workoutLogId: 'w-assisted-cross-kg',
        workoutDate: '2026-08-01',
        modality: 'assisted',
        weightUnit: 'kg',
        sets: [set1],
      });

      const candidate: CandidateSetTarget = {
        workingSetOrdinal: 1,
        weight: assistanceLb,
        reps: 8,
        rpe: 8.0,
        modality: 'assisted',
        unit: 'lb',
        bodyweight: bwLb,
      };

      const result = compareGuidedCandidatesToHistory({
        candidateTargets: [candidate],
        history: [exposure],
      });

      expect(result.status).toBe('pass');
      expect(result.rawAggregatePassed).toBe(true);
      const ordRes = result.ordinalResults[0];
      expect(ordRes.status).toBe('pass');
      expect(ordRes.referenceProvenance?.workoutLogId).toBe('w-assisted-cross-kg');
      expect(ordRes.referenceComparisonLoadKg).toBeCloseTo(expectedNetKg, 5);
      expect(ordRes.candidateComparisonLoadKg).toBeCloseTo(expectedNetKg, 5);
      expect(Math.abs(ordRes.candidateComparisonLoadKg! - ordRes.referenceComparisonLoadKg!)).toBeLessThan(1e-5);
      expect(ordRes.candidateLoadEqualsReference).toBe(true);
      expect(ordRes.relativeChallenge).toBeCloseTo(0, 5);
      expect(ordRes.isWithinRawCap).toBe(true);
    });

    it('negative control: identical displayed numbers across units (100 lb vs 100 kg) must compare as different loads and exceed 5% cap', () => {
      const set1 = createSetDetail(
        1,
        { weight: 100, reps: 8, rpe: 8.0 },
        { weightUnit: 'lb', comparisonLoadKg: convertWeightUnit(100, 'lb', 'kg') }
      );
      const exposure = createExposure({
        workoutLogId: 'w-neg-control-cross-unit',
        workoutDate: '2026-08-01',
        weightUnit: 'lb',
        sets: [set1],
      });

      // Candidate with identical displayed number 100, but in kg (100 kg is physically much heavier than 100 lb = 45.359237 kg)
      const candidate: CandidateSetTarget = {
        workingSetOrdinal: 1,
        weight: 100,
        reps: 8,
        rpe: 8.0,
        unit: 'kg',
      };

      const result = compareGuidedCandidatesToHistory({
        candidateTargets: [candidate],
        history: [exposure],
      });

      expect(result.status).toBe('fail');
      expect(result.rawAggregatePassed).toBe(false);
      const ordRes = result.ordinalResults[0];
      expect(ordRes.status).toBe('fail');
      expect(ordRes.referenceProvenance?.workoutLogId).toBe('w-neg-control-cross-unit');
      expect(ordRes.referenceComparisonLoadKg).toBeCloseTo(45.359237, 5);
      expect(ordRes.candidateComparisonLoadKg).toBeCloseTo(100.0, 5);
      expect(ordRes.candidateLoadEqualsReference).toBe(false);
      expect(ordRes.isWithinRawCap).toBe(false);
      // (100 - 45.359237) / 45.359237 = 54.640763 / 45.359237 = +1.204622... (+120.46%)
      expect(ordRes.relativeChallenge).toBeCloseTo(1.204623, 5);
      expect(ordRes.relativeChallenge).toBeGreaterThan(0.05);
    });
  });

  describe('Requirement 6G: Missing and Excluded Evidence', () => {
    it('returns unavailable when an ordinal is missing from history', () => {
      // History has only Set 1
      const set1 = createSetDetail(1, { weight: 100, reps: 8, rpe: 8.0 });
      const exposure = createExposure({
        workoutLogId: 'w-1',
        workoutDate: '2026-08-01',
        sets: [set1],
      });

      // Candidates ask for Set 1 and Set 2
      const candidates: CandidateSetTarget[] = [
        { workingSetOrdinal: 1, weight: 100, reps: 8, rpe: 8.0 },
        { workingSetOrdinal: 2, weight: 100, reps: 8, rpe: 8.0 },
      ];

      const result = evaluateGuidedCandidateComparison({
        candidateTargets: candidates,
        history: [exposure],
      });

      expect(result.status).toBe('unavailable');
      expect(result.allComparisonsValid).toBe(false);
      expect(result.ordinalResults[0].status).toBe('pass');
      expect(result.ordinalResults[1].status).toBe('unavailable');
      expect(result.ordinalResults[1].diagnosticCode).toBe('NO_FACTUAL_REFERENCE_FOUND');
    });

    it('skips skipped sets, warmup sets, drop sets, and loose form in history', () => {
      // Exposure w-2 has Set 1 with loose form and warmup Set 2
      const w2Sets = [
        createSetDetail(1, { weight: 110, reps: 8, rpe: 8.0, form: 'loose' }),
        createSetDetail(2, { weight: 100, reps: 8, rpe: 8.0, isWarmup: true }),
      ];
      const exp2 = createExposure({
        workoutLogId: 'w-2',
        workoutDate: '2026-08-05',
        sets: w2Sets,
      });

      // Exposure w-1 has valid completed performance for Set 1 and Set 2
      const w1Sets = [
        createSetDetail(1, { weight: 100, reps: 8, rpe: 8.0 }),
        createSetDetail(2, { weight: 100, reps: 8, rpe: 8.0 }),
      ];
      const exp1 = createExposure({
        workoutLogId: 'w-1',
        workoutDate: '2026-08-01',
        sets: w1Sets,
      });

      const candidates: CandidateSetTarget[] = [
        { workingSetOrdinal: 1, weight: 100, reps: 8, rpe: 8.0 },
        { workingSetOrdinal: 2, weight: 100, reps: 8, rpe: 8.0 },
      ];

      const result = evaluateGuidedCandidateComparison({
        candidateTargets: candidates,
        history: [exp2, exp1],
      });

      expect(result.status).toBe('pass');
      // Provenance for both must have bypassed w-2 and matched w-1!
      expect(result.ordinalResults[0].referenceProvenance?.workoutLogId).toBe('w-1');
      expect(result.ordinalResults[1].referenceProvenance?.workoutLogId).toBe('w-1');
    });

    it('correctly uses approved presented-RPE imputation when performed RPE was omitted', () => {
      // Historical set had rpe = null, but snapshot presentedRpe was 8.0
      const set1 = createSetDetail(
        1,
        { weight: 100, reps: 8, rpe: null },
        { presentedRpe: 8.0 }
      );
      const exposure = createExposure({
        workoutLogId: 'w-imputed',
        workoutDate: '2026-08-01',
        sets: [set1],
      });

      const candidate: CandidateSetTarget = {
        workingSetOrdinal: 1,
        weight: 102.5,
        reps: 8,
        rpe: 8.0,
      };

      const result = evaluateGuidedCandidateComparison({
        candidateTargets: [candidate],
        history: [exposure],
      });

      expect(result.status).toBe('pass');
      const prov = result.ordinalResults[0].referenceProvenance;
      expect(prov).not.toBeNull();
      expect(prov?.effectiveRpe).toBe(8.0);
      expect(prov?.rpeSource).toBe('presented_target_imputation');
    });

    it('treats valid completed underperformance as usable factual evidence', () => {
      // Historical workout: Lifter attempted 8 reps, but only achieved 6 reps @ RPE 9.5 (completed: true)
      // Coaching outcome was marginal_miss or substantial_miss, but it was completed performance!
      const set1 = createSetDetail(
        1,
        { weight: 100, reps: 6, rpe: 9.5, isCompleted: true },
        { presentedReps: 8, presentedRpe: 8.0 }
      );
      set1.setResult = {
        outcome: 'marginal_miss',
        reason: 'MARGINAL_MISS_REPS',
        targetAchieved: false,
        extraCapacityCreditEligible: false,
        rpeSource: 'explicit',
        actualComparisonLoadKg: 100,
        presentedComparisonLoadKg: 100,
        presentedCapacityIndex: null,
        actualCapacityIndex: null,
        relativePerformance: null,
      };

      const exposure = createExposure({
        workoutLogId: 'w-miss',
        workoutDate: '2026-08-01',
        sets: [set1],
      });

      // Candidate asks for 100 kg x 6 @ RPE 9.5
      const candidate: CandidateSetTarget = {
        workingSetOrdinal: 1,
        weight: 100,
        reps: 6,
        rpe: 9.5,
      };

      const result = evaluateGuidedCandidateComparison({
        candidateTargets: [candidate],
        history: [exposure],
      });

      expect(result.status).toBe('pass');
      expect(result.ordinalResults[0].referenceProvenance?.performedReps).toBe(6);
      expect(result.ordinalResults[0].referenceProvenance?.effectiveRpe).toBe(9.5);
      expect(result.ordinalResults[0].relativeChallenge).toBeCloseTo(0.0, 5);
    });
  });

  describe('Requirement 6H: Raw Comparison vs Eventual Authorization (Pure Repetition Exemption)', () => {
    it('reports raw cap failure for 10 reps to 11 reps at unchanged load, while flagging pure-repetition exemption eligibility', () => {
      // Reference: 100 kg x 10 reps @ RPE 8.0
      // RTS[10][8.0] = 0.680
      // Candidate: 100 kg x 11 reps @ RPE 8.0
      // RTS[11][8.0] = 0.644
      // Raw capacity challenge = (0.680 - 0.644) / 0.644 = +5.5901% (> 5.0% raw cap)
      const set1 = createSetDetail(1, { weight: 100, reps: 10, rpe: 8.0, isCompleted: true });
      const exposure = createExposure({
        workoutLogId: 'w-1',
        workoutDate: '2026-08-01',
        sets: [set1],
      });

      const candidate: CandidateSetTarget = {
        workingSetOrdinal: 1,
        weight: 100,
        reps: 11,
        rpe: 8.0,
      };

      const result = evaluateGuidedCandidateComparison({
        candidateTargets: [candidate],
        history: [exposure],
      });

      // Raw mathematical comparison fails the 5% cap
      expect(result.status).toBe('fail');
      expect(result.rawAggregatePassed).toBe(false);

      const ordRes = result.ordinalResults[0];
      expect(ordRes.relativeChallenge).toBeCloseTo(0.055901, 5);
      expect(ordRes.isWithinRawCap).toBe(false);

      // BUT pure-repetition exemption characteristics are accurately identified:
      expect(ordRes.candidateLoadEqualsReference).toBe(true);
      expect(ordRes.isPureRepetitionIncrement).toBe(true);
      expect(ordRes.pureRepetitionExemptionEligible).toBe(true);
      expect(result.hasExemptionEligibleOrdinals).toBe(true);
    });

    it('does not flag pure-repetition exemption when load changes or reps increase by more than 1', () => {
      const set1 = createSetDetail(1, { weight: 100, reps: 10, rpe: 8.0, isCompleted: true });
      const exposure = createExposure({
        workoutLogId: 'w-1',
        workoutDate: '2026-08-01',
        sets: [set1],
      });

      // Case 1: Load increased (+2.5 kg) alongside rep increase
      const candLoadChange: CandidateSetTarget = {
        workingSetOrdinal: 1,
        weight: 102.5,
        reps: 11,
        rpe: 8.0,
      };
      const res1 = evaluateGuidedCandidateComparison({
        candidateTargets: [candLoadChange],
        history: [exposure],
      });
      expect(res1.ordinalResults[0].candidateLoadEqualsReference).toBe(false);
      expect(res1.ordinalResults[0].isPureRepetitionIncrement).toBe(false);
      expect(res1.ordinalResults[0].pureRepetitionExemptionEligible).toBe(false);

      // Case 2: Reps increased by 2 (from 10 to 12)
      const candTwoReps: CandidateSetTarget = {
        workingSetOrdinal: 1,
        weight: 100,
        reps: 12,
        rpe: 8.0,
      };
      const res2 = evaluateGuidedCandidateComparison({
        candidateTargets: [candTwoReps],
        history: [exposure],
      });
      expect(res2.ordinalResults[0].candidateLoadEqualsReference).toBe(true);
      expect(res2.ordinalResults[0].isPureRepetitionIncrement).toBe(false);
      expect(res2.ordinalResults[0].pureRepetitionExemptionEligible).toBe(false);
    });
  });

  describe('Purity and Edge Cases', () => {
    it('does not mutate input candidate targets or history arrays', () => {
      const set1 = createSetDetail(1, { weight: 100, reps: 8, rpe: 8.0 });
      const exposure = createExposure({
        workoutLogId: 'w-1',
        workoutDate: '2026-08-01',
        sets: [set1],
      });

      const candidate: CandidateSetTarget = {
        workingSetOrdinal: 1,
        weight: 100,
        reps: 8,
        rpe: 8.0,
      };

      const candidateList = Object.freeze([Object.freeze({ ...candidate })]);
      const historyList = Object.freeze([Object.freeze({ ...exposure })]);

      expect(() => {
        evaluateGuidedCandidateComparison({
          candidateTargets: candidateList,
          history: historyList,
        });
      }).not.toThrow();
    });

    it('returns invalid_input when candidate targets list is empty or has duplicate ordinals', () => {
      const resEmpty = evaluateGuidedCandidateComparison({
        candidateTargets: [],
        history: [],
      });
      expect(resEmpty.status).toBe('invalid_input');
      expect(resEmpty.diagnostics[0].code).toBe('EMPTY_CANDIDATE_TARGETS');

      const resDup = evaluateGuidedCandidateComparison({
        candidateTargets: [
          { workingSetOrdinal: 1, weight: 100, reps: 8, rpe: 8.0 },
          { workingSetOrdinal: 1, weight: 102.5, reps: 8, rpe: 8.0 },
        ],
        history: [],
      });
      expect(resDup.status).toBe('invalid_input');
      expect(resDup.diagnostics[0].code).toBe('DUPLICATE_CANDIDATE_ORDINAL');
    });

    it('handles modality mismatch between candidate and historical performance', () => {
      // History has weighted bench press
      const set1 = createSetDetail(1, { weight: 100, reps: 8, rpe: 8.0 }, { modality: 'weighted' });
      const exposure = createExposure({
        workoutLogId: 'w-1',
        workoutDate: '2026-08-01',
        modality: 'weighted',
        sets: [set1],
      });

      // Candidate is bodyweight
      const candidate: CandidateSetTarget = {
        workingSetOrdinal: 1,
        weight: 0,
        reps: 8,
        rpe: 8.0,
        modality: 'bodyweight',
        bodyweight: 80,
      };

      const result = evaluateGuidedCandidateComparison({
        candidateTargets: [candidate],
        history: [exposure],
      });

      expect(result.status).toBe('unavailable');
      expect(result.ordinalResults[0].status).toBe('unavailable');
      expect(result.ordinalResults[0].diagnosticCode).toBe('MODALITY_MISMATCH');
    });
  });
});
