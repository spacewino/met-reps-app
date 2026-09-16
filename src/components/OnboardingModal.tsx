/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  PlusCircle,
  Dumbbell,
  Plus,
  LineChart,
  BookOpen,
  Info,
  ChevronRight,
  ChevronLeft,
  X,
  MoreVertical,
  Check,
  Play,
  ExternalLink,
} from 'lucide-react';
import { useModalHistory } from '../lib/useModalHistory';
import { markOnboardingCompleted, METREPS_VIDEO_GUIDE_URL } from '../lib/onboarding';
import { WarmupIcon } from './WarmupIcon';

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  themeId?: string;
  initialPage?: number;
}

export function OnboardingModal({ isOpen, onClose, themeId = 'slate', initialPage = 1 }: OnboardingModalProps) {
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const isDesert = themeId === 'amber';
  const modalContainerRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  // Handle hardware / gesture BACK button navigation with modal history stack
  useModalHistory(
    isOpen,
    () => {
      markOnboardingCompleted();
      onClose();
    },
    'onboarding-modal'
  );

  // Focus trap, focus restoration, and Escape listener
  useEffect(() => {
    if (!isOpen) return;

    // Capture currently focused element before modal opened
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      previousActiveElementRef.current = document.activeElement;
    }

    const modalEl = modalContainerRef.current;
    if (modalEl) {
      // Focus the modal container
      modalEl.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        markOnboardingCompleted();
        onClose();
        return;
      }

      if (e.key === 'Tab' && modalEl) {
        const focusableElements = modalEl.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      // Restore focus to original element on close
      if (previousActiveElementRef.current && typeof previousActiveElementRef.current.focus === 'function') {
        previousActiveElementRef.current.focus();
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleDismiss = () => {
    markOnboardingCompleted();
    onClose();
  };

  const handleNext = () => {
    if (currentPage < 4) {
      setCurrentPage(prev => prev + 1);
    } else {
      handleDismiss();
    }
  };

  const handlePrev = () => {
    if (currentPage > 1) {
      setCurrentPage(prev => prev - 1);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-3.5 sm:p-4 z-50 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-dialog-title"
      aria-describedby="onboarding-dialog-heading"
    >
      <div
        ref={modalContainerRef}
        tabIndex={-1}
        className="bg-slate-900 border border-slate-800 rounded-none w-full max-w-sm sm:max-w-md overflow-hidden shadow-2xl flex flex-col relative h-[640px] max-h-[calc(100dvh-2rem)] focus:outline-none"
        onClick={e => e.stopPropagation()}
      >
        {/* Top Header Bar */}
        <div className="p-3.5 sm:p-4 border-b border-slate-850 bg-slate-950/80 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2">
            <h2
              id="onboarding-dialog-title"
              className="font-black text-xs sm:text-sm text-white uppercase tracking-wider font-mono"
            >
              METREPS QUICK START
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="text-[11px] font-mono font-bold text-slate-400 uppercase tracking-wider"
              aria-live="polite"
            >
              {`Step ${currentPage} of 4`}
            </span>
            <button
              type="button"
              onClick={handleDismiss}
              className="p-2 text-slate-400 hover:text-white transition rounded-none cursor-pointer ml-1 min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Close guide"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Page Content */}
        <div className="p-4 sm:p-6 space-y-4 overflow-y-auto min-h-0 flex-1 flex flex-col justify-between">
          {/* Page 1: SET UP A PROGRAM */}
          {currentPage === 1 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-150">
              {/* Visual Showcase Box */}
              <div
                className="w-full h-24 p-3 bg-slate-950 border border-slate-850 flex flex-col items-center justify-center text-center relative overflow-hidden shrink-0"
                aria-hidden="true"
              >
                <div className="text-[10px] font-mono font-black text-slate-400 uppercase tracking-widest mb-1">
                  FIND IT IN
                </div>
                <div className="flex flex-col items-center justify-center p-1.5 bg-slate-900 border border-slate-850 text-indigo-400 min-w-[80px]">
                  <PlusCircle className="w-4 h-4 text-indigo-400" />
                  <span className="text-[10px] font-black uppercase tracking-tight text-indigo-400 mt-0.5 font-mono">
                    PROGRAM
                  </span>
                </div>
              </div>

              {/* Text Description */}
              <div className="space-y-2.5">
                <h3
                  id="onboarding-dialog-heading"
                  className="font-black text-base sm:text-lg text-white uppercase tracking-wide font-sans"
                >
                  SET UP A PROGRAM
                </h3>
                <p className="text-[13.5px] leading-relaxed text-slate-200">
                  Use Program to choose a template or create your own training week.
                </p>
                <p className="text-[13.5px] leading-relaxed text-slate-300">
                  Choose a Training Goal and Periodisation Method. Workout Target Mode determines whether targets follow that method alone or can be adapted by MetReps Coach.
                </p>
                <p className="text-[13.5px] leading-relaxed text-slate-300">
                  Strength programs use one designated Main Movement for strength-specific targets.
                </p>
              </div>
            </div>
          )}

          {/* Page 2: RECORD A WORKOUT */}
          {currentPage === 2 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-150">
              {/* Visual Showcase Box */}
              <div
                className="w-full h-24 p-3 bg-slate-950 border border-slate-850 flex flex-col items-center justify-center text-center relative overflow-hidden shrink-0"
                aria-hidden="true"
              >
                <div className="text-[10px] font-mono font-black text-slate-400 uppercase tracking-widest mb-1">
                  RECORD WITH
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex flex-col items-center justify-center p-1.5 bg-slate-900 border border-slate-850 text-indigo-400 min-w-[75px]">
                    <Dumbbell className="w-4 h-4 text-indigo-400" />
                    <span className="text-[10px] font-black uppercase tracking-tight text-indigo-400 mt-0.5 font-mono">
                      WORKOUT
                    </span>
                  </div>
                  <div className="flex flex-col items-center justify-center p-1.5 bg-slate-900 border border-slate-850 text-cyan-400 min-w-[75px]">
                    <Plus className="w-4 h-4 text-cyan-400" />
                    <span className="text-[10px] font-black uppercase tracking-tight text-cyan-400 mt-0.5 font-mono">
                      ONE-OFF
                    </span>
                  </div>
                </div>
              </div>

              {/* Text Description */}
              <div className="space-y-2.5">
                <h3
                  id="onboarding-dialog-heading"
                  className="font-black text-base sm:text-lg text-white uppercase tracking-wide font-sans"
                >
                  RECORD A WORKOUT
                </h3>
                <p className="text-[13.5px] leading-relaxed text-slate-200">
                  Use Workout for the scheduled session in your active program. Use One-Off for training outside a program.
                </p>
                <p className="text-[13.5px] leading-relaxed text-slate-300">
                  Leave a set unchanged when you complete it as shown. Edit its weight, repetitions or RPE when your performance differs, or skip it if it was not performed.
                </p>
              </div>
            </div>
          )}

          {/* Page 3: UPDATE SETS WHILE TRAINING */}
          {currentPage === 3 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-150">
              {/* Visual Showcase Box */}
              <div
                className="w-full h-24 p-3 bg-slate-950 border border-slate-850 flex flex-col items-center justify-center text-center relative overflow-hidden shrink-0"
                aria-hidden="true"
              >
                <div className="w-full flex items-center justify-between gap-2 text-[10px] font-mono text-slate-400">
                  <div className="flex flex-col items-center flex-1">
                    <span className="font-extrabold text-[9px] text-slate-400 uppercase tracking-widest mb-1 whitespace-nowrap">
                      LOCK IN WITH
                    </span>
                    <span className="px-2 py-1 bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 font-black text-xs">
                      @ 8.5 RPE
                    </span>
                  </div>
                  <div className="flex flex-col items-center flex-1">
                    <span className="font-extrabold text-[9px] text-slate-400 uppercase tracking-widest mb-1 whitespace-nowrap">
                      SET OPTIONS
                    </span>
                    <div className="p-1 border border-slate-800 bg-slate-900 text-slate-300 flex items-center justify-center">
                      <MoreVertical className="w-4 h-4 text-slate-300" />
                    </div>
                  </div>
                  <div className="flex flex-col items-center flex-1">
                    <span className="font-extrabold text-[9px] text-slate-400 uppercase tracking-widest mb-1 whitespace-nowrap">
                      WARM-UP SETS
                    </span>
                    <div className="p-1 border border-slate-800 bg-slate-900 text-amber-500 flex items-center justify-center">
                      <WarmupIcon className="w-4 h-4 text-amber-500" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Text Description */}
              <div className="space-y-2.5">
                <h3
                  id="onboarding-dialog-heading"
                  className="font-black text-base sm:text-lg text-white uppercase tracking-wide font-sans"
                >
                  UPDATE SETS WHILE TRAINING
                </h3>
                <p className="text-[13.5px] leading-relaxed text-slate-200">
                  Record the weight, repetitions and RPE you actually complete. Completed or edited sets stay fixed while eligible Live Adjustments can update remaining untouched sets.
                </p>
                <p className="text-[13.5px] leading-relaxed text-slate-300">
                  Open Set Options from the three-dot button for additional tools, including Auto Warm-Up and the Equivalent Set Calculator.
                </p>
              </div>
            </div>
          )}

          {/* Page 4: REVIEW AND BACK UP */}
          {currentPage === 4 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-150">
              {/* Visual Showcase Box */}
              <div
                className="w-full h-24 p-3 bg-slate-950 border border-slate-850 flex flex-col items-center justify-center text-center relative overflow-hidden shrink-0"
                aria-hidden="true"
              >
                <div className="w-full flex items-center justify-around gap-2 text-xs font-mono">
                  <div className="flex flex-col items-center space-y-1">
                    <span className="font-extrabold text-[9px] text-slate-400 uppercase tracking-widest">
                      REVIEW IN
                    </span>
                    <div className="flex items-center gap-2">
                      <div className="flex flex-col items-center justify-center p-1 bg-slate-900 border border-slate-850 text-indigo-400 min-w-[56px]">
                        <LineChart className="w-4 h-4 text-indigo-400" />
                        <span className="text-[9px] font-black uppercase tracking-tight text-indigo-400 mt-0.5 font-mono">
                          TRENDS
                        </span>
                      </div>
                      <div className="flex flex-col items-center justify-center p-1 bg-slate-900 border border-slate-850 text-indigo-400 min-w-[56px]">
                        <BookOpen className="w-4 h-4 text-indigo-400" />
                        <span className="text-[9px] font-black uppercase tracking-tight text-indigo-400 mt-0.5 font-mono">
                          DIARY
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-center space-y-1">
                    <span className="font-extrabold text-[9px] text-slate-400 uppercase tracking-widest">
                      MORE HELP
                    </span>
                    <div className="flex flex-col items-center justify-center p-1 bg-slate-900 border border-slate-850 text-slate-300 min-w-[56px]">
                      <Info className="w-4 h-4 text-slate-300" />
                      <span className="text-[9px] font-black uppercase tracking-tight text-slate-300 mt-0.5 font-mono">
                        ON HOME
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Text Description */}
              <div className="space-y-2.5">
                <h3
                  id="onboarding-dialog-heading"
                  className="font-black text-base sm:text-lg text-white uppercase tracking-wide font-sans"
                >
                  REVIEW AND BACK UP
                </h3>
                <p className="text-[13.5px] leading-relaxed text-slate-200">
                  Use Diary to review completed workouts and records. Use Trends to follow longer-term changes.
                </p>
                <p className="text-[13.5px] leading-relaxed text-slate-300">
                  MetReps stores your training data locally on this device. Create regular backups in Settings → App Data Management.
                </p>
                <p className="text-[13.5px] leading-relaxed text-slate-300">
                  Open Information on Home to access the full help guide or replay this introduction.
                </p>
              </div>

              {/* Watch Video Guide External Link */}
              <a
                href={METREPS_VIDEO_GUIDE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-2.5 px-3.5 bg-slate-950 hover:bg-slate-850 border border-slate-800 hover:border-slate-700 transition flex items-center justify-between text-left cursor-pointer group rounded-none min-h-[44px] focus:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
                aria-label="Watch MetReps video guide on YouTube (opens in new tab)"
              >
                <div className="flex items-center gap-2.5">
                  <Play className="w-4 h-4 text-slate-400 group-hover:text-slate-200 shrink-0 transition-colors" aria-hidden="true" />
                  <div className="flex flex-col">
                    <span className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wide">
                      WATCH VIDEO GUIDE
                    </span>
                    <span className="text-[11px] font-mono text-slate-400">
                      Opens YouTube
                    </span>
                  </div>
                </div>
                <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-200 shrink-0 transition-colors" aria-hidden="true" />
              </a>
            </div>
          )}

          {/* Accessible Step Indicators (Progress Dots) */}
          <div
            className="flex items-center justify-center gap-2 pt-2"
            role="tablist"
            aria-label="Onboarding pages"
          >
            {[1, 2, 3, 4].map(pageNum => {
              const isActive = currentPage === pageNum;
              return (
                <button
                  key={pageNum}
                  type="button"
                  onClick={() => setCurrentPage(pageNum)}
                  className={`h-2 transition-all rounded-none cursor-pointer min-h-[44px] min-w-[24px] flex items-center justify-center ${
                    isActive
                      ? isDesert
                        ? 'w-8 bg-amber-500'
                        : 'w-8 bg-indigo-500'
                      : 'w-3 bg-slate-700 hover:bg-slate-600'
                  }`}
                  aria-label={`Go to step ${pageNum}`}
                  aria-selected={isActive}
                  role="tab"
                />
              );
            })}
          </div>
        </div>

        {/* Footer Navigation Buttons */}
        <div className="p-3.5 sm:p-4 border-t border-slate-850 bg-slate-950/80 flex items-center justify-between gap-3 shrink-0">
          {currentPage === 1 ? (
            <button
              type="button"
              onClick={handleDismiss}
              className="px-4 py-2.5 text-xs font-mono font-bold text-slate-400 hover:text-slate-200 transition uppercase cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              SKIP
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrev}
                className="px-3.5 py-2.5 text-xs font-mono font-bold text-slate-300 hover:text-white transition flex items-center gap-1 uppercase cursor-pointer border border-slate-800 bg-slate-900 hover:bg-slate-800 min-h-[44px] min-w-[44px]"
              >
                <ChevronLeft className="w-4 h-4" /> BACK
              </button>
              {currentPage < 4 && (
                <button
                  type="button"
                  onClick={handleDismiss}
                  className="px-3 py-2.5 text-xs font-mono font-bold text-slate-400 hover:text-slate-200 transition uppercase cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
                >
                  SKIP
                </button>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            {currentPage < 4 ? (
              <button
                type="button"
                onClick={handleNext}
                className={`px-5 py-2.5 text-xs font-mono font-black text-white ${
                  isDesert
                    ? 'bg-amber-600 hover:bg-amber-500 border border-amber-500'
                    : 'bg-indigo-600 hover:bg-indigo-500 border border-indigo-500'
                } transition flex items-center gap-1.5 uppercase cursor-pointer shadow-md shadow-indigo-950/40 min-h-[44px] min-w-[44px]`}
              >
                NEXT <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleDismiss}
                className="px-5 py-2.5 text-xs font-mono font-black text-white bg-emerald-600 hover:bg-emerald-500 border border-emerald-500 transition flex items-center gap-1.5 uppercase cursor-pointer shadow-md shadow-emerald-950/40 min-h-[44px] min-w-[44px]"
              >
                <Check className="w-4 h-4" /> GET STARTED
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
