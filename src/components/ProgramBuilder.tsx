/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Dumbbell, Plus, Trash2, ArrowLeft, Clipboard, HelpCircle, Save, Info, Pencil, Check } from 'lucide-react';
import { Program, ExerciseEntry, WeightUnit } from '../types';
import { storage, PREBUILT_TEMPLATES } from '../lib/storage';
import { ExerciseSelectorModal } from './ExerciseSelectorModal';
import { ConfirmationModal } from './ConfirmationModal';

interface ProgramBuilderProps {
  onClose: () => void;
  onSave: () => void;
}

const WEEKDAYS = [
  { value: 0, label: 'Monday', short: 'Mon' },
  { value: 1, label: 'Tuesday', short: 'Tue' },
  { value: 2, label: 'Wednesday', short: 'Wed' },
  { value: 3, label: 'Thursday', short: 'Thu' },
  { value: 4, label: 'Friday', short: 'Fri' },
  { value: 5, label: 'Saturday', short: 'Sat' },
  { value: 6, label: 'Sunday', short: 'Sun' },
];

const getDefaultWeekdays = (num: number): Record<number, number> => {
  if (num === 3) {
    return { 1: 0, 2: 2, 3: 4 }; // Mon, Wed, Fri
  }
  if (num === 4) {
    return { 1: 0, 2: 1, 3: 3, 4: 4 }; // Mon, Tue, Thu, Fri
  }
  if (num === 5) {
    return { 1: 0, 2: 1, 3: 3, 4: 4, 5: 5 }; // Mon, Tue, Thu, Fri, Sat
  }
  if (num === 6) {
    return { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5 }; // Mon, Tue, Wed, Thu, Fri, Sat
  }
  if (num === 7) {
    return { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6 }; // Mon, Tue, Wed, Thu, Fri, Sat, Sun
  }
  if (num === 1) {
    return { 1: 0 };
  }
  if (num === 2) {
    return { 1: 0, 2: 3 }; // Mon, Thu
  }
  const result: Record<number, number> = {};
  for (let i = 1; i <= num; i++) {
    result[i] = (i - 1) % 7;
  }
  return result;
};

export function ProgramBuilder({ onClose, onSave }: ProgramBuilderProps) {
  const activeProg = useState(() => storage.getCurrentProgram())[0];
  const [currentProgramId, setCurrentProgramId] = useState<string | null>(() => activeProg?.id || null);
  const [editingProgramId, setEditingProgramId] = useState<string | null>(() => activeProg?.id || null);

  const [name, setName] = useState(() => activeProg?.name || 'My Custom Strength Program');
  const [originalName, setOriginalName] = useState(() => activeProg?.name || '');
  const [daysPerWeek, setDaysPerWeek] = useState(() => activeProg?.daysPerWeek || 3);
  const [durationWeeks, setDurationWeeks] = useState<'∞' | number>(() => activeProg?.programDuration || 4);
  const [alertMsg, setAlertMsg] = useState<string | null>(null);
  const [savedPrograms, setSavedPrograms] = useState<Program[]>(() => storage.getPrograms());
  const [isDaysDropdownOpen, setIsDaysDropdownOpen] = useState(false);
  const [isDurationDropdownOpen, setIsDurationDropdownOpen] = useState(false);
  
  // Exercise library selector modal states
  const [isSelectorOpen, setIsSelectorOpen] = useState(false);
  const [selectorTarget, setSelectorTarget] = useState<{ dayIdx: number; exIdx: number | null } | null>(null);

  // Swap target state
  const [swapTarget, setSwapTarget] = useState<Program | null>(null);

  const openSelectorFor = (dayIdx: number, exIdx: number | null) => {
    setSelectorTarget({ dayIdx, exIdx });
    setIsSelectorOpen(true);
  };

  const handleSelectExercise = (selectedList: { name: string; category: string; modality?: 'weighted' | 'bodyweight' | 'assisted' | 'distance' | 'timed' }[]) => {
    if (selectedList.length === 0) return;
    if (selectorTarget) {
      const { dayIdx, exIdx } = selectorTarget;
      
      if (exIdx === null) {
        // Adding brand new exercises
        setExercisesByDay(prev => {
          const currentList = prev[dayIdx] || [];
          const additional = selectedList.map(item => ({
            name: item.name,
            muscleGroup: item.category,
            modality: item.modality || 'weighted',
            sets: [{ setNumber: 1, weight: 0, reps: 8 }]
          }));
          return {
            ...prev,
            [dayIdx]: [...currentList, ...additional]
          };
        });
      } else {
        // Editing existing exercise at exIdx
        const first = selectedList[0];
        handleUpdateExerciseField(dayIdx, exIdx, 'name', first.name);
        handleUpdateExerciseField(dayIdx, exIdx, 'muscleGroup', first.category);
        handleUpdateExerciseField(dayIdx, exIdx, 'modality', first.modality || 'weighted');

        if (selectedList.length > 1) {
          setExercisesByDay(prev => {
            const currentList = prev[dayIdx] || [];
            const additional = selectedList.slice(1).map(item => ({
              name: item.name,
              muscleGroup: item.category,
              modality: item.modality || 'weighted',
              sets: [{ setNumber: 1, weight: 0, reps: 8 }]
            }));
            return {
              ...prev,
              [dayIdx]: [...currentList, ...additional]
            };
          });
        }
      }
      setSelectorTarget(null);
    }
  };

  // Exercises state: Record<dayIndex, list of exercises>
  const [exercisesByDay, setExercisesByDay] = useState<Record<number, ExerciseEntry[]>>(() => {
    return activeProg ? JSON.parse(JSON.stringify(activeProg.exercisesByDay)) : { 1: [], 2: [], 3: [] };
  });

  // Weekday index assignment state: Record<dayIndex, weekday index>
  const [assignedWeekdays, setAssignedWeekdays] = useState<Record<number, number>>(() => {
    return activeProg?.assignedWeekdays
      ? JSON.parse(JSON.stringify(activeProg.assignedWeekdays))
      : getDefaultWeekdays(daysPerWeek);
  });

  // Current Day Tab selected in the editor
  const [activeTabDay, setActiveTabDay] = useState<number>(1);

  // Apply static template program
  const handleApplyPrebuiltTemplate = (tpl: any) => {
    setEditingProgramId(tpl.id);
    setName(tpl.name);
    setOriginalName(tpl.name);
    setDaysPerWeek(tpl.daysPerWeek);
    setDurationWeeks(tpl.programDuration);
    setExercisesByDay(JSON.parse(JSON.stringify(tpl.exercisesByDay)));
    if (tpl.assignedWeekdays) {
      setAssignedWeekdays(JSON.parse(JSON.stringify(tpl.assignedWeekdays)));
    } else {
      setAssignedWeekdays(getDefaultWeekdays(tpl.daysPerWeek));
    }
    setActiveTabDay(1);
  };

  // Apply custom saved program template
  const handleApplySavedProgram = (prog: Program) => {
    setEditingProgramId(prog.id);
    setName(prog.name);
    setOriginalName(prog.name);
    setDaysPerWeek(prog.daysPerWeek);
    setDurationWeeks(prog.programDuration === '∞' ? '∞' : Number(prog.programDuration));
    setExercisesByDay(JSON.parse(JSON.stringify(prog.exercisesByDay)));
    if (prog.assignedWeekdays) {
      setAssignedWeekdays(JSON.parse(JSON.stringify(prog.assignedWeekdays)));
    } else {
      setAssignedWeekdays(getDefaultWeekdays(prog.daysPerWeek));
    }
    setActiveTabDay(1);
  };

  const handleProgramClick = (prog: any) => {
    if (prog.id === currentProgramId) {
      return;
    }
    setSwapTarget(prog);
  };

  const handleConfirmSwap = () => {
    if (!swapTarget) return;
    
    storage.setCurrentProgramId(swapTarget.id);
    setCurrentProgramId(swapTarget.id);
    setEditingProgramId(swapTarget.id);
    
    setName(swapTarget.name);
    setOriginalName(swapTarget.name);
    setDaysPerWeek(swapTarget.daysPerWeek);
    setDurationWeeks(swapTarget.programDuration === '∞' ? '∞' : Number(swapTarget.programDuration));
    setExercisesByDay(JSON.parse(JSON.stringify(swapTarget.exercisesByDay)));
    if (swapTarget.assignedWeekdays) {
      setAssignedWeekdays(JSON.parse(JSON.stringify(swapTarget.assignedWeekdays)));
    } else {
      setAssignedWeekdays(getDefaultWeekdays(swapTarget.daysPerWeek));
    }
    setActiveTabDay(1);
    
    setSwapTarget(null);
  };

  const handleCreateNewCustom = () => {
    setEditingProgramId(null);
    setName('My Custom Strength Program');
    setOriginalName('');
    setDaysPerWeek(3);
    setDurationWeeks(4);
    setExercisesByDay({ 1: [], 2: [], 3: [] });
    setAssignedWeekdays(getDefaultWeekdays(3));
    setActiveTabDay(1);
  };

  const handleDaysPerWeekChange = (num: number) => {
    setDaysPerWeek(num);
    setExercisesByDay(prev => {
      const updated = { ...prev };
      // Make sure all day indexes up to num have at least a blank array
      for (let i = 1; i <= num; i++) {
        if (!updated[i]) {
          updated[i] = [];
        }
      }
      return updated;
    });
    setAssignedWeekdays(getDefaultWeekdays(num));
    if (activeTabDay > num) {
      setActiveTabDay(1);
    }
  };

  const handleAddExerciseToDayDirectly = (dayIdx: number) => {
    openSelectorFor(dayIdx, null);
  };

  const handleDeleteExerciseFromDay = (dayIdx: number, exIdx: number) => {
    setExercisesByDay(prev => {
      const currentList = prev[dayIdx] || [];
      return {
        ...prev,
        [dayIdx]: currentList.filter((_, idx) => idx !== exIdx),
      };
    });
  };

  const handleUpdateExerciseField = <K extends keyof ExerciseEntry>(
    dayIdx: number,
    exIdx: number,
    key: K,
    val: ExerciseEntry[K]
  ) => {
    setExercisesByDay(prev => {
      const currentList = prev[dayIdx] || [];
      const updated = currentList.map((ex, idx) => {
        if (idx === exIdx) {
          return { ...ex, [key]: val };
        }
        return ex;
      });
      return { ...prev, [dayIdx]: updated };
    });
  };

  const handleSaveProgram = () => {
    if (!name.trim()) {
      setAlertMsg('Please enter a program name!');
      return;
    }

    // Verify all days have at least one exercise
    for (let i = 1; i <= daysPerWeek; i++) {
      if (!exercisesByDay[i] || exercisesByDay[i].length === 0) {
        setAlertMsg(`Please add at least one exercise to Day ${i} before saving!`);
        return;
      }
    }

    // Clean up any extra days beyond daysPerWeek
    const cleanedExercisesByDay: Record<number, any> = {};
    const cleanedAssignedWeekdays: Record<number, number> = {};
    for (let i = 1; i <= daysPerWeek; i++) {
      if (exercisesByDay[i]) {
        cleanedExercisesByDay[i] = exercisesByDay[i];
      }
      if (assignedWeekdays[i] !== undefined) {
        cleanedAssignedWeekdays[i] = assignedWeekdays[i];
      }
    }

    let targetId = editingProgramId;
    const hasNameChanged = originalName !== '' && name.trim().toLowerCase() !== originalName.trim().toLowerCase();
    if (!targetId || hasNameChanged) {
      targetId = `prog-${Date.now()}`;
    }

    const updatedProgram: Program = {
      id: targetId,
      name: name,
      daysPerWeek: daysPerWeek,
      programDuration: durationWeeks,
      createdAt: new Date().toISOString(),
      exercisesByDay: cleanedExercisesByDay,
      assignedWeekdays: cleanedAssignedWeekdays,
    };

    storage.saveProgram(updatedProgram);
    storage.setCurrentProgramId(updatedProgram.id);
    setCurrentProgramId(updatedProgram.id);
    setEditingProgramId(updatedProgram.id);
    setOriginalName(updatedProgram.name);
    setSavedPrograms(storage.getPrograms());
    onSave();
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Header Bar */}
      <div className="sticky top-[-16px] -mt-4 pt-3 pb-2.5 bg-slate-950 z-30 flex items-center justify-between border-b border-slate-850 px-4 shadow-md">
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="p-2 bg-slate-900 hover:bg-slate-800 rounded-none text-slate-400 hover:text-white border border-slate-800 transition"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h2 className="font-extrabold text-sm text-white uppercase tracking-wide">
              Create Program
            </h2>
            <p className="text-[10px] text-indigo-400 font-mono uppercase tracking-widest">
              Weekly Program Setup
            </p>
          </div>
        </div>

        <button
          onClick={handleSaveProgram}
          className="bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs px-4 py-2.5 rounded-none transition flex items-center gap-1 shadow-md shadow-indigo-950/25"
        >
          <Save className="w-4 h-4" /> Save Program
        </button>
      </div>

      {/* Preset Templates Slider */}
      <div className="w-full bg-slate-900/50 border-y border-x-0 border-slate-850 p-4 space-y-3 rounded-none">
        <h3 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest flex items-center gap-1.5">
          <Clipboard className="w-3.5 h-3.5" /> My Programs
        </h3>
        <p className="text-xs text-slate-400 leading-relaxed font-sans">
          Select a <span className="font-bold border border-slate-800 bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-200 uppercase tracking-wide">template</span> or one of your <span className="font-bold border border-indigo-900/30 bg-indigo-950/40 px-1.5 py-0.5 text-[10px] text-indigo-300 uppercase tracking-wide">saved custom programs</span> to quickly load its settings and exercises:
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {PREBUILT_TEMPLATES.map((tpl) => {
            const isCurrent = currentProgramId === tpl.id;
            return (
              <button
                key={`prebuilt-${tpl.id}`}
                onClick={() => handleProgramClick(tpl)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-none text-xs font-bold transition border cursor-pointer ${
                  isCurrent
                    ? 'bg-slate-950 border-emerald-500 text-emerald-400 font-extrabold shadow-[0_0_8px_rgba(16,185,129,0.15)]'
                    : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-200 hover:text-white'
                }`}
              >
                {isCurrent ? <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> : <span className="text-slate-500 font-bold text-xs">+</span>}
                {tpl.name}
              </button>
            );
          })}
          {savedPrograms.filter(p => !p.id.startsWith('prog-tpl-')).map((prog) => {
            const isCurrent = currentProgramId === prog.id;
            return (
              <button
                key={`saved-${prog.id}`}
                onClick={() => handleProgramClick(prog)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-none text-xs font-bold transition border cursor-pointer ${
                  isCurrent
                    ? 'bg-slate-950 border-emerald-500 text-emerald-400 font-extrabold shadow-[0_0_8px_rgba(16,185,129,0.15)]'
                    : 'bg-indigo-950/40 hover:bg-indigo-900/40 border-indigo-900/30 text-indigo-300 hover:text-indigo-200'
                }`}
              >
                {isCurrent ? <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> : <span className="text-indigo-500/80 font-bold text-xs">★</span>}
                {prog.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Form Settings */}
      <div className="w-full bg-slate-900 border-y border-x-0 border-slate-800 p-4 space-y-4 shadow-sm rounded-none">
        <h3 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest flex items-center gap-1.5">
          <Pencil className="w-3.5 h-3.5" /> Create/Modify Program
        </h3>

        <div className="space-y-1.5">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide">
            Program Name
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full bg-slate-950 border border-slate-850 rounded-none px-3 h-11 text-base font-semibold text-white focus:outline-none focus:border-indigo-500 font-sans"
            placeholder="e.g., Hypertrophy Push Pull Legs"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Custom Training Days Dropdown */}
          <div className="space-y-1.5 relative">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide">
              Training Days/Week
            </label>
            <button
              type="button"
              onClick={() => {
                setIsDaysDropdownOpen(!isDaysDropdownOpen);
                setIsDurationDropdownOpen(false);
              }}
              className="w-full bg-slate-950 border border-slate-850 rounded-none px-3 text-sm font-bold text-slate-300 focus:outline-none focus:border-indigo-500 h-11 flex items-center justify-between cursor-pointer hover:bg-slate-900 transition"
            >
              <span>{daysPerWeek} Days per week</span>
              <span className="text-[8px] text-slate-500">▼</span>
            </button>
            {isDaysDropdownOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsDaysDropdownOpen(false)} />
                <div className="absolute left-0 right-0 top-16 bg-slate-950 border border-slate-800 rounded-none shadow-2xl z-50 overflow-y-auto max-h-60 py-1 font-sans">
                  {[1, 2, 3, 4, 5, 6, 7].map(num => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => {
                        handleDaysPerWeekChange(num);
                        setIsDaysDropdownOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2.5 text-xs font-bold border-y border-transparent cursor-pointer transition ${
                        daysPerWeek === num
                          ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30'
                          : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                      }`}
                    >
                      {num} {num === 1 ? 'Day' : 'Days'} per week
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Custom Program Duration Dropdown */}
          <div className="space-y-1.5 relative">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide">
              Program Duration
            </label>
            <button
              type="button"
              onClick={() => {
                setIsDurationDropdownOpen(!isDurationDropdownOpen);
                setIsDaysDropdownOpen(false);
              }}
              className="w-full bg-slate-950 border border-slate-850 rounded-none px-3 text-sm font-bold text-slate-300 focus:outline-none focus:border-indigo-500 h-11 flex items-center justify-between cursor-pointer hover:bg-slate-900 transition"
            >
              <span>{durationWeeks === '∞' ? 'Continuous (∞)' : `${durationWeeks} Weeks`}</span>
              <span className="text-[8px] text-slate-500">▼</span>
            </button>
            {isDurationDropdownOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsDurationDropdownOpen(false)} />
                <div className="absolute left-0 right-0 top-16 bg-slate-950 border border-slate-800 rounded-none shadow-2xl z-50 overflow-y-auto max-h-60 py-1 font-sans">
                  {[4, 6, 8, 12, '∞'].map(opt => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => {
                        setDurationWeeks(opt === '∞' ? '∞' : Number(opt));
                        setIsDurationDropdownOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2.5 text-xs font-bold border-y border-transparent cursor-pointer transition ${
                        durationWeeks === opt
                          ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30'
                          : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                      }`}
                    >
                      {opt === '∞' ? 'Continuous (∞)' : `${opt} Weeks`}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Program Detail Creator */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-4">
          <h3 className="font-extrabold text-xs text-slate-400 uppercase tracking-wider">
            Edit Program Exercises
          </h3>
          <span className="text-[10px] text-slate-500 font-bold font-mono">
            {daysPerWeek} Days Total
          </span>
        </div>

        {/* Day selection tabs */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 px-4 scrollbar-thin">
          {Array.from({ length: daysPerWeek }).map((_, idx) => {
            const dayNum = idx + 1;
            const isActive = activeTabDay === dayNum;
            const dayLabel = WEEKDAYS.find(w => w.value === assignedWeekdays[dayNum])?.short || 'Mon';
            return (
              <button
                key={dayNum}
                onClick={() => setActiveTabDay(dayNum)}
                className={`px-3.5 py-2 rounded-none text-xs font-black transition shrink-0 border text-center flex flex-col items-center min-w-[76px] ${
                  isActive
                    ? 'bg-indigo-600 border-indigo-500 text-white'
                    : 'bg-slate-900 border-slate-850 text-slate-400 hover:text-white'
                }`}
              >
                <span>Day {dayNum}</span>
                <span className={`text-[9px] font-mono mt-0.5 ${isActive ? 'text-indigo-200 font-extrabold' : 'text-indigo-400/80 font-bold'}`}>
                  {dayLabel}
                </span>
              </button>
            );
          })}
        </div>

        {/* Day exercise cards list */}
        <div className="w-full bg-slate-900 border-y border-x-0 border-slate-800 p-4 space-y-4 shadow-inner rounded-none">
          <div className="flex justify-between items-center mb-2 gap-4">
            <div className="flex flex-col">
              <h4 className="text-xs font-black text-slate-300 uppercase tracking-wide">
                Exercises for Day {activeTabDay}
              </h4>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="text-[9px] text-slate-500 font-extrabold uppercase tracking-wide">Weekday:</span>
                <select
                  value={assignedWeekdays[activeTabDay] ?? 0}
                  onChange={e => {
                    const val = Number(e.target.value);
                    setAssignedWeekdays(prev => ({
                      ...prev,
                      [activeTabDay]: val,
                    }));
                  }}
                  className="bg-slate-950 border border-slate-800 rounded-none px-2 py-0.5 text-[10px] font-bold text-indigo-400 focus:outline-none focus:border-indigo-500 cursor-pointer h-6"
                >
                  {WEEKDAYS.map(w => (
                    <option key={w.value} value={w.value} className="bg-slate-900 text-slate-300">
                      {w.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <span className="text-[10px] text-slate-500 font-bold bg-slate-950 px-2 py-1 rounded-none border border-slate-850 font-mono self-start shrink-0">
              {(exercisesByDay[activeTabDay] || []).length} Exercises
            </span>
          </div>

          {(exercisesByDay[activeTabDay] || []).length === 0 ? (
            <p className="text-xs text-slate-500 italic text-center py-8 bg-slate-950/40 border border-slate-850 rounded-none">
              No exercises added to Day {activeTabDay} yet. Click add below.
            </p>
          ) : (
            <div className="space-y-3">
              {(exercisesByDay[activeTabDay] || []).map((ex, exIdx) => (
                <div
                  key={exIdx}
                  className="bg-slate-950/70 border border-slate-850 rounded-none p-3.5 flex items-center gap-3"
                >
                  <div className="grid grid-cols-12 gap-2 flex-1">
                    {/* Exercise Name */}
                    <div className="col-span-5">
                      <label className="block text-[8px] font-extrabold text-slate-500 uppercase tracking-wider mb-1">Name</label>
                      <input
                        type="text"
                        value={ex.name}
                        onChange={e =>
                          handleUpdateExerciseField(activeTabDay, exIdx, 'name', e.target.value)
                        }
                        placeholder="e.g. Squat"
                        className="w-full bg-slate-900 border border-slate-800 rounded-none px-2.5 h-10 text-xs font-semibold text-white focus:outline-none focus:border-indigo-500 font-sans"
                      />
                    </div>
                    {/* Muscle Group */}
                    <div className="col-span-5">
                      <label className="block text-[8px] font-extrabold text-slate-500 uppercase tracking-wider mb-1">Muscle Group</label>
                      <input
                        type="text"
                        value={ex.muscleGroup}
                        onChange={e =>
                          handleUpdateExerciseField(
                            activeTabDay,
                            exIdx,
                            'muscleGroup',
                            e.target.value
                          )
                        }
                        placeholder="e.g. Quads"
                        className="w-full bg-slate-900 border border-slate-800 rounded-none px-2.5 h-10 text-xs font-semibold text-slate-300 focus:outline-none focus:border-indigo-500 font-sans"
                      />
                    </div>
                    {/* Browse Library Button */}
                    <div className="col-span-2">
                      <label className="block text-[8px] font-extrabold text-transparent select-none uppercase tracking-wider mb-1">Edit</label>
                      <button
                        onClick={() => openSelectorFor(activeTabDay, exIdx)}
                        className="w-full h-10 bg-slate-900 hover:bg-slate-850 border border-slate-800 rounded-none flex items-center justify-center text-indigo-400 hover:text-indigo-300 transition"
                        title="Browse Library"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Remove Exercise */}
                  <div className="self-end pb-2">
                    <button
                      onClick={() => handleDeleteExerciseFromDay(activeTabDay, exIdx)}
                      className="p-1.5 text-slate-500 hover:text-rose-400 transition"
                      title="Delete exercise template"
                    >
                      <Trash2 className="w-4.5 h-4.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => handleAddExerciseToDayDirectly(activeTabDay)}
            className="w-full bg-slate-950 hover:bg-slate-850 text-slate-300 hover:text-white border border-slate-850 rounded-none py-3.5 text-xs font-bold transition flex items-center justify-center gap-1.5 uppercase tracking-wide"
          >
            <Plus className="w-4 h-4" /> Add exercise
          </button>
        </div>
      </div>

      <ExerciseSelectorModal
        isOpen={isSelectorOpen}
        onClose={() => {
          setIsSelectorOpen(false);
          setSelectorTarget(null);
        }}
        onSelect={handleSelectExercise}
      />

      <ConfirmationModal
        visible={alertMsg !== null}
        title="Program Setup Error"
        message={alertMsg || ''}
        confirmLabel="OK"
        onConfirm={() => setAlertMsg(null)}
        onCancel={() => setAlertMsg(null)}
      />

      <ConfirmationModal
        visible={swapTarget !== null}
        title="Swap active program"
        message="Swap to alternate program? Save the program to make it the active program."
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={handleConfirmSwap}
        onCancel={() => setSwapTarget(null)}
      />
    </div>
  );
}
