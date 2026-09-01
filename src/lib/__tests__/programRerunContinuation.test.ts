import { describe, it, expect } from 'vitest';
import {
  createProgramContinuation,
  formatContinuationCycleName,
  calculateNextAlgorithmPhaseOffset,
  isContinuationCycle,
} from '../programContinuation';
import { calculateObjectiveSets, calculateAddedSetTarget } from '../objectiveMath';
import { Program, WorkoutLog } from '../../types';

describe('Program Rerun Continuation Foundation (RPC-2A)', () => {
  describe('Pure Continuation Constructor & Cycle Naming', () => {
    const baseProgram: Program = {
      id: 'prog-orig-123',
      name: 'Hypertrophy Mastery',
      daysPerWeek: 3,
      programDuration: 8,
      createdAt: '2026-01-01T00:00:00.000Z',
      objective: 'Hypertrophy',
      algorithmId: 'hypertrophy_step',
      exercisesByDay: {
        1: [
          {
            name: 'Barbell Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            sets: [{ setNumber: 1, weight: 100, reps: 8, rpe: 8, form: 'standard' }],
          },
        ],
        2: [],
        3: [],
      },
      assignedWeekdays: { 1: 0, 2: 2, 3: 4 },
    };

    it('creates a successor program linked to predecessor without mutating predecessor', () => {
      const predecessorFrozen = JSON.parse(JSON.stringify(baseProgram));
      const successor = createProgramContinuation(baseProgram);

      // Predecessor is untouched
      expect(baseProgram).toEqual(predecessorFrozen);

      // Successor has distinct new ID
      expect(successor.id).toBeDefined();
      expect(successor.id).not.toBe(baseProgram.id);
      expect(successor.id.startsWith('prog-')).toBe(true);

      // Lineage metadata
      expect(successor.parentProgramId).toBe('prog-orig-123');
      expect(successor.cycleIndex).toBe(2);
      expect(successor.name).toBe('Hypertrophy Mastery — Cycle 2');

      // Preserves structure
      expect(successor.daysPerWeek).toBe(3);
      expect(successor.programDuration).toBe(8);
      expect(successor.objective).toBe('Hypertrophy');
      expect(successor.algorithmId).toBe('hypertrophy_step');
      expect(successor.assignedWeekdays).toEqual({ 1: 0, 2: 2, 3: 4 });
      expect(successor.exercisesByDay[1][0].name).toBe('Barbell Bench Press');

      // Deep copy verification
      expect(successor.exercisesByDay).not.toBe(baseProgram.exercisesByDay);
      expect(successor.exercisesByDay[1]).not.toBe(baseProgram.exercisesByDay[1]);
      expect(successor.assignedWeekdays).not.toBe(baseProgram.assignedWeekdays);
    });

    it('formats cycle names accurately and avoids duplicate suffixes', () => {
      expect(formatContinuationCycleName('Powerbuilding', 2)).toBe('Powerbuilding — Cycle 2');
      expect(formatContinuationCycleName('Powerbuilding — Cycle 2', 3)).toBe('Powerbuilding — Cycle 3');
      expect(formatContinuationCycleName('Powerbuilding — Cycle 3', 4)).toBe('Powerbuilding — Cycle 4');
      expect(formatContinuationCycleName('Powerbuilding - Cycle 2', 3)).toBe('Powerbuilding — Cycle 3');
      expect(formatContinuationCycleName('Powerbuilding — Cycle 9', 10)).toBe('Powerbuilding — Cycle 10');
      expect(formatContinuationCycleName('PPL (Hypertrophy) — Cycle 2', 3)).toBe('PPL (Hypertrophy) — Cycle 3');
    });

    it('handles successive continuation chains (Cycle 2 -> Cycle 3 -> Cycle 4)', () => {
      const cycle2 = createProgramContinuation(baseProgram);
      expect(cycle2.name).toBe('Hypertrophy Mastery — Cycle 2');
      expect(cycle2.cycleIndex).toBe(2);
      expect(cycle2.parentProgramId).toBe(baseProgram.id);
      expect(cycle2.algorithmPhaseOffset).toBe(8); // (0 + 8) % 12 = 8

      const cycle3 = createProgramContinuation(cycle2);
      expect(cycle3.name).toBe('Hypertrophy Mastery — Cycle 3');
      expect(cycle3.cycleIndex).toBe(3);
      expect(cycle3.parentProgramId).toBe(cycle2.id);
      expect(cycle3.algorithmPhaseOffset).toBe(4); // (8 + 8) % 12 = 4

      const cycle4 = createProgramContinuation(cycle3);
      expect(cycle4.name).toBe('Hypertrophy Mastery — Cycle 4');
      expect(cycle4.cycleIndex).toBe(4);
      expect(cycle4.parentProgramId).toBe(cycle3.id);
      expect(cycle4.algorithmPhaseOffset).toBe(0); // (4 + 8) % 12 = 0
    });

    it('correctly identifies continuation cycles with isContinuationCycle', () => {
      expect(isContinuationCycle(baseProgram)).toBe(false);
      expect(isContinuationCycle({ ...baseProgram, cycleIndex: 1 })).toBe(false);
      expect(isContinuationCycle({ ...baseProgram, parentProgramId: 'prog-prev' })).toBe(true);
      expect(isContinuationCycle({ ...baseProgram, cycleIndex: 2 })).toBe(true);
      expect(isContinuationCycle({ ...baseProgram, name: 'Bench Focus — Cycle 2' })).toBe(true);
    });
  });

  describe('Algorithm Phase Offsets Calculation', () => {
    it('calculates modulo-12 phase offsets for hypertrophy_step across various durations', () => {
      // 8-week program
      expect(calculateNextAlgorithmPhaseOffset('hypertrophy_step', 0, 8)).toBe(8);
      expect(calculateNextAlgorithmPhaseOffset('hypertrophy_step', 8, 8)).toBe(4);
      expect(calculateNextAlgorithmPhaseOffset('hypertrophy_step', 4, 8)).toBe(0);

      // 4-week program
      expect(calculateNextAlgorithmPhaseOffset('hypertrophy_step', 0, 4)).toBe(4);
      expect(calculateNextAlgorithmPhaseOffset('hypertrophy_step', 4, 4)).toBe(8);
      expect(calculateNextAlgorithmPhaseOffset('hypertrophy_step', 8, 4)).toBe(0);

      // 6-week program
      expect(calculateNextAlgorithmPhaseOffset('hypertrophy_step', 0, 6)).toBe(6);
      expect(calculateNextAlgorithmPhaseOffset('hypertrophy_step', 6, 6)).toBe(0);

      // 12-week program
      expect(calculateNextAlgorithmPhaseOffset('hypertrophy_step', 0, 12)).toBe(0);

      // Infinite duration (returns 0 or keeps current)
      expect(calculateNextAlgorithmPhaseOffset('hypertrophy_step', 0, '∞')).toBe(0);
      expect(calculateNextAlgorithmPhaseOffset('hypertrophy_step', 8, '∞')).toBe(0);
    });

    it('returns 0 offset for non-step algorithms', () => {
      expect(calculateNextAlgorithmPhaseOffset('hypertrophy_linear', 0, 8)).toBe(0);
      expect(calculateNextAlgorithmPhaseOffset('strength_undulating', 0, 8)).toBe(0);
      expect(calculateNextAlgorithmPhaseOffset('strength_linear', 0, 8)).toBe(0);
      expect(calculateNextAlgorithmPhaseOffset('none', 0, 8)).toBe(0);
      expect(calculateNextAlgorithmPhaseOffset(undefined, 0, 8)).toBe(0);
    });
  });

  describe('Runtime Target Calculation with Predecessor Evidence Tiering', () => {
    const predecessorId = 'prog-pred-100';
    const successorId = 'prog-succ-200';

    const predecessorLog: WorkoutLog = {
      id: 'log-pred-wk8',
      date: '2026-02-28',
      programId: predecessorId,
      program: 'Hypertrophy Mastery',
      day: '1',
      week: '8',
      unit: 'kg',
      objective: 'Hypertrophy',
      exercises: [
        {
          name: 'Barbell Squat',
          muscleGroup: 'Quads',
          modality: 'weighted',
          sets: [
            { setNumber: 1, weight: 140, reps: 8, rpe: 8, form: 'standard' }, // e1RM ≈ 140 / (1.0278 - 0.0278*8) / 0.922 ≈ 180+
          ],
        },
      ],
      durationMinutes: 60,
      notes: '',
    };

    it('uses predecessor program evidence as Tier 3 baseline when successor has no logs yet', () => {
      const exercise = {
        name: 'Barbell Squat',
        muscleGroup: 'Quads',
        modality: 'weighted' as const,
        sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' as const }],
      };

      // In Cycle 2 (successor), week 1 prescription without successor logs but with predecessor logs
      const resultWithPredecessor = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise,
        exerciseIndex: 0,
        totalExercises: 1,
        weekNum: 1,
        programDuration: 8,
        previousLogs: [predecessorLog],
        userTouchedSets: {},
        checkedSets: {},
        algorithmId: 'hypertrophy_linear',
        programId: successorId,
        predecessorProgramId: predecessorId,
        dayNum: '1',
        activeUnit: 'kg',
      });

      expect(resultWithPredecessor[0].weight).toBeGreaterThan(100);
      expect(resultWithPredecessor[0].reps).toBeGreaterThan(0);
      expect(resultWithPredecessor[0].rpe).toBeGreaterThan(0);

      // If predecessorId is NOT linked, it would have to fall back to generic/cross-program or template
      const resultWithoutPredecessor = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise,
        exerciseIndex: 0,
        totalExercises: 1,
        weekNum: 1,
        programDuration: 8,
        previousLogs: [], // No logs at all
        userTouchedSets: {},
        checkedSets: {},
        algorithmId: 'hypertrophy_linear',
        programId: successorId,
        predecessorProgramId: null,
        dayNum: '1',
        activeUnit: 'kg',
      });

      // Without logs or predecessor, weight defaults to 0 or template baseline
      expect(resultWithoutPredecessor[0].weight).toBe(0);
    });

    it('prioritises successor current program logs (Tier 1/2) over predecessor logs (Tier 3)', () => {
      const successorWeek1Log: WorkoutLog = {
        id: 'log-succ-wk1',
        date: '2026-03-05',
        programId: successorId,
        program: 'Hypertrophy Mastery — Cycle 2',
        day: '1',
        week: '1',
        unit: 'kg',
        objective: 'Hypertrophy',
        exercises: [
          {
            name: 'Barbell Squat',
            muscleGroup: 'Quads',
            modality: 'weighted',
            sets: [
              { setNumber: 1, weight: 150, reps: 8, rpe: 8, form: 'standard' }, // Higher weight in successor
            ],
          },
        ],
        durationMinutes: 60,
        notes: '',
      };

      const exercise = {
        name: 'Barbell Squat',
        muscleGroup: 'Quads',
        modality: 'weighted' as const,
        sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' as const }],
      };

      // Week 2 prescription should use successor's Week 1 log (150kg baseline), not predecessor's 140kg log
      const resultWeek2 = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise,
        exerciseIndex: 0,
        totalExercises: 1,
        weekNum: 2,
        programDuration: 8,
        previousLogs: [successorWeek1Log, predecessorLog],
        userTouchedSets: {},
        checkedSets: {},
        algorithmId: 'hypertrophy_linear',
        programId: successorId,
        predecessorProgramId: predecessorId,
        dayNum: '1',
        activeUnit: 'kg',
      });

      // Prescription from 150kg baseline in week 2 will be higher than week 1 from 140kg baseline
      expect(resultWeek2[0].weight).toBeGreaterThan(140);
    });

    it('applies algorithmPhaseOffset to hypertrophy_step runtime target calculation', () => {
      const exercise = {
        name: 'Barbell Squat',
        muscleGroup: 'Quads',
        modality: 'weighted' as const,
        sets: [
          { setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' as const },
          { setNumber: 2, weight: 0, reps: 0, rpe: 0, form: 'standard' as const },
          { setNumber: 3, weight: 0, reps: 0, rpe: 0, form: 'standard' as const },
        ],
      };

      // Cycle 1, Week 1 (phase offset 0): maps to phase 1 (reps: 10-12 / 10 reps)
      const cycle1Week1 = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise,
        exerciseIndex: 0,
        totalExercises: 1,
        weekNum: 1,
        programDuration: 8,
        previousLogs: [predecessorLog],
        userTouchedSets: {},
        checkedSets: {},
        algorithmId: 'hypertrophy_step',
        programId: successorId,
        predecessorProgramId: predecessorId,
        algorithmPhaseOffset: 0,
        dayNum: '1',
        activeUnit: 'kg',
      });

      // Cycle 2, Week 1 (phase offset 8 from 8-week cycle): maps to phase 9 (reps: 6-8 / 6 reps)
      const cycle2Week1 = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise,
        exerciseIndex: 0,
        totalExercises: 1,
        weekNum: 1,
        programDuration: 8,
        previousLogs: [predecessorLog],
        userTouchedSets: {},
        checkedSets: {},
        algorithmId: 'hypertrophy_step',
        programId: successorId,
        predecessorProgramId: predecessorId,
        algorithmPhaseOffset: 8,
        dayNum: '1',
        activeUnit: 'kg',
      });

      // In step periodization, Phase 9 is heavier / lower reps than Phase 1
      expect(cycle1Week1[0].reps!).toBeGreaterThan(cycle2Week1[0].reps!);
      expect(cycle2Week1[0].weight!).toBeGreaterThan(cycle1Week1[0].weight!);
    });

    it('forwards predecessorProgramId and algorithmPhaseOffset in calculateAddedSetTarget', () => {
      const exercise = {
        name: 'Barbell Squat',
        muscleGroup: 'Quads',
        modality: 'weighted' as const,
        sets: [
          { setNumber: 1, weight: 140, reps: 8, rpe: 8, form: 'standard' as const },
        ],
      };

      const addedTargetResult = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise,
        weekNum: 1,
        programDuration: 8,
        previousLogs: [predecessorLog],
        algorithmId: 'hypertrophy_step',
        predecessorProgramId: predecessorId,
        algorithmPhaseOffset: 8,
        activeUnit: 'kg',
        programId: successorId,
        dayNum: '1',
      });

      expect(addedTargetResult.isPrescribed).toBe(true);
      expect(addedTargetResult.target).toBeDefined();
      expect(addedTargetResult.target!.weight).toBeGreaterThan(100);
      expect(addedTargetResult.target!.reps).toBe(5); // Working set 2 target derived from Phase 9 (6 anchor reps with fatigue profile)
    });
  });
});
