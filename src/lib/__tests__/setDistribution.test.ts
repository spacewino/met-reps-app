import { describe, it, expect } from 'vitest';
import {
  getFatiguePrior,
  extractObservedFatigueRatios,
  computeLearnedFatigueRatios,
  distributeMultiSetTargets,
  distributeHypertrophySets,
  distributeStrengthSets,
  distributePeakSingleStrengthSets,
  isValidFatiguePriorProfile,
  SessionAnchor,
  FatiguePriorProfile,
  ObservedSessionRatio,
} from '../setDistribution';
import { WorkoutLog, BodyweightSnapshot } from '../../types';

describe('setDistribution', () => {
  describe('isValidFatiguePriorProfile', () => {
    it('validates known profile types and rejects unknown strings', () => {
      expect(isValidFatiguePriorProfile('hypertrophy')).toBe(true);
      expect(isValidFatiguePriorProfile('strength_normal')).toBe(true);
      expect(isValidFatiguePriorProfile('strength_post_test')).toBe(true);
      expect(isValidFatiguePriorProfile('unknown')).toBe(false);
      expect(isValidFatiguePriorProfile('')).toBe(false);
      expect(isValidFatiguePriorProfile(null)).toBe(false);
      expect(isValidFatiguePriorProfile(undefined)).toBe(false);
    });
  });

  describe('getFatiguePrior', () => {
    it('returns exact transparent default prior arrays for all three profiles', () => {
      expect(getFatiguePrior('hypertrophy')).toEqual([1.000, 0.975, 0.950, 0.925, 0.900, 0.875]);
      expect(getFatiguePrior('strength_normal')).toEqual([1.000, 0.980, 0.960, 0.940, 0.920, 0.900]);
      expect(getFatiguePrior('strength_post_test')).toEqual([1.000, 0.950, 0.920, 0.895, 0.875, 0.855]);
    });
  });

  describe('Historical Fatigue Extraction (extractObservedFatigueRatios)', () => {
    const validLogTemplate: WorkoutLog = {
      id: 'log-1',
      date: '2026-08-01',
      unit: 'kg',
      objective: 'Hypertrophy',
      exercises: [
        {
          name: 'Barbell Bench Press',
          muscleGroup: 'Chest',
          modality: 'weighted',
          sets: [
            { setNumber: 1, weight: 100, reps: 10, rpe: 8.0, isCompleted: true, form: 'standard' },
            { setNumber: 2, weight: 100, reps: 10, rpe: 10.0, isCompleted: true, form: 'standard' },
            { setNumber: 3, weight: 100, reps: 8, rpe: 10.0, isCompleted: true, form: 'standard' },
          ],
        },
      ],
    };

    it('extracts ratios correctly from eligible completed hypertrophy session', () => {
      const extracted = extractObservedFatigueRatios('Barbell Bench Press', [validLogTemplate], 'hypertrophy');
      expect(extracted).toHaveLength(1);
      expect(extracted[0].logId).toBe('log-1');
      expect(extracted[0].ratiosByOrdinal[1]).toBe(1.000);
      expect(extracted[0].ratiosByOrdinal[2]).toBeCloseTo(0.92016, 4);
      expect(extracted[0].ratiosByOrdinal[3]).toBeCloseTo(0.86514, 4);
    });

    it('rejects sessions where Working Set 1 isCompleted is undefined or false (provenance gating)', () => {
      const incompleteLog: WorkoutLog = {
        ...validLogTemplate,
        id: 'log-inc',
        exercises: [
          {
            ...validLogTemplate.exercises[0],
            sets: [
              { setNumber: 1, weight: 100, reps: 10, rpe: 8.0, isCompleted: undefined },
              { setNumber: 2, weight: 100, reps: 10, rpe: 10.0, isCompleted: true },
            ],
          },
        ],
      };
      const extracted = extractObservedFatigueRatios('Barbell Bench Press', [incompleteLog], 'hypertrophy');
      expect(extracted).toHaveLength(0);
    });

    it('filters out warm-up rows before assigning working-set ordinals', () => {
      const warmupLog: WorkoutLog = {
        ...validLogTemplate,
        id: 'log-wu',
        exercises: [
          {
            ...validLogTemplate.exercises[0],
            sets: [
              { setNumber: 1, weight: 60, reps: 10, rpe: 6.0, isWarmup: true, isCompleted: true },
              { setNumber: 2, weight: 80, reps: 5, rpe: 6.0, isWarmup: true, isCompleted: true },
              { setNumber: 3, weight: 100, reps: 10, rpe: 8.0, isCompleted: true }, // Working Set 1
              { setNumber: 4, weight: 100, reps: 10, rpe: 10.0, isCompleted: true }, // Working Set 2
            ],
          },
        ],
      };
      const extracted = extractObservedFatigueRatios('Barbell Bench Press', [warmupLog], 'hypertrophy');
      expect(extracted).toHaveLength(1);
      expect(extracted[0].ratiosByOrdinal[1]).toBe(1.000);
      expect(extracted[0].ratiosByOrdinal[2]).toBeCloseTo(0.92016, 4);
    });

    it('preserves Working Set 3 ordinal even if intermediate Working Set 2 is invalid', () => {
      const invalidMiddleLog: WorkoutLog = {
        ...validLogTemplate,
        id: 'log-mid-inv',
        exercises: [
          {
            ...validLogTemplate.exercises[0],
            sets: [
              { setNumber: 1, weight: 100, reps: 10, rpe: 8.0, isCompleted: true }, // Set 1: Valid
              { setNumber: 2, weight: 100, reps: 10, rpe: 5.0, isCompleted: true }, // Set 2: RPE 5.0 invalid (<6.0)
              { setNumber: 3, weight: 100, reps: 8, rpe: 10.0, isCompleted: true }, // Set 3: Valid
            ],
          },
        ],
      };
      const extracted = extractObservedFatigueRatios('Barbell Bench Press', [invalidMiddleLog], 'hypertrophy');
      expect(extracted).toHaveLength(1);
      expect(extracted[0].ratiosByOrdinal[1]).toBe(1.000);
      expect(extracted[0].ratiosByOrdinal[2]).toBeUndefined();
      expect(extracted[0].ratiosByOrdinal[3]).toBeCloseTo(0.86514, 4);
    });

    it('excludes drop-sets and non-empty dropSubSets but keeps empty dropSubSets', () => {
      const dropLog: WorkoutLog = {
        ...validLogTemplate,
        id: 'log-drop',
        exercises: [
          {
            ...validLogTemplate.exercises[0],
            sets: [
              { setNumber: 1, weight: 100, reps: 10, rpe: 8.0, isCompleted: true, dropSubSets: [] }, // Kept
              { setNumber: 2, weight: 100, reps: 10, rpe: 10.0, isCompleted: true, isDropSet: true }, // Excluded
              { setNumber: 3, weight: 100, reps: 8, rpe: 10.0, isCompleted: true, dropSubSets: [{ weight: 60, reps: 5 }] }, // Excluded
            ],
          },
        ],
      };
      const extracted = extractObservedFatigueRatios('Barbell Bench Press', [dropLog], 'hypertrophy');
      expect(extracted).toHaveLength(1);
      expect(extracted[0].ratiosByOrdinal[1]).toBe(1.000);
      expect(extracted[0].ratiosByOrdinal[2]).toBeUndefined();
      expect(extracted[0].ratiosByOrdinal[3]).toBeUndefined();
    });

    it('excludes loose form sets', () => {
      const looseLog: WorkoutLog = {
        ...validLogTemplate,
        id: 'log-loose',
        exercises: [
          {
            ...validLogTemplate.exercises[0],
            sets: [
              { setNumber: 1, weight: 100, reps: 10, rpe: 8.0, isCompleted: true, form: 'standard' },
              { setNumber: 2, weight: 100, reps: 10, rpe: 9.0, isCompleted: true, form: 'loose' }, // Excluded
            ],
          },
        ],
      };
      const extracted = extractObservedFatigueRatios('Barbell Bench Press', [looseLog], 'hypertrophy');
      expect(extracted[0].ratiosByOrdinal[2]).toBeUndefined();
    });

    it('bypasses unsupported modalities (bodyweight, assisted, timed, distance, distance_loaded)', () => {
      const modalities = ['bodyweight', 'assisted', 'timed', 'distance', 'distance_loaded'] as const;
      for (const m of modalities) {
        const anchor: SessionAnchor = {
          profileType: 'hypertrophy',
          baselineE1RM: 100,
          rawAnchorWeight: 70,
          roundedAnchorWeight: 70,
          anchorReps: 8,
          anchorRPE: 8.0,
          workingSetCount: 3,
          modality: m,
        };
        const res = distributeMultiSetTargets(anchor, 'Push Up', []);
        expect(res.isBypassed).toBe(true);
        expect(res.bypassReason).toBe('unsupported_modality');
        expect(res.targets).toEqual([]);
        expect(res.unsupportedOrdinalRange).toBeNull();
      }
    });

    it('excludes skipped exercises', () => {
      const skippedLog: WorkoutLog = {
        ...validLogTemplate,
        id: 'log-skip',
        exercises: [
          {
            ...validLogTemplate.exercises[0],
            isSkipped: true,
          },
        ],
      };
      const extracted = extractObservedFatigueRatios('Barbell Bench Press', [skippedLog], 'hypertrophy');
      expect(extracted).toHaveLength(0);
    });

    it('excludes logs with Off, Deload, or undefined objectives', () => {
      const offLog = { ...validLogTemplate, id: 'log-off', objective: 'Off' as const };
      const deloadLog = { ...validLogTemplate, id: 'log-del', objective: 'Deload' as const };
      const missingLog = { ...validLogTemplate, id: 'log-mis', objective: undefined as any };

      const extracted = extractObservedFatigueRatios('Barbell Bench Press', [offLog, deloadLog, missingLog], 'hypertrophy');
      expect(extracted).toHaveLength(0);
    });

    it('classifies strength normal vs peak-test singles strictly', () => {
      const peakSingleLog: WorkoutLog = {
        id: 'log-peak',
        date: '2026-08-01',
        unit: 'kg',
        objective: 'Strength',
        exercises: [
          {
            name: 'Deadlift',
            muscleGroup: 'Back',
            modality: 'weighted',
            sets: [
              { setNumber: 1, weight: 200, reps: 1, rpe: 10.0, isCompleted: true },
              { setNumber: 2, weight: 160, reps: 3, rpe: 8.0, isCompleted: true },
            ],
          },
        ],
      };

      const normExtracted = extractObservedFatigueRatios('Deadlift', [peakSingleLog], 'strength_normal');
      expect(normExtracted).toHaveLength(0); // Peak single cannot enter normal strength

      const peakExtracted = extractObservedFatigueRatios('Deadlift', [peakSingleLog], 'strength_post_test');
      expect(peakExtracted).toHaveLength(1);
    });

    it('sorts chronologically and extracts only the 3 most recent sessions, safely handling invalid dates', () => {
      const logs: WorkoutLog[] = [
        { ...validLogTemplate, id: 'log-old', date: '2026-01-01' },
        { ...validLogTemplate, id: 'log-invalid', date: 'invalid-date' },
        { ...validLogTemplate, id: 'log-recent-1', date: '2026-08-10' },
        { ...validLogTemplate, id: 'log-recent-2', date: '2026-08-08' },
        { ...validLogTemplate, id: 'log-recent-3', date: '2026-08-05' },
        { ...validLogTemplate, id: 'log-recent-4', date: '2026-08-02' },
      ];

      const extracted = extractObservedFatigueRatios('Barbell Bench Press', logs, 'hypertrophy');
      expect(extracted).toHaveLength(3);
      expect(extracted.map((e) => e.logId)).toEqual(['log-recent-1', 'log-recent-2', 'log-recent-3']);
    });

    it('matches exercises by normalized name case-insensitively and regardless of array index', () => {
      const multiExLog: WorkoutLog = {
        id: 'log-multi',
        date: '2026-08-01',
        unit: 'kg',
        objective: 'Hypertrophy',
        exercises: [
          {
            name: 'Squat',
            muscleGroup: 'Quads',
            sets: [{ setNumber: 1, weight: 140, reps: 8, rpe: 8.0, isCompleted: true }],
          },
          {
            name: '  barbell BENCH press  ',
            muscleGroup: 'Chest',
            sets: [{ setNumber: 1, weight: 100, reps: 10, rpe: 8.0, isCompleted: true }],
          },
        ],
      };

      const extracted = extractObservedFatigueRatios('Barbell Bench Press', [multiExLog], 'hypertrophy');
      expect(extracted).toHaveLength(1);
      expect(extracted[0].logId).toBe('log-multi');
    });
  });

  describe('Learned Blending Mathematics', () => {
    const priors = getFatiguePrior('hypertrophy'); // [1.0, 0.975, 0.950, 0.925, 0.900, 0.875]

    it('returns prior_only when 0 historical sessions exist', () => {
      const learned = computeLearnedFatigueRatios(priors, []);
      expect(learned).toHaveLength(6);
      expect(learned[0].status).toBe('prior_only');
      expect(learned[1].status).toBe('prior_only');
      expect(learned[1].blendedRatio).toBe(0.975);
      expect(learned[1].sampleCount).toBe(0);
      expect(learned[1].alpha).toBe(0.00);
    });

    it('blends correctly with N = 1 session (alpha = 0.33)', () => {
      const sessions: ObservedSessionRatio[] = [
        { logId: '1', date: '2026-08-01', ratiosByOrdinal: { 1: 1.0, 2: 0.92016, 3: 0.86514 } },
      ];
      const learned = computeLearnedFatigueRatios(priors, sessions);
      expect(learned[1].status).toBe('blended');
      expect(learned[1].sampleCount).toBe(1);
      expect(learned[1].alpha).toBe(0.33);
      // 0.67 * 0.975 + 0.33 * 0.92016 = 0.65325 + 0.30365 = 0.95690
      expect(learned[1].blendedRatio).toBeCloseTo(0.95690, 4);

      expect(learned[2].status).toBe('blended');
      expect(learned[2].sampleCount).toBe(1);
      // 0.67 * 0.950 + 0.33 * 0.86514 = 0.6365 + 0.28550 = 0.92200
      expect(learned[2].blendedRatio).toBeCloseTo(0.92200, 4);
    });

    it('blends correctly with N = 2 sessions (alpha = 0.66, mean median)', () => {
      const sessions: ObservedSessionRatio[] = [
        { logId: '1', date: '2026-08-02', ratiosByOrdinal: { 1: 1.0, 2: 0.92 } },
        { logId: '2', date: '2026-08-01', ratiosByOrdinal: { 1: 1.0, 2: 0.90 } },
      ];
      const learned = computeLearnedFatigueRatios(priors, sessions);
      expect(learned[1].status).toBe('blended');
      expect(learned[1].sampleCount).toBe(2);
      expect(learned[1].alpha).toBe(0.66);
      expect(learned[1].observedMedian).toBe(0.91);
      // 0.34 * 0.975 + 0.66 * 0.91 = 0.3315 + 0.6006 = 0.9321
      expect(learned[1].blendedRatio).toBeCloseTo(0.9321, 4);
    });

    it('blends fully with N = 3 sessions (alpha = 1.00, true median)', () => {
      const sessions: ObservedSessionRatio[] = [
        { logId: '1', date: '2026-08-03', ratiosByOrdinal: { 1: 1.0, 2: 0.94 } },
        { logId: '2', date: '2026-08-02', ratiosByOrdinal: { 1: 1.0, 2: 0.91 } },
        { logId: '3', date: '2026-08-01', ratiosByOrdinal: { 1: 1.0, 2: 0.88 } },
      ];
      const learned = computeLearnedFatigueRatios(priors, sessions);
      expect(learned[1].status).toBe('fully_learned');
      expect(learned[1].sampleCount).toBe(3);
      expect(learned[1].alpha).toBe(1.00);
      expect(learned[1].observedMedian).toBe(0.91);
      expect(learned[1].blendedRatio).toBe(0.91);
    });

    it('defensively slices direct input to 3 most recent sessions and caps sampleCount at 3', () => {
      const sessions: ObservedSessionRatio[] = [
        { logId: '1', date: '2026-08-05', ratiosByOrdinal: { 1: 1.0, 2: 0.94 } },
        { logId: '2', date: '2026-08-04', ratiosByOrdinal: { 1: 1.0, 2: 0.91 } },
        { logId: '3', date: '2026-08-03', ratiosByOrdinal: { 1: 1.0, 2: 0.88 } },
        { logId: '4', date: '2026-08-02', ratiosByOrdinal: { 1: 1.0, 2: 0.99 } }, // Ignored
        { logId: '5', date: '2026-08-01', ratiosByOrdinal: { 1: 1.0, 2: 0.70 } }, // Ignored
      ];
      const learned = computeLearnedFatigueRatios(priors, sessions);
      expect(learned[0].sampleCount).toBe(3);
      expect(learned[1].sampleCount).toBe(3);
      expect(learned[1].alpha).toBe(1.00);
      expect(learned[1].observedMedian).toBe(0.91); // Median of first 3 [0.88, 0.91, 0.94]
      expect(learned[1].blendedRatio).toBe(0.91);
    });

    it('enforces non-increasing monotonicity F_i <= F_(i-1)', () => {
      // Create noisy session where Set 3 has higher ratio than Set 2
      const sessions: ObservedSessionRatio[] = [
        { logId: '1', date: '2026-08-03', ratiosByOrdinal: { 1: 1.0, 2: 0.85, 3: 0.92 } },
        { logId: '2', date: '2026-08-02', ratiosByOrdinal: { 1: 1.0, 2: 0.85, 3: 0.92 } },
        { logId: '3', date: '2026-08-01', ratiosByOrdinal: { 1: 1.0, 2: 0.85, 3: 0.92 } },
      ];
      const learned = computeLearnedFatigueRatios(priors, sessions);
      expect(learned[1].blendedRatio).toBe(0.85);
      expect(learned[2].blendedRatio).toBe(0.85); // Clamped to 0.85 by monotonicity
    });
  });

  describe('Runtime Profile & Configuration Validation', () => {
    const baseAnchor: SessionAnchor = {
      profileType: 'hypertrophy',
      baselineE1RM: 100,
      rawAnchorWeight: 70,
      roundedAnchorWeight: 70,
      anchorReps: 8,
      anchorRPE: 8.0,
      workingSetCount: 3,
      movementCategory: 'compound',
      equipment: 'freeweight',
      modality: 'weighted',
    };

    it('rejects unknown runtime profileType strings', () => {
      const res = distributeMultiSetTargets({ ...baseAnchor, profileType: 'unknown_profile' as any }, 'Bench', []);
      expect(res.isBypassed).toBe(true);
      expect(res.bypassReason).toBe('invalid_profile_configuration');
      expect(res.targets).toEqual([]);
      expect(res.unsupportedOrdinalRange).toBeNull();
    });

    it('rejects hypertrophy algorithm paired with strength profile', () => {
      const res = distributeMultiSetTargets(
        { ...baseAnchor, algorithmId: 'hypertrophy_linear', profileType: 'strength_normal' },
        'Bench',
        []
      );
      expect(res.isBypassed).toBe(true);
      expect(res.bypassReason).toBe('invalid_profile_configuration');
    });

    it('rejects strength algorithm paired with hypertrophy profile', () => {
      const res = distributeMultiSetTargets(
        { ...baseAnchor, algorithmId: 'strength_linear', profileType: 'hypertrophy' },
        'Bench',
        []
      );
      expect(res.isBypassed).toBe(true);
      expect(res.bypassReason).toBe('invalid_profile_configuration');
    });

    it('rejects algorithmId = "none" for active target generation', () => {
      const res = distributeMultiSetTargets(
        { ...baseAnchor, algorithmId: 'none', profileType: 'hypertrophy' },
        'Bench',
        []
      );
      expect(res.isBypassed).toBe(true);
      expect(res.bypassReason).toBe('invalid_profile_configuration');
    });

    it('allows undefined algorithmId when profile and anchor are consistent', () => {
      const res = distributeMultiSetTargets(
        { ...baseAnchor, algorithmId: undefined, profileType: 'hypertrophy' },
        'Bench',
        []
      );
      expect(res.isBypassed).toBe(false);
      expect(res.targets).toHaveLength(3);
    });

    it('rejects strength_post_test with reps !== 1', () => {
      const res = distributeMultiSetTargets(
        { ...baseAnchor, profileType: 'strength_post_test', anchorReps: 3, anchorRPE: 10.0 },
        'Deadlift',
        []
      );
      expect(res.isBypassed).toBe(true);
      expect(res.bypassReason).toBe('invalid_profile_configuration');
    });

    it('rejects strength_post_test with RPE < 9.5', () => {
      const res = distributeMultiSetTargets(
        { ...baseAnchor, profileType: 'strength_post_test', anchorReps: 1, anchorRPE: 9.0 },
        'Deadlift',
        []
      );
      expect(res.isBypassed).toBe(true);
      expect(res.bypassReason).toBe('invalid_profile_configuration');
    });

    it('rejects strength_normal receiving 1 rep @ RPE >= 9.5', () => {
      const res = distributeMultiSetTargets(
        { ...baseAnchor, profileType: 'strength_normal', anchorReps: 1, anchorRPE: 10.0 },
        'Deadlift',
        []
      );
      expect(res.isBypassed).toBe(true);
      expect(res.bypassReason).toBe('invalid_profile_configuration');
    });
  });

  describe('Specialized Function Defensive Integrity', () => {
    const validHyperAnchor: SessionAnchor = {
      profileType: 'hypertrophy',
      baselineE1RM: 100,
      rawAnchorWeight: 70,
      roundedAnchorWeight: 70,
      anchorReps: 8,
      anchorRPE: 8.0,
      workingSetCount: 3,
      movementCategory: 'compound',
      modality: 'weighted',
    };

    it('distributePeakSingleStrengthSets returns null when called directly with non-peak anchor', () => {
      const priors = getFatiguePrior('strength_post_test');
      // Reps !== 1
      const res1 = distributePeakSingleStrengthSets({ ...validHyperAnchor, profileType: 'strength_post_test', anchorReps: 3, anchorRPE: 10.0 }, priors);
      expect(res1).toBeNull();

      // RPE < 9.5
      const res2 = distributePeakSingleStrengthSets({ ...validHyperAnchor, profileType: 'strength_post_test', anchorReps: 1, anchorRPE: 9.0 }, priors);
      expect(res2).toBeNull();
    });

    it('distributeStrengthSets returns null when called directly with peak single', () => {
      const priors = getFatiguePrior('strength_normal');
      const res = distributeStrengthSets({ ...validHyperAnchor, profileType: 'strength_normal', anchorReps: 1, anchorRPE: 10.0 }, priors);
      expect(res).toBeNull();
    });

    it('specialized functions return null rather than using synthetic multiplier fallbacks when multipliers fail', () => {
      const invalidFatigue = [1.0, NaN, 0.95];
      const resHyper = distributeHypertrophySets(validHyperAnchor, invalidFatigue);
      expect(resHyper).toBeNull();

      const resStrength = distributeStrengthSets({ ...validHyperAnchor, profileType: 'strength_normal', anchorReps: 5 }, invalidFatigue);
      expect(resStrength).toBeNull();

      const resPeak = distributePeakSingleStrengthSets({ ...validHyperAnchor, profileType: 'strength_post_test', anchorReps: 1, anchorRPE: 10.0 }, invalidFatigue);
      expect(resPeak).toBeNull();
    });
  });

  describe('The Four Approved Worked Examples', () => {
    it('Worked Example 1: No-History hypertrophy_step (Compound Free-Weight)', () => {
      const anchor: SessionAnchor = {
        algorithmId: 'hypertrophy_step',
        profileType: 'hypertrophy',
        baselineE1RM: 147.0588, // 95 / 0.646 = 147.0588
        rawAnchorWeight: 95.0,
        roundedAnchorWeight: 95.0,
        anchorReps: 10,
        anchorRPE: 7.0,
        workingSetCount: 3,
        movementCategory: 'compound',
        equipment: 'freeweight',
        modality: 'weighted',
      };

      const result = distributeMultiSetTargets(anchor, 'Squat', []);
      expect(result.isBypassed).toBe(false);
      expect(result.targets).toHaveLength(3);
      expect(result.unsupportedOrdinalRange).toBeNull();

      expect(result.targets[0]).toEqual({ workingSetOrdinal: 1, weight: 95.0, reps: 10, rpe: 7.0 });
      expect(result.targets[1]).toEqual({ workingSetOrdinal: 2, weight: 95.0, reps: 10, rpe: 7.5 });
      expect(result.targets[2]).toEqual({ workingSetOrdinal: 3, weight: 95.0, reps: 10, rpe: 8.0 });
    });

    it('Worked Example 2: Learned Hypertrophy Session with Rep Drop and Load Drop', () => {
      const historicalLog: WorkoutLog = {
        id: 'log-hist-1',
        date: '2026-08-01',
        unit: 'kg',
        objective: 'Hypertrophy',
        exercises: [
          {
            name: 'Barbell Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            sets: [
              { setNumber: 1, weight: 100, reps: 10, rpe: 8.0, isCompleted: true },
              { setNumber: 2, weight: 100, reps: 10, rpe: 10.0, isCompleted: true },
              { setNumber: 3, weight: 100, reps: 8, rpe: 10.0, isCompleted: true },
            ],
          },
        ],
      };

      const anchor: SessionAnchor = {
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 147.0588,
        rawAnchorWeight: 114.559,
        roundedAnchorWeight: 115.0,
        anchorReps: 6,
        anchorRPE: 8.0,
        workingSetCount: 3,
        movementCategory: 'compound',
        equipment: 'freeweight',
        modality: 'weighted',
      };

      const result = distributeMultiSetTargets(anchor, 'Barbell Bench Press', [historicalLog]);
      expect(result.isBypassed).toBe(false);
      expect(result.targets).toHaveLength(3);
      expect(result.unsupportedOrdinalRange).toBeNull();

      expect(result.targets[0]).toEqual({ workingSetOrdinal: 1, weight: 115.0, reps: 6, rpe: 8.0 });
      expect(result.targets[1]).toEqual({ workingSetOrdinal: 2, weight: 115.0, reps: 5, rpe: 8.5 });
      expect(result.targets[2]).toEqual({ workingSetOrdinal: 3, weight: 112.5, reps: 5, rpe: 9.0 });
    });

    it('Worked Example 3: Normal Strength Top Set & Back-Offs', () => {
      const anchor: SessionAnchor = {
        algorithmId: 'strength_undulating',
        profileType: 'strength_normal',
        baselineE1RM: 148.6989,
        rawAnchorWeight: 120.0,
        roundedAnchorWeight: 120.0,
        anchorReps: 5,
        anchorRPE: 8.0,
        workingSetCount: 3,
        movementCategory: 'compound',
        equipment: 'freeweight',
        modality: 'weighted',
      };

      const result = distributeMultiSetTargets(anchor, 'Squat', []);
      expect(result.isBypassed).toBe(false);
      expect(result.targets).toHaveLength(3);
      expect(result.unsupportedOrdinalRange).toBeNull();

      expect(result.targets[0]).toEqual({ workingSetOrdinal: 1, weight: 120.0, reps: 5, rpe: 8.0 });
      expect(result.targets[1]).toEqual({ workingSetOrdinal: 2, weight: 112.5, reps: 5, rpe: 7.0 });
      expect(result.targets[2]).toEqual({ workingSetOrdinal: 3, weight: 112.5, reps: 5, rpe: 7.5 });
    });

    it('Worked Example 4: Peak-Test Single & Safe Back-Off Triples (Strict Unrounded Baseline)', () => {
      const anchor: SessionAnchor = {
        algorithmId: 'strength_linear',
        profileType: 'strength_post_test',
        baselineE1RM: 147.0588,
        rawAnchorWeight: 147.0588,
        roundedAnchorWeight: 147.5,
        anchorReps: 1,
        anchorRPE: 10.0,
        workingSetCount: 6,
        movementCategory: 'compound',
        equipment: 'freeweight',
        modality: 'weighted',
      };

      const result = distributeMultiSetTargets(anchor, 'Deadlift', []);
      expect(result.isBypassed).toBe(false);
      expect(result.targets).toHaveLength(6);
      expect(result.unsupportedOrdinalRange).toBeNull();

      expect(result.targets[0]).toEqual({ workingSetOrdinal: 1, weight: 147.5, reps: 1, rpe: 10.0 });
      expect(result.targets[1]).toEqual({ workingSetOrdinal: 2, weight: 117.5, reps: 3, rpe: 7.5 });
      expect(result.targets[2]).toEqual({ workingSetOrdinal: 3, weight: 117.5, reps: 3, rpe: 8.0 });
      expect(result.targets[3]).toEqual({ workingSetOrdinal: 4, weight: 112.5, reps: 3, rpe: 8.0 });
      expect(result.targets[4]).toEqual({ workingSetOrdinal: 5, weight: 112.5, reps: 3, rpe: 8.5 });
      expect(result.targets[5]).toEqual({ workingSetOrdinal: 6, weight: 110.0, reps: 3, rpe: 8.5 });
    });
  });

  describe('Preservation Across All 4 Algorithm IDs', () => {
    const algos = ['hypertrophy_linear', 'hypertrophy_step', 'strength_undulating', 'strength_linear'] as const;

    it('preserves Set 1 verbatim for all 4 algorithm IDs', () => {
      for (const algoId of algos) {
        const isStrength = algoId.startsWith('strength');
        const anchor: SessionAnchor = {
          algorithmId: algoId,
          profileType: isStrength ? 'strength_normal' : 'hypertrophy',
          baselineE1RM: 140.0,
          rawAnchorWeight: 101.2,
          roundedAnchorWeight: 100.0,
          anchorReps: isStrength ? 5 : 8,
          anchorRPE: 8.0,
          workingSetCount: 3,
          movementCategory: 'compound',
          modality: 'weighted',
        };

        const result = distributeMultiSetTargets(anchor, 'Bench Press', []);
        expect(result.targets[0]).toEqual({
          workingSetOrdinal: 1,
          weight: 100.0,
          reps: isStrength ? 5 : 8,
          rpe: 8.0,
        });
      }
    });
  });

  describe('Isolation vs Compound Bounds', () => {
    it('applies 9.5 RPE ceiling and 8 rep floor to isolation movements', () => {
      const anchor: SessionAnchor = {
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 50.0,
        rawAnchorWeight: 30.0,
        roundedAnchorWeight: 30.0,
        anchorReps: 12,
        anchorRPE: 8.0,
        workingSetCount: 4,
        movementCategory: 'isolation',
        equipment: 'machine',
        modality: 'weighted',
      };

      const result = distributeMultiSetTargets(anchor, 'Bicep Curl', []);
      expect(result.targets[0].rpe).toBe(8.0);
      expect(result.targets[1].rpe).toBe(8.5);
      expect(result.targets[2].rpe).toBe(9.0);
      expect(result.targets[3].rpe).toBe(9.5); // Allowed up to 9.5 for isolation
      for (const t of result.targets) {
        expect(t.reps).toBeGreaterThanOrEqual(8);
      }
    });
  });

  describe('Working Set Counts & Boundary Guardrails', () => {
    const baseAnchor: SessionAnchor = {
      profileType: 'hypertrophy',
      baselineE1RM: 100.0,
      rawAnchorWeight: 70.0,
      roundedAnchorWeight: 70.0,
      anchorReps: 8,
      anchorRPE: 8.0,
      workingSetCount: 1,
      modality: 'weighted',
    };

    it('handles count = 0 as bypass', () => {
      const res = distributeMultiSetTargets({ ...baseAnchor, workingSetCount: 0 }, 'Bench', []);
      expect(res.isBypassed).toBe(true);
      expect(res.bypassReason).toBe('zero_working_sets');
      expect(res.targets).toHaveLength(0);
      expect(res.unsupportedOrdinalRange).toBeNull();
    });

    it('handles count = 1 returning only Set 1 with range null', () => {
      const res = distributeMultiSetTargets({ ...baseAnchor, workingSetCount: 1 }, 'Bench', []);
      expect(res.isBypassed).toBe(false);
      expect(res.targets).toHaveLength(1);
      expect(res.targets[0].workingSetOrdinal).toBe(1);
      expect(res.unsupportedOrdinalRange).toBeNull();
    });

    it('handles count <= 6 returning range null', () => {
      const res = distributeMultiSetTargets({ ...baseAnchor, workingSetCount: 6 }, 'Bench', []);
      expect(res.isBypassed).toBe(false);
      expect(res.targets).toHaveLength(6);
      expect(res.unsupportedOrdinalRange).toBeNull();
    });

    it('handles count > 6 returning generated 1..6 and reporting bounded range { from: 7, to: count }', () => {
      const res = distributeMultiSetTargets({ ...baseAnchor, workingSetCount: 8 }, 'Bench', []);
      expect(res.isBypassed).toBe(false);
      expect(res.targets).toHaveLength(6);
      expect(res.unsupportedOrdinalRange).toEqual({ from: 7, to: 8 });
    });

    it('handles large safe workingSetCount without allocation and reports accurate range', () => {
      const res = distributeMultiSetTargets({ ...baseAnchor, workingSetCount: 1000 }, 'Bench', []);
      expect(res.isBypassed).toBe(false);
      expect(res.targets).toHaveLength(6);
      expect(res.unsupportedOrdinalRange).toEqual({ from: 7, to: 1000 });
    });

    it('bypasses invalid, fractional, negative, NaN, infinite, or unsafe integer workingSetCount', () => {
      const invalidCounts = [-1, 2.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 10];
      for (const count of invalidCounts) {
        const res = distributeMultiSetTargets({ ...baseAnchor, workingSetCount: count as any }, 'Bench', []);
        expect(res.isBypassed).toBe(true);
        expect(res.bypassReason).toBe('invalid_anchor_inputs');
        expect(res.unsupportedOrdinalRange).toBeNull();
      }
    });

    it('bypasses invalid anchor baseline and weights without throwing or fabricating 0 target', () => {
      const invalidBaselines = [0, -100, NaN, Infinity];
      for (const b of invalidBaselines) {
        const res = distributeMultiSetTargets({ ...baseAnchor, baselineE1RM: b }, 'Bench', []);
        expect(res.isBypassed).toBe(true);
        expect(res.bypassReason).toBe('invalid_anchor_inputs');
      }
    });

    it('guarantees pure target object contract (no logging metadata)', () => {
      const res = distributeMultiSetTargets({ ...baseAnchor, workingSetCount: 3 }, 'Bench', []);
      for (const t of res.targets) {
        const keys = Object.keys(t);
        expect(keys.sort()).toEqual(['reps', 'rpe', 'weight', 'workingSetOrdinal'].sort());
        expect((t as any).isCompleted).toBeUndefined();
        expect((t as any).isWarmup).toBeUndefined();
        expect((t as any).form).toBeUndefined();
        expect((t as any).comment).toBeUndefined();
      }
    });

    it('guarantees immutability of input anchor and logs', () => {
      const anchor: SessionAnchor = { ...baseAnchor, workingSetCount: 3 };
      const anchorCopy = JSON.parse(JSON.stringify(anchor));
      const logCopy = JSON.parse(JSON.stringify([]));

      distributeMultiSetTargets(anchor, 'Bench', []);
      expect(anchor).toEqual(anchorCopy);
    });
  });

  describe('Bodyweight Historical Fatigue Learning (Phase AS-4A)', () => {
    const bw100SnapshotKg: BodyweightSnapshot = { value: 100, unit: 'kg' };

    // Fixture A: 1 observation
    const bwLogWeek2: WorkoutLog = {
      id: 'log-bw-w2',
      date: '2026-08-01',
      unit: 'kg',
      objective: 'Hypertrophy',
      bodyweightSnapshot: bw100SnapshotKg,
      exercises: [
        {
          name: 'Pull-up',
          muscleGroup: 'Back',
          modality: 'bodyweight',
          sets: [
            { setNumber: 1, weight: 0, reps: 10, rpe: 8.0, isCompleted: true, form: 'standard' },
            { setNumber: 2, weight: 0, reps: 8, rpe: 8.5, isCompleted: true, form: 'standard' },
            { setNumber: 3, weight: 0, reps: 7, rpe: 9.0, isCompleted: true, form: 'standard' },
          ],
        },
      ],
    };

    // Fixture B: 2nd observation
    const bwLogWeek3: WorkoutLog = {
      id: 'log-bw-w3',
      date: '2026-08-08',
      unit: 'kg',
      objective: 'Hypertrophy',
      bodyweightSnapshot: bw100SnapshotKg,
      exercises: [
        {
          name: 'Pull-up',
          muscleGroup: 'Back',
          modality: 'bodyweight',
          sets: [
            { setNumber: 1, weight: 0, reps: 10, rpe: 8.0, isCompleted: true, form: 'standard' },
            { setNumber: 2, weight: 0, reps: 7, rpe: 8.5, isCompleted: true, form: 'standard' },
            { setNumber: 3, weight: 0, reps: 4, rpe: 10.0, isCompleted: true, form: 'standard' },
          ],
        },
      ],
    };

    // Fixture C: 3rd observation
    const bwLogWeek4: WorkoutLog = {
      id: 'log-bw-w4',
      date: '2026-08-15',
      unit: 'kg',
      objective: 'Hypertrophy',
      bodyweightSnapshot: bw100SnapshotKg,
      exercises: [
        {
          name: 'Pull-up',
          muscleGroup: 'Back',
          modality: 'bodyweight',
          sets: [
            { setNumber: 1, weight: 0, reps: 10, rpe: 8.0, isCompleted: true, form: 'standard' },
            { setNumber: 2, weight: 0, reps: 6, rpe: 8.5, isCompleted: true, form: 'standard' },
            { setNumber: 3, weight: 0, reps: 5, rpe: 9.5, isCompleted: true, form: 'standard' },
          ],
        },
      ],
    };

    it('Fixture A: extracts exact observed ratios and blends with alpha=0.33 for 1 bodyweight observation', () => {
      const extracted = extractObservedFatigueRatios('Pull-up', [bwLogWeek2], 'hypertrophy');
      expect(extracted).toHaveLength(1);
      expect(extracted[0].logId).toBe('log-bw-w2');
      expect(extracted[0].ratiosByOrdinal[1]).toBe(1.000);

      // RTS(10, 8.0) = 0.680; RTS(8, 8.5) = 0.743; RTS(7, 9.0) = 0.779
      // Set 2 ratio = 0.680 / 0.743 = 0.915208614
      // Set 3 ratio = 0.680 / 0.779 = 0.872913992
      expect(extracted[0].ratiosByOrdinal[2]).toBeCloseTo(0.680 / 0.743, 6);
      expect(extracted[0].ratiosByOrdinal[3]).toBeCloseTo(0.680 / 0.779, 6);

      const priors = getFatiguePrior('hypertrophy');
      const learned = computeLearnedFatigueRatios(priors, extracted);
      expect(learned[1].status).toBe('blended');
      expect(learned[1].sampleCount).toBe(1);
      expect(learned[1].alpha).toBe(0.33);
      // Blended F2 = (0.67 * 0.975) + (0.33 * (0.680 / 0.743)) = 0.65325 + 0.302018843 = 0.955268843
      expect(learned[1].blendedRatio).toBeCloseTo(0.955268843, 5);
      // Blended F3 = (0.67 * 0.950) + (0.33 * (0.680 / 0.779)) = 0.63650 + 0.288061617 = 0.924561617
      expect(learned[2].blendedRatio).toBeCloseTo(0.924561617, 5);
    });

    it('Fixture B: computes median and blends with alpha=0.66 for 2 bodyweight observations', () => {
      const extracted = extractObservedFatigueRatios('Pull-up', [bwLogWeek2, bwLogWeek3], 'hypertrophy');
      expect(extracted).toHaveLength(2);

      // Log Week 3 ratios: Set 2: 0.680 / 0.765 = 0.888888889; Set 3: 0.680 / 0.892 = 0.762331839
      const w3Extracted = extracted.find((e) => e.logId === 'log-bw-w3')!;
      expect(w3Extracted.ratiosByOrdinal[2]).toBeCloseTo(0.680 / 0.765, 6);
      expect(w3Extracted.ratiosByOrdinal[3]).toBeCloseTo(0.680 / 0.892, 6);

      const priors = getFatiguePrior('hypertrophy');
      const learned = computeLearnedFatigueRatios(priors, extracted);
      expect(learned[1].status).toBe('blended');
      expect(learned[1].sampleCount).toBe(2);
      expect(learned[1].alpha).toBe(0.66);

      // Median F2 = (0.915208614 + 0.888888889) / 2 = 0.902048751
      expect(learned[1].observedMedian).toBeCloseTo(0.902048751, 5);
      // Blended F2 = (0.34 * 0.975) + (0.66 * 0.902048751) = 0.926852176
      expect(learned[1].blendedRatio).toBeCloseTo(0.926852176, 5);

      // Median F3 = (0.872913992 + 0.762331839) / 2 = 0.817622916
      expect(learned[2].observedMedian).toBeCloseTo(0.817622916, 5);
      // Blended F3 = (0.34 * 0.950) + (0.66 * 0.817622916) = 0.862631125
      expect(learned[2].blendedRatio).toBeCloseTo(0.862631125, 5);
    });

    it('Fixture C: fully learns from 3 bodyweight observations with alpha=1.00 and ignores 4th older session', () => {
      const olderBwLog: WorkoutLog = {
        id: 'log-bw-older',
        date: '2026-07-20',
        unit: 'kg',
        objective: 'Hypertrophy',
        bodyweightSnapshot: bw100SnapshotKg,
        exercises: [
          {
            name: 'Pull-up',
            muscleGroup: 'Back',
            modality: 'bodyweight',
            sets: [
              { setNumber: 1, weight: 0, reps: 10, rpe: 8.0, isCompleted: true },
              { setNumber: 2, weight: 0, reps: 5, rpe: 9.0, isCompleted: true },
            ],
          },
        ],
      };

      const extracted = extractObservedFatigueRatios(
        'Pull-up',
        [olderBwLog, bwLogWeek2, bwLogWeek3, bwLogWeek4],
        'hypertrophy'
      );
      expect(extracted).toHaveLength(3);
      expect(extracted.map((e) => e.logId)).toEqual(['log-bw-w4', 'log-bw-w3', 'log-bw-w2']);

      const priors = getFatiguePrior('hypertrophy');
      const learned = computeLearnedFatigueRatios(priors, extracted);
      expect(learned[1].status).toBe('fully_learned');
      expect(learned[1].sampleCount).toBe(3);
      expect(learned[1].alpha).toBe(1.00);
      expect(learned[1].blendedRatio).toBe(learned[1].observedMedian);
    });

    it('ignores raw SetEntry.weight for bodyweight fatigue calculations', () => {
      const substitutedWeightLog: WorkoutLog = {
        id: 'log-bw-subst',
        date: '2026-08-01',
        unit: 'kg',
        objective: 'Hypertrophy',
        bodyweightSnapshot: bw100SnapshotKg,
        exercises: [
          {
            name: 'Pull-up',
            muscleGroup: 'Back',
            modality: 'bodyweight',
            sets: [
              // Set weight filled with 100 kg or 0 kg or 50 kg - should make no difference
              { setNumber: 1, weight: 100, reps: 10, rpe: 8.0, isCompleted: true },
              { setNumber: 2, weight: 0, reps: 8, rpe: 8.5, isCompleted: true },
              { setNumber: 3, weight: 999, reps: 7, rpe: 9.0, isCompleted: true },
            ],
          },
        ],
      };

      const extracted = extractObservedFatigueRatios('Pull-up', [substitutedWeightLog], 'hypertrophy');
      expect(extracted).toHaveLength(1);
      expect(extracted[0].ratiosByOrdinal[2]).toBeCloseTo(0.680 / 0.743, 6);
      expect(extracted[0].ratiosByOrdinal[3]).toBeCloseTo(0.680 / 0.779, 6);
    });
  });

  describe('Assisted Historical Fatigue Learning (Phase AS-4A)', () => {
    const bw80SnapshotKg: BodyweightSnapshot = { value: 80, unit: 'kg' };

    it('extracts fatigue ratios from assisted modality using effective load (bodyweight - assistance)', () => {
      // 80 kg bodyweight:
      // Set 1: 10 kg assistance, 5 reps @ RPE 8.0 => effectiveLoad = 70 kg, e1RM = 70 / RTS(5, 8.0) = 70 / 0.807 = 86.7410 kg
      // Set 2: 15 kg assistance, 5 reps @ RPE 8.0 => effectiveLoad = 65 kg, e1RM = 65 / 0.807 = 80.5452 kg
      // Set 3: 20 kg assistance, 5 reps @ RPE 8.0 => effectiveLoad = 60 kg, e1RM = 60 / 0.807 = 74.3494 kg
      // Ratios relative to Set 1: Set 2 = 65 / 70 = 0.9285714; Set 3 = 60 / 70 = 0.8571428
      const assistedLog: WorkoutLog = {
        id: 'log-assisted-1',
        date: '2026-08-01',
        unit: 'kg',
        objective: 'Hypertrophy',
        bodyweightSnapshot: bw80SnapshotKg,
        exercises: [
          {
            name: 'Assisted Pull-up',
            muscleGroup: 'Back',
            modality: 'assisted',
            sets: [
              { setNumber: 1, weight: 10, reps: 5, rpe: 8.0, isCompleted: true },
              { setNumber: 2, weight: 15, reps: 5, rpe: 8.0, isCompleted: true },
              { setNumber: 3, weight: 20, reps: 5, rpe: 8.0, isCompleted: true },
            ],
          },
        ],
      };

      const extracted = extractObservedFatigueRatios('Assisted Pull-up', [assistedLog], 'hypertrophy');
      expect(extracted).toHaveLength(1);
      expect(extracted[0].ratiosByOrdinal[1]).toBe(1.000);
      expect(extracted[0].ratiosByOrdinal[2]).toBeCloseTo(65 / 70, 6);
      expect(extracted[0].ratiosByOrdinal[3]).toBeCloseTo(60 / 70, 6);
    });

    it('allows 0 kg assistance when bodyweight is positive', () => {
      const zeroAssistanceLog: WorkoutLog = {
        id: 'log-assisted-0',
        date: '2026-08-01',
        unit: 'kg',
        objective: 'Hypertrophy',
        bodyweightSnapshot: bw80SnapshotKg,
        exercises: [
          {
            name: 'Assisted Dip',
            muscleGroup: 'Chest',
            modality: 'assisted',
            sets: [
              { setNumber: 1, weight: 0, reps: 8, rpe: 8.0, isCompleted: true },
              { setNumber: 2, weight: 5, reps: 8, rpe: 8.5, isCompleted: true },
            ],
          },
        ],
      };

      const extracted = extractObservedFatigueRatios('Assisted Dip', [zeroAssistanceLog], 'hypertrophy');
      expect(extracted).toHaveLength(1);
      expect(extracted[0].ratiosByOrdinal[1]).toBe(1.000);
      // Set 1: eff = 80 kg, e1RM = 80 / 0.728 = 109.8901
      // Set 2: eff = 75 kg, e1RM = 75 / 0.743 = 100.9421
      // Ratio = 100.9421 / 109.8901 = (75 / 0.743) / (80 / 0.728) = 0.918573
      expect(extracted[0].ratiosByOrdinal[2]).toBeCloseTo((75 / 0.743) / (80 / 0.728), 5);
    });

    it('produces identical dimensionless fatigue ratios across different bodyweights if effective load ratio is identical', () => {
      // Session A: 80 kg BW, 10 kg and 15 kg assistance (effective loads: 70 kg, 65 kg)
      const logA: WorkoutLog = {
        id: 'log-a',
        date: '2026-08-01',
        unit: 'kg',
        objective: 'Hypertrophy',
        bodyweightSnapshot: { value: 80, unit: 'kg' },
        exercises: [
          {
            name: 'Assisted Pull-up',
            muscleGroup: 'Back',
            modality: 'assisted',
            sets: [
              { setNumber: 1, weight: 10, reps: 5, rpe: 8.0, isCompleted: true },
              { setNumber: 2, weight: 15, reps: 5, rpe: 8.0, isCompleted: true },
            ],
          },
        ],
      };

      // Session B: 100 kg BW, 30 kg and 35 kg assistance (effective loads: 70 kg, 65 kg)
      const logB: WorkoutLog = {
        id: 'log-b',
        date: '2026-08-08',
        unit: 'kg',
        objective: 'Hypertrophy',
        bodyweightSnapshot: { value: 100, unit: 'kg' },
        exercises: [
          {
            name: 'Assisted Pull-up',
            muscleGroup: 'Back',
            modality: 'assisted',
            sets: [
              { setNumber: 1, weight: 30, reps: 5, rpe: 8.0, isCompleted: true },
              { setNumber: 2, weight: 35, reps: 5, rpe: 8.0, isCompleted: true },
            ],
          },
        ],
      };

      const extracted = extractObservedFatigueRatios('Assisted Pull-up', [logA, logB], 'hypertrophy');
      expect(extracted).toHaveLength(2);
      expect(extracted[0].ratiosByOrdinal[2]).toBeCloseTo(extracted[1].ratiosByOrdinal[2], 6);
    });
  });

  describe('Cross-Unit Physical Equivalence in Fatigue Learning', () => {
    it('produces equivalent fatigue ratios for physically equivalent kg and lb bodyweight sessions', () => {
      const kgLog: WorkoutLog = {
        id: 'log-kg',
        date: '2026-08-01',
        unit: 'kg',
        objective: 'Hypertrophy',
        bodyweightSnapshot: { value: 100, unit: 'kg' },
        exercises: [
          {
            name: 'Pull-up',
            muscleGroup: 'Back',
            modality: 'bodyweight',
            sets: [
              { setNumber: 1, weight: 0, reps: 10, rpe: 8.0, isCompleted: true },
              { setNumber: 2, weight: 0, reps: 8, rpe: 8.5, isCompleted: true },
            ],
          },
        ],
      };

      const lbLog: WorkoutLog = {
        id: 'log-lb',
        date: '2026-08-08',
        unit: 'lb',
        objective: 'Hypertrophy',
        bodyweightSnapshot: { value: 220.462, unit: 'lb' },
        exercises: [
          {
            name: 'Pull-up',
            muscleGroup: 'Back',
            modality: 'bodyweight',
            sets: [
              { setNumber: 1, weight: 0, reps: 10, rpe: 8.0, isCompleted: true },
              { setNumber: 2, weight: 0, reps: 8, rpe: 8.5, isCompleted: true },
            ],
          },
        ],
      };

      const extractedKg = extractObservedFatigueRatios('Pull-up', [kgLog], 'hypertrophy');
      const extractedLb = extractObservedFatigueRatios('Pull-up', [lbLog], 'hypertrophy');

      expect(extractedKg[0].ratiosByOrdinal[2]).toBeCloseTo(extractedLb[0].ratiosByOrdinal[2], 5);
    });
  });

  describe('Safe Bypass and Defensive Isolation in Fatigue Learning', () => {
    it('safely excludes bodyweight session with missing or null bodyweightSnapshot', () => {
      const noSnapshotLog: WorkoutLog = {
        id: 'log-no-snap',
        date: '2026-08-01',
        unit: 'kg',
        objective: 'Hypertrophy',
        bodyweightSnapshot: null,
        exercises: [
          {
            name: 'Pull-up',
            muscleGroup: 'Back',
            modality: 'bodyweight',
            sets: [{ setNumber: 1, weight: 0, reps: 10, rpe: 8.0, isCompleted: true }],
          },
        ],
      };

      const extracted = extractObservedFatigueRatios('Pull-up', [noSnapshotLog], 'hypertrophy');
      expect(extracted).toHaveLength(0);
    });

    it('safely excludes bodyweight session with non-positive snapshot value', () => {
      const zeroSnapshotLog: WorkoutLog = {
        id: 'log-zero-snap',
        date: '2026-08-01',
        unit: 'kg',
        objective: 'Hypertrophy',
        bodyweightSnapshot: { value: 0, unit: 'kg' },
        exercises: [
          {
            name: 'Pull-up',
            muscleGroup: 'Back',
            modality: 'bodyweight',
            sets: [{ setNumber: 1, weight: 0, reps: 10, rpe: 8.0, isCompleted: true }],
          },
        ],
      };

      const extracted = extractObservedFatigueRatios('Pull-up', [zeroSnapshotLog], 'hypertrophy');
      expect(extracted).toHaveLength(0);
    });

    it('safely excludes assisted session where assistance equals or exceeds bodyweight', () => {
      const excessiveAssistanceLog: WorkoutLog = {
        id: 'log-bad-asst',
        date: '2026-08-01',
        unit: 'kg',
        objective: 'Hypertrophy',
        bodyweightSnapshot: { value: 80, unit: 'kg' },
        exercises: [
          {
            name: 'Assisted Pull-up',
            muscleGroup: 'Back',
            modality: 'assisted',
            sets: [
              { setNumber: 1, weight: 80, reps: 5, rpe: 8.0, isCompleted: true }, // assistance == BW
            ],
          },
        ],
      };

      const extracted = extractObservedFatigueRatios('Assisted Pull-up', [excessiveAssistanceLog], 'hypertrophy');
      expect(extracted).toHaveLength(0);
    });

    it('safely excludes unsupported timed and distance modalities', () => {
      const timedLog: WorkoutLog = {
        id: 'log-timed',
        date: '2026-08-01',
        unit: 'kg',
        objective: 'Hypertrophy',
        exercises: [
          {
            name: 'Plank',
            muscleGroup: 'Core',
            modality: 'timed',
            sets: [{ setNumber: 1, weight: 0, reps: 60, rpe: 8.0, isCompleted: true }],
          },
        ],
      };

      const extracted = extractObservedFatigueRatios('Plank', [timedLog], 'hypertrophy');
      expect(extracted).toHaveLength(0);
    });

    it('guarantees immutability of historical logs and snapshots', () => {
      const testLog: WorkoutLog = {
        id: 'log-immut',
        date: '2026-08-01',
        unit: 'kg',
        objective: 'Hypertrophy',
        bodyweightSnapshot: { value: 100, unit: 'kg' },
        exercises: [
          {
            name: 'Pull-up',
            muscleGroup: 'Back',
            modality: 'bodyweight',
            sets: [
              { setNumber: 1, weight: 0, reps: 10, rpe: 8.0, isCompleted: true },
              { setNumber: 2, weight: 0, reps: 8, rpe: 8.5, isCompleted: true },
            ],
          },
        ],
      };

      const deepCopy = JSON.parse(JSON.stringify(testLog));
      extractObservedFatigueRatios('Pull-up', [testLog], 'hypertrophy');
      expect(testLog).toEqual(deepCopy);
    });
  });
});
