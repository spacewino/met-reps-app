/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type MovementCategory = 'compound' | 'isolation';
export type EquipmentType = 'freeweight' | 'machine';

export interface CustomExerciseItem {
  name: string;
  category: string;
  modality?: 'weighted' | 'bodyweight' | 'assisted' | 'distance' | 'timed' | 'distance_loaded';
  movementCategory?: MovementCategory;
  equipment?: EquipmentType;
}

const ISOLATION_KEYWORDS = [
  'curl', 'fly', 'flye', 'extension', 'raise', 'lateral', 'shrug',
  'pushdown', 'crunch', 'pec deck', 'pec-deck', 'calf', 'wrist', 'kickback',
  'face pull', 'skull crusher', 'skullcrusher', 'preacher', 'concentration',
  'cable crossover', 'leg extension', 'leg curl', 'adductor', 'abductor'
];

const COMPOUND_KEYWORDS = [
  'squat', 'press', 'deadlift', 'row', 'lunge', 'dip', 'chin', 'pull-up', 'pullup',
  'chin-up', 'chinup', 'clean', 'snatch', 'thrust', 'bench', 'push-up', 'pushup',
  'overhead', 'lat pulldown', 'hip hinge', 'back extension', 'farmer'
];

const MACHINE_KEYWORDS = [
  'machine', 'cable', 'smith', 'hack', 'leg press', 'pec deck', 'lat pulldown',
  'lever', 'plate-loaded', 'plate loaded', 'nautilus', 'cybex', 'hammer strength',
  'selectorized', 'chest press machine', 'shoulder press machine', 'seated row machine',
  'pushdown', 'pulldown', 'kickback', 'rope'
];

const FREEWEIGHT_KEYWORDS = [
  'barbell', 'dumbbell', 'kettlebell', 'db', 'bb', 'kb', 'trap bar', 'ez bar', 'landmine'
];

const EXPLICIT_CLASSIFICATIONS: Record<string, { category: MovementCategory; equipment: EquipmentType }> = {
  'face pull': { category: 'isolation', equipment: 'machine' },
  'y raise': { category: 'isolation', equipment: 'freeweight' },
  'dumbell y-raise': { category: 'isolation', equipment: 'freeweight' },
  'dumbbell y-raise': { category: 'isolation', equipment: 'freeweight' },
  'dumbell y raise': { category: 'isolation', equipment: 'freeweight' },
  'dumbbell y raise': { category: 'isolation', equipment: 'freeweight' },
  'cable y raise': { category: 'isolation', equipment: 'machine' },
  'smith machine shrug': { category: 'isolation', equipment: 'machine' },
  'smith machine shrug (behind-the-back)': { category: 'isolation', equipment: 'machine' },
  'rope hammer curl': { category: 'isolation', equipment: 'machine' },
  'triceps pushdown (rope)': { category: 'isolation', equipment: 'machine' },
  'straight bar pushdown': { category: 'isolation', equipment: 'machine' },
  'triceps pushdown (straight bar)': { category: 'isolation', equipment: 'machine' },
  'dumbbell skull crushers': { category: 'isolation', equipment: 'freeweight' },
  'skull crushers (db)': { category: 'isolation', equipment: 'freeweight' },
  'single-arm cable pushdown': { category: 'isolation', equipment: 'machine' },
  'triceps pushdown (single arm)': { category: 'isolation', equipment: 'machine' },
  'incline dumbbell press': { category: 'compound', equipment: 'freeweight' },
  'dumbell bench press (incline)': { category: 'compound', equipment: 'freeweight' },
  'bench press (barbell, flat)': { category: 'compound', equipment: 'freeweight' },
  'barbell bench press (flat)': { category: 'compound', equipment: 'freeweight' },
  'pec deck machine': { category: 'isolation', equipment: 'machine' },
  'pec deck machine fly': { category: 'isolation', equipment: 'machine' },
  'incline dumbbell fly': { category: 'isolation', equipment: 'freeweight' },
  'dumbell fly (incline)': { category: 'isolation', equipment: 'freeweight' },
  'close-grip pulldown': { category: 'compound', equipment: 'machine' },
  'straight-arm pulldown': { category: 'compound', equipment: 'machine' },
  'crunches (weighted)': { category: 'isolation', equipment: 'freeweight' },
  'leg extension': { category: 'isolation', equipment: 'machine' },
  'seated leg curl': { category: 'isolation', equipment: 'machine' },
  'standing calf raise (machine)': { category: 'isolation', equipment: 'machine' },
  'single-leg calf raise (db)': { category: 'isolation', equipment: 'freeweight' },
  'cable glute kickback': { category: 'isolation', equipment: 'machine' },
};

/**
 * Detects default movement category and equipment type based on exercise name & modality.
 */
export function detectExerciseClassification(
  name: string,
  modality?: string
): { category: MovementCategory; equipment: EquipmentType } {
  const norm = (name || '').trim().toLowerCase();

  // Check explicit override first
  if (EXPLICIT_CLASSIFICATIONS[norm]) {
    return EXPLICIT_CLASSIFICATIONS[norm];
  }

  // 1. Movement Category (Compound vs Isolation) Heuristics
  let category: MovementCategory = 'compound';

  const hasIsolationKeyword = ISOLATION_KEYWORDS.some(kw => norm.includes(kw));
  const hasCompoundKeyword = COMPOUND_KEYWORDS.some(kw => norm.includes(kw));

  if (hasIsolationKeyword && !hasCompoundKeyword) {
    category = 'isolation';
  } else if (hasIsolationKeyword && hasCompoundKeyword) {
    if (norm.includes('extension') || norm.includes('curl') || norm.includes('fly') || norm.includes('raise') || norm.includes('pushdown')) {
      category = 'isolation';
    } else {
      category = 'compound';
    }
  } else {
    category = 'compound';
  }

  // 2. Equipment Type (Free Weight vs Machine / Cable) Heuristics
  let equipment: EquipmentType = 'freeweight';

  if (modality === 'assisted') {
    equipment = 'machine';
  } else {
    const hasMachine = MACHINE_KEYWORDS.some(kw => norm.includes(kw));
    const hasFreeweight = FREEWEIGHT_KEYWORDS.some(kw => norm.includes(kw));

    if (hasFreeweight) {
      equipment = 'freeweight';
    } else if (hasMachine) {
      equipment = 'machine';
    } else {
      equipment = 'freeweight';
    }
  }

  return { category, equipment };
}

/**
 * Gets effective classification checking explicit properties first, then stored custom exercises,
 * then falling back to keyword heuristics.
 */
export function getExerciseClassification(exercise: {
  name: string;
  modality?: string;
  movementCategory?: MovementCategory;
  equipment?: EquipmentType;
}): { category: MovementCategory; equipment: EquipmentType } {
  // Explicit properties on object
  if (exercise.movementCategory && exercise.equipment) {
    return {
      category: exercise.movementCategory,
      equipment: exercise.equipment,
    };
  }

  // Check saved custom exercises in localStorage
  try {
    const saved = localStorage.getItem('metreps_custom_exercises');
    if (saved) {
      const customs: CustomExerciseItem[] = JSON.parse(saved);
      const match = customs.find(c => c.name.toLowerCase() === exercise.name.trim().toLowerCase());
      if (match) {
        const detected = detectExerciseClassification(match.name, match.modality || exercise.modality);
        return {
          category: exercise.movementCategory || match.movementCategory || detected.category,
          equipment: exercise.equipment || match.equipment || detected.equipment,
        };
      }
    }
  } catch (_) {}

  // Fallback heuristic auto-detection
  const detected = detectExerciseClassification(exercise.name, exercise.modality);
  return {
    category: exercise.movementCategory || detected.category,
    equipment: exercise.equipment || detected.equipment,
  };
}
