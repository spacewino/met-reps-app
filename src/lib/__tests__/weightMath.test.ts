import { describe, it, expect } from 'vitest';
import { roundToNearestIncrement, roundToNearest25 } from '../weightMath';

describe('weightMath', () => {
  describe('roundToNearest25', () => {
    it('rounds standard weights correctly', () => {
      expect(roundToNearest25(114.559)).toBe(115.0);
      expect(roundToNearest25(113.216)).toBe(112.5);
      expect(roundToNearest25(118.6103)).toBe(117.5);
      expect(roundToNearest25(116.7588)).toBe(117.5);
      expect(roundToNearest25(119.853)).toBe(120.0);
      expect(roundToNearest25(95.441)).toBe(95.0);
      expect(roundToNearest25(147.0588)).toBe(147.5);
    });

    it('handles exact multiples and edge cases', () => {
      expect(roundToNearest25(100.0)).toBe(100.0);
      expect(roundToNearest25(101.25)).toBe(102.5);
      expect(roundToNearest25(101.24)).toBe(100.0);
      expect(roundToNearest25(0)).toBe(0);
    });

    it('handles non-finite values safely', () => {
      expect(roundToNearest25(NaN)).toBeNaN();
      expect(roundToNearest25(Infinity)).toBe(Infinity);
      expect(roundToNearest25(-Infinity)).toBe(-Infinity);
    });
  });

  describe('roundToNearestIncrement', () => {
    it('rounds to custom increments', () => {
      expect(roundToNearestIncrement(102.3, 5)).toBe(100.0);
      expect(roundToNearestIncrement(103.0, 5)).toBe(105.0);
      expect(roundToNearestIncrement(100.4, 0.5)).toBe(100.5);
      expect(roundToNearestIncrement(100.2, 0.5)).toBe(100.0);
    });

    it('returns raw weight if increment is invalid', () => {
      expect(roundToNearestIncrement(102.3, 0)).toBe(102.3);
      expect(roundToNearestIncrement(102.3, -2.5)).toBe(102.3);
      expect(roundToNearestIncrement(102.3, NaN)).toBe(102.3);
    });
  });
});
