import { describe, it, expect } from 'vitest';
import { calculateObjectiveSets } from '../objectiveMath';
import { WorkoutLog, ExerciseEntry } from '../../types';

describe('MetReps Algorithm Profiles and Multi-Set Distribution Tests', () => {
  // Test fixture: Completed historical working set of 100 kg x 10 reps @ RPE 8.0
  // RTS 3-decimal table: 10 reps @ RPE 8.0 = 0.680
  // Unrounded baseline e1RM = 100 / 0.680 = 147.05882352941177 kg
  const standardHistoricalLogs: WorkoutLog[] = [
    {
      id: 'log-fixture-1',
      date: '2026-01-01',
      unit: 'kg',
      exercises: [
        {
          name: 'Bench Press (Barbell, Flat)',
          muscleGroup: 'Chest',
          isSkipped: false,
          sets: [
            { setNumber: 1, weight: 100, reps: 10, rpe: 8.0, isWarmup: false },
          ],
        },
      ],
    },
  ];

  const createTestExercise = (overrides?: Partial<ExerciseEntry>): ExerciseEntry => ({
    name: 'Bench Press (Barbell, Flat)',
    muscleGroup: 'Chest',
    modality: 'weighted',
    isMainMovement: true,
    movementCategory: 'compound',
    equipment: 'freeweight',
    sets: [
      { setNumber: 1, weight: 0, reps: 0, rpe: 0, isWarmup: false },
      { setNumber: 2, weight: 0, reps: 0, rpe: 0, isWarmup: false },
      { setNumber: 3, weight: 0, reps: 0, rpe: 0, isWarmup: false },
    ],
    ...overrides,
  });

  describe('1. strength_undulating (DUP)', () => {
    it('Week 2 of 8-week program: Set 1 = 120.0 kg x 5 @ 8.0, with distributed back-offs', () => {
      const exercise = createTestExercise();
      const result = calculateObjectiveSets({
        objective: 'Strength',
        exercise,
        exerciseIndex: 0,
        weekNum: 2,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'strength_undulating',
      });

      // 8-week undulating profile week 2: reps 5, rpe 8.0, target1RMPercent = 0.815
      // Raw target weight = 147.0588235... * 0.815 = 119.8529... kg -> Rounded = 120.0 kg
      expect(result.length).toBe(3);

      // Set 1 (Top Set): 120.0 kg x 5 reps @ RPE 8.0
      expect(result[0].weight).toBe(120.0);
      expect(result[0].reps).toBe(5);
      expect(result[0].rpe).toBe(8.0);

      // Set 2 (Back-off 1): 112.5 kg x 5 reps @ RPE 7.0
      expect(result[1].weight).toBe(112.5);
      expect(result[1].reps).toBe(5);
      expect(result[1].rpe).toBe(7.0);

      // Set 3 (Back-off 2): 112.5 kg x 5 reps @ RPE 7.5
      expect(result[2].weight).toBe(112.5);
      expect(result[2].reps).toBe(5);
      expect(result[2].rpe).toBe(7.5);
    });

    it('Defined 4-week program profile (Week 4 peak single post-test)', () => {
      const exercise = createTestExercise();
      const result = calculateObjectiveSets({
        objective: 'Strength',
        exercise,
        weekNum: 4,
        programDuration: 4,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'strength_undulating',
      });

      // 4-week profile week 4: reps 1, targetRPE 10.0, target1RMPercent = 1.00
      // Set 1: 147.5 kg x 1 rep @ RPE 10.0 (strength_post_test profile)
      expect(result[0].weight).toBe(147.5);
      expect(result[0].reps).toBe(1);
      expect(result[0].rpe).toBe(10.0);

      // Post-test back-offs: 3 reps per set at RPE 7.5 and 8.0
      expect(result[1].reps).toBe(3);
      expect(result[1].rpe).toBe(7.5);
      expect(result[1].weight).toBe(117.5);

      expect(result[2].reps).toBe(3);
      expect(result[2].rpe).toBe(8.0);
      expect(result[2].weight).toBe(117.5);
    });

    it('Defined 12-week program profile (Week 1: 5 reps @ 7.0)', () => {
      const exercise = createTestExercise();
      const result = calculateObjectiveSets({
        objective: 'Strength',
        exercise,
        weekNum: 1,
        programDuration: 12,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'strength_undulating',
      });

      // 12-week profile week 1: reps 5, rpe 7.0, target1RMPercent = 0.786
      // Set 1: 147.0588 * 0.786 = 115.588 -> 115.0 kg
      expect(result[0].weight).toBe(115.0);
      expect(result[0].reps).toBe(5);
      expect(result[0].rpe).toBe(7.0);
    });

    it('Undefined programDuration defaults to 8-week profile', () => {
      const exercise = createTestExercise();
      const result = calculateObjectiveSets({
        objective: 'Strength',
        exercise,
        weekNum: 2,
        programDuration: undefined,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'strength_undulating',
      });

      // 8-week profile week 2: reps 5, rpe 8.0, target1RMPercent = 0.815 -> 120.0 kg
      expect(result[0].weight).toBe(120.0);
      expect(result[0].reps).toBe(5);
      expect(result[0].rpe).toBe(8.0);
    });

    it('Custom 6-week program uses 4-week profile with modulo wrapping (Weeks 1-6)', () => {
      const exercise = createTestExercise();

      // Week 1 -> 4-week profile Week 1: 5 reps @ 7.0, 0.786 -> 115.0 kg
      const w1 = calculateObjectiveSets({
        objective: 'Strength',
        exercise,
        weekNum: 1,
        programDuration: 6,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'strength_undulating',
      });
      expect(w1[0].weight).toBe(115.0);
      expect(w1[0].reps).toBe(5);
      expect(w1[0].rpe).toBe(7.0);

      // Week 2 -> 4-week profile Week 2: 4 reps @ 8.0, 0.85 -> 125.0 kg
      const w2 = calculateObjectiveSets({
        objective: 'Strength',
        exercise,
        weekNum: 2,
        programDuration: 6,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'strength_undulating',
      });
      expect(w2[0].weight).toBe(125.0);
      expect(w2[0].reps).toBe(4);
      expect(w2[0].rpe).toBe(8.0);

      // Week 3 -> 4-week profile Week 3: 3 reps @ 9.0, 0.92 -> 135.0 kg
      const w3 = calculateObjectiveSets({
        objective: 'Strength',
        exercise,
        weekNum: 3,
        programDuration: 6,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'strength_undulating',
      });
      expect(w3[0].weight).toBe(135.0);
      expect(w3[0].reps).toBe(3);
      expect(w3[0].rpe).toBe(9.0);

      // Week 4 -> 4-week profile Week 4: 1 rep @ 10.0, 1.00 -> 147.5 kg
      const w4 = calculateObjectiveSets({
        objective: 'Strength',
        exercise,
        weekNum: 4,
        programDuration: 6,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'strength_undulating',
      });
      expect(w4[0].weight).toBe(147.5);
      expect(w4[0].reps).toBe(1);
      expect(w4[0].rpe).toBe(10.0);

      // Week 5 -> 4-week profile Week 1 repeat: 5 reps @ 7.0, 0.786 -> 115.0 kg
      const w5 = calculateObjectiveSets({
        objective: 'Strength',
        exercise,
        weekNum: 5,
        programDuration: 6,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'strength_undulating',
      });
      expect(w5[0].weight).toBe(115.0);
      expect(w5[0].reps).toBe(5);
      expect(w5[0].rpe).toBe(7.0);

      // Week 6 -> 4-week profile Week 2 repeat: 4 reps @ 8.0, 0.85 -> 125.0 kg
      const w6 = calculateObjectiveSets({
        objective: 'Strength',
        exercise,
        weekNum: 6,
        programDuration: 6,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'strength_undulating',
      });
      expect(w6[0].weight).toBe(125.0);
      expect(w6[0].reps).toBe(4);
      expect(w6[0].rpe).toBe(8.0);
    });

    it('Custom 10-week program: Weeks 9 and 10 map to 4-week profile Weeks 1 and 2', () => {
      const exercise = createTestExercise();

      // Week 9 -> 4-week profile Week 1: 5 reps @ 7.0, 0.786 -> 115.0 kg
      const w9 = calculateObjectiveSets({
        objective: 'Strength',
        exercise,
        weekNum: 9,
        programDuration: 10,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'strength_undulating',
      });
      expect(w9[0].weight).toBe(115.0);
      expect(w9[0].reps).toBe(5);
      expect(w9[0].rpe).toBe(7.0);

      // Week 10 -> 4-week profile Week 2: 4 reps @ 8.0, 0.85 -> 125.0 kg
      const w10 = calculateObjectiveSets({
        objective: 'Strength',
        exercise,
        weekNum: 10,
        programDuration: 10,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'strength_undulating',
      });
      expect(w10[0].weight).toBe(125.0);
      expect(w10[0].reps).toBe(4);
      expect(w10[0].rpe).toBe(8.0);
    });
  });

  describe('2. strength_linear (LP)', () => {
    it('Week 2 of 8-week program: Set 1 = 110.0 kg x 7 @ 7.5, with distributed back-offs', () => {
      const exercise = createTestExercise();
      const result = calculateObjectiveSets({
        objective: 'Strength',
        exercise,
        exerciseIndex: 0,
        weekNum: 2,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'strength_linear',
      });

      // weekNum = 2 in 8-week program:
      // progress = 1 / 7 ≈ 0.142857
      // targetReps = 7, targetRPE = 7.5, target1RMPercent = 0.742857
      // Raw target weight = 147.0588... * 0.742857... = 109.24 kg -> Rounded = 110.0 kg
      expect(result.length).toBe(3);

      // Set 1: 110.0 kg x 7 reps @ RPE 7.5
      expect(result[0].weight).toBe(110.0);
      expect(result[0].reps).toBe(7);
      expect(result[0].rpe).toBe(7.5);

      // Set 2: 102.5 kg x 7 reps @ RPE 6.5
      expect(result[1].weight).toBe(102.5);
      expect(result[1].reps).toBe(7);
      expect(result[1].rpe).toBe(6.5);

      // Set 3: 102.5 kg x 7 reps @ RPE 7.0
      expect(result[2].weight).toBe(102.5);
      expect(result[2].reps).toBe(7);
      expect(result[2].rpe).toBe(7.0);
    });

    it('Week 8 peak single test (1 rep @ 10.0 -> post-test triples)', () => {
      const exercise = createTestExercise();
      const result = calculateObjectiveSets({
        objective: 'Strength',
        exercise,
        weekNum: 8,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'strength_linear',
      });

      // Week 8 progress = 1.0 -> 1 rep @ 10.0, 100% 1RM -> 147.5 kg
      expect(result[0].weight).toBe(147.5);
      expect(result[0].reps).toBe(1);
      expect(result[0].rpe).toBe(10.0);

      // Post-test back-off triples: 3 reps @ RPE 7.5 and 8.0
      expect(result[1].reps).toBe(3);
      expect(result[1].rpe).toBe(7.5);
      expect(result[1].weight).toBe(117.5);

      expect(result[2].reps).toBe(3);
      expect(result[2].rpe).toBe(8.0);
      expect(result[2].weight).toBe(117.5);
    });
  });

  describe('3. hypertrophy_linear (Wave Volume)', () => {
    it('Odd week (Week 1) Compound Free Weight: 12 reps @ RPE 8.0 (90.0 kg Set 1) with distributed multi-sets', () => {
      const ex = createTestExercise({ movementCategory: 'compound', equipment: 'freeweight' });
      const result = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'hypertrophy_linear',
      });
      // 12 reps @ RPE 8.0 multiplier in rpeMath = 0.610
      // Raw weight = 147.0588235... * 0.610 = 89.70588... kg -> Rounded = 90.0 kg
      expect(result[0].reps).toBe(12);
      expect(result[0].rpe).toBe(8.0);
      expect(result[0].weight).toBe(90.0);

      // Set 2: 90.0 kg x 12 reps @ RPE 8.5
      expect(result[1].reps).toBe(12);
      expect(result[1].rpe).toBe(8.5);
      expect(result[1].weight).toBe(90.0);

      // Set 3: 90.0 kg x 12 reps @ RPE 9.0
      expect(result[2].reps).toBe(12);
      expect(result[2].rpe).toBe(9.0);
      expect(result[2].weight).toBe(90.0);
    });

    it('Odd week (Week 1) Isolation Free Weight: 15 reps @ RPE 8.0 (85.0 kg)', () => {
      const ex = createTestExercise({ movementCategory: 'isolation', equipment: 'freeweight' });
      const result = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'hypertrophy_linear',
      });
      expect(result[0].reps).toBe(15);
      expect(result[0].rpe).toBe(8.0);
      expect(result[0].weight).toBe(85.0);
    });

    it('Even week (Week 2) Compound Free Weight: 6 reps @ RPE 8.0 (115.0 kg)', () => {
      const ex = createTestExercise({ movementCategory: 'compound', equipment: 'freeweight' });
      const result = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 2,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'hypertrophy_linear',
      });
      expect(result[0].reps).toBe(6);
      expect(result[0].rpe).toBe(8.0);
      expect(result[0].weight).toBe(115.0);
    });

    it('Even week (Week 2) Compound Machine: 8 reps @ RPE 8.0 (107.5 kg)', () => {
      const ex = createTestExercise({ movementCategory: 'compound', equipment: 'machine' });
      const result = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 2,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'hypertrophy_linear',
      });
      expect(result[0].reps).toBe(8);
      expect(result[0].rpe).toBe(8.0);
      expect(result[0].weight).toBe(107.5);
    });

    it('Even week (Week 2) Isolation Free Weight: 10 reps @ RPE 8.0 (100.0 kg)', () => {
      const ex = createTestExercise({ movementCategory: 'isolation', equipment: 'freeweight' });
      const result = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 2,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'hypertrophy_linear',
      });
      expect(result[0].reps).toBe(10);
      expect(result[0].rpe).toBe(8.0);
      expect(result[0].weight).toBe(100.0);
    });

    it('Even week (Week 2) Isolation Machine: 12 reps @ RPE 8.0 (90.0 kg)', () => {
      const ex = createTestExercise({ movementCategory: 'isolation', equipment: 'machine' });
      const result = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 2,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'hypertrophy_linear',
      });
      expect(result[0].reps).toBe(12);
      expect(result[0].rpe).toBe(8.0);
      expect(result[0].weight).toBe(90.0);
    });
  });

  describe('4. hypertrophy_step (Step Loading)', () => {
    it('Week 1 (Base 10 @ 7.0): Category/Equipment Offsets', () => {
      const cFw = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: createTestExercise({ movementCategory: 'compound', equipment: 'freeweight' }),
        weekNum: 1,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'hypertrophy_step',
      });
      expect(cFw[0].reps).toBe(10);
      expect(cFw[0].rpe).toBe(7.0);

      const cMach = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: createTestExercise({ movementCategory: 'compound', equipment: 'machine' }),
        weekNum: 1,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'hypertrophy_step',
      });
      expect(cMach[0].reps).toBe(12);
      expect(cMach[0].rpe).toBe(7.0);

      const iFw = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: createTestExercise({ movementCategory: 'isolation', equipment: 'freeweight' }),
        weekNum: 1,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'hypertrophy_step',
      });
      expect(iFw[0].reps).toBe(12);
      expect(iFw[0].rpe).toBe(7.0);

      const iMach = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: createTestExercise({ movementCategory: 'isolation', equipment: 'machine' }),
        weekNum: 1,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'hypertrophy_step',
      });
      expect(iMach[0].reps).toBe(14);
      expect(iMach[0].rpe).toBe(7.0);
    });

    it('Week 4 (Base 12 @ 8.0) and Week 5 (Base 8 @ 7.5)', () => {
      const w4 = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: createTestExercise({ movementCategory: 'compound', equipment: 'freeweight' }),
        weekNum: 4,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'hypertrophy_step',
      });
      expect(w4[0].reps).toBe(12);
      expect(w4[0].rpe).toBe(8.0);

      const w5 = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: createTestExercise({ movementCategory: 'compound', equipment: 'freeweight' }),
        weekNum: 5,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'hypertrophy_step',
      });
      expect(w5[0].reps).toBe(8);
      expect(w5[0].rpe).toBe(7.5);
    });
  });

  describe('5. Classification, Modality & Eligibility Tests', () => {
    it('Strength algorithms do not transform non-main accessory movements', () => {
      const accessory = createTestExercise({ isMainMovement: false });
      const result = calculateObjectiveSets({
        objective: 'Strength',
        exercise: accessory,
        weekNum: 2,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'strength_undulating',
      });
      expect(result[0].weight).toBe(0);
      expect(result[0].reps).toBe(0);
    });

    it('User-provided movementCategory and equipment metadata control hypertrophy prescriptions when baseline is present', () => {
      const explicitMach = createTestExercise({
        name: 'Bench Press (Barbell, Flat)', // Has baseline in fixture
        movementCategory: 'compound',
        equipment: 'machine',
      });
      const result = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: explicitMach,
        weekNum: 2,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'hypertrophy_linear',
      });
      // Even week compound machine -> 8 reps @ RPE 8.0
      expect(result[0].reps).toBe(8);
      expect(result[0].rpe).toBe(8.0);
      expect(result[0].weight).toBe(107.5);
    });

    it('Undefined modality retains the existing weighted default behaviour', () => {
      const undefModality = createTestExercise({ modality: undefined });
      const result = calculateObjectiveSets({
        objective: 'Strength',
        exercise: undefModality,
        weekNum: 2,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'strength_undulating',
      });
      expect(result[0].weight).toBe(120.0);
      expect(result[0].reps).toBe(5);
    });

    it('Explicit weighted modality receives algorithm targets', () => {
      const weightedEx = createTestExercise({ modality: 'weighted' });
      const result = calculateObjectiveSets({
        objective: 'Strength',
        exercise: weightedEx,
        weekNum: 2,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'strength_undulating',
      });
      expect(result[0].weight).toBe(120.0);
      expect(result[0].reps).toBe(5);
      expect(result[0].rpe).toBe(8.0);
    });

    it('All five non-weighted modalities bypass target generation and return sets completely unchanged', () => {
      const nonWeightedModalities = [
        'bodyweight',
        'assisted',
        'timed',
        'distance',
        'distance_loaded',
      ] as const;

      const algorithmIds = [
        'strength_undulating',
        'strength_linear',
        'hypertrophy_linear',
        'hypertrophy_step',
      ] as const;

      for (const modality of nonWeightedModalities) {
        const testExercise: ExerciseEntry = {
          name: `${modality} Sample Movement`,
          muscleGroup: 'Back',
          modality,
          isMainMovement: true,
          movementCategory: 'compound',
          equipment: 'machine',
          isSuperset: true,
          sets: [
            {
              setNumber: 1,
              weight: 25,
              reps: 10,
              rpe: 7.5,
              isWarmup: false,
              form: 'strict',
              comment: 'First set note',
            },
            {
              setNumber: 2,
              weight: 30,
              reps: 8,
              rpe: 8.5,
              isWarmup: false,
              form: 'standard',
              comment: 'Second set note',
              isDropSet: true,
            },
          ],
        };

        for (const algorithmId of algorithmIds) {
          const result = calculateObjectiveSets({
            objective: algorithmId.startsWith('strength') ? 'Strength' : 'Hypertrophy',
            exercise: testExercise,
            weekNum: 2,
            programDuration: 8,
            previousLogs: standardHistoricalLogs,
            algorithmId,
          });

          // Sets must be completely unchanged
          expect(result).toBe(testExercise.sets);
          expect(result).toEqual(testExercise.sets);
          expect(result[0].weight).toBe(25);
          expect(result[0].reps).toBe(10);
          expect(result[0].rpe).toBe(7.5);
          expect(result[0].comment).toBe('First set note');
          expect(result[0].form).toBe('strict');
          expect(result[1].weight).toBe(30);
          expect(result[1].reps).toBe(8);
          expect(result[1].rpe).toBe(8.5);
          expect(result[1].comment).toBe('Second set note');
          expect(result[1].isDropSet).toBe(true);
        }
      }
    });
  });

  describe('6. Protection, Warm-ups, Ordinals & Invariants', () => {
    it('Objective Off returns the exercise sets unchanged', () => {
      const ex = createTestExercise();
      const result = calculateObjectiveSets({
        objective: 'Off',
        exercise: ex,
        weekNum: 2,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'strength_undulating',
      });
      expect(result).toEqual(ex.sets);
    });

    it('Warm-ups retain existing warm-up generation ramping behaviour from Set 1 load', () => {
      const exWithWarmup = createTestExercise({
        sets: [
          { setNumber: 1, weight: 0, reps: 0, rpe: 0, isWarmup: true },
          { setNumber: 2, weight: 0, reps: 0, rpe: 0, isWarmup: true },
          { setNumber: 3, weight: 0, reps: 0, rpe: 0, isWarmup: false },
        ],
      });

      const result = calculateObjectiveSets({
        objective: 'Strength',
        exercise: exWithWarmup,
        weekNum: 2,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'strength_undulating',
      });

      // Working set 1 weight = 120.0 kg, reps = 5, rpe = 8.0
      // 2 warmups:
      // Set 1 (warmup 1): 50% = 120.0 * 0.50 = 60.0 kg, 5 reps @ 4.0
      // Set 2 (warmup 2): 75% = 120.0 * 0.75 = 90.0 kg, 4 reps @ 6.0
      // Set 3 (working): 120.0 kg, 5 reps @ 8.0
      expect(result[0].isWarmup).toBe(true);
      expect(result[0].weight).toBe(60.0);
      expect(result[0].reps).toBe(5);
      expect(result[0].rpe).toBe(4.0);

      expect(result[1].isWarmup).toBe(true);
      expect(result[1].weight).toBe(90.0);
      expect(result[1].reps).toBe(4);
      expect(result[1].rpe).toBe(6.0);

      expect(result[2].isWarmup).toBe(false);
      expect(result[2].weight).toBe(120.0);
      expect(result[2].reps).toBe(5);
      expect(result[2].rpe).toBe(8.0);
    });

    it('userTouchedSets and checkedSets are protected from target overrides and preserve ordinals', () => {
      const ex = createTestExercise({
        sets: [
          { setNumber: 1, weight: 135, reps: 5, rpe: 9.0, isWarmup: false },
          { setNumber: 2, weight: 0, reps: 0, rpe: 0, isWarmup: false },
          { setNumber: 3, weight: 0, reps: 0, rpe: 0, isWarmup: false },
        ],
      });

      const result = calculateObjectiveSets({
        objective: 'Strength',
        exercise: ex,
        exerciseIndex: 0,
        weekNum: 2,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        userTouchedSets: { '0-0': true }, // Set 1 is user touched
        checkedSets: {},
        algorithmId: 'strength_undulating',
      });

      // Set 1 is protected
      expect(result[0].weight).toBe(135);
      expect(result[0].reps).toBe(5);
      expect(result[0].rpe).toBe(9.0);

      // Set 2 gets target for ordinal 2 (112.5 kg x 5 @ 7.0)
      expect(result[1].weight).toBe(112.5);
      expect(result[1].reps).toBe(5);
      expect(result[1].rpe).toBe(7.0);

      // Set 3 gets target for ordinal 3 (112.5 kg x 5 @ 7.5)
      expect(result[2].weight).toBe(112.5);
      expect(result[2].reps).toBe(5);
      expect(result[2].rpe).toBe(7.5);
    });

    it('All final generated target weights are multiples of 2.5', () => {
      const ex = createTestExercise();
      for (let week = 1; week <= 8; week++) {
        const result = calculateObjectiveSets({
          objective: 'Strength',
          exercise: ex,
          weekNum: week,
          programDuration: 8,
          previousLogs: standardHistoricalLogs,
          algorithmId: 'strength_undulating',
        });
        result.forEach((s) => {
          expect((s.weight ?? 0) % 2.5).toBe(0);
        });
      }
    });
  });
});
