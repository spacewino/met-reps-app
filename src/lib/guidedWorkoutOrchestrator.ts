/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BodyweightSnapshot,
  ExerciseEntry,
  ExerciseModality,
  GuidedCoachingReasonCode,
  PrescriptionSnapshot,
  Program,
  SetEntry,
  WeightUnit,
  WorkoutLog,
} from '../types';
import {
  CURRENT_ALGORITHM_VERSION,
  CURRENT_PRESCRIPTION_SNAPSHOT_VERSION,
  CURRENT_PROGRESSION_POLICY_VERSION,
  isValidRollbackTarget,
  isValidSnapshotStepMetadata,
  resolveProgramProgressionMode,
} from './programProgressionMode';
import { isValidTargetSnapshot } from './guidedHistoryCollector';
import {
  adaptGuidedExercisePrescription,
  GuidedAdapterErrorCode,
  GuidedAdapterFailureKind,
  GuidedExerciseAdapterGuidedAppliedResult,
  GuidedExerciseAdapterGuidedBypassedResult,
  GuidedExerciseAdapterGuidedInvalidInputFallbackResult,
  GuidedExerciseAdapterFailureFallbackResult,
  GuidedExerciseAdapterInput,
  GuidedExerciseAdapterPerformanceLedResult,
  GuidedExerciseAdapterResult,
  isPrescribedWorkingSet,
} from './guidedRuntimeAdapter';
import {
  BasePrescriptionSet,
  ClosedPeriodisationLaneContext,
  GuidedBypassReason,
  GuidedConstructionContext,
  GuidedSessionKind,
} from './guidedTargetSelector';
import {
  calculateObjectivePrescriptionBundle,
  CalculateObjectiveSetsParams,
  ObjectivePrescriptionBundle,
} from './objectiveMath';
import {
  ActivePrescriptionBoundary,
  resolveLivePrescriptionBoundary,
} from './workoutDraftBoundary';
import {
  getGuidedCanonicalIncrement,
  resolveGuidedCanonicalIncrement,
} from './modalityTargetMath';
import { resolveSessionBodyweightInUnit } from './bodyweightSessionMath';
import { SessionAnchor } from './setDistribution';

// ============================================================================
// 1. LIFECYCLE EVIDENCE & STATE DEFINITIONS
// ============================================================================

/**
 * Closed lifecycle state union for exercise prescription in an active workout session.
 * Derived internally by classifyExercisePrescriptionLifecycle; never supplied by caller.
 */
export type ExerciseLifecycleState =
  | 'historical_locked'
  | 'redo_locked'
  | 'malformed_snapshot_locked'
  | 'restored_committed'
  | 'active_committed'
  | 'already_evaluated'
  | 'fresh_uncommitted';

/**
 * Factual origin/provenance of an exercise within the current session.
 */
export type ExerciseOriginProvenance =
  | 'session_template_init'     // Loaded from program day template at session start
  | 'user_added_library'        // Added by user via exercise selector during session
  | 'user_added_blank'          // Added by user via "+ Add Exercise" blank button
  | 'user_replaced_library'     // Substituted into an existing slot via exercise selector
  | 'restored_from_draft'       // Restored from a persisted workout draft
  | 'historical_log_entry';     // Loaded for historical log editing

/**
 * Closed structural mutation categories committing an exercise to active_committed.
 */
export type ExerciseStructuralMutationReason =
  | 'set_added'
  | 'set_deleted'
  | 'set_reordered'
  | 'warmup_structure_changed'
  | 'drop_set_structure_changed'
  | 'drop_subsets_changed'
  | 'other_exercise_structure_changed';

/**
 * Canonical hold coaching reasons from GuidedCoachingReasonCode.
 */
export type GuidedHoldCoachingReasonCode =
  | 'CHALLENGE_CAP_HOLD'
  | 'HIGH_EXERTION_HOLD'
  | 'STEP_OUT_BASE_ONLY'
  | 'BODYWEIGHT_CEILING_HOLD'
  | 'BODYWEIGHT_MAIN_LOAD_HOLD'
  | 'MINIMUM_ASSISTANCE_REACHED'
  | 'MISSING_BODYWEIGHT_HOLD'
  | 'INVALID_ASSISTANCE_HOLD'
  | 'ZERO_NET_LOAD_HOLD'
  | 'MARGINAL_MISS_TARGET_HELD'
  | 'NUDGE_MARGINAL_FAILURE_ROLLBACK'
  | 'NUDGE_SUBSTANTIAL_FAILURE_ROLLBACK'
  | 'DEGRADED_HISTORY_HOLD'
  | 'INCONSISTENT_HISTORY_HOLD';

/**
 * Canonical applied / progression coaching reasons from GuidedCoachingReasonCode.
 */
export type GuidedAppliedCoachingReasonCode =
  | 'BASE_PRESCRIPTION'
  | 'REP_NUDGE'
  | 'LOAD_NUDGE_MAIN_MOVEMENT'
  | 'LOAD_PROMOTION_CEILING_REACHED'
  | 'NUDGE_NEUTRAL_RETRY';

export const GUIDED_HOLD_COACHING_REASONS: ReadonlySet<GuidedHoldCoachingReasonCode> = new Set([
  'CHALLENGE_CAP_HOLD',
  'HIGH_EXERTION_HOLD',
  'STEP_OUT_BASE_ONLY',
  'BODYWEIGHT_CEILING_HOLD',
  'BODYWEIGHT_MAIN_LOAD_HOLD',
  'MINIMUM_ASSISTANCE_REACHED',
  'MISSING_BODYWEIGHT_HOLD',
  'INVALID_ASSISTANCE_HOLD',
  'ZERO_NET_LOAD_HOLD',
  'MARGINAL_MISS_TARGET_HELD',
  'NUDGE_MARGINAL_FAILURE_ROLLBACK',
  'NUDGE_SUBSTANTIAL_FAILURE_ROLLBACK',
  'DEGRADED_HISTORY_HOLD',
  'INCONSISTENT_HISTORY_HOLD',
]);

export const GUIDED_APPLIED_COACHING_REASONS: ReadonlySet<GuidedAppliedCoachingReasonCode> = new Set([
  'BASE_PRESCRIPTION',
  'REP_NUDGE',
  'LOAD_NUDGE_MAIN_MOVEMENT',
  'LOAD_PROMOTION_CEILING_REACHED',
  'NUDGE_NEUTRAL_RETRY',
]);

// Compile-time assertions that GuidedHoldCoachingReasonCode and GuidedAppliedCoachingReasonCode
// form an exact, exhaustive partition of GuidedCoachingReasonCode with zero overlap.
type _AssertUnionEqual<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false;
type _AssertDisjoint<T, U> = [Extract<T, U>] extends [never] ? true : false;

type _CheckHoldAppliedPartition = _AssertUnionEqual<
  GuidedHoldCoachingReasonCode | GuidedAppliedCoachingReasonCode,
  GuidedCoachingReasonCode
>;
type _CheckHoldAppliedDisjoint = _AssertDisjoint<
  GuidedHoldCoachingReasonCode,
  GuidedAppliedCoachingReasonCode
>;

const _partitionCheck: _CheckHoldAppliedPartition = true;
const _disjointCheck: _CheckHoldAppliedDisjoint = true;
void _partitionCheck;
void _disjointCheck;

export function isGuidedHoldCoachingReason(
  code: GuidedCoachingReasonCode
): code is GuidedHoldCoachingReasonCode {
  return GUIDED_HOLD_COACHING_REASONS.has(code as GuidedHoldCoachingReasonCode);
}

export function isGuidedAppliedCoachingReason(
  code: GuidedCoachingReasonCode
): code is GuidedAppliedCoachingReasonCode {
  return GUIDED_APPLIED_COACHING_REASONS.has(code as GuidedAppliedCoachingReasonCode);
}

/**
 * Canonical selector invalid-input error codes from selectGuidedPrescription.
 * Exhaustively derived from all 29 invalid-input return sites in guidedTargetSelector.ts.
 */
export type GuidedSelectorErrorCode =
  | 'MALFORMED_INPUT'
  | 'MISSING_EXERCISE'
  | 'INVALID_EXERCISE_KEY'
  | 'UNRECOGNIZED_MODALITY'
  | 'MISSING_CONSTRUCTION'
  | 'CONSTRUCTION_MODALITY_MISMATCH'
  | 'INVALID_CANONICAL_INCREMENT'
  | 'INVALID_BASE_SETS'
  | 'INVALID_BASE_SET_ENTRY'
  | 'NON_CONTIGUOUS_ORDINALS'
  | 'INVALID_BASE_REPS'
  | 'INVALID_BASE_RPE'
  | 'INVALID_BASE_WEIGHT'
  | 'INVALID_WEIGHTED_LOAD'
  | 'INVALID_BODYWEIGHT_LOAD'
  | 'MISSING_PERIODISATION_LANE'
  | 'PERIODISATION_ALGORITHM_MISMATCH'
  | 'INVALID_SESSION_ANCHOR'
  | 'ANCHOR_ALGORITHM_MISMATCH'
  | 'ANCHOR_SET_COUNT_MISMATCH'
  | 'ANCHOR_WEIGHT_MISMATCH'
  | 'ANCHOR_REPS_MISMATCH'
  | 'ANCHOR_MODALITY_MISMATCH'
  | 'ANCHOR_EQUIPMENT_MISMATCH'
  | 'INVALID_WEIGHTED_BODYWEIGHT_SNAPSHOT'
  | 'OFF_DAY_OBJECTIVE_CONTRADICTION'
  | 'ACTIVE_SESSION_OBJECTIVE_CONTRADICTION'
  | 'INVALID_LANE_KEY_GENERATION'
  | 'INVALID_PROVISIONAL_SNAPSHOT';

export const GUIDED_SELECTOR_ERROR_CODES: ReadonlySet<GuidedSelectorErrorCode> = new Set([
  'MALFORMED_INPUT',
  'MISSING_EXERCISE',
  'INVALID_EXERCISE_KEY',
  'UNRECOGNIZED_MODALITY',
  'MISSING_CONSTRUCTION',
  'CONSTRUCTION_MODALITY_MISMATCH',
  'INVALID_CANONICAL_INCREMENT',
  'INVALID_BASE_SETS',
  'INVALID_BASE_SET_ENTRY',
  'NON_CONTIGUOUS_ORDINALS',
  'INVALID_BASE_REPS',
  'INVALID_BASE_RPE',
  'INVALID_BASE_WEIGHT',
  'INVALID_WEIGHTED_LOAD',
  'INVALID_BODYWEIGHT_LOAD',
  'MISSING_PERIODISATION_LANE',
  'PERIODISATION_ALGORITHM_MISMATCH',
  'INVALID_SESSION_ANCHOR',
  'ANCHOR_ALGORITHM_MISMATCH',
  'ANCHOR_SET_COUNT_MISMATCH',
  'ANCHOR_WEIGHT_MISMATCH',
  'ANCHOR_REPS_MISMATCH',
  'ANCHOR_MODALITY_MISMATCH',
  'ANCHOR_EQUIPMENT_MISMATCH',
  'INVALID_WEIGHTED_BODYWEIGHT_SNAPSHOT',
  'OFF_DAY_OBJECTIVE_CONTRADICTION',
  'ACTIVE_SESSION_OBJECTIVE_CONTRADICTION',
  'INVALID_LANE_KEY_GENERATION',
  'INVALID_PROVISIONAL_SNAPSHOT',
]);

export function isGuidedSelectorErrorCode(code: string): code is GuidedSelectorErrorCode {
  return GUIDED_SELECTOR_ERROR_CODES.has(code as GuidedSelectorErrorCode);
}

/**
 * Fully discriminated closed evaluation outcome union.
 */
export interface BaseOnlyEvaluationOutcome {
  readonly kind: 'base_only';
  readonly reason: BaseOnlyReason;
}

export interface GuidedAppliedEvaluationOutcome {
  readonly kind: 'guided_applied';
  readonly adapterStatus: 'guided_applied';
  readonly coachingReasonCode: GuidedAppliedCoachingReasonCode;
}

export interface GuidedHoldEvaluationOutcome {
  readonly kind: 'guided_hold';
  readonly adapterStatus: 'guided_applied';
  readonly coachingReasonCode: GuidedHoldCoachingReasonCode;
}

export interface GuidedBypassedEvaluationOutcome {
  readonly kind: 'guided_bypassed';
  readonly adapterStatus: 'guided_bypassed';
  readonly bypassReason: GuidedBypassReason;
}

export interface SelectorFallbackEvaluationOutcome {
  readonly kind: 'selector_fallback';
  readonly errorSource: 'selector';
  readonly selectorError: GuidedSelectorErrorCode;
}

export interface AdapterFallbackEvaluationOutcome {
  readonly kind: 'adapter_fallback';
  readonly errorSource: 'adapter';
  readonly failureKind: GuidedAdapterFailureKind;
  readonly adapterError: GuidedAdapterErrorCode;
}

export type SessionEvaluationOutcome =
  | BaseOnlyEvaluationOutcome
  | GuidedAppliedEvaluationOutcome
  | GuidedHoldEvaluationOutcome
  | GuidedBypassedEvaluationOutcome
  | SelectorFallbackEvaluationOutcome
  | AdapterFallbackEvaluationOutcome;

/**
 * Pure, deterministic current-session evaluation state.
 * Ephemeral in Phase 1: not persisted across browser refresh because draft restoration
 * independently locks rehydrated exercises via `restored_from_draft` provenance.
 */
export type SessionEvaluationState =
  | { readonly status: 'not_evaluated' }
  | {
      readonly status: 'evaluated';
      readonly result: SessionEvaluationOutcome;
    };

/**
 * Factual lifecycle evidence for an exercise, excluding the exercise itself.
 * The authoritative exercise is provided separately to eliminate duplicate authority.
 */
export interface ExerciseLifecycleEvidence {
  readonly originProvenance: ExerciseOriginProvenance;
  readonly isHistoricalEdit: boolean;
  readonly isRedoSession: boolean;
  readonly isRestoredFromDraft: boolean;
  readonly evaluationState: SessionEvaluationState;
  readonly exerciseIndex: number;

  // Set-level activity evidence
  readonly userTouchedSetKeys?: ReadonlySet<string>;
  readonly checkedSetKeys?: ReadonlySet<string>;
  readonly skippedSetKeys?: ReadonlySet<string>;
  readonly hasCommittedLiveEvidence?: boolean;
  readonly hasLiveAdjustedSets?: boolean;
  readonly structuralMutationReason?: ExerciseStructuralMutationReason;
  readonly isStructurallyModified?: boolean;
}

// ============================================================================
// 2. PURE SNAPSHOT INTEGRITY VALIDATOR
// ============================================================================

export interface SnapshotCoherenceResult {
  readonly coherent: boolean;
  readonly error?: string;
}

/**
 * Validates prescribed-working-set snapshot coverage and cross-ordinal coherence.
 * Non-prescribed rows (warmups, drop sets, dropSubSets) are ignored.
 * If no prescribed set has a snapshot, returns coherent: true (normal base state).
 * If any prescribed set has a snapshot, strictly validates:
 *  - 100% 1-to-1 coverage across prescribed sets (no partial snapshots)
 *  - Canonical schema validity via isValidTargetSnapshot and isValidSnapshotStepMetadata
 *  - Contiguous 1..N workingSetOrdinal sequence
 *  - Uniform cross-set metadata (snapshotVersion, algorithmId, comparableLaneKey, exerciseRole, modality)
 *  - Valid rollback targets for advances, null for stable/holds
 */
export function validatePrescribedSnapshotsCoherence(
  sets: readonly SetEntry[] | undefined | null
): SnapshotCoherenceResult {
  if (!Array.isArray(sets) || sets.length === 0) {
    return { coherent: true };
  }

  // Filter prescribed working sets
  const prescribedSets: { set: SetEntry; index: number }[] = [];
  for (let i = 0; i < sets.length; i++) {
    const s = sets[i];
    if (isPrescribedWorkingSet(s)) {
      prescribedSets.push({ set: s, index: i });
    }
  }

  if (prescribedSets.length === 0) {
    return { coherent: true };
  }

  const prescribedWithSnapshots = prescribedSets.filter(
    p => p.set.prescriptionSnapshot !== null && p.set.prescriptionSnapshot !== undefined
  );

  // Normal base state: zero prescribed sets have snapshots
  if (prescribedWithSnapshots.length === 0) {
    return { coherent: true };
  }

  // Fail-closed on partial snapshot coverage
  if (prescribedWithSnapshots.length !== prescribedSets.length) {
    return {
      coherent: false,
      error: `PARTIAL_SNAPSHOT_COVERAGE: ${prescribedWithSnapshots.length}/${prescribedSets.length} prescribed sets have snapshots.`,
    };
  }

  const expectedCount = prescribedSets.length;
  const seenOrdinals = new Set<number>();
  let referenceSnapshot: PrescriptionSnapshot | null = null;

  for (let i = 0; i < prescribedSets.length; i++) {
    const snap = prescribedSets[i].set.prescriptionSnapshot!;

    // 1. Canonical individual snapshot validity
    if (!isValidTargetSnapshot(snap) || !isValidSnapshotStepMetadata(snap)) {
      return {
        coherent: false,
        error: `INVALID_SNAPSHOT_SCHEMA at ordinal index ${i}`,
      };
    }

    // 2. Working set ordinal contiguous sequence 1..N
    const expectedOrdinal = i + 1;
    if (snap.workingSetOrdinal !== expectedOrdinal) {
      return {
        coherent: false,
        error: `ORDINAL_MISMATCH: expected ${expectedOrdinal}, got ${snap.workingSetOrdinal}`,
      };
    }

    if (seenOrdinals.has(snap.workingSetOrdinal)) {
      return {
        coherent: false,
        error: `DUPLICATE_ORDINAL: ${snap.workingSetOrdinal}`,
      };
    }
    seenOrdinals.add(snap.workingSetOrdinal);

    // 3. prescribedWorkingSetCount coherence
    if (snap.prescribedWorkingSetCount !== expectedCount) {
      return {
        coherent: false,
        error: `SET_COUNT_MISMATCH: snapshot declares ${snap.prescribedWorkingSetCount}, actual prescribed sets is ${expectedCount}`,
      };
    }

    // 4. Uniform cross-set metadata
    if (referenceSnapshot === null) {
      referenceSnapshot = snap;
    } else {
      if (
        snap.algorithmId !== referenceSnapshot.algorithmId ||
        snap.comparableLaneKey !== referenceSnapshot.comparableLaneKey ||
        snap.exerciseRole !== referenceSnapshot.exerciseRole ||
        snap.modality !== referenceSnapshot.modality ||
        snap.weightUnit !== referenceSnapshot.weightUnit ||
        snap.snapshotVersion !== referenceSnapshot.snapshotVersion ||
        snap.progressionPolicyVersion !== referenceSnapshot.progressionPolicyVersion ||
        snap.algorithmVersion !== referenceSnapshot.algorithmVersion
      ) {
        return {
          coherent: false,
          error: `CROSS_ORDINAL_METADATA_INCOHERENCE between ordinal 1 and ordinal ${snap.workingSetOrdinal}`,
        };
      }
    }
  }

  return { coherent: true };
}

// ============================================================================
// 3. PURE LIFECYCLE CLASSIFIER
// ============================================================================

/**
 * Classifies an exercise's prescription lifecycle using strict fail-closed precedence.
 * Only 'fresh_uncommitted' is authorized to generate or adapt prescriptions.
 *
 * Precedence:
 * 1. historical_locked
 * 2. redo_locked
 * 3. malformed_snapshot_locked
 * 4. restored_committed
 * 5. active_committed
 * 6. already_evaluated
 * 7. fresh_uncommitted
 */
export function classifyExercisePrescriptionLifecycle(
  exercise: ExerciseEntry,
  evidence: ExerciseLifecycleEvidence
): ExerciseLifecycleState {
  // 1. Historical Edit Hard Lock
  if (evidence.isHistoricalEdit || evidence.originProvenance === 'historical_log_entry') {
    return 'historical_locked';
  }

  // 2. Redo Session Hard Lock
  if (evidence.isRedoSession) {
    return 'redo_locked';
  }

  // 3. Malformed Snapshot Lock (Fail-Closed Protection)
  const coherence = validatePrescribedSnapshotsCoherence(exercise.sets);
  if (!coherence.coherent) {
    return 'malformed_snapshot_locked';
  }

  // 4. Restored Draft Immutability Lock
  if (evidence.isRestoredFromDraft || evidence.originProvenance === 'restored_from_draft') {
    return 'restored_committed';
  }

  // 5. Active Commitment Lock
  // Validate exerciseIndex strictly: must be finite integer >= 0.
  // Missing or invalid index must fail closed to active_committed, never defaulting to 0 or classifying as fresh.
  if (
    typeof evidence.exerciseIndex !== 'number' ||
    !Number.isFinite(evidence.exerciseIndex) ||
    !Number.isInteger(evidence.exerciseIndex) ||
    evidence.exerciseIndex < 0
  ) {
    return 'active_committed';
  }

  // Any structural mutation commits the whole exercise
  if (evidence.structuralMutationReason !== undefined || evidence.isStructurallyModified === true) {
    return 'active_committed';
  }
  if (evidence.hasCommittedLiveEvidence || evidence.hasLiveAdjustedSets) {
    return 'active_committed';
  }

  const exIdx = evidence.exerciseIndex;
  const sets = exercise.sets || [];

  for (let sIdx = 0; sIdx < sets.length; sIdx++) {
    const s = sets[sIdx];
    // Intrinsic set completion flag
    if (s.isCompleted === true) {
      return 'active_committed';
    }

    // Scoped set activity keys
    const idxKey = `${exIdx}-${sIdx}`;

    if (evidence.userTouchedSetKeys && evidence.userTouchedSetKeys.has(idxKey)) {
      return 'active_committed';
    }
    if (evidence.checkedSetKeys && evidence.checkedSetKeys.has(idxKey)) {
      return 'active_committed';
    }
    if (evidence.skippedSetKeys && evidence.skippedSetKeys.has(idxKey)) {
      return 'active_committed';
    }
  }

  // 6. Current-Session Evaluation Lock
  if (evidence.evaluationState.status === 'evaluated') {
    return 'already_evaluated';
  }

  // 7. Fresh Uncommitted (Sole authorized regeneration state)
  return 'fresh_uncommitted';
}

// ============================================================================
// 4. PURE MODALITY & CONSTRUCTION RESOLVER
// ============================================================================

export type OrchestrationConstructionResolution =
  | {
      readonly status: 'resolved';
      readonly construction: GuidedConstructionContext;
      readonly canonicalIncrement: number;
    }
  | {
      readonly status: 'base_only';
      readonly reason:
        | 'MISSING_MODALITY'
        | 'UNRECOGNIZED_MODALITY'
        | 'UNSUPPORTED_MODALITY'
        | 'INVALID_CONSTRUCTION_CONTEXT'
        | 'MISSING_REQUIRED_SESSION_ANCHOR'
        | 'MISSING_REQUIRED_BODYWEIGHT';
      readonly diagnostics?: string;
    };

/**
 * Pure resolver mapping exercise modality and domain context into a valid GuidedConstructionContext.
 * Strict rules:
 * - Missing/empty modality -> MISSING_MODALITY (never defaults to weighted)
 * - Timed/distance/distance_loaded -> UNSUPPORTED_MODALITY
 * - Unrecognized modality -> UNRECOGNIZED_MODALITY
 * - Weighted requiring session anchor -> MISSING_REQUIRED_SESSION_ANCHOR if null/missing
 * - Assisted requiring bodyweight -> MISSING_REQUIRED_BODYWEIGHT if null/missing/non-positive
 * - Bodyweight requiring bodyweight -> MISSING_REQUIRED_BODYWEIGHT if null/missing/non-positive
 */
export function resolveOrchestrationConstructionContext(
  exercise: ExerciseEntry,
  activeUnit: WeightUnit,
  bodyweightSnapshot: BodyweightSnapshot | null,
  sessionAnchor: SessionAnchor | null
): OrchestrationConstructionResolution {
  const modality = exercise.modality;

  if (!modality || typeof modality !== 'string' || modality.trim() === '') {
    return { status: 'base_only', reason: 'MISSING_MODALITY', diagnostics: 'Modality is missing or empty.' };
  }

  if (modality === 'timed' || modality === 'distance' || modality === 'distance_loaded') {
    return { status: 'base_only', reason: 'UNSUPPORTED_MODALITY', diagnostics: `Modality "${modality}" is unsupported for Guided progression.` };
  }

  if (modality !== 'weighted' && modality !== 'assisted' && modality !== 'bodyweight') {
    return { status: 'base_only', reason: 'UNRECOGNIZED_MODALITY', diagnostics: `Modality "${modality}" is not recognized.` };
  }

  const canonicalInc = getGuidedCanonicalIncrement(modality, activeUnit);
  if (canonicalInc === null || !Number.isFinite(canonicalInc) || canonicalInc <= 0) {
    return { status: 'base_only', reason: 'INVALID_CONSTRUCTION_CONTEXT', diagnostics: `Unable to resolve canonical increment for modality "${modality}" in unit "${activeUnit}".` };
  }

  if (modality === 'weighted') {
    if (!sessionAnchor || typeof sessionAnchor !== 'object') {
      return { status: 'base_only', reason: 'MISSING_REQUIRED_SESSION_ANCHOR', diagnostics: 'Weighted Guided progression requires an authoritative SessionAnchor.' };
    }
    const bwKg = resolveSessionBodyweightInUnit(bodyweightSnapshot, 'kg');
    const construction: GuidedConstructionContext = {
      kind: 'weighted',
      sessionAnchor,
      bodyweightSnapshot: bwKg !== null && bwKg > 0 ? bwKg : null,
    };
    return { status: 'resolved', construction, canonicalIncrement: canonicalInc };
  }

  if (modality === 'assisted') {
    const sessionBW = resolveSessionBodyweightInUnit(bodyweightSnapshot, activeUnit);
    if (sessionBW === null || !Number.isFinite(sessionBW) || sessionBW <= 0) {
      return { status: 'base_only', reason: 'MISSING_REQUIRED_BODYWEIGHT', diagnostics: 'Assisted Guided progression requires a valid positive session bodyweight.' };
    }
    const construction: GuidedConstructionContext = {
      kind: 'assisted',
      sessionBodyweight: sessionBW,
    };
    return { status: 'resolved', construction, canonicalIncrement: canonicalInc };
  }

  // modality === 'bodyweight'
  const sessionBW = resolveSessionBodyweightInUnit(bodyweightSnapshot, activeUnit);
  if (sessionBW === null || !Number.isFinite(sessionBW) || sessionBW <= 0) {
    return { status: 'base_only', reason: 'MISSING_REQUIRED_BODYWEIGHT', diagnostics: 'Pure bodyweight Guided progression requires a valid positive session bodyweight.' };
  }
  const construction: GuidedConstructionContext = {
    kind: 'bodyweight',
    sessionBodyweight: sessionBW,
  };
  return { status: 'resolved', construction, canonicalIncrement: canonicalInc };
}

// ============================================================================
// 5. ORCHESTRATION INPUT & RESULT CONTRACTS
// ============================================================================

export type BaseOnlyReason =
  | 'ONE_OFF'
  | 'PERFORMANCE_LED'
  | 'OFF_OBJECTIVE'
  | 'DELOAD_OBJECTIVE'
  | 'BOUNDARY_UNAVAILABLE'
  | 'MISSING_MODALITY'
  | 'UNRECOGNIZED_MODALITY'
  | 'UNSUPPORTED_MODALITY'
  | 'INVALID_CONSTRUCTION_CONTEXT'
  | 'MISSING_REQUIRED_SESSION_ANCHOR'
  | 'MISSING_REQUIRED_BODYWEIGHT';

export interface OrchestrateGuidedExerciseInput {
  // Authoritative exercise
  readonly exercise: ExerciseEntry;
  // Factual lifecycle evidence
  readonly lifecycleEvidence: ExerciseLifecycleEvidence;

  // Domain context
  readonly program: Program | null;
  readonly programs: readonly Program[];
  readonly historicalLogs: readonly WorkoutLog[];
  readonly boundary: ActivePrescriptionBoundary | null;
  readonly sessionKind: GuidedSessionKind;

  // Parameters for calculateObjectivePrescriptionBundle
  readonly activeUnit: WeightUnit;
  readonly bodyweightSnapshot: BodyweightSnapshot | null;
  readonly objective: 'Off' | 'Hypertrophy' | 'Strength' | 'Deload';
  readonly weekNum: number;
  readonly programDuration: number;

  readonly dayNum?: number | string | null;
  readonly targetDate?: string | null;
  readonly targetLogId?: string | null;
  readonly templateExercise?: ExerciseEntry;

  // Pure dependency injection seams for hermetic test call-count assertions
  readonly calculateBundleFn?: (params: CalculateObjectiveSetsParams) => ObjectivePrescriptionBundle;
  readonly adaptPrescriptionFn?: (input: GuidedExerciseAdapterInput) => GuidedExerciseAdapterResult;
}

export type PreservedUnchangedLifecycleState =
  | 'historical_locked'
  | 'redo_locked'
  | 'malformed_snapshot_locked'
  | 'restored_committed'
  | 'active_committed'
  | 'already_evaluated';

export interface OrchestratedPreservedResult {
  readonly status: 'preserved_unchanged';
  readonly exercise: ExerciseEntry;
  readonly appliedSets: readonly SetEntry[];
  readonly lifecycleState: PreservedUnchangedLifecycleState;
  readonly nextEvaluationState: SessionEvaluationState;
  readonly bundleCalculated: false;
  readonly adapterCalled: false;
}

export interface OrchestratedBaseOnlyResult {
  readonly status: 'base_only';
  readonly exercise: ExerciseEntry;
  readonly appliedSets: readonly SetEntry[];
  readonly reason: BaseOnlyReason;
  readonly nextEvaluationState: SessionEvaluationState;
  readonly bundleCalculated: true;
  readonly adapterCalled: false;
  readonly diagnostics?: {
    readonly errorCode?: string;
    readonly errorMessage?: string;
  };
}

export interface OrchestratedGuidedAdapterResult {
  readonly status: 'guided_adapter_result';
  readonly exercise: ExerciseEntry;
  readonly appliedSets: readonly SetEntry[];
  readonly adapterResult: GuidedExerciseAdapterResult;
  readonly nextEvaluationState: SessionEvaluationState;
  readonly bundleCalculated: true;
  readonly adapterCalled: true;
}

export type OrchestratedExerciseResult =
  | OrchestratedPreservedResult
  | OrchestratedBaseOnlyResult
  | OrchestratedGuidedAdapterResult;

// ============================================================================
// 6. HELPER CLONERS
// ============================================================================

function cloneSetDeep(s: SetEntry): SetEntry {
  const cloned: SetEntry = { ...s };
  if (Array.isArray(s.dropSubSets)) {
    cloned.dropSubSets = s.dropSubSets.map(sub => ({ ...sub }));
  }
  if (s.prescriptionSnapshot) {
    cloned.prescriptionSnapshot = {
      ...s.prescriptionSnapshot,
      rollbackTarget: s.prescriptionSnapshot.rollbackTarget
        ? { ...s.prescriptionSnapshot.rollbackTarget }
        : null,
    };
  }
  return cloned;
}

function cloneSetsDeep(sets: readonly SetEntry[] | undefined | null): SetEntry[] {
  if (!Array.isArray(sets)) return [];
  return sets.map(cloneSetDeep);
}

function cloneExerciseDeep(ex: ExerciseEntry, newSets?: SetEntry[]): ExerciseEntry {
  return {
    ...ex,
    sets: newSets !== undefined ? newSets : cloneSetsDeep(ex.sets),
  };
}

function stripSnapshots(sets: readonly SetEntry[]): SetEntry[] {
  return sets.map(s => {
    const c = cloneSetDeep(s);
    c.prescriptionSnapshot = null;
    return c;
  });
}

// ============================================================================
// 7. PURE ORCHESTRATOR
// ============================================================================

/**
 * Pure, isolated Guided workout orchestrator.
 * Enforces lifecycle classification before any bundle calculation.
 * Preserves non-fresh exercises verbatim with zero bundle and zero adapter calls.
 * Ensures Off and Deload never enter Guided evaluation.
 * Guarantees atomic snapshot application or safe base fallback with no partial snapshots.
 */
export function orchestrateGuidedExercisePrescription(
  input: OrchestrateGuidedExerciseInput
): OrchestratedExerciseResult {
  const { exercise, lifecycleEvidence } = input;

  // 1. Classify lifecycle state using strict internal precedence
  const lifecycleState = classifyExercisePrescriptionLifecycle(exercise, lifecycleEvidence);

  // 2. Non-fresh preservation gates (MUST precede every regenerating branch)
  if (lifecycleState !== 'fresh_uncommitted') {
    const sets = cloneSetsDeep(exercise.sets);
    return {
      status: 'preserved_unchanged',
      exercise: cloneExerciseDeep(exercise, sets),
      appliedSets: sets,
      lifecycleState,
      nextEvaluationState: lifecycleEvidence.evaluationState,
      bundleCalculated: false,
      adapterCalled: false,
    };
  }

  // 3. Fresh uncommitted exercise: Calculate base prescription bundle EXACTLY ONCE
  const calculateBundle = input.calculateBundleFn ?? calculateObjectivePrescriptionBundle;
  const bundleParams: CalculateObjectiveSetsParams = {
    exercise,
    programId: input.program?.id ?? null,
    algorithmId: input.program?.algorithmId,
    previousLogs: input.historicalLogs as WorkoutLog[],
    activeUnit: input.activeUnit,
    bodyweightSnapshot: input.bodyweightSnapshot,
    objective: input.objective,
    weekNum: input.weekNum,
    programDuration: input.programDuration,
    dayNum: input.dayNum,
    targetDate: input.targetDate,
    targetLogId: input.targetLogId,
    templateExercise: input.templateExercise,
  };

  const bundle = calculateBundle(bundleParams);
  const cleanBaseSets = stripSnapshots(bundle.baseSets);

  // 4. One-off session check -> Base-only
  if (input.sessionKind.type === 'one_off') {
    return {
      status: 'base_only',
      exercise: cloneExerciseDeep(exercise, cleanBaseSets),
      appliedSets: cleanBaseSets,
      reason: 'ONE_OFF',
      nextEvaluationState: {
        status: 'evaluated',
        result: {
          kind: 'base_only',
          reason: 'ONE_OFF',
        },
      },
      bundleCalculated: true,
      adapterCalled: false,
    };
  }

  // 5. Progression mode check -> Base-only if performance-led or program missing
  const progressionMode = resolveProgramProgressionMode(input.program);
  if (progressionMode === 'performance_led' || !input.program) {
    return {
      status: 'base_only',
      exercise: cloneExerciseDeep(exercise, cleanBaseSets),
      appliedSets: cleanBaseSets,
      reason: 'PERFORMANCE_LED',
      nextEvaluationState: {
        status: 'evaluated',
        result: {
          kind: 'base_only',
          reason: 'PERFORMANCE_LED',
        },
      },
      bundleCalculated: true,
      adapterCalled: false,
    };
  }

  // 6. Explicit Off and Deload check -> Base-only (Zero adapter calls, zero snapshots)
  if (input.objective === 'Off') {
    return {
      status: 'base_only',
      exercise: cloneExerciseDeep(exercise, cleanBaseSets),
      appliedSets: cleanBaseSets,
      reason: 'OFF_OBJECTIVE',
      nextEvaluationState: {
        status: 'evaluated',
        result: {
          kind: 'base_only',
          reason: 'OFF_OBJECTIVE',
        },
      },
      bundleCalculated: true,
      adapterCalled: false,
    };
  }

  if (input.objective === 'Deload') {
    return {
      status: 'base_only',
      exercise: cloneExerciseDeep(exercise, cleanBaseSets),
      appliedSets: cleanBaseSets,
      reason: 'DELOAD_OBJECTIVE',
      nextEvaluationState: {
        status: 'evaluated',
        result: {
          kind: 'base_only',
          reason: 'DELOAD_OBJECTIVE',
        },
      },
      bundleCalculated: true,
      adapterCalled: false,
    };
  }

  // 7. Active prescription boundary check -> Base-only if unavailable
  const boundaryResolution = resolveLivePrescriptionBoundary(input.boundary);
  if (boundaryResolution.status !== 'valid') {
    return {
      status: 'base_only',
      exercise: cloneExerciseDeep(exercise, cleanBaseSets),
      appliedSets: cleanBaseSets,
      reason: 'BOUNDARY_UNAVAILABLE',
      nextEvaluationState: {
        status: 'evaluated',
        result: {
          kind: 'base_only',
          reason: 'BOUNDARY_UNAVAILABLE',
        },
      },
      bundleCalculated: true,
      adapterCalled: false,
    };
  }

  // 8. Modality and Construction resolution
  const constructionResolution = resolveOrchestrationConstructionContext(
    exercise,
    input.activeUnit,
    input.bodyweightSnapshot,
    bundle.sessionAnchor
  );

  if (constructionResolution.status !== 'resolved') {
    return {
      status: 'base_only',
      exercise: cloneExerciseDeep(exercise, cleanBaseSets),
      appliedSets: cleanBaseSets,
      reason: constructionResolution.reason,
      nextEvaluationState: {
        status: 'evaluated',
        result: {
          kind: 'base_only',
          reason: constructionResolution.reason,
        },
      },
      bundleCalculated: true,
      adapterCalled: false,
      diagnostics: {
        errorCode: constructionResolution.reason,
        errorMessage: constructionResolution.diagnostics,
      },
    };
  }

  // 9. Periodisation lane context validation
  if (!bundle.periodisationLane) {
    return {
      status: 'base_only',
      exercise: cloneExerciseDeep(exercise, cleanBaseSets),
      appliedSets: cleanBaseSets,
      reason: 'INVALID_CONSTRUCTION_CONTEXT',
      nextEvaluationState: {
        status: 'evaluated',
        result: {
          kind: 'base_only',
          reason: 'INVALID_CONSTRUCTION_CONTEXT',
        },
      },
      bundleCalculated: true,
      adapterCalled: false,
      diagnostics: {
        errorCode: 'MISSING_PERIODISATION_LANE',
        errorMessage: 'Bundle did not provide an authoritative periodisation lane.',
      },
    };
  }

  // 10. Invoke Guided Runtime Adapter EXACTLY ONCE
  const adaptPrescription = input.adaptPrescriptionFn ?? adaptGuidedExercisePrescription;
  const adapterInput: GuidedExerciseAdapterInput = {
    exercise,
    baseSets: cleanBaseSets,
    program: input.program,
    programs: input.programs,
    historicalLogs: input.historicalLogs,
    boundary: boundaryResolution.boundary,
    sessionKind: input.sessionKind,
    activeUnit: input.activeUnit,
    canonicalIncrement: constructionResolution.canonicalIncrement,
    periodisationLane: bundle.periodisationLane,
    construction: constructionResolution.construction,
  };

  const adapterResult = adaptPrescription(adapterInput);

  // Map deterministic next evaluation state based on adapter outcome
  let nextEvalResult: SessionEvaluationOutcome;
  if (adapterResult.status === 'guided_applied') {
    if (isGuidedHoldCoachingReason(adapterResult.coachingReasonCode)) {
      nextEvalResult = {
        kind: 'guided_hold',
        adapterStatus: 'guided_applied',
        coachingReasonCode: adapterResult.coachingReasonCode,
      };
    } else {
      nextEvalResult = {
        kind: 'guided_applied',
        adapterStatus: 'guided_applied',
        coachingReasonCode: adapterResult.coachingReasonCode as GuidedAppliedCoachingReasonCode,
      };
    }
  } else if (adapterResult.status === 'guided_bypassed') {
    nextEvalResult = {
      kind: 'guided_bypassed',
      adapterStatus: 'guided_bypassed',
      bypassReason: adapterResult.bypassReason,
    };
  } else if (adapterResult.status === 'performance_led_unchanged') {
    nextEvalResult = {
      kind: 'base_only',
      reason: 'PERFORMANCE_LED',
    };
  } else if (adapterResult.status === 'guided_invalid_input_fallback') {
    const rawError = adapterResult.selectorError;
    const selectorError: GuidedSelectorErrorCode = isGuidedSelectorErrorCode(rawError)
      ? rawError
      : 'MALFORMED_INPUT';
    nextEvalResult = {
      kind: 'selector_fallback',
      errorSource: 'selector',
      selectorError,
    };
  } else {
    // guided_adapter_failure_fallback
    nextEvalResult = {
      kind: 'adapter_fallback',
      errorSource: 'adapter',
      failureKind: adapterResult.failureKind,
      adapterError: adapterResult.adapterError,
    };
  }

  return {
    status: 'guided_adapter_result',
    exercise: adapterResult.exercise,
    appliedSets: adapterResult.appliedSets,
    adapterResult,
    nextEvaluationState: {
      status: 'evaluated',
      result: nextEvalResult,
    },
    bundleCalculated: true,
    adapterCalled: true,
  };
}
