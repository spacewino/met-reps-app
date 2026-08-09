/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Trophy,
  Shield,
  Flame,
  Crown,
  Zap,
  Star,
  Swords,
  Award,
  Target,
  Sparkles,
  Dumbbell,
  CheckCircle2,
  Lock,
  X,
  Info
} from 'lucide-react';
import { Achievement } from '../lib/achievements';
import { useModalHistory } from '../lib/useModalHistory';

interface AchievementsModalProps {
  visible: boolean;
  onClose: () => void;
  achievements: Achievement[];
  selectedTitleId: string;
  onSelectTitle: (id: string) => void;
  themeId?: string;
}

export function AchievementsModal({
  visible,
  onClose,
  achievements,
  selectedTitleId,
  onSelectTitle,
  themeId = 'slate',
}: AchievementsModalProps) {
  const { dismiss } = useModalHistory(visible, onClose, 'achievements-modal');
  const [filter, setFilter] = useState<'all' | 'unlocked' | 'locked'>('all');

  if (!visible) return null;

  const isDesert = themeId === 'amber';
  const isEmerald = themeId === 'emerald';

  const unlockedCount = achievements.filter(a => a.unlocked).length;

  const filteredList = achievements.filter(a => {
    if (filter === 'unlocked') return a.unlocked;
    if (filter === 'locked') return !a.unlocked;
    return true;
  });

  const getIcon = (iconName: string, unlocked: boolean) => {
    const cls = "w-4 h-4";
    switch (iconName) {
      case 'trophy': return <Trophy className={cls} />;
      case 'shield': return <Shield className={cls} />;
      case 'flame': return <Flame className={cls} />;
      case 'crown': return <Crown className={cls} />;
      case 'zap': return <Zap className={cls} />;
      case 'star': return <Star className={cls} />;
      case 'swords': return <Swords className={cls} />;
      case 'award': return <Award className={cls} />;
      case 'target': return <Target className={cls} />;
      case 'sparkles': return <Sparkles className={cls} />;
      default: return <Dumbbell className={cls} />;
    }
  };

  return (
    <div
      className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-3 animate-in fade-in duration-150"
      onClick={dismiss}
    >
      <div
        className={`w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col border shadow-2xl animate-in fade-in zoom-in-95 duration-150 ${
          isDesert
            ? 'bg-[#FAF5F0] border-[#E05A47]/40 text-[#252320]'
            : isEmerald
            ? 'bg-slate-900 border-emerald-800/80 text-slate-100'
            : 'bg-slate-900 border-slate-800 text-slate-100'
        }`}
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className={`p-4 border-b flex items-start justify-between gap-2 ${
          isDesert ? 'bg-[#F5EBE0] border-[#E05A47]/30' : 'bg-slate-950/80 border-slate-800'
        }`}>
          <div className="flex items-center gap-2.5">
            <div className={`p-2 border ${
              isDesert
                ? 'bg-[#FDF2F2] border-[#E05A47]/40 text-[#9B1C1C]'
                : 'bg-indigo-950/80 border-indigo-500/40 text-indigo-400'
            }`}>
              <Trophy className="w-5 h-5" />
            </div>
            <div>
              <h3 className={`text-sm font-black uppercase tracking-wider ${
                isDesert ? 'text-[#252320]' : 'text-white'
              }`}>
                Journal Achievements & Titles
              </h3>
              <p className={`text-[10px] font-mono mt-0.5 ${
                isDesert ? 'text-[#504A43]' : 'text-slate-400'
              }`}>
                Tap any unlocked title to feature it on your Journal Summary card.
              </p>
            </div>
          </div>

          <button
            onClick={dismiss}
            className={`p-1.5 rounded transition-colors ${
              isDesert ? 'hover:bg-[#E05A47]/20 text-[#252320]' : 'hover:bg-slate-800 text-slate-300'
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Counter & Filter Pills */}
        <div className={`px-4 py-2.5 border-b flex items-center justify-between gap-2 text-xs font-mono ${
          isDesert ? 'bg-[#FAF5F0] border-[#E05A47]/20' : 'bg-slate-950/40 border-slate-850'
        }`}>
          <div className="flex items-center gap-1.5 font-bold">
            <span className={`px-2 py-0.5 border text-[10px] font-black ${
              isDesert ? 'bg-[#F5EBE0] border-[#E05A47]/50 text-[#9B1C1C]' : 'bg-indigo-950 border-indigo-800 text-indigo-300'
            }`}>
              {unlockedCount} / {achievements.length} UNLOCKED
            </span>
          </div>

          <div className="flex items-center gap-1">
            {(['all', 'unlocked', 'locked'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setFilter(tab)}
                className={`px-2.5 py-1 text-[10px] uppercase font-black tracking-wider border transition-colors ${
                  filter === tab
                    ? isDesert
                      ? 'bg-[#E05A47] text-white border-[#E05A47] shadow-sm'
                      : 'bg-indigo-600 text-white border-indigo-500'
                    : isDesert
                      ? 'bg-[#F5EBE0] text-[#252320] border-[#E05A47]/30 hover:bg-[#E05A47]/15'
                      : 'bg-transparent text-slate-400 border-transparent hover:border-slate-800'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable Achievement List */}
        <div className="p-3 overflow-y-auto space-y-2.5 flex-1">
          {filteredList.map(item => {
            const isSelected = item.id === selectedTitleId || (item.isDefaultTitle && !selectedTitleId);

            return (
              <div
                key={item.id}
                onClick={() => {
                  if (item.unlocked) {
                    onSelectTitle(item.id);
                  }
                }}
                className={`p-3 border transition-all ${
                  item.unlocked ? 'cursor-pointer' : 'opacity-70 cursor-not-allowed'
                } ${
                  isSelected
                    ? isDesert
                      ? 'bg-[#F5EBE0] border-[#E05A47] ring-1 ring-[#E05A47]'
                      : 'bg-indigo-950/40 border-indigo-500 ring-1 ring-indigo-500/50'
                    : item.unlocked
                    ? isDesert
                      ? 'bg-[#FAF5F0] border-[#E05A47]/30 hover:border-[#E05A47]'
                      : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                    : isDesert
                      ? 'bg-[#FAF5F0]/50 border-gray-200'
                      : 'bg-slate-950/20 border-slate-900'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5 min-w-0">
                    {/* Badge Icon */}
                    <div className={`p-2 border shrink-0 ${
                      item.unlocked
                        ? isDesert
                          ? 'bg-[#FDF2F2] border-[#E05A47]/40 text-[#9B1C1C]'
                          : 'bg-indigo-950 border-indigo-500/40 text-indigo-400'
                        : isDesert
                          ? 'bg-gray-100 border-gray-300 text-gray-500'
                          : 'bg-slate-900 border-slate-800 text-slate-600'
                    }`}>
                      {item.unlocked ? getIcon(item.badgeIcon, true) : <Lock className="w-4 h-4" />}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-xs font-black font-mono tracking-wider ${
                          item.unlocked
                            ? isDesert ? 'text-[#801717]' : 'text-indigo-300'
                            : isDesert ? 'text-gray-600' : 'text-slate-500'
                        }`}>
                          {item.title}
                        </span>

                        {isSelected && (
                          <span className={`px-1.5 py-0.2 text-[8px] font-mono font-black uppercase tracking-wider border ${
                            isDesert
                              ? 'bg-[#E05A47] text-white border-[#E05A47]'
                              : 'bg-indigo-600 text-white border-indigo-500'
                          }`}>
                            FEATURED
                          </span>
                        )}
                      </div>

                      <p className={`text-[11px] mt-0.5 leading-snug font-medium ${
                        isDesert ? 'text-[#252320]' : 'text-slate-300'
                      }`}>
                        {item.description}
                      </p>

                      <div className={`text-[10px] font-mono mt-1 ${
                        isDesert ? 'text-[#504A43]' : 'text-slate-400'
                      }`}>
                        <span className="font-bold">Criteria:</span> {item.criteriaText}
                      </div>
                    </div>
                  </div>

                  {/* Status / Select Button */}
                  <div className="shrink-0 text-right">
                    {item.unlocked ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectTitle(item.id);
                        }}
                        className={`px-2.5 py-1 text-[9px] font-mono font-black uppercase border transition ${
                          isSelected
                            ? isDesert
                              ? 'bg-[#E05A47] text-white border-[#E05A47] shadow-sm'
                              : 'bg-indigo-600 text-white border-indigo-500'
                            : isDesert
                              ? 'bg-[#F5EBE0] hover:bg-[#E05A47]/20 border-[#E05A47]/50 text-[#801717]'
                              : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-indigo-300'
                        }`}
                      >
                        {isSelected ? 'FEATURED' : 'SELECT'}
                      </button>
                    ) : (
                      <span className={`text-[9px] font-mono font-bold uppercase px-2 py-1 border block ${
                        isDesert ? 'bg-[#EBE5DE] border-[#D5CDC3] text-[#504A43]' : 'bg-slate-950 border-slate-900 text-slate-600'
                      }`}>
                        LOCKED
                      </span>
                    )}
                  </div>
                </div>

                {/* Progress bar for locked or partially completed items */}
                {!item.unlocked && (
                  <div className="mt-2 pt-2 border-t border-dashed border-gray-300/40">
                    <div className="flex items-center justify-between text-[9px] font-mono mb-1">
                      <span className={isDesert ? 'text-[#504A43] font-bold' : 'text-slate-500'}>PROGRESS</span>
                      <span className={isDesert ? 'text-[#252320] font-bold' : 'text-slate-400'}>{item.currentStatusText}</span>
                    </div>
                    <div className={`w-full h-1.5 border overflow-hidden ${
                      isDesert ? 'bg-gray-200 border-gray-300' : 'bg-slate-950 border-slate-800'
                    }`}>
                      <div
                        className={`h-full transition-all duration-300 ${
                          isDesert ? 'bg-[#E05A47]' : 'bg-indigo-500'
                        }`}
                        style={{ width: `${item.progressPercent}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Modal Footer */}
        <div className={`p-3 border-t text-right ${
          isDesert ? 'bg-[#F5EBE0] border-[#E05A47]/30' : 'bg-slate-950/80 border-slate-800'
        }`}>
          <button
            onClick={dismiss}
            className={`px-5 py-2 font-mono text-xs font-black uppercase tracking-wider border transition ${
              isDesert
                ? 'bg-[#E05A47] hover:bg-[#C84B39] text-white border-[#E05A47] shadow-sm'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-500'
            }`}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default AchievementsModal;
