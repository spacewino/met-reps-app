import { describe, it, expect } from 'vitest';
import { resolveSetEffectiveLoad, calculateSetWorkingVolume } from '../effectiveLoad';

describe('effectiveLoad module', () => {
  describe('resolveSetEffectiveLoad', () => {
    it('1. Weighted 100 kg resolves to 100 kg', () => {
      const res = resolveSetEffectiveLoad(100, 'weighted', 'kg', null);
      expect(res.status).toBe('valid');
      expect(res.effectiveLoadKg).toBe(100);
      expect(res.effectiveLoadInLogUnit).toBe(100);
      expect(res.canonicalUnit).toBe('kg');
      expect(res.modality).toBe('weighted');
    });

    it('2. Weighted 220.46226218 lb is physically equivalent to 100 kg', () => {
      const res = resolveSetEffectiveLoad(220.46226218487757, 'weighted', 'lb', null);
      expect(res.status).toBe('valid');
      expect(res.effectiveLoadKg).toBeCloseTo(100, 4);
      expect(res.effectiveLoadInLogUnit).toBeCloseTo(220.462, 2);
    });

    it('3. Modern bodyweight with 100 kg snapshot and raw weight 0 resolves to 100 kg', () => {
      const res = resolveSetEffectiveLoad(0, 'bodyweight', 'kg', { value: 100, unit: 'kg' });
      expect(res.status).toBe('valid');
      expect(res.effectiveLoadKg).toBe(100);
      expect(res.effectiveLoadInLogUnit).toBe(100);
    });

    it('4. Modern bodyweight with 100 kg snapshot and raw stored weight 100 still resolves to 100 kg (no double-counting)', () => {
      const res = resolveSetEffectiveLoad(100, 'bodyweight', 'kg', { value: 100, unit: 'kg' });
      expect(res.status).toBe('valid');
      expect(res.effectiveLoadKg).toBe(100);
      expect(res.effectiveLoadInLogUnit).toBe(100);
    });

    it('5. Legacy bodyweight without snapshot returns unavailable', () => {
      const res = resolveSetEffectiveLoad(0, 'bodyweight', 'kg', null);
      expect(res.status).toBe('unavailable');
      expect(res.effectiveLoadKg).toBeNull();
      expect(res.reason).toBe('missing_snapshot');
    });

    it('6. Assisted 100 kg snapshot minus 50 kg assistance resolves to 50 kg', () => {
      const res = resolveSetEffectiveLoad(50, 'assisted', 'kg', { value: 100, unit: 'kg' });
      expect(res.status).toBe('valid');
      expect(res.effectiveLoadKg).toBe(50);
      expect(res.effectiveLoadInLogUnit).toBe(50);
    });

    it('7. Assisted assistance falling from 50 kg to 20 kg increases effective load from 50 kg to 80 kg', () => {
      const res1 = resolveSetEffectiveLoad(50, 'assisted', 'kg', { value: 100, unit: 'kg' });
      const res2 = resolveSetEffectiveLoad(20, 'assisted', 'kg', { value: 100, unit: 'kg' });
      expect(res1.effectiveLoadKg).toBe(50);
      expect(res2.effectiveLoadKg).toBe(80);
      expect(res2.effectiveLoadKg! > res1.effectiveLoadKg!).toBe(true);
    });

    it('8. Cross-unit assisted: 220.46226218 lb snapshot minus 50 kg assistance (in kg session) resolves to 50 kg', () => {
      const res = resolveSetEffectiveLoad(50, 'assisted', 'kg', { value: 220.46226218487757, unit: 'lb' });
      expect(res.status).toBe('valid');
      expect(res.effectiveLoadKg).toBeCloseTo(50, 4);
    });

    it('9. Zero assistance is valid (effective load equals bodyweight)', () => {
      const res = resolveSetEffectiveLoad(0, 'assisted', 'kg', { value: 85, unit: 'kg' });
      expect(res.status).toBe('valid');
      expect(res.effectiveLoadKg).toBe(85);
    });

    it('10. Negative assistance is invalid', () => {
      const res = resolveSetEffectiveLoad(-10, 'assisted', 'kg', { value: 85, unit: 'kg' });
      expect(res.status).toBe('invalid');
      expect(res.reason).toBe('negative_assistance');
    });

    it('11. Assistance equal to bodyweight produces zero effective load and is invalid', () => {
      const res = resolveSetEffectiveLoad(85, 'assisted', 'kg', { value: 85, unit: 'kg' });
      expect(res.status).toBe('invalid');
      expect(res.reason).toBe('zero_effective_load');
    });

    it('12. Assistance exceeding bodyweight is invalid', () => {
      const res = resolveSetEffectiveLoad(90, 'assisted', 'kg', { value: 85, unit: 'kg' });
      expect(res.status).toBe('invalid');
      expect(res.reason).toBe('assistance_exceeds_bodyweight');
    });

    it('13. Timed, distance, and distance_loaded are not applicable for mass load', () => {
      expect(resolveSetEffectiveLoad(null, 'timed', 'kg', null).status).toBe('not_applicable');
      expect(resolveSetEffectiveLoad(null, 'distance', 'kg', null).status).toBe('not_applicable');
      expect(resolveSetEffectiveLoad(50, 'distance_loaded', 'kg', null).status).toBe('not_applicable');
    });
  });

  describe('calculateSetWorkingVolume', () => {
    it('calculates weighted volume (100 kg x 10 = 1000 kg)', () => {
      const res = calculateSetWorkingVolume(100, 10, 'weighted', 'kg', null);
      expect(res.status).toBe('valid');
      expect(res.volumeKg).toBe(1000);
      expect(res.effectiveLoadKg).toBe(100);
      expect(res.reps).toBe(10);
    });

    it('rejects invalid reps (0 or negative)', () => {
      const res = calculateSetWorkingVolume(100, 0, 'weighted', 'kg', null);
      expect(res.status).toBe('invalid');
      expect(res.reason).toBe('invalid_reps');
    });

    it('propagates unavailable status from missing snapshot on bodyweight', () => {
      const res = calculateSetWorkingVolume(0, 10, 'bodyweight', 'kg', null);
      expect(res.status).toBe('unavailable');
      expect(res.volumeKg).toBeNull();
    });
  });
});
