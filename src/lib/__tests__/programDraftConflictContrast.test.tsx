// @vitest-environment happy-dom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProgramDraftConflictModal } from '../../components/ProgramDraftConflictModal';

const renderModal = (themeId: string) => render(
  <ProgramDraftConflictModal
    isOpen
    themeId={themeId}
    sourceProgramName="Program A"
    targetProgramName="Program B"
    onKeepWorkout={vi.fn()}
    onDiscardAndSave={vi.fn()}
  />
);

describe('ProgramDraftConflictModal contrast presentation', () => {
  afterEach(cleanup);

  it('uses dark semantic foregrounds on Crimson Desert light surfaces', () => {
    renderModal('amber');
    const heading = screen.getByRole('heading', { name: 'ACTIVE WORKOUT IN PROGRESS' });
    const body = screen.getByText(/unfinished workout for Program A/);
    const keep = screen.getByRole('button', { name: 'KEEP WORKOUT' });
    const discard = screen.getByRole('button', { name: 'DISCARD WORKOUT & SWITCH PROGRAM' });
    const close = screen.getByRole('button', { name: 'Close active workout warning' });
    expect(heading.className).toContain('text-slate-300');
    expect(heading.className).not.toContain('text-white');
    expect(body.className).toContain('text-slate-300');
    expect(body.className).not.toContain('text-slate-400');
    expect(keep.className).toContain('text-slate-300');
    expect(keep.className).toContain('border-slate-800');
    expect(discard.className).toContain('text-on-destructive');
    expect(discard.className).toContain('bg-rose-800');
    expect(close.className).toContain('text-slate-300');
    expect(close.className).toContain('focus-visible:ring-2');
  });

  it.each(['slate', 'onyx'])('retains light-on-dark semantic pairings and accessible controls for %s', themeId => {
    renderModal(themeId);
    expect(screen.getByRole('heading', { name: 'ACTIVE WORKOUT IN PROGRESS' }).className).toContain('text-slate-100');
    expect(screen.getByText(/unfinished workout for Program A/).className).toContain('text-slate-300');
    expect(screen.getByRole('button', { name: 'KEEP WORKOUT' }).className).toContain('bg-slate-900');
    expect(screen.getByRole('button', { name: 'DISCARD WORKOUT & SWITCH PROGRAM' }).className).toContain('text-on-destructive');
    expect(screen.getByRole('button', { name: 'Close active workout warning' })).toBeTruthy();
  });
});
