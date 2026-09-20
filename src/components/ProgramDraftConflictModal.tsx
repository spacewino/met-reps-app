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
      className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4 animate-in fade-in duration-150 font-sans text-left"
      onClick={onKeepWorkout}
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
              <AlertTriangle className={`w-4 h-4 font-bold ${isAmber ? 'text-amber-700' : 'text-rose-400'}`} />
              ACTIVE WORKOUT IN PROGRESS
            </h3>
            <p
              className={`text-[10px] font-mono uppercase tracking-widest leading-none mt-1 ${
                isAmber ? 'text-amber-700/80' : 'text-slate-400'
              }`}
            >
              Draft Conflict Protection
            </p>
          </div>
          <button
            onClick={onKeepWorkout}
            disabled={isProcessing}
            className={`p-1.5 rounded-none border transition cursor-pointer shrink-0 text-slate-300 disabled:opacity-50 ${
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
            You have an unfinished workout for {sourceProgramName}. Enrolling in {targetProgramName} will discard that workout draft.
          </p>
        </div>

        {/* Footer Actions */}
        <div
          className={`p-3 border-t flex flex-col sm:flex-row gap-2 justify-end ${
            isAmber ? 'bg-[#F2EAE1] border-amber-200/50' : 'bg-slate-950 border-slate-850'
          }`}
        >
          <button
            onClick={onKeepWorkout}
            disabled={isProcessing}
            className={`font-extrabold text-xs py-2 px-4 rounded-none border transition cursor-pointer disabled:opacity-50 ${
              isAmber
                ? 'bg-[#FDFCFB] hover:bg-amber-100/50 border-amber-200 text-slate-700'
                : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-300'
            }`}
          >
            KEEP WORKOUT
          </button>
          <button
            onClick={onDiscardAndSave}
            disabled={isProcessing}
            className={`font-extrabold text-xs py-2 px-4 rounded-none border transition cursor-pointer text-white shadow disabled:opacity-50 ${
              isAmber
                ? 'bg-rose-700 hover:bg-rose-600 border-rose-800 shadow-rose-950/20'
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
