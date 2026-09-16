/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import defaultExercises from '../defaultExerciseLibrary.json';
import {
  canonicalizeExerciseName,
  resolveExerciseKey,
  isUsableExerciseKey
} from '../exerciseIdentity';
import { createProgramContinuation } from '../programContinuation';
import { Program, ExerciseEntry } from '../../types';

describe('APC-3A2A: Canonical Built-in Exercise Identity Foundation', () => {
  describe('Task 3 & 8: Built-in Library Keys Integrity', () => {
    it('1. Every built-in exercise has a non-empty explicit key', () => {
      let totalExercises = 0;
      Object.entries(defaultExercises as Record<string, Array<{ name: string; exerciseKey: string }>>).forEach(([category, list]) => {
        list.forEach((item) => {
          totalExercises++;
          expect(item.exerciseKey, `Exercise "${item.name}" in category "${category}" must have an exerciseKey`).toBeDefined();
          expect(typeof item.exerciseKey).toBe('string');
          expect(item.exerciseKey.trim().length).toBeGreaterThan(0);
          expect(isUsableExerciseKey(item.exerciseKey)).toBe(true);
        });
      });
      expect(totalExercises).toBe(183);
    });

    it('2. Exactly 179 distinct semantic keys exist, with exactly 3 intentionally shared movement groups across 7 rows', () => {
      const keyMap = new Map<string, Array<{ category: string; name: string }>>();
      Object.entries(defaultExercises as Record<string, Array<{ name: string; exerciseKey: string }>>).forEach(([category, list]) => {
        list.forEach((item) => {
          if (!keyMap.has(item.exerciseKey)) {
            keyMap.set(item.exerciseKey, []);
          }
          keyMap.get(item.exerciseKey)!.push({ category, name: item.name });
        });
      });

      expect(keyMap.size).toBe(179);

      // Identify shared keys
      const sharedGroups = Array.from(keyMap.entries()).filter(([_, entries]) => entries.length > 1);
      expect(sharedGroups.length).toBe(3);

      const sharedKeys = sharedGroups.map(([key]) => key).sort();
      expect(sharedKeys).toEqual(['bulgarian_split_squat', 'farmer_s_carry', 'walking_lunge'].sort());

      const totalSharedRows = sharedGroups.reduce((sum, [_, entries]) => sum + entries.length, 0);
      expect(totalSharedRows).toBe(7);

      // Verify exact category memberships and names for each shared key
      const farmersCarryEntries = keyMap.get('farmer_s_carry')!;
      expect(farmersCarryEntries).toEqual([
        { category: 'Traps', name: "Farmer's Carry" },
        { category: 'Forearms', name: 'Farmer’s Carry' },
        { category: 'Conditioning', name: "Farmer's Carry" }
      ]);

      const bssEntries = keyMap.get('bulgarian_split_squat')!;
      expect(bssEntries).toEqual([
        { category: 'Quads', name: 'Bulgarian Split Squat' },
        { category: 'Glutes', name: 'Bulgarian Split Squat' }
      ]);

      const walkingLungeEntries = keyMap.get('walking_lunge')!;
      expect(walkingLungeEntries).toEqual([
        { category: 'Quads', name: 'Walking Lunge' },
        { category: 'Glutes', name: 'Walking Lunge' }
      ]);
    });

    it('3. Built-in count is unchanged (exactly 183 exercises across 13 categories)', () => {
      const categories = Object.keys(defaultExercises);
      expect(categories.length).toBe(13);
      const totalCount = Object.values(defaultExercises as Record<string, any[]>).reduce((sum, list) => sum + list.length, 0);
      expect(totalCount).toBe(183);
    });

    it('4. Existing catalog category and exercise order is preserved', () => {
      const expectedCategoryOrder = [
        'Delts', 'Traps', 'Biceps', 'Triceps', 'Pecs', 'Back', 'Abs',
        'Quads', 'Hamstrings', 'Calves', 'Glutes', 'Forearms', 'Conditioning'
      ];
      expect(Object.keys(defaultExercises)).toEqual(expectedCategoryOrder);

      const delts = (defaultExercises as Record<string, Array<{ name: string; exerciseKey: string }>>)['Delts'];
      expect(delts[0].name).toBe('Overhead Press (Barbell)');
      expect(delts[0].exerciseKey).toBe('overhead_press_barbell');
      expect(delts[1].name).toBe('Seated Dumbbell Shoulder Press');
      expect(delts[1].exerciseKey).toBe('seated_dumbbell_shoulder_press');
    });

    it('5. Representative built-in keys match expected stable values', () => {
      const library = defaultExercises as Record<string, Array<{ name: string; exerciseKey: string }>>;
      
      const pecs = library['Pecs'];
      const flatBench = pecs.find(e => e.name === 'Barbell Bench Press (flat)');
      expect(flatBench?.exerciseKey).toBe('barbell_bench_press_flat');

      const back = library['Back'];
      const latPulldown = back.find(e => e.name === 'Lat Pulldown (Wide)');
      expect(latPulldown?.exerciseKey).toBe('lat_pulldown_wide');

      const hamstrings = library['Hamstrings'];
      const rdl = hamstrings.find(e => e.name === 'Romanian Deadlift (RDL)');
      expect(rdl?.exerciseKey).toBe('romanian_deadlift_rdl');

      const deadlift = hamstrings.find(e => e.name === 'Deadlift (Conventional)');
      expect(deadlift?.exerciseKey).toBe('deadlift_conventional');
    });

    it('6. Multi-category duplicate placements share identical semantic movement keys', () => {
      const library = defaultExercises as Record<string, Array<{ name: string; exerciseKey: string }>>;

      const trapsCarry = library['Traps'].find(e => e.name.includes('Carry'));
      expect(trapsCarry?.exerciseKey).toBe('farmer_s_carry');

      const forearmsCarry = library['Forearms'].find(e => e.name.includes('Carry'));
      expect(forearmsCarry?.exerciseKey).toBe('farmer_s_carry');

      const condCarry = library['Conditioning'].find(e => e.name.includes('Carry'));
      expect(condCarry?.exerciseKey).toBe('farmer_s_carry');

      const quadsBss = library['Quads'].find(e => e.name === 'Bulgarian Split Squat');
      expect(quadsBss?.exerciseKey).toBe('bulgarian_split_squat');

      const glutesBss = library['Glutes'].find(e => e.name === 'Bulgarian Split Squat');
      expect(glutesBss?.exerciseKey).toBe('bulgarian_split_squat');

      const quadsLunge = library['Quads'].find(e => e.name === 'Walking Lunge');
      expect(quadsLunge?.exerciseKey).toBe('walking_lunge');

      const glutesLunge = library['Glutes'].find(e => e.name === 'Walking Lunge');
      expect(glutesLunge?.exerciseKey).toBe('walking_lunge');
    });

    it('7. No category-suffixed or fragmented keys remain in the catalog', () => {
      const categorySuffixes = ['_quads', '_glutes', '_traps', '_forearms', '_conditioning'];
      Object.entries(defaultExercises as Record<string, Array<{ name: string; exerciseKey: string }>>).forEach(([category, list]) => {
        list.forEach((item) => {
          categorySuffixes.forEach((suffix) => {
            expect(
              item.exerciseKey.endsWith(suffix),
              `Catalog item "${item.name}" in category "${category}" must not have category suffix "${suffix}": got "${item.exerciseKey}"`
            ).toBe(false);
          });
        });
      });
    });

    it('8. No built-in contains bodyweightRatio', () => {
      Object.values(defaultExercises as Record<string, any[]>).forEach(list => {
        list.forEach(item => {
          expect(item).not.toHaveProperty('bodyweightRatio');
          expect((item as any).bodyweightRatio).toBeUndefined();
        });
      });
    });
  });

  describe('Task 1 & 8: canonicalizeExerciseName Authority', () => {
    it('1. Normalizes standard names, whitespace, and punctuation deterministically', () => {
      expect(canonicalizeExerciseName('Barbell Bench Press')).toBe('barbell_bench_press');
      expect(canonicalizeExerciseName('  Barbell   Bench   Press  ')).toBe('barbell_bench_press');
      expect(canonicalizeExerciseName('BARBELL-BENCH PRESS')).toBe('barbell_bench_press');
      expect(canonicalizeExerciseName('45° Back Extension (Hip Hinge)')).toBe('45_back_extension_hip_hinge');
      expect(canonicalizeExerciseName("Farmer's Carry")).toBe('farmer_s_carry');
      expect(canonicalizeExerciseName('Farmer’s Carry')).toBe('farmer_s_carry');
      expect(canonicalizeExerciseName('Leg Press (45-Degree)')).toBe('leg_press_45_degree');
    });

    it('2. Normalizes Unicode and removes combining diacritics', () => {
      expect(canonicalizeExerciseName('Café Press')).toBe('cafe_press');
      expect(canonicalizeExerciseName('Tríceps Pushdown')).toBe('triceps_pushdown');
      expect(canonicalizeExerciseName('Über Squat')).toBe('uber_squat');
    });

    it('3. Returns null for invalid, non-string, or empty/whitespace-only inputs', () => {
      expect(canonicalizeExerciseName('')).toBeNull();
      expect(canonicalizeExerciseName('   ')).toBeNull();
      expect(canonicalizeExerciseName('---')).toBeNull();
      expect(canonicalizeExerciseName('!@#$%^&*()')).toBeNull();
      expect(canonicalizeExerciseName(null)).toBeNull();
      expect(canonicalizeExerciseName(undefined)).toBeNull();
      expect(canonicalizeExerciseName(12345)).toBeNull();
      expect(canonicalizeExerciseName({})).toBeNull();
      expect(canonicalizeExerciseName([])).toBeNull();
    });
  });

  describe('Task 2 & 8: resolveExerciseKey Authority', () => {
    it('1. Prefers explicit exerciseKey over any current display name', () => {
      const entry: Pick<ExerciseEntry, 'exerciseKey' | 'name'> = {
        name: 'Overhead Press (Barbell)',
        exerciseKey: 'custom_ohp_v1'
      };
      expect(resolveExerciseKey(entry)).toBe('custom_ohp_v1');
    });

    it('2. Does not mutate, lowercase, or regenerate valid explicit keys', () => {
      const entry: Pick<ExerciseEntry, 'exerciseKey' | 'name'> = {
        name: 'Barbell Bench Press (flat)',
        exerciseKey: 'Custom-Bench-1234_ABCD'
      };
      // Preserves casing and internal formatting of explicit keys
      expect(resolveExerciseKey(entry)).toBe('Custom-Bench-1234_ABCD');
    });

    it('3. Trims surrounding whitespace from explicit key', () => {
      const entry: Pick<ExerciseEntry, 'exerciseKey' | 'name'> = {
        name: 'Squat',
        exerciseKey: '  barbell_back_squat  '
      };
      expect(resolveExerciseKey(entry)).toBe('barbell_back_squat');
    });

    it('4. Falls back to canonical name slug when explicit exerciseKey is missing or empty', () => {
      const legacyEntry1: Pick<ExerciseEntry, 'exerciseKey' | 'name'> = {
        name: 'Barbell Bench Press (flat)'
      };
      expect(resolveExerciseKey(legacyEntry1)).toBe('barbell_bench_press_flat');

      const legacyEntry2: Pick<ExerciseEntry, 'exerciseKey' | 'name'> = {
        name: 'Lat Pulldown (Wide)',
        exerciseKey: ''
      };
      expect(resolveExerciseKey(legacyEntry2)).toBe('lat_pulldown_wide');

      const legacyEntry3: Pick<ExerciseEntry, 'exerciseKey' | 'name'> = {
        name: '  Deadlift (Conventional)  ',
        exerciseKey: '   '
      };
      expect(resolveExerciseKey(legacyEntry3)).toBe('deadlift_conventional');

      // Shared movement legacy fallback alignment
      expect(resolveExerciseKey({ name: "Farmer's Carry" })).toBe('farmer_s_carry');
      expect(resolveExerciseKey({ name: 'Farmer’s Carry' })).toBe('farmer_s_carry');
      expect(resolveExerciseKey({ name: 'Bulgarian Split Squat' })).toBe('bulgarian_split_squat');
      expect(resolveExerciseKey({ name: 'Walking Lunge' })).toBe('walking_lunge');
    });

    it('5. Explicit shared built-in keys match their legacy fallback keys perfectly', () => {
      const library = defaultExercises as Record<string, Array<{ name: string; exerciseKey: string }>>;
      const trapsCarry = library['Traps'].find(e => e.name.includes('Carry'))!;
      const forearmsCarry = library['Forearms'].find(e => e.name.includes('Carry'))!;
      const quadsBss = library['Quads'].find(e => e.name === 'Bulgarian Split Squat')!;
      const quadsLunge = library['Quads'].find(e => e.name === 'Walking Lunge')!;

      expect(trapsCarry.exerciseKey).toBe(canonicalizeExerciseName(trapsCarry.name));
      expect(forearmsCarry.exerciseKey).toBe(canonicalizeExerciseName(forearmsCarry.name));
      expect(quadsBss.exerciseKey).toBe(canonicalizeExerciseName(quadsBss.name));
      expect(quadsLunge.exerciseKey).toBe(canonicalizeExerciseName(quadsLunge.name));
    });

    it('6. Returns null when neither a usable key nor valid name exists', () => {
      expect(resolveExerciseKey(null)).toBeNull();
      expect(resolveExerciseKey(undefined)).toBeNull();
      expect(resolveExerciseKey({ name: '' })).toBeNull();
      expect(resolveExerciseKey({ name: '   ', exerciseKey: '' })).toBeNull();
      expect(resolveExerciseKey({ name: '---' })).toBeNull();
    });
  });

  describe('Task 5 & 8: Program Continuation Preservation', () => {
    const createSampleProgram = (overrides?: Partial<Program>): Program => ({
      id: 'prog-source-1',
      name: 'Strength Foundation',
      daysPerWeek: 3,
      programDuration: 8,
      createdAt: '2026-09-01T00:00:00.000Z',
      objective: 'Strength',
      algorithmId: 'strength_linear',
      targetProgressionMode: 'metreps_guided',
      progressionPolicyVersion: 1,
      algorithmVersion: 1,
      exercisesByDay: {
        1: [
          {
            name: 'Barbell Bench Press (flat)',
            exerciseKey: 'barbell_bench_press_flat',
            muscleGroup: 'Pecs',
            modality: 'weighted',
            movementCategory: 'compound',
            equipment: 'freeweight',
            isMainMovement: true,
            sets: [{ setNumber: 1, weight: 100, reps: 5, rpe: 8, form: 'standard' }]
          },
          {
            name: 'Lat Pulldown (Wide)',
            exerciseKey: 'lat_pulldown_wide',
            muscleGroup: 'Back',
            modality: 'weighted',
            movementCategory: 'compound',
            equipment: 'machine',
            isMainMovement: false,
            sets: [{ setNumber: 1, weight: 70, reps: 10, rpe: 8, form: 'standard' }]
          }
        ],
        2: [
          {
            name: 'Legacy Exercise Without Key',
            muscleGroup: 'Quads',
            modality: 'weighted',
            isMainMovement: false,
            sets: [{ setNumber: 1, weight: 80, reps: 8, rpe: 8, form: 'standard' }]
          }
        ]
      },
      ...overrides
    });

    it('1. Deeply preserves exerciseKey across continuation cycles without mutation or crosstalk', () => {
      const source = createSampleProgram();
      const continuation = createProgramContinuation(source);

      expect(continuation.parentProgramId).toBe(source.id);
      expect(continuation.cycleIndex).toBe(2);
      expect(continuation.name).toBe('Strength Foundation — Cycle 2');

      const day1Exercises = continuation.exercisesByDay[1];
      expect(day1Exercises.length).toBe(2);
      expect(day1Exercises[0].name).toBe('Barbell Bench Press (flat)');
      expect(day1Exercises[0].exerciseKey).toBe('barbell_bench_press_flat');
      expect(day1Exercises[1].name).toBe('Lat Pulldown (Wide)');
      expect(day1Exercises[1].exerciseKey).toBe('lat_pulldown_wide');

      // Modifying continuation exerciseKey does not mutate source
      day1Exercises[0].exerciseKey = 'mutated_in_cycle_2';
      expect(source.exercisesByDay[1][0].exerciseKey).toBe('barbell_bench_press_flat');
    });

    it('2. Handles mixed programs containing both keyed exercises and legacy unkeyed exercises', () => {
      const source = createSampleProgram();
      const continuation = createProgramContinuation(source);

      const day2 = continuation.exercisesByDay[2];
      expect(day2[0].name).toBe('Legacy Exercise Without Key');
      expect(day2[0].exerciseKey).toBeUndefined();

      // Resolver works consistently across both
      expect(resolveExerciseKey(continuation.exercisesByDay[1][0])).toBe('barbell_bench_press_flat');
      expect(resolveExerciseKey(day2[0])).toBe('legacy_exercise_without_key');
    });

    it('3. Preserves shared keys like bulgarian_split_squat across continuation cycles', () => {
      const source = createSampleProgram({
        exercisesByDay: {
          1: [
            {
              name: 'Bulgarian Split Squat',
              exerciseKey: 'bulgarian_split_squat',
              muscleGroup: 'Quads',
              modality: 'weighted',
              movementCategory: 'compound',
              equipment: 'freeweight',
              isMainMovement: true,
              sets: [{ setNumber: 1, weight: 24, reps: 10, rpe: 8, form: 'standard' }]
            }
          ]
        }
      });
      const continuation = createProgramContinuation(source);

      expect(continuation.exercisesByDay[1][0].exerciseKey).toBe('bulgarian_split_squat');
      expect(continuation.exercisesByDay[1][0].name).toBe('Bulgarian Split Squat');
      expect(continuation.exercisesByDay[1][0].muscleGroup).toBe('Quads');

      // Modifying continuation doesn't mutate source
      continuation.exercisesByDay[1][0].exerciseKey = 'mutated_key';
      expect(source.exercisesByDay[1][0].exerciseKey).toBe('bulgarian_split_squat');
    });

    it('4. Preserves all APC metadata fields alongside exerciseKey', () => {
      const source = createSampleProgram({
        targetProgressionMode: 'metreps_guided',
        progressionPolicyVersion: 1,
        algorithmVersion: 1
      });
      const continuation = createProgramContinuation(source);

      expect(continuation.targetProgressionMode).toBe('metreps_guided');
      expect(continuation.progressionPolicyVersion).toBe(1);
      expect(continuation.algorithmVersion).toBe(1);
      expect(continuation.exercisesByDay[1][0].exerciseKey).toBe('barbell_bench_press_flat');
    });
  });
});
