import { describe, expect, it } from 'vitest';
import { THEME_PRESETS } from '../../theme';

const channel = (hex: string, offset: number) => parseInt(hex.slice(offset, offset + 2), 16) / 255;
const luminance = (hex: string) => {
  const linear = [1, 3, 5].map(offset => {
    const value = channel(hex, offset);
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
};
const contrast = (foreground: string, background: string) => {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

describe('resolved theme contrast', () => {
  it.each(THEME_PRESETS)('$name text remains WCAG AA on both application surfaces', theme => {
    for (const surface of [theme.bgMain, theme.bgCard]) {
      expect(contrast(theme.textPrimary, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.textSecondary, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.textMuted, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.accentLight, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.accentCyan, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.success, surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(THEME_PRESETS)('$name selected-card copy remains readable on its filled surface', theme => {
    expect(contrast(theme.textPrimary, theme.selectedSurface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.textSecondary, theme.selectedSurface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.accent, theme.selectedSurface)).toBeGreaterThanOrEqual(3);
  });

  it.each(THEME_PRESETS)('$name controls retain perceivable boundaries and focus colour', theme => {
    for (const surface of [theme.bgMain, theme.bgCard]) {
      expect(contrast(theme.borderMain, surface)).toBeGreaterThanOrEqual(3);
      expect(contrast(theme.accent, surface)).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(THEME_PRESETS)('$name filled actions keep readable fixed foregrounds', theme => {
    expect(contrast('#ffffff', theme.action)).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#ffffff', theme.actionHover)).toBeGreaterThanOrEqual(4.5);
  });

  it('fixed status-action colours keep readable foregrounds', () => {
    for (const background of ['#047857', '#065f46', '#0e7490', '#155e75', '#9a4d06', '#7c3d05']) {
      expect(contrast('#ffffff', background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
