/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Info, X, Dumbbell, Plus, Edit3 } from 'lucide-react';
import { ActiveWorkoutIdentity } from '../lib/navigationGuard';
import { useModalHistory } from '../lib/useModalHistory';

interface WorkoutConflictModalProps {
  isOpen: boolean;
  activeIdentity: ActiveWorkoutIdentity;
  themeId?: string;
  onClose: () => void;
  onResumeActive: () => void;
}

export function WorkoutConflictModal({
  isOpen,
  activeIdentity,
  themeId,
  onClose,
  onResumeActive,
}: WorkoutConflictModalProps) {
  const isAmber = themeId === 'amber';

  useModalHistory(isOpen, onClose, 'workout-conflict-modal');

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4 animate-in fade-in duration-150 font-sans text-left"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-md overflow-hidden flex flex-col shadow-2xl rounded-none border transition-all duration-150 animate-in fade-in zoom-in-95 ${
          isAmber
            ? 'bg-[#FAF5F0] border-amber-600/60 text-slate-900 shadow-amber-950/10'
            : 'bg-slate-900 border-slate-800 text-slate-100 shadow-indigo-950/40'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={`p-4 border-b flex items-center justify-between gap-3 ${
            isAmber ? 'bg-[#F2EAE1] border-amber-200/50' : 'bg-slate-950 border-slate-850'
          }`}
        >
          <div>
            <h3 className="text-sm font-black uppercase tracking-wider leading-snug flex items-center gap-2">
              <Info className={`w-4 h-4 font-bold ${isAmber ? 'text-amber-700' : 'text-indigo-400'}`} />
              Workout In Progress
            </h3>
            <p
              className={`text-[10px] font-mono uppercase tracking-widest leading-none mt-1 ${
                isAmber ? 'text-amber-700/80' : 'text-indigo-400'
              }`}
            >
              Unsaved Session Protection
            </p>
          </div>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-none border transition cursor-pointer shrink-0 text-slate-300 ${
              isAmber
                ? 'bg-[#FDFCFB] hover:bg-amber-100/50 border-amber-200'
                : 'bg-slate-900 hover:bg-slate-800 border-slate-800'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 text-xs sm:text-sm leading-relaxed">
          <p className={`${isAmber ? 'text-slate-700' : 'text-slate-300'} font-semibold leading-relaxed`}>
            You have an unsaved workout session in progress. Please finish and save, or cancel and discard that session before commencing or editing another workout.
          </p>

          <div
            className={`p-3.5 border ${
              isAmber
                ? 'bg-amber-500/5 border-amber-200/60'
                : 'bg-indigo-950/20 border-indigo-900/30'
            }`}
          >
            <h4
              className={`font-extrabold uppercase text-xs tracking-wider font-mono mb-1.5 ${
                isAmber ? 'text-amber-800' : 'text-indigo-400'
              }`}
            >
              Current Active Session:
            </h4>
            <div className={`text-xs ${isAmber ? 'text-slate-800' : 'text-slate-200'}`}>
              {activeIdentity.kind === 'one_off' && (
                <div className="font-bold flex items-center gap-1.5">
                  <Plus className={`w-3.5 h-3.5 ${isAmber ? 'text-amber-700' : 'text-indigo-400'}`} />
                  <span>One-Off Workout</span>
                </div>
              )}

              {activeIdentity.kind === 'programmed' && (
                <div>
                  <div className="font-bold flex items-center gap-1.5">
                    <Dumbbell className={`w-3.5 h-3.5 ${isAmber ? 'text-amber-700' : 'text-indigo-400'}`} />
                    <span>{activeIdentity.programName || 'Programmed Workout'}</span>
                  </div>
                  <span className={`block text-[11px] font-mono mt-1 ${isAmber ? 'text-slate-600' : 'text-slate-400'}`}>
                    Week {activeIdentity.weekNum}, Day {activeIdentity.dayNum}
                  </span>
                </div>
              )}

              {activeIdentity.kind === 'historical_edit' && (
                <div className="font-bold flex items-center gap-1.5">
                  <Edit3 className={`w-3.5 h-3.5 ${isAmber ? 'text-amber-700' : 'text-indigo-400'}`} />
                  <span>Editing Completed Workout Log</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div
          className={`p-3 border-t flex flex-col sm:flex-row gap-2 justify-end ${
            isAmber ? 'bg-[#F2EAE1] border-amber-200/50' : 'bg-slate-950 border-slate-850'
          }`}
        >
          <button
            onClick={onClose}
            className={`font-extrabold text-xs py-2 px-4 rounded-none border transition cursor-pointer ${
              isAmber
                ? 'bg-[#FDFCFB] hover:bg-amber-100/50 border-amber-200 text-slate-700'
                : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-300'
            }`}
          >
            Go Back
          </button>
          <button
            onClick={onResumeActive}
            className={`font-extrabold text-xs py-2 px-4 rounded-none border transition cursor-pointer text-white shadow ${
              isAmber
                ? 'bg-amber-600 hover:bg-amber-500 border-amber-700 shadow-amber-900/10'
                : 'bg-indigo-600 hover:bg-indigo-500 border-indigo-700 shadow-indigo-900/20'
            }`}
          >
            Resume Active Session
          </button>
        </div>
      </div>
    </div>
  );
}
