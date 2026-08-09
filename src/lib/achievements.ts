/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkoutLog } from '../types';

export type AchievementCategory = 'milestone' | 'consistency' | 'specialization' | 'progression' | 'mastery';

export type Achievement = {
  id: string;
  title: string;
  category: AchievementCategory;
  description: string;
  badgeIcon: string;
  criteriaText: string;
  unlocked: boolean;
  progressPercent: number; // 0 to 100
  currentStatusText: string;
  isDefaultTitle?: boolean;
};

const FEATURED_TITLE_STORAGE_KEY = 'metreps_selected_featured_title_id';

export function getSelectedFeaturedTitleId(): string | null {
  return localStorage.getItem(FEATURED_TITLE_STORAGE_KEY);
}

export function setSelectedFeaturedTitleId(id: string): void {
  localStorage.setItem(FEATURED_TITLE_STORAGE_KEY, id);
}

/**
 * Calculates volume in kg for a set, respecting unit and bodyweight fallback.
 * Excludes warm-up sets (isWarmup === true) from volume and execution metrics.
 */
function getSetVolumeKg(
  weight: number | null | undefined,
  reps: number | null | undefined,
  modality: string | undefined,
  logUnit: string,
  userBodyweight?: number | null
): number {
  if (!reps || reps <= 0) return 0;
  const w = weight || 0;
  const weightInKg = logUnit === 'lb' ? w * 0.453592 : w;
  const bw = userBodyweight || 75;

  if (modality === 'assisted') {
    const netWeight = Math.max(1, bw - weightInKg);
    return netWeight * reps;
  }
  if (modality === 'bodyweight') {
    return bw * reps;
  }
  if (modality === 'distance' || modality === 'timed') {
    return 0;
  }
  return weightInKg * reps;
}

/**
 * Calculates estimated 1RM using Epley formula: w * (1 + r / 30)
 */
function getE1RM(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

/**
 * Standardize muscle group names
 */
function normalizeMuscleGroup(mg: string): string {
  const clean = (mg || '').trim().toLowerCase();
  if (/delt|shoulder/i.test(clean)) return 'Delts';
  if (/trap/i.test(clean)) return 'Traps';
  if (/bicep/i.test(clean)) return 'Biceps';
  if (/tricep/i.test(clean)) return 'Triceps';
  if (/chest|pec/i.test(clean)) return 'Pecs';
  if (/back|lat|rhomboid/i.test(clean)) return 'Back';
  if (/abs|core|abdominal/i.test(clean)) return 'Abs';
  if (/quad/i.test(clean)) return 'Quads';
  if (/ham|hamstring/i.test(clean)) return 'Hamstrings';
  if (/calf|calves/i.test(clean)) return 'Calves';
  if (/glute/i.test(clean)) return 'Glutes';
  if (/forearm/i.test(clean)) return 'Forearms';
  return 'Other';
}

export function evaluateAchievements(
  logs: WorkoutLog[],
  userBodyweight?: number | null
): Achievement[] {
  // Sort logs chronologically (oldest to newest) for streak/history analysis
  const sortedChronological = [...logs].sort((a, b) => a.date.localeCompare(b.date));
  const totalWorkouts = sortedChronological.length;

  // 1. Total Volume, Sets, Reps, Strict Sets
  let totalVolumeKg = 0;
  let totalStrictRpe9Sets = 0;
  let completeArchivistWorkouts = 0;
  let workoutsWithRpeTracked = 0;

  sortedChronological.forEach(log => {
    let logHasCompleteSets = true;
    let logWorkingSetsCount = 0;
    let logRpeTrackedSetsCount = 0;

    log.exercises.forEach(ex => {
      ex.sets.forEach(s => {
        if (s.isWarmup) return; // Skip warmup sets

        const r = s.reps || 0;
        const w = s.weight || 0;

        if (r > 0 || w > 0) {
          logWorkingSetsCount++;
          const vol = getSetVolumeKg(s.weight, s.reps, ex.modality, log.unit, userBodyweight);
          totalVolumeKg += vol;

          if (s.form === 'strict' && s.rpe && s.rpe <= 9) {
            totalStrictRpe9Sets++;
          }

          if (s.rpe) {
            logRpeTrackedSetsCount++;
          }

          if (s.weight === null || s.weight === undefined || s.reps === null || s.reps === undefined) {
            logHasCompleteSets = false;
          }
        }
      });
    });

    if (logWorkingSetsCount > 0 && logHasCompleteSets) {
      completeArchivistWorkouts++;
    }
    if (logWorkingSetsCount > 0 && logRpeTrackedSetsCount / logWorkingSetsCount >= 0.8) {
      workoutsWithRpeTracked++;
    }
  });

  // 2. PR calculations (Baseline established on 1st exposure)
  const exerciseHistory: Record<
    string,
    { date: string; maxWeight: number; maxRepsAtWeight: Record<number, number>; maxE1RM: number; rpe: number }[]
  > = {};

  let totalPRsSingleSession = 0;
  let maxPRsInOneSession = 0;
  const distinctPRExercises = new Set<string>();
  let hasCasualPRAtLowRPE = false;
  let hasOneMoreRep = false;
  let progressiveOverlordCount = 0;
  let mainCharacterArcUnlocked = false;

  sortedChronological.forEach(log => {
    let sessionPRsCount = 0;

    log.exercises.forEach(ex => {
      const exKey = ex.name.trim().toLowerCase();
      if (!exKey) return;

      if (!exerciseHistory[exKey]) {
        exerciseHistory[exKey] = [];
      }

      let sessionMaxWeight = 0;
      let sessionMaxE1RM = 0;
      let sessionBestRpeAtPR = 10;
      let beatRepAtSameWeight = false;

      ex.sets.forEach(s => {
        if (s.isWarmup) return;
        const w = s.weight || 0;
        const r = s.reps || 0;
        const rpe = s.rpe || 10;

        if (w > 0 && r > 0) {
          const wKg = log.unit === 'lb' ? w * 0.453592 : w;
          const e1rm = getE1RM(wKg, r);

          if (wKg > sessionMaxWeight) sessionMaxWeight = wKg;
          if (e1rm > sessionMaxE1RM) {
            sessionMaxE1RM = e1rm;
            sessionBestRpeAtPR = rpe;
          }

          // Check "One More Rep" at same weight
          const historyForEx = exerciseHistory[exKey];
          if (historyForEx.length > 0) {
            historyForEx.forEach(h => {
              const prevMaxRep = h.maxRepsAtWeight[Math.round(wKg * 10) / 10] || 0;
              if (prevMaxRep > 0 && r > prevMaxRep) {
                beatRepAtSameWeight = true;
              }
            });
          }
        }
      });

      if (sessionMaxE1RM > 0) {
        const historyForEx = exerciseHistory[exKey];
        if (historyForEx.length === 0) {
          // Baseline establishment! Do NOT count as PR.
          const maxRepsAtWeightMap: Record<number, number> = {};
          ex.sets.forEach(s => {
            if (!s.isWarmup && (s.weight || 0) > 0 && (s.reps || 0) > 0) {
              const wKg = log.unit === 'lb' ? s.weight! * 0.453592 : s.weight!;
              const roundedW = Math.round(wKg * 10) / 10;
              maxRepsAtWeightMap[roundedW] = Math.max(maxRepsAtWeightMap[roundedW] || 0, s.reps!);
            }
          });

          historyForEx.push({
            date: log.date,
            maxWeight: sessionMaxWeight,
            maxRepsAtWeight: maxRepsAtWeightMap,
            maxE1RM: sessionMaxE1RM,
            rpe: sessionBestRpeAtPR,
          });
        } else {
          // Compare with all previous history for this exercise
          const prevMaxE1RM = Math.max(...historyForEx.map(h => h.maxE1RM));
          if (sessionMaxE1RM > prevMaxE1RM * 1.005) {
            sessionPRsCount++;
            distinctPRExercises.add(exKey);

            if (sessionBestRpeAtPR <= 8) {
              hasCasualPRAtLowRPE = true;
            }
          }

          if (beatRepAtSameWeight) {
            hasOneMoreRep = true;
          }

          const maxRepsAtWeightMap: Record<number, number> = {};
          ex.sets.forEach(s => {
            if (!s.isWarmup && (s.weight || 0) > 0 && (s.reps || 0) > 0) {
              const wKg = log.unit === 'lb' ? s.weight! * 0.453592 : s.weight!;
              const roundedW = Math.round(wKg * 10) / 10;
              maxRepsAtWeightMap[roundedW] = Math.max(maxRepsAtWeightMap[roundedW] || 0, s.reps!);
            }
          });

          historyForEx.push({
            date: log.date,
            maxWeight: sessionMaxWeight,
            maxRepsAtWeight: maxRepsAtWeightMap,
            maxE1RM: sessionMaxE1RM,
            rpe: sessionBestRpeAtPR,
          });
        }
      }
    });

    if (sessionPRsCount > maxPRsInOneSession) {
      maxPRsInOneSession = sessionPRsCount;
    }
  });

  // Evaluate Progressive Overlord and Main Character Arc
  Object.values(exerciseHistory).forEach(history => {
    let prIncrements = 0;
    let runningMax = 0;

    history.forEach((h, idx) => {
      if (idx === 0) {
        runningMax = h.maxE1RM;
      } else if (h.maxE1RM > runningMax * 1.005) {
        prIncrements++;
        runningMax = h.maxE1RM;
      }
    });

    if (prIncrements >= 3) {
      progressiveOverlordCount++;
    }

    if (history.length >= 5) {
      const firstDate = new Date(history[0].date).getTime();
      const lastDate = new Date(history[history.length - 1].date).getTime();
      const daysSpan = (lastDate - firstDate) / (1000 * 60 * 60 * 24);

      const baselineE1RM = history[0].maxE1RM;
      const finalE1RM = Math.max(...history.map(h => h.maxE1RM));

      if (daysSpan >= 56 && baselineE1RM > 0 && finalE1RM >= baselineE1RM * 1.05) {
        mainCharacterArcUnlocked = true;
      }
    }
  });

  // 3. Sliding 10-Workout Windows for Muscle Emphasis (Dorito Mode, Boulder Shoulders, Sleeve Stretcher, Quadzilla, Chest Day Fever)
  let maxBackSetsWindow = 0;
  let maxDeltSetsWindow = 0;
  let maxQuadSetsWindow = 0;
  let maxPecSetsWindow = 0;
  let maxArmSetsWindow = { biceps: 0, triceps: 0 };

  for (let i = 0; i <= sortedChronological.length - 1; i++) {
    const windowLogs = sortedChronological.slice(Math.max(0, i - 9), i + 1);

    const windowMuscleSets: Record<string, number> = {
      Back: 0, Delts: 0, Quads: 0, Pecs: 0, Biceps: 0, Triceps: 0
    };
    const windowMuscleSessions: Record<string, Set<string>> = {
      Back: new Set(), Delts: new Set(), Quads: new Set(), Pecs: new Set()
    };

    windowLogs.forEach(log => {
      log.exercises.forEach(ex => {
        const mg = normalizeMuscleGroup(ex.muscleGroup);
        const validSets = ex.sets.filter(s => !s.isWarmup && ((s.reps || 0) > 0 || (s.weight || 0) > 0)).length;

        if (validSets > 0 && windowMuscleSets[mg] !== undefined) {
          windowMuscleSets[mg] += validSets;
          if (windowMuscleSessions[mg]) windowMuscleSessions[mg].add(log.id);
        }
      });
    });

    if (windowMuscleSets.Back > maxBackSetsWindow) maxBackSetsWindow = windowMuscleSets.Back;
    if (windowMuscleSets.Delts > maxDeltSetsWindow) maxDeltSetsWindow = windowMuscleSets.Delts;
    if (windowMuscleSets.Quads > maxQuadSetsWindow) maxQuadSetsWindow = windowMuscleSets.Quads;
    if (windowMuscleSets.Pecs > maxPecSetsWindow) maxPecSetsWindow = windowMuscleSets.Pecs;

    if (windowMuscleSets.Biceps > maxArmSetsWindow.biceps || windowMuscleSets.Triceps > maxArmSetsWindow.triceps) {
      if (windowMuscleSets.Biceps + windowMuscleSets.Triceps > maxArmSetsWindow.biceps + maxArmSetsWindow.triceps) {
        maxArmSetsWindow = { biceps: windowMuscleSets.Biceps, triceps: windowMuscleSets.Triceps };
      }
    }
  }

  // 4. Streak & Calendar Calculations (Iron Calendar, Perfect Attendance, Respawned)
  const distinctWeeks = new Set<string>();
  sortedChronological.forEach(l => {
    const d = new Date(l.date);
    if (!isNaN(d.getTime())) {
      const year = d.getFullYear();
      // Simple ISO week number approx
      const firstDay = new Date(year, 0, 1);
      const weekNum = Math.ceil((((d.getTime() - firstDay.getTime()) / 86400000) + firstDay.getDay() + 1) / 7);
      distinctWeeks.add(`${year}-W${weekNum}`);
    }
  });

  // Respawned check: gap >= 14 days then 3 workouts in 10 days
  let respawnedUnlocked = false;
  for (let i = 1; i < sortedChronological.length; i++) {
    const prevDate = new Date(sortedChronological[i - 1].date).getTime();
    const currDate = new Date(sortedChronological[i].date).getTime();
    const gapDays = (currDate - prevDate) / (1000 * 60 * 60 * 24);

    if (gapDays >= 14) {
      // Check next workouts
      const returnDate = currDate;
      const subsequentLogsIn10Days = sortedChronological.slice(i).filter(l => {
        const d = new Date(l.date).getTime();
        return (d - returnDate) / (1000 * 60 * 60 * 24) <= 10;
      });

      if (subsequentLogsIn10Days.length >= 3) {
        respawnedUnlocked = true;
        break;
      }
    }
  }

  // Helper to format volume
  const formatVol = (kg: number) => {
    if (kg >= 1000000) return `${(kg / 1000000).toFixed(2)}M kg`;
    if (kg >= 1000) return `${Math.round(kg / 1000)}k kg`;
    return `${Math.round(kg)} kg`;
  };

  const list: Achievement[] = [
    // --- WORKOUT QUANTITY MILESTONES ---
    {
      id: 'iron-initiate',
      title: 'IRON INITIATE',
      category: 'milestone',
      description: 'Logged your first training session in the journal.',
      badgeIcon: 'dumbbell',
      criteriaText: 'Complete 1 workout',
      unlocked: totalWorkouts >= 1,
      progressPercent: Math.min(100, Math.round((totalWorkouts / 1) * 100)),
      currentStatusText: totalWorkouts >= 1 ? 'Unlocked!' : `${totalWorkouts} / 1 workout`,
      isDefaultTitle: true,
    },
    {
      id: 'dedicated-lifter',
      title: 'DEDICATED LIFTER',
      category: 'milestone',
      description: 'Built momentum by logging 10 total training sessions.',
      badgeIcon: 'flame',
      criteriaText: 'Complete 10 workouts',
      unlocked: totalWorkouts >= 10,
      progressPercent: Math.min(100, Math.round((totalWorkouts / 10) * 100)),
      currentStatusText: totalWorkouts >= 10 ? 'Unlocked!' : `${totalWorkouts} / 10 workouts`,
    },
    {
      id: 'swoldier',
      title: 'SWOLDIER',
      category: 'milestone',
      description: 'Solidified your habit with 25 logged workout sessions.',
      badgeIcon: 'shield',
      criteriaText: 'Complete 25 workouts',
      unlocked: totalWorkouts >= 25,
      progressPercent: Math.min(100, Math.round((totalWorkouts / 25) * 100)),
      currentStatusText: totalWorkouts >= 25 ? 'Unlocked!' : `${totalWorkouts} / 25 workouts`,
    },
    {
      id: 'veteran-lifter',
      title: 'VETERAN LIFTER',
      category: 'milestone',
      description: 'A proven practitioner with 50 logged workouts under your belt.',
      badgeIcon: 'award',
      criteriaText: 'Complete 50 workouts',
      unlocked: totalWorkouts >= 50,
      progressPercent: Math.min(100, Math.round((totalWorkouts / 50) * 100)),
      currentStatusText: totalWorkouts >= 50 ? 'Unlocked!' : `${totalWorkouts} / 50 workouts`,
    },
    {
      id: 'warlord-of-iron',
      title: 'WARLORD OF IRON',
      category: 'milestone',
      description: 'Ascended to supreme mastery with 100+ logged workouts.',
      badgeIcon: 'crown',
      criteriaText: 'Complete 100 workouts',
      unlocked: totalWorkouts >= 100,
      progressPercent: Math.min(100, Math.round((totalWorkouts / 100) * 100)),
      currentStatusText: totalWorkouts >= 100 ? 'Unlocked!' : `${totalWorkouts} / 100 workouts`,
    },

    // --- CUMULATIVE VOLUME TONNAGE ---
    {
      id: 'tonnage-titan',
      title: 'TONNAGE TITAN',
      category: 'milestone',
      description: 'Moved a colossal 100,000 kg (100 Metric Tons) of volume.',
      badgeIcon: 'trophy',
      criteriaText: '100,000 kg total volume',
      unlocked: totalVolumeKg >= 100000,
      progressPercent: Math.min(100, Math.round((totalVolumeKg / 100000) * 100)),
      currentStatusText: totalVolumeKg >= 100000 ? 'Unlocked!' : `${formatVol(totalVolumeKg)} / 100k kg`,
    },
    {
      id: 'half-a-meg',
      title: 'HALF-A-MEG',
      category: 'milestone',
      description: 'Shifted half a million kilograms (500,000 kg) across your lifespans.',
      badgeIcon: 'trophy',
      criteriaText: '500,000 kg total volume',
      unlocked: totalVolumeKg >= 500000,
      progressPercent: Math.min(100, Math.round((totalVolumeKg / 500000) * 100)),
      currentStatusText: totalVolumeKg >= 500000 ? 'Unlocked!' : `${formatVol(totalVolumeKg)} / 500k kg`,
    },
    {
      id: 'million-kg-club',
      title: 'MILLION KG CLUB',
      category: 'milestone',
      description: 'Joined the elite tier by moving 1,000,000+ kg of total weight.',
      badgeIcon: 'sparkles',
      criteriaText: '1,000,000 kg total volume',
      unlocked: totalVolumeKg >= 1000000,
      progressPercent: Math.min(100, Math.round((totalVolumeKg / 1000000) * 100)),
      currentStatusText: totalVolumeKg >= 1000000 ? 'Unlocked!' : `${formatVol(totalVolumeKg)} / 1M kg`,
    },

    // --- CONSISTENCY & RECOVERY ---
    {
      id: 'iron-calendar',
      title: 'IRON CALENDAR',
      category: 'consistency',
      description: 'Showed unrelenting commitment across 12 distinct calendar weeks.',
      badgeIcon: 'zap',
      criteriaText: 'Log workouts in 12 calendar weeks',
      unlocked: distinctWeeks.size >= 12,
      progressPercent: Math.min(100, Math.round((distinctWeeks.size / 12) * 100)),
      currentStatusText: distinctWeeks.size >= 12 ? 'Unlocked!' : `${distinctWeeks.size} / 12 weeks`,
    },
    {
      id: 'respawned',
      title: 'RESPAWNED',
      category: 'consistency',
      description: 'Returned after 14+ days away and immediately knocked out 3 workouts in 10 days.',
      badgeIcon: 'sparkles',
      criteriaText: 'Return after 14+ days & complete 3 workouts in 10 days',
      unlocked: respawnedUnlocked,
      progressPercent: respawnedUnlocked ? 100 : 0,
      currentStatusText: respawnedUnlocked ? 'Unlocked!' : 'Awaiting comeback streak',
    },

    // --- MUSCLE SPECIALIZATION & MEMES ---
    {
      id: 'dorito-mode',
      title: 'DORITO MODE',
      category: 'specialization',
      description: 'Forged the ultimate V-Taper back with 24+ working Back sets across a 10-workout window.',
      badgeIcon: 'swords',
      criteriaText: '24+ Back sets in a 10-workout window',
      unlocked: maxBackSetsWindow >= 24,
      progressPercent: Math.min(100, Math.round((maxBackSetsWindow / 24) * 100)),
      currentStatusText: maxBackSetsWindow >= 24 ? 'Unlocked!' : `${maxBackSetsWindow} / 24 Back sets`,
    },
    {
      id: 'boulder-shoulders',
      title: 'BOULDER SHOULDERS',
      category: 'specialization',
      description: 'Built 3D cannonball delts with 24+ working Delt sets in a 10-workout window.',
      badgeIcon: 'target',
      criteriaText: '24+ Delt sets in a 10-workout window',
      unlocked: maxDeltSetsWindow >= 24,
      progressPercent: Math.min(100, Math.round((maxDeltSetsWindow / 24) * 100)),
      currentStatusText: maxDeltSetsWindow >= 24 ? 'Unlocked!' : `${maxDeltSetsWindow} / 24 Delt sets`,
    },
    {
      id: 'sleeve-stretcher',
      title: 'SLEEVE STRETCHER',
      category: 'specialization',
      description: 'Accumulated 20+ Biceps sets and 20+ Triceps sets in a 10-workout window.',
      badgeIcon: 'flame',
      criteriaText: '20 Biceps & 20 Triceps sets in 10 workouts',
      unlocked: maxArmSetsWindow.biceps >= 20 && maxArmSetsWindow.triceps >= 20,
      progressPercent: Math.min(
        100,
        Math.round(((Math.min(20, maxArmSetsWindow.biceps) + Math.min(20, maxArmSetsWindow.triceps)) / 40) * 100)
      ),
      currentStatusText:
        maxArmSetsWindow.biceps >= 20 && maxArmSetsWindow.triceps >= 20
          ? 'Unlocked!'
          : `Bi: ${maxArmSetsWindow.biceps}/20 | Tri: ${maxArmSetsWindow.triceps}/20`,
    },
    {
      id: 'quadzilla',
      title: 'QUADZILLA',
      category: 'specialization',
      description: 'Never skipped leg day! Built tree-trunk quads with 24+ Quad sets in 10 workouts.',
      badgeIcon: 'swords',
      criteriaText: '24+ Quad sets in a 10-workout window',
      unlocked: maxQuadSetsWindow >= 24,
      progressPercent: Math.min(100, Math.round((maxQuadSetsWindow / 24) * 100)),
      currentStatusText: maxQuadSetsWindow >= 24 ? 'Unlocked!' : `${maxQuadSetsWindow} / 24 Quad sets`,
    },
    {
      id: 'chest-day-fever',
      title: 'CHEST DAY FEVER',
      category: 'specialization',
      description: 'Pushed maximum upper body volume with 24+ Pec sets in a 10-workout window.',
      badgeIcon: 'target',
      criteriaText: '24+ Pec sets in a 10-workout window',
      unlocked: maxPecSetsWindow >= 24,
      progressPercent: Math.min(100, Math.round((maxPecSetsWindow / 24) * 100)),
      currentStatusText: maxPecSetsWindow >= 24 ? 'Unlocked!' : `${maxPecSetsWindow} / 24 Pec sets`,
    },

    // --- PROGRESSION & PR ACHIEVEMENTS ---
    {
      id: 'progressive-overlord',
      title: 'PROGRESSIVE OVERLORD',
      category: 'progression',
      description: 'Set new estimated 1RM personal records across 3 separate sessions on an exercise.',
      badgeIcon: 'zap',
      criteriaText: '3 PR progressions on same exercise',
      unlocked: progressiveOverlordCount >= 1,
      progressPercent: progressiveOverlordCount >= 1 ? 100 : 33,
      currentStatusText: progressiveOverlordCount >= 1 ? 'Unlocked!' : 'Awaiting 3 PR steps',
    },
    {
      id: 'main-character-arc',
      title: 'MAIN CHARACTER ARC',
      category: 'progression',
      description: 'Improved estimated 1RM on an exercise by 5%+ over 8+ weeks across 5+ exposures.',
      badgeIcon: 'crown',
      criteriaText: '5%+ gain on exercise over 8+ weeks',
      unlocked: mainCharacterArcUnlocked,
      progressPercent: mainCharacterArcUnlocked ? 100 : 0,
      currentStatusText: mainCharacterArcUnlocked ? 'Unlocked!' : 'Requires 8-week 5% gain',
    },
    {
      id: 'pr-storm',
      title: 'PR STORM',
      category: 'progression',
      description: 'Hit post-baseline personal records on 3 or more different exercises in a single workout.',
      badgeIcon: 'sparkles',
      criteriaText: '3 PRs in a single workout session',
      unlocked: maxPRsInOneSession >= 3,
      progressPercent: Math.min(100, Math.round((maxPRsInOneSession / 3) * 100)),
      currentStatusText: maxPRsInOneSession >= 3 ? 'Unlocked!' : `${maxPRsInOneSession} / 3 PRs in 1 session`,
    },
    {
      id: 'plate-collector',
      title: 'PLATE COLLECTOR',
      category: 'progression',
      description: 'Earned post-baseline PRs on 10 or more different exercises in your journal.',
      badgeIcon: 'award',
      criteriaText: 'PRs on 10 distinct exercises',
      unlocked: distinctPRExercises.size >= 10,
      progressPercent: Math.min(100, Math.round((distinctPRExercises.size / 10) * 100)),
      currentStatusText: distinctPRExercises.size >= 10 ? 'Unlocked!' : `${distinctPRExercises.size} / 10 exercises`,
    },
    {
      id: 'casual-pr',
      title: 'CASUAL PR',
      category: 'progression',
      description: 'Shattered a personal record with absolute composure at RPE 8 or lower.',
      badgeIcon: 'star',
      criteriaText: 'Set a PR at RPE <= 8',
      unlocked: hasCasualPRAtLowRPE,
      progressPercent: hasCasualPRAtLowRPE ? 100 : 0,
      currentStatusText: hasCasualPRAtLowRPE ? 'Unlocked!' : 'Set PR with RPE <= 8',
    },
    {
      id: 'one-more-rep',
      title: 'ONE MORE REP',
      category: 'progression',
      description: 'Beat your previous rep record on an exercise using the exact same weight.',
      badgeIcon: 'zap',
      criteriaText: 'Beat rep best at same weight',
      unlocked: hasOneMoreRep,
      progressPercent: hasOneMoreRep ? 100 : 0,
      currentStatusText: hasOneMoreRep ? 'Unlocked!' : 'Beat reps at same load',
    },

    // --- EXECUTION & FORM QUALITY (SAFETY FIRST) ---
    {
      id: 'form-over-ego',
      title: 'FORM OVER EGO',
      category: 'mastery',
      description: 'Logged 50+ working sets with strict form rating and safe RPE <= 9.',
      badgeIcon: 'shield',
      criteriaText: '50 strict form sets at RPE <= 9',
      unlocked: totalStrictRpe9Sets >= 50,
      progressPercent: Math.min(100, Math.round((totalStrictRpe9Sets / 50) * 100)),
      currentStatusText: totalStrictRpe9Sets >= 50 ? 'Unlocked!' : `${totalStrictRpe9Sets} / 50 strict sets`,
    },
    {
      id: 'rpe-whisperer',
      title: 'RPE WHISPERER',
      category: 'mastery',
      description: 'Dialed in intensity by completing 5 workouts with 80%+ sets tracked for RPE.',
      badgeIcon: 'target',
      criteriaText: '5 workouts with 80%+ RPE data logged',
      unlocked: workoutsWithRpeTracked >= 5,
      progressPercent: Math.min(100, Math.round((workoutsWithRpeTracked / 5) * 100)),
      currentStatusText: workoutsWithRpeTracked >= 5 ? 'Unlocked!' : `${workoutsWithRpeTracked} / 5 workouts`,
    },
    {
      id: 'the-archivist',
      title: 'THE ARCHIVIST',
      category: 'mastery',
      description: 'Recorded complete load & rep data across 10 workouts without missing entries.',
      badgeIcon: 'star',
      criteriaText: '10 fully logged workout entries',
      unlocked: completeArchivistWorkouts >= 10,
      progressPercent: Math.min(100, Math.round((completeArchivistWorkouts / 10) * 100)),
      currentStatusText: completeArchivistWorkouts >= 10 ? 'Unlocked!' : `${completeArchivistWorkouts} / 10 workouts`,
    },
  ];

  return list;
}
