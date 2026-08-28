/**
 * Resolves a workout duration in minutes according to MetReps domain rules:
 * - A valid, finite number greater than 0: returns the recorded value unchanged.
 * - An absent or `undefined` duration: returns 60 minutes (legacy fallback).
 * - Explicit `null`, 0, negative, `NaN` or infinite values: returns `null`.
 *
 * Pure function with no storage access, no React dependencies, and no side effects.
 */
export function resolveWorkoutDurationMinutes(durationMinutes?: number | null): number | null {
  if (durationMinutes === undefined) {
    return 60;
  }
  if (typeof durationMinutes === 'number' && Number.isFinite(durationMinutes) && durationMinutes > 0) {
    return durationMinutes;
  }
  return null;
}
