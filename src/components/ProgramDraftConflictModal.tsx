/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useModalHistory } from '../lib/useModalHistory';

interface ProgramDraftConflictModalProps {
  isOpen: boolean;
  themeId?: string;
  onKeepWorkout: () => void;
  onDiscardAndSave: () => void;
  isProcessing?: boolean;
  sourceProgramName?: string;
  targetProgramName?: string;
}

export function ProgramDraftConflictModal({
  isOpen,
  themeId,
  onKeepWorkout,
  onDiscardAndSave,
  isProcessing = false,
  sourceProgramName = 'your current program',
  targetProgramName = 'the selected program',
}: ProgramDraftConflictModalProps) {
  const isAmber = themeId === 'amber';

  useModalHistory(isOpen, onKeepWorkout, 'program-draft-conflict-modal');

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-overlay/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4 animate-in fade-in duration-150 font-sans text-left"
      onClick={onKeepWorkout}
    >
      <div
        className={`w-full max-w-md overflow-hidden flex flex-col shadow-2xl rounded-none border transition-all duration-150 animate-in fade-in zoom-in-95 ${
          isAmber
            ? 'bg-slate-900 border-indigo-500 text-slate-300 shadow-amber-950/10'
            : 'bg-slate-900 border-slate-800 text-slate-100 shadow-indigo-950/40'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={`p-4 border-b flex items-center justify-between gap-3 ${
            isAmber ? 'bg-slate-950 border-slate-800' : 'bg-slate-950 border-slate-850'
          }`}
        >
          <div>
            <h3 className={`text-sm font-black uppercase tracking-wider leading-snug flex items-center gap-2 ${isAmber ? 'text-slate-300' : 'text-slate-100'}`}>
              <AlertTriangle className={`w-4 h-4 font-bold ${isAmber ? 'text-indigo-600' : 'text-rose-400'}`} />
              ACTIVE WORKOUT IN PROGRESS
            </h3>
            <p
              className={`text-[10px] font-mono uppercase tracking-widest leading-none mt-1 ${
                isAmber ? 'text-slate-400' : 'text-slate-400'
              }`}
            >
              Draft Conflict Protection
            </p>
          </div>
          <button
            onClick={onKeepWorkout}
            disabled={isProcessing}
            aria-label="Close active workout warning"
            className={`p-1.5 rounded-none border transition cursor-pointer shrink-0 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              isAmber
                ? 'bg-slate-900 hover:bg-slate-950 border-slate-800 text-slate-300'
                : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-300'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 text-xs sm:text-sm leading-relaxed">
          <p className={`${isAmber ? 'text-slate-300' : 'text-slate-300'} font-semibold leading-relaxed`}>
            You have an unfinished workout for {sourceProgramName}. Enrolling in {targetProgramName} will discard that workout draft.
          </p>
        </div>

        {/* Footer Actions */}
        <div
          className={`p-3 border-t flex flex-col sm:flex-row gap-2 justify-end ${
            isAmber ? 'bg-slate-950 border-slate-800' : 'bg-slate-950 border-slate-850'
          }`}
        >
          <button
            onClick={onKeepWorkout}
            disabled={isProcessing}
            className={`font-extrabold text-xs py-2 px-4 rounded-none border transition cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              isAmber
                ? 'bg-slate-900 hover:bg-slate-950 border-slate-800 text-slate-300'
                : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-300'
            }`}
          >
            KEEP WORKOUT
          </button>
          <button
            onClick={onDiscardAndSave}
            disabled={isProcessing}
            className={`font-extrabold text-xs py-2 px-4 rounded-none border transition cursor-pointer text-on-destructive shadow disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              isAmber
                ? 'bg-rose-800 hover:bg-rose-700 border-rose-900 shadow-rose-950/20'
                : 'bg-rose-600 hover:bg-rose-500 border-rose-700 shadow-rose-950/30'
            }`}
          >
            DISCARD WORKOUT & SWITCH PROGRAM
          </button>
        </div>
      </div>
    </div>
  );
}
