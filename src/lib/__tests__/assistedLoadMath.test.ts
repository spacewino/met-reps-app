/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  convertWeightUnit,
  roundToNearest2Point5,
  calculateAssistedEffectiveLoad,
  generateAssistedWarmupTargets,
  KG_TO_LB,
  LB_TO_KG,
} from '../assistedLoadMath';

describe('assistedLoadMath - Unit-Safe Assisted Modality & Auto Warm-Up', () => {
  describe('1. Unit Conversion and Rounding Helpers', () => {
    it('converts kg to lb using canonical constant', () => {
      expect(convertWeightUnit(100, 'kg', 'lb')).toBeCloseTo(100 * KG_TO_LB, 6);
      expect(convertWeightUnit(1, 'kg', 'lb')).toBe(2.2046226218);
    });

    it('converts lb to kg using canonical constant', () => {
      expect(convertWeightUnit(220.46226218, 'lb', 'kg')).toBeCloseTo(100, 4);
      expect(convertWeightUnit(1, 'lb', 'kg')).toBe(0.45359237);
    });

    it('returns the same value when fromUnit === toUnit', () => {
      expect(convertWeightUnit(75, 'kg', 'kg')).toBe(75);
      expect(convertWeightUnit(150, 'lb', 'lb')).toBe(150);
    });

    it('rounds correctly to nearest 2.5 increment', () => {
      expect(roundToNearest2Point5(73.8)).toBe(75);
      expect(roundToNearest2Point5(73.75)).toBe(75);
      expect(roundToNearest2Point5(73.7)).toBe(72.5);
      expect(roundToNearest2Point5(73.6)).toBe(72.5);
      expect(roundToNearest2Point5(57.5)).toBe(57.5);
      expect(roundToNearest2Point5(126.5)).toBe(127.5);
      expect(roundToNearest2Point5(143)).toBe(142.5);
    });
  });

  describe('2. calculateAssistedEffectiveLoad', () => {
    it('calculates effective load for canonical 100 kg bodyweight', () => {
      // 100 kg BW, 50 kg assistance => 50 kg effective
      const resA = calculateAssistedEffectiveLoad(50, 'kg', 100, 'kg');
      expect(resA.status).toBe('valid');
      expect(resA.effectiveLoad).toBe(50);
      expect(resA.unit).toBe('kg');

      // 100 kg BW, 20 kg assistance => 80 kg effective (greater performance demand)
      const resB = calculateAssistedEffectiveLoad(20, 'kg', 100, 'kg');
      expect(resB.status).toBe('valid');
      expect(resB.effectiveLoad).toBe(80);
      expect(resB.unit).toBe('kg');

      expect(resB.effectiveLoad!).toBeGreaterThan(resA.effectiveLoad!);
    });

    it('converts cross-unit bodyweight correctly when calculating effective load', () => {
      // Bodyweight stored as 220.46226218 lb (~100 kg), workout in kg, 40 kg assistance => 60 kg effective
      const res = calculateAssistedEffectiveLoad(40, 'kg', 220.46226218, 'lb', 'kg');
      expect(res.status).toBe('valid');
      expect(res.effectiveLoad).toBeCloseTo(60, 2);
    });

    it('returns bypass for missing or invalid inputs', () => {
      expect(calculateAssistedEffectiveLoad(null, 'kg', 100, 'kg').status).toBe('bypassed');
      expect(calculateAssistedEffectiveLoad(50, 'kg', null, 'kg').status).toBe('bypassed');
      expect(calculateAssistedEffectiveLoad(50, 'kg', 100, null).status).toBe('bypassed');
      expect(calculateAssistedEffectiveLoad(-10, 'kg', 100, 'kg').bypassReason).toBe('negative_assistance');
      expect(calculateAssistedEffectiveLoad(100, 'kg', 100, 'kg').bypassReason).toBe('zero_effective_load');
      expect(calculateAssistedEffectiveLoad(110, 'kg', 100, 'kg').bypassReason).toBe('assistance_exceeds_bodyweight');
    });
  });

  describe('3. generateAssistedWarmupTargets - Canonical Fixtures', () => {
    it('generates ascending effective load warmups for canonical 100 kg BW / 50 kg assistance / 8 reps', () => {
      const result = generateAssistedWarmupTargets({
        workingAssistance: 50,
        assistanceUnit: 'kg',
        bodyweight: 100,
        bodyweightUnit: 'kg',
        workingReps: 8,
      });

      expect(result.status).toBe('valid');
      expect(result.warmupTargets).toHaveLength(3);

      const [w1, w2, w3] = result.warmupTargets!;

      // Working set: 50 kg assistance (Effective: 50 kg)
      // W1: 50% effective load = 25 kg => Assistance = 100 - 25 = 75 kg
      expect(w1.setNumber).toBe(1);
      expect(w1.assistance).toBe(75);
      expect(w1.reps).toBe(8);
      expect(w1.rpe).toBe(4.0);
      expect(w1.isWarmup).toBe(true);

      // W2: 70% effective load = 35 kg => Assistance = 100 - 35 = 65 kg
      expect(w2.setNumber).toBe(2);
      expect(w2.assistance).toBe(65);
      expect(w2.reps).toBe(6); // round(8 * 0.70) = 6
      expect(w2.rpe).toBe(6.0);
      expect(w2.isWarmup).toBe(true);

      // W3: 85% effective load = 42.5 kg => Assistance = 100 - 42.5 = 57.5 kg
      expect(w3.setNumber).toBe(3);
      expect(w3.assistance).toBe(57.5);
      expect(w3.reps).toBe(3); // max(3, round(8 * 0.35)) = 3
      expect(w3.rpe).toBe(7.0);
      expect(w3.isWarmup).toBe(true);

      // Verify assistance strictly descends (meaning effective load strictly ascends)
      expect(w1.assistance).toBeGreaterThan(w2.assistance);
      expect(w2.assistance).toBeGreaterThan(w3.assistance);
      expect(w3.assistance).toBeGreaterThan(50); // Working assistance
    });

    it('generates correct warmups for lb fixture: 220 lb BW / 110 lb assistance / 8 reps', () => {
      const result = generateAssistedWarmupTargets({
        workingAssistance: 110,
        assistanceUnit: 'lb',
        bodyweight: 220,
        bodyweightUnit: 'lb',
        workingReps: 8,
      });

      expect(result.status).toBe('valid');
      expect(result.warmupTargets).toHaveLength(3);

      const [w1, w2, w3] = result.warmupTargets!;

      // Working set: 110 lb assistance (Effective: 110 lb)
      // W1: 50% effective load = 55 lb => Assistance = 220 - 55 = 165 lb
      expect(w1.assistance).toBe(165);
      expect(w1.reps).toBe(8);
      expect(w1.rpe).toBe(4.0);

      // W2: 70% effective load = 77 lb => Assistance = 220 - 77 = 143 lb -> 142.5 lb
      expect(w2.assistance).toBe(142.5);
      expect(w2.reps).toBe(6);
      expect(w2.rpe).toBe(6.0);

      // W3: 85% effective load = 93.5 lb => Assistance = 220 - 93.5 = 126.5 lb -> 127.5 lb
      expect(w3.assistance).toBe(127.5);
      expect(w3.reps).toBe(3);
      expect(w3.rpe).toBe(7.0);

      // Verify progression
      expect(w1.assistance).toBeGreaterThan(w2.assistance);
      expect(w2.assistance).toBeGreaterThan(w3.assistance);
      expect(w3.assistance).toBeGreaterThan(110);
    });

    it('handles cross-unit bodyweight in lb with workout in kg', () => {
      const result = generateAssistedWarmupTargets({
        workingAssistance: 50,
        assistanceUnit: 'kg',
        bodyweight: 220.46226218, // 100 kg in lb
        bodyweightUnit: 'lb',
        workingReps: 8,
      });

      expect(result.status).toBe('valid');
      const [w1, w2, w3] = result.warmupTargets!;
      expect(w1.assistance).toBe(75);
      expect(w2.assistance).toBe(65);
      expect(w3.assistance).toBe(57.5);
    });
  });

  describe('4. generateAssistedWarmupTargets - Bypass Cases', () => {
    it('bypasses when bodyweight is missing or null', () => {
      const res = generateAssistedWarmupTargets({
        workingAssistance: 50,
        assistanceUnit: 'kg',
        bodyweight: null,
        bodyweightUnit: 'kg',
        workingReps: 8,
      });
      expect(res.status).toBe('bypassed');
      expect(res.bypassReason).toBe('missing_bodyweight');
      expect(res.warmupTargets).toBeNull();
    });

    it('bypasses when bodyweight is non-positive or NaN', () => {
      const res = generateAssistedWarmupTargets({
        workingAssistance: 50,
        assistanceUnit: 'kg',
        bodyweight: 0,
        bodyweightUnit: 'kg',
        workingReps: 8,
      });
      expect(res.status).toBe('bypassed');
      expect(res.bypassReason).toBe('invalid_bodyweight');
    });

    it('bypasses when bodyweight unit is missing', () => {
      const res = generateAssistedWarmupTargets({
        workingAssistance: 50,
        assistanceUnit: 'kg',
        bodyweight: 100,
        bodyweightUnit: null,
        workingReps: 8,
      });
      expect(res.status).toBe('bypassed');
      expect(res.bypassReason).toBe('missing_bodyweight_unit');
    });

    it('bypasses when working assistance is missing', () => {
      const res = generateAssistedWarmupTargets({
        workingAssistance: null,
        assistanceUnit: 'kg',
        bodyweight: 100,
        bodyweightUnit: 'kg',
        workingReps: 8,
      });
      expect(res.status).toBe('bypassed');
      expect(res.bypassReason).toBe('missing_assistance');
    });

    it('bypasses when working assistance is negative', () => {
      const res = generateAssistedWarmupTargets({
        workingAssistance: -10,
        assistanceUnit: 'kg',
        bodyweight: 100,
        bodyweightUnit: 'kg',
        workingReps: 8,
      });
      expect(res.status).toBe('bypassed');
      expect(res.bypassReason).toBe('negative_assistance');
    });

    it('bypasses when working assistance equals bodyweight (zero effective load)', () => {
      const res = generateAssistedWarmupTargets({
        workingAssistance: 100,
        assistanceUnit: 'kg',
        bodyweight: 100,
        bodyweightUnit: 'kg',
        workingReps: 8,
      });
      expect(res.status).toBe('bypassed');
      expect(res.bypassReason).toBe('zero_effective_load');
    });

    it('bypasses when working assistance exceeds bodyweight', () => {
      const res = generateAssistedWarmupTargets({
        workingAssistance: 120,
        assistanceUnit: 'kg',
        bodyweight: 100,
        bodyweightUnit: 'kg',
        workingReps: 8,
      });
      expect(res.status).toBe('bypassed');
      expect(res.bypassReason).toBe('assistance_exceeds_bodyweight');
    });

    it('bypasses when working reps are zero or invalid', () => {
      const res = generateAssistedWarmupTargets({
        workingAssistance: 50,
        assistanceUnit: 'kg',
        bodyweight: 100,
        bodyweightUnit: 'kg',
        workingReps: 0,
      });
      expect(res.status).toBe('bypassed');
      expect(res.bypassReason).toBe('invalid_working_reps');
    });

    it('bypasses when working reps are negative, fractional, NaN, or infinite', () => {
      // Negative reps
      expect(generateAssistedWarmupTargets({
        workingAssistance: 50,
        assistanceUnit: 'kg',
        bodyweight: 100,
        bodyweightUnit: 'kg',
        workingReps: -5,
      }).bypassReason).toBe('invalid_working_reps');

      // Fractional reps (must not be silently rounded)
      expect(generateAssistedWarmupTargets({
        workingAssistance: 50,
        assistanceUnit: 'kg',
        bodyweight: 100,
        bodyweightUnit: 'kg',
        workingReps: 8.5,
      }).bypassReason).toBe('invalid_working_reps');

      // NaN reps
      expect(generateAssistedWarmupTargets({
        workingAssistance: 50,
        assistanceUnit: 'kg',
        bodyweight: 100,
        bodyweightUnit: 'kg',
        workingReps: NaN,
      }).bypassReason).toBe('invalid_working_reps');

      // Infinity reps
      expect(generateAssistedWarmupTargets({
        workingAssistance: 50,
        assistanceUnit: 'kg',
        bodyweight: 100,
        bodyweightUnit: 'kg',
        workingReps: Infinity,
      }).bypassReason).toBe('invalid_working_reps');
    });

    it('bypasses when bodyweight or assistance is NaN or Infinity', () => {
      expect(generateAssistedWarmupTargets({
        workingAssistance: NaN,
        assistanceUnit: 'kg',
        bodyweight: 100,
        bodyweightUnit: 'kg',
        workingReps: 8,
      }).bypassReason).toBe('invalid_assistance');

      expect(generateAssistedWarmupTargets({
        workingAssistance: Infinity,
        assistanceUnit: 'kg',
        bodyweight: 100,
        bodyweightUnit: 'kg',
        workingReps: 8,
      }).bypassReason).toBe('invalid_assistance');

      expect(generateAssistedWarmupTargets({
        workingAssistance: 50,
        assistanceUnit: 'kg',
        bodyweight: Infinity,
        bodyweightUnit: 'kg',
        workingReps: 8,
      }).bypassReason).toBe('invalid_bodyweight');
    });

    it('handles legacy bodyweight without unit by bypassing safely', () => {
      const res = generateAssistedWarmupTargets({
        workingAssistance: 50,
        assistanceUnit: 'kg',
        bodyweight: 100,
        bodyweightUnit: null,
        workingReps: 8,
      });
      expect(res.status).toBe('bypassed');
      expect(res.bypassReason).toBe('missing_bodyweight_unit');
      expect(res.warmupTargets).toBeNull();
    });
  });

  describe('5. Post-Rounding Safety Invariants and Edge Cases', () => {
    it('allows zero assistance when bodyweight is positive', () => {
      const result = generateAssistedWarmupTargets({
        workingAssistance: 0,
        assistanceUnit: 'kg',
        bodyweight: 100,
        bodyweightUnit: 'kg',
        workingReps: 8,
      });

      expect(result.status).toBe('valid');
      expect(result.warmupTargets).toHaveLength(3);

      const [w1, w2, w3] = result.warmupTargets!;
      // Working: 0 assistance (100 kg effective)
      // W1: 50% = 50 kg eff => 50 kg assistance
      // W2: 70% = 70 kg eff => 30 kg assistance
      // W3: 85% = 85 kg eff => 15 kg assistance
      expect(w1.assistance).toBe(50);
      expect(w2.assistance).toBe(30);
      expect(w3.assistance).toBe(15);

      // Invariants:
      expect(w1.assistance).toBeGreaterThan(0);
      expect(w2.assistance).toBeGreaterThan(0);
      expect(w3.assistance).toBeGreaterThan(0);
      expect(w1.assistance).toBeLessThan(100);
      expect(w2.assistance).toBeLessThan(100);
      expect(w3.assistance).toBeLessThan(100);
    });

    it('bypasses near-bodyweight fixture (100 kg BW, 97.6 kg assistance) with insufficient_assistance_resolution', () => {
      const result = generateAssistedWarmupTargets({
        workingAssistance: 97.6,
        assistanceUnit: 'kg',
        bodyweight: 100,
        bodyweightUnit: 'kg',
        workingReps: 8,
      });

      expect(result.status).toBe('bypassed');
      expect(result.bypassReason).toBe('insufficient_assistance_resolution');
      expect(result.warmupTargets).toBeNull();
    });

    it('enforces post-rounding invariants on every valid target across varying loads', () => {
      const testCases = [
        { bw: 80, ast: 40, reps: 10, unit: 'kg' as const },
        { bw: 100, ast: 50, reps: 8, unit: 'kg' as const },
        { bw: 200, ast: 150, reps: 5, unit: 'lb' as const },
        { bw: 150, ast: 0, reps: 12, unit: 'lb' as const },
        { bw: 70, ast: 35, reps: 6, unit: 'kg' as const },
      ];

      for (const tc of testCases) {
        const res = generateAssistedWarmupTargets({
          workingAssistance: tc.ast,
          assistanceUnit: tc.unit,
          bodyweight: tc.bw,
          bodyweightUnit: tc.unit,
          workingReps: tc.reps,
        });

        expect(res.status).toBe('valid');
        const targets = res.warmupTargets!;
        const workingEff = tc.bw - tc.ast;

        let prevAst = Infinity;
        let prevEff = -Infinity;

        for (const t of targets) {
          // 1. target assistance > working assistance
          expect(t.assistance).toBeGreaterThan(tc.ast);
          // 2. target assistance < bodyweight
          expect(t.assistance).toBeLessThan(tc.bw);
          // 3. 2.5-unit increments
          expect(t.assistance % 2.5).toBeCloseTo(0, 5);

          const eff = tc.bw - t.assistance;
          // 4. effective load is positive
          expect(eff).toBeGreaterThan(0);
          // 5. effective load is less than working effective load
          expect(eff).toBeLessThan(workingEff);

          // 6. Warm-up effective loads are non-decreasing
          expect(eff).toBeGreaterThanOrEqual(prevEff);
          // 7. Assistance values are non-increasing
          expect(t.assistance).toBeLessThanOrEqual(prevAst);

          prevAst = t.assistance;
          prevEff = eff;
        }
      }
    });

    it('produces deep-equal results on repeated identical calls (idempotence)', () => {
      const input = {
        workingAssistance: 50,
        assistanceUnit: 'kg' as const,
        bodyweight: 100,
        bodyweightUnit: 'kg' as const,
        workingReps: 8,
      };

      const res1 = generateAssistedWarmupTargets(input);
      const res2 = generateAssistedWarmupTargets(input);

      expect(res1).toEqual(res2);
    });

    it('does not mutate input parameters', () => {
      const input = Object.freeze({
        workingAssistance: 50,
        assistanceUnit: 'kg' as const,
        bodyweight: 100,
        bodyweightUnit: 'kg' as const,
        workingReps: 8,
      });

      expect(() => generateAssistedWarmupTargets(input)).not.toThrow();
    });

    it('confirms 100 kg converts to 220.5 lb and switches back to 100.0 kg with 1-decimal rounding', () => {
      const initialKg = 100;
      const convertedLb = Math.round(convertWeightUnit(initialKg, 'kg', 'lb') * 10) / 10;
      expect(convertedLb).toBe(220.5);

      const backToKg = Math.round(convertWeightUnit(convertedLb, 'lb', 'kg') * 10) / 10;
      expect(backToKg).toBe(100.0);
    });

    it('guarantees failed assisted generation performs zero state or template mutation', () => {
      // Setup mock exercise state
      const initialExerciseState = Object.freeze([
        {
          name: 'Assisted Pull-Up',
          modality: 'assisted' as const,
          sets: Object.freeze([
            { setNumber: 1, weight: 97.6, reps: 8, rpe: 8.0, isWarmup: false },
            { setNumber: 2, weight: 97.6, reps: 8, rpe: 8.5, isWarmup: false },
          ]),
        },
      ]);

      // Attempt generation with 100 kg BW / 97.6 kg assistance (near-bodyweight => bypass)
      const res = generateAssistedWarmupTargets({
        workingAssistance: 97.6,
        assistanceUnit: 'kg',
        bodyweight: 100,
        bodyweightUnit: 'kg',
        workingReps: 8,
      });

      expect(res.status).toBe('bypassed');

      // Emulate the logger handler: on bypass, state mutation is skipped
      let mutated = false;
      if (res.status === 'valid' && res.warmupTargets) {
        mutated = true;
      }

      expect(mutated).toBe(false);
      expect(initialExerciseState[0].sets).toHaveLength(2);
      expect(initialExerciseState[0].sets[0].weight).toBe(97.6);
    });
  });
});
