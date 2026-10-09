import { describe, expect, it } from 'vitest';
import { DomainError, payWindow } from '../src/index';

describe('pay schedule windows', () => {
  it('builds weekly windows from the configured start weekday', () => {
    // 2026-10-08 is a Thursday; weeks start on Monday (1).
    expect(payWindow({ kind: 'weekly', startWeekday: 1 }, '2026-10-08')).toEqual({ startsOn: '2026-10-05', endsOn: '2026-10-11' });
    expect(payWindow({ kind: 'weekly', startWeekday: 4 }, '2026-10-08')).toEqual({ startsOn: '2026-10-08', endsOn: '2026-10-14' });
  });

  it('builds biweekly and custom windows from an anchor date, including dates before the anchor', () => {
    expect(payWindow({ kind: 'biweekly', anchorDate: '2026-01-05' }, '2026-01-20')).toEqual({ startsOn: '2026-01-19', endsOn: '2026-02-01' });
    expect(payWindow({ kind: 'customDays', days: 10, anchorDate: '2026-01-01' }, '2025-12-25')).toEqual({ startsOn: '2025-12-22', endsOn: '2025-12-31' });
  });

  it('builds monthly windows from the configured start day across year boundaries', () => {
    expect(payWindow({ kind: 'monthly', startDayOfMonth: 1 }, '2026-02-14')).toEqual({ startsOn: '2026-02-01', endsOn: '2026-02-28' });
    expect(payWindow({ kind: 'monthly', startDayOfMonth: 15 }, '2026-01-10')).toEqual({ startsOn: '2025-12-15', endsOn: '2026-01-14' });
  });

  it('rejects invalid configuration and malformed dates', () => {
    expect(() => payWindow({ kind: 'monthly', startDayOfMonth: 31 }, '2026-01-10')).toThrow(DomainError);
    expect(() => payWindow({ kind: 'customDays', days: 0, anchorDate: '2026-01-01' }, '2026-01-10')).toThrow(DomainError);
    expect(() => payWindow({ kind: 'weekly', startWeekday: 1 }, '2026-02-30')).toThrow(/YYYY-MM-DD/);
  });
});
