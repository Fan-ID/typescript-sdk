import { beforeEach, describe, expect, it } from 'vitest';
import { Soundlink } from '../../src/index.js';
import { BASE_URL, TEST_API_KEY } from '../mocks/handlers.js';

describe('Campaigns resource', () => {
  let soundlink: Soundlink;

  beforeEach(() => {
    soundlink = new Soundlink({ apiKey: TEST_API_KEY, baseUrl: BASE_URL });
  });

  it('lists campaigns with pagination', async () => {
    const { data, error } = await soundlink.campaigns.list({ page: 1, pageSize: 10 });

    expect(error).toBeNull();
    expect(data?.items).toHaveLength(1);
    expect(data?.pagination.totalCount).toBe(1);
  });

  it('gets a campaign by id', async () => {
    const { data, error } = await soundlink.campaigns.get('camp_abc123');

    expect(error).toBeNull();
    expect(data?.campaignId).toBe('camp_abc123');
    expect(data?.strategyType).toBe('custom');
  });

  it('iterates all campaigns via listAll', async () => {
    const items = [];
    for await (const campaign of soundlink.campaigns.listAll({ pageSize: 10 })) {
      items.push(campaign);
    }

    expect(items).toHaveLength(1);
    expect(items[0]?.campaignId).toBe('camp_abc123');
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

  it('lists engagement metrics (spec-ready endpoint)', async () => {
    const { data, error } = await soundlink.metrics.engagement.list('camp_abc123');

    expect(error).toBeNull();
    expect(data?.schemaVersion).toBe('1.0');
  });

  it('returns not_found for engagement list when route is unavailable', async () => {
    const { data, error } = await soundlink.metrics.engagement.list('missing');

    expect(data).toBeNull();
    expect(error?.code).toBe('not_found');
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
