/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type ActiveWorkoutIdentity =
  | {
      kind: 'one_off';
      workoutId?: string | null;
    }
  | {
      kind: 'programmed';
      programId: string;
      weekNum: number | string;
      dayNum: number | string;
      workoutId?: string | null;
      programName?: string | null;
      workoutName?: string | null;
    }
  | {
      kind: 'historical_edit';
      workoutId: string;
    };

/**
 * Extracts a structured ActiveWorkoutIdentity from navigation view parameters.
 */
export function getWorkoutIdentityFromParams(params: any): ActiveWorkoutIdentity | null {
  if (!params || typeof params !== 'object') {
    return { kind: 'one_off', workoutId: null };
  }

  if (params.editLogId) {
    return {
      kind: 'historical_edit',
      workoutId: String(params.editLogId),
    };
  }

  if (params.isOneOff) {
    return {
      kind: 'one_off',
      workoutId: params.workoutId ? String(params.workoutId) : (params.redoFromLogId ? String(params.redoFromLogId) : null),
    };
  }

  if (params.programId) {
    return {
      kind: 'programmed',
      programId: String(params.programId),
      weekNum: params.week !== undefined ? params.week : (params.weekNum !== undefined ? params.weekNum : '1'),
      dayNum: params.day !== undefined ? params.day : (params.dayNum !== undefined ? params.dayNum : '1'),
      programName: params.programName || null,
      workoutName: params.workoutName || params.programName || null,
      workoutId: params.workoutId ? String(params.workoutId) : null,
    };
  }

  if (params.redoFromLogId) {
    return {
      kind: 'one_off',
      workoutId: String(params.redoFromLogId),
    };
  }

  return { kind: 'one_off', workoutId: null };
}

/**
 * Extracts a structured ActiveWorkoutIdentity from a raw localStorage draft object.
 */
export function getWorkoutIdentityFromDraft(draft: any): ActiveWorkoutIdentity | null {
  if (!draft || typeof draft !== 'object') {
    return null;
  }

  if (draft.editLogId) {
    return {
      kind: 'historical_edit',
      workoutId: String(draft.editLogId),
    };
  }

  if (draft.isOneOff === true) {
    return {
      kind: 'one_off',
      workoutId: draft.workoutId ? String(draft.workoutId) : (draft.redoFromLogId ? String(draft.redoFromLogId) : null),
    };
  }

  if (draft.programId) {
    return {
      kind: 'programmed',
      programId: String(draft.programId),
      weekNum: draft.weekNum !== undefined ? draft.weekNum : (draft.week !== undefined ? draft.week : '1'),
      dayNum: draft.dayNum !== undefined ? draft.dayNum : (draft.day !== undefined ? draft.day : '1'),
      programName: draft.programName || null,
      workoutName: draft.workoutName || draft.programName || null,
      workoutId: draft.workoutId ? String(draft.workoutId) : null,
    };
  }

  if (draft.redoFromLogId) {
    return {
      kind: 'one_off',
      workoutId: String(draft.redoFromLogId),
    };
  }

  // If draft has exercises or data without explicit tags, treat as generic one-off if exercises exist
  if (Array.isArray(draft.exercises) && draft.exercises.length > 0) {
    return { kind: 'one_off', workoutId: null };
  }

  return null;
}

/**
 * Safely parses the active workout draft from localStorage.
 */
export function getActiveWorkoutDraft(): { rawDraft: any; identity: ActiveWorkoutIdentity | null } | null {
  try {
    const draftStr = localStorage.getItem('metreps_workout_draft');
    if (!draftStr) return null;
    const rawDraft = JSON.parse(draftStr);
    const identity = getWorkoutIdentityFromDraft(rawDraft);
    if (!identity) return null;
    return { rawDraft, identity };
  } catch (e) {
    // Malformed JSON should fail safely
    return null;
  }
}

/**
 * Deterministic navigation decision helper.
 * 
 * Rules:
 * 1. No active session (null) -> 'allow'
 * 2. No requested workout identity (null) -> 'allow' (e.g. non-logger routes)
 * 3. Same exact session identity -> 'allow'
 * 4. Different kinds -> 'block'
 * 5. Programmed to different week/day/program -> 'block'
 * 6. Historical edit to different log -> 'block'
 */
export function resolveWorkoutNavigation(
  activeIdentity: ActiveWorkoutIdentity | null,
  requestedIdentity: ActiveWorkoutIdentity | null
): 'allow' | 'block' {
  if (!activeIdentity || !requestedIdentity) {
    return 'allow';
  }

  // Cross-kind navigation is always blocked
  if (activeIdentity.kind !== requestedIdentity.kind) {
    return 'block';
  }

  if (activeIdentity.kind === 'one_off' && requestedIdentity.kind === 'one_off') {
    // If both specify a workout ID (or redo ID), they must match
    if (activeIdentity.workoutId && requestedIdentity.workoutId) {
      return String(activeIdentity.workoutId) === String(requestedIdentity.workoutId) ? 'allow' : 'block';
    }
    // If one is specific and one is generic, block to prevent losing specific context
    if (activeIdentity.workoutId || requestedIdentity.workoutId) {
      return activeIdentity.workoutId === requestedIdentity.workoutId ? 'allow' : 'block';
    }
    return 'allow';
  }

  if (activeIdentity.kind === 'programmed' && requestedIdentity.kind === 'programmed') {
    const sameProgram = String(activeIdentity.programId) === String(requestedIdentity.programId);
    const sameWeek = String(activeIdentity.weekNum) === String(requestedIdentity.weekNum);
    const sameDay = String(activeIdentity.dayNum) === String(requestedIdentity.dayNum);

    if (sameProgram && sameWeek && sameDay) {
      return 'allow';
    }
    return 'block';
  }

  if (activeIdentity.kind === 'historical_edit' && requestedIdentity.kind === 'historical_edit') {
    return String(activeIdentity.workoutId) === String(requestedIdentity.workoutId) ? 'allow' : 'block';
  }

  return 'block';
}
