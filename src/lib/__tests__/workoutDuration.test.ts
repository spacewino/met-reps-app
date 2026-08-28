import { describe, it, expect } from 'vitest';
import { resolveWorkoutDurationMinutes } from '../workoutDuration';

describe('resolveWorkoutDurationMinutes', () => {
  it('1. Returns 60 when durationMinutes is undefined (legacy fallback)', () => {
    expect(resolveWorkoutDurationMinutes(undefined)).toBe(60);
  });

  it('2. Returns 60 when argument is omitted (missing optional value)', () => {
    expect(resolveWorkoutDurationMinutes()).toBe(60);
  });

  it('3. Preserves valid positive numbers below, equal to, and above 60 unchanged', () => {
    expect(resolveWorkoutDurationMinutes(1)).toBe(1);
    expect(resolveWorkoutDurationMinutes(45)).toBe(45);
    expect(resolveWorkoutDurationMinutes(60)).toBe(60);
    expect(resolveWorkoutDurationMinutes(90)).toBe(90);
    expect(resolveWorkoutDurationMinutes(180)).toBe(180);
  });

  it('4. Preserves positive non-integer finite values unchanged', () => {
    expect(resolveWorkoutDurationMinutes(45.5)).toBe(45.5);
    expect(resolveWorkoutDurationMinutes(60.25)).toBe(60.25);
  });

  it('5. Returns null for explicit null', () => {
    expect(resolveWorkoutDurationMinutes(null)).toBeNull();
  });

  it('6. Returns null for zero', () => {
    expect(resolveWorkoutDurationMinutes(0)).toBeNull();
    expect(resolveWorkoutDurationMinutes(-0)).toBeNull();
  });

  it('7. Returns null for negative numbers', () => {
    expect(resolveWorkoutDurationMinutes(-1)).toBeNull();
    expect(resolveWorkoutDurationMinutes(-60)).toBeNull();
    expect(resolveWorkoutDurationMinutes(-0.5)).toBeNull();
  });

  it('8. Returns null for NaN', () => {
    expect(resolveWorkoutDurationMinutes(NaN)).toBeNull();
  });

  it('9. Returns null for Infinity and -Infinity', () => {
    expect(resolveWorkoutDurationMinutes(Infinity)).toBeNull();
    expect(resolveWorkoutDurationMinutes(-Infinity)).toBeNull();
  });
});
