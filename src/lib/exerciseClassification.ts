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
  'selectorized', 'chest press machine', 'shoulder press machine', 'seated row machine'
];

const FREEWEIGHT_KEYWORDS = [
  'barbell', 'dumbbell', 'kettlebell', 'db', 'bb', 'kb', 'trap bar', 'ez bar', 'landmine'
];

/**
 * Detects default movement category and equipment type based on exercise name & modality.
 */
export function detectExerciseClassification(
  name: string,
  modality?: string
): { category: MovementCategory; equipment: EquipmentType } {
  const norm = (name || '').trim().toLowerCase();

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
