/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { storage } from './storage';

export const CURRENT_ONBOARDING_VERSION = 1;
export const ONBOARDING_STORAGE_KEY = 'metreps_onboarding_version';

export type OnboardingUserStatus = 'blank' | 'established' | 'unavailable';

/**
 * Pure classifier that evaluates stored application state without mutating storage.
 *
 * Returns:
 * - 'blank': Genuinely new user with no meaningful user-authored data or historical records.
 * - 'established': User has existing logs, user programs, active drafts, bodyweight entries, custom exercises, or customizations.
 * - 'unavailable': Storage is inaccessible, throws errors, or cannot be verified safely (fails closed).
 *
 * Note: Prebuilt static templates, default settings, default theme, and default unit preferences
 * do NOT classify a user as established.
 */
export function classifyUserStatus(): OnboardingUserStatus {
  try {
    if (typeof localStorage === 'undefined' || localStorage === null) {
      return 'unavailable';
    }

    // 1. Saved workout logs
    const logsRaw = localStorage.getItem('workoutLogs');
    if (logsRaw) {
      const logs = JSON.parse(logsRaw);
      if (Array.isArray(logs) && logs.length > 0) return 'established';
    }

    // 2. Saved user programs in programList
    const progListRaw = localStorage.getItem('programList');
    if (progListRaw) {
      const progs = JSON.parse(progListRaw);
      if (Array.isArray(progs) && progs.length > 0) return 'established';
    }

    // 3. Active workout draft
    const draftRaw = localStorage.getItem('metreps_workout_draft');
    if (draftRaw) {
      const draft = JSON.parse(draftRaw);
      if (draft && typeof draft === 'object' && Object.keys(draft).length > 0) {
        return 'established';
      }
    }

    // 4. Saved bodyweight
    const bw = localStorage.getItem('userBodyweight');
    if (bw !== null && bw !== undefined && bw.trim() !== '') {
      const numBw = Number(bw);
      if (!isNaN(numBw) && numBw > 0) return 'established';
    }

    // 5. Custom program ID (not a prebuilt template)
    const currentProgId = localStorage.getItem('currentProgramId');
    if (
      currentProgId &&
      typeof currentProgId === 'string' &&
      currentProgId.trim() !== '' &&
      !currentProgId.startsWith('prog-tpl-')
    ) {
      return 'established';
    }

    // 6. Custom exercises
    const customExRaw = localStorage.getItem('metreps_custom_exercises');
    if (customExRaw) {
      const customEx = JSON.parse(customExRaw);
      if (Array.isArray(customEx) && customEx.length > 0) return 'established';
    }

    // 7. Hidden defaults (library customizations)
    const hiddenDefaultsRaw = localStorage.getItem('metreps_hidden_defaults');
    if (hiddenDefaultsRaw) {
      const hiddenDefaults = JSON.parse(hiddenDefaultsRaw);
      if (Array.isArray(hiddenDefaults) && hiddenDefaults.length > 0) return 'established';
    }

    // 8. Checked/selected exercises (exercise customizations)
    const checkedExRaw = localStorage.getItem('metreps_checked_exercises');
    if (checkedExRaw) {
      const checkedEx = JSON.parse(checkedExRaw);
      if (Array.isArray(checkedEx) && checkedEx.length > 0) return 'established';
    }

    return 'blank';
  } catch {
    return 'unavailable';
  }
}

/**
 * Pure predicate to determine if a user is classified as established.
 */
export function isEstablishedUser(): boolean {
  return classifyUserStatus() === 'established';
}

/**
 * Deliberately performs a silent migration write recording onboarding version 1
 * for established users who have existing data.
 */
export function migrateEstablishedUserOnboarding(): void {
  try {
    storage.setOnboardingVersion(CURRENT_ONBOARDING_VERSION);
  } catch (e) {
    console.error('Failed to migrate established user onboarding version:', e);
  }
}

/**
 * Pure predicate to determine if onboarding should auto-open on launch.
 * - Does NOT perform side-effect storage writes.
 * - Returns true ONLY for 'blank' users who have no stored version or lower stored version.
 * - Returns false for 'established' and 'unavailable' (fail-closed).
 */
export function shouldAutoOpenOnboarding(): boolean {
  try {
    const currentVersion = storage.getOnboardingVersion();
    if (currentVersion !== null && currentVersion >= CURRENT_ONBOARDING_VERSION) {
      return false;
    }

    const status = classifyUserStatus();
    if (status === 'blank') {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Startup helper that checks the onboarding state and performs silent migration
 * if the user is established.
 */
export function initializeOnboardingStartup(): boolean {
  try {
    const currentVersion = storage.getOnboardingVersion();
    if (currentVersion !== null && currentVersion >= CURRENT_ONBOARDING_VERSION) {
      return false;
    }

    const status = classifyUserStatus();
    if (status === 'established') {
      migrateEstablishedUserOnboarding();
      return false;
    }
    if (status === 'blank') {
      return true;
    }
    // 'unavailable' fails closed
    return false;
  } catch {
    return false;
  }
}

/**
 * Marks onboarding as completed for the current version.
 */
export function markOnboardingCompleted(version: number = CURRENT_ONBOARDING_VERSION): void {
  storage.setOnboardingVersion(version);
}
