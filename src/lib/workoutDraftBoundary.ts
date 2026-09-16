/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GuidedHistoryBoundary } from './guidedHistoryCollector';
import { isValidCalendarDate } from './guidedHistoryCollector';
import { getTodayLocalDateString } from './dateUtils';

export interface ActivePrescriptionBoundaryCoordinates {
  readonly sessionStartedAt: number;
  readonly prescriptionTargetDate: string;
}

export type ActivePrescriptionBoundary = ActivePrescriptionBoundaryCoordinates | null;

export type ResolvedLivePrescriptionBoundary =
  | {
      readonly status: 'valid';
      readonly boundary: Extract<GuidedHistoryBoundary, { mode: 'active_live' }>;
    }
  | {
      readonly status: 'unavailable';
    };

/**
 * Validates whether a timestamp is a valid positive integer millisecond timestamp.
 */
export function isValidSessionTimestamp(ts: unknown): ts is number {
  return typeof ts === 'number' && Number.isInteger(ts) && Number.isFinite(ts) && ts > 0;
}

/**
 * Validates strict ISO calendar date string (YYYY-MM-DD).
 */
export function isValidIsoCalendarDate(dateStr: unknown): dateStr is string {
  return typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && isValidCalendarDate(dateStr);
}

/**
 * Safely parses unknown draft input into an immutable ActivePrescriptionBoundary.
 * Returns null if input is missing, null, not an object, malformed, or has invalid coordinates.
 * Never performs partial repair.
 */
export function parseActivePrescriptionBoundary(raw: unknown): ActivePrescriptionBoundary {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const candidate = raw as Record<string, unknown>;
  const { sessionStartedAt, prescriptionTargetDate } = candidate;

  if (!isValidSessionTimestamp(sessionStartedAt)) {
    return null;
  }

  if (!isValidIsoCalendarDate(prescriptionTargetDate)) {
    return null;
  }

  return {
    sessionStartedAt,
    prescriptionTargetDate,
  };
}

/**
 * Creates a fresh ActivePrescriptionBoundaryCoordinates object.
 * Requires explicit nowMs timestamp to guarantee determinism in tests.
 * Throws an explicit Error if either coordinate is invalid.
 */
export function createFreshPrescriptionBoundary(
  targetDate: string,
  nowMs: number
): ActivePrescriptionBoundaryCoordinates {
  if (!isValidSessionTimestamp(nowMs)) {
    throw new Error(`Invalid sessionStartedAt timestamp for fresh prescription boundary: ${nowMs}`);
  }

  if (!isValidIsoCalendarDate(targetDate)) {
    throw new Error(`Invalid prescriptionTargetDate for fresh prescription boundary: "${targetDate}"`);
  }

  return {
    sessionStartedAt: nowMs,
    prescriptionTargetDate: targetDate,
  };
}

/**
 * Resolves an ActivePrescriptionBoundary into a discriminated active_live GuidedHistoryBoundary or unavailable.
 * Never invokes the selector or adapter, and never performs history collection.
 */
export function resolveLivePrescriptionBoundary(
  boundary: ActivePrescriptionBoundary
): ResolvedLivePrescriptionBoundary {
  if (
    !boundary ||
    !isValidSessionTimestamp(boundary.sessionStartedAt) ||
    !isValidIsoCalendarDate(boundary.prescriptionTargetDate)
  ) {
    return { status: 'unavailable' };
  }

  return {
    status: 'valid',
    boundary: {
      mode: 'active_live',
      targetDate: boundary.prescriptionTargetDate,
      sessionStartedAt: boundary.sessionStartedAt,
      targetWorkoutId: null,
    },
  };
}

/**
 * Resolves the initial authoritative target date for a fresh session:
 * - For a scheduled programmed workout, uses scheduledDate if valid.
 * - Otherwise uses date if valid.
 * - Otherwise uses todayDateStr if valid.
 * - Otherwise falls back to today's local date string.
 */
export function resolveFreshSessionTargetDate(params?: {
  scheduledDate?: string | null;
  date?: string | null;
  isOneOff?: boolean;
  programId?: string | null;
  todayDateStr?: string;
}): string {
  const isProgrammed = !params?.isOneOff && !!params?.programId;
  if (isProgrammed && isValidIsoCalendarDate(params?.scheduledDate)) {
    return params.scheduledDate;
  }
  if (isValidIsoCalendarDate(params?.date)) {
    return params.date;
  }
  if (isValidIsoCalendarDate(params?.todayDateStr)) {
    return params.todayDateStr;
  }
  return getTodayLocalDateString();
}
