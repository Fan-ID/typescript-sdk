import type { BreakdownRow, CampaignStatus } from '../types/api.js';
import type { EmulatorCampaignRecord, EmulatorStore } from './store.js';

/** Sorted, because the exports sort rows by `country_code`. */
export const EXPORT_COUNTRIES = ['DE', 'GB', 'US'] as const;

/** Widest span, in days, the exports accept. */
export const EXPORT_MAX_RANGE_DAYS = 90;

const DAY_MS = 86_400_000;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Splits `total` into `parts` whole numbers that sum to it. The earliest parts get the remainder. */
export function splitInt(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const remainder = total - base * parts;
  return Array.from(
    { length: parts },
    (_, index) => base + (index < remainder ? 1 : 0),
  );
}

/** Splits a dollar amount on whole cents. */
export function splitCents(totalUsd: number, parts: number): number[] {
  return splitInt(Math.round(totalUsd * 100), parts).map((cents) => cents / 100);
}

export interface ExportWindow {
  startDate: string;
  endDate: string;
}

export type WindowResult =
  | { ok: true; value: ExportWindow }
  | {
      ok: false;
      code: 'invalid_query_parameter' | 'invalid_date_range';
      message: string;
    };

function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function parseIsoDate(value: string): number | null {
  if (!ISO_DATE_PATTERN.test(value)) {
    return null;
  }
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(ms) || toIsoDate(ms) !== value ? null : ms;
}

function startOfUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Inclusive window for an export. A missing `endDate` is today (UTC) and a
 * missing `startDate` is 89 days before `endDate`.
 */
export function parseExportWindow(
  startDate: string | null,
  endDate: string | null,
  today: Date,
): WindowResult {
  const invalid = (name: string): WindowResult => ({
    ok: false,
    code: 'invalid_query_parameter',
    message: `${name} must be a YYYY-MM-DD date.`,
  });

  const endMs = endDate === null ? startOfUtcDay(today) : parseIsoDate(endDate);
  if (endMs === null) return invalid('endDate');
  const startMs =
    startDate === null
      ? endMs - (EXPORT_MAX_RANGE_DAYS - 1) * DAY_MS
      : parseIsoDate(startDate);
  if (startMs === null) return invalid('startDate');

  if (endMs < startMs) {
    return {
      ok: false,
      code: 'invalid_date_range',
      message: 'endDate must not be before startDate.',
    };
  }
  if ((endMs - startMs) / DAY_MS + 1 > EXPORT_MAX_RANGE_DAYS) {
    return {
      ok: false,
      code: 'invalid_query_parameter',
      message: `The date range must not exceed ${String(EXPORT_MAX_RANGE_DAYS)} days.`,
    };
  }
  return {
    ok: true,
    value: { startDate: toIsoDate(startMs), endDate: toIsoDate(endMs) },
  };
}

export interface ExportCell {
  reportDate: string;
  countryCode: string;
}

/**
 * One cell per active day and country, ordered by date then country. The
 * active days are the `cycleDay` days ending today (UTC). A campaign that is
 * still `creating` has not delivered, so it has no cells.
 */
export function buildActiveCells(
  input: { status: CampaignStatus; cycleDay: number },
  today: Date,
): ExportCell[] {
  if (input.status === 'creating') {
    return [];
  }
  const todayMs = startOfUtcDay(today);
  const cells: ExportCell[] = [];
  for (let offset = input.cycleDay - 1; offset >= 0; offset -= 1) {
    const reportDate = toIsoDate(todayMs - offset * DAY_MS);
    for (const countryCode of EXPORT_COUNTRIES) {
      cells.push({ reportDate, countryCode });
    }
  }
  return cells;
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

/** `numerator / denominator` to 4 decimals, `0` when the denominator is `0`. */
function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? round(numerator / denominator, 4) : 0;
}

/** Like {@link ratio}, but `null` when either side is unknown or the denominator is `0`. */
function nullableRatio(
  numerator: number | null,
  denominator: number | null,
): number | null {
  if (numerator === null || denominator === null || denominator <= 0) {
    return null;
  }
  return round(numerator / denominator, 4);
}

function splitNullable(total: number | null, parts: number): (number | null)[] {
  return total === null
    ? Array.from({ length: parts }, () => null)
    : splitInt(total, parts);
}

/** The overview's fee formula, applied to one row's media spend. */
function feesFor(spendMedia: number, feeRate: number): number {
  return feeRate > 0 && spendMedia > 0
    ? round(spendMedia / (1 - feeRate) - spendMedia, 2)
    : 0;
}

function inWindow(reportDate: string, window: ExportWindow): boolean {
  return reportDate >= window.startDate && reportDate <= window.endDate;
}

function campaignTarget(campaign: EmulatorCampaignRecord) {
  return {
    campaign_target_type: campaign.playlistId
      ? ('playlist' as const)
      : campaign.trackId
        ? ('track' as const)
        : null,
    campaign_target_isrc: null,
    campaign_target_spotify_track_id: campaign.trackId,
    campaign_target_playlist_id: campaign.playlistId,
  };
}

/**
 * Breakdown rows for the campaign. The overview totals are split across every
 * active `(day, country)` cell first, then the window picks rows, so a
 * narrower window returns a subset of the same rows.
 */
export function buildBreakdownRows(
  store: EmulatorStore,
  campaign: EmulatorCampaignRecord,
  window: ExportWindow,
  now: Date,
): BreakdownRow[] {
  const cells = buildActiveCells(campaign, now);
  if (cells.length === 0) {
    return [];
  }
  const totals = store.buildOverview(campaign);
  const count = cells.length;
  const newListeners = splitInt(totals.listeners, count);
  const returningListeners = splitInt(
    Math.max(0, totals.total_listeners - totals.listeners),
    count,
  );
  const streams = splitInt(totals.streams, count);
  const followers = splitInt(totals.followers, count);
  const impressions = splitNullable(totals.impressions, count);
  const adClicks = splitNullable(totals.ad_clicks, count);
  const linkClicks = splitNullable(totals.link_clicks, count);
  const spend = splitCents(totals.spend_media, count);
  const exportedAt = now.toISOString();

  return cells.flatMap((cell, index) => {
    if (!inWindow(cell.reportDate, window)) {
      return [];
    }
    const listeners = newListeners[index] ?? 0;
    const returning = returningListeners[index] ?? 0;
    const totalListeners = listeners + returning;
    const rowStreams = streams[index] ?? 0;
    const rowFollowers = followers[index] ?? 0;
    const rowImpressions = impressions[index] ?? null;
    const rowAdClicks = adClicks[index] ?? null;
    const rowLinkClicks = linkClicks[index] ?? null;
    const spendMedia = spend[index] ?? 0;
    const fees = feesFor(spendMedia, store.feeRate);
    const cpf = ratio(spendMedia, rowFollowers);

    const row: BreakdownRow = {
      provider: 'soundlink',
      account_id: store.organizationId,
      schema_version: '1.1',
      report_date: cell.reportDate,
      report_date_timezone: 'UTC',
      exported_at: exportedAt,
      campaign_id: campaign.campaignId,
      campaign_name: campaign.campaignName,
      ...campaignTarget(campaign),
      country_code: cell.countryCode,
      impressions: rowImpressions,
      ad_clicks: rowAdClicks,
      link_clicks: rowLinkClicks,
      streams: rowStreams,
      listeners,
      new_listeners: listeners,
      returning_listeners: returning,
      total_listeners: totalListeners,
      followers: rowFollowers,
      streams_per_listener: ratio(rowStreams, totalListeners),
      spend_media: spendMedia,
      spend_total: round(spendMedia + fees, 2),
      fees,
      currency: 'USD',
      currency_account: 'USD',
      cpl: ratio(spendMedia, listeners),
      cpf,
      cpc_linkclick: nullableRatio(spendMedia, rowLinkClicks),
      ctr_linkclick: nullableRatio(rowLinkClicks, rowImpressions),
      ctr_adclick: nullableRatio(rowAdClicks, rowImpressions),
      cost_per_result: cpf,
      result_type: 'follow',
    };
    return [row];
  });
}
