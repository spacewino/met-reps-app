import { describe, expect, it } from 'vitest';
import { buildExercisePRReport } from '../exercisePRReport';
import type { ExerciseEntry, SetEntry, WorkoutLog } from '../../types';
import { convertWeightUnit } from '../assistedLoadMath';
const set = (extra: Partial<SetEntry> = {}): SetEntry => ({ setNumber: 1, weight: 100, reps: 1, ...extra });
const exercise = (extra: Partial<ExerciseEntry> = {}): ExerciseEntry => ({ name: 'Bench', exerciseKey: 'bench', muscleGroup: 'Pecs', sets: [set()], ...extra });
const log = (date: string, extra: Partial<WorkoutLog> = {}): WorkoutLog => ({ id: 'duplicate', date, unit: 'kg', exercises: [exercise()], ...extra });
const report = (logs: WorkoutLog[], target = exercise()) => buildExercisePRReport(logs, target, '2026-09-22');
const freeze = <T>(value: T): T => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

describe('exercise PR report saved history', () => {
  it('finds the first chronological all-time achievement, with exact duplicate occurrence/set/log provenance', () => {
    const logs = [log('2026-09-22'), log('2026-08-01', { exercises: [exercise({ sets: [set({ weight: 80 })] }), exercise({ sets: [set({ isWarmup: true, weight: 500 }), set(), set()] })] }), log('2026-07-01', { exercises: [exercise({ sets: [set({ weight: 80 })] })] })];
    const result = report(freeze(logs));
    expect(result.record).toMatchObject({ logIndex: 1, exerciseIndex: 1, setIndex: 1, bestKg: 100 });
    expect(result.record?.log).toBe(logs[1]);
    expect(logs[1].exercises[1].sets).toHaveLength(3);
  });
  it('retains the first tied set across occurrences in the same session', () => {
    expect(report([log('2026-09-21', { exercises: [exercise(), exercise()] })]).record).toMatchObject({ exerciseIndex: 0, setIndex: 0 });
  });
  it('uses explicit identity across renames and separates matching names with distinct explicit keys', () => {
    expect(report([log('2026-09-21', { exercises: [exercise({ name: 'Renamed', sets: [set({ weight: 110 })] }), exercise({ exerciseKey: 'custom', sets: [set({ weight: 500 })] })] })]).record?.bestKg).toBe(110);
    expect(report([log('2026-09-21', { exercises: [exercise({ exerciseKey: 'custom' })] })]).record).toBeNull();
  });
  it('uses canonical legacy-name fallback', () => {
    expect(report([log('2026-09-21', { exercises: [exercise({ exerciseKey: undefined, name: ' BÉNCH ' })] })]).record?.bestKg).toBe(100);
  });
  it('normalizes pounds before two-decimal kg rounding and uses reps-only Epley', () => {
    const kg = convertWeightUnit(220, 'lb', 'kg');
    expect(report([log('2026-09-21', { unit: 'lb', exercises: [exercise({ sets: [set({ weight: 220, reps: 5, rpe: 2, form: 'loose' })] })] })]).record?.bestKg).toBe(Math.round(kg * (1 + 5 / 30) * 100) / 100);
  });
  it.each(['bodyweight', 'assisted'] as const)('uses saved snapshots for %s and excludes missing snapshots', modality => {
    const target = exercise({ modality, sets: [set({ weight: 20, reps: 1 })] });
    expect(report([log('2026-09-21', { exercises: [target] })], target).record).toBeNull();
    expect(report([log('2026-09-21', { exercises: [target], bodyweightSnapshot: { value: 80, unit: 'kg' } })], target).record?.bestKg).toBe(modality === 'bodyweight' ? 80 : 60);
  });
  it.each([{ isWarmup: true }, { isSkipped: true }, { isCompleted: false }, { reps: 0 }, { reps: 1.5 }, { reps: NaN }, { weight: NaN }, { weight: -1 }, { weight: 0 }])('excludes ineligible parent sets %j', extra => {
    expect(report([log('2026-09-21', { exercises: [exercise({ sets: [set(extra)] })] })]).record).toBeNull();
  });
  it('excludes skipped exercises, retains legacy completion and ignores drop subsets as records', () => {
    expect(report([log('2026-09-21', { exercises: [exercise({ isSkipped: true })] })]).record).toBeNull();
    expect(report([log('2026-09-21', { exercises: [exercise({ sets: [set({ isDropSet: true, dropSubSets: [{ weight: 500, reps: 20 }] })] })] })]).record?.bestKg).toBe(100);
  });
  it.each(['timed', 'distance', 'distance_loaded'] as const)('reports unsupported %s', modality => {
    expect(report([log('2026-09-21')], exercise({ modality }))).toEqual({ unsupported: true, record: null, recent: [] });
    expect(report([log('2026-09-21', { exercises: [exercise({ modality })] })]).record).toBeNull();
  });
  it('rejects invalid and future dates and sorts unsorted same-day epoch sessions', () => {
    const logs = [log('2026-09-22', { id: 'log-1700000009000' }), log('2026-09-23'), log('2026-02-30'), log(' 2026-09-01'), log('bad'), log('2026-09-22', { id: 'log-1700000000000' })];
    const result = report(logs);
    expect(result.recent.map(s => s.logIndex)).toEqual([5, 0]);
    expect(result.record?.logIndex).toBe(5);
    expect(result.recent.map(s => s.sameDayOrdinal)).toEqual([1, 2]);
  });
  it('retains original order for legacy same-day and duplicate IDs', () => {
    expect(report([log('2026-09-22'), log('2026-09-22')]).record?.logIndex).toBe(0);
  });
  it('uses exactly the latest six matching sessions including unavailable; keeps an older PR reference', () => {
    const logs = Array.from({ length: 8 }, (_, i) => log(`2026-09-${String(i + 1).padStart(2, '0')}`, { exercises: [exercise({ sets: [set({ weight: i === 0 ? 200 : 100, isCompleted: i !== 4 })] }), exercise({ sets: [set({ weight: 90, isCompleted: i !== 4 })] })] }));
    const result = report(freeze(logs));
    expect(result.record?.bestKg).toBe(200);
    expect(result.recent.map(s => s.logIndex)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(result.recent.map(s => s.bestKg)).toEqual([100, 100, null, 100, 100, 100]);
  });
  it('returns zero and one session without fabricated data', () => {
    expect(report([])).toEqual({ unsupported: false, record: null, recent: [] });
    expect(report([log('2026-09-21')]).recent).toHaveLength(1);
  });
});
