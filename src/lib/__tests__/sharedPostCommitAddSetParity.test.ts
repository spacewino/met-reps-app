import { describe, it, expect } from 'vitest';
import { calculateAddedSetTarget } from '../objectiveMath';
import { ExerciseEntry, WorkoutLog } from '../../types';

describe('MetReps — Shared Post-Commit Add-Set Distribution-Parity Test Suite', () => {
  // =========================================================================
  // FIXTURE A: Weighted Hypertrophy Post-Commit Parity
  // Fresh/no-history weighted compound exercise: Barbell Bench Press (Flat)
  // Objective: Hypertrophy, Algorithm: Wave Volume (hypertrophy_linear), Week 1
  // Actual Set 1 committed: 100 kg x 12 @ RPE 9.0
  // Added Set 2: 100 kg x 10 @ 8.5
  // Added Set 3: 100 kg x 10 @ 9.0
  // Added Set 4: 100 kg x 9 @ 9.0
  // =========================================================================
  describe('Fixture A: Weighted Hypertrophy Post-Commit Parity (hypertrophy_linear)', () => {
    const exercise: ExerciseEntry = {
      name: 'Barbell Bench Press (Flat)',
      muscleGroup: 'Chest',
      modality: 'weighted',
      movementCategory: 'compound',
      equipment: 'freeweight',
      sets: [
        { setNumber: 1, weight: 100, reps: 12, rpe: 9.0, form: 'standard', isCompleted: true },
      ],
    };

    const committedEvidence = [
      { workingSetOrdinal: 1, weight: 100, reps: 12, rpe: 9.0, form: 'standard' as const },
    ];

    it('1. Post-commit Add Set 2 yields canonical 100 kg x 10 @ 8.5', () => {
      const res = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
        committedEvidence,
      });

      expect(res.isPrescribed).toBe(true);
      expect(res.workingSetOrdinal).toBe(2);
      expect(res.target).toEqual({
        weight: 100,
        reps: 10,
        rpe: 8.5,
        form: 'standard',
      });
    });

    it('2. Post-commit Add Set 3 yields canonical 100 kg x 10 @ 9.0', () => {
      const ex3: ExerciseEntry = {
        ...exercise,
        sets: [
          { setNumber: 1, weight: 100, reps: 12, rpe: 9.0, isCompleted: true },
          { setNumber: 2, weight: 100, reps: 10, rpe: 8.5, isCompleted: false },
        ],
      };

      const res = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex3,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
        committedEvidence,
      });

      expect(res.isPrescribed).toBe(true);
      expect(res.workingSetOrdinal).toBe(3);
      expect(res.target).toEqual({
        weight: 100,
        reps: 10,
        rpe: 9.0,
        form: 'standard',
      });
    });

    it('3. Post-commit Add Set 4 yields canonical 100 kg x 10 @ 9.0', () => {
      const ex4: ExerciseEntry = {
        ...exercise,
        sets: [
          { setNumber: 1, weight: 100, reps: 12, rpe: 9.0, isCompleted: true },
          { setNumber: 2, weight: 100, reps: 10, rpe: 8.5, isCompleted: false },
          { setNumber: 3, weight: 100, reps: 10, rpe: 9.0, isCompleted: false },
        ],
      };

      const res = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex4,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
        committedEvidence,
      });

      expect(res.isPrescribed).toBe(true);
      expect(res.workingSetOrdinal).toBe(4);
      expect(res.target).toEqual({
        weight: 100,
        reps: 10,
        rpe: 9.0,
        form: 'standard',
      });
    });
  });

  // =========================================================================
  // FIXTURE B: Pure-Bodyweight Hypertrophy Post-Commit Parity
  // Fresh/no-history pure-bodyweight compound exercise, Session BW: 110 kg
  // Objective: Hypertrophy, Algorithm: Wave Volume (hypertrophy_linear), Week 1
  // Actual Set 1 committed: 0 kg x 6 @ RPE 9.0
  // Added Set 2: 0 kg x 5 @ 8.5
  // Added Set 3: 0 kg x 5 @ 9.0
  // Added Set 4: 0 kg x 5 @ 9.0
  // =========================================================================
  describe('Fixture B: Pure-Bodyweight Hypertrophy Post-Commit Parity (hypertrophy_linear)', () => {
    const templateExercise: ExerciseEntry = {
      name: 'Pull-up',
      muscleGroup: 'Back',
      modality: 'bodyweight',
      sets: [
        { setNumber: 1, weight: 0, reps: 8, rpe: 8.0, form: 'standard' },
      ],
    };

    const exercise: ExerciseEntry = {
      name: 'Pull-up',
      muscleGroup: 'Back',
      modality: 'bodyweight',
      sets: [
        { setNumber: 1, weight: 0, reps: 6, rpe: 9.0, form: 'standard', isCompleted: true },
      ],
    };

    const committedEvidence = [
      { workingSetOrdinal: 1, weight: 0, reps: 6, rpe: 9.0, form: 'standard' as const },
    ];
    const bodyweightSnapshot = { value: 110, unit: 'kg' as const };

    it('4. Post-commit Add Set 2 yields canonical 0 kg x 5 @ 8.5', () => {
      const res = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
        templateExercise,
        bodyweightSnapshot,
        committedEvidence,
      });

      expect(res.isPrescribed).toBe(true);
      expect(res.workingSetOrdinal).toBe(2);
      expect(res.target).toEqual({
        weight: 0,
        reps: 5,
        rpe: 8.5,
        form: 'standard',
      });
    });

    it('5. Post-commit Add Set 3 yields canonical 0 kg x 5 @ 9.0', () => {
      const ex3: ExerciseEntry = {
        ...exercise,
        sets: [
          { setNumber: 1, weight: 0, reps: 6, rpe: 9.0, isCompleted: true },
          { setNumber: 2, weight: 0, reps: 5, rpe: 8.5, isCompleted: false },
        ],
      };

      const res = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex3,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
        templateExercise,
        bodyweightSnapshot,
        committedEvidence,
      });

      expect(res.isPrescribed).toBe(true);
      expect(res.workingSetOrdinal).toBe(3);
      expect(res.target).toEqual({
        weight: 0,
        reps: 5,
        rpe: 9.0,
        form: 'standard',
      });
    });

    it('6. Post-commit Add Set 4 yields canonical 0 kg x 5 @ 9.0', () => {
      const ex4: ExerciseEntry = {
        ...exercise,
        sets: [
          { setNumber: 1, weight: 0, reps: 6, rpe: 9.0, isCompleted: true },
          { setNumber: 2, weight: 0, reps: 5, rpe: 8.5, isCompleted: false },
          { setNumber: 3, weight: 0, reps: 5, rpe: 9.0, isCompleted: false },
        ],
      };

      const res = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex4,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
        templateExercise,
        bodyweightSnapshot,
        committedEvidence,
      });

      expect(res.isPrescribed).toBe(true);
      expect(res.workingSetOrdinal).toBe(4);
      expect(res.target).toEqual({
        weight: 0,
        reps: 5,
        rpe: 9.0,
        form: 'standard',
      });
    });
  });

  // =========================================================================
  // PRE-EVIDENCE COLD-START PARITY FOR BOTH MODALITIES ACROSS ALL 4 ALGORITHMS
  // =========================================================================
  describe('Pre-Evidence Cold-Start Add Set across Algorithms', () => {
    it('7. Weighted Pre-Evidence hypertrophy_step week 1 added sets', () => {
      const ex: ExerciseEntry = {
        name: 'Incline Dumbbell Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: [{ setNumber: 1, weight: 0, reps: 10, rpe: 8.0 }],
      };

      const res2 = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_step',
      });

      expect(res2.isPrescribed).toBe(true);
      expect(res2.workingSetOrdinal).toBe(2);
      expect(res2.target?.weight).toBe(0);
      expect(res2.target?.reps).toBe(10);
      expect(res2.target?.rpe).toBe(7.5);
    });

    it('8. Bodyweight Pre-Evidence hypertrophy_step week 1 added sets', () => {
      const ex: ExerciseEntry = {
        name: 'Dip',
        muscleGroup: 'Chest',
        modality: 'bodyweight',
        sets: [{ setNumber: 1, weight: 0, reps: 8, rpe: 8.0 }],
      };

      const res2 = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_step',
        bodyweightSnapshot: { value: 80, unit: 'kg' },
      });

      expect(res2.isPrescribed).toBe(true);
      expect(res2.workingSetOrdinal).toBe(2);
      expect(res2.target?.weight).toBe(0);
      expect(res2.target?.reps).toBe(10);
      expect(res2.target?.rpe).toBe(7.5);
    });

    it('9. Weighted Pre-Evidence strength_undulating week 1 added sets', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Squat',
        muscleGroup: 'Legs',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'freeweight',
        isMainMovement: true,
        sets: [{ setNumber: 1, weight: 0, reps: 5, rpe: 8.0 }],
      };

      const res2 = calculateAddedSetTarget({
        objective: 'Strength',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'strength_undulating',
      });

      expect(res2.isPrescribed).toBe(true);
      expect(res2.workingSetOrdinal).toBe(2);
      expect(res2.target?.weight).toBe(0);
      expect(res2.target?.reps).toBe(5);
      expect(res2.target?.rpe).toBe(6.0);
    });

    it('10. Weighted Pre-Evidence strength_linear week 1 added sets', () => {
      const ex: ExerciseEntry = {
        name: 'Deadlift',
        muscleGroup: 'Back',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'freeweight',
        isMainMovement: true,
        sets: [{ setNumber: 1, weight: 0, reps: 5, rpe: 8.0 }],
      };

      const res2 = calculateAddedSetTarget({
        objective: 'Strength',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'strength_linear',
      });

      expect(res2.isPrescribed).toBe(true);
      expect(res2.workingSetOrdinal).toBe(2);
      expect(res2.target?.weight).toBe(0);
      expect(res2.target?.reps).toBe(8);
      expect(res2.target?.rpe).toBe(6.0);
    });
  });

  // =========================================================================
  // WEIGHTED STRENGTH POST-COMMIT ADD SET
  // =========================================================================
  describe('Weighted Strength Post-Commit Add Set', () => {
    it('11. Strength main movement with committed Set 1 calculates authoritative back-off target', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Back Squat',
        muscleGroup: 'Legs',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'freeweight',
        isMainMovement: true,
        sets: [{ setNumber: 1, weight: 140, reps: 5, rpe: 8.0, isCompleted: true }],
      };

      const committedEvidence = [
        { workingSetOrdinal: 1, weight: 140, reps: 5, rpe: 8.0, form: 'standard' as const },
      ];

      const res2 = calculateAddedSetTarget({
        objective: 'Strength',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'strength_linear',
        committedEvidence,
      });

      expect(res2.isPrescribed).toBe(true);
      expect(res2.workingSetOrdinal).toBe(2);
      expect(res2.target!.weight).toBe(115);
      expect(res2.target!.reps).toBe(8);
      expect(res2.target!.rpe).toBe(6.0);
    });

    it('12. Strength non-main accessory bypasses Add Set prescription', () => {
      const ex: ExerciseEntry = {
        name: 'Leg Curl',
        muscleGroup: 'Hamstrings',
        modality: 'weighted',
        movementCategory: 'isolation',
        equipment: 'machine',
        isMainMovement: false,
        sets: [{ setNumber: 1, weight: 50, reps: 10, rpe: 8.0 }],
      };

      const res = calculateAddedSetTarget({
        objective: 'Strength',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'strength_linear',
      });

      expect(res.isPrescribed).toBe(false);
      expect(res.workingSetOrdinal).toBe(2);
    });
  });

  // =========================================================================
  // PROVISIONAL SET 1 ANCHOR ADD SET
  // =========================================================================
  describe('Provisional Set 1 Anchor Add Set', () => {
    it('13. Cold start uncommitted provisional Set 1 load distributes across added set', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: [{ setNumber: 1, weight: 80, reps: 12, rpe: 8.0 }],
      };

      const res2 = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
        committedEvidence: [],
      });

      expect(res2.isPrescribed).toBe(true);
      expect(res2.workingSetOrdinal).toBe(2);
      expect(res2.target!.weight).toBe(80);
      expect(res2.target!.reps).toBe(11);
      expect(res2.target!.rpe).toBe(8.5);
    });
  });

  // =========================================================================
  // HISTORICAL BASELINE ADD SET
  // =========================================================================
  describe('Historical Baseline Add Set', () => {
    it('14. Historical baseline with no session evidence generates canonical session target', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-1',
          date: '2026-01-01',
          unit: 'kg',
          exercises: [
            {
              name: 'Barbell Bench Press',
              muscleGroup: 'Chest',
              modality: 'weighted',
              sets: [{ setNumber: 1, weight: 100, reps: 10, rpe: 8.0, isCompleted: true }],
            },
          ],
        },
      ];

      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: [{ setNumber: 1, weight: 90, reps: 12, rpe: 8.0 }],
      };

      const res2 = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
        previousLogs: logs,
      });

      expect(res2.isPrescribed).toBe(true);
      expect(res2.workingSetOrdinal).toBe(2);
      expect(res2.target?.reps).toBe(12);
      expect(res2.target?.rpe).toBe(8.5);
    });
  });

  // =========================================================================
  // BOUNDARY, UNIT, AND DRIFT PROTECTION
  // =========================================================================
  describe('Boundary, Unit, and Immutability Safeguards', () => {
    it('15. Max 6 working set cap strictly returns unprescribed for set 7', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        sets: [
          { setNumber: 1, weight: 100, reps: 10, rpe: 8.0 },
          { setNumber: 2, weight: 100, reps: 10, rpe: 8.0 },
          { setNumber: 3, weight: 100, reps: 10, rpe: 8.0 },
          { setNumber: 4, weight: 100, reps: 10, rpe: 8.0 },
          { setNumber: 5, weight: 100, reps: 10, rpe: 8.0 },
          { setNumber: 6, weight: 100, reps: 10, rpe: 8.0 },
        ],
      };

      const res7 = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
      });

      expect(res7.isPrescribed).toBe(false);
      expect(res7.workingSetOrdinal).toBe(7);
    });

    it('16. Warmups do not consume working set ordinals', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        sets: [
          { setNumber: 1, weight: 40, reps: 10, rpe: 5.0, isWarmup: true },
          { setNumber: 2, weight: 60, reps: 5, rpe: 6.0, isWarmup: true },
          { setNumber: 3, weight: 100, reps: 12, rpe: 9.0, isCompleted: true },
        ],
      };

      const committedEvidence = [
        { workingSetOrdinal: 1, weight: 100, reps: 12, rpe: 9.0, form: 'standard' as const },
      ];

      const res = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
        committedEvidence,
      });

      expect(res.isPrescribed).toBe(true);
      expect(res.workingSetOrdinal).toBe(2);
      expect(res.target!.reps).toBe(10);
      expect(res.target!.rpe).toBe(8.5);
    });

    it('17. Pounds (lb) unit quantizes correctly on 2.5 lb grid', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        sets: [{ setNumber: 1, weight: 225, reps: 12, rpe: 9.0, isCompleted: true }],
      };

      const committedEvidence = [
        { workingSetOrdinal: 1, weight: 225, reps: 12, rpe: 9.0, form: 'standard' as const },
      ];

      const res = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
        activeUnit: 'lb',
        committedEvidence,
      });

      expect(res.isPrescribed).toBe(true);
      expect(res.target!.weight % 2.5).toBeCloseTo(0, 4);
    });

    it('18. Repeated 10x calls exhibit zero numerical drift', () => {
      const ex: ExerciseEntry = {
        name: 'Pull-up',
        muscleGroup: 'Back',
        modality: 'bodyweight',
        sets: [{ setNumber: 1, weight: 0, reps: 6, rpe: 9.0, isCompleted: true }],
      };

      const committedEvidence = [
        { workingSetOrdinal: 1, weight: 0, reps: 6, rpe: 9.0, form: 'standard' as const },
      ];
      const bodyweightSnapshot = { value: 110, unit: 'kg' as const };

      const results = Array.from({ length: 10 }, () =>
        calculateAddedSetTarget({
          objective: 'Hypertrophy',
          exercise: ex,
          weekNum: 1,
          programDuration: 8,
          algorithmId: 'hypertrophy_linear',
          bodyweightSnapshot,
          committedEvidence,
        })
      );

      for (let i = 1; i < results.length; i++) {
        expect(results[i]).toEqual(results[0]);
      }
    });

    it('19. Input exercise and sets are not mutated', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        sets: [{ setNumber: 1, weight: 100, reps: 12, rpe: 9.0 }],
      };

      const snapshot = JSON.stringify(ex);

      calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
      });

      expect(JSON.stringify(ex)).toBe(snapshot);
    });

    it('20. Bodyweight missing snapshot returns unprescribed for cold start', () => {
      const ex: ExerciseEntry = {
        name: 'Pull-up',
        muscleGroup: 'Back',
        modality: 'bodyweight',
        sets: [{ setNumber: 1, weight: 0, reps: 6, rpe: 9.0 }],
      };

      const res = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
        bodyweightSnapshot: undefined,
      });

      expect(res.isPrescribed).toBe(false);
      expect(res.workingSetOrdinal).toBe(2);
    });

    it('21. Loose form committed evidence does not trigger live adjustment calibration', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'loose', isCompleted: true }],
      };

      const committedEvidence = [
        { workingSetOrdinal: 1, weight: 100, reps: 12, rpe: 9.0, form: 'loose' as const },
      ];

      const res = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
        committedEvidence,
      });

      // Loose form falls through authority 1 to zero-baseline pre-evidence shape
      expect(res.isPrescribed).toBe(true);
      expect(res.workingSetOrdinal).toBe(2);
      expect(res.target!.weight).toBe(0);
    });
  });
});
