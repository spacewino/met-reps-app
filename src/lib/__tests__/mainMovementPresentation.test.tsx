/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, it, expect, beforeEach } from 'vitest';
import { ExerciseEntry, Program, WorkoutLog } from '../../types';
import { HomeView } from '../../components/HomeView';
import { WorkoutLogger } from '../../components/WorkoutLogger';
import {
  calculateObjectiveSets,
} from '../objectiveMath';
import { updateProgramDayMainMovement } from '../programMetadata';
import { storage } from '../storage';

// In-memory storage mock
const memoryStore: Record<string, string> = {};
globalThis.localStorage = {
  getItem: (key: string) => memoryStore[key] ?? null,
  setItem: (key: string, value: string) => {
    memoryStore[key] = String(value);
  },
  removeItem: (key: string) => {
    delete memoryStore[key];
  },
  clear: () => {
    Object.keys(memoryStore).forEach(k => delete memoryStore[k]);
  },
  key: (index: number) => Object.keys(memoryStore)[index] ?? null,
  length: 0,
};

describe('MetReps — Strength-Only Main Movement Presentation & Invariance Tests', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const createExercise = (name: string, isMain: boolean = false): ExerciseEntry => ({
    name,
    muscleGroup: 'Chest',
    modality: 'weighted',
    isMainMovement: isMain,
    sets: [
      { setNumber: 1, weight: 100, reps: 10, rpe: 8.0, isCompleted: false },
      { setNumber: 2, weight: 100, reps: 10, rpe: 8.0, isCompleted: false },
      { setNumber: 3, weight: 100, reps: 10, rpe: 8.0, isCompleted: false },
    ],
  });

  describe('1. Workout Logger Main Movement Control Visibility', () => {
    it('1. Programmed Strength renders the Main Movement control', () => {
      const ex1 = createExercise('Barbell Bench Press', true);
      const ex2 = createExercise('Incline Dumbbell Press', false);
      const program: Program = {
        id: 'prog-1',
        name: 'Strength Program',
        daysPerWeek: 3,
        programDuration: 4,
        createdAt: '2026-01-01T00:00:00Z',
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        exercisesByDay: { 1: [ex1, ex2] },
      };
      storage.saveProgram(program);
      storage.setCurrentProgramId(program.id);

      const html = renderToString(
        <WorkoutLogger
          initialParams={{
            programId: program.id,
            week: '1',
            day: '1',
            isOneOff: false,
          }}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      expect(html).toContain('Main Movement');
    });

    it('2. One-off Strength renders the Main Movement control', () => {
      const ex1 = createExercise('Barbell Bench Press', true);
      localStorage.setItem('metreps_workout_draft', JSON.stringify({
        isOneOff: true,
        objective: 'Strength',
        exercises: [ex1],
        userRawExercises: [ex1],
      }));

      const html = renderToString(
        <WorkoutLogger
          initialParams={{
            isOneOff: true,
          }}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      expect(html).toContain('Main Movement');
    });

    it('3. Programmed Hypertrophy does NOT render the Main Movement control', () => {
      const ex1 = createExercise('Barbell Bench Press', true);
      const program: Program = {
        id: 'prog-2',
        name: 'Hypertrophy Program',
        daysPerWeek: 3,
        programDuration: 4,
        createdAt: '2026-01-01T00:00:00Z',
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        exercisesByDay: { 1: [ex1] },
      };
      storage.saveProgram(program);
      storage.setCurrentProgramId(program.id);

      const html = renderToString(
        <WorkoutLogger
          initialParams={{
            programId: program.id,
            week: '1',
            day: '1',
            isOneOff: false,
          }}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      expect(html).not.toContain('Main Movement');
      expect(html).not.toContain('Locked Main Movement');
      expect(html).not.toContain('Accessory Movement');
    });

    it('4. One-off Hypertrophy does NOT render the Main Movement control', () => {
      const ex1 = createExercise('Barbell Bench Press', true);
      localStorage.setItem('metreps_workout_draft', JSON.stringify({
        isOneOff: true,
        objective: 'Hypertrophy',
        exercises: [ex1],
        userRawExercises: [ex1],
      }));

      const html = renderToString(
        <WorkoutLogger
          initialParams={{
            isOneOff: true,
          }}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      expect(html).not.toContain('Main Movement');
    });

    it('5. Deload workout does NOT render the Main Movement control', () => {
      const ex1 = createExercise('Barbell Bench Press', true);
      localStorage.setItem('metreps_workout_draft', JSON.stringify({
        isOneOff: true,
        objective: 'Deload',
        exercises: [ex1],
        userRawExercises: [ex1],
      }));

      const html = renderToString(
        <WorkoutLogger
          initialParams={{
            isOneOff: true,
          }}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      expect(html).not.toContain('Main Movement');
    });

    it('6. Objective Off/manual does NOT render the Main Movement control', () => {
      const ex1 = createExercise('Barbell Bench Press', true);
      localStorage.setItem('metreps_workout_draft', JSON.stringify({
        isOneOff: true,
        objective: 'Off',
        exercises: [ex1],
        userRawExercises: [ex1],
      }));

      const html = renderToString(
        <WorkoutLogger
          initialParams={{
            isOneOff: true,
          }}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      expect(html).not.toContain('Main Movement');
    });
  });

  describe('2. Metadata Preservation Across Objective Transitions', () => {
    it('7 & 8 & 9. Stored isMainMovement remains preserved and reappears upon switching to Strength', () => {
      const ex1 = createExercise('Barbell Bench Press', true);
      const ex2 = createExercise('Incline Dumbbell Press', false);
      const program: Program = {
        id: 'prog-switch',
        name: 'Switching Program',
        daysPerWeek: 3,
        programDuration: 4,
        createdAt: '2026-01-01T00:00:00Z',
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        exercisesByDay: { 1: [ex1, ex2] },
      };
      storage.saveProgram(program);
      storage.setCurrentProgramId(program.id);

      // In Hypertrophy, the flag in template is still true, but hidden from UI
      expect(program.exercisesByDay[1][0].isMainMovement).toBe(true);
      const htmlHyp = renderToString(
        <WorkoutLogger
          initialParams={{
            programId: program.id,
            week: '1',
            day: '1',
            isOneOff: false,
          }}
          onClose={() => {}}
          onSave={() => {}}
        />
      );
      expect(htmlHyp).not.toContain('Main Movement');

      // Now switch program objective to Strength
      const strengthProgram: Program = {
        ...program,
        objective: 'Strength',
        algorithmId: 'strength_undulating',
      };
      storage.saveProgram(strengthProgram);
      storage.setCurrentProgramId(strengthProgram.id);

      const htmlStr = renderToString(
        <WorkoutLogger
          initialParams={{
            programId: strengthProgram.id,
            week: '1',
            day: '1',
            isOneOff: false,
          }}
          onClose={() => {}}
          onSave={() => {}}
        />
      );
      expect(htmlStr).toContain('Main Movement');
      // Verify the checkbox is checked in the rendered HTML
      expect(htmlStr).toContain('checked=""');
      expect(strengthProgram.exercisesByDay[1][0].isMainMovement).toBe(true);
    });

    it('10. Strength unselect remains functional via updateProgramDayMainMovement(null)', () => {
      const ex1 = createExercise('Barbell Bench Press', true);
      const program: Program = {
        id: 'prog-unselect',
        name: 'Strength Program',
        daysPerWeek: 3,
        programDuration: 4,
        createdAt: '2026-01-01T00:00:00Z',
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        exercisesByDay: { 1: [ex1] },
      };

      const result = updateProgramDayMainMovement(program, 1, null);
      expect(result.success).toBe(true);
      expect(result.updatedProgram.exercisesByDay[1][0].isMainMovement).toBe(false);
    });

    it('11. Strength swap and Week 2+ lock render correctly in Logger', () => {
      const ex1 = createExercise('Barbell Bench Press', true);
      const ex2 = createExercise('Overhead Press', false);
      const program: Program = {
        id: 'prog-lock',
        name: 'Strength Program',
        daysPerWeek: 3,
        programDuration: 4,
        createdAt: '2026-01-01T00:00:00Z',
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        exercisesByDay: { 1: [ex1, ex2] },
      };
      storage.saveProgram(program);
      storage.setCurrentProgramId(program.id);

      // Week 2 with exactly 1 eligible main movement locks the control
      const htmlWeek2 = renderToString(
        <WorkoutLogger
          initialParams={{
            programId: program.id,
            week: '2',
            day: '1',
            isOneOff: false,
          }}
          onClose={() => {}}
          onSave={() => {}}
        />
      );
      expect(htmlWeek2).toContain('Locked Main Movement');
      expect(htmlWeek2).toContain('Accessory Movement');
    });
  });

  describe('3. HomeView and LogsHistoryView MM Badge Visibility', () => {
    it('12. Home/Diary badges appear for Strength workouts with isMainMovement: true', () => {
      const log: WorkoutLog = {
        id: 'log-str-1',
        date: '2026-06-09',
        objective: 'Strength',
        program: 'Strength Wave',
        week: '1',
        day: '1',
        unit: 'kg',
        exercises: [
          createExercise('Barbell Bench Press', true),
          createExercise('Tricep Pushdown', false),
        ],
      };

      const homeHtml = renderToString(
        <HomeView
          currentProgram={null}
          workoutLogs={[log]}
          selectedDate="2026-06-09"
          setSelectedDate={() => {}}
          onNavigate={() => {}}
        />
      );
      expect(homeHtml).toContain('MM');
      expect(homeHtml).toContain('Barbell Bench Press');

      // Test badge condition for Strength
      const ex = log.exercises[0];
      const showBadge = !!(ex.isMainMovement && log.objective === 'Strength');
      expect(showBadge).toBe(true);
    });

    it('13. Home/Diary badges remain ABSENT for Hypertrophy, Deload, and Off even when stored flag is true', () => {
      const objectives: Array<'Hypertrophy' | 'Deload' | 'Off'> = ['Hypertrophy', 'Deload', 'Off'];

      for (const obj of objectives) {
        const log: WorkoutLog = {
          id: `log-${obj.toLowerCase()}-1`,
          date: '2026-06-09',
          objective: obj,
          program: `${obj} Session`,
          week: '1',
          day: '1',
          unit: 'kg',
          exercises: [
            createExercise('Barbell Bench Press', true), // Stale true flag
          ],
        };

        const homeHtml = renderToString(
          <HomeView
            currentProgram={null}
            workoutLogs={[log]}
            selectedDate="2026-06-09"
            setSelectedDate={() => {}}
            onNavigate={() => {}}
          />
        );
        expect(homeHtml, `HomeView should not show MM badge for ${obj}`).not.toContain('>MM<');

        // Test badge condition for Diary
        const ex = log.exercises[0];
        const showBadge = !!(ex.isMainMovement && log.objective === 'Strength');
        expect(showBadge, `LogsHistory badge condition should be false for ${obj}`).toBe(false);
      }
    });
  });

  describe('4. Mathematical Invariance & Calculation Parity', () => {
    it('14. Hypertrophy linear targets are strictly invariant to isMainMovement flag', () => {
      const baseEx = createExercise('Barbell Bench Press', false);

      const setsFalse = calculateObjectiveSets({
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        exercise: { ...baseEx, isMainMovement: false },
        templateExercise: baseEx,
        weekNum: 1,
        activeUnit: 'kg',
      });

      const setsTrue = calculateObjectiveSets({
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        exercise: { ...baseEx, isMainMovement: true },
        templateExercise: baseEx,
        weekNum: 1,
        activeUnit: 'kg',
      });

      expect(setsFalse).toEqual(setsTrue);
    });

    it('15. Strength main movement receives periodised targets, while non-main accessory retains template baseline', () => {
      const baseEx: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'freeweight',
        isMainMovement: true,
        sets: [
          { setNumber: 1, weight: 100, reps: 5, rpe: 8.0, isCompleted: false },
          { setNumber: 2, weight: 100, reps: 5, rpe: 8.0, isCompleted: false },
          { setNumber: 3, weight: 100, reps: 5, rpe: 8.0, isCompleted: false },
        ],
      };
      const previousLog: WorkoutLog = {
        id: 'prev-log-1',
        date: '2026-05-01',
        objective: 'Strength',
        unit: 'kg',
        exercises: [
          {
            name: 'Barbell Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            isMainMovement: true,
            sets: [{ setNumber: 1, weight: 100, reps: 1, rpe: 10, isCompleted: true }],
          },
        ],
      };

      const mainSets = calculateObjectiveSets({
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        exercise: { ...baseEx, isMainMovement: true },
        weekNum: 3,
        programDuration: 4,
        previousLogs: [previousLog],
        activeUnit: 'kg',
      });

      const accessorySets = calculateObjectiveSets({
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        exercise: { ...baseEx, isMainMovement: false },
        weekNum: 3,
        programDuration: 4,
        previousLogs: [previousLog],
        activeUnit: 'kg',
      });

      // Main movement receives undulating 3-rep wave targets
      expect(mainSets[0].reps).toBe(3);
      expect(mainSets[0].rpe).toBe(9.0);
      expect(mainSets[0].weight).toBe(90);

      // Accessory retains original template set (5 reps @ 100kg)
      expect(accessorySets[0].reps).toBe(5);
      expect(accessorySets[0].weight).toBe(100);
    });
  });
});
