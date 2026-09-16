// @vitest-environment happy-dom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ExerciseSelectorModal, ExerciseItem } from '../../components/ExerciseSelectorModal';

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

if (typeof window !== 'undefined') {
  window.scrollTo = (() => {}) as any;
} else {
  (globalThis as any).window = { scrollTo: () => {} };
}

describe('APC-3A2A-RC1: ExerciseSelectorModal Rendered Identity & Shared Keys Suite', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe('Task 4: Rendered Multi-Category Shared Key Identity', () => {
    it('1. Selecting Bulgarian Split Squat from Quads preserves Quads category and emits canonical exerciseKey', () => {
      let selectedResult: ExerciseItem[] = [];
      const onSelect = vi.fn((items: ExerciseItem[]) => {
        selectedResult = items;
      });
      const onClose = vi.fn();

      render(
        <ExerciseSelectorModal
          isOpen={true}
          onClose={onClose}
          onSelect={onSelect}
        />
      );

      // 1. Navigate to Quads category
      const quadsTab = screen.getByRole('button', { name: /^Quads$/i });
      fireEvent.click(quadsTab);

      // 2. Locate Bulgarian Split Squat button/row in the filtered list
      const bssHeading = screen.getByRole('heading', { name: /^Bulgarian Split Squat$/i });
      const bssRowButton = bssHeading.closest('button');
      expect(bssRowButton).not.toBeNull();
      fireEvent.click(bssRowButton!);

      // 3. Click Add to Workout confirm button
      const confirmButton = screen.getByRole('button', { name: /Add to Workout \(1\)/i });
      fireEvent.click(confirmButton);

      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(selectedResult.length).toBe(1);

      const item = selectedResult[0];
      expect(item.name).toBe('Bulgarian Split Squat');
      expect(item.exerciseKey).toBe('bulgarian_split_squat');
      expect(item.category).toBe('Quads');
      expect(item.modality).toBe('weighted');
      expect(item.movementCategory).toBe('compound');
      expect(item.equipment).toBe('freeweight');
    });

    it('2. Selecting Bulgarian Split Squat from Glutes preserves Glutes category and emits identical canonical exerciseKey', () => {
      let selectedResult: ExerciseItem[] = [];
      const onSelect = vi.fn((items: ExerciseItem[]) => {
        selectedResult = items;
      });
      const onClose = vi.fn();

      render(
        <ExerciseSelectorModal
          isOpen={true}
          onClose={onClose}
          onSelect={onSelect}
        />
      );

      // 1. Navigate to Glutes category
      const glutesTab = screen.getByRole('button', { name: /^Glutes$/i });
      fireEvent.click(glutesTab);

      // 2. Locate Bulgarian Split Squat button/row in the filtered list
      const bssHeading = screen.getByRole('heading', { name: /^Bulgarian Split Squat$/i });
      const bssRowButton = bssHeading.closest('button');
      expect(bssRowButton).not.toBeNull();
      fireEvent.click(bssRowButton!);

      // 3. Click Add to Workout confirm button
      const confirmButton = screen.getByRole('button', { name: /Add to Workout \(1\)/i });
      fireEvent.click(confirmButton);

      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(selectedResult.length).toBe(1);

      const item = selectedResult[0];
      expect(item.name).toBe('Bulgarian Split Squat');
      expect(item.exerciseKey).toBe('bulgarian_split_squat');
      expect(item.category).toBe('Glutes');
      expect(item.modality).toBe('weighted');
      expect(item.movementCategory).toBe('compound');
      expect(item.equipment).toBe('freeweight');
    });

    it('3. Selecting Farmer’s Carry from Traps emits canonical farmer_s_carry key', () => {
      let selectedResult: ExerciseItem[] = [];
      render(
        <ExerciseSelectorModal
          isOpen={true}
          onClose={() => {}}
          onSelect={(items) => { selectedResult = items; }}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /^Traps$/i }));
      const carryHeading = screen.getByRole('heading', { name: /^Farmer's Carry$/i });
      fireEvent.click(carryHeading.closest('button')!);
      fireEvent.click(screen.getByRole('button', { name: /Add to Workout \(1\)/i }));

      expect(selectedResult.length).toBe(1);
      expect(selectedResult[0].exerciseKey).toBe('farmer_s_carry');
      expect(selectedResult[0].name).toBe("Farmer's Carry");
      expect(selectedResult[0].category).toBe('Traps');
      expect(selectedResult[0].modality).toBe('distance_loaded');
    });

    it('4. Selecting Farmer’s Carry from Forearms (curly apostrophe) emits canonical farmer_s_carry key', () => {
      let selectedResult: ExerciseItem[] = [];
      render(
        <ExerciseSelectorModal
          isOpen={true}
          onClose={() => {}}
          onSelect={(items) => { selectedResult = items; }}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /^Forearms$/i }));
      const carryHeading = screen.getByRole('heading', { name: /^Farmer’s Carry$/i });
      fireEvent.click(carryHeading.closest('button')!);
      fireEvent.click(screen.getByRole('button', { name: /Add to Workout \(1\)/i }));

      expect(selectedResult.length).toBe(1);
      expect(selectedResult[0].exerciseKey).toBe('farmer_s_carry');
      expect(selectedResult[0].name).toBe('Farmer’s Carry');
      expect(selectedResult[0].category).toBe('Forearms');
      expect(selectedResult[0].modality).toBe('distance_loaded');
    });

    it('5. Selecting Farmer’s Carry from Conditioning emits canonical farmer_s_carry key', () => {
      let selectedResult: ExerciseItem[] = [];
      render(
        <ExerciseSelectorModal
          isOpen={true}
          onClose={() => {}}
          onSelect={(items) => { selectedResult = items; }}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /^Conditioning$/i }));
      const carryHeading = screen.getByRole('heading', { name: /^Farmer's Carry$/i });
      fireEvent.click(carryHeading.closest('button')!);
      fireEvent.click(screen.getByRole('button', { name: /Add to Workout \(1\)/i }));

      expect(selectedResult.length).toBe(1);
      expect(selectedResult[0].exerciseKey).toBe('farmer_s_carry');
      expect(selectedResult[0].name).toBe("Farmer's Carry");
      expect(selectedResult[0].category).toBe('Conditioning');
      expect(selectedResult[0].modality).toBe('distance_loaded');
    });

    it('6. Walking Lunge selected from Quads emits canonical walking_lunge key', () => {
      let selectedResult: ExerciseItem[] = [];
      render(
        <ExerciseSelectorModal
          isOpen={true}
          onClose={() => {}}
          onSelect={(items) => { selectedResult = items; }}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /^Quads$/i }));
      const lungeHeading = screen.getByRole('heading', { name: /^Walking Lunge$/i });
      fireEvent.click(lungeHeading.closest('button')!);
      fireEvent.click(screen.getByRole('button', { name: /Add to Workout \(1\)/i }));

      expect(selectedResult.length).toBe(1);
      expect(selectedResult[0].exerciseKey).toBe('walking_lunge');
      expect(selectedResult[0].name).toBe('Walking Lunge');
      expect(selectedResult[0].category).toBe('Quads');
    });

    it('7. Walking Lunge selected from Glutes emits canonical walking_lunge key', () => {
      let selectedResult: ExerciseItem[] = [];
      render(
        <ExerciseSelectorModal
          isOpen={true}
          onClose={() => {}}
          onSelect={(items) => { selectedResult = items; }}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /^Glutes$/i }));
      const lungeHeading = screen.getByRole('heading', { name: /^Walking Lunge$/i });
      fireEvent.click(lungeHeading.closest('button')!);
      fireEvent.click(screen.getByRole('button', { name: /Add to Workout \(1\)/i }));

      expect(selectedResult.length).toBe(1);
      expect(selectedResult[0].exerciseKey).toBe('walking_lunge');
      expect(selectedResult[0].name).toBe('Walking Lunge');
      expect(selectedResult[0].category).toBe('Glutes');
    });
  });

  describe('Task 5: Search Filtering & Object Entry Preservations', () => {
    it('1. Searching filters catalog items and selected search result emits exerciseKey', () => {
      let selectedResult: ExerciseItem[] = [];
      render(
        <ExerciseSelectorModal
          isOpen={true}
          onClose={() => {}}
          onSelect={(items) => { selectedResult = items; }}
        />
      );

      const searchInput = screen.getByPlaceholderText(/Search exercises/i);
      fireEvent.change(searchInput, { target: { value: 'Incline Bench Press' } });

      const heading = screen.getByRole('heading', { name: /^Incline Bench Press \(Barbell\)$/i });
      expect(heading).toBeDefined();

      fireEvent.click(heading.closest('button')!);
      fireEvent.click(screen.getByRole('button', { name: /Add to Workout \(1\)/i }));

      expect(selectedResult.length).toBe(1);
      expect(selectedResult[0].name).toBe('Incline Bench Press (Barbell)');
      expect(selectedResult[0].exerciseKey).toBe('incline_bench_press_barbell');
      expect(selectedResult[0].category).toBe('Pecs');
      expect(selectedResult[0].equipment).toBe('freeweight');
    });

    it('2. Multi-selection emits all selected exercises with their respective exerciseKeys', () => {
      let selectedResult: ExerciseItem[] = [];
      render(
        <ExerciseSelectorModal
          isOpen={true}
          onClose={() => {}}
          onSelect={(items) => { selectedResult = items; }}
          confirmLabel="Add Exercises"
        />
      );

      // Filter to Delts
      fireEvent.click(screen.getByRole('button', { name: /^Delts$/i }));

      const ohpHeading = screen.getByRole('heading', { name: /^Overhead Press \(Barbell\)$/i });
      const dbPressHeading = screen.getByRole('heading', { name: /^Seated Dumbbell Shoulder Press$/i });

      fireEvent.click(ohpHeading.closest('button')!);
      fireEvent.click(dbPressHeading.closest('button')!);

      const confirmBtn = screen.getByRole('button', { name: /Add Exercises \(2\)/i });
      fireEvent.click(confirmBtn);

      expect(selectedResult.length).toBe(2);
      expect(selectedResult[0].exerciseKey).toBe('overhead_press_barbell');
      expect(selectedResult[1].exerciseKey).toBe('seated_dumbbell_shoulder_press');
    });
  });
});
