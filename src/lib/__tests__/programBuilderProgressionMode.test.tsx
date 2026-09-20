// @vitest-environment happy-dom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Program } from '../../types';
import { ProgramBuilder } from '../../components/ProgramBuilder';
import { storage } from '../storage';
import * as integrationModule from '../guidedWorkoutIntegration';
import * as targetSelectorModule from '../guidedTargetSelector';
import * as adapterModule from '../guidedRuntimeAdapter';

const memoryStore: Record<string, string> = {};
const mockStorage: Storage = {
  getItem: (key: string) => memoryStore[key] ?? null,
  setItem: (key: string, value: string) => {
    memoryStore[key] = String(value);
  },
  removeItem: (key: string) => {
    delete memoryStore[key];
  },
  clear: () => {
    Object.keys(memoryStore).forEach(k => delete memoryStore[k]);
  },
  key: (index: number) => Object.keys(memoryStore)[index] ?? null,
  length: 0,
};

Object.defineProperty(globalThis, 'localStorage', {
  value: mockStorage,
  writable: true,
});

if (typeof window !== 'undefined') {
  window.scrollTo = () => {};
  window.confirm = () => true;
  window.alert = () => {};
}

function makeTestProgram(overrides?: Partial<Program>): Program {
  return {
    id: 'test-program-1',
    name: 'Test Target Program',
    daysPerWeek: 3,
    programDuration: 8,
    createdAt: '2026-08-24T00:00:00.000Z',
    objective: 'Hypertrophy',
    algorithmId: 'hypertrophy_linear',
    exercisesByDay: {
      1: [
        {
          name: 'Barbell Bench Press',
          muscleGroup: 'Chest',
          modality: 'weighted',
          isMainMovement: true,
          sets: [{ setNumber: 1, weight: 100, reps: 10, rpe: 8.0, isCompleted: false }],
        },
      ],
      2: [
        {
          name: 'Barbell Squat',
          muscleGroup: 'Legs',
          modality: 'weighted',
          isMainMovement: true,
          sets: [{ setNumber: 1, weight: 140, reps: 8, rpe: 8.0, isCompleted: false }],
        },
      ],
      3: [
        {
          name: 'Barbell Deadlift',
          muscleGroup: 'Back',
          modality: 'weighted',
          isMainMovement: true,
          sets: [{ setNumber: 1, weight: 180, reps: 5, rpe: 8.0, isCompleted: false }],
        },
      ],
    },
    ...overrides,
  };
}

const saveForLater = () => {
  fireEvent.click(screen.getByRole('button', { name: /^save program$/i }));
  fireEvent.click(screen.getByRole('button', { name: /save for later/i }));
};

const saveActiveChanges = () => {
  fireEvent.click(screen.getByRole('button', { name: /^save program$/i }));
  fireEvent.click(screen.getByRole('button', { name: /^save changes$/i }));
};

describe('METREPS — D2C-4B Program Builder Progression Mode Integration Tests', () => {
  beforeEach(() => {
    mockStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('1. new program displays Periodisation Targets by default', () => {
    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);

    const radiogroup = screen.getByRole('radiogroup', { name: /workout target mode/i });
    const standardRadio = within(radiogroup).getByRole('radio', { name: /periodisation targets/i });
    const coachRadio = within(radiogroup).getByRole('radio', { name: /metreps coach/i });

    expect(standardRadio.getAttribute('aria-checked')).toBe('true');
    expect(coachRadio.getAttribute('aria-checked')).toBe('false');
  });

  it('2. saving a new program explicitly persists targetProgressionMode: performance_led', () => {
    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);

    const templateButton = screen.getByRole('button', { name: /Milhouse Mass Split/i });
    fireEvent.click(templateButton);

    const nameInput = screen.getByDisplayValue(/Milhouse Mass Split/i);
    fireEvent.change(nameInput, { target: { value: 'My New Program' } });

    saveForLater();

    const programs = storage.getPrograms();
    const saved = programs.find(p => p.name === 'My New Program');
    expect(saved).toBeDefined();
    expect(saved?.targetProgressionMode).toBe('performance_led');
  });

  it('3. selecting MetReps Coach marks it selected and saving persists metreps_guided', () => {
    const prog = makeTestProgram();
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);

    const radiogroup = screen.getByRole('radiogroup', { name: /workout target mode/i });
    const coachRadio = within(radiogroup).getByRole('radio', { name: /metreps coach/i });
    const standardRadio = within(radiogroup).getByRole('radio', { name: /periodisation targets/i });

    fireEvent.click(coachRadio);

    expect(coachRadio.getAttribute('aria-checked')).toBe('true');
    expect(standardRadio.getAttribute('aria-checked')).toBe('false');

    saveActiveChanges();

    const saved = storage.getPrograms().find(p => p.id === prog.id);
    expect(saved?.targetProgressionMode).toBe('metreps_guided');
  });

  it('4. reopening a coached program displays Coach selected without creating dirty state or writing storage', () => {
    const prog = makeTestProgram({ name: 'Coached to Periodisation Program', targetProgressionMode: 'metreps_guided' });
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    const saveSpy = vi.spyOn(storage, 'saveProgram');
    let dirtyReported = false;

    render(
      <ProgramBuilder
        onClose={() => {}}
        onSave={() => {}}
        onDirtyChange={(isDirty) => {
          if (isDirty) {
            dirtyReported = true;
          }
        }}
      />
    );

    const radiogroup = screen.getByRole('radiogroup', { name: /workout target mode/i });
    const coachRadio = within(radiogroup).getByRole('radio', { name: /metreps coach/i });
    const standardRadio = within(radiogroup).getByRole('radio', { name: /periodisation targets/i });

    expect(coachRadio.getAttribute('aria-checked')).toBe('true');
    expect(standardRadio.getAttribute('aria-checked')).toBe('false');
    expect(saveSpy).not.toHaveBeenCalled();
    expect(dirtyReported).toBe(false);
  });

  it('5. legacy missing-field program resolves to Periodisation Targets', () => {
    const legacyProg = makeTestProgram();
    delete legacyProg.targetProgressionMode;
    storage.saveProgram(legacyProg);
    storage.setCurrentProgramId(legacyProg.id);

    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);

    const radiogroup = screen.getByRole('radiogroup', { name: /workout target mode/i });
    const standardRadio = within(radiogroup).getByRole('radio', { name: /periodisation targets/i });
    const coachRadio = within(radiogroup).getByRole('radio', { name: /metreps coach/i });

    expect(standardRadio.getAttribute('aria-checked')).toBe('true');
    expect(coachRadio.getAttribute('aria-checked')).toBe('false');
  });

  it('6. malformed persisted value resolves to Periodisation Targets without a TypeScript cast', () => {
    const malformedProg = makeTestProgram({ id: 'malformed-prog' });
    Reflect.set(malformedProg, 'targetProgressionMode', 'invalid_unrecognized_mode');
    storage.saveProgram(malformedProg);
    storage.setCurrentProgramId(malformedProg.id);

    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);

    const radiogroup = screen.getByRole('radiogroup', { name: /workout target mode/i });
    const standardRadio = within(radiogroup).getByRole('radio', { name: /periodisation targets/i });
    const coachRadio = within(radiogroup).getByRole('radio', { name: /metreps coach/i });

    expect(standardRadio.getAttribute('aria-checked')).toBe('true');
    expect(coachRadio.getAttribute('aria-checked')).toBe('false');
  });

  it('7. selecting Periodisation Targets on a coached program and saving persists performance_led', () => {
    const prog = makeTestProgram({ name: 'Coached to Periodisation Save', targetProgressionMode: 'metreps_guided' });
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);

    const radiogroup = screen.getByRole('radiogroup', { name: /workout target mode/i });
    const standardRadio = within(radiogroup).getByRole('radio', { name: /periodisation targets/i });
    fireEvent.click(standardRadio);

    saveActiveChanges();

    const saved = storage.getPrograms().find(p => p.id === prog.id);
    expect(saved?.targetProgressionMode).toBe('performance_led');
  });

  it('8. switching a coached Hypertrophy/Strength form to Off immediately selects Periodisation Targets, disables Coach, and shows the explanatory note', () => {
    const prog = makeTestProgram({ objective: 'Hypertrophy', targetProgressionMode: 'metreps_guided' });
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);

    const radiogroup = screen.getByRole('radiogroup', { name: /workout target mode/i });
    const coachRadio = within(radiogroup).getByRole('radio', { name: /metreps coach/i });
    expect(coachRadio.getAttribute('aria-checked')).toBe('true');

    const offButton = screen.getByRole('button', { name: /^off/i });
    fireEvent.click(offButton);

    const standardRadio = within(radiogroup).getByRole('radio', { name: /periodisation targets/i });
    expect(standardRadio.getAttribute('aria-checked')).toBe('true');
    expect(coachRadio.getAttribute('aria-checked')).toBe('false');
    expect(coachRadio.hasAttribute('disabled')).toBe(true);
    expect(coachRadio.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('MetReps Coach is available for Hypertrophy and Strength programs.')).toBeDefined();
  });

  it('9. an Off program can never save metreps_guided', () => {
    const prog = makeTestProgram({ name: 'Off Mode Save Program', objective: 'Off', algorithmId: 'none' });
    Reflect.set(prog, 'targetProgressionMode', 'metreps_guided');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);

    saveActiveChanges();

    const saved = storage.getPrograms().find(p => p.id === prog.id);
    expect(saved?.targetProgressionMode).toBe('performance_led');
  });

  it('10. switching from Off back to Hypertrophy or Strength does not automatically re-enable Coach', () => {
    const prog = makeTestProgram({ objective: 'Hypertrophy', targetProgressionMode: 'metreps_guided' });
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);

    const offButton = screen.getByRole('button', { name: /^off/i });
    fireEvent.click(offButton);

    const strengthButton = screen.getByRole('button', { name: /^strength/i });
    fireEvent.click(strengthButton);

    const radiogroup = screen.getByRole('radiogroup', { name: /workout target mode/i });
    const coachRadio = within(radiogroup).getByRole('radio', { name: /metreps coach/i });
    const standardRadio = within(radiogroup).getByRole('radio', { name: /periodisation targets/i });

    expect(coachRadio.hasAttribute('disabled')).toBe(false);
    expect(coachRadio.getAttribute('aria-disabled')).toBe('false');
    expect(standardRadio.getAttribute('aria-checked')).toBe('true');
    expect(coachRadio.getAttribute('aria-checked')).toBe('false');
  });

  it('11. canceling/closing without saving performs no program persistence', () => {
    const prog = makeTestProgram({ targetProgressionMode: 'performance_led' });
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    const saveSpy = vi.spyOn(storage, 'saveProgram');
    const onClose = vi.fn();

    render(<ProgramBuilder onClose={onClose} onSave={() => {}} />);

    const radiogroup = screen.getByRole('radiogroup', { name: /workout target mode/i });
    const coachRadio = within(radiogroup).getByRole('radio', { name: /metreps coach/i });
    fireEvent.click(coachRadio);
    expect(coachRadio.getAttribute('aria-checked')).toBe('true');

    const backButton = screen.getAllByRole('button')[0];
    fireEvent.click(backButton);

    fireEvent.click(screen.getByRole('button', { name: /discard changes/i }));

    expect(onClose).toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();

    const stored = storage.getPrograms().find(p => p.id === prog.id);
    expect(stored?.targetProgressionMode).toBe('performance_led');
  });

  it('12. renaming preserves the same program identity and metreps_guided metadata', () => {
    const prog = makeTestProgram({ id: 'original-prog-1', name: 'Original Program', targetProgressionMode: 'metreps_guided' });
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);

    const nameInput = screen.getByDisplayValue('Original Program');
    fireEvent.change(nameInput, { target: { value: 'Copied Program' } });

    saveActiveChanges();

    const allPrograms = storage.getPrograms();
    const copiedProgram = allPrograms.find(p => p.name === 'Copied Program');
    expect(copiedProgram).toBeDefined();
    expect(copiedProgram?.id).toBe('original-prog-1');
    expect(copiedProgram?.targetProgressionMode).toBe('metreps_guided');

    expect(allPrograms.filter(p => p.id === 'original-prog-1')).toHaveLength(1);
    expect(storage.getCurrentProgramId()).toBe('original-prog-1');
  });

  it('13. prebuilt template without the field resolves to Periodisation Targets', () => {
    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);

    const templateButton = screen.getByRole('button', { name: /Milhouse Mass Split/i });
    fireEvent.click(templateButton);

    const radiogroup = screen.getByRole('radiogroup', { name: /workout target mode/i });
    const standardRadio = within(radiogroup).getByRole('radio', { name: /periodisation targets/i });
    const coachRadio = within(radiogroup).getByRole('radio', { name: /metreps coach/i });

    expect(standardRadio.getAttribute('aria-checked')).toBe('true');
    expect(coachRadio.getAttribute('aria-checked')).toBe('false');
  });

  it('14. radiogroup, radio roles, aria-checked, accessible names, disabled state, and keyboard-operable buttons are present', () => {
    const prog = makeTestProgram({ objective: 'Hypertrophy', targetProgressionMode: 'performance_led' });
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);

    const radiogroup = screen.getByRole('radiogroup', { name: /workout target mode/i });
    expect(radiogroup).toBeDefined();

    const standardRadio = within(radiogroup).getByRole('radio', { name: /periodisation targets/i });
    const coachRadio = within(radiogroup).getByRole('radio', { name: /metreps coach/i });

    expect(standardRadio.tagName.toLowerCase()).toBe('button');
    expect(standardRadio.getAttribute('type')).toBe('button');
    expect(coachRadio.tagName.toLowerCase()).toBe('button');
    expect(coachRadio.getAttribute('type')).toBe('button');

    expect(standardRadio.getAttribute('aria-checked')).toBe('true');
    expect(coachRadio.getAttribute('aria-checked')).toBe('false');

    fireEvent.keyDown(coachRadio, { key: 'Enter', code: 'Enter' });
    fireEvent.click(coachRadio);
    expect(coachRadio.getAttribute('aria-checked')).toBe('true');

    const offButton = screen.getByRole('button', { name: /^off/i });
    fireEvent.click(offButton);
    expect(coachRadio.hasAttribute('disabled')).toBe(true);
    expect(coachRadio.getAttribute('aria-disabled')).toBe('true');
  });

  it('15. selecting either option calls zero Guided runtime functions and performs zero workout-target calculations', () => {
    const orchestrateSpy = vi.spyOn(integrationModule, 'orchestrateGuidedWorkoutExercises');
    const selectorSpy = vi.spyOn(targetSelectorModule, 'selectGuidedPrescription');
    const adapterSpy = vi.spyOn(adapterModule, 'adaptGuidedExercisePrescription');

    const prog = makeTestProgram({ objective: 'Hypertrophy' });
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);

    const radiogroup = screen.getByRole('radiogroup', { name: /workout target mode/i });
    const coachRadio = within(radiogroup).getByRole('radio', { name: /metreps coach/i });
    const standardRadio = within(radiogroup).getByRole('radio', { name: /periodisation targets/i });

    fireEvent.click(coachRadio);
    fireEvent.click(standardRadio);

    expect(orchestrateSpy).not.toHaveBeenCalled();
    expect(selectorSpy).not.toHaveBeenCalled();
    expect(adapterSpy).not.toHaveBeenCalled();
  });

  it('16. activating Periodisation Targets info control opens accessible dialog with exact copy and dismisses via Escape', () => {
    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);

    const infoButton = screen.getByRole('button', { name: /about periodisation targets/i });
    fireEvent.click(infoButton);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeDefined();
    expect(dialog.getAttribute('aria-modal')).toBe('true');

    expect(within(dialog).getByText('Periodisation Targets')).toBeDefined();
    expect(within(dialog).getByText(/MetReps uses your recorded performance as the baseline/i)).toBeDefined();

    // Escape closes the dialog
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('17. activating MetReps Coach info control opens accessible dialog with exact copy and dismisses via Close button', () => {
    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);

    const infoButton = screen.getByRole('button', { name: /about metreps coach/i });
    fireEvent.click(infoButton);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeDefined();
    expect(dialog.getAttribute('aria-modal')).toBe('true');

    expect(within(dialog).getByText('MetReps Coach')).toBeDefined();
    expect(within(dialog).getByText(/MetReps Coach starts with the same periodisation-based targets/i)).toBeDefined();

    // Dismiss via close button
    const closeButtons = within(dialog).getAllByRole('button', { name: /close/i });
    fireEvent.click(closeButtons[0]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('18. opening and closing info dialogs does not dirty form or trigger save', () => {
    let dirtyReported = false;
    const saveSpy = vi.spyOn(storage, 'saveProgram');

    render(
      <ProgramBuilder
        onClose={() => {}}
        onSave={() => {}}
        onDirtyChange={(isDirty) => {
          if (isDirty) {
            dirtyReported = true;
          }
        }}
      />
    );

    const infoButton = screen.getByRole('button', { name: /about wave volume/i });
    fireEvent.click(infoButton);

    expect(screen.getByRole('dialog')).toBeDefined();
    expect(within(screen.getByRole('dialog')).getByText('Wave Volume')).toBeDefined();

    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    expect(dirtyReported).toBe(false);
    expect(saveSpy).not.toHaveBeenCalled();
  });
});
