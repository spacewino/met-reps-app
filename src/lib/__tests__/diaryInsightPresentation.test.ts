import { describe, it, expect } from 'vitest';
import {
  groupDiaryInsights,
  getVisibleExpandedInsights,
  getDiaryRarityLabel,
  getDiaryRarityDescription,
  getCollapsedInsightBadgeLabel,
  formatDiaryNumericEvidence,
  formatDiaryHistoryVolume,
  formatDiarySessionVolume,
  formatExerciseCount,
  formatDuration,
  formatWorkingSetCount,
  formatDiarySessionTotals,
  formatMuscleGroupSetCounts,
  formatCompactMuscleSummary,
  buildAccessibleDiarySummary,
  formatPerformanceIndex,
  PERFORMANCE_INDEX_EXPLANATION,
  DOMAIN_ORDER,
} from '../diaryInsightPresentation';
import { DiaryInsightResult } from '../diaryInsights';
import { DiaryHistoryVolumeSummary, DiarySessionSummary, MuscleGroupSetCount } from '../diarySessionSummary';

function makeMockInsight(overrides: Partial<DiaryInsightResult> = {}): DiaryInsightResult {
  return {
    id: 'load_pr',
    label: 'Load PR',
    explanation: 'Heaviest absolute weight recorded.',
    domain: 'progression',
    tone: 'celebratory',
    priority: 3,
    rarity: 'rare',
    ...overrides,
  };
}

function makeMockSessionSummary(overrides: Partial<DiarySessionSummary> = {}): DiarySessionSummary {
  return {
    completedExerciseCount: 3,
    durationMinutes: 60,
    completedWorkingSetCount: 9,
    workingVolume: {
      valueKg: 4820,
      status: 'complete',
      resolvedMassSetCount: 9,
      unresolvedMassSetCount: 0,
      totalMassSetCount: 9,
    },
    muscleSetCounts: [],
    ...overrides,
  };
}

describe('diaryInsightPresentation pure helpers', () => {
  describe('groupDiaryInsights', () => {
    it('groups insights into the approved domain order', () => {
      const insights: DiaryInsightResult[] = [
        makeMockInsight({ id: 'minimalist_session', domain: 'session_signature' }),
        makeMockInsight({ id: 'recovery_strain', domain: 'recovery_context' }),
        makeMockInsight({ id: 'heavy_exposure', domain: 'stimulus' }),
        makeMockInsight({ id: 'load_pr', domain: 'progression' }),
        makeMockInsight({ id: 'form_drift', domain: 'execution_fatigue' }),
      ];

      const grouped = groupDiaryInsights(insights);
      expect(grouped.map(g => g.domain)).toEqual([
        'progression',
        'stimulus',
        'execution_fatigue',
        'recovery_context',
        'session_signature',
      ]);
      expect(grouped.map(g => g.domainLabel)).toEqual([
        'Progression',
        'Stimulus',
        'Execution & Fatigue',
        'Recovery Context',
        'Session Signature',
      ]);
    });

    it('omits empty domain headings', () => {
      const insights: DiaryInsightResult[] = [
        makeMockInsight({ id: 'load_pr', domain: 'progression' }),
        makeMockInsight({ id: 'heavy_exposure', domain: 'stimulus' }),
      ];

      const grouped = groupDiaryInsights(insights);
      expect(grouped).toHaveLength(2);
      expect(grouped.map(g => g.domain)).toEqual(['progression', 'stimulus']);
    });

    it('returns empty array when input is empty or invalid', () => {
      expect(groupDiaryInsights([])).toEqual([]);
      expect(groupDiaryInsights(undefined as any)).toEqual([]);
    });

    it('preserves input immutability', () => {
      const insights = [
        makeMockInsight({ id: 'load_pr', domain: 'progression' }),
        makeMockInsight({ id: 'heavy_exposure', domain: 'stimulus' }),
      ];
      const cloneBefore = JSON.stringify(insights);
      groupDiaryInsights(insights);
      expect(JSON.stringify(insights)).toBe(cloneBefore);
    });

    it('preserves engine priority order of insights within each domain', () => {
      const insights: DiaryInsightResult[] = [
        makeMockInsight({ id: 'load_pr', domain: 'progression', priority: 1, label: 'First' }),
        makeMockInsight({ id: 'heavy_exposure', domain: 'stimulus', priority: 2, label: 'Stim 1' }),
        makeMockInsight({ id: 'rep_pr', domain: 'progression', priority: 5, label: 'Second' }),
        makeMockInsight({ id: 'quiet_progress', domain: 'progression', priority: 10, label: 'Third' }),
      ];

      const grouped = groupDiaryInsights(insights);
      const progGroup = grouped.find(g => g.domain === 'progression');
      expect(progGroup).toBeDefined();
      expect(progGroup?.insights.map(i => i.label)).toEqual(['First', 'Second', 'Third']);
    });

    it('has exact canonical domain labels matching specification', () => {
      const allDomains = groupDiaryInsights([
        makeMockInsight({ id: 'load_pr', domain: 'progression' }),
        makeMockInsight({ id: 'heavy_exposure', domain: 'stimulus' }),
        makeMockInsight({ id: 'form_drift', domain: 'execution_fatigue' }),
        makeMockInsight({ id: 'recovery_strain', domain: 'recovery_context' }),
        makeMockInsight({ id: 'minimalist_session', domain: 'session_signature' }),
      ]);

      const labelMap = Object.fromEntries(allDomains.map(g => [g.domain, g.domainLabel]));
      expect(labelMap['progression']).toBe('Progression');
      expect(labelMap['stimulus']).toBe('Stimulus');
      expect(labelMap['execution_fatigue']).toBe('Execution & Fatigue');
      expect(labelMap['recovery_context']).toBe('Recovery Context');
      expect(labelMap['session_signature']).toBe('Session Signature');
    });
  });

  describe('getVisibleExpandedInsights', () => {
    it('shows all insights initially when total count is 0 through 8', () => {
      [0, 1, 3, 5, 8].forEach(count => {
        const insights: DiaryInsightResult[] = Array.from({ length: count }, (_, i) =>
          makeMockInsight({ id: 'load_pr', priority: i, label: `Insight ${i}` })
        );

        const res = getVisibleExpandedInsights(insights, false, 8);
        expect(res.visibleInsights).toHaveLength(count);
        expect(res.hasOverflow).toBe(false);
        expect(res.totalCount).toBe(count);
        expect(res.hiddenCount).toBe(0);
      });
    });

    it('caps initially at exactly 8 insights when 9 or more exist', () => {
      [9, 10, 15].forEach(count => {
        const insights: DiaryInsightResult[] = Array.from({ length: count }, (_, i) =>
          makeMockInsight({ id: 'load_pr', priority: i, label: `Insight ${i}` })
        );

        const res = getVisibleExpandedInsights(insights, false, 8);
        expect(res.visibleInsights).toHaveLength(8);
        expect(res.hasOverflow).toBe(true);
        expect(res.totalCount).toBe(count);
        expect(res.hiddenCount).toBe(count - 8);
        expect(res.visibleInsights[0].label).toBe('Insight 0');
        expect(res.visibleInsights[7].label).toBe('Insight 7');
      });
    });

    it('returns complete list when showAll is toggled to true', () => {
      const insights: DiaryInsightResult[] = Array.from({ length: 12 }, (_, i) =>
        makeMockInsight({ id: 'load_pr', priority: i, label: `Insight ${i}` })
      );

      const resShowAll = getVisibleExpandedInsights(insights, true, 8);
      expect(resShowAll.visibleInsights).toHaveLength(12);
      expect(resShowAll.hasOverflow).toBe(true);
      expect(resShowAll.totalCount).toBe(12);
      expect(resShowAll.hiddenCount).toBe(0);
    });

    it('returns to initial 8 when showAll is toggled back to false (Show Fewer)', () => {
      const insights: DiaryInsightResult[] = Array.from({ length: 12 }, (_, i) =>
        makeMockInsight({ id: 'load_pr', priority: i, label: `Insight ${i}` })
      );

      // Expanded
      const resExpanded = getVisibleExpandedInsights(insights, true, 8);
      expect(resExpanded.visibleInsights).toHaveLength(12);

      // Collapsed back to fewer
      const resFewer = getVisibleExpandedInsights(insights, false, 8);
      expect(resFewer.visibleInsights).toHaveLength(8);
      expect(resFewer.hiddenCount).toBe(4);
    });
  });

  describe('rarity helpers', () => {
    it('formats rarity labels correctly', () => {
      expect(getDiaryRarityLabel('personal_first')).toBe('PERSONAL FIRST');
      expect(getDiaryRarityLabel('rare')).toBe('RARE');
      expect(getDiaryRarityLabel('notable')).toBe('NOTABLE');
      expect(getDiaryRarityLabel('common')).toBe('COMMON');
      expect(getDiaryRarityLabel(null)).toBeNull();
      expect(getDiaryRarityLabel(undefined as any)).toBeNull();
    });

    it('formats rarity descriptions without population claims', () => {
      const pf = getDiaryRarityDescription('personal_first');
      expect(pf).toContain('First time this insight has appeared');
      expect(pf).not.toContain('top 5% of lifters');

      const rare = getDiaryRarityDescription('rare');
      expect(rare).toContain('under 5% of your eligible preceding workout sessions');

      expect(getDiaryRarityDescription(null)).toBeNull();
    });
  });

  describe('getCollapsedInsightBadgeLabel', () => {
    it('formats concise exercise-specific collapsed labels', () => {
      expect(
        getCollapsedInsightBadgeLabel(
          makeMockInsight({ id: 'load_pr', exerciseName: 'Bench Press' })
        )
      ).toBe('LOAD PR: BENCH PRESS');

      expect(
        getCollapsedInsightBadgeLabel(
          makeMockInsight({ id: 'rep_pr', exerciseName: 'Back Squat' })
        )
      ).toBe('REP PR: BACK SQUAT');

      expect(
        getCollapsedInsightBadgeLabel(
          makeMockInsight({ id: 'quiet_progress', exerciseName: 'Leg Press' })
        )
      ).toBe('QUIET PROGRESS: LEG PRESS');

      expect(
        getCollapsedInsightBadgeLabel(
          makeMockInsight({ id: 'new_strength_ceiling', exerciseName: 'Deadlift' })
        )
      ).toBe('NEW CEILING: DEADLIFT');

      expect(
        getCollapsedInsightBadgeLabel(
          makeMockInsight({ id: 'muscle_focus', muscleGroup: 'Chest' })
        )
      ).toBe('FOCUS: CHEST');
    });

    it('formats session-wide collapsed labels', () => {
      expect(getCollapsedInsightBadgeLabel(makeMockInsight({ id: 'heavy_exposure' }))).toBe(
        'HEAVY EXPOSURE'
      );
      expect(getCollapsedInsightBadgeLabel(makeMockInsight({ id: 'high_exertion' }))).toBe(
        'HIGH EXERTION'
      );
      expect(getCollapsedInsightBadgeLabel(makeMockInsight({ id: 'recovery_strain' }))).toBe(
        'RECOVERY STRAIN'
      );
      expect(getCollapsedInsightBadgeLabel(makeMockInsight({ id: 'against_the_odds' }))).toBe(
        'AGAINST THE ODDS'
      );
      expect(getCollapsedInsightBadgeLabel(makeMockInsight({ id: 'back_in_action' }))).toBe(
        'BACK IN ACTION'
      );
      expect(getCollapsedInsightBadgeLabel(makeMockInsight({ id: 'minimalist_session' }))).toBe(
        'MINIMALIST SESSION'
      );
      expect(getCollapsedInsightBadgeLabel(makeMockInsight({ id: 'compound_dominant' }))).toBe(
        'COMPOUND DOMINANT'
      );
    });
  });

  describe('formatDiaryNumericEvidence', () => {
    it('formats kg evidence properly', () => {
      const insight = makeMockInsight({
        id: 'load_pr',
        numericEvidence: {
          todayMaxWeightKg: 100,
          previousMaxWeightKg: 95,
        },
      });

      const formatted = formatDiaryNumericEvidence(insight, 'kg');
      expect(formatted).toEqual([
        { key: 'todayMaxWeightKg', label: 'Top Weight', value: '100 kg' },
        { key: 'previousMaxWeightKg', label: 'Previous Best', value: '95 kg' },
      ]);
    });

    it('converts and formats lb evidence properly', () => {
      const insight = makeMockInsight({
        id: 'load_pr',
        numericEvidence: {
          todayMaxWeightKg: 100,
          previousMaxWeightKg: 95,
        },
      });

      const formatted = formatDiaryNumericEvidence(insight, 'lb');
      expect(formatted).toEqual([
        { key: 'todayMaxWeightKg', label: 'Top Weight', value: '220.5 lb' },
        { key: 'previousMaxWeightKg', label: 'Previous Best', value: '209.4 lb' },
      ]);
    });

    it('formats percentage, ratios and gap evidence correctly', () => {
      const fatigueInsight = makeMockInsight({
        id: 'steep_fatigue_drop',
        numericEvidence: {
          dropPercentage: 15,
          firstSetE1RM: 100,
          lastSetE1RM: 85,
        },
      });
      expect(formatDiaryNumericEvidence(fatigueInsight, 'kg')).toEqual([
        { key: 'dropPercentage', label: 'Performance Drop', value: '15%' },
        { key: 'firstSetE1RM', label: 'Set 1 e1RM', value: '100 kg' },
        { key: 'lastSetE1RM', label: 'Final Set e1RM', value: '85 kg' },
      ]);

      const cvInsight = makeMockInsight({
        id: 'consistent_output',
        numericEvidence: {
          coefficientOfVariation: 0.018,
        },
      });
      expect(formatDiaryNumericEvidence(cvInsight, 'kg')).toEqual([
        { key: 'coefficientOfVariation', label: 'Variation', value: '1.8%' },
      ]);

      const recoveryInsight = makeMockInsight({
        id: 'recovery_strain',
        numericEvidence: {
          sessionPerformanceIndex: 0.925,
          sleepHours: 5.0,
          soreness: 8,
        },
      });
      expect(formatDiaryNumericEvidence(recoveryInsight, 'kg')).toEqual([
        { key: 'sessionPerformanceIndex', label: 'Performance Index', value: '93%' },
        { key: 'sleepHours', label: 'Logged Sleep', value: '5.0 hrs' },
        { key: 'soreness', label: 'Logged Soreness', value: '8/10' },
      ]);

      const gapInsight = makeMockInsight({
        id: 'back_in_action',
        numericEvidence: {
          gapDays: 16,
        },
      });
      expect(formatDiaryNumericEvidence(gapInsight, 'kg')).toEqual([
        { key: 'gapDays', label: 'Training Gap', value: '16 days' },
      ]);
    });

    it('safely ignores unknown keys, NaN and Infinity', () => {
      const weirdInsight = makeMockInsight({
        id: 'load_pr',
        numericEvidence: {
          todayMaxWeightKg: NaN,
          previousMaxWeightKg: Infinity,
          someUnsolicitedKey: 9999,
        } as any,
      });

      const formatted = formatDiaryNumericEvidence(weirdInsight, 'kg');
      expect(formatted).toEqual([]);
    });

    it('returns empty array when numericEvidence is undefined or null', () => {
      const insight = makeMockInsight({ id: 'form_drift', numericEvidence: undefined });
      expect(formatDiaryNumericEvidence(insight, 'kg')).toEqual([]);
    });
  });

  describe('formatDiaryHistoryVolume pure presentation helper', () => {
    it('formats complete volume in kg with commas', () => {
      const summary: DiaryHistoryVolumeSummary = {
        valueKg: 4820,
        status: 'complete',
        completeSessionCount: 5,
        partialSessionCount: 0,
        unavailableSessionCount: 0,
      };

      expect(formatDiaryHistoryVolume(summary, 'kg')).toBe('4,820 kg');
    });

    it('formats complete volume in lb converted and rounded cleanly with commas', () => {
      const summary: DiaryHistoryVolumeSummary = {
        valueKg: 4820,
        status: 'complete',
        completeSessionCount: 5,
        partialSessionCount: 0,
        unavailableSessionCount: 0,
      };

      // 4820 * 2.2046226218 = 10626.28 -> 10,626 lb
      expect(formatDiaryHistoryVolume(summary, 'lb')).toBe('10,626 lb');
    });

    it('formats partial volume in kg with known-minimum prefix ≥', () => {
      const summary: DiaryHistoryVolumeSummary = {
        valueKg: 4820,
        status: 'partial',
        completeSessionCount: 4,
        partialSessionCount: 1,
        unavailableSessionCount: 0,
      };

      expect(formatDiaryHistoryVolume(summary, 'kg')).toBe('≥4,820 kg');
    });

    it('formats partial volume in lb with known-minimum prefix ≥', () => {
      const summary: DiaryHistoryVolumeSummary = {
        valueKg: 4820,
        status: 'partial',
        completeSessionCount: 4,
        partialSessionCount: 1,
        unavailableSessionCount: 0,
      };

      expect(formatDiaryHistoryVolume(summary, 'lb')).toBe('≥10,626 lb');
    });

    it('formats unavailable volume state honestly', () => {
      const summary: DiaryHistoryVolumeSummary = {
        valueKg: null,
        status: 'unavailable',
        completeSessionCount: 0,
        partialSessionCount: 0,
        unavailableSessionCount: 2,
      };

      expect(formatDiaryHistoryVolume(summary, 'kg')).toBe('Volume unavailable');
      expect(formatDiaryHistoryVolume(summary, 'lb')).toBe('Volume unavailable');
    });

    it('formats not_applicable volume state honestly', () => {
      const summary: DiaryHistoryVolumeSummary = {
        valueKg: null,
        status: 'not_applicable',
        completeSessionCount: 0,
        partialSessionCount: 0,
        unavailableSessionCount: 0,
      };

      expect(formatDiaryHistoryVolume(summary, 'kg')).toBe('Volume n/a');
      expect(formatDiaryHistoryVolume(summary, 'lb')).toBe('Volume n/a');
    });

    it('handles null and undefined summaries safely', () => {
      expect(formatDiaryHistoryVolume(null, 'kg')).toBe('Volume n/a');
      expect(formatDiaryHistoryVolume(undefined, 'kg')).toBe('Volume n/a');
    });

    it('handles non-finite volume values defensively', () => {
      const weirdComplete: DiaryHistoryVolumeSummary = {
        valueKg: NaN,
        status: 'complete',
        completeSessionCount: 1,
        partialSessionCount: 0,
        unavailableSessionCount: 0,
      };
      expect(formatDiaryHistoryVolume(weirdComplete, 'kg')).toBe('Volume n/a');

      const weirdPartial: DiaryHistoryVolumeSummary = {
        valueKg: Infinity,
        status: 'partial',
        completeSessionCount: 1,
        partialSessionCount: 1,
        unavailableSessionCount: 0,
      };
      expect(formatDiaryHistoryVolume(weirdPartial, 'kg')).toBe('Volume unavailable');
    });

    it('preserves input immutability and is deterministic', () => {
      const summary: DiaryHistoryVolumeSummary = {
        valueKg: 1500,
        status: 'complete',
        completeSessionCount: 2,
        partialSessionCount: 0,
        unavailableSessionCount: 0,
      };

      const cloneBefore = JSON.stringify(summary);
      const res1 = formatDiaryHistoryVolume(summary, 'kg');
      const res2 = formatDiaryHistoryVolume(summary, 'kg');

      expect(JSON.stringify(summary)).toBe(cloneBefore);
      expect(res1).toBe('1,500 kg');
      expect(res2).toBe('1,500 kg');
    });
  });

  describe('formatExerciseCount', () => {
    it('handles 1 exercise singular correctly', () => {
      expect(formatExerciseCount(1)).toBe('1 exercise');
    });

    it('handles 2 or more exercises plural correctly', () => {
      expect(formatExerciseCount(2)).toBe('2 exercises');
      expect(formatExerciseCount(5)).toBe('5 exercises');
      expect(formatExerciseCount(0)).toBe('0 exercises');
    });

    it('handles non-finite values safely', () => {
      expect(formatExerciseCount(NaN as any)).toBe('0 exercises');
      expect(formatExerciseCount(-1 as any)).toBe('0 exercises');
    });
  });

  describe('formatDuration', () => {
    it('formats duration in minutes when positive and finite', () => {
      expect(formatDuration(60)).toBe('60 min');
      expect(formatDuration(45.4)).toBe('45 min');
      expect(formatDuration(1)).toBe('1 min');
    });

    it('returns null when duration is missing, zero, negative, or non-finite', () => {
      expect(formatDuration(null)).toBeNull();
      expect(formatDuration(undefined)).toBeNull();
      expect(formatDuration(0)).toBeNull();
      expect(formatDuration(-5)).toBeNull();
      expect(formatDuration(NaN)).toBeNull();
      expect(formatDuration(Infinity)).toBeNull();
    });
  });

  describe('formatWorkingSetCount', () => {
    it('handles 1 set singular correctly', () => {
      expect(formatWorkingSetCount(1)).toBe('1 set');
    });

    it('handles 2 or more sets plural correctly', () => {
      expect(formatWorkingSetCount(2)).toBe('2 sets');
      expect(formatWorkingSetCount(9)).toBe('9 sets');
      expect(formatWorkingSetCount(0)).toBe('0 sets');
    });

    it('handles non-finite values safely', () => {
      expect(formatWorkingSetCount(NaN as any)).toBe('0 sets');
    });
  });

  describe('formatDiarySessionVolume', () => {
    it('formats complete volume in kg with commas', () => {
      expect(formatDiarySessionVolume({ valueKg: 4820, status: 'complete' }, 'kg')).toBe('4,820 kg');
    });

    it('formats complete volume in lb converted and rounded cleanly with commas', () => {
      // 4820 * 2.2046226218 = 10626.28 -> 10,626 lb
      expect(formatDiarySessionVolume({ valueKg: 4820, status: 'complete' }, 'lb')).toBe('10,626 lb');
    });

    it('formats partial volume in kg with known-minimum prefix ≥', () => {
      expect(formatDiarySessionVolume({ valueKg: 4820, status: 'partial' }, 'kg')).toBe('≥4,820 kg');
    });

    it('formats partial volume in lb with known-minimum prefix ≥', () => {
      expect(formatDiarySessionVolume({ valueKg: 4820, status: 'partial' }, 'lb')).toBe('≥10,626 lb');
    });

    it('formats unavailable volume state honestly', () => {
      expect(formatDiarySessionVolume({ valueKg: null, status: 'unavailable' }, 'kg')).toBe('Volume unavailable');
      expect(formatDiarySessionVolume({ valueKg: null, status: 'unavailable' }, 'lb')).toBe('Volume unavailable');
    });

    it('formats not_applicable volume state honestly', () => {
      expect(formatDiarySessionVolume({ valueKg: null, status: 'not_applicable' }, 'kg')).toBe('Volume n/a');
      expect(formatDiarySessionVolume({ valueKg: null, status: 'not_applicable' }, 'lb')).toBe('Volume n/a');
    });

    it('handles null and undefined summaries safely', () => {
      expect(formatDiarySessionVolume(null, 'kg')).toBe('Volume n/a');
      expect(formatDiarySessionVolume(undefined, 'kg')).toBe('Volume n/a');
    });

    it('handles non-finite volume values defensively', () => {
      expect(formatDiarySessionVolume({ valueKg: NaN, status: 'complete' }, 'kg')).toBe('Volume n/a');
      expect(formatDiarySessionVolume({ valueKg: Infinity, status: 'partial' }, 'kg')).toBe('Volume unavailable');
    });

    it('converts units exactly once', () => {
      const vol = { valueKg: 100, status: 'complete' as const };
      const resLb = formatDiarySessionVolume(vol, 'lb');
      // 100 * 2.2046226218 = 220.46 -> 220 lb
      expect(resLb).toBe('220 lb');
    });
  });

  describe('formatDiarySessionTotals', () => {
    it('formats complete example matching: 3 exercises · 60 min · 9 sets · 4,820 kg', () => {
      const summary = makeMockSessionSummary({
        completedExerciseCount: 3,
        durationMinutes: 60,
        completedWorkingSetCount: 9,
        workingVolume: {
          valueKg: 4820,
          status: 'complete',
          resolvedMassSetCount: 9,
          unresolvedMassSetCount: 0,
          totalMassSetCount: 9,
        },
      });

      expect(formatDiarySessionTotals(summary, 'kg')).toBe(
        '3 exercises · 60 min · 9 sets · 4,820 kg'
      );
    });

    it('omits duration when missing or 0 without leaving orphan middle dots', () => {
      const summary = makeMockSessionSummary({
        completedExerciseCount: 3,
        durationMinutes: null,
        completedWorkingSetCount: 9,
        workingVolume: {
          valueKg: 4820,
          status: 'complete',
          resolvedMassSetCount: 9,
          unresolvedMassSetCount: 0,
          totalMassSetCount: 9,
        },
      });

      expect(formatDiarySessionTotals(summary, 'kg')).toBe(
        '3 exercises · 9 sets · 4,820 kg'
      );
    });

    it('formats partial volume example with ≥ prefix', () => {
      const summary = makeMockSessionSummary({
        completedExerciseCount: 4,
        durationMinutes: 45,
        completedWorkingSetCount: 12,
        workingVolume: {
          valueKg: 3200,
          status: 'partial',
          resolvedMassSetCount: 10,
          unresolvedMassSetCount: 2,
          totalMassSetCount: 12,
        },
      });

      expect(formatDiarySessionTotals(summary, 'kg')).toBe(
        '4 exercises · 45 min · 12 sets · ≥3,200 kg'
      );
    });

    it('formats timed-only / bodyweight-only session with Volume n/a', () => {
      const summary = makeMockSessionSummary({
        completedExerciseCount: 2,
        durationMinutes: 30,
        completedWorkingSetCount: 6,
        workingVolume: {
          valueKg: null,
          status: 'not_applicable',
          resolvedMassSetCount: 0,
          unresolvedMassSetCount: 0,
          totalMassSetCount: 0,
        },
      });

      expect(formatDiarySessionTotals(summary, 'kg')).toBe(
        '2 exercises · 30 min · 6 sets · Volume n/a'
      );
    });

    it('formats singular counts naturally: 1 exercise · 1 set · 100 kg', () => {
      const summary = makeMockSessionSummary({
        completedExerciseCount: 1,
        durationMinutes: null,
        completedWorkingSetCount: 1,
        workingVolume: {
          valueKg: 100,
          status: 'complete',
          resolvedMassSetCount: 1,
          unresolvedMassSetCount: 0,
          totalMassSetCount: 1,
        },
      });

      expect(formatDiarySessionTotals(summary, 'kg')).toBe(
        '1 exercise · 1 set · 100 kg'
      );
    });
  });

  describe('formatMuscleGroupSetCounts and formatCompactMuscleSummary', () => {
    it('returns empty when muscleSetCounts is empty or null', () => {
      expect(formatMuscleGroupSetCounts([])).toEqual({
        displayedItems: [],
        overflowText: null,
        overflowTooltip: null,
        allItems: [],
      });
      expect(formatCompactMuscleSummary([])).toBe('');
      expect(formatCompactMuscleSummary(null)).toBe('');
    });

    it('formats a single muscle group correctly', () => {
      const muscles: MuscleGroupSetCount[] = [{ muscleGroup: 'Quads', setCount: 4 }];
      const res = formatMuscleGroupSetCounts(muscles);
      expect(res.displayedItems).toEqual(['Quads (4)']);
      expect(res.overflowText).toBeNull();
      expect(formatCompactMuscleSummary(muscles)).toBe('Quads (4)');
    });

    it('displays exactly three muscle groups without overflow', () => {
      const muscles: MuscleGroupSetCount[] = [
        { muscleGroup: 'Quads', setCount: 4 },
        { muscleGroup: 'Pecs', setCount: 3 },
        { muscleGroup: 'Triceps', setCount: 2 },
      ];
      const res = formatMuscleGroupSetCounts(muscles);
      expect(res.displayedItems).toEqual(['Quads (4)', 'Pecs (3)', 'Triceps (2)']);
      expect(res.overflowText).toBeNull();
      expect(formatCompactMuscleSummary(muscles)).toBe(
        'Quads (4) · Pecs (3) · Triceps (2)'
      );
    });

    it('shows first three plus +1 muscle for 4 muscle groups', () => {
      const muscles: MuscleGroupSetCount[] = [
        { muscleGroup: 'Quads', setCount: 4 },
        { muscleGroup: 'Pecs', setCount: 3 },
        { muscleGroup: 'Triceps', setCount: 2 },
        { muscleGroup: 'Delts', setCount: 2 },
      ];
      const res = formatMuscleGroupSetCounts(muscles);
      expect(res.displayedItems).toEqual(['Quads (4)', 'Pecs (3)', 'Triceps (2)']);
      expect(res.overflowText).toBe('+1 muscle');
      expect(res.overflowTooltip).toBe('+1 muscle: Delts (2)');
      expect(formatCompactMuscleSummary(muscles)).toBe(
        'Quads (4) · Pecs (3) · Triceps (2) · +1 muscle'
      );
    });

    it('shows first three plus +N muscles for 5 or more muscle groups', () => {
      const muscles: MuscleGroupSetCount[] = [
        { muscleGroup: 'Quads', setCount: 6 },
        { muscleGroup: 'Hamstrings', setCount: 4 },
        { muscleGroup: 'Glutes', setCount: 3 },
        { muscleGroup: 'Calves', setCount: 3 },
        { muscleGroup: 'Abs', setCount: 2 },
      ];
      const res = formatMuscleGroupSetCounts(muscles);
      expect(res.displayedItems).toEqual(['Quads (6)', 'Hamstrings (4)', 'Glutes (3)']);
      expect(res.overflowText).toBe('+2 muscles');
      expect(res.overflowTooltip).toBe('+2 muscles: Calves (3), Abs (2)');
      expect(formatCompactMuscleSummary(muscles)).toBe(
        'Quads (6) · Hamstrings (4) · Glutes (3) · +2 muscles'
      );
    });

    it('displays all muscle groups when expanded is true', () => {
      const muscles: MuscleGroupSetCount[] = [
        { muscleGroup: 'Quads', setCount: 6 },
        { muscleGroup: 'Hamstrings', setCount: 4 },
        { muscleGroup: 'Glutes', setCount: 3 },
        { muscleGroup: 'Calves', setCount: 3 },
        { muscleGroup: 'Abs', setCount: 2 },
      ];
      const res = formatMuscleGroupSetCounts(muscles, true);
      expect(res.displayedItems).toEqual([
        'Quads (6)',
        'Hamstrings (4)',
        'Glutes (3)',
        'Calves (3)',
        'Abs (2)',
      ]);
      expect(res.overflowText).toBeNull();
      expect(formatCompactMuscleSummary(muscles, true)).toBe(
        'Quads (6) · Hamstrings (4) · Glutes (3) · Calves (3) · Abs (2)'
      );
    });

    it('preserves input immutability', () => {
      const muscles: MuscleGroupSetCount[] = [
        { muscleGroup: 'Quads', setCount: 4 },
        { muscleGroup: 'Pecs', setCount: 3 },
      ];
      const clone = JSON.stringify(muscles);
      formatMuscleGroupSetCounts(muscles);
      formatCompactMuscleSummary(muscles);
      expect(JSON.stringify(muscles)).toBe(clone);
    });
  });

  describe('buildAccessibleDiarySummary', () => {
    it('formats complete accessible summary example correctly', () => {
      const summary = makeMockSessionSummary({
        completedExerciseCount: 3,
        durationMinutes: 60,
        completedWorkingSetCount: 9,
        workingVolume: {
          valueKg: 4820,
          status: 'complete',
          resolvedMassSetCount: 9,
          unresolvedMassSetCount: 0,
          totalMassSetCount: 9,
        },
        muscleSetCounts: [
          { muscleGroup: 'Quads', setCount: 4 },
          { muscleGroup: 'Pecs', setCount: 3 },
          { muscleGroup: 'Triceps', setCount: 2 },
        ],
      });

      expect(buildAccessibleDiarySummary(summary, 'kg')).toBe(
        '3 exercises, 60 minutes, 9 working sets, 4,820 kilograms of working volume. Quads 4 sets, Pecs 3 sets, Triceps 2 sets.'
      );
    });

    it('formats singular counts in accessible summary correctly', () => {
      const summary = makeMockSessionSummary({
        completedExerciseCount: 1,
        durationMinutes: 1,
        completedWorkingSetCount: 1,
        workingVolume: {
          valueKg: 680,
          status: 'complete',
          resolvedMassSetCount: 1,
          unresolvedMassSetCount: 0,
          totalMassSetCount: 1,
        },
        muscleSetCounts: [{ muscleGroup: 'Quads', setCount: 1 }],
      });

      expect(buildAccessibleDiarySummary(summary, 'kg')).toBe(
        '1 exercise, 1 minute, 1 working set, 680 kilograms of working volume. Quads 1 set.'
      );
    });

    it('omits duration when missing and handles unavailable volume and lb units', () => {
      const summary = makeMockSessionSummary({
        completedExerciseCount: 2,
        durationMinutes: null,
        completedWorkingSetCount: 7,
        workingVolume: {
          valueKg: null,
          status: 'unavailable',
          resolvedMassSetCount: 0,
          unresolvedMassSetCount: 7,
          totalMassSetCount: 7,
        },
        muscleSetCounts: [
          { muscleGroup: 'Quads', setCount: 4 },
          { muscleGroup: 'Pecs', setCount: 3 },
        ],
      });

      expect(buildAccessibleDiarySummary(summary, 'lb')).toBe(
        '2 exercises, 7 working sets, working volume unavailable. Quads 4 sets, Pecs 3 sets.'
      );
    });

    it('formats partial volume in lb with at least prefix', () => {
      const summary = makeMockSessionSummary({
        completedExerciseCount: 4,
        durationMinutes: 50,
        completedWorkingSetCount: 12,
        workingVolume: {
          valueKg: 3200,
          status: 'partial',
          resolvedMassSetCount: 10,
          unresolvedMassSetCount: 2,
          totalMassSetCount: 12,
        },
        muscleSetCounts: [{ muscleGroup: 'Quads', setCount: 6 }],
      });

      // 3200 * 2.2046226218 = 7054.79 -> 7,055 pounds
      expect(buildAccessibleDiarySummary(summary, 'lb')).toBe(
        '4 exercises, 50 minutes, 12 working sets, at least 7,055 pounds of working volume. Quads 6 sets.'
      );
    });

    it('includes all muscle groups in accessible summary even when 4 or more exist', () => {
      const summary = makeMockSessionSummary({
        completedExerciseCount: 5,
        durationMinutes: 60,
        completedWorkingSetCount: 15,
        workingVolume: {
          valueKg: 5000,
          status: 'complete',
          resolvedMassSetCount: 15,
          unresolvedMassSetCount: 0,
          totalMassSetCount: 15,
        },
        muscleSetCounts: [
          { muscleGroup: 'Quads', setCount: 6 },
          { muscleGroup: 'Hamstrings', setCount: 4 },
          { muscleGroup: 'Glutes', setCount: 3 },
          { muscleGroup: 'Calves', setCount: 3 },
          { muscleGroup: 'Abs', setCount: 2 },
        ],
      });

      const accessible = buildAccessibleDiarySummary(summary, 'kg');
      expect(accessible).toContain(
        'Quads 6 sets, Hamstrings 4 sets, Glutes 3 sets, Calves 3 sets, Abs 2 sets.'
      );
    });
  });

  describe('formatPerformanceIndex', () => {
    it('formats null as —', () => {
      expect(formatPerformanceIndex(null)).toBe('—');
    });

    it('formats undefined as —', () => {
      expect(formatPerformanceIndex(undefined)).toBe('—');
    });

    it('formats exact baseline 1.0 as 100.0%', () => {
      expect(formatPerformanceIndex(1.0)).toBe('100.0%');
    });

    it('formats 1.1% above baseline (1.011) as 101.1%', () => {
      expect(formatPerformanceIndex(1.011)).toBe('101.1%');
    });

    it('formats 1.1% below baseline (0.989) as 98.9%', () => {
      expect(formatPerformanceIndex(0.989)).toBe('98.9%');
    });

    it('formats NaN defensively as —', () => {
      expect(formatPerformanceIndex(NaN)).toBe('—');
    });

    it('formats Infinity and -Infinity defensively as —', () => {
      expect(formatPerformanceIndex(Infinity)).toBe('—');
      expect(formatPerformanceIndex(-Infinity)).toBe('—');
    });

    it('formats valid score without parenthetical status like (Rolling Baseline)', () => {
      const formatted = `Performance Index: ${formatPerformanceIndex(1.011)}`;
      expect(formatted).toBe('Performance Index: 101.1%');
      expect(formatted).not.toContain('Rolling Baseline');
      expect(formatted).not.toContain('Provisional');
    });

    it('formats unavailable score without parenthetical status like (Provisional)', () => {
      const formatted = `Performance Index: ${formatPerformanceIndex(null)}`;
      expect(formatted).toBe('Performance Index: —');
      expect(formatted).not.toContain('Rolling Baseline');
      expect(formatted).not.toContain('Provisional');
    });
  });

  describe('PERFORMANCE_INDEX_EXPLANATION', () => {
    it('contains complete explanation including unavailable — state sentence', () => {
      expect(PERFORMANCE_INDEX_EXPLANATION).toHaveLength(3);
      expect(PERFORMANCE_INDEX_EXPLANATION[0]).toContain('Your Performance Index compares your actual session capacity');
      expect(PERFORMANCE_INDEX_EXPLANATION[0]).toContain('100%');
      expect(PERFORMANCE_INDEX_EXPLANATION[1]).toContain('Performance Index is a contextual comparison, not a medical or recovery diagnosis.');
      expect(PERFORMANCE_INDEX_EXPLANATION[2]).toBe(
        'If there is not enough comparable exercise history, the Performance Index is shown as “—” (unavailable).'
      );
    });
  });
});

