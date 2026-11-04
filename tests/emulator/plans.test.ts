import { describe, expect, it } from 'vitest';
import { createEmulator } from '../../src/emulator/index.js';
import {
  EMULATOR_PLAN_PRESETS,
  resolveEmulatorPlan,
} from '../../src/emulator/plans.js';
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
    const selfServe = resolveEmulatorPlan({ plan: 'self_serve_5000' });
    expect(selfServe.maxNewListeners).toBe(5000);
    expect(selfServe.premium).toBe(true);
  });

  it('rejects invalid feeRate', () => {
    expect(() => resolveEmulatorPlan({ feeRate: 1 })).toThrow(/feeRate/);
    expect(() => resolveEmulatorPlan({ feeRate: -0.1 })).toThrow(/feeRate/);
  });

  it('enterprise plan applies fee on refund and overview', () => {
    const emu = createEmulator({
      apiKey: EMULATOR_API_KEY,
      plan: 'enterprise',
      initialWalletBalance: 500,
    });
    expect(emu.getPlan()).toMatchObject({
      plan: 'enterprise',
      feeRate: 0.1,
      premium: true,
      maxNewListeners: null,
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

  it('self_serve_5000 caps activate listeners and blocks when exhausted', () => {
    const emu = createEmulator({
      apiKey: EMULATOR_API_KEY,
      plan: 'self_serve_5000',
      // tiny allowance via override is not supported — use consume by activating
      // many times against 5000 with default seed 120 → floor(5000/120)=41 activates
      initialWalletBalance: 100_000,
    });
    expect(emu.getPlan().maxNewListeners).toBe(
      EMULATOR_PLAN_PRESETS.self_serve_5000.maxNewListeners,
    );

    // Force near-exhaustion: consume 5000 - 0 by activating with custom path —
    // seed grants min(120, remaining). Exhaust by looping.
    let lastId = '';
    for (let i = 0; i < 42; i += 1) {
      const create = emu.dispatch({
        method: 'POST',
        path: '/v1/campaigns',
        headers: authHeaders(`plan-ss-create-${String(i)}`),
        body: DEFAULT_CREATE_BODY,
      });
      expect(create.status).toBe(201);
      lastId = asCampaignCreate(envelopeData(create.json)).campaignId;
      if (emu.getPlan().remainingNewListeners === 0) {
        expect(() => emu.transition(lastId, 'activate')).toThrow(/listener limit/);
        break;
      }
      emu.transition(lastId, 'activate');
    }

    expect(emu.getPlan().usedNewListeners).toBe(5000);
    expect(emu.getPlan().remainingNewListeners).toBe(0);
  });

  it('feeRate override wins over plan fee', () => {
    const emu = createEmulator({
      apiKey: EMULATOR_API_KEY,
      plan: 'enterprise',
      feeRate: 0,
      initialWalletBalance: 500,
    });
    expect(emu.getPlan().feeRate).toBe(0);
    expect(emu.getPlan().plan).toBe('enterprise');
  });
});
