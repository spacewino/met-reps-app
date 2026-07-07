/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Search, X, Dumbbell, Sparkles, Check, Plus, Pencil } from 'lucide-react';
import libraryData from '../lib/defaultExerciseLibrary.json';

interface ExerciseSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (selected: { name: string; category: string; modality?: 'weighted' | 'bodyweight' | 'assisted' | 'distance' | 'timed' }[]) => void;
}

const typedLibrary = libraryData as Record<string, string[]>;

const migrateExerciseDetails = (
  oldName: string,
  newName: string,
  newModality: 'weighted' | 'bodyweight' | 'assisted' | 'distance' | 'timed',
  newCategory: string
) => {
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

export function ExerciseSelectorModal({ isOpen, onClose, onSelect }: ExerciseSelectorModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  
  // Selection state
  const [checkedExercises, setCheckedExercises] = useState<{ name: string; category: string; modality?: 'weighted' | 'bodyweight' | 'assisted' | 'distance' | 'timed' }[]>(() => {
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
  const [customModality, setCustomModality] = useState<'weighted' | 'bodyweight' | 'assisted' | 'timed'>('weighted');
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);

  // Editing state
  const [editingExercise, setEditingExercise] = useState<{ originalName: string; originalCategory: string; name: string; category: string; modality?: 'weighted' | 'bodyweight' | 'assisted' | 'distance' | 'timed' } | null>(null);

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
  const [customExercises, setCustomExercises] = useState<{ name: string; category: string; modality?: 'weighted' | 'bodyweight' | 'assisted' | 'distance' | 'timed' }[]>(() => {
    try {
      const saved = localStorage.getItem('metreps_custom_exercises');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const listRef = useRef<HTMLDivElement>(null);

  // Reset local state on open
  useEffect(() => {
    if (isOpen) {
      setIsCustomMode(false);
      setCustomName('');
      setCustomModality('weighted');
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
    const results: { name: string; category: string; modality?: 'weighted' | 'bodyweight' | 'assisted' | 'distance' | 'timed' }[] = [];

    // Add custom exercises first
    customExercises.forEach(ex => {
      const matchesSearch = ex.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            ex.category.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = selectedCategory === 'All' || selectedCategory === ex.category;

      if (matchesSearch && matchesCategory) {
        results.push(ex);
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
          results.push({ name: ex, category, modality: 'weighted' });
        }
      });
    });

    return results;
  }, [searchQuery, selectedCategory, customExercises, hiddenDefaults]);

  if (!isOpen) return null;

  const handleToggleChecked = (name: string, category: string, modality?: 'weighted' | 'bodyweight' | 'assisted' | 'distance' | 'timed') => {
    setCheckedExercises(prev => {
      const isAlreadyChecked = prev.some(item => item.name === name);
      if (isAlreadyChecked) {
        return prev.filter(item => item.name !== name);
      } else {
        return [...prev, { name, category, modality }];
      }
    });
  };

  const handleStartEdit = (ex: { name: string; category: string; modality?: 'weighted' | 'bodyweight' | 'assisted' | 'distance' | 'timed' }) => {
    setEditingExercise({
      originalName: ex.name,
      originalCategory: ex.category,
      name: ex.name,
      category: ex.category,
      modality: ex.modality || 'weighted'
    });
    setCustomName(ex.name);
    setCustomCategory(ex.category);
    setCustomModality((ex.modality as any) || 'weighted');
    setIsCustomMode(true);
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-start justify-center p-0 sm:p-4 md:pt-8">
      <div 
        className="bg-slate-900 border border-slate-800 rounded-none w-full max-w-md md:max-w-xl overflow-hidden flex flex-col h-[90vh] md:h-[80vh] shadow-2xl shadow-indigo-950/30 animate-in slide-in-from-top-5 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-850 flex items-center justify-between shrink-0 bg-slate-900 font-sans">
          <div>
            <h3 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-1.5">
              <Dumbbell className="w-4 h-4 text-indigo-400" />
              {isCustomMode ? (editingExercise ? 'Edit Custom Exercise' : 'New Custom Exercise') : 'Exercise Library'}
            </h3>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest font-mono">
              {isCustomMode ? 'Define exercise parameters' : 'Browse & Select Exercises'}
            </p>
          </div>
          <button
            onClick={isCustomMode ? () => {
              setIsCustomMode(false);
              setCustomName('');
              setEditingExercise(null);
            } : onClose}
            className="p-2 hover:bg-slate-800 rounded-none text-slate-400 hover:text-white transition border border-slate-800 bg-slate-950 text-xs font-black uppercase tracking-wider"
            title={isCustomMode ? "Back to library" : "Close"}
          >
            {isCustomMode ? (
              <span className="px-1 text-[10px]">Back</span>
            ) : (
              <X className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Search Input (Hidden in Custom Mode) */}
        {!isCustomMode && (
          <div className="p-3 bg-slate-950/40 border-b border-slate-850/60 shrink-0">
            <div className="relative flex items-center bg-slate-950 rounded-none border border-slate-850 px-3 h-11 focus-within:border-indigo-500 transition">
              <Search className="w-4 h-4 text-slate-500 mr-2 shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search exercise or muscle..."
                className="bg-transparent text-sm font-semibold text-white w-full focus:outline-none placeholder-slate-600 font-sans"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="text-xs text-slate-500 hover:text-white font-black uppercase font-sans pr-1"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        )}

        {/* Muscle Categories Pills */}
        {!isCustomMode && (
          <div className="px-3 py-2 border-b-2 border-indigo-500/40 shrink-0 flex flex-wrap gap-1.5 bg-slate-950/10 max-h-[85px] overflow-y-auto scrollbar-thin">
            {categories.map(cat => {
              const isSelected = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-2 py-1 rounded-none text-[9px] font-black uppercase tracking-wider transition shrink-0 border ${
                    isSelected
                      ? 'bg-indigo-600 border-indigo-500 text-white shadow-sm shadow-indigo-950/30'
                      : 'bg-slate-950 border-slate-850 text-slate-400 hover:text-slate-200 hover:border-slate-800'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        )}

        {/* Content Body */}
        {isCustomMode ? (
          <div className="flex-1 p-4 space-y-4 bg-slate-950/20 overflow-y-auto font-sans">
            <div className="space-y-1.5">
              <label className="text-[10px] text-indigo-400 font-black uppercase tracking-wider">Exercise Name</label>
              <input
                type="text"
                value={customName}
                onChange={e => setCustomName(e.target.value)}
                placeholder="e.g. Pull-Ups"
                className="w-full bg-slate-950 border border-slate-800 rounded-none px-3 text-sm font-semibold text-white focus:outline-none focus:border-indigo-500 h-11"
              />
            </div>
            
            <div className="space-y-1.5 relative">
              <label className="text-[10px] text-indigo-400 font-black uppercase tracking-wider">Muscle Group</label>
              <button
                type="button"
                onClick={() => setIsCategoryDropdownOpen(!isCategoryDropdownOpen)}
                className="w-full bg-slate-950 border border-slate-800 rounded-none px-3 text-sm font-semibold text-slate-200 focus:outline-none focus:border-indigo-500 h-11 flex items-center justify-between cursor-pointer hover:bg-slate-900 transition"
              >
                <span>{customCategory}</span>
                <span className="text-[8px] text-slate-500">▼</span>
              </button>
              {isCategoryDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsCategoryDropdownOpen(false)} />
                  <div className="absolute left-0 right-0 top-[66px] bg-slate-950 border border-slate-800 rounded-none shadow-2xl z-50 overflow-y-auto max-h-48 py-1 font-sans">
                    {Object.keys(typedLibrary).map(cat => (
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
                  { value: 'timed', label: 'Duration', desc: 'Time (Secs) + Reps' }
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

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsCustomMode(false);
                  setCustomName('');
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
                  const newEx: { name: string; category: string; modality: 'weighted' | 'bodyweight' | 'assisted' | 'distance' | 'timed' } = { 
                    name: formattedName, 
                    category: customCategory,
                    modality: customModality
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
                  setEditingExercise(null);
                  setIsCustomMode(false);
                }}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs py-3.5 rounded-none transition cursor-pointer uppercase tracking-wider"
              >
                {editingExercise ? 'Save Changes' : 'Add & Select'}
              </button>
            </div>
          </div>
        ) : (
          <div ref={listRef} className="flex-1 overflow-y-auto space-y-1 bg-slate-950/20 scrollbar-none font-sans">
            {filteredExercises.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center space-y-2">
                <Sparkles className="w-6 h-6 text-slate-700" />
                <p className="text-xs text-slate-500 font-bold">No matching exercises found</p>
                <p className="text-[10px] text-slate-600">Try checking spelling or create a custom entry.</p>
              </div>
            ) : (
              filteredExercises.map((ex, idx) => {
                const isChecked = checkedExercises.some(item => item.name === ex.name);
                return (
                  <div
                    key={idx}
                    className={`w-full p-3.5 flex items-center justify-between gap-2 border-y border-x-0 ${
                      isChecked
                        ? 'bg-indigo-950/20 border-indigo-500/50 hover:bg-indigo-950/30'
                        : 'bg-slate-900 border-slate-850 hover:bg-slate-850/50 hover:border-slate-800'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleToggleChecked(ex.name, ex.category, ex.modality)}
                      className="flex-1 text-left focus:outline-none cursor-pointer"
                    >
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h4 className={`text-xs font-black uppercase tracking-wide transition ${
                            isChecked ? 'text-indigo-300' : 'text-slate-200 group-hover:text-white'
                          }`}>
                            {ex.name}
                          </h4>
                          {ex.modality && ex.modality !== 'weighted' && (
                            <span className="text-[8px] font-mono font-extrabold px-1.5 py-0.5 rounded-none bg-indigo-500/15 text-indigo-400 border border-indigo-500/20 uppercase tracking-widest shrink-0">
                              {ex.modality === 'timed' ? 'Duration' : ex.modality}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider font-mono">
                          {ex.category}
                        </span>
                      </div>
                    </button>

                    <div className="flex items-center gap-1.5">
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

                      <button
                        type="button"
                        onClick={() => handleToggleChecked(ex.name, ex.category, ex.modality)}
                        className={`p-2 rounded-none border transition cursor-pointer ${
                          isChecked
                            ? 'bg-indigo-600 border-indigo-500 text-white'
                            : 'bg-slate-950 border-slate-850 text-transparent hover:text-slate-600'
                        }`}
                      >
                        <Check className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Footer Actions */}
        <div className="bg-slate-900 border-t border-slate-850 px-4 py-3 flex items-center justify-between shrink-0 font-sans">
          {isCustomMode ? (
            <span className="text-[10px] text-slate-500 font-mono font-bold uppercase tracking-wider">
              {editingExercise ? 'Editing Exercise' : 'Creating Custom Exercise'}
            </span>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setIsCustomMode(true)}
                className="text-xs text-indigo-400 hover:text-indigo-300 font-black uppercase tracking-wider flex items-center gap-1.5 transition py-2 px-4 bg-slate-950/40 rounded-none border border-slate-850"
              >
                <Plus className="w-3.5 h-3.5" /> Custom
              </button>
              
              <button
                type="button"
                disabled={checkedExercises.length === 0}
                onClick={() => {
                  onSelect(checkedExercises);
                  onClose();
                }}
                className={`px-4 py-2.5 rounded-none text-xs font-black uppercase tracking-wider transition flex items-center gap-1.5 ${
                  checkedExercises.length > 0
                    ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-950/50 cursor-pointer'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                }`}
              >
                Add to Workout ({checkedExercises.length})
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
