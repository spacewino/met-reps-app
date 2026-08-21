/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { LineChart, TrendingUp, Sparkles, Coffee, Droplet, Flame, Brain, Award, AlertCircle, Dumbbell, Target, Info, X, ArrowLeft } from 'lucide-react';
import { WorkoutLog, SetEntry, Program, HydrationLevel, mapLitersToHydration, mapHydrationToLiters } from '../types';
import { storage } from '../lib/storage';
import { useModalHistory } from '../lib/useModalHistory';
import {
  getUniqueTrackedExercises,
  getStrengthProgression,
  downsampleStrengthHistory,
  getPlateauStatus,
  getPersonalRecords,
  getRecoveryCorrelations,
} from '../lib/historicalAnalytics';
import { getProgramReportCard, getReportChartData } from '../lib/programReportCard';

interface AnalyticsViewProps {
  workoutLogs: WorkoutLog[];
  initialProgramId?: string | null;
}

export function AnalyticsView({ workoutLogs, initialProgramId }: AnalyticsViewProps) {
  const themeId = useMemo(() => storage.getTheme(), []);
  const isDesert = themeId === 'amber';
  const isFeralas = themeId === 'onyx';

  const [selectedExercise, setSelectedExercise] = useState<string>('Back Squat (High Bar)');
  const [prSearch, setPrSearch] = useState<string>('');
  const [selectedPrMuscle, setSelectedPrMuscle] = useState<string>('All');
  const [isExerciseDropdownOpen, setIsExerciseDropdownOpen] = useState(false);
  const [isMuscleDropdownOpen, setIsMuscleDropdownOpen] = useState(false);
  const [showTargetInfo, setShowTargetInfo] = useState(false);
  
  // Report Card state
  const [selectedReportProgram, setSelectedReportProgram] = useState<Program | null>(null);
  const [reportChartExercise, setReportChartExercise] = useState<string>('Overall');
  const [isReportExerciseDropdownOpen, setIsReportExerciseDropdownOpen] = useState(false);

  const { dismiss: dismissReportCard } = useModalHistory(
    selectedReportProgram !== null,
    () => setSelectedReportProgram(null),
    'program-report-card'
  );

  // Pre-select program from initialProgramId prop
  useEffect(() => {
    if (initialProgramId) {
      const allProgs = storage.getPrograms();
      const match = allProgs.find(p => p.id === initialProgramId);
      if (match) {
        setSelectedReportProgram(match);
      }
    }
  }, [initialProgramId]);

  // Active chart tooltip states for mobile/desktop tapping/hovering
  const [activeTrendDotIdx, setActiveTrendDotIdx] = useState<number | null>(null);
  const [activeReportDotIdx, setActiveReportDotIdx] = useState<number | null>(null);

  // Scroll to top when report card is loaded
  useEffect(() => {
    if (selectedReportProgram) {
      window.scrollTo(0, 0);
      // Also scroll the viewport wrapper in App.tsx to the top
      const scrollContainers = document.querySelectorAll('.overflow-y-auto, .scrollbar-none');
      scrollContainers.forEach(container => {
        container.scrollTop = 0;
      });
    }
  }, [selectedReportProgram]);

  // Reset active tooltips when selected items change
  useEffect(() => {
    setActiveTrendDotIdx(null);
  }, [selectedExercise]);

  useEffect(() => {
    setActiveReportDotIdx(null);
  }, [selectedReportProgram, reportChartExercise]);

  const exerciseDropdownRef = useRef<HTMLDivElement>(null);
  const muscleDropdownRef = useRef<HTMLDivElement>(null);
  const reportExerciseDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: PointerEvent | TouchEvent) {
      if (exerciseDropdownRef.current && !exerciseDropdownRef.current.contains(event.target as Node)) {
        setIsExerciseDropdownOpen(false);
      }
      if (muscleDropdownRef.current && !muscleDropdownRef.current.contains(event.target as Node)) {
        setIsMuscleDropdownOpen(false);
      }
      if (reportExerciseDropdownRef.current && !reportExerciseDropdownRef.current.contains(event.target as Node)) {
        setIsReportExerciseDropdownOpen(false);
      }
    }
    document.addEventListener('pointerdown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('pointerdown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, []);

  // Extract all unique exercises logged in history
  const uniqueExercises = useMemo(() => {
    return getUniqueTrackedExercises(workoutLogs);
  }, [workoutLogs]);

  useEffect(() => {
    if (uniqueExercises.length > 0 && !uniqueExercises.includes(selectedExercise)) {
      setSelectedExercise(uniqueExercises[0]);
    }
  }, [uniqueExercises, selectedExercise]);

  // Track weight history for the selected exercise (ordered chronologically)
  const exerciseHistory = useMemo(() => {
    return getStrengthProgression(workoutLogs, selectedExercise, storage.getWeightUnit());
  }, [workoutLogs, selectedExercise]);

  // Downsample to max 10 points if there are too many logs, ensuring beautiful distribution across time
  const processedHistory = useMemo(() => {
    return downsampleStrengthHistory(exerciseHistory, 10);
  }, [exerciseHistory]);

  // Plateau Detection calculation based on 1RM standardisation
  const plateauStatus = useMemo(() => {
    return getPlateauStatus(exerciseHistory);
  }, [exerciseHistory]);

  // PR Spotlights matched with recovery stats and standardized by estimated 1RM
  const personalRecords = useMemo(() => {
    return getPersonalRecords(workoutLogs, 'kg');
  }, [workoutLogs]);

  // Extract unique muscle groups from the personal records for filtering
  const uniquePrMuscles = useMemo(() => {
    const muscles = new Set<string>();
    personalRecords.forEach(pr => {
      if (pr.muscleGroup) {
        muscles.add(pr.muscleGroup);
      }
    });
    return Array.from(muscles).sort();
  }, [personalRecords]);

  // Filter personal records by search query and muscle group
  const filteredPersonalRecords = useMemo(() => {
    return personalRecords.filter(pr => {
      const matchesSearch = pr.exercise.toLowerCase().includes(prSearch.toLowerCase());
      const matchesMuscle = selectedPrMuscle === 'All' || pr.muscleGroup === selectedPrMuscle;
      return matchesSearch && matchesMuscle;
    });
  }, [personalRecords, prSearch, selectedPrMuscle]);

  // Correlation metrics: Sleep Impact & Calories fuel factor computed dynamically for the selected exercise using standardized Est. 1RM
  const correlations = useMemo(() => {
    return getRecoveryCorrelations(workoutLogs, selectedExercise, storage.getWeightUnit());
  }, [workoutLogs, selectedExercise]);

  // Custom SVG Chart dimensions
  const chartWidth = 500;
  const chartHeight = 160;
  const padding = 24;

  const svgPaths = useMemo(() => {
    if (processedHistory.length < 2) return { linePath: '', dots: [] };

    const onesRM = processedHistory.map(d => d.max1RM);
    const minW = Math.min(...onesRM) * 0.9; // 10% lower boundary for nice scale
    const maxW = Math.max(...onesRM) * 1.1; // 10% upper boundary
    const range = maxW - minW || 10;

    const points = processedHistory.map((d, index) => {
      const x = padding + (index / (processedHistory.length - 1)) * (chartWidth - padding * 2);
      const y = chartHeight - padding - ((d.max1RM - minW) / range) * (chartHeight - padding * 2);
      return { x, y, val: d.max1RM, rawWeight: d.maxWeight, date: d.date };
    });

    let linePath = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      linePath += ` L ${points[i].x} ${points[i].y}`;
    }

    return { linePath, dots: points };
  }, [processedHistory]);

  const currentProgramId = storage.getCurrentProgramId();

  const reportPrograms = useMemo(() => {
    const list = storage.getPrograms();
    return list.filter(p => workoutLogs.some(l => l.programId === p.id));
  }, [workoutLogs]);

  const activeReportPrograms = useMemo(() => {
    return reportPrograms.filter(p => !storage.isProgramCompleted(p, workoutLogs));
  }, [reportPrograms, workoutLogs]);

  const completedReportPrograms = useMemo(() => {
    return reportPrograms.filter(p => storage.isProgramCompleted(p, workoutLogs));
  }, [reportPrograms, workoutLogs]);

  const reportCard = useMemo(() => {
    if (!selectedReportProgram) return null;
    return getProgramReportCard(selectedReportProgram, workoutLogs, storage.getWeightUnit());
  }, [selectedReportProgram, workoutLogs]);

  const reportExercises = useMemo(() => {
    if (!selectedReportProgram) return [];
    const list = new Set<string>();
    Object.keys(selectedReportProgram.exercisesByDay).forEach(key => {
      const d = Number(key);
      if (d <= selectedReportProgram.daysPerWeek) {
        const exs = selectedReportProgram.exercisesByDay[d] || [];
        exs.forEach(ex => list.add(ex.name));
      }
    });
    return ['Overall', ...Array.from(list)];
  }, [selectedReportProgram]);

  const reportChartData = useMemo(() => {
    if (!selectedReportProgram) return null;
    return getReportChartData(selectedReportProgram, workoutLogs, reportChartExercise, storage.getWeightUnit());
  }, [selectedReportProgram, reportChartExercise, workoutLogs]);

  // Coordinate math for Report SVG Chart
  const { pointsWithCoords, paddedMin, paddedMax, paddedRange, projPath, actPath } = useMemo(() => {
    if (!reportChartData || reportChartData.points.length === 0) {
      return { pointsWithCoords: [], paddedMin: 0, paddedMax: 100, paddedRange: 100, projPath: '', actPath: '' };
    }

    const allValues = reportChartData.points.flatMap(p => [p.projected, p.actual].filter((v): v is number => v !== null));
    const maxVal = allValues.length > 0 ? Math.max(...allValues) : 100;
    const minVal = allValues.length > 0 ? Math.min(...allValues) : 0;
    const range = maxVal - minVal || 10;
    
    const pMin = Math.max(0, minVal - range * 0.1);
    const pMax = maxVal + range * 0.1;
    const pRange = pMax - pMin || 10;

    const numPoints = reportChartData.points.length;
    const svgWidth = 500;
    const svgHeight = 220;
    const padL = 45;
    const padR = 20;
    const padT = 20;
    const padB = 30;

    const points = reportChartData.points.map((p, index) => {
      const x = padL + (index / (numPoints - 1 || 1)) * (svgWidth - padL - padR);
      const yProj = svgHeight - padB - ((p.projected - pMin) / pRange) * (svgHeight - padB - padT);
      const yAct = p.actual !== null
        ? svgHeight - padB - ((p.actual - pMin) / pRange) * (svgHeight - padB - padT)
        : null;

      return { ...p, x, yProj, yAct };
    });

    let pPath = `M ${points[0].x} ${points[0].yProj}`;
    for (let i = 1; i < points.length; i++) {
      pPath += ` L ${points[i].x} ${points[i].yProj}`;
    }

    const validActuals = points.filter(p => p.yAct !== null);
    let aPath = '';
    if (validActuals.length > 0) {
      aPath = `M ${validActuals[0].x} ${validActuals[0].yAct}`;
      for (let i = 1; i < validActuals.length; i++) {
        aPath += ` L ${validActuals[i].x} ${validActuals[i].yAct}`;
      }
    }

    return {
      pointsWithCoords: points,
      paddedMin: pMin,
      paddedMax: pMax,
      paddedRange: pRange,
      projPath: pPath,
      actPath: aPath
    };
  }, [reportChartData]);

  if (selectedReportProgram && reportCard) {
    return (
      <div className="space-y-6 pb-20 font-sans animate-fade-in bg-slate-950 min-h-screen">
        {/* Header Bar with Back Button */}
        <div className="sticky top-[-16px] -mt-4 pt-3 pb-2.5 bg-slate-950 z-30 flex items-center gap-3 border-b border-slate-850 px-4 shadow-md">
          <button
            onClick={dismissReportCard}
            className="p-2 bg-slate-900 hover:bg-slate-800 rounded-none text-slate-400 hover:text-white border border-slate-800 transition cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h2 className="font-extrabold text-xs text-white uppercase tracking-wide font-sans">
              PROGRAM REPORT CARD
            </h2>
            <p className="text-[9px] text-emerald-400 font-mono uppercase tracking-widest">
              {storage.isProgramCompleted(selectedReportProgram, workoutLogs) ? 'Final Performance Evaluation' : 'Interim Midterm Analysis'}
            </p>
          </div>
        </div>

        {/* Program Title Block */}
        <div className="w-full bg-slate-900 border-y border-slate-800 p-4 space-y-1.5">
          <h3 className="text-base font-black text-white uppercase tracking-tight">{selectedReportProgram.name}</h3>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[9px] text-slate-400 font-bold uppercase tracking-wider">
            <span>Objective: {selectedReportProgram.objective}</span>
            <span>•</span>
            <span>Split: {selectedReportProgram.daysPerWeek === 1 ? 'Full Body' : (selectedReportProgram.assignedWeekdays && Object.keys(selectedReportProgram.assignedWeekdays).length > 0 ? 'Custom Split' : 'Sequential Split')}</span>
            <span>•</span>
            <span>Model: {selectedReportProgram.algorithmId ? selectedReportProgram.algorithmId.replace('_', ' ') : 'linear'}</span>
          </div>
        </div>

        {/* Score and Grade Bento Block */}
        <div className="px-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            {/* Grade display */}
            <div className="sm:col-span-2 border border-slate-800 bg-slate-900 p-4 flex flex-col items-center justify-center text-center space-y-1">
              <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest font-mono">Performance Grade</span>
              <div className={`text-5xl font-black font-mono tracking-tighter ${reportCard.score >= 90 ? 'text-emerald-400' : reportCard.score >= 80 ? 'text-cyan-400' : reportCard.score >= 70 ? 'text-yellow-400' : 'text-rose-400'}`}>
                {reportCard.grade}
              </div>
              <div className="text-[10px] text-white uppercase font-black tracking-wide">
                {reportCard.gradeSub}
              </div>
              <div className="text-sm text-slate-400 font-semibold font-mono">
                Score: {reportCard.score}/100
              </div>
            </div>

            {/* Quick stats columns */}
            <div className="sm:col-span-2 grid grid-cols-2 sm:grid-cols-1 gap-2">
              <div className="bg-slate-900 border border-slate-800 p-3.5 flex flex-col justify-between">
                <span className="text-[8px] text-slate-500 font-bold uppercase tracking-wider font-mono">Adherence Rate</span>
                <div>
                  <div className="text-xl font-black text-indigo-400 font-mono leading-none">{reportCard.adherenceRate}%</div>
                  <span className="text-[8px] text-slate-500 font-semibold uppercase block mt-1">{reportCard.completedCount} / {reportCard.totalPlannedDays} Sessions</span>
                </div>
              </div>
              <div className="bg-slate-900 border border-slate-800 p-3.5 flex flex-col justify-between">
                <span className="text-[8px] text-slate-500 font-bold uppercase tracking-wider font-mono">Personal Records Hit</span>
                <div>
                  <div className="text-xl font-black text-cyan-400 font-mono leading-none">+{reportCard.totalPRsHit}</div>
                  <span className="text-[8px] text-slate-500 font-semibold uppercase block mt-1">During Program</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Strongest Muscle and Growth Summary */}
        <div className="px-4">
          <div className="bg-slate-900 border border-slate-800 p-4 grid grid-cols-2 gap-4">
            <div>
              <span className="block text-[8px] text-slate-500 font-bold uppercase tracking-wider font-mono">Strongest Adaptor</span>
              <div className="text-sm font-black text-emerald-400 uppercase mt-1 leading-tight">{reportCard.strongestMuscle}</div>
              <span className="text-[8px] text-slate-500 font-semibold uppercase block mt-0.5">Top responding muscle group</span>
            </div>
            <div>
              <span className="block text-[8px] text-slate-500 font-bold uppercase tracking-wider font-mono">Average E1RM Progression</span>
              <div className="text-sm font-black text-indigo-400 font-mono mt-1 leading-tight">+{reportCard.avgActualGrowth.toFixed(1)}%</div>
              <span className="text-[8px] text-slate-500 font-semibold uppercase block mt-0.5">Across programmed lifts</span>
            </div>
          </div>
        </div>

        {/* Magic Recovery & Science Feedback */}
        <div className="w-full bg-slate-900 border-y border-slate-800 p-4 space-y-3">
          <div className="flex items-center border-b border-slate-850 pb-1.5">
            <h4 className="font-extrabold text-xs text-white uppercase tracking-wider">Recovery & Bio-Feedback Diagnostics</h4>
          </div>
          
          <div className="bg-slate-950/40 border border-slate-850 p-4 space-y-3.5">
            {reportCard.feedbacks.map((fb, idx) => (
              <div key={idx} className="flex gap-2.5 items-start">
                <span className="text-[10px] text-emerald-400 font-mono font-bold mt-0.5 bg-emerald-500/10 border border-emerald-500/20 px-1 py-0.2">0{idx + 1}</span>
                <p className="text-[11px] text-slate-300 leading-relaxed font-sans">
                  {fb.split('**').map((chunk, chunkIdx) => 
                    chunkIdx % 2 === 1 ? <strong key={chunkIdx} className="text-white font-extrabold">{chunk}</strong> : chunk
                  )}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Chart Section */}
        <div className="w-full bg-slate-900 border-y border-slate-800 p-4 space-y-4">
          <div className="space-y-3 border-b border-slate-850 pb-2">
            <h4 className="font-extrabold text-xs text-white uppercase tracking-wider">Algorithmic Projection Mapping</h4>

            {/* Dropdown for chart filtering */}
            <div ref={reportExerciseDropdownRef} className="relative w-full z-20">
              <button
                type="button"
                onClick={() => setIsReportExerciseDropdownOpen(!isReportExerciseDropdownOpen)}
                className="w-full bg-slate-950 border border-slate-850 rounded-none px-3 text-xs font-bold text-slate-300 focus:outline-none focus:border-indigo-500 h-9 flex items-center justify-between cursor-pointer hover:bg-slate-900 transition font-sans"
              >
                <span>{reportChartExercise === 'Overall' ? 'Overall Relative Progress' : reportChartExercise}</span>
                <span className="text-[7px] text-slate-500">▼</span>
              </button>
              {isReportExerciseDropdownOpen && (
                <div className="absolute left-0 right-0 top-10 bg-slate-950 border border-slate-800 rounded-none shadow-2xl z-50 overflow-y-auto max-h-60 py-1 font-sans">
                  {reportExercises.map(exName => (
                    <button
                      key={exName}
                      type="button"
                      onClick={() => {
                        setReportChartExercise(exName);
                        setIsReportExerciseDropdownOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2 text-xs font-bold border-y border-transparent cursor-pointer transition ${
                        reportChartExercise === exName
                          ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30'
                          : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                      }`}
                    >
                      {exName === 'Overall' ? 'Overall Relative Progress' : exName}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {reportChartData && (
            <div className="bg-slate-950/40 border border-slate-850 p-3.5 rounded-none space-y-3">
              <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-wider font-sans">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1">
                    <span className="w-3 h-0.5 bg-emerald-400 inline-block border-t border-dashed border-emerald-400"></span>
                    <span className="text-emerald-400 font-semibold">Algorithmic Target (Projected)</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className={`w-3 h-0.5 inline-block ${isFeralas ? '' : 'bg-indigo-400'}`} style={isFeralas ? { backgroundColor: '#E05A47' } : undefined}></span>
                    <span className={`font-semibold ${isFeralas ? '' : 'text-indigo-400'}`} style={isFeralas ? { color: '#E05A47' } : undefined}>Your Progress (Actual)</span>
                  </div>
                </div>
                <div className="text-slate-500 font-mono">Unit: {reportChartData.unit}</div>
              </div>

              {/* SVG Chart */}
              <div className="w-full overflow-hidden relative">
                {activeReportDotIdx !== null && pointsWithCoords[activeReportDotIdx] && (
                  <div className="absolute top-1 left-1 right-1 border p-2 shadow-xl flex items-center justify-between text-xs font-sans z-10 rounded-none animate-in fade-in slide-in-from-top-1 duration-150 bg-[var(--theme-card)] border-[var(--theme-border)]">
                    <div className="flex flex-col text-left">
                      <span className="text-[9px] text-[var(--theme-text-muted)] font-bold uppercase tracking-wider">Week</span>
                      <span className="font-extrabold text-[var(--theme-text-primary)] text-xs">{pointsWithCoords[activeReportDotIdx].week}</span>
                    </div>
                    <div className="flex flex-col text-right col-span-2">
                      <span className="text-[9px] text-[var(--theme-success)] font-bold uppercase tracking-wider">Target (Proj.)</span>
                      <span className="font-mono font-black text-[var(--theme-success)] text-xs">
                        {pointsWithCoords[activeReportDotIdx].projected}{reportChartData.unit}
                      </span>
                    </div>
                    <div className="flex flex-col text-right">
                      <span className={`text-[9px] font-bold uppercase tracking-wider ${isFeralas ? '' : 'text-[var(--theme-accent)]'}`} style={isFeralas ? { color: '#E05A47' } : undefined}>Progress (Actual)</span>
                      <span className={`font-mono font-black text-xs ${isFeralas ? '' : 'text-[var(--theme-accent)]'}`} style={isFeralas ? { color: '#E05A47' } : undefined}>
                        {pointsWithCoords[activeReportDotIdx].actual !== null 
                          ? `${pointsWithCoords[activeReportDotIdx].actual}${reportChartData.unit}`
                          : 'No log yet'}
                      </span>
                    </div>
                    <button 
                      onClick={(e) => { e.stopPropagation(); setActiveReportDotIdx(null); }}
                      className="text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] p-1 ml-1 cursor-pointer font-bold text-sm"
                    >
                      &times;
                    </button>
                  </div>
                )}
                <svg viewBox="0 0 500 220" className="w-full h-auto overflow-visible select-none">
                  {/* Grid lines */}
                  {Array.from({ length: 4 }).map((_, i) => {
                    const y = 20 + i * 56.6;
                    const gridVal = paddedMax - i * (paddedRange / 3);
                    return (
                      <g key={i} className="opacity-20">
                        <line x1="45" y1={y} x2="480" y2={y} className="stroke-slate-700" strokeWidth="1" strokeDasharray="2 2" />
                        <text x="5" y={y + 4} className="fill-slate-500 text-[8px] font-mono font-bold">
                          {Math.round(gridVal)}{reportChartData.unit}
                        </text>
                      </g>
                    );
                  })}

                  {/* Chart lines */}
                  {pointsWithCoords.length > 1 && (
                    <>
                      {/* Projected Line */}
                      <path
                        d={projPath}
                        fill="none"
                        className="stroke-emerald-400 opacity-80"
                        strokeWidth="2.5"
                        strokeDasharray="4 4"
                      />
                      {/* Actual Line */}
                      {actPath && (
                        <path
                          d={actPath}
                          fill="none"
                          className={isFeralas ? "" : "stroke-indigo-400"}
                          style={isFeralas ? { stroke: '#E05A47' } : undefined}
                          strokeWidth="3"
                        />
                      )}

                      {/* Data Points */}
                      {pointsWithCoords.map((p, idx) => (
                        <g 
                          key={idx}
                          className="group cursor-pointer"
                          onMouseEnter={() => setActiveReportDotIdx(idx)}
                          onMouseLeave={() => setActiveReportDotIdx(null)}
                          onClick={() => setActiveReportDotIdx(idx)}
                        >
                          {/* Invisible larger touch target for mobile friendliness */}
                          <circle cx={p.x} cy={p.yProj} r="18" className="fill-transparent stroke-transparent" />
                          <circle
                            cx={p.x}
                            cy={p.yProj}
                            r={activeReportDotIdx === idx ? "5" : "3"}
                            className={`fill-slate-900 stroke-emerald-400 transition-all duration-150 ${activeReportDotIdx === idx ? 'stroke-cyan-400 stroke-2' : 'stroke-[1.5]'}`}
                          />
                          {p.yAct !== null && (
                            <>
                              <circle
                                cx={p.x}
                                cy={p.yAct}
                                r={activeReportDotIdx === idx ? "6" : "4"}
                                className={isFeralas ? "stroke-slate-900 transition-all duration-150" : `fill-indigo-500 stroke-slate-900 transition-all duration-150 ${activeReportDotIdx === idx ? 'fill-cyan-400 stroke-slate-900' : ''}`}
                                style={isFeralas ? { fill: activeReportDotIdx === idx ? '#F59E0B' : '#E05A47' } : undefined}
                                strokeWidth="2"
                              />
                              <text
                                x={p.x}
                                y={p.yAct - 8}
                                textAnchor="middle"
                                className={`fill-white text-[8px] font-mono font-black transition-all duration-150 ${activeReportDotIdx === idx ? (isFeralas ? 'fill-[#F59E0B] scale-110 text-[9px]' : 'fill-cyan-300 scale-110 text-[9px]') : ''}`}
                              >
                                {p.actual}{reportChartData.unit === '%' ? '%' : ''}
                              </text>
                            </>
                          )}
                        </g>
                      ))}
                    </>
                  )}

                  {/* X Axis labels */}
                  {pointsWithCoords.map((p, idx) => (
                    <text
                      key={idx}
                      x={p.x}
                      y="210"
                      textAnchor="middle"
                      className="fill-slate-500 text-[8px] font-mono font-bold"
                    >
                      {p.week}
                    </text>
                  ))}
                </svg>
              </div>
            </div>
          )}
        </div>

        {/* Footer Button to Return */}
        <div className="px-4">
          <button
            type="button"
            onClick={dismissReportCard}
            className="w-full bg-slate-900 hover:bg-slate-800 text-slate-300 font-extrabold text-xs py-4 px-4 border border-slate-800 transition uppercase tracking-widest cursor-pointer"
          >
            Back to Trends
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-20">
      {/* Header Bar */}
      <div className="flex items-center gap-2 border-b border-slate-850 pb-3 px-4">
        <Dumbbell className="w-6 h-6 text-indigo-400" />
        <div>
          <h2 className="font-extrabold text-[22px] sm:text-[24px] text-white uppercase tracking-wide leading-none">PERFORMANCE TRENDS</h2>
          <p className="text-[10px] text-indigo-400 font-mono uppercase tracking-widest mt-1">Progress and analytics for weighted exercises</p>
        </div>
      </div>

      {/* Selector and Chart Card */}
      <div className="w-full bg-slate-900 border-y border-x-0 border-slate-800 p-4 shadow-sm rounded-none">
        <div className="border-b border-slate-850 pb-3 mb-4 space-y-3">
          <div>
            <h2 className="font-extrabold text-[18px] text-slate-300 uppercase tracking-wide">Strength Progression</h2>
            <p className="text-[9px] text-slate-500 font-semibold uppercase tracking-wider">Standardised Est. 1RM (Epley formula)</p>
          </div>
          
          <div ref={exerciseDropdownRef} className="relative">
            <button
              type="button"
              onClick={() => setIsExerciseDropdownOpen(!isExerciseDropdownOpen)}
              className="w-full bg-slate-950 border border-slate-850 rounded-none px-3 text-sm font-bold text-slate-300 focus:outline-none focus:border-indigo-500 h-11 flex items-center justify-between cursor-pointer hover:bg-slate-900 transition"
            >
              <span>{selectedExercise}</span>
              <span className="text-[8px] text-slate-500">▼</span>
            </button>
            {isExerciseDropdownOpen && (
              <div className="absolute left-0 right-0 top-12 bg-slate-950 border border-slate-800 rounded-none shadow-2xl z-50 overflow-y-auto max-h-60 py-1 font-sans">
                {uniqueExercises.map(exName => (
                  <button
                    key={exName}
                    type="button"
                    onClick={() => {
                      setSelectedExercise(exName);
                      setIsExerciseDropdownOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2.5 text-xs font-bold border-y border-transparent cursor-pointer transition ${
                      selectedExercise === exName
                        ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30'
                        : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                    }`}
                  >
                    {exName}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Dynamic SVG chart */}
        {exerciseHistory.length < 2 ? (
          <div className="h-40 flex flex-col items-center justify-center border border-dashed border-slate-800 rounded-none bg-slate-950/40 p-4 text-center">
            <AlertCircle className="w-5 h-5 text-slate-600 mb-2" />
            <p className="text-xs text-slate-500 max-w-xs font-medium font-sans">
              Not enough chronological logs for <strong className="text-slate-400">{selectedExercise}</strong> to plot regression graphs. Keep logging!
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {exerciseHistory.length > 10 && (
              <div className="text-[11px] text-indigo-400 font-bold bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-1.5 rounded-none inline-flex items-center shadow-sm font-sans">
                Showing {processedHistory.length} chronological peak points across {exerciseHistory.length} logged sessions. Tap for details!
              </div>
            )}
            <div className="relative overflow-hidden rounded-none border border-slate-850 bg-slate-950/75 p-2">
              {activeTrendDotIdx !== null && svgPaths.dots[activeTrendDotIdx] && (
                <div className="absolute top-1 left-1 right-1 border p-2 shadow-xl flex items-center justify-between text-xs font-sans z-10 rounded-none animate-in fade-in slide-in-from-top-1 duration-150 bg-[var(--theme-card)] border-[var(--theme-border)]">
                  <div className="flex flex-col text-left">
                    <span className="text-[9px] text-[var(--theme-text-muted)] font-bold uppercase tracking-wider">Date</span>
                    <span className="font-extrabold text-[var(--theme-text-primary)] text-xs">{svgPaths.dots[activeTrendDotIdx].date}</span>
                  </div>
                  <div className="flex flex-col text-right">
                    <span className="text-[9px] text-[var(--theme-accent)] font-bold uppercase tracking-wider">Est. 1RM</span>
                    <span className="font-mono font-black text-[var(--theme-accent)] text-xs">
                      {svgPaths.dots[activeTrendDotIdx].val} {storage.getWeightUnit()}
                    </span>
                  </div>
                  <div className="flex flex-col text-right">
                    <span className={`text-[9px] font-bold uppercase tracking-wider ${isDesert ? 'text-[#9B1C1C]' : 'text-[var(--theme-accent-cyan)]'}`}>Logged Max</span>
                    <span className={`font-mono font-black text-xs ${isDesert ? 'text-[#E05A47]' : 'text-[var(--theme-accent-cyan)]'}`}>
                      {svgPaths.dots[activeTrendDotIdx].rawWeight} {storage.getWeightUnit()}
                    </span>
                  </div>
                  <button 
                    onClick={(e) => { e.stopPropagation(); setActiveTrendDotIdx(null); }}
                    className="text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] p-1 ml-1 cursor-pointer font-bold text-sm"
                  >
                    &times;
                  </button>
                </div>
              )}
              <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-auto">
                {/* Horizontal reference lines */}
                <line x1={padding} y1={chartHeight / 2} stroke="var(--theme-border, #1E293B)" strokeDasharray="3 3" />
                
                {/* Main line path */}
                <path d={svgPaths.linePath} fill="none" stroke="url(#gradient-indigo-cyan)" strokeWidth="3" strokeLinecap="round" />
                
                {/* Dots along path */}
                {svgPaths.dots.map((dot, idx) => (
                  <g 
                    key={idx} 
                    className="group cursor-pointer"
                    onMouseEnter={() => setActiveTrendDotIdx(idx)}
                    onMouseLeave={() => setActiveTrendDotIdx(null)}
                    onClick={() => setActiveTrendDotIdx(idx)}
                  >
                    <title>
                      {`Date: ${dot.date}\nStandardised Est. 1RM: ${dot.val} ${storage.getWeightUnit()}\nLogged Max Weight: ${dot.rawWeight} ${storage.getWeightUnit()}`}
                    </title>
                    {/* Invisible larger touch target for mobile friendliness */}
                    <circle cx={dot.x} cy={dot.y} r="18" className="fill-transparent stroke-transparent" />
                    <circle 
                      cx={dot.x} 
                      cy={dot.y} 
                      r={activeTrendDotIdx === idx ? "7" : "5"} 
                      className={`fill-slate-950 stroke-indigo-400 transition-all duration-150 ${activeTrendDotIdx === idx ? 'stroke-cyan-400 stroke-[3.5]' : 'stroke-[2.5]'}`} 
                    />
                    {/* Text above active dots - increased font size and brightness for maximum clarity */}
                    <text x={dot.x} y={dot.y - 12} className={`fill-slate-100 text-[14px] font-mono font-black animate-pulse transition-all duration-150 ${activeTrendDotIdx === idx ? 'fill-cyan-300 scale-110 text-[15px]' : ''}`} textAnchor="middle">
                      {dot.val}{storage.getWeightUnit()}
                    </text>
                    {/* Date label at bottom of chart */}
                    <text x={dot.x} y={chartHeight - 4} className={`fill-slate-400 text-[8px] font-bold transition-all duration-150 ${activeTrendDotIdx === idx ? 'fill-slate-200 text-[9px]' : ''}`} textAnchor="middle">
                      {dot.date}
                    </text>
                  </g>
                ))}

                <defs>
                  <linearGradient id="gradient-indigo-cyan" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="var(--theme-accent, #6366f1)" />
                    <stop offset="100%" stopColor="var(--theme-accent-cyan, #06b6d4)" />
                  </linearGradient>
                </defs>
              </svg>
            </div>

            {/* Plateau indicator badge */}
            <div className={`p-3.5 rounded-none border flex gap-3 items-start ${plateauStatus.color || 'bg-slate-950 border-slate-850 text-slate-300'}`}>
              <TrendingUp className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-extrabold text-xs uppercase tracking-wider font-sans">{plateauStatus.status}</h4>
                <p className="text-[11px] opacity-80 leading-relaxed mt-0.5 font-sans">{plateauStatus.desc}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Correlation Insight Engine */}
      <div className="w-full bg-slate-900 border-y border-x-0 border-slate-800 p-4 space-y-4 shadow-sm rounded-none">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-850 pb-2.5">
          <h3 className="font-extrabold text-xs text-slate-400 uppercase tracking-wider">
            Recovery Correlations
          </h3>
          <span className="text-[10px] text-indigo-400 bg-indigo-500/10 px-2.5 py-0.5 rounded-none border border-indigo-500/20 font-bold uppercase tracking-wider self-start sm:self-auto">
            Focused: {selectedExercise}
          </span>
        </div>

        {correlations && correlations.sleepCount >= 2 ? (
          <div className="grid md:grid-cols-2 gap-3">
            {/* Left Column: Sleep Correlation & Target */}
            <div className="flex flex-col gap-1.5">
              {/* Sleep Correlation Card */}
              <div className="bg-slate-950/70 p-3.5 rounded-none border border-slate-850 space-y-3 flex flex-col justify-between flex-1">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Coffee className="w-4 h-4 text-indigo-400" />
                    <h4 className="font-bold text-xs text-white uppercase tracking-wider">The Sleep Bonus</h4>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed font-sans">
                    {correlations.sleepDesc}
                  </p>
                </div>
                
                <div className="border-t border-slate-900/50 pt-2.5">
                  <div className="text-[8px] text-slate-500 font-bold uppercase tracking-widest font-mono">1RM Correlation</div>
                  <div className="text-xl sm:text-2xl font-black text-indigo-400 font-mono">
                    {correlations.sleepFactor}
                  </div>
                </div>
              </div>

              {/* Target Sleep Card */}
              {correlations.targetSleep && (
                <div className="bg-slate-950/45 p-3.5 rounded-none border border-slate-850 space-y-2 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Target className="w-4 h-4 text-indigo-400" />
                      <h4 className="font-bold text-xs text-white uppercase tracking-wider">Target Sleep</h4>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowTargetInfo(true)}
                      className="p-1 hover:bg-slate-900 rounded-none text-slate-500 hover:text-indigo-400 transition cursor-pointer"
                      title="How is this calculated?"
                    >
                      <Info className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div>
                    <div className="text-xl sm:text-2xl font-black text-indigo-400 font-mono">
                      {correlations.targetSleep} hrs
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right Column: Calories Correlation & Target */}
            <div className="flex flex-col gap-1.5">
              {/* Calories Correlation Card */}
              <div className="bg-slate-950/70 p-3.5 rounded-none border border-slate-850 space-y-3 flex flex-col justify-between flex-1">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Flame className="w-4 h-4 text-amber-500" />
                    <h4 className="font-bold text-xs text-white uppercase tracking-wider">Caloric factor</h4>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed font-sans">
                    {correlations.calDesc}
                  </p>
                </div>

                <div className="border-t border-slate-900/50 pt-2.5">
                  <div className="text-[8px] text-slate-500 font-bold uppercase tracking-widest font-mono">1RM Correlation</div>
                  <div className="text-xl sm:text-2xl font-black text-amber-500 font-mono">
                    {correlations.calFactor}
                  </div>
                </div>
              </div>

              {/* Target Intake Card */}
              {correlations.targetCalories && (
                <div className="bg-slate-950/45 p-3.5 rounded-none border border-slate-850 space-y-2 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Target className="w-4 h-4 text-amber-500" />
                      <h4 className="font-bold text-xs text-white uppercase tracking-wider">Target Intake</h4>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowTargetInfo(true)}
                      className="p-1 hover:bg-slate-900 rounded-none text-slate-500 hover:text-amber-500 transition cursor-pointer"
                      title="How is this calculated?"
                    >
                      <Info className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div>
                    <div className="text-xl sm:text-2xl font-black text-amber-500 font-mono">
                      {correlations.targetCalories.toLocaleString()} kcal
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="p-4 bg-slate-950/40 rounded-none text-center border border-slate-850 text-[11px] text-slate-500 leading-relaxed font-sans">
            Not enough {selectedExercise} sessions logged with mixed recovery data to compute correlations. Make sure to input <strong className="font-extrabold text-slate-300">Sleep</strong> and <strong className="font-extrabold text-slate-300">Intake</strong> when saving your workouts!
          </div>
        )}
      </div>

      {/* Program Report Cards Section */}
      <div className="w-full bg-slate-900 border-y border-x-0 border-slate-800 p-4 shadow-sm rounded-none">
        <div className="border-b border-slate-850 pb-3 mb-4">
          <div>
            <h2 className="font-extrabold text-[18px] text-slate-300 uppercase tracking-wide">Program Report Cards</h2>
            <p className="text-[9px] text-slate-500 font-semibold uppercase tracking-wider">Performance Grading, Algorithmic Projections & Recovery Analysis</p>
          </div>
        </div>

        {reportPrograms.length === 0 ? (
          <div className="p-4 bg-slate-950/40 rounded-none text-center border border-slate-950 text-[11px] text-slate-500 leading-relaxed font-sans">
            No active or completed programs found with logged workout data yet. Start tracking your program workouts in the Logger to unlock your performance report cards!
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[11px] text-slate-400 font-sans leading-relaxed">
              Tapping an active program displays an <strong className="font-extrabold text-slate-200">Interim Midterm Report</strong>, while a fully completed program issues your <strong className="font-extrabold text-slate-200">Final Report Card</strong> based on progression math and recovery factors.
            </p>
            
            <div className="grid grid-cols-1 gap-2.5">
              {activeReportPrograms.map(prog => {
                const card = getProgramReportCard(prog, workoutLogs, storage.getWeightUnit());
                return (
                  <button
                    key={prog.id}
                    type="button"
                    onClick={() => {
                      setSelectedReportProgram(prog);
                      setReportChartExercise('Overall');
                    }}
                    className="w-full bg-slate-950 hover:bg-slate-900 border border-slate-850 hover:border-slate-800 p-3.5 flex items-center justify-between transition text-left cursor-pointer group"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-white uppercase group-hover:text-indigo-400 transition">{prog.name}</span>
                        {prog.id === currentProgramId && (
                          <span className="px-1.5 py-0.5 text-[8px] font-mono font-bold tracking-wider uppercase border border-amber-500/30 text-amber-500 bg-amber-500/5 rounded-none">Active</span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500 font-semibold uppercase">
                        <span>Obj: {prog.objective || 'Hypertrophy'}</span>
                        <span>•</span>
                        <span>{prog.programDuration === '∞' ? 'Ongoing' : `${prog.programDuration} Weeks`}</span>
                        <span>•</span>
                        <span>Adherence: {card.adherenceRate}%</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <span className="block text-lg font-black text-amber-500 font-mono leading-none">{card.grade}</span>
                        <span className="text-[8px] text-slate-500 font-semibold uppercase font-mono">Interim Grade</span>
                      </div>
                      <span className="text-xs text-slate-600 group-hover:text-slate-300 transition-all transform group-hover:translate-x-1 font-mono">➔</span>
                    </div>
                  </button>
                );
              })}

              {completedReportPrograms.map(prog => {
                const card = getProgramReportCard(prog, workoutLogs, storage.getWeightUnit());
                return (
                  <button
                    key={prog.id}
                    type="button"
                    onClick={() => {
                      setSelectedReportProgram(prog);
                      setReportChartExercise('Overall');
                    }}
                    className="w-full bg-slate-950 hover:bg-slate-900 border border-slate-850 hover:border-slate-800 p-3.5 flex items-center justify-between transition text-left cursor-pointer group"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-white uppercase group-hover:text-emerald-400 transition">{prog.name}</span>
                        <span className="px-1.5 py-0.5 text-[8px] font-mono font-bold tracking-wider uppercase border border-emerald-500/30 text-emerald-400 bg-emerald-400/5 rounded-none">Completed</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500 font-semibold uppercase">
                        <span>Obj: {prog.objective || 'Hypertrophy'}</span>
                        <span>•</span>
                        <span>{prog.programDuration} Weeks</span>
                        <span>•</span>
                        <span>Adherence: {card.adherenceRate}%</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <span className="block text-lg font-black text-emerald-400 font-mono leading-none">{card.grade}</span>
                        <span className="text-[8px] text-slate-500 font-semibold uppercase font-mono">Final Grade</span>
                      </div>
                      <span className="text-xs text-slate-600 group-hover:text-slate-300 transition-all transform group-hover:translate-x-1 font-mono">➔</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* PR Spotlight with wellness factors */}
      <div className="w-full bg-slate-900 border-y border-x-0 border-slate-800 p-4 shadow-sm rounded-none">
        <div className="border-b border-slate-850 pb-3 mb-4 space-y-3">
          <div>
            <h2 className="font-extrabold text-[18px] text-slate-300 uppercase tracking-wide">Personal Records</h2>
            <p className="text-[9px] text-slate-500 font-semibold uppercase tracking-wider">All-time peak lift performance & recovery tracking</p>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              placeholder="Search exercise..."
              value={prSearch}
              onChange={e => setPrSearch(e.target.value)}
              className="w-full sm:flex-1 bg-slate-950 border border-slate-850 rounded-none px-3 text-sm font-bold text-slate-300 placeholder-slate-600 focus:outline-none focus:border-cyan-500 h-11 font-sans"
            />
            <div ref={muscleDropdownRef} className="w-full sm:w-48 relative">
              <button
                type="button"
                onClick={() => setIsMuscleDropdownOpen(!isMuscleDropdownOpen)}
                className="w-full bg-slate-950 border border-slate-850 rounded-none px-3 text-sm font-bold text-slate-300 focus:outline-none focus:border-cyan-500 h-11 flex items-center justify-between cursor-pointer hover:bg-slate-900 transition"
              >
                <span>{selectedPrMuscle === 'All' ? 'All Muscles' : selectedPrMuscle}</span>
                <span className="text-[8px] text-slate-500">▼</span>
              </button>
              {isMuscleDropdownOpen && (
                <div className="absolute left-0 right-0 top-12 bg-slate-950 border border-slate-800 rounded-none shadow-2xl z-50 overflow-y-auto max-h-48 py-1 font-sans">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPrMuscle('All');
                      setIsMuscleDropdownOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2.5 text-xs font-bold border-y border-transparent cursor-pointer transition ${
                      selectedPrMuscle === 'All'
                        ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30'
                        : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                    }`}
                  >
                    All Muscles
                  </button>
                  {uniquePrMuscles.map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setSelectedPrMuscle(m);
                        setIsMuscleDropdownOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2.5 text-xs font-bold border-y border-transparent cursor-pointer transition ${
                        selectedPrMuscle === m
                          ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30'
                          : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {personalRecords.length === 0 ? (
          <p className="text-xs text-slate-500 italic text-center py-4 font-sans">No PR records recorded yet.</p>
        ) : filteredPersonalRecords.length === 0 ? (
          <p className="text-xs text-slate-500 italic text-center py-4 font-sans">No exercises match search or muscle filter.</p>
        ) : (
          <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
            {filteredPersonalRecords.map((pr, idx) => (
              <div key={idx} className="bg-slate-950/50 border border-slate-850 rounded-none p-3.5 flex justify-between items-center gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h4 className="font-black text-xs text-white flex items-center gap-1.5 uppercase tracking-wide font-sans">
                      <Dumbbell className="w-4 h-4 text-indigo-400" />
                      {pr.exercise}
                    </h4>
                    <span className="text-[8px] bg-indigo-500/10 text-indigo-300 px-1.5 py-0.5 rounded-none font-bold border border-indigo-500/15 uppercase tracking-wider">
                      {pr.muscleGroup}
                    </span>
                  </div>
                  {/* Matching recovery criteria on that day */}
                  <div className="flex items-center gap-2.5 text-[10px] font-bold text-slate-500 mt-2 font-mono">
                    <span className="flex items-center gap-0.5"><Coffee className="w-3 h-3" /> {pr.sleep}h sleep</span>
                    <span className="flex items-center gap-0.5"><Flame className="w-3 h-3" /> {pr.calories}kcal</span>
                    <span className="flex items-center gap-0.5"><Droplet className="w-3 h-3" /> {pr.hydration}</span>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="text-xs font-bold text-slate-400 font-sans">
                    Est. 1RM: <span className="font-black text-emerald-400 font-mono text-sm">{pr.est1RM} kg</span>
                  </div>
                  <div className="text-[10px] text-slate-500 font-bold font-mono mt-0.5">
                    Best: {pr.weight} kg × {pr.reps} rep{pr.reps > 1 ? 's' : ''}
                  </div>
                  <div className="text-[9px] text-slate-600 font-bold font-mono">
                    {new Date(pr.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Target Info Explanation Modal */}
      {showTargetInfo && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-150" onClick={() => setShowTargetInfo(false)}>
          <div className="bg-slate-900 border border-slate-800 rounded-none w-full max-w-md p-5 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <h3 className="font-extrabold text-xs text-white uppercase tracking-wider flex items-center gap-1.5">
                <Target className="w-4 h-4 text-indigo-400 animate-pulse" />
                PR Optimizing Target Formula
              </h3>
              <button 
                type="button"
                onClick={() => setShowTargetInfo(false)}
                className="p-1 hover:bg-slate-850 rounded-none text-slate-400 hover:text-white transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="space-y-3 text-xs leading-relaxed font-sans text-slate-300">
              <p>
                <strong className="text-white">PR Optimizing Targets</strong> provide personalized guidelines designed to maximize your progressive overload potential.
              </p>
              <p>
                Rather than generic population guidelines, these values are synthesized dynamically from your own logged data:
              </p>
              <ul className="list-disc list-inside space-y-2 pl-1 font-sans text-slate-400">
                <li>We isolate your high-intensity peak zone (<strong className="text-white">workouts within 10-20% of your maximum estimated 1RM</strong>) for <strong className="text-indigo-400">{selectedExercise}</strong>.</li>
                <li>We filter for sessions where your strength followed a progressive <strong className="text-emerald-400">upward trendline</strong> compared to the previous session.</li>
                <li>We average the corresponding sleep and caloric metrics from those positive-trend, high-intensity workouts to define your ideal "fuel" conditions.</li>
              </ul>
              
              <div className="bg-slate-950 p-3 border border-slate-850 text-[10px] text-slate-400 font-mono uppercase tracking-wider space-y-1">
                <div><span className="text-slate-500">Exercise:</span> <span className="text-slate-300 font-bold">{selectedExercise}</span></div>
                <div><span className="text-slate-500">Active Model:</span> <span className="text-slate-300 font-bold">{correlations?.targetMethod || 'Standard Formula'}</span></div>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setShowTargetInfo(false)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black uppercase tracking-wider transition rounded-none cursor-pointer"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
