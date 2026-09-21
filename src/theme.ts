/**
 * The application palette is semantic: Tailwind's slate/indigo aliases are
 * resolved through these values in index.css.  Keep foregrounds in this table
 * readable on both bgMain and bgCard; accent colours are also used for text and
 * control boundaries, while accentDark is used for filled controls.
 */
export const THEME_PRESETS = [
  {
    id: 'slate', name: 'Subnautic', bgMain: '#04060a', bgCard: '#11182c', borderMain: '#64748B',
    textPrimary: '#F9FAFB', textSecondary: '#94a3b8', textMuted: '#94a3b8',
    accent: '#6366f1', accentLight: '#818cf8', accentDark: '#4f46e5', accentCyan: '#22d3ee', success: '#34d399',
    action: '#4f46e5', actionHover: '#4338ca',
    selectedSurface: '#22274A',
    label: 'Blue Slate', swatch1: '#6366f1', swatch2: '#11182c',
  },
  {
    id: 'onyx', name: 'Feralas', bgMain: '#111827', bgCard: '#1F2937', borderMain: '#6B7280',
    textPrimary: '#F9FAFB', textSecondary: '#D1D5DB', textMuted: '#9CA3AF',
    accent: '#10B981', accentLight: '#34D399', accentDark: '#047857', accentCyan: '#FBBF24', success: '#34D399',
    action: '#047857', actionHover: '#065F46',
    selectedSurface: '#123D32',
    label: 'Forest Green', swatch1: '#10B981', swatch2: '#1F2937',
  },
  {
    id: 'amber', name: 'Crimson Desert', bgMain: '#F2F0EC', bgCard: '#FBFAF8', borderMain: '#8A837B',
    textPrimary: '#252320', textSecondary: '#6F6A63', textMuted: '#6F6A63',
    accent: '#9B5C34', accentLight: '#9B5C34', accentDark: '#7D4726', accentCyan: '#84570F', success: '#477041',
    action: '#7D4726', actionHover: '#69391D',
    selectedSurface: '#F7EADD',
    label: 'Desert Leather', swatch1: '#B56D3E', swatch2: '#FBFAF8',
  },
] as const;

export type ThemePreset = (typeof THEME_PRESETS)[number];
