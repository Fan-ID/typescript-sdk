import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Soundlink } from '../../src/index.js';
import {
  createApiEmulator,
  type ApiEmulator,
  type EmulatorServer,
} from '../../src/emulator/index.js';
import type { CampaignDetail } from '../../src/types/api.js';
import {
  asCampaignCreate,
  authHeaders,
  DEFAULT_CREATE_BODY,
  EMULATOR_API_KEY,
  envelopeData,
  envelopeError,
} from './helpers.js';

const INITIAL_BALANCE = 500;
/** 20 * 7 days. */
const COMMITTED_USD = 140;

describe('emulator budget decrease', () => {
  let emu: ApiEmulator;
  let httpServer: EmulatorServer | undefined;

  beforeEach(() => {
    emu = createApiEmulator({
      apiKey: EMULATOR_API_KEY,
      initialWalletBalance: INITIAL_BALANCE,
    });
  });

  afterEach(async () => {
    if (httpServer) {
      await httpServer.close();
      httpServer = undefined;
    }
  });

  function createCampaign(idempotencyKey: string, activate = true): string {
    const created = emu.dispatch({
      method: 'POST',
      path: '/v1/campaigns',
      headers: authHeaders(idempotencyKey),
      body: { ...DEFAULT_CREATE_BODY, dailyBudget: 20 },
    });
    expect(created.status).toBe(201);
    const campaignId = asCampaignCreate(envelopeData(created.json)).campaignId;
    if (activate) {
      emu.transition(campaignId, 'activate');
    }
    return campaignId;
  }

  function detailOf(campaignId: string): CampaignDetail {
    const response = emu.dispatch({
      method: 'GET',
      path: `/v1/campaigns/${campaignId}`,
      headers: authHeaders(),
    });
    return envelopeData(response.json) as CampaignDetail;
  }

  function decrease(campaignId: string, body: unknown, idempotencyKey?: string) {
    return emu.dispatch({
      method: 'POST',
      path: `/v1/campaigns/${campaignId}/budget/decrease`,
      headers: authHeaders(idempotencyKey),
      body,
    });
  }

  it('lowers dailyBudget, refunds the unused days and sets the next-cycle budget by default', () => {
    const campaignId = createCampaign('bd-default');
    const before = emu.getWallet().balance;

    const response = decrease(campaignId, { targetDailyBudget: 12 }, 'bd-default-key');

    expect(response.status).toBe(200);
    expect(envelopeData(response.json)).toEqual({
      campaignId,
      mode: 'current_and_renewals',
      targetDailyBudget: 12,
      accepted: true,
      walletNextCycleDailyBudget: 12,
    });
    // (20 - 12) * 6 remaining days
    expect(emu.getWallet().balance).toBe(before + 48);
    const detail = detailOf(campaignId);
    expect(detail.dailyBudget).toBe(12);
    expect(detail.totalBudget).toBe(COMMITTED_USD - 48);
  });

  it('omits walletNextCycleDailyBudget for current_cycle', () => {
    const campaignId = createCampaign('bd-current');

    const response = decrease(
      campaignId,
      { targetDailyBudget: 15, mode: 'current_cycle' },
      'bd-current-key',
    );

    expect(response.status).toBe(200);
    const data = envelopeData(response.json) as Record<string, unknown>;
    expect(data).toEqual({
      campaignId,
      mode: 'current_cycle',
      targetDailyBudget: 15,
      accepted: true,
    });
    expect(detailOf(campaignId).dailyBudget).toBe(15);
  });

  it('accepts 4 days remaining and rejects 3 or fewer', () => {
    const accepted = createCampaign('bd-days-ok');
    emu.transition(accepted, 'set_metrics', undefined, undefined, { cycleDay: 3 });
    expect(decrease(accepted, { targetDailyBudget: 12 }, 'bd-days-ok-key').status).toBe(
      200,
    );

    const rejected = createCampaign('bd-days-late');
    emu.transition(rejected, 'set_metrics', undefined, undefined, { cycleDay: 4 });
    const before = emu.getWallet().balance;

    const response = decrease(rejected, { targetDailyBudget: 12 }, 'bd-days-late-key');

    expect(response.status).toBe(400);
    expect(envelopeError(response.json).code).toBe('invalid_request');
    expect(envelopeError(response.json).message).toContain('More than 3 days');
    expect(emu.getWallet().balance).toBe(before);
    expect(detailOf(rejected).dailyBudget).toBe(20);
  });

  it.each([
    ['a target equal to the current budget', { targetDailyBudget: 20 }],
    ['a target above the current budget', { targetDailyBudget: 25 }],
    ['a target below the minimum', { targetDailyBudget: 9 }],
    ['a missing target', {}],
    ['a string target', { targetDailyBudget: '12' }],
    ['next_renewal mode', { targetDailyBudget: 12, mode: 'next_renewal' }],
  ])('rejects %s', (name, body) => {
    const campaignId = createCampaign(`bd-bad-${name}`);

    const response = decrease(campaignId, body, `bd-bad-key-${name}`);

    expect(response.status).toBe(400);
    expect(envelopeError(response.json).code).toBe('invalid_request');
    expect(detailOf(campaignId).dailyBudget).toBe(20);
  });

  it('replays the same key without refunding twice', () => {
    const campaignId = createCampaign('bd-replay');
    const before = emu.getWallet().balance;

    const first = decrease(campaignId, { targetDailyBudget: 12 }, 'bd-replay-key');
    const second = decrease(campaignId, { targetDailyBudget: 12 }, 'bd-replay-key');

    expect(second.status).toBe(200);
    expect(envelopeData(second.json)).toEqual(envelopeData(first.json));
    expect(emu.getWallet().balance).toBe(before + 48);
  });

  it('returns idempotency_key_conflict for the same key with a different body', () => {
    const campaignId = createCampaign('bd-conflict');
    decrease(campaignId, { targetDailyBudget: 12 }, 'bd-conflict-key');

    const response = decrease(campaignId, { targetDailyBudget: 11 }, 'bd-conflict-key');

    expect(response.status).toBe(409);
    expect(envelopeError(response.json).code).toBe('idempotency_key_conflict');
  });

  it('requires an Idempotency-Key', () => {
    const campaignId = createCampaign('bd-nokey');

    expect(decrease(campaignId, { targetDailyBudget: 12 }, undefined).status).toBe(400);
  });

  it('returns 404 for an unknown campaign', () => {
    const response = decrease('missing-campaign', { targetDailyBudget: 12 }, 'bd-404');

    expect(response.status).toBe(404);
    expect(envelopeError(response.json).code).toBe('campaign_not_found');
  });

  it('rejects a campaign that is not active', () => {
    const campaignId = createCampaign('bd-creating', false);

    const response = decrease(campaignId, { targetDailyBudget: 12 }, 'bd-creating-key');

    expect(response.status).toBe(400);
    expect(envelopeError(response.json).message).toContain('creating');
  });

  it('keeps the wallet whole when the campaign is stopped unspent afterwards', () => {
    const campaignId = createCampaign('bd-stop');
    decrease(campaignId, { targetDailyBudget: 12 }, 'bd-stop-key');

    emu.dispatch({
      method: 'POST',
      path: `/v1/campaigns/${campaignId}/stop`,
      headers: authHeaders('bd-stop-stop'),
    });

    expect(emu.getWallet().balance).toBe(INITIAL_BALANCE);
  });

  it('decreases the budget over HTTP through the SDK client', async () => {
    const campaignId = createCampaign('sdk-bd-create');
    httpServer = await emu.listen({ port: 0 });
    const soundlink = new Soundlink({
      apiKey: EMULATOR_API_KEY,
      baseUrl: httpServer.baseUrl,
    });

    const result = await soundlink.campaigns.decreaseBudget(
      campaignId,
      { targetDailyBudget: 12, mode: 'current_cycle' },
      { idempotencyKey: 'sdk-bd-http' },
    );

    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({
      campaignId,
      targetDailyBudget: 12,
      accepted: true,
    });
  });
});
