import { describe, it, expect, vi } from 'vitest';
import {
  orchestrateGuidedWorkoutExercises,
  type GuidedWorkoutIntegrationContext,
  type GuidedWorkoutIntegrationItem,
} from '../guidedWorkoutIntegration';
import {
  orchestrateGuidedExercisePrescription,
  type OrchestrateGuidedExerciseInput,
  type OrchestratedExerciseResult,
  type ExerciseLifecycleEvidence,
} from '../guidedWorkoutOrchestrator';
import type { ExerciseEntry, Program, WorkoutLog, SetEntry } from '../../types';
import {
  CURRENT_ALGORITHM_VERSION,
  CURRENT_PRESCRIPTION_SNAPSHOT_VERSION,
  CURRENT_PROGRESSION_POLICY_VERSION,
} from '../programProgressionMode';
import type { ActivePrescriptionBoundary } from '../workoutDraftBoundary';
import type { GuidedSelectorDiagnostics } from '../guidedTargetSelector';

function makeTestExercise(overrides?: Partial<ExerciseEntry>): ExerciseEntry {
  return {
    exerciseKey: 'bench_press',
    name: 'Barbell Bench Press',
    modality: 'weighted',
    muscleGroup: 'Chest',
    isMainMovement: true,
    sets: [
      { setNumber: 1, weight: 100, reps: 8, rpe: 8, isCompleted: false },
      { setNumber: 2, weight: 100, reps: 8, rpe: 8, isCompleted: false },
      { setNumber: 3, weight: 100, reps: 8, rpe: 8, isCompleted: false },
    ],
    ...overrides,
  };
}

function makeTestBoundary(): ActivePrescriptionBoundary {
  return {
    sessionStartedAt: 1773129600000,
    prescriptionTargetDate: '2026-03-10',
  };
}

function makeTestDiagnostics(): GuidedSelectorDiagnostics {
  return {
    comparableLaneKey: 'bench_press:weighted:main_movement:hypertrophy_linear:sets-3:linear_standard',
    narrowHistoryStatus: 'success',
    broadHistoryStatus: 'success',
    adherenceGateOpen: true,
    gateReady: true,
    successCredit: 1,
    laneReplayTrustStatus: 'trusted',
    laneReplayNextAction: 'advance',
    candidateComparisonInvoked: true,
    candidateComparisonStatus: 'accepted',
    evaluatedOrdinals: [1],
    activeNudgeOrdinal: 1,
    challengeCapExempt: false,
  };
}

function createDummyContext(overrides?: Partial<GuidedWorkoutIntegrationContext>): GuidedWorkoutIntegrationContext {
  return {
    program: null,
    programs: [],
    historicalLogs: [],
    boundary: makeTestBoundary(),
    sessionKind: { type: 'active_program_session', weekNum: 1, scheduledDate: '2026-03-10' },
    activeUnit: 'kg',
    bodyweightSnapshot: null,
    objective: 'Hypertrophy',
    weekNum: 1,
    programDuration: 4,
    dayNum: 1,
    targetDate: '2026-03-10',
    targetLogId: null,
    ...overrides,
  };
}

describe('guidedWorkoutIntegration (Injected Isolation Tests)', () => {
  it('1. empty item collection returns an empty result and performs zero calls', () => {
    const mockOrchestrator = vi.fn();
    const context = createDummyContext();

    const result = orchestrateGuidedWorkoutExercises({
      context,
      items: [],
      orchestrateExerciseFn: mockOrchestrator,
    });

    expect(result).toEqual([]);
    expect(mockOrchestrator).not.toHaveBeenCalled();
  });

  it('2. single item is passed to the orchestrator exactly once', () => {
    const mockResult: OrchestratedExerciseResult = {
      status: 'preserved_unchanged',
      exercise: makeTestExercise(),
      appliedSets: [],
      lifecycleState: 'active_committed',
      nextEvaluationState: { status: 'not_evaluated' },
      bundleCalculated: false,
      adapterCalled: false,
    };
    const mockOrchestrator = vi.fn().mockReturnValue(mockResult);

    const context = createDummyContext();
    const item: GuidedWorkoutIntegrationItem = {
      exercise: makeTestExercise(),
      exerciseIndex: 0,
      lifecycleEvidence: {
        originProvenance: 'session_template_init',
        isHistoricalEdit: false,
        isRedoSession: false,
        isRestoredFromDraft: false,
        evaluationState: { status: 'not_evaluated' },
      },
    };

    const output = orchestrateGuidedWorkoutExercises({
      context,
      items: [item],
      orchestrateExerciseFn: mockOrchestrator,
    });

    expect(mockOrchestrator).toHaveBeenCalledTimes(1);
    expect(output).toHaveLength(1);
    expect(output[0].exerciseIndex).toBe(0);
    expect(output[0].result).toBe(mockResult);
  });

  it('3. multiple items are processed exactly once each', () => {
    const mockOrchestrator = vi.fn().mockImplementation((input: OrchestrateGuidedExerciseInput): OrchestratedExerciseResult => ({
      status: 'preserved_unchanged',
      exercise: input.exercise,
      appliedSets: [],
      lifecycleState: 'already_evaluated',
      nextEvaluationState: { status: 'not_evaluated' },
      bundleCalculated: false,
      adapterCalled: false,
    }));

    const context = createDummyContext();
    const items: GuidedWorkoutIntegrationItem[] = [
      {
        exercise: makeTestExercise({ name: 'Squat', exerciseKey: 'squat' }),
        exerciseIndex: 0,
        lifecycleEvidence: {
          originProvenance: 'session_template_init',
          isHistoricalEdit: false,
          isRedoSession: false,
          isRestoredFromDraft: false,
          evaluationState: { status: 'not_evaluated' },
        },
      },
      {
        exercise: makeTestExercise({ name: 'Bench Press', exerciseKey: 'bench_press' }),
        exerciseIndex: 1,
        lifecycleEvidence: {
          originProvenance: 'session_template_init',
          isHistoricalEdit: false,
          isRedoSession: false,
          isRestoredFromDraft: false,
          evaluationState: { status: 'not_evaluated' },
        },
      },
      {
        exercise: makeTestExercise({ name: 'Deadlift', exerciseKey: 'deadlift' }),
        exerciseIndex: 2,
        lifecycleEvidence: {
          originProvenance: 'session_template_init',
          isHistoricalEdit: false,
          isRedoSession: false,
          isRestoredFromDraft: false,
          evaluationState: { status: 'not_evaluated' },
        },
      },
    ];

    const output = orchestrateGuidedWorkoutExercises({
      context,
      items,
      orchestrateExerciseFn: mockOrchestrator,
    });

    expect(mockOrchestrator).toHaveBeenCalledTimes(3);
    expect(output).toHaveLength(3);
  });

  it('4. output order matches input order', () => {
    const mockOrchestrator = vi.fn().mockImplementation((input: OrchestrateGuidedExerciseInput): OrchestratedExerciseResult => ({
      status: 'preserved_unchanged',
      exercise: input.exercise,
      appliedSets: [],
      lifecycleState: 'already_evaluated',
      nextEvaluationState: { status: 'not_evaluated' },
      bundleCalculated: false,
      adapterCalled: false,
    }));

    const context = createDummyContext();
    const items: GuidedWorkoutIntegrationItem[] = [
      {
        exercise: makeTestExercise({ name: 'First Exercise' }),
        exerciseIndex: 5,
        lifecycleEvidence: {
          originProvenance: 'user_added_library',
          isHistoricalEdit: false,
          isRedoSession: false,
          isRestoredFromDraft: false,
          evaluationState: { status: 'not_evaluated' },
        },
      },
      {
        exercise: makeTestExercise({ name: 'Second Exercise' }),
        exerciseIndex: 2,
        lifecycleEvidence: {
          originProvenance: 'user_added_library',
          isHistoricalEdit: false,
          isRedoSession: false,
          isRestoredFromDraft: false,
          evaluationState: { status: 'not_evaluated' },
        },
      },
    ];

    const output = orchestrateGuidedWorkoutExercises({
      context,
      items,
      orchestrateExerciseFn: mockOrchestrator,
    });

    expect(output[0].exerciseIndex).toBe(5);
    expect(output[0].result.exercise.name).toBe('First Exercise');
    expect(output[1].exerciseIndex).toBe(2);
    expect(output[1].result.exercise.name).toBe('Second Exercise');
  });

  it('5. each output retains its corresponding exerciseIndex', () => {
    const mockOrchestrator = vi.fn().mockReturnValue({
      status: 'preserved_unchanged',
      exercise: makeTestExercise(),
      appliedSets: [],
      lifecycleState: 'already_evaluated',
      nextEvaluationState: { status: 'not_evaluated' },
      bundleCalculated: false,
      adapterCalled: false,
    } as OrchestratedExerciseResult);

    const context = createDummyContext();
    const items: GuidedWorkoutIntegrationItem[] = [
      {
        exercise: makeTestExercise({ name: 'Ex A' }),
        exerciseIndex: 10,
        lifecycleEvidence: {
          originProvenance: 'session_template_init',
          isHistoricalEdit: false,
          isRedoSession: false,
          isRestoredFromDraft: false,
          evaluationState: { status: 'not_evaluated' },
        },
      },
    ];

    const output = orchestrateGuidedWorkoutExercises({
      context,
      items,
      orchestrateExerciseFn: mockOrchestrator,
    });

    expect(output[0].exerciseIndex).toBe(10);
  });

  it('6. lifecycleEvidence.exerciseIndex is derived from the item’s exerciseIndex', () => {
    let capturedEvidence: ExerciseLifecycleEvidence | null = null;
    const mockOrchestrator = vi.fn().mockImplementation((input: OrchestrateGuidedExerciseInput): OrchestratedExerciseResult => {
      capturedEvidence = input.lifecycleEvidence;
      return {
        status: 'preserved_unchanged',
        exercise: input.exercise,
        appliedSets: [],
        lifecycleState: 'already_evaluated',
        nextEvaluationState: { status: 'not_evaluated' },
        bundleCalculated: false,
        adapterCalled: false,
      };
    });

    const context = createDummyContext();
    const item: GuidedWorkoutIntegrationItem = {
      exercise: makeTestExercise(),
      exerciseIndex: 7,
      lifecycleEvidence: {
        originProvenance: 'session_template_init',
        isHistoricalEdit: false,
        isRedoSession: false,
        isRestoredFromDraft: false,
        evaluationState: { status: 'not_evaluated' },
      },
    };

    orchestrateGuidedWorkoutExercises({
      context,
      items: [item],
      orchestrateExerciseFn: mockOrchestrator,
    });

    expect(capturedEvidence).not.toBeNull();
    expect(capturedEvidence!.exerciseIndex).toBe(7);
  });

  it('7. compile-time assertion: the caller cannot supply exerciseIndex inside item.lifecycleEvidence', () => {
    const item: GuidedWorkoutIntegrationItem = {
      exercise: makeTestExercise(),
      exerciseIndex: 3,
      lifecycleEvidence: {
        originProvenance: 'session_template_init',
        isHistoricalEdit: false,
        isRedoSession: false,
        isRestoredFromDraft: false,
        evaluationState: { status: 'not_evaluated' },
        // @ts-expect-error exerciseIndex is omitted from GuidedWorkoutIntegrationLifecycleEvidence
        exerciseIndex: 999,
      },
    };

    expect(item.exerciseIndex).toBe(3);
  });

  it('8. shared session context is forwarded without rewriting values', () => {
    let capturedInput: OrchestrateGuidedExerciseInput | null = null;
    const mockOrchestrator = vi.fn().mockImplementation((input: OrchestrateGuidedExerciseInput): OrchestratedExerciseResult => {
      capturedInput = input;
      return {
        status: 'preserved_unchanged',
        exercise: input.exercise,
        appliedSets: [],
        lifecycleState: 'already_evaluated',
        nextEvaluationState: { status: 'not_evaluated' },
        bundleCalculated: false,
        adapterCalled: false,
      };
    });

    const boundary = makeTestBoundary();
    const context: GuidedWorkoutIntegrationContext = {
      program: {
        id: 'prog-1',
        name: 'Prog 1',
        daysPerWeek: 3,
        programDuration: 4,
        createdAt: '2026-01-01',
        exercisesByDay: {},
        algorithmId: 'hypertrophy_linear',
        objective: 'Hypertrophy',
      },
      programs: [],
      historicalLogs: [],
      boundary,
      sessionKind: { type: 'active_program_session', weekNum: 4, scheduledDate: '2026-03-05' },
      activeUnit: 'lb',
      bodyweightSnapshot: { value: 75, unit: 'kg', timestamp: '2026-03-01T11:00:00.000Z' },
      objective: 'Strength',
      weekNum: 4,
      programDuration: 12,
      dayNum: 3,
      targetDate: '2026-03-05',
      targetLogId: 'custom-target-id',
    };

    const item: GuidedWorkoutIntegrationItem = {
      exercise: makeTestExercise(),
      exerciseIndex: 1,
      lifecycleEvidence: {
        originProvenance: 'session_template_init',
        isHistoricalEdit: false,
        isRedoSession: false,
        isRestoredFromDraft: false,
        evaluationState: { status: 'not_evaluated' },
      },
    };

    orchestrateGuidedWorkoutExercises({
      context,
      items: [item],
      orchestrateExerciseFn: mockOrchestrator,
    });

    expect(capturedInput).not.toBeNull();
    expect(capturedInput!.activeUnit).toBe('lb');
    expect(capturedInput!.objective).toBe('Strength');
    expect(capturedInput!.weekNum).toBe(4);
    expect(capturedInput!.programDuration).toBe(12);
    expect(capturedInput!.dayNum).toBe(3);
    expect(capturedInput!.targetDate).toBe('2026-03-05');
    expect(capturedInput!.targetLogId).toBe('custom-target-id');
    expect(capturedInput!.boundary).toBe(boundary);
  });

  it('9. each item’s templateExercise is forwarded independently', () => {
    const capturedTemplates: (ExerciseEntry | undefined)[] = [];
    const mockOrchestrator = vi.fn().mockImplementation((input: OrchestrateGuidedExerciseInput): OrchestratedExerciseResult => {
      capturedTemplates.push(input.templateExercise);
      return {
        status: 'preserved_unchanged',
        exercise: input.exercise,
        appliedSets: [],
        lifecycleState: 'already_evaluated',
        nextEvaluationState: { status: 'not_evaluated' },
        bundleCalculated: false,
        adapterCalled: false,
      };
    });

    const context = createDummyContext();
    const tmplA = makeTestExercise({ name: 'Template A' });
    const tmplB = makeTestExercise({ name: 'Template B' });

    const items: GuidedWorkoutIntegrationItem[] = [
      {
        exercise: makeTestExercise({ name: 'Ex 1' }),
        exerciseIndex: 0,
        templateExercise: tmplA,
        lifecycleEvidence: {
          originProvenance: 'session_template_init',
          isHistoricalEdit: false,
          isRedoSession: false,
          isRestoredFromDraft: false,
          evaluationState: { status: 'not_evaluated' },
        },
      },
      {
        exercise: makeTestExercise({ name: 'Ex 2' }),
        exerciseIndex: 1,
        templateExercise: tmplB,
        lifecycleEvidence: {
          originProvenance: 'session_template_init',
          isHistoricalEdit: false,
          isRedoSession: false,
          isRestoredFromDraft: false,
          evaluationState: { status: 'not_evaluated' },
        },
      },
      {
        exercise: makeTestExercise({ name: 'Ex 3' }),
        exerciseIndex: 2,
        // templateExercise omitted
        lifecycleEvidence: {
          originProvenance: 'user_added_library',
          isHistoricalEdit: false,
          isRedoSession: false,
          isRestoredFromDraft: false,
          evaluationState: { status: 'not_evaluated' },
        },
      },
    ];

    orchestrateGuidedWorkoutExercises({
      context,
      items,
      orchestrateExerciseFn: mockOrchestrator,
    });

    expect(capturedTemplates).toHaveLength(3);
    expect(capturedTemplates[0]?.name).toBe('Template A');
    expect(capturedTemplates[1]?.name).toBe('Template B');
    expect(capturedTemplates[2]).toBeUndefined();
  });

  it('10. input exercises, sets, snapshots, context, and lifecycle evidence are not mutated', () => {
    const exercise = makeTestExercise();
    const originalExerciseFrozen = JSON.parse(JSON.stringify(exercise));

    const lifecycleEvidence = {
      originProvenance: 'session_template_init' as const,
      isHistoricalEdit: false,
      isRedoSession: false,
      isRestoredFromDraft: false,
      evaluationState: { status: 'not_evaluated' as const },
    };
    const originalEvidenceFrozen = JSON.parse(JSON.stringify(lifecycleEvidence));

    const context = createDummyContext();
    const originalContextFrozen = JSON.parse(JSON.stringify(context));

    const mockOrchestrator = vi.fn().mockImplementation((input: OrchestrateGuidedExerciseInput): OrchestratedExerciseResult => {
      return {
        status: 'preserved_unchanged',
        exercise: input.exercise,
        appliedSets: input.exercise.sets,
        lifecycleState: 'already_evaluated',
        nextEvaluationState: { status: 'not_evaluated' },
        bundleCalculated: false,
        adapterCalled: false,
      };
    });

    orchestrateGuidedWorkoutExercises({
      context,
      items: [{ exercise, exerciseIndex: 0, lifecycleEvidence }],
      orchestrateExerciseFn: mockOrchestrator,
    });

    expect(exercise).toEqual(originalExerciseFrozen);
    expect(lifecycleEvidence).toEqual(originalEvidenceFrozen);
    expect(context).toEqual(originalContextFrozen);
  });

  it('11. complete preserved_unchanged results pass through unchanged', () => {
    const mockPreserved: OrchestratedExerciseResult = {
      status: 'preserved_unchanged',
      exercise: makeTestExercise(),
      appliedSets: [],
      lifecycleState: 'historical_locked',
      nextEvaluationState: { status: 'not_evaluated' },
      bundleCalculated: false,
      adapterCalled: false,
    };
    const mockOrchestrator = vi.fn().mockReturnValue(mockPreserved);

    const output = orchestrateGuidedWorkoutExercises({
      context: createDummyContext(),
      items: [{
        exercise: makeTestExercise(),
        exerciseIndex: 0,
        lifecycleEvidence: {
          originProvenance: 'historical_log_entry',
          isHistoricalEdit: true,
          isRedoSession: false,
          isRestoredFromDraft: false,
          evaluationState: { status: 'not_evaluated' },
        },
      }],
      orchestrateExerciseFn: mockOrchestrator,
    });

    expect(output[0].result).toBe(mockPreserved);
    expect(output[0].result.status).toBe('preserved_unchanged');
  });

  it('12. complete base_only results pass through unchanged', () => {
    const mockBaseOnly: OrchestratedExerciseResult = {
      status: 'base_only',
      exercise: makeTestExercise(),
      appliedSets: [],
      reason: 'DELOAD_OBJECTIVE',
      nextEvaluationState: {
        status: 'evaluated',
        result: { kind: 'base_only', reason: 'DELOAD_OBJECTIVE' },
      },
      bundleCalculated: true,
      adapterCalled: false,
    };
    const mockOrchestrator = vi.fn().mockReturnValue(mockBaseOnly);

    const output = orchestrateGuidedWorkoutExercises({
      context: createDummyContext(),
      items: [{
        exercise: makeTestExercise(),
        exerciseIndex: 0,
        lifecycleEvidence: {
          originProvenance: 'session_template_init',
          isHistoricalEdit: false,
          isRedoSession: false,
          isRestoredFromDraft: false,
          evaluationState: { status: 'not_evaluated' },
        },
      }],
      orchestrateExerciseFn: mockOrchestrator,
    });

    expect(output[0].result).toBe(mockBaseOnly);
    expect(output[0].result.status).toBe('base_only');
    if (output[0].result.status === 'base_only') {
      expect(output[0].result.reason).toBe('DELOAD_OBJECTIVE');
    }
  });

  it('13. complete guided_adapter_result results pass through unchanged', () => {
    const mockAdapterResult: OrchestratedExerciseResult = {
      status: 'guided_adapter_result',
      exercise: makeTestExercise(),
      appliedSets: [],
      adapterResult: {
        status: 'guided_applied',
        exercise: makeTestExercise(),
        appliedSets: [],
        snapshots: [],
        coachingReasonCode: 'BASE_PRESCRIPTION',
        diagnostics: makeTestDiagnostics(),
      },
      nextEvaluationState: {
        status: 'evaluated',
        result: {
          kind: 'guided_applied',
          adapterStatus: 'guided_applied',
          coachingReasonCode: 'BASE_PRESCRIPTION',
        },
      },
      bundleCalculated: true,
      adapterCalled: true,
    };
    const mockOrchestrator = vi.fn().mockReturnValue(mockAdapterResult);

    const output = orchestrateGuidedWorkoutExercises({
      context: createDummyContext(),
      items: [{
        exercise: makeTestExercise(),
        exerciseIndex: 0,
        lifecycleEvidence: {
          originProvenance: 'session_template_init',
          isHistoricalEdit: false,
          isRedoSession: false,
          isRestoredFromDraft: false,
          evaluationState: { status: 'not_evaluated' },
        },
      }],
      orchestrateExerciseFn: mockOrchestrator,
    });

    expect(output[0].result).toBe(mockAdapterResult);
    expect(output[0].result.status).toBe('guided_adapter_result');
  });

  it('14. selector-fallback and adapter-fallback provenance remain present inside returned orchestrator results', () => {
    const mockSelectorFallback: OrchestratedExerciseResult = {
      status: 'guided_adapter_result',
      exercise: makeTestExercise(),
      appliedSets: [],
      adapterResult: {
        status: 'guided_invalid_input_fallback',
        errorSource: 'selector',
        exercise: makeTestExercise(),
        appliedSets: [],
        snapshots: [],
        selectorError: 'UNRECOGNIZED_MODALITY',
        selectorErrorMessage: 'Unrecognized modality',
        diagnostics: [],
      },
      nextEvaluationState: {
        status: 'evaluated',
        result: {
          kind: 'selector_fallback',
          errorSource: 'selector',
          selectorError: 'UNRECOGNIZED_MODALITY',
        },
      },
      bundleCalculated: true,
      adapterCalled: true,
    };
    const mockOrchestrator = vi.fn().mockReturnValue(mockSelectorFallback);

    const output = orchestrateGuidedWorkoutExercises({
      context: createDummyContext(),
      items: [{
        exercise: makeTestExercise(),
        exerciseIndex: 0,
        lifecycleEvidence: {
          originProvenance: 'session_template_init',
          isHistoricalEdit: false,
          isRedoSession: false,
          isRestoredFromDraft: false,
          evaluationState: { status: 'not_evaluated' },
        },
      }],
      orchestrateExerciseFn: mockOrchestrator,
    });

    expect(output[0].result.nextEvaluationState.status).toBe('evaluated');
    if (output[0].result.nextEvaluationState.status === 'evaluated') {
      expect(output[0].result.nextEvaluationState.result.kind).toBe('selector_fallback');
      if (output[0].result.nextEvaluationState.result.kind === 'selector_fallback') {
        expect(output[0].result.nextEvaluationState.result.selectorError).toBe('UNRECOGNIZED_MODALITY');
      }
    }
  });

  it('15. invalid, negative, non-integer, NaN, and infinite exercise indices are not repaired and fail closed through the real orchestrator lifecycle classifier', () => {
    const context = createDummyContext();
    const invalidIndices = [-1, 1.5, NaN, Infinity, -Infinity];

    for (const invalidIdx of invalidIndices) {
      const output = orchestrateGuidedWorkoutExercises({
        context,
        items: [{
          exercise: makeTestExercise(),
          exerciseIndex: invalidIdx,
          lifecycleEvidence: {
            originProvenance: 'session_template_init',
            isHistoricalEdit: false,
            isRedoSession: false,
            isRestoredFromDraft: false,
            evaluationState: { status: 'not_evaluated' },
          },
        }],
      });

      expect(output).toHaveLength(1);
      expect(output[0].exerciseIndex).toBe(invalidIdx);
      expect(output[0].result.status).toBe('preserved_unchanged');
      if (output[0].result.status === 'preserved_unchanged') {
        expect(output[0].result.lifecycleState).toBe('active_committed');
      }
    }
  });

  it('16. a mixed batch can return different genuine result variants without flattening them', () => {
    let callCount = 0;
    const mockOrchestrator = vi.fn().mockImplementation((): OrchestratedExerciseResult => {
      callCount++;
      if (callCount === 1) {
        return {
          status: 'preserved_unchanged',
          exercise: makeTestExercise({ name: 'Ex 1' }),
          appliedSets: [],
          lifecycleState: 'redo_locked',
          nextEvaluationState: { status: 'not_evaluated' },
          bundleCalculated: false,
          adapterCalled: false,
        };
      }
      if (callCount === 2) {
        return {
          status: 'base_only',
          exercise: makeTestExercise({ name: 'Ex 2' }),
          appliedSets: [],
          reason: 'ONE_OFF',
          nextEvaluationState: {
            status: 'evaluated',
            result: { kind: 'base_only', reason: 'ONE_OFF' },
          },
          bundleCalculated: true,
          adapterCalled: false,
        };
      }
      return {
        status: 'guided_adapter_result',
        exercise: makeTestExercise({ name: 'Ex 3' }),
        appliedSets: [],
        adapterResult: {
          status: 'guided_applied',
          exercise: makeTestExercise({ name: 'Ex 3' }),
          appliedSets: [],
          snapshots: [],
          coachingReasonCode: 'BASE_PRESCRIPTION',
          diagnostics: makeTestDiagnostics(),
        },
        nextEvaluationState: {
          status: 'evaluated',
          result: {
            kind: 'guided_applied',
            adapterStatus: 'guided_applied',
            coachingReasonCode: 'BASE_PRESCRIPTION',
          },
        },
        bundleCalculated: true,
        adapterCalled: true,
      };
    });

    const context = createDummyContext();
    const items: GuidedWorkoutIntegrationItem[] = [
      {
        exercise: makeTestExercise({ name: 'Ex 1' }),
        exerciseIndex: 0,
        lifecycleEvidence: {
          originProvenance: 'session_template_init',
          isHistoricalEdit: false,
          isRedoSession: true,
          isRestoredFromDraft: false,
          evaluationState: { status: 'not_evaluated' },
        },
      },
      {
        exercise: makeTestExercise({ name: 'Ex 2' }),
        exerciseIndex: 1,
        lifecycleEvidence: {
          originProvenance: 'session_template_init',
          isHistoricalEdit: false,
          isRedoSession: false,
          isRestoredFromDraft: false,
          evaluationState: { status: 'not_evaluated' },
        },
      },
      {
        exercise: makeTestExercise({ name: 'Ex 3' }),
        exerciseIndex: 2,
        lifecycleEvidence: {
          originProvenance: 'session_template_init',
          isHistoricalEdit: false,
          isRedoSession: false,
          isRestoredFromDraft: false,
          evaluationState: { status: 'not_evaluated' },
        },
      },
    ];

    const output = orchestrateGuidedWorkoutExercises({
      context,
      items,
      orchestrateExerciseFn: mockOrchestrator,
    });

    expect(output).toHaveLength(3);
    expect(output[0].result.status).toBe('preserved_unchanged');
    expect(output[1].result.status).toBe('base_only');
    expect(output[2].result.status).toBe('guided_adapter_result');
  });

  it('19. no React, WorkoutLogger, browser storage, random-ID, or wall-clock dependency is required', () => {
    const context = Object.freeze(createDummyContext());
    const item: GuidedWorkoutIntegrationItem = Object.freeze({
      exercise: Object.freeze(makeTestExercise()),
      exerciseIndex: 0,
      lifecycleEvidence: Object.freeze({
        originProvenance: 'session_template_init',
        isHistoricalEdit: false,
        isRedoSession: false,
        isRestoredFromDraft: false,
        evaluationState: Object.freeze({ status: 'not_evaluated' }),
      }),
    });

    const mockOrchestrator = vi.fn().mockReturnValue({
      status: 'preserved_unchanged',
      exercise: item.exercise,
      appliedSets: [],
      lifecycleState: 'already_evaluated',
      nextEvaluationState: { status: 'not_evaluated' },
      bundleCalculated: false,
      adapterCalled: false,
    } as OrchestratedExerciseResult);

    const output = orchestrateGuidedWorkoutExercises({
      context,
      items: Object.freeze([item]),
      orchestrateExerciseFn: mockOrchestrator,
    });

    expect(output).toHaveLength(1);
    expect(output[0].exerciseIndex).toBe(0);
  });
});

describe('guidedWorkoutIntegration (Real Default-Dependency End-to-End Tests)', () => {
  it('17. real default-dependency Performance-Led request returns canonical base-only behaviour', () => {
    const context = createDummyContext({
      program: null,
      sessionKind: { type: 'active_program_session', weekNum: 1 },
      objective: 'Hypertrophy',
    });

    const exercise = makeTestExercise({ name: 'Barbell Bench Press' });
    const items: GuidedWorkoutIntegrationItem[] = [
      {
        exercise,
        exerciseIndex: 0,
        lifecycleEvidence: {
          originProvenance: 'session_template_init',
          isHistoricalEdit: false,
          isRedoSession: false,
          isRestoredFromDraft: false,
          evaluationState: { status: 'not_evaluated' },
        },
      },
    ];

    const output = orchestrateGuidedWorkoutExercises({
      context,
      items,
    });

    expect(output).toHaveLength(1);
    expect(output[0].exerciseIndex).toBe(0);
    expect(output[0].result.status).toBe('base_only');
    if (output[0].result.status === 'base_only') {
      expect(output[0].result.reason).toBe('PERFORMANCE_LED');
      expect(output[0].result.bundleCalculated).toBe(true);
      expect(output[0].result.adapterCalled).toBe(false);
      expect(output[0].result.nextEvaluationState).toEqual({
        status: 'evaluated',
        result: {
          kind: 'base_only',
          reason: 'PERFORMANCE_LED',
        },
      });
    }
  });

  it('18. real default-dependency Guided request traverses helper -> orchestrator -> bundle -> adapter -> selector', () => {
    const prog: Program = {
      id: 'prog-hl-lb',
      name: 'Hypertrophy Linear LB',
      daysPerWeek: 3,
      programDuration: 4,
      exercisesByDay: {},
      createdAt: '2026-08-01T00:00:00.000Z',
      algorithmId: 'hypertrophy_linear',
      objective: 'Hypertrophy',
      targetProgressionMode: 'metreps_guided',
      progressionPolicyVersion: CURRENT_PROGRESSION_POLICY_VERSION,
      algorithmVersion: CURRENT_ALGORITHM_VERSION,
    };

    const ex: ExerciseEntry = {
      exerciseKey: 'bench_press',
      name: 'Barbell Bench Press',
      muscleGroup: 'Chest',
      modality: 'weighted',
      isMainMovement: true,
      sets: [
        { setNumber: 1, weight: 187.5, reps: 15, rpe: 8, isCompleted: false },
        { setNumber: 2, weight: 187.5, reps: 15, rpe: 8, isCompleted: false },
        { setNumber: 3, weight: 187.5, reps: 15, rpe: 8, isCompleted: false },
      ],
    };

    const log1: WorkoutLog = {
      id: 'log-lb-1',
      date: '2026-07-27',
      unit: 'lb',
      programId: 'prog-hl-lb',
      exercises: [{
        exerciseKey: 'bench_press',
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        isMainMovement: true,
        sets: [1, 2, 3].map(sn => ({
          setNumber: sn,
          weight: 187.5,
          reps: 15,
          rpe: 8,
          isCompleted: true,
        })),
      }],
    };

    const log2: WorkoutLog = {
      id: 'log-lb-2',
      date: '2026-08-03',
      unit: 'lb',
      programId: 'prog-hl-lb',
      exercises: [{
        exerciseKey: 'bench_press',
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        isMainMovement: true,
        sets: [1, 2, 3].map(sn => ({
          setNumber: sn,
          weight: 187.5,
          reps: 15,
          rpe: 8,
          isCompleted: true,
        })),
      }],
    };

    const boundary: ActivePrescriptionBoundary = {
      sessionStartedAt: 1786320000000,
      prescriptionTargetDate: '2026-08-10',
    };

    const context: GuidedWorkoutIntegrationContext = {
      program: prog,
      programs: [prog],
      historicalLogs: [log1, log2],
      boundary,
      sessionKind: { type: 'active_program_session', weekNum: 1, scheduledDate: '2026-08-10' },
      activeUnit: 'lb',
      bodyweightSnapshot: null,
      objective: 'Hypertrophy',
      weekNum: 1,
      programDuration: 4,
    };

    const items: GuidedWorkoutIntegrationItem[] = [
      {
        exercise: ex,
        exerciseIndex: 0,
        templateExercise: ex,
        lifecycleEvidence: {
          originProvenance: 'session_template_init',
          isHistoricalEdit: false,
          isRedoSession: false,
          isRestoredFromDraft: false,
          evaluationState: { status: 'not_evaluated' },
        },
      },
    ];

    const output = orchestrateGuidedWorkoutExercises({
      context,
      items,
    });

    expect(output).toHaveLength(1);
    expect(output[0].exerciseIndex).toBe(0);

    const res = output[0].result;
    expect(res.status).toBe('guided_adapter_result');
    expect(res.bundleCalculated).toBe(true);
    expect(res.adapterCalled).toBe(true);

    if (res.status === 'guided_adapter_result') {
      expect(res.adapterResult.status).toBe('guided_applied');
      expect(res.nextEvaluationState.status).toBe('evaluated');
      if (res.nextEvaluationState.status === 'evaluated') {
        expect(res.nextEvaluationState.result.kind).toBe('guided_applied');
      }
      expect(res.appliedSets[0].prescriptionSnapshot).toBeDefined();
      expect(res.appliedSets[0].prescriptionSnapshot?.weightUnit).toBe('lb');
    }
  });
});
