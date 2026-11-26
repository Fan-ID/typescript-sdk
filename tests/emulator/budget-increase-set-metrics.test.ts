import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Soundlink } from '../../src/index.js';
import {
  createApiEmulator,
  type ApiEmulator,
  type EmulatorServer,
} from '../../src/emulator/index.js';
import type { CampaignDetail, MetricsOverview } from '../../src/types/api.js';
import {
  asCampaignCreate,
  authHeaders,
  DEFAULT_CREATE_BODY,
  DEFAULT_COMMITTED_USD,
  EMULATOR_API_KEY,
  envelopeData,
  envelopeError,
} from './helpers.js';

const INITIAL_BALANCE = 500;

describe('emulator set_metrics and budget increase', () => {
  let emu: ApiEmulator;
  let httpServer: EmulatorServer | undefined;

  beforeEach(() => {
    emu = createApiEmulator({
      apiKey: EMULATOR_API_KEY,
      initialWalletBalance: INITIAL_BALANCE,
      feeRate: 0.2,
    });
  });

  afterEach(async () => {
    if (httpServer) {
      await httpServer.close();
      httpServer = undefined;
    }
  });

  function createActive(idempotencyKey: string): string {
    const created = emu.dispatch({
      method: 'POST',
      path: '/v1/campaigns',
      headers: authHeaders(idempotencyKey),
      body: DEFAULT_CREATE_BODY,
    });
    expect(created.status).toBe(201);
    const campaignId = asCampaignCreate(envelopeData(created.json)).campaignId;
    emu.transition(campaignId, 'activate');
    return campaignId;
  }

  function harness(campaignId: string, body: Record<string, unknown>) {
    return emu.dispatch({
      method: 'POST',
      path: `/__emulator/campaigns/${campaignId}/transition`,
      body,
    });
  }

  function overviewOf(campaignId: string): MetricsOverview {
    const response = emu.dispatch({
      method: 'GET',
      path: `/v1/campaigns/${campaignId}/metrics/overview`,
      headers: authHeaders(),
    });
    return envelopeData(response.json) as MetricsOverview;
  }

  function detailOf(campaignId: string): CampaignDetail {
    const response = emu.dispatch({
      method: 'GET',
      path: `/v1/campaigns/${campaignId}`,
      headers: authHeaders(),
    });
    return envelopeData(response.json) as CampaignDetail;
  }

  function increase(campaignId: string, body: unknown, idempotencyKey?: string) {
    return emu.dispatch({
      method: 'POST',
      path: `/v1/campaigns/${campaignId}/budget/increase`,
      headers: authHeaders(idempotencyKey),
      body,
    });
  }

  function setCycleDay(campaignId: string, cycleDay: number): void {
    emu.transition(campaignId, 'set_metrics', undefined, undefined, { cycleDay });
  }

  describe('set_metrics', () => {
    it('sets spend, listeners and streams and recomputes CPL and fees', () => {
      const campaignId = createActive('sm-recompute');

      const response = harness(campaignId, {
        action: 'set_metrics',
        mediaSpendUsd: 40,
        listeners: 100,
        streams: 250,
        cycleDay: 3,
      });

      expect(response.status).toBe(200);
      const overview = overviewOf(campaignId);
      expect(overview.spend_media).toBe(40);
      expect(overview.listeners).toBe(100);
      expect(overview.streams).toBe(250);
      expect(overview.cpl).toBe(0.4);
      // feeRate 0.2: 40 / 0.8 - 40
      expect(overview.fees).toBe(10);
      expect(overview.spend_total).toBe(50);
    });

    it('shows the values in the batch overview', () => {
      const campaignId = createActive('sm-batch');
      harness(campaignId, {
        action: 'set_metrics',
        mediaSpendUsd: 40,
        listeners: 100,
        streams: 250,
      });

      const response = emu.dispatch({
        method: 'POST',
        path: '/v1/campaigns/metrics/overview/batch',
        headers: authHeaders(),
        body: { campaignIds: [campaignId] },
      });

      const items = (envelopeData(response.json) as { items: MetricsOverview[] }).items;
      expect(items[0]).toMatchObject({
        spend_media: 40,
        spend_total: 50,
        streams: 250,
        listeners: 100,
        cpl: 0.4,
      });
    });

    it('changes only the fields that are sent', () => {
      const campaignId = createActive('sm-partial');
      harness(campaignId, {
        action: 'set_metrics',
        mediaSpendUsd: 40,
        listeners: 100,
        streams: 250,
      });

      harness(campaignId, { action: 'set_metrics', streams: 300 });

      const overview = overviewOf(campaignId);
      expect(overview.streams).toBe(300);
      expect(overview.listeners).toBe(100);
      expect(overview.spend_media).toBe(40);
    });

    it('keeps metrics set before activation', () => {
      const created = emu.dispatch({
        method: 'POST',
        path: '/v1/campaigns',
        headers: authHeaders('sm-preactivate'),
        body: DEFAULT_CREATE_BODY,
      });
      const campaignId = asCampaignCreate(envelopeData(created.json)).campaignId;
      harness(campaignId, { action: 'set_metrics', listeners: 300, streams: 900 });

      emu.transition(campaignId, 'activate');

      const overview = overviewOf(campaignId);
      expect(overview.listeners).toBe(300);
      expect(overview.streams).toBe(900);
      expect(overview.total_listeners).toBeGreaterThanOrEqual(300);
      // Fields that were not set keep the activation defaults.
      expect(overview.followers).toBe(18);
      expect(overview.impressions).toBe(8000);
    });

    it('works through the typed emulator helper', () => {
      const campaignId = createActive('sm-helper');

      const result = emu.transition(campaignId, 'set_metrics', 25, undefined, {
        listeners: 50,
        streams: 80,
        cycleDay: 4,
      });

      expect(result.mediaSpendUsd).toBe(25);
      expect(overviewOf(campaignId).listeners).toBe(50);
    });

    it.each([
      ['no field', {}],
      ['a negative listeners', { listeners: -1 }],
      ['a fractional streams', { streams: 1.5 }],
      ['a string listeners', { listeners: '10' }],
      ['a string mediaSpendUsd', { mediaSpendUsd: '10' }],
      ['cycleDay 0', { cycleDay: 0 }],
      ['cycleDay past the cycle', { cycleDay: 8 }],
      [
        'spend above the committed budget',
        { mediaSpendUsd: DEFAULT_COMMITTED_USD + 1 },
      ],
    ])('rejects %s', (_name, fields) => {
      const campaignId = createActive(`sm-bad-${_name}`);

      const response = harness(campaignId, { action: 'set_metrics', ...fields });

      expect(response.status).toBe(400);
      expect(envelopeError(response.json).code).toBe('invalid_request');
    });

    it('returns 404 for an unknown campaign', () => {
      const response = harness('missing-campaign', {
        action: 'set_metrics',
        listeners: 1,
      });

      expect(response.status).toBe(404);
    });
  });

  describe('POST /v1/campaigns/:id/budget/increase', () => {
    it('debits the wallet and raises dailyBudget for current_cycle', () => {
      const campaignId = createActive('bi-current');
      setCycleDay(campaignId, 4); // 3 days remaining
      const before = emu.getWallet().balance;

      const response = increase(
        campaignId,
        { amount: 30, mode: 'current_cycle' },
        'bi-current-key',
      );

      expect(response.status).toBe(200);
      expect(envelopeData(response.json)).toEqual({
        campaignId,
        mode: 'current_cycle',
        amount: 30,
        walletBalance: before - 30,
        walletNextCycleDailyBudget: null,
      });
      expect(emu.getWallet().balance).toBe(before - 30);
      const detail = detailOf(campaignId);
      // 10 + 30 / 3 remaining days
      expect(detail.dailyBudget).toBe(20);
      expect(detail.totalBudget).toBe(DEFAULT_COMMITTED_USD + 30);
    });

    it('defaults to current_and_renewals and sets the next-cycle budget', () => {
      const campaignId = createActive('bi-default');
      setCycleDay(campaignId, 4);

      const response = increase(campaignId, { amount: 30 }, 'bi-default-key');

      expect(response.status).toBe(200);
      expect(envelopeData(response.json)).toMatchObject({
        mode: 'current_and_renewals',
        walletNextCycleDailyBudget: 20,
      });
      expect(detailOf(campaignId).dailyBudget).toBe(20);
    });

    it.each(['current_cycle', 'current_and_renewals', undefined])(
      'rejects mode %s with 2 days or fewer remaining',
      (mode) => {
        const campaignId = createActive(`bi-late-${String(mode)}`);
        setCycleDay(campaignId, 5); // 2 days remaining
        const before = emu.getWallet().balance;

        const response = increase(
          campaignId,
          { amount: 30, ...(mode ? { mode } : {}) },
          `bi-late-key-${String(mode)}`,
        );

        expect(response.status).toBe(400);
        const error = envelopeError(response.json);
        expect(error.code).toBe('invalid_request');
        expect(error.message).toBe(
          `Campaign ${campaignId} has too few days remaining for a top-up.`,
        );
        expect(emu.getWallet().balance).toBe(before);
        expect(detailOf(campaignId).dailyBudget).toBe(10);
      },
    );

    it('accepts the last cycle day, 3 days remaining', () => {
      const campaignId = createActive('bi-boundary');
      setCycleDay(campaignId, 4);

      const response = increase(campaignId, { amount: 30 }, 'bi-boundary-key');

      expect(response.status).toBe(200);
    });

    it('accepts next_renewal with 2 days or fewer remaining, without debiting', () => {
      const campaignId = createActive('bi-next');
      setCycleDay(campaignId, 6); // 1 day remaining
      const before = emu.getWallet().balance;

      const response = increase(
        campaignId,
        { amount: 14, mode: 'next_renewal' },
        'bi-next-key',
      );

      expect(response.status).toBe(200);
      expect(envelopeData(response.json)).toMatchObject({
        mode: 'next_renewal',
        walletBalance: before,
        // 10 + 14 / 7 cycle days
        walletNextCycleDailyBudget: 12,
      });
      expect(emu.getWallet().balance).toBe(before);
      expect(detailOf(campaignId).dailyBudget).toBe(10);
    });

    it('sets an absolute next-cycle target with amount 0', () => {
      const campaignId = createActive('bi-target');
      setCycleDay(campaignId, 6);

      const response = increase(
        campaignId,
        { amount: 0, mode: 'next_renewal', targetDailyBudget: 40 },
        'bi-target-key',
      );

      expect(response.status).toBe(200);
      expect(envelopeData(response.json)).toMatchObject({
        amount: 0,
        walletNextCycleDailyBudget: 40,
      });
    });

    it.each([
      ['amount 0 without a target', { amount: 0, mode: 'next_renewal' }],
      ['amount 0 on a current-cycle mode', { amount: 0, targetDailyBudget: 40 }],
      ['a negative amount', { amount: -5 }],
      ['a string amount', { amount: '30' }],
      ['an unknown mode', { amount: 30, mode: 'someday' }],
      ['a non-positive target', { amount: 30, targetDailyBudget: 0 }],
    ])('rejects %s', (name, body) => {
      const campaignId = createActive(`bi-bad-${name}`);
      setCycleDay(campaignId, 2);

      const response = increase(campaignId, body, `bi-bad-key-${name}`);

      expect(response.status).toBe(400);
      expect(envelopeError(response.json).code).toBe('invalid_request');
    });

    it('returns 402 when the wallet cannot cover the amount, and does not store the key', () => {
      const campaignId = createActive('bi-402');
      setCycleDay(campaignId, 2);
      emu.dispatch({
        method: 'POST',
        path: '/__emulator/wallet',
        body: { balance: 10 },
      });

      const rejected = increase(
        campaignId,
        { amount: 30, mode: 'current_cycle' },
        'bi-402-key',
      );

      expect(rejected.status).toBe(402);
      expect(envelopeError(rejected.json)).toMatchObject({
        code: 'insufficient_credit',
        details: { available: 10, required: 30 },
      });
      expect(emu.getWallet().balance).toBe(10);
      expect(detailOf(campaignId).dailyBudget).toBe(10);

      emu.dispatch({
        method: 'POST',
        path: '/__emulator/wallet',
        body: { balance: 100 },
      });
      const retried = increase(
        campaignId,
        { amount: 30, mode: 'current_cycle' },
        'bi-402-key',
      );
      expect(retried.status).toBe(200);
    });

    it('replays the same key without debiting twice', () => {
      const campaignId = createActive('bi-replay');
      setCycleDay(campaignId, 2);
      const before = emu.getWallet().balance;

      const first = increase(campaignId, { amount: 30 }, 'bi-replay-key');
      const second = increase(campaignId, { amount: 30 }, 'bi-replay-key');

      expect(second.status).toBe(200);
      expect(envelopeData(second.json)).toEqual(envelopeData(first.json));
      expect(emu.getWallet().balance).toBe(before - 30);
    });

    it('returns idempotency_key_conflict for the same key with a different body', () => {
      const campaignId = createActive('bi-conflict');
      setCycleDay(campaignId, 2);
      increase(campaignId, { amount: 30 }, 'bi-conflict-key');

      const response = increase(campaignId, { amount: 40 }, 'bi-conflict-key');

      expect(response.status).toBe(409);
      expect(envelopeError(response.json).code).toBe('idempotency_key_conflict');
    });

    it('requires an Idempotency-Key', () => {
      const campaignId = createActive('bi-nokey');

      const response = increase(campaignId, { amount: 30 }, undefined);

      expect(response.status).toBe(400);
    });

    it('returns 404 for an unknown campaign', () => {
      const response = increase('missing-campaign', { amount: 30 }, 'bi-404');

      expect(response.status).toBe(404);
      expect(envelopeError(response.json).code).toBe('campaign_not_found');
    });

    it('rejects a campaign that is not active', () => {
      const created = emu.dispatch({
        method: 'POST',
        path: '/v1/campaigns',
        headers: authHeaders('bi-creating-create'),
        body: DEFAULT_CREATE_BODY,
      });
      const campaignId = asCampaignCreate(envelopeData(created.json)).campaignId;

      const response = increase(campaignId, { amount: 30 }, 'bi-creating');

      expect(response.status).toBe(400);
      expect(envelopeError(response.json).message).toContain('creating');
    });

    it('refunds the topped-up amount when the campaign is stopped unspent', () => {
      const campaignId = createActive('bi-refund');
      setCycleDay(campaignId, 2);
      increase(campaignId, { amount: 30 }, 'bi-refund-key');

      emu.dispatch({
        method: 'POST',
        path: `/v1/campaigns/${campaignId}/stop`,
        headers: authHeaders('bi-refund-stop'),
      });

      expect(emu.getWallet().balance).toBe(INITIAL_BALANCE);
    });
  });

  describe('through the SDK client', () => {
    it('increases the budget over HTTP', async () => {
      const campaignId = createActive('sdk-bi-create');
      setCycleDay(campaignId, 4);
      httpServer = await emu.listen({ port: 0 });
      const soundlink = new Soundlink({
        apiKey: EMULATOR_API_KEY,
        baseUrl: httpServer.baseUrl,
      });

      const result = await soundlink.campaigns.increaseBudget(
        campaignId,
        { amount: 30, mode: 'current_cycle' },
        { idempotencyKey: 'sdk-bi-http' },
      );

      expect(result.error).toBeNull();
      expect(result.data).toMatchObject({
        campaignId,
        amount: 30,
        walletNextCycleDailyBudget: null,
      });
    });
  });
});
