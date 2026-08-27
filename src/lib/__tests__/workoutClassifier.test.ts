/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { getEffectiveWeight, calculateE1RMForSet, getRollingBaselineE1RM, classifyWorkout } from '../workoutClassifier';
import { WorkoutLog } from '../../types';

describe('workoutClassifier effective load delegation and regressions', () => {
  it('correctly calculates active bodyweight (snapshot 110, set.weight: 0 -> effective 110kg)', () => {
    const eff = getEffectiveWeight(0, 'bodyweight', null, { value: 110, unit: 'kg' }, 'kg');
    expect(eff).toBe(110);
  });

  it('correctly calculates saved bodyweight without double counting (snapshot 110, set.weight: 110 -> effective 110kg, not 220kg)', () => {
    const eff = getEffectiveWeight(110, 'bodyweight', null, { value: 110, unit: 'kg' }, 'kg');
    expect(eff).toBe(110);
  });

  it('correctly calculates assisted effective load (snapshot 110, assistance 20 -> effective 90kg)', () => {
    const eff = getEffectiveWeight(20, 'assisted', null, { value: 110, unit: 'kg' }, 'kg');
    expect(eff).toBe(90);
  });

  it('correctly calculates weighted effective load (recorded weight 100 -> effective 100kg)', () => {
    const eff = getEffectiveWeight(100, 'weighted', null, null, 'kg');
    expect(eff).toBe(100);
  });

  it('returns 0 when snapshot is missing for bodyweight or assisted without fabricating fallback', () => {
    expect(getEffectiveWeight(0, 'bodyweight', null, null, 'kg')).toBe(0);
    expect(getEffectiveWeight(20, 'assisted', null, null, 'kg')).toBe(0);
  });

  it('correctly handles lb to lb unit continuity', () => {
    const eff = getEffectiveWeight(20, 'assisted', null, { value: 200, unit: 'lb' }, 'lb');
    expect(eff).toBe(180);
  });
});
