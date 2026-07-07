/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Dumbbell, Calendar, LineChart, PlusCircle, BookOpen, Settings, HelpCircle, ArrowRight, ArrowLeft, Info, Shield, HeartPulse, Check, FileJson, Plus, QrCode } from 'lucide-react';
import { Program, WorkoutLog } from './types';
import { storage } from './lib/storage';
import { getLocalDateString, getTodayLocalDateString, calculateSessionDate } from './lib/dateUtils';

// Screens
import { HomeView } from './components/HomeView';
import { WorkoutLogger } from './components/WorkoutLogger';
import { ProgramBuilder } from './components/ProgramBuilder';
import { AnalyticsView } from './components/AnalyticsView';
import { LogsHistoryView } from './components/LogsHistoryView';
import { SettingsView, THEME_PRESETS } from './components/SettingsView';
import { MetRepsLogo } from './components/MetRepsLogo';
import { InfoView } from './components/InfoView';

export default function App() {
  const [currentView, setCurrentView] = useState<string>(() => {
    return localStorage.getItem('metreps_current_view') || 'home';
  });
  const [viewParams, setViewParams] = useState<any>(() => {
    try {
      const val = localStorage.getItem('metreps_view_params');
      return val ? JSON.parse(val) : null;
    } catch (_) {
      return null;
    }
  });

  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (viewportRef.current) {
      viewportRef.current.scrollTop = 0;
    }
  }, [currentView, viewParams]);

  // Theme state
  const [themeId, setThemeId] = useState<string>(() => storage.getTheme());

  const activeTheme = THEME_PRESETS.find(t => t.id === themeId) || THEME_PRESETS[0];

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--theme-bg', activeTheme.bgMain);
    root.style.setProperty('--theme-card', activeTheme.bgCard);
    root.style.setProperty('--theme-border', activeTheme.borderMain);
    root.style.setProperty('--theme-text-primary', activeTheme.textPrimary);
    root.style.setProperty('--theme-text-secondary', activeTheme.textSecondary);
    root.style.setProperty('--theme-text-muted', activeTheme.textMuted);
    root.style.setProperty('--theme-accent', activeTheme.accent);
    root.style.setProperty('--theme-accent-light', activeTheme.accentLight);
    root.style.setProperty('--theme-accent-dark', activeTheme.accentDark);
    root.style.setProperty('--theme-accent-cyan', activeTheme.accentCyan);
    root.style.setProperty('--theme-success', activeTheme.success);
    
    // Set html background color to match so mobile elastic scrolling matches
    root.style.backgroundColor = activeTheme.bgMain;
  }, [activeTheme]);

  const handleThemeChange = (newThemeId: string) => {
    setThemeId(newThemeId);
    storage.setTheme(newThemeId);
  };

  const themeStyle = {
    '--theme-bg': activeTheme.bgMain,
    '--theme-card': activeTheme.bgCard,
    '--theme-border': activeTheme.borderMain,
    '--theme-text-primary': activeTheme.textPrimary,
    '--theme-text-secondary': activeTheme.textSecondary,
    '--theme-text-muted': activeTheme.textMuted,
    '--theme-accent': activeTheme.accent,
    '--theme-accent-light': activeTheme.accentLight,
    '--theme-accent-dark': activeTheme.accentDark,
    '--theme-accent-cyan': activeTheme.accentCyan,
    '--theme-success': activeTheme.success,
  } as React.CSSProperties;

  // Core synchronized state
  const [currentProgram, setCurrentProgram] = useState<Program | null>(null);
  const [workoutLogs, setWorkoutLogs] = useState<WorkoutLog[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return getTodayLocalDateString();
  });

  // Load state on mount and on trigger
  const loadData = () => {
    setCurrentProgram(storage.getCurrentProgram());
    setWorkoutLogs(storage.getWorkoutLogs());
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleNavigate = (view: string, params: any = null) => {
    setViewParams(params);
    setCurrentView(view);
    localStorage.setItem('metreps_current_view', view);
    if (params) {
      localStorage.setItem('metreps_view_params', JSON.stringify(params));
    } else {
      localStorage.removeItem('metreps_view_params');
    }
  };

  const getNextProgrammedWorkoutParams = () => {
    if (!currentProgram) return null;
    
    const logs = workoutLogs;
    const totalWeeks = currentProgram.programDuration === '∞' ? 12 : Number(currentProgram.programDuration);
    const dayIndexes = Object.keys(currentProgram.exercisesByDay)
      .map(Number)
      .sort((a, b) => a - b);
      
    // Loop up to a high limit (e.g., 1000 weeks) to support infinite progression beyond the standard duration.
    const searchWeeksLimit = Math.max(totalWeeks + 100, 1000);
    for (let w = 1; w <= searchWeeksLimit; w++) {
      for (const d of dayIndexes) {
        const hasCompletedLog = logs.some(
          l =>
            l.programId === currentProgram.id &&
            l.week === String(w) &&
            l.day === String(d)
        );
        if (!hasCompletedLog) {
          const sessionDate = calculateSessionDate(currentProgram.createdAt, currentProgram.assignedWeekdays, w, d);
          const schedDateStr = getLocalDateString(sessionDate);

          return {
            programId: currentProgram.id,
            programName: currentProgram.name,
            week: String(w),
            day: String(d),
            scheduledDate: schedDateStr,
            date: getTodayLocalDateString(),
          };
        }
      }
    }
    
    const defaultD = dayIndexes[0] || 1;
    const sessionDate = calculateSessionDate(currentProgram.createdAt, currentProgram.assignedWeekdays, 1, defaultD);
    const schedDateStr = getLocalDateString(sessionDate);

    return {
      programId: currentProgram.id,
      programName: currentProgram.name,
      week: '1',
      day: String(defaultD),
      scheduledDate: schedDateStr,
      date: getTodayLocalDateString(),
    };
  };

  const handleNextProgrammedWorkout = () => {
    if (!currentProgram) {
      alert('Please select or build a workout program first in the "Program" or "Home" tab.');
      return;
    }
    const params = getNextProgrammedWorkoutParams();
    handleNavigate('logger', params);
  };

  const handleWorkoutSaved = () => {
    loadData();
    handleNavigate('home', null);
  };

  const handleProgramSaved = () => {
    loadData();
    handleNavigate('home', null);
  };

  return (
    <div 
      style={themeStyle}
      className="h-[100dvh] md:h-auto md:min-h-screen bg-slate-950 text-slate-100 flex flex-col md:flex-row justify-center selection:bg-indigo-500 selection:text-white overflow-hidden md:overflow-visible"
    >
      {/* LEFT SIDE: Explanatory Sidebar (Visible on desktop) */}
      <aside className="hidden md:flex md:w-80 lg:w-96 p-6 md:p-8 shrink-0 bg-slate-900/40 border-r border-slate-900 flex-col justify-between space-y-8">
        <div className="space-y-6">
          {/* Logo Brand */}
          <div className="flex items-center gap-3">
            <div className="p-1.5 bg-slate-950/40 rounded-xl border border-slate-800 shrink-0">
              <MetRepsLogo size={36} />
            </div>
            <div>
              <span className="font-black text-lg tracking-tight bg-gradient-to-r from-white via-slate-100 to-indigo-300 bg-clip-text text-transparent">
                MetReps
              </span>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest font-mono">
                Companion Engine
              </p>
            </div>
          </div>

          {/* Quick Explainer */}
          <div className="space-y-3">
            <h1 className="text-xl font-black text-white leading-snug">
              Your Complete <span className="bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">Lifting Companion</span>
            </h1>
            <p className="text-xs text-slate-400 leading-relaxed">
              We translated your React Native components into standard web modules. This lets you inspect your routines, log recovery, and view correlation analytics directly inside this preview sandbox!
            </p>
          </div>

          {/* Guidelines info */}
          <div className="space-y-3 bg-slate-900/60 p-4 rounded-2xl border border-slate-900/80">
            <h3 className="text-[10px] font-black uppercase text-indigo-400 tracking-widest flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5" /> Migration Instructions
            </h3>
            <ul className="space-y-2 text-[11px] text-slate-400 leading-normal pl-0.5">
              <li className="flex items-start gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                <span>Go to <strong className="text-white">Settings</strong> (top right cog icon) to upload or paste your 12 JSON files!</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                <span>The dashboard automatically handles custom schemas and registers them securely.</span>
              </li>
            </ul>
          </div>

          {/* Phone QR Code Scanner */}
          <div className="space-y-4 bg-slate-900/40 p-4 rounded-2xl border border-slate-900 flex flex-col items-center text-center">
            <div className="flex items-center gap-2 self-start">
              <QrCode className="w-4 h-4 text-indigo-400" />
              <h3 className="text-[10px] font-black uppercase text-indigo-400 tracking-widest">
                Scan to Open on Phone
              </h3>
            </div>
            
            <div className="bg-white p-2 rounded-xl border border-slate-800 shadow-md">
              <img
                src="https://api.qrserver.com/v1/create-qr-code/?size=130x130&data=https://ais-pre-5wrcnrcisuajwjhlf5gkym-176001435540.asia-southeast1.run.app"
                alt="Scan to open on phone"
                width={130}
                height={130}
                className="select-none pointer-events-none"
              />
            </div>

            <p className="text-[10px] text-slate-400 leading-normal">
              Click the <strong className="text-indigo-400 font-bold">"Share"</strong> button in the top-right of AI Studio to deploy! Once the build completes, scan this code to load it on your phone.
            </p>
          </div>
        </div>

        {/* Diagnostic Status Footer */}
        <div className="pt-6 border-t border-slate-900 space-y-2">
          <div className="flex items-center gap-2 text-xs text-slate-500 font-semibold font-mono">
            <HeartPulse className="w-4 h-4 text-emerald-400 shrink-0 animate-pulse" />
            <span>SANDBOX STATUS: ONLINE</span>
          </div>
          <p className="text-[10px] text-slate-600 font-medium">
            Local database powered by browser persistence storage.
          </p>
        </div>
      </aside>

      {/* RIGHT SIDE: Dynamic Premium Mobile Device Container */}
      <main className="flex-1 flex md:items-center justify-center p-0 md:py-12 md:px-4 bg-slate-950 md:bg-slate-950/80 overflow-hidden md:overflow-y-auto h-full md:h-auto">
        <div className="w-full h-full md:h-[780px] md:min-h-[780px] md:max-w-[420px] bg-slate-950 md:rounded-[38px] md:border-[6px] md:border-slate-900 md:shadow-[0_0_80px_-15px_rgba(99,102,241,0.12)] overflow-hidden flex flex-col justify-between relative">
          
          {/* Mobile Status Bar Mockup */}
          <div className="hidden md:flex bg-slate-950 h-7 shrink-0 px-6 items-center justify-between text-[10px] text-slate-500 font-mono font-bold select-none border-b border-slate-900/30">
            <span>MetReps Mobile</span>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
              <span>9:41 AM</span>
            </div>
          </div>

          {/* Screen Content Window */}
          <div ref={viewportRef} className="flex-1 overflow-y-auto px-0 py-4 scrollbar-none">
            {currentView === 'home' && (
              <HomeView
                currentProgram={currentProgram}
                workoutLogs={workoutLogs}
                selectedDate={selectedDate}
                setSelectedDate={setSelectedDate}
                onNavigate={handleNavigate}
              />
            )}

            {currentView === 'builder' && (
              <ProgramBuilder
                onClose={() => {
                  loadData();
                  handleNavigate('home', null);
                }}
                onSave={handleProgramSaved}
              />
            )}

            {currentView === 'logger' && (
              <WorkoutLogger
                initialParams={viewParams}
                onClose={() => {
                  handleNavigate('home', null);
                }}
                onSave={handleWorkoutSaved}
              />
            )}

            {currentView === 'analytics' && (
              <AnalyticsView workoutLogs={workoutLogs} />
            )}

            {currentView === 'history' && (
              <LogsHistoryView
                workoutLogs={workoutLogs}
                onRefresh={loadData}
              />
            )}

            {currentView === 'settings' && (
              <SettingsView
                currentProgram={currentProgram}
                onRefresh={loadData}
                onClose={() => handleNavigate('home', null)}
                themeId={themeId}
                onThemeChange={handleThemeChange}
              />
            )}

            {currentView === 'info' && (
              <InfoView onClose={() => handleNavigate('home', null)} />
            )}
          </div>

          {/* Phone Navigation Bar Mockup */}
          <nav className="bg-slate-900/90 backdrop-blur-md border-t border-slate-850 py-1.5 px-1 h-16 shrink-0 flex items-center justify-around text-slate-400 z-40">
            {/* Nav: Home */}
            <button
              onClick={() => handleNavigate('home')}
              className={`flex flex-col items-center justify-center transition flex-1 py-1 relative ${
                currentView === 'home' ? 'text-indigo-400' : 'hover:text-slate-200'
              }`}
            >
              <Calendar className="w-5 h-5" />
              <span className="text-[8px] font-bold mt-1 uppercase tracking-tight line-clamp-1">Home</span>
              {currentView === 'home' && (
                <span className="absolute bottom-[-2px] w-1 h-1 rounded-full bg-indigo-400 shadow-[0_0_8px_#818cf8]" />
              )}
            </button>

            {/* Nav: Build Program */}
            <button
              onClick={() => handleNavigate('builder')}
              className={`flex flex-col items-center justify-center transition flex-1 py-1 relative ${
                currentView === 'builder' ? 'text-indigo-400' : 'hover:text-slate-200'
              }`}
            >
              <PlusCircle className="w-5 h-5" />
              <span className="text-[8px] font-bold mt-1 uppercase tracking-tight line-clamp-1">Program</span>
              {currentView === 'builder' && (
                <span className="absolute bottom-[-2px] w-1 h-1 rounded-full bg-indigo-400 shadow-[0_0_8px_#818cf8]" />
              )}
            </button>

            {/* Nav: Next Programmed Workout */}
            <button
              onClick={handleNextProgrammedWorkout}
              className={`flex flex-col items-center justify-center transition flex-1 py-1 relative ${
                currentView === 'logger' && !viewParams?.isOneOff ? 'text-indigo-400' : 'hover:text-slate-200'
              }`}
            >
              <Dumbbell className="w-5 h-5" />
              <span className="text-[8px] font-bold mt-1 uppercase tracking-tight line-clamp-1">Next Prog</span>
              {currentView === 'logger' && !viewParams?.isOneOff && (
                <span className="absolute bottom-[-2px] w-1 h-1 rounded-full bg-indigo-400 shadow-[0_0_8px_#818cf8]" />
              )}
            </button>

            {/* Nav: Log One-Off Workout */}
            <button
              onClick={() => handleNavigate('logger', { isOneOff: true })}
              className={`flex flex-col items-center justify-center transition flex-1 py-1 relative ${
                currentView === 'logger' && viewParams?.isOneOff ? 'text-indigo-400' : 'hover:text-slate-200'
              }`}
            >
              <Plus className="w-5 h-5" />
              <span className="text-[8px] font-bold mt-1 uppercase tracking-tight line-clamp-1">One-Off</span>
              {currentView === 'logger' && viewParams?.isOneOff && (
                <span className="absolute bottom-[-2px] w-1 h-1 rounded-full bg-indigo-400 shadow-[0_0_8px_#818cf8]" />
              )}
            </button>

            {/* Nav: Analytics */}
            <button
              onClick={() => handleNavigate('analytics')}
              className={`flex flex-col items-center justify-center transition flex-1 py-1 relative ${
                currentView === 'analytics' ? 'text-indigo-400' : 'hover:text-slate-200'
              }`}
            >
              <LineChart className="w-5 h-5" />
              <span className="text-[8px] font-bold mt-1 uppercase tracking-tight line-clamp-1">Trends</span>
              {currentView === 'analytics' && (
                <span className="absolute bottom-[-2px] w-1 h-1 rounded-full bg-indigo-400 shadow-[0_0_8px_#818cf8]" />
              )}
            </button>

            {/* Nav: Diary */}
            <button
              onClick={() => handleNavigate('history')}
              className={`flex flex-col items-center justify-center transition flex-1 py-1 relative ${
                currentView === 'history' ? 'text-indigo-400' : 'hover:text-slate-200'
              }`}
            >
              <BookOpen className="w-5 h-5" />
              <span className="text-[8px] font-bold mt-1 uppercase tracking-tight line-clamp-1">Diary</span>
              {currentView === 'history' && (
                <span className="absolute bottom-[-2px] w-1 h-1 rounded-full bg-indigo-400 shadow-[0_0_8px_#818cf8]" />
              )}
            </button>
          </nav>
        </div>
      </main>
    </div>
  );
}
