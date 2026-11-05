import { describe, expect, it } from 'vitest';
import { createApiEmulator } from '../../src/emulator/index.js';
import { resolveEmulatorPlan } from '../../src/emulator/plans.js';
import {
  asCampaignCreate,
  authHeaders,
  DEFAULT_CREATE_BODY,
  EMULATOR_API_KEY,
  envelopeData,
} from './helpers.js';

describe('emulator plans', () => {
  it('resolveEmulatorPlan uses plan fee unless feeRate overrides', () => {
    expect(resolveEmulatorPlan({ plan: 'enterprise' }).feeRate).toBe(0.1);
    expect(resolveEmulatorPlan({ plan: 'label_power' }).feeRate).toBe(0.15);
    expect(resolveEmulatorPlan({ plan: 'studio' }).feeRate).toBe(0.2);
    expect(resolveEmulatorPlan({ plan: 'studio' }).premium).toBe(false);
    expect(resolveEmulatorPlan({ plan: 'enterprise', feeRate: 0 }).feeRate).toBe(0);
    expect(resolveEmulatorPlan({}).feeRate).toBe(0);
  });

  it('rejects invalid feeRate', () => {
    expect(() => resolveEmulatorPlan({ feeRate: 1 })).toThrow(/feeRate/);
    expect(() => resolveEmulatorPlan({ feeRate: -0.1 })).toThrow(/feeRate/);
  });

  it('enterprise plan applies fee on refund and overview', () => {
    const emu = createApiEmulator({
      apiKey: EMULATOR_API_KEY,
      plan: 'enterprise',
      initialWalletBalance: 500,
    });
    expect(emu.getPlan()).toMatchObject({
      plan: 'enterprise',
      feeRate: 0.1,
      premium: true,
    });

    const create = emu.dispatch({
      method: 'POST',
      path: '/v1/campaigns',
      headers: authHeaders('plan-ent-create'),
      body: DEFAULT_CREATE_BODY,
    });
    const { campaignId } = asCampaignCreate(envelopeData(create.json));
    emu.transition(campaignId, 'activate');
    emu.transition(campaignId, 'set_spend', 40);

    const overview = envelopeData(
      emu.dispatch({
        method: 'GET',
        path: `/v1/campaigns/${campaignId}/metrics/overview`,
        headers: authHeaders(),
      }).json,
    ) as { spend_media: number; fees: number; spend_total: number };
    expect(overview.spend_media).toBe(40);
    // fees = 40/0.9 - 40 ≈ 4.44
    expect(overview.fees).toBe(4.44);
    expect(overview.spend_total).toBe(44.44);

    const stop = emu.dispatch({
      method: 'POST',
      path: `/v1/campaigns/${campaignId}/stop`,
      headers: authHeaders('plan-ent-stop'),
      body: {},
    });
    expect(stop.status).toBe(200);
    // refund = committed - grossEquiv = 70 - 40/0.9 ≈ 25.56
    // wallet = 500 - 70 + 25.56 = 455.56
    expect(emu.getWallet().balance).toBe(455.56);
  });

  it('feeRate override wins over plan fee', () => {
    const emu = createApiEmulator({
      apiKey: EMULATOR_API_KEY,
      plan: 'enterprise',
      feeRate: 0,
      initialWalletBalance: 500,
    });
    expect(emu.getPlan().feeRate).toBe(0);
    expect(emu.getPlan().plan).toBe('enterprise');
  });
});
