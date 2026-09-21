// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProgramBuilder } from '../../components/ProgramBuilder';
import { WorkoutConflictModal } from '../../components/WorkoutConflictModal';
import { THEME_PRESETS } from '../../theme';
import type { Program } from '../../types';
import { storage } from '../storage';

const luminance = (hex: string) => {
  const channels = [1, 3, 5].map(offset => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};
const contrast = (a: string, b: string) => {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
};
const optionCard = (control: HTMLElement) => control.closest('.border');
const selectedCard = (control: HTMLElement) => control.closest('.bg-selected-surface');

const program: Program = {
  id: 'manual-preview-program',
  name: 'Manual Preview Program',
  createdAt: '2026-09-21T00:00:00.000Z',
  daysPerWeek: 1,
  programDuration: 8,
  objective: 'Hypertrophy',
  algorithmId: 'hypertrophy_linear',
  targetProgressionMode: 'performance_led',
  exercisesByDay: { 1: [{ name: 'Squat', muscleGroup: 'Legs', sets: [{ setNumber: 1 }] }] },
};

describe('manual preview theme corrections', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it.each(THEME_PRESETS)('$name gives the Workout In Progress heading an AA primary foreground', theme => {
    render(
      <WorkoutConflictModal
        isOpen
        themeId={theme.id}
        activeIdentity={{ kind: 'one_off', workoutId: 'draft' }}
        onClose={() => {}}
        onResumeActive={() => {}}
      />,
    );

    const heading = screen.getByRole('heading', { name: /workout in progress/i });
    const headerSurface = theme.id === 'amber' ? '#F2EAE1' : theme.bgMain;
    expect(heading.className).toContain('text-slate-100');
    expect(contrast(theme.textPrimary, headerSurface)).toBeGreaterThanOrEqual(4.5);
  });

  it('fills only the selected periodisation and target cards, keeps radio semantics, removes ticks, and persists both choices', () => {
    storage.saveProgram(program);
    storage.setCurrentProgramId(program.id);
    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);

    const methodGroup = screen.getByRole('radiogroup', { name: 'Periodisation Method' });
    const wave = within(methodGroup).getByRole('radio', { name: /Wave Volume/i });
    const step = within(methodGroup).getByRole('radio', { name: /Step Loading/i });
    expect(wave.getAttribute('aria-checked')).toBe('true');
    expect(step.getAttribute('aria-checked')).toBe('false');
    expect(selectedCard(wave)).not.toBeNull();
    expect(selectedCard(step)).toBeNull();
    expect(optionCard(step)?.className).toContain('bg-slate-950');
    expect(methodGroup.querySelector('.lucide-check')).toBeNull();

    fireEvent.click(step);
    expect(wave.getAttribute('aria-checked')).toBe('false');
    expect(step.getAttribute('aria-checked')).toBe('true');
    expect(selectedCard(wave)).toBeNull();
    expect(selectedCard(step)).not.toBeNull();

    const targetGroup = screen.getByRole('radiogroup', { name: 'Workout Target Mode' });
    const targets = within(targetGroup).getByRole('radio', { name: /Periodisation Targets/i });
    const coach = within(targetGroup).getByRole('radio', { name: /MetReps Coach/i });
    expect(selectedCard(targets)).not.toBeNull();
    expect(selectedCard(coach)).toBeNull();
    expect(optionCard(coach)?.className).toContain('bg-slate-950');
    expect(targetGroup.querySelector('.lucide-check')).toBeNull();

    fireEvent.click(coach);
    expect(targets.getAttribute('aria-checked')).toBe('false');
    expect(coach.getAttribute('aria-checked')).toBe('true');
    expect(selectedCard(targets)).toBeNull();
    expect(selectedCard(coach)).not.toBeNull();
    expect(targetGroup.querySelector('.lucide-check')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^save program$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^save changes$/i }));
    const saved = storage.getPrograms().find(item => item.id === program.id);
    expect(saved?.algorithmId).toBe('hypertrophy_step');
    expect(saved?.targetProgressionMode).toBe('metreps_guided');
  });
});
