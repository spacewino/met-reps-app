/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Search, X, Dumbbell, HelpCircle, Check, Plus, Pencil, Trash2 } from 'lucide-react';
import libraryData from '../lib/defaultExerciseLibrary.json';
import { storage } from '../lib/storage';
import { useModalHistory } from '../lib/useModalHistory';
import { detectExerciseClassification, MovementCategory, EquipmentType } from '../lib/exerciseClassification';

export interface ExerciseItem {
  name: string;
  category: string;
  modality?: 'weighted' | 'bodyweight' | 'assisted' | 'distance' | 'timed' | 'distance_loaded';
  movementCategory?: MovementCategory;
  equipment?: EquipmentType;
}

interface ExerciseSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect?: (selected: ExerciseItem[]) => void;
  confirmLabel?: string;
  isManagementOnly?: boolean;
}

const getDefaultModality = (name: string): 'weighted' | 'bodyweight' | 'assisted' | 'distance' | 'timed' | 'distance_loaded' => {
  const norm = name.trim().toLowerCase();

  // 1. Explicitly weighted overrides
  if (norm.includes('weighted')) {
    return 'weighted';
  }

  // 2. Assisted
  if (norm.includes('assisted') || norm.includes('(assisted)')) {
    return 'assisted';
  }

  // 3. Distance Loaded (Loaded Carry / Push / Pull)
  if (
    norm.includes("farmer's carry") ||
    norm.includes("farmer's walk") ||
    norm.includes("farmer’s carry") ||
    norm.includes("farmer’s walk") ||
    norm.includes("sled pull") ||
    norm.includes("sled push") ||
    norm.includes("yoke walk") ||
    norm.includes("sandbag carry")
  ) {
    return 'distance_loaded';
  }

  // 4. Distance (Unloaded cardio / conditioning)
  if (
    norm.includes('treadmill') ||
    norm.includes('running') ||
    norm.includes('rowing machine') ||
    norm.includes('stationary bike') ||
    norm.includes('cycling') ||
    norm.includes('jogging')
  ) {
    return 'distance';
  }

  // 5. Timed (Duration)
  if (
    norm.includes('plank') ||
    norm.includes('hollow body hold') ||
    norm.includes('l-sit') ||
    norm.includes('wall sit') ||
    norm.includes('battle ropes') ||
    norm.includes('handstand hold')
  ) {
    return 'timed';
  }

  // 6. Bodyweight
  if (
    norm === 'push-ups' ||
    norm === 'push-up' ||
    norm.includes('push-up') ||
    norm === 'pull-up (wide grip)' ||
    norm === 'pull-ups' ||
    norm === 'pull-up' ||
    norm.includes('pull-up') ||
    norm === 'chin-up (underhand)' ||
    norm === 'chin-ups' ||
    norm === 'chin-up' ||
    norm.includes('chin-up') ||
    norm.includes('neutral-grip pull-up') ||
    norm === 'dips (parallel bar)' ||
    norm === 'bench dips' ||
    norm === 'dips (chest lean)' ||
    norm === 'dips' ||
    norm.includes('dips') ||
    norm === 'crunches' ||
    norm === 'bicycle crunch' ||
    norm === 'reverse crunch' ||
    norm === 'hanging leg raise' ||
    norm === "captain's chair leg raise" ||
    norm === 'lying leg raise' ||
    norm === 'toes-to-bar' ||
    norm === 'ab wheel rollout' ||
    norm === 'dead bug' ||
    norm === 'russian twist' ||
    norm === 'bird dog' ||
    norm === 'sissy squat' ||
    norm === 'pistol squat' ||
    norm === 'nordic hamstring curl' ||
    norm === '45° back extension (hip hinge)' ||
    norm === 'single-leg calf raise' ||
    norm === 'tibialis raise' ||
    norm === 'glute bridge' ||
    norm === 'burpees' ||
    norm === 'air squat' ||
    norm === 'inverted row' ||
    norm === 'bodyweight squat'
  ) {
    return 'bodyweight';
  }

  return 'weighted';
};

const typedLibrary = libraryData as Record<string, string[]>;

// Helper function to update existing exercise records across all stored data when exercise attributes are edited
const migrateExerciseDetails = (oldName: string, newName: string, newModality: any, newCategory: string) => {
  const oldNameNorm = oldName.trim().toLowerCase();
  const newNameNorm = newName.trim();

  // 1. Migrate Workout Logs
  try {
    const logsStr = localStorage.getItem('workoutLogs');
    if (logsStr) {
      const logs = JSON.parse(logsStr);
      let updatedAny = false;
      logs.forEach((log: any) => {
        if (log.exercises && Array.isArray(log.exercises)) {
          log.exercises.forEach((ex: any) => {
            if (ex.name && ex.name.trim().toLowerCase() === oldNameNorm) {
              ex.name = newNameNorm;
              ex.modality = newModality;
              ex.muscleGroup = newCategory;
              updatedAny = true;
            }
          });
        }
      });
      if (updatedAny) {
        localStorage.setItem('workoutLogs', JSON.stringify(logs));
      }
    }
  } catch (err) {
    console.error('Error migrating workout logs:', err);
  }

  // 2. Migrate Programs
  try {
    const programsStr = localStorage.getItem('programList');
    if (programsStr) {
      const programs = JSON.parse(programsStr);
      let updatedAny = false;
      programs.forEach((prog: any) => {
        if (prog.exercisesByDay) {
          Object.keys(prog.exercisesByDay).forEach((dayKey) => {
            const exercises = prog.exercisesByDay[dayKey];
            if (Array.isArray(exercises)) {
              exercises.forEach((ex: any) => {
                if (ex.name && ex.name.trim().toLowerCase() === oldNameNorm) {
                  ex.name = newNameNorm;
                  ex.modality = newModality;
                  ex.muscleGroup = newCategory;
                  updatedAny = true;
                }
              });
            }
          });
        }
      });
      if (updatedAny) {
        localStorage.setItem('programList', JSON.stringify(programs));
      }
    }
  } catch (err) {
    console.error('Error migrating program list:', err);
  }

  // 3. Migrate active workout draft
  try {
    const draftStr = localStorage.getItem('metreps_workout_draft');
    if (draftStr) {
      const draft = JSON.parse(draftStr);
      let updatedAny = false;
      if (draft.exercises && Array.isArray(draft.exercises)) {
        draft.exercises.forEach((ex: any) => {
          if (ex.name && ex.name.trim().toLowerCase() === oldNameNorm) {
            ex.name = newNameNorm;
            ex.modality = newModality;
            ex.muscleGroup = newCategory;
            updatedAny = true;
          }
        });
      }
      if (updatedAny) {
        localStorage.setItem('metreps_workout_draft', JSON.stringify(draft));
      }
    }
  } catch (err) {
    console.error('Error migrating workout draft:', err);
  }
};

export function ExerciseSelectorModal({ isOpen, onClose, onSelect, confirmLabel, isManagementOnly = false }: ExerciseSelectorModalProps) {
  const { dismiss, dismissWithoutCallback } = useModalHistory(isOpen, onClose, 'exercise-selector-modal');

  const themeId = storage.getTheme();
  const isAmber = themeId === 'amber';
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  
  // Selection state
  const [checkedExercises, setCheckedExercises] = useState<ExerciseItem[]>(() => {
    try {
      const saved = localStorage.getItem('metreps_checked_exercises');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Persist checks to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('metreps_checked_exercises', JSON.stringify(checkedExercises));
    } catch (e) {
      console.error(e);
    }
  }, [checkedExercises]);

  // Clear checks on close
  useEffect(() => {
    if (!isOpen) {
      setCheckedExercises([]);
      try {
        localStorage.removeItem('metreps_checked_exercises');
      } catch (_) {}
    }
  }, [isOpen]);
  
  // Custom exercise creation state
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customCategory, setCustomCategory] = useState('Quads');
  const [customModality, setCustomModality] = useState<'weighted' | 'bodyweight' | 'assisted' | 'timed' | 'distance_loaded' | 'distance'>('weighted');
  const [customMovementCategory, setCustomMovementCategory] = useState<MovementCategory>('compound');
  const [customEquipment, setCustomEquipment] = useState<EquipmentType>('freeweight');
  const [isMovementTouched, setIsMovementTouched] = useState(false);
  const [isEquipmentTouched, setIsEquipmentTouched] = useState(false);
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);

  // Editing state
  const [editingExercise, setEditingExercise] = useState<({ originalName: string; originalCategory: string } & ExerciseItem) | null>(null);

  // Hidden defaults state
  const [hiddenDefaults, setHiddenDefaults] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('metreps_hidden_defaults');
      return saved ? JSON.parse(saved) : [];
    } catch (_) {
      return [];
    }
  });

  // Load custom exercises from localStorage
  const [customExercises, setCustomExercises] = useState<ExerciseItem[]>(() => {
    try {
      const saved = localStorage.getItem('metreps_custom_exercises');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const listRef = useRef<HTMLDivElement>(null);

  // Dynamic context-aware heuristics sync
  useEffect(() => {
    if (isCustomMode) {
      const detected = detectExerciseClassification(customName, customModality);
      if (!isMovementTouched) {
        setCustomMovementCategory(detected.category);
      }
      if (!isEquipmentTouched) {
        setCustomEquipment(detected.equipment);
      }
    }
  }, [customName, customModality, isCustomMode, isMovementTouched, isEquipmentTouched]);

  // Reset local state on open
  useEffect(() => {
    if (isOpen) {
      setIsCustomMode(false);
      setCustomName('');
      setCustomModality('weighted');
      setIsMovementTouched(false);
      setIsEquipmentTouched(false);
      setIsCategoryDropdownOpen(false);
      setEditingExercise(null);
      setSearchQuery('');
      setSelectedCategory('All');
      setTimeout(() => {
        if (listRef.current) {
          listRef.current.scrollTop = 0;
        }
      }, 50);
    }
  }, [isOpen]);

  // Scroll to top when category changes
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [selectedCategory]);

  const categories = useMemo(() => {
    const defaultCats = Object.keys(typedLibrary);
    const customCats = customExercises.map(ex => ex.category);
    const allCats = Array.from(new Set([...defaultCats, ...customCats]));
    return ['All', ...allCats];
  }, [customExercises]);

  const filteredExercises = useMemo(() => {
    const results: ExerciseItem[] = [];

    // Add custom exercises first
    customExercises.forEach(ex => {
      const matchesSearch = ex.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            ex.category.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = selectedCategory === 'All' || selectedCategory === ex.category;

      if (matchesSearch && matchesCategory) {
        const detected = detectExerciseClassification(ex.name, ex.modality);
        results.push({
          ...ex,
          movementCategory: ex.movementCategory || detected.category,
          equipment: ex.equipment || detected.equipment
        });
      }
    });

    // Add default library exercises
    Object.entries(typedLibrary).forEach(([category, exercises]) => {
      exercises.forEach(ex => {
        const matchesSearch = ex.toLowerCase().includes(searchQuery.toLowerCase()) || 
                              category.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesCategory = selectedCategory === 'All' || selectedCategory === category;

        // Prevent duplication of custom overrides
        const alreadyAdded = results.some(r => r.name.toLowerCase() === ex.toLowerCase());
        const isHidden = hiddenDefaults.includes(ex.toLowerCase());

        if (matchesSearch && matchesCategory && !alreadyAdded && !isHidden) {
          const mod = getDefaultModality(ex);
          const detected = detectExerciseClassification(ex, mod);
          results.push({
            name: ex,
            category,
            modality: mod,
            movementCategory: detected.category,
            equipment: detected.equipment
          });
        }
      });
    });

    return results;
  }, [searchQuery, selectedCategory, customExercises, hiddenDefaults]);

  if (!isOpen) return null;

  const handleToggleChecked = (ex: ExerciseItem) => {
    setCheckedExercises(prev => {
      const isAlreadyChecked = prev.some(item => item.name === ex.name);
      if (isAlreadyChecked) {
        return prev.filter(item => item.name !== ex.name);
      } else {
        const detected = detectExerciseClassification(ex.name, ex.modality);
        return [...prev, {
          name: ex.name,
          category: ex.category,
          modality: ex.modality,
          movementCategory: ex.movementCategory || detected.category,
          equipment: ex.equipment || detected.equipment
        }];
      }
    });
  };

  const handleDeleteCustom = (name: string) => {
    if (confirm(`Are you sure you want to delete custom exercise "${name}"?`)) {
      const updatedCustoms = customExercises.filter(c => c.name.toLowerCase() !== name.toLowerCase());
      setCustomExercises(updatedCustoms);
      try {
        localStorage.setItem('metreps_custom_exercises', JSON.stringify(updatedCustoms));
      } catch (e) {
        console.error(e);
      }
      setCheckedExercises(prev => prev.filter(item => item.name.toLowerCase() !== name.toLowerCase()));
    }
  };

  const handleStartEdit = (ex: ExerciseItem) => {
    const detected = detectExerciseClassification(ex.name, ex.modality);
    const moveCat = ex.movementCategory || detected.category;
    const eqType = ex.equipment || detected.equipment;

    setEditingExercise({
      originalName: ex.name,
      originalCategory: ex.category,
      name: ex.name,
      category: ex.category,
      modality: ex.modality || 'weighted',
      movementCategory: moveCat,
      equipment: eqType
    });
    setCustomName(ex.name);
    setCustomCategory(ex.category);
    setCustomModality((ex.modality as any) || 'weighted');
    setCustomMovementCategory(moveCat);
    setCustomEquipment(eqType);
    setIsMovementTouched(!!ex.movementCategory);
    setIsEquipmentTouched(!!ex.equipment);
    setIsCustomMode(true);
  };

  return (
    <div 
      className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-start justify-center p-0 sm:p-4 md:pt-8"
      onClick={dismiss}
    >
      <div 
        className="bg-slate-900 border border-slate-800 rounded-none w-full max-w-md md:max-w-xl overflow-hidden flex flex-col h-[90vh] md:h-[80vh] shadow-2xl shadow-indigo-950/30 animate-in slide-in-from-top-5 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-850 flex items-center justify-between shrink-0 bg-slate-900 font-sans">
          <div>
            <h3 className="text-[18px] font-black text-white uppercase tracking-wider flex items-center gap-1.5">
              <Dumbbell className="w-5 h-5 text-indigo-400" />
              {isCustomMode ? (editingExercise ? 'Edit Custom Exercise' : 'New Custom Exercise') : 'Exercise Library'}
            </h3>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">
              {isCustomMode ? 'Define exercise parameters' : isManagementOnly ? 'Add, edit, or customize exercises' : 'Browse & Select Exercises'}
            </p>
          </div>
          <button
            onClick={() => {
              dismissWithoutCallback();
              onClose();
            }}
            className="p-2 text-slate-400 hover:text-white rounded-none border border-slate-800 bg-slate-950 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search & Category Filter Bar (Only when browsing library) */}
        {!isCustomMode && (
          <div className="p-3 border-b border-slate-850 bg-slate-900/90 space-y-2.5 shrink-0 font-sans">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search exercises by name or muscle group..."
                className="w-full bg-slate-950 border border-slate-850 text-slate-200 text-xs pl-9 pr-8 py-2.5 rounded-none focus:outline-none focus:border-indigo-500/60 placeholder-slate-600 font-bold"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Muscle Group Category Pills */}
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              {categories.map(cat => {
                const isSelected = selectedCategory === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-wider rounded-none whitespace-nowrap transition cursor-pointer border ${
                      isSelected
                        ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                        : 'bg-slate-950 text-slate-400 border-slate-850 hover:text-slate-200 hover:border-slate-800'
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Content Area */}
        {isCustomMode ? (
          <div className="flex-1 overflow-y-auto p-4 space-y-4 font-sans bg-slate-950/20">
            <div className="space-y-1.5">
              <label className="text-[10px] text-indigo-400 font-black uppercase tracking-wider">Exercise Name</label>
              <input
                type="text"
                value={customName}
                onChange={e => setCustomName(e.target.value)}
                placeholder="e.g. Incline DB Bench Press, Belt Squat, Cable Lateral Raise"
                className="w-full bg-slate-950 border border-slate-850 text-white px-3.5 py-3 rounded-none text-xs font-bold focus:outline-none focus:border-indigo-500/60 placeholder-slate-600"
                autoFocus
              />
            </div>

            <div className="space-y-1.5 relative">
              <label className="text-[10px] text-indigo-400 font-black uppercase tracking-wider">Primary Muscle Group</label>
              <button
                type="button"
                onClick={() => setIsCategoryDropdownOpen(!isCategoryDropdownOpen)}
                className="w-full bg-slate-950 border border-slate-850 text-white px-3.5 py-3 rounded-none text-xs font-bold flex items-center justify-between cursor-pointer"
              >
                <span>{customCategory}</span>
                <span className="text-[10px] text-slate-500 font-mono">▼</span>
              </button>

              {isCategoryDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setIsCategoryDropdownOpen(false)} />
                  <div className="absolute top-full left-0 right-0 mt-1 bg-slate-950 border border-slate-800 rounded-none shadow-xl z-20 max-h-48 overflow-y-auto">
                    {categories.filter(c => c !== 'All').map(cat => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => {
                          setCustomCategory(cat);
                          setIsCategoryDropdownOpen(false);
                        }}
                        className={`w-full text-left px-4 py-2.5 text-xs font-bold border-y border-transparent cursor-pointer transition ${
                          customCategory === cat
                            ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30'
                            : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] text-indigo-400 font-black uppercase tracking-wider">Modality / Metric Type</label>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { value: 'weighted', label: 'Weight', desc: 'Weight + Reps' },
                  { value: 'bodyweight', label: 'Bodyweight', desc: 'Reps Only' },
                  { value: 'assisted', label: 'Assist', desc: 'Assist Weight + Reps' },
                  { value: 'timed', label: 'Duration', desc: 'Time (Secs)' },
                  { value: 'distance_loaded', label: 'Loaded Dist', desc: 'Weight + Meters' },
                  { value: 'distance', label: 'Distance', desc: 'Meters + Time (Secs)' }
                ].map(mod => {
                  const isSelected = customModality === mod.value;
                  return (
                    <button
                      key={mod.value}
                      type="button"
                      onClick={() => setCustomModality(mod.value as any)}
                      className={`p-2 rounded-none text-left border flex flex-col justify-center transition min-h-[48px] ${
                        isSelected
                          ? 'bg-indigo-950/40 border-indigo-500/60 text-indigo-300'
                          : 'bg-slate-950 border-slate-850 text-slate-400 hover:text-slate-300 hover:border-slate-800'
                      }`}
                    >
                      <span className="text-[9px] font-black uppercase tracking-wider">{mod.label}</span>
                      <span className="text-[8px] text-slate-500 font-bold tracking-normal leading-tight">{mod.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Movement Classification Row */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-indigo-400 font-black uppercase tracking-wider">Movement Classification</label>
                {!isMovementTouched && (
                  <span className="text-[9px] text-cyan-400 font-medium italic">Auto-detected</span>
                )}
              </div>
              <div className="bg-slate-950 p-1 rounded-none border border-slate-850 flex gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setCustomMovementCategory('compound');
                    setIsMovementTouched(true);
                  }}
                  className={`flex-1 py-2 px-2 text-center transition min-h-[40px] flex flex-col items-center justify-center cursor-pointer ${
                    customMovementCategory === 'compound'
                      ? 'bg-indigo-950/60 border border-indigo-500/70 text-indigo-300 font-black'
                      : 'bg-transparent border border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900 font-bold'
                  }`}
                >
                  <span className="text-[10px] uppercase tracking-wider">Compound</span>
                  <span className="text-[8px] opacity-75">Multi-joint</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCustomMovementCategory('isolation');
                    setIsMovementTouched(true);
                  }}
                  className={`flex-1 py-2 px-2 text-center transition min-h-[40px] flex flex-col items-center justify-center cursor-pointer ${
                    customMovementCategory === 'isolation'
                      ? 'bg-pink-950/60 border border-pink-500/70 text-pink-300 font-black'
                      : 'bg-transparent border border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900 font-bold'
                  }`}
                >
                  <span className="text-[10px] uppercase tracking-wider">Isolation</span>
                  <span className="text-[8px] opacity-75">Single-joint</span>
                </button>
              </div>
            </div>

            {/* Equipment Type Row */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-indigo-400 font-black uppercase tracking-wider">Equipment Type</label>
                {!isEquipmentTouched && (
                  <span className="text-[9px] text-cyan-400 font-medium italic">Auto-detected</span>
                )}
              </div>
              <div className="bg-slate-950 p-1 rounded-none border border-slate-850 flex gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setCustomEquipment('freeweight');
                    setIsEquipmentTouched(true);
                  }}
                  className={`flex-1 py-2 px-2 text-center transition min-h-[40px] flex flex-col items-center justify-center cursor-pointer ${
                    customEquipment === 'freeweight'
                      ? 'bg-indigo-950/60 border border-indigo-500/70 text-indigo-300 font-black'
                      : 'bg-transparent border border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900 font-bold'
                  }`}
                >
                  <span className="text-[10px] uppercase tracking-wider">Free Weight</span>
                  <span className="text-[8px] opacity-75">Barbell / Dumbbell</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCustomEquipment('machine');
                    setIsEquipmentTouched(true);
                  }}
                  className={`flex-1 py-2 px-2 text-center transition min-h-[40px] flex flex-col items-center justify-center cursor-pointer ${
                    customEquipment === 'machine'
                      ? 'bg-cyan-950/60 border border-cyan-500/70 text-cyan-300 font-black'
                      : 'bg-transparent border border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900 font-bold'
                  }`}
                >
                  <span className="text-[10px] uppercase tracking-wider">Machine / Cable</span>
                  <span className="text-[8px] opacity-75">Selectorized / Lever</span>
                </button>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsCustomMode(false);
                  setCustomName('');
                  setIsMovementTouched(false);
                  setIsEquipmentTouched(false);
                  setEditingExercise(null);
                }}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-black text-xs py-3.5 rounded-none transition cursor-pointer uppercase tracking-wider"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!customName.trim()) {
                    alert('Please enter an exercise name!');
                    return;
                  }
                  const formattedName = customName.trim();
                  const newEx: ExerciseItem = { 
                    name: formattedName, 
                    category: customCategory,
                    modality: customModality,
                    movementCategory: customMovementCategory,
                    equipment: customEquipment
                  };
                  
                  let updatedCustoms = [...customExercises];

                  if (editingExercise) {
                    const oldName = editingExercise.name;
                    const isOldDefault = !customExercises.some(c => c.name.toLowerCase() === oldName.toLowerCase());

                    if (isOldDefault) {
                      if (oldName.toLowerCase() !== formattedName.toLowerCase()) {
                        const updatedHidden = [...hiddenDefaults, oldName.toLowerCase()];
                        setHiddenDefaults(updatedHidden);
                        try {
                          localStorage.setItem('metreps_hidden_defaults', JSON.stringify(updatedHidden));
                        } catch (e) {
                          console.error(e);
                        }
                      }
                      updatedCustoms = [newEx, ...updatedCustoms];
                    } else {
                      const idx = updatedCustoms.findIndex(c => c.name.toLowerCase() === oldName.toLowerCase());
                      if (idx >= 0) {
                        updatedCustoms[idx] = newEx;
                      } else {
                        updatedCustoms = [newEx, ...updatedCustoms];
                      }
                    }

                    // Run data migrations if name, category or modality changed
                    if (
                      oldName.toLowerCase() !== formattedName.toLowerCase() ||
                      editingExercise.modality !== customModality ||
                      editingExercise.category !== customCategory
                    ) {
                      migrateExerciseDetails(oldName, formattedName, customModality, customCategory);
                    }

                    // Auto-check logic
                    setCheckedExercises(prev => {
                      const filtered = prev.filter(item => item.name.toLowerCase() !== oldName.toLowerCase());
                      if (filtered.some(item => item.name.toLowerCase() === formattedName.toLowerCase())) {
                        return filtered;
                      }
                      return [...filtered, newEx];
                    });

                  } else {
                    // Normal custom creation
                    updatedCustoms = [newEx, ...updatedCustoms];
                    setCheckedExercises(prev => {
                      if (prev.some(item => item.name.toLowerCase() === formattedName.toLowerCase())) return prev;
                      return [...prev, newEx];
                    });
                  }

                  setCustomExercises(updatedCustoms);
                  try {
                    localStorage.setItem('metreps_custom_exercises', JSON.stringify(updatedCustoms));
                  } catch (e) {
                    console.error(e);
                  }

                  // Reset and exit custom mode
                  setCustomName('');
                  setIsMovementTouched(false);
                  setIsEquipmentTouched(false);
                  setEditingExercise(null);
                  setIsCustomMode(false);
                }}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-[#FBFAF8] font-black text-xs py-3.5 rounded-none transition cursor-pointer uppercase tracking-wider"
              >
                {editingExercise ? 'Save Changes' : 'Add & Select'}
              </button>
            </div>
          </div>
        ) : (
          <div ref={listRef} className="flex-1 overflow-y-auto space-y-1 bg-slate-950/20 scrollbar-none font-sans">
            {filteredExercises.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-6 text-center space-y-4">
                <HelpCircle className="w-8 h-8 text-slate-700 animate-pulse" />
                <div>
                  <p className="text-xs text-slate-400 font-bold">No matching exercises found</p>
                  <p className="text-[10px] text-slate-600 font-mono mt-1">
                    {searchQuery ? `"${searchQuery}" is not in the library. You can create a custom exercise with this name instantly.` : 'Try checking spelling or create a custom entry.'}
                  </p>
                </div>
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setCustomName(searchQuery);
                      setCustomCategory(selectedCategory === 'All' ? 'Quads' : selectedCategory);
                      setCustomModality('weighted');
                      setIsMovementTouched(false);
                      setIsEquipmentTouched(false);
                      setIsCustomMode(true);
                    }}
                    className={`px-4 py-2.5 rounded-none text-xs font-black uppercase tracking-wider transition flex items-center gap-1.5 shadow cursor-pointer text-[#FBFAF8] ${
                      isAmber 
                        ? 'bg-amber-600 hover:bg-amber-500 border border-amber-700 shadow-amber-950/20' 
                        : 'bg-indigo-600 hover:bg-indigo-500 border border-indigo-700 shadow-indigo-950/40'
                    }`}
                  >
                    <Plus className="w-4 h-4 font-black" /> Create Custom: "{searchQuery}"
                  </button>
                )}
              </div>
            ) : (
              filteredExercises.map((ex, idx) => {
                const isChecked = checkedExercises.some(item => item.name === ex.name);
                const isCustom = customExercises.some(c => c.name.toLowerCase() === ex.name.toLowerCase());
                return (
                  <div
                    key={idx}
                    className={`w-full p-3.5 flex items-center justify-between gap-2 border-y border-x-0 ${
                      !isManagementOnly && isChecked
                        ? 'bg-indigo-950/20 border-indigo-500/50 hover:bg-indigo-950/30'
                        : 'bg-slate-900 border-slate-850 hover:bg-slate-850/50 hover:border-slate-800'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (isManagementOnly) {
                          handleStartEdit(ex);
                        } else {
                          handleToggleChecked(ex);
                        }
                      }}
                      className="flex-1 text-left focus:outline-none cursor-pointer"
                    >
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h4 className={`text-xs font-black uppercase tracking-wide transition ${
                            !isManagementOnly && isChecked ? 'text-indigo-300' : 'text-slate-200 group-hover:text-white'
                          }`}>
                            {ex.name}
                          </h4>
                          {ex.modality && ex.modality !== 'weighted' && (
                            <span className="text-[8px] font-mono font-extrabold px-1.5 py-0.5 rounded-none bg-indigo-500/15 text-indigo-400 border border-indigo-500/20 uppercase tracking-widest shrink-0">
                              {ex.modality === 'timed' ? 'Duration' : ex.modality}
                            </span>
                          )}
                          {ex.movementCategory === 'isolation' ? (
                            <span className="text-[8px] font-mono font-extrabold px-1.5 py-0.5 rounded-none bg-pink-500/15 text-pink-400 border border-pink-500/20 uppercase tracking-widest shrink-0">
                              Isolation
                            </span>
                          ) : (
                            <span className="text-[8px] font-mono font-extrabold px-1.5 py-0.5 rounded-none bg-indigo-500/15 text-indigo-300 border border-indigo-500/20 uppercase tracking-widest shrink-0">
                              Compound
                            </span>
                          )}
                          {ex.equipment === 'machine' ? (
                            <span className="text-[8px] font-mono font-extrabold px-1.5 py-0.5 rounded-none bg-cyan-500/15 text-cyan-400 border border-cyan-500/20 uppercase tracking-widest shrink-0">
                              Machine
                            </span>
                          ) : (
                            <span className="text-[8px] font-mono font-extrabold px-1.5 py-0.5 rounded-none bg-slate-800 text-slate-300 border border-slate-700/80 uppercase tracking-widest shrink-0">
                              Free Weight
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider font-mono">
                          {ex.category}
                        </span>
                      </div>
                    </button>

                    <div className="flex items-center gap-1.5">
                      {isCustom && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteCustom(ex.name);
                          }}
                          className="p-2 rounded-none border border-slate-800 bg-slate-950 text-slate-500 hover:text-rose-400 hover:border-rose-500/30 transition cursor-pointer"
                          title="Delete Custom Exercise"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartEdit(ex);
                        }}
                        className="p-2 rounded-none border border-slate-800 bg-slate-950 text-slate-500 hover:text-indigo-400 hover:border-indigo-500/30 transition cursor-pointer"
                        title="Edit Exercise"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>

                      {!isManagementOnly && (
                        <button
                          type="button"
                          onClick={() => handleToggleChecked(ex)}
                          className={`p-2 rounded-none border transition cursor-pointer ${
                            isChecked
                              ? 'bg-indigo-600 border-indigo-500 text-white'
                              : 'bg-slate-950 border-slate-850 text-transparent hover:text-slate-600'
                          }`}
                        >
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Footer Bar */}
        <div className="p-3 bg-slate-900 border-t border-slate-850 flex items-center justify-between shrink-0 font-sans">
          {!isCustomMode && (
            <>
              <button
                type="button"
                onClick={() => {
                  setCustomName(searchQuery);
                  setCustomCategory(selectedCategory === 'All' ? 'Quads' : selectedCategory);
                  setCustomModality('weighted');
                  setIsMovementTouched(false);
                  setIsEquipmentTouched(false);
                  setIsCustomMode(true);
                }}
                className={`text-xs font-black uppercase tracking-wider flex items-center gap-1 transition cursor-pointer ${
                  isAmber ? 'text-amber-400 hover:text-amber-300' : 'text-indigo-400 hover:text-indigo-300'
                }`}
              >
                <Plus className="w-3.5 h-3.5" /> Add Custom Exercise
              </button>
              
              {isManagementOnly ? (
                <button
                  type="button"
                  onClick={() => {
                    dismissWithoutCallback();
                    onClose();
                  }}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-none text-xs font-black uppercase tracking-wider transition cursor-pointer shadow shadow-indigo-950/50 font-sans font-black"
                >
                  Done
                </button>
              ) : (
                <button
                  type="button"
                  disabled={checkedExercises.length === 0}
                  onClick={() => {
                    dismissWithoutCallback();
                    if (onSelect) {
                      onSelect(checkedExercises);
                    }
                    onClose();
                  }}
                  className={`px-4 py-2.5 rounded-none text-xs font-black uppercase tracking-wider transition flex items-center gap-1.5 ${
                    checkedExercises.length > 0
                      ? 'bg-indigo-600 hover:bg-indigo-500 text-[#FBFAF8] shadow-md shadow-indigo-950/50 cursor-pointer'
                      : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  {confirmLabel ? `${confirmLabel} (${checkedExercises.length})` : `Add to Workout (${checkedExercises.length})`}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
