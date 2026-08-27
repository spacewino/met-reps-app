/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BodyweightSnapshot, WeightUnit, WorkoutLog } from '../types';
import { PrescriptionTargetChronology } from './objectiveMath';
import { convertWeightUnit } from './assistedLoadMath';

/**
 * Absolute tolerance in normalized kilograms for unit-only equivalence.
 * Capped at 0.05 kg plus a minimal floating-point epsilon.
 */
export const BODYWEIGHT_UNIT_EQUIVALENCE_TOLERANCE_KG = 0.05;
const FLOAT_EPSILON = 1e-9;

export type BodyweightWarmupBypassReason =
  | 'invalid_working_reps'
  | 'insufficient_repetition_resolution';

export interface BodyweightWarmupTarget {
  setNumber: number;
  weight: 0;
  reps: number;
  rpe: number;
  form: 'standard';
  isWarmup: true;
}

export interface BodyweightWarmupResult {
  status: 'valid' | 'bypassed';
  warmupTargets: BodyweightWarmupTarget[] | null;
  bypassReason?: BodyweightWarmupBypassReason;
}

export type SnapshotComparisonStatus =
  | 'exact_match'
  | 'unit_equivalent'
  | 'meaningful_change'
  | 'both_null'
  | 'both_undefined'
  | 'settings_missing'
  | 'draft_missing'
  | 'invalid';

export interface SnapshotComparisonResult {
  status: SnapshotComparisonStatus;
  isPhysicallyEquivalent: boolean;
  deltaNormalizedKg: number | null;
}

/**
 * Pure validator for an unknown bodyweight snapshot value.
 * Requires:
 * - A positive finite number for `value` (> 0)
 * - An explicit unit ('kg' | 'lb')
 */
export function validateBodyweightSnapshot(raw: unknown): BodyweightSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const val = obj.value;
  const unit = obj.unit;
  const timestamp = typeof obj.timestamp === 'string' ? obj.timestamp : undefined;

  if (
    typeof val !== 'number' ||
    !Number.isFinite(val) ||
    isNaN(val) ||
    val <= 0
  ) {
    return null;
  }

  if (unit !== 'kg' && unit !== 'lb' && unit !== 'lbs') {
    return null;
  }

  return {
    value: val,
    unit: (unit === 'lbs' ? 'lb' : unit) as WeightUnit,
    ...(timestamp ? { timestamp } : {}),
  };
}

/**
 * Immutably clones a snapshot.
 * Preserves undefined and explicit null.
 */
export function cloneBodyweightSnapshot(
  snapshot: BodyweightSnapshot | null | undefined
): BodyweightSnapshot | null | undefined {
  if (snapshot === undefined) return undefined;
  if (snapshot === null) return null;
  const valid = validateBodyweightSnapshot(snapshot);
  if (!valid) return null;
  return {
    value: valid.value,
    unit: valid.unit,
    ...(valid.timestamp ? { timestamp: valid.timestamp } : {}),
  };
}

/**
 * Converts a snapshot to normalized kilograms using canonical constants from assistedLoadMath.
 */
export function snapshotToNormalizedKg(snapshot: BodyweightSnapshot): number {
  return convertWeightUnit(snapshot.value, snapshot.unit, 'kg');
}

/**
 * Compares two snapshots by physical mass within the specified tolerance in kg.
 */
export function areSnapshotsPhysicallyEquivalent(
  a: BodyweightSnapshot | null | undefined,
  b: BodyweightSnapshot | null | undefined,
  toleranceKg = BODYWEIGHT_UNIT_EQUIVALENCE_TOLERANCE_KG
): boolean {
  if (!a || !b) return false;
  const validA = validateBodyweightSnapshot(a);
  const validB = validateBodyweightSnapshot(b);
  if (!validA || !validB) return false;

  const kgA = snapshotToNormalizedKg(validA);
  const kgB = snapshotToNormalizedKg(validB);
  return Math.abs(kgA - kgB) <= toleranceKg + FLOAT_EPSILON;
}

/**
 * Detailed comparison between draft and settings snapshots.
 */
export function compareSnapshots(
  draft: BodyweightSnapshot | null | undefined,
  settings: BodyweightSnapshot | null | undefined,
  toleranceKg = BODYWEIGHT_UNIT_EQUIVALENCE_TOLERANCE_KG
): SnapshotComparisonResult {
  if (draft === undefined && settings === undefined) {
    return { status: 'both_undefined', isPhysicallyEquivalent: true, deltaNormalizedKg: 0 };
  }
  if (draft === null && settings === null) {
    return { status: 'both_null', isPhysicallyEquivalent: true, deltaNormalizedKg: 0 };
  }

  const validDraft = draft ? validateBodyweightSnapshot(draft) : null;
  const validSettings = settings ? validateBodyweightSnapshot(settings) : null;

  if (!validSettings && validDraft) {
    return { status: 'settings_missing', isPhysicallyEquivalent: false, deltaNormalizedKg: null };
  }
  if (!validDraft && validSettings) {
    return { status: 'draft_missing', isPhysicallyEquivalent: false, deltaNormalizedKg: null };
  }
  if (!validDraft && !validSettings) {
    return { status: 'invalid', isPhysicallyEquivalent: false, deltaNormalizedKg: null };
  }

  const kgDraft = snapshotToNormalizedKg(validDraft!);
  const kgSettings = snapshotToNormalizedKg(validSettings!);
  const delta = Math.abs(kgDraft - kgSettings);

  if (validDraft!.value === validSettings!.value && validDraft!.unit === validSettings!.unit) {
    return { status: 'exact_match', isPhysicallyEquivalent: true, deltaNormalizedKg: 0 };
  }

  if (delta <= toleranceKg + FLOAT_EPSILON) {
    return { status: 'unit_equivalent', isPhysicallyEquivalent: true, deltaNormalizedKg: delta };
  }

  return { status: 'meaningful_change', isPhysicallyEquivalent: false, deltaNormalizedKg: delta };
}

export interface ReconcileSessionSnapshotOptions {
  draftSnapshot?: BodyweightSnapshot | null;
  settingsSnapshot?: BodyweightSnapshot | null;
  existingLogSnapshot?: BodyweightSnapshot | null;
  isEditMode: boolean;
  previousLogs?: WorkoutLog[];
  chronology?: PrescriptionTargetChronology | null;
}

/**
 * Safely extracts a numeric timestamp in ms from a WorkoutLog (via createdAt, timestamp-bearing id, or ISO date).
 */
export function extractLogEffectiveTimestampMsForSnapshot(log: {
  id?: string | null;
  date?: string | null;
  createdAt?: string | number | null;
}): number | null {
  if (!log) return null;

  // 1. Explicit createdAt field
  if (log.createdAt !== undefined && log.createdAt !== null) {
    if (typeof log.createdAt === 'number' && Number.isFinite(log.createdAt) && log.createdAt > 0) {
      return log.createdAt;
    }
    if (typeof log.createdAt === 'string') {
      const ts = Date.parse(log.createdAt);
      if (Number.isFinite(ts) && ts > 0) {
        return ts;
      }
    }
  }

  // 2. Timestamp-bearing MetReps ID extraction (e.g. 'log-1724400000000', '1724400000000', 'log-1724400000000-abc')
  if (log.id && typeof log.id === 'string') {
    const str = log.id.trim();
    const match = str.match(/^(?:log-)?(\d{10,16})/);
    if (match) {
      const parsed = parseInt(match[1], 10);
      if (Number.isFinite(parsed) && parsed > 1577836800000 && parsed < 4102444800000) {
        return parsed;
      }
    }
  }

  // 3. Full ISO datetime parsing ONLY when date contains an explicit time component (e.g. "2026-08-23T14:30:00.000Z")
  if (log.date && typeof log.date === 'string') {
    const dateTrimmed = log.date.trim();
    const isoDateTimeMatch = dateTrimmed.match(/^\d{4}-\d{2}-\d{2}[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (isoDateTimeMatch) {
      const hours = parseInt(isoDateTimeMatch[1], 10);
      const minutes = parseInt(isoDateTimeMatch[2], 10);
      const seconds = isoDateTimeMatch[3] ? parseInt(isoDateTimeMatch[3], 10) : 0;
      if (
        hours >= 0 && hours <= 23 &&
        minutes >= 0 && minutes <= 59 &&
        seconds >= 0 && seconds <= 59
      ) {
        const parsed = Date.parse(dateTrimmed);
        if (Number.isFinite(parsed) && parsed > 1577836800000) {
          return parsed;
        }
      }
    }
  }

  return null;
}

/**
 * Pure helper to determine whether a candidate WorkoutLog occurred prior to the target workout session.
 */
export function isLogChronologicallyEligibleForSnapshot(
  candidate: WorkoutLog,
  chronology?: PrescriptionTargetChronology | null,
  logs: WorkoutLog[] = []
): boolean {
  if (!candidate || !candidate.date) {
    return false;
  }

  if (!chronology) {
    return true; // Backward compatibility fallback
  }

  const candidateDate = candidate.date.trim();
  const targetDate = (chronology.displayedDate || '').trim();

  // Candidate is on a strictly FUTURE calendar date relative to target date
  if (candidateDate > targetDate) {
    return false;
  }

  // Candidate is on a strictly EARLIER calendar date relative to target date
  if (candidateDate < targetDate) {
    return true;
  }

  // Candidate is on the EXACT SAME calendar date as target date
  if (chronology.mode === 'historical_edit') {
    if (candidate.id && candidate.id === chronology.targetLogId) {
      return false;
    }
    const matchingTargets = logs.filter(l => l && l.id && l.id === chronology.targetLogId);
    if (matchingTargets.length !== 1) {
      return false;
    }
    const targetLog = matchingTargets[0];
    const targetTs = extractLogEffectiveTimestampMsForSnapshot(targetLog);
    const candidateTs = extractLogEffectiveTimestampMsForSnapshot(candidate);
    if (targetTs === null || candidateTs === null) {
      return false;
    }
    return candidateTs < targetTs;
  }

  if (chronology.mode === 'active_live') {
    const candidateTs = extractLogEffectiveTimestampMsForSnapshot(candidate);
    if (candidateTs !== null) {
      return candidateTs < chronology.sessionStartedAt;
    }
    return false;
  }

  if (chronology.mode === 'retrospective_new') {
    if (chronology.explicitTargetTimestamp !== undefined && chronology.explicitTargetTimestamp !== null) {
      const candidateTs = extractLogEffectiveTimestampMsForSnapshot(candidate);
      if (candidateTs !== null) {
        return candidateTs < chronology.explicitTargetTimestamp;
      }
    }
    return false;
  }

  return false;
}

/**
 * Pure resolver for the most recent chronologically eligible valid historical WorkoutLog.bodyweightSnapshot.
 */
export function resolveHistoricalBodyweightSnapshot(
  previousLogs: WorkoutLog[],
  chronology?: PrescriptionTargetChronology | null
): BodyweightSnapshot | null {
  if (!previousLogs || !Array.isArray(previousLogs) || previousLogs.length === 0) {
    return null;
  }

  // 1. Filter chronologically eligible logs
  const eligibleLogs = previousLogs.filter(log =>
    isLogChronologicallyEligibleForSnapshot(log, chronology, previousLogs)
  );

  if (eligibleLogs.length === 0) {
    return null;
  }

  // 2. Sort chronologically descending: date descending, then timestamp descending, then id descending
  const sorted = [...eligibleLogs].sort((a, b) => {
    const dateComp = (b.date || '').localeCompare(a.date || '');
    if (dateComp !== 0) return dateComp;

    const tsA = extractLogEffectiveTimestampMsForSnapshot(a) ?? 0;
    const tsB = extractLogEffectiveTimestampMsForSnapshot(b) ?? 0;
    if (tsA !== tsB) return tsB - tsA;

    return (b.id || '').localeCompare(a.id || '');
  });

  // 3. Find the first log with a valid bodyweightSnapshot
  for (const log of sorted) {
    if (log.bodyweightSnapshot) {
      const valid = validateBodyweightSnapshot(log.bodyweightSnapshot);
      if (valid) {
        return {
          value: valid.value,
          unit: valid.unit,
          timestamp: valid.timestamp || log.date,
        };
      }
    }
  }

  return null;
}

/**
 * Reconciles an active workout snapshot across Draft, Settings, Historical Logs, and Edit Mode inputs.
 *
 * Authority Order for Unsaved Session (New Session / Active Draft):
 * 1. Active Draft Snapshot (if user entered/modified or restored a valid snapshot in draft)
 * 2. Current Bodyweight stored in Settings
 * 3. Most recent chronologically eligible valid historical WorkoutLog.bodyweightSnapshot
 * 4. Unknown (null)
 *
 * Rules:
 * 1. Historical Edit Mode:
 *    - Valid existing snapshot -> preserve it exactly.
 *    - Explicit null -> preserve null.
 *    - Absent legacy field (undefined) -> preserve undefined.
 *    - Live Settings and historical fallback are completely ignored.
 *
 * 2. Unsaved Workout (New Session or Active Draft):
 *    - Valid draft snapshot -> adopt draft snapshot.
 *    - Explicit null in draft -> return null.
 *    - Valid Settings value -> adopt Settings.
 *    - Historical fallback -> adopt most recent chronologically eligible log's snapshot.
 *    - None available -> return explicit null.
 *
 * Idempotent: repeated calls produce identical results.
 */
export function reconcileSessionSnapshot(
  options: ReconcileSessionSnapshotOptions
): BodyweightSnapshot | null | undefined {
  const { draftSnapshot, settingsSnapshot, existingLogSnapshot, isEditMode, previousLogs = [], chronology } = options;

  if (isEditMode) {
    if (existingLogSnapshot === undefined) return undefined;
    if (existingLogSnapshot === null) return null;
    const validExisting = validateBodyweightSnapshot(existingLogSnapshot);
    return validExisting ? { value: validExisting.value, unit: validExisting.unit, timestamp: validExisting.timestamp } : null;
  }

  // Tier 1: Active Draft Snapshot
  const validDraft = draftSnapshot ? validateBodyweightSnapshot(draftSnapshot) : null;
  if (validDraft) {
    return { value: validDraft.value, unit: validDraft.unit, timestamp: validDraft.timestamp };
  }
  if (draftSnapshot === null) {
    return null;
  }

  // Tier 2: Current Settings Bodyweight
  const validSettings = settingsSnapshot ? validateBodyweightSnapshot(settingsSnapshot) : null;
  if (validSettings) {
    return { value: validSettings.value, unit: validSettings.unit };
  }

  // Tier 3: Chronologically Eligible Historical Log Snapshot
  if (previousLogs && previousLogs.length > 0) {
    const historicalSnapshot = resolveHistoricalBodyweightSnapshot(previousLogs, chronology);
    if (historicalSnapshot) {
      return historicalSnapshot;
    }
  }

  // Tier 4: Unknown
  return null;
}

/**
 * Pure resolver for the active session bodyweight in the target unit.
 *
 * Rules:
 * - Valid snapshot -> converted finite positive value.
 * - Null, undefined or invalid snapshot -> null.
 * - Never reads storage.
 * - Never defaults to 75.
 * - Never mutates input.
 */
export function resolveSessionBodyweightInUnit(
  snapshot: BodyweightSnapshot | null | undefined,
  activeUnit: WeightUnit
): number | null {
  if (!snapshot) return null;
  const valid = validateBodyweightSnapshot(snapshot);
  if (!valid) return null;
  if (activeUnit !== 'kg' && activeUnit !== 'lb') return null;
  const targetUnit = activeUnit as WeightUnit;
  const converted = convertWeightUnit(valid.value, valid.unit, targetUnit);
  if (typeof converted !== 'number' || !Number.isFinite(converted) || isNaN(converted) || converted <= 0) {
    return null;
  }
  return Math.round(converted * 10) / 10;
}

/**
 * Pure generator for bodyweight Auto Warmup targets.
 *
 * Formula:
 * For working repetitions R:
 *   c1 = min(3, max(1, round(R * 0.20)), R - 1)
 *   c2 = min(5, max(1, round(R * 0.35)), R - 1)
 *   c3 = min(8, max(1, round(R * 0.50)), R - 1)
 *
 * Rules:
 * - Weight is strictly 0.
 * - Repetitions are positive integers strictly below R.
 * - Deduplicated and ascending order.
 * - RPE mapping: 3 sets -> [4.0, 6.0, 7.0]; 2 sets -> [5.0, 6.5]; 1 set -> [5.0].
 * - R < 2 or invalid -> bypassed with reason.
 */
export function generateBodyweightWarmupTargets(
  workingReps: number | null | undefined
): BodyweightWarmupResult {
  if (
    workingReps === null ||
    workingReps === undefined ||
    typeof workingReps !== 'number' ||
    !Number.isFinite(workingReps) ||
    isNaN(workingReps) ||
    !Number.isInteger(workingReps) ||
    workingReps <= 0
  ) {
    return {
      status: 'bypassed',
      warmupTargets: null,
      bypassReason: 'invalid_working_reps',
    };
  }

  if (workingReps < 2) {
    return {
      status: 'bypassed',
      warmupTargets: null,
      bypassReason: 'insufficient_repetition_resolution',
    };
  }

  const maxAllowed = workingReps - 1;
  const c1 = Math.min(3, Math.min(maxAllowed, Math.max(1, Math.round(workingReps * 0.20))));
  const c2 = Math.min(5, Math.min(maxAllowed, Math.max(1, Math.round(workingReps * 0.35))));
  const c3 = Math.min(8, Math.min(maxAllowed, Math.max(1, Math.round(workingReps * 0.50))));

  const rawCandidates = [c1, c2, c3].filter(c => c > 0 && c <= maxAllowed);
  const uniqueAscendingReps = Array.from(new Set(rawCandidates)).sort((a, b) => a - b);

  if (uniqueAscendingReps.length === 0) {
    return {
      status: 'bypassed',
      warmupTargets: null,
      bypassReason: 'insufficient_repetition_resolution',
    };
  }

  let rpes: number[] = [];
  if (uniqueAscendingReps.length === 3) {
    rpes = [4.0, 6.0, 7.0];
  } else if (uniqueAscendingReps.length === 2) {
    rpes = [5.0, 6.5];
  } else {
    rpes = [5.0];
  }

  const warmupTargets: BodyweightWarmupTarget[] = uniqueAscendingReps.map((reps, idx) => ({
    setNumber: idx + 1,
    weight: 0,
    reps,
    rpe: rpes[idx],
    form: 'standard',
    isWarmup: true,
  }));

  return {
    status: 'valid',
    warmupTargets,
  };
}
