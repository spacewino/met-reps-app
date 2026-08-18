/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { storage } from '../storage';

// In-memory localStorage mock for node test runner
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

describe('storage - Unit-Safe Bodyweight Management', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stores and retrieves bodyweight with unit metadata', () => {
    storage.setBodyweightWithUnit(82.5, 'kg');
    expect(storage.getBodyweight()).toBe(82.5);
    expect(storage.getBodyweightUnit()).toBe('kg');

    const bwWithUnit = storage.getBodyweightWithUnit();
    expect(bwWithUnit).toEqual({ value: 82.5, unit: 'kg' });
  });

  it('handles legacy bodyweight without unit metadata', () => {
    localStorage.setItem('userBodyweight', '75');
    // userBodyweightUnit is not set in localStorage
    expect(storage.getBodyweight()).toBe(75);
    expect(storage.getBodyweightUnit()).toBeNull();
    expect(storage.getBodyweightWithUnit()).toBeNull();
  });

  it('clears both value and unit when bodyweight is set to null', () => {
    storage.setBodyweightWithUnit(80, 'kg');
    storage.setBodyweight(null);

    expect(storage.getBodyweight()).toBeNull();
    expect(storage.getBodyweightUnit()).toBeNull();
    expect(storage.getBodyweightWithUnit()).toBeNull();
  });

  it('clears both value and unit when setBodyweightWithUnit is called with null or invalid values', () => {
    storage.setBodyweightWithUnit(80, 'kg');
    storage.setBodyweightWithUnit(null, null);

    expect(storage.getBodyweight()).toBeNull();
    expect(storage.getBodyweightUnit()).toBeNull();
    expect(storage.getBodyweightWithUnit()).toBeNull();
  });

  it('clears stored bodyweight and unit on non-positive or non-finite inputs', () => {
    storage.setBodyweightWithUnit(80, 'kg');

    // 0
    storage.setBodyweightWithUnit(0, 'kg');
    expect(storage.getBodyweight()).toBeNull();
    expect(storage.getBodyweightUnit()).toBeNull();

    // Negative
    storage.setBodyweightWithUnit(80, 'kg');
    storage.setBodyweightWithUnit(-75, 'kg');
    expect(storage.getBodyweight()).toBeNull();
    expect(storage.getBodyweightUnit()).toBeNull();

    // NaN
    storage.setBodyweightWithUnit(80, 'kg');
    storage.setBodyweightWithUnit(NaN, 'kg');
    expect(storage.getBodyweight()).toBeNull();
    expect(storage.getBodyweightUnit()).toBeNull();

    // Infinity
    storage.setBodyweightWithUnit(80, 'kg');
    storage.setBodyweightWithUnit(Infinity, 'kg');
    expect(storage.getBodyweight()).toBeNull();
    expect(storage.getBodyweightUnit()).toBeNull();

    // -Infinity
    storage.setBodyweightWithUnit(80, 'kg');
    storage.setBodyweightWithUnit(-Infinity, 'kg');
    expect(storage.getBodyweight()).toBeNull();
    expect(storage.getBodyweightUnit()).toBeNull();

    // Invalid unit
    storage.setBodyweightWithUnit(80, 'kg');
    storage.setBodyweightWithUnit(80, 'invalid' as any);
    expect(storage.getBodyweight()).toBeNull();
    expect(storage.getBodyweightUnit()).toBeNull();
  });

  it('clears stored bodyweight on setBodyweight(0) or negative/non-finite values', () => {
    storage.setBodyweightWithUnit(80, 'kg');
    storage.setBodyweight(0);
    expect(storage.getBodyweight()).toBeNull();
    expect(storage.getBodyweightUnit()).toBeNull();

    storage.setBodyweightWithUnit(80, 'kg');
    storage.setBodyweight(-10);
    expect(storage.getBodyweight()).toBeNull();
    expect(storage.getBodyweightUnit()).toBeNull();

    storage.setBodyweightWithUnit(80, 'kg');
    storage.setBodyweight(Infinity);
    expect(storage.getBodyweight()).toBeNull();
    expect(storage.getBodyweightUnit()).toBeNull();
  });
});
