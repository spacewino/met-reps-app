import { describe, it, expect } from 'vitest';
import {
  createSessionExerciseRegistry,
  appendSessionExerciseRegistryEntry,
  replaceSessionExerciseRegistryEntry,
  removeSessionExerciseRegistryEntry,
  moveSessionExerciseRegistryEntry,
  updateSessionExerciseEvaluationState,
  markSessionExerciseStructuralMutation,
  clearSessionExerciseRegistry,
  type SessionExerciseRegistry,
  type SessionExerciseRegistryEntry,
  type SessionExerciseInstanceId,
} from '../guidedSessionExerciseRegistry';
import type {
  ExerciseOriginProvenance,
  ExerciseStructuralMutationReason,
  SessionEvaluationState,
} from '../guidedWorkoutOrchestrator';

describe('guidedSessionExerciseRegistry (Pure Unit Suite)', () => {
  it('1. empty initialization returns zero entries and nextInstanceId 1', () => {
    const reg = createSessionExerciseRegistry([]);
    expect(reg.entries).toHaveLength(0);
    expect(reg.nextInstanceId).toBe(1);
    expect(Object.isFrozen(reg.entries)).toBe(true);
  });

  it('2. multi-entry initialization creates unique monotonic instance IDs and not_evaluated state', () => {
    const provenances: ExerciseOriginProvenance[] = [
      'session_template_init',
      'user_added_library',
      'user_added_blank',
    ];
    const reg = createSessionExerciseRegistry(provenances);

    expect(reg.entries).toHaveLength(3);
    expect(reg.nextInstanceId).toBe(4);
    expect(reg.entries[0].instanceId).toBe('session_ex_1');
    expect(reg.entries[1].instanceId).toBe('session_ex_2');
    expect(reg.entries[2].instanceId).toBe('session_ex_3');

    for (const entry of reg.entries) {
      expect(entry.evaluationState).toEqual({ status: 'not_evaluated' });
      expect(entry.structuralMutationReason).toBeUndefined();
    }
  });

  it('3. deterministic unique IDs across distinct registry instances', () => {
    const reg1 = createSessionExerciseRegistry(['session_template_init']);
    const reg2 = createSessionExerciseRegistry(['session_template_init']);

    expect(reg1.entries[0].instanceId).toBe('session_ex_1');
    expect(reg2.entries[0].instanceId).toBe('session_ex_1');
    expect(reg1.nextInstanceId).toBe(2);
    expect(reg2.nextInstanceId).toBe(2);
  });

  it('4. initial not_evaluated state is assigned to every entry', () => {
    const reg = createSessionExerciseRegistry([
      'restored_from_draft',
      'historical_log_entry',
    ]);
    expect(reg.entries[0].evaluationState).toEqual({ status: 'not_evaluated' });
    expect(reg.entries[1].evaluationState).toEqual({ status: 'not_evaluated' });
  });

  it('5. mixed provenance initialization assigns correct provenance to corresponding slots', () => {
    const provenances: ExerciseOriginProvenance[] = [
      'session_template_init',
      'user_added_library',
      'user_added_blank',
      'user_replaced_library',
      'restored_from_draft',
      'historical_log_entry',
    ];
    const reg = createSessionExerciseRegistry(provenances);

    expect(reg.entries.map(e => e.originProvenance)).toEqual(provenances);
    expect(reg.nextInstanceId).toBe(7);
  });

  it('6. appendSessionExerciseRegistryEntry adds fresh entry and increments nextInstanceId', () => {
    const reg1 = createSessionExerciseRegistry(['session_template_init']);
    const res = appendSessionExerciseRegistryEntry(reg1, 'user_added_library');

    expect(res.applied).toBe(true);
    expect(res.registry.entries).toHaveLength(2);
    expect(res.registry.entries[0].instanceId).toBe('session_ex_1');
    expect(res.registry.entries[1].instanceId).toBe('session_ex_2');
    expect(res.registry.entries[1].originProvenance).toBe('user_added_library');
    expect(res.registry.entries[1].evaluationState).toEqual({ status: 'not_evaluated' });
    expect(res.registry.nextInstanceId).toBe(3);

    // Old registry untouched
    expect(reg1.entries).toHaveLength(1);
    expect(reg1.nextInstanceId).toBe(2);
  });

  it('7. repeated append maintains strictly monotonic IDs and ordering', () => {
    let reg = createSessionExerciseRegistry([]);
    for (let i = 0; i < 5; i++) {
      const res = appendSessionExerciseRegistryEntry(reg, 'user_added_library');
      expect(res.applied).toBe(true);
      reg = res.registry;
    }

    expect(reg.entries).toHaveLength(5);
    expect(reg.nextInstanceId).toBe(6);
    expect(reg.entries.map(e => e.instanceId)).toEqual([
      'session_ex_1',
      'session_ex_2',
      'session_ex_3',
      'session_ex_4',
      'session_ex_5',
    ]);
  });

  it('8. replacement allocates fresh ID, resets evaluationState, and clears structural mutation reason', () => {
    const initial = createSessionExerciseRegistry(['session_template_init', 'session_template_init']);
    // Update evaluation state and mark structural mutation on index 1
    const evalRes = updateSessionExerciseEvaluationState(initial, 1, {
      status: 'evaluated',
      result: { kind: 'base_only', reason: 'PERFORMANCE_LED' },
    });
    const mutRes = markSessionExerciseStructuralMutation(evalRes.registry, 1, 'set_added');
    const modified = mutRes.registry;

    expect(modified.entries[1].evaluationState.status).toBe('evaluated');
    expect(modified.entries[1].structuralMutationReason).toBe('set_added');

    // Replace index 1
    const replaceRes = replaceSessionExerciseRegistryEntry(modified, 1, 'user_replaced_library');
    expect(replaceRes.applied).toBe(true);
    expect(replaceRes.registry.entries).toHaveLength(2);

    // Index 0 unchanged
    expect(replaceRes.registry.entries[0]).toBe(modified.entries[0]);
    expect(replaceRes.registry.entries[0].instanceId).toBe('session_ex_1');

    // Index 1 has new ID, reset evaluationState, cleared reason
    expect(replaceRes.registry.entries[1].instanceId).toBe('session_ex_3');
    expect(replaceRes.registry.entries[1].originProvenance).toBe('user_replaced_library');
    expect(replaceRes.registry.entries[1].evaluationState).toEqual({ status: 'not_evaluated' });
    expect(replaceRes.registry.entries[1].structuralMutationReason).toBeUndefined();
    expect(replaceRes.registry.nextInstanceId).toBe(4);
  });

  it('9. removal removes target entry, preserves sibling IDs without renumbering', () => {
    const reg = createSessionExerciseRegistry([
      'session_template_init',
      'session_template_init',
      'session_template_init',
    ]);

    const res = removeSessionExerciseRegistryEntry(reg, 1);
    expect(res.applied).toBe(true);
    expect(res.registry.entries).toHaveLength(2);
    expect(res.registry.entries[0].instanceId).toBe('session_ex_1');
    expect(res.registry.entries[1].instanceId).toBe('session_ex_3');
    expect(res.registry.nextInstanceId).toBe(4); // nextInstanceId is not reduced

    // References to unaffected entries are preserved
    expect(res.registry.entries[0]).toBe(reg.entries[0]);
    expect(res.registry.entries[1]).toBe(reg.entries[2]);
  });

  it('10. exact existing WorkoutLogger move semantics (adjacent and arbitrary swap)', () => {
    const reg = createSessionExerciseRegistry([
      'session_template_init',
      'user_added_library',
      'user_added_blank',
    ]);
    const markedReg = markSessionExerciseStructuralMutation(reg, 0, 'set_added').registry;

    // Move down (swap 0 and 1)
    const moveRes = moveSessionExerciseRegistryEntry(markedReg, 0, 1);
    expect(moveRes.applied).toBe(true);
    expect(moveRes.registry.entries).toHaveLength(3);

    expect(moveRes.registry.entries[0].instanceId).toBe('session_ex_2');
    expect(moveRes.registry.entries[0].originProvenance).toBe('user_added_library');

    expect(moveRes.registry.entries[1].instanceId).toBe('session_ex_1');
    expect(moveRes.registry.entries[1].originProvenance).toBe('session_template_init');
    expect(moveRes.registry.entries[1].structuralMutationReason).toBe('set_added');

    expect(moveRes.registry.entries[2]).toBe(markedReg.entries[2]);
    expect(moveRes.registry.entries[2].instanceId).toBe('session_ex_3');

    // nextInstanceId untouched
    expect(moveRes.registry.nextInstanceId).toBe(markedReg.nextInstanceId);
  });

  it('11. evaluation-state update updates only target entry and preserves other properties', () => {
    const reg = createSessionExerciseRegistry(['session_template_init', 'session_template_init']);
    const state: SessionEvaluationState = {
      status: 'evaluated',
      result: {
        kind: 'guided_applied',
        adapterStatus: 'guided_applied',
        coachingReasonCode: 'BASE_PRESCRIPTION',
      },
    };

    const res = updateSessionExerciseEvaluationState(reg, 1, state);
    expect(res.applied).toBe(true);
    expect(res.registry.entries[0]).toBe(reg.entries[0]);
    expect(res.registry.entries[1].instanceId).toBe('session_ex_2');
    expect(res.registry.entries[1].originProvenance).toBe('session_template_init');
    expect(res.registry.entries[1].evaluationState).toBe(state);
    expect(res.registry.nextInstanceId).toBe(reg.nextInstanceId);
  });

  it('12. all seven structural-mutation reason values can be recorded', () => {
    const reasons: ExerciseStructuralMutationReason[] = [
      'set_added',
      'set_deleted',
      'set_reordered',
      'warmup_structure_changed',
      'drop_set_structure_changed',
      'drop_subsets_changed',
      'other_exercise_structure_changed',
    ];

    const reg = createSessionExerciseRegistry(reasons.map(() => 'session_template_init'));

    for (let i = 0; i < reasons.length; i++) {
      const res = markSessionExerciseStructuralMutation(reg, i, reasons[i]);
      expect(res.applied).toBe(true);
      expect(res.registry.entries[i].structuralMutationReason).toBe(reasons[i]);
      expect(res.registry.entries[i].instanceId).toBe(`session_ex_${i + 1}`);
    }
  });

  it('13. clearing returns a clean empty registry with nextInstanceId reset to 1 without mutating input', () => {
    const reg = createSessionExerciseRegistry(['session_template_init', 'session_template_init']);
    const cleared = clearSessionExerciseRegistry();

    expect(cleared.entries).toHaveLength(0);
    expect(cleared.nextInstanceId).toBe(1);
    expect(Object.isFrozen(cleared.entries)).toBe(true);

    // Old registry untouched
    expect(reg.entries).toHaveLength(2);
    expect(reg.nextInstanceId).toBe(3);
  });

  it('14. invalid indices return applied: false and unchanged registry reference', () => {
    const reg = createSessionExerciseRegistry(['session_template_init', 'session_template_init']);
    const invalidIndices = [-1, 2, 5, 1.5, NaN, Infinity, -Infinity];

    for (const invalidIdx of invalidIndices) {
      const rep = replaceSessionExerciseRegistryEntry(reg, invalidIdx, 'user_replaced_library');
      expect(rep.applied).toBe(false);
      expect(rep.registry).toBe(reg);

      const rem = removeSessionExerciseRegistryEntry(reg, invalidIdx);
      expect(rem.applied).toBe(false);
      expect(rem.registry).toBe(reg);

      const upd = updateSessionExerciseEvaluationState(reg, invalidIdx, { status: 'not_evaluated' });
      expect(upd.applied).toBe(false);
      expect(upd.registry).toBe(reg);

      const mut = markSessionExerciseStructuralMutation(reg, invalidIdx, 'set_added');
      expect(mut.applied).toBe(false);
      expect(mut.registry).toBe(reg);
    }
  });

  it('15. invalid move destinations return applied: false and unchanged registry', () => {
    const reg = createSessionExerciseRegistry(['session_template_init', 'session_template_init']);
    const invalidPairs: [number, number][] = [
      [-1, 1],
      [0, 2],
      [0, -1],
      [1, 5],
      [0.5, 1],
      [0, 1.5],
      [NaN, 1],
      [0, Infinity],
    ];

    for (const [from, to] of invalidPairs) {
      const res = moveSessionExerciseRegistryEntry(reg, from, to);
      expect(res.applied).toBe(false);
      expect(res.registry).toBe(reg);
    }
  });

  it('16. same-source/destination move returns applied: false and original registry unchanged', () => {
    const reg = createSessionExerciseRegistry(['session_template_init', 'session_template_init']);
    const res = moveSessionExerciseRegistryEntry(reg, 1, 1);
    expect(res.applied).toBe(false);
    expect(res.registry).toBe(reg);
  });

  it('17. identity scenario 1 & 2: duplicate exercises have distinct IDs; deleting first does not change second ID', () => {
    // Two occurrences of "Barbell Bench Press"
    const reg = createSessionExerciseRegistry([
      'session_template_init',
      'session_template_init',
    ]);

    const id1 = reg.entries[0].instanceId;
    const id2 = reg.entries[1].instanceId;
    expect(id1).not.toBe(id2);
    expect(id1).toBe('session_ex_1');
    expect(id2).toBe('session_ex_2');

    // Delete first duplicate
    const rem = removeSessionExerciseRegistryEntry(reg, 0);
    expect(rem.applied).toBe(true);
    expect(rem.registry.entries).toHaveLength(1);
    expect(rem.registry.entries[0].instanceId).toBe(id2);
  });

  it('18. identity scenario 3, 8 & 9: reordering duplicates moves IDs, evaluationState, and structural mutations with them', () => {
    const reg = createSessionExerciseRegistry([
      'session_template_init',
      'session_template_init',
    ]);
    const marked = markSessionExerciseStructuralMutation(reg, 0, 'set_added').registry;
    const evaled = updateSessionExerciseEvaluationState(marked, 0, {
      status: 'evaluated',
      result: { kind: 'base_only', reason: 'PERFORMANCE_LED' },
    }).registry;

    const swapped = moveSessionExerciseRegistryEntry(evaled, 0, 1);
    expect(swapped.applied).toBe(true);

    // Slot 0 now has the previously second entry
    expect(swapped.registry.entries[0].instanceId).toBe('session_ex_2');
    expect(swapped.registry.entries[0].structuralMutationReason).toBeUndefined();
    expect(swapped.registry.entries[0].evaluationState).toEqual({ status: 'not_evaluated' });

    // Slot 1 now has the previously first entry with all its metadata preserved
    expect(swapped.registry.entries[1].instanceId).toBe('session_ex_1');
    expect(swapped.registry.entries[1].structuralMutationReason).toBe('set_added');
    expect(swapped.registry.entries[1].evaluationState).toEqual({
      status: 'evaluated',
      result: { kind: 'base_only', reason: 'PERFORMANCE_LED' },
    });
  });

  it('19. identity scenario 5: replacing one duplicate creates a new ID only for the replacement', () => {
    const reg = createSessionExerciseRegistry([
      'session_template_init',
      'session_template_init',
    ]);
    const res = replaceSessionExerciseRegistryEntry(reg, 0, 'user_replaced_library');
    expect(res.applied).toBe(true);
    expect(res.registry.entries[0].instanceId).toBe('session_ex_3');
    expect(res.registry.entries[1].instanceId).toBe('session_ex_2');
  });

  it('20. identity scenario 6: removing an earlier unrelated exercise does not change later IDs', () => {
    const reg = createSessionExerciseRegistry([
      'session_template_init', // Unrelated exercise
      'session_template_init', // Target duplicate A
      'session_template_init', // Target duplicate B
    ]);
    const res = removeSessionExerciseRegistryEntry(reg, 0);
    expect(res.applied).toBe(true);
    expect(res.registry.entries[0].instanceId).toBe('session_ex_2');
    expect(res.registry.entries[1].instanceId).toBe('session_ex_3');
  });

  it('21. identity scenario 7: appending after deletion never reuses a deleted ID', () => {
    const reg = createSessionExerciseRegistry([
      'session_template_init',
      'session_template_init',
    ]);
    // Delete session_ex_2
    const rem = removeSessionExerciseRegistryEntry(reg, 1);
    expect(rem.applied).toBe(true);
    expect(rem.registry.entries).toHaveLength(1);

    // Append new entry
    const app = appendSessionExerciseRegistryEntry(rem.registry, 'user_added_library');
    expect(app.applied).toBe(true);
    expect(app.registry.entries[1].instanceId).toBe('session_ex_3');
    expect(app.registry.nextInstanceId).toBe(4);
  });

  it('22. deep immutability: past registry states and evaluation states are never mutated', () => {
    const reg1 = createSessionExerciseRegistry(['session_template_init']);
    const reg1Snapshot = JSON.parse(JSON.stringify(reg1));

    const reg2 = appendSessionExerciseRegistryEntry(reg1, 'user_added_library').registry;
    const reg3 = updateSessionExerciseEvaluationState(reg2, 0, {
      status: 'evaluated',
      result: { kind: 'base_only', reason: 'ONE_OFF' },
    }).registry;
    const reg4 = markSessionExerciseStructuralMutation(reg3, 0, 'set_added').registry;
    const reg5 = clearSessionExerciseRegistry();

    // Verify reg1 remained completely unchanged
    expect(reg1).toEqual(reg1Snapshot);
    expect(reg1.entries).toHaveLength(1);
    expect(reg1.entries[0].evaluationState).toEqual({ status: 'not_evaluated' });
    expect(reg1.entries[0].structuralMutationReason).toBeUndefined();

    // Verify reg2 remained unchanged
    expect(reg2.entries[0].evaluationState).toEqual({ status: 'not_evaluated' });

    // Verify reg3 remained unchanged
    expect(reg3.entries[0].structuralMutationReason).toBeUndefined();

    // Verify reg5 is fresh
    expect(reg5.entries).toHaveLength(0);
    expect(reg5.nextInstanceId).toBe(1);
  });

  it('23. absence of exercise names, exerciseKey, canonical identity, or ExerciseEntry from registry entries', () => {
    const reg = createSessionExerciseRegistry(['session_template_init']);
    const entry = reg.entries[0] as unknown as Record<string, unknown>;

    expect(entry.name).toBeUndefined();
    expect(entry.exerciseKey).toBeUndefined();
    expect(entry.sets).toBeUndefined();
    expect(entry.modality).toBeUndefined();
    expect(entry.muscleGroup).toBeUndefined();
    expect(Object.keys(entry).sort()).toEqual([
      'evaluationState',
      'instanceId',
      'originProvenance',
    ]);
  });

  it('24. type-level rejection of open provenance, evaluation-state, and structural-reason strings', () => {
    // @ts-expect-error open provenance string is rejected
    createSessionExerciseRegistry(['custom_nonexistent_provenance']);

    const reg = createSessionExerciseRegistry(['session_template_init']);

    // @ts-expect-error open structural mutation reason string is rejected
    markSessionExerciseStructuralMutation(reg, 0, 'arbitrary_reason');

    // @ts-expect-error invalid evaluation state status is rejected
    updateSessionExerciseEvaluationState(reg, 0, { status: 'unevaluated' });

    expect(reg.entries).toHaveLength(1);
  });
});
