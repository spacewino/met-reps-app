/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Info, Milestone, Dumbbell, ShieldCheck, Mail, ArrowLeft, BarChart3, CircleSlash, Play, ExternalLink } from 'lucide-react';
import { storage } from '../lib/storage';
import { METREPS_VIDEO_GUIDE_URL } from '../lib/onboarding';

interface InfoViewProps {
  onClose: () => void;
  onOpenOnboarding?: () => void;
}

export function InfoView({ onClose, onOpenOnboarding }: InfoViewProps) {
  const themeId = React.useMemo(() => storage.getTheme(), []);
  const isDesert = themeId === 'amber';

  return (
    <div className="space-y-6 pb-20">
      {/* Sticky Header */}
      <div className="sticky top-[-16px] -mt-4 pt-3 pb-2.5 bg-slate-950 z-30 flex items-center gap-3 border-b border-slate-850 px-4 shadow-md">
        <button
          onClick={onClose}
          className="p-2 bg-slate-900 hover:bg-slate-800 rounded-none text-slate-400 hover:text-white border border-slate-800 transition min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
          aria-label="Back to Home"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h2 className="font-extrabold text-sm text-white uppercase tracking-wide flex items-center gap-1.5 font-sans">
            <Info className="w-4.5 h-4.5 text-indigo-400" />
            APP INFORMATION
          </h2>
          <p className="text-[10px] text-indigo-400 font-mono uppercase tracking-widest">
            Guide & philosophy
          </p>
        </div>
      </div>

      <div className="px-4 space-y-6">
        {/* Welcome Block */}
        <div className="bg-slate-900/40 border border-slate-850 p-5 space-y-3 shadow-md relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-full blur-xl pointer-events-none" />
          <div className="text-indigo-400">
            <h3 className="font-extrabold text-sm uppercase tracking-wider font-sans">
              Welcome to Metreps
            </h3>
          </div>
          <p className="text-[14px] leading-relaxed text-slate-300">
            Metreps is a powerful workout tracker designed to help you plan your training, log your progress, and analyse your lifting data. Born as a personal passion project backed by over 25 years of strength training experience, its ultimate goal is to help you 'min/max' results in the gym through precise analysis of all performance and recovery metrics.
          </p>
        </div>

        {/* Section 1: Quick Start Guide */}
        <div className="space-y-4">
          <div className="border-b border-slate-850 pb-2">
            <h3 className="font-black text-xs text-indigo-400 uppercase tracking-widest">
              Quick Start Guide
            </h3>
          </div>

          <div className="space-y-4">
            {/* Guide Step 1 */}
            <div className="flex gap-3.5 items-start">
              <div className="w-7 h-7 bg-indigo-950/80 border border-indigo-800/50 flex items-center justify-center text-indigo-300 font-mono font-black text-xs shrink-0">
                1
              </div>
              <div className="space-y-1">
                <h4 className="font-bold text-[14px] text-slate-100 uppercase tracking-wide flex items-center gap-1.5">
                  Create Your <span className="text-indigo-400 font-mono text-[11px] bg-slate-900 border border-slate-800 px-1">Program</span>
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
                  The <span className="text-indigo-400 font-mono text-[11px] bg-slate-900 border border-slate-800 px-1">Workout</span> Tab
                </h4>
                <p className="text-[13px] leading-relaxed text-slate-400">
                  When you are ready to train, open the <span className="text-white font-bold">Workout</span> tab. It automatically loads your next scheduled session from your active program, calculating your target sets and suggested weights based on previous performance.
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
                  Auxiliary & <span className="text-indigo-400 font-mono text-[11px] bg-slate-900 border border-slate-800 px-1">One-Off</span> Workouts
                </h4>
                <p className="text-[13px] leading-relaxed text-slate-400">
                  Need to log a workout outside your regular program schedule? Use the <span className="text-white font-bold">One-Off</span> button in the main menu to track ad-hoc sessions, travel workouts, or extra accessory work.
                </p>
              </div>
            </div>

            {/* Replay App Introduction Button */}
            {onOpenOnboarding && (
              <button
                type="button"
                onClick={onOpenOnboarding}
                className="w-full mt-2 py-3 px-4 bg-slate-900/60 hover:bg-slate-850 border border-slate-800 hover:border-indigo-500/50 transition flex items-center justify-between text-left cursor-pointer group rounded-none min-h-[44px]"
              >
                <div className="flex items-center gap-2.5">
                  <Info className="w-4 h-4 text-indigo-400 shrink-0 group-hover:scale-110 transition-transform" />
                  <span className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wide">
                    Replay app introduction
                  </span>
                </div>
                <span className="text-xs font-mono font-bold text-indigo-400 group-hover:translate-x-0.5 transition-transform">
                  Launch Guide →
                </span>
              </button>
            )}

            {/* Watch Video Guide External Link */}
            <a
              href={METREPS_VIDEO_GUIDE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full mt-2 py-3 px-4 bg-slate-900/60 hover:bg-slate-850 border border-slate-800 hover:border-slate-700 transition flex items-center justify-between text-left cursor-pointer group rounded-none min-h-[44px] focus:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
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
              <ExternalLink className="w-4 h-4 text-slate-400 group-hover:text-slate-200 shrink-0 transition-colors" aria-hidden="true" />
            </a>
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
                <BarChart3 className="w-4 h-4 text-cyan-400 shrink-0" />
                <h4 className="font-extrabold text-[13px] text-slate-100 uppercase tracking-wider font-mono">
                  Data-Driven Progress
                </h4>
              </div>
              <p className="text-[13px] text-slate-400 leading-relaxed">
                Built around the joy of mathematical progression, Metreps leverages exercise science-based algorithms and standard lifting formulas (Epley estimated 1RM, work volume index, and execution quality ratings) to give intermediate to advanced gym lovers a precise roadmap for hitting new milestones.
              </p>
            </div>

            {/* Philosophy B */}
            <div className="p-4 border border-slate-850 bg-slate-900/20 space-y-1.5">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <h4 className="font-extrabold text-[13px] text-slate-100 uppercase tracking-wider font-mono">
                  100% Client-Side & Private
                </h4>
              </div>
              <p className="text-[13px] text-slate-400 leading-relaxed">
                We believe your lifting and recovery data belongs strictly to you. Metreps does not require creating an account, has zero tracking cookies, and operates 100% client-side in your local storage. Export full JSON data backups anytime from the Settings menu.
              </p>
            </div>

            {/* Philosophy C */}
            <div className="p-4 border border-slate-850 bg-slate-900/20 space-y-1.5">
              <div className="flex items-center gap-2">
                <CircleSlash className="w-4 h-4 text-rose-400 shrink-0" />
                <h4 className="font-extrabold text-[13px] text-slate-100 uppercase tracking-wider font-mono">
                  Zero Paywalls or Ads
                </h4>
              </div>
              <p className="text-[13px] text-slate-400 leading-relaxed">
                Metreps has no subscription tiers, paywalled features, locked algorithms, or third-party ads. Every single chart, auto-adjust formula, and template is completely unlocked.
              </p>
            </div>
          </div>
        </div>

        {/* Section 3: Contact, Creator and Version Info */}
        <div className="p-4 bg-slate-950 border border-slate-850 text-center space-y-3">
          <div className="space-y-1">
            <p className="text-xs text-slate-400">
              MetReps by <span className="text-slate-200 font-bold">Fil Filidei</span>
            </p>
            <p className="text-[11px] font-mono text-slate-500">
              Ver: <span className="text-slate-300 font-bold">1.1.0.0</span>
            </p>
          </div>
          <div className="pt-1">
            <a
              href="mailto:MetRepsApp@gmail.com"
              className="inline-flex items-center gap-2 text-xs font-mono text-indigo-400 hover:text-indigo-300 uppercase font-bold underline"
            >
              <Mail className="w-3.5 h-3.5" /> MetRepsApp@gmail.com
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
