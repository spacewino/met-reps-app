/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Program, WorkoutLog, PlannedSession, AppSettings, WeightUnit } from '../types';
import { getLocalDateString, calculateSessionDate } from './dateUtils';

export const DEFAULT_SETTINGS: AppSettings = {
  highlightCurrentSet: true,
};

export const PREBUILT_TEMPLATES: Program[] = [
  {
    id: 'prog-tpl-milhouse-mass-split',
    name: 'Milhouse Mass Split',
    daysPerWeek: 3,
    programDuration: 4,
    createdAt: '2026-08-24T00:00:00.000Z',
    objective: 'Hypertrophy',
    algorithmId: 'hypertrophy_linear',
    exercisesByDay: {
      1: [
        {
          name: 'Hack Squat (Machine)',
          muscleGroup: 'Quads',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Plate-Loaded Romanian Deadlift',
          muscleGroup: 'Hamstrings',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Standing Calf Raise',
          muscleGroup: 'Calves',
          modality: 'weighted',
          movementCategory: 'isolation',
          equipment: 'freeweight',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Smith Machine Bulgarian Split Squat',
          muscleGroup: 'Quads',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Chest-Supported Row (Dumbbell)',
          muscleGroup: 'Back',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'freeweight',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Lying Leg Curl (Machine)',
          muscleGroup: 'Hamstrings',
          modality: 'weighted',
          movementCategory: 'isolation',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Plate-Loaded Shrug Machine',
          muscleGroup: 'Traps',
          modality: 'weighted',
          movementCategory: 'isolation',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        }
      ],
      2: [
        {
          name: 'Plate-Loaded Chest Press',
          muscleGroup: 'Pecs',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Plate-Loaded Shoulder Press',
          muscleGroup: 'Delts',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Smith Machine Incline Bench Press',
          muscleGroup: 'Pecs',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Leg Extension',
          muscleGroup: 'Quads',
          modality: 'weighted',
          movementCategory: 'isolation',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Machine Lateral Raise',
          muscleGroup: 'Delts',
          modality: 'weighted',
          movementCategory: 'isolation',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Hip Abduction Machine',
          muscleGroup: 'Glutes',
          modality: 'weighted',
          movementCategory: 'isolation',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Triceps Pushdown (single arm)',
          muscleGroup: 'Triceps',
          modality: 'weighted',
          movementCategory: 'isolation',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        }
      ],
      3: [
        {
          name: 'Diverging Lat Pulldown Machine',
          muscleGroup: 'Back',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Machine Row',
          muscleGroup: 'Back',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Pec Deck Machine Fly',
          muscleGroup: 'Pecs',
          modality: 'weighted',
          movementCategory: 'isolation',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Reverse Pec Deck',
          muscleGroup: 'Delts',
          modality: 'weighted',
          movementCategory: 'isolation',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Incline Dumbbell Curl',
          muscleGroup: 'Biceps',
          modality: 'weighted',
          movementCategory: 'isolation',
          equipment: 'freeweight',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Overhead Cable Extension (Rope)',
          muscleGroup: 'Triceps',
          modality: 'weighted',
          movementCategory: 'isolation',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Lat Pulldown (Wide)',
          muscleGroup: 'Back',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        }
      ]
    },
    assignedWeekdays: { 1: 0, 2: 2, 3: 4 } // Mon, Wed, Fri
  },
  {
    id: 'prog-tpl-upper-lower-foundations',
    name: 'Upper/Lower Foundations',
    daysPerWeek: 4,
    programDuration: 12,
    createdAt: '2026-08-24T00:00:00.000Z',
    objective: 'Hypertrophy',
    algorithmId: 'hypertrophy_linear',
    exercisesByDay: {
      1: [
        {
          name: 'Back Squat (High Bar)',
          muscleGroup: 'Quads',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'freeweight',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Deadlift (Conventional)',
          muscleGroup: 'Hamstrings',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'freeweight',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Bulgarian Split Squat',
          muscleGroup: 'Quads',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'freeweight',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Standing Calf Raise',
          muscleGroup: 'Calves',
          modality: 'weighted',
          movementCategory: 'isolation',
          equipment: 'freeweight',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        }
      ],
      2: [
        {
          name: 'Barbell Bench Press (flat)',
          muscleGroup: 'Pecs',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'freeweight',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Seated Cable Row',
          muscleGroup: 'Back',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Overhead Press (Barbell)',
          muscleGroup: 'Delts',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'freeweight',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Chin-Up (Underhand)',
          muscleGroup: 'Back',
          modality: 'bodyweight',
          movementCategory: 'compound',
          equipment: 'freeweight',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Cable Fly (Mid)',
          muscleGroup: 'Pecs',
          modality: 'weighted',
          movementCategory: 'isolation',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        }
      ],
      3: [
        {
          name: 'Barbell Hip Thrust',
          muscleGroup: 'Glutes',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'freeweight',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Leg Press',
          muscleGroup: 'Quads',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Leg Extension',
          muscleGroup: 'Quads',
          modality: 'weighted',
          movementCategory: 'isolation',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Lying Leg Curl (Machine)',
          muscleGroup: 'Hamstrings',
          modality: 'weighted',
          movementCategory: 'isolation',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Seated Calf Raise',
          muscleGroup: 'Calves',
          modality: 'weighted',
          movementCategory: 'isolation',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        }
      ],
      4: [
        {
          name: 'Barbell Bench Press (flat)',
          muscleGroup: 'Pecs',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'freeweight',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Seated Cable Row',
          muscleGroup: 'Back',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Dumbell Bench Press (incline)',
          muscleGroup: 'Pecs',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'freeweight',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Chin-Up (Underhand)',
          muscleGroup: 'Back',
          modality: 'bodyweight',
          movementCategory: 'compound',
          equipment: 'freeweight',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Triceps Pushdown (Straight Bar)',
          muscleGroup: 'Triceps',
          modality: 'weighted',
          movementCategory: 'isolation',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Dumbbell Curl (Alternating)',
          muscleGroup: 'Biceps',
          modality: 'weighted',
          movementCategory: 'isolation',
          equipment: 'freeweight',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        }
      ]
    },
    assignedWeekdays: { 1: 0, 2: 1, 3: 3, 4: 4 } // Mon, Tue, Thu, Fri
  },
  {
    id: 'prog-tpl-push-pull-legs-ab',
    name: 'Push Pull Legs A/B',
    daysPerWeek: 6,
    programDuration: 8,
    createdAt: '2026-08-24T00:00:00.000Z',
    objective: 'Hypertrophy',
    algorithmId: 'hypertrophy_linear',
    exercisesByDay: {
      1: [
        {
          name: 'Barbell Bench Press (flat)',
          muscleGroup: 'Pecs',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'freeweight',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Overhead Press (Barbell)',
          muscleGroup: 'Delts',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'freeweight',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Dumbell Bench Press (incline)',
          muscleGroup: 'Pecs',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'freeweight',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Cable Lateral Raise',
          muscleGroup: 'Delts',
          modality: 'weighted',
          movementCategory: 'isolation',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Triceps Pushdown (Rope)',
          muscleGroup: 'Triceps',
          modality: 'weighted',
          movementCategory: 'isolation',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        }
      ],
      2: [
        {
          name: 'Barbell Row (Bent-Over)',
          muscleGroup: 'Back',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'freeweight',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Lat Pulldown (Wide)',
          muscleGroup: 'Back',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Chest-Supported Row (Dumbbell)',
          muscleGroup: 'Back',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'freeweight',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Face Pull',
          muscleGroup: 'Delts',
          modality: 'weighted',
          movementCategory: 'isolation',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Incline Dumbbell Curl',
          muscleGroup: 'Biceps',
          modality: 'weighted',
          movementCategory: 'isolation',
          equipment: 'freeweight',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        }
      ],
      3: [
        {
          name: 'Back Squat (High Bar)',
          muscleGroup: 'Quads',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'freeweight',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Romanian Deadlift (RDL)',
          muscleGroup: 'Hamstrings',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'freeweight',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Leg Extension',
          muscleGroup: 'Quads',
          modality: 'weighted',
          movementCategory: 'isolation',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Lying Leg Curl (Machine)',
          muscleGroup: 'Hamstrings',
          modality: 'weighted',
          movementCategory: 'isolation',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Standing Calf Raise',
          muscleGroup: 'Calves',
          modality: 'weighted',
          movementCategory: 'isolation',
          equipment: 'freeweight',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        }
      ],
      4: [
        {
          name: 'Incline Bench Press (Barbell)',
          muscleGroup: 'Pecs',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'freeweight',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Seated Dumbbell Shoulder Press',
          muscleGroup: 'Delts',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'freeweight',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Pec Deck Machine Fly',
          muscleGroup: 'Pecs',
          modality: 'weighted',
          movementCategory: 'isolation',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Lateral Raise (Dumbbell)',
          muscleGroup: 'Delts',
          modality: 'weighted',
          movementCategory: 'isolation',
          equipment: 'freeweight',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Overhead Cable Extension (Rope)',
          muscleGroup: 'Triceps',
          modality: 'weighted',
          movementCategory: 'isolation',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        }
      ],
      5: [
        {
          name: 'Pull-Up (Wide Grip)',
          muscleGroup: 'Back',
          modality: 'bodyweight',
          movementCategory: 'compound',
          equipment: 'freeweight',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Seated Cable Row',
          muscleGroup: 'Back',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Single-Arm Dumbbell Row',
          muscleGroup: 'Back',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'freeweight',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Reverse Pec Deck',
          muscleGroup: 'Delts',
          modality: 'weighted',
          movementCategory: 'isolation',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Rope Hammer Curl',
          muscleGroup: 'Biceps',
          modality: 'weighted',
          movementCategory: 'isolation',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        }
      ],
      6: [
        {
          name: 'Deadlift (Conventional)',
          muscleGroup: 'Hamstrings',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'freeweight',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Leg Press',
          muscleGroup: 'Quads',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Bulgarian Split Squat',
          muscleGroup: 'Quads',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'freeweight',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Seated Leg Curl',
          muscleGroup: 'Hamstrings',
          modality: 'weighted',
          movementCategory: 'isolation',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        },
        {
          name: 'Seated Calf Raise',
          muscleGroup: 'Calves',
          modality: 'weighted',
          movementCategory: 'isolation',
          equipment: 'machine',
          isMainMovement: false,
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }]
        }
      ]
    },
    assignedWeekdays: { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5 } // Mon, Tue, Wed, Thu, Fri, Sat
  }
];

// Helper keys matching your old app's keys
const KEYS = {
  PROGRAM_LIST: 'programList',
  CURRENT_PROGRAM_ID: 'currentProgramId',
  WORKOUT_LOGS: 'workoutLogs',
};

// Seed programs
const SEED_PROGRAMS: Program[] = [];

// Helper to format date offset in YYYY-MM-DD
function getDateStringOffset(daysOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// Seed workout logs
const SEED_WORKOUT_LOGS: WorkoutLog[] = [];

// Initialize storage helper
export const storage = {
  getPrograms: (): Program[] => {
    const data = localStorage.getItem(KEYS.PROGRAM_LIST);
    if (!data) {
      localStorage.setItem(KEYS.PROGRAM_LIST, JSON.stringify(SEED_PROGRAMS));
      return SEED_PROGRAMS;
    }
    return JSON.parse(data);
  },

  saveProgram: (program: Program) => {
    const list = storage.getPrograms();
    const index = list.findIndex(p => p.id === program.id);
    if (index >= 0) {
      list[index] = program;
    } else {
      list.push(program);
    }
    localStorage.setItem(KEYS.PROGRAM_LIST, JSON.stringify(list));
  },

  deleteProgram: (id: string) => {
    const list = storage.getPrograms();
    const updated = list.filter(p => p.id !== id);
    localStorage.setItem(KEYS.PROGRAM_LIST, JSON.stringify(updated));
    if (storage.getCurrentProgramId() === id) {
      localStorage.removeItem(KEYS.CURRENT_PROGRAM_ID);
    }
  },

  getCurrentProgramId: (): string | null => {
    return localStorage.getItem(KEYS.CURRENT_PROGRAM_ID);
  },

  setCurrentProgramId: (id: string | null) => {
    if (id === null) {
      localStorage.removeItem(KEYS.CURRENT_PROGRAM_ID);
    } else {
      localStorage.setItem(KEYS.CURRENT_PROGRAM_ID, id);
    }
  },

  getCurrentProgram: (): Program | null => {
    const id = storage.getCurrentProgramId();
    if (!id) return null;
    const programs = storage.getPrograms();
    const saved = programs.find(p => p.id === id);
    if (saved) return saved;
    const prebuilt = PREBUILT_TEMPLATES.find(p => p.id === id);
    if (prebuilt) return prebuilt;
    return null;
  },

  getWorkoutLogs: (): WorkoutLog[] => {
    const data = localStorage.getItem(KEYS.WORKOUT_LOGS);
    if (!data) {
      localStorage.setItem(KEYS.WORKOUT_LOGS, JSON.stringify(SEED_WORKOUT_LOGS));
      return SEED_WORKOUT_LOGS;
    }
    return JSON.parse(data);
  },

  saveWorkoutLog: (log: WorkoutLog) => {
    const list = storage.getWorkoutLogs();
    const index = list.findIndex(l => l.id === log.id);
    if (index >= 0) {
      list[index] = log;
    } else {
      list.push(log);
    }
    localStorage.setItem(KEYS.WORKOUT_LOGS, JSON.stringify(list));
  },

  deleteWorkoutLog: (id: string) => {
    const list = storage.getWorkoutLogs();
    const updated = list.filter(l => l.id !== id);
    localStorage.setItem(KEYS.WORKOUT_LOGS, JSON.stringify(updated));
  },

  getWeightUnit: (): 'kg' | 'lb' => {
    const u = localStorage.getItem('preferredWeightUnit');
    return (u as 'kg' | 'lb') || 'kg';
  },

  setWeightUnit: (u: 'kg' | 'lb') => {
    localStorage.setItem('preferredWeightUnit', u);
  },

  getBodyweight: (): number | null => {
    const bw = localStorage.getItem('userBodyweight');
    return bw ? Number(bw) : null;
  },

  setBodyweight: (bw: number | null) => {
    if (bw === null || isNaN(bw) || !Number.isFinite(bw) || bw <= 0) {
      localStorage.removeItem('userBodyweight');
      localStorage.removeItem('userBodyweightUnit');
    } else {
      localStorage.setItem('userBodyweight', String(bw));
    }
  },

  getBodyweightUnit: (): WeightUnit | null => {
    const u = localStorage.getItem('userBodyweightUnit');
    return u === 'kg' || u === 'lb' ? u : null;
  },

  setBodyweightUnit: (u: WeightUnit | null) => {
    if (!u || (u !== 'kg' && u !== 'lb')) {
      localStorage.removeItem('userBodyweightUnit');
    } else {
      localStorage.setItem('userBodyweightUnit', u);
    }
  },

  getBodyweightWithUnit: (): { value: number; unit: WeightUnit } | null => {
    const bw = localStorage.getItem('userBodyweight');
    const unit = localStorage.getItem('userBodyweightUnit');
    if (!bw || !unit) return null;
    const num = Number(bw);
    if (!Number.isFinite(num) || num <= 0 || isNaN(num)) return null;
    if (unit !== 'kg' && unit !== 'lb') return null;
    return { value: num, unit: unit as WeightUnit };
  },

  setBodyweightWithUnit: (bw: number | null, unit: WeightUnit | null) => {
    if (bw === null || isNaN(bw) || !Number.isFinite(bw) || bw <= 0 || !unit || (unit !== 'kg' && unit !== 'lb')) {
      localStorage.removeItem('userBodyweight');
      localStorage.removeItem('userBodyweightUnit');
    } else {
      localStorage.setItem('userBodyweight', String(bw));
      localStorage.setItem('userBodyweightUnit', unit);
    }
  },

  getTheme: (): string => {
    return localStorage.getItem('metreps_theme') || 'slate';
  },

  setTheme: (t: string) => {
    localStorage.setItem('metreps_theme', t);
  },

  getSettings: (): AppSettings => {
    try {
      const data = localStorage.getItem('metreps_settings');
      if (!data) {
        return { ...DEFAULT_SETTINGS };
      }
      return {
        ...DEFAULT_SETTINGS,
        ...JSON.parse(data),
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  },

  saveSettings: (settings: Partial<AppSettings>) => {
    try {
      const current = storage.getSettings();
      const updated: AppSettings = { ...current, ...settings };
      localStorage.setItem('metreps_settings', JSON.stringify(updated));
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
  },

  getHighlightCurrentSet: (): boolean => {
    return storage.getSettings().highlightCurrentSet;
  },

  setHighlightCurrentSet: (val: boolean) => {
    storage.saveSettings({ highlightCurrentSet: val });
  },

  getPlannedSessions: (programId: string): Record<string, PlannedSession> => {
    const saved = storage.getPrograms().find(p => p.id === programId);
    const prebuilt = PREBUILT_TEMPLATES.find(p => p.id === programId);
    const program = saved || prebuilt;
    if (!program) return {};

    const map: Record<string, PlannedSession> = {};

    // Generate planned workouts for the duration of the program (e.g. 4 weeks)
    const totalWeeks = program.programDuration === '∞' ? 12 : Number(program.programDuration);
    const logs = storage.getWorkoutLogs();

    for (let w = 1; w <= totalWeeks; w++) {
      for (let dayIdx = 1; dayIdx <= program.daysPerWeek; dayIdx++) {
        const exercises = program.exercisesByDay[dayIdx];
        if (!exercises) continue;

        // Calculate actual date for this planned session
        const sessionDate = calculateSessionDate(program.createdAt, program.assignedWeekdays, w, dayIdx);
        const dateStr = getLocalDateString(sessionDate);

        // Check if there is already a completed log for this program/week/day on any date after the program was started/re-started
        const completedLog = logs.find(
          l => {
            if (l.programId !== programId) return false;
            if (String(l.week) !== String(w)) return false;
            if (String(l.day) !== String(dayIdx)) return false;
            
            const progTime = new Date(program.createdAt).getTime();
            const logTime = Number(l.id.replace('log-', ''));
            const actualLogTime = (!isNaN(logTime) && logTime > 1000000000000)
              ? logTime
              : new Date(l.date).getTime();
              
            return actualLogTime >= progTime;
          }
        );

        map[dateStr] = {
          date: dateStr,
          programId,
          dayIndex: dayIdx,
          week: w,
          status: completedLog ? 'completed' : 'planned',
          completedDate: completedLog ? completedLog.date : null,
        };
      }
    }

    return map;
  },

  isProgramCompleted: (program: Program | null, logs: WorkoutLog[]): boolean => {
    if (!program) return false;
    if (program.programDuration === '∞') return false;
    
    const totalWeeks = Number(program.programDuration);
    if (isNaN(totalWeeks)) return false;
    
    const dayIndexes = Object.keys(program.exercisesByDay)
      .map(Number)
      .filter(d => d <= program.daysPerWeek)
      .sort((a, b) => a - b);
    if (dayIndexes.length === 0) return false;
    
    const lastDay = dayIndexes[dayIndexes.length - 1];
    const progTime = new Date(program.createdAt).getTime();
    
    return logs.some(
      l => {
        if (l.programId !== program.id) return false;
        if (String(l.week) !== String(totalWeeks)) return false;
        if (String(l.day) !== String(lastDay)) return false;
        
        const logTime = Number(l.id.replace('log-', ''));
        const actualLogTime = (!isNaN(logTime) && logTime > 1000000000000)
          ? logTime
          : new Date(l.date).getTime();
          
        return actualLogTime >= progTime;
      }
    );
  },

  getOnboardingVersion: (): number | null => {
    try {
      const val = localStorage.getItem('metreps_onboarding_version');
      if (val === null || val === undefined) return null;
      const num = Number(val);
      return isNaN(num) ? null : num;
    } catch {
      return null;
    }
  },

  setOnboardingVersion: (version: number) => {
    try {
      localStorage.setItem('metreps_onboarding_version', String(version));
    } catch (e) {
      console.error('Failed to set onboarding version:', e);
    }
  },
};
