import {
  serialToIsoDate, isoDateToSerial, textToIsoDate, todayIsoDate,
} from '../../src/server/utils/sheetDates.js';
import { formatOrderDate } from '../../src/client/src/lib/orderHistory.js';

describe('sheet date serials', () => {
  it('match the dates the Orders tab shows', () => {
    // Read off the live sheet: 46266 displays as 9/1/2026.
    expect(serialToIsoDate(46266)).toBe('2026-09-01');
    expect(serialToIsoDate(46324)).toBe('2026-10-29');
    expect(isoDateToSerial('2026-10-29')).toBe(46324);
  });

  it('round-trip', () => {
    for (const iso of ['2000-01-01', '2026-02-28', '2028-02-29', '2026-12-31']) {
      expect(serialToIsoDate(isoDateToSerial(iso))).toBe(iso);
    }
  });

  it('reject non-dates', () => {
    expect(serialToIsoDate(null)).toBeNull();
    expect(serialToIsoDate(-1)).toBeNull();
  });

  it('parse a hand-typed m/d/yyyy', () => {
    expect(textToIsoDate('10/29/2026')).toBe('2026-10-29');
    expect(textToIsoDate('1/5/2027')).toBe('2027-01-05');
    expect(textToIsoDate('13/1/2026')).toBeNull();
    expect(textToIsoDate('Robot radio')).toBeNull();
  });

  it('take today in the given zone', () => {
    // 03:00 UTC on Nov 5 is still Nov 4 in Chicago.
    const now = new Date('2026-11-05T03:00:00Z');
    expect(todayIsoDate('America/Chicago', now)).toBe('2026-11-04');
    expect(todayIsoDate('UTC', now)).toBe('2026-11-05');
    expect(todayIsoDate('Not/AZone', now)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('format for display without shifting the day', () => {
    expect(formatOrderDate('2026-10-29')).toBe('Thu, Oct 29, 2026');
    expect(formatOrderDate(null)).toBe('');
  });
});
