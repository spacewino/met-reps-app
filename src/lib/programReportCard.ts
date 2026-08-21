/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BodyweightSnapshot, ExerciseEntry, Program, SetEntry, WeightUnit, WorkoutLog, mapHydrationToLiters, mapLitersToHydration } from '../types';
import { resolveSetEffectiveLoad } from './effectiveLoad';
import { convertWeightUnit } from './assistedLoadMath';

export interface ExerciseStat {
  name: string;
  baselineE1RM: number;
  latestE1RM: number;
  maxE1RM: number;
  growthPercent: number;
  muscleGroup: string;
}

export interface ProgramReportCard {
  score: number;
  grade: string;
  gradeSub: string;
  gradeColor: string;
  adherenceRate: number;
  completedCount: number;
  totalPlannedDays: number;
  totalPRsHit: number;
  strongestMuscle: string;
  exerciseStats: ExerciseStat[];
  feedbacks: string[];
  avgActualGrowth: number;
  avgSleep: number;
  avgSoreness: number;
  avgQuality: number;
  avgHydration: number;
}

export interface ReportChartPoint {
  week: string;
  actual: number | null;
  projected: number;
}

export interface ReportChartData {
  unit: string;
  points: ReportChartPoint[];
}

/**
 * Calculates estimated 1RM in canonical kilograms for an eligible set.
 * Uses the canonical Epley formula:
 *   e1RM = effectiveLoadKg * (1 + reps / 30) for reps > 1
 *   e1RM = effectiveLoadKg for reps === 1
 */
function calculateSetE1RMKg(
  set: SetEntry,
  modality: ExerciseEntry['modality'],
  logUnit: WeightUnit,
  snapshot?: BodyweightSnapshot | null
): number | null {
  if (set.isSkipped === true || set.isWarmup === true || set.isCompleted === false) {
    return null;
  }
  const reps = set.reps;
  if (reps === null || reps === undefined || !Number.isInteger(reps) || reps <= 0) {
    return null;
  }

  const loadRes = resolveSetEffectiveLoad(set.weight, modality, logUnit, snapshot);
  if (loadRes.status !== 'valid' || loadRes.effectiveLoadKg === null || loadRes.effectiveLoadKg <= 0) {
    return null;
  }

  const effectiveLoadKg = loadRes.effectiveLoadKg;
  return reps === 1 ? effectiveLoadKg : effectiveLoadKg * (1 + reps / 30);
}

/**
 * Calculates a complete Program Report Card for a specific program and historical logs.
 * All load comparisons and progression formulas use canonical kilograms via resolveSetEffectiveLoad.
 */
export function getProgramReportCard(
  program: Program,
  logs: WorkoutLog[],
  displayUnit: WeightUnit = 'kg'
): ProgramReportCard {
  const progLogs = logs.filter(l => l.programId === program.id);

  // Chronological sort by week then day
  const sortedLogs = [...progLogs].sort((a, b) => {
    const wa = Number(a.week) || 1;
    const wb = Number(b.week) || 1;
    if (wa !== wb) return wa - wb;
    const da = Number(a.day) || 1;
    const db = Number(b.day) || 1;
    return da - db;
  });

  const totalWeeks = program.programDuration === '∞' ? 12 : Number(program.programDuration) || 12;
  const totalPlannedDays = totalWeeks * program.daysPerWeek;

  const completedCombos = new Set<string>();
  progLogs.forEach(l => {
    if (l.week && l.day) {
      completedCombos.add(`${l.week}-${l.day}`);
    }
  });
  const completedCount = completedCombos.size;
  const adherenceRate = Math.min(100, Math.round((completedCount / (totalPlannedDays || 1)) * 100));

  // Collect distinct programmed exercises
  const programmedExercises: { name: string; muscleGroup: string }[] = [];
  const seenNames = new Set<string>();
  if (program.exercisesByDay) {
    Object.keys(program.exercisesByDay).forEach(key => {
      const d = Number(key);
      if (d <= program.daysPerWeek) {
        const exercises = program.exercisesByDay[d] || [];
        exercises.forEach(ex => {
          if (ex && ex.name && !seenNames.has(ex.name.trim().toLowerCase())) {
            seenNames.add(ex.name.trim().toLowerCase());
            programmedExercises.push({ name: ex.name, muscleGroup: ex.muscleGroup });
          }
        });
      }
    });
  }

  const exerciseStats: ExerciseStat[] = [];
  const muscleImprovements: Record<string, number[]> = {};

  programmedExercises.forEach(({ name: exName, muscleGroup }) => {
    // Find all sessions in chronological order with valid calculable sets for this exercise
    const sessionMaxesKg: number[] = [];

    sortedLogs.forEach(log => {
      const matchedEx = log.exercises.find(
        e => !e.isSkipped && e.name.trim().toLowerCase() === exName.trim().toLowerCase()
      );
      if (!matchedEx) return;

      const validE1RMsKg: number[] = [];
      matchedEx.sets.forEach(s => {
        const e1rmKg = calculateSetE1RMKg(s, matchedEx.modality, log.unit, log.bodyweightSnapshot);
        if (e1rmKg !== null && e1rmKg > 0) {
          validE1RMsKg.push(e1rmKg);
        }
      });

      if (validE1RMsKg.length > 0) {
        sessionMaxesKg.push(Math.max(...validE1RMsKg));
      }
    });

    if (sessionMaxesKg.length === 0) return;

    const baselineE1RMKg = sessionMaxesKg[0];
    if (baselineE1RMKg <= 0) return;

    const latestE1RMKg = sessionMaxesKg[sessionMaxesKg.length - 1];
    const maxE1RMKg = Math.max(...sessionMaxesKg);
    const growthPercent = ((latestE1RMKg - baselineE1RMKg) / baselineE1RMKg) * 100;

    const baselineDisplay = displayUnit === 'lb' ? convertWeightUnit(baselineE1RMKg, 'kg', 'lb') : baselineE1RMKg;
    const latestDisplay = displayUnit === 'lb' ? convertWeightUnit(latestE1RMKg, 'kg', 'lb') : latestE1RMKg;
    const maxDisplay = displayUnit === 'lb' ? convertWeightUnit(maxE1RMKg, 'kg', 'lb') : maxE1RMKg;

    exerciseStats.push({
      name: exName,
      baselineE1RM: Math.round(baselineDisplay * 10) / 10,
      latestE1RM: Math.round(latestDisplay * 10) / 10,
      maxE1RM: Math.round(maxDisplay * 10) / 10,
      growthPercent,
      muscleGroup,
    });

    if (muscleGroup) {
      if (!muscleImprovements[muscleGroup]) {
        muscleImprovements[muscleGroup] = [];
      }
      muscleImprovements[muscleGroup].push(growthPercent);
    }
  });

  // Calculate Strongest Adaptor
  let strongestMuscle = 'N/A';
  let bestMuscleGrowth = -999;
  Object.entries(muscleImprovements).forEach(([muscle, growths]) => {
    const avgGrowth = growths.reduce((a, b) => a + b, 0) / growths.length;
    if (avgGrowth > bestMuscleGrowth) {
      bestMuscleGrowth = avgGrowth;
      strongestMuscle = muscle;
    }
  });
  if (strongestMuscle !== 'N/A' && bestMuscleGrowth > 0) {
    strongestMuscle = `${strongestMuscle} (+${bestMuscleGrowth.toFixed(1)}%)`;
  } else if (strongestMuscle !== 'N/A') {
    strongestMuscle = `${strongestMuscle} (0.0%)`;
  }

  // Calculate Personal Records Hit during program
  let totalPRsHit = 0;
  const runningBestKg: Record<string, number> = {};

  sortedLogs.forEach(log => {
    log.exercises.forEach(ex => {
      if (ex.isSkipped) return;
      const isProgrammed = exerciseStats.some(
        es => es.name.trim().toLowerCase() === ex.name.trim().toLowerCase()
      );
      if (!isProgrammed) return;

      const validE1RMsKg: number[] = [];
      ex.sets.forEach(s => {
        const e1rmKg = calculateSetE1RMKg(s, ex.modality, log.unit, log.bodyweightSnapshot);
        if (e1rmKg !== null && e1rmKg > 0) {
          validE1RMsKg.push(e1rmKg);
        }
      });

      if (validE1RMsKg.length === 0) return;
      const sessionMaxKg = Math.max(...validE1RMsKg);

      if (sessionMaxKg > 0) {
        const key = ex.name.trim().toLowerCase();
        const prevBest = runningBestKg[key] || 0;
        if (prevBest > 0 && sessionMaxKg > prevBest * 1.005) {
          totalPRsHit++;
        }
        if (sessionMaxKg > prevBest) {
          runningBestKg[key] = sessionMaxKg;
        }
      }
    });
  });

  // Scoring and grade calculation
  const targetGrowthRate = program.objective === 'Strength' ? 0.005 : (program.objective === 'Hypertrophy' ? 0.004 : 0.002);
  const targetTotalGrowth = targetGrowthRate * (totalWeeks - 1) * 100;

  let avgActualGrowth = 0;
  if (exerciseStats.length > 0) {
    avgActualGrowth = exerciseStats.reduce((a, b) => a + b.growthPercent, 0) / exerciseStats.length;
  }

  // Recovery averages
  let totalSleep = 0;
  let totalSoreness = 0;
  let totalQuality = 0;
  let totalHydration = 0;
  let sleepCount = 0;
  let sorenessCount = 0;
  let qualityCount = 0;
  let hydrationCount = 0;
  let deficitCount = 0;
  let surplusCount = 0;
  let maintenanceCount = 0;

  progLogs.forEach(l => {
    if (l.recovery) {
      if (l.recovery.sleepHours !== undefined && l.recovery.sleepHours !== null) {
        totalSleep += l.recovery.sleepHours;
        sleepCount++;
      }
      if (l.recovery.soreness !== undefined && l.recovery.soreness !== null) {
        totalSoreness += l.recovery.soreness;
        sorenessCount++;
      }
      if (l.recovery.motivation !== undefined && l.recovery.motivation !== null) {
        totalQuality += l.recovery.motivation;
        qualityCount++;
      }
      if (l.recovery.hydrationLevel) {
        totalHydration += mapHydrationToLiters(l.recovery.hydrationLevel);
        hydrationCount++;
      } else if (l.recovery.hydrationLiters !== undefined && l.recovery.hydrationLiters !== null) {
        totalHydration += l.recovery.hydrationLiters;
        hydrationCount++;
      }
      if (l.recovery.nutritionCalories !== undefined && l.recovery.nutritionCalories !== null) {
        const c = l.recovery.nutritionCalories;
        if (c < 1800) deficitCount++;
        else if (c > 2700) surplusCount++;
        else maintenanceCount++;
      }
    }
  });

  const avgSleep = sleepCount > 0 ? totalSleep / sleepCount : 7.0;
  const avgSoreness = sorenessCount > 0 ? totalSoreness / sorenessCount : 3.0;
  const avgQuality = qualityCount > 0 ? totalQuality / qualityCount : 7.0;
  const avgHydration = hydrationCount > 0 ? totalHydration / hydrationCount : 2.0;

  const adherencePoints = adherenceRate * 0.5;

  let progressionPoints = 15;
  if (targetTotalGrowth > 0) {
    const growthRatio = avgActualGrowth / Math.max(1, targetTotalGrowth);
    if (growthRatio >= 1.2) progressionPoints = 30;
    else if (growthRatio >= 1.0) progressionPoints = 27;
    else if (growthRatio >= 0.5) progressionPoints = 22;
    else if (growthRatio > 0) progressionPoints = 18;
    else progressionPoints = 10;
  } else {
    progressionPoints = avgActualGrowth > 0 ? 25 : 15;
  }

  let recoveryPoints = 0;
  if (avgSleep >= 7.5) recoveryPoints += 7;
  else if (avgSleep >= 7.0) recoveryPoints += 5;
  else recoveryPoints += 2;

  if (avgSoreness <= 4.0) recoveryPoints += 7;
  else if (avgSoreness <= 6.0) recoveryPoints += 5;
  else recoveryPoints += 2;

  if (avgQuality >= 7.5) recoveryPoints += 6;
  else if (avgQuality >= 6.0) recoveryPoints += 4;
  else recoveryPoints += 1;

  const rawScore = adherencePoints + progressionPoints + recoveryPoints;
  const score = Math.max(10, Math.min(100, Math.round(rawScore)));

  let grade = 'C';
  let gradeSub = 'Baseline Achieved';
  let gradeColor = 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10';

  if (score >= 95) {
    grade = 'A+';
    gradeSub = 'Masterful Adaptation';
    gradeColor = 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10';
  } else if (score >= 90) {
    grade = 'A';
    gradeSub = 'Outstanding Growth';
    gradeColor = 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10';
  } else if (score >= 85) {
    grade = 'B+';
    gradeSub = 'Superb Recovery';
    gradeColor = 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10';
  } else if (score >= 80) {
    grade = 'B';
    gradeSub = 'Solid Consistency';
    gradeColor = 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10';
  } else if (score >= 75) {
    grade = 'C+';
    gradeSub = 'Moderate Adapt';
    gradeColor = 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10';
  } else if (score >= 70) {
    grade = 'C';
    gradeSub = 'Baseline Achieved';
    gradeColor = 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10';
  } else {
    grade = 'D';
    gradeSub = 'Needs Recovery Focus';
    gradeColor = 'text-rose-400 border-rose-500/30 bg-rose-500/10';
  }

  // Formulate feedbacks
  const feedbacks: string[] = [];

  // Sleep feedback
  if (avgSleep < 7.0) {
    feedbacks.push(
      `Your average sleep was low at **${avgSleep.toFixed(1)} hrs**. Muscle protein synthesis and central nervous system replenishment peak during deep sleep stages. Prioritize 7.5+ hrs to prevent performance drops.`
    );
  } else {
    feedbacks.push(
      `Outstanding sleep hygiene! Averaging **${avgSleep.toFixed(1)} hrs** provided excellent neural restoration and glycogen replenishment, supporting your weekly weight jumps.`
    );
  }

  // Soreness feedback
  if (avgSoreness >= 6.0) {
    feedbacks.push(
      `Accumulated soreness was high (**${avgSoreness.toFixed(1)}/10**). This suggests mechanical eccentric overload is outpacing systemic recovery. Consider slightly trimming accessory volume or extending deload frequency.`
    );
  } else if (avgSoreness <= 3.0) {
    feedbacks.push(
      `Average soreness was minimal (**${avgSoreness.toFixed(1)}/10**), proving superb muscular work capacity and rapid tissue rebuilding. You can safely increase training density or accessory volume.`
    );
  } else {
    feedbacks.push(
      `Muscle soreness was managed perfectly, averaging a comfortable **${avgSoreness.toFixed(1)}/10**, indicating stimulus is ideal without entering localized exhaustion.`
    );
  }

  // Hydration feedback
  const avgHydrationLabel = mapLitersToHydration(avgHydration);
  if (avgHydrationLabel === 'Dehydrated' || avgHydrationLabel === 'Under-hydrated') {
    feedbacks.push(
      `Hydration averaged at a **${avgHydrationLabel}** level. Even mild dehydration (2% body mass drop) reduces plasma volume, raising your working RPE and accelerating motor-unit fatigue.`
    );
  } else {
    feedbacks.push(
      `Solid fluid intake! Your **${avgHydrationLabel}** hydration level average sustains cell volumization and intracellular pressure, crucial for maintaining leverage on heavy lifts.`
    );
  }

  // Nutrition feedback
  const mainCalStatus =
    surplusCount > deficitCount && surplusCount > maintenanceCount
      ? 'surplus'
      : deficitCount > surplusCount && deficitCount > maintenanceCount
      ? 'deficit'
      : 'maintenance';

  if (mainCalStatus === 'deficit') {
    feedbacks.push(
      `You trained mostly in a **Caloric Deficit**. While excellent for body composition, a deficit limits raw glycogen reserves. Keep protein high (~2.0g/kg) to safeguard your myofibrillar density.`
    );
  } else if (mainCalStatus === 'surplus') {
    feedbacks.push(
      `Your consistent **Caloric Surplus** provided the direct thermodynamic energy required to synthesize new contractile tissues and fuel heavy linear periodization progression.`
    );
  } else {
    feedbacks.push(
      `Maintaining **Caloric Balance** supported steady recomposition, providing enough daily glycogen for high workout quality without excessive body weight changes.`
    );
  }

  return {
    score,
    grade,
    gradeSub,
    gradeColor,
    adherenceRate,
    completedCount,
    totalPlannedDays,
    totalPRsHit,
    strongestMuscle,
    exerciseStats,
    feedbacks,
    avgActualGrowth,
    avgSleep,
    avgSoreness,
    avgQuality,
    avgHydration,
  };
}

/**
 * Calculates algorithmic projection mapping and actual progress chart points for a program.
 */
export function getReportChartData(
  program: Program,
  logs: WorkoutLog[],
  selectedExercise: string,
  displayUnit: WeightUnit = 'kg'
): ReportChartData | null {
  const card = getProgramReportCard(program, logs, displayUnit);
  const progLogs = logs.filter(l => l.programId === program.id);

  const totalWeeks = program.programDuration === '∞' ? 12 : Number(program.programDuration) || 12;
  const growthRate =
    program.objective === 'Strength' ? 0.005 : program.objective === 'Hypertrophy' ? 0.004 : 0.002;

  // Track the highest week that was actually logged
  let lastLoggedWeek = 1;
  progLogs.forEach(l => {
    const w = Number(l.week) || 1;
    if (w > lastLoggedWeek) lastLoggedWeek = w;
  });

  if (selectedExercise === 'Overall') {
    const points: ReportChartPoint[] = [];

    for (let w = 1; w <= totalWeeks; w++) {
      const proj = Math.round(100 * (1 + growthRate * (w - 1)) * 10) / 10;
      const weekLogs = progLogs.filter(l => (Number(l.week) || 1) === w);

      let actualVal: number | null = null;
      if (weekLogs.length > 0 && card.exerciseStats.length > 0) {
        const ratios: number[] = [];

        card.exerciseStats.forEach(es => {
          // Find week max E1RM in kg for this exercise
          const weekE1RMsKg: number[] = [];
          weekLogs.forEach(l => {
            const matchedEx = l.exercises.find(
              e => !e.isSkipped && e.name.trim().toLowerCase() === es.name.trim().toLowerCase()
            );
            if (!matchedEx) return;

            matchedEx.sets.forEach(s => {
              const e1rmKg = calculateSetE1RMKg(s, matchedEx.modality, l.unit, l.bodyweightSnapshot);
              if (e1rmKg !== null && e1rmKg > 0) {
                weekE1RMsKg.push(e1rmKg);
              }
            });
          });

          if (weekE1RMsKg.length > 0 && es.baselineE1RM > 0) {
            const weekMaxKg = Math.max(...weekE1RMsKg);
            // es.baselineE1RM is in displayUnit, convert weekMax to displayUnit
            const weekMaxDisplay = displayUnit === 'lb' ? convertWeightUnit(weekMaxKg, 'kg', 'lb') : weekMaxKg;
            ratios.push((weekMaxDisplay / es.baselineE1RM) * 100);
          }
        });

        if (ratios.length > 0) {
          actualVal = Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 10) / 10;
        }
      }

      points.push({
        week: `W${w}`,
        actual: actualVal,
        projected: proj,
      });
    }

    let lastKnownActual = 100;
    const pointsFilled = points.map(p => {
      if (p.actual !== null) {
        lastKnownActual = p.actual;
        return p;
      }
      return {
        ...p,
        actual: lastKnownActual,
      };
    });

    return {
      unit: '%',
      points: pointsFilled,
    };
  } else {
    // Specific exercise chart
    const exStat = card.exerciseStats.find(
      es => es.name.trim().toLowerCase() === selectedExercise.trim().toLowerCase()
    );
    const baseline = exStat ? exStat.baselineE1RM : 0;
    const points: ReportChartPoint[] = [];

    for (let w = 1; w <= totalWeeks; w++) {
      const proj = Math.round(baseline * (1 + growthRate * (w - 1)) * 10) / 10;
      const weekLogs = progLogs.filter(l => (Number(l.week) || 1) === w);

      let actualVal: number | null = null;
      if (weekLogs.length > 0) {
        const weekE1RMsKg: number[] = [];
        weekLogs.forEach(l => {
          const matchedEx = l.exercises.find(
            e => !e.isSkipped && e.name.trim().toLowerCase() === selectedExercise.trim().toLowerCase()
          );
          if (!matchedEx) return;

          matchedEx.sets.forEach(s => {
            const e1rmKg = calculateSetE1RMKg(s, matchedEx.modality, l.unit, l.bodyweightSnapshot);
            if (e1rmKg !== null && e1rmKg > 0) {
              weekE1RMsKg.push(e1rmKg);
            }
          });
        });

        if (weekE1RMsKg.length > 0) {
          const weekMaxKg = Math.max(...weekE1RMsKg);
          const weekMaxDisplay = displayUnit === 'lb' ? convertWeightUnit(weekMaxKg, 'kg', 'lb') : weekMaxKg;
          actualVal = Math.round(weekMaxDisplay * 10) / 10;
        }
      }

      points.push({
        week: `W${w}`,
        actual: actualVal,
        projected: proj,
      });
    }

    let lastKnownActual = baseline;
    const pointsFilled = points.map(p => {
      if (p.actual !== null) {
        lastKnownActual = p.actual;
        return p;
      }
      return {
        ...p,
        actual: lastKnownActual,
      };
    });

    return {
      unit: displayUnit,
      points: pointsFilled,
    };
  }
}
