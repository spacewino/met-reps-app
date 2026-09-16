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

export interface ActiveWorkoutDraftPayload {
  editLogId?: string | null;
  programId?: string | null;
  programName?: string | null;
  weekNum?: number | string;
  dayNum?: number | string;
  dateStr?: string;
  workoutDate?: string;
  isOneOff?: boolean;
  scheduledDate?: string | null;
  exercises?: any[];
  userRawExercises?: any[] | null;
  duration?: number | '';
  notes?: string;
  sleep?: number | '';
  hydration?: any;
  calories?: number | '';
  protein?: number | '';
  soreness?: number;
  motivation?: number;
  checkedSets?: Record<string, boolean>;
  completionTouchedSets?: Record<string, boolean>;
  collapsed?: Record<number, boolean>;
  objective?: string;
  userTouchedSets?: Record<string, boolean>;
  prescribedTargetSnapshots?: Record<string, any>;
  committedLiveEvidenceBySet?: Record<string, any>;
  liveAdjustedSets?: Record<string, boolean>;
  currentSetGuideKey?: string | null;
  bodyweightSnapshot?: any;
  restIntervals?: any[];
  startTime?: string;
  prescriptionBoundary?: {
    sessionStartedAt: number;
    prescriptionTargetDate: string;
  } | null;
  [key: string]: any;
}

/**
 * Extracts a structured ActiveWorkoutIdentity from navigation view parameters.
 */
export function getWorkoutIdentityFromParams(params: any): ActiveWorkoutIdentity | null {
  if (!params || typeof params !== 'object') {
    return { kind: 'one_off', workoutId: null };
  }

  if (params.editLogId !== null && params.editLogId !== undefined && String(params.editLogId).trim() !== '') {
    return {
      kind: 'historical_edit',
      workoutId: String(params.editLogId).trim(),
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
export function getWorkoutIdentityFromDraft(draft: unknown): ActiveWorkoutIdentity | null {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    return null;
  }

  const d = draft as Record<string, unknown>;

  if (d.editLogId !== null && d.editLogId !== undefined && String(d.editLogId).trim() !== '') {
    return {
      kind: 'historical_edit',
      workoutId: String(d.editLogId).trim(),
    };
  }

  if (d.isOneOff === true) {
    return {
      kind: 'one_off',
      workoutId: d.workoutId ? String(d.workoutId) : (d.redoFromLogId ? String(d.redoFromLogId) : null),
    };
  }

  if (d.programId !== null && d.programId !== undefined && String(d.programId).trim() !== '') {
    return {
      kind: 'programmed',
      programId: String(d.programId),
      weekNum: d.weekNum !== undefined ? (d.weekNum as number | string) : (d.week !== undefined ? (d.week as number | string) : '1'),
      dayNum: d.dayNum !== undefined ? (d.dayNum as number | string) : (d.day !== undefined ? (d.day as number | string) : '1'),
      programName: typeof d.programName === 'string' ? d.programName : null,
      workoutName: typeof d.workoutName === 'string' ? d.workoutName : (typeof d.programName === 'string' ? d.programName : null),
      workoutId: d.workoutId ? String(d.workoutId) : null,
    };
  }

  if (d.redoFromLogId !== null && d.redoFromLogId !== undefined && String(d.redoFromLogId).trim() !== '') {
    return {
      kind: 'one_off',
      workoutId: String(d.redoFromLogId),
    };
  }

  // If draft has exercises or data without explicit tags, treat as generic one-off if exercises exist
  if (Array.isArray(d.exercises) && d.exercises.length > 0) {
    return { kind: 'one_off', workoutId: null };
  }

  return null;
}

/**
 * Safely parses the active workout draft from localStorage.
 */
export function getActiveWorkoutDraft(): { rawDraft: Record<string, any>; identity: ActiveWorkoutIdentity | null } | null {
  try {
    const draftStr = localStorage.getItem('metreps_workout_draft');
    if (!draftStr) return null;
    const rawParsed: unknown = JSON.parse(draftStr);
    const identity = getWorkoutIdentityFromDraft(rawParsed);
    if (!identity) return null;
    if (typeof rawParsed !== 'object' || rawParsed === null || Array.isArray(rawParsed)) {
      return null;
    }
    return { rawDraft: rawParsed as Record<string, any>, identity };
  } catch (e) {
    // Malformed JSON should fail safely
    return null;
  }
}

/**
 * Alias helper for getting active draft metadata and structured identity.
 */
export function getActiveWorkoutDraftMetadata(): { rawDraft: Record<string, any>; identity: ActiveWorkoutIdentity | null } | null {
  return getActiveWorkoutDraft();
}

/**
 * Safely saves the active workout draft to localStorage.
 */
export function saveActiveWorkoutDraft(payload: Record<string, any> | unknown): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('metreps_workout_draft', JSON.stringify(payload));
    }
  } catch (e) {
    console.error('Failed to save active workout draft:', e);
  }
}

/**
 * Safely clears the active workout draft from localStorage.
 */
export function clearActiveWorkoutDraft(): void {
  try {
    localStorage.removeItem('metreps_workout_draft');
  } catch (e) {
    console.error('Failed to clear active workout draft:', e);
  }
}

/**
 * Checks whether an active workout draft belongs to a specific program.
 * Strictly checks that the draft is a programmed session for this program ID,
 * and not a historical edit or generic one-off.
 */
export function doesDraftMatchProgram(draft: unknown, programId: string | number | null | undefined): boolean {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft) || programId === null || programId === undefined) {
    return false;
  }
  const cleanProgId = String(programId).trim();
  if (!cleanProgId) return false;

  const d = draft as Record<string, unknown>;

  // Historical edit or generic one-off drafts do not belong to a program
  if (
    (d.editLogId !== null && d.editLogId !== undefined && String(d.editLogId).trim() !== '') ||
    d.isOneOff === true
  ) {
    return false;
  }

  if (d.programId === null || d.programId === undefined) {
    return false;
  }

  const draftProgId = String(d.programId).trim();
  if (!draftProgId) return false;

  return draftProgId === cleanProgId;
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
