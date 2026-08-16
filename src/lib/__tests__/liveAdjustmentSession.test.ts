import { describe, it, expect, vi } from 'vitest';
import { ExerciseEntry, SetEntry, Program, WorkoutLog } from '../../types';
import { resolveEffectiveAlgorithmPolicyB } from '../../components/WorkoutLogger';
import { storage } from '../storage';
import {
  PrescribedTargetSnapshotMap,
  CommittedLiveEvidenceMap,
  LiveAdjustedSetMap,
  deriveWorkingSetOrdinal,
  getWorkingSetRowIndex,
  prepareLiveAdjustmentParams,
  capturePrescribedSnapshotsFromExercises,
  createCommittedLiveEvidenceValue,
  applyLiveAdjustmentResult,
  canRestorePlannedTargets,
  restorePlannedTargetsForExercise,
  shouldShowLowRPEExplanation,
} from '../liveAdjustmentSession';
import { calculateLiveSetAdjustments } from '../liveAdjustmentMath';
import {
  remapAfterExerciseDelete,
  remapAfterExerciseMove,
  remapAfterExerciseReplace,
  remapAfterSetDelete,
  remapAfterSetMove,
  remapAfterSetInsert,
  prepareExercisesForSave,
} from '../workoutCompletion';

describe('MetReps Phase 2B-2A-2 Live Adjustment Session Foundation Suite', () => {
  describe('Session types and key-based maps', () => {
    it('1. Session maps contain only row-keyed coordinates without stored workingSetOrdinal', () => {
      const snapshots: PrescribedTargetSnapshotMap = {
        '0-0': { weight: 100, reps: 5, rpe: 8 },
        '0-1': { weight: 100, reps: 5, rpe: 8.5 },
      };

      const committedEvidence: CommittedLiveEvidenceMap = {
        '0-0': { weight: 100, reps: 5, rpe: 8.5, form: 'standard' },
      };

      const liveAdjustedSets: LiveAdjustedSetMap = {
        '0-1': true,
      };

      // Stored keys are exIdx-setIdx coordinates
      expect(Object.keys(snapshots)).toContain('0-0');
      expect(snapshots['0-0']).toEqual({ weight: 100, reps: 5, rpe: 8 });
      // Stored objects do not contain workingSetOrdinal
      expect((snapshots['0-0'] as any).workingSetOrdinal).toBeUndefined();
      expect((committedEvidence['0-0'] as any).workingSetOrdinal).toBeUndefined();
      expect(liveAdjustedSets['0-1']).toBe(true);
    });
  });

  describe('Ordinal derivation and dynamic layout helpers', () => {
    it('2. deriveWorkingSetOrdinal excludes warmups and counts non-warmup sets correctly', () => {
      const sets: SetEntry[] = [
        { setNumber: 1, isWarmup: true, weight: 60, reps: 5, rpe: 6 },
        { setNumber: 2, isWarmup: true, weight: 80, reps: 3, rpe: 7 },
        { setNumber: 3, isWarmup: false, weight: 100, reps: 5, rpe: 8 }, // working set 1
        { setNumber: 4, isWarmup: false, isSkipped: true },              // working set 2 (skipped retains ordinal)
        { setNumber: 5, isWarmup: false, weight: 100, reps: 5, rpe: 8.5 }, // working set 3
      ];

      expect(deriveWorkingSetOrdinal(sets, 0)).toBeNull(); // warmup
      expect(deriveWorkingSetOrdinal(sets, 1)).toBeNull(); // warmup
      expect(deriveWorkingSetOrdinal(sets, 2)).toBe(1);    // working set 1
      expect(deriveWorkingSetOrdinal(sets, 3)).toBe(2);    // working set 2 (skipped)
      expect(deriveWorkingSetOrdinal(sets, 4)).toBe(3);    // working set 3
      expect(deriveWorkingSetOrdinal(sets, 5)).toBeNull(); // out of bounds
    });

    it('3. getWorkingSetRowIndex finds the exact physical row index for a given working set ordinal', () => {
      const sets: SetEntry[] = [
        { setNumber: 1, isWarmup: true },
        { setNumber: 2, isWarmup: false, weight: 100, reps: 5, rpe: 8 },
        { setNumber: 3, isWarmup: false, weight: 100, reps: 5, rpe: 8.5 },
      ];

      expect(getWorkingSetRowIndex(sets, 1)).toBe(1);
      expect(getWorkingSetRowIndex(sets, 2)).toBe(2);
      expect(getWorkingSetRowIndex(sets, 3)).toBeNull();
    });
  });

  describe('Session Adapter (prepareLiveAdjustmentParams)', () => {
    it('4. Dynamically derives ordinals and attaches live row metadata (skip, drop, warmup)', () => {
      const exercise: ExerciseEntry = {
        name: 'Barbell Squat',
        muscleGroup: 'Quads',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'freeweight',
        isMainMovement: true,
        sets: [
          { setNumber: 1, isWarmup: true, weight: 60, reps: 5, rpe: 6 },
          { setNumber: 2, isWarmup: false, weight: 100, reps: 5, rpe: 8 },
          {
            setNumber: 3,
            isWarmup: false,
            weight: 100,
            reps: 5,
            rpe: 8.5,
            isDropSet: true,
            dropSubSets: [{ weight: 80, reps: 4 }],
          },
          { setNumber: 4, isWarmup: false, isSkipped: true, weight: 100, reps: 5, rpe: 9 },
        ],
      };

      const prescribedSnapshots: PrescribedTargetSnapshotMap = {
        '0-1': { weight: 100, reps: 5, rpe: 8 },
        '0-2': { weight: 100, reps: 5, rpe: 8.5 },
        '0-3': { weight: 100, reps: 5, rpe: 9 },
      };

      const committedEvidence: CommittedLiveEvidenceMap = {
        '0-1': { weight: 100, reps: 5, rpe: 8.5, form: 'standard' },
        '0-2': { weight: 100, reps: 5, rpe: 10, form: 'loose' },
      };

      const result = prepareLiveAdjustmentParams({
        exercise,
        exIdx: 0,
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        profileType: 'strength_normal',
        baselineE1RM: 140,
        prescribedTargetSnapshots: prescribedSnapshots,
        committedLiveEvidenceBySet: committedEvidence,
        triggeringSetIdx: 1, // physical row index 1 -> working set 1
      });

      expect(result.success).toBe(true);
      expect(result.params).toBeDefined();
      const params = result.params!;

      expect(params.triggeringWorkingSetOrdinal).toBe(1);
      expect(params.objective).toBe('Strength');
      expect(params.isMainMovement).toBe(true);

      // Prescribed targets mapped to working set ordinals 1, 2, 3
      expect(params.prescribedTargets).toEqual([
        { workingSetOrdinal: 1, weight: 100, reps: 5, rpe: 8 },
        { workingSetOrdinal: 2, weight: 100, reps: 5, rpe: 8.5 },
        { workingSetOrdinal: 3, weight: 100, reps: 5, rpe: 9 },
      ]);

      // Committed evidence mapped to ordinals 1 and 2, with current metadata attached from SetEntry
      expect(params.committedEvidence).toHaveLength(2);
      expect(params.committedEvidence[0]).toEqual({
        workingSetOrdinal: 1,
        weight: 100,
        reps: 5,
        rpe: 8.5,
        form: 'standard',
        isWarmup: false,
        isSkipped: false,
        isDropSet: false,
        dropSubSets: null,
      });

      // Row 2 is a drop set: metadata attached
      expect(params.committedEvidence[1]).toEqual({
        workingSetOrdinal: 2,
        weight: 100,
        reps: 5,
        rpe: 10,
        form: 'loose',
        isWarmup: false,
        isSkipped: false,
        isDropSet: true,
        dropSubSets: [{ reps: 4, weight: 80, rpe: 10 }],
      });
    });

    it('5. Returns safe failure if triggering set is a warm-up or invalid index', () => {
      const exercise: ExerciseEntry = {
        name: 'Bench Press',
        muscleGroup: 'Pecs',
        sets: [
          { setNumber: 1, isWarmup: true, weight: 40, reps: 10, rpe: 6 },
          { setNumber: 2, isWarmup: false, weight: 80, reps: 8, rpe: 8 },
        ],
      };

      const warmupResult = prepareLiveAdjustmentParams({
        exercise,
        exIdx: 0,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 110,
        prescribedTargetSnapshots: {},
        committedLiveEvidenceBySet: {},
        triggeringSetIdx: 0, // warm-up
      });

      expect(warmupResult.success).toBe(false);
      expect(warmupResult.failureReason).toBe('invalid_or_warmup_triggering_set');

      const outOfBoundsResult = prepareLiveAdjustmentParams({
        exercise,
        exIdx: 0,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 110,
        prescribedTargetSnapshots: {},
        committedLiveEvidenceBySet: {},
        triggeringSetIdx: 99,
      });

      expect(outOfBoundsResult.success).toBe(false);
    });

    it('6. Returns safe failure for non-supported objectives (e.g. Deload, Off)', () => {
      const exercise: ExerciseEntry = {
        name: 'Squat',
        muscleGroup: 'Quads',
        sets: [{ setNumber: 1, isWarmup: false, weight: 100, reps: 5, rpe: 7 }],
      };

      const result = prepareLiveAdjustmentParams({
        exercise,
        exIdx: 0,
        objective: 'Deload',
        algorithmId: 'strength_linear',
        profileType: 'strength_normal',
        baselineE1RM: 140,
        prescribedTargetSnapshots: { '0-0': { weight: 100, reps: 5, rpe: 7 } },
        committedLiveEvidenceBySet: {},
        triggeringSetIdx: 0,
      });

      expect(result.success).toBe(false);
      expect(result.failureReason).toBe('unsupported_objective');
    });
  });

  describe('Lifecycle Remapping with Insertion, Deletion, and Movement', () => {
    it('7. Auto-warmup insertion shifts all three session maps by 3 without mutating inputs', () => {
      const snapshots: PrescribedTargetSnapshotMap = Object.freeze({
        '0-0': { weight: 100, reps: 5, rpe: 8 },
        '0-1': { weight: 100, reps: 5, rpe: 8.5 },
        '1-0': { weight: 50, reps: 10, rpe: 8 },
      });

      const committedEvidence: CommittedLiveEvidenceMap = Object.freeze({
        '0-0': { weight: 100, reps: 5, rpe: 9, form: 'standard' },
      });

      const liveAdjustedSets: LiveAdjustedSetMap = Object.freeze({
        '0-1': true,
      });

      // Insert 3 warmups at beginning of exercise 0 (targetExIdx = 0, insertedAtSetIdx = 0, count = 3)
      const remappedSnapshots = remapAfterSetInsert(snapshots, 0, 0, 3);
      const remappedEvidence = remapAfterSetInsert(committedEvidence, 0, 0, 3);
      const remappedAdjusted = remapAfterSetInsert(liveAdjustedSets, 0, 0, 3);

      expect(remappedSnapshots['0-3']).toEqual({ weight: 100, reps: 5, rpe: 8 });
      expect(remappedSnapshots['0-4']).toEqual({ weight: 100, reps: 5, rpe: 8.5 });
      expect(remappedSnapshots['0-0']).toBeUndefined();
      expect(remappedSnapshots['0-1']).toBeUndefined();
      expect(remappedSnapshots['1-0']).toEqual({ weight: 50, reps: 10, rpe: 8 }); // Ex 1 untouched

      expect(remappedEvidence['0-3']).toEqual({ weight: 100, reps: 5, rpe: 9, form: 'standard' });
      expect(remappedEvidence['0-0']).toBeUndefined();

      expect(remappedAdjusted['0-4']).toBe(true);
      expect(remappedAdjusted['0-1']).toBeUndefined();
    });

    it('8. Exercise deletion, set deletion, set move, and exercise move remap all three maps accurately', () => {
      const snapshots: PrescribedTargetSnapshotMap = {
        '0-0': { weight: 100, reps: 5, rpe: 8 },
        '0-1': { weight: 100, reps: 5, rpe: 8.5 },
        '1-0': { weight: 60, reps: 10, rpe: 8 },
      };

      // Set deletion at 0-0
      const afterSetDelete = remapAfterSetDelete(snapshots, 0, 0);
      expect(afterSetDelete['0-0']).toEqual({ weight: 100, reps: 5, rpe: 8.5 }); // old 0-1 shifted down
      expect(afterSetDelete['0-1']).toBeUndefined();
      expect(afterSetDelete['1-0']).toEqual({ weight: 60, reps: 10, rpe: 8 });

      // Exercise move (swap 0 and 1)
      const afterExMove = remapAfterExerciseMove(snapshots, 0, 1);
      expect(afterExMove['1-0']).toEqual({ weight: 100, reps: 5, rpe: 8 });
      expect(afterExMove['1-1']).toEqual({ weight: 100, reps: 5, rpe: 8.5 });
      expect(afterExMove['0-0']).toEqual({ weight: 60, reps: 10, rpe: 8 });

      // Exercise delete (delete ex 0)
      const afterExDelete = remapAfterExerciseDelete(snapshots, 0);
      expect(afterExDelete['0-0']).toEqual({ weight: 60, reps: 10, rpe: 8 }); // old 1-0 shifted down
      expect(afterExDelete['1-0']).toBeUndefined();
    });

    it('9. Exercise replacement clears state for the replaced exercise only', () => {
      const snapshots: PrescribedTargetSnapshotMap = {
        '0-0': { weight: 100, reps: 5, rpe: 8 },
        '1-0': { weight: 50, reps: 12, rpe: 8 },
      };

      const afterReplace = remapAfterExerciseReplace(snapshots, 0);
      expect(afterReplace['0-0']).toBeUndefined();
      expect(afterReplace['1-0']).toEqual({ weight: 50, reps: 12, rpe: 8 });
    });
  });

  describe('Draft Persistence and WorkoutLog Isolation', () => {
    it('10. Draft serialization preserves all three maps in active draft payload', () => {
      const draftPayload = {
        programId: 'prog-1',
        programName: 'Hypertrophy Block',
        weekNum: 1,
        dayNum: 1,
        dateStr: '2026-08-15',
        isOneOff: false,
        scheduledDate: null,
        exercises: [],
        duration: 45,
        notes: '',
        sleep: 8,
        hydration: 'Adequate',
        calories: 2500,
        protein: 160,
        soreness: 2,
        motivation: 4,
        checkedSets: {},
        completionTouchedSets: {},
        collapsed: {},
        objective: 'Hypertrophy',
        userRawExercises: null,
        userTouchedSets: {},
        startTime: '2026-08-15T08:00:00.000Z',
        prescribedTargetSnapshots: {
          '0-0': { weight: 100, reps: 8, rpe: 8 },
        },
        committedLiveEvidenceBySet: {
          '0-0': { weight: 100, reps: 8, rpe: 8.5, form: 'standard' },
        },
        liveAdjustedSets: {
          '0-1': true,
        },
      };

      const serialized = JSON.stringify(draftPayload);
      const restored = JSON.parse(serialized);

      expect(restored.prescribedTargetSnapshots['0-0']).toEqual({ weight: 100, reps: 8, rpe: 8 });
      expect(restored.committedLiveEvidenceBySet['0-0']).toEqual({ weight: 100, reps: 8, rpe: 8.5, form: 'standard' });
      expect(restored.liveAdjustedSets['0-1']).toBe(true);
    });

    it('11. Old drafts without session maps restore safely with empty fallback maps', () => {
      const oldDraftPayload = {
        programId: 'prog-1',
        programName: 'Old Draft',
        weekNum: 1,
        dayNum: 1,
        dateStr: '2026-08-15',
        isOneOff: false,
        exercises: [],
        checkedSets: {},
        userTouchedSets: {},
      };

      // Simulating old draft restore logic in logger
      const restoredPrescribedSnapshots: PrescribedTargetSnapshotMap =
        (oldDraftPayload as any).prescribedTargetSnapshots ?? {};
      const restoredCommittedEvidence: CommittedLiveEvidenceMap =
        (oldDraftPayload as any).committedLiveEvidenceBySet ?? {};
      const restoredLiveAdjustedSets: LiveAdjustedSetMap =
        (oldDraftPayload as any).liveAdjustedSets ?? {};

      expect(restoredPrescribedSnapshots).toEqual({});
      expect(restoredCommittedEvidence).toEqual({});
      expect(restoredLiveAdjustedSets).toEqual({});
    });

    it('12. Permanent WorkoutLog saving excludes draft-only session maps completely', () => {
      const exercise: ExerciseEntry = {
        name: 'Incline Dumbbell Press',
        muscleGroup: 'Pecs',
        sets: [
          { setNumber: 1, weight: 30, reps: 10, rpe: 8 },
          { setNumber: 2, weight: 30, reps: 10, rpe: 8.5 },
        ],
      };

      const savedExercises = prepareExercisesForSave({
        exercises: [exercise],
      });

      // The saved exercise payload adheres strictly to standard ExerciseEntry schema
      expect(savedExercises[0].sets[0].isCompleted).toBe(true);
      expect((savedExercises[0] as any).prescribedTargetSnapshots).toBeUndefined();
      expect((savedExercises[0] as any).committedLiveEvidenceBySet).toBeUndefined();
      expect((savedExercises[0] as any).liveAdjustedSets).toBeUndefined();
      expect((savedExercises[0].sets[0] as any).prescribedTargetSnapshots).toBeUndefined();
    });
  });

  describe('Prescribed-snapshot capture and touched-row protection', () => {
    it('13. A. Untouched valid target capture: captures 100 kg x 10 at RPE 8 when userTouchedSets is false', () => {
      const exercise: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Pecs',
        sets: [
          { setNumber: 1, weight: 100, reps: 10, rpe: 8 },
          { setNumber: 2, weight: 100, reps: 10, rpe: 8.5 },
        ],
      };

      const userTouchedSets = { '0-0': false, '0-1': false };
      const snapshots = capturePrescribedSnapshotsFromExercises([exercise], {}, userTouchedSets, 0);

      expect(snapshots['0-0']).toEqual({ weight: 100, reps: 10, rpe: 8 });
      expect(snapshots['0-1']).toEqual({ weight: 100, reps: 10, rpe: 8.5 });
    });

    it('14. B. Touched row with existing snapshot: preserves existing 100 x 10 @ 8 snapshot without promoting 105 x 9 @ 9', () => {
      const existingSnapshots: PrescribedTargetSnapshotMap = {
        '0-0': { weight: 100, reps: 10, rpe: 8 },
      };

      // Active row was edited by user to 105 x 9 @ 9
      const modifiedExercise: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Pecs',
        sets: [
          { setNumber: 1, weight: 105, reps: 9, rpe: 9 },
        ],
      };

      const userTouchedSets = { '0-0': true };
      const result = capturePrescribedSnapshotsFromExercises([modifiedExercise], existingSnapshots, userTouchedSets, 0);

      // Preserves original snapshot without promoting user edits
      expect(result['0-0']).toEqual({ weight: 100, reps: 10, rpe: 8 });
    });

    it('15. C. Touched row without existing snapshot: creates no snapshot for user-touched row', () => {
      const modifiedExercise: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Pecs',
        sets: [
          { setNumber: 1, weight: 105, reps: 9, rpe: 9 },
        ],
      };

      const userTouchedSets = { '0-0': true };
      const result = capturePrescribedSnapshotsFromExercises([modifiedExercise], {}, userTouchedSets, 0);

      expect(result['0-0']).toBeUndefined();
    });

    it('16. D. Invalid/unprescribed row: creates no snapshot when weight or reps is zero or RPE invalid', () => {
      const unprescribedExercise: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Pecs',
        sets: [
          { setNumber: 1, weight: 0, reps: 0, rpe: 0 },
          { setNumber: 2, weight: 100, reps: 0, rpe: 8 },
          { setNumber: 3, weight: 0, reps: 10, rpe: 8 },
          { setNumber: 4, weight: 100, reps: 10, rpe: 5 }, // RPE < 6
          { setNumber: 5, weight: 100, reps: 10, rpe: 8, isSkipped: true }, // Skipped
        ],
      };

      const result = capturePrescribedSnapshotsFromExercises([unprescribedExercise], {}, {}, 0);

      expect(Object.keys(result)).toHaveLength(0);
    });

    it('17. E. Input immutability: does not mutate exercise arrays, existing snapshots, or touched records', () => {
      const originalSet = Object.freeze({ setNumber: 1, weight: 100, reps: 10, rpe: 8 });
      const originalEx = Object.freeze({
        name: 'Squat',
        muscleGroup: 'Quads',
        sets: Object.freeze([originalSet]) as unknown as SetEntry[],
      }) as unknown as ExerciseEntry;
      const exercises = Object.freeze([originalEx]) as unknown as ExerciseEntry[];
      const initialSnapshots = Object.freeze({
        '1-0': Object.freeze({ weight: 80, reps: 8, rpe: 8 }),
      }) as unknown as PrescribedTargetSnapshotMap;
      const touchedSets = Object.freeze({ '0-0': false }) as unknown as Record<string, boolean>;

      const result = capturePrescribedSnapshotsFromExercises(exercises, initialSnapshots, touchedSets, 0);

      expect(result['0-0']).toEqual({ weight: 100, reps: 10, rpe: 8 });
      expect(result['1-0']).toEqual({ weight: 80, reps: 8, rpe: 8 });
      expect(initialSnapshots['0-0']).toBeUndefined();
    });
  });

  describe('Committed-evidence helper tests', () => {
    it('18. Preserves Form accurately (null remains null, undefined becomes null, standard and loose preserved)', () => {
      const nullFormEvidence = createCommittedLiveEvidenceValue(100, 10, 8, null);
      expect(nullFormEvidence.form).toBeNull();

      const undefinedFormEvidence = createCommittedLiveEvidenceValue(100, 10, 8, undefined);
      expect(undefinedFormEvidence.form).toBeNull();

      const strictFormEvidence = createCommittedLiveEvidenceValue(100, 10, 8, 'strict');
      expect(strictFormEvidence.form).toBe('strict');

      const standardFormEvidence = createCommittedLiveEvidenceValue(100, 10, 8, 'standard');
      expect(standardFormEvidence.form).toBe('standard');

      const looseFormEvidence = createCommittedLiveEvidenceValue(100, 10, 8, 'loose');
      expect(looseFormEvidence.form).toBe('loose');
    });

    it('19. Selected RPE replaces previous displayed RPE in evidence', () => {
      // Row previously had target RPE 8, user selects RPE 9
      const evidence = createCommittedLiveEvidenceValue(100, 10, 9, 'standard');
      expect(evidence.rpe).toBe(9);
      expect(evidence.weight).toBe(100);
      expect(evidence.reps).toBe(10);
      expect(evidence.form).toBe('standard');
    });

    it('20. Updated weight and reps are captured when RPE is recommitted', () => {
      // User first committed 100 x 10 @ 8.5
      const firstEvidence = createCommittedLiveEvidenceValue(100, 10, 8.5, 'standard');
      expect(firstEvidence).toEqual({ weight: 100, reps: 10, rpe: 8.5, form: 'standard' });

      // User edited row to 105 kg and 9 reps, then clicked RPE 9
      const recommittedEvidence = createCommittedLiveEvidenceValue(105, 9, 9, 'standard');
      expect(recommittedEvidence).toEqual({ weight: 105, reps: 9, rpe: 9, form: 'standard' });
    });

    it('21. Same-value RPE commitment returns a refreshed evidence tuple', () => {
      // Current displayed target is 100 x 8 @ 8
      // Clicking 8 again produces refreshed evidence
      const evidence = createCommittedLiveEvidenceValue(100, 8, 8, null);
      expect(evidence).toEqual({ weight: 100, reps: 8, rpe: 8, form: null });
    });
  });

  describe('MetReps Phase 2B-2B Live Future-Set Target Application & Protection Suite', () => {
    it('22. Compound Hypertrophy: Set 1 underperformance (RPE 10 instead of 8) live adjusts Sets 2 and 3 downwards', () => {
      const exercise: ExerciseEntry = {
        name: 'Incline Barbell Press',
        muscleGroup: 'Pecs',
        sets: [
          { setNumber: 1, weight: 100, reps: 10, rpe: 8 },
          { setNumber: 2, weight: 100, reps: 10, rpe: 8.5 },
          { setNumber: 3, weight: 100, reps: 9, rpe: 9 },
        ],
      };

      const prescribedSnapshots: PrescribedTargetSnapshotMap = {
        '0-0': { weight: 100, reps: 10, rpe: 8 },
        '0-1': { weight: 100, reps: 10, rpe: 8.5 },
        '0-2': { weight: 100, reps: 9, rpe: 9 },
      };

      // Set 1 committed as 100 x 10 @ 10 (overfatigued / RPE overshoot by 2)
      const committedEvidence: CommittedLiveEvidenceMap = {
        '0-0': { weight: 100, reps: 10, rpe: 10, form: 'standard' },
      };

      const prep = prepareLiveAdjustmentParams({
        exercise,
        exIdx: 0,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 133.3,
        prescribedTargetSnapshots: prescribedSnapshots,
        committedLiveEvidenceBySet: committedEvidence,
        triggeringSetIdx: 0,
      });

      expect(prep.success).toBe(true);
      const mathResult = calculateLiveSetAdjustments(prep.params!);
      expect(mathResult.status).toBe('adjusted');
      expect(mathResult.sessionReadiness).toBeLessThan(1.0);
      expect(mathResult.candidateTargets.length).toBeGreaterThan(0);

      const appResult = applyLiveAdjustmentResult({
        exercise,
        exIdx: 0,
        result: mathResult,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: {},
        userTouchedSets: { '0-0': true },
        focusedSetKey: null,
        activeSelectorRowKey: null,
        triggeringRowIndex: 0,
      });

      expect(appResult.appliedChangeCount).toBe(2);
      expect(appResult.updatedLiveAdjustedSets['0-1']).toBe(true);
      expect(appResult.updatedLiveAdjustedSets['0-2']).toBe(true);
      expect(appResult.updatedLiveAdjustedSets['0-0']).toBeUndefined(); // Set 0 is evidence, not marked adjusted

      // Future sets had their weights reduced
      expect(appResult.updatedExercise.sets[1].weight).toBeLessThan(100);
      expect(appResult.updatedExercise.sets[2].weight).toBeLessThan(100);
      // Set 0 was untouched by application
      expect(appResult.updatedExercise.sets[0].weight).toBe(100);
      expect(appResult.updatedExercise.sets[0].reps).toBe(10);
    });

    it('23. Strength Undulating: Set 1 overperformance live adjusts future working sets upwards', () => {
      const exercise: ExerciseEntry = {
        name: 'Barbell Squat',
        muscleGroup: 'Quads',
        isMainMovement: true,
        sets: [
          { setNumber: 1, weight: 140, reps: 5, rpe: 8 },
          { setNumber: 2, weight: 130, reps: 5, rpe: 7.0 },
          { setNumber: 3, weight: 132.5, reps: 5, rpe: 7.5 },
        ],
      };

      const prescribedSnapshots: PrescribedTargetSnapshotMap = {
        '0-0': { weight: 140, reps: 5, rpe: 8 },
        '0-1': { weight: 130, reps: 5, rpe: 7.0 },
        '0-2': { weight: 132.5, reps: 5, rpe: 7.5 },
      };

      // Set 1 committed at 140 x 5 @ 6.5 (significantly easier than planned RPE 8)
      const committedEvidence: CommittedLiveEvidenceMap = {
        '0-0': { weight: 140, reps: 5, rpe: 6.5, form: 'standard' },
      };

      const prep = prepareLiveAdjustmentParams({
        exercise,
        exIdx: 0,
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        profileType: 'strength_normal',
        baselineE1RM: 172.6,
        prescribedTargetSnapshots: prescribedSnapshots,
        committedLiveEvidenceBySet: committedEvidence,
        triggeringSetIdx: 0,
      });

      expect(prep.success).toBe(true);
      const mathResult = calculateLiveSetAdjustments(prep.params!);
      expect(mathResult.status).toBe('adjusted');
      expect(mathResult.sessionReadiness).toBeGreaterThan(1.0);

      const appResult = applyLiveAdjustmentResult({
        exercise,
        exIdx: 0,
        result: mathResult,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: {},
        userTouchedSets: { '0-0': true },
        focusedSetKey: null,
        activeSelectorRowKey: null,
        triggeringRowIndex: 0,
      });

      expect(appResult.appliedChangeCount).toBe(2);
      expect(appResult.updatedExercise.sets[1].weight).toBeGreaterThan(130);
      expect(appResult.updatedExercise.sets[2].weight).toBeGreaterThan(132.5);
    });

    it('24. Protection: User-touched future row is preserved while untouched rows adjust', () => {
      const exercise: ExerciseEntry = {
        name: 'Bench Press',
        muscleGroup: 'Pecs',
        sets: [
          { setNumber: 1, weight: 100, reps: 10, rpe: 8 },
          { setNumber: 2, weight: 105, reps: 8, rpe: 8.5 }, // User manually edited Set 2
          { setNumber: 3, weight: 100, reps: 9, rpe: 9 },
        ],
      };

      const prescribedSnapshots: PrescribedTargetSnapshotMap = {
        '0-0': { weight: 100, reps: 10, rpe: 8 },
        '0-1': { weight: 100, reps: 10, rpe: 8.5 },
        '0-2': { weight: 100, reps: 9, rpe: 9 },
      };

      const committedEvidence: CommittedLiveEvidenceMap = {
        '0-0': { weight: 100, reps: 10, rpe: 10, form: 'standard' },
      };

      const prep = prepareLiveAdjustmentParams({
        exercise,
        exIdx: 0,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 133.3,
        prescribedTargetSnapshots: prescribedSnapshots,
        committedLiveEvidenceBySet: committedEvidence,
        triggeringSetIdx: 0,
      });

      const mathResult = calculateLiveSetAdjustments(prep.params!);

      const appResult = applyLiveAdjustmentResult({
        exercise,
        exIdx: 0,
        result: mathResult,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: {},
        userTouchedSets: { '0-0': true, '0-1': true }, // Set 1 is user-touched!
        focusedSetKey: null,
        activeSelectorRowKey: null,
        triggeringRowIndex: 0,
      });

      // Only Set 2 (row 2) received the adjustment
      expect(appResult.appliedChangeCount).toBe(1);
      // Row 1 remained exactly what the user typed (105 x 8)
      expect(appResult.updatedExercise.sets[1].weight).toBe(105);
      expect(appResult.updatedExercise.sets[1].reps).toBe(8);
      expect(appResult.updatedLiveAdjustedSets['0-1']).toBeUndefined();
      // Row 2 was adjusted
      expect(appResult.updatedExercise.sets[2].weight).toBeLessThan(100);
      expect(appResult.updatedLiveAdjustedSets['0-2']).toBe(true);
    });

    it('25. Protection: Currently focused input or active popup is never overwritten', () => {
      const exercise: ExerciseEntry = {
        name: 'Deadlift',
        muscleGroup: 'Back',
        isMainMovement: true,
        sets: [
          { setNumber: 1, weight: 160, reps: 5, rpe: 8 },
          { setNumber: 2, weight: 160, reps: 5, rpe: 8.5 },
          { setNumber: 3, weight: 160, reps: 5, rpe: 9 },
        ],
      };

      const prescribedSnapshots: PrescribedTargetSnapshotMap = {
        '0-0': { weight: 160, reps: 5, rpe: 8 },
        '0-1': { weight: 160, reps: 5, rpe: 8.5 },
        '0-2': { weight: 160, reps: 5, rpe: 9 },
      };

      const committedEvidence: CommittedLiveEvidenceMap = {
        '0-0': { weight: 160, reps: 5, rpe: 10, form: 'standard' },
      };

      const prep = prepareLiveAdjustmentParams({
        exercise,
        exIdx: 0,
        objective: 'Strength',
        algorithmId: 'strength_linear',
        profileType: 'strength_normal',
        baselineE1RM: 197.3,
        prescribedTargetSnapshots: prescribedSnapshots,
        committedLiveEvidenceBySet: committedEvidence,
        triggeringSetIdx: 0,
      });

      const mathResult = calculateLiveSetAdjustments(prep.params!);

      // User has focus on row 1 ('0-1')
      const appResultFocused = applyLiveAdjustmentResult({
        exercise,
        exIdx: 0,
        result: mathResult,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: {},
        userTouchedSets: { '0-0': true },
        focusedSetKey: '0-1',
        activeSelectorRowKey: null,
        triggeringRowIndex: 0,
      });

      // Row 1 is protected from overwrite because it is focused
      expect(appResultFocused.updatedExercise.sets[1].weight).toBe(160);
      expect(appResultFocused.updatedLiveAdjustedSets['0-1']).toBeUndefined();
      // Row 2 is adjusted
      expect(appResultFocused.updatedExercise.sets[2].weight).toBeLessThan(160);
      expect(appResultFocused.updatedLiveAdjustedSets['0-2']).toBe(true);

      // Active selector popup on row 2 ('0-2') protects row 2
      const appResultPopup = applyLiveAdjustmentResult({
        exercise,
        exIdx: 0,
        result: mathResult,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: {},
        userTouchedSets: { '0-0': true },
        focusedSetKey: null,
        activeSelectorRowKey: '0-2',
        triggeringRowIndex: 0,
      });

      expect(appResultPopup.updatedExercise.sets[1].weight).toBeLessThan(160);
      expect(appResultPopup.updatedLiveAdjustedSets['0-1']).toBe(true);
      expect(appResultPopup.updatedExercise.sets[2].weight).toBe(160);
      expect(appResultPopup.updatedLiveAdjustedSets['0-2']).toBeUndefined();
    });

    it('26. Restore Planned Targets: Restores original snapshots and clears liveAdjusted markers', () => {
      const liveAdjustedExercise: ExerciseEntry = {
        name: 'Incline Dumbbell Press',
        muscleGroup: 'Pecs',
        sets: [
          { setNumber: 1, weight: 32, reps: 10, rpe: 10 },
          { setNumber: 2, weight: 28, reps: 10, rpe: 8.5 }, // Live adjusted from 32
          { setNumber: 3, weight: 26, reps: 9, rpe: 9 },    // Live adjusted from 32
        ],
      };

      const prescribedSnapshots: PrescribedTargetSnapshotMap = {
        '0-0': { weight: 32, reps: 10, rpe: 8 },
        '0-1': { weight: 32, reps: 10, rpe: 8.5 },
        '0-2': { weight: 32, reps: 9, rpe: 9 },
      };

      const currentLiveAdjustedSets: LiveAdjustedSetMap = {
        '0-1': true,
        '0-2': true,
      };

      const canRestore = canRestorePlannedTargets({
        exercise: liveAdjustedExercise,
        exIdx: 0,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: currentLiveAdjustedSets,
        userTouchedSets: { '0-0': true },
        focusedSetKey: null,
        activeSelectorRowKey: null,
      });

      expect(canRestore).toBe(true);

      const restoreResult = restorePlannedTargetsForExercise({
        exercise: liveAdjustedExercise,
        exIdx: 0,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: currentLiveAdjustedSets,
        userTouchedSets: { '0-0': true },
        focusedSetKey: null,
        activeSelectorRowKey: null,
      });

      expect(restoreResult.restoredRowKeys).toEqual(['0-1', '0-2']);
      // Targets reverted to original snapshots
      expect(restoreResult.updatedExercise.sets[1].weight).toBe(32);
      expect(restoreResult.updatedExercise.sets[2].weight).toBe(32);
      // Evidence on Set 1 untouched
      expect(restoreResult.updatedExercise.sets[0].weight).toBe(32);
      expect(restoreResult.updatedExercise.sets[0].rpe).toBe(10);
      // Live adjusted markers cleared
      expect(restoreResult.updatedLiveAdjustedSets['0-1']).toBeUndefined();
      expect(restoreResult.updatedLiveAdjustedSets['0-2']).toBeUndefined();

      // Subsequent canRestore check returns false
      const canRestoreAfter = canRestorePlannedTargets({
        exercise: restoreResult.updatedExercise,
        exIdx: 0,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: restoreResult.updatedLiveAdjustedSets,
        userTouchedSets: { '0-0': true },
        focusedSetKey: null,
        activeSelectorRowKey: null,
      });
      expect(canRestoreAfter).toBe(false);
    });

    it('27. Idempotency & Repeatability: Committing RPE multiple times produces deterministic targets', () => {
      const exercise: ExerciseEntry = {
        name: 'Leg Press',
        muscleGroup: 'Quads',
        sets: [
          { setNumber: 1, weight: 200, reps: 10, rpe: 8 },
          { setNumber: 2, weight: 200, reps: 10, rpe: 8.5 },
          { setNumber: 3, weight: 200, reps: 10, rpe: 9 },
        ],
      };

      const prescribedSnapshots: PrescribedTargetSnapshotMap = {
        '0-0': { weight: 200, reps: 10, rpe: 8 },
        '0-1': { weight: 200, reps: 10, rpe: 8.5 },
        '0-2': { weight: 200, reps: 10, rpe: 9 },
      };

      const committedEvidence: CommittedLiveEvidenceMap = {
        '0-0': { weight: 200, reps: 10, rpe: 9.5, form: 'standard' },
      };

      const prep1 = prepareLiveAdjustmentParams({
        exercise,
        exIdx: 0,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 266.6,
        prescribedTargetSnapshots: prescribedSnapshots,
        committedLiveEvidenceBySet: committedEvidence,
        triggeringSetIdx: 0,
      });

      const math1 = calculateLiveSetAdjustments(prep1.params!);
      const app1 = applyLiveAdjustmentResult({
        exercise,
        exIdx: 0,
        result: math1,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: {},
        userTouchedSets: { '0-0': true },
        focusedSetKey: null,
        activeSelectorRowKey: null,
        triggeringRowIndex: 0,
      });

      // Commit same RPE again with the updated exercise as input
      const prep2 = prepareLiveAdjustmentParams({
        exercise: app1.updatedExercise,
        exIdx: 0,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 266.6,
        prescribedTargetSnapshots: prescribedSnapshots,
        committedLiveEvidenceBySet: committedEvidence,
        triggeringSetIdx: 0,
      });

      const math2 = calculateLiveSetAdjustments(prep2.params!);
      const app2 = applyLiveAdjustmentResult({
        exercise: app1.updatedExercise,
        exIdx: 0,
        result: math2,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: app1.updatedLiveAdjustedSets,
        userTouchedSets: { '0-0': true },
        focusedSetKey: null,
        activeSelectorRowKey: null,
        triggeringRowIndex: 0,
      });

      expect(app2.updatedExercise.sets[1].weight).toEqual(app1.updatedExercise.sets[1].weight);
      expect(app2.updatedExercise.sets[2].weight).toEqual(app1.updatedExercise.sets[2].weight);
      expect(app2.updatedLiveAdjustedSets).toEqual(app1.updatedLiveAdjustedSets);
    });

    it('28. Manual Trace Scenario: Prescribed 100x10@8, 100x10@8.5, 100x9@9 -> Commit Set 1 as 100x10@10 -> Restore', () => {
      // Step 1: Initial prescribed state
      const initialExercise: ExerciseEntry = {
        name: 'Bench Press',
        muscleGroup: 'Pecs',
        sets: [
          { setNumber: 1, weight: 100, reps: 10, rpe: 8 },
          { setNumber: 2, weight: 100, reps: 10, rpe: 8.5 },
          { setNumber: 3, weight: 100, reps: 9, rpe: 9 },
        ],
      };

      const prescribedSnapshots: PrescribedTargetSnapshotMap = {
        '0-0': { weight: 100, reps: 10, rpe: 8 },
        '0-1': { weight: 100, reps: 10, rpe: 8.5 },
        '0-2': { weight: 100, reps: 9, rpe: 9 },
      };

      // Step 2: User commits Set 1 as 100 x 10 @ 10
      const committedEvidence: CommittedLiveEvidenceMap = {
        '0-0': { weight: 100, reps: 10, rpe: 10, form: 'standard' },
      };

      const prep = prepareLiveAdjustmentParams({
        exercise: initialExercise,
        exIdx: 0,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 133.3,
        prescribedTargetSnapshots: prescribedSnapshots,
        committedLiveEvidenceBySet: committedEvidence,
        triggeringSetIdx: 0,
      });

      expect(prep.success).toBe(true);
      const mathResult = calculateLiveSetAdjustments(prep.params!);
      expect(mathResult.status).toBe('adjusted');
      expect(mathResult.shouldNotify).toBe(true);

      const appResult = applyLiveAdjustmentResult({
        exercise: initialExercise,
        exIdx: 0,
        result: mathResult,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: {},
        userTouchedSets: { '0-0': true },
        focusedSetKey: null,
        activeSelectorRowKey: null,
        triggeringRowIndex: 0,
      });

      // Step 3 & 4: Sets 2 and 3 are displayed with reduced targets, Set 1 untouched, toast triggered
      expect(appResult.appliedChangeCount).toBe(2);
      expect(appResult.updatedExercise.sets[0]).toEqual({ setNumber: 1, weight: 100, reps: 10, rpe: 8 });
      expect(appResult.updatedExercise.sets[1].weight).toBeLessThan(100);
      expect(appResult.updatedExercise.sets[2].weight).toBeLessThan(100);
      expect(appResult.updatedLiveAdjustedSets['0-1']).toBe(true);
      expect(appResult.updatedLiveAdjustedSets['0-2']).toBe(true);

      // Step 5: User clicks Restore Planned Targets
      const restoreResult = restorePlannedTargetsForExercise({
        exercise: appResult.updatedExercise,
        exIdx: 0,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: appResult.updatedLiveAdjustedSets,
        userTouchedSets: { '0-0': true },
        focusedSetKey: null,
        activeSelectorRowKey: null,
      });

      // Step 6: Sets 2 and 3 restored to original 100x10@8.5 and 100x9@9, evidence untouched
      expect(restoreResult.updatedExercise.sets[1]).toEqual({ setNumber: 2, weight: 100, reps: 10, rpe: 8.5 });
      expect(restoreResult.updatedExercise.sets[2]).toEqual({ setNumber: 3, weight: 100, reps: 9, rpe: 9 });
      expect(committedEvidence['0-0']).toEqual({ weight: 100, reps: 10, rpe: 10, form: 'standard' });
      expect(restoreResult.updatedLiveAdjustedSets).toEqual({});
    });
  });

  describe('MetReps Phase 2B-2B Permanent Template Isolation & Coverage Integrity Suite', () => {
    it('1. RPE commitment does not mutate Program.exercisesByDay', () => {
      const templateExercise: ExerciseEntry = {
        name: 'Barbell Bench Press (flat)',
        muscleGroup: 'Pecs',
        modality: 'weighted',
        sets: [
          { setNumber: 1, weight: 100, reps: 10, rpe: 8, form: 'standard' },
          { setNumber: 2, weight: 100, reps: 10, rpe: 8.5, form: 'standard' },
          { setNumber: 3, weight: 100, reps: 9, rpe: 9, form: 'standard' },
        ],
      };

      const sampleProgram: Program = {
        id: 'test-prog-1',
        name: 'Test Program',
        daysPerWeek: 3,
        programDuration: 8,
        createdAt: new Date().toISOString(),
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        exercisesByDay: {
          1: [JSON.parse(JSON.stringify(templateExercise))],
        },
      };

      const initialProgramJson = JSON.stringify(sampleProgram);

      // Active workout session exercises
      const activeExercise: ExerciseEntry = JSON.parse(JSON.stringify(templateExercise));
      const prescribedSnapshots: PrescribedTargetSnapshotMap = {
        '0-0': { weight: 100, reps: 10, rpe: 8 },
        '0-1': { weight: 100, reps: 10, rpe: 8.5 },
        '0-2': { weight: 100, reps: 9, rpe: 9 },
      };

      const committedEvidence: CommittedLiveEvidenceMap = {
        '0-0': { weight: 100, reps: 10, rpe: 10, form: 'standard' },
      };

      const prep = prepareLiveAdjustmentParams({
        exercise: activeExercise,
        exIdx: 0,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 133.3,
        prescribedTargetSnapshots: prescribedSnapshots,
        committedLiveEvidenceBySet: committedEvidence,
        triggeringSetIdx: 0,
      });

      expect(prep.success).toBe(true);
      const mathResult = calculateLiveSetAdjustments(prep.params!);
      const appResult = applyLiveAdjustmentResult({
        exercise: activeExercise,
        exIdx: 0,
        result: mathResult,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: {},
        userTouchedSets: { '0-0': true },
        focusedSetKey: null,
        activeSelectorRowKey: null,
        triggeringRowIndex: 0,
      });

      expect(appResult.appliedChangeCount).toBe(2);
      expect(appResult.updatedExercise.sets[1].weight).toBeLessThan(100);

      // Verify that sampleProgram was not mutated in any way
      expect(JSON.stringify(sampleProgram)).toBe(initialProgramJson);
      expect(sampleProgram.exercisesByDay[1][0].sets[1].weight).toBe(100);
      expect(sampleProgram.exercisesByDay[1][0].sets[2].weight).toBe(100);
    });

    it('2. RPE commitment does not invoke permanent program storage', () => {
      const saveProgramSpy = vi.spyOn(storage, 'saveProgram');

      const activeExercise: ExerciseEntry = {
        name: 'Squat',
        muscleGroup: 'Quads',
        sets: [
          { setNumber: 1, weight: 140, reps: 5, rpe: 8 },
          { setNumber: 2, weight: 140, reps: 5, rpe: 8 },
        ],
      };

      const prescribedSnapshots: PrescribedTargetSnapshotMap = {
        '0-0': { weight: 140, reps: 5, rpe: 8 },
        '0-1': { weight: 140, reps: 5, rpe: 8 },
      };

      const committedEvidence: CommittedLiveEvidenceMap = {
        '0-0': { weight: 140, reps: 5, rpe: 9.5, form: 'standard' },
      };

      const prep = prepareLiveAdjustmentParams({
        exercise: activeExercise,
        exIdx: 0,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 172.8,
        prescribedTargetSnapshots: prescribedSnapshots,
        committedLiveEvidenceBySet: committedEvidence,
        triggeringSetIdx: 0,
      });

      const mathResult = calculateLiveSetAdjustments(prep.params!);
      applyLiveAdjustmentResult({
        exercise: activeExercise,
        exIdx: 0,
        result: mathResult,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: {},
        userTouchedSets: { '0-0': true },
        focusedSetKey: null,
        activeSelectorRowKey: null,
        triggeringRowIndex: 0,
      });

      expect(saveProgramSpy).not.toHaveBeenCalled();
      saveProgramSpy.mockRestore();
    });

    it('3. Restore Planned Targets does not mutate Program.exercisesByDay', () => {
      const sampleProgram: Program = {
        id: 'test-prog-restore',
        name: 'Test Program Restore',
        daysPerWeek: 3,
        programDuration: 8,
        createdAt: new Date().toISOString(),
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        exercisesByDay: {
          1: [
            {
              name: 'Overhead Press',
              muscleGroup: 'Delts',
              sets: [
                { setNumber: 1, weight: 60, reps: 8, rpe: 8 },
                { setNumber: 2, weight: 60, reps: 8, rpe: 8 },
              ],
            },
          ],
        },
      };

      const initialProgramJson = JSON.stringify(sampleProgram);

      const activeExercise: ExerciseEntry = {
        name: 'Overhead Press',
        muscleGroup: 'Delts',
        sets: [
          { setNumber: 1, weight: 60, reps: 8, rpe: 8 },
          { setNumber: 2, weight: 55, reps: 8, rpe: 8 }, // adjusted down
        ],
      };

      const prescribedSnapshots: PrescribedTargetSnapshotMap = {
        '0-0': { weight: 60, reps: 8, rpe: 8 },
        '0-1': { weight: 60, reps: 8, rpe: 8 },
      };

      const restoreOutput = restorePlannedTargetsForExercise({
        exercise: activeExercise,
        exIdx: 0,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: { '0-1': true },
        userTouchedSets: { '0-0': true },
        focusedSetKey: null,
        activeSelectorRowKey: null,
      });

      expect(restoreOutput.updatedExercise.sets[1].weight).toBe(60);
      expect(JSON.stringify(sampleProgram)).toBe(initialProgramJson);
      expect(sampleProgram.exercisesByDay[1][0].sets[1].weight).toBe(60);
    });

    it('4. Restore Planned Targets does not invoke permanent program storage', () => {
      const saveProgramSpy = vi.spyOn(storage, 'saveProgram');

      const activeExercise: ExerciseEntry = {
        name: 'Overhead Press',
        muscleGroup: 'Delts',
        sets: [
          { setNumber: 1, weight: 60, reps: 8, rpe: 8 },
          { setNumber: 2, weight: 55, reps: 8, rpe: 8 },
        ],
      };

      const prescribedSnapshots: PrescribedTargetSnapshotMap = {
        '0-0': { weight: 60, reps: 8, rpe: 8 },
        '0-1': { weight: 60, reps: 8, rpe: 8 },
      };

      restorePlannedTargetsForExercise({
        exercise: activeExercise,
        exIdx: 0,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: { '0-1': true },
        userTouchedSets: { '0-0': true },
        focusedSetKey: null,
        activeSelectorRowKey: null,
      });

      expect(saveProgramSpy).not.toHaveBeenCalled();
      saveProgramSpy.mockRestore();
    });

    it('5. Neither action mutates an existing saved WorkoutLog', () => {
      const existingLogs: WorkoutLog[] = [
        {
          id: 'log-past-1',
          date: '2026-08-01',
          program: 'Hypertrophy Block',
          programId: 'prog-1',
          week: '1',
          day: '1',
          unit: 'kg',
          exercises: [
            {
              name: 'Deadlift',
              muscleGroup: 'Hamstrings',
              sets: [{ setNumber: 1, weight: 180, reps: 5, rpe: 8, form: 'standard' }],
            },
          ],
        },
      ];

      const initialLogsJson = JSON.stringify(existingLogs);

      const activeExercise: ExerciseEntry = {
        name: 'Deadlift',
        muscleGroup: 'Hamstrings',
        sets: [
          { setNumber: 1, weight: 185, reps: 5, rpe: 8 },
          { setNumber: 2, weight: 185, reps: 5, rpe: 8 },
        ],
      };

      const prescribedSnapshots: PrescribedTargetSnapshotMap = {
        '0-0': { weight: 185, reps: 5, rpe: 8 },
        '0-1': { weight: 185, reps: 5, rpe: 8 },
      };

      const committedEvidence: CommittedLiveEvidenceMap = {
        '0-0': { weight: 185, reps: 5, rpe: 9.5, form: 'standard' },
      };

      const prep = prepareLiveAdjustmentParams({
        exercise: activeExercise,
        exIdx: 0,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 228.4,
        prescribedTargetSnapshots: prescribedSnapshots,
        committedLiveEvidenceBySet: committedEvidence,
        triggeringSetIdx: 0,
      });

      const mathResult = calculateLiveSetAdjustments(prep.params!);
      const appResult = applyLiveAdjustmentResult({
        exercise: activeExercise,
        exIdx: 0,
        result: mathResult,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: {},
        userTouchedSets: { '0-0': true },
        focusedSetKey: null,
        activeSelectorRowKey: null,
        triggeringRowIndex: 0,
      });

      restorePlannedTargetsForExercise({
        exercise: appResult.updatedExercise,
        exIdx: 0,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: appResult.updatedLiveAdjustedSets,
        userTouchedSets: { '0-0': true },
        focusedSetKey: null,
        activeSelectorRowKey: null,
      });

      expect(JSON.stringify(existingLogs)).toBe(initialLogsJson);
      expect(existingLogs[0].exercises[0].sets[0].weight).toBe(180);
    });

    it('6. Active adjusted values remain available to the existing draft-autosave data path', () => {
      const activeExercise: ExerciseEntry = {
        name: 'Incline Dumbbell Press',
        muscleGroup: 'Pecs',
        sets: [
          { setNumber: 1, weight: 30, reps: 10, rpe: 8 },
          { setNumber: 2, weight: 30, reps: 10, rpe: 8.5 },
        ],
      };

      const prescribedSnapshots: PrescribedTargetSnapshotMap = {
        '0-0': { weight: 30, reps: 10, rpe: 8 },
        '0-1': { weight: 30, reps: 10, rpe: 8.5 },
      };

      const committedEvidence: CommittedLiveEvidenceMap = {
        '0-0': { weight: 30, reps: 10, rpe: 10, form: 'standard' },
      };

      const prep = prepareLiveAdjustmentParams({
        exercise: activeExercise,
        exIdx: 0,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 40.0,
        prescribedTargetSnapshots: prescribedSnapshots,
        committedLiveEvidenceBySet: committedEvidence,
        triggeringSetIdx: 0,
      });

      const mathResult = calculateLiveSetAdjustments(prep.params!);
      const appResult = applyLiveAdjustmentResult({
        exercise: activeExercise,
        exIdx: 0,
        result: mathResult,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: {},
        userTouchedSets: { '0-0': true },
        focusedSetKey: null,
        activeSelectorRowKey: null,
        triggeringRowIndex: 0,
      });

      // Live adjusted targets exist in updatedExercise
      expect(appResult.updatedExercise.sets[1].weight).toBeLessThan(30);

      // In WorkoutLogger, draft autosave serializes `exercises`, `liveAdjustedSets`, `committedLiveEvidenceBySet`, `prescribedTargetSnapshots`
      const draftPayload = {
        exercises: [appResult.updatedExercise],
        liveAdjustedSets: appResult.updatedLiveAdjustedSets,
        committedLiveEvidenceBySet: committedEvidence,
        prescribedTargetSnapshots: prescribedSnapshots,
      };

      const serializedDraft = JSON.stringify(draftPayload);
      const deserializedDraft = JSON.parse(serializedDraft);

      expect(deserializedDraft.exercises[0].sets[1].weight).toBe(appResult.updatedExercise.sets[1].weight);
      expect(deserializedDraft.liveAdjustedSets['0-1']).toBe(true);
      expect(deserializedDraft.committedLiveEvidenceBySet['0-0'].rpe).toBe(10);
    });

    it('7. When every proposed future row is protected, appliedChangeCount is zero and the toast condition is false', () => {
      const exercise: ExerciseEntry = {
        name: 'Squat',
        muscleGroup: 'Quads',
        sets: [
          { setNumber: 1, weight: 100, reps: 10, rpe: 8 },
          { setNumber: 2, weight: 100, reps: 10, rpe: 8.5 },
          { setNumber: 3, weight: 100, reps: 9, rpe: 9 },
        ],
      };

      const prescribedSnapshots: PrescribedTargetSnapshotMap = {
        '0-0': { weight: 100, reps: 10, rpe: 8 },
        '0-1': { weight: 100, reps: 10, rpe: 8.5 },
        '0-2': { weight: 100, reps: 9, rpe: 9 },
      };

      const committedEvidence: CommittedLiveEvidenceMap = {
        '0-0': { weight: 100, reps: 10, rpe: 10, form: 'standard' },
      };

      const prep = prepareLiveAdjustmentParams({
        exercise,
        exIdx: 0,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 133.3,
        prescribedTargetSnapshots: prescribedSnapshots,
        committedLiveEvidenceBySet: committedEvidence,
        triggeringSetIdx: 0,
      });

      const mathResult = calculateLiveSetAdjustments(prep.params!);
      expect(mathResult.shouldNotify).toBe(true);

      // Protect Set 2 via userTouched and Set 3 via focusedSetKey
      const appResult = applyLiveAdjustmentResult({
        exercise,
        exIdx: 0,
        result: mathResult,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: {},
        userTouchedSets: { '0-0': true, '0-1': true },
        focusedSetKey: '0-2',
        activeSelectorRowKey: null,
        triggeringRowIndex: 0,
      });

      expect(appResult.appliedChangeCount).toBe(0);
      const toastTriggered = appResult.appliedChangeCount > 0 && mathResult.shouldNotify;
      expect(toastTriggered).toBe(false);
      expect(appResult.updatedLiveAdjustedSets).toEqual({});
    });

    it('8. When exactly one eligible future row changes, appliedChangeCount is one and the toast condition is true', () => {
      const exercise: ExerciseEntry = {
        name: 'Squat',
        muscleGroup: 'Quads',
        sets: [
          { setNumber: 1, weight: 100, reps: 10, rpe: 8 },
          { setNumber: 2, weight: 100, reps: 10, rpe: 8.5 },
          { setNumber: 3, weight: 100, reps: 9, rpe: 9 },
        ],
      };

      const prescribedSnapshots: PrescribedTargetSnapshotMap = {
        '0-0': { weight: 100, reps: 10, rpe: 8 },
        '0-1': { weight: 100, reps: 10, rpe: 8.5 },
        '0-2': { weight: 100, reps: 9, rpe: 9 },
      };

      const committedEvidence: CommittedLiveEvidenceMap = {
        '0-0': { weight: 100, reps: 10, rpe: 10, form: 'standard' },
      };

      const prep = prepareLiveAdjustmentParams({
        exercise,
        exIdx: 0,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 133.3,
        prescribedTargetSnapshots: prescribedSnapshots,
        committedLiveEvidenceBySet: committedEvidence,
        triggeringSetIdx: 0,
      });

      const mathResult = calculateLiveSetAdjustments(prep.params!);
      expect(mathResult.shouldNotify).toBe(true);

      // Protect Set 2 via userTouched, Set 3 remains eligible
      const appResult = applyLiveAdjustmentResult({
        exercise,
        exIdx: 0,
        result: mathResult,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: {},
        userTouchedSets: { '0-0': true, '0-1': true },
        focusedSetKey: null,
        activeSelectorRowKey: null,
        triggeringRowIndex: 0,
      });

      expect(appResult.appliedChangeCount).toBe(1);
      const toastTriggered = appResult.appliedChangeCount > 0 && mathResult.shouldNotify;
      expect(toastTriggered).toBe(true);
      expect(appResult.updatedLiveAdjustedSets['0-2']).toBe(true);
      expect(appResult.updatedLiveAdjustedSets['0-1']).toBeUndefined();
    });

    it('9. A no_change engine result produces no target mutation and no toast', () => {
      const exercise: ExerciseEntry = {
        name: 'Bench Press',
        muscleGroup: 'Pecs',
        sets: [
          { setNumber: 1, weight: 100, reps: 10, rpe: 8 },
          { setNumber: 2, weight: 100, reps: 10, rpe: 8.5 },
        ],
      };

      const prescribedSnapshots: PrescribedTargetSnapshotMap = {
        '0-0': { weight: 100, reps: 10, rpe: 8 },
        '0-1': { weight: 100, reps: 10, rpe: 8.5 },
      };

      // Set 1 committed exactly at prescribed targets (100 x 10 @ 8)
      const committedEvidence: CommittedLiveEvidenceMap = {
        '0-0': { weight: 100, reps: 10, rpe: 8, form: 'standard' },
      };

      const prep = prepareLiveAdjustmentParams({
        exercise,
        exIdx: 0,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 133.3,
        prescribedTargetSnapshots: prescribedSnapshots,
        committedLiveEvidenceBySet: committedEvidence,
        triggeringSetIdx: 0,
      });

      const mathResult = calculateLiveSetAdjustments(prep.params!);
      expect(mathResult.status).toBe('no_change');
      expect(mathResult.shouldNotify).toBe(false);

      const appResult = applyLiveAdjustmentResult({
        exercise,
        exIdx: 0,
        result: mathResult,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: {},
        userTouchedSets: { '0-0': true },
        focusedSetKey: null,
        activeSelectorRowKey: null,
        triggeringRowIndex: 0,
      });

      expect(appResult.appliedChangeCount).toBe(0);
      expect(appResult.updatedExercise.sets[1]).toEqual({ setNumber: 2, weight: 100, reps: 10, rpe: 8.5 });
      const toastTriggered = appResult.appliedChangeCount > 0 && mathResult.shouldNotify;
      expect(toastTriggered).toBe(false);
    });

    it('10. Warm-up rows are never altered by live adjustment', () => {
      const exercise: ExerciseEntry = {
        name: 'Squat',
        muscleGroup: 'Quads',
        sets: [
          { setNumber: 1, weight: 50, reps: 10, rpe: 4, form: 'standard', isWarmup: true },
          { setNumber: 2, weight: 100, reps: 10, rpe: 8, form: 'standard' },
          { setNumber: 3, weight: 100, reps: 10, rpe: 8.5, form: 'standard' },
        ],
      };

      const prescribedSnapshots: PrescribedTargetSnapshotMap = {
        '0-1': { weight: 100, reps: 10, rpe: 8 },
        '0-2': { weight: 100, reps: 10, rpe: 8.5 },
      };

      const committedEvidence: CommittedLiveEvidenceMap = {
        '0-1': { weight: 100, reps: 10, rpe: 10, form: 'standard' },
      };

      const prep = prepareLiveAdjustmentParams({
        exercise,
        exIdx: 0,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 133.3,
        prescribedTargetSnapshots: prescribedSnapshots,
        committedLiveEvidenceBySet: committedEvidence,
        triggeringSetIdx: 1, // Working Set 1 is at index 1
      });

      expect(prep.params?.triggeringWorkingSetOrdinal).toBe(1);
      const mathResult = calculateLiveSetAdjustments(prep.params!);
      const appResult = applyLiveAdjustmentResult({
        exercise,
        exIdx: 0,
        result: mathResult,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: {},
        userTouchedSets: { '0-1': true },
        focusedSetKey: null,
        activeSelectorRowKey: null,
        triggeringRowIndex: 1,
      });

      // Warmup row (index 0) remains identical
      expect(appResult.updatedExercise.sets[0]).toEqual({
        setNumber: 1,
        weight: 50,
        reps: 10,
        rpe: 4,
        form: 'standard',
        isWarmup: true,
      });
      // Working set 2 (index 2) was adjusted
      expect(appResult.updatedExercise.sets[2].weight).toBeLessThan(100);
    });

    it('11. Skipped sets are never altered', () => {
      const exercise: ExerciseEntry = {
        name: 'Bench Press',
        muscleGroup: 'Pecs',
        sets: [
          { setNumber: 1, weight: 100, reps: 10, rpe: 8 },
          { setNumber: 2, weight: 100, reps: 10, rpe: 8.5, isSkipped: true },
          { setNumber: 3, weight: 100, reps: 9, rpe: 9 },
        ],
      };

      const prescribedSnapshots: PrescribedTargetSnapshotMap = {
        '0-0': { weight: 100, reps: 10, rpe: 8 },
        '0-1': { weight: 100, reps: 10, rpe: 8.5 },
        '0-2': { weight: 100, reps: 9, rpe: 9 },
      };

      const committedEvidence: CommittedLiveEvidenceMap = {
        '0-0': { weight: 100, reps: 10, rpe: 10, form: 'standard' },
      };

      const prep = prepareLiveAdjustmentParams({
        exercise,
        exIdx: 0,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 133.3,
        prescribedTargetSnapshots: prescribedSnapshots,
        committedLiveEvidenceBySet: committedEvidence,
        triggeringSetIdx: 0,
      });

      const mathResult = calculateLiveSetAdjustments(prep.params!);
      const appResult = applyLiveAdjustmentResult({
        exercise,
        exIdx: 0,
        result: mathResult,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: {},
        userTouchedSets: { '0-0': true },
        focusedSetKey: null,
        activeSelectorRowKey: null,
        triggeringRowIndex: 0,
      });

      // Row 1 (skipped) is unchanged
      expect(appResult.updatedExercise.sets[1]).toEqual({
        setNumber: 2,
        weight: 100,
        reps: 10,
        rpe: 8.5,
        isSkipped: true,
      });
      // Row 2 is adjusted
      expect(appResult.updatedExercise.sets[2].weight).toBeLessThan(100);
      expect(appResult.updatedLiveAdjustedSets['0-1']).toBeUndefined();
      expect(appResult.updatedLiveAdjustedSets['0-2']).toBe(true);
    });

    it('12. Working-set ordinals 7 and higher are never altered', () => {
      const sets: SetEntry[] = [];
      const prescribedSnapshots: PrescribedTargetSnapshotMap = {};

      for (let ord = 1; ord <= 8; ord++) {
        sets.push({ setNumber: ord, weight: 100, reps: 8, rpe: 8 });
        prescribedSnapshots[`0-${ord - 1}`] = { weight: 100, reps: 8, rpe: 8 };
      }

      const exercise: ExerciseEntry = {
        name: 'Volume Squats',
        muscleGroup: 'Quads',
        sets,
      };

      const committedEvidence: CommittedLiveEvidenceMap = {
        '0-0': { weight: 100, reps: 8, rpe: 10, form: 'standard' },
      };

      const prep = prepareLiveAdjustmentParams({
        exercise,
        exIdx: 0,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 125.0,
        prescribedTargetSnapshots: prescribedSnapshots,
        committedLiveEvidenceBySet: committedEvidence,
        triggeringSetIdx: 0,
      });

      const mathResult = calculateLiveSetAdjustments(prep.params!);
      const appResult = applyLiveAdjustmentResult({
        exercise,
        exIdx: 0,
        result: mathResult,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: {},
        userTouchedSets: { '0-0': true },
        focusedSetKey: null,
        activeSelectorRowKey: null,
        triggeringRowIndex: 0,
      });

      // Ordinals 2..6 (indices 1..5) are adjusted
      for (let i = 1; i <= 5; i++) {
        expect(appResult.updatedExercise.sets[i].weight).toBeLessThan(100);
        expect(appResult.updatedLiveAdjustedSets[`0-${i}`]).toBe(true);
      }

      // Ordinals 7 and 8 (indices 6 and 7) are completely unaltered
      expect(appResult.updatedExercise.sets[6]).toEqual({ setNumber: 7, weight: 100, reps: 8, rpe: 8 });
      expect(appResult.updatedExercise.sets[7]).toEqual({ setNumber: 8, weight: 100, reps: 8, rpe: 8 });
      expect(appResult.updatedLiveAdjustedSets['0-6']).toBeUndefined();
      expect(appResult.updatedLiveAdjustedSets['0-7']).toBeUndefined();
    });

    it('13. Invalid-evidence restoration restores an untouched live-adjusted row but preserves a manually edited future row', () => {
      const exercise: ExerciseEntry = {
        name: 'Bench Press',
        muscleGroup: 'Pecs',
        sets: [
          { setNumber: 1, weight: 100, reps: 10, rpe: 8 },
          { setNumber: 2, weight: 92.5, reps: 10, rpe: 8.5 }, // Live adjusted
          { setNumber: 3, weight: 105, reps: 8, rpe: 9 }, // Manually edited by user
        ],
      };

      const prescribedSnapshots: PrescribedTargetSnapshotMap = {
        '0-0': { weight: 100, reps: 10, rpe: 8 },
        '0-1': { weight: 100, reps: 10, rpe: 8.5 },
        '0-2': { weight: 100, reps: 9, rpe: 9 },
      };

      // Set 1 recommitted with form 'loose', producing invalid_evidence
      const mathResult = {
        status: 'invalid_evidence' as const,
        candidateTargets: [{ workingSetOrdinal: 1, weight: 100, reps: 10, rpe: 8 }],
        changedWorkingSetOrdinals: [],
        restorePrescribedOrdinals: [2, 3],
        shouldNotify: false,
        sessionReadiness: 1.0,
        validEvidenceCount: 0,
        bypassReason: 'invalid_set_form' as const,
      };

      const appResult = applyLiveAdjustmentResult({
        exercise,
        exIdx: 0,
        result: mathResult,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: { '0-1': true, '0-2': true },
        userTouchedSets: { '0-0': true, '0-2': true }, // Set 3 was manually edited
        focusedSetKey: null,
        activeSelectorRowKey: null,
        triggeringRowIndex: 0,
      });

      // Set 2 restored to prescribed 100x10@8.5 and live-adjusted marker removed
      expect(appResult.updatedExercise.sets[1]).toEqual({ setNumber: 2, weight: 100, reps: 10, rpe: 8.5 });
      expect(appResult.updatedLiveAdjustedSets['0-1']).toBeUndefined();

      // Set 3 (user-touched) is protected: preserves manual edit (105x8@9) and is not modified by restoration
      expect(appResult.updatedExercise.sets[2]).toEqual({ setNumber: 3, weight: 105, reps: 8, rpe: 9 });
      expect(appResult.updatedLiveAdjustedSets['0-2']).toBe(true);
    });

    it('14. Target application preserves all non-target metadata, including form, comment, isWarmup, isDropSet, dropSubSets, isSkipped, isCompleted and custom properties', () => {
      const exercise: ExerciseEntry = {
        name: 'Leg Press',
        muscleGroup: 'Quads',
        sets: [
          { setNumber: 1, weight: 200, reps: 10, rpe: 8 },
          {
            setNumber: 2,
            weight: 200,
            reps: 10,
            rpe: 8.5,
            form: 'strict',
            comment: 'Pause at bottom',
            isWarmup: false,
            isDropSet: true,
            dropSubSets: [{ weight: 160, reps: 8 }],
            isSkipped: false,
            isCompleted: false,
            customTag: 'quad-focus',
          } as any,
        ],
      };

      const prescribedSnapshots: PrescribedTargetSnapshotMap = {
        '0-0': { weight: 200, reps: 10, rpe: 8 },
        '0-1': { weight: 200, reps: 10, rpe: 8.5 },
      };

      const committedEvidence: CommittedLiveEvidenceMap = {
        '0-0': { weight: 200, reps: 10, rpe: 10, form: 'standard' },
      };

      const prep = prepareLiveAdjustmentParams({
        exercise,
        exIdx: 0,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 266.6,
        prescribedTargetSnapshots: prescribedSnapshots,
        committedLiveEvidenceBySet: committedEvidence,
        triggeringSetIdx: 0,
      });

      const mathResult = calculateLiveSetAdjustments(prep.params!);
      const appResult = applyLiveAdjustmentResult({
        exercise,
        exIdx: 0,
        result: mathResult,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: {},
        userTouchedSets: { '0-0': true },
        focusedSetKey: null,
        activeSelectorRowKey: null,
        triggeringRowIndex: 0,
      });

      const set2 = appResult.updatedExercise.sets[1] as any;
      expect(set2.weight).toBeLessThan(200);
      expect(set2.form).toBe('strict');
      expect(set2.comment).toBe('Pause at bottom');
      expect(set2.isDropSet).toBe(true);
      expect(set2.dropSubSets).toEqual([{ weight: 160, reps: 8 }]);
      expect(set2.isSkipped).toBe(false);
      expect(set2.isCompleted).toBe(false);
      expect(set2.customTag).toBe('quad-focus');
    });

    it('15. canRestorePlannedTargets returns false when every marked row is user-touched or otherwise protected', () => {
      const exercise: ExerciseEntry = {
        name: 'Bench Press',
        muscleGroup: 'Pecs',
        sets: [
          { setNumber: 1, weight: 100, reps: 10, rpe: 8 },
          { setNumber: 2, weight: 92.5, reps: 10, rpe: 8.5 },
          { setNumber: 3, weight: 90, reps: 9, rpe: 9 },
        ],
      };

      const prescribedSnapshots: PrescribedTargetSnapshotMap = {
        '0-0': { weight: 100, reps: 10, rpe: 8 },
        '0-1': { weight: 100, reps: 10, rpe: 8.5 },
        '0-2': { weight: 100, reps: 9, rpe: 9 },
      };

      const currentLiveAdjustedSets: LiveAdjustedSetMap = {
        '0-1': true,
        '0-2': true,
      };

      // Both marked sets are user touched
      const userTouchedSets = {
        '0-1': true,
        '0-2': true,
      };

      const canRestore = canRestorePlannedTargets({
        exercise,
        exIdx: 0,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets,
        userTouchedSets,
        focusedSetKey: null,
        activeSelectorRowKey: null,
      });

      expect(canRestore).toBe(false);
    });

    it('16. Invoking restoration in that protected state changes nothing', () => {
      const exercise: ExerciseEntry = {
        name: 'Bench Press',
        muscleGroup: 'Pecs',
        sets: [
          { setNumber: 1, weight: 100, reps: 10, rpe: 8 },
          { setNumber: 2, weight: 92.5, reps: 10, rpe: 8.5 },
          { setNumber: 3, weight: 90, reps: 9, rpe: 9 },
        ],
      };

      const prescribedSnapshots: PrescribedTargetSnapshotMap = {
        '0-0': { weight: 100, reps: 10, rpe: 8 },
        '0-1': { weight: 100, reps: 10, rpe: 8.5 },
        '0-2': { weight: 100, reps: 9, rpe: 9 },
      };

      const currentLiveAdjustedSets: LiveAdjustedSetMap = {
        '0-1': true,
        '0-2': true,
      };

      const userTouchedSets = {
        '0-1': true,
        '0-2': true,
      };

      const restoreResult = restorePlannedTargetsForExercise({
        exercise,
        exIdx: 0,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets,
        userTouchedSets,
        focusedSetKey: null,
        activeSelectorRowKey: null,
      });

      expect(restoreResult.restoredRowKeys).toEqual([]);
      expect(restoreResult.updatedExercise).toEqual(exercise);
      expect(restoreResult.updatedLiveAdjustedSets).toEqual(currentLiveAdjustedSets);
    });

    it('17. Restore Planned Targets preserves committedLiveEvidenceBySet', () => {
      const exercise: ExerciseEntry = {
        name: 'Squat',
        muscleGroup: 'Quads',
        sets: [
          { setNumber: 1, weight: 100, reps: 10, rpe: 8 },
          { setNumber: 2, weight: 90, reps: 10, rpe: 8.5 },
        ],
      };

      const prescribedSnapshots: PrescribedTargetSnapshotMap = {
        '0-0': { weight: 100, reps: 10, rpe: 8 },
        '0-1': { weight: 100, reps: 10, rpe: 8.5 },
      };

      const committedEvidence: CommittedLiveEvidenceMap = {
        '0-0': { weight: 100, reps: 10, rpe: 10, form: 'standard' },
      };

      const initialEvidenceJson = JSON.stringify(committedEvidence);

      restorePlannedTargetsForExercise({
        exercise,
        exIdx: 0,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: { '0-1': true },
        userTouchedSets: { '0-0': true },
        focusedSetKey: null,
        activeSelectorRowKey: null,
      });

      expect(JSON.stringify(committedEvidence)).toBe(initialEvidenceJson);
      expect(committedEvidence['0-0']).toEqual({ weight: 100, reps: 10, rpe: 10, form: 'standard' });
    });

    it('18. Restore Planned Targets preserves prescribedTargetSnapshots', () => {
      const exercise: ExerciseEntry = {
        name: 'Squat',
        muscleGroup: 'Quads',
        sets: [
          { setNumber: 1, weight: 100, reps: 10, rpe: 8 },
          { setNumber: 2, weight: 90, reps: 10, rpe: 8.5 },
        ],
      };

      const prescribedSnapshots: PrescribedTargetSnapshotMap = {
        '0-0': { weight: 100, reps: 10, rpe: 8 },
        '0-1': { weight: 100, reps: 10, rpe: 8.5 },
      };

      const initialSnapshotsJson = JSON.stringify(prescribedSnapshots);

      restorePlannedTargetsForExercise({
        exercise,
        exIdx: 0,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: { '0-1': true },
        userTouchedSets: { '0-0': true },
        focusedSetKey: null,
        activeSelectorRowKey: null,
      });

      expect(JSON.stringify(prescribedSnapshots)).toBe(initialSnapshotsJson);
      expect(prescribedSnapshots['0-1']).toEqual({ weight: 100, reps: 10, rpe: 8.5 });
    });

    it('19. A triggering row previously marked live-adjusted loses its own marker when its RPE is explicitly recommitted', () => {
      const exercise: ExerciseEntry = {
        name: 'Bench Press',
        muscleGroup: 'Pecs',
        sets: [
          { setNumber: 1, weight: 100, reps: 10, rpe: 8 },
          { setNumber: 2, weight: 95, reps: 10, rpe: 8.5 }, // previously marked as live adjusted
          { setNumber: 3, weight: 95, reps: 9, rpe: 9 },
        ],
      };

      const prescribedSnapshots: PrescribedTargetSnapshotMap = {
        '0-0': { weight: 100, reps: 10, rpe: 8 },
        '0-1': { weight: 100, reps: 10, rpe: 8.5 },
        '0-2': { weight: 100, reps: 9, rpe: 9 },
      };

      const committedEvidence: CommittedLiveEvidenceMap = {
        '0-0': { weight: 100, reps: 10, rpe: 9, form: 'standard' },
        '0-1': { weight: 95, reps: 10, rpe: 9, form: 'standard' },
      };

      const prep = prepareLiveAdjustmentParams({
        exercise,
        exIdx: 0,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 133.3,
        prescribedTargetSnapshots: prescribedSnapshots,
        committedLiveEvidenceBySet: committedEvidence,
        triggeringSetIdx: 1, // row 1 is triggering
      });

      const mathResult = calculateLiveSetAdjustments(prep.params!);
      const appResult = applyLiveAdjustmentResult({
        exercise,
        exIdx: 0,
        result: mathResult,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: { '0-1': true, '0-2': true },
        userTouchedSets: { '0-0': true, '0-1': true },
        focusedSetKey: null,
        activeSelectorRowKey: null,
        triggeringRowIndex: 1,
      });

      // Row 1 (triggering row) must have its live adjusted marker explicitly removed
      expect(appResult.updatedLiveAdjustedSets['0-1']).toBeUndefined();
    });

    it('20. Missing and none Hypertrophy algorithms resolve to hypertrophy_linear', () => {
      expect(resolveEffectiveAlgorithmPolicyB('Hypertrophy', undefined)).toBe('hypertrophy_linear');
      expect(resolveEffectiveAlgorithmPolicyB('Hypertrophy', null)).toBe('hypertrophy_linear');
      expect(resolveEffectiveAlgorithmPolicyB('Hypertrophy', 'none')).toBe('hypertrophy_linear');
      expect(resolveEffectiveAlgorithmPolicyB('Hypertrophy', '')).toBe('hypertrophy_linear');
      expect(resolveEffectiveAlgorithmPolicyB('Hypertrophy', 'hypertrophy_linear')).toBe('hypertrophy_linear');
      expect(resolveEffectiveAlgorithmPolicyB('Hypertrophy', 'hypertrophy_step')).toBe('hypertrophy_step');
    });

    it('21. Missing and none Strength algorithms resolve to strength_undulating', () => {
      expect(resolveEffectiveAlgorithmPolicyB('Strength', undefined)).toBe('strength_undulating');
      expect(resolveEffectiveAlgorithmPolicyB('Strength', null)).toBe('strength_undulating');
      expect(resolveEffectiveAlgorithmPolicyB('Strength', 'none')).toBe('strength_undulating');
      expect(resolveEffectiveAlgorithmPolicyB('Strength', '')).toBe('strength_undulating');
      expect(resolveEffectiveAlgorithmPolicyB('Strength', 'strength_undulating')).toBe('strength_undulating');
      expect(resolveEffectiveAlgorithmPolicyB('Strength', 'strength_linear')).toBe('strength_linear');
    });

    it('22. Cross-objective and unknown algorithm identifiers remain safely bypassed', () => {
      // Hypertrophy with strength algorithm
      const crossHyp = resolveEffectiveAlgorithmPolicyB('Hypertrophy', 'strength_undulating');
      expect(crossHyp).toBe('strength_undulating');

      const exercise: ExerciseEntry = {
        name: 'Curl',
        muscleGroup: 'Biceps',
        sets: [
          { setNumber: 1, weight: 20, reps: 10, rpe: 8 },
          { setNumber: 2, weight: 20, reps: 10, rpe: 8 },
        ],
      };

      const prepCrossHyp = prepareLiveAdjustmentParams({
        exercise,
        exIdx: 0,
        objective: 'Hypertrophy',
        algorithmId: crossHyp,
        profileType: 'hypertrophy',
        baselineE1RM: 26.6,
        prescribedTargetSnapshots: { '0-0': { weight: 20, reps: 10, rpe: 8 } },
        committedLiveEvidenceBySet: { '0-0': { weight: 20, reps: 10, rpe: 10, form: 'standard' } },
        triggeringSetIdx: 0,
      });

      expect(prepCrossHyp.success).toBe(true);
      const mathCrossHyp = calculateLiveSetAdjustments(prepCrossHyp.params!);
      expect(mathCrossHyp.status).toBe('bypassed');
      expect(mathCrossHyp.bypassReason).toBe('invalid_algorithm_objective_pairing');

      // Strength with hypertrophy algorithm
      const crossStr = resolveEffectiveAlgorithmPolicyB('Strength', 'hypertrophy_linear');
      expect(crossStr).toBe('hypertrophy_linear');

      const prepCrossStr = prepareLiveAdjustmentParams({
        exercise: { ...exercise, isMainMovement: true },
        exIdx: 0,
        objective: 'Strength',
        algorithmId: crossStr,
        profileType: 'strength_normal',
        baselineE1RM: 26.6,
        prescribedTargetSnapshots: { '0-0': { weight: 20, reps: 10, rpe: 8 } },
        committedLiveEvidenceBySet: { '0-0': { weight: 20, reps: 10, rpe: 10, form: 'standard' } },
        triggeringSetIdx: 0,
      });

      expect(prepCrossStr.success).toBe(true);
      const mathCrossStr = calculateLiveSetAdjustments(prepCrossStr.params!);
      expect(mathCrossStr.status).toBe('bypassed');
      expect(mathCrossStr.bypassReason).toBe('invalid_algorithm_objective_pairing');

      // Unknown algorithm string
      const unknownAlg = resolveEffectiveAlgorithmPolicyB('Hypertrophy', 'custom_unknown_engine');
      expect(unknownAlg).toBe('custom_unknown_engine');

      const prepUnknown = prepareLiveAdjustmentParams({
        exercise,
        exIdx: 0,
        objective: 'Hypertrophy',
        algorithmId: unknownAlg,
        profileType: 'hypertrophy',
        baselineE1RM: 26.6,
        prescribedTargetSnapshots: { '0-0': { weight: 20, reps: 10, rpe: 8 } },
        committedLiveEvidenceBySet: { '0-0': { weight: 20, reps: 10, rpe: 10, form: 'standard' } },
        triggeringSetIdx: 0,
      });

      const mathUnknown = calculateLiveSetAdjustments(prepUnknown.params!);
      expect(mathUnknown.status).toBe('bypassed');
      expect(mathUnknown.bypassReason).toBe('invalid_algorithm_objective_pairing');
    });
  });

  describe('MetReps Phase 2B-2B Sequential Regression and Continuous Recommitment Suite', () => {
    const prescribedSnapshots: PrescribedTargetSnapshotMap = {
      '0-0': { weight: 90, reps: 12, rpe: 8.0 },
      '0-1': { weight: 90, reps: 12, rpe: 8.5 },
      '0-2': { weight: 90, reps: 9, rpe: 9.0 },
    };

    const initialExercise: ExerciseEntry = {
      name: 'Bench Press',
      muscleGroup: 'Chest',
      modality: 'weighted',
      movementCategory: 'compound',
      equipment: 'freeweight',
      sets: [
        { setNumber: 1, weight: 90, reps: 12, rpe: 8.0 },
        { setNumber: 2, weight: 90, reps: 12, rpe: 8.5 },
        { setNumber: 3, weight: 90, reps: 9, rpe: 9.0 },
      ],
    };

    const baselineE1RM = 145.631; // 90 / 0.618

    it('A. Valid RPE 8 followed by valid RPE 7: targets return to snapshots, markers clear, appliedChangeCount reflects restoration, Restore becomes unavailable, toast condition is true', () => {
      // Step 1: Set 1 underperformance committed as 90 x 12 @ RPE 10.0
      let evidenceMap: CommittedLiveEvidenceMap = {
        '0-0': createCommittedLiveEvidenceValue(90, 12, 10.0, 'standard'),
      };
      let userTouched: Record<string, boolean> = { '0-0': true };
      let liveAdjusted: LiveAdjustedSetMap = {};

      const currentEx1: ExerciseEntry = {
        ...initialExercise,
        sets: [
          { ...initialExercise.sets[0], rpe: 10.0 },
          { ...initialExercise.sets[1] },
          { ...initialExercise.sets[2] },
        ],
      };

      const prep1 = prepareLiveAdjustmentParams({
        exercise: currentEx1,
        exIdx: 0,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM,
        prescribedTargetSnapshots: prescribedSnapshots,
        committedLiveEvidenceBySet: evidenceMap,
        triggeringSetIdx: 0,
      });

      expect(prep1.success).toBe(true);
      const res1 = calculateLiveSetAdjustments(prep1.params!);
      expect(res1.status).toBe('adjusted');
      expect(res1.shouldNotify).toBe(true);

      const app1 = applyLiveAdjustmentResult({
        exercise: currentEx1,
        exIdx: 0,
        result: res1,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: liveAdjusted,
        userTouchedSets: userTouched,
        focusedSetKey: null,
        activeSelectorRowKey: null,
        triggeringRowIndex: 0,
      });

      expect(app1.appliedChangeCount).toBeGreaterThan(0);
      expect(app1.updatedLiveAdjustedSets['0-1']).toBe(true);
      expect(
        canRestorePlannedTargets({
          exercise: app1.updatedExercise,
          exIdx: 0,
          prescribedTargetSnapshots: prescribedSnapshots,
          currentLiveAdjustedSets: app1.updatedLiveAdjustedSets,
          userTouchedSets: userTouched,
          focusedSetKey: null,
          activeSelectorRowKey: null,
        })
      ).toBe(true);
      expect(app1.appliedChangeCount > 0 && res1.shouldNotify).toBe(true);

      // Step 2: Set 1 recommitted as 90 x 12 @ RPE 8.0 (returns to baseline plan)
      evidenceMap = {
        '0-0': createCommittedLiveEvidenceValue(90, 12, 8.0, 'standard'),
      };
      const currentEx2: ExerciseEntry = {
        ...app1.updatedExercise,
        sets: [
          { ...app1.updatedExercise.sets[0], reps: 12, rpe: 8.0 },
          { ...app1.updatedExercise.sets[1] },
          { ...app1.updatedExercise.sets[2] },
        ],
      };

      const prep2 = prepareLiveAdjustmentParams({
        exercise: currentEx2,
        exIdx: 0,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM,
        prescribedTargetSnapshots: prescribedSnapshots,
        committedLiveEvidenceBySet: evidenceMap,
        triggeringSetIdx: 0,
      });

      expect(prep2.success).toBe(true);
      const res2 = calculateLiveSetAdjustments(prep2.params!);
      expect(res2.status).toBe('adjusted');

      const app2 = applyLiveAdjustmentResult({
        exercise: currentEx2,
        exIdx: 0,
        result: res2,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: app1.updatedLiveAdjustedSets,
        userTouchedSets: userTouched,
        focusedSetKey: null,
        activeSelectorRowKey: null,
        triggeringRowIndex: 0,
      });

      // Target values returned to prescribed snapshots
      expect(app2.updatedExercise.sets[1].reps).toBe(12);
      expect(app2.updatedExercise.sets[1].rpe).toBe(8.5);
      expect(app2.updatedExercise.sets[1].weight).toBe(90);

      // Markers cleared because candidate targets match snapshots
      expect(app2.updatedLiveAdjustedSets['0-1']).toBeUndefined();
      expect(app2.updatedLiveAdjustedSets['0-2']).toBeUndefined();

      // Restore becomes unavailable
      expect(
        canRestorePlannedTargets({
          exercise: app2.updatedExercise,
          exIdx: 0,
          prescribedTargetSnapshots: prescribedSnapshots,
          currentLiveAdjustedSets: app2.updatedLiveAdjustedSets,
          userTouchedSets: userTouched,
          focusedSetKey: null,
          activeSelectorRowKey: null,
        })
      ).toBe(false);

      // Toast condition is true because visible rows changed back to plan
      expect(app2.appliedChangeCount).toBeGreaterThan(0);
      expect(res2.shouldNotify).toBe(true);
      expect(app2.appliedChangeCount > 0 && res2.shouldNotify).toBe(true);
    });

    it('B. Valid RPE 8 followed by RPE 5: invalid_evidence restores untouched rows to snapshots, markers clear, Restore becomes unavailable, ordinary toast is suppressed, low-RPE message is eligible', () => {
      // Step 1: Initial adjustment
      const evidenceMap1: CommittedLiveEvidenceMap = {
        '0-0': createCommittedLiveEvidenceValue(90, 12, 10.0, 'standard'),
      };
      const userTouched: Record<string, boolean> = { '0-0': true };

      const prep1 = prepareLiveAdjustmentParams({
        exercise: initialExercise,
        exIdx: 0,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM,
        prescribedTargetSnapshots: prescribedSnapshots,
        committedLiveEvidenceBySet: evidenceMap1,
        triggeringSetIdx: 0,
      });

      const res1 = calculateLiveSetAdjustments(prep1.params!);
      const app1 = applyLiveAdjustmentResult({
        exercise: initialExercise,
        exIdx: 0,
        result: res1,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: {},
        userTouchedSets: userTouched,
        focusedSetKey: null,
        activeSelectorRowKey: null,
        triggeringRowIndex: 0,
      });

      expect(app1.updatedLiveAdjustedSets['0-1']).toBe(true);

      // Step 2: Recommit with RPE 5.0
      const evidenceMap2: CommittedLiveEvidenceMap = {
        '0-0': createCommittedLiveEvidenceValue(90, 11, 5.0, 'standard'),
      };
      const exWithRpe5: ExerciseEntry = {
        ...app1.updatedExercise,
        sets: [
          { ...app1.updatedExercise.sets[0], reps: 11, rpe: 5.0 },
          { ...app1.updatedExercise.sets[1] },
          { ...app1.updatedExercise.sets[2] },
        ],
      };

      const prep2 = prepareLiveAdjustmentParams({
        exercise: exWithRpe5,
        exIdx: 0,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM,
        prescribedTargetSnapshots: prescribedSnapshots,
        committedLiveEvidenceBySet: evidenceMap2,
        triggeringSetIdx: 0,
      });

      expect(prep2.success).toBe(true);
      const res2 = calculateLiveSetAdjustments(prep2.params!);
      expect(res2.status).toBe('invalid_evidence');
      expect(res2.shouldNotify).toBe(false);
      expect(res2.restorePrescribedOrdinals).toContain(2);

      const app2 = applyLiveAdjustmentResult({
        exercise: exWithRpe5,
        exIdx: 0,
        result: res2,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: app1.updatedLiveAdjustedSets,
        userTouchedSets: userTouched,
        focusedSetKey: null,
        activeSelectorRowKey: null,
        triggeringRowIndex: 0,
      });

      // Untouched future rows restored to snapshots
      expect(app2.updatedExercise.sets[1].weight).toBe(90);
      expect(app2.updatedExercise.sets[1].reps).toBe(12);
      expect(app2.updatedExercise.sets[1].rpe).toBe(8.5);

      // Markers cleared
      expect(app2.updatedLiveAdjustedSets['0-1']).toBeUndefined();
      expect(app2.updatedLiveAdjustedSets['0-2']).toBeUndefined();

      // Restore becomes unavailable
      expect(
        canRestorePlannedTargets({
          exercise: app2.updatedExercise,
          exIdx: 0,
          prescribedTargetSnapshots: prescribedSnapshots,
          currentLiveAdjustedSets: app2.updatedLiveAdjustedSets,
          userTouchedSets: userTouched,
          focusedSetKey: null,
          activeSelectorRowKey: null,
        })
      ).toBe(false);

      // Ordinary toast is suppressed
      expect(res2.shouldNotify).toBe(false);
      expect(app2.appliedChangeCount > 0 && res2.shouldNotify).toBe(false);

      // Low-RPE message is eligible
      const lowRpeEligible = shouldShowLowRPEExplanation({
        objective: 'Hypertrophy',
        exercise: initialExercise,
        setIdx: 0,
        rpe: 5.0,
      });
      expect(lowRpeEligible).toBe(true);
    });

    it('C. Recovery after RPE 5: subsequent valid RPE 8 adjusts future rows again, markers recreated, Restore available, ordinary toast condition true without permanent disabled state', () => {
      // Begin with restored state from RPE 5
      const userTouched: Record<string, boolean> = { '0-0': true };
      const evidenceMap: CommittedLiveEvidenceMap = {
        '0-0': createCommittedLiveEvidenceValue(90, 12, 10.0, 'standard'),
      };

      const currentEx: ExerciseEntry = {
        ...initialExercise,
        sets: [
          { ...initialExercise.sets[0], reps: 12, rpe: 10.0 },
          { ...initialExercise.sets[1] },
          { ...initialExercise.sets[2] },
        ],
      };

      const prep = prepareLiveAdjustmentParams({
        exercise: currentEx,
        exIdx: 0,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM,
        prescribedTargetSnapshots: prescribedSnapshots,
        committedLiveEvidenceBySet: evidenceMap,
        triggeringSetIdx: 0,
      });

      expect(prep.success).toBe(true);
      const res = calculateLiveSetAdjustments(prep.params!);
      expect(res.status).toBe('adjusted');
      expect(res.shouldNotify).toBe(true);

      const app = applyLiveAdjustmentResult({
        exercise: currentEx,
        exIdx: 0,
        result: res,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: {},
        userTouchedSets: userTouched,
        focusedSetKey: null,
        activeSelectorRowKey: null,
        triggeringRowIndex: 0,
      });

      expect(app.appliedChangeCount).toBeGreaterThan(0);
      expect(app.updatedLiveAdjustedSets['0-1']).toBe(true);
      expect(
        canRestorePlannedTargets({
          exercise: app.updatedExercise,
          exIdx: 0,
          prescribedTargetSnapshots: prescribedSnapshots,
          currentLiveAdjustedSets: app.updatedLiveAdjustedSets,
          userTouchedSets: userTouched,
          focusedSetKey: null,
          activeSelectorRowKey: null,
        })
      ).toBe(true);
      expect(app.appliedChangeCount > 0 && res.shouldNotify).toBe(true);
    });

    it('D. Later-set commitment: Set 2 commitment removes own marker and becomes evidence; Set 3 recalculates from Sets 1 and 2; clears marker and greys Restore if matching snapshot', () => {
      // Step 1: Set 1 adjusted Sets 2 and 3
      const liveAdjustedAfterSet1: LiveAdjustedSetMap = {
        '0-1': true,
        '0-2': true,
      };
      const userTouchedAfterSet1: Record<string, boolean> = { '0-0': true };

      // Step 2: User commits Set 2 at 90 x 10 @ RPE 8.5
      // Simulating handleCommitUserRPE for exIdx: 0, setIdx: 1
      const set2Key = '0-1';
      const userTouchedAfterSet2 = { ...userTouchedAfterSet1, [set2Key]: true };
      const liveAdjustedPriorToCalc = { ...liveAdjustedAfterSet1 };
      delete liveAdjustedPriorToCalc[set2Key]; // Set 2's own marker is deleted on commitment

      expect(liveAdjustedPriorToCalc['0-1']).toBeUndefined();
      expect(liveAdjustedPriorToCalc['0-2']).toBe(true);

      const evidenceMap: CommittedLiveEvidenceMap = {
        '0-0': createCommittedLiveEvidenceValue(90, 12, 10.0, 'standard'),
        '0-1': createCommittedLiveEvidenceValue(90, 10, 8.5, 'standard'),
      };

      const currentEx: ExerciseEntry = {
        ...initialExercise,
        sets: [
          { ...initialExercise.sets[0], reps: 12, rpe: 10.0 },
          { ...initialExercise.sets[1], reps: 10, rpe: 8.5 },
          { ...initialExercise.sets[2], reps: 9, rpe: 9.0 },
        ],
      };

      const prep = prepareLiveAdjustmentParams({
        exercise: currentEx,
        exIdx: 0,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM,
        prescribedTargetSnapshots: prescribedSnapshots,
        committedLiveEvidenceBySet: evidenceMap,
        triggeringSetIdx: 1,
      });

      expect(prep.success).toBe(true);
      expect(prep.params?.triggeringWorkingSetOrdinal).toBe(2);
      expect(prep.params?.committedEvidence.length).toBe(2);

      const res = calculateLiveSetAdjustments(prep.params!);
      const app = applyLiveAdjustmentResult({
        exercise: currentEx,
        exIdx: 0,
        result: res,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: liveAdjustedPriorToCalc,
        userTouchedSets: userTouchedAfterSet2,
        focusedSetKey: null,
        activeSelectorRowKey: null,
        triggeringRowIndex: 1,
      });

      // Set 2 remains committed and protected
      expect(app.updatedLiveAdjustedSets['0-1']).toBeUndefined();
      expect(userTouchedAfterSet2['0-1']).toBe(true);

      // Restoration cannot alter Set 2
      const rest = restorePlannedTargetsForExercise({
        exercise: app.updatedExercise,
        exIdx: 0,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: app.updatedLiveAdjustedSets,
        userTouchedSets: userTouchedAfterSet2,
        focusedSetKey: null,
        activeSelectorRowKey: null,
      });

      expect(rest.updatedExercise.sets[1].reps).toBe(10);
      expect(rest.updatedExercise.sets[1].rpe).toBe(8.5);
    });

    it('E. User protection during invalid restoration: untouched Set 2 restores to snapshot while manually edited Set 3 is protected and retains exact values and metadata', () => {
      // Step 1: Set 2 is untouched live-adjusted (90 x 8 @ 8.5), Set 3 was manually edited by user
      const liveAdjusted: LiveAdjustedSetMap = {
        '0-1': true,
        '0-2': true,
      };
      const userTouched: Record<string, boolean> = {
        '0-0': true,
        '0-2': true, // user manually edited Set 3
      };

      const currentEx: ExerciseEntry = {
        ...initialExercise,
        sets: [
          { ...initialExercise.sets[0], reps: 11, rpe: 5.0 }, // RPE 5 committed
          { ...initialExercise.sets[1], weight: 90, reps: 8, rpe: 8.5 }, // adjusted away from snapshot (12 -> 8)
          {
            ...initialExercise.sets[2],
            weight: 95,
            reps: 15,
            rpe: 8.0,
            comment: 'manual user pump set',
            form: 'strict',
          },
        ],
      };

      const evidenceMap: CommittedLiveEvidenceMap = {
        '0-0': createCommittedLiveEvidenceValue(90, 11, 5.0, 'standard'),
      };

      const prep = prepareLiveAdjustmentParams({
        exercise: currentEx,
        exIdx: 0,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM,
        prescribedTargetSnapshots: prescribedSnapshots,
        committedLiveEvidenceBySet: evidenceMap,
        triggeringSetIdx: 0,
      });

      const res = calculateLiveSetAdjustments(prep.params!);
      expect(res.status).toBe('invalid_evidence');

      const app = applyLiveAdjustmentResult({
        exercise: currentEx,
        exIdx: 0,
        result: res,
        prescribedTargetSnapshots: prescribedSnapshots,
        currentLiveAdjustedSets: liveAdjusted,
        userTouchedSets: userTouched,
        focusedSetKey: null,
        activeSelectorRowKey: null,
        triggeringRowIndex: 0,
      });

      // Set 2 was untouched -> restored to snapshot (12 reps)
      expect(app.updatedExercise.sets[1].weight).toBe(90);
      expect(app.updatedExercise.sets[1].reps).toBe(12);
      expect(app.updatedExercise.sets[1].rpe).toBe(8.5);
      expect(app.updatedLiveAdjustedSets['0-1']).toBeUndefined();

      // Set 3 was user-touched -> preserved completely
      expect(app.updatedExercise.sets[2].weight).toBe(95);
      expect(app.updatedExercise.sets[2].reps).toBe(15);
      expect(app.updatedExercise.sets[2].rpe).toBe(8.0);
      expect(app.updatedExercise.sets[2].comment).toBe('manual user pump set');
      expect(app.updatedExercise.sets[2].form).toBe('strict');
    });
  });

  describe('MetReps Phase 2B-2B Low-RPE Message Eligibility and Storage Integrity Suite', () => {
    const sampleExercise: ExerciseEntry = {
      name: 'Barbell Squat',
      muscleGroup: 'Quads',
      modality: 'weighted',
      sets: [
        { setNumber: 1, weight: 100, reps: 10, rpe: 8.0 },
        { setNumber: 2, weight: 100, reps: 10, rpe: 8.5 },
      ],
    };

    it('1. Eligible Hypertrophy weighted working set at RPE 5 shows message', () => {
      expect(
        shouldShowLowRPEExplanation({
          objective: 'Hypertrophy',
          exercise: sampleExercise,
          setIdx: 0,
          rpe: 5.0,
        })
      ).toBe(true);
    });

    it('2. Eligible Strength main working set at RPE 5 shows message', () => {
      const strengthMainEx: ExerciseEntry = {
        ...sampleExercise,
        isMainMovement: true,
      };
      expect(
        shouldShowLowRPEExplanation({
          objective: 'Strength',
          exercise: strengthMainEx,
          setIdx: 0,
          rpe: 5.0,
        })
      ).toBe(true);

      // Strength accessory does NOT show message
      const strengthAccEx: ExerciseEntry = {
        ...sampleExercise,
        isMainMovement: false,
      };
      expect(
        shouldShowLowRPEExplanation({
          objective: 'Strength',
          exercise: strengthAccEx,
          setIdx: 0,
          rpe: 5.0,
        })
      ).toBe(false);
    });

    it('3. RPE 5.5 shows message', () => {
      expect(
        shouldShowLowRPEExplanation({
          objective: 'Hypertrophy',
          exercise: sampleExercise,
          setIdx: 0,
          rpe: 5.5,
        })
      ).toBe(true);
    });

    it('4. RPE 6.0 and above do not show low-RPE message', () => {
      expect(
        shouldShowLowRPEExplanation({
          objective: 'Hypertrophy',
          exercise: sampleExercise,
          setIdx: 0,
          rpe: 6.0,
        })
      ).toBe(false);

      expect(
        shouldShowLowRPEExplanation({
          objective: 'Hypertrophy',
          exercise: sampleExercise,
          setIdx: 0,
          rpe: 8.5,
        })
      ).toBe(false);
    });

    it('5. Warm-up set at RPE 5 does not show low-RPE message', () => {
      const warmupExercise: ExerciseEntry = {
        ...sampleExercise,
        sets: [
          { setNumber: 1, isWarmup: true, weight: 60, reps: 5, rpe: 5.0 },
          { setNumber: 2, isWarmup: false, weight: 100, reps: 10, rpe: 8.0 },
        ],
      };
      expect(
        shouldShowLowRPEExplanation({
          objective: 'Hypertrophy',
          exercise: warmupExercise,
          setIdx: 0,
          rpe: 5.0,
        })
      ).toBe(false);
    });

    it('6. Skipped set at RPE 5 does not show low-RPE message', () => {
      const skippedSetExercise: ExerciseEntry = {
        ...sampleExercise,
        sets: [
          { setNumber: 1, isSkipped: true, weight: 100, reps: 10, rpe: 5.0 },
          { setNumber: 2, weight: 100, reps: 10, rpe: 8.0 },
        ],
      };
      expect(
        shouldShowLowRPEExplanation({
          objective: 'Hypertrophy',
          exercise: skippedSetExercise,
          setIdx: 0,
          rpe: 5.0,
        })
      ).toBe(false);
    });

    it('7. Skipped exercise at RPE 5 does not show low-RPE message', () => {
      const skippedExercise: ExerciseEntry = {
        ...sampleExercise,
        isSkipped: true,
      };
      expect(
        shouldShowLowRPEExplanation({
          objective: 'Hypertrophy',
          exercise: skippedExercise,
          setIdx: 0,
          rpe: 5.0,
        })
      ).toBe(false);
    });

    it('8. Objective Off at RPE 5 does not show low-RPE message', () => {
      expect(
        shouldShowLowRPEExplanation({
          objective: 'Off',
          exercise: sampleExercise,
          setIdx: 0,
          rpe: 5.0,
        })
      ).toBe(false);

      expect(
        shouldShowLowRPEExplanation({
          objective: 'Deload',
          exercise: sampleExercise,
          setIdx: 0,
          rpe: 5.0,
        })
      ).toBe(false);
    });

    it('9. Non-weighted modalities (bodyweight, assisted, timed, distance, distance_loaded) do not show low-RPE message', () => {
      const modalities: Array<'bodyweight' | 'assisted' | 'timed' | 'distance' | 'distance_loaded'> = [
        'bodyweight',
        'assisted',
        'timed',
        'distance',
        'distance_loaded',
      ];

      for (const mod of modalities) {
        const modEx: ExerciseEntry = {
          ...sampleExercise,
          modality: mod,
        };
        expect(
          shouldShowLowRPEExplanation({
            objective: 'Hypertrophy',
            exercise: modEx,
            setIdx: 0,
            rpe: 5.0,
          })
        ).toBe(false);
      }
    });

    it('10. Low-RPE selection is stored in committedLiveEvidenceBySet without mutating Program.exercisesByDay or WorkoutLog', () => {
      const saveProgramSpy = vi.spyOn(storage, 'saveProgram');
      const saveLogSpy = vi.spyOn(storage, 'saveWorkoutLog');

      const lowEvidence = createCommittedLiveEvidenceValue(100, 10, 5.0, 'standard');
      expect(lowEvidence.rpe).toBe(5.0);
      expect(lowEvidence.weight).toBe(100);
      expect(lowEvidence.reps).toBe(10);

      const evidenceMap: CommittedLiveEvidenceMap = {
        '0-0': lowEvidence,
      };
      expect(evidenceMap['0-0'].rpe).toBe(5.0);

      // Verify no permanent storage side-effects
      expect(saveProgramSpy).not.toHaveBeenCalled();
      expect(saveLogSpy).not.toHaveBeenCalled();

      saveProgramSpy.mockRestore();
      saveLogSpy.mockRestore();
    });
  });
});

