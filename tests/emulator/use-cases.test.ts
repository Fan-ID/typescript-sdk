import { beforeEach, describe, expect, it } from 'vitest';
import { createEmulator, type SoundlinkEmulator } from '../../src/emulator/index.js';
import type {
  CampaignDetail,
  CampaignStopData,
  MetricsOverview,
} from '../../src/types/api.js';
import {
  asCampaignCreate,
  asWallet,
  authHeaders,
  DEFAULT_COMMITTED_USD,
  DEFAULT_CREATE_BODY,
  EMULATOR_API_KEY,
  envelopeData,
  envelopeError,
} from './helpers.js';

const INITIAL_BALANCE = 500;

describe('emulator use cases', () => {
  let emu: SoundlinkEmulator;

  beforeEach(() => {
    emu = createEmulator({
      apiKey: EMULATOR_API_KEY,
      initialWalletBalance: INITIAL_BALANCE,
      feeRate: 0,
    });
  });

  function createCampaign(idempotencyKey: string, body: unknown = DEFAULT_CREATE_BODY) {
    return emu.dispatch({
      method: 'POST',
      path: '/v1/campaigns',
      headers: authHeaders(idempotencyKey),
      body,
    });
  }

  function getCampaign(campaignId: string) {
    return emu.dispatch({
      method: 'GET',
      path: `/v1/campaigns/${campaignId}`,
      headers: authHeaders(),
    });
  }

  function getWallet() {
    return emu.dispatch({
      method: 'GET',
      path: '/v1/wallet',
      headers: authHeaders(),
    });
  }

  function getOverview(campaignId: string, query = '') {
    return emu.dispatch({
      method: 'GET',
      path: `/v1/campaigns/${campaignId}/metrics/overview${query}`,
      headers: authHeaders(),
    });
  }

  function stopCampaign(campaignId: string, idempotencyKey: string) {
    return emu.dispatch({
      method: 'POST',
      path: `/v1/campaigns/${campaignId}/stop`,
      headers: authHeaders(idempotencyKey),
      body: {},
    });
  }

  function harnessTransition(
    campaignId: string,
    action: string,
    mediaSpendUsd?: number,
  ) {
    return emu.dispatch({
      method: 'POST',
      path: `/__emulator/campaigns/${campaignId}/transition`,
      headers: { 'content-type': 'application/json' },
      body: mediaSpendUsd === undefined ? { action } : { action, mediaSpendUsd },
    });
  }

  describe('DoD 1 — happy path create → activate → overview → set_spend → stop', () => {
    it('debits wallet, activates, seeds overview, refunds once after partial spend', () => {
      const create = createCampaign('create-happy-1');
      expect(create.status).toBe(201);

      const created = asCampaignCreate(envelopeData(create.json));
      expect(created.status).toBe('creating');
      expect(created.autoRenew).toBe(false);
      expect(created.campaignId.length).toBeGreaterThan(0);

      const walletAfterCreate = asWallet(envelopeData(getWallet().json));
      expect(walletAfterCreate.balance).toBe(INITIAL_BALANCE - DEFAULT_COMMITTED_USD);
      expect(walletAfterCreate.available).toBe(walletAfterCreate.balance);
      expect(walletAfterCreate.reserved).toBe(0);
      expect(walletAfterCreate.currency).toBe('USD');
      expect(typeof walletAfterCreate.updatedAt).toBe('string');

      const detailCreating = envelopeData(
        getCampaign(created.campaignId).json,
      ) as CampaignDetail;
      expect(detailCreating.status).toBe('creating');
      expect(detailCreating.generation).toBe(3);
      expect(detailCreating.socialPlatform).toBe('meta');
      expect(detailCreating.organizationId).toBe('org_emulator');
      expect(detailCreating.dailyBudget).toBe(10);
      expect(detailCreating.campaignDuration).toBe(7);
      expect(detailCreating.totalBudget).toBe(DEFAULT_COMMITTED_USD);

      const activate = harnessTransition(created.campaignId, 'activate');
      expect(activate.status).toBe(200);
      expect((envelopeData(activate.json) as { status: string }).status).toBe('active');

      const detailActive = envelopeData(
        getCampaign(created.campaignId).json,
      ) as CampaignDetail;
      expect(detailActive.status).toBe('active');

      const overviewRes = getOverview(
        created.campaignId,
        '?startDate=2026-01-01&endDate=2026-01-31',
      );
      expect(overviewRes.status).toBe(200);
      const overview = envelopeData(overviewRes.json) as MetricsOverview;
      expect(overview.listeners).toBeGreaterThan(0);
      expect(overview.total_listeners).toBeGreaterThanOrEqual(overview.listeners);
      expect(overview.streams).toBeGreaterThan(0);
      expect(overview.followers).toBeGreaterThanOrEqual(0);
      expect(overview.spend_media).toBe(0);
      expect(overview.spend_total).toBe(0);
      expect(overview.fees).toBe(0);
      expect(overview.currency).toBe('USD');
      expect(typeof overview.cpl).toBe('number');
      expect(typeof overview.cpf).toBe('number');
      expect(typeof overview.streams_per_listener).toBe('number');
      expect(
        overview.impressions === null || typeof overview.impressions === 'number',
      ).toBe(true);
      expect(
        overview.ad_clicks === null || typeof overview.ad_clicks === 'number',
      ).toBe(true);
      expect(
        overview.link_clicks === null || typeof overview.link_clicks === 'number',
      ).toBe(true);

      const setSpend = harnessTransition(created.campaignId, 'set_spend', 40);
      expect(setSpend.status).toBe(200);

      const overviewAfterSpend = envelopeData(
        getOverview(created.campaignId).json,
      ) as MetricsOverview;
      expect(overviewAfterSpend.spend_media).toBe(40);
      expect(overviewAfterSpend.spend_total).toBe(40);
      expect(overviewAfterSpend.fees).toBe(0);

      const stop = stopCampaign(created.campaignId, 'stop-happy-1');
      expect(stop.status).toBe(200);
      const stopped = envelopeData(stop.json) as CampaignStopData;
      expect(stopped.campaignId).toBe(created.campaignId);
      expect(stopped.status).toBe('stopped');

      const detailStopped = envelopeData(
        getCampaign(created.campaignId).json,
      ) as CampaignDetail;
      expect(detailStopped.status).toBe('stopped');

      const walletFinal = asWallet(envelopeData(getWallet().json));
      expect(walletFinal.balance).toBe(INITIAL_BALANCE - 40);
      expect(walletFinal.available).toBe(walletFinal.balance);
      expect(walletFinal.reserved).toBe(0);
    });
  });

  describe('DoD 2 — create 402 releases Idempotency-Key', () => {
    it('returns insufficient_credit with details and no campaign; same key succeeds after setWallet', () => {
      emu = createEmulator({
        apiKey: EMULATOR_API_KEY,
        initialWalletBalance: 10,
        feeRate: 0,
      });

      const first = createCampaign('create-402-same-key');
      expect(first.status).toBe(402);
      const err = envelopeError(first.json);
      expect(err.code).toBe('insufficient_credit');
      expect(err.message).toBe('Insufficient wallet balance for this campaign.');
      expect(err.details).toEqual({
        available: 10,
        required: DEFAULT_COMMITTED_USD,
      });

      const list = emu.dispatch({
        method: 'GET',
        path: '/v1/campaigns',
        headers: authHeaders(),
      });
      expect(list.status).toBe(200);
      expect((envelopeData(list.json) as { items: unknown[] }).items).toEqual([]);

      const topUp = emu.dispatch({
        method: 'POST',
        path: '/__emulator/wallet',
        headers: { 'content-type': 'application/json' },
        body: { balance: INITIAL_BALANCE },
      });
      expect(topUp.status).toBe(200);
      expect(asWallet(envelopeData(topUp.json)).balance).toBe(INITIAL_BALANCE);

      const retry = createCampaign('create-402-same-key');
      expect(retry.status).toBe(201);
      const created = asCampaignCreate(envelopeData(retry.json));
      expect(created.status).toBe('creating');
      expect(created.campaignId.length).toBeGreaterThan(0);
    });
  });

  describe('DoD 3 — reject_meta does not credit until stop', () => {
    it('moves to inactive without refund; stop then refunds full committed', () => {
      const create = createCampaign('create-reject-1');
      const { campaignId } = asCampaignCreate(envelopeData(create.json));
      const walletPostCreate = asWallet(envelopeData(getWallet().json));
      expect(walletPostCreate.balance).toBe(INITIAL_BALANCE - DEFAULT_COMMITTED_USD);

      const reject = harnessTransition(campaignId, 'reject_meta');
      expect(reject.status).toBe(200);
      expect((envelopeData(reject.json) as { status: string }).status).toBe('inactive');

      const detail = envelopeData(getCampaign(campaignId).json) as CampaignDetail;
      expect(detail.status).toBe('inactive');

      const walletAfterReject = asWallet(envelopeData(getWallet().json));
      expect(walletAfterReject.balance).toBe(walletPostCreate.balance);

      const stop = stopCampaign(campaignId, 'stop-after-reject');
      expect(stop.status).toBe(200);
      expect((envelopeData(stop.json) as CampaignStopData).status).toBe('stopped');

      const walletFinal = asWallet(envelopeData(getWallet().json));
      expect(walletFinal.balance).toBe(INITIAL_BALANCE);
      expect(walletFinal.reserved).toBe(0);
    });
  });

  describe('DoD 4 — end partial spend; stop afterwards does not re-credit', () => {
    it('ends with refund once; subsequent stop returns same status without second credit', () => {
      const create = createCampaign('create-end-1');
      const { campaignId } = asCampaignCreate(envelopeData(create.json));

      expect(harnessTransition(campaignId, 'activate').status).toBe(200);
      expect(harnessTransition(campaignId, 'set_spend', 25).status).toBe(200);

      const end = harnessTransition(campaignId, 'end');
      expect(end.status).toBe(200);
      expect((envelopeData(end.json) as { status: string }).status).toBe('ended');

      const detailEnded = envelopeData(getCampaign(campaignId).json) as CampaignDetail;
      expect(detailEnded.status).toBe('ended');

      const walletAfterEnd = asWallet(envelopeData(getWallet().json));
      expect(walletAfterEnd.balance).toBe(INITIAL_BALANCE - 25);

      const stop = stopCampaign(campaignId, 'stop-after-end');
      expect(stop.status).toBe(200);
      const stopped = envelopeData(stop.json) as CampaignStopData;
      expect(stopped.campaignId).toBe(campaignId);
      expect(stopped.status).toBe('ended');

      const walletAfterStop = asWallet(envelopeData(getWallet().json));
      expect(walletAfterStop.balance).toBe(walletAfterEnd.balance);

      const stopAgain = stopCampaign(campaignId, 'stop-after-end-2');
      expect(stopAgain.status).toBe(200);
      expect((envelopeData(stopAgain.json) as CampaignStopData).status).toBe('ended');
      expect(asWallet(envelopeData(getWallet().json)).balance).toBe(
        walletAfterEnd.balance,
      );
    });

    it('second stop on stopped returns 200 same status without re-credit', () => {
      const create = createCampaign('create-double-stop');
      const { campaignId } = asCampaignCreate(envelopeData(create.json));
      expect(harnessTransition(campaignId, 'activate').status).toBe(200);
      expect(harnessTransition(campaignId, 'set_spend', 10).status).toBe(200);

      const firstStop = stopCampaign(campaignId, 'stop-double-1');
      expect(firstStop.status).toBe(200);
      expect((envelopeData(firstStop.json) as CampaignStopData).status).toBe('stopped');

      const walletAfterFirst = asWallet(envelopeData(getWallet().json));
      expect(walletAfterFirst.balance).toBe(INITIAL_BALANCE - 10);

      const secondStop = stopCampaign(campaignId, 'stop-double-2');
      expect(secondStop.status).toBe(200);
      const stopped = envelopeData(secondStop.json) as CampaignStopData;
      expect(stopped.campaignId).toBe(campaignId);
      expect(stopped.status).toBe('stopped');
      expect(asWallet(envelopeData(getWallet().json)).balance).toBe(
        walletAfterFirst.balance,
      );
    });
  });

  describe('DoD 5 — idempotency conflict and stop-while-creating key release', () => {
    it('replays create 201 for same key+hash; conflicts on different body', () => {
      const first = createCampaign('create-idem-1');
      expect(first.status).toBe(201);
      const firstData = asCampaignCreate(envelopeData(first.json));

      const replay = createCampaign('create-idem-1');
      expect(replay.status).toBe(201);
      expect(asCampaignCreate(envelopeData(replay.json))).toEqual(firstData);

      const conflict = createCampaign('create-idem-1', {
        ...DEFAULT_CREATE_BODY,
        dailyBudget: 20,
      });
      expect(conflict.status).toBe(409);
      expect(envelopeError(conflict.json).code).toBe('idempotency_key_conflict');
      expect(envelopeError(conflict.json).message).toBe(
        'This Idempotency-Key was already used with a different request body.',
      );
    });

    it('releases stop key on 400 while creating; same key works after activate', () => {
      const create = createCampaign('create-for-stop-key');
      const { campaignId } = asCampaignCreate(envelopeData(create.json));

      const stopCreating = stopCampaign(campaignId, 'stop-key-reuse');
      expect(stopCreating.status).toBe(400);
      expect(envelopeError(stopCreating.json).code).toBe('invalid_request');

      expect(harnessTransition(campaignId, 'activate').status).toBe(200);

      const stopActive = stopCampaign(campaignId, 'stop-key-reuse');
      expect(stopActive.status).toBe(200);
      expect((envelopeData(stopActive.json) as CampaignStopData).status).toBe(
        'stopped',
      );
    });

    it('rejects missing or oversized Idempotency-Key with 400 invalid_request', () => {
      const missing = emu.dispatch({
        method: 'POST',
        path: '/v1/campaigns',
        headers: authHeaders(),
        body: DEFAULT_CREATE_BODY,
      });
      expect(missing.status).toBe(400);
      expect(envelopeError(missing.json).code).toBe('invalid_request');
      expect(envelopeError(missing.json).message).toBe(
        'Idempotency-Key header is required and must not be empty.',
      );

      const tooLong = createCampaign('x'.repeat(256));
      expect(tooLong.status).toBe(400);
      expect(envelopeError(tooLong.json).code).toBe('invalid_request');
      expect(envelopeError(tooLong.json).message).toBe(
        'Idempotency-Key must not exceed 255 characters.',
      );
    });
  });

  describe('DoD 6 — not found codes and auth', () => {
    it('returns campaign_not_found for missing campaign and not_found for unknown path', () => {
      const missing = getCampaign('cmp_does_not_exist');
      expect(missing.status).toBe(404);
      expect(envelopeError(missing.json).code).toBe('campaign_not_found');

      const unknown = emu.dispatch({
        method: 'GET',
        path: '/v1/does-not-exist',
        headers: authHeaders(),
      });
      expect(unknown.status).toBe(404);
      expect(envelopeError(unknown.json).code).toBe('not_found');
    });

    it('returns 401 invalid_api_key without Bearer sk_', () => {
      const res = emu.dispatch({
        method: 'GET',
        path: '/v1/ping',
        headers: {},
      });
      expect(res.status).toBe(401);
      expect(envelopeError(res.json).code).toBe('invalid_api_key');
      expect(envelopeError(res.json).message).toBe(
        'Missing credentials. Send Authorization: Bearer.',
      );
    });

    it('ping and strategies succeed', () => {
      const ping = emu.dispatch({
        method: 'GET',
        path: '/v1/ping',
        headers: authHeaders(),
      });
      expect(ping.status).toBe(200);
      expect((envelopeData(ping.json) as { status: string }).status).toBe('ok');

      const strategies = emu.dispatch({
        method: 'GET',
        path: '/v1/strategies',
        headers: authHeaders(),
      });
      expect(strategies.status).toBe(200);
      expect(
        (envelopeData(strategies.json) as { strategies: unknown[] }).strategies.length,
      ).toBeGreaterThan(0);
    });
  });

  describe('harness reset', () => {
    it('clears campaigns and restores initial wallet balance', () => {
      createCampaign('create-before-reset');
      expect(
        (
          envelopeData(
            emu.dispatch({
              method: 'GET',
              path: '/v1/campaigns',
              headers: authHeaders(),
            }).json,
          ) as { items: unknown[] }
        ).items,
      ).toHaveLength(1);

      const reset = emu.dispatch({
        method: 'POST',
        path: '/__emulator/reset',
        headers: { 'content-type': 'application/json' },
        body: {},
      });
      expect(reset.status).toBe(200);
      expect((envelopeData(reset.json) as { ok: boolean }).ok).toBe(true);

      expect(
        (
          envelopeData(
            emu.dispatch({
              method: 'GET',
              path: '/v1/campaigns',
              headers: authHeaders(),
            }).json,
          ) as { items: unknown[] }
        ).items,
      ).toHaveLength(0);
      expect(asWallet(envelopeData(getWallet().json)).balance).toBe(INITIAL_BALANCE);
    });
  });
});
