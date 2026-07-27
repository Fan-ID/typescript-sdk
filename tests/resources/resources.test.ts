import { http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { Soundlink } from '../../src/index.js';
import { BASE_URL, TEST_API_KEY, errorEnvelope } from '../mocks/handlers.js';
import { server } from '../mocks/server.js';

describe('Strategies resource', () => {
  let soundlink: Soundlink;

  beforeEach(() => {
    soundlink = new Soundlink({ apiKey: TEST_API_KEY, baseUrl: BASE_URL });
  });

  it('lists strategies', async () => {
    const { data, error } = await soundlink.strategies.list();

    expect(error).toBeNull();
    expect(data?.strategies).toHaveLength(4);
    expect(
      data?.strategies.find((s) => s.strategyType === 'custom')?.tierTargetingAllowed,
    ).toBe(true);
  });
});

describe('Campaigns resource', () => {
  let soundlink: Soundlink;

  beforeEach(() => {
    soundlink = new Soundlink({ apiKey: TEST_API_KEY, baseUrl: BASE_URL });
  });

  it('lists campaigns with pagination', async () => {
    const { data, error } = await soundlink.campaigns.list({ page: 1, pageSize: 10 });

    expect(error).toBeNull();
    expect(data?.items).toHaveLength(1);
    expect(data?.items[0]?.generation).toBe(3);
    expect(data?.pagination.totalCount).toBe(1);
  });

  it('gets a campaign by id', async () => {
    const { data, error } = await soundlink.campaigns.get('camp_abc123');

    expect(error).toBeNull();
    expect(data?.campaignId).toBe('camp_abc123');
    expect(data?.strategyType).toBe('custom');
    expect(data?.generation).toBe(3);
  });

  it('iterates all campaigns via listAll', async () => {
    const items = [];
    for await (const campaign of soundlink.campaigns.listAll({ pageSize: 10 })) {
      items.push(campaign);
    }

    expect(items).toHaveLength(1);
    expect(items[0]?.campaignId).toBe('camp_abc123');
  });

  it('creates a campaign with Idempotency-Key', async () => {
    const { data, error } = await soundlink.campaigns.create(
      {
        spotifyUrl: 'https://open.spotify.com/track/6habFhsOp2NvndAvgiJ01P',
        dailyBudget: 20,
        durationDays: 7,
        genre: 'Pop',
        strategyType: 'maximum_growth',
      },
      { idempotencyKey: 'create-test-01' },
    );

    expect(error).toBeNull();
    expect(data?.campaignId).toBe('camp_new123');
    expect(data?.status).toBe('creating');
  });

  it('returns idempotency_key_conflict on create', async () => {
    const { data, error } = await soundlink.campaigns.create(
      {
        spotifyUrl: 'https://open.spotify.com/track/6habFhsOp2NvndAvgiJ01P',
        dailyBudget: 20,
        durationDays: 7,
        genre: 'Pop',
        strategyType: 'maximum_growth',
      },
      { idempotencyKey: 'conflict-key' },
    );

    expect(data).toBeNull();
    expect(error?.code).toBe('idempotency_key_conflict');
    expect(error?.status).toBe(409);
  });

  it('returns insufficient_credit on create', async () => {
    server.use(
      http.post(`${BASE_URL}/v1/campaigns`, () =>
        errorEnvelope(
          'insufficient_credit',
          'Insufficient wallet balance for this campaign.',
          402,
        ),
      ),
    );

    const { data, error } = await soundlink.campaigns.create(
      {
        spotifyUrl: 'https://open.spotify.com/track/6habFhsOp2NvndAvgiJ01P',
        dailyBudget: 20,
        durationDays: 7,
        genre: 'Pop',
        strategyType: 'maximum_growth',
      },
      { idempotencyKey: 'create-no-credit' },
    );

    expect(data).toBeNull();
    expect(error?.code).toBe('insufficient_credit');
    expect(error?.status).toBe(402);
  });

  it('stops a campaign', async () => {
    const { data, error } = await soundlink.campaigns.stop('camp_abc123', {
      idempotencyKey: 'stop-01',
    });

    expect(error).toBeNull();
    expect(data?.status).toBe('stopped');
  });

  it('increases budget', async () => {
    const { data, error } = await soundlink.campaigns.increaseBudget(
      'camp_abc123',
      { amount: 50, mode: 'current_and_renewals' },
      { idempotencyKey: 'inc-01' },
    );

    expect(error).toBeNull();
    expect(data?.amount).toBe(50);
    expect(data?.walletBalance).toBe(500);
  });

  it('decreases budget', async () => {
    const { data, error } = await soundlink.campaigns.decreaseBudget(
      'camp_abc123',
      { targetDailyBudget: 15 },
      { idempotencyKey: 'dec-01' },
    );

    expect(error).toBeNull();
    expect(data?.accepted).toBe(true);
    expect(data?.targetDailyBudget).toBe(15);
  });

  it('gets and updates tiers', async () => {
    const getResult = await soundlink.campaigns.tiers.get('camp_abc123');
    expect(getResult.error).toBeNull();
    expect(getResult.data?.tiers).toHaveLength(1);

    const updateResult = await soundlink.campaigns.tiers.update('camp_abc123', {
      items: [
        {
          targetingTierId: 1,
          isEnabled: true,
          newAllocationPercent: 100,
        },
      ],
    });

    expect(updateResult.error).toBeNull();
    expect(updateResult.data?.lastUpdate).toBeTruthy();
    expect(updateResult.data?.tiers[0]?.allocationPercent).toBe(100);
  });
});

describe('Metrics resource', () => {
  let soundlink: Soundlink;

  beforeEach(() => {
    soundlink = new Soundlink({ apiKey: TEST_API_KEY, baseUrl: BASE_URL });
  });

  it('fetches metrics overview', async () => {
    const { data, error } = await soundlink.metrics.overview('camp_abc123', {
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });

    expect(error).toBeNull();
    expect(data?.listeners).toBe(100);
  });

  it('lists breakdown metrics', async () => {
    const { data, error } = await soundlink.metrics.breakdown.list('camp_abc123');

    expect(error).toBeNull();
    expect(data?.items[0]?.country_code).toBe('US');
  });

  it('streams breakdown export rows', async () => {
    const { data, error } = await soundlink.metrics.breakdown.export('camp_abc123');

    expect(error).toBeNull();
    expect(data).toBeDefined();

    const rows = [];
    if (data) {
      for await (const row of data) {
        rows.push(row);
      }
    }

    expect(rows).toHaveLength(2);
  });

  it('collects breakdown export rows', async () => {
    const { data, error } =
      await soundlink.metrics.breakdown.export.collect('camp_abc123');

    expect(error).toBeNull();
    expect(data?.rowCount).toBe(2);
    expect(data?.rows).toHaveLength(2);
  });

  it('streams engagement export rows', async () => {
    const { data, error } = await soundlink.metrics.engagement.export('camp_abc123');

    expect(error).toBeNull();

    const rows = [];
    if (data) {
      for await (const row of data) {
        rows.push(row);
      }
    }

    expect(rows).toHaveLength(1);
  });
});
