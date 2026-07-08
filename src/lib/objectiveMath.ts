import { ExerciseEntry, SetEntry, WorkoutLog } from '../types';
import { calculateE1RMForSet } from './workoutClassifier';

// Canonical RTS % 1RM lookup
export const RTS_RPE_PERCENT: Record<number, Record<number, number>> = {
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

interface StrengthProfileWeek {
  reps: number;
  target1RMPercent: number;
  targetRPE: number;
}

const STRENGTH_PROFILES: Record<number, Record<number, StrengthProfileWeek>> = {
  4: {
    1: { reps: 5, target1RMPercent: 0.786, targetRPE: 7.0 },
    2: { reps: 4, target1RMPercent: 0.85, targetRPE: 8.0 },
    3: { reps: 3, target1RMPercent: 0.92, targetRPE: 9.0 },
    4: { reps: 1, target1RMPercent: 1.00, targetRPE: 10.0 },
  },
  6: {
    1: { reps: 5, target1RMPercent: 0.786, targetRPE: 7.0 },
    2: { reps: 3, target1RMPercent: 0.75, targetRPE: 7.0 },
    3: { reps: 3, target1RMPercent: 0.84, targetRPE: 8.0 },
    4: { reps: 2, target1RMPercent: 0.80, targetRPE: 7.5 },
    5: { reps: 2, target1RMPercent: 0.90, targetRPE: 9.0 },
    6: { reps: 1, target1RMPercent: 1.00, targetRPE: 10.0 },
  },
  8: {
    1: { reps: 5, target1RMPercent: 0.786, targetRPE: 7.0 },
    2: { reps: 5, target1RMPercent: 0.815, targetRPE: 8.0 },
    3: { reps: 5, target1RMPercent: 0.85, targetRPE: 9.0 },
    4: { reps: 3, target1RMPercent: 0.80, targetRPE: 7.5 },
    5: { reps: 3, target1RMPercent: 0.88, targetRPE: 8.5 },
    6: { reps: 2, target1RMPercent: 0.84, targetRPE: 8.0 },
    7: { reps: 2, target1RMPercent: 0.92, targetRPE: 9.0 },
    8: { reps: 1, target1RMPercent: 1.00, targetRPE: 10.0 },
  },
  12: {
    1: { reps: 5, target1RMPercent: 0.786, targetRPE: 7.0 },
    2: { reps: 5, target1RMPercent: 0.815, targetRPE: 8.0 },
    3: { reps: 5, target1RMPercent: 0.84, targetRPE: 8.5 },
    4: { reps: 5, target1RMPercent: 0.86, targetRPE: 9.0 },
    5: { reps: 3, target1RMPercent: 0.80, targetRPE: 7.5 },
    6: { reps: 3, target1RMPercent: 0.85, targetRPE: 8.0 },
    7: { reps: 3, target1RMPercent: 0.90, targetRPE: 9.0 },
    8: { reps: 2, target1RMPercent: 0.84, targetRPE: 8.0 },
    9: { reps: 2, target1RMPercent: 0.89, targetRPE: 8.5 },
    10: { reps: 2, target1RMPercent: 0.94, targetRPE: 9.5 },
    11: { reps: 1, target1RMPercent: 0.96, targetRPE: 9.0 },
    12: { reps: 1, target1RMPercent: 1.00, targetRPE: 10.0 },
  }
};

/**
 * Rounds a weight to the nearest 2.5kg increment
 */
export function roundToNearest25(weight: number): number {
  return Math.max(0, Math.round(weight / 2.5) * 2.5);
}

/**
 * Fetches the user's e1RM from previous workout logs
 */
export function getPreviousE1RMForExercise(
  exerciseName: string,
  logs: WorkoutLog[]
): number {
  if (!logs || logs.length === 0) return 0;

  const normName = exerciseName.trim().toLowerCase();
  let maxE1RM = 0;

  for (const log of logs) {
    const matchedEx = log.exercises.find(e => e.name.trim().toLowerCase() === normName);
    if (matchedEx && matchedEx.sets) {
      const e1rms = matchedEx.sets
        .filter(s => s.weight && s.reps)
        .map(s => calculateE1RMForSet(s.weight || 0, s.reps || 0, s.rpe || 8));
      if (e1rms.length > 0) {
        const logMax = Math.max(...e1rms);
        if (logMax > maxE1RM) {
          maxE1RM = logMax;
        }
      }
    }
  }
  return maxE1RM;
}

/**
 * Helper to get the RTS multiplier percentage
 */
export function getRTSMultiplier(reps: number, rpe: number): number {
  const roundedRpe = Math.round(rpe * 2) / 2;
  const repData = RTS_RPE_PERCENT[reps];
  if (repData) {
    const pct = repData[roundedRpe];
    if (pct !== undefined) return pct;
  }
  // Fallback linear estimation of RTS chart if missing
  const rir = 10 - rpe;
  return 1 - (reps + rir) * 0.03;
}

/**
 * Applies the Strength, Hypertrophy, or Deload algorithm to an exercise's prefilled sets
 */
export function calculateObjectiveSets(params: {
  objective: 'Off' | 'Hypertrophy' | 'Strength' | 'Deload';
  exercise: ExerciseEntry;
  exerciseIndex: number;
  totalExercises: number;
  weekNum: number;
  programDuration: number;
  previousLogs: WorkoutLog[];
  userTouchedSets: Record<string, boolean>;
  checkedSets: Record<string, boolean>;
  algorithmId?: 'hypertrophy_linear' | 'hypertrophy_step' | 'strength_undulating' | 'strength_linear' | 'none';
}): SetEntry[] {
  const {
    objective,
    exercise,
    exerciseIndex,
    weekNum,
    programDuration,
    previousLogs,
    userTouchedSets,
    checkedSets,
    algorithmId
  } = params;

  // If objective is Off, do not alter anything
  if (objective === 'Off') {
    return exercise.sets;
  }

  // Omit bodyweight, timed, distance modalities from algorithm changes as requested
  if (exercise.modality === 'bodyweight' || exercise.modality === 'timed' || exercise.modality === 'distance') {
    return exercise.sets;
  }

  const previousE1RM = getPreviousE1RMForExercise(exercise.name, previousLogs);

  // We map sets
  return exercise.sets.map((set, setIdx) => {
    const key = `${exerciseIndex}-${setIdx}`;
    // If the set is already touched or checked, do not alter it!
    if (userTouchedSets[key] || checkedSets[key]) {
      return set;
    }

    if (objective === 'Strength') {
      // Strength objective ONLY alters the main movement
      if (!exercise.isMainMovement) {
        return set;
      }

      const activeAlgo = algorithmId || 'strength_undulating';

      if (activeAlgo === 'strength_linear') {
        const maxWeek = programDuration || 8;
        const activeWeek = Math.min(weekNum, maxWeek);
        const progress = maxWeek > 1 ? (activeWeek - 1) / (maxWeek - 1) : 0;

        // Transition smoothly from 8 reps down to 1 rep
        const targetReps = Math.max(1, Math.round(8 - progress * 7));
        // Transition intensity from RPE 7.0 to RPE 10.0, rounded to nearest 0.5
        const targetRPE = Math.round((7.0 + progress * 3.0) * 2) / 2;

        // Transition weight from 70% of 1RM to 100% of 1RM
        const target1RMPercent = 0.70 + progress * 0.30;

        let estE1RM = previousE1RM;
        if (set.weight && set.weight > 0) {
          const currentRpe = set.rpe || 8.0;
          const currentReps = set.reps || 10;
          estE1RM = calculateE1RMForSet(set.weight, currentReps, currentRpe);
        }

        let targetWeight = 0;
        if (estE1RM > 0) {
          targetWeight = roundToNearest25(estE1RM * target1RMPercent);
        } else if (set.weight && set.weight > 0) {
          targetWeight = roundToNearest25(set.weight);
        }

        return {
          ...set,
          reps: targetReps,
          rpe: targetRPE,
          weight: targetWeight,
          form: 'standard' as const
        };
      } else {
        // strength_undulating (Default)
        // Determine strength week profile
        const durationKey = STRENGTH_PROFILES[programDuration] ? programDuration : 8; // default to 8 if custom
        const profile = STRENGTH_PROFILES[durationKey];
        const maxWeek = Math.max(...Object.keys(profile).map(Number));
        const activeWeek = Math.min(weekNum, maxWeek);
        const weekProfile = profile[activeWeek] || profile[1];

        const targetReps = weekProfile.reps;
        const targetRPE = weekProfile.targetRPE;
        const target1RMPercent = weekProfile.target1RMPercent;

        let estE1RM = previousE1RM;
        if (set.weight && set.weight > 0) {
          // Use 1RM formula to convert pre-filled/current weight
          const currentRpe = set.rpe || 8.0;
          const currentReps = set.reps || 10;
          estE1RM = calculateE1RMForSet(set.weight, currentReps, currentRpe);
        }

        let targetWeight = 0;
        if (estE1RM > 0) {
          targetWeight = roundToNearest25(estE1RM * target1RMPercent);
        } else if (set.weight && set.weight > 0) {
          targetWeight = roundToNearest25(set.weight);
        }

        return {
          ...set,
          reps: targetReps,
          rpe: targetRPE,
          weight: targetWeight,
          form: 'standard' as const
        };
      }
    }

    if (objective === 'Hypertrophy') {
      const activeAlgo = algorithmId || 'hypertrophy_linear';
      const isMain = !!exercise.isMainMovement;
      const isSecond = exerciseIndex === 1 || (isMain ? exerciseIndex === 1 : exerciseIndex === 0);

      if (activeAlgo === 'hypertrophy_step') {
        const maxWeek = programDuration || 8;
        const activeWeek = Math.min(weekNum, maxWeek);
        const activeBlock = Math.min(2, Math.floor((activeWeek - 1) / 4));
        const stepNum = ((activeWeek - 1) % 4) + 1;

        let baseReps = 10;
        let baseRPE = 7.5;

        if (activeBlock === 0) {
          // Block 1 (Weeks 1-4): Stepwise RPE / Volume push
          baseReps = stepNum === 4 ? 12 : 10;
          baseRPE = stepNum === 1 ? 7.0 : (stepNum === 2 ? 7.5 : 8.0);
        } else if (activeBlock === 1) {
          // Block 2 (Weeks 5-8): Stepwise reps go down, intensity goes up
          baseReps = stepNum === 4 ? 10 : 8;
          baseRPE = stepNum === 1 ? 7.5 : (stepNum === 2 ? 8.0 : 8.5);
        } else {
          // Block 3 (Weeks 9-12+): Heavy high-threshold motor unit recruitment
          baseReps = stepNum === 4 ? 8 : 6;
          baseRPE = stepNum === 1 ? 8.0 : (stepNum === 2 ? 8.5 : 9.0);
        }

        // Main movements do slightly lower reps (more motor-unit specific) and higher RPE
        const targetReps = isMain ? Math.max(4, baseReps - 2) : baseReps;
        const targetRPE = isMain ? Math.min(10, baseRPE + 0.5) : baseRPE;

        const rtsPct = getRTSMultiplier(targetReps, targetRPE);

        let estE1RM = previousE1RM;
        if (set.weight && set.weight > 0) {
          const currentRpe = set.rpe || 8.0;
          const currentReps = set.reps || (isMain ? 5 : 10);
          estE1RM = calculateE1RMForSet(set.weight, currentReps, currentRpe);
        }

        let targetWeight = 0;
        if (estE1RM > 0) {
          targetWeight = roundToNearest25(estE1RM * rtsPct);
        } else if (set.weight && set.weight > 0) {
          const baselineRtsPct = getRTSMultiplier(isMain ? 8 : (isSecond ? 10 : 12), 8.0);
          const estimatedE1RM = set.weight / baselineRtsPct;
          targetWeight = roundToNearest25(estimatedE1RM * rtsPct);
        }

        return {
          ...set,
          reps: targetReps,
          rpe: targetRPE,
          weight: targetWeight,
          form: 'standard' as const
        };
      } else {
        // hypertrophy_linear (Default)
        // Hypertrophy affects ALL exercises
        // 1. Determine target reps based on week type (odd: Light 15 reps, even: Heavy 10 reps for non-main / 6 reps for main)
        const isOddWeek = weekNum % 2 !== 0;
        let baseReps = 10; // Even week (Heavy) baseline for non-main movements
        if (isMain) {
          baseReps = 6;
        }

        const targetReps = isOddWeek ? 15 : baseReps;
        const targetRPE = 8.0;

        // 2. Calculate target weight based on previous e1RM or template weight
        const rtsPct = getRTSMultiplier(targetReps, targetRPE);

        let estE1RM = previousE1RM;
        if (set.weight && set.weight > 0) {
          const currentRpe = set.rpe || 8.0;
          const currentReps = set.reps || (isMain ? 5 : 10);
          estE1RM = calculateE1RMForSet(set.weight, currentReps, currentRpe);
        }

        let targetWeight = 0;
        if (estE1RM > 0) {
          targetWeight = roundToNearest25(estE1RM * rtsPct);
        } else if (set.weight && set.weight > 0) {
          const baselineRtsPct = getRTSMultiplier(isMain ? 8 : (isSecond ? 10 : 12), 8.0);
          const estimatedE1RM = set.weight / baselineRtsPct;
          targetWeight = roundToNearest25(estimatedE1RM * rtsPct);
        }

        return {
          ...set,
          reps: targetReps,
          rpe: targetRPE,
          weight: targetWeight,
          form: 'standard' as const
        };
      }
    }

    if (objective === 'Deload') {
      // Deload affects ALL exercises. Halving weight, reducing RPE and reps.
      // Set Form to 'strict' as requested.
      const baseWeight = set.weight || 0;
      const baseReps = set.reps || 8;

      const targetWeight = baseWeight > 0 ? roundToNearest25(baseWeight * 0.5) : 0;
      const targetReps = Math.max(1, Math.round(baseReps * 0.6));
      const targetRPE = 5.0; // low intensity

      return {
        ...set,
        reps: targetReps,
        rpe: targetRPE,
        weight: targetWeight,
        form: 'strict' as const // strict form for deload
      };
    }

    return set;
  });
}
