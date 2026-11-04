import { describe, expect, it } from 'vitest';
import { createEmulator } from '../../src/emulator/index.js';
import { computeRefundGrossFromRawSpend } from '../../src/emulator/money.js';
import {
  asCampaignCreate,
  authHeaders,
  DEFAULT_CREATE_BODY,
  EMULATOR_API_KEY,
  envelopeData,
} from './helpers.js';

describe('emulator transition guards and money', () => {
  it('rejects createEmulator apiKey without sk_ prefix', () => {
    expect(() => createEmulator({ apiKey: 'not-a-key' })).toThrow(/sk_/);
  });

  it('computeRefundGrossFromRawSpend matches feeRate 0 and positive fee', () => {
    expect(computeRefundGrossFromRawSpend(40, 70, 0)).toBe(30);
    // grossEquiv = 40 / 0.9 ≈ 44.444… → refund = 70 - 44.44 = 25.56
    expect(computeRefundGrossFromRawSpend(40, 70, 0.1)).toBe(25.56);
  });

  it('activate / set_spend / end / reject_meta enforce status guards', () => {
    const emu = createEmulator({
      apiKey: EMULATOR_API_KEY,
      initialWalletBalance: 500,
    });

    const create = emu.dispatch({
      method: 'POST',
      path: '/v1/campaigns',
      headers: authHeaders('guards-create'),
      body: DEFAULT_CREATE_BODY,
    });
    const campaignId = asCampaignCreate(envelopeData(create.json)).campaignId;

    expect(() => emu.transition(campaignId, 'end')).toThrow(/Cannot end/);
    expect(() => emu.transition(campaignId, 'set_spend', -1)).toThrow(/mediaSpendUsd/);
    expect(() => emu.transition(campaignId, 'set_spend', 9999)).toThrow(
      /mediaSpendUsd/,
    );
    expect(() => emu.transition('missing', 'activate')).toThrow(/not found/i);

    emu.transition(campaignId, 'activate');
    expect(() => emu.transition(campaignId, 'activate')).toThrow(/Cannot activate/);

    emu.transition(campaignId, 'set_spend', 10);
    emu.transition(campaignId, 'end');
    expect(() => emu.transition(campaignId, 'set_spend', 5)).toThrow(
      /Cannot set_spend/,
    );
    expect(() => emu.transition(campaignId, 'reject_meta')).toThrow(/reject_meta/);
  });

  it('reject_meta from active is allowed', () => {
    const emu = createEmulator({
      apiKey: EMULATOR_API_KEY,
      initialWalletBalance: 500,
    });
    const create = emu.dispatch({
      method: 'POST',
      path: '/v1/campaigns',
      headers: authHeaders('guards-reject-active'),
      body: DEFAULT_CREATE_BODY,
    });
    const campaignId = asCampaignCreate(envelopeData(create.json)).campaignId;
    emu.transition(campaignId, 'activate');
    const result = emu.transition(campaignId, 'reject_meta');
    expect(result.status).toBe('inactive');
  });

  it('harness transition returns 400 for unknown action', () => {
    const emu = createEmulator({ apiKey: EMULATOR_API_KEY });
    const create = emu.dispatch({
      method: 'POST',
      path: '/v1/campaigns',
      headers: authHeaders('guards-bad-action'),
      body: DEFAULT_CREATE_BODY,
    });
    const campaignId = asCampaignCreate(envelopeData(create.json)).campaignId;

    const res = emu.dispatch({
      method: 'POST',
      path: `/__emulator/campaigns/${campaignId}/transition`,
      headers: { 'content-type': 'application/json' },
      body: { action: 'explode' },
    });
    expect(res.status).toBe(400);
  });

  it('create validation rejects incomplete body', () => {
    const emu = createEmulator({ apiKey: EMULATOR_API_KEY });
    const res = emu.dispatch({
      method: 'POST',
      path: '/v1/campaigns',
      headers: authHeaders('guards-bad-body'),
      body: { spotifyUrl: 'https://open.spotify.com/track/x' },
    });
    expect(res.status).toBe(400);
  });
});
