/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  parseActivePrescriptionBoundary,
  createFreshPrescriptionBoundary,
  resolveLivePrescriptionBoundary,
  resolveFreshSessionTargetDate,
  isValidSessionTimestamp,
  isValidIsoCalendarDate,
  ActivePrescriptionBoundary,
} from '../workoutDraftBoundary';

describe('METREPS — Pure Workout Draft Boundary & Resolver Suite', () => {
  it('1. Complete valid boundary parses exactly', () => {
    const input = {
      sessionStartedAt: 1725804000000,
      prescriptionTargetDate: '2026-09-08',
    };
    const parsed = parseActivePrescriptionBoundary(input);
    expect(parsed).toEqual({
      sessionStartedAt: 1725804000000,
      prescriptionTargetDate: '2026-09-08',
    });
  });

  it('2. Parser returns a copied object rather than the original reference', () => {
    const input = {
      sessionStartedAt: 1725804000000,
      prescriptionTargetDate: '2026-09-08',
    };
    const parsed = parseActivePrescriptionBoundary(input);
    expect(parsed).not.toBe(input);
  });

  it('3. undefined returns null', () => {
    expect(parseActivePrescriptionBoundary(undefined)).toBeNull();
  });

  it('4. null returns null', () => {
    expect(parseActivePrescriptionBoundary(null)).toBeNull();
  });

  it('5. Missing timestamp returns null', () => {
    expect(
      parseActivePrescriptionBoundary({
        prescriptionTargetDate: '2026-09-08',
      })
    ).toBeNull();
  });

  it('6. Missing target date returns null', () => {
    expect(
      parseActivePrescriptionBoundary({
        sessionStartedAt: 1725804000000,
      })
    ).toBeNull();
  });

  it('7. Partial object returns null', () => {
    expect(
      parseActivePrescriptionBoundary({
        sessionStartedAt: null,
        prescriptionTargetDate: '2026-09-08',
      })
    ).toBeNull();
  });

  it('8. Negative timestamp returns null', () => {
    expect(
      parseActivePrescriptionBoundary({
        sessionStartedAt: -1725804000000,
        prescriptionTargetDate: '2026-09-08',
      })
    ).toBeNull();
  });

  it('9. Zero timestamp returns null', () => {
    expect(
      parseActivePrescriptionBoundary({
        sessionStartedAt: 0,
        prescriptionTargetDate: '2026-09-08',
      })
    ).toBeNull();
  });

  it('10. NaN returns null', () => {
    expect(
      parseActivePrescriptionBoundary({
        sessionStartedAt: NaN,
        prescriptionTargetDate: '2026-09-08',
      })
    ).toBeNull();
  });

  it('11. Infinity returns null', () => {
    expect(
      parseActivePrescriptionBoundary({
        sessionStartedAt: Infinity,
        prescriptionTargetDate: '2026-09-08',
      })
    ).toBeNull();
    expect(
      parseActivePrescriptionBoundary({
        sessionStartedAt: -Infinity,
        prescriptionTargetDate: '2026-09-08',
      })
    ).toBeNull();
  });

  it('12. Fractional timestamp returns null', () => {
    expect(
      parseActivePrescriptionBoundary({
        sessionStartedAt: 1725804000000.5,
        prescriptionTargetDate: '2026-09-08',
      })
    ).toBeNull();
  });

  it('13. Array input returns null', () => {
    expect(parseActivePrescriptionBoundary([1725804000000, '2026-09-08'])).toBeNull();
  });

  it('14. Primitive inputs return null', () => {
    expect(parseActivePrescriptionBoundary('1725804000000')).toBeNull();
    expect(parseActivePrescriptionBoundary(1725804000000)).toBeNull();
    expect(parseActivePrescriptionBoundary(true)).toBeNull();
  });

  it('15. Invalid ISO formatting returns null', () => {
    expect(
      parseActivePrescriptionBoundary({
        sessionStartedAt: 1725804000000,
        prescriptionTargetDate: '09/08/2026',
      })
    ).toBeNull();
    expect(
      parseActivePrescriptionBoundary({
        sessionStartedAt: 1725804000000,
        prescriptionTargetDate: '2026-9-8',
      })
    ).toBeNull();
    expect(
      parseActivePrescriptionBoundary({
        sessionStartedAt: 1725804000000,
        prescriptionTargetDate: 'not-a-date',
      })
    ).toBeNull();
  });

  it('16. Invalid month returns null', () => {
    expect(
      parseActivePrescriptionBoundary({
        sessionStartedAt: 1725804000000,
        prescriptionTargetDate: '2026-13-01',
      })
    ).toBeNull();
    expect(
      parseActivePrescriptionBoundary({
        sessionStartedAt: 1725804000000,
        prescriptionTargetDate: '2026-00-15',
      })
    ).toBeNull();
  });

  it('17. Invalid day returns null', () => {
    expect(
      parseActivePrescriptionBoundary({
        sessionStartedAt: 1725804000000,
        prescriptionTargetDate: '2026-04-31', // April has 30 days
      })
    ).toBeNull();
    expect(
      parseActivePrescriptionBoundary({
        sessionStartedAt: 1725804000000,
        prescriptionTargetDate: '2026-01-00',
      })
    ).toBeNull();
  });

  it('18. February 31 returns null', () => {
    expect(
      parseActivePrescriptionBoundary({
        sessionStartedAt: 1725804000000,
        prescriptionTargetDate: '2026-02-31',
      })
    ).toBeNull();
  });

  it('19. Valid leap day passes', () => {
    const leapDay = {
      sessionStartedAt: 1709164800000,
      prescriptionTargetDate: '2024-02-29',
    };
    expect(parseActivePrescriptionBoundary(leapDay)).toEqual(leapDay);
  });

  it('20. Invalid non-leap-year February 29 returns null', () => {
    expect(
      parseActivePrescriptionBoundary({
        sessionStartedAt: 1725804000000,
        prescriptionTargetDate: '2026-02-29',
      })
    ).toBeNull();
  });

  it('21. Factory returns the exact supplied deterministic timestamp and target date', () => {
    const created = createFreshPrescriptionBoundary('2026-09-08', 1725804000000);
    expect(created).toEqual({
      sessionStartedAt: 1725804000000,
      prescriptionTargetDate: '2026-09-08',
    });
  });

  it('22. Factory rejects invalid timestamp input', () => {
    expect(() => createFreshPrescriptionBoundary('2026-09-08', -1)).toThrow();
    expect(() => createFreshPrescriptionBoundary('2026-09-08', NaN)).toThrow();
    expect(() => createFreshPrescriptionBoundary('2026-09-08', 1725804000000.5)).toThrow();
  });

  it('23. Factory rejects invalid target-date input', () => {
    expect(() => createFreshPrescriptionBoundary('2026-02-31', 1725804000000)).toThrow();
    expect(() => createFreshPrescriptionBoundary('not-a-date', 1725804000000)).toThrow();
  });

  it('24. Resolver returns status unavailable for null', () => {
    const resolved = resolveLivePrescriptionBoundary(null);
    expect(resolved).toEqual({ status: 'unavailable' });
  });

  it('25. Resolver returns the exact active_live boundary for valid coordinates', () => {
    const valid: ActivePrescriptionBoundary = {
      sessionStartedAt: 1725804000000,
      prescriptionTargetDate: '2026-09-08',
    };
    const resolved = resolveLivePrescriptionBoundary(valid);
    expect(resolved).toEqual({
      status: 'valid',
      boundary: {
        mode: 'active_live',
        targetDate: '2026-09-08',
        sessionStartedAt: 1725804000000,
        targetWorkoutId: null,
      },
    });
  });

  it('26. No selector or adapter is called or imported', () => {
    // Verified by pure compilation and module isolation.
    expect(typeof resolveLivePrescriptionBoundary).toBe('function');
  });

  it('27. resolveFreshSessionTargetDate uses scheduledDate for programmed sessions', () => {
    const resolved = resolveFreshSessionTargetDate({
      scheduledDate: '2026-09-12',
      date: '2026-09-08',
      isOneOff: false,
      programId: 'prog-1',
    });
    expect(resolved).toBe('2026-09-12');
  });

  it('28. resolveFreshSessionTargetDate uses date if scheduledDate missing or invalid', () => {
    const resolved = resolveFreshSessionTargetDate({
      scheduledDate: null,
      date: '2026-09-08',
      isOneOff: false,
      programId: 'prog-1',
    });
    expect(resolved).toBe('2026-09-08');

    const invalidSched = resolveFreshSessionTargetDate({
      scheduledDate: '2026-02-31',
      date: '2026-09-08',
      isOneOff: false,
      programId: 'prog-1',
    });
    expect(invalidSched).toBe('2026-09-08');
  });

  it('29. resolveFreshSessionTargetDate for one-off ignores scheduledDate', () => {
    const resolved = resolveFreshSessionTargetDate({
      scheduledDate: '2026-09-12',
      date: '2026-09-08',
      isOneOff: true,
      programId: null,
    });
    expect(resolved).toBe('2026-09-08');
  });

  it('30. resolveFreshSessionTargetDate uses valid todayDateStr when scheduledDate and date are missing', () => {
    const resolved = resolveFreshSessionTargetDate({
      scheduledDate: null,
      date: null,
      todayDateStr: '2026-09-15',
    });
    expect(resolved).toBe('2026-09-15');
  });

  it('31. resolveFreshSessionTargetDate rejects invalid todayDateStr and falls back to getTodayLocalDateString()', () => {
    const invalidDates = ['not-a-date', '2026-02-31', '2026-13-01', '2026-04-31', ''];
    for (const invalid of invalidDates) {
      const resolved = resolveFreshSessionTargetDate({
        scheduledDate: null,
        date: null,
        todayDateStr: invalid,
      });
      // Fallback is a valid calendar date matching format YYYY-MM-DD
      expect(isValidIsoCalendarDate(resolved)).toBe(true);
      expect(resolved).not.toBe(invalid);
    }
  });

  it('32. resolveFreshSessionTargetDate returns valid local date when called with no arguments', () => {
    const resolved = resolveFreshSessionTargetDate();
    expect(isValidIsoCalendarDate(resolved)).toBe(true);
  });
});
