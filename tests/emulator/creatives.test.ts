import { beforeEach, describe, expect, it } from 'vitest';
import { createApiEmulator, type ApiEmulator } from '../../src/emulator/index.js';
import type { CreativeMetrics, CreativeMetricsBatch } from '../../src/types/api.js';
import {
  asCampaignCreate,
  authHeaders,
  DEFAULT_CREATE_BODY,
  EMULATOR_API_KEY,
  envelopeData,
  envelopeError,
} from './helpers.js';

describe('emulator creative metrics', () => {
  let emu: ApiEmulator;

  beforeEach(() => {
    emu = createApiEmulator({
      apiKey: EMULATOR_API_KEY,
      initialWalletBalance: 500,
    });
  });

  function createCampaign(idempotencyKey: string) {
    return emu.dispatch({
      method: 'POST',
      path: '/v1/campaigns',
      headers: authHeaders(idempotencyKey),
      body: DEFAULT_CREATE_BODY,
    });
  }

  it('returns creatives with delivery_state null by default', () => {
    const create = createCampaign('creatives-default');
    const campaignId = asCampaignCreate(envelopeData(create.json)).campaignId;
    emu.transition(campaignId, 'activate');

    const response = emu.dispatch({
      method: 'GET',
      path: `/v1/campaigns/${campaignId}/metrics/creatives`,
      headers: authHeaders(),
    });

    expect(response.status).toBe(200);
    const data = envelopeData(response.json) as CreativeMetrics;
    expect(data.creatives).toHaveLength(1);
    expect(data.creatives[0]?.children[0]?.delivery_state).toBeNull();
  });

  it('sets delivery_state to disapproved after disapprove_creatives', () => {
    const create = createCampaign('creatives-disapproved');
    const campaignId = asCampaignCreate(envelopeData(create.json)).campaignId;
    emu.transition(campaignId, 'activate');
    emu.transition(campaignId, 'disapprove_creatives');

    const response = emu.dispatch({
      method: 'GET',
      path: `/v1/campaigns/${campaignId}/metrics/creatives`,
      headers: authHeaders(),
    });

    const data = envelopeData(response.json) as CreativeMetrics;
    expect(data.creatives[0]?.children[0]?.delivery_state).toBe('disapproved');
  });

  it('returns delivery_reason null by default', () => {
    const create = createCampaign('creatives-reason-default');
    const campaignId = asCampaignCreate(envelopeData(create.json)).campaignId;
    emu.transition(campaignId, 'activate');

    const response = emu.dispatch({
      method: 'GET',
      path: `/v1/campaigns/${campaignId}/metrics/creatives`,
      headers: authHeaders(),
    });

    const data = envelopeData(response.json) as CreativeMetrics;
    expect(data.creatives[0]?.children[0]?.delivery_reason).toBeNull();
  });

  it('sets delivery_reason from disapprove_creatives', () => {
    const create = createCampaign('creatives-reason-spam');
    const campaignId = asCampaignCreate(envelopeData(create.json)).campaignId;
    emu.transition(campaignId, 'activate');
    emu.transition(campaignId, 'disapprove_creatives', undefined, 'Spam');

    const response = emu.dispatch({
      method: 'GET',
      path: `/v1/campaigns/${campaignId}/metrics/creatives`,
      headers: authHeaders(),
    });

    const child = (envelopeData(response.json) as CreativeMetrics).creatives[0]
      ?.children[0];
    expect(child?.delivery_state).toBe('disapproved');
    expect(child?.delivery_reason).toBe('Spam');
  });

  it('keeps delivery_reason null when disapprove_creatives has no reason', () => {
    const create = createCampaign('creatives-reason-missing');
    const campaignId = asCampaignCreate(envelopeData(create.json)).campaignId;
    emu.transition(campaignId, 'activate');
    emu.transition(campaignId, 'disapprove_creatives');

    const response = emu.dispatch({
      method: 'GET',
      path: `/v1/campaigns/${campaignId}/metrics/creatives`,
      headers: authHeaders(),
    });

    const child = (envelopeData(response.json) as CreativeMetrics).creatives[0]
      ?.children[0];
    expect(child?.delivery_state).toBe('disapproved');
    expect(child?.delivery_reason).toBeNull();
  });

  it('accepts reason on the harness transition route', () => {
    const create = createCampaign('creatives-reason-harness');
    const campaignId = asCampaignCreate(envelopeData(create.json)).campaignId;
    emu.dispatch({
      method: 'POST',
      path: `/__emulator/campaigns/${campaignId}/transition`,
      body: { action: 'activate' },
    });

    const transition = emu.dispatch({
      method: 'POST',
      path: `/__emulator/campaigns/${campaignId}/transition`,
      body: { action: 'disapprove_creatives', reason: 'Spam' },
    });
    expect(transition.status).toBe(200);

    const response = emu.dispatch({
      method: 'GET',
      path: `/v1/campaigns/${campaignId}/metrics/creatives`,
      headers: authHeaders(),
    });
    const child = (envelopeData(response.json) as CreativeMetrics).creatives[0]
      ?.children[0];
    expect(child?.delivery_reason).toBe('Spam');
  });

  it('batches creatives and omits unknown campaign ids', () => {
    const first = asCampaignCreate(
      envelopeData(createCampaign('creatives-batch-a').json),
    ).campaignId;
    const second = asCampaignCreate(
      envelopeData(createCampaign('creatives-batch-b').json),
    ).campaignId;
    emu.transition(first, 'activate');
    emu.transition(second, 'activate');
    emu.transition(second, 'disapprove_creatives');

    const response = emu.dispatch({
      method: 'POST',
      path: '/v1/campaigns/metrics/creatives/batch',
      headers: authHeaders(),
      body: { campaignIds: [first, 'missing', second] },
    });

    expect(response.status).toBe(200);
    const data = envelopeData(response.json) as CreativeMetricsBatch;
    expect(data.items.map((item) => item.campaignId)).toEqual([first, second]);
    expect(data.items[0]?.creatives[0]?.children[0]?.delivery_state).toBeNull();
    expect(data.items[1]?.creatives[0]?.children[0]?.delivery_state).toBe(
      'disapproved',
    );
  });

  it('rejects empty creatives batch campaignIds', () => {
    const response = emu.dispatch({
      method: 'POST',
      path: '/v1/campaigns/metrics/creatives/batch',
      headers: authHeaders(),
      body: { campaignIds: [] },
    });

    expect(response.status).toBe(400);
    expect(envelopeError(response.json).code).toBe('invalid_request');
  });

  it('deduplicates creatives batch campaignIds', () => {
    const campaignId = asCampaignCreate(
      envelopeData(createCampaign('creatives-batch-dedupe').json),
    ).campaignId;
    emu.transition(campaignId, 'activate');

    const response = emu.dispatch({
      method: 'POST',
      path: '/v1/campaigns/metrics/creatives/batch',
      headers: authHeaders(),
      body: { campaignIds: [campaignId, campaignId] },
    });

    expect(response.status).toBe(200);
    const data = envelopeData(response.json) as CreativeMetricsBatch;
    expect(data.items).toHaveLength(1);
    expect(data.items[0]?.campaignId).toBe(campaignId);
  });

  it('rejects creatives batch with more than 50 campaignIds', () => {
    const response = emu.dispatch({
      method: 'POST',
      path: '/v1/campaigns/metrics/creatives/batch',
      headers: authHeaders(),
      body: {
        campaignIds: Array.from({ length: 51 }, (_, index) => `camp_${String(index)}`),
      },
    });

    expect(response.status).toBe(400);
    expect(envelopeError(response.json).message).toMatch(/at most 50/);
  });

  it('rejects creatives batch startDate and endDate', () => {
    const response = emu.dispatch({
      method: 'POST',
      path: '/v1/campaigns/metrics/creatives/batch',
      headers: authHeaders(),
      body: {
        campaignIds: ['camp_a'],
        startDate: '2026-01-01',
      },
    });

    expect(response.status).toBe(400);
    expect(envelopeError(response.json).message).toMatch(/startDate and endDate/);
  });
});
