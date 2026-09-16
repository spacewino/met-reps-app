// @vitest-environment happy-dom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ExerciseSelectorModal, ExerciseItem } from '../../components/ExerciseSelectorModal';
import { ProgramBuilder } from '../../components/ProgramBuilder';
import { WorkoutLogger } from '../../components/WorkoutLogger';
import { createProgramContinuation } from '../programContinuation';
import {
  isCustomExerciseKey,
  generateUniqueCustomExerciseKey,
  prepareMigratedCustomCatalog,
  loadAndRepairCustomExercises
} from '../customExerciseIdentity';
import { resolveExerciseKey } from '../exerciseIdentity';
import { getExerciseClassification } from '../exerciseClassification';
import { storage } from '../storage';
import { WorkoutLog, Program, ExerciseEntry } from '../../types';

// Mock storage
const memoryStore: Record<string, string> = {};
const mockStorage = {
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

globalThis.localStorage = mockStorage as any;

if (typeof window !== 'undefined') {
  window.scrollTo = (() => {}) as any;
  window.confirm = (() => true) as any;
  window.alert = (() => {}) as any;
}

describe('APC-3A2B: Custom Exercise Identity Invariant Suite', () => {
  beforeEach(() => {
    mockStorage.clear();
    vi.restoreAllMocks();
    window.confirm = () => true;
    window.alert = () => {};
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe('Invariant 1: Unique UUID-backed keys generated for new custom exercises', () => {
    it('generates a valid custom_<uuid> key matching RFC 4122 v4 pattern', () => {
      const existing: ExerciseItem[] = [];
      const key1 = generateUniqueCustomExerciseKey(existing);
      const key2 = generateUniqueCustomExerciseKey(existing);

      expect(isCustomExerciseKey(key1)).toBe(true);
      expect(isCustomExerciseKey(key2)).toBe(true);
      expect(key1).not.toBe(key2);
      expect(key1).toMatch(/^custom_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('creates and persists a unique custom key when adding a new custom exercise via modal UI', () => {
      let selected: ExerciseItem[] = [];
      const onSelect = vi.fn((items: ExerciseItem[]) => { selected = items; });
      const onClose = vi.fn();

      render(
        <ExerciseSelectorModal
          isOpen={true}
          onClose={onClose}
          onSelect={onSelect}
        />
      );

      // Click "Add Custom Exercise"
      const customBtn = screen.getByRole('button', { name: /Add Custom Exercise/i });
      fireEvent.click(customBtn);

      // Fill form
      const nameInput = screen.getByPlaceholderText(/e\.g\. Incline DB Bench Press/i);
      fireEvent.change(nameInput, { target: { value: 'Belt Squat' } });

      // Click "Add & Select"
      const addBtn = screen.getByRole('button', { name: /Add & Select/i });
      fireEvent.click(addBtn);

      // Confirm in selected exercises
      const confirmBtn = screen.getByRole('button', { name: /Add to Workout \(1\)/i });
      fireEvent.click(confirmBtn);

      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(selected.length).toBe(1);
      expect(selected[0].name).toBe('Belt Squat');
      expect(isCustomExerciseKey(selected[0].exerciseKey)).toBe(true);

      // Verify persisted in localStorage
      const persisted = JSON.parse(mockStorage.getItem('metreps_custom_exercises') || '[]');
      expect(persisted.length).toBe(1);
      expect(persisted[0].name).toBe('Belt Squat');
      expect(persisted[0].exerciseKey).toBe(selected[0].exerciseKey);
    });
  });

  describe('Invariant 2: Custom key remains identical across renames', () => {
    it('preserves the original exerciseKey when a custom exercise is renamed', () => {
      const originalKey = 'custom_11111111-2222-4333-8444-555555555555';
      const initialCatalog: ExerciseItem[] = [
        {
          name: 'My Special Press',
          category: 'Chest',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'freeweight',
          exerciseKey: originalKey
        }
      ];
      mockStorage.setItem('metreps_custom_exercises', JSON.stringify(initialCatalog));

      let selected: ExerciseItem[] = [];
      const onSelect = vi.fn((items: ExerciseItem[]) => { selected = items; });
      const onClose = vi.fn();

      render(
        <ExerciseSelectorModal
          isOpen={true}
          onClose={onClose}
          onSelect={onSelect}
        />
      );

      // Click Edit pencil on 'My Special Press'
      const heading = screen.getByRole('heading', { name: /^My Special Press$/i });
      const row = heading.closest('div.border-y') || heading.parentElement!.parentElement!.parentElement!;
      const editBtn = row.querySelector('[title="Edit Exercise"]') as HTMLButtonElement;
      fireEvent.click(editBtn);

      // Rename to 'Incline DB Press v2'
      const nameInput = screen.getByPlaceholderText(/e\.g\. Incline DB Bench Press/i);
      fireEvent.change(nameInput, { target: { value: 'Incline DB Press v2' } });

      // Click "Save Changes"
      const saveBtn = screen.getByRole('button', { name: /Save Changes/i });
      fireEvent.click(saveBtn);

      // Select it and confirm
      const confirmBtn = screen.getByRole('button', { name: /Add to Workout \(1\)/i });
      fireEvent.click(confirmBtn);

      expect(selected.length).toBe(1);
      expect(selected[0].name).toBe('Incline DB Press v2');
      expect(selected[0].exerciseKey).toBe(originalKey);

      // Check persisted catalog
      const persisted = JSON.parse(mockStorage.getItem('metreps_custom_exercises') || '[]');
      expect(persisted.length).toBe(1);
      expect(persisted[0].name).toBe('Incline DB Press v2');
      expect(persisted[0].exerciseKey).toBe(originalKey);
    });
  });

  describe('Invariant 3: Custom key remains identical across category / modality / equipment edits', () => {
    it('preserves exerciseKey when metadata changes without name change', () => {
      const originalKey = 'custom_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
      const initialCatalog: ExerciseItem[] = [
        {
          name: 'Custom Pull',
          category: 'Back',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'freeweight',
          exerciseKey: originalKey
        }
      ];
      mockStorage.setItem('metreps_custom_exercises', JSON.stringify(initialCatalog));

      render(
        <ExerciseSelectorModal
          isOpen={true}
          onClose={() => {}}
          onSelect={() => {}}
        />
      );

      // Click edit
      const heading = screen.getByRole('heading', { name: /^Custom Pull$/i });
      const row = heading.closest('div.border-y') || heading.parentElement!.parentElement!.parentElement!;
      const editBtn = row.querySelector('[title="Edit Exercise"]') as HTMLButtonElement;
      fireEvent.click(editBtn);

      // Switch modality to 'bodyweight'
      const bodyweightBtn = screen.getByRole('button', { name: /^Bodyweight/i });
      fireEvent.click(bodyweightBtn);

      // Switch equipment to 'machine'
      const machineBtn = screen.getByRole('button', { name: /^Machine/i });
      fireEvent.click(machineBtn);

      // Save
      const saveBtn = screen.getByRole('button', { name: /Save Changes/i });
      fireEvent.click(saveBtn);

      const persisted = JSON.parse(mockStorage.getItem('metreps_custom_exercises') || '[]');
      expect(persisted.length).toBe(1);
      expect(persisted[0].name).toBe('Custom Pull');
      expect(persisted[0].exerciseKey).toBe(originalKey);
      expect(persisted[0].modality).toBe('bodyweight');
      expect(persisted[0].equipment).toBe('machine');
    });
  });

  describe('Invariant 4 & 5: Legacy unkeyed custom entries repaired atomically and stably', () => {
    it('repairs unkeyed or legacy-keyed entries deterministically or with unique UUIDs without duplicate generation', () => {
      const legacyRaw = [
        { name: 'Legacy Exercise A', category: 'Chest', modality: 'weighted' },
        { id: '12345678-1234-4234-8234-123456789abc', name: 'Legacy Exercise B', category: 'Back' },
        { id: 'custom_legacy_c', name: 'Legacy Exercise C', category: 'Legs' },
        { exerciseKey: 'custom_valid_key_1111', name: 'Valid Exercise D', category: 'Arms' }
      ];
      mockStorage.setItem('metreps_custom_exercises', JSON.stringify(legacyRaw));

      // First load
      const repaired1 = loadAndRepairCustomExercises(mockStorage);
      expect(repaired1.length).toBe(4);
      expect(isCustomExerciseKey(repaired1[0].exerciseKey)).toBe(true);
      expect(isCustomExerciseKey(repaired1[1].exerciseKey)).toBe(true);
      expect(isCustomExerciseKey(repaired1[2].exerciseKey)).toBe(true);
      expect(repaired1[3].exerciseKey).toBe('custom_valid_key_1111');

      // Keys must all be distinct
      const keysSet = new Set(repaired1.map(r => r.exerciseKey));
      expect(keysSet.size).toBe(4);

      const savedJson1 = mockStorage.getItem('metreps_custom_exercises');

      // Second load must be identical without regenerating new UUIDs
      const repaired2 = loadAndRepairCustomExercises(mockStorage);
      expect(repaired2).toEqual(repaired1);
      expect(mockStorage.getItem('metreps_custom_exercises')).toBe(savedJson1);
    });
  });

  describe('Invariant 6: Two same-name custom exercises receive distinct keys and remain independent', () => {
    it('maintains distinct identities and independent deletion for custom exercises with duplicate names', () => {
      const key1 = 'custom_11111111-1111-4111-8111-111111111111';
      const key2 = 'custom_22222222-2222-4222-8222-222222222222';
      const initialCatalog: ExerciseItem[] = [
        { name: 'Same Name', category: 'Quads', modality: 'weighted', exerciseKey: key1 },
        { name: 'Same Name', category: 'Glutes', modality: 'bodyweight', exerciseKey: key2 }
      ];
      mockStorage.setItem('metreps_custom_exercises', JSON.stringify(initialCatalog));

      render(
        <ExerciseSelectorModal
          isOpen={true}
          onClose={() => {}}
          onSelect={() => {}}
        />
      );

      // Should have 2 delete buttons
      const deleteButtons = screen.getAllByTitle('Delete Custom Exercise');
      expect(deleteButtons.length).toBe(2);

      // Delete the first one
      fireEvent.click(deleteButtons[0]);

      const persisted = JSON.parse(mockStorage.getItem('metreps_custom_exercises') || '[]');
      expect(persisted.length).toBe(1);
      expect(persisted[0].exerciseKey).toBe(key2);
      expect(persisted[0].category).toBe('Glutes');
    });
  });

  describe('Invariant 7: Custom exercise sharing built-in display name receives distinct custom_ key', () => {
    it('does not alias built-in exerciseKey when custom exercise is named like a built-in', () => {
      const customKey = 'custom_99999999-9999-4999-8999-999999999999';
      const initialCatalog: ExerciseItem[] = [
        { name: 'Bench Press', category: 'Chest', modality: 'weighted', exerciseKey: customKey }
      ];
      mockStorage.setItem('metreps_custom_exercises', JSON.stringify(initialCatalog));

      const loaded = loadAndRepairCustomExercises(mockStorage);
      const customBench = loaded.find(c => c.name === 'Bench Press');
      expect(customBench?.exerciseKey).toBe(customKey);
      expect(customBench?.exerciseKey).not.toBe('bench_press');

      // getExerciseClassification resolves custom item by key
      const classInfo = getExerciseClassification({ name: 'Bench Press', modality: 'weighted', exerciseKey: customKey });
      expect(classInfo.category).toBeDefined();
    });
  });

  describe('Invariant 8: Custom rename/edit leaves historical logs, programs, and drafts byte-for-byte unmodified', () => {
    it('does not touch workoutLogs, programList, or metreps_workout_draft on custom exercise edits', () => {
      const targetKey = 'custom_77777777-7777-4777-8777-777777777777';
      const initialCatalog: ExerciseItem[] = [
        { name: 'Old Custom Name', category: 'Shoulders', modality: 'weighted', exerciseKey: targetKey }
      ];
      const initialLog: WorkoutLog = {
        id: 'log-1',
        date: '2026-03-01',
        unit: 'kg',
        exercises: [{ name: 'Old Custom Name', muscleGroup: 'Shoulders', modality: 'weighted', sets: [{ setNumber: 1, weight: 50, reps: 10 }] }]
      };
      const initialProgram: Program = {
        id: 'prog-1',
        name: 'Hypertrophy Block',
        daysPerWeek: 3,
        programDuration: 8,
        createdAt: '2026-03-01T00:00:00.000Z',
        exercisesByDay: { 1: [{ name: 'Old Custom Name', muscleGroup: 'Shoulders', modality: 'weighted', sets: [{ setNumber: 1, weight: 50, reps: 10 }] }] }
      };
      const initialDraft = {
        exercises: [{ name: 'Old Custom Name', muscleGroup: 'Shoulders', sets: [] }]
      };

      mockStorage.setItem('metreps_custom_exercises', JSON.stringify(initialCatalog));
      mockStorage.setItem('workoutLogs', JSON.stringify([initialLog]));
      mockStorage.setItem('programList', JSON.stringify([initialProgram]));
      mockStorage.setItem('metreps_workout_draft', JSON.stringify(initialDraft));

      render(
        <ExerciseSelectorModal
          isOpen={true}
          onClose={() => {}}
          onSelect={() => {}}
        />
      );

      // Edit exercise
      const heading = screen.getByRole('heading', { name: /^Old Custom Name$/i });
      const row = heading.closest('div.border-y') || heading.parentElement!.parentElement!.parentElement!;
      const editBtn = row.querySelector('[title="Edit Exercise"]') as HTMLButtonElement;
      fireEvent.click(editBtn);

      const nameInput = screen.getByPlaceholderText(/e\.g\. Incline DB Bench Press/i);
      fireEvent.change(nameInput, { target: { value: 'New Custom Name' } });

      const saveBtn = screen.getByRole('button', { name: /Save Changes/i });
      fireEvent.click(saveBtn);

      // Verify logs, programs, drafts are unmodified strings
      expect(mockStorage.getItem('workoutLogs')).toBe(JSON.stringify([initialLog]));
      expect(mockStorage.getItem('programList')).toBe(JSON.stringify([initialProgram]));
      expect(mockStorage.getItem('metreps_workout_draft')).toBe(JSON.stringify(initialDraft));
    });
  });

  describe('Invariant 9: Deleting custom exercise removes only that key from catalog and leaves logs/programs intact', () => {
    it('deletes from custom library but does not delete historical records', () => {
      const delKey = 'custom_33333333-3333-4333-8333-333333333333';
      const keepKey = 'custom_44444444-4444-4444-8444-444444444444';
      const initialCatalog: ExerciseItem[] = [
        { name: 'To Delete', category: 'Back', exerciseKey: delKey },
        { name: 'To Keep', category: 'Chest', exerciseKey: keepKey }
      ];
      const initialLog: WorkoutLog = {
        id: 'log-delete-test',
        date: '2026-03-01',
        unit: 'kg',
        exercises: [{ name: 'To Delete', muscleGroup: 'Back', exerciseKey: delKey, sets: [] }]
      };

      mockStorage.setItem('metreps_custom_exercises', JSON.stringify(initialCatalog));
      mockStorage.setItem('workoutLogs', JSON.stringify([initialLog]));

      render(
        <ExerciseSelectorModal
          isOpen={true}
          onClose={() => {}}
          onSelect={() => {}}
        />
      );

      const delButtons = screen.getAllByTitle('Delete Custom Exercise');
      fireEvent.click(delButtons[0]); // delete 'To Delete'

      const updatedCatalog = JSON.parse(mockStorage.getItem('metreps_custom_exercises') || '[]');
      expect(updatedCatalog.length).toBe(1);
      expect(updatedCatalog[0].exerciseKey).toBe(keepKey);

      expect(mockStorage.getItem('workoutLogs')).toBe(JSON.stringify([initialLog]));
    });
  });

  describe('Invariant 10: Selection propagates exact exerciseKey', () => {
    it('propagates exact custom exerciseKey on single and multi selection', () => {
      const key1 = 'custom_55555555-5555-4555-8555-555555555555';
      const initialCatalog: ExerciseItem[] = [
        { name: 'Custom Lateral Raise', category: 'Shoulders', modality: 'weighted', exerciseKey: key1 }
      ];
      mockStorage.setItem('metreps_custom_exercises', JSON.stringify(initialCatalog));

      let selected: ExerciseItem[] = [];
      render(
        <ExerciseSelectorModal
          isOpen={true}
          onClose={() => {}}
          onSelect={(items) => { selected = items; }}
        />
      );

      // Select 'Custom Lateral Raise'
      const rowBtn = screen.getByRole('heading', { name: /^Custom Lateral Raise$/i }).closest('button');
      fireEvent.click(rowBtn!);

      const confirmBtn = screen.getByRole('button', { name: /Add to Workout \(1\)/i });
      fireEvent.click(confirmBtn);

      expect(selected.length).toBe(1);
      expect(selected[0].exerciseKey).toBe(key1);
      expect(resolveExerciseKey(selected[0])).toBe(key1);
    });
  });

  describe('Invariant 11: Storage failure handling', () => {
    it('gracefully handles localStorage failures without corrupting in-memory state with invalid mutations', () => {
      const initialCatalog: ExerciseItem[] = [
        { name: 'Existing Exercise', category: 'Chest', exerciseKey: 'custom_existing_key' }
      ];
      mockStorage.setItem('metreps_custom_exercises', JSON.stringify(initialCatalog));

      // Simulate failing setItem
      const originalSetItem = mockStorage.setItem;
      mockStorage.setItem = () => {
        throw new Error('QuotaExceededError');
      };

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(
        <ExerciseSelectorModal
          isOpen={true}
          onClose={() => {}}
          onSelect={() => {}}
        />
      );

      // Try to create custom
      const customBtn = screen.getByRole('button', { name: /Add Custom Exercise/i });
      fireEvent.click(customBtn);

      const nameInput = screen.getByPlaceholderText(/e\.g\. Incline DB Bench Press/i);
      fireEvent.change(nameInput, { target: { value: 'Failing Add' } });

      const addBtn = screen.getByRole('button', { name: /Add & Select/i });
      fireEvent.click(addBtn);

      expect(consoleSpy).toHaveBeenCalled();

      // Restore storage
      mockStorage.setItem = originalSetItem;
    });
  });

  describe('Invariant 12: Failed migration collision & fail-closed protection', () => {
    it('blocks selection, editing, and deletion for unkeyed custom exercises if migration persistence failed', () => {
      // Seed two unkeyed custom exercises with the exact same name
      const unkeyedDuplicates: ExerciseItem[] = [
        { name: 'Same Name Custom', category: 'Chest', modality: 'weighted' },
        { name: 'Same Name Custom', category: 'Back', modality: 'weighted' },
      ];
      mockStorage.setItem('metreps_custom_exercises', JSON.stringify(unkeyedDuplicates));

      // Force storage failure during migration
      const originalSetItem = mockStorage.setItem;
      mockStorage.setItem = (key: string, val: string) => {
        if (key === 'metreps_custom_exercises') {
          throw new Error('QuotaExceededError during migration');
        }
        memoryStore[key] = String(val);
      };

      try {
        // Verify loadAndRepair returns unkeyed items without generating exposed keys
        const loaded = loadAndRepairCustomExercises(mockStorage);
        expect(loaded.length).toBe(2);
        expect(loaded[0].exerciseKey).toBeUndefined();
        expect(loaded[1].exerciseKey).toBeUndefined();

        const alertSpy = vi.fn();
        window.alert = alertSpy;
        (globalThis as any).alert = alertSpy;
        const onSelectSpy = vi.fn();

        render(
          <ExerciseSelectorModal
            isOpen={true}
            onClose={() => {}}
            onSelect={onSelectSpy}
          />
        );

        // Attempt to toggle check on the first unkeyed custom exercise
        const headings = screen.getAllByRole('heading', { name: /^Same Name Custom$/i });
        expect(headings.length).toBe(2);

        const firstRowBtn = headings[0].closest('button');
        fireEvent.click(firstRowBtn!);

        // Should trigger fail-closed alert and block selection
        expect(alertSpy).toHaveBeenCalledWith('Custom exercise identity could not be saved. Please reload and try again.');
        alertSpy.mockClear();

        // Attempt to delete unkeyed custom exercise
        const delButtons = screen.getAllByTitle('Delete Custom Exercise');
        expect(delButtons.length).toBe(2);
        fireEvent.click(delButtons[0]);
        expect(alertSpy).toHaveBeenCalledWith('Custom exercise identity could not be saved. Please reload and try again.');
        alertSpy.mockClear();

        // Attempt to edit unkeyed custom exercise
        const editButtons = screen.getAllByTitle('Edit Exercise');
        fireEvent.click(editButtons[0]);
        expect(alertSpy).toHaveBeenCalledWith('Custom exercise identity could not be saved. Please reload and try again.');

        // Confirm nothing was emitted
        expect(onSelectSpy).not.toHaveBeenCalled();
      } finally {
        mockStorage.setItem = originalSetItem;
      }
    });

    it('prevents an unkeyed custom exercise with a built-in name from being emitted under a built-in key', () => {
      // Seed an unkeyed custom exercise named 'Bench Press'
      const unkeyedBuiltinName: ExerciseItem[] = [
        { name: 'Bench Press', category: 'Chest', modality: 'weighted' },
      ];
      mockStorage.setItem('metreps_custom_exercises', JSON.stringify(unkeyedBuiltinName));

      const originalSetItem = mockStorage.setItem;
      mockStorage.setItem = (key: string, val: string) => {
        if (key === 'metreps_custom_exercises') {
          throw new Error('Storage failure');
        }
        memoryStore[key] = String(val);
      };

      try {
        const alertSpy = vi.fn();
        window.alert = alertSpy;
        (globalThis as any).alert = alertSpy;
        const onSelectSpy = vi.fn();

        render(
          <ExerciseSelectorModal
            isOpen={true}
            onClose={() => {}}
            onSelect={onSelectSpy}
          />
        );

        // The custom 'Bench Press' row has a delete button (unlike built-in)
        const delButtons = screen.queryAllByTitle('Delete Custom Exercise');
        expect(delButtons.length).toBe(1);

        // Attempting to select this unkeyed custom item triggers fail-closed alert
        const customRow = delButtons[0].closest('div');
        const rowSelectBtn = customRow?.querySelector('button');
        fireEvent.click(rowSelectBtn!);

        expect(alertSpy).toHaveBeenCalledWith('Custom exercise identity could not be saved. Please reload and try again.');
        expect(onSelectSpy).not.toHaveBeenCalled();
      } finally {
        mockStorage.setItem = originalSetItem;
      }
    });
  });

  describe('Invariant 13: Real Program Builder propagation', () => {
    it('persists exact exerciseKey when selecting a custom exercise in ProgramBuilder', () => {
      const customKey = 'custom_b43f9a72-881c-461d-91b4-239102948123';
      const catalog: ExerciseItem[] = [
        { name: 'Custom Cable Fly', category: 'Chest', modality: 'weighted', exerciseKey: customKey }
      ];
      mockStorage.setItem('metreps_custom_exercises', JSON.stringify(catalog));

      render(
        <ProgramBuilder onClose={() => {}} onSave={() => {}} />
      );

      // Select 1 Day per week so only Day 1 is required
      const daysDropdownBtn = screen.getByRole('button', { name: /3 Days per week/i });
      fireEvent.click(daysDropdownBtn);
      const oneDayOption = screen.getByRole('button', { name: /1 Day per week/i });
      fireEvent.click(oneDayOption);

      // Click "Add Exercise" on Day 1
      const addExButtons = screen.getAllByRole('button', { name: /Add Exercise/i });
      fireEvent.click(addExButtons[0]);

      // Click on Custom Cable Fly in modal
      const customHeading = screen.getByRole('heading', { name: /^Custom Cable Fly$/i });
      const customRowBtn = customHeading.closest('button');
      fireEvent.click(customRowBtn!);

      // Confirm addition to program
      const confirmBtn = screen.getByRole('button', { name: /Add to Workout \(1\)/i });
      fireEvent.click(confirmBtn);

      // Enter program name
      const titleInput = screen.getByPlaceholderText(/e\.g\., Hypertrophy Push Pull Legs/i);
      fireEvent.change(titleInput, { target: { value: 'Custom Key Test Program' } });

      // Click Save Program
      const saveBtn = screen.getByRole('button', { name: /Save Program/i });
      fireEvent.click(saveBtn);

      // Read saved program from storage
      const programs: Program[] = storage.getPrograms();
      const savedProgram = programs.find(p => p.name === 'Custom Key Test Program');
      expect(savedProgram).toBeDefined();

      const day1Exercises = savedProgram!.exercisesByDay[1];
      expect(day1Exercises.length).toBeGreaterThan(0);
      const targetEx = day1Exercises.find(e => e.name === 'Custom Cable Fly');
      expect(targetEx).toBeDefined();
      expect(targetEx!.exerciseKey).toBe(customKey);
    });
  });

  describe('Invariant 14: Real Workout Logger and draft round trip', () => {
    it('persists and restores custom exerciseKey through active workout draft without key regeneration', () => {
      const customKey = 'custom_c99f9a72-881c-461d-91b4-239102948999';
      const catalog: ExerciseItem[] = [
        { name: 'Custom Incline Press', category: 'Chest', modality: 'weighted', exerciseKey: customKey }
      ];
      mockStorage.setItem('metreps_custom_exercises', JSON.stringify(catalog));

      const { unmount } = render(
        <WorkoutLogger onClose={() => {}} onSave={() => {}} />
      );

      // Open Exercise Selector via "Add Custom Exercise"
      const addCustomBtn = screen.getByRole('button', { name: /Add Custom Exercise/i });
      fireEvent.click(addCustomBtn);

      // Select Custom Incline Press
      const heading = screen.getByRole('heading', { name: /^Custom Incline Press$/i });
      const rowBtn = heading.closest('button');
      fireEvent.click(rowBtn!);

      // Confirm
      const confirmBtn = screen.getByRole('button', { name: /Add to Workout \(1\)/i });
      fireEvent.click(confirmBtn);

      // Verify custom exercise is in logger
      expect(screen.getByText('Custom Incline Press')).toBeDefined();

      // Verify draft in storage contains the exact exerciseKey
      const draftJson = mockStorage.getItem('metreps_workout_draft');
      expect(draftJson).toBeTruthy();
      const draft = JSON.parse(draftJson!);
      const loggedCustom = draft.exercises.find((e: any) => e.name === 'Custom Incline Press');
      expect(loggedCustom).toBeDefined();
      expect(loggedCustom.exerciseKey).toBe(customKey);

      // Unmount logger
      unmount();
      cleanup();

      // Remount logger (draft should be restored)
      render(
        <WorkoutLogger onClose={() => {}} onSave={() => {}} />
      );

      expect(screen.getByText('Custom Incline Press')).toBeDefined();
      const restoredDraftJson = mockStorage.getItem('metreps_workout_draft');
      const restoredDraft = JSON.parse(restoredDraftJson!);
      const restoredCustom = restoredDraft.exercises.find((e: any) => e.name === 'Custom Incline Press');
      expect(restoredCustom).toBeDefined();
      expect(restoredCustom.exerciseKey).toBe(customKey);
    });
  });

  describe('Invariant 15: Continuation preservation', () => {
    it('preserves exact custom exerciseKey in continuation without regenerating keys', () => {
      const customKey = 'custom_d88f9a72-881c-461d-91b4-239102948888';
      const sourceProgram: Program = {
        id: 'prog-custom-source',
        name: 'Cycle 1 Hypertrophy',
        daysPerWeek: 3,
        programDuration: 4,
        createdAt: '2026-08-01T00:00:00.000Z',
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        exercisesByDay: {
          1: [
            {
              name: 'Custom Lat Pulldown',
              muscleGroup: 'Back',
              modality: 'weighted',
              exerciseKey: customKey,
              sets: [{ setNumber: 1, weight: 120, reps: 10, rpe: 8.0, isCompleted: false }],
            },
          ],
          2: [],
          3: [],
        },
      };

      const continuation = createProgramContinuation(sourceProgram);

      // Verify continuation preserves exact key
      expect(continuation.exercisesByDay[1][0].exerciseKey).toBe(customKey);
      expect(continuation.exercisesByDay[1][0].name).toBe('Custom Lat Pulldown');

      // Verify source is unmodified
      expect(sourceProgram.exercisesByDay[1][0].exerciseKey).toBe(customKey);
    });
  });
});
