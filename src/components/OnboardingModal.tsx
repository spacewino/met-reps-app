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
} from 'lucide-react';
import { useModalHistory } from '../lib/useModalHistory';
import { markOnboardingCompleted } from '../lib/onboarding';
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
          'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
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
        className="bg-slate-900 border border-slate-800 rounded-none w-full max-w-sm sm:max-w-md overflow-hidden shadow-2xl flex flex-col relative max-h-[90vh] focus:outline-none"
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
        <div className="p-4 sm:p-6 space-y-5 overflow-y-auto flex-1 flex flex-col justify-between">
          {/* Page 1: BUILD YOUR TRAINING */}
          {currentPage === 1 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-150">
              {/* Visual Showcase Box */}
              <div
                className="p-3.5 bg-slate-950 border border-slate-850 flex flex-col items-center justify-center text-center space-y-2 relative overflow-hidden"
                aria-hidden="true"
              >
                <div className="text-[10px] font-mono font-black text-slate-400 uppercase tracking-widest">
                  FIND IT IN
                </div>
                <div className="flex flex-col items-center justify-center p-2.5 bg-slate-900 border border-slate-800 text-indigo-400 min-w-[90px]">
                  <PlusCircle className="w-6 h-6 text-indigo-400" />
                  <span className="text-[10px] font-black uppercase tracking-tight text-indigo-400 mt-1 font-mono">
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
                  BUILD YOUR TRAINING
                </h3>
                <p className="text-[13.5px] leading-relaxed text-slate-200">
                  Choose a built-in template or create your own training week. Templates provide the days and exercises.
                </p>
                <p className="text-[13.5px] leading-relaxed text-slate-300">
                  Your selected objective and progression algorithm control how targets are generated. Hypertrophy can guide the whole workout, Strength targets the designated Main Movement, and Off remains self-directed.
                </p>
              </div>
            </div>
          )}

          {/* Page 2: LOG WHAT YOU ACTUALLY DO */}
          {currentPage === 2 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-150">
              {/* Visual Showcase Box */}
              <div
                className="p-3.5 bg-slate-950 border border-slate-850 flex flex-col items-center justify-center text-center space-y-2 relative overflow-hidden"
                aria-hidden="true"
              >
                <div className="text-[10px] font-mono font-black text-slate-400 uppercase tracking-widest">
                  RECORD WITH
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex flex-col items-center justify-center p-2.5 bg-slate-900 border border-slate-800 text-indigo-400 min-w-[85px]">
                    <Dumbbell className="w-6 h-6 text-indigo-400" />
                    <span className="text-[10px] font-black uppercase tracking-tight text-indigo-400 mt-1 font-mono">
                      WORKOUT
                    </span>
                  </div>
                  <div className="flex flex-col items-center justify-center p-2.5 bg-slate-900 border border-slate-800 text-cyan-400 min-w-[85px]">
                    <Plus className="w-6 h-6 text-cyan-400" />
                    <span className="text-[10px] font-black uppercase tracking-tight text-cyan-400 mt-1 font-mono">
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
                  LOG WHAT YOU ACTUALLY DO
                </h3>
                <p className="text-[13.5px] leading-relaxed text-slate-200">
                  Open Workout for your scheduled program session, or One-Off to record training outside a program.
                </p>
                <p className="text-[13.5px] leading-relaxed text-slate-300">
                  Finishing a workout confirms every valid, unskipped set as performed. Leave a set unchanged if you completed it as shown; edit it when your actual performance differs.
                </p>
              </div>
            </div>
          )}

          {/* Page 3: ADJUST ON THE GYM FLOOR */}
          {currentPage === 3 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-150">
              {/* Visual Showcase Box */}
              <div
                className="p-3 bg-slate-950 border border-slate-850 flex flex-col items-center justify-center text-center space-y-2.5 relative overflow-hidden"
                aria-hidden="true"
              >
                <div className="w-full flex items-center justify-between gap-2 text-[10px] font-mono text-slate-400 border-b border-slate-850 pb-2">
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
                    <div className="p-1.5 border border-slate-800 bg-slate-900 text-slate-300 flex items-center justify-center">
                      <MoreVertical className="w-4 h-4 text-slate-300" />
                    </div>
                  </div>
                  <div className="flex flex-col items-center flex-1">
                    <span className="font-extrabold text-[9px] text-slate-400 uppercase tracking-widest mb-1 whitespace-nowrap">
                      WARM-UP SETS
                    </span>
                    <div className="p-1.5 border border-slate-800 bg-slate-900 text-amber-500 flex items-center justify-center">
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
                  ADJUST ON THE GYM FLOOR
                </h3>
                <p className="text-[13.5px] leading-relaxed text-slate-200">
                  Leave the RPE unchanged when the target felt right. If it felt different, select the RPE you actually reached.
                </p>
                <p className="text-[13.5px] leading-relaxed text-slate-200">
                  This locks that completed set against automatic changes while Live Adjustments can update the remaining untouched sets.
                </p>
                <p className="text-[13.5px] leading-relaxed text-slate-300">
                  Auto Warm-Up creates preparation sets from a valid working target. Tap the three-dot button beside a set to open Set Options, including the Equivalent Set Calculator.
                </p>
              </div>
            </div>
          )}

          {/* Page 4: REVIEW AND PROTECT YOUR PROGRESS */}
          {currentPage === 4 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-150">
              {/* Visual Showcase Box */}
              <div
                className="p-3 bg-slate-950 border border-slate-850 flex flex-col items-center justify-center text-center space-y-2 relative overflow-hidden"
                aria-hidden="true"
              >
                <div className="w-full flex items-center justify-around gap-2 text-xs font-mono">
                  <div className="flex flex-col items-center space-y-1">
                    <span className="font-extrabold text-[9px] text-slate-400 uppercase tracking-widest">
                      REVIEW IN
                    </span>
                    <div className="flex items-center gap-2">
                      <div className="flex flex-col items-center justify-center p-1.5 bg-slate-900 border border-slate-800 text-indigo-400 min-w-[65px]">
                        <LineChart className="w-5 h-5 text-indigo-400" />
                        <span className="text-[9px] font-black uppercase tracking-tight text-indigo-400 mt-0.5 font-mono">
                          TRENDS
                        </span>
                      </div>
                      <div className="flex flex-col items-center justify-center p-1.5 bg-slate-900 border border-slate-800 text-indigo-400 min-w-[65px]">
                        <BookOpen className="w-5 h-5 text-indigo-400" />
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
                    <div className="flex flex-col items-center justify-center p-1.5 bg-slate-900 border border-slate-800 text-slate-300 min-w-[65px]">
                      <Info className="w-5 h-5 text-slate-300" />
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
                  REVIEW AND PROTECT YOUR PROGRESS
                </h3>
                <p className="text-[13.5px] leading-relaxed text-slate-200">
                  Diary helps you review completed workouts, personal records, volume and muscle-group work. Trends shows your longer-term progress.
                </p>
                <p className="text-[13.5px] leading-relaxed text-slate-300">
                  Your training data is stored locally in this browser or device. Export regular backups from Settings → App Data Management.
                </p>
                <p className="text-[13.5px] leading-relaxed text-slate-300">
                  The information button on Home contains the full help guide and lets you replay this introduction.
                </p>
              </div>
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
