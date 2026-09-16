/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  collectComparableGuidedHistory,
  isValidCalendarDate,
  isValidTargetSnapshot,
  GuidedHistoryBoundary,
  CollectComparableGuidedHistoryInput,
} from '../guidedHistoryCollector';
import {
  Program,
  WorkoutLog,
  PrescriptionSnapshot,
  SetEntry,
} from '../../types';

describe('guidedHistoryCollector', () => {
  const createTargetSnapshot = (
    overrides?: Partial<PrescriptionSnapshot>
  ): PrescriptionSnapshot => ({
    snapshotVersion: 2,
    progressionPolicyVersion: 1,
    algorithmVersion: 1,
    progressionMode: 'metreps_guided',
    algorithmId: 'hypertrophy_linear',
    exerciseKey: 'bench_press_standard',
    exerciseRole: 'main_movement',
    modality: 'weighted',
    comparableLaneKey: 'bench_press_flat_standard',
    workingSetOrdinal: 1,
    prescribedWorkingSetCount: 3,
    baseWeight: 100,
    baseReps: 8,
    baseRpe: 8,
    presentedWeight: 100,
    presentedReps: 8,
    presentedRpe: 8,
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

  const createProgram = (overrides?: Partial<Program>): Program => ({
    id: 'prog-root',
    name: 'Push Pull Legs',
    daysPerWeek: 3,
    programDuration: 4,
    createdAt: '2026-01-01T00:00:00.000Z',
    exercisesByDay: {},
    targetProgressionMode: 'metreps_guided',
    progressionPolicyVersion: 1,
    algorithmVersion: 1,
    unit: 'kg',
    ...overrides,
  });

  const create3SetExerciseSets = (
    setWeight = 100,
    setReps = 8,
    setRpe = 8,
    isCompleted = true,
    snapshotOverrides?: Partial<PrescriptionSnapshot>
  ): SetEntry[] => [
    {
      setNumber: 1,
      weight: setWeight,
      reps: setReps,
      rpe: setRpe,
      isCompleted,
      prescriptionSnapshot: createTargetSnapshot({
        workingSetOrdinal: 1,
        ...snapshotOverrides,
      }),
    },
    {
      setNumber: 2,
      weight: setWeight,
      reps: setReps,
      rpe: setRpe,
      isCompleted,
      prescriptionSnapshot: createTargetSnapshot({
        workingSetOrdinal: 2,
        ...snapshotOverrides,
      }),
    },
    {
      setNumber: 3,
      weight: setWeight,
      reps: setReps,
      rpe: setRpe,
      isCompleted,
      prescriptionSnapshot: createTargetSnapshot({
        workingSetOrdinal: 3,
        ...snapshotOverrides,
      }),
    },
  ];

  const createGuidedWorkoutLog = (
    id: string,
    date: string,
    programId: string,
    sets?: SetEntry[],
    logOverrides?: Partial<WorkoutLog>
  ): WorkoutLog => ({
    id,
    date,
    programId,
    unit: 'kg',
    exercises: [
      {
        name: 'Barbell Bench Press',
        exerciseKey: 'bench_press_standard',
        modality: 'weighted',
        muscleGroup: 'Chest',
        sets: sets ?? create3SetExerciseSets(),
      },
    ],
    ...logOverrides,
  });

  describe('1. Input and Fatal Validation', () => {
    const defaultSnapshot = createTargetSnapshot();
    const defaultBoundary: GuidedHistoryBoundary = {
      mode: 'active_live',
      targetDate: '2026-08-20',
      sessionStartedAt: 1724150000000,
    };

    it('returns TARGET_PROGRAM_NOT_FOUND when target program ID is blank or missing', () => {
      const prog = createProgram({ id: 'prog-1' });
      const res = collectComparableGuidedHistory({
        targetProgramId: '   ',
        programs: [prog],
        logs: [],
        targetSnapshot: defaultSnapshot,
        boundary: defaultBoundary,
      });

      expect(res.status).toBe('fatal_error');
      if (res.status === 'fatal_error') {
        expect(res.error).toBe('TARGET_PROGRAM_NOT_FOUND');
      }
    });

    it('returns TARGET_PROGRAM_NOT_FOUND when target program is not in programs array', () => {
      const prog = createProgram({ id: 'prog-1' });
      const res = collectComparableGuidedHistory({
        targetProgramId: 'prog-nonexistent',
        programs: [prog],
        logs: [],
        targetSnapshot: defaultSnapshot,
        boundary: defaultBoundary,
      });

      expect(res.status).toBe('fatal_error');
      if (res.status === 'fatal_error') {
        expect(res.error).toBe('TARGET_PROGRAM_NOT_FOUND');
      }
    });

    it('returns DUPLICATE_PROGRAM_IDS when a program has a blank ID or duplicate ID exists', () => {
      const prog1 = createProgram({ id: 'prog-1' });
      const prog2 = createProgram({ id: 'prog-1' });
      const res = collectComparableGuidedHistory({
        targetProgramId: 'prog-1',
        programs: [prog1, prog2],
        logs: [],
        targetSnapshot: defaultSnapshot,
        boundary: defaultBoundary,
      });

      expect(res.status).toBe('fatal_error');
      if (res.status === 'fatal_error') {
        expect(res.error).toBe('DUPLICATE_PROGRAM_IDS');
      }

      const blankProg = createProgram({ id: '   ' });
      const resBlank = collectComparableGuidedHistory({
        targetProgramId: 'prog-1',
        programs: [prog1, blankProg],
        logs: [],
        targetSnapshot: defaultSnapshot,
        boundary: defaultBoundary,
      });
      expect(resBlank.status).toBe('fatal_error');
      if (resBlank.status === 'fatal_error') {
        expect(resBlank.error).toBe('DUPLICATE_PROGRAM_IDS');
      }
    });

    it('returns CIRCULAR_PROGRAM_LINEAGE on self-referencing or circular parentProgramId', () => {
      const selfRef = createProgram({ id: 'prog-self', parentProgramId: 'prog-self' });
      const resSelf = collectComparableGuidedHistory({
        targetProgramId: 'prog-self',
        programs: [selfRef],
        logs: [],
        targetSnapshot: defaultSnapshot,
        boundary: defaultBoundary,
      });
      expect(resSelf.status).toBe('fatal_error');
      if (resSelf.status === 'fatal_error') {
        expect(resSelf.error).toBe('CIRCULAR_PROGRAM_LINEAGE');
      }

      const progA = createProgram({ id: 'prog-a', parentProgramId: 'prog-b' });
      const progB = createProgram({ id: 'prog-b', parentProgramId: 'prog-a' });
      const resCycle = collectComparableGuidedHistory({
        targetProgramId: 'prog-a',
        programs: [progA, progB],
        logs: [],
        targetSnapshot: defaultSnapshot,
        boundary: defaultBoundary,
      });
      expect(resCycle.status).toBe('fatal_error');
      if (resCycle.status === 'fatal_error') {
        expect(resCycle.error).toBe('CIRCULAR_PROGRAM_LINEAGE');
      }
    });

    it('returns INVALID_TARGET_SNAPSHOT on malformed or non-guided target snapshot', () => {
      const prog = createProgram({ id: 'prog-1' });

      const invalidMode = createTargetSnapshot({ progressionMode: 'performance_led' as any });
      expect(isValidTargetSnapshot(invalidMode)).toBe(false);

      const invalidVersion = createTargetSnapshot({ snapshotVersion: 1 });
      expect(isValidTargetSnapshot(invalidVersion)).toBe(false);

      const invalidCount = createTargetSnapshot({ prescribedWorkingSetCount: 0 });
      expect(isValidTargetSnapshot(invalidCount)).toBe(false);

      const invalidBasis = createTargetSnapshot({ modality: 'weighted', loadBasis: 'bodyweight_normalized_v1' });
      expect(isValidTargetSnapshot(invalidBasis)).toBe(false);

      const res = collectComparableGuidedHistory({
        targetProgramId: 'prog-1',
        programs: [prog],
        logs: [],
        targetSnapshot: invalidMode,
        boundary: defaultBoundary,
      });
      expect(res.status).toBe('fatal_error');
      if (res.status === 'fatal_error') {
        expect(res.error).toBe('INVALID_TARGET_SNAPSHOT');
      }
    });

    it('returns INVALID_CHRONOLOGY_BOUNDARY on malformed calendar dates or boundary fields', () => {
      const prog = createProgram({ id: 'prog-1' });

      // Impossible date: 2026-02-30
      expect(isValidCalendarDate('2026-02-30')).toBe(false);
      expect(isValidCalendarDate('2026-13-01')).toBe(false);
      expect(isValidCalendarDate('2026-08-20')).toBe(true);

      const badDateBoundary: GuidedHistoryBoundary = {
        mode: 'active_live',
        targetDate: '2026-02-30',
        sessionStartedAt: 1724150000000,
      };
      const res = collectComparableGuidedHistory({
        targetProgramId: 'prog-1',
        programs: [prog],
        logs: [],
        targetSnapshot: defaultSnapshot,
        boundary: badDateBoundary,
      });
      expect(res.status).toBe('fatal_error');
      if (res.status === 'fatal_error') {
        expect(res.error).toBe('INVALID_CHRONOLOGY_BOUNDARY');
      }

      // Invalid active_live sessionStartedAt
      const badTsBoundary: GuidedHistoryBoundary = {
        mode: 'active_live',
        targetDate: '2026-08-20',
        sessionStartedAt: -1,
      };
      const resTs = collectComparableGuidedHistory({
        targetProgramId: 'prog-1',
        programs: [prog],
        logs: [],
        targetSnapshot: defaultSnapshot,
        boundary: badTsBoundary,
      });
      expect(resTs.status).toBe('fatal_error');
      if (resTs.status === 'fatal_error') {
        expect(resTs.error).toBe('INVALID_CHRONOLOGY_BOUNDARY');
      }
    });

    it('returns DUPLICATE_WORKOUT_LOG_IDS when two distinct logs share the same ID', () => {
      const prog = createProgram({ id: 'prog-1' });
      const log1 = createGuidedWorkoutLog('log-dup-1', '2026-08-10', 'prog-1');
      const log2 = createGuidedWorkoutLog('log-dup-1', '2026-08-12', 'prog-1');

      const res = collectComparableGuidedHistory({
        targetProgramId: 'prog-1',
        programs: [prog],
        logs: [log1, log2],
        targetSnapshot: defaultSnapshot,
        boundary: defaultBoundary,
      });
      expect(res.status).toBe('fatal_error');
      if (res.status === 'fatal_error') {
        expect(res.error).toBe('DUPLICATE_WORKOUT_LOG_IDS');
      }
    });

    it('returns TARGET_WORKOUT_NOT_FOUND_IN_LOGS in historical_edit mode if target workout is absent', () => {
      const prog = createProgram({ id: 'prog-1' });
      const log1 = createGuidedWorkoutLog('log-101', '2026-08-10', 'prog-1');

      const res = collectComparableGuidedHistory({
        targetProgramId: 'prog-1',
        programs: [prog],
        logs: [log1],
        targetSnapshot: defaultSnapshot,
        boundary: {
          mode: 'historical_edit',
          targetWorkoutId: 'log-missing',
          targetDate: '2026-08-15',
          targetTimestampMs: 1723700000000,
        },
      });
      expect(res.status).toBe('fatal_error');
      if (res.status === 'fatal_error') {
        expect(res.error).toBe('TARGET_WORKOUT_NOT_FOUND_IN_LOGS');
      }
    });

    it('returns AMBIGUOUS_TARGET_WORKOUT_IN_LOGS in historical_edit mode if target workout appears > 1 time', () => {
      const prog = createProgram({ id: 'prog-1' });
      const log1 = createGuidedWorkoutLog('log-target', '2026-08-10', 'prog-1');
      const log2 = createGuidedWorkoutLog('log-target', '2026-08-10', 'prog-1');

      const res = collectComparableGuidedHistory({
        targetProgramId: 'prog-1',
        programs: [prog],
        logs: [log1, log2],
        targetSnapshot: defaultSnapshot,
        boundary: {
          mode: 'historical_edit',
          targetWorkoutId: 'log-target',
          targetDate: '2026-08-10',
          targetTimestampMs: 1723700000000,
        },
      });
      expect(res.status).toBe('fatal_error');
      if (res.status === 'fatal_error') {
        expect(res.error).toBe('AMBIGUOUS_TARGET_WORKOUT_IN_LOGS');
      }
    });
  });

  describe('2. Lineage Traversal', () => {
    const defaultSnapshot = createTargetSnapshot();
    const defaultBoundary: GuidedHistoryBoundary = {
      mode: 'active_live',
      targetDate: '2026-08-25',
      sessionStartedAt: 1724580000000,
    };

    it('traverses single root program correctly', () => {
      const root = createProgram({ id: 'prog-root' });
      const log = createGuidedWorkoutLog('log-1', '2026-08-10', 'prog-root');

      const res = collectComparableGuidedHistory({
        targetProgramId: 'prog-root',
        programs: [root],
        logs: [log],
        targetSnapshot: defaultSnapshot,
        boundary: defaultBoundary,
      });

      expect(res.status).toBe('success');
      if (res.status === 'success') {
        expect(res.lineageProgramIds).toEqual(['prog-root']);
        expect(res.isPartialLineage).toBe(false);
        expect(res.usableExposures).toHaveLength(1);
        expect(res.usableExposures[0].lineagePosition).toBe(0);
      }
    });

    it('traverses multi-cycle continuation root -> cycle 2 -> cycle 3 root-to-current', () => {
      const c1 = createProgram({ id: 'cycle-1', cycleIndex: 1 });
      const c2 = createProgram({ id: 'cycle-2', parentProgramId: 'cycle-1', cycleIndex: 2 });
      const c3 = createProgram({ id: 'cycle-3', parentProgramId: 'cycle-2', cycleIndex: 3 });

      const log1 = createGuidedWorkoutLog('log-c1', '2026-08-01', 'cycle-1');
      const log2 = createGuidedWorkoutLog('log-c2', '2026-08-10', 'cycle-2');
      const log3 = createGuidedWorkoutLog('log-c3', '2026-08-20', 'cycle-3');

      const res = collectComparableGuidedHistory({
        targetProgramId: 'cycle-3',
        programs: [c1, c2, c3],
        logs: [log1, log2, log3],
        targetSnapshot: defaultSnapshot,
        boundary: defaultBoundary,
      });

      expect(res.status).toBe('success');
      if (res.status === 'success') {
        expect(res.lineageProgramIds).toEqual(['cycle-1', 'cycle-2', 'cycle-3']);
        expect(res.isPartialLineage).toBe(false);
        expect(res.usableExposures).toHaveLength(3);
        expect(res.usableExposures[0].lineagePosition).toBe(0);
        expect(res.usableExposures[1].lineagePosition).toBe(1);
        expect(res.usableExposures[2].lineagePosition).toBe(2);
      }
    });

    it('handles partial lineage gracefully when ancestor is missing', () => {
      const c2 = createProgram({ id: 'cycle-2', parentProgramId: 'ghost-c1', cycleIndex: 2 });
      const c3 = createProgram({ id: 'cycle-3', parentProgramId: 'cycle-2', cycleIndex: 3 });

      const log2 = createGuidedWorkoutLog('log-c2', '2026-08-10', 'cycle-2');
      const log3 = createGuidedWorkoutLog('log-c3', '2026-08-20', 'cycle-3');

      const res = collectComparableGuidedHistory({
        targetProgramId: 'cycle-3',
        programs: [c2, c3], // ghost-c1 is omitted
        logs: [log2, log3],
        targetSnapshot: defaultSnapshot,
        boundary: defaultBoundary,
      });

      expect(res.status).toBe('success');
      if (res.status === 'success') {
        expect(res.isPartialLineage).toBe(true);
        expect(res.partialLineageWarning).toEqual({
          missingParentProgramId: 'ghost-c1',
          safelyTraversedProgramIds: ['cycle-2', 'cycle-3'],
        });
        expect(res.lineageProgramIds).toEqual(['cycle-2', 'cycle-3']);
        expect(res.usableExposures).toHaveLength(2);
      }
    });

    it('excludes sibling continuation branches and descendant cycles', () => {
      const root = createProgram({ id: 'prog-root' });
      const sibling = createProgram({ id: 'prog-sibling', parentProgramId: 'prog-root' });
      const target = createProgram({ id: 'prog-target', parentProgramId: 'prog-root' });
      const descendant = createProgram({ id: 'prog-descendant', parentProgramId: 'prog-target' });

      const logRoot = createGuidedWorkoutLog('log-root', '2026-08-01', 'prog-root');
      const logSibling = createGuidedWorkoutLog('log-sibling', '2026-08-05', 'prog-sibling');
      const logTarget = createGuidedWorkoutLog('log-target', '2026-08-10', 'prog-target');
      const logDescendant = createGuidedWorkoutLog('log-descendant', '2026-08-15', 'prog-descendant');

      const res = collectComparableGuidedHistory({
        targetProgramId: 'prog-target',
        programs: [root, sibling, target, descendant],
        logs: [logRoot, logSibling, logTarget, logDescendant],
        targetSnapshot: defaultSnapshot,
        boundary: defaultBoundary,
      });

      expect(res.status).toBe('success');
      if (res.status === 'success') {
        expect(res.usableExposures.map(e => e.workoutLogId)).toEqual(['log-root', 'log-target']);
        const siblingDiag = res.diagnostics.excludedExposures.find(d => d.workoutLogId === 'log-sibling');
        expect(siblingDiag?.reason).toBe('UNRELATED_PROGRAM');
        const descDiag = res.diagnostics.excludedExposures.find(d => d.workoutLogId === 'log-descendant');
        expect(descDiag?.reason).toBe('DESCENDANT_PROGRAM_CYCLE');
      }
    });
  });

  describe('3. Identity and Comparable Lane Rules', () => {
    const defaultSnapshot = createTargetSnapshot({
      exerciseKey: 'bench_press_standard',
      exerciseRole: 'main_movement',
      comparableLaneKey: 'bench_press_flat_standard',
      prescribedWorkingSetCount: 3,
    });
    const prog = createProgram({ id: 'prog-1' });
    const defaultBoundary: GuidedHistoryBoundary = {
      mode: 'active_live',
      targetDate: '2026-08-20',
      sessionStartedAt: 1724150000000,
    };

    it('rejects candidate with different exerciseKey even if display name is identical (no fallback)', () => {
      const sets = create3SetExerciseSets(100, 8, 8, true, {
        exerciseKey: 'bench_press_custom_uuid_456',
      });
      const log = createGuidedWorkoutLog('log-diff-key', '2026-08-10', 'prog-1', sets, {
        exercises: [
          {
            name: 'Barbell Bench Press', // identical display name
            exerciseKey: 'bench_press_custom_uuid_456',
            modality: 'weighted',
            muscleGroup: 'Chest',
            sets,
          },
        ],
      });

      const res = collectComparableGuidedHistory({
        targetProgramId: 'prog-1',
        programs: [prog],
        logs: [log],
        targetSnapshot: defaultSnapshot,
        boundary: defaultBoundary,
      });

      expect(res.status).toBe('success');
      if (res.status === 'success') {
        expect(res.usableExposures).toHaveLength(0);
        expect(res.diagnostics.excludedExposures[0].reason).toBe('EXERCISE_KEY_MISMATCH');
      }
    });

    it('excludes on role, modality, lane, and algorithm mismatches', () => {
      const logRole = createGuidedWorkoutLog(
        'log-role',
        '2026-08-01',
        'prog-1',
        create3SetExerciseSets(100, 8, 8, true, { exerciseRole: 'accessory' })
      );
      const logModality = createGuidedWorkoutLog(
        'log-modality',
        '2026-08-02',
        'prog-1',
        create3SetExerciseSets(100, 8, 8, true, {
          modality: 'bodyweight',
          loadBasis: 'bodyweight_normalized_v1',
        })
      );
      const logLane = createGuidedWorkoutLog(
        'log-lane',
        '2026-08-03',
        'prog-1',
        create3SetExerciseSets(100, 8, 8, true, { comparableLaneKey: 'bench_press_close_grip' })
      );
      const logAlgo = createGuidedWorkoutLog(
        'log-algo',
        '2026-08-04',
        'prog-1',
        create3SetExerciseSets(100, 8, 8, true, { algorithmId: 'strength_undulating' })
      );

      const res = collectComparableGuidedHistory({
        targetProgramId: 'prog-1',
        programs: [prog],
        logs: [logRole, logModality, logLane, logAlgo],
        targetSnapshot: defaultSnapshot,
        boundary: defaultBoundary,
      });

      expect(res.status).toBe('success');
      if (res.status === 'success') {
        expect(res.usableExposures).toHaveLength(0);
        const reasons = res.diagnostics.excludedExposures.map(d => d.reason);
        expect(reasons).toContain('ROLE_MISMATCH');
        expect(reasons).toContain('MODALITY_MISMATCH');
        expect(reasons).toContain('COMPARABLE_LANE_MISMATCH');
        expect(reasons).toContain('ALGORITHM_ID_MISMATCH');
      }
    });

    it('excludes candidate with mismatched prescribedWorkingSetCount (2 vs 3 sets)', () => {
      const sets2 = [
        {
          setNumber: 1,
          weight: 100,
          reps: 8,
          rpe: 8,
          isCompleted: true,
          prescriptionSnapshot: createTargetSnapshot({ workingSetOrdinal: 1, prescribedWorkingSetCount: 2 }),
        },
        {
          setNumber: 2,
          weight: 100,
          reps: 8,
          rpe: 8,
          isCompleted: true,
          prescriptionSnapshot: createTargetSnapshot({ workingSetOrdinal: 2, prescribedWorkingSetCount: 2 }),
        },
      ];
      const log = createGuidedWorkoutLog('log-2set', '2026-08-10', 'prog-1', sets2);

      const res = collectComparableGuidedHistory({
        targetProgramId: 'prog-1',
        programs: [prog],
        logs: [log],
        targetSnapshot: defaultSnapshot, // target requires 3 sets
        boundary: defaultBoundary,
      });

      expect(res.status).toBe('success');
      if (res.status === 'success') {
        expect(res.usableExposures).toHaveLength(0);
        expect(res.diagnostics.excludedExposures[0].reason).toBe('SET_COUNT_MISMATCH');
      }
    });

    it('preserves comparable history across kg-to-lb continuation because comparisonLoadKg is canonical', () => {
      const setsLb = create3SetExerciseSets(220, 8, 8, true, {
        weightUnit: 'lb',
        comparisonLoadKg: 100, // normalized load matches
      });
      const logLb = createGuidedWorkoutLog('log-lb', '2026-08-10', 'prog-1', setsLb, {
        unit: 'lb',
      });

      const res = collectComparableGuidedHistory({
        targetProgramId: 'prog-1',
        programs: [prog],
        logs: [logLb],
        targetSnapshot: defaultSnapshot,
        boundary: defaultBoundary,
      });

      expect(res.status).toBe('success');
      if (res.status === 'success') {
        expect(res.usableExposures).toHaveLength(1);
        expect(res.usableExposures[0].weightUnit).toBe('lb');
        expect(res.usableExposures[0].sets[0].snapshot.comparisonLoadKg).toBe(100);
      }
    });
  });

  describe('4. Chronology and Boundaries', () => {
    const defaultSnapshot = createTargetSnapshot();
    const prog = createProgram({ id: 'prog-1' });

    it('orders exposures strictly chronologically ascending regardless of array input order', () => {
      const log1 = createGuidedWorkoutLog('log-1', '2026-08-05', 'prog-1');
      const log2 = createGuidedWorkoutLog('log-2', '2026-08-10', 'prog-1');
      const log3 = createGuidedWorkoutLog('log-3', '2026-08-15', 'prog-1');

      // Shuffled input order: log3, log1, log2
      const res = collectComparableGuidedHistory({
        targetProgramId: 'prog-1',
        programs: [prog],
        logs: [log3, log1, log2],
        targetSnapshot: defaultSnapshot,
        boundary: {
          mode: 'active_live',
          targetDate: '2026-08-20',
          sessionStartedAt: 1724150000000,
        },
      });

      expect(res.status).toBe('success');
      if (res.status === 'success') {
        expect(res.usableExposures.map(e => e.workoutLogId)).toEqual(['log-1', 'log-2', 'log-3']);
      }
    });

    it('resolves same-day sessions with distinct timestamps in factual order', () => {
      const morningLog = createGuidedWorkoutLog('log-am', '2026-08-10', 'prog-1', undefined, {
        startTime: '09:00:00',
      });
      const eveningLog = createGuidedWorkoutLog('log-pm', '2026-08-10', 'prog-1', undefined, {
        startTime: '17:00:00',
      });

      const res = collectComparableGuidedHistory({
        targetProgramId: 'prog-1',
        programs: [prog],
        logs: [eveningLog, morningLog], // reversed in input
        targetSnapshot: defaultSnapshot,
        boundary: {
          mode: 'active_live',
          targetDate: '2026-08-20',
          sessionStartedAt: 1724150000000,
        },
      });

      expect(res.status).toBe('success');
      if (res.status === 'success') {
        expect(res.usableExposures).toHaveLength(2);
        expect(res.usableExposures[0].workoutLogId).toBe('log-am');
        expect(res.usableExposures[1].workoutLogId).toBe('log-pm');
      }
    });

    it('excludes entire same-day candidate group on ambiguous missing or identical timestamps', () => {
      const logNoTime1 = createGuidedWorkoutLog('log-no-time-1', '2026-08-10', 'prog-1');
      const logNoTime2 = createGuidedWorkoutLog('log-no-time-2', '2026-08-10', 'prog-1');

      const res = collectComparableGuidedHistory({
        targetProgramId: 'prog-1',
        programs: [prog],
        logs: [logNoTime1, logNoTime2],
        targetSnapshot: defaultSnapshot,
        boundary: {
          mode: 'active_live',
          targetDate: '2026-08-20',
          sessionStartedAt: 1724150000000,
        },
      });

      expect(res.status).toBe('success');
      if (res.status === 'success') {
        expect(res.usableExposures).toHaveLength(0);
        expect(res.diagnostics.chronologyAmbiguities).toHaveLength(2);
        expect(res.diagnostics.chronologyAmbiguities[0].reason).toBe('AMBIGUOUS_EXPOSURE_CHRONOLOGY');
      }
    });

    it('excludes future workouts and workouts occurring at or after target boundary', () => {
      const logPast = createGuidedWorkoutLog('log-past', '2026-08-10', 'prog-1');
      const logFutureDate = createGuidedWorkoutLog('log-future-date', '2026-08-25', 'prog-1');
      const logSameDayAfter = createGuidedWorkoutLog('log-same-day-after', '2026-08-20', 'prog-1', undefined, {
        startTime: '18:00:00', // ts: 2026-08-20T18:00:00
      });

      // Target session started at 2026-08-20T10:00:00Z
      const targetTs = new Date('2026-08-20T10:00:00').getTime();

      const res = collectComparableGuidedHistory({
        targetProgramId: 'prog-1',
        programs: [prog],
        logs: [logPast, logFutureDate, logSameDayAfter],
        targetSnapshot: defaultSnapshot,
        boundary: {
          mode: 'active_live',
          targetDate: '2026-08-20',
          sessionStartedAt: targetTs,
        },
      });

      expect(res.status).toBe('success');
      if (res.status === 'success') {
        expect(res.usableExposures.map(e => e.workoutLogId)).toEqual(['log-past']);
        const reasons = res.diagnostics.excludedExposures.map(d => d.reason);
        expect(reasons).toContain('FUTURE_WORKOUT');
      }
    });

    it('historical_edit boundary self-excludes target workout and retains strictly earlier sessions', () => {
      const targetLogTs = new Date('2026-08-15T14:00:00').getTime();
      const targetLog = createGuidedWorkoutLog('log-target', '2026-08-15', 'prog-1', undefined, {
        startTime: '14:00:00',
      });
      const earlierSameDay = createGuidedWorkoutLog('log-earlier-am', '2026-08-15', 'prog-1', undefined, {
        startTime: '08:00:00',
      });
      const earlierPast = createGuidedWorkoutLog('log-earlier-day', '2026-08-10', 'prog-1');

      const res = collectComparableGuidedHistory({
        targetProgramId: 'prog-1',
        programs: [prog],
        logs: [earlierPast, earlierSameDay, targetLog],
        targetSnapshot: defaultSnapshot,
        boundary: {
          mode: 'historical_edit',
          targetWorkoutId: 'log-target',
          targetDate: '2026-08-15',
          targetTimestampMs: targetLogTs,
        },
      });

      expect(res.status).toBe('success');
      if (res.status === 'success') {
        expect(res.usableExposures.map(e => e.workoutLogId)).toEqual(['log-earlier-day', 'log-earlier-am']);
        const targetDiag = res.diagnostics.excludedExposures.find(d => d.workoutLogId === 'log-target');
        expect(targetDiag?.reason).toBe('TARGET_WORKOUT_SELF');
      }
    });

    it('retrospective_new boundary without explicitTargetTimestamp excludes same-day candidates as ambiguous', () => {
      const sameDayLog = createGuidedWorkoutLog('log-same-day', '2026-08-20', 'prog-1');
      const pastLog = createGuidedWorkoutLog('log-past', '2026-08-10', 'prog-1');

      const res = collectComparableGuidedHistory({
        targetProgramId: 'prog-1',
        programs: [prog],
        logs: [pastLog, sameDayLog],
        targetSnapshot: defaultSnapshot,
        boundary: {
          mode: 'retrospective_new',
          targetDate: '2026-08-20',
          explicitTargetTimestamp: null,
        },
      });

      expect(res.status).toBe('success');
      if (res.status === 'success') {
        expect(res.usableExposures.map(e => e.workoutLogId)).toEqual(['log-past']);
        expect(res.diagnostics.chronologyAmbiguities[0].reason).toBe('AMBIGUOUS_EXPOSURE_CHRONOLOGY');
      }
    });
  });

  describe('5. Exercise Outcomes & Locked Classifier Reuse', () => {
    const defaultSnapshot = createTargetSnapshot();
    const prog = createProgram({ id: 'prog-1' });
    const defaultBoundary: GuidedHistoryBoundary = {
      mode: 'active_live',
      targetDate: '2026-08-25',
      sessionStartedAt: 1724580000000,
    };

    it('retains success outcome', () => {
      // 3 sets achieving exact target: 100x8@8
      const sets = create3SetExerciseSets(100, 8, 8, true);
      const log = createGuidedWorkoutLog('log-success', '2026-08-10', 'prog-1', sets);

      const res = collectComparableGuidedHistory({
        targetProgramId: 'prog-1',
        programs: [prog],
        logs: [log],
        targetSnapshot: defaultSnapshot,
        boundary: defaultBoundary,
      });

      expect(res.status).toBe('success');
      if (res.status === 'success') {
        expect(res.usableExposures).toHaveLength(1);
        expect(res.usableExposures[0].classification.outcome).toBe('success');
        expect(res.usableExposures[0].classification.reason).toBe('ALL_PRESCRIBED_SETS_ACHIEVED');
      }
    });

    it('retains marginal_miss outcome on single set rep miss', () => {
      // Set 1: 100x8@8, Set 2: 100x8@8, Set 3: 100x7@8 (1 rep miss on 1 set -> SINGLE_MARGINAL_MISS)
      const sets: SetEntry[] = [
        {
          setNumber: 1,
          weight: 100,
          reps: 8,
          rpe: 8,
          isCompleted: true,
          prescriptionSnapshot: createTargetSnapshot({ workingSetOrdinal: 1 }),
        },
        {
          setNumber: 2,
          weight: 100,
          reps: 8,
          rpe: 8,
          isCompleted: true,
          prescriptionSnapshot: createTargetSnapshot({ workingSetOrdinal: 2 }),
        },
        {
          setNumber: 3,
          weight: 100,
          reps: 7, // 1 rep below target 8
          rpe: 8,
          isCompleted: true,
          prescriptionSnapshot: createTargetSnapshot({ workingSetOrdinal: 3 }),
        },
      ];
      const log = createGuidedWorkoutLog('log-marginal', '2026-08-10', 'prog-1', sets);

      const res = collectComparableGuidedHistory({
        targetProgramId: 'prog-1',
        programs: [prog],
        logs: [log],
        targetSnapshot: defaultSnapshot,
        boundary: defaultBoundary,
      });

      expect(res.status).toBe('success');
      if (res.status === 'success') {
        expect(res.usableExposures).toHaveLength(1);
        expect(res.usableExposures[0].classification.outcome).toBe('marginal_miss');
        expect(res.usableExposures[0].classification.reason).toBe('SINGLE_MARGINAL_MISS');
      }
    });

    it('retains substantial_miss outcome on multiple marginal misses or severe miss', () => {
      // Set 1: 100x7, Set 2: 100x7, Set 3: 100x7 (3 marginal misses -> MULTIPLE_MARGINAL_MISSES -> substantial_miss)
      const sets: SetEntry[] = [
        {
          setNumber: 1,
          weight: 100,
          reps: 7,
          rpe: 8,
          isCompleted: true,
          prescriptionSnapshot: createTargetSnapshot({ workingSetOrdinal: 1 }),
        },
        {
          setNumber: 2,
          weight: 100,
          reps: 7,
          rpe: 8,
          isCompleted: true,
          prescriptionSnapshot: createTargetSnapshot({ workingSetOrdinal: 2 }),
        },
        {
          setNumber: 3,
          weight: 100,
          reps: 7,
          rpe: 8,
          isCompleted: true,
          prescriptionSnapshot: createTargetSnapshot({ workingSetOrdinal: 3 }),
        },
      ];
      const log = createGuidedWorkoutLog('log-sub-miss', '2026-08-10', 'prog-1', sets);

      const res = collectComparableGuidedHistory({
        targetProgramId: 'prog-1',
        programs: [prog],
        logs: [log],
        targetSnapshot: defaultSnapshot,
        boundary: defaultBoundary,
      });

      expect(res.status).toBe('success');
      if (res.status === 'success') {
        expect(res.usableExposures).toHaveLength(1);
        expect(res.usableExposures[0].classification.outcome).toBe('substantial_miss');
        expect(res.usableExposures[0].classification.reason).toBe('MULTIPLE_MARGINAL_MISSES');
      }
    });

    it('retains skipped exercise with snapshots as neutral with reason EXERCISE_SKIPPED', () => {
      const sets = create3SetExerciseSets(100, 8, 8, true);
      const log = createGuidedWorkoutLog('log-skipped', '2026-08-10', 'prog-1', sets, {
        exercises: [
          {
            name: 'Barbell Bench Press',
            exerciseKey: 'bench_press_standard',
            modality: 'weighted',
            muscleGroup: 'Chest',
            isSkipped: true,
            sets,
          },
        ],
      });

      const res = collectComparableGuidedHistory({
        targetProgramId: 'prog-1',
        programs: [prog],
        logs: [log],
        targetSnapshot: defaultSnapshot,
        boundary: defaultBoundary,
      });

      expect(res.status).toBe('success');
      if (res.status === 'success') {
        expect(res.usableExposures).toHaveLength(1);
        expect(res.usableExposures[0].classification.outcome).toBe('neutral');
        expect(res.usableExposures[0].classification.reason).toBe('EXERCISE_SKIPPED');
        expect(res.usableExposures[0].sets[0].setResult.outcome).toBe('neutral');
        expect(res.usableExposures[0].sets[0].setResult.reason).toBe('SKIPPED_EXERCISE');
      }
    });

    it('excludes skipped exercise WITHOUT snapshot identity with MISSING_COMPARABLE_SNAPSHOT_IDENTITY', () => {
      const log = createGuidedWorkoutLog('log-skipped-nosnap', '2026-08-10', 'prog-1', undefined, {
        exercises: [
          {
            name: 'Barbell Bench Press',
            exerciseKey: 'bench_press_standard',
            modality: 'weighted',
            muscleGroup: 'Chest',
            isSkipped: true,
            sets: [], // zero snapshots on target candidate
          },
          {
            name: 'Other Guided Exercise',
            exerciseKey: 'other_guided_ex',
            modality: 'weighted',
            muscleGroup: 'Back',
            sets: [
              {
                setNumber: 1,
                weight: 50,
                reps: 10,
                isCompleted: true,
                prescriptionSnapshot: createTargetSnapshot({
                  exerciseKey: 'other_guided_ex',
                  workingSetOrdinal: 1,
                  prescribedWorkingSetCount: 1,
                }),
              },
            ],
          },
        ],
      });

      const res = collectComparableGuidedHistory({
        targetProgramId: 'prog-1',
        programs: [prog],
        logs: [log],
        targetSnapshot: defaultSnapshot,
        boundary: defaultBoundary,
      });

      expect(res.status).toBe('success');
      if (res.status === 'success') {
        expect(res.usableExposures).toHaveLength(0);
        expect(res.diagnostics.excludedExposures[0].reason).toBe('MISSING_COMPARABLE_SNAPSHOT_IDENTITY');
      }
    });

    it('retains missing prescribed set as neutral with reason PRESCRIBED_SET_MISSING', () => {
      // Prescribed 3 sets, but only ordinals 1 and 2 logged
      const sets: SetEntry[] = [
        {
          setNumber: 1,
          weight: 100,
          reps: 8,
          rpe: 8,
          isCompleted: true,
          prescriptionSnapshot: createTargetSnapshot({ workingSetOrdinal: 1, prescribedWorkingSetCount: 3 }),
        },
        {
          setNumber: 2,
          weight: 100,
          reps: 8,
          rpe: 8,
          isCompleted: true,
          prescriptionSnapshot: createTargetSnapshot({ workingSetOrdinal: 2, prescribedWorkingSetCount: 3 }),
        },
      ];
      const log = createGuidedWorkoutLog('log-missing-set', '2026-08-10', 'prog-1', sets);

      const res = collectComparableGuidedHistory({
        targetProgramId: 'prog-1',
        programs: [prog],
        logs: [log],
        targetSnapshot: defaultSnapshot,
        boundary: defaultBoundary,
      });

      expect(res.status).toBe('success');
      if (res.status === 'success') {
        expect(res.usableExposures).toHaveLength(1);
        expect(res.usableExposures[0].classification.outcome).toBe('neutral');
        expect(res.usableExposures[0].classification.reason).toBe('PRESCRIBED_SET_MISSING');
        expect(res.usableExposures[0].classification.missingWorkingSetOrdinals).toEqual([3]);
      }
    });

    it('retains explicitly uncompleted set (isCompleted: false) as substantial_miss', () => {
      const sets: SetEntry[] = [
        {
          setNumber: 1,
          weight: 100,
          reps: 8,
          rpe: 8,
          isCompleted: true,
          prescriptionSnapshot: createTargetSnapshot({ workingSetOrdinal: 1 }),
        },
        {
          setNumber: 2,
          weight: 100,
          reps: 8,
          rpe: 8,
          isCompleted: false, // uncompleted set!
          prescriptionSnapshot: createTargetSnapshot({ workingSetOrdinal: 2 }),
        },
        {
          setNumber: 3,
          weight: 100,
          reps: 8,
          rpe: 8,
          isCompleted: true,
          prescriptionSnapshot: createTargetSnapshot({ workingSetOrdinal: 3 }),
        },
      ];
      const log = createGuidedWorkoutLog('log-uncompleted', '2026-08-10', 'prog-1', sets);

      const res = collectComparableGuidedHistory({
        targetProgramId: 'prog-1',
        programs: [prog],
        logs: [log],
        targetSnapshot: defaultSnapshot,
        boundary: defaultBoundary,
      });

      expect(res.status).toBe('success');
      if (res.status === 'success') {
        expect(res.usableExposures).toHaveLength(1);
        expect(res.usableExposures[0].classification.outcome).toBe('substantial_miss');
        expect(res.usableExposures[0].classification.reason).toBe('PRESCRIBED_SET_SUBSTANTIAL_MISS');
        const set2 = res.usableExposures[0].sets.find(s => s.workingSetOrdinal === 2);
        expect(set2?.setResult.outcome).toBe('substantial_miss');
        expect(set2?.setResult.reason).toBe('UNCOMPLETED_SET');
      }
    });

    it('excludes structurally ineligible exercises with classifier reason preserved', () => {
      // Duplicate prescribed ordinal: two sets both marked workingSetOrdinal: 1
      const setsDuplicateOrdinal: SetEntry[] = [
        {
          setNumber: 1,
          weight: 100,
          reps: 8,
          rpe: 8,
          isCompleted: true,
          prescriptionSnapshot: createTargetSnapshot({ workingSetOrdinal: 1 }),
        },
        {
          setNumber: 2,
          weight: 100,
          reps: 8,
          rpe: 8,
          isCompleted: true,
          prescriptionSnapshot: createTargetSnapshot({ workingSetOrdinal: 1 }), // duplicate ordinal!
        },
      ];
      const log = createGuidedWorkoutLog('log-ineligible', '2026-08-10', 'prog-1', setsDuplicateOrdinal);

      const res = collectComparableGuidedHistory({
        targetProgramId: 'prog-1',
        programs: [prog],
        logs: [log],
        targetSnapshot: defaultSnapshot,
        boundary: defaultBoundary,
      });

      expect(res.status).toBe('success');
      if (res.status === 'success') {
        expect(res.usableExposures).toHaveLength(0);
        const diag = res.diagnostics.excludedExposures[0];
        expect(diag.reason).toBe('INELIGIBLE_EXERCISE_OUTCOME');
        expect(diag.classifierReason).toBe('DUPLICATE_PRESCRIBED_ORDINAL');
      }
    });
  });

  describe('6. Duplicate and Multi-Set Safety', () => {
    const defaultSnapshot = createTargetSnapshot();
    const prog = createProgram({ id: 'prog-1' });
    const defaultBoundary: GuidedHistoryBoundary = {
      mode: 'active_live',
      targetDate: '2026-08-25',
      sessionStartedAt: 1724580000000,
    };

    it('excludes all occurrences when identical target identity appears twice in one workout', () => {
      const sets1 = create3SetExerciseSets(100, 8, 8, true);
      const sets2 = create3SetExerciseSets(100, 8, 8, true);

      const log = createGuidedWorkoutLog('log-dup-ex', '2026-08-10', 'prog-1', undefined, {
        exercises: [
          {
            name: 'Barbell Bench Press',
            exerciseKey: 'bench_press_standard',
            modality: 'weighted',
            muscleGroup: 'Chest',
            sets: sets1,
          },
          {
            name: 'Barbell Bench Press (Second Block)',
            exerciseKey: 'bench_press_standard',
            modality: 'weighted',
            muscleGroup: 'Chest',
            sets: sets2,
          },
        ],
      });

      const res = collectComparableGuidedHistory({
        targetProgramId: 'prog-1',
        programs: [prog],
        logs: [log],
        targetSnapshot: defaultSnapshot,
        boundary: defaultBoundary,
      });

      expect(res.status).toBe('success');
      if (res.status === 'success') {
        expect(res.usableExposures).toHaveLength(0);
        expect(res.diagnostics.duplicateOccurrences).toHaveLength(2);
        expect(res.diagnostics.duplicateOccurrences[0].reason).toBe('DUPLICATE_COMPARABLE_EXERCISE_OCCURRENCE');
        expect(res.diagnostics.duplicateOccurrences[1].reason).toBe('DUPLICATE_COMPARABLE_EXERCISE_OCCURRENCE');
      }
    });

    it('does not collide when different roles or lanes exist in the same workout', () => {
      const setsMain = create3SetExerciseSets(100, 8, 8, true, {
        exerciseRole: 'main_movement',
        comparableLaneKey: 'bench_press_flat_standard',
      });
      const setsAccessory = create3SetExerciseSets(60, 10, 8, true, {
        exerciseRole: 'accessory',
        comparableLaneKey: 'bench_press_flat_standard',
      });

      const log = createGuidedWorkoutLog('log-multi-role', '2026-08-10', 'prog-1', undefined, {
        exercises: [
          {
            name: 'Bench Press Main',
            exerciseKey: 'bench_press_standard',
            modality: 'weighted',
            muscleGroup: 'Chest',
            sets: setsMain,
          },
          {
            name: 'Bench Press Accessory',
            exerciseKey: 'bench_press_standard',
            modality: 'weighted',
            muscleGroup: 'Chest',
            sets: setsAccessory,
          },
        ],
      });

      const res = collectComparableGuidedHistory({
        targetProgramId: 'prog-1',
        programs: [prog],
        logs: [log],
        targetSnapshot: defaultSnapshot, // target requires main_movement
        boundary: defaultBoundary,
      });

      expect(res.status).toBe('success');
      if (res.status === 'success') {
        expect(res.usableExposures).toHaveLength(1);
        expect(res.usableExposures[0].exerciseRole).toBe('main_movement');
        expect(res.diagnostics.duplicateOccurrences).toHaveLength(0);
      }
    });

    it('preserves multi-set details ordered by workingSetOrdinal without collapsing', () => {
      const sets: SetEntry[] = [
        {
          setNumber: 3,
          weight: 95,
          reps: 10,
          rpe: 9,
          isCompleted: true,
          prescriptionSnapshot: createTargetSnapshot({
            workingSetOrdinal: 3,
            presentedWeight: 95,
            presentedReps: 10,
            presentedRpe: 9,
          }),
        },
        {
          setNumber: 1,
          weight: 105,
          reps: 6,
          rpe: 8,
          isCompleted: true,
          prescriptionSnapshot: createTargetSnapshot({
            workingSetOrdinal: 1,
            presentedWeight: 105,
            presentedReps: 6,
            presentedRpe: 8,
          }),
        },
        {
          setNumber: 2,
          weight: 100,
          reps: 8,
          rpe: 8,
          isCompleted: true,
          prescriptionSnapshot: createTargetSnapshot({
            workingSetOrdinal: 2,
            presentedWeight: 100,
            presentedReps: 8,
            presentedRpe: 8,
          }),
        },
      ];

      const log = createGuidedWorkoutLog('log-multi-set', '2026-08-10', 'prog-1', sets);

      const res = collectComparableGuidedHistory({
        targetProgramId: 'prog-1',
        programs: [prog],
        logs: [log],
        targetSnapshot: defaultSnapshot,
        boundary: defaultBoundary,
      });

      expect(res.status).toBe('success');
      if (res.status === 'success') {
        expect(res.usableExposures).toHaveLength(1);
        const exp = res.usableExposures[0];
        expect(exp.sets).toHaveLength(3);
        expect(exp.sets[0].workingSetOrdinal).toBe(1);
        expect(exp.sets[0].snapshot.presentedWeight).toBe(105);
        expect(exp.sets[1].workingSetOrdinal).toBe(2);
        expect(exp.sets[1].snapshot.presentedWeight).toBe(100);
        expect(exp.sets[2].workingSetOrdinal).toBe(3);
        expect(exp.sets[2].snapshot.presentedWeight).toBe(95);
      }
    });
  });

  describe('7. Purity and Immutability', () => {
    const defaultSnapshot = createTargetSnapshot();
    const prog = createProgram({ id: 'prog-1' });
    const log = createGuidedWorkoutLog('log-1', '2026-08-10', 'prog-1');
    const defaultBoundary: GuidedHistoryBoundary = {
      mode: 'active_live',
      targetDate: '2026-08-25',
      sessionStartedAt: 1724580000000,
    };

    it('is completely deterministic on identical inputs', () => {
      const input: CollectComparableGuidedHistoryInput = {
        targetProgramId: 'prog-1',
        programs: [prog],
        logs: [log],
        targetSnapshot: defaultSnapshot,
        boundary: defaultBoundary,
      };

      const run1 = collectComparableGuidedHistory(input);
      const run2 = collectComparableGuidedHistory(input);

      expect(run1).toEqual(run2);
    });

    it('does not mutate input programs, logs, exercises, sets, or snapshots', () => {
      const snapshotBefore = JSON.stringify(defaultSnapshot);
      const progBefore = JSON.stringify(prog);
      const logBefore = JSON.stringify(log);

      collectComparableGuidedHistory({
        targetProgramId: 'prog-1',
        programs: [prog],
        logs: [log],
        targetSnapshot: defaultSnapshot,
        boundary: defaultBoundary,
      });

      expect(JSON.stringify(defaultSnapshot)).toBe(snapshotBefore);
      expect(JSON.stringify(prog)).toBe(progBefore);
      expect(JSON.stringify(log)).toBe(logBefore);
    });
  });
});
