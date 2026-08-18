import { describe, it, expect } from 'vitest';
import {
  groupDiaryInsights,
  getVisibleExpandedInsights,
  getDiaryRarityLabel,
  getDiaryRarityDescription,
  getCollapsedInsightBadgeLabel,
  formatDiaryNumericEvidence,
  DOMAIN_ORDER,
} from '../diaryInsightPresentation';
import { DiaryInsightResult } from '../diaryInsights';

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
});
