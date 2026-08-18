/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateBodyweightSnapshot,
  cloneBodyweightSnapshot,
  snapshotToNormalizedKg,
  areSnapshotsPhysicallyEquivalent,
  compareSnapshots,
  reconcileSessionSnapshot,
  resolveSessionBodyweightInUnit,
  generateBodyweightWarmupTargets,
} from '../bodyweightSessionMath';
import { remapAfterWarmupChange, prepareExercisesForSave } from '../workoutCompletion';
import { BodyweightSnapshot, ExerciseEntry, WorkoutLog } from '../../types';
import { storage } from '../storage';

// In-memory localStorage mock for node test runner
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

describe('bodyweightSessionMath - Snapshot and Warmup Logic', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('validateBodyweightSnapshot', () => {
    it('accepts valid kg and lbs snapshots', () => {
      expect(validateBodyweightSnapshot({ value: 75.5, unit: 'kg' })).toEqual({
        value: 75.5,
        unit: 'kg',
      });
      expect(validateBodyweightSnapshot({ value: 165, unit: 'lb' })).toEqual({
        value: 165,
        unit: 'lb',
      });
      expect(validateBodyweightSnapshot({ value: 165, unit: 'lbs' })).toEqual({
        value: 165,
        unit: 'lb',
      });
    });

    it('rejects non-positive numbers, NaNs, and infinities', () => {
      expect(validateBodyweightSnapshot({ value: 0, unit: 'kg' })).toBeNull();
      expect(validateBodyweightSnapshot({ value: -10, unit: 'kg' })).toBeNull();
      expect(validateBodyweightSnapshot({ value: NaN, unit: 'kg' })).toBeNull();
      expect(validateBodyweightSnapshot({ value: Infinity, unit: 'kg' })).toBeNull();
      expect(validateBodyweightSnapshot({ value: -Infinity, unit: 'kg' })).toBeNull();
    });

    it('rejects invalid or unsupported units', () => {
      expect(validateBodyweightSnapshot({ value: 75, unit: 'stone' as any })).toBeNull();
      expect(validateBodyweightSnapshot({ value: 75, unit: '' as any })).toBeNull();
      expect(validateBodyweightSnapshot({ value: 75, unit: null as any })).toBeNull();
      expect(validateBodyweightSnapshot({ value: 75, unit: undefined as any })).toBeNull();
    });

    it('rejects non-objects, null, and undefined', () => {
      expect(validateBodyweightSnapshot(null)).toBeNull();
      expect(validateBodyweightSnapshot(undefined)).toBeNull();
      expect(validateBodyweightSnapshot(80 as any)).toBeNull();
      expect(validateBodyweightSnapshot('80kg' as any)).toBeNull();
    });
  });

  describe('cloneBodyweightSnapshot', () => {
    it('returns an independent cloned object for valid snapshots', () => {
      const original: BodyweightSnapshot = { value: 82.5, unit: 'kg' };
      const cloned = cloneBodyweightSnapshot(original);
      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
    });

    it('preserves null and undefined appropriately', () => {
      expect(cloneBodyweightSnapshot(null)).toBeNull();
      expect(cloneBodyweightSnapshot(undefined)).toBeUndefined();
    });

    it('returns null for invalid snapshot objects', () => {
      expect(cloneBodyweightSnapshot({ value: -5, unit: 'kg' })).toBeNull();
      expect(cloneBodyweightSnapshot({ value: 70, unit: 'invalid' as any })).toBeNull();
    });
  });

  describe('snapshotToNormalizedKg', () => {
    it('normalizes kg snapshot to exact kg value', () => {
      const snapshot: BodyweightSnapshot = { value: 75, unit: 'kg' };
      expect(snapshotToNormalizedKg(snapshot)).toBe(75);
    });

    it('normalizes lb snapshot to canonical kg value', () => {
      // 165.3466966 lb * 0.45359237 kg/lb = ~75 kg
      const snapshot: BodyweightSnapshot = { value: 165.3466966, unit: 'lb' };
      expect(snapshotToNormalizedKg(snapshot)).toBeCloseTo(75, 4);
    });
  });

  describe('areSnapshotsPhysicallyEquivalent & compareSnapshots', () => {
    it('areSnapshotsPhysicallyEquivalent returns true within 0.05 kg tolerance', () => {
      const snapKg: BodyweightSnapshot = { value: 75, unit: 'kg' };
      const snapLbEquivalent: BodyweightSnapshot = { value: 165.35, unit: 'lb' };
      expect(areSnapshotsPhysicallyEquivalent(snapKg, snapLbEquivalent)).toBe(true);
    });

    it('areSnapshotsPhysicallyEquivalent returns false for values outside 0.05 kg', () => {
      const snapA: BodyweightSnapshot = { value: 75, unit: 'kg' };
      const snapB: BodyweightSnapshot = { value: 76, unit: 'kg' };
      expect(areSnapshotsPhysicallyEquivalent(snapA, snapB)).toBe(false);
    });

    it('compareSnapshots detects exact match', () => {
      const snap: BodyweightSnapshot = { value: 80, unit: 'kg' };
      const res = compareSnapshots(snap, snap);
      expect(res.status).toBe('exact_match');
      expect(res.isPhysicallyEquivalent).toBe(true);
      expect(res.deltaNormalizedKg).toBe(0);
    });

    it('compareSnapshots detects unit equivalence', () => {
      const snapKg: BodyweightSnapshot = { value: 80, unit: 'kg' };
      const snapLb: BodyweightSnapshot = { value: 176.37, unit: 'lb' };
      const res = compareSnapshots(snapKg, snapLb);
      expect(res.status).toBe('unit_equivalent');
      expect(res.isPhysicallyEquivalent).toBe(true);
      expect(res.deltaNormalizedKg).toBeLessThanOrEqual(0.05);
    });

    it('compareSnapshots detects meaningful change', () => {
      const snapA: BodyweightSnapshot = { value: 80, unit: 'kg' };
      const snapB: BodyweightSnapshot = { value: 85, unit: 'kg' };
      const res = compareSnapshots(snapA, snapB);
      expect(res.status).toBe('meaningful_change');
      expect(res.isPhysicallyEquivalent).toBe(false);
      expect(res.deltaNormalizedKg).toBe(5);
    });

    it('compareSnapshots detects settings missing', () => {
      const draft: BodyweightSnapshot = { value: 80, unit: 'kg' };
      const res = compareSnapshots(draft, null);
      expect(res.status).toBe('settings_missing');
      expect(res.isPhysicallyEquivalent).toBe(false);
    });

    it('compareSnapshots detects draft missing', () => {
      const settings: BodyweightSnapshot = { value: 80, unit: 'kg' };
      const res = compareSnapshots(null, settings);
      expect(res.status).toBe('draft_missing');
      expect(res.isPhysicallyEquivalent).toBe(false);
    });
  });

  describe('reconcileSessionSnapshot', () => {
    const settingsSnapshot: BodyweightSnapshot = { value: 80, unit: 'kg' };
    const draftSnapshot: BodyweightSnapshot = { value: 82, unit: 'kg' };
    const logSnapshot: BodyweightSnapshot = { value: 78, unit: 'kg' };

    it('for a new workout with draft containing snapshot and no settings snapshot, uses draft snapshot', () => {
      const result = reconcileSessionSnapshot({
        isEditMode: false,
        draftSnapshot,
        settingsSnapshot: null,
      });
      expect(result).toEqual(draftSnapshot);
    });

    it('for a new workout with settings snapshot, adopts settings snapshot', () => {
      const result = reconcileSessionSnapshot({
        isEditMode: false,
        draftSnapshot,
        settingsSnapshot,
      });
      expect(result).toEqual(settingsSnapshot);
    });

    it('settings clearing preserves a valid active draft snapshot', () => {
      const result = reconcileSessionSnapshot({
        isEditMode: false,
        draftSnapshot: { value: 77.5, unit: 'kg' },
        settingsSnapshot: null,
      });
      expect(result).toEqual({ value: 77.5, unit: 'kg' });
    });

    it('for a new workout without draft snapshot, falls back to settings snapshot', () => {
      const result = reconcileSessionSnapshot({
        isEditMode: false,
        draftSnapshot: undefined,
        settingsSnapshot,
      });
      expect(result).toEqual(settingsSnapshot);
    });

    it('for a new workout with no settings snapshot and no draft, returns null', () => {
      const result = reconcileSessionSnapshot({
        isEditMode: false,
        draftSnapshot: undefined,
        settingsSnapshot: null,
      });
      expect(result).toBeNull();
    });

    it('reconciliation is idempotent', () => {
      const opts = {
        isEditMode: false,
        draftSnapshot,
        settingsSnapshot,
      };
      const res1 = reconcileSessionSnapshot(opts);
      const res2 = reconcileSessionSnapshot(opts);
      expect(res1).toEqual(res2);
    });

    it('does not mutate input snapshots', () => {
      const draftCopy = { ...draftSnapshot };
      const settingsCopy = { ...settingsSnapshot };
      reconcileSessionSnapshot({
        isEditMode: false,
        draftSnapshot: draftCopy,
        settingsSnapshot: settingsCopy,
      });
      expect(draftCopy).toEqual(draftSnapshot);
      expect(settingsCopy).toEqual(settingsSnapshot);
    });

    it('for edit mode, prioritizes existing log snapshot over draft and settings', () => {
      const result = reconcileSessionSnapshot({
        isEditMode: true,
        existingLogSnapshot: logSnapshot,
        draftSnapshot,
        settingsSnapshot,
      });
      expect(result).toEqual(logSnapshot);
    });

    it('for edit mode with explicit null log snapshot, preserves null', () => {
      const result = reconcileSessionSnapshot({
        isEditMode: true,
        existingLogSnapshot: null,
        draftSnapshot,
        settingsSnapshot,
      });
      expect(result).toBeNull();
    });

    it('for edit mode with legacy undefined log snapshot, preserves undefined', () => {
      const result = reconcileSessionSnapshot({
        isEditMode: true,
        existingLogSnapshot: undefined,
        draftSnapshot,
        settingsSnapshot,
      });
      expect(result).toBeUndefined();
    });
  });

  describe('resolveSessionBodyweightInUnit', () => {
    it('converts valid snapshot to target unit', () => {
      const snapKg: BodyweightSnapshot = { value: 80, unit: 'kg' };
      expect(resolveSessionBodyweightInUnit(snapKg, 'kg')).toBe(80);
      expect(resolveSessionBodyweightInUnit(snapKg, 'lb')).toBe(176.4);

      const snapLb: BodyweightSnapshot = { value: 176.37, unit: 'lb' };
      expect(resolveSessionBodyweightInUnit(snapLb, 'kg')).toBe(80);
      expect(resolveSessionBodyweightInUnit(snapLb, 'lb')).toBe(176.4);
    });

    it('returns null for null, undefined, or invalid snapshots', () => {
      expect(resolveSessionBodyweightInUnit(null, 'kg')).toBeNull();
      expect(resolveSessionBodyweightInUnit(undefined, 'kg')).toBeNull();
      expect(resolveSessionBodyweightInUnit({ value: -5, unit: 'kg' }, 'kg')).toBeNull();
      expect(resolveSessionBodyweightInUnit({ value: 0, unit: 'kg' }, 'kg')).toBeNull();
      expect(resolveSessionBodyweightInUnit({ value: NaN, unit: 'kg' }, 'kg')).toBeNull();
      expect(resolveSessionBodyweightInUnit({ value: 75, unit: 'invalid' as any }, 'kg')).toBeNull();
    });

    it('has no current-Settings or 75 kg fallback', () => {
      // Set storage bodyweight to 90 kg
      storage.setBodyweightWithUnit(90, 'kg');

      // Passing undefined snapshot MUST return null, not 90 kg and not 75 kg
      expect(resolveSessionBodyweightInUnit(undefined, 'kg')).toBeNull();
      expect(resolveSessionBodyweightInUnit(null, 'kg')).toBeNull();
    });

    it('does not mutate input snapshot', () => {
      const snap: BodyweightSnapshot = { value: 82.5, unit: 'kg' };
      const copy = { ...snap };
      resolveSessionBodyweightInUnit(snap, 'lb');
      expect(snap).toEqual(copy);
    });
  });

  describe('generateBodyweightWarmupTargets', () => {
    it('generates single 1-rep warmup set for 2 working reps', () => {
      const result = generateBodyweightWarmupTargets(2);
      expect(result.status).toBe('valid');
      expect(result.warmupTargets).toBeDefined();
      expect(result.warmupTargets).toHaveLength(1);

      const [w1] = result.warmupTargets!;
      expect(w1.reps).toBe(1);
      expect(w1.rpe).toBe(5.0);
      expect(w1.weight).toBe(0);
      expect(w1.isWarmup).toBe(true);
    });

    it('generates 2 calibrated warmup sets for 3 working reps', () => {
      const result = generateBodyweightWarmupTargets(3);
      expect(result.status).toBe('valid');
      expect(result.warmupTargets).toHaveLength(2);

      const [w1, w2] = result.warmupTargets!;
      expect(w1.reps).toBe(1);
      expect(w1.rpe).toBe(5.0);
      expect(w1.weight).toBe(0);

      expect(w2.reps).toBe(2);
      expect(w2.rpe).toBe(6.5);
      expect(w2.weight).toBe(0);
    });

    it('generates 3 calibrated warmup sets for 5 working reps', () => {
      const result = generateBodyweightWarmupTargets(5);
      expect(result.status).toBe('valid');
      expect(result.warmupTargets).toHaveLength(3);

      const [w1, w2, w3] = result.warmupTargets!;
      // round(5 * 0.20) = 1
      expect(w1.reps).toBe(1);
      expect(w1.rpe).toBe(4.0);
      expect(w1.weight).toBe(0);

      // round(5 * 0.35) = 2
      expect(w2.reps).toBe(2);
      expect(w2.rpe).toBe(6.0);
      expect(w2.weight).toBe(0);

      // round(5 * 0.50) = 3 (capped at 4)
      expect(w3.reps).toBe(3);
      expect(w3.rpe).toBe(7.0);
      expect(w3.weight).toBe(0);
    });

    it('generates 3 calibrated bodyweight warmup sets for 10 working reps', () => {
      const result = generateBodyweightWarmupTargets(10);
      expect(result.status).toBe('valid');
      expect(result.warmupTargets).toBeDefined();
      expect(result.warmupTargets).toHaveLength(3);

      const [w1, w2, w3] = result.warmupTargets!;
      // Set 1: 20% reps = 2 @ RPE 4.0
      expect(w1.reps).toBe(2);
      expect(w1.rpe).toBe(4.0);
      expect(w1.weight).toBe(0);

      // Set 2: 35% reps = 4 @ RPE 6.0
      expect(w2.reps).toBe(4);
      expect(w2.rpe).toBe(6.0);
      expect(w2.weight).toBe(0);

      // Set 3: 50% reps = 5 @ RPE 7.0
      expect(w3.reps).toBe(5);
      expect(w3.rpe).toBe(7.0);
      expect(w3.weight).toBe(0);
    });

    it('generates 3 calibrated bodyweight warmup sets for 12 working reps', () => {
      const result = generateBodyweightWarmupTargets(12);
      expect(result.status).toBe('valid');
      expect(result.warmupTargets).toHaveLength(3);

      const [w1, w2, w3] = result.warmupTargets!;
      // round(12 * 0.20) = 2
      expect(w1.reps).toBe(2);
      expect(w1.rpe).toBe(4.0);
      expect(w1.weight).toBe(0);

      // round(12 * 0.35) = 4
      expect(w2.reps).toBe(4);
      expect(w2.rpe).toBe(6.0);
      expect(w2.weight).toBe(0);

      // round(12 * 0.50) = 6
      expect(w3.reps).toBe(6);
      expect(w3.rpe).toBe(7.0);
      expect(w3.weight).toBe(0);
    });

    it('generates 3 calibrated bodyweight warmup sets for 20 working reps', () => {
      const result = generateBodyweightWarmupTargets(20);
      expect(result.status).toBe('valid');
      expect(result.warmupTargets).toHaveLength(3);

      const [w1, w2, w3] = result.warmupTargets!;
      // min(3, max(1, round(20 * 0.20))) = 3
      expect(w1.reps).toBe(3);
      expect(w1.rpe).toBe(4.0);
      expect(w1.weight).toBe(0);

      // min(5, max(1, round(20 * 0.35))) = 5
      expect(w2.reps).toBe(5);
      expect(w2.rpe).toBe(6.0);
      expect(w2.weight).toBe(0);

      // min(8, max(1, round(20 * 0.50))) = 8
      expect(w3.reps).toBe(8);
      expect(w3.rpe).toBe(7.0);
      expect(w3.weight).toBe(0);
    });

    it('bypasses calculation when working reps is 1 due to insufficient resolution', () => {
      const result = generateBodyweightWarmupTargets(1);
      expect(result.status).toBe('bypassed');
      expect(result.bypassReason).toBe('insufficient_repetition_resolution');
      expect(result.warmupTargets).toBeNull();
    });

    it('bypasses calculation on invalid working reps (0, negative, NaN, undefined, fractional, infinities)', () => {
      expect(generateBodyweightWarmupTargets(0).bypassReason).toBe('invalid_working_reps');
      expect(generateBodyweightWarmupTargets(-5).bypassReason).toBe('invalid_working_reps');
      expect(generateBodyweightWarmupTargets(NaN).bypassReason).toBe('invalid_working_reps');
      expect(generateBodyweightWarmupTargets(undefined).bypassReason).toBe('invalid_working_reps');
      expect(generateBodyweightWarmupTargets(null as any).bypassReason).toBe('invalid_working_reps');
      expect(generateBodyweightWarmupTargets(10.5).bypassReason).toBe('invalid_working_reps');
      expect(generateBodyweightWarmupTargets(Infinity).bypassReason).toBe('invalid_working_reps');
      expect(generateBodyweightWarmupTargets(-Infinity).bypassReason).toBe('invalid_working_reps');
    });

    it('is deterministic over repeated calls', () => {
      const res1 = generateBodyweightWarmupTargets(10);
      const res2 = generateBodyweightWarmupTargets(10);
      expect(res1).toEqual(res2);
    });
  });

  describe('remapAfterWarmupChange', () => {
    it('shifts target exercise working sets: 0 -> 1', () => {
      const stateMap = { '0-0': 'work1', '0-1': 'work2', '1-0': 'other' };
      const remapped = remapAfterWarmupChange(stateMap, 0, 0, 1);
      expect(remapped).toEqual({ '0-1': 'work1', '0-2': 'work2', '1-0': 'other' });
    });

    it('shifts target exercise working sets: 0 -> 2', () => {
      const stateMap = { '0-0': 'work1', '1-0': 'other' };
      const remapped = remapAfterWarmupChange(stateMap, 0, 0, 2);
      expect(remapped).toEqual({ '0-2': 'work1', '1-0': 'other' });
    });

    it('shifts target exercise working sets: 0 -> 3', () => {
      const stateMap = { '0-0': 'work1', '0-1': 'work2', '1-0': 'other' };
      const remapped = remapAfterWarmupChange(stateMap, 0, 0, 3);
      expect(remapped).toEqual({ '0-3': 'work1', '0-4': 'work2', '1-0': 'other' });
    });

    it('shifts target exercise working sets: 1 -> 2', () => {
      const stateMap = { '0-0': 'old-w1', '0-1': 'work1', '1-0': 'other' };
      const remapped = remapAfterWarmupChange(stateMap, 0, 1, 2);
      expect(remapped).toEqual({ '0-2': 'work1', '1-0': 'other' });
    });

    it('shifts target exercise working sets: 1 -> 3', () => {
      const stateMap = { '0-0': 'old-w1', '0-1': 'work1', '1-0': 'other' };
      const remapped = remapAfterWarmupChange(stateMap, 0, 1, 3);
      expect(remapped).toEqual({ '0-3': 'work1', '1-0': 'other' });
    });

    it('shifts target exercise working sets: 2 -> 1', () => {
      const stateMap = { '0-0': 'old-w1', '0-1': 'old-w2', '0-2': 'work1', '1-0': 'other' };
      const remapped = remapAfterWarmupChange(stateMap, 0, 2, 1);
      expect(remapped).toEqual({ '0-1': 'work1', '1-0': 'other' });
    });

    it('shifts target exercise working sets: 2 -> 3', () => {
      const stateMap = { '0-0': 'old-w1', '0-1': 'old-w2', '0-2': 'work1', '1-0': 'other' };
      const remapped = remapAfterWarmupChange(stateMap, 0, 2, 3);
      expect(remapped).toEqual({ '0-3': 'work1', '1-0': 'other' });
    });

    it('shifts target exercise working sets: 3 -> 1', () => {
      const stateMap = { '0-0': 'old-w1', '0-1': 'old-w2', '0-2': 'old-w3', '0-3': 'work1', '1-0': 'other' };
      const remapped = remapAfterWarmupChange(stateMap, 0, 3, 1);
      expect(remapped).toEqual({ '0-1': 'work1', '1-0': 'other' });
    });

    it('shifts target exercise working sets: 3 -> 2', () => {
      const stateMap = { '0-0': 'old-w1', '0-1': 'old-w2', '0-2': 'old-w3', '0-3': 'work1', '1-0': 'other' };
      const remapped = remapAfterWarmupChange(stateMap, 0, 3, 2);
      expect(remapped).toEqual({ '0-2': 'work1', '1-0': 'other' });
    });

    it('same-count replacement: 1 -> 1 discards old warmup and retains working sets', () => {
      const stateMap = { '0-0': 'old-w1', '0-1': 'work1', '1-0': 'other' };
      const remapped = remapAfterWarmupChange(stateMap, 0, 1, 1);
      expect(remapped).toEqual({ '0-1': 'work1', '1-0': 'other' });
    });

    it('same-count replacement: 2 -> 2 discards old warmups and retains working sets', () => {
      const stateMap = { '0-0': 'old-w1', '0-1': 'old-w2', '0-2': 'work1', '1-0': 'other' };
      const remapped = remapAfterWarmupChange(stateMap, 0, 2, 2);
      expect(remapped).toEqual({ '0-2': 'work1', '1-0': 'other' });
    });

    it('same-count replacement: 3 -> 3 discards old warmups and retains working sets', () => {
      const stateMap = { '0-0': 'old-w1', '0-1': 'old-w2', '0-2': 'old-w3', '0-3': 'work1' };
      const remapped = remapAfterWarmupChange(stateMap, 0, 3, 3);
      expect(remapped).toEqual({ '0-3': 'work1' });
    });

    it('preserves malformed and non-conforming keys untouched', () => {
      const stateMap = {
        'invalid': true,
        '0-abc': false,
        'foo-bar': true,
        '': false,
      };
      const remapped = remapAfterWarmupChange(stateMap, 0, 0, 2);
      expect(remapped).toEqual(stateMap);
    });

    it('does not mutate input map', () => {
      const stateMap = { '0-0': 'work1', '1-0': 'other' };
      const copy = { ...stateMap };
      remapAfterWarmupChange(stateMap, 0, 0, 2);
      expect(stateMap).toEqual(copy);
    });
  });

  describe('Historical Save Traces & Isolation Regressions', () => {
    it('Trace 1: Legacy log, zero underlying bodyweight weight, current Settings is 90 kg -> snapshot remains absent, weight remains 0', () => {
      // Current settings bodyweight is set to 90 kg
      storage.setBodyweightWithUnit(90, 'kg');

      // Legacy historical log has no bodyweightSnapshot property (undefined)
      const historicalLog: WorkoutLog = {
        id: 'legacy-log-1',
        date: '2025-01-01',
        unit: 'kg',
        exercises: [
          {
            name: 'Pull Up',
            muscleGroup: 'Back',
            modality: 'bodyweight',
            sets: [
              {
                setNumber: 1,
                weight: 0,
                reps: 10,
                rpe: 8,
                form: 'standard',
                comment: 'legacy note',
              },
            ],
          },
        ],
      };

      // In WorkoutLogger edit mode for legacy log:
      const activeSnapshot = historicalLog.bodyweightSnapshot !== undefined
        ? cloneBodyweightSnapshot(historicalLog.bodyweightSnapshot)
        : undefined;
      expect(activeSnapshot).toBeUndefined();

      // Resolved active bodyweight in unit
      const sessionBw = resolveSessionBodyweightInUnit(activeSnapshot, 'kg');
      expect(sessionBw).toBeNull(); // No fallback to storage 90 kg!

      // Execute save preparation using identical arguments as WorkoutLogger
      const processedExercises = prepareExercisesForSave({
        exercises: historicalLog.exercises,
        checkedSets: { '0-0': true },
        defaultBodyweight: sessionBw ?? null,
        completionTouchedSets: {},
        isEditMode: true,
      });

      // Construct resaved log using WorkoutLogger save logic
      const resavedLog: WorkoutLog = {
        ...historicalLog,
        exercises: processedExercises,
        bodyweightSnapshot: activeSnapshot !== undefined
          ? cloneBodyweightSnapshot(activeSnapshot)
          : undefined,
      };

      // Verifications:
      expect(resavedLog.bodyweightSnapshot).toBeUndefined();
      expect(resavedLog.exercises[0].sets[0].weight).toBe(0); // Never became 90 kg!
      expect(resavedLog.exercises[0].sets[0].reps).toBe(10);
      expect(resavedLog.exercises[0].sets[0].rpe).toBe(8);
      expect(resavedLog.exercises[0].sets[0].comment).toBe('legacy note');
      expect(resavedLog.exercises[0].sets[0].isCompleted).toBe(true);

      // JSON serialization check: undefined property is omitted, not converted to null
      const serialized = JSON.stringify(resavedLog);
      expect(serialized).not.toContain('"bodyweightSnapshot"');
    });

    it('Trace 2: Legacy log with existing nonzero stored weight 80 kg, current Settings is 90 kg -> weight remains 80, snapshot remains absent', () => {
      storage.setBodyweightWithUnit(90, 'kg');

      const historicalLog: WorkoutLog = {
        id: 'legacy-log-2',
        date: '2025-01-02',
        unit: 'kg',
        exercises: [
          {
            name: 'Dips',
            muscleGroup: 'Triceps',
            modality: 'bodyweight',
            sets: [
              {
                setNumber: 1,
                weight: 80,
                reps: 8,
                rpe: 8.5,
                form: 'standard',
              },
            ],
          },
        ],
      };

      const activeSnapshot = historicalLog.bodyweightSnapshot !== undefined
        ? cloneBodyweightSnapshot(historicalLog.bodyweightSnapshot)
        : undefined;
      const sessionBw = resolveSessionBodyweightInUnit(activeSnapshot, 'kg');

      const processedExercises = prepareExercisesForSave({
        exercises: historicalLog.exercises,
        checkedSets: { '0-0': true },
        defaultBodyweight: sessionBw ?? null,
        completionTouchedSets: {},
        isEditMode: true,
      });

      const resavedLog: WorkoutLog = {
        ...historicalLog,
        exercises: processedExercises,
        bodyweightSnapshot: activeSnapshot !== undefined
          ? cloneBodyweightSnapshot(activeSnapshot)
          : undefined,
      };

      expect(resavedLog.bodyweightSnapshot).toBeUndefined();
      expect(resavedLog.exercises[0].sets[0].weight).toBe(80);
      expect(resavedLog.exercises[0].sets[0].weight).not.toBe(90);
    });

    it('Trace 3: Historical log with explicit null snapshot, current Settings is 90 kg -> null remains null, weight remains 0', () => {
      storage.setBodyweightWithUnit(90, 'kg');

      const historicalLog: WorkoutLog = {
        id: 'log-with-null-bw',
        date: '2025-01-03',
        unit: 'kg',
        bodyweightSnapshot: null,
        exercises: [
          {
            name: 'Push Up',
            muscleGroup: 'Chest',
            modality: 'bodyweight',
            sets: [
              {
                setNumber: 1,
                weight: 0,
                reps: 15,
                rpe: 7,
                form: 'standard',
              },
            ],
          },
        ],
      };

      const activeSnapshot = historicalLog.bodyweightSnapshot !== undefined
        ? cloneBodyweightSnapshot(historicalLog.bodyweightSnapshot)
        : undefined;
      expect(activeSnapshot).toBeNull();

      const sessionBw = resolveSessionBodyweightInUnit(activeSnapshot, 'kg');
      expect(sessionBw).toBeNull();

      const processedExercises = prepareExercisesForSave({
        exercises: historicalLog.exercises,
        checkedSets: { '0-0': true },
        defaultBodyweight: sessionBw ?? null,
        completionTouchedSets: {},
        isEditMode: true,
      });

      const resavedLog: WorkoutLog = {
        ...historicalLog,
        exercises: processedExercises,
        bodyweightSnapshot: activeSnapshot !== undefined
          ? cloneBodyweightSnapshot(activeSnapshot)
          : null,
      };

      expect(resavedLog.bodyweightSnapshot).toBeNull();
      expect(resavedLog.exercises[0].sets[0].weight).toBe(0);
    });

    it('Trace 4: Historical log with valid original snapshot (80 kg), current Settings is 90 kg -> snapshot remains 80 kg, ignores 90 kg', () => {
      storage.setBodyweightWithUnit(90, 'kg');

      const historicalLog: WorkoutLog = {
        id: 'log-with-valid-bw',
        date: '2025-01-04',
        unit: 'kg',
        bodyweightSnapshot: { value: 80, unit: 'kg' },
        exercises: [
          {
            name: 'Pull Up',
            muscleGroup: 'Back',
            modality: 'bodyweight',
            sets: [
              {
                setNumber: 1,
                weight: 0,
                reps: 8,
                rpe: 8,
                form: 'standard',
              },
            ],
          },
        ],
      };

      const activeSnapshot = historicalLog.bodyweightSnapshot !== undefined
        ? cloneBodyweightSnapshot(historicalLog.bodyweightSnapshot)
        : undefined;
      expect(activeSnapshot).toEqual({ value: 80, unit: 'kg' });

      const sessionBw = resolveSessionBodyweightInUnit(activeSnapshot, 'kg');
      expect(sessionBw).toBe(80);

      const processedExercises = prepareExercisesForSave({
        exercises: historicalLog.exercises,
        checkedSets: { '0-0': true },
        defaultBodyweight: sessionBw ?? null,
        completionTouchedSets: {},
        isEditMode: true,
      });

      const resavedLog: WorkoutLog = {
        ...historicalLog,
        exercises: processedExercises,
        bodyweightSnapshot: activeSnapshot !== undefined
          ? cloneBodyweightSnapshot(activeSnapshot)
          : null,
      };

      expect(resavedLog.bodyweightSnapshot).toEqual({ value: 80, unit: 'kg' });
      // When defaultBodyweight is 80 kg and set weight is 0 for bodyweight modality, prepareExercisesForSave fills default
      expect(resavedLog.exercises[0].sets[0].weight).toBe(80);
      expect(resavedLog.exercises[0].sets[0].weight).not.toBe(90);
    });
  });
});
