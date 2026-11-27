import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Soundlink } from '../../src/index.js';
import {
  createApiEmulator,
  type ApiEmulator,
  type EmulatorResponse,
  type EmulatorServer,
} from '../../src/emulator/index.js';
import { parseNdjsonText } from '../../src/core/jsonl.js';
import type {
  BreakdownRow,
  CreateCampaignRequest,
  EngagementRow,
  MetricsOverview,
} from '../../src/types/api.js';
import {
  asCampaignCreate,
  authHeaders,
  DEFAULT_CREATE_BODY,
  EMULATOR_API_KEY,
  envelopeData,
  envelopeError,
} from './helpers.js';

const DAY_MS = 86_400_000;

/** UTC calendar date `offset` days from today. */
function isoDay(offset = 0): string {
  const now = new Date();
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(todayMs + offset * DAY_MS).toISOString().slice(0, 10);
}

function sum<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

describe('emulator campaign exports', () => {
  let emu: ApiEmulator;
  let httpServer: EmulatorServer | undefined;
  let keyCounter = 0;

  beforeEach(() => {
    emu = createApiEmulator({ apiKey: EMULATOR_API_KEY, initialWalletBalance: 500 });
  });

  afterEach(async () => {
    if (httpServer) {
      await httpServer.close();
      httpServer = undefined;
    }
  });

  function get(path: string): EmulatorResponse {
    return emu.dispatch({ method: 'GET', path, headers: authHeaders() });
  }

  function create(body: CreateCampaignRequest = DEFAULT_CREATE_BODY): string {
    keyCounter += 1;
    const response = emu.dispatch({
      method: 'POST',
      path: '/v1/campaigns',
      headers: authHeaders(`export-${String(keyCounter)}`),
      body,
    });
    expect(response.status).toBe(201);
    return asCampaignCreate(envelopeData(response.json)).campaignId;
  }

  function createActive(body?: CreateCampaignRequest): string {
    const id = create(body);
    emu.transition(id, 'activate');
    return id;
  }

  function overview(id: string): MetricsOverview {
    return envelopeData(
      get(`/v1/campaigns/${id}/metrics/overview`).json,
    ) as MetricsOverview;
  }

  function breakdown(id: string, query = ''): BreakdownRow[] {
    const response = get(`/v1/campaigns/${id}/metrics/breakdown/export${query}`);
    expect(response.status).toBe(200);
    return parseNdjsonText<BreakdownRow>(response.text ?? '');
  }

  function engagement(id: string, query = ''): EngagementRow[] {
    const response = get(`/v1/campaigns/${id}/metrics/engagement/export${query}`);
    expect(response.status).toBe(200);
    return parseNdjsonText<EngagementRow>(response.text ?? '');
  }

  describe('breakdown', () => {
    it('returns JSONL with a row count header', () => {
      const id = createActive();
      const response = get(`/v1/campaigns/${id}/metrics/breakdown/export`);

      expect(response.status).toBe(200);
      expect(response.headers?.['Content-Type']).toBe('application/x-ndjson');
      expect(response.headers?.['X-Row-Count']).toBe('3');
      const rows = parseNdjsonText<BreakdownRow>(response.text ?? '');
      expect(rows.map((row) => row.country_code)).toEqual(['DE', 'GB', 'US']);
      for (const row of rows) {
        expect(row.report_date).toBe(isoDay());
        expect(row.schema_version).toBe('1.1');
        expect(row.account_id).toBe('org_emulator');
        expect(row.campaign_id).toBe(id);
        expect(row.campaign_target_type).toBe('track');
        expect(row.campaign_target_spotify_track_id).toBe('4iV5W9uYEdYUVa79Axb7Rh');
      }
    });

    it('sums to the overview totals over all active days', () => {
      const id = createActive();
      emu.transition(id, 'set_metrics', 40.01, undefined, {
        listeners: 101,
        streams: 250,
        cycleDay: 4,
      });

      const rows = breakdown(id);
      const totals = overview(id);

      expect(rows).toHaveLength(12);
      expect(Math.round(sum(rows, (row) => row.spend_media) * 100)).toBe(4001);
      expect(sum(rows, (row) => row.streams)).toBe(totals.streams);
      expect(sum(rows, (row) => row.listeners)).toBe(totals.listeners);
      for (const row of rows) {
        expect(row.listeners).toBe(row.new_listeners);
        expect(row.total_listeners).toBe(row.new_listeners + row.returning_listeners);
      }
    });

    it('filters rows by startDate and endDate', () => {
      const id = createActive();
      emu.transition(id, 'set_metrics', undefined, undefined, { cycleDay: 4 });
      const totals = overview(id);

      expect(breakdown(id, `?startDate=${isoDay()}&endDate=${isoDay()}`)).toHaveLength(
        3,
      );
      const lastTwo = breakdown(id, `?startDate=${isoDay(-1)}`);
      expect(lastTwo).toHaveLength(6);
      expect(sum(lastTwo, (row) => row.streams)).toBeLessThan(totals.streams);
      expect(breakdown(id, `?endDate=${isoDay(-2)}`)).toHaveLength(6);
    });

    it('allows a future endDate', () => {
      const id = createActive();
      expect(breakdown(id, `?endDate=${isoDay(30)}`)).toHaveLength(3);
    });

    it('computes fees from the fee rate', () => {
      emu = createApiEmulator({
        apiKey: EMULATOR_API_KEY,
        initialWalletBalance: 500,
        plan: 'enterprise',
      });
      const id = createActive();
      emu.transition(id, 'set_metrics', 40);

      const rows = breakdown(id);
      expect(sum(rows, (row) => row.fees)).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.spend_total).toBeCloseTo(row.spend_media + row.fees, 2);
      }
      expect(Math.abs(sum(rows, (row) => row.fees) - overview(id).fees)).toBeLessThan(
        0.05,
      );
    });

    it('is empty while the campaign is creating', () => {
      const id = create();
      const response = get(`/v1/campaigns/${id}/metrics/breakdown/export`);

      expect(response.status).toBe(200);
      expect(response.headers?.['X-Row-Count']).toBe('0');
      expect(response.text).toBe('');
    });

    it('returns 404 for an unknown campaign', () => {
      const response = get('/v1/campaigns/cmp_missing/metrics/breakdown/export');

      expect(response.status).toBe(404);
      expect(envelopeError(response.json).code).toBe('campaign_not_found');
    });

    it('rejects bad windows', () => {
      const id = createActive();
      const path = `/v1/campaigns/${id}/metrics/breakdown/export`;

      const reversed = get(`${path}?startDate=${isoDay()}&endDate=${isoDay(-3)}`);
      expect(reversed.status).toBe(400);
      expect(envelopeError(reversed.json).code).toBe('invalid_date_range');

      const garbage = get(`${path}?startDate=nope`);
      expect(garbage.status).toBe(400);
      expect(envelopeError(garbage.json).code).toBe('invalid_query_parameter');

      const tooWide = get(`${path}?startDate=${isoDay(-90)}&endDate=${isoDay()}`);
      expect(tooWide.status).toBe(400);
      expect(envelopeError(tooWide.json).code).toBe('invalid_query_parameter');

      const widest = get(`${path}?startDate=${isoDay(-89)}&endDate=${isoDay()}`);
      expect(widest.status).toBe(200);
    });

    it('keeps every numeric field finite when the metrics are zero', () => {
      const id = createActive();
      emu.transition(id, 'set_metrics', 0, undefined, {
        listeners: 0,
        streams: 0,
        cycleDay: 4,
      });

      const rows = breakdown(id);
      expect(rows).toHaveLength(12);
      for (const row of rows) {
        for (const value of [
          row.streams,
          row.listeners,
          row.new_listeners,
          row.returning_listeners,
          row.total_listeners,
          row.followers,
          row.streams_per_listener,
          row.spend_media,
          row.spend_total,
          row.fees,
          row.cpl,
          row.cpf,
          row.cost_per_result,
        ]) {
          expect(Number.isFinite(value)).toBe(true);
        }
        expect(row.cpl).toBe(0);
      }
    });

    it('keeps sums exact when totals are smaller than the cell count', () => {
      const id = createActive();
      emu.transition(id, 'set_metrics', undefined, undefined, {
        listeners: 2,
        cycleDay: 4,
      });

      const rows = breakdown(id);
      expect(sum(rows, (row) => row.listeners)).toBe(2);
      expect(rows.filter((row) => row.listeners === 0).length).toBeGreaterThanOrEqual(
        10,
      );
    });

    it('is parsed by the SDK over listen', async () => {
      const id = createActive();
      httpServer = await emu.listen();
      const soundlink = new Soundlink({
        apiKey: EMULATOR_API_KEY,
        baseUrl: httpServer.baseUrl,
      });

      const all = await soundlink.metrics.breakdown.export.collect(id);
      expect(all.error).toBeNull();
      expect(all.data?.rowCount).toBe(3);
      expect(all.data?.rows).toHaveLength(3);

      const today = await soundlink.metrics.breakdown.export.collect(id, {
        startDate: isoDay(),
        endDate: isoDay(),
      });
      expect(today.data?.rowCount).toBe(3);
    });
  });

  describe('engagement', () => {
    const PLAYLIST_BODY: CreateCampaignRequest = {
      ...DEFAULT_CREATE_BODY,
      spotifyUrl: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
    };

    it('returns JSONL with the engagement schema', () => {
      const id = createActive();
      const response = get(`/v1/campaigns/${id}/metrics/engagement/export`);

      expect(response.status).toBe(200);
      expect(response.headers?.['Content-Type']).toBe('application/x-ndjson');
      expect(response.headers?.['X-Row-Count']).toBe('3');
      const rows = parseNdjsonText<EngagementRow>(response.text ?? '');
      expect(rows.map((row) => row.country_code)).toEqual(['DE', 'GB', 'US']);
      for (const row of rows) {
        expect(row.schema_version).toBe('1.0');
        expect(row.report_date).toBe(isoDay());
        expect(row.status).toBe('active');
        expect(row.engagement_context).toBe('catalog');
        expect(row.playlist_position).toBeNull();
        expect(row.engaged_spotify_track_id).toBe('4iV5W9uYEdYUVa79Axb7Rh');
      }
    });

    it('follows the row schema totals', () => {
      const id = createActive();
      emu.transition(id, 'set_metrics', undefined, undefined, {
        listeners: 101,
        streams: 250,
        cycleDay: 4,
      });

      const rows = engagement(id);
      const totals = overview(id);

      expect(rows).toHaveLength(12);
      expect(sum(rows, (row) => row.streams)).toBe(totals.streams);
      expect(sum(rows, (row) => row.new_listeners)).toBe(totals.listeners);
      expect(sum(rows, (row) => row.listeners)).toBe(totals.total_listeners);
      for (const row of rows) {
        expect(row.listeners).toBe(row.new_listeners + row.returning_listeners);
        expect(row.streams).toBe(
          row.new_listener_streams + row.returning_listener_streams,
        );
      }
    });

    it('filters rows by date window', () => {
      const id = createActive();
      emu.transition(id, 'set_metrics', undefined, undefined, { cycleDay: 4 });

      expect(engagement(id, `?startDate=${isoDay()}&endDate=${isoDay()}`)).toHaveLength(
        3,
      );
      expect(engagement(id, `?startDate=${isoDay(-1)}`)).toHaveLength(6);
    });

    it('filters by engagementContext', () => {
      const id = createActive();
      emu.transition(id, 'set_metrics', undefined, undefined, { cycleDay: 4 });

      const catalog = engagement(id, '?engagementContext=catalog');
      expect(catalog).toHaveLength(12);
      expect(catalog.every((row) => row.engagement_context === 'catalog')).toBe(true);

      const response = get(
        `/v1/campaigns/${id}/metrics/engagement/export?engagementContext=playlist`,
      );
      expect(response.status).toBe(200);
      expect(response.headers?.['X-Row-Count']).toBe('0');
      expect(response.text).toBe('');
    });

    it('uses the playlist context for a playlist campaign', () => {
      const id = createActive(PLAYLIST_BODY);

      const rows = engagement(id);
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(row.engagement_context).toBe('playlist');
        expect(row.playlist_position).toBe(1);
        expect(row.engaged_spotify_track_id).toBe('emulator_track');
        expect(row.engaged_track_name).toBe('Emulator Track');
        expect(row.campaign_target_type).toBe('playlist');
      }
      expect(engagement(id, '?engagementContext=playlist')).toHaveLength(3);
      const none = get(
        `/v1/campaigns/${id}/metrics/engagement/export?engagementContext=catalog`,
      );
      expect(none.headers?.['X-Row-Count']).toBe('0');
    });

    it('is empty while the campaign is creating', () => {
      const id = create();
      const response = get(`/v1/campaigns/${id}/metrics/engagement/export`);

      expect(response.status).toBe(200);
      expect(response.headers?.['X-Row-Count']).toBe('0');
      expect(response.text).toBe('');
    });

    it('rejects bad input and unknown campaigns', () => {
      const id = createActive();
      const path = `/v1/campaigns/${id}/metrics/engagement/export`;

      const context = get(`${path}?engagementContext=other`);
      expect(context.status).toBe(400);
      expect(envelopeError(context.json).code).toBe('invalid_query_parameter');

      const reversed = get(`${path}?startDate=${isoDay()}&endDate=${isoDay(-3)}`);
      expect(reversed.status).toBe(400);
      expect(envelopeError(reversed.json).code).toBe('invalid_date_range');

      const missing = get('/v1/campaigns/cmp_missing/metrics/engagement/export');
      expect(missing.status).toBe(404);
      expect(envelopeError(missing.json).code).toBe('campaign_not_found');
    });

    it('keeps every numeric field finite when the metrics are zero', () => {
      const id = createActive();
      emu.transition(id, 'set_metrics', 0, undefined, {
        listeners: 0,
        streams: 0,
        cycleDay: 4,
      });

      for (const row of engagement(id)) {
        for (const value of [
          row.new_listeners,
          row.returning_listeners,
          row.listeners,
          row.new_listener_streams,
          row.returning_listener_streams,
          row.streams,
          row.spl,
        ]) {
          expect(Number.isFinite(value)).toBe(true);
        }
        expect(row.streams).toBe(0);
      }
    });

    it('keeps sums exact when totals are smaller than the cell count', () => {
      const id = createActive();
      emu.transition(id, 'set_metrics', undefined, undefined, {
        streams: 5,
        cycleDay: 4,
      });

      const rows = engagement(id);
      expect(sum(rows, (row) => row.streams)).toBe(5);
      for (const row of rows) {
        expect(row.new_listener_streams).toBeGreaterThanOrEqual(0);
        expect(row.returning_listener_streams).toBeGreaterThanOrEqual(0);
      }
    });

    it('is parsed by the SDK over listen', async () => {
      const id = createActive();
      httpServer = await emu.listen();
      const soundlink = new Soundlink({
        apiKey: EMULATOR_API_KEY,
        baseUrl: httpServer.baseUrl,
      });

      const all = await soundlink.metrics.engagement.export.collect(id);
      expect(all.error).toBeNull();
      expect(all.data?.rowCount).toBe(3);

      const catalog = await soundlink.metrics.engagement.export.collect(id, {
        engagementContext: 'catalog',
      });
      expect(catalog.data?.rowCount).toBe(3);

      const playlist = await soundlink.metrics.engagement.export.collect(id, {
        engagementContext: 'playlist',
      });
      expect(playlist.error).toBeNull();
      expect(playlist.data?.rowCount).toBe(0);
    });
  });
});
