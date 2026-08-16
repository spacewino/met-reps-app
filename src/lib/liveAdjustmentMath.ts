import { calculateE1RMForSet, getRTSMultiplier, isValidRPE } from './rpeMath';
import { roundToNearest25 } from './weightMath';
import {
  FatiguePriorProfile,
  SessionAnchor,
  getFatiguePrior,
  distributeHypertrophySets,
  distributeStrengthSets,
  distributePeakSingleStrengthSets,
} from './setDistribution';

/**
 * Immutable snapshot of a scheduled or calculated target for a specific working set ordinal.
 */
export interface LiveTargetSnapshot {
  workingSetOrdinal: number; // 1..6
  weight: number;            // positive finite number
  reps: number;              // positive integer
  rpe: number;               // 6.0..10.0
}

/**
 * Committed user performance captured at the moment of explicit RPE selection.
 */
export interface CommittedLiveEvidence {
  workingSetOrdinal: number;
  weight?: number | null;
  reps?: number | null;
  rpe?: number | null;
  form?: 'strict' | 'standard' | 'loose' | null;
  isWarmup?: boolean | null;
  isSkipped?: boolean | null;
  isDropSet?: boolean | null;
  dropSubSets?: Array<{ reps: number; weight: number; rpe: number }> | null;
}

/**
 * Input parameters for pure intra-session live adjustment calculation.
 */
export interface LiveAdjustmentParams {
  objective: 'Hypertrophy' | 'Strength';
  algorithmId: 'hypertrophy_linear' | 'hypertrophy_step' | 'strength_undulating' | 'strength_linear' | string;
  profileType: FatiguePriorProfile;
  baselineE1RM: number;
  movementCategory?: 'compound' | 'isolation' | string;
  equipment?: 'freeweight' | 'machine' | string;
  modality?: string;
  isMainMovement?: boolean;
  prescribedTargets: LiveTargetSnapshot[];
  currentTargets: LiveTargetSnapshot[];
  committedEvidence: CommittedLiveEvidence[];
  triggeringWorkingSetOrdinal: number;
}

/**
 * Detailed diagnostic statistics for validation and unit testing.
 */
export interface LiveAdjustmentDiagnostics {
  rawReadiness: number;
  clampedReadiness: number;
  upwardCap: number;
  observedDeltas: number[];
  medianObservedDelta: number;
  confidenceWeight: number;
  blendedFatigueRatios: number[];
  plannedSet1E1RM: number;
  actualSet1E1RM: number;
}

/**
 * Result returned by calculateLiveSetAdjustments.
 */
export interface LiveAdjustmentResult {
  status: 'adjusted' | 'no_change' | 'bypassed' | 'invalid_evidence';
  candidateTargets: LiveTargetSnapshot[];
  changedWorkingSetOrdinals: number[];
  restorePrescribedOrdinals: number[];
  shouldNotify: boolean;
  sessionReadiness: number;
  validEvidenceCount: number;
  bypassReason?: string;
  invalidReason?: string;
  diagnostics?: LiveAdjustmentDiagnostics;
}

/**
 * Helper to compute the median of a non-empty array of numbers.
 */
function calculateMedian(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Pure deterministic engine for live intra-session target adjustments.
 * Evaluates committed performance evidence, computes session readiness, applies
 * conservative prior-weighted blending (shrinkage toward the prior), and recalculates
 * untouched future working-set targets.
 */
export function calculateLiveSetAdjustments(params: LiveAdjustmentParams): LiveAdjustmentResult {
  const {
    objective,
    algorithmId,
    profileType,
    baselineE1RM,
    movementCategory,
    equipment,
    modality,
    isMainMovement,
    prescribedTargets,
    currentTargets,
    committedEvidence,
    triggeringWorkingSetOrdinal,
  } = params;

  // 1. Modality Eligibility Guard
  if (modality !== undefined && modality !== 'weighted') {
    return {
      status: 'bypassed',
      candidateTargets: currentTargets ? [...currentTargets] : [],
      changedWorkingSetOrdinals: [],
      restorePrescribedOrdinals: [],
      shouldNotify: false,
      sessionReadiness: 1.0,
      validEvidenceCount: 0,
      bypassReason: 'unsupported_modality',
    };
  }

  // 2. Algorithm and Objective Matching Guard
  const isHypertrophy = objective === 'Hypertrophy';
  const isStrength = objective === 'Strength';

  if (isHypertrophy) {
    if (algorithmId !== 'hypertrophy_linear' && algorithmId !== 'hypertrophy_step') {
      return {
        status: 'bypassed',
        candidateTargets: currentTargets ? [...currentTargets] : [],
        changedWorkingSetOrdinals: [],
        restorePrescribedOrdinals: [],
        shouldNotify: false,
        sessionReadiness: 1.0,
        validEvidenceCount: 0,
        bypassReason: 'invalid_algorithm_objective_pairing',
      };
    }
  } else if (isStrength) {
    if (algorithmId !== 'strength_undulating' && algorithmId !== 'strength_linear') {
      return {
        status: 'bypassed',
        candidateTargets: currentTargets ? [...currentTargets] : [],
        changedWorkingSetOrdinals: [],
        restorePrescribedOrdinals: [],
        shouldNotify: false,
        sessionReadiness: 1.0,
        validEvidenceCount: 0,
        bypassReason: 'invalid_algorithm_objective_pairing',
      };
    }
    // Strength Accessory Bypass
    if (isMainMovement !== true) {
      return {
        status: 'bypassed',
        candidateTargets: currentTargets ? [...currentTargets] : [],
        changedWorkingSetOrdinals: [],
        restorePrescribedOrdinals: [],
        shouldNotify: false,
        sessionReadiness: 1.0,
        validEvidenceCount: 0,
        bypassReason: 'strength_accessory_bypassed',
      };
    }
  } else {
    return {
      status: 'bypassed',
      candidateTargets: currentTargets ? [...currentTargets] : [],
      changedWorkingSetOrdinals: [],
      restorePrescribedOrdinals: [],
      shouldNotify: false,
      sessionReadiness: 1.0,
      validEvidenceCount: 0,
      bypassReason: 'unsupported_objective',
    };
  }

  // 3. Baseline Capacity and Triggering Ordinal Guard
  if (typeof baselineE1RM !== 'number' || !Number.isFinite(baselineE1RM) || baselineE1RM <= 0) {
    return {
      status: 'bypassed',
      candidateTargets: currentTargets ? [...currentTargets] : [],
      changedWorkingSetOrdinals: [],
      restorePrescribedOrdinals: [],
      shouldNotify: false,
      sessionReadiness: 1.0,
      validEvidenceCount: 0,
      bypassReason: 'invalid_baseline_capacity',
    };
  }

  if (
    typeof triggeringWorkingSetOrdinal !== 'number' ||
    !Number.isInteger(triggeringWorkingSetOrdinal) ||
    triggeringWorkingSetOrdinal < 1 ||
    triggeringWorkingSetOrdinal > 6
  ) {
    return {
      status: 'bypassed',
      candidateTargets: currentTargets ? [...currentTargets] : [],
      changedWorkingSetOrdinals: [],
      restorePrescribedOrdinals: [],
      shouldNotify: false,
      sessionReadiness: 1.0,
      validEvidenceCount: 0,
      bypassReason: 'invalid_triggering_ordinal',
    };
  }

  // 4. Prescribed Target Snapshots Guard
  if (!Array.isArray(prescribedTargets) || prescribedTargets.length === 0) {
    return {
      status: 'bypassed',
      candidateTargets: currentTargets ? [...currentTargets] : [],
      changedWorkingSetOrdinals: [],
      restorePrescribedOrdinals: [],
      shouldNotify: false,
      sessionReadiness: 1.0,
      validEvidenceCount: 0,
      bypassReason: 'missing_prescribed_targets',
    };
  }

  const prescribedSet1 = prescribedTargets.find((t) => t.workingSetOrdinal === 1);
  if (
    !prescribedSet1 ||
    typeof prescribedSet1.weight !== 'number' ||
    prescribedSet1.weight <= 0 ||
    typeof prescribedSet1.reps !== 'number' ||
    prescribedSet1.reps < 1 ||
    typeof prescribedSet1.rpe !== 'number' ||
    !isValidRPE(prescribedSet1.rpe) ||
    prescribedSet1.rpe < 6.0 ||
    prescribedSet1.rpe > 10.0
  ) {
    return {
      status: 'bypassed',
      candidateTargets: currentTargets ? [...currentTargets] : [],
      changedWorkingSetOrdinals: [],
      restorePrescribedOrdinals: [],
      shouldNotify: false,
      sessionReadiness: 1.0,
      validEvidenceCount: 0,
      bypassReason: 'invalid_prescribed_set_1_target',
    };
  }

  // 5. Clean Contiguous Evidence Chain Evaluation
  const evidenceMap = new Map<number, CommittedLiveEvidence>();
  if (Array.isArray(committedEvidence)) {
    for (const ev of committedEvidence) {
      if (ev && typeof ev.workingSetOrdinal === 'number') {
        evidenceMap.set(ev.workingSetOrdinal, ev);
      }
    }
  }

  const validChain: CommittedLiveEvidence[] = [];
  let chainBrokenReason: string | undefined = undefined;

  for (let ord = 1; ord <= 6; ord++) {
    const ev = evidenceMap.get(ord);
    if (!ev) {
      chainBrokenReason = `missing_evidence_for_ordinal_${ord}`;
      break;
    }
    if (ev.isWarmup === true) {
      chainBrokenReason = `warmup_set_at_ordinal_${ord}`;
      break;
    }
    if (ev.isSkipped === true) {
      chainBrokenReason = `skipped_set_at_ordinal_${ord}`;
      break;
    }
    if (typeof ev.weight !== 'number' || !Number.isFinite(ev.weight) || ev.weight <= 0) {
      chainBrokenReason = `invalid_weight_at_ordinal_${ord}`;
      break;
    }
    if (typeof ev.reps !== 'number' || !Number.isInteger(ev.reps) || ev.reps < 1) {
      chainBrokenReason = `invalid_reps_at_ordinal_${ord}`;
      break;
    }
    if (typeof ev.rpe !== 'number' || !isValidRPE(ev.rpe) || ev.rpe < 6.0 || ev.rpe > 10.0) {
      chainBrokenReason = `invalid_rpe_at_ordinal_${ord}`;
      break;
    }
    if (ev.form === 'loose') {
      chainBrokenReason = `loose_form_at_ordinal_${ord}`;
      break;
    }
    if (ev.isDropSet === true || (Array.isArray(ev.dropSubSets) && ev.dropSubSets.length > 0)) {
      chainBrokenReason = `drop_set_at_ordinal_${ord}`;
      break;
    }

    validChain.push(ev);
  }

  // 6. Handle Zero Valid Working-Set Evidence (Invalid Recommitment Path)
  if (validChain.length === 0) {
    const restorePrescribedOrdinals: number[] = [];
    const restoredCandidates: LiveTargetSnapshot[] = [];

    for (const cur of currentTargets || []) {
      if (cur.workingSetOrdinal > 1) {
        const pres = prescribedTargets.find((p) => p.workingSetOrdinal === cur.workingSetOrdinal);
        if (pres) {
          if (
            pres.weight !== cur.weight ||
            pres.reps !== cur.reps ||
            pres.rpe !== cur.rpe
          ) {
            restorePrescribedOrdinals.push(cur.workingSetOrdinal);
          }
          restoredCandidates.push({ ...pres });
        } else {
          restoredCandidates.push({ ...cur });
        }
      } else {
        restoredCandidates.push({ ...cur });
      }
    }

    return {
      status: 'invalid_evidence',
      candidateTargets: restoredCandidates,
      changedWorkingSetOrdinals: [],
      restorePrescribedOrdinals,
      shouldNotify: false,
      sessionReadiness: 1.0,
      validEvidenceCount: 0,
      invalidReason: chainBrokenReason || 'no_valid_working_set_evidence',
    };
  }

  // 7. Calculate Readiness from Prescribed vs Actual Set 1
  const plannedSet1E1RM = calculateE1RMForSet(
    prescribedSet1.weight,
    prescribedSet1.reps,
    prescribedSet1.rpe
  );
  const actualSet1 = validChain[0];
  const actualSet1E1RM = calculateE1RMForSet(
    actualSet1.weight!,
    actualSet1.reps!,
    actualSet1.rpe!
  );

  if (
    typeof plannedSet1E1RM !== 'number' ||
    !Number.isFinite(plannedSet1E1RM) ||
    plannedSet1E1RM <= 0 ||
    typeof actualSet1E1RM !== 'number' ||
    !Number.isFinite(actualSet1E1RM) ||
    actualSet1E1RM <= 0
  ) {
    return {
      status: 'bypassed',
      candidateTargets: currentTargets ? [...currentTargets] : [],
      changedWorkingSetOrdinals: [],
      restorePrescribedOrdinals: [],
      shouldNotify: false,
      sessionReadiness: 1.0,
      validEvidenceCount: validChain.length,
      bypassReason: 'invalid_calculated_e1rm',
    };
  }

  const rawReadiness = actualSet1E1RM / plannedSet1E1RM;
  const priorRatios = getFatiguePrior(profileType);

  // Evaluate individual readiness for each valid set in the contiguous chain
  let allSetsAbove100 = true;
  const EPSILON = 1e-6;

  for (let k = 1; k <= validChain.length; k++) {
    const setEv = validChain[k - 1];
    const actualE1RM_k = calculateE1RMForSet(setEv.weight!, setEv.reps!, setEv.rpe!);
    if (typeof actualE1RM_k !== 'number' || actualE1RM_k <= 0) {
      allSetsAbove100 = false;
      continue;
    }
    const priorRatio_k = priorRatios[k - 1] ?? 1.0;
    const expectedE1RM_k = plannedSet1E1RM * priorRatio_k;
    const individualReadiness_k = actualE1RM_k / expectedE1RM_k;

    if (individualReadiness_k < 1.0 - EPSILON) {
      allSetsAbove100 = false;
    }
  }

  // Determine Upward Cap based on chain length and consistency
  let upwardCap: number;
  if (validChain.length === 1) {
    upwardCap = 1.025; // 1 valid committed set cap (+2.5%)
  } else {
    // 2 or more contiguous valid sets
    if (allSetsAbove100) {
      upwardCap = 1.05; // 2+ consistent sets cap (+5.0%)
    } else {
      upwardCap = 1.00; // Inconsistent multi-set evidence cap (0.0%)
    }
  }

  const downwardFloor = 0.85; // Downward safety floor (-15.0%)
  const clampedReadiness = Math.max(downwardFloor, Math.min(upwardCap, rawReadiness));
  const adjustedBaselineE1RM = baselineE1RM * clampedReadiness;

  // 8. Conservative Fatigue Blending (Shrinkage Toward the Prior)
  const observedDeltas: number[] = [];
  for (let k = 2; k <= validChain.length; k++) {
    const setEv = validChain[k - 1];
    const actualE1RM_k = calculateE1RMForSet(setEv.weight!, setEv.reps!, setEv.rpe!);
    if (typeof actualE1RM_k === 'number' && actualE1RM_k > 0) {
      const observedRatio_k = actualE1RM_k / actualSet1E1RM;
      const priorRatio_k = priorRatios[k - 1] ?? 1.0;
      observedDeltas.push(observedRatio_k - priorRatio_k);
    }
  }

  let confidenceWeight = 0.0;
  if (validChain.length === 2) {
    confidenceWeight = 0.33;
  } else if (validChain.length === 3) {
    confidenceWeight = 0.66;
  } else if (validChain.length >= 4) {
    confidenceWeight = 0.85;
  }

  const medianObservedDelta = calculateMedian(observedDeltas);
  const blendedFatigueRatios: number[] = [1.000];

  for (let ord = 2; ord <= 6; ord++) {
    const priorRatio_i = priorRatios[ord - 1] ?? 0.85;
    const rawBlended = priorRatio_i + confidenceWeight * medianObservedDelta;
    const clampedBlended = Math.max(0.70, Math.min(1.00, rawBlended));
    // Monotonically non-increasing constraint
    const finalRatio = Math.min(blendedFatigueRatios[ord - 2], clampedBlended);
    blendedFatigueRatios.push(finalRatio);
  }

  // 9. Reconstruct Targets for Future Working Set Ordinals
  const totalWorkingSetCount = Math.max(
    ...prescribedTargets.map((p) => p.workingSetOrdinal),
    ...validChain.map((v) => v.workingSetOrdinal),
    validChain.length
  );

  const anchorMultiplier = getRTSMultiplier(prescribedSet1.reps, prescribedSet1.rpe);
  if (anchorMultiplier === null || anchorMultiplier <= 0) {
    return {
      status: 'bypassed',
      candidateTargets: currentTargets ? [...currentTargets] : [],
      changedWorkingSetOrdinals: [],
      restorePrescribedOrdinals: [],
      shouldNotify: false,
      sessionReadiness: clampedReadiness,
      validEvidenceCount: validChain.length,
      bypassReason: 'invalid_anchor_multiplier',
    };
  }

  const rawAnchorWeight = prescribedSet1.weight;
  const roundedAnchorWeight = prescribedSet1.weight;

  const anchor: SessionAnchor = {
    algorithmId: algorithmId as any,
    profileType,
    baselineE1RM: adjustedBaselineE1RM,
    rawAnchorWeight,
    roundedAnchorWeight,
    anchorReps: prescribedSet1.reps,
    anchorRPE: prescribedSet1.rpe,
    workingSetCount: Math.min(6, totalWorkingSetCount),
    movementCategory: movementCategory as any,
    equipment: equipment as any,
    modality: modality as any,
  };

  let distributedTargets: Array<{ workingSetOrdinal: number; reps: number; rpe: number; weight: number }> | null = null;

  if (isHypertrophy) {
    distributedTargets = distributeHypertrophySets(anchor, blendedFatigueRatios);
  } else if (isStrength) {
    if (profileType === 'strength_post_test') {
      distributedTargets = distributePeakSingleStrengthSets(anchor, blendedFatigueRatios);
    } else {
      distributedTargets = distributeStrengthSets(anchor, blendedFatigueRatios);
    }
  }

  if (!distributedTargets) {
    return {
      status: 'bypassed',
      candidateTargets: currentTargets ? [...currentTargets] : [],
      changedWorkingSetOrdinals: [],
      restorePrescribedOrdinals: [],
      shouldNotify: false,
      sessionReadiness: clampedReadiness,
      validEvidenceCount: validChain.length,
      bypassReason: 'distribution_generation_failed',
    };
  }

  // 10. Enforce Peak-Single Upward Lock & Construct Candidate Target List
  const candidateTargets: LiveTargetSnapshot[] = [];
  const changedWorkingSetOrdinals: number[] = [];

  for (let ord = 1; ord <= totalWorkingSetCount; ord++) {
    if (ord <= validChain.length) {
      // Completed / triggering working set rows retain current displayed targets or committed values
      const cur = currentTargets?.find((c) => c.workingSetOrdinal === ord);
      if (cur) {
        candidateTargets.push({ ...cur });
      } else {
        const pres = prescribedTargets.find((p) => p.workingSetOrdinal === ord);
        candidateTargets.push(pres ? { ...pres } : {
          workingSetOrdinal: ord,
          weight: validChain[ord - 1].weight!,
          reps: validChain[ord - 1].reps!,
          rpe: validChain[ord - 1].rpe!,
        });
      }
    } else {
      // Future working sets: retrieve recalculated target
      const gen = distributedTargets.find((g) => g.workingSetOrdinal === ord);
      const pres = prescribedTargets.find((p) => p.workingSetOrdinal === ord);
      const cur = currentTargets?.find((c) => c.workingSetOrdinal === ord);

      // Mandatory No-Change / No-Drift Invariant:
      // If readiness is 1.0 and no fatigue delta exists (exact match with plan),
      // ensure we strictly preserve the immutable prescribed target values.
      let finalWeight = gen ? gen.weight : (cur?.weight ?? pres?.weight ?? 0);
      let finalReps = gen ? gen.reps : (cur?.reps ?? pres?.reps ?? 0);
      let finalRPE = gen ? gen.rpe : (cur?.rpe ?? pres?.rpe ?? 8.0);

      // Guard: Peak single (1 rep @ >= 9.5) must never be increased above prescribed target
      if (pres && pres.reps === 1 && pres.rpe >= 9.5) {
        if (finalWeight > pres.weight) {
          finalWeight = pres.weight;
        }
      }

      if (
        Math.abs(clampedReadiness - 1.0) < EPSILON &&
        confidenceWeight === 0 &&
        pres
      ) {
        finalWeight = pres.weight;
        finalReps = pres.reps;
        finalRPE = pres.rpe;
      }

      const candidate: LiveTargetSnapshot = {
        workingSetOrdinal: ord,
        weight: finalWeight,
        reps: finalReps,
        rpe: finalRPE,
      };
      candidateTargets.push(candidate);

      // Compare against current displayed targets
      if (cur) {
        if (
          cur.weight !== candidate.weight ||
          cur.reps !== candidate.reps ||
          cur.rpe !== candidate.rpe
        ) {
          changedWorkingSetOrdinals.push(ord);
        }
      } else if (pres) {
        if (
          pres.weight !== candidate.weight ||
          pres.reps !== candidate.reps ||
          pres.rpe !== candidate.rpe
        ) {
          changedWorkingSetOrdinals.push(ord);
        }
      }
    }
  }

  const hasChanges = changedWorkingSetOrdinals.length > 0;

  return {
    status: hasChanges ? 'adjusted' : 'no_change',
    candidateTargets,
    changedWorkingSetOrdinals,
    restorePrescribedOrdinals: [],
    shouldNotify: hasChanges,
    sessionReadiness: clampedReadiness,
    validEvidenceCount: validChain.length,
    diagnostics: {
      rawReadiness,
      clampedReadiness,
      upwardCap,
      observedDeltas,
      medianObservedDelta,
      confidenceWeight,
      blendedFatigueRatios,
      plannedSet1E1RM,
      actualSet1E1RM,
    },
  };
}
