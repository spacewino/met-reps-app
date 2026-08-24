import { describe, it, expect } from 'vitest';
import defaultExercises from '../defaultExerciseLibrary.json';
import { detectExerciseClassification } from '../exerciseClassification';
import { PREBUILT_TEMPLATES, storage } from '../storage';
import { Program } from '../../types';

describe('Part 1 & Part 5: Canonical Default Exercise Library Registration', () => {
  const approvedNewExercises: Record<string, string> = {
    'Plate-Loaded Romanian Deadlift': 'Hamstrings',
    'Standing Leg Curl (Machine)': 'Hamstrings',
    'Smith Machine Bulgarian Split Squat': 'Quads',
    'Plate-Loaded Shrug Machine': 'Traps',
    'Plate-Loaded Chest Press': 'Pecs',
    'Smith Machine Incline Bench Press': 'Pecs',
    'Plate-Loaded Shoulder Press': 'Delts',
    'Glute Kickback Machine': 'Glutes',
    'Hip Abduction Machine': 'Glutes',
    'Diverging Lat Pulldown Machine': 'Back'
  };

  it('1. All ten new exercises occur exactly once in their intended category', () => {
    Object.entries(approvedNewExercises).forEach(([exerciseName, intendedCategory]) => {
      const categoryList = (defaultExercises as Record<string, string[]>)[intendedCategory] || [];
      const matches = categoryList.filter(name => name === exerciseName);
      expect(matches.length, `Expected "${exerciseName}" to exist exactly once in category "${intendedCategory}"`).toBe(1);
    });
  });

  it('2. None of the ten are added under an incorrect category', () => {
    Object.entries(approvedNewExercises).forEach(([exerciseName, intendedCategory]) => {
      Object.entries(defaultExercises as Record<string, string[]>).forEach(([category, list]) => {
        if (category !== intendedCategory) {
          expect(list).not.toContain(exerciseName);
        }
      });
    });
  });

  it('3. No manufacturer names appear among the ten additions', () => {
    const forbiddenBrands = ['technogym', 'gym80', 'matrix', 'hammer strength', 'cybex', 'nautilus', 'life fitness', 'eleiko'];
    Object.keys(approvedNewExercises).forEach(name => {
      const lower = name.toLowerCase();
      forbiddenBrands.forEach(brand => {
        expect(lower).not.toContain(brand);
      });
    });
  });

  it('4. No existing default name is renamed or removed, including legacy spellings', () => {
    const pecs = defaultExercises['Pecs'] as string[];
    expect(pecs).toContain('Dumbell Bench Press (incline)');
    expect(pecs).toContain('Dumbell Fly (incline)');
    expect(pecs).toContain('Barbell Bench Press (flat)');

    const back = defaultExercises['Back'] as string[];
    expect(back).toContain('Pull-Up (Wide Grip)');
    expect(back).toContain('Chin-Up (Underhand)');
    expect(back).toContain('Lat Pulldown (Wide)');

    const hamstrings = defaultExercises['Hamstrings'] as string[];
    expect(hamstrings).toContain('Deadlift (Conventional)');
    expect(hamstrings).toContain('Romanian Deadlift (RDL)');
    expect(hamstrings).toContain('Lying Leg Curl (Machine)');
  });

  it('5. No Chin-Up (Weighted), Technogym Pulldown or Hip Adduction Machine entry is added by this task', () => {
    const allExercises = Object.values(defaultExercises as Record<string, string[]>).flat();
    expect(allExercises).not.toContain('Chin-Up (Weighted)');
    expect(allExercises).not.toContain('Technogym Pulldown');
    expect(allExercises).not.toContain('Hip Adduction Machine');
  });
});

describe('Part 1 & Part 5: Runtime Metadata & Classification Verification', () => {
  // Helper matching ExerciseSelectorModal getDefaultModality
  const getDefaultModality = (name: string): 'weighted' | 'bodyweight' | 'assisted' | 'distance' | 'timed' | 'distance_loaded' => {
    const norm = name.trim().toLowerCase();
    if (norm.includes('weighted')) return 'weighted';
    if (norm.includes('assisted') || norm.includes('(assisted)')) return 'assisted';
    if (
      norm.includes("farmer's carry") ||
      norm.includes("farmer's walk") ||
      norm.includes("farmer’s carry") ||
      norm.includes("sled push") ||
      norm.includes("sled pull")
    ) {
      return 'distance_loaded';
    }
    if (norm.includes('treadmill') || norm.includes('running') || norm.includes('jump rope') || norm.includes('stationary bike') || norm.includes('rowing machine')) {
      return 'distance';
    }
    if (norm.includes('plank') || norm.includes('wall sit') || norm.includes('hold') || norm.includes('battle ropes')) {
      return 'timed';
    }
    if (
      norm === 'push-ups' ||
      norm === 'diamond push-ups' ||
      norm === 'pull-up (wide grip)' ||
      norm === 'chin-up (underhand)' ||
      norm === 'neutral-grip pull-up' ||
      norm === 'inverted row' ||
      norm === 'dips (parallel bar)' ||
      norm === 'bench dips' ||
      norm === 'dips (chest lean)' ||
      norm === 'glute bridge' ||
      norm === 'sissy squat' ||
      norm === 'pistol squat' ||
      norm === 'crunches' ||
      norm === 'bicycle crunch' ||
      norm === 'reverse crunch' ||
      norm === 'hanging leg raise' ||
      norm === "captain's chair leg raise" ||
      norm === 'lying leg raise' ||
      norm === 'toes-to-bar' ||
      norm === 'dead bug' ||
      norm === 'hollow body hold' ||
      norm === 'russian twist' ||
      norm === 'bird dog' ||
      norm === 'burpees' ||
      norm === 'bodyweight squat'
    ) {
      return 'bodyweight';
    }
    return 'weighted';
  };

  const expectedClassifications: Record<string, { modality: string; category: 'compound' | 'isolation'; equipment: 'freeweight' | 'machine' }> = {
    'Plate-Loaded Romanian Deadlift': { modality: 'weighted', category: 'compound', equipment: 'machine' },
    'Smith Machine Bulgarian Split Squat': { modality: 'weighted', category: 'compound', equipment: 'machine' },
    'Standing Leg Curl (Machine)': { modality: 'weighted', category: 'isolation', equipment: 'machine' },
    'Plate-Loaded Shrug Machine': { modality: 'weighted', category: 'isolation', equipment: 'machine' },
    'Plate-Loaded Chest Press': { modality: 'weighted', category: 'compound', equipment: 'machine' },
    'Plate-Loaded Shoulder Press': { modality: 'weighted', category: 'compound', equipment: 'machine' },
    'Smith Machine Incline Bench Press': { modality: 'weighted', category: 'compound', equipment: 'machine' },
    'Glute Kickback Machine': { modality: 'weighted', category: 'isolation', equipment: 'machine' },
    'Hip Abduction Machine': { modality: 'weighted', category: 'isolation', equipment: 'machine' },
    'Diverging Lat Pulldown Machine': { modality: 'weighted', category: 'compound', equipment: 'machine' },
  };

  it('6. All ten resolve to modality weighted', () => {
    Object.keys(expectedClassifications).forEach(name => {
      expect(getDefaultModality(name)).toBe('weighted');
    });
  });

  it('7. Every movement and equipment classification exactly matches the approved table', () => {
    Object.entries(expectedClassifications).forEach(([name, expected]) => {
      const detected = detectExerciseClassification(name, expected.modality);
      expect(detected.category, `Movement category mismatch for ${name}`).toBe(expected.category);
      expect(detected.equipment, `Equipment mismatch for ${name}`).toBe(expected.equipment);
    });
  });

  it('8. Plate-Loaded Shrug Machine resolves as isolation/machine', () => {
    const res = detectExerciseClassification('Plate-Loaded Shrug Machine', 'weighted');
    expect(res).toEqual({ category: 'isolation', equipment: 'machine' });
  });

  it('9. Glute Kickback Machine resolves as isolation/machine', () => {
    const res = detectExerciseClassification('Glute Kickback Machine', 'weighted');
    expect(res).toEqual({ category: 'isolation', equipment: 'machine' });
  });

  it('10. Hip Abduction Machine resolves as isolation/machine', () => {
    const res = detectExerciseClassification('Hip Abduction Machine', 'weighted');
    expect(res).toEqual({ category: 'isolation', equipment: 'machine' });
  });

  it('11. Explicit classifications prevent the known "chin"-inside-"machine" and "kb"-inside-"kickback" substring failures', () => {
    // Shrug Machine should NOT be categorized compound just because of "chin" in "machine"
    const shrug = detectExerciseClassification('Plate-Loaded Shrug Machine');
    expect(shrug.category).toBe('isolation');

    // Glute Kickback Machine should NOT be categorized freeweight just because of "kb" in "kickback"
    const kickback = detectExerciseClassification('Glute Kickback Machine');
    expect(kickback.equipment).toBe('machine');
    expect(kickback.category).toBe('isolation');
  });

  it('12. Existing classification outputs remain unchanged outside the authorized additions', () => {
    expect(detectExerciseClassification('Barbell Bench Press (flat)')).toEqual({ category: 'compound', equipment: 'freeweight' });
    expect(detectExerciseClassification('Face Pull')).toEqual({ category: 'isolation', equipment: 'machine' });
    expect(detectExerciseClassification('Leg Extension')).toEqual({ category: 'isolation', equipment: 'machine' });
    expect(detectExerciseClassification('Back Squat (High Bar)')).toEqual({ category: 'compound', equipment: 'freeweight' });
  });
});

describe('Part 2, 3 & Part 5: Prebuilt Template Structure Verification', () => {
  it('13. Exactly three built-in templates exist with the approved names and unique IDs', () => {
    expect(PREBUILT_TEMPLATES.length).toBe(3);
    const ids = PREBUILT_TEMPLATES.map(t => t.id);
    expect(new Set(ids).size).toBe(3);

    expect(PREBUILT_TEMPLATES[0].id).toBe('prog-tpl-milhouse-mass-split');
    expect(PREBUILT_TEMPLATES[0].name).toBe('Milhouse Mass Split');

    expect(PREBUILT_TEMPLATES[1].id).toBe('prog-tpl-upper-lower-foundations');
    expect(PREBUILT_TEMPLATES[1].name).toBe('Upper/Lower Foundations');

    expect(PREBUILT_TEMPLATES[2].id).toBe('prog-tpl-push-pull-legs-ab');
    expect(PREBUILT_TEMPLATES[2].name).toBe('Push Pull Legs A/B');
  });

  it('14. Their day counts are exactly 3, 4 and 6', () => {
    expect(PREBUILT_TEMPLATES[0].daysPerWeek).toBe(3);
    expect(Object.keys(PREBUILT_TEMPLATES[0].exercisesByDay).length).toBe(3);
    expect(PREBUILT_TEMPLATES[0].programDuration).toBe(4);

    expect(PREBUILT_TEMPLATES[1].daysPerWeek).toBe(4);
    expect(Object.keys(PREBUILT_TEMPLATES[1].exercisesByDay).length).toBe(4);
    expect(PREBUILT_TEMPLATES[1].programDuration).toBe(12);

    expect(PREBUILT_TEMPLATES[2].daysPerWeek).toBe(6);
    expect(Object.keys(PREBUILT_TEMPLATES[2].exercisesByDay).length).toBe(6);
    expect(PREBUILT_TEMPLATES[2].programDuration).toBe(8);
  });

  it('15. Their exact exercise order matches the prompt specification', () => {
    // Template 1: Milhouse Mass Split (7 / 7 / 7)
    const mDay1 = PREBUILT_TEMPLATES[0].exercisesByDay[1].map(e => e.name);
    expect(mDay1).toEqual([
      'Hack Squat (Machine)',
      'Plate-Loaded Romanian Deadlift',
      'Standing Calf Raise',
      'Smith Machine Bulgarian Split Squat',
      'Chest-Supported Row (Dumbbell)',
      'Lying Leg Curl (Machine)',
      'Plate-Loaded Shrug Machine'
    ]);

    const mDay2 = PREBUILT_TEMPLATES[0].exercisesByDay[2].map(e => e.name);
    expect(mDay2).toEqual([
      'Plate-Loaded Chest Press',
      'Plate-Loaded Shoulder Press',
      'Smith Machine Incline Bench Press',
      'Leg Extension',
      'Machine Lateral Raise',
      'Hip Abduction Machine',
      'Triceps Pushdown (single arm)'
    ]);

    const mDay3 = PREBUILT_TEMPLATES[0].exercisesByDay[3].map(e => e.name);
    expect(mDay3).toEqual([
      'Diverging Lat Pulldown Machine',
      'Machine Row',
      'Pec Deck Machine Fly',
      'Reverse Pec Deck',
      'Incline Dumbbell Curl',
      'Overhead Cable Extension (Rope)',
      'Lat Pulldown (Wide)'
    ]);

    // Template 2: Upper/Lower Foundations
    const ulDay1 = PREBUILT_TEMPLATES[1].exercisesByDay[1].map(e => e.name);
    expect(ulDay1).toEqual([
      'Back Squat (High Bar)',
      'Deadlift (Conventional)',
      'Bulgarian Split Squat',
      'Standing Calf Raise'
    ]);

    const ulDay2 = PREBUILT_TEMPLATES[1].exercisesByDay[2].map(e => e.name);
    expect(ulDay2).toEqual([
      'Barbell Bench Press (flat)',
      'Seated Cable Row',
      'Overhead Press (Barbell)',
      'Chin-Up (Underhand)',
      'Cable Fly (Mid)'
    ]);

    const ulDay3 = PREBUILT_TEMPLATES[1].exercisesByDay[3].map(e => e.name);
    expect(ulDay3).toEqual([
      'Barbell Hip Thrust',
      'Leg Press',
      'Leg Extension',
      'Lying Leg Curl (Machine)',
      'Seated Calf Raise'
    ]);

    const ulDay4 = PREBUILT_TEMPLATES[1].exercisesByDay[4].map(e => e.name);
    expect(ulDay4).toEqual([
      'Barbell Bench Press (flat)',
      'Seated Cable Row',
      'Dumbell Bench Press (incline)',
      'Chin-Up (Underhand)',
      'Triceps Pushdown (Straight Bar)',
      'Dumbbell Curl (Alternating)'
    ]);

    // Template 3: Push Pull Legs A/B
    const pplDay1 = PREBUILT_TEMPLATES[2].exercisesByDay[1].map(e => e.name);
    expect(pplDay1).toEqual([
      'Barbell Bench Press (flat)',
      'Overhead Press (Barbell)',
      'Dumbell Bench Press (incline)',
      'Cable Lateral Raise',
      'Triceps Pushdown (Rope)'
    ]);

    const pplDay2 = PREBUILT_TEMPLATES[2].exercisesByDay[2].map(e => e.name);
    expect(pplDay2).toEqual([
      'Barbell Row (Bent-Over)',
      'Lat Pulldown (Wide)',
      'Chest-Supported Row (Dumbbell)',
      'Face Pull',
      'Incline Dumbbell Curl'
    ]);

    const pplDay3 = PREBUILT_TEMPLATES[2].exercisesByDay[3].map(e => e.name);
    expect(pplDay3).toEqual([
      'Back Squat (High Bar)',
      'Romanian Deadlift (RDL)',
      'Leg Extension',
      'Lying Leg Curl (Machine)',
      'Standing Calf Raise'
    ]);

    const pplDay4 = PREBUILT_TEMPLATES[2].exercisesByDay[4].map(e => e.name);
    expect(pplDay4).toEqual([
      'Incline Bench Press (Barbell)',
      'Seated Dumbbell Shoulder Press',
      'Pec Deck Machine Fly',
      'Lateral Raise (Dumbbell)',
      'Overhead Cable Extension (Rope)'
    ]);

    const pplDay5 = PREBUILT_TEMPLATES[2].exercisesByDay[5].map(e => e.name);
    expect(pplDay5).toEqual([
      'Pull-Up (Wide Grip)',
      'Seated Cable Row',
      'Single-Arm Dumbbell Row',
      'Reverse Pec Deck',
      'Rope Hammer Curl'
    ]);

    const pplDay6 = PREBUILT_TEMPLATES[2].exercisesByDay[6].map(e => e.name);
    expect(pplDay6).toEqual([
      'Deadlift (Conventional)',
      'Leg Press',
      'Bulgarian Split Squat',
      'Seated Leg Curl',
      'Seated Calf Raise'
    ]);
  });

  it('16. Every template exercise resolves to an existing canonical default-library name in its intended muscle category', () => {
    PREBUILT_TEMPLATES.forEach(tpl => {
      Object.values(tpl.exercisesByDay).forEach(dayExercises => {
        dayExercises.forEach(ex => {
          const categoryList = (defaultExercises as Record<string, string[]>)[ex.muscleGroup];
          expect(categoryList, `Muscle group ${ex.muscleGroup} not found for exercise ${ex.name}`).toBeDefined();
          expect(categoryList).toContain(ex.name);
        });
      });
    });
  });

  it('17. Every template exercise has complete modality, movement and equipment metadata', () => {
    PREBUILT_TEMPLATES.forEach(tpl => {
      Object.values(tpl.exercisesByDay).forEach(dayExercises => {
        dayExercises.forEach(ex => {
          expect(ex.modality).toBeDefined();
          expect(['weighted', 'bodyweight', 'assisted', 'distance', 'timed', 'distance_loaded']).toContain(ex.modality);
          expect(ex.movementCategory).toBeDefined();
          expect(['compound', 'isolation']).toContain(ex.movementCategory);
          expect(ex.equipment).toBeDefined();
          expect(['freeweight', 'machine']).toContain(ex.equipment);
        });
      });
    });
  });

  it('18. Every template exercise has isMainMovement: false', () => {
    PREBUILT_TEMPLATES.forEach(tpl => {
      Object.values(tpl.exercisesByDay).forEach(dayExercises => {
        dayExercises.forEach(ex => {
          expect(ex.isMainMovement).toBe(false);
        });
      });
    });
  });

  it('19. Every template exercise contains exactly one neutral structural set', () => {
    PREBUILT_TEMPLATES.forEach(tpl => {
      Object.values(tpl.exercisesByDay).forEach(dayExercises => {
        dayExercises.forEach(ex => {
          expect(ex.sets.length).toBe(1);
          const s = ex.sets[0];
          expect(s.setNumber).toBe(1);
          expect(s.weight).toBe(0);
          expect(s.reps).toBe(0);
          expect(s.rpe).toBe(0);
          expect(s.form).toBe('standard');
        });
      });
    });
  });

  it('20. No template exercise contains a non-zero weight, reps or RPE target', () => {
    PREBUILT_TEMPLATES.forEach(tpl => {
      Object.values(tpl.exercisesByDay).forEach(dayExercises => {
        dayExercises.forEach(ex => {
          ex.sets.forEach(s => {
            expect(s.weight === 0 || s.weight === null || s.weight === undefined).toBe(true);
            expect(s.reps === 0 || s.reps === null || s.reps === undefined).toBe(true);
            expect(s.rpe === 0 || s.rpe === null || s.rpe === undefined).toBe(true);
          });
        });
      });
    });
  });

  it('21. No template imposes three initial working sets', () => {
    PREBUILT_TEMPLATES.forEach(tpl => {
      Object.values(tpl.exercisesByDay).forEach(dayExercises => {
        dayExercises.forEach(ex => {
          expect(ex.sets.length).toBe(1);
        });
      });
    });
  });

  it('22. No manufacturer-specific exercise name appears in a template', () => {
    const forbiddenBrands = ['technogym', 'gym80', 'matrix', 'hammer strength', 'cybex', 'nautilus', 'life fitness', 'eleiko'];
    PREBUILT_TEMPLATES.forEach(tpl => {
      Object.values(tpl.exercisesByDay).forEach(dayExercises => {
        dayExercises.forEach(ex => {
          const lower = ex.name.toLowerCase();
          forbiddenBrands.forEach(brand => {
            expect(lower).not.toContain(brand);
          });
        });
      });
    });
  });

  it('23. Technogym Pulldown is represented generically as Lat Pulldown (Wide)', () => {
    const mDay3 = PREBUILT_TEMPLATES[0].exercisesByDay[3];
    const latPulldown = mDay3.find(e => e.name === 'Lat Pulldown (Wide)');
    expect(latPulldown).toBeDefined();
    expect(latPulldown?.muscleGroup).toBe('Back');
  });

  it('24. Chin-Up (Underhand) and Pull-Up (Wide Grip) retain their existing bodyweight modality', () => {
    const ulTemplate = PREBUILT_TEMPLATES.find(t => t.id === 'prog-tpl-upper-lower-foundations')!;
    const chinUps = [
      ...ulTemplate.exercisesByDay[2].filter(e => e.name === 'Chin-Up (Underhand)'),
      ...ulTemplate.exercisesByDay[4].filter(e => e.name === 'Chin-Up (Underhand)')
    ];
    chinUps.forEach(c => expect(c.modality).toBe('bodyweight'));

    const pplTemplate = PREBUILT_TEMPLATES.find(t => t.id === 'prog-tpl-push-pull-legs-ab')!;
    const pullUps = pplTemplate.exercisesByDay[5].filter(e => e.name === 'Pull-Up (Wide Grip)');
    pullUps.forEach(p => expect(p.modality).toBe('bodyweight'));
  });

  it('25. No weighted chin-up is introduced in templates', () => {
    PREBUILT_TEMPLATES.forEach(tpl => {
      Object.values(tpl.exercisesByDay).forEach(dayExercises => {
        dayExercises.forEach(ex => {
          expect(ex.name).not.toContain('Chin-Up (Weighted)');
        });
      });
    });
  });
});

describe('Part 4 & Part 5: Program Creation & Objective/Algorithm Independence', () => {
  const objectivesAndAlgorithms = [
    { objective: 'Hypertrophy' as const, algorithmId: 'hypertrophy_linear' as const },
    { objective: 'Hypertrophy' as const, algorithmId: 'hypertrophy_step' as const },
    { objective: 'Strength' as const, algorithmId: 'strength_undulating' as const },
    { objective: 'Strength' as const, algorithmId: 'strength_linear' as const },
    { objective: 'Off' as const, algorithmId: 'none' as const },
  ];

  it('26 & 27. Each template can create a program under every current objective/algorithm selection, stored at root', () => {
    PREBUILT_TEMPLATES.forEach(tpl => {
      objectivesAndAlgorithms.forEach(config => {
        const createdProgram: Program = {
          id: `prog-${Date.now()}-${Math.random()}`,
          name: tpl.name,
          daysPerWeek: tpl.daysPerWeek,
          programDuration: tpl.programDuration,
          createdAt: new Date().toISOString(),
          exercisesByDay: JSON.parse(JSON.stringify(tpl.exercisesByDay)),
          assignedWeekdays: tpl.assignedWeekdays ? JSON.parse(JSON.stringify(tpl.assignedWeekdays)) : {},
          objective: config.objective,
          algorithmId: config.algorithmId
        };

        expect(createdProgram.objective).toBe(config.objective);
        expect(createdProgram.algorithmId).toBe(config.algorithmId);
        expect(createdProgram.exercisesByDay).toBeDefined();
      });
    });
  });

  it('28. Selecting a template does not lock a template-specific objective or algorithm', () => {
    // Template source object has technical initialization defaults, but user choice overrides them
    const tpl = PREBUILT_TEMPLATES[0];
    const userSelectedObjective = 'Strength';
    const userSelectedAlgorithm = 'strength_linear';

    const cloned = JSON.parse(JSON.stringify(tpl));
    cloned.objective = userSelectedObjective;
    cloned.algorithmId = userSelectedAlgorithm;

    expect(cloned.objective).toBe('Strength');
    expect(cloned.algorithmId).toBe('strength_linear');
  });

  it('29. Creating two programs from the same template under different algorithms produces independent deep-cloned programs', () => {
    const tpl = PREBUILT_TEMPLATES[1]; // Upper/Lower Foundations

    const prog1: Program = {
      id: 'prog-1',
      name: 'UL Hypertrophy',
      daysPerWeek: tpl.daysPerWeek,
      programDuration: 8,
      createdAt: new Date().toISOString(),
      exercisesByDay: JSON.parse(JSON.stringify(tpl.exercisesByDay)),
      assignedWeekdays: JSON.parse(JSON.stringify(tpl.assignedWeekdays)),
      objective: 'Hypertrophy',
      algorithmId: 'hypertrophy_linear'
    };

    const prog2: Program = {
      id: 'prog-2',
      name: 'UL Strength',
      daysPerWeek: tpl.daysPerWeek,
      programDuration: 12,
      createdAt: new Date().toISOString(),
      exercisesByDay: JSON.parse(JSON.stringify(tpl.exercisesByDay)),
      assignedWeekdays: JSON.parse(JSON.stringify(tpl.assignedWeekdays)),
      objective: 'Strength',
      algorithmId: 'strength_undulating'
    };

    // Modify prog1
    prog1.exercisesByDay[1][0].isMainMovement = true;
    prog1.exercisesByDay[1][0].sets.push({ setNumber: 2, weight: 100, reps: 5 });

    // Ensure prog2 and source template are not mutated
    expect(prog2.exercisesByDay[1][0].isMainMovement).toBe(false);
    expect(prog2.exercisesByDay[1][0].sets.length).toBe(1);
    expect(tpl.exercisesByDay[1][0].isMainMovement).toBe(false);
    expect(tpl.exercisesByDay[1][0].sets.length).toBe(1);
  });

  it('30. Editing one created program does not mutate its source template or another program', () => {
    const tpl = PREBUILT_TEMPLATES[0];
    const clonedExercises = JSON.parse(JSON.stringify(tpl.exercisesByDay));
    clonedExercises[1][0].name = 'Modified Squat';

    expect(tpl.exercisesByDay[1][0].name).toBe('Hack Squat (Machine)');
  });

  it('31. Existing Strength Main Movement selection remains unchanged (starts false in template)', () => {
    PREBUILT_TEMPLATES.forEach(tpl => {
      Object.values(tpl.exercisesByDay).forEach(dayList => {
        dayList.forEach(ex => {
          expect(ex.isMainMovement).toBe(false);
        });
      });
    });
  });

  it('32. Off remains self-directed', () => {
    const tpl = PREBUILT_TEMPLATES[0];
    const offProg: Program = {
      ...JSON.parse(JSON.stringify(tpl)),
      id: 'prog-off',
      objective: 'Off',
      algorithmId: 'none'
    };
    expect(offProg.objective).toBe('Off');
    expect(offProg.algorithmId).toBe('none');
  });

  it('33. Suggested weekdays use the accepted existing weekday convention', () => {
    // 3-Day: Mon (0), Wed (2), Fri (4)
    expect(PREBUILT_TEMPLATES[0].assignedWeekdays).toEqual({ 1: 0, 2: 2, 3: 4 });

    // 4-Day: Mon (0), Tue (1), Thu (3), Fri (4)
    expect(PREBUILT_TEMPLATES[1].assignedWeekdays).toEqual({ 1: 0, 2: 1, 3: 3, 4: 4 });

    // 6-Day: Mon (0), Tue (1), Wed (2), Thu (3), Fri (4), Sat (5)
    expect(PREBUILT_TEMPLATES[2].assignedWeekdays).toEqual({ 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5 });
  });

  it('34. Program duration remains editable', () => {
    const tpl = PREBUILT_TEMPLATES[1];
    expect(tpl.programDuration).toBe(12);

    const customizedDurationProg: Program = {
      ...JSON.parse(JSON.stringify(tpl)),
      id: 'prog-custom-dur',
      programDuration: 6
    };
    expect(customizedDurationProg.programDuration).toBe(6);
  });
});

describe('Part 6: Template Selection Objective and Algorithm Independence & Saved Program Restoration', () => {
  // Test simulated builder state transitions matching handleSelectPrebuiltTemplate and handleSelectSavedProgram
  function createBuilderState() {
    let state = {
      editingProgramId: null as string | null,
      name: 'My Custom Strength Program',
      originalName: '',
      daysPerWeek: 3,
      durationWeeks: 8,
      objective: 'Hypertrophy' as 'Off' | 'Hypertrophy' | 'Strength',
      algorithmId: 'hypertrophy_linear' as 'hypertrophy_linear' | 'hypertrophy_step' | 'strength_undulating' | 'strength_linear' | 'none',
      exercisesByDay: { 1: [], 2: [], 3: [] } as Record<number, any[]>,
      assignedWeekdays: { 1: 0, 2: 2, 3: 4 } as Record<number, number>,
      snapshot: {} as any
    };

    return {
      getState: () => ({ ...state }),
      setObjectiveAndAlgorithm: (obj: 'Off' | 'Hypertrophy' | 'Strength', algo: 'hypertrophy_linear' | 'hypertrophy_step' | 'strength_undulating' | 'strength_linear' | 'none') => {
        state.objective = obj;
        state.algorithmId = algo;
      },
      selectPrebuiltTemplate: (tpl: typeof PREBUILT_TEMPLATES[0]) => {
        const tplDuration = tpl.programDuration === '∞' ? 8 : Number(tpl.programDuration);
        const tplWeekdays = tpl.assignedWeekdays ? JSON.parse(JSON.stringify(tpl.assignedWeekdays)) : { 1: 0, 2: 2, 3: 4 };

        state.editingProgramId = tpl.id;
        state.name = tpl.name;
        state.originalName = tpl.name;
        state.daysPerWeek = tpl.daysPerWeek;
        state.durationWeeks = tplDuration;
        state.exercisesByDay = JSON.parse(JSON.stringify(tpl.exercisesByDay));
        state.assignedWeekdays = tplWeekdays;
        // Objective and algorithmId preserved!
        state.snapshot = {
          id: tpl.id,
          name: tpl.name,
          daysPerWeek: tpl.daysPerWeek,
          durationWeeks: tplDuration,
          objective: state.objective,
          algorithmId: state.algorithmId,
          exercisesByDay: JSON.parse(JSON.stringify(tpl.exercisesByDay)),
          assignedWeekdays: tplWeekdays
        };
      },
      selectSavedProgram: (prog: Program) => {
        const progObjective = prog.objective || 'Hypertrophy';
        const progAlgorithm = prog.algorithmId || (progObjective === 'Strength' ? 'strength_undulating' : 'hypertrophy_linear');
        const progDuration = prog.programDuration === '∞' ? 8 : Number(prog.programDuration);
        const progWeekdays = prog.assignedWeekdays ? JSON.parse(JSON.stringify(prog.assignedWeekdays)) : { 1: 0, 2: 2, 3: 4 };

        state.editingProgramId = prog.id;
        state.name = prog.name;
        state.originalName = prog.name;
        state.daysPerWeek = prog.daysPerWeek;
        state.durationWeeks = progDuration;
        state.exercisesByDay = JSON.parse(JSON.stringify(prog.exercisesByDay));
        state.assignedWeekdays = progWeekdays;
        state.objective = progObjective;
        state.algorithmId = progAlgorithm;
        state.snapshot = {
          id: prog.id,
          name: prog.name,
          daysPerWeek: prog.daysPerWeek,
          durationWeeks: progDuration,
          objective: progObjective,
          algorithmId: progAlgorithm,
          exercisesByDay: JSON.parse(JSON.stringify(prog.exercisesByDay)),
          assignedWeekdays: progWeekdays
        };
      },
      saveProgram: (): Program => {
        return {
          id: `prog-${Date.now()}`,
          name: state.name,
          daysPerWeek: state.daysPerWeek,
          programDuration: state.durationWeeks,
          createdAt: new Date().toISOString(),
          exercisesByDay: JSON.parse(JSON.stringify(state.exercisesByDay)),
          assignedWeekdays: JSON.parse(JSON.stringify(state.assignedWeekdays)),
          objective: state.objective,
          algorithmId: state.algorithmId
        };
      }
    };
  };

  it('35. Strength Linear survives selection of Milhouse Mass Split', () => {
    const builder = createBuilderState();
    builder.setObjectiveAndAlgorithm('Strength', 'strength_linear');

    const milhouse = PREBUILT_TEMPLATES.find(t => t.id === 'prog-tpl-milhouse-mass-split')!;
    builder.selectPrebuiltTemplate(milhouse);

    const st = builder.getState();
    expect(st.objective).toBe('Strength');
    expect(st.algorithmId).toBe('strength_linear');
    expect(st.name).toBe('Milhouse Mass Split');
    expect(st.daysPerWeek).toBe(3);
  });

  it('36. Strength Wave survives selection of Upper/Lower Foundations', () => {
    const builder = createBuilderState();
    builder.setObjectiveAndAlgorithm('Strength', 'strength_undulating');

    const ul = PREBUILT_TEMPLATES.find(t => t.id === 'prog-tpl-upper-lower-foundations')!;
    builder.selectPrebuiltTemplate(ul);

    const st = builder.getState();
    expect(st.objective).toBe('Strength');
    expect(st.algorithmId).toBe('strength_undulating');
    expect(st.name).toBe('Upper/Lower Foundations');
    expect(st.daysPerWeek).toBe(4);
  });

  it('37. Off/none survives selection of Push Pull Legs A/B', () => {
    const builder = createBuilderState();
    builder.setObjectiveAndAlgorithm('Off', 'none');

    const ppl = PREBUILT_TEMPLATES.find(t => t.id === 'prog-tpl-push-pull-legs-ab')!;
    builder.selectPrebuiltTemplate(ppl);

    const st = builder.getState();
    expect(st.objective).toBe('Off');
    expect(st.algorithmId).toBe('none');
    expect(st.name).toBe('Push Pull Legs A/B');
    expect(st.daysPerWeek).toBe(6);
  });

  it('38. Hypertrophy Step Loading survives selection of each template', () => {
    PREBUILT_TEMPLATES.forEach(tpl => {
      const builder = createBuilderState();
      builder.setObjectiveAndAlgorithm('Hypertrophy', 'hypertrophy_step');
      builder.selectPrebuiltTemplate(tpl);

      const st = builder.getState();
      expect(st.objective).toBe('Hypertrophy');
      expect(st.algorithmId).toBe('hypertrophy_step');
      expect(st.name).toBe(tpl.name);
    });
  });

  it('39. Hypertrophy Wave Volume survives template selection', () => {
    const builder = createBuilderState();
    builder.setObjectiveAndAlgorithm('Hypertrophy', 'hypertrophy_linear');

    const ul = PREBUILT_TEMPLATES[1];
    builder.selectPrebuiltTemplate(ul);

    const st = builder.getState();
    expect(st.objective).toBe('Hypertrophy');
    expect(st.algorithmId).toBe('hypertrophy_linear');
  });

  it('40. Switching repeatedly between all three templates preserves the current objective/algorithm', () => {
    const builder = createBuilderState();
    builder.setObjectiveAndAlgorithm('Strength', 'strength_linear');

    // Switch to Milhouse
    builder.selectPrebuiltTemplate(PREBUILT_TEMPLATES[0]);
    expect(builder.getState().objective).toBe('Strength');
    expect(builder.getState().algorithmId).toBe('strength_linear');

    // Switch to Upper/Lower
    builder.selectPrebuiltTemplate(PREBUILT_TEMPLATES[1]);
    expect(builder.getState().objective).toBe('Strength');
    expect(builder.getState().algorithmId).toBe('strength_linear');

    // Switch to PPL
    builder.selectPrebuiltTemplate(PREBUILT_TEMPLATES[2]);
    expect(builder.getState().objective).toBe('Strength');
    expect(builder.getState().algorithmId).toBe('strength_linear');

    // Switch back to Milhouse
    builder.selectPrebuiltTemplate(PREBUILT_TEMPLATES[0]);
    expect(builder.getState().objective).toBe('Strength');
    expect(builder.getState().algorithmId).toBe('strength_linear');
  });

  it('41. The selected template still updates name, daysPerWeek, duration, weekdays, exercise structure', () => {
    const builder = createBuilderState();
    const ppl = PREBUILT_TEMPLATES[2];
    builder.selectPrebuiltTemplate(ppl);

    const st = builder.getState();
    expect(st.name).toBe('Push Pull Legs A/B');
    expect(st.daysPerWeek).toBe(6);
    expect(st.durationWeeks).toBe(8);
    expect(st.assignedWeekdays).toEqual(ppl.assignedWeekdays);
    expect(Object.keys(st.exercisesByDay).length).toBe(6);
    expect(st.exercisesByDay[1][0].name).toBe('Barbell Bench Press (flat)');
  });

  it('42. Saving after template selection stores the preserved objective/algorithm exactly once at Program root', () => {
    const builder = createBuilderState();
    builder.setObjectiveAndAlgorithm('Strength', 'strength_linear');
    builder.selectPrebuiltTemplate(PREBUILT_TEMPLATES[0]);

    const savedProg = builder.saveProgram();
    expect(savedProg.objective).toBe('Strength');
    expect(savedProg.algorithmId).toBe('strength_linear');
    expect((savedProg as any).exercisesByDay[1][0].objective).toBeUndefined();
    expect((savedProg as any).exercisesByDay[1][0].algorithmId).toBeUndefined();
  });

  it('43. No day or exercise stores an objective/algorithm', () => {
    PREBUILT_TEMPLATES.forEach(tpl => {
      Object.entries(tpl.exercisesByDay).forEach(([dayKey, exercises]) => {
        expect((tpl as any)[dayKey]?.objective).toBeUndefined();
        expect((tpl as any)[dayKey]?.algorithmId).toBeUndefined();
        exercises.forEach(ex => {
          expect((ex as any).objective).toBeUndefined();
          expect((ex as any).algorithmId).toBeUndefined();
        });
      });
    });
  });

  it('44. Opening an existing saved program for editing still restores that programs saved objective/algorithm', () => {
    const builder = createBuilderState();
    // Currently at Hypertrophy / hypertrophy_linear
    expect(builder.getState().objective).toBe('Hypertrophy');

    // Existing saved program with Strength / strength_undulating
    const customSavedProg: Program = {
      id: 'prog-custom-123',
      name: 'My Powerlifting Program',
      daysPerWeek: 4,
      programDuration: 12,
      createdAt: '2026-08-01T00:00:00.000Z',
      exercisesByDay: { 1: [{ name: 'Back Squat', muscleGroup: 'Quads', modality: 'weighted', sets: [{ setNumber: 1, weight: 100, reps: 5 }] }] },
      assignedWeekdays: { 1: 0, 2: 1, 3: 3, 4: 4 },
      objective: 'Strength',
      algorithmId: 'strength_undulating'
    };

    builder.selectSavedProgram(customSavedProg);

    const st = builder.getState();
    expect(st.name).toBe('My Powerlifting Program');
    expect(st.objective).toBe('Strength');
    expect(st.algorithmId).toBe('strength_undulating');
    expect(st.daysPerWeek).toBe(4);
    expect(st.durationWeeks).toBe(12);
  });

  it('45. Changing the objective after selecting a template still works', () => {
    const builder = createBuilderState();
    builder.selectPrebuiltTemplate(PREBUILT_TEMPLATES[0]);
    expect(builder.getState().objective).toBe('Hypertrophy');

    // Change objective after selecting template
    builder.setObjectiveAndAlgorithm('Strength', 'strength_undulating');
    expect(builder.getState().objective).toBe('Strength');
    expect(builder.getState().algorithmId).toBe('strength_undulating');

    const saved = builder.saveProgram();
    expect(saved.objective).toBe('Strength');
    expect(saved.algorithmId).toBe('strength_undulating');
    expect(saved.name).toBe('Milhouse Mass Split');
  });

  it('46. Creating two programs from the same template under different algorithms remains independent', () => {
    const builder1 = createBuilderState();
    builder1.setObjectiveAndAlgorithm('Strength', 'strength_linear');
    builder1.selectPrebuiltTemplate(PREBUILT_TEMPLATES[0]);
    const prog1 = builder1.saveProgram();

    const builder2 = createBuilderState();
    builder2.setObjectiveAndAlgorithm('Off', 'none');
    builder2.selectPrebuiltTemplate(PREBUILT_TEMPLATES[0]);
    const prog2 = builder2.saveProgram();

    expect(prog1.objective).toBe('Strength');
    expect(prog1.algorithmId).toBe('strength_linear');
    expect(prog2.objective).toBe('Off');
    expect(prog2.algorithmId).toBe('none');
  });

  it('47. Source templates remain immutable across selections and modifications', () => {
    const sourceTpl = PREBUILT_TEMPLATES[0];
    const initialName = sourceTpl.name;
    const initialDayCount = sourceTpl.daysPerWeek;

    const builder = createBuilderState();
    builder.selectPrebuiltTemplate(sourceTpl);
    builder.setObjectiveAndAlgorithm('Off', 'none');
    const prog = builder.saveProgram();
    prog.name = 'Mutated Name';
    prog.exercisesByDay[1] = [];

    expect(sourceTpl.name).toBe(initialName);
    expect(sourceTpl.daysPerWeek).toBe(initialDayCount);
    expect(sourceTpl.exercisesByDay[1].length).toBeGreaterThan(0);
  });
});

describe('Part 7: Milhouse Mass Split 7-Exercise Balance Update Verification', () => {
  const milhouse = PREBUILT_TEMPLATES.find(t => t.id === 'prog-tpl-milhouse-mass-split')!;

  it('48. Milhouse Mass Split contains exactly 7 exercises on Day 1, 7 on Day 2, and 7 on Day 3', () => {
    expect(milhouse.exercisesByDay[1].length).toBe(7);
    expect(milhouse.exercisesByDay[2].length).toBe(7);
    expect(milhouse.exercisesByDay[3].length).toBe(7);
  });

  it('49. Day 1 has exact 7-exercise composition and order', () => {
    const day1Names = milhouse.exercisesByDay[1].map(e => e.name);
    expect(day1Names).toEqual([
      'Hack Squat (Machine)',
      'Plate-Loaded Romanian Deadlift',
      'Standing Calf Raise',
      'Smith Machine Bulgarian Split Squat',
      'Chest-Supported Row (Dumbbell)',
      'Lying Leg Curl (Machine)',
      'Plate-Loaded Shrug Machine'
    ]);
  });

  it('50. Day 2 has exact 7-exercise composition and order', () => {
    const day2Names = milhouse.exercisesByDay[2].map(e => e.name);
    expect(day2Names).toEqual([
      'Plate-Loaded Chest Press',
      'Plate-Loaded Shoulder Press',
      'Smith Machine Incline Bench Press',
      'Leg Extension',
      'Machine Lateral Raise',
      'Hip Abduction Machine',
      'Triceps Pushdown (single arm)'
    ]);
  });

  it('51. Day 3 remains exact and unchanged with 7 exercises', () => {
    const day3Names = milhouse.exercisesByDay[3].map(e => e.name);
    expect(day3Names).toEqual([
      'Diverging Lat Pulldown Machine',
      'Machine Row',
      'Pec Deck Machine Fly',
      'Reverse Pec Deck',
      'Incline Dumbbell Curl',
      'Overhead Cable Extension (Rope)',
      'Lat Pulldown (Wide)'
    ]);
  });

  it('52. Standing Leg Curl (Machine) is absent from Milhouse Day 1', () => {
    const day1Names = milhouse.exercisesByDay[1].map(e => e.name);
    expect(day1Names).not.toContain('Standing Leg Curl (Machine)');
  });

  it('53. Leg Extension is absent from Milhouse Day 1 and appears exactly once on Day 2 in position 4', () => {
    const day1Names = milhouse.exercisesByDay[1].map(e => e.name);
    expect(day1Names).not.toContain('Leg Extension');

    const day2Names = milhouse.exercisesByDay[2].map(e => e.name);
    expect(day2Names[3]).toBe('Leg Extension');
    expect(day2Names.filter(n => n === 'Leg Extension').length).toBe(1);
  });

  it('54. Glute Kickback Machine is absent from Milhouse Day 2', () => {
    const day2Names = milhouse.exercisesByDay[2].map(e => e.name);
    expect(day2Names).not.toContain('Glute Kickback Machine');
  });

  it('55. Chest-Supported Row (Dumbbell) appears exactly once on Day 1 in position 5', () => {
    const day1Names = milhouse.exercisesByDay[1].map(e => e.name);
    expect(day1Names[4]).toBe('Chest-Supported Row (Dumbbell)');
    expect(day1Names.filter(n => n === 'Chest-Supported Row (Dumbbell)').length).toBe(1);
  });

  it('56. Standing Leg Curl (Machine) and Glute Kickback Machine remain available in the default Exercise Library', () => {
    const hamstrings = (defaultExercises as any)['Hamstrings'];
    const glutes = (defaultExercises as any)['Glutes'];
    expect(hamstrings).toContain('Standing Leg Curl (Machine)');
    expect(glutes).toContain('Glute Kickback Machine');
  });

  it('57. All retained Milhouse exercises resolve to canonical Exercise Library entries with full metadata', () => {
    Object.values(milhouse.exercisesByDay).forEach(dayExercises => {
      dayExercises.forEach(ex => {
        const cat = (defaultExercises as any)[ex.muscleGroup];
        expect(cat).toBeDefined();
        expect(cat).toContain(ex.name);
        expect(ex.modality).toBeDefined();
        expect(ex.movementCategory).toBeDefined();
        expect(ex.equipment).toBeDefined();
        expect(ex.isMainMovement).toBe(false);
        expect(ex.sets.length).toBe(1);
        expect(ex.sets[0]).toEqual({
          setNumber: 1,
          weight: 0,
          reps: 0,
          rpe: 0,
          form: 'standard'
        });
      });
    });
  });

  it('58. Upper/Lower Foundations and Push Pull Legs A/B remain deeply unchanged', () => {
    const ul = PREBUILT_TEMPLATES.find(t => t.id === 'prog-tpl-upper-lower-foundations')!;
    expect(ul.daysPerWeek).toBe(4);
    expect(ul.programDuration).toBe(12);
    expect(ul.exercisesByDay[1].map(e => e.name)).toEqual([
      'Back Squat (High Bar)',
      'Deadlift (Conventional)',
      'Bulgarian Split Squat',
      'Standing Calf Raise'
    ]);

    const ppl = PREBUILT_TEMPLATES.find(t => t.id === 'prog-tpl-push-pull-legs-ab')!;
    expect(ppl.daysPerWeek).toBe(6);
    expect(ppl.programDuration).toBe(8);
    expect(ppl.exercisesByDay[6].map(e => e.name)).toEqual([
      'Deadlift (Conventional)',
      'Leg Press',
      'Bulgarian Split Squat',
      'Seated Leg Curl',
      'Seated Calf Raise'
    ]);
  });
});
