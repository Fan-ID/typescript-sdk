import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { Soundlink } from '../../src/index.js';
import { BASE_URL, TEST_API_KEY } from '../mocks/handlers.js';
import { server } from '../mocks/server.js';

describe('Strategies resource', () => {
  let soundlink: Soundlink;

  beforeEach(() => {
    soundlink = new Soundlink({ apiKey: TEST_API_KEY, baseUrl: BASE_URL });
  });

  it('lists strategies', async () => {
    const response = await soundlink.strategies.list();

    expect(response).toMatchObject({
      error: null,
      data: {
        strategies: [
          { strategyType: 'maximum_growth', tierTargetingAllowed: false },
          { strategyType: 'market_discovery', tierTargetingAllowed: false },
          { strategyType: 'revenue_maximization', tierTargetingAllowed: false },
          { strategyType: 'custom', tierTargetingAllowed: true },
        ],
      },
    });
  });
});

describe('Campaigns resource', () => {
  let soundlink: Soundlink;

  beforeEach(() => {
    soundlink = new Soundlink({ apiKey: TEST_API_KEY, baseUrl: BASE_URL });
  });

  it('lists campaigns with pagination', async () => {
    const response = await soundlink.campaigns.list({ page: 1, pageSize: 10 });

    expect(response).toMatchObject({
      error: null,
      data: {
        items: [{ generation: 3 }],
        pagination: { totalCount: 1 },
      },
    });
  });

  it('gets a campaign by id', async () => {
    const response = await soundlink.campaigns.get('camp_abc123');

    expect(response).toMatchObject({
      error: null,
      data: {
        campaignId: 'camp_abc123',
        strategyType: 'custom',
        generation: 3,
      },
    });
  });

  it('iterates all campaigns via listAll', async () => {
    const items: Array<{ campaignId: string }> = [];
    for await (const campaign of soundlink.campaigns.listAll({ pageSize: 10 })) {
      items.push(campaign);
    }

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ campaignId: 'camp_abc123' });
  });

  it('creates a campaign with Idempotency-Key', async () => {
    const response = await soundlink.campaigns.create(
      {
        spotifyUrl: 'https://open.spotify.com/track/6habFhsOp2NvndAvgiJ01P',
        dailyBudget: 20,
        durationDays: 7,
        genre: 'Pop',
        strategyType: 'maximum_growth',
      },
      { idempotencyKey: 'create-test-01' },
    );

    expect(response).toMatchObject({
      error: null,
      data: { campaignId: 'camp_new123', status: 'creating' },
    });
  });

  it('returns idempotency_key_conflict on create', async () => {
    const response = await soundlink.campaigns.create(
      {
        spotifyUrl: 'https://open.spotify.com/track/6habFhsOp2NvndAvgiJ01P',
        dailyBudget: 20,
        durationDays: 7,
        genre: 'Pop',
        strategyType: 'maximum_growth',
      },
      { idempotencyKey: 'conflict-key' },
    );

    expect(response).toMatchObject({
      data: null,
      error: { code: 'idempotency_key_conflict', status: 409 },
    });
  });

  it('returns insufficient_credit on create', async () => {
    server.use(
      http.post(`${BASE_URL}/v1/campaigns`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'insufficient_credit',
              message: 'Insufficient wallet balance for this campaign.',
              details: { available: 10, required: 140 },
            },
            meta: { requestId: '550e8400-e29b-41d4-a716-446655440000' },
          },
          { status: 402 },
        ),
      ),
    );

    const response = await soundlink.campaigns.create(
      {
        spotifyUrl: 'https://open.spotify.com/track/6habFhsOp2NvndAvgiJ01P',
        dailyBudget: 20,
        durationDays: 7,
        genre: 'Pop',
        strategyType: 'maximum_growth',
      },
      { idempotencyKey: 'create-no-credit' },
    );

    expect(response).toMatchObject({
      data: null,
      error: {
        code: 'insufficient_credit',
        status: 402,
        details: { available: 10, required: 140 },
      },
    });
  });

  it('stops a campaign', async () => {
    const response = await soundlink.campaigns.stop('camp_abc123', {
      idempotencyKey: 'stop-01',
    });

    expect(response).toMatchObject({
      error: null,
      data: { status: 'stopped' },
    });
  });

  it('increases budget', async () => {
    const response = await soundlink.campaigns.increaseBudget(
      'camp_abc123',
      { amount: 50, mode: 'current_and_renewals' },
      { idempotencyKey: 'inc-01' },
    );

    expect(response).toMatchObject({
      error: null,
      data: { amount: 50, walletBalance: 500 },
    });
  });

  it('decreases budget', async () => {
    const response = await soundlink.campaigns.decreaseBudget(
      'camp_abc123',
      { targetDailyBudget: 15 },
      { idempotencyKey: 'dec-01' },
    );

    expect(response).toMatchObject({
      error: null,
      data: { accepted: true, targetDailyBudget: 15 },
    });
  });

  it('gets and updates tiers', async () => {
    const getResult = await soundlink.campaigns.tiers.get('camp_abc123');
    expect(getResult).toMatchObject({
      error: null,
      data: { tiers: [{ tierId: 1 }] },
    });

    const updateResult = await soundlink.campaigns.tiers.update('camp_abc123', {
      items: [
        {
          targetingTierId: 1,
          isEnabled: true,
          newAllocationPercent: 100,
        },
      ],
    });

    expect(updateResult).toMatchObject({
      error: null,
      data: {
        lastUpdate: '2026-07-27T12:00:00.000Z',
        tiers: [{ allocationPercent: 100 }],
      },
    });
  });
});

describe('Metrics resource', () => {
  let soundlink: Soundlink;

  beforeEach(() => {
    soundlink = new Soundlink({ apiKey: TEST_API_KEY, baseUrl: BASE_URL });
  });

  it('fetches metrics overview', async () => {
    const response = await soundlink.metrics.overview('camp_abc123', {
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });

    expect(response).toMatchObject({
      error: null,
      data: { listeners: 100 },
    });
  });

  it('lists breakdown metrics', async () => {
    const response = await soundlink.metrics.breakdown.list('camp_abc123');

    expect(response).toMatchObject({
      error: null,
      data: { items: [{ country_code: 'US' }] },
    });
  });

  it('streams breakdown export rows', async () => {
    const response = await soundlink.metrics.breakdown.export('camp_abc123');

    expect(response.error).toBeNull();
    expect(response.data).toBeDefined();

    const rows: unknown[] = [];
    if (response.data) {
      for await (const row of response.data) {
        rows.push(row);
      }
    }

    expect(rows).toHaveLength(2);
  });

  it('collects breakdown export rows', async () => {
    const response = await soundlink.metrics.breakdown.export.collect('camp_abc123');

    expect(response.error).toBeNull();
    expect(response.data?.rowCount).toBe(2);
    expect(response.data?.rows).toHaveLength(2);
  });

  it('streams engagement export rows', async () => {
    const response = await soundlink.metrics.engagement.export('camp_abc123');

    expect(response.error).toBeNull();

    const rows: unknown[] = [];
    if (response.data) {
      for await (const row of response.data) {
        rows.push(row);
      }
    }

    expect(rows).toHaveLength(1);
  });
});

describe('Soundlinks resource', () => {
  let soundlink: Soundlink;

  beforeEach(() => {
    soundlink = new Soundlink({ apiKey: TEST_API_KEY, baseUrl: BASE_URL });
  });

  it('lists soundlinks with pagination', async () => {
    const response = await soundlink.soundlinks.list({ page: 1, pageSize: 10 });

    expect(response).toMatchObject({
      error: null,
      data: {
        items: [{ soundlinkId: 'sl_abc123', status: 'active' }],
        pagination: { totalCount: 1 },
      },
    });
  });

  it('gets a soundlink by id', async () => {
    const response = await soundlink.soundlinks.get('sl_abc123');

    expect(response).toMatchObject({
      error: null,
      data: {
        soundlinkId: 'sl_abc123',
        autoFollow: true,
        metaPixelId: '1234567890123456',
        tiktokPixelId: null,
      },
    });
  });

  it('returns not_found for a missing soundlink', async () => {
    const response = await soundlink.soundlinks.get('missing');

    expect(response).toMatchObject({
      data: null,
      error: { code: 'not_found', status: 404 },
    });
  });

  it('fetches soundlink metrics overview', async () => {
    const response = await soundlink.soundlinks.metricsOverview('sl_abc123', {
      startDate: '2026-08-01',
      endDate: '2026-08-31',
    });

    expect(response).toMatchObject({
      error: null,
      data: { views: 4821, streams: 9340, listeners: 3980 },
    });
  });

  it('lists soundlink breakdown rows', async () => {
    const response = await soundlink.soundlinks.breakdown.list('sl_abc123', {
      page: 1,
      pageSize: 50,
    });

    expect(response).toMatchObject({
      error: null,
      data: {
        schemaVersion: '1.0',
        items: [
          { soundlink_id: 'sl_abc123', country_code: 'US', report_date: '2026-08-01' },
        ],
      },
    });
  });

  it('streams soundlink breakdown export rows', async () => {
    const response = await soundlink.soundlinks.breakdown.export('sl_abc123', {
      startDate: '2026-08-01',
      endDate: '2026-08-31',
    });

    expect(response.error).toBeNull();
    expect(response.data).toBeDefined();

    const rows: unknown[] = [];
    if (response.data) {
      for await (const row of response.data) {
        rows.push(row);
      }
    }

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ soundlink_id: 'sl_abc123', country_code: 'US' });
  });

  it('lists soundlink engagement rows', async () => {
    const response = await soundlink.soundlinks.engagement.list('sl_abc123', {
      engagementContext: 'catalog',
    });

    expect(response).toMatchObject({
      error: null,
      data: {
        schemaVersion: '1.0',
        items: [
          {
            soundlink_id: 'sl_abc123',
            engagement_context: 'catalog',
            engaged_spotify_track_id: '4cOdK2wGLETKBW3PvgPWqT',
          },
        ],
      },
    });
  });

  it('streams soundlink engagement export rows', async () => {
    const response = await soundlink.soundlinks.engagement.export('sl_abc123');

    expect(response.error).toBeNull();
    expect(response.data).toBeDefined();

    const rows: unknown[] = [];
    if (response.data) {
      for await (const row of response.data) {
        rows.push(row);
      }
    }

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      soundlink_id: 'sl_abc123',
      engagement_context: 'catalog',
      streams: 89,
    });
  });
});
