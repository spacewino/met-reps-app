import { ExerciseEntry, Program } from '../types';

/**
 * Validates whether an exercise is eligible to be designated as a Strength Main Movement.
 * 
 * An eligible Strength Main Movement must:
 * 1. Not be skipped (isSkipped !== true)
 * 2. Have a modality of 'weighted' or undefined (which defaults to 'weighted')
 * 
 * Non-weighted modalities (bodyweight, assisted, timed, distance, distance_loaded) are ineligible.
 */
export function isEligibleStrengthMainMovement(ex: ExerciseEntry): boolean {
  if (ex.isSkipped) return false;
  const modality = ex.modality || 'weighted';
  return modality === 'weighted';
}

/**
 * Computes the number of eligible exercises currently designated as Main Movement.
 */
export function getEligibleMainMovementCount(exercises: ExerciseEntry[]): number {
  if (!exercises || !Array.isArray(exercises)) return 0;
  return exercises.filter(ex => !!ex.isMainMovement && isEligibleStrengthMainMovement(ex)).length;
}

export interface UpdateProgramDayMainMovementResult {
  success: boolean;
  updatedProgram: Program;
  error?: string;
}

/**
 * Pure metadata-only update that updates exclusively the `isMainMovement` flags
 * on a specified program day within a Program template.
 * 
 * Strictly preserves:
 * - Template weights, reps, and RPE
 * - Set counts and set ordering
 * - Form, comments, warm-ups, drop sets, dropSubSets
 * - Movement category, equipment, modality, superset configuration
 * - All other program days and program-level properties
 * 
 * Exercise identity is resolved via:
 * 1. Target index + normalized name verification at that index.
 * 2. If misaligned, fallback to unique normalized name match across the day.
 * 3. Fails safely without modifying storage if ambiguous (0 or >1 matches).
 */
export function updateProgramDayMainMovement(
  program: Program,
  dayNum: number,
  targetIdx: number | null,
  activeExerciseName?: string
): UpdateProgramDayMainMovementResult {
  if (!program || !program.exercisesByDay) {
    return {
      success: false,
      updatedProgram: program,
      error: 'Invalid program definition.',
    };
  }

  const dayExercises = program.exercisesByDay[dayNum];
  if (!dayExercises || !Array.isArray(dayExercises)) {
    return {
      success: false,
      updatedProgram: program,
      error: `Program day ${dayNum} not found in template.`,
    };
  }

  // Case 1: Deselect / Clear all main movements for this day
  if (targetIdx === null) {
    const updatedExercises: ExerciseEntry[] = dayExercises.map(ex => ({
      ...ex,
      isMainMovement: false,
    }));

    return {
      success: true,
      updatedProgram: {
        ...program,
        exercisesByDay: {
          ...program.exercisesByDay,
          [dayNum]: updatedExercises,
        },
      },
    };
  }

  // Case 2: Resolve target exercise identity safely
  let resolvedIdx: number = -1;

  if (activeExerciseName) {
    const normalizedActive = activeExerciseName.trim().toLowerCase();
    const isDirectMatch =
      targetIdx >= 0 &&
      targetIdx < dayExercises.length &&
      dayExercises[targetIdx].name.trim().toLowerCase() === normalizedActive;

    if (isDirectMatch) {
      resolvedIdx = targetIdx;
    } else {
      // Fallback: search for matching exercise name in template
      const matchingIndices: number[] = [];
      dayExercises.forEach((ex, idx) => {
        if (ex.name.trim().toLowerCase() === normalizedActive) {
          matchingIndices.push(idx);
        }
      });

      if (matchingIndices.length === 1) {
        resolvedIdx = matchingIndices[0];
      } else if (matchingIndices.length === 0) {
        return {
          success: false,
          updatedProgram: program,
          error: `Exercise "${activeExerciseName}" could not be found in the program day template.`,
        };
      } else {
        return {
          success: false,
          updatedProgram: program,
          error: `Multiple exercises named "${activeExerciseName}" exist on this program day. Cannot unambiguously resolve Main Movement.`,
        };
      }
    }
  } else {
    if (targetIdx >= 0 && targetIdx < dayExercises.length) {
      resolvedIdx = targetIdx;
    } else {
      return {
        success: false,
        updatedProgram: program,
        error: `Exercise index ${targetIdx} is out of bounds for program day ${dayNum}.`,
      };
    }
  }

  // Mutate strictly isMainMovement on the resolved exercise, setting all others on that day to false
  const updatedExercises: ExerciseEntry[] = dayExercises.map((ex, idx) => ({
    ...ex,
    isMainMovement: idx === resolvedIdx,
  }));

  return {
    success: true,
    updatedProgram: {
      ...program,
      exercisesByDay: {
        ...program.exercisesByDay,
        [dayNum]: updatedExercises,
      },
    },
  };
}
