import { describe, it, expect } from 'vitest';
import {
  calculateLiveSetAdjustments,
  LiveAdjustmentParams,
  LiveTargetSnapshot,
  CommittedLiveEvidence,
} from '../liveAdjustmentMath';

describe('Live Intra-Session Adjustment Pure Math Engine (Phase 2B-2A-1)', () => {
  // 1. All Four Algorithms & Modality Guard
  describe('Algorithm Eligibility & Modality Bypasses', () => {
    it('bypasses non-weighted modalities (bodyweight, assisted, timed, distance, distance_loaded)', () => {
      const baseParams: LiveAdjustmentParams = {
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 100,
        modality: 'bodyweight',
        prescribedTargets: [
          { workingSetOrdinal: 1, weight: 100, reps: 10, rpe: 8 },
          { workingSetOrdinal: 2, weight: 100, reps: 10, rpe: 8.5 },
        ],
        currentTargets: [
          { workingSetOrdinal: 1, weight: 100, reps: 10, rpe: 8 },
          { workingSetOrdinal: 2, weight: 100, reps: 10, rpe: 8.5 },
        ],
        committedEvidence: [{ workingSetOrdinal: 1, weight: 100, reps: 10, rpe: 10, form: 'standard' }],
        triggeringWorkingSetOrdinal: 1,
      };

      const result = calculateLiveSetAdjustments(baseParams);
      expect(result.status).toBe('bypassed');
      expect(result.bypassReason).toBe('unsupported_modality');
      expect(result.shouldNotify).toBe(false);
      expect(result.changedWorkingSetOrdinals).toEqual([]);
    });

    it('bypasses invalid algorithm and objective pairings', () => {
      const result = calculateLiveSetAdjustments({
        objective: 'Hypertrophy',
        algorithmId: 'strength_linear', // Mismatched
        profileType: 'hypertrophy',
        baselineE1RM: 100,
        prescribedTargets: [
          { workingSetOrdinal: 1, weight: 100, reps: 10, rpe: 8 },
          { workingSetOrdinal: 2, weight: 100, reps: 10, rpe: 8.5 },
        ],
        currentTargets: [
          { workingSetOrdinal: 1, weight: 100, reps: 10, rpe: 8 },
          { workingSetOrdinal: 2, weight: 100, reps: 10, rpe: 8.5 },
        ],
        committedEvidence: [{ workingSetOrdinal: 1, weight: 100, reps: 10, rpe: 10, form: 'standard' }],
        triggeringWorkingSetOrdinal: 1,
      });

      expect(result.status).toBe('bypassed');
      expect(result.bypassReason).toBe('invalid_algorithm_objective_pairing');
    });

    it('bypasses Strength accessory exercises (isMainMovement !== true)', () => {
      const result = calculateLiveSetAdjustments({
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        profileType: 'strength_normal',
        baselineE1RM: 140,
        isMainMovement: false, // Accessory
        prescribedTargets: [
          { workingSetOrdinal: 1, weight: 100, reps: 5, rpe: 8 },
          { workingSetOrdinal: 2, weight: 95, reps: 5, rpe: 7 },
        ],
        currentTargets: [
          { workingSetOrdinal: 1, weight: 100, reps: 5, rpe: 8 },
          { workingSetOrdinal: 2, weight: 95, reps: 5, rpe: 7 },
        ],
        committedEvidence: [{ workingSetOrdinal: 1, weight: 100, reps: 5, rpe: 10, form: 'standard' }],
        triggeringWorkingSetOrdinal: 1,
      });

      expect(result.status).toBe('bypassed');
      expect(result.bypassReason).toBe('strength_accessory_bypassed');
    });
  });

  // 2. Hypertrophy Classifications and Load Preservation vs Drop
  describe('Hypertrophy Classifications and Boundaries', () => {
    it('handles hypertrophy_linear compound freeweight underperformance (preserves load, drops reps)', () => {
      // Planned: Set 1 = 100kg x 10 @ RPE 8 (e1RM = 100 / 0.680 = 147.0588)
      // Actual: 100kg x 10 @ RPE 10 (e1RM = 100 / 0.739 = 135.318)
      // Readiness = 135.318 / 147.0588 = 0.9202 (-7.98%)
      // Set 2 Target: target RPE 8.5. Set 2 capacity = 135.318 * 0.975 = 131.935.
      // Fixed load 100kg requires multiplier 100 / 131.935 = 0.7579.
      // Candidate reps at RPE 8.5: 7 reps gives multiplier 0.781 >= 0.7579.
      const result = calculateLiveSetAdjustments({
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 147.0588,
        movementCategory: 'compound',
        equipment: 'freeweight',
        isMainMovement: true,
        prescribedTargets: [
          { workingSetOrdinal: 1, weight: 100, reps: 10, rpe: 8 },
          { workingSetOrdinal: 2, weight: 100, reps: 10, rpe: 8.5 },
          { workingSetOrdinal: 3, weight: 100, reps: 9, rpe: 9.0 },
        ],
        currentTargets: [
          { workingSetOrdinal: 1, weight: 100, reps: 10, rpe: 8 },
          { workingSetOrdinal: 2, weight: 100, reps: 10, rpe: 8.5 },
          { workingSetOrdinal: 3, weight: 100, reps: 9, rpe: 9.0 },
        ],
        committedEvidence: [
          { workingSetOrdinal: 1, weight: 100, reps: 10, rpe: 10, form: 'standard' },
        ],
        triggeringWorkingSetOrdinal: 1,
      });

      expect(result.status).toBe('adjusted');
      expect(result.validEvidenceCount).toBe(1);
      expect(result.shouldNotify).toBe(true);
      expect(result.changedWorkingSetOrdinals).toEqual([2, 3]);

      const set2 = result.candidateTargets.find((t) => t.workingSetOrdinal === 2);
      expect(set2).toBeDefined();
      expect(set2?.weight).toBe(100);
      expect(set2?.reps).toBe(7);
      expect(set2?.rpe).toBe(8.5);

      const set3 = result.candidateTargets.find((t) => t.workingSetOrdinal === 3);
      expect(set3).toBeDefined();
      expect(set3?.weight).toBe(100);
      expect(set3?.reps).toBe(7);
      expect(set3?.rpe).toBe(9.0);
    });

    it('handles high-rep isolation machine scenario with reps > 12 extension (reduces load at repMin)', () => {
      // Scenario:
      // planned Set 1: 90 kg x 15 at RPE 8.0 (planned e1RM = 90 / 0.57855 = 155.560 kg)
      // planned Set 2: 90 kg x 14 at RPE 8.5
      // actual Set 1: 90 kg x 15 at RPE 10.0 (actual e1RM = 90 / 0.63467 = 141.807 kg)
      // Set 2 prior fatigue = 0.985, permitted rep range = [12, 15]
      // Set 2 capacity = 141.807 * 0.985 = 139.680 kg
      // At 90kg, required multiplier = 0.64433.
      // 12 reps at RPE 8.5 gives multiplier 0.633 < 0.64433.
      // Feasible reps with fixed 90kg does not exist -> fallback to repMin (12) and reduce load:
      // unrounded load = 139.680 * 0.633 = 88.417 kg -> rounded to 87.5 kg.
      const result = calculateLiveSetAdjustments({
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 155.5605,
        movementCategory: 'isolation',
        equipment: 'machine',
        prescribedTargets: [
          { workingSetOrdinal: 1, weight: 90, reps: 15, rpe: 8.0 },
          { workingSetOrdinal: 2, weight: 90, reps: 14, rpe: 8.5 },
        ],
        currentTargets: [
          { workingSetOrdinal: 1, weight: 90, reps: 15, rpe: 8.0 },
          { workingSetOrdinal: 2, weight: 90, reps: 14, rpe: 8.5 },
        ],
        committedEvidence: [
          { workingSetOrdinal: 1, weight: 90, reps: 15, rpe: 10.0, form: 'standard' },
        ],
        triggeringWorkingSetOrdinal: 1,
      });

      expect(result.status).toBe('adjusted');
      expect(result.changedWorkingSetOrdinals).toEqual([2]);

      const set2 = result.candidateTargets.find((t) => t.workingSetOrdinal === 2);
      expect(set2?.weight).toBe(87.5);
      expect(set2?.reps).toBe(12);
      expect(set2?.rpe).toBe(8.5);
    });

    it('handles hypertrophy compound machine classification', () => {
      const result = calculateLiveSetAdjustments({
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_step',
        profileType: 'hypertrophy',
        baselineE1RM: 120,
        movementCategory: 'compound',
        equipment: 'machine',
        prescribedTargets: [
          { workingSetOrdinal: 1, weight: 80, reps: 10, rpe: 8.0 },
          { workingSetOrdinal: 2, weight: 80, reps: 10, rpe: 8.5 },
        ],
        currentTargets: [
          { workingSetOrdinal: 1, weight: 80, reps: 10, rpe: 8.0 },
          { workingSetOrdinal: 2, weight: 80, reps: 10, rpe: 8.5 },
        ],
        committedEvidence: [
          { workingSetOrdinal: 1, weight: 80, reps: 10, rpe: 10.0, form: 'standard' },
        ],
        triggeringWorkingSetOrdinal: 1,
      });

      expect(result.status).toBe('adjusted');
      const set2 = result.candidateTargets.find((t) => t.workingSetOrdinal === 2);
      expect(set2).toBeDefined();
      expect(set2?.weight).toBe(80);
      expect(set2?.rpe).toBe(8.5);
    });
  });

  // 3. Strength Scenarios: Underperformance, Overperformance, Peak Single Lock
  describe('Strength Objectives & Main Movement Rules', () => {
    it('handles strength underperformance (locks reps, scales back-off load downward to nearest 2.5 kg)', () => {
      // Bench Press: Planned Set 1: 120 kg x 5 @ RPE 8.0 (planned e1RM = 120 / 0.807 = 148.698)
      // Planned Set 2: 112.5 kg x 5 @ RPE 7.0
      // Actual Set 1: 115 kg x 5 @ RPE 9.0 (actual e1RM = 115 / 0.835 = 137.724)
      // Readiness = 137.724 / 148.698 = 0.9262
      // Set 2 capacity = 137.724 * 0.980 = 134.970 kg
      // Target RPE 7.0 (multiplier = 0.779) -> unrounded weight = 134.970 * 0.779 = 105.14 kg
      // Rounded = 105.0 kg
      const result = calculateLiveSetAdjustments({
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        profileType: 'strength_normal',
        baselineE1RM: 148.6989,
        isMainMovement: true,
        movementCategory: 'compound',
        equipment: 'freeweight',
        prescribedTargets: [
          { workingSetOrdinal: 1, weight: 120, reps: 5, rpe: 8.0 },
          { workingSetOrdinal: 2, weight: 112.5, reps: 5, rpe: 7.0 },
        ],
        currentTargets: [
          { workingSetOrdinal: 1, weight: 120, reps: 5, rpe: 8.0 },
          { workingSetOrdinal: 2, weight: 112.5, reps: 5, rpe: 7.0 },
        ],
        committedEvidence: [
          { workingSetOrdinal: 1, weight: 115, reps: 5, rpe: 9.0, form: 'standard' },
        ],
        triggeringWorkingSetOrdinal: 1,
      });

      expect(result.status).toBe('adjusted');
      expect(result.changedWorkingSetOrdinals).toEqual([2]);

      const set2 = result.candidateTargets.find((t) => t.workingSetOrdinal === 2);
      expect(set2?.weight).toBe(105.0);
      expect(set2?.reps).toBe(5); // Reps locked
      expect(set2?.rpe).toBe(7.0);
    });

    it('enforces 1-set upward readiness cap (+2.5% max) on single-set overperformance', () => {
      // Planned: 120 kg x 5 @ RPE 8.0
      // Actual: 120 kg x 5 @ RPE 7.0 (multiplier = 0.779, actual e1RM = 154.043 vs planned 148.698 -> +3.59%)
      // Clamped upward cap for 1 set is 1.025 (+2.5%)
      const result = calculateLiveSetAdjustments({
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        profileType: 'strength_normal',
        baselineE1RM: 148.6989,
        isMainMovement: true,
        prescribedTargets: [
          { workingSetOrdinal: 1, weight: 120, reps: 5, rpe: 8.0 },
          { workingSetOrdinal: 2, weight: 112.5, reps: 5, rpe: 7.0 },
        ],
        currentTargets: [
          { workingSetOrdinal: 1, weight: 120, reps: 5, rpe: 8.0 },
          { workingSetOrdinal: 2, weight: 112.5, reps: 5, rpe: 7.0 },
        ],
        committedEvidence: [
          { workingSetOrdinal: 1, weight: 120, reps: 5, rpe: 7.0, form: 'standard' },
        ],
        triggeringWorkingSetOrdinal: 1,
      });

      expect(result.status).toBe('adjusted');
      expect(result.diagnostics?.clampedReadiness).toBeCloseTo(1.025, 4);
      expect(result.diagnostics?.upwardCap).toBe(1.025);

      const set2 = result.candidateTargets.find((t) => t.workingSetOrdinal === 2);
      expect(set2?.weight).toBe(117.5); // Scaled up to 117.5 kg
      expect(set2?.reps).toBe(5);
    });

    it('allows up to +5.0% upward cap with 2 consistent clean overperforming sets', () => {
      const result = calculateLiveSetAdjustments({
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        profileType: 'strength_normal',
        baselineE1RM: 148.6989,
        isMainMovement: true,
        prescribedTargets: [
          { workingSetOrdinal: 1, weight: 120, reps: 5, rpe: 8.0 },
          { workingSetOrdinal: 2, weight: 112.5, reps: 5, rpe: 7.0 },
          { workingSetOrdinal: 3, weight: 115, reps: 5, rpe: 7.5 },
        ],
        currentTargets: [
          { workingSetOrdinal: 1, weight: 120, reps: 5, rpe: 8.0 },
          { workingSetOrdinal: 2, weight: 117.5, reps: 5, rpe: 7.0 },
          { workingSetOrdinal: 3, weight: 115, reps: 5, rpe: 7.5 },
        ],
        committedEvidence: [
          { workingSetOrdinal: 1, weight: 125, reps: 5, rpe: 7.5, form: 'standard' }, // e1RM = 125 / 0.793 = 157.6 > 148.7
          { workingSetOrdinal: 2, weight: 120, reps: 5, rpe: 7.0, form: 'standard' }, // e1RM = 120 / 0.779 = 154.0 > 145.7
        ],
        triggeringWorkingSetOrdinal: 2,
      });

      expect(result.diagnostics?.upwardCap).toBe(1.05);
    });

    it('prohibits upward adjustment (cap = 1.00) when multi-set evidence is inconsistent', () => {
      const result = calculateLiveSetAdjustments({
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        profileType: 'strength_normal',
        baselineE1RM: 148.6989,
        isMainMovement: true,
        prescribedTargets: [
          { workingSetOrdinal: 1, weight: 120, reps: 5, rpe: 8.0 },
          { workingSetOrdinal: 2, weight: 112.5, reps: 5, rpe: 7.0 },
          { workingSetOrdinal: 3, weight: 115, reps: 5, rpe: 7.5 },
        ],
        currentTargets: [
          { workingSetOrdinal: 1, weight: 120, reps: 5, rpe: 8.0 },
          { workingSetOrdinal: 2, weight: 112.5, reps: 5, rpe: 7.0 },
          { workingSetOrdinal: 3, weight: 115, reps: 5, rpe: 7.5 },
        ],
        committedEvidence: [
          { workingSetOrdinal: 1, weight: 125, reps: 5, rpe: 7.5, form: 'standard' }, // High readiness
          { workingSetOrdinal: 2, weight: 100, reps: 5, rpe: 9.5, form: 'standard' }, // Sudden severe drop < 1.0
        ],
        triggeringWorkingSetOrdinal: 2,
      });

      expect(result.diagnostics?.upwardCap).toBe(1.00);
    });

    it('strictly locks peak singles (1 rep @ RPE >= 9.5) from receiving upward load adjustments', () => {
      const result = calculateLiveSetAdjustments({
        objective: 'Strength',
        algorithmId: 'strength_linear',
        profileType: 'strength_post_test',
        baselineE1RM: 150,
        isMainMovement: true,
        prescribedTargets: [
          { workingSetOrdinal: 1, weight: 150, reps: 1, rpe: 10.0 },
          { workingSetOrdinal: 2, weight: 122.5, reps: 3, rpe: 7.5 },
        ],
        currentTargets: [
          { workingSetOrdinal: 1, weight: 150, reps: 1, rpe: 10.0 },
          { workingSetOrdinal: 2, weight: 122.5, reps: 3, rpe: 7.5 },
        ],
        committedEvidence: [
          { workingSetOrdinal: 1, weight: 150, reps: 1, rpe: 10.0, form: 'standard' },
        ],
        triggeringWorkingSetOrdinal: 1,
      });

      const set1 = result.candidateTargets.find((t) => t.workingSetOrdinal === 1);
      expect(set1?.weight).toBe(150);
      expect(set1?.reps).toBe(1);
    });
  });

  // 4. Evidence Validation: Loose form, Drop sets, Skipped sets, Warm-ups, Gaps
  describe('Clean Contiguous Evidence & Exclusions', () => {
    it('excludes loose form sets from valid evidence', () => {
      const result = calculateLiveSetAdjustments({
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 100,
        prescribedTargets: [
          { workingSetOrdinal: 1, weight: 80, reps: 10, rpe: 8 },
          { workingSetOrdinal: 2, weight: 80, reps: 10, rpe: 8.5 },
        ],
        currentTargets: [
          { workingSetOrdinal: 1, weight: 80, reps: 10, rpe: 8 },
          { workingSetOrdinal: 2, weight: 80, reps: 10, rpe: 8.5 },
        ],
        committedEvidence: [
          { workingSetOrdinal: 1, weight: 80, reps: 10, rpe: 8, form: 'loose' }, // Loose form
        ],
        triggeringWorkingSetOrdinal: 1,
      });

      expect(result.status).toBe('invalid_evidence');
      expect(result.validEvidenceCount).toBe(0);
      expect(result.invalidReason).toContain('loose_form');
    });

    it('excludes drop sets and sets with dropSubSets from valid evidence', () => {
      const result = calculateLiveSetAdjustments({
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 100,
        prescribedTargets: [
          { workingSetOrdinal: 1, weight: 80, reps: 10, rpe: 8 },
          { workingSetOrdinal: 2, weight: 80, reps: 10, rpe: 8.5 },
        ],
        currentTargets: [
          { workingSetOrdinal: 1, weight: 80, reps: 10, rpe: 8 },
          { workingSetOrdinal: 2, weight: 80, reps: 10, rpe: 8.5 },
        ],
        committedEvidence: [
          { workingSetOrdinal: 1, weight: 80, reps: 10, rpe: 8, form: 'standard', isDropSet: true },
        ],
        triggeringWorkingSetOrdinal: 1,
      });

      expect(result.status).toBe('invalid_evidence');
      expect(result.validEvidenceCount).toBe(0);
    });

    it('terminates evidence chain at the first skipped working set', () => {
      const result = calculateLiveSetAdjustments({
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 100,
        prescribedTargets: [
          { workingSetOrdinal: 1, weight: 80, reps: 10, rpe: 8 },
          { workingSetOrdinal: 2, weight: 80, reps: 10, rpe: 8.5 },
          { workingSetOrdinal: 3, weight: 80, reps: 10, rpe: 9.0 },
        ],
        currentTargets: [
          { workingSetOrdinal: 1, weight: 80, reps: 10, rpe: 8 },
          { workingSetOrdinal: 2, weight: 80, reps: 10, rpe: 8.5 },
          { workingSetOrdinal: 3, weight: 80, reps: 10, rpe: 9.0 },
        ],
        committedEvidence: [
          { workingSetOrdinal: 1, weight: 80, reps: 10, rpe: 8, form: 'standard' },
          { workingSetOrdinal: 2, isSkipped: true }, // Skipped
          { workingSetOrdinal: 3, weight: 80, reps: 10, rpe: 9, form: 'standard' },
        ],
        triggeringWorkingSetOrdinal: 3,
      });

      // Chain halts at Set 1 (length 1). Set 3 does not contribute.
      expect(result.validEvidenceCount).toBe(1);
    });

    it('ignores warm-up entries and does not consume working-set ordinals', () => {
      const result = calculateLiveSetAdjustments({
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 100,
        prescribedTargets: [
          { workingSetOrdinal: 1, weight: 80, reps: 10, rpe: 8 },
          { workingSetOrdinal: 2, weight: 80, reps: 10, rpe: 8.5 },
        ],
        currentTargets: [
          { workingSetOrdinal: 1, weight: 80, reps: 10, rpe: 8 },
          { workingSetOrdinal: 2, weight: 80, reps: 10, rpe: 8.5 },
        ],
        committedEvidence: [
          { workingSetOrdinal: 1, weight: 80, reps: 10, rpe: 8, form: 'standard' },
        ],
        triggeringWorkingSetOrdinal: 1,
      });

      expect(result.validEvidenceCount).toBe(1);
    });

    it('rejects invalid weight, reps, or RPE (< 6.0 or > 10.0)', () => {
      const result = calculateLiveSetAdjustments({
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 100,
        prescribedTargets: [
          { workingSetOrdinal: 1, weight: 80, reps: 10, rpe: 8 },
          { workingSetOrdinal: 2, weight: 80, reps: 10, rpe: 8.5 },
        ],
        currentTargets: [
          { workingSetOrdinal: 1, weight: 80, reps: 10, rpe: 8 },
          { workingSetOrdinal: 2, weight: 80, reps: 10, rpe: 8.5 },
        ],
        committedEvidence: [
          { workingSetOrdinal: 1, weight: 80, reps: 10, rpe: 5.5, form: 'standard' }, // RPE < 6.0
        ],
        triggeringWorkingSetOrdinal: 1,
      });

      expect(result.status).toBe('invalid_evidence');
      expect(result.validEvidenceCount).toBe(0);
    });
  });

  // 5. Mandatory No-Change and No-Drift Invariants
  describe('Mandatory No-Change & No-Drift Invariants', () => {
    it('preserves exact prescribed targets when actual Set 1 matches plan', () => {
      const prescribed: LiveTargetSnapshot[] = [
        { workingSetOrdinal: 1, weight: 100, reps: 10, rpe: 8.0 },
        { workingSetOrdinal: 2, weight: 100, reps: 10, rpe: 8.5 },
        { workingSetOrdinal: 3, weight: 100, reps: 9, rpe: 9.0 },
      ];

      const result = calculateLiveSetAdjustments({
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 147.0588,
        movementCategory: 'compound',
        equipment: 'freeweight',
        prescribedTargets: prescribed,
        currentTargets: prescribed,
        committedEvidence: [
          { workingSetOrdinal: 1, weight: 100, reps: 10, rpe: 8.0, form: 'standard' },
        ],
        triggeringWorkingSetOrdinal: 1,
      });

      expect(result.status).toBe('no_change');
      expect(result.shouldNotify).toBe(false);
      expect(result.changedWorkingSetOrdinals).toEqual([]);
      expect(result.sessionReadiness).toBe(1.0);
    });

    it('preserves exact targets when Sets 1 and 2 match plan', () => {
      const prescribed: LiveTargetSnapshot[] = [
        { workingSetOrdinal: 1, weight: 100, reps: 10, rpe: 8.0 },
        { workingSetOrdinal: 2, weight: 100, reps: 10, rpe: 8.5 },
        { workingSetOrdinal: 3, weight: 100, reps: 9, rpe: 9.0 },
      ];

      const result = calculateLiveSetAdjustments({
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 147.0588,
        movementCategory: 'compound',
        equipment: 'freeweight',
        prescribedTargets: prescribed,
        currentTargets: prescribed,
        committedEvidence: [
          { workingSetOrdinal: 1, weight: 100, reps: 10, rpe: 8.0, form: 'standard' },
          { workingSetOrdinal: 2, weight: 100, reps: 10, rpe: 8.5, form: 'standard' },
        ],
        triggeringWorkingSetOrdinal: 2,
      });

      expect(result.status).toBe('no_change');
      expect(result.changedWorkingSetOrdinals).toEqual([]);
    });

    it('produces no drift when performing a previously live-adjusted target exactly', () => {
      const prescribed: LiveTargetSnapshot[] = [
        { workingSetOrdinal: 1, weight: 100, reps: 10, rpe: 8.0 },
        { workingSetOrdinal: 2, weight: 100, reps: 10, rpe: 8.5 },
        { workingSetOrdinal: 3, weight: 100, reps: 9, rpe: 9.0 },
      ];

      // After Set 1 @ RPE 10, Set 2 was adjusted to 100kg x 7 @ RPE 8.5, Set 3 to 100kg x 7 @ RPE 9.0
      const current: LiveTargetSnapshot[] = [
        { workingSetOrdinal: 1, weight: 100, reps: 10, rpe: 10.0 },
        { workingSetOrdinal: 2, weight: 100, reps: 7, rpe: 8.5 },
        { workingSetOrdinal: 3, weight: 100, reps: 7, rpe: 9.0 },
      ];

      // User performs Set 2 exactly as live-adjusted
      const result = calculateLiveSetAdjustments({
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 147.0588,
        movementCategory: 'compound',
        equipment: 'freeweight',
        prescribedTargets: prescribed,
        currentTargets: current,
        committedEvidence: [
          { workingSetOrdinal: 1, weight: 100, reps: 10, rpe: 10.0, form: 'standard' },
          { workingSetOrdinal: 2, weight: 100, reps: 7, rpe: 8.5, form: 'standard' },
        ],
        triggeringWorkingSetOrdinal: 2,
      });

      // Target for Set 3 should remain stable at 100kg x 7 @ RPE 9.0
      const set3 = result.candidateTargets.find((t) => t.workingSetOrdinal === 3);
      expect(set3?.weight).toBe(100);
      expect(set3?.reps).toBe(7);
      expect(set3?.rpe).toBe(9.0);
    });

    it('guarantees idempotency and zero input mutation across 5 repeated calls', () => {
      const params: LiveAdjustmentParams = {
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 147.0588,
        prescribedTargets: [
          { workingSetOrdinal: 1, weight: 100, reps: 10, rpe: 8.0 },
          { workingSetOrdinal: 2, weight: 100, reps: 10, rpe: 8.5 },
        ],
        currentTargets: [
          { workingSetOrdinal: 1, weight: 100, reps: 10, rpe: 8.0 },
          { workingSetOrdinal: 2, weight: 100, reps: 10, rpe: 8.5 },
        ],
        committedEvidence: [
          { workingSetOrdinal: 1, weight: 100, reps: 10, rpe: 10.0, form: 'standard' },
        ],
        triggeringWorkingSetOrdinal: 1,
      };

      const deepClone = JSON.parse(JSON.stringify(params));
      const res1 = calculateLiveSetAdjustments(params);
      const res2 = calculateLiveSetAdjustments(params);
      const res3 = calculateLiveSetAdjustments(params);
      const res4 = calculateLiveSetAdjustments(params);
      const res5 = calculateLiveSetAdjustments(params);

      expect(res1).toEqual(res2);
      expect(res2).toEqual(res3);
      expect(res3).toEqual(res4);
      expect(res4).toEqual(res5);

      // Verify input object was never mutated
      expect(params).toEqual(deepClone);
    });
  });

  // 6. Invalid Recommitment Restoration
  describe('Invalid Recommitment Restoration Behavior', () => {
    it('verifies all four algorithms function deterministically', () => {
      const algorithms: Array<LiveAdjustmentParams['algorithmId']> = [
        'hypertrophy_linear',
        'hypertrophy_step',
      ];
      for (const alg of algorithms) {
        const res = calculateLiveSetAdjustments({
          objective: 'Hypertrophy',
          algorithmId: alg,
          profileType: 'hypertrophy',
          baselineE1RM: 147.0588,
          movementCategory: 'compound',
          equipment: 'freeweight',
          prescribedTargets: [
            { workingSetOrdinal: 1, weight: 100, reps: 10, rpe: 8.0 },
            { workingSetOrdinal: 2, weight: 100, reps: 10, rpe: 8.5 },
          ],
          currentTargets: [
            { workingSetOrdinal: 1, weight: 100, reps: 10, rpe: 8.0 },
            { workingSetOrdinal: 2, weight: 100, reps: 10, rpe: 8.5 },
          ],
          committedEvidence: [
            { workingSetOrdinal: 1, weight: 100, reps: 10, rpe: 10.0, form: 'standard' },
          ],
          triggeringWorkingSetOrdinal: 1,
        });
        expect(res.status).toBe('adjusted');
      }

      const strengthAlgs: Array<LiveAdjustmentParams['algorithmId']> = [
        'strength_undulating',
        'strength_linear',
      ];
      for (const alg of strengthAlgs) {
        const res = calculateLiveSetAdjustments({
          objective: 'Strength',
          algorithmId: alg,
          profileType: 'strength_normal',
          baselineE1RM: 148.6989,
          isMainMovement: true,
          movementCategory: 'compound',
          equipment: 'freeweight',
          prescribedTargets: [
            { workingSetOrdinal: 1, weight: 120, reps: 5, rpe: 8.0 },
            { workingSetOrdinal: 2, weight: 112.5, reps: 5, rpe: 7.0 },
          ],
          currentTargets: [
            { workingSetOrdinal: 1, weight: 120, reps: 5, rpe: 8.0 },
            { workingSetOrdinal: 2, weight: 112.5, reps: 5, rpe: 7.0 },
          ],
          committedEvidence: [
            { workingSetOrdinal: 1, weight: 115, reps: 5, rpe: 9.0, form: 'standard' },
          ],
          triggeringWorkingSetOrdinal: 1,
        });
        expect(res.status).toBe('adjusted');
      }
    });

    it('handles hypertrophy isolation freeweight', () => {
      const result = calculateLiveSetAdjustments({
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 50,
        movementCategory: 'isolation',
        equipment: 'freeweight',
        prescribedTargets: [
          { workingSetOrdinal: 1, weight: 30, reps: 12, rpe: 8.0 },
          { workingSetOrdinal: 2, weight: 30, reps: 11, rpe: 8.5 },
        ],
        currentTargets: [
          { workingSetOrdinal: 1, weight: 30, reps: 12, rpe: 8.0 },
          { workingSetOrdinal: 2, weight: 30, reps: 11, rpe: 8.5 },
        ],
        committedEvidence: [
          { workingSetOrdinal: 1, weight: 30, reps: 12, rpe: 10.0, form: 'standard' },
        ],
        triggeringWorkingSetOrdinal: 1,
      });

      expect(result.status).toBe('adjusted');
      expect(result.candidateTargets.length).toBe(2);
    });

    it('terminates contiguous chain when evidence has missing intermediate ordinals', () => {
      const result = calculateLiveSetAdjustments({
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 147.0588,
        prescribedTargets: [
          { workingSetOrdinal: 1, weight: 100, reps: 10, rpe: 8.0 },
          { workingSetOrdinal: 2, weight: 100, reps: 10, rpe: 8.5 },
          { workingSetOrdinal: 3, weight: 100, reps: 9, rpe: 9.0 },
        ],
        currentTargets: [
          { workingSetOrdinal: 1, weight: 100, reps: 10, rpe: 8.0 },
          { workingSetOrdinal: 2, weight: 100, reps: 10, rpe: 8.5 },
          { workingSetOrdinal: 3, weight: 100, reps: 9, rpe: 9.0 },
        ],
        committedEvidence: [
          { workingSetOrdinal: 1, weight: 100, reps: 10, rpe: 10.0, form: 'standard' },
          // Set 2 missing
          { workingSetOrdinal: 3, weight: 100, reps: 8, rpe: 9.0, form: 'standard' },
        ],
        triggeringWorkingSetOrdinal: 3,
      });

      // Chain halts at Set 1 (length 1), validEvidenceCount is 1
      expect(result.validEvidenceCount).toBe(1);
    });

    it('bypasses calculation if triggering working set ordinal is out of bounds (< 1 or > 6)', () => {
      const result = calculateLiveSetAdjustments({
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 147.0588,
        prescribedTargets: [
          { workingSetOrdinal: 1, weight: 100, reps: 10, rpe: 8.0 },
        ],
        currentTargets: [
          { workingSetOrdinal: 1, weight: 100, reps: 10, rpe: 8.0 },
        ],
        committedEvidence: [
          { workingSetOrdinal: 1, weight: 100, reps: 10, rpe: 10.0, form: 'standard' },
        ],
        triggeringWorkingSetOrdinal: 7, // Out of bounds
      });

      expect(result.status).toBe('bypassed');
      expect(result.bypassReason).toBe('invalid_triggering_ordinal');
    });

    it('identifies rows to restore when Set 1 is recommitted as loose form', () => {
      const prescribed: LiveTargetSnapshot[] = [
        { workingSetOrdinal: 1, weight: 100, reps: 10, rpe: 8.0 },
        { workingSetOrdinal: 2, weight: 100, reps: 10, rpe: 8.5 },
      ];
      // Current displays an adjusted Set 2
      const current: LiveTargetSnapshot[] = [
        { workingSetOrdinal: 1, weight: 100, reps: 10, rpe: 10.0 },
        { workingSetOrdinal: 2, weight: 100, reps: 7, rpe: 8.5 },
      ];

      const result = calculateLiveSetAdjustments({
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 147.0588,
        prescribedTargets: prescribed,
        currentTargets: current,
        committedEvidence: [
          { workingSetOrdinal: 1, weight: 100, reps: 10, rpe: 10.0, form: 'loose' }, // Switched to loose
        ],
        triggeringWorkingSetOrdinal: 1,
      });

      expect(result.status).toBe('invalid_evidence');
      expect(result.restorePrescribedOrdinals).toEqual([2]);

      const candidate2 = result.candidateTargets.find((t) => t.workingSetOrdinal === 2);
      expect(candidate2?.reps).toBe(10); // Restored to prescribed 10 reps
    });

    it('guarantees all candidate target loads are exact 2.5 kg increments', () => {
      const result = calculateLiveSetAdjustments({
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        profileType: 'strength_normal',
        baselineE1RM: 137.333,
        isMainMovement: true,
        prescribedTargets: [
          { workingSetOrdinal: 1, weight: 111, reps: 5, rpe: 8.0 },
          { workingSetOrdinal: 2, weight: 104, reps: 5, rpe: 7.0 },
          { workingSetOrdinal: 3, weight: 107, reps: 5, rpe: 7.5 },
        ],
        currentTargets: [
          { workingSetOrdinal: 1, weight: 110, reps: 5, rpe: 8.0 },
          { workingSetOrdinal: 2, weight: 105, reps: 5, rpe: 7.0 },
          { workingSetOrdinal: 3, weight: 107.5, reps: 5, rpe: 7.5 },
        ],
        committedEvidence: [
          { workingSetOrdinal: 1, weight: 110, reps: 5, rpe: 9.5, form: 'standard' },
        ],
        triggeringWorkingSetOrdinal: 1,
      });

      for (const t of result.candidateTargets) {
        expect(t.weight % 2.5).toBeCloseTo(0, 5);
      }
    });
  });
});
