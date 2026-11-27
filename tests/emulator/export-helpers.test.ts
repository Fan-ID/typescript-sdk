import { describe, expect, it } from 'vitest';
import {
  buildActiveCells,
  parseExportWindow,
  splitCents,
  splitInt,
} from '../../src/emulator/exports.js';

const today = new Date('2026-11-27T10:00:00Z');

describe('splitInt', () => {
  it('gives the remainder to the earliest cells', () => {
    expect(splitInt(10, 3)).toEqual([4, 3, 3]);
    expect(splitInt(2, 3)).toEqual([1, 1, 0]);
    expect(splitInt(0, 3)).toEqual([0, 0, 0]);
  });
});

describe('splitCents', () => {
  it('splits dollars on whole cents', () => {
    expect(splitCents(10.01, 3)).toEqual([3.34, 3.34, 3.33]);
  });
});

describe('parseExportWindow', () => {
  it('defaults to the last 90 days ending today', () => {
    expect(parseExportWindow(null, null, today)).toEqual({
      ok: true,
      value: { startDate: '2026-08-30', endDate: '2026-11-27' },
    });
  });

  it('fills the missing bound', () => {
    expect(parseExportWindow('2026-11-20', null, today)).toEqual({
      ok: true,
      value: { startDate: '2026-11-20', endDate: '2026-11-27' },
    });
    expect(parseExportWindow(null, '2026-11-10', today)).toEqual({
      ok: true,
      value: { startDate: '2026-08-13', endDate: '2026-11-10' },
    });
  });

  it('accepts a 90-day span and rejects 91', () => {
    expect(parseExportWindow('2026-08-30', '2026-11-27', today).ok).toBe(true);
    expect(parseExportWindow('2026-08-29', '2026-11-27', today)).toMatchObject({
      ok: false,
      code: 'invalid_query_parameter',
    });
  });

  it('rejects a reversed range', () => {
    expect(parseExportWindow('2026-11-27', '2026-11-20', today)).toMatchObject({
      ok: false,
      code: 'invalid_date_range',
    });
  });

  it('rejects unparseable dates', () => {
    for (const bad of ['2026-02-30', 'nope']) {
      expect(parseExportWindow(bad, null, today)).toMatchObject({
        ok: false,
        code: 'invalid_query_parameter',
      });
    }
  });

  it('allows a future endDate', () => {
    expect(parseExportWindow(null, '2026-12-31', today)).toMatchObject({ ok: true });
  });
});

describe('buildActiveCells', () => {
  it('returns one cell per day and country, oldest day first', () => {
    const cells = buildActiveCells({ status: 'active', cycleDay: 2 }, today);
    expect(cells).toEqual([
      { reportDate: '2026-11-26', countryCode: 'DE' },
      { reportDate: '2026-11-26', countryCode: 'GB' },
      { reportDate: '2026-11-26', countryCode: 'US' },
      { reportDate: '2026-11-27', countryCode: 'DE' },
      { reportDate: '2026-11-27', countryCode: 'GB' },
      { reportDate: '2026-11-27', countryCode: 'US' },
    ]);
  });

  it('has no cells while creating', () => {
    expect(buildActiveCells({ status: 'creating', cycleDay: 3 }, today)).toEqual([]);
  });
});
