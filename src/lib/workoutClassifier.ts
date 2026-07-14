/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkoutLog, SetEntry } from '../types';

// Standard RPE-to-%1RM Lookup Chart (Reps 1 to 12, RPE 6 to 10 in steps of 0.5)
const RPE_CHART: Record<number, Record<number, number>> = {
  1: { 10: 1.00, 9.5: 0.98, 9.0: 0.96, 8.5: 0.94, 8.0: 0.92, 7.5: 0.91, 7.0: 0.89, 6.5: 0.87, 6.0: 0.86 },
  2: { 10: 0.96, 9.5: 0.94, 9.0: 0.92, 8.5: 0.91, 8.0: 0.89, 7.5: 0.87, 7.0: 0.86, 6.5: 0.84, 6.0: 0.82 },
  3: { 10: 0.92, 9.5: 0.91, 9.0: 0.89, 8.5: 0.87, 8.0: 0.86, 7.5: 0.84, 7.0: 0.82, 6.5: 0.81, 6.0: 0.79 },
  4: { 10: 0.89, 9.5: 0.87, 9.0: 0.86, 8.5: 0.84, 8.0: 0.82, 7.5: 0.81, 7.0: 0.79, 6.5: 0.77, 6.0: 0.76 },
  5: { 10: 0.86, 9.5: 0.84, 9.0: 0.82, 8.5: 0.81, 8.0: 0.79, 7.5: 0.77, 7.0: 0.76, 6.5: 0.74, 6.0: 0.72 },
  6: { 10: 0.83, 9.5: 0.81, 9.0: 0.79, 8.5: 0.77, 8.0: 0.76, 7.5: 0.74, 7.0: 0.72, 6.5: 0.70, 6.0: 0.69 },
  7: { 10: 0.80, 9.5: 0.78, 9.0: 0.76, 8.5: 0.74, 8.0: 0.72, 7.5: 0.70, 7.0: 0.69, 6.5: 0.67, 6.0: 0.65 },
  8: { 10: 0.77, 9.5: 0.75, 9.0: 0.74, 8.5: 0.72, 8.0: 0.70, 7.5: 0.69, 7.0: 0.67, 6.5: 0.65, 6.0: 0.63 },
  9: { 10: 0.74, 9.5: 0.72, 9.0: 0.70, 8.5: 0.69, 8.0: 0.67, 7.5: 0.65, 7.0: 0.63, 6.5: 0.61, 6.0: 0.60 },
  10: { 10: 0.71, 9.5: 0.69, 9.0: 0.67, 8.5: 0.65, 8.0: 0.63, 7.5: 0.61, 7.0: 0.60, 6.5: 0.58, 6.0: 0.56 },
  11: { 10: 0.68, 9.5: 0.66, 9.0: 0.64, 8.5: 0.62, 8.0: 0.60, 7.5: 0.58, 7.0: 0.57, 6.5: 0.55, 6.0: 0.53 },
  12: { 10: 0.65, 9.5: 0.63, 9.0: 0.61, 8.5: 0.59, 8.0: 0.57, 7.5: 0.55, 7.0: 0.54, 6.5: 0.52, 6.0: 0.50 }
};

export type ClassifiedWorkout = {
  category: string;
  categoryDesc: string;
  color: string;
  flags: string[];
  fatigueScore: number;
  performanceIndex: number;
  stats: {
    totalVolume: number;
    workingVolume: number;
    avgRpe: number;
    hardSets: number;
    looseRate: number;
  };
};

/**
 * Calculates effective weight lifted based on exercise modality
 */
export function getEffectiveWeight(weight: number | null | undefined, modality: string, userBodyweight: number | null): number {
  const w = weight || 0;
  const bw = userBodyweight || 75; // Fallback bodyweight if none entered
  
  switch (modality) {
    case 'assisted':
      return Math.max(1, bw - w);
    case 'bodyweight':
      return bw + w;
    case 'timed':
      return w || 1; // secs can act as intensity proxy
    default:
      return w;
  }
}

/**
 * Estimates 1RM for a single set
 */
export function calculateE1RMForSet(weight: number, reps: number, rpe: number): number {
  if (reps <= 0) return 0;
  if (reps === 1 && rpe >= 10) return weight;

  const roundedRpe = Math.round(rpe * 2) / 2;
  const percentChart = RPE_CHART[reps]?.[roundedRpe];

  if (percentChart) {
    return weight / percentChart;
  }

  // Fallback for reps/RPE values outside chart (matches getRTSMultiplier fallback)
  const rir = Math.max(0, 10 - rpe);
  const multiplier = 1 - (reps + rir) * 0.03;
  return weight / Math.max(0.1, multiplier);
}

/**
 * Calculates rolling baseline e1RM for an exercise using previous 4-8 exposures
 */
export function getRollingBaselineE1RM(
  exerciseName: string,
  priorLogs: WorkoutLog[],
  userBodyweight: number | null
): number | null {
  const normName = exerciseName.trim().toLowerCase();
  const topE1RMs: number[] = [];

  // Filter and process chronologically newest first
  const priorLogsNewestFirst = [...priorLogs].sort((a, b) => b.date.localeCompare(a.date));

  for (const log of priorLogsNewestFirst) {
    const matchedEx = log.exercises.find(ex => ex.name.trim().toLowerCase() === normName);
    if (matchedEx && matchedEx.sets && matchedEx.sets.length > 0) {
      let maxSetE1RM = 0;
      matchedEx.sets.forEach(set => {
        const reps = set.reps || 0;
        const rpe = set.rpe || 8;
        const w = set.weight || 0;
        if (reps <= 0) return;

        const effWeight = getEffectiveWeight(w, matchedEx.modality || 'weighted', userBodyweight);
        const e1rm = calculateE1RMForSet(effWeight, reps, rpe);
        if (e1rm > maxSetE1RM) {
          maxSetE1RM = e1rm;
        }
      });

      if (maxSetE1RM > 0) {
        topE1RMs.push(maxSetE1RM);
      }
      if (topE1RMs.length >= 8) {
        break; // Stop at recent 8 exposures
      }
    }
  }

  if (topE1RMs.length === 0) return null;
  const sum = topE1RMs.reduce((a, b) => a + b, 0);
  return sum / topE1RMs.length;
}

/**
 * Classifies a single workout session and computes categories, scores, and flags.
 */
export function classifyWorkout(
  currentLog: WorkoutLog,
  allLogs: WorkoutLog[],
  userBodyweight: number | null
): ClassifiedWorkout {
  // 1. Get all prior workout logs chronologically before this log
  const sortedLogs = [...allLogs].sort((a, b) => a.date.localeCompare(b.date));
  const currentIdx = sortedLogs.findIndex(l => l.id === currentLog.id);
  const priorLogs = currentIdx >= 0 ? sortedLogs.slice(0, currentIdx) : sortedLogs.filter(l => l.date < currentLog.date);

  // Set-level & Session-level accumulator variables
  let totalVolumeLoad = 0;
  let workingVolumeLoad = 0;
  let totalSetsCount = 0;
  let hardSetsCount = 0;
  let looseSetsCount = 0;
  let strictSetsCount = 0;
  let totalRpeSum = 0;
  let setsWithRpeCount = 0;

  // Track exercise performance ratios
  const exercisePerformanceRatios: number[] = [];
  const exerciseMaxRelativeIntensities: number[] = [];

  // Detail collection per set for scoring rules
  const allSetsDetails: Array<{
    reps: number;
    rpe: number;
    weight: number;
    effectiveWeight: number;
    e1RM: number;
    isHighConfidence: boolean;
    relativeIntensity: number;
    performanceRatio: number;
    isHard: boolean;
    form: string;
  }> = [];

  currentLog.exercises.forEach(ex => {
    if (!ex.sets || ex.sets.length === 0) return;
    const modality = ex.modality || 'weighted';

    // Get rolling baseline e1RM for this exercise
    let exerciseRollingBaseline = getRollingBaselineE1RM(ex.name, priorLogs, userBodyweight);
    
    // Find current session top set e1RM to use as fallback baseline if no history (excluding warmups)
    let currentSessionTopE1RM = 0;
    ex.sets.forEach(set => {
      const reps = set.reps || 0;
      const rpe = set.rpe || 8;
      const weight = set.weight || 0;
      if (reps <= 0) return;
      if (set.isWarmup) return;
      const effW = getEffectiveWeight(weight, modality, userBodyweight);
      const e1rm = calculateE1RMForSet(effW, reps, rpe);
      if (e1rm > currentSessionTopE1RM) currentSessionTopE1RM = e1rm;
    });

    const baseline = exerciseRollingBaseline || currentSessionTopE1RM || 1;
    const hasPriorHistory = exerciseRollingBaseline !== null;

    let maxExPerfRatio = 0;
    let maxExRelIntensity = 0;

    ex.sets.forEach(set => {
      const reps = set.reps || 0;
      const rpe = set.rpe || 8;
      const weight = set.weight || 0;
      const form = set.form || 'standard';

      if (reps <= 0) return;

      const effW = getEffectiveWeight(weight, modality, userBodyweight);
      const e1RM = calculateE1RMForSet(effW, reps, rpe);
      const relativeIntensity = effW / baseline;
      const performanceRatio = e1RM / baseline;
      const setVol = effW * reps;

      totalVolumeLoad += setVol;
      totalSetsCount++;

      if (form === 'strict') strictSetsCount++;
      if (form === 'loose') looseSetsCount++;

      const isWarmup = !!set.isWarmup;

      if (!isWarmup) {
        workingVolumeLoad += setVol;

        // Include drop subsets in working and total volume load if this is a working drop set
        if (set.isDropSet && set.dropSubSets && set.dropSubSets.length > 0) {
          set.dropSubSets.forEach(sub => {
            const subReps = sub.reps || 0;
            const subWeight = sub.weight || 0;
            if (subReps > 0) {
              const subEffW = getEffectiveWeight(subWeight, modality, userBodyweight);
              const subVol = subEffW * subReps;
              totalVolumeLoad += subVol;
              workingVolumeLoad += subVol;
            }
          });
        }

        if (set.rpe) {
          totalRpeSum += set.rpe;
          setsWithRpeCount++;
        }

        const isHard = rpe >= 7;
        if (isHard) hardSetsCount++;

        const isHighConfidence = reps >= 1 && reps <= 12 && rpe >= 7 && form !== 'loose';

        allSetsDetails.push({
          reps,
          rpe,
          weight,
          effectiveWeight: effW,
          e1RM,
          isHighConfidence,
          relativeIntensity,
          performanceRatio,
          isHard,
          form
        });

        if (performanceRatio > maxExPerfRatio) maxExPerfRatio = performanceRatio;
        if (relativeIntensity > maxExRelIntensity) maxExRelIntensity = relativeIntensity;
      }
    });

    if (hasPriorHistory && maxExPerfRatio > 0) {
      exercisePerformanceRatios.push(maxExPerfRatio);
    }
    if (maxExRelIntensity > 0) {
      exerciseMaxRelativeIntensities.push(maxExRelIntensity);
    }
  });

  const sessionAvgRpe = setsWithRpeCount > 0 ? (totalRpeSum / setsWithRpeCount) : 7.0;
  const looseFormRate = totalSetsCount > 0 ? (looseSetsCount / totalSetsCount) : 0;
  const strictFormRate = totalSetsCount > 0 ? (strictSetsCount / totalSetsCount) : 0;

  // Session Performance Index: average today's top performance ratios across exercises with history
  const sessionPerformanceIndex = exercisePerformanceRatios.length > 0
    ? (exercisePerformanceRatios.reduce((a, b) => a + b, 0) / exercisePerformanceRatios.length)
    : 1.0;

  // Volumed-weighted average relative intensity
  let volumeWeightedIntensitySum = 0;
  allSetsDetails.forEach(set => {
    volumeWeightedIntensitySum += set.relativeIntensity * (set.effectiveWeight * set.reps);
  });
  const avgRelativeIntensity = totalVolumeLoad > 0 ? (volumeWeightedIntensitySum / totalVolumeLoad) : 0.65;

  // 2. Compute Fatigue Score (1-10)
  const soreness = currentLog.recovery?.soreness || 5; // 1-10
  const workoutQuality = currentLog.recovery?.motivation || 5; // 1-10

  const sorenessPart = (soreness / 10) * 3.5;              // Up to 3.5 pts
  const qualityPart = ((11 - workoutQuality) / 10) * 2.5;   // Up to 2.5 pts (low quality = high fatigue)
  const rpePart = (sessionAvgRpe / 10) * 2.0;               // Up to 2.0 pts
  const formPart = looseFormRate * 1.0;                     // Up to 1.0 pt
  const performancePart = Math.min(1.0, Math.max(0, 1 - sessionPerformanceIndex) * 10); // Up to 1.0 pt

  let fatigueScore = sorenessPart + qualityPart + rpePart + formPart + performancePart;
  fatigueScore = Math.max(1, Math.min(10, Math.round(fatigueScore * 10) / 10));

  // 3. Category Scoring Rules (0-100 pts)
  let scores = {
    peakTest: 0,
    recoveryDeload: 0,
    strengthBuilder: 0,
    hypertrophy: 0,
    techniqueSkill: 0,
    mixedMaintenance: 40 // Baseline score for Mixed/Maintenance
  };

  // Rule: PEAK / TEST
  // Any set with high intensity (95%+) or producing a new e1RM (100%+) on standard/strict form, reps 1-3, RPE 9.5-10
  const hasPeakSet = allSetsDetails.some(set => 
    (set.relativeIntensity >= 0.95 || set.performanceRatio >= 1.00) && 
    set.reps <= 3 && 
    set.rpe >= 9
  );
  if (hasPeakSet) {
    scores.peakTest = 100;
  } else {
    // Partial score for near-peaks
    const nearPeakSet = allSetsDetails.some(set => set.reps <= 4 && set.rpe >= 8.5 && set.relativeIntensity >= 0.90);
    scores.peakTest = nearPeakSet ? 65 : 0;
  }

  // Rule: RECOVERY / DELOAD
  // 65%+ of sets around 40-65% intensity. Avg RPE <= 6. Max 1 hard set. Max 1 set of RPE 8+. Loose form is rare.
  const setsInRecoveryIntensity = allSetsDetails.filter(set => set.relativeIntensity >= 0.35 && set.relativeIntensity <= 0.68).length;
  const pctInRecoveryIntensity = totalSetsCount > 0 ? (setsInRecoveryIntensity / totalSetsCount) : 0;
  const rpe8PlusSets = allSetsDetails.filter(set => set.rpe >= 8).length;

  let recoveryScore = 0;
  if (pctInRecoveryIntensity >= 0.60) recoveryScore += 40;
  if (sessionAvgRpe <= 6.5) recoveryScore += 25;
  if (hardSetsCount <= 1) recoveryScore += 15;
  if (rpe8PlusSets <= 1) recoveryScore += 10;
  if (looseFormRate <= 0.15) recoveryScore += 10;
  if (sessionAvgRpe > 7.5 || hardSetsCount >= 3) {
    recoveryScore = Math.min(recoveryScore, 20); // Cap if hard effort
  }
  scores.recoveryDeload = recoveryScore;

  // Rule: STRENGTH BUILDER
  // Heavy low-rep work: intensity 80-92.5%, reps 1-6, RPE 7-9.5. At least 2 sets.
  const strengthSets = allSetsDetails.filter(set => 
    set.relativeIntensity >= 0.75 && 
    set.relativeIntensity <= 0.95 && 
    set.reps <= 6 && 
    set.rpe >= 7
  ).length;
  const pctStrengthSets = totalSetsCount > 0 ? (strengthSets / totalSetsCount) : 0;

  let strengthScore = 0;
  strengthScore += pctStrengthSets * 50;
  if (strengthSets >= 2) strengthScore += 30;
  if (sessionAvgRpe >= 7 && sessionAvgRpe <= 9.5) strengthScore += 20;
  if (looseFormRate >= 0.25) strengthScore -= 15; // Loose form penalises strength category
  scores.strengthBuilder = Math.max(0, strengthScore);

  // Rule: HYPERTROPHY
  // Dominated by hard volume work, reps 5-30 (especially 6-20), intensity 30-85% (especially 60-80%), RPE 7-9.
  const hypertrophySets = allSetsDetails.filter(set => 
    set.reps >= 5 && 
    set.reps <= 25 && 
    set.rpe >= 6.5 && 
    set.rpe <= 9.5 &&
    set.relativeIntensity >= 0.30 && 
    set.relativeIntensity <= 0.85
  ).length;
  const pctHypertrophySets = totalSetsCount > 0 ? (hypertrophySets / totalSetsCount) : 0;

  let hypertrophyScore = 0;
  hypertrophyScore += pctHypertrophySets * 50;
  if (hardSetsCount >= 3) hypertrophyScore += 30;
  if (sessionAvgRpe >= 7 && sessionAvgRpe <= 9) hypertrophyScore += 20;
  scores.hypertrophy = hypertrophyScore;

  // Rule: TECHNIQUE / SKILL
  // Loads light-moderate 30-70%, RPE is low, strict form, low fatigue, not enough for hypertrophy volume
  const techniqueSets = allSetsDetails.filter(set => 
    set.relativeIntensity >= 0.30 && 
    set.relativeIntensity <= 0.75 && 
    set.rpe <= 6.5 &&
    set.form === 'strict'
  ).length;
  const pctTechniqueSets = totalSetsCount > 0 ? (techniqueSets / totalSetsCount) : 0;

  let techniqueScore = 0;
  techniqueScore += pctTechniqueSets * 40;
  if (sessionAvgRpe <= 6.5) techniqueScore += 30;
  if (strictFormRate >= 0.50) techniqueScore += 20;
  if (hardSetsCount <= 1) techniqueScore += 10;
  scores.techniqueSkill = techniqueScore;

  // 4. Select Primary Category
  let bestCategoryKey: string = 'mixedMaintenance';
  let highestScore = 0;

  (Object.keys(scores) as Array<keyof typeof scores>).forEach(key => {
    if (scores[key] > highestScore) {
      highestScore = scores[key];
      bestCategoryKey = key;
    }
  });

  // Fallback to Mixed/Maintenance if the winning category is weak (score < 50)
  if (highestScore < 50) {
    bestCategoryKey = 'mixedMaintenance';
  }

  // Descriptions, Labels and colors
  let category = 'Mixed / Maintenance';
  let categoryDesc = 'Balanced training session with mixed intensity, volume, or focus.';
  let color = 'text-slate-200 bg-slate-900 border-slate-700 shadow-sm';

  if (bestCategoryKey === 'peakTest') {
    category = 'Peak / Test';
    categoryDesc = 'Intense peak intensity training session. Excellent for testing top-end strength limits.';
    color = 'text-rose-100 bg-rose-950/80 border-rose-500/50 shadow-[0_0_15px_rgba(244,63,94,0.3)] font-black';
  } else if (bestCategoryKey === 'recoveryDeload') {
    category = 'Recovery / Deload Session';
    categoryDesc = 'Lighter recovery-focused session to allow nervous system and muscle regeneration.';
    color = 'text-emerald-100 bg-emerald-950/80 border-emerald-500/50 font-black';
  } else if (bestCategoryKey === 'strengthBuilder') {
    category = 'Strength Builder';
    categoryDesc = 'Heavier low-rep lifting focused on neurological adaptations and absolute strength.';
    color = 'text-indigo-100 bg-indigo-950/80 border-indigo-500/50 font-black';
  } else if (bestCategoryKey === 'hypertrophy') {
    category = 'Hypertrophy';
    categoryDesc = 'Hard working sets in high-stimulus volume ranges optimized for muscle growth.';
    color = 'text-cyan-100 bg-cyan-950/80 border-cyan-500/50 font-black';
  } else if (bestCategoryKey === 'techniqueSkill') {
    category = 'Technique / Skill Practice';
    categoryDesc = 'Sub-maximal motor pattern practice. Focus is on execution, pause reps, or tempo.';
    color = 'text-amber-100 bg-amber-950/80 border-amber-500/50 font-black';
  }

  // 5. Secondary Flags Logic
  const flags: string[] = [];

  // PR / Progressive Overload Flag
  // If e1RM performance is higher than baseline, or user beat records on clean sets
  const isPrSession = allSetsDetails.some(set => set.performanceRatio >= 1.01 && set.form !== 'loose');
  if (isPrSession || sessionPerformanceIndex >= 1.015) {
    flags.push('PR / Progressive Overload');
  }

  // Technical Breakdown Flag
  // Loose form on 25%+ of sets or top set
  const hasLooseTopSet = allSetsDetails.some(set => set.relativeIntensity >= 0.90 && set.form === 'loose');
  if (looseFormRate >= 0.25 || hasLooseTopSet) {
    flags.push('Technical Breakdown');
  }

  // High Fatigue Flag
  // Fatigue score >= 6.5, soreness >= 7, or session average RPE >= 8.5
  if (fatigueScore >= 6.5 || soreness >= 7 || sessionAvgRpe >= 8.5) {
    flags.push('High Fatigue');
  }

  // Deload Recommended & Deload Watch
  // Deload recommended needs BOTH performance concern (<97%) and fatigue concern
  const hasPerformanceConcern = sessionPerformanceIndex < 0.97;
  const hasFatigueConcern = sessionAvgRpe >= 8.2 || soreness >= 7 || workoutQuality <= 5 || looseFormRate >= 0.25;

  if (hasPerformanceConcern && hasFatigueConcern) {
    flags.push('Deload Recommended');
  } else {
    // Deload Watch if fatigue is moderate or slight performance decline
    const isWatchFatigue = fatigueScore >= 5.0 || soreness >= 6 || workoutQuality <= 5 || looseFormRate >= 0.20;
    const isWatchPerformance = sessionPerformanceIndex < 0.95;
    if (isWatchFatigue || isWatchPerformance) {
      flags.push('Deload Watch');
    }
  }

  return {
    category,
    categoryDesc,
    color,
    flags,
    fatigueScore,
    performanceIndex: Math.round(sessionPerformanceIndex * 100),
    stats: {
      totalVolume: Math.round(totalVolumeLoad),
      workingVolume: Math.round(workingVolumeLoad),
      avgRpe: Math.round(sessionAvgRpe * 10) / 10,
      hardSets: hardSetsCount,
      looseRate: Math.round(looseFormRate * 100)
    }
  };
}
