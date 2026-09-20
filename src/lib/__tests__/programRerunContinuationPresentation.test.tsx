// @vitest-environment happy-dom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/react';
import { ExerciseEntry, Program, WorkoutLog } from '../../types';
import { WorkoutLogger } from '../../components/WorkoutLogger';
import { ProgramBuilder } from '../../components/ProgramBuilder';
import { calculateObjectiveSets } from '../objectiveMath';
import { createProgramContinuation } from '../programContinuation';
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
 */
function extractRenderedSetsFromLogger(container: HTMLElement): RenderedSetTuple[] {
  const setRows: RenderedSetTuple[] = [];
  const gridRows = container.querySelectorAll('.grid');

  gridRows.forEach((row) => {
    const optionsButton = row.querySelector('button[title="Set Options"]');
    if (!optionsButton) return;

    const inputs = row.querySelectorAll('input[type="number"]');
    if (inputs.length >= 2) {
      const weightInput = inputs[0] as HTMLInputElement;
      const repsInput = inputs[1] as HTMLInputElement;

      const relativeContainers = row.querySelectorAll('.relative');
      const rpeButton = relativeContainers[0]?.querySelector('button') as HTMLButtonElement | null;

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

describe('METREPS — RPC-2A Real Component Behavioural Presentation Suite', () => {
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
    programId: string,
    programName: string,
    week: string,
    exerciseName: string,
    sets: { weight: number; reps: number; rpe: number; isWarmup?: boolean; isCompleted?: boolean }[]
  ): WorkoutLog => ({
    id,
    date: '2026-02-28',
    startTime: '09:00',
    programId,
    program: programName,
    week,
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

  it('Test 1 — Real WorkoutLogger continuation prescription: Mounts WorkoutLogger with successor program, renders Phase 5 targets with predecessor baseline', async () => {
    // 1. Setup completed 4-week predecessor program and Week 4 evidence
    const predecessorProgram: Program = {
      id: 'prog-pred-4wk',
      name: 'Hypertrophy Mastery',
      daysPerWeek: 3,
      programDuration: 4,
      createdAt: '2026-01-01T00:00:00Z',
      objective: 'Hypertrophy',
      algorithmId: 'hypertrophy_step',
      exercisesByDay: {
        1: [
          {
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
          },
        ],
      },
    };

    // Predecessor Week 4 log providing baseline evidence (110kg x 10 @ 8.0 RPE -> baseline e1RM ~ 146.67kg)
    const predecessorLog = createHistoricalLog(
      'log-pred-w4',
      predecessorProgram.id,
      predecessorProgram.name,
      '4',
      'Barbell Bench Press',
      [
        { weight: 110, reps: 10, rpe: 8.0, isCompleted: true },
        { weight: 110, reps: 10, rpe: 8.0, isCompleted: true },
        { weight: 110, reps: 10, rpe: 8.0, isCompleted: true },
      ]
    );

    // 2. Create successor program using production createProgramContinuation
    const successorProgram = createProgramContinuation({
      sourceProgram: predecessorProgram,
      newProgramId: 'prog-succ-cycle2',
      createdAt: '2026-03-01T00:00:00Z',
    });

    expect(successorProgram.parentProgramId).toBe('prog-pred-4wk');
    expect(successorProgram.cycleIndex).toBe(2);
    expect(successorProgram.algorithmPhaseOffset).toBe(4);
    expect(successorProgram.name).toBe('Hypertrophy Mastery — Cycle 2');

    // Save both programs and log to storage
    storage.saveProgram(predecessorProgram);
    storage.saveProgram(successorProgram);
    storage.saveWorkoutLog(predecessorLog);
    storage.setCurrentProgramId(successorProgram.id);

    // 3. Compute expected values via authoritative production calculation authority
    const templateEx = successorProgram.exercisesByDay[1][0];
    const authoritativeTargetSets = calculateObjectiveSets({
      objective: 'Hypertrophy',
      exercise: templateEx,
      exerciseIndex: 0,
      totalExercises: 1,
      weekNum: 1,
      programDuration: 4,
      previousLogs: storage.getWorkoutLogs(),
      userTouchedSets: {},
      checkedSets: {},
      algorithmId: 'hypertrophy_step',
      templateExercise: templateEx,
      activeUnit: 'kg',
      programId: successorProgram.id,
      dayNum: '1',
      targetDate: '2026-03-01',
      targetLogId: null,
      occurrenceOrdinal: 1,
      predecessorProgramId: successorProgram.parentProgramId,
      algorithmPhaseOffset: successorProgram.algorithmPhaseOffset,
    });

    // Compute legacy comparison (without continuation metadata)
    const legacyTargetSets = calculateObjectiveSets({
      objective: 'Hypertrophy',
      exercise: templateEx,
      exerciseIndex: 0,
      totalExercises: 1,
      weekNum: 1,
      programDuration: 4,
      previousLogs: storage.getWorkoutLogs(),
      userTouchedSets: {},
      checkedSets: {},
      algorithmId: 'hypertrophy_step',
      templateExercise: templateEx,
      activeUnit: 'kg',
      programId: successorProgram.id,
      dayNum: '1',
      targetDate: '2026-03-01',
      targetLogId: null,
      occurrenceOrdinal: 1,
      predecessorProgramId: null,
      algorithmPhaseOffset: 0,
    });

    // 4. Mount real WorkoutLogger for successor at Week 1, Day 1
    let rendered: ReturnType<typeof render>;
    await act(async () => {
      rendered = render(
        <WorkoutLogger
          initialParams={{
            programId: successorProgram.id,
            week: '1',
            day: '1',
            date: '2026-03-01',
            isOneOff: false,
          }}
          onClose={() => {}}
          onSave={() => {}}
        />
      );
    });

    const renderedSets = extractRenderedSetsFromLogger(rendered!.container);
    expect(renderedSets).toHaveLength(3);

    // Verify displayed stage header displays W1 / 4
    expect(rendered!.container.textContent).toContain('W1 / 4');

    // Verify Set 1 (Ordinal 1): Phase 5 target derived from predecessor baseline evidence
    // In Phase 5 (Block 2 Step 1), anchor reps is 8 @ RPE 7.5
    expect(renderedSets[0].setNumber).toBe(1);
    expect(renderedSets[0].reps).toBe(8); // Phase 5 anchor reps is 8 (compared to Phase 1 anchor reps of 10)
    expect(renderedSets[0].rpe).toBe(7.5);
    expect(renderedSets[0].weight).toBe(authoritativeTargetSets[0].weight);
    expect(renderedSets[0].weight).toBeGreaterThan(100); // Baseline evidence from 110kg predecessor applied

    // Verify Set 2 & Set 3 retain multi-set ordinal distribution
    expect(renderedSets[1].setNumber).toBe(2);
    expect(renderedSets[1].weight).toBe(authoritativeTargetSets[1].weight);
    expect(renderedSets[1].reps).toBe(authoritativeTargetSets[1].reps);

    expect(renderedSets[2].setNumber).toBe(3);
    expect(renderedSets[2].weight).toBe(authoritativeTargetSets[2].weight);
    expect(renderedSets[2].reps).toBe(authoritativeTargetSets[2].reps);

    // Crucial check: rendered continuation output strictly differs from legacy calculation without continuation
    expect(renderedSets[0].reps).not.toBe(legacyTargetSets[0].reps);
    expect(renderedSets[0].weight).not.toBe(legacyTargetSets[0].weight);
  });

  it('Test 2 — Real added-set interaction: Clicking Add Set on mounted WorkoutLogger creates continuation-aware target', async () => {
    // 1. Setup predecessor and successor with 3 initial working sets
    const predecessorProgram: Program = {
      id: 'prog-pred-addset',
      name: 'Hypertrophy Mastery',
      daysPerWeek: 3,
      programDuration: 4,
      createdAt: '2026-01-01T00:00:00Z',
      objective: 'Hypertrophy',
      algorithmId: 'hypertrophy_step',
      exercisesByDay: {
        1: [
          {
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
          },
        ],
      },
    };

    const predecessorLog = createHistoricalLog(
      'log-pred-addset-w4',
      predecessorProgram.id,
      predecessorProgram.name,
      '4',
      'Barbell Bench Press',
      [
        { weight: 110, reps: 10, rpe: 8.0, isCompleted: true },
        { weight: 110, reps: 10, rpe: 8.0, isCompleted: true },
        { weight: 110, reps: 10, rpe: 8.0, isCompleted: true },
      ]
    );

    const successorProgram = createProgramContinuation({
      sourceProgram: predecessorProgram,
      newProgramId: 'prog-succ-addset',
      createdAt: '2026-03-01T00:00:00Z',
    });

    storage.saveProgram(predecessorProgram);
    storage.saveProgram(successorProgram);
    storage.saveWorkoutLog(predecessorLog);
    storage.setCurrentProgramId(successorProgram.id);

    // 2. Mount real WorkoutLogger
    let rendered: ReturnType<typeof render>;
    await act(async () => {
      rendered = render(
        <WorkoutLogger
          initialParams={{
            programId: successorProgram.id,
            week: '1',
            day: '1',
            date: '2026-03-01',
            isOneOff: false,
          }}
          onClose={() => {}}
          onSave={() => {}}
        />
      );
    });

    const initialSets = extractRenderedSetsFromLogger(rendered!.container);
    expect(initialSets).toHaveLength(3);

    // 3. Find and click the real "Add set 4" button in the DOM
    const addSetButton = Array.from(rendered!.container.querySelectorAll('button')).find(
      btn => btn.textContent?.includes('Add set 4')
    );
    expect(addSetButton).toBeDefined();

    await act(async () => {
      fireEvent.click(addSetButton!);
    });

    // 4. Verify 4 sets are now rendered in the logger
    const updatedSets = extractRenderedSetsFromLogger(rendered!.container);
    expect(updatedSets).toHaveLength(4);

    const addedSet = updatedSets[3];
    expect(addedSet.setNumber).toBe(4);
    expect(addedSet.weight).toBeGreaterThan(100); // Uses predecessor baseline load
    expect(addedSet.reps).toBe(7); // Working ordinal 4 fatigue-profile target in Phase 5
    expect(addedSet.rpe).toBe(9.0); // Working ordinal 4 RPE target in Phase 5
    expect(addedSet.isWarmup).toBe(false);

    // 5. Verify warm-up rows do not consume working-set ordinals
    cleanup();
    const warmupLog = createHistoricalLog(
      'log-pred-warmup-w4',
      predecessorProgram.id,
      predecessorProgram.name,
      '4',
      'Incline Dumbbell Press',
      [
        { weight: 20, reps: 10, rpe: 5.0, isWarmup: true, isCompleted: true },
        { weight: 40, reps: 10, rpe: 8.0, isWarmup: false, isCompleted: true },
        { weight: 40, reps: 10, rpe: 8.0, isWarmup: false, isCompleted: true },
      ]
    );

    const warmupProgram: Program = {
      id: 'prog-succ-warmup-addset',
      name: 'Hypertrophy Mastery — Cycle 2',
      daysPerWeek: 3,
      programDuration: 4,
      createdAt: '2026-03-01T00:00:00Z',
      objective: 'Hypertrophy',
      algorithmId: 'hypertrophy_step',
      parentProgramId: 'prog-pred-addset',
      cycleIndex: 2,
      algorithmPhaseOffset: 4,
      exercisesByDay: {
        1: [
          {
            name: 'Incline Dumbbell Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            movementCategory: 'compound',
            equipment: 'freeweight',
            isMainMovement: true,
            sets: [
              { setNumber: 1, weight: 20, reps: 10, rpe: 5.0, isWarmup: true, isCompleted: false },
              { setNumber: 2, weight: 40, reps: 10, rpe: 8.0, isWarmup: false, isCompleted: false },
              { setNumber: 3, weight: 40, reps: 10, rpe: 8.0, isWarmup: false, isCompleted: false },
            ],
          },
        ],
      },
    };
    storage.saveProgram(warmupProgram);
    storage.saveWorkoutLog(warmupLog);
    storage.setCurrentProgramId(warmupProgram.id);

    let warmupRendered: ReturnType<typeof render>;
    await act(async () => {
      warmupRendered = render(
        <WorkoutLogger
          initialParams={{
            programId: warmupProgram.id,
            week: '1',
            day: '1',
            date: '2026-03-01',
            isOneOff: false,
          }}
          onClose={() => {}}
          onSave={() => {}}
        />
      );
    });

    const warmupAddButton = Array.from(warmupRendered!.container.querySelectorAll('button')).find(
      btn => btn.textContent?.includes('Add set 4')
    );
    expect(warmupAddButton).toBeDefined();

    await act(async () => {
      fireEvent.click(warmupAddButton!);
    });

    const warmupUpdatedSets = extractRenderedSetsFromLogger(warmupRendered!.container);
    expect(warmupUpdatedSets).toHaveLength(4);
    // Set 1 is warmup; Set 2 is working ordinal 1; Set 3 is working ordinal 2; Set 4 is working ordinal 3
    const addedWorkingSet3 = warmupUpdatedSets[3];
    expect(addedWorkingSet3.setNumber).toBe(4);
    expect(addedWorkingSet3.reps).toBe(7); // Working ordinal 3 receives 7 reps (distributed fatigue under Phase 5 anchor)
    expect(addedWorkingSet3.rpe).toBe(8.5); // Working ordinal 3 receives 8.5 RPE (compared to ordinal 4 receiving 9.0 RPE)
    expect(addedWorkingSet3.isWarmup).toBe(false);
  });

  it('Test 3 — Real ProgramBuilder edit/save preservation: Modifying program in ProgramBuilder preserves lineage metadata', async () => {
    // 1. Seed storage with continuation Program containing full lineage metadata
    const sampleExercise: ExerciseEntry = {
      name: 'Barbell Bench Press',
      muscleGroup: 'Chest',
      modality: 'weighted',
      movementCategory: 'compound',
      equipment: 'freeweight',
      isMainMovement: true,
      sets: [
        { setNumber: 1, weight: 100, reps: 10, rpe: 8.0, isCompleted: false },
      ],
    };

    const predecessorProgram: Program = {
      id: 'pred-prog-edit',
      name: 'Hypertrophy Foundation',
      daysPerWeek: 3,
      programDuration: 4,
      createdAt: '2026-01-01T00:00:00Z',
      objective: 'Hypertrophy',
      algorithmId: 'hypertrophy_step',
      exercisesByDay: { 1: [sampleExercise], 2: [sampleExercise], 3: [sampleExercise] },
    };

    const continuationProgram: Program = {
      id: 'continuation-prog-edit',
      name: 'Hypertrophy Foundation — Cycle 2',
      daysPerWeek: 3,
      programDuration: 4,
      createdAt: '2026-02-01T00:00:00Z',
      objective: 'Hypertrophy',
      algorithmId: 'hypertrophy_step',
      exercisesByDay: { 1: [sampleExercise], 2: [sampleExercise], 3: [sampleExercise] },
      parentProgramId: 'pred-prog-edit',
      cycleIndex: 2,
      algorithmPhaseOffset: 4,
      assignedWeekdays: { 1: 0, 2: 2, 3: 4 },
    };

    storage.saveProgram(predecessorProgram);
    storage.saveProgram(continuationProgram);
    storage.setCurrentProgramId(continuationProgram.id);

    // 2. Mount real ProgramBuilder in edit mode (loads active program)
    let rendered: ReturnType<typeof render>;
    await act(async () => {
      rendered = render(
        <ProgramBuilder onClose={() => {}} onSave={() => {}} />
      );
    });

    // 3. Make an editable change via UI controls (modify duration via dropdown)
    // Find Program Duration button (contains '4 Weeks')
    const durationDropdownButton = Array.from(rendered!.container.querySelectorAll('button')).find(
      btn => btn.textContent?.includes('4 Weeks')
    );
    expect(durationDropdownButton).toBeDefined();

    await act(async () => {
      fireEvent.click(durationDropdownButton!);
    });

    // Select 8 Weeks option from opened dropdown
    const eightWeeksButton = Array.from(rendered!.container.querySelectorAll('button')).find(
      btn => btn.textContent?.trim() === '8 Weeks'
    );
    expect(eightWeeksButton).toBeDefined();

    await act(async () => {
      fireEvent.click(eightWeeksButton!);
    });

    // 4. Click Save Program button
    const saveButton = Array.from(rendered!.container.querySelectorAll('button')).find(
      btn => btn.textContent?.includes('Save Program')
    );
    expect(saveButton).toBeDefined();

    await act(async () => {
      fireEvent.click(saveButton!);
    });
    await act(async () => {
      const saveChanges = Array.from(rendered!.container.querySelectorAll('button')).find(
        btn => btn.textContent?.trim() === 'Save Changes'
      );
      expect(saveChanges).toBeDefined();
      fireEvent.click(saveChanges!);
    });

    // 5. Read back saved program from storage authority
    const savedContinuation = storage.getPrograms().find(p => p.id === continuationProgram.id);
    expect(savedContinuation).toBeDefined();

    // Verify duration changed to 8
    expect(savedContinuation!.programDuration).toBe(8);

    // Verify lineage metadata remains fully preserved
    expect(savedContinuation!.parentProgramId).toBe('pred-prog-edit');
    expect(savedContinuation!.cycleIndex).toBe(2);
    expect(savedContinuation!.algorithmPhaseOffset).toBe(4);

    // Verify predecessor program in storage was not mutated
    const savedPredecessor = storage.getPrograms().find(p => p.id === predecessorProgram.id);
    expect(savedPredecessor).toBeDefined();
    expect(savedPredecessor!.programDuration).toBe(4);
    expect(savedPredecessor!.parentProgramId).toBeUndefined();
  });

  it('Test 4 — Normal new Program isolation: Saving a normal new Program does not invent or leak continuation metadata', async () => {
    // Reset stored programs and active program
    localStorage.removeItem('programList');
    storage.setCurrentProgramId(null);

    // Mount real ProgramBuilder for a fresh new program
    let rendered: ReturnType<typeof render>;
    await act(async () => {
      rendered = render(
        <ProgramBuilder onClose={() => {}} onSave={() => {}} />
      );
    });

    // Add a required exercise to each of the 3 days to allow saving
    // Day 1 is selected by default; click "+ Add Exercise" or choose template
    const templateButton = Array.from(rendered!.container.querySelectorAll('button')).find(
      btn => btn.textContent?.includes('Milhouse Mass Split')
    );
    expect(templateButton).toBeDefined();

    await act(async () => {
      fireEvent.click(templateButton!);
    });

    // Save program directly via UI
    const saveButton = Array.from(rendered!.container.querySelectorAll('button')).find(
      btn => btn.textContent?.includes('Save Program')
    );
    expect(saveButton).toBeDefined();

    await act(async () => {
      fireEvent.click(saveButton!);
    });

    const savedPrograms = storage.getPrograms();
    expect(savedPrograms.length).toBeGreaterThan(0);

    const newProgram = savedPrograms[savedPrograms.length - 1];
    expect(newProgram.parentProgramId).toBeUndefined();
    expect(newProgram.cycleIndex).toBeUndefined();
    expect(newProgram.algorithmPhaseOffset).toBeUndefined();
  });

  it('Test 5 — Legacy WorkoutLogger control: Legacy program without continuation metadata preserves exact legacy targets', async () => {
    // Setup legacy program with 3 sets and no continuation metadata
    const templateEx: ExerciseEntry = {
      name: 'Barbell Bench Press (flat)',
      muscleGroup: 'Pecs',
      modality: 'weighted',
      movementCategory: 'compound',
      equipment: 'freeweight',
      isMainMovement: true,
      sets: [
        { setNumber: 1, weight: 80, reps: 10, rpe: 8.0, isCompleted: false },
        { setNumber: 2, weight: 80, reps: 10, rpe: 8.0, isCompleted: false },
        { setNumber: 3, weight: 80, reps: 10, rpe: 8.0, isCompleted: false },
      ],
    };

    const legacyProgram: Program = {
      id: 'prog-legacy-control',
      name: 'Classic Full Body',
      daysPerWeek: 3,
      programDuration: 8,
      createdAt: '2026-01-01T00:00:00Z',
      objective: 'Hypertrophy',
      algorithmId: 'hypertrophy_step',
      exercisesByDay: {
        1: [templateEx],
      },
    };

    storage.saveProgram(legacyProgram);
    storage.setCurrentProgramId(legacyProgram.id);

    // Compute expected legacy targets (with predecessorProgramId: null, algorithmPhaseOffset: 0)
    const expectedLegacySets = calculateObjectiveSets({
      objective: 'Hypertrophy',
      exercise: templateEx,
      exerciseIndex: 0,
      totalExercises: 1,
      weekNum: 1,
      programDuration: 8,
      previousLogs: storage.getWorkoutLogs(),
      userTouchedSets: {},
      checkedSets: {},
      algorithmId: 'hypertrophy_step',
      templateExercise: templateEx,
      activeUnit: 'kg',
      programId: legacyProgram.id,
      dayNum: '1',
      targetDate: '2026-03-01',
      targetLogId: null,
      occurrenceOrdinal: 1,
      predecessorProgramId: null,
      algorithmPhaseOffset: 0,
    });

    // Mount real WorkoutLogger
    let rendered: ReturnType<typeof render>;
    await act(async () => {
      rendered = render(
        <WorkoutLogger
          initialParams={{
            programId: legacyProgram.id,
            week: '1',
            day: '1',
            date: '2026-03-01',
            isOneOff: false,
          }}
          onClose={() => {}}
          onSave={() => {}}
        />
      );
    });

    const renderedSets = extractRenderedSetsFromLogger(rendered!.container);
    expect(renderedSets).toHaveLength(3);

    // Verify Set 1, 2, 3 match expected legacy calculations perfectly (Phase 1 reps 10 @ RPE 7.0)
    expect(renderedSets[0].setNumber).toBe(1);
    expect(renderedSets[0].weight).toBe(expectedLegacySets[0].weight);
    expect(renderedSets[0].reps).toBe(expectedLegacySets[0].reps);
    expect(renderedSets[0].rpe).toBe(expectedLegacySets[0].rpe);
    expect(renderedSets[0].reps).toBe(10); // Standard Phase 1 reps

    expect(renderedSets[1].setNumber).toBe(2);
    expect(renderedSets[1].weight).toBe(expectedLegacySets[1].weight);
    expect(renderedSets[1].reps).toBe(expectedLegacySets[1].reps);
    expect(renderedSets[1].rpe).toBe(expectedLegacySets[1].rpe);

    expect(renderedSets[2].setNumber).toBe(3);
    expect(renderedSets[2].weight).toBe(expectedLegacySets[2].weight);
    expect(renderedSets[2].reps).toBe(expectedLegacySets[2].reps);
    expect(renderedSets[2].rpe).toBe(expectedLegacySets[2].rpe);
  });
});
