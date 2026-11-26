import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Soundlink } from '../../src/index.js';
import {
  createApiEmulator,
  type ApiEmulator,
  type EmulatorServer,
} from '../../src/emulator/index.js';
import {
  asCampaignCreate,
  authHeaders,
  DEFAULT_CREATE_BODY,
  EMULATOR_API_KEY,
  envelopeData,
  envelopeError,
} from './helpers.js';

describe('emulator auto-renew and batch overview', () => {
  let emu: ApiEmulator;
  let httpServer: EmulatorServer | undefined;

  beforeEach(() => {
    emu = createApiEmulator({
      apiKey: EMULATOR_API_KEY,
      initialWalletBalance: 500,
    });
  });

  afterEach(async () => {
    if (httpServer) {
      await httpServer.close();
      httpServer = undefined;
    }
  });

  function create(idempotencyKey: string): string {
    const response = emu.dispatch({
      method: 'POST',
      path: '/v1/campaigns',
      headers: authHeaders(idempotencyKey),
      body: DEFAULT_CREATE_BODY,
    });
    expect(response.status).toBe(201);
    return asCampaignCreate(envelopeData(response.json)).campaignId;
  }

  function activate(campaignId: string): void {
    const response = emu.dispatch({
      method: 'POST',
      path: `/__emulator/campaigns/${campaignId}/transition`,
      body: { action: 'activate' },
    });
    expect(response.status).toBe(200);
  }

  function setAutoRenew(campaignId: string, body: unknown, idempotencyKey?: string) {
    return emu.dispatch({
      method: 'PUT',
      path: `/v1/campaigns/${campaignId}/auto-renew`,
      headers: authHeaders(idempotencyKey),
      body,
    });
  }

  function batchItems(
    json: unknown,
  ): Array<Record<string, unknown> & { campaignId: string }> {
    const data = envelopeData(json) as {
      items: Array<Record<string, unknown> & { campaignId: string }>;
    };
    return data.items;
  }

  function batch(body: unknown) {
    return emu.dispatch({
      method: 'POST',
      path: '/v1/campaigns/metrics/overview/batch',
      headers: authHeaders(),
      body,
    });
  }

  describe('PUT /v1/campaigns/:id/auto-renew', () => {
    it('toggles autoRenew and returns the campaignId and autoRenew', () => {
      const campaignId = create('ar-toggle-create');
      activate(campaignId);

      const response = setAutoRenew(campaignId, { autoRenew: true }, 'ar-toggle');

      expect(response.status).toBe(200);
      expect(envelopeData(response.json)).toEqual({ campaignId, autoRenew: true });

      const detail = emu.dispatch({
        method: 'GET',
        path: `/v1/campaigns/${campaignId}`,
        headers: authHeaders(),
      });
      expect(envelopeData(detail.json)).toMatchObject({ autoRenew: true });
    });

    it('turns auto-renew off again', () => {
      const campaignId = create('ar-off-create');
      activate(campaignId);
      setAutoRenew(campaignId, { autoRenew: true }, 'ar-off-on');

      const response = setAutoRenew(campaignId, { autoRenew: false }, 'ar-off-off');

      expect(response.status).toBe(200);
      expect(envelopeData(response.json)).toEqual({ campaignId, autoRenew: false });
    });

    it('treats a matching stored value as a no-op success', () => {
      const campaignId = create('ar-noop-create');
      activate(campaignId);

      const response = setAutoRenew(campaignId, { autoRenew: false }, 'ar-noop');

      expect(response.status).toBe(200);
      expect(envelopeData(response.json)).toEqual({ campaignId, autoRenew: false });
    });

    it('requires an Idempotency-Key', () => {
      const campaignId = create('ar-key-create');
      activate(campaignId);

      const response = setAutoRenew(campaignId, { autoRenew: true }, undefined);

      expect(response.status).toBe(400);
      expect(envelopeError(response.json).code).toBe('invalid_request');
    });

    it('rejects a non-boolean autoRenew', () => {
      const campaignId = create('ar-bool-create');
      activate(campaignId);

      const response = setAutoRenew(campaignId, { autoRenew: 'yes' }, 'ar-bool');

      expect(response.status).toBe(400);
      expect(envelopeError(response.json).code).toBe('invalid_request');
    });

    it('returns 404 for an unknown campaign', () => {
      const response = setAutoRenew('missing-campaign', { autoRenew: true }, 'ar-404');

      expect(response.status).toBe(404);
      expect(envelopeError(response.json).code).toBe('campaign_not_found');
    });

    it('rejects a campaign that is not active or renew_failed', () => {
      const campaignId = create('ar-status-create');

      const response = setAutoRenew(campaignId, { autoRenew: true }, 'ar-status');

      expect(response.status).toBe(400);
      expect(envelopeError(response.json).message).toContain('creating');
    });

    it('replays the stored response for the same key and body', () => {
      const campaignId = create('ar-replay-create');
      activate(campaignId);

      const first = setAutoRenew(campaignId, { autoRenew: true }, 'ar-replay');
      const second = setAutoRenew(campaignId, { autoRenew: true }, 'ar-replay');

      expect(second.status).toBe(200);
      expect(envelopeData(second.json)).toEqual(envelopeData(first.json));
    });

    it('returns idempotency_key_conflict for the same key with a different body', () => {
      const campaignId = create('ar-conflict-create');
      activate(campaignId);
      setAutoRenew(campaignId, { autoRenew: true }, 'ar-conflict');

      const response = setAutoRenew(campaignId, { autoRenew: false }, 'ar-conflict');

      expect(response.status).toBe(409);
      expect(envelopeError(response.json).code).toBe('idempotency_key_conflict');
    });
  });

  describe('POST /v1/campaigns/metrics/overview/batch', () => {
    it('returns one overview per campaign, in request order', () => {
      const first = create('batch-a');
      const second = create('batch-b');
      activate(first);
      activate(second);

      const response = batch({ campaignIds: [second, first] });

      expect(response.status).toBe(200);
      const items = batchItems(response.json);
      expect(items.map((item) => item.campaignId)).toEqual([second, first]);
      for (const item of items) {
        expect(typeof item.spend_media).toBe('number');
        expect(typeof item.spend_total).toBe('number');
        expect(typeof item.streams).toBe('number');
        expect(typeof item.listeners).toBe('number');
      }
    });

    it('omits unknown IDs and ignores duplicates', () => {
      const campaignId = create('batch-known');
      activate(campaignId);

      const response = batch({
        campaignIds: [campaignId, 'missing-campaign', campaignId],
      });

      expect(response.status).toBe(200);
      expect(batchItems(response.json).map((item) => item.campaignId)).toEqual([
        campaignId,
      ]);
    });

    it('rejects an empty campaignIds list', () => {
      const response = batch({ campaignIds: [] });

      expect(response.status).toBe(400);
      expect(envelopeError(response.json).code).toBe('invalid_request');
    });

    it('rejects more than 50 IDs', () => {
      const campaignIds = Array.from(
        { length: 51 },
        (_, index) => `c-${String(index)}`,
      );

      const response = batch({ campaignIds });

      expect(response.status).toBe(400);
      expect(envelopeError(response.json).code).toBe('invalid_request');
    });

    it('rejects non-string IDs', () => {
      const response = batch({ campaignIds: [42] });

      expect(response.status).toBe(400);
      expect(envelopeError(response.json).code).toBe('invalid_request');
    });

    it('rejects a malformed startDate', () => {
      const campaignId = create('batch-date');

      const response = batch({
        campaignIds: [campaignId],
        startDate: '2026-4-1',
      });

      expect(response.status).toBe(400);
      expect(envelopeError(response.json).message).toContain('startDate');
    });

    it('accepts a valid date window and returns lifetime totals', () => {
      const campaignId = create('batch-window');
      activate(campaignId);

      const withWindow = batch({
        campaignIds: [campaignId],
        startDate: '2026-04-01',
        endDate: '2026-04-08',
      });
      const withoutWindow = batch({ campaignIds: [campaignId] });

      expect(withWindow.status).toBe(200);
      expect(envelopeData(withWindow.json)).toEqual(envelopeData(withoutWindow.json));
    });
  });

  describe('through the SDK client', () => {
    it('updates auto-renew over HTTP', async () => {
      const campaignId = create('sdk-ar-create');
      activate(campaignId);
      httpServer = await emu.listen({ port: 0 });
      const soundlink = new Soundlink({
        apiKey: EMULATOR_API_KEY,
        baseUrl: httpServer.baseUrl,
      });

      const result = await soundlink.campaigns.updateAutoRenew(
        campaignId,
        { autoRenew: true },
        { idempotencyKey: 'sdk-ar-http' },
      );

      expect(result.error).toBeNull();
      expect(result.data).toEqual({ campaignId, autoRenew: true });
    });

    it('returns one overview per ID over HTTP', async () => {
      const campaignId = create('sdk-batch-create');
      activate(campaignId);
      httpServer = await emu.listen({ port: 0 });
      const soundlink = new Soundlink({
        apiKey: EMULATOR_API_KEY,
        baseUrl: httpServer.baseUrl,
      });

      const result = await soundlink.metrics.overviewBatch({
        campaignIds: [campaignId],
      });

      expect(result.error).toBeNull();
      expect(result.data?.items.map((item) => item.campaignId)).toEqual([campaignId]);
    });
  });
});
