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
    objective: 'Hypertrophy',
    algorithmId: 'hypertrophy_linear',
    exercisesByDay: {
      1: [
        { name: 'Back Squat (High Bar)', muscleGroup: 'Quads', modality: 'weighted', sets: [{ setNumber: 1, weight: 60, reps: 5, rpe: 8, form: 'strict' }, { setNumber: 2, weight: 60, reps: 5, rpe: 8, form: 'strict' }, { setNumber: 3, weight: 60, reps: 5, rpe: 8, form: 'standard' }] },
        { name: 'Bench Press (Barbell, Flat)', muscleGroup: 'Pecs', modality: 'weighted', sets: [{ setNumber: 1, weight: 40, reps: 8, rpe: 7, form: 'strict' }, { setNumber: 2, weight: 40, reps: 8, rpe: 8, form: 'strict' }] },
        { name: 'Lat Pulldown (Wide)', muscleGroup: 'Back', modality: 'weighted', sets: [{ setNumber: 1, weight: 35, reps: 10, rpe: 8, form: 'standard' }, { setNumber: 2, weight: 35, reps: 10, rpe: 8, form: 'standard' }] },
      ],
      2: [
        { name: 'Deadlift (Conventional)', muscleGroup: 'Hamstrings', modality: 'weighted', sets: [{ setNumber: 1, weight: 70, reps: 5, rpe: 8, form: 'strict' }, { setNumber: 2, weight: 70, reps: 5, rpe: 8, form: 'standard' }] },
        { name: 'Overhead Press (Barbell)', muscleGroup: 'Delts', modality: 'weighted', sets: [{ setNumber: 1, weight: 20, reps: 8, rpe: 8, form: 'strict' }, { setNumber: 2, weight: 20, reps: 8, rpe: 8, form: 'strict' }] },
        { name: 'Dumbbell Curl (Alternating)', muscleGroup: 'Biceps', modality: 'weighted', sets: [{ setNumber: 1, weight: 10, reps: 12, rpe: 7, form: 'strict' }, { setNumber: 2, weight: 10, reps: 12, rpe: 8, form: 'standard' }] },
      ],
      3: [
        { name: 'Leg Press', muscleGroup: 'Quads', modality: 'weighted', sets: [{ setNumber: 1, weight: 100, reps: 10, rpe: 7, form: 'strict' }, { setNumber: 2, weight: 100, reps: 10, rpe: 8, form: 'standard' }] },
        { name: 'Incline Dumbbell Press', muscleGroup: 'Pecs', modality: 'weighted', sets: [{ setNumber: 1, weight: 16, reps: 10, rpe: 8, form: 'strict' }, { setNumber: 2, weight: 16, reps: 10, rpe: 8, form: 'standard' }] },
        { name: 'Seated Cable Row', muscleGroup: 'Back', modality: 'weighted', sets: [{ setNumber: 1, weight: 40, reps: 10, rpe: 8, form: 'strict' }, { setNumber: 2, weight: 40, reps: 10, rpe: 8, form: 'standard' }] },
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
    objective: 'Hypertrophy',
    algorithmId: 'hypertrophy_linear',
    exercisesByDay: {
      1: [
        { name: 'Bench Press (Barbell, Flat)', muscleGroup: 'Pecs', modality: 'weighted', sets: [{ setNumber: 1, weight: 50, reps: 8 }, { setNumber: 2, weight: 50, reps: 8 }] },
        { name: 'Barbell Row (Bent-Over)', muscleGroup: 'Back', modality: 'weighted', sets: [{ setNumber: 1, weight: 40, reps: 8 }, { setNumber: 2, weight: 40, reps: 8 }] },
        { name: 'Seated Dumbbell Shoulder Press', muscleGroup: 'Delts', sets: [{ setNumber: 1, weight: 14, reps: 10 }] },
      ],
      2: [
        { name: 'Back Squat (High Bar)', muscleGroup: 'Quads', sets: [{ setNumber: 1, weight: 70, reps: 6 }, { setNumber: 2, weight: 70, reps: 6 }] },
        { name: 'Romanian Deadlift (RDL)', muscleGroup: 'Hamstrings', sets: [{ setNumber: 1, weight: 60, reps: 10 }] },
        { name: 'Standing Calf Raise', muscleGroup: 'Calves', sets: [{ setNumber: 1, weight: 40, reps: 15 }] },
      ],
      3: [
        { name: 'Pull-Up (Wide Grip)', muscleGroup: 'Back', sets: [{ setNumber: 1, reps: 6 }] },
        { name: 'Incline Bench Press (Barbell)', muscleGroup: 'Pecs', sets: [{ setNumber: 1, weight: 45, reps: 8 }] },
        { name: 'Lateral Raise (Dumbbell)', muscleGroup: 'Delts', sets: [{ setNumber: 1, weight: 8, reps: 12 }] },
      ],
      4: [
        { name: 'Lying Leg Curl (Machine)', muscleGroup: 'Hamstrings', sets: [{ setNumber: 1, weight: 30, reps: 12 }] },
        { name: 'Leg Extension', muscleGroup: 'Quads', sets: [{ setNumber: 1, weight: 40, reps: 12 }] },
        { name: 'Plank', muscleGroup: 'Abs', sets: [{ setNumber: 1, reps: 1 }] },
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
    
    const dayIndexes = Object.keys(program.exercisesByDay).map(Number).sort((a, b) => a - b);
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
};
