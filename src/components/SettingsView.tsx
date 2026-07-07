/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { Settings, FileJson, Download, Upload, Trash2, ArrowLeft, RefreshCw, Check, AlertTriangle, Sparkles } from 'lucide-react';
import { Program, WorkoutLog } from '../types';
import { storage } from '../lib/storage';
import { ConfirmationModal } from './ConfirmationModal';

export const THEME_PRESETS = [
  {
    id: 'slate',
    name: 'Subnautic',
    bgMain: '#04060a',
    bgCard: '#11182c',
    borderMain: '#202a45',
    textPrimary: '#F9FAFB',
    textSecondary: '#94a3b8',
    textMuted: '#64748b',
    accent: '#6366f1',
    accentLight: '#818cf8',
    accentDark: '#4f46e5',
    accentCyan: '#06b6d4',
    success: '#10b981',
    label: 'Blue Slate',
    swatch1: '#6366f1',
    swatch2: '#11182c',
  },
  {
    id: 'onyx',
    name: 'Feralas',
    bgMain: '#111827',
    bgCard: '#1F2937',
    borderMain: '#374151',
    textPrimary: '#F9FAFB',
    textSecondary: '#9CA3AF',
    textMuted: '#6B7280',
    accent: '#10B981',
    accentLight: '#34D399',
    accentDark: '#059669',
    accentCyan: '#F59E0B',
    success: '#10B981',
    label: 'Forest Green',
    swatch1: '#10B981',
    swatch2: '#1F2937',
  },
  {
    id: 'amber',
    name: 'Crimson Desert',
    bgMain: '#F2F0EC',
    bgCard: '#FBFAF8',
    borderMain: '#DDD7D0',
    textPrimary: '#252320',
    textSecondary: '#6F6A63',
    textMuted: '#A49D95',
    accent: '#B56D3E',
    accentLight: '#D0915D',
    accentDark: '#9B5C34',
    accentCyan: '#C58A2B',
    success: '#5C8A55',
    label: 'Desert Leather',
    swatch1: '#252320',
    swatch2: '#B56D3E',
  },
];

interface SettingsViewProps {
  currentProgram: Program | null;
  onRefresh: () => void;
  onClose: () => void;
  themeId: string;
  onThemeChange: (themeId: string) => void;
}

export function SettingsView({ 
  currentProgram, 
  onRefresh, 
  onClose,
  themeId,
  onThemeChange,
}: SettingsViewProps) {
  const [activeProgId, setActiveProgId] = useState(storage.getCurrentProgramId() || '');
  const [isProgramDropdownOpen, setIsProgramDropdownOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showCleanConfirm, setShowCleanConfirm] = useState(false);
  const [alertMsg, setAlertMsg] = useState<{ title: string; message: string } | null>(null);
  const [unitPref, setUnitPref] = useState<'kg' | 'lb'>(() => storage.getWeightUnit());
  const [bodyweightVal, setBodyweightVal] = useState<string>(() => {
    const bw = storage.getBodyweight();
    return bw !== null ? String(bw) : '';
  });
  const [showDataMgmtPopup, setShowDataMgmtPopup] = useState(false);

  const programs = storage.getPrograms();

  const handleProgramChange = (id: string) => {
    setActiveProgId(id);
    storage.setCurrentProgramId(id);
    onRefresh();
  };

  const handleGenerateTestData = () => {
    const testProgId = 'prog-test-10-weeks';
    
    // 1. Create the program
    const testProgram: Program = {
      id: testProgId,
      name: 'PR Correlation Testing',
      daysPerWeek: 1,
      programDuration: 10,
      createdAt: new Date(Date.now() - 70 * 24 * 60 * 60 * 1000).toISOString(),
      exercisesByDay: {
        1: [
          { name: 'Squat', muscleGroup: 'Quads', modality: 'weighted', sets: [] },
          { name: 'Bench Press', muscleGroup: 'Chest', modality: 'weighted', sets: [] },
          { name: 'Deadlift', muscleGroup: 'Hamstrings & Back', modality: 'weighted', sets: [] },
        ]
      },
      assignedWeekdays: { 1: 0 }
    };

    // 2. Clear old test entries if they exist
    const currentLogs = storage.getWorkoutLogs().filter(l => l.programId !== testProgId);

    // 3. Generate 10 logs with progressive peaks at Week 5, then taper off
    const progressionData = [
      { sleep: 7.0, cals: 2400, squat: 100, bench: 75, dead: 120 },
      { sleep: 7.2, cals: 2500, squat: 105, bench: 78, dead: 125 },
      { sleep: 7.5, cals: 2650, squat: 110, bench: 82, dead: 130 },
      { sleep: 8.0, cals: 2800, squat: 115, bench: 87, dead: 135 },
      { sleep: 8.5, cals: 3200, squat: 125, bench: 95, dead: 145 }, // Peak Week 5
      { sleep: 7.8, cals: 2700, squat: 118, bench: 90, dead: 138 },
      { sleep: 7.4, cals: 2550, squat: 112, bench: 85, dead: 132 },
      { sleep: 7.1, cals: 2450, squat: 108, bench: 81, dead: 127 },
      { sleep: 6.8, cals: 2300, squat: 102, bench: 76, dead: 121 },
      { sleep: 6.5, cals: 2200, squat: 95,  bench: 71, dead: 115 },
    ];

    const logsToSave: WorkoutLog[] = progressionData.map((data, idx) => {
      const weekNum = idx + 1;
      const daysOffset = -70 + (idx * 7); // Spread over 10 weeks
      const d = new Date();
      d.setDate(d.getDate() + daysOffset);
      const dateStr = d.toISOString().split('T')[0];

      return {
        id: `test-log-w${weekNum}`,
        date: dateStr,
        programId: testProgId,
        program: 'PR Correlation Testing',
        week: String(weekNum),
        day: '1',
        unit: 'kg',
        durationMinutes: 60,
        exercises: [
          {
            name: 'Squat',
            muscleGroup: 'Quads',
            modality: 'weighted',
            sets: [
              { setNumber: 1, weight: data.squat, reps: 5, rpe: 8, form: 'strict' },
              { setNumber: 2, weight: data.squat, reps: 5, rpe: 8, form: 'strict' },
            ]
          },
          {
            name: 'Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            sets: [
              { setNumber: 1, weight: data.bench, reps: 5, rpe: 8, form: 'strict' },
              { setNumber: 2, weight: data.bench, reps: 5, rpe: 8, form: 'strict' },
            ]
          },
          {
            name: 'Deadlift',
            muscleGroup: 'Hamstrings & Back',
            modality: 'weighted',
            sets: [
              { setNumber: 1, weight: data.dead, reps: 5, rpe: 8, form: 'strict' },
            ]
          },
        ],
        recovery: {
          sleepHours: data.sleep,
          hydrationLiters: 3.0,
          nutritionCalories: data.cals,
          proteinGrams: 160,
          soreness: idx === 4 ? 1 : 3,
          motivation: idx === 4 ? 5 : 3,
        },
        notes: `Test Log Week ${weekNum} - Sleep: ${data.sleep} hrs, Calories: ${data.cals} kcal.`
      };
    });

    // Save program
    storage.saveProgram(testProgram);
    // Switch to active
    storage.setCurrentProgramId(testProgId);
    
    // Save all logs
    const mergedLogs = [...currentLogs, ...logsToSave];
    localStorage.setItem('workoutLogs', JSON.stringify(mergedLogs));

    onRefresh();
    setActiveProgId(testProgId);
    setAlertMsg({
      title: 'Test Program Generated',
      message: 'A 10-week mock program "PR Correlation Testing" has been populated with 10 historically logged workouts. The program has been set to Active. Navigate to the Analytics tab to visualize the beautiful peaks and see your dynamic PR targets!'
    });
  };

  const handleDeleteTestData = () => {
    const testProgId = 'prog-test-10-weeks';
    const logs = storage.getWorkoutLogs().filter(l => l.programId !== testProgId);
    localStorage.setItem('workoutLogs', JSON.stringify(logs));
    storage.deleteProgram(testProgId);
    
    onRefresh();
    const currentId = storage.getCurrentProgramId() || '';
    setActiveProgId(currentId);
    setAlertMsg({
      title: 'Test Program Removed',
      message: 'The "PR Correlation Testing" program and its 10 mock logs have been deleted. Active program returned to default.'
    });
  };

  const handleUnitChange = (u: 'kg' | 'lb') => {
    setUnitPref(u);
    storage.setWeightUnit(u);
    onRefresh();
  };

  const handleBodyweightChange = (val: string) => {
    setBodyweightVal(val);
    if (val === '') {
      storage.setBodyweight(null);
    } else {
      const num = Number(val);
      if (!isNaN(num)) {
        storage.setBodyweight(num);
      }
    }
    onRefresh();
  };

  // Export full app data to a local file
  const handleExportData = () => {
    try {
      const data = {
        programList: storage.getPrograms(),
        currentProgramId: storage.getCurrentProgramId(),
        workoutLogs: storage.getWorkoutLogs(),
      };
      const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(data, null, 2))}`;
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', jsonString);
      downloadAnchor.setAttribute('download', `metreps_backup_${new Date().toISOString().split('T')[0]}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    } catch (e: any) {
      setAlertMsg({
        title: 'Export Failed',
        message: 'Error exporting data: ' + e.message,
      });
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const parsed = JSON.parse(content);
        let logsAdded = 0;
        let programsAdded = 0;

        if (parsed.programList || parsed.workoutLogs) {
          if (parsed.programList && Array.isArray(parsed.programList)) {
            parsed.programList.forEach((p: Program) => {
              if (p.id) storage.saveProgram(p);
            });
            programsAdded += parsed.programList.length;
          }
          if (parsed.workoutLogs && Array.isArray(parsed.workoutLogs)) {
            parsed.workoutLogs.forEach((l: WorkoutLog) => {
              if (l.id) storage.saveWorkoutLog(l);
            });
            logsAdded += parsed.workoutLogs.length;
          }
          if (parsed.currentProgramId) {
            storage.setCurrentProgramId(parsed.currentProgramId);
          }
        } else if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].exercisesByDay) {
          parsed.forEach((p: Program) => {
            if (!p.id) p.id = `imported-${Date.now()}-${Math.random()}`;
            storage.saveProgram(p);
          });
          programsAdded += parsed.length;
        } else if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].exercises) {
          parsed.forEach((l: WorkoutLog) => {
            if (!l.id) l.id = `imported-${Date.now()}-${Math.random()}`;
            storage.saveWorkoutLog(l);
          });
          logsAdded += parsed.length;
        } else if (typeof parsed === 'object' && parsed.exercisesByDay) {
          const p = parsed as Program;
          if (!p.id) p.id = `imported-${Date.now()}`;
          storage.saveProgram(p);
          programsAdded += 1;
        } else if (typeof parsed === 'object' && parsed.exercises) {
          const l = parsed as WorkoutLog;
          if (!l.id) l.id = `imported-${Date.now()}`;
          storage.saveWorkoutLog(l);
          logsAdded += 1;
        } else {
          throw new Error('Unrecognized JSON structure. Make sure you upload a valid backup file.');
        }

        onRefresh();
        const currentId = storage.getCurrentProgramId() || '';
        setActiveProgId(currentId);
        setAlertMsg({
          title: 'Data Imported Successfully',
          message: `Successfully imported ${programsAdded} programs and ${logsAdded} workout logs! App state updated.`,
        });
      } catch (err: any) {
        setAlertMsg({
          title: 'Import Failed',
          message: `Failed to import: ${err.message || err}`,
        });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleFactoryReset = () => {
    setShowResetConfirm(true);
  };

  const handleFactoryResetConfirm = () => {
    localStorage.clear();
    onRefresh();
    setShowResetConfirm(false);
    setShowDataMgmtPopup(false);
    setAlertMsg({
      title: 'Factory Reset Complete',
      message: 'MetReps has been reset to default template state (includes sample program and historic logs).',
    });
  };

  const handleCleanReset = () => {
    setShowCleanConfirm(true);
  };

  const handleCleanResetConfirm = () => {
    localStorage.clear();
    // Initialize storage keys as empty arrays to prevent automatic seeding on first load
    localStorage.setItem('programList', '[]');
    localStorage.setItem('workoutLogs', '[]');
    onRefresh();
    setShowCleanConfirm(false);
    setShowDataMgmtPopup(false);
    setAlertMsg({
      title: 'Slate Wiped Clean',
      message: 'All local data and seed data templates have been permanently erased. You are starting with a completely empty app.',
    });
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Header Bar */}
      <div className="sticky top-[-16px] -mt-4 pt-3 pb-2.5 bg-slate-950 z-30 flex items-center gap-3 border-b border-slate-850 px-4 shadow-md">
        <button
          onClick={onClose}
          className="p-2 bg-slate-900 hover:bg-slate-800 rounded-none text-slate-400 hover:text-white border border-slate-800 transition"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h2 className="font-extrabold text-sm text-white uppercase tracking-wide flex items-center gap-1.5 font-sans">
            <Settings className="w-4.5 h-4.5 text-indigo-400" />
            SETTINGS
          </h2>
          <p className="text-[10px] text-indigo-400 font-mono uppercase tracking-widest">
            Units, Themes and Dev tools
          </p>
        </div>
      </div>

      {/* Preferred Weight Unit Selector */}
      <div className="w-full bg-slate-900 border-y border-x-0 border-slate-800 p-4 space-y-3 shadow-sm rounded-none">
        <h3 className="text-xs font-black text-slate-300 uppercase tracking-wide font-sans">Preferred Weight Unit</h3>
        <p className="text-xs text-slate-400 leading-relaxed font-sans">
          Set your default unit for tracking lifts. Changes apply automatically to new logging sessions:
        </p>
        <div className="flex gap-2">
          {(['kg', 'lb'] as const).map(u => {
            const isActive = unitPref === u;
            return (
              <button
                key={u}
                onClick={() => handleUnitChange(u)}
                className={`flex-1 py-3 rounded-none text-xs font-black border transition uppercase tracking-wider ${
                  isActive
                    ? 'bg-indigo-600 border-indigo-500 text-white shadow-md'
                    : 'bg-slate-950 border-slate-850 text-slate-400 hover:text-slate-200'
                }`}
              >
                {u.toUpperCase()} ({u === 'kg' ? 'Kilograms' : 'Pounds'})
              </button>
            );
          })}
        </div>
      </div>

      {/* Default Bodyweight Setting */}
      <div className="w-full bg-slate-900 border-y border-x-0 border-slate-800 p-4 space-y-3 shadow-sm rounded-none">
        <h3 className="text-xs font-black text-slate-300 uppercase tracking-wide font-sans">Default Bodyweight</h3>
        <p className="text-xs text-slate-400 leading-relaxed font-sans">
          Enter your current bodyweight. This value will be automatically filled in and logged for bodyweight exercises (like Pull-Ups):
        </p>
        <div className="relative">
          <input
            type="number"
            step="0.1"
            value={bodyweightVal}
            onChange={e => handleBodyweightChange(e.target.value)}
            className="w-full bg-slate-950 border border-slate-850 rounded-none pl-3 pr-12 text-sm font-mono font-semibold text-slate-200 focus:outline-none focus:border-indigo-500 h-11"
            placeholder="e.g. 75"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono font-black text-indigo-400 uppercase">
            {unitPref}
          </span>
        </div>
      </div>

      {/* Colour theme */}
      <div className="w-full bg-slate-900 border-y border-x-0 border-slate-800 p-4 space-y-3 shadow-sm rounded-none">
        <h3 className="text-xs font-black text-slate-300 uppercase tracking-wide font-sans">Colour theme</h3>
        <p className="text-xs text-slate-400 leading-relaxed font-sans">
          Select a background theme to optimize contrast and readability on your device, especially under direct sunlight:
        </p>
        
        <div className="grid grid-cols-3 gap-2">
          {THEME_PRESETS.map((preset) => {
            const isSelected = themeId === preset.id;
            return (
              <button
                key={preset.id}
                onClick={() => onThemeChange(preset.id)}
                className={`flex flex-col p-2.5 rounded-none border text-left transition cursor-pointer ${
                  isSelected
                    ? 'border-indigo-500 bg-slate-950 shadow-md ring-1 ring-indigo-500/20'
                    : 'border-slate-850 bg-slate-950/40 hover:bg-slate-950/80 hover:border-slate-800'
                }`}
              >
                {/* Visual color swatches mockup */}
                <div className="flex gap-1 mb-2">
                  <div 
                    className="w-5 h-5 rounded-none border border-slate-800 shadow-sm shrink-0" 
                    style={{ backgroundColor: preset.swatch1 }}
                    title={`Swatch 1: ${preset.swatch1}`}
                  />
                  <div 
                    className="w-5 h-5 rounded-none border border-slate-800 shadow-sm shrink-0" 
                    style={{ backgroundColor: preset.swatch2 }}
                    title={`Swatch 2: ${preset.swatch2}`}
                  />
                </div>
                <span className="text-[10px] font-bold text-slate-200 line-clamp-1 leading-tight font-sans">
                  {preset.name}
                </span>
                <span className="text-[8px] text-slate-500 font-bold font-mono mt-0.5">
                  {preset.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* App Data Management Button */}
      <div className="px-4 pt-1">
        <button
          type="button"
          onClick={() => setShowDataMgmtPopup(true)}
          className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs py-3.5 px-4 rounded-none transition flex items-center justify-center gap-2 shadow uppercase tracking-widest cursor-pointer"
        >
          App Data Management
        </button>
      </div>

      {/* App Data Management Popup Overlay */}
      {showDataMgmtPopup && (
        <div className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 w-full max-w-md p-5 space-y-6 shadow-2xl overflow-y-auto max-h-[90vh] rounded-none">
            <div className="flex justify-between items-center border-b border-slate-850 pb-3">
              <h3 className="font-extrabold text-sm text-white uppercase tracking-wider">
                App Data Management
              </h3>
              <button
                onClick={() => setShowDataMgmtPopup(false)}
                className="text-slate-400 hover:text-white transition text-xs font-bold font-mono border border-slate-800 bg-slate-900 px-2.5 py-1"
              >
                CLOSE
              </button>
            </div>

            {/* App Data Option Container */}
            <div className="space-y-3">
              <h4 className="text-xs font-black text-slate-300 uppercase tracking-widest">
                App Data
              </h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Manage your programs, exercise logs, and local database cache. We recommend downloading a backup first before clearing any data.
              </p>
              
              <div className="flex flex-col gap-2 pt-1">
                {/* Button 1: Download backup */}
                <button
                  type="button"
                  onClick={handleExportData}
                  className="w-full bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 font-extrabold text-xs py-3.5 px-3 rounded-none transition flex items-center justify-center gap-1.5 uppercase tracking-wider cursor-pointer"
                >
                  <Download className="w-4 h-4 text-indigo-400" /> Download Backup
                </button>

                {/* Button 2: Upload saved data */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 font-extrabold text-xs py-3.5 px-3 rounded-none transition flex items-center justify-center gap-1.5 uppercase tracking-wider cursor-pointer"
                >
                  <Upload className="w-4 h-4 text-indigo-400" /> Upload Saved Data
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept=".json"
                  className="hidden"
                />

                {/* Button 3: Restore default templates */}
                <button
                  type="button"
                  onClick={handleFactoryReset}
                  className="w-full bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 font-extrabold text-xs py-3.5 px-3 rounded-none transition flex items-center justify-center gap-1.5 uppercase tracking-wider cursor-pointer"
                >
                  <AlertTriangle className="w-4 h-4 text-amber-500" /> Restore Default Templates
                </button>
                
                {/* Button 4: Wipe slate completely */}
                <button
                  type="button"
                  onClick={handleCleanReset}
                  className="w-full bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 hover:border-rose-500/30 font-extrabold text-xs py-3.5 px-3 rounded-none transition flex items-center justify-center gap-1.5 uppercase tracking-wider cursor-pointer"
                >
                  <Trash2 className="w-4 h-4 text-rose-500" /> Wipe Slate Completely (Start Empty)
                </button>
              </div>
            </div>

            {/* Test Data Option Container */}
            <div className="space-y-3 pt-4 border-t border-slate-850">
              <h4 className="text-xs font-black text-slate-300 uppercase tracking-widest">
                Test Data
              </h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Want to test the Recovery Correlation graphs, trendlines, and target guidelines? Generate a 10-week, 1-day/week testing program with progressive strength, sleep, and nutrition data that peaks in Week 5 and tapers off:
              </p>

              <div className="flex flex-col gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleGenerateTestData}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs py-3.5 px-3 rounded-none transition flex items-center justify-center gap-1.5 shadow uppercase tracking-wider cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4" /> Generate 10-Week Test Data
                </button>
                
                <button
                  type="button"
                  onClick={handleDeleteTestData}
                  className="w-full bg-slate-900 hover:bg-slate-800 text-rose-400 border border-slate-850 hover:border-slate-800 font-extrabold text-xs py-3.5 px-3 rounded-none transition flex items-center justify-center gap-1.5 uppercase tracking-wider cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" /> Delete Test Data
                </button>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-850">
              <button
                type="button"
                onClick={() => setShowDataMgmtPopup(false)}
                className="w-full py-3 bg-slate-900 hover:bg-slate-850 text-white border border-slate-800 font-extrabold text-xs uppercase tracking-widest transition"
              >
                Understood & Close
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmationModal
        visible={showResetConfirm}
        title="Restore Default Templates"
        message="Warning, this will delete all your custom programs"
        confirmLabel="Erase & Restore"
        cancelLabel="Keep Current Data"
        confirmVariant="danger"
        onConfirm={handleFactoryResetConfirm}
        onCancel={() => setShowResetConfirm(false)}
      />

      <ConfirmationModal
        visible={showCleanConfirm}
        title="Wipe Slate Completely"
        message="warning this will wipe all your saved programs AND exercise data"
        confirmLabel="Wipe Everything"
        cancelLabel="Keep Current Data"
        confirmVariant="danger"
        onConfirm={handleCleanResetConfirm}
        onCancel={() => setShowCleanConfirm(false)}
      />

      <ConfirmationModal
        visible={alertMsg !== null}
        title={alertMsg?.title || 'Notification'}
        message={alertMsg?.message || ''}
        confirmLabel="OK"
        onConfirm={() => {
          if (alertMsg?.title.includes('Reset') || alertMsg?.title.includes('Wipe') || alertMsg?.title.includes('Slate')) {
            onClose();
          }
          setAlertMsg(null);
        }}
        onCancel={() => {
          if (alertMsg?.title.includes('Reset') || alertMsg?.title.includes('Wipe') || alertMsg?.title.includes('Slate')) {
            onClose();
          }
          setAlertMsg(null);
        }}
      />
    </div>
  );
}
