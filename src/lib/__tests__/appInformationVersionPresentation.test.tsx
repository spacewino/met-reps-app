/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, it, expect, beforeEach } from 'vitest';
import { InfoView } from '../../components/InfoView';
import { storage } from '../storage';

// In-memory localStorage mock for test runner
const memoryStore: Record<string, string> = {};
globalThis.localStorage = {
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

describe('MetReps — App Information Version Presentation Test', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders exact version 1.0.6.0 in the default (slate/Subnautic) theme', () => {
    storage.setTheme('slate');
    const html = renderToString(<InfoView onClose={() => {}} />);

    // Check for Ver: label and 1.0.6.0 value
    expect(html).toContain('Ver:');
    expect(html).toContain('1.0.6.0');
    expect(html).not.toContain('1.0.2');
    expect(html).toContain('Fil Filidei');
    expect(html).toContain('MetRepsApp@gmail.com');
  });

  it('renders exact version 1.0.6.0 in the onyx (Abyss) theme', () => {
    storage.setTheme('onyx');
    const html = renderToString(<InfoView onClose={() => {}} />);

    expect(html).toContain('Ver:');
    expect(html).toContain('1.0.6.0');
    expect(html).not.toContain('1.0.2');
  });

  it('renders exact version 1.0.6.0 in the amber (Desert) theme', () => {
    storage.setTheme('amber');
    const html = renderToString(<InfoView onClose={() => {}} />);

    expect(html).toContain('Ver:');
    expect(html).toContain('1.0.6.0');
    expect(html).not.toContain('1.0.2');
  });
});
