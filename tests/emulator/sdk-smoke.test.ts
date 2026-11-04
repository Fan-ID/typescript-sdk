import { afterEach, describe, expect, it } from 'vitest';
import { Soundlink } from '../../src/index.js';
import {
  createApiEmulator,
  type EmulatorServer,
  type ApiEmulator,
} from '../../src/emulator/index.js';
import {
  DEFAULT_COMMITTED_USD,
  DEFAULT_CREATE_BODY,
  EMULATOR_API_KEY,
} from './helpers.js';

describe('emulator SDK smoke', () => {
  let emu: ApiEmulator;
  let httpServer: EmulatorServer | undefined;
  const initialBalance = 500;

  afterEach(async () => {
    if (httpServer) {
      await httpServer.close();
      httpServer = undefined;
    }
  });

  it('create → activate → overview → set_spend → stop via SDK baseUrl', async () => {
    emu = createApiEmulator({
      apiKey: EMULATOR_API_KEY,
      initialWalletBalance: initialBalance,
      feeRate: 0,
    });
    httpServer = await emu.listen({ port: 0 });

    const soundlink = new Soundlink({
      apiKey: EMULATOR_API_KEY,
      baseUrl: httpServer.baseUrl,
    });

    const ping = await soundlink.ping();
    expect(ping.error).toBeNull();
    expect(ping.data?.status).toBe('ok');

    const walletBefore = await soundlink.wallet.get();
    expect(walletBefore.data?.balance).toBe(initialBalance);
    expect(walletBefore.data?.reserved).toBe(0);

    const created = await soundlink.campaigns.create(DEFAULT_CREATE_BODY, {
      idempotencyKey: 'sdk-smoke-create',
    });
    expect(created.error).toBeNull();
    expect(created.data?.status).toBe('creating');
    const campaignId = created.data?.campaignId;
    expect(typeof campaignId).toBe('string');
    if (!campaignId) {
      throw new Error('expected campaignId');
    }

    const walletAfterCreate = await soundlink.wallet.get();
    expect(walletAfterCreate.data?.balance).toBe(
      initialBalance - DEFAULT_COMMITTED_USD,
    );

    const activate = await fetch(
      `${httpServer.baseUrl}/__emulator/campaigns/${campaignId}/transition`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'activate' }),
      },
    );
    expect(activate.status).toBe(200);

    const detail = await soundlink.campaigns.get(campaignId);
    expect(detail.error).toBeNull();
    expect(detail.data?.status).toBe('active');
    expect(detail.data?.generation).toBe(3);

    const overview = await soundlink.metrics.overview(campaignId, {
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });
    expect(overview.error).toBeNull();
    expect(overview.data).not.toBeNull();
    if (!overview.data) {
      throw new Error('expected overview data');
    }
    expect(overview.data.listeners).toBeGreaterThan(0);
    expect(overview.data.spend_media).toBe(0);
    expect(overview.data.fees).toBe(0);
    expect(overview.data.spend_total).toBe(overview.data.spend_media);

    const setSpend = await fetch(
      `${httpServer.baseUrl}/__emulator/campaigns/${campaignId}/transition`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_spend', mediaSpendUsd: 40 }),
      },
    );
    expect(setSpend.status).toBe(200);

    const stopped = await soundlink.campaigns.stop(campaignId, {
      idempotencyKey: 'sdk-smoke-stop',
    });
    expect(stopped.error).toBeNull();
    expect(stopped.data?.status).toBe('stopped');

    const walletFinal = await soundlink.wallet.get();
    expect(walletFinal.data?.balance).toBe(initialBalance - 40);
    expect(walletFinal.data?.available).toBe(walletFinal.data?.balance);
    expect(walletFinal.data?.reserved).toBe(0);
  });
});
