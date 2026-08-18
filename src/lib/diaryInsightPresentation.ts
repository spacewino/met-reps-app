import {
  DiaryInsightResult,
  DiaryInsightDomain,
  DiaryRarity,
  DiaryPrimaryCategoryId,
} from './diaryInsights';
import { WeightUnit } from '../types';

export const DOMAIN_ORDER: DiaryInsightDomain[] = [
  'progression',
  'stimulus',
  'execution_fatigue',
  'recovery_context',
  'session_signature',
];

export const DOMAIN_LABELS: Record<DiaryInsightDomain, string> = {
  progression: 'Progression',
  stimulus: 'Stimulus',
  execution_fatigue: 'Execution & Fatigue',
  recovery_context: 'Recovery Context',
  session_signature: 'Session Signature',
};

export interface GroupedDiaryInsights {
  domain: DiaryInsightDomain;
  domainLabel: string;
  insights: DiaryInsightResult[];
}

export function groupDiaryInsights(insights: DiaryInsightResult[]): GroupedDiaryInsights[] {
  if (!Array.isArray(insights) || insights.length === 0) {
    return [];
  }

  const byDomain = new Map<DiaryInsightDomain, DiaryInsightResult[]>();
  DOMAIN_ORDER.forEach(d => byDomain.set(d, []));

  insights.forEach(item => {
    if (!item) return;
    const bucket = byDomain.get(item.domain);
    if (bucket) {
      bucket.push(item);
    }
  });

  const result: GroupedDiaryInsights[] = [];
  DOMAIN_ORDER.forEach(domain => {
    const list = byDomain.get(domain);
    if (list && list.length > 0) {
      result.push({
        domain,
        domainLabel: DOMAIN_LABELS[domain],
        insights: list,
      });
    }
  });

  return result;
}

export function getVisibleExpandedInsights(
  insights: DiaryInsightResult[],
  showAll: boolean,
  cap: number = 8
): {
  visibleInsights: DiaryInsightResult[];
  hasOverflow: boolean;
  totalCount: number;
  hiddenCount: number;
} {
  const safeList = Array.isArray(insights) ? insights : [];
  const totalCount = safeList.length;
  const hasOverflow = totalCount > cap;

  if (showAll || !hasOverflow) {
    return {
      visibleInsights: [...safeList],
      hasOverflow,
      totalCount,
      hiddenCount: 0,
    };
  }

  return {
    visibleInsights: safeList.slice(0, cap),
    hasOverflow: true,
    totalCount,
    hiddenCount: totalCount - cap,
  };
}

export function getDiaryRarityLabel(rarity: DiaryRarity): string | null {
  if (!rarity) return null;
  switch (rarity) {
    case 'personal_first':
      return 'PERSONAL FIRST';
    case 'rare':
      return 'RARE';
    case 'notable':
      return 'NOTABLE';
    case 'common':
      return 'COMMON';
    default:
      return null;
  }
}

export function getDiaryRarityDescription(rarity: DiaryRarity): string | null {
  if (!rarity) return null;
  switch (rarity) {
    case 'personal_first':
      return 'First time this insight has appeared across your logged workout history.';
    case 'rare':
      return 'Occurs in under 5% of your eligible preceding workout sessions.';
    case 'notable':
      return 'Occurs in 5% to 15% of your eligible preceding workout sessions.';
    case 'common':
      return 'Occurs in over 15% of your eligible preceding workout sessions.';
    default:
      return null;
  }
}

export function getCollapsedInsightBadgeLabel(insight: DiaryInsightResult): string {
  if (!insight) return '';
  const ex = insight.exerciseName ? insight.exerciseName.trim().toUpperCase() : null;
  const mg = insight.muscleGroup ? insight.muscleGroup.trim().toUpperCase() : null;

  switch (insight.id) {
    case 'load_pr':
      return ex ? `LOAD PR: ${ex}` : 'LOAD PR';
    case 'rep_pr':
      return ex ? `REP PR: ${ex}` : 'REP PR';
    case 'new_strength_ceiling':
      return ex ? `NEW CEILING: ${ex}` : 'STRENGTH CEILING';
    case 'exercise_tonnage_pr':
      return ex ? `TONNAGE PR: ${ex}` : 'TONNAGE PR';
    case 'quiet_progress':
      return ex ? `QUIET PROGRESS: ${ex}` : 'QUIET PROGRESS';
    case 'steep_fatigue_drop':
      return ex ? `FATIGUE DROP: ${ex}` : 'FATIGUE DROP';
    case 'form_drift':
      return ex ? `FORM DRIFT: ${ex}` : 'FORM DRIFT';
    case 'consistent_output':
      return ex ? `CONSISTENT: ${ex}` : 'CONSISTENT OUTPUT';
    case 'muscle_focus':
      return mg ? `FOCUS: ${mg}` : 'MUSCLE FOCUS';
    case 'heavy_exposure':
      return 'HEAVY EXPOSURE';
    case 'high_exertion':
      return 'HIGH EXERTION';
    case 'recovery_strain':
      return 'RECOVERY STRAIN';
    case 'against_the_odds':
      return 'AGAINST THE ODDS';
    case 'back_in_action':
      return 'BACK IN ACTION';
    case 'minimalist_session':
      return 'MINIMALIST SESSION';
    case 'compound_dominant':
      return 'COMPOUND DOMINANT';
    default:
      return insight.label.toUpperCase();
  }
}

export interface FormattedNumericEvidenceItem {
  key: string;
  label: string;
  value: string;
}

function convertKgToDisplay(kg: number, unit: WeightUnit): { val: number; unitStr: string } {
  if (unit === 'lb') {
    const lb = kg * 2.20462;
    const rounded = Math.round(lb * 10) / 10;
    return { val: rounded, unitStr: 'lb' };
  }
  const rounded = Math.round(kg * 10) / 10;
  return { val: rounded, unitStr: 'kg' };
}

function formatWeightValue(kg: number, unit: WeightUnit): string {
  const { val, unitStr } = convertKgToDisplay(kg, unit);
  return `${val} ${unitStr}`;
}

export function formatDiaryNumericEvidence(
  insight: DiaryInsightResult,
  unit: WeightUnit = 'kg'
): FormattedNumericEvidenceItem[] {
  if (!insight || !insight.numericEvidence) return [];

  const ev = insight.numericEvidence;
  const items: FormattedNumericEvidenceItem[] = [];

  const isFiniteNum = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v) && !Number.isNaN(v);

  switch (insight.id) {
    case 'new_strength_ceiling':
      if (isFiniteNum(ev.todayBestE1RM)) {
        items.push({
          key: 'todayBestE1RM',
          label: 'Estimated 1RM',
          value: formatWeightValue(ev.todayBestE1RM, unit),
        });
      }
      if (isFiniteNum(ev.previousMaxE1RM)) {
        items.push({
          key: 'previousMaxE1RM',
          label: 'Previous Best',
          value: formatWeightValue(ev.previousMaxE1RM, unit),
        });
      }
      break;

    case 'load_pr':
      if (isFiniteNum(ev.todayMaxWeightKg)) {
        items.push({
          key: 'todayMaxWeightKg',
          label: 'Top Weight',
          value: formatWeightValue(ev.todayMaxWeightKg, unit),
        });
      }
      if (isFiniteNum(ev.previousMaxWeightKg)) {
        items.push({
          key: 'previousMaxWeightKg',
          label: 'Previous Best',
          value: formatWeightValue(ev.previousMaxWeightKg, unit),
        });
      }
      break;

    case 'rep_pr':
      if (isFiniteNum(ev.loadKg)) {
        items.push({
          key: 'loadKg',
          label: 'Weight',
          value: formatWeightValue(ev.loadKg, unit),
        });
      }
      if (isFiniteNum(ev.todayReps)) {
        items.push({
          key: 'todayReps',
          label: 'Reps Completed',
          value: `${Math.round(ev.todayReps)} reps`,
        });
      }
      if (isFiniteNum(ev.previousReps)) {
        items.push({
          key: 'previousReps',
          label: 'Previous Reps',
          value: `${Math.round(ev.previousReps)} reps`,
        });
      }
      break;

    case 'exercise_tonnage_pr':
      if (isFiniteNum(ev.todayTonnageKg)) {
        items.push({
          key: 'todayTonnageKg',
          label: 'Session Tonnage',
          value: formatWeightValue(ev.todayTonnageKg, unit),
        });
      }
      if (isFiniteNum(ev.previousMaxTonnageKg)) {
        items.push({
          key: 'previousMaxTonnageKg',
          label: 'Previous Peak',
          value: formatWeightValue(ev.previousMaxTonnageKg, unit),
        });
      }
      break;

    case 'quiet_progress':
      if (isFiniteNum(ev.todayBestE1RM)) {
        items.push({
          key: 'todayBestE1RM',
          label: 'Today e1RM',
          value: formatWeightValue(ev.todayBestE1RM, unit),
        });
      }
      if (isFiniteNum(ev.rollingMedianE1RM)) {
        items.push({
          key: 'rollingMedianE1RM',
          label: '4-Wk Rolling Baseline',
          value: formatWeightValue(ev.rollingMedianE1RM, unit),
        });
      }
      break;

    case 'back_in_action':
      if (isFiniteNum(ev.gapDays)) {
        items.push({
          key: 'gapDays',
          label: 'Training Gap',
          value: `${Math.round(ev.gapDays)} days`,
        });
      }
      break;

    case 'heavy_exposure':
      if (isFiniteNum(ev.heavySetsCount)) {
        items.push({
          key: 'heavySetsCount',
          label: 'Heavy Sets (≥85% e1RM)',
          value: `${Math.round(ev.heavySetsCount)} sets`,
        });
      }
      break;

    case 'steep_fatigue_drop':
      if (isFiniteNum(ev.dropPercentage)) {
        items.push({
          key: 'dropPercentage',
          label: 'Performance Drop',
          value: `${Math.round(ev.dropPercentage)}%`,
        });
      }
      if (isFiniteNum(ev.firstSetE1RM)) {
        items.push({
          key: 'firstSetE1RM',
          label: 'Set 1 e1RM',
          value: formatWeightValue(ev.firstSetE1RM, unit),
        });
      }
      if (isFiniteNum(ev.lastSetE1RM)) {
        items.push({
          key: 'lastSetE1RM',
          label: 'Final Set e1RM',
          value: formatWeightValue(ev.lastSetE1RM, unit),
        });
      }
      break;

    case 'consistent_output':
      if (isFiniteNum(ev.coefficientOfVariation)) {
        const pct = Math.round(ev.coefficientOfVariation * 1000) / 10;
        items.push({
          key: 'coefficientOfVariation',
          label: 'Variation',
          value: `${pct}%`,
        });
      }
      break;

    case 'recovery_strain':
    case 'against_the_odds':
      if (isFiniteNum(ev.sessionPerformanceIndex)) {
        const pct = Math.round(ev.sessionPerformanceIndex * 100);
        items.push({
          key: 'sessionPerformanceIndex',
          label: 'Performance Index',
          value: `${pct}%`,
        });
      }
      if (isFiniteNum(ev.sleepHours)) {
        items.push({
          key: 'sleepHours',
          label: 'Logged Sleep',
          value: `${ev.sleepHours.toFixed(1)} hrs`,
        });
      }
      if (isFiniteNum(ev.soreness)) {
        items.push({
          key: 'soreness',
          label: 'Logged Soreness',
          value: `${Math.round(ev.soreness)}/10`,
        });
      }
      break;

    case 'high_exertion':
      if (isFiniteNum(ev.highExertionSetsCount)) {
        items.push({
          key: 'highExertionSetsCount',
          label: 'RPE 9.0+ Sets',
          value: `${Math.round(ev.highExertionSetsCount)} sets`,
        });
      }
      break;

    case 'muscle_focus':
      if (isFiniteNum(ev.muscleGroupSets) && isFiniteNum(ev.totalWorkingSets)) {
        const mgSets = Math.round(ev.muscleGroupSets);
        const totSets = Math.round(ev.totalWorkingSets);
        const pct = totSets > 0 ? Math.round((mgSets / totSets) * 100) : 0;
        items.push({
          key: 'muscleGroupSets',
          label: 'Target Sets',
          value: `${mgSets} / ${totSets} sets (${pct}%)`,
        });
      }
      break;

    case 'minimalist_session':
      if (isFiniteNum(ev.totalWorkingSets)) {
        items.push({
          key: 'totalWorkingSets',
          label: 'Completed Working Sets',
          value: `${Math.round(ev.totalWorkingSets)} sets`,
        });
      }
      break;

    case 'compound_dominant':
      if (isFiniteNum(ev.compoundSets) && isFiniteNum(ev.totalResistanceSets)) {
        const cSets = Math.round(ev.compoundSets);
        const totSets = Math.round(ev.totalResistanceSets);
        const pct = totSets > 0 ? Math.round((cSets / totSets) * 100) : 0;
        items.push({
          key: 'compoundSets',
          label: 'Compound Sets',
          value: `${cSets} / ${totSets} sets (${pct}%)`,
        });
      }
      break;

    default:
      // Unknown keys are safely ignored per guidelines
      break;
  }

  return items;
}
