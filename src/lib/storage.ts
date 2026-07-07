/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Program, WorkoutLog, PlannedSession } from '../types';
import { getLocalDateString, calculateSessionDate } from './dateUtils';

export const PREBUILT_TEMPLATES: Program[] = [
  {
    id: 'prog-tpl-beginner-full-body',
    name: 'Beginner Full Body (3 Days)',
    daysPerWeek: 3,
    programDuration: 4,
    createdAt: new Date().toISOString(),
    exercisesByDay: {
      1: [
        { name: 'Squat', muscleGroup: 'Quads', modality: 'weighted', sets: [{ setNumber: 1, weight: 60, reps: 5, rpe: 8, form: 'strict' }, { setNumber: 2, weight: 60, reps: 5, rpe: 8, form: 'strict' }, { setNumber: 3, weight: 60, reps: 5, rpe: 8, form: 'standard' }] },
        { name: 'Bench Press', muscleGroup: 'Chest', modality: 'weighted', sets: [{ setNumber: 1, weight: 40, reps: 8, rpe: 7, form: 'strict' }, { setNumber: 2, weight: 40, reps: 8, rpe: 8, form: 'strict' }] },
        { name: 'Lat Pulldown', muscleGroup: 'Back', modality: 'weighted', sets: [{ setNumber: 1, weight: 35, reps: 10, rpe: 8, form: 'standard' }, { setNumber: 2, weight: 35, reps: 10, rpe: 8, form: 'standard' }] },
      ],
      2: [
        { name: 'Deadlift', muscleGroup: 'Hamstrings & Back', modality: 'weighted', sets: [{ setNumber: 1, weight: 70, reps: 5, rpe: 8, form: 'strict' }, { setNumber: 2, weight: 70, reps: 5, rpe: 8, form: 'standard' }] },
        { name: 'Overhead Press', muscleGroup: 'Shoulders', modality: 'weighted', sets: [{ setNumber: 1, weight: 20, reps: 8, rpe: 8, form: 'strict' }, { setNumber: 2, weight: 20, reps: 8, rpe: 8, form: 'strict' }] },
        { name: 'Dumbbell Curl', muscleGroup: 'Biceps', modality: 'weighted', sets: [{ setNumber: 1, weight: 10, reps: 12, rpe: 7, form: 'strict' }, { setNumber: 2, weight: 10, reps: 12, rpe: 8, form: 'standard' }] },
      ],
      3: [
        { name: 'Leg Press', muscleGroup: 'Quads', modality: 'weighted', sets: [{ setNumber: 1, weight: 100, reps: 10, rpe: 7, form: 'strict' }, { setNumber: 2, weight: 100, reps: 10, rpe: 8, form: 'standard' }] },
        { name: 'Incline Dumbbell Press', muscleGroup: 'Chest', modality: 'weighted', sets: [{ setNumber: 1, weight: 16, reps: 10, rpe: 8, form: 'strict' }, { setNumber: 2, weight: 16, reps: 10, rpe: 8, form: 'standard' }] },
        { name: 'Cable Row', muscleGroup: 'Back', modality: 'weighted', sets: [{ setNumber: 1, weight: 40, reps: 10, rpe: 8, form: 'strict' }, { setNumber: 2, weight: 40, reps: 10, rpe: 8, form: 'standard' }] },
      ],
    },
    assignedWeekdays: { 1: 0, 2: 2, 3: 4 }, // Mon, Wed, Fri
  },
  {
    id: 'prog-tpl-upper-lower',
    name: 'Upper / Lower Split (4 Days)',
    daysPerWeek: 4,
    programDuration: 8,
    createdAt: new Date().toISOString(),
    exercisesByDay: {
      1: [
        { name: 'Bench Press', muscleGroup: 'Chest', modality: 'weighted', sets: [{ setNumber: 1, weight: 50, reps: 8 }, { setNumber: 2, weight: 50, reps: 8 }] },
        { name: 'Barbell Row', muscleGroup: 'Back', modality: 'weighted', sets: [{ setNumber: 1, weight: 40, reps: 8 }, { setNumber: 2, weight: 40, reps: 8 }] },
        { name: 'Overhead Dumbbell Press', muscleGroup: 'Shoulders', sets: [{ setNumber: 1, weight: 14, reps: 10 }] },
      ],
      2: [
        { name: 'Barbell Back Squat', muscleGroup: 'Quads', sets: [{ setNumber: 1, weight: 70, reps: 6 }, { setNumber: 2, weight: 70, reps: 6 }] },
        { name: 'Romanian Deadlift', muscleGroup: 'Hamstrings', sets: [{ setNumber: 1, weight: 60, reps: 10 }] },
        { name: 'Standing Calf Raise', muscleGroup: 'Calves', sets: [{ setNumber: 1, weight: 40, reps: 15 }] },
      ],
      3: [
        { name: 'Weighted Pull-Ups', muscleGroup: 'Back', sets: [{ setNumber: 1, reps: 6 }] },
        { name: 'Incline Barbell Bench', muscleGroup: 'Chest', sets: [{ setNumber: 1, weight: 45, reps: 8 }] },
        { name: 'Lateral Raise', muscleGroup: 'Shoulders', sets: [{ setNumber: 1, weight: 8, reps: 12 }] },
      ],
      4: [
        { name: 'Leg Curl', muscleGroup: 'Hamstrings', sets: [{ setNumber: 1, weight: 30, reps: 12 }] },
        { name: 'Leg Extension', muscleGroup: 'Quads', sets: [{ setNumber: 1, weight: 40, reps: 12 }] },
        { name: 'Plank', muscleGroup: 'Core', sets: [{ setNumber: 1, reps: 1 }] },
      ],
    },
    assignedWeekdays: { 1: 0, 2: 1, 3: 3, 4: 4 }, // Mon, Tue, Thu, Fri
  },
];

// Helper keys matching your old app's keys
const KEYS = {
  PROGRAM_LIST: 'programList',
  CURRENT_PROGRAM_ID: 'currentProgramId',
  WORKOUT_LOGS: 'workoutLogs',
};

// Seed programs
const SEED_PROGRAMS: Program[] = [
  {
    id: 'prog-strength-101',
    name: 'MetReps Strength Builder',
    daysPerWeek: 3,
    programDuration: 4,
    createdAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 days ago
    exercisesByDay: {
      1: [
        {
          name: 'Squat',
          muscleGroup: 'Quads',
          modality: 'weighted',
          sets: [
            { setNumber: 1, weight: 100, reps: 5, rpe: 8, form: 'strict' },
            { setNumber: 2, weight: 100, reps: 5, rpe: 8, form: 'strict' },
            { setNumber: 3, weight: 100, reps: 5, rpe: 9, form: 'standard' },
          ],
        },
        {
          name: 'Bench Press',
          muscleGroup: 'Chest',
          modality: 'weighted',
          sets: [
            { setNumber: 1, weight: 80, reps: 5, rpe: 7, form: 'strict' },
            { setNumber: 2, weight: 80, reps: 5, rpe: 8, form: 'strict' },
            { setNumber: 3, weight: 80, reps: 5, rpe: 8, form: 'standard' },
          ],
        },
        {
          name: 'Barbell Row',
          muscleGroup: 'Back',
          modality: 'weighted',
          sets: [
            { setNumber: 1, weight: 60, reps: 8, rpe: 7, form: 'standard' },
            { setNumber: 2, weight: 60, reps: 8, rpe: 8, form: 'standard' },
            { setNumber: 3, weight: 60, reps: 8, rpe: 8, form: 'standard' },
          ],
        },
      ],
      2: [
        {
          name: 'Deadlift',
          muscleGroup: 'Hamstrings & Back',
          modality: 'weighted',
          sets: [
            { setNumber: 1, weight: 120, reps: 5, rpe: 8, form: 'strict' },
            { setNumber: 2, weight: 120, reps: 5, rpe: 9, form: 'standard' },
          ],
        },
        {
          name: 'Overhead Press',
          muscleGroup: 'Shoulders',
          modality: 'weighted',
          sets: [
            { setNumber: 1, weight: 45, reps: 5, rpe: 8, form: 'strict' },
            { setNumber: 2, weight: 45, reps: 5, rpe: 8, form: 'strict' },
            { setNumber: 3, weight: 45, reps: 5, rpe: 9, form: 'loose' },
          ],
        },
        {
          name: 'Pull-Ups',
          muscleGroup: 'Back',
          modality: 'bodyweight',
          sets: [
            { setNumber: 1, reps: 8, rpe: 8, form: 'strict' },
            { setNumber: 2, reps: 6, rpe: 9, form: 'standard' },
            { setNumber: 3, reps: 5, rpe: 10, form: 'loose' },
          ],
        },
      ],
      3: [
        {
          name: 'Squat',
          muscleGroup: 'Quads',
          modality: 'weighted',
          sets: [
            { setNumber: 1, weight: 105, reps: 3, rpe: 8, form: 'strict' },
            { setNumber: 2, weight: 105, reps: 3, rpe: 8, form: 'strict' },
            { setNumber: 3, weight: 105, reps: 3, rpe: 9, form: 'standard' },
          ],
        },
        {
          name: 'Incline Dumbbell Press',
          muscleGroup: 'Chest',
          modality: 'weighted',
          sets: [
            { setNumber: 1, weight: 26, reps: 8, rpe: 7, form: 'strict' },
            { setNumber: 2, weight: 26, reps: 8, rpe: 8, form: 'strict' },
            { setNumber: 3, weight: 26, reps: 8, rpe: 8, form: 'standard' },
          ],
        },
        {
          name: 'Romanian Deadlift',
          muscleGroup: 'Hamstrings',
          modality: 'weighted',
          sets: [
            { setNumber: 1, weight: 80, reps: 8, rpe: 7, form: 'strict' },
            { setNumber: 2, weight: 80, reps: 8, rpe: 7, form: 'strict' },
            { setNumber: 3, weight: 80, reps: 8, rpe: 8, form: 'standard' },
          ],
        },
      ],
    },
    assignedWeekdays: {
      1: 0, // Monday
      2: 2, // Wednesday
      3: 4, // Friday
    },
  },
];

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
const SEED_WORKOUT_LOGS: WorkoutLog[] = [
  {
    id: 'log-1',
    date: getDateStringOffset(-7), // 7 days ago (typically a Mon)
    programId: 'prog-strength-101',
    program: 'MetReps Strength Builder',
    week: '1',
    day: '1',
    unit: 'kg',
    durationMinutes: 55,
    exercises: [
      {
        name: 'Squat',
        muscleGroup: 'Quads',
        modality: 'weighted',
        sets: [
          { setNumber: 1, weight: 95, reps: 5, rpe: 7, form: 'strict' },
          { setNumber: 2, weight: 95, reps: 5, rpe: 7, form: 'strict' },
          { setNumber: 3, weight: 95, reps: 5, rpe: 8, form: 'strict' },
        ],
      },
      {
        name: 'Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        sets: [
          { setNumber: 1, weight: 77.5, reps: 5, rpe: 7, form: 'strict' },
          { setNumber: 2, weight: 77.5, reps: 5, rpe: 8, form: 'strict' },
          { setNumber: 3, weight: 77.5, reps: 5, rpe: 8, form: 'standard' },
        ],
      },
      {
        name: 'Barbell Row',
        muscleGroup: 'Back',
        modality: 'weighted',
        sets: [
          { setNumber: 1, weight: 57.5, reps: 8, rpe: 7, form: 'standard' },
          { setNumber: 2, weight: 57.5, reps: 8, rpe: 8, form: 'standard' },
        ],
      },
    ],
    recovery: {
      sleepHours: 8,
      hydrationLiters: 2.5,
      nutritionCalories: 2800,
      proteinGrams: 150,
      soreness: 3,
      motivation: 4,
    },
    notes: 'Felt great. Squats were smooth.',
  },
  {
    id: 'log-2',
    date: getDateStringOffset(-5), // 5 days ago (Wed)
    programId: 'prog-strength-101',
    program: 'MetReps Strength Builder',
    week: '1',
    day: '2',
    unit: 'kg',
    durationMinutes: 60,
    exercises: [
      {
        name: 'Deadlift',
        muscleGroup: 'Hamstrings & Back',
        modality: 'weighted',
        sets: [
          { setNumber: 1, weight: 115, reps: 5, rpe: 7, form: 'strict' },
          { setNumber: 2, weight: 115, reps: 5, rpe: 8, form: 'strict' },
        ],
      },
      {
        name: 'Overhead Press',
        muscleGroup: 'Shoulders',
        modality: 'weighted',
        sets: [
          { setNumber: 1, weight: 42.5, reps: 5, rpe: 8, form: 'strict' },
          { setNumber: 2, weight: 42.5, reps: 5, rpe: 8, form: 'strict' },
          { setNumber: 3, weight: 42.5, reps: 5, rpe: 9, form: 'standard' },
        ],
      },
    ],
    recovery: {
      sleepHours: 6.5,
      hydrationLiters: 2.0,
      nutritionCalories: 2500,
      proteinGrams: 130,
      soreness: 5,
      motivation: 3,
    },
    notes: 'Slightly tired, but finished overhead presses.',
  },
  {
    id: 'log-3',
    date: getDateStringOffset(-3), // 3 days ago (Fri)
    programId: 'prog-strength-101',
    program: 'MetReps Strength Builder',
    week: '1',
    day: '3',
    unit: 'kg',
    durationMinutes: 45,
    exercises: [
      {
        name: 'Squat',
        muscleGroup: 'Quads',
        modality: 'weighted',
        sets: [
          { setNumber: 1, weight: 100, reps: 3, rpe: 8, form: 'strict' },
          { setNumber: 2, weight: 100, reps: 3, rpe: 8, form: 'strict' },
        ],
      },
      {
        name: 'Incline Dumbbell Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        sets: [
          { setNumber: 1, weight: 24, reps: 8, rpe: 7, form: 'strict' },
          { setNumber: 2, weight: 24, reps: 8, rpe: 8, form: 'standard' },
        ],
      },
    ],
    recovery: {
      sleepHours: 9,
      hydrationLiters: 3.2,
      nutritionCalories: 3100,
      proteinGrams: 170,
      soreness: 2,
      motivation: 5,
    },
    notes: 'Incredible session. Slept perfectly last night!',
  },
  {
    id: 'log-4',
    date: getDateStringOffset(-1), // Yesterday
    programId: 'prog-strength-101',
    program: 'MetReps Strength Builder',
    week: '2',
    day: '1',
    unit: 'kg',
    durationMinutes: 50,
    exercises: [
      {
        name: 'Squat',
        muscleGroup: 'Quads',
        modality: 'weighted',
        sets: [
          { setNumber: 1, weight: 100, reps: 5, rpe: 8, form: 'strict' },
          { setNumber: 2, weight: 100, reps: 5, rpe: 8, form: 'strict' },
          { setNumber: 3, weight: 100, reps: 5, rpe: 9, form: 'standard' },
        ],
      },
      {
        name: 'Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        sets: [
          { setNumber: 1, weight: 80, reps: 5, rpe: 8, form: 'strict' },
          { setNumber: 2, weight: 80, reps: 5, rpe: 8, form: 'strict' },
          { setNumber: 3, weight: 80, reps: 5, rpe: 9, form: 'standard' },
        ],
      },
    ],
    recovery: {
      sleepHours: 7.5,
      hydrationLiters: 2.8,
      nutritionCalories: 2950,
      proteinGrams: 165,
      soreness: 4,
      motivation: 4,
    },
    notes: 'Squatted 100kg for 5 reps! Personal record feel.',
  },
];

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

  setCurrentProgramId: (id: string) => {
    localStorage.setItem(KEYS.CURRENT_PROGRAM_ID, id);
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
    if (bw === null || isNaN(bw)) {
      localStorage.removeItem('userBodyweight');
    } else {
      localStorage.setItem('userBodyweight', String(bw));
    }
  },

  getTheme: (): string => {
    return localStorage.getItem('metreps_theme') || 'slate';
  },

  setTheme: (t: string) => {
    localStorage.setItem('metreps_theme', t);
  },

  getPlannedSessions: (programId: string): Record<string, PlannedSession> => {
    const prebuilt = PREBUILT_TEMPLATES.find(p => p.id === programId);
    const program = prebuilt || storage.getPrograms().find(p => p.id === programId);
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

        // Check if there is already a completed log for this program/week/day on any date
        const completedLog = logs.find(
          l =>
            l.programId === programId &&
            l.week === String(w) &&
            l.day === String(dayIdx)
        );

        map[dateStr] = {
          date: dateStr,
          programId,
          dayIndex: dayIdx,
          status: completedLog ? 'completed' : 'planned',
          completedDate: completedLog ? completedLog.date : null,
        };
      }
    }

    return map;
  },
};
