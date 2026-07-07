/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Info, X, Milestone, Dumbbell, ShieldCheck, Mail } from 'lucide-react';

interface InfoViewProps {
  onClose: () => void;
}

export function InfoView({ onClose }: InfoViewProps) {
  return (
    <div className="space-y-6 pb-20">
      {/* Sticky Header */}
      <div className="sticky top-[-16px] -mt-4 pt-3 pb-2.5 bg-slate-950 z-30 flex items-center justify-between border-b border-slate-850 px-4 shadow-md">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-slate-900 rounded-none border border-slate-800 text-slate-400 flex items-center justify-center">
            <Info className="w-4 h-4 text-indigo-400" />
          </div>
          <div>
            <h2 className="font-extrabold text-sm text-white uppercase tracking-wide leading-none">
              App Information
            </h2>
            <p className="text-[10px] text-indigo-400 font-mono uppercase tracking-widest mt-1">
              Guide & philosophy
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-slate-500 hover:text-white hover:bg-slate-800 transition rounded-none flex items-center justify-center"
          title="Return to Home"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-4 space-y-6">
        {/* Welcome Block */}
        <div className="bg-slate-900/40 border border-slate-850 p-5 space-y-3 shadow-md relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-full blur-xl pointer-events-none" />
          <div className="text-indigo-400">
            <h3 className="font-extrabold text-sm uppercase tracking-wider font-sans">
              Welcome to Metereps
            </h3>
          </div>
          <p className="text-[14px] leading-relaxed text-slate-300">
            Metereps is a powerful workout tracker designed to help you plan your training, log your progress, and analyse your lifting data. Whether you're following a structured program or creating your own, Metereps makes it easy to record your workouts while correlating lifestyle factors to provide deeper insights and help optimise your results.
          </p>
        </div>

        {/* Section 1: Quick Start Guide */}
        <div className="space-y-4">
          <h3 className="font-black text-xs text-indigo-400 uppercase tracking-widest border-b border-slate-850 pb-2">
            Quick Start Guide
          </h3>

          <div className="space-y-4">
            {/* Guide Step 1 */}
            <div className="flex gap-3.5 items-start">
              <div className="w-7 h-7 bg-indigo-950/80 border border-indigo-800/50 flex items-center justify-center text-indigo-300 font-mono font-black text-xs shrink-0">
                1
              </div>
              <div className="space-y-1">
                <h4 className="font-bold text-[14px] text-slate-100 uppercase tracking-wide">
                  Create Your Program
                </h4>
                <p className="text-[13px] leading-relaxed text-slate-400">
                  Navigate to the <span className="text-white font-bold">Program</span> tab in the main navigation menu. From there, you can choose one of the pre-made master templates or design a custom multi-week routine from scratch.
                </p>
              </div>
            </div>

            {/* Guide Step 2 */}
            <div className="flex gap-3.5 items-start">
              <div className="w-7 h-7 bg-indigo-950/80 border border-indigo-800/50 flex items-center justify-center text-indigo-300 font-mono font-black text-xs shrink-0">
                2
              </div>
              <div className="space-y-1">
                <h4 className="font-bold text-[14px] text-slate-100 uppercase tracking-wide flex items-center gap-1.5">
                  The <span className="text-indigo-400 font-mono text-[11px] bg-slate-900 border border-slate-800 px-1">Next Prog</span> TAB
                </h4>
                <p className="text-[13px] leading-relaxed text-slate-400">
                  Once your active program is set, the Next Prog tab automatically takes you to your next workout in your program. From this screen, you will be able to log your exercises for the session, with your weights, sets, reps, and RPE pre-populated using previously achieved values.
                </p>
              </div>
            </div>

            {/* Guide Step 3 */}
            <div className="flex gap-3.5 items-start">
              <div className="w-7 h-7 bg-indigo-950/80 border border-indigo-800/50 flex items-center justify-center text-indigo-300 font-mono font-black text-xs shrink-0">
                3
              </div>
              <div className="space-y-1">
                <h4 className="font-bold text-[14px] text-slate-100 uppercase tracking-wide flex items-center gap-1.5">
                  Auxiliary <span className="text-cyan-400 font-mono text-[11px] bg-slate-900 border border-slate-800 px-1">One-Off</span> Logs
                </h4>
                <p className="text-[13px] leading-relaxed text-slate-400">
                  Want to log an ad-hoc session outside of your active schedule? Press the <span className="text-white font-bold">One-Off</span> tab to record individual workouts without interrupting your main program progression.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Philosophy and Details */}
        <div className="space-y-4 pt-2">
          <h3 className="font-black text-xs text-indigo-400 uppercase tracking-widest border-b border-slate-850 pb-2">
            METREPS' CORE PHILOSOPHY
          </h3>

          <div className="space-y-4">
            {/* Philosophy A */}
            <div className="p-4 border border-slate-850 bg-slate-900/20 space-y-1.5">
              <div className="flex items-center gap-2">
                <Milestone className="w-4 h-4 text-cyan-400 shrink-0" />
                <h4 className="font-extrabold text-[13px] text-slate-100 uppercase tracking-wider font-mono">
                  Data-Driven Progress
                </h4>
              </div>
              <p className="text-[13px] text-slate-400 leading-relaxed">
                We believe in the joy of mathematical progression. MetReps leverages standard lifting formulas (Epley estimated 1RM, work volume index, and execution quality ratings) to give intermediate to advanced gym lovers a precise roadmap for hitting new milestones.
              </p>
            </div>

            {/* Philosophy B */}
            <div className="p-4 border border-slate-850 bg-slate-900/20 space-y-1.5">
              <div className="flex items-center gap-2">
                <Dumbbell className="w-4 h-4 text-emerald-400 shrink-0" />
                <h4 className="font-extrabold text-[13px] text-slate-100 uppercase tracking-wider font-mono">
                  No F*** subscriptions!
                </h4>
              </div>
              <p className="text-[13px] text-slate-400 leading-relaxed">
                Physical fitness and self-betterment should be enjoyed by everyone, not locked behind paywalls. You will never see extortionate monthly subscriptions, microtransactions, or pay-to-unlock trackers here.
              </p>
            </div>

            {/* Philosophy C */}
            <div className="p-4 border border-slate-850 bg-slate-900/20 space-y-1.5">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
                <h4 className="font-extrabold text-[13px] text-slate-100 uppercase tracking-wider font-mono">
                  Privacy-First Offline Design
                </h4>
              </div>
              <p className="text-[13px] text-slate-400 leading-relaxed">
                All your logged programs, historical lifts, and body data reside strictly in your local device storage. No sign up portals, no forced cloud accounts, and no mandatory logins.
              </p>
            </div>
          </div>
        </div>

        {/* Creator Specs */}
        <div className="pt-4 border-t border-slate-850 space-y-3.5">
          <div className="bg-slate-900 border border-slate-800 p-4 space-y-3 font-mono text-[12px] text-slate-400">
            <div className="flex justify-between items-center border-b border-slate-850 pb-2">
              <span className="font-bold text-slate-300">Ver:</span>
              <span className="text-indigo-400 font-extrabold">0.9</span>
            </div>
            <div className="flex justify-between items-center border-b border-slate-850 pb-2">
              <span className="font-bold text-slate-300">Author:</span>
              <span className="text-white font-extrabold">Phil F</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-300">Support / Feedback:</span>
              <a
                href="mailto:MetRepsApp@gmail.com"
                className="text-indigo-400 font-extrabold hover:underline flex items-center gap-1"
              >
                <Mail className="w-3.5 h-3.5 shrink-0" />
                MetRepsApp@gmail.com
              </a>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs uppercase tracking-widest transition shadow-md flex items-center justify-center gap-2"
          >
            <X className="w-4 h-4" />
            Understood & Close
          </button>
        </div>
      </div>
    </div>
  );
}
