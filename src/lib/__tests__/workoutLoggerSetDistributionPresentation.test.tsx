// @vitest-environment happy-dom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { ExerciseEntry, Program, WorkoutLog } from '../../types';
import { WorkoutLogger } from '../../components/WorkoutLogger';
import { calculateObjectiveSets } from '../objectiveMath';
import { storage } from '../storage';

// In-memory localStorage mock for test environment
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

interface RenderedSetTuple {
  setNumber: number;
  weight: number;
  reps: number;
  rpe: number;
  isWarmup: boolean;
}

/**
 * Extracts rendered Set tuples directly from the mounted WorkoutLogger DOM container.
 * Inspects actual <input> elements for weight and reps, and the RPE selector button.
 */
function extractRenderedSetsFromLogger(container: HTMLElement): RenderedSetTuple[] {
  const setRows: RenderedSetTuple[] = [];
  const gridRows = container.querySelectorAll('.grid');

  gridRows.forEach((row) => {
    // Each set row has a "Set Options" button
    const optionsButton = row.querySelector('button[title="Set Options"]');
    if (!optionsButton) return;

    const inputs = row.querySelectorAll('input[type="number"]');
    // In weighted exercises, there are 2 inputs: weight and reps
    if (inputs.length >= 2) {
      const weightInput = inputs[0] as HTMLInputElement;
      const repsInput = inputs[1] as HTMLInputElement;

      // RPE button is in the first .relative container within the row
      const relativeContainers = row.querySelectorAll('.relative');
      const rpeButton = relativeContainers[0]?.querySelector('button') as HTMLButtonElement | null;

      // Check warmup presence via svg title or aria-label
      const warmupSvg = row.querySelector('svg[aria-label="Warmup Set"], svg title');
      const hasWarmupTitle = warmupSvg && warmupSvg.textContent === 'Warmup Set';
      const isWarmup = !!hasWarmupTitle || !!row.querySelector('[aria-label="Warmup Set"]');

      const setNumSpan = row.querySelector('.font-bold');
      const setNumber = setNumSpan ? parseInt(setNumSpan.textContent?.trim() || '0', 10) : setRows.length + 1;

      setRows.push({
        setNumber,
        weight: parseFloat(weightInput.value || '0'),
        reps: parseInt(repsInput.value || '0', 10),
        rpe: parseFloat(rpeButton?.textContent?.trim() || '0'),
        isWarmup: !!isWarmup,
      });
    }
  });

  return setRows;
}

describe('METREPS — Phase 2A End-to-End Logger DOM Multi-Set Target Presentation', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  const createHistoricalLog = (
    id: string,
    exerciseName: string,
    sets: { weight: number; reps: number; rpe: number; isWarmup?: boolean; isCompleted?: boolean }[]
  ): WorkoutLog => ({
    id,
    date: '2026-08-20',
    startTime: '09:00',
    programId: 'prog-test-1',
    program: 'Historical Baseline Program',
    week: '1',
    day: '1',
    unit: 'kg',
    durationMinutes: 60,
    objective: 'Hypertrophy',
    exercises: [
      {
        name: exerciseName,
        muscleGroup: 'Chest',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'freeweight',
        isMainMovement: true,
        sets: sets.map((s, idx) => ({
          setNumber: idx + 1,
          weight: s.weight,
          reps: s.reps,
          rpe: s.rpe,
          isWarmup: !!s.isWarmup,
          isCompleted: s.isCompleted ?? true,
          form: 'standard',
        })),
      },
    ],
  });

  it('1. HYPERTROPHY_STEP LOGGER RENDER: Mounts WorkoutLogger and renders canonical fatigue-declined weights across Sets 1-3', async () => {
    // Seed historical completed sets with learned fatigue profile (100kg x 10 @ 8 RPE, 100kg x 10 @ 10 RPE, 100kg x 8 @ 10 RPE)
    const historyLog = createHistoricalLog('hist-hs-1', 'Barbell Bench Press', [
      { weight: 100, reps: 10, rpe: 8.0, isCompleted: true },
      { weight: 100, reps: 10, rpe: 10.0, isCompleted: true },
      { weight: 100, reps: 8, rpe: 10.0, isCompleted: true },
    ]);
    localStorage.setItem('workoutLogs', JSON.stringify([historyLog]));

    const templateExercise: ExerciseEntry = {
      name: 'Barbell Bench Press',
      muscleGroup: 'Chest',
      modality: 'weighted',
      movementCategory: 'compound',
      equipment: 'freeweight',
      isMainMovement: true,
      sets: [
        { setNumber: 1, weight: 100, reps: 10, rpe: 8.0, isCompleted: false },
        { setNumber: 2, weight: 100, reps: 10, rpe: 8.0, isCompleted: false },
        { setNumber: 3, weight: 100, reps: 10, rpe: 8.0, isCompleted: false },
      ],
    };

    const program: Program = {
      id: 'prog-hs-101',
      name: 'Hypertrophy Step Program',
      daysPerWeek: 3,
      programDuration: 8,
      createdAt: '2026-01-01T00:00:00Z',
      objective: 'Hypertrophy',
      algorithmId: 'hypertrophy_step',
      exercisesByDay: { 1: [templateExercise] },
    };
    storage.saveProgram(program);
    storage.setCurrentProgramId(program.id);

    // Compute expected canonical targets independently via production calculation authority
    const canonicalTargetSets = calculateObjectiveSets({
      objective: 'Hypertrophy',
      exercise: templateExercise,
      exerciseIndex: 0,
      totalExercises: 1,
      weekNum: 1,
      programDuration: 8,
      previousLogs: storage.getWorkoutLogs(),
      userTouchedSets: {},
      checkedSets: {},
      algorithmId: 'hypertrophy_step',
      templateExercise,
      activeUnit: 'kg',
      programId: program.id,
      dayNum: '1',
      targetDate: '2026-08-30',
      targetLogId: null,
      occurrenceOrdinal: 1,
    });

    // Mount real WorkoutLogger component
    let rendered: ReturnType<typeof render>;
    await act(async () => {
      rendered = render(
        <WorkoutLogger
          initialParams={{
            programId: program.id,
            week: '1',
            day: '1',
            date: '2026-08-30',
            isOneOff: false,
          }}
          onClose={() => {}}
          onSave={() => {}}
        />
      );
    });

    const renderedSets = extractRenderedSetsFromLogger(rendered!.container);
    expect(renderedSets).toHaveLength(3);

    // 1. Verify Set 1 (Ordinal 1): Anchor baseline (95.0 kg x 10 @ 7.0 RPE)
    expect(renderedSets[0].setNumber).toBe(1);
    expect(renderedSets[0].weight).toBe(canonicalTargetSets[0].weight);
    expect(renderedSets[0].reps).toBe(canonicalTargetSets[0].reps);
    expect(renderedSets[0].rpe).toBe(canonicalTargetSets[0].rpe);
    expect(renderedSets[0].weight).toBe(95.0);
    expect(renderedSets[0].reps).toBe(10);
    expect(renderedSets[0].rpe).toBe(7.0);

    // 2. Verify Set 2 (Ordinal 2): Multi-set distributed target matching canonical authority
    expect(renderedSets[1].setNumber).toBe(2);
    expect(renderedSets[1].weight).toBe(canonicalTargetSets[1].weight);
    expect(renderedSets[1].reps).toBe(canonicalTargetSets[1].reps);
    expect(renderedSets[1].rpe).toBe(canonicalTargetSets[1].rpe);

    // 3. Verify Set 3 (Ordinal 3): Multi-set distributed target matching canonical authority
    expect(renderedSets[2].setNumber).toBe(3);
    expect(renderedSets[2].weight).toBe(canonicalTargetSets[2].weight);
    expect(renderedSets[2].reps).toBe(canonicalTargetSets[2].reps);
    expect(renderedSets[2].rpe).toBe(canonicalTargetSets[2].rpe);

    // 4. Anti-cloning proof: Ordinal targets differ across working sets (Set 3 differs from Set 1)
    expect(
      renderedSets[1].weight !== renderedSets[0].weight ||
      renderedSets[1].reps !== renderedSets[0].reps ||
      renderedSets[1].rpe !== renderedSets[0].rpe
    ).toBe(true);
    expect(
      renderedSets[2].weight !== renderedSets[0].weight ||
      renderedSets[2].reps !== renderedSets[0].reps ||
      renderedSets[2].rpe !== renderedSets[0].rpe
    ).toBe(true);
  });

  it('2. HYPERTROPHY_LINEAR LOGGER RENDER: Mounts WorkoutLogger and renders canonical RPE progression across Sets 1-3', async () => {
    // Seed history log with 147.06 kg e1RM (100kg x 10 @ 8 RPE)
    const historyLog = createHistoricalLog('hist-hl-1', 'Barbell Bench Press', [
      { weight: 100, reps: 10, rpe: 8.0, isCompleted: true },
      { weight: 100, reps: 10, rpe: 8.0, isCompleted: true },
      { weight: 100, reps: 10, rpe: 8.0, isCompleted: true },
    ]);
    localStorage.setItem('workoutLogs', JSON.stringify([historyLog]));

    const templateExercise: ExerciseEntry = {
      name: 'Barbell Bench Press',
      muscleGroup: 'Chest',
      modality: 'weighted',
      movementCategory: 'compound',
      equipment: 'freeweight',
      isMainMovement: true,
      sets: [
        { setNumber: 1, weight: 100, reps: 10, rpe: 8.0, isCompleted: false },
        { setNumber: 2, weight: 100, reps: 10, rpe: 8.0, isCompleted: false },
        { setNumber: 3, weight: 100, reps: 10, rpe: 8.0, isCompleted: false },
      ],
    };

    const program: Program = {
      id: 'prog-hl-102',
      name: 'Wave Volume Hypertrophy Program',
      daysPerWeek: 3,
      programDuration: 8,
      createdAt: '2026-01-01T00:00:00Z',
      objective: 'Hypertrophy',
      algorithmId: 'hypertrophy_linear',
      exercisesByDay: { 1: [templateExercise] },
    };
    storage.saveProgram(program);
    storage.setCurrentProgramId(program.id);

    const canonicalTargetSets = calculateObjectiveSets({
      objective: 'Hypertrophy',
      exercise: templateExercise,
      exerciseIndex: 0,
      totalExercises: 1,
      weekNum: 1,
      programDuration: 8,
      previousLogs: storage.getWorkoutLogs(),
      userTouchedSets: {},
      checkedSets: {},
      algorithmId: 'hypertrophy_linear',
      templateExercise,
      activeUnit: 'kg',
      programId: program.id,
      dayNum: '1',
      targetDate: '2026-08-30',
      targetLogId: null,
      occurrenceOrdinal: 1,
    });

    let rendered: ReturnType<typeof render>;
    await act(async () => {
      rendered = render(
        <WorkoutLogger
          initialParams={{
            programId: program.id,
            week: '1',
            day: '1',
            date: '2026-08-30',
            isOneOff: false,
          }}
          onClose={() => {}}
          onSave={() => {}}
        />
      );
    });

    const renderedSets = extractRenderedSetsFromLogger(rendered!.container);
    expect(renderedSets).toHaveLength(3);

    // 1. Set 1 (Ordinal 1): 90.0 kg x 12 @ 8.0 RPE
    expect(renderedSets[0].weight).toBe(canonicalTargetSets[0].weight);
    expect(renderedSets[0].reps).toBe(canonicalTargetSets[0].reps);
    expect(renderedSets[0].rpe).toBe(canonicalTargetSets[0].rpe);
    expect(renderedSets[0].weight).toBe(90.0);
    expect(renderedSets[0].reps).toBe(12);
    expect(renderedSets[0].rpe).toBe(8.0);

    // 2. Set 2 (Ordinal 2): 90.0 kg x 12 @ 8.5 RPE (RPE step-up)
    expect(renderedSets[1].weight).toBe(canonicalTargetSets[1].weight);
    expect(renderedSets[1].reps).toBe(canonicalTargetSets[1].reps);
    expect(renderedSets[1].rpe).toBe(canonicalTargetSets[1].rpe);
    expect(renderedSets[1].weight).toBe(90.0);
    expect(renderedSets[1].reps).toBe(12);
    expect(renderedSets[1].rpe).toBe(8.5);

    // 3. Set 3 (Ordinal 3): 90.0 kg x 12 @ 9.0 RPE (RPE step-up)
    expect(renderedSets[2].weight).toBe(canonicalTargetSets[2].weight);
    expect(renderedSets[2].reps).toBe(canonicalTargetSets[2].reps);
    expect(renderedSets[2].rpe).toBe(canonicalTargetSets[2].rpe);
    expect(renderedSets[2].weight).toBe(90.0);
    expect(renderedSets[2].reps).toBe(12);
    expect(renderedSets[2].rpe).toBe(9.0);

    // 4. Anti-cloning proof: While load is maintained, RPE steps up across ordinals 1 -> 2 -> 3
    expect(renderedSets[1].rpe).toBeGreaterThan(renderedSets[0].rpe);
    expect(renderedSets[2].rpe).toBeGreaterThan(renderedSets[1].rpe);
    expect(renderedSets[1].rpe).not.toBe(renderedSets[0].rpe);
    expect(renderedSets[2].rpe).not.toBe(renderedSets[0].rpe);
  });

  it('3. STRENGTH_UNDULATING LOGGER RENDER: Mounts WorkoutLogger and renders canonical top-set and back-off prescriptions', async () => {
    // Seed historical baseline e1RM
    const historyLog = createHistoricalLog('hist-su-1', 'Barbell Squat', [
      { weight: 120, reps: 5, rpe: 8.0, isCompleted: true },
      { weight: 115, reps: 5, rpe: 7.0, isCompleted: true },
      { weight: 115, reps: 5, rpe: 7.5, isCompleted: true },
    ]);
    localStorage.setItem('workoutLogs', JSON.stringify([historyLog]));

    const templateExercise: ExerciseEntry = {
      name: 'Barbell Squat',
      muscleGroup: 'Legs',
      modality: 'weighted',
      movementCategory: 'compound',
      equipment: 'freeweight',
      isMainMovement: true,
      sets: [
        { setNumber: 1, weight: 120, reps: 5, rpe: 8.0, isCompleted: false },
        { setNumber: 2, weight: 115, reps: 5, rpe: 7.0, isCompleted: false },
        { setNumber: 3, weight: 115, reps: 5, rpe: 7.5, isCompleted: false },
      ],
    };

    const program: Program = {
      id: 'prog-su-103',
      name: 'Daily Undulating Periodization Program',
      daysPerWeek: 3,
      programDuration: 8,
      createdAt: '2026-01-01T00:00:00Z',
      objective: 'Strength',
      algorithmId: 'strength_undulating',
      exercisesByDay: { 1: [templateExercise] },
    };
    storage.saveProgram(program);
    storage.setCurrentProgramId(program.id);

    // Week 2 of 8: Day 1 Heavy / Volume day
    const canonicalTargetSets = calculateObjectiveSets({
      objective: 'Strength',
      exercise: templateExercise,
      exerciseIndex: 0,
      totalExercises: 1,
      weekNum: 2,
      programDuration: 8,
      previousLogs: storage.getWorkoutLogs(),
      userTouchedSets: {},
      checkedSets: {},
      algorithmId: 'strength_undulating',
      templateExercise,
      activeUnit: 'kg',
      programId: program.id,
      dayNum: '1',
      targetDate: '2026-08-30',
      targetLogId: null,
      occurrenceOrdinal: 1,
    });

    let rendered: ReturnType<typeof render>;
    await act(async () => {
      rendered = render(
        <WorkoutLogger
          initialParams={{
            programId: program.id,
            week: '2',
            day: '1',
            date: '2026-08-30',
            isOneOff: false,
          }}
          onClose={() => {}}
          onSave={() => {}}
        />
      );
    });

    const renderedSets = extractRenderedSetsFromLogger(rendered!.container);
    expect(renderedSets).toHaveLength(3);

    // 1. Set 1 (Ordinal 1): Top Working Set
    expect(renderedSets[0].weight).toBe(canonicalTargetSets[0].weight);
    expect(renderedSets[0].reps).toBe(canonicalTargetSets[0].reps);
    expect(renderedSets[0].rpe).toBe(canonicalTargetSets[0].rpe);

    // 2. Set 2 (Ordinal 2): Scheduled Back-off 1 with fatigue reduction
    expect(renderedSets[1].weight).toBe(canonicalTargetSets[1].weight);
    expect(renderedSets[1].reps).toBe(canonicalTargetSets[1].reps);
    expect(renderedSets[1].rpe).toBe(canonicalTargetSets[1].rpe);

    // 3. Set 3 (Ordinal 3): Scheduled Back-off 2 with fatigue reduction
    expect(renderedSets[2].weight).toBe(canonicalTargetSets[2].weight);
    expect(renderedSets[2].reps).toBe(canonicalTargetSets[2].reps);
    expect(renderedSets[2].rpe).toBe(canonicalTargetSets[2].rpe);

    // 4. Anti-cloning proof: Back-off sets have distinct target RPE / weight compared to Set 1
    expect(renderedSets[1].weight).toBeLessThanOrEqual(renderedSets[0].weight);
    expect(renderedSets[1].rpe).toBeLessThan(renderedSets[0].rpe);
    expect(renderedSets[2].rpe).not.toBe(renderedSets[0].rpe);
  });

  it('4. STRENGTH_LINEAR LOGGER RENDER: Mounts WorkoutLogger and renders canonical top-set and back-off prescriptions', async () => {
    // Seed 147.06 kg baseline e1RM (100kg x 10 @ 8 RPE)
    const historyLog = createHistoricalLog('hist-sl-1', 'Barbell Squat', [
      { weight: 100, reps: 10, rpe: 8.0, isCompleted: true },
      { weight: 100, reps: 10, rpe: 8.0, isCompleted: true },
      { weight: 100, reps: 10, rpe: 8.0, isCompleted: true },
    ]);
    localStorage.setItem('workoutLogs', JSON.stringify([historyLog]));

    const templateExercise: ExerciseEntry = {
      name: 'Barbell Squat',
      muscleGroup: 'Legs',
      modality: 'weighted',
      movementCategory: 'compound',
      equipment: 'freeweight',
      isMainMovement: true,
      sets: [
        { setNumber: 1, weight: 100, reps: 10, rpe: 8.0, isCompleted: false },
        { setNumber: 2, weight: 100, reps: 10, rpe: 8.0, isCompleted: false },
        { setNumber: 3, weight: 100, reps: 10, rpe: 8.0, isCompleted: false },
      ],
    };

    const program: Program = {
      id: 'prog-sl-104',
      name: 'Linear Strength Program',
      daysPerWeek: 3,
      programDuration: 8,
      createdAt: '2026-01-01T00:00:00Z',
      objective: 'Strength',
      algorithmId: 'strength_linear',
      exercisesByDay: { 1: [templateExercise] },
    };
    storage.saveProgram(program);
    storage.setCurrentProgramId(program.id);

    // Week 2 of 8
    const canonicalTargetSets = calculateObjectiveSets({
      objective: 'Strength',
      exercise: templateExercise,
      exerciseIndex: 0,
      totalExercises: 1,
      weekNum: 2,
      programDuration: 8,
      previousLogs: storage.getWorkoutLogs(),
      userTouchedSets: {},
      checkedSets: {},
      algorithmId: 'strength_linear',
      templateExercise,
      activeUnit: 'kg',
      programId: program.id,
      dayNum: '1',
      targetDate: '2026-08-30',
      targetLogId: null,
      occurrenceOrdinal: 1,
    });

    let rendered: ReturnType<typeof render>;
    await act(async () => {
      rendered = render(
        <WorkoutLogger
          initialParams={{
            programId: program.id,
            week: '2',
            day: '1',
            date: '2026-08-30',
            isOneOff: false,
          }}
          onClose={() => {}}
          onSave={() => {}}
        />
      );
    });

    const renderedSets = extractRenderedSetsFromLogger(rendered!.container);
    expect(renderedSets).toHaveLength(3);

    // 1. Set 1 (Ordinal 1): Top Working Set (107.5 kg x 7 @ 7.5 RPE)
    expect(renderedSets[0].weight).toBe(canonicalTargetSets[0].weight);
    expect(renderedSets[0].reps).toBe(canonicalTargetSets[0].reps);
    expect(renderedSets[0].rpe).toBe(canonicalTargetSets[0].rpe);
    expect(renderedSets[0].weight).toBe(107.5);
    expect(renderedSets[0].reps).toBe(7);
    expect(renderedSets[0].rpe).toBe(7.5);

    // 2. Set 2 (Ordinal 2): Scheduled Back-off 1 (102.5 kg x 7 @ 6.5 RPE)
    expect(renderedSets[1].weight).toBe(canonicalTargetSets[1].weight);
    expect(renderedSets[1].reps).toBe(canonicalTargetSets[1].reps);
    expect(renderedSets[1].rpe).toBe(canonicalTargetSets[1].rpe);
    expect(renderedSets[1].weight).toBe(102.5);
    expect(renderedSets[1].reps).toBe(7);
    expect(renderedSets[1].rpe).toBe(6.5);

    // 3. Set 3 (Ordinal 3): Scheduled Back-off 2 (102.5 kg x 7 @ 7.0 RPE)
    expect(renderedSets[2].weight).toBe(canonicalTargetSets[2].weight);
    expect(renderedSets[2].reps).toBe(canonicalTargetSets[2].reps);
    expect(renderedSets[2].rpe).toBe(canonicalTargetSets[2].rpe);
    expect(renderedSets[2].weight).toBe(102.5);
    expect(renderedSets[2].reps).toBe(7);
    expect(renderedSets[2].rpe).toBe(7.0);

    // 4. Anti-cloning proof: Back-off Set 2 has lower RPE/load target than Set 1
    expect(renderedSets[1].rpe).toBeLessThan(renderedSets[0].rpe);
    expect(renderedSets[1].rpe).not.toBe(renderedSets[0].rpe);
    expect(renderedSets[1].weight).toBeLessThan(renderedSets[0].weight);
  });

  it('5. WARM-UP ORDINAL ISOLATION: Warm-up does not consume working ordinal 1, working sets display ordinals 1-3', async () => {
    // Explicitly isolate workout logs so no prior history overrides the 4-set template structure
    localStorage.setItem('workoutLogs', JSON.stringify([]));

    // Template with 1 warmup set and 3 working sets, using pristine template baseline (100kg x 10 @ 8 RPE)
    const templateExercise: ExerciseEntry = {
      name: 'Barbell Bench Press',
      muscleGroup: 'Chest',
      modality: 'weighted',
      movementCategory: 'compound',
      equipment: 'freeweight',
      isMainMovement: true,
      sets: [
        { setNumber: 1, weight: 50, reps: 10, rpe: 5.0, isWarmup: true, isCompleted: false },
        { setNumber: 2, weight: 100, reps: 10, rpe: 8.0, isWarmup: false, isCompleted: false },
        { setNumber: 3, weight: 100, reps: 10, rpe: 8.0, isWarmup: false, isCompleted: false },
        { setNumber: 4, weight: 100, reps: 10, rpe: 8.0, isWarmup: false, isCompleted: false },
      ],
    };

    const program: Program = {
      id: 'prog-wu-105',
      name: 'Warmup Isolation Program',
      daysPerWeek: 3,
      programDuration: 8,
      createdAt: '2026-01-01T00:00:00Z',
      objective: 'Hypertrophy',
      algorithmId: 'hypertrophy_step',
      exercisesByDay: { 1: [templateExercise] },
    };
    storage.saveProgram(program);
    storage.setCurrentProgramId(program.id);

    const canonicalTargetSets = calculateObjectiveSets({
      objective: 'Hypertrophy',
      exercise: templateExercise,
      exerciseIndex: 0,
      totalExercises: 1,
      weekNum: 1,
      programDuration: 8,
      previousLogs: storage.getWorkoutLogs(),
      userTouchedSets: {},
      checkedSets: {},
      algorithmId: 'hypertrophy_step',
      templateExercise,
      activeUnit: 'kg',
      programId: program.id,
      dayNum: '1',
      targetDate: '2026-08-30',
      targetLogId: null,
      occurrenceOrdinal: 1,
    });

    let rendered: ReturnType<typeof render>;
    await act(async () => {
      rendered = render(
        <WorkoutLogger
          initialParams={{
            programId: program.id,
            week: '1',
            day: '1',
            date: '2026-08-30',
            isOneOff: false,
          }}
          onClose={() => {}}
          onSave={() => {}}
        />
      );
    });

    const renderedSets = extractRenderedSetsFromLogger(rendered!.container);
    expect(renderedSets).toHaveLength(4);

    // 1. Warm-up Row (Row 0)
    expect(renderedSets[0].isWarmup).toBe(true);
    expect(renderedSets[0].weight).toBe(canonicalTargetSets[0].weight);

    // 2. Working Set 1 (Row 1): MUST display Ordinal 1 target (95.0 kg x 10 @ 7.0 RPE)
    expect(renderedSets[1].isWarmup).toBe(false);
    expect(renderedSets[1].weight).toBe(canonicalTargetSets[1].weight);
    expect(renderedSets[1].reps).toBe(canonicalTargetSets[1].reps);
    expect(renderedSets[1].rpe).toBe(canonicalTargetSets[1].rpe);
    expect(renderedSets[1].weight).toBe(95.0);
    expect(renderedSets[1].reps).toBe(10);
    expect(renderedSets[1].rpe).toBe(7.0);

    // 3. Working Set 2 (Row 2): MUST display Ordinal 2 target matching canonical authority
    expect(renderedSets[2].isWarmup).toBe(false);
    expect(renderedSets[2].weight).toBe(canonicalTargetSets[2].weight);
    expect(renderedSets[2].reps).toBe(canonicalTargetSets[2].reps);
    expect(renderedSets[2].rpe).toBe(canonicalTargetSets[2].rpe);

    // 4. Working Set 3 (Row 3): MUST display Ordinal 3 target matching canonical authority
    expect(renderedSets[3].isWarmup).toBe(false);
    expect(renderedSets[3].weight).toBe(canonicalTargetSets[3].weight);
    expect(renderedSets[3].reps).toBe(canonicalTargetSets[3].reps);
    expect(renderedSets[3].rpe).toBe(canonicalTargetSets[3].rpe);

    // 5. Verify warm-up was isolated from working-set fatigue ordering
    expect(renderedSets[1].weight).toBeGreaterThan(renderedSets[0].weight);
  });
});
