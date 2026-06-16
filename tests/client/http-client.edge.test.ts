import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import {
  HttpClient,
  Soundlink,
  SoundlinkParseError,
  getStreamRowCount,
} from '../../src/index.js';
import { BASE_URL, TEST_API_KEY, errorEnvelope } from '../mocks/handlers.js';
import { server } from '../mocks/server.js';

describe('HttpClient edge cases', () => {
  it('throws on malformed JSON success responses', async () => {
    server.use(
      http.get(
        `${BASE_URL}/v1/ping`,
        () => new HttpResponse('not-json', { status: 200 }),
      ),
    );

    const httpClient = new HttpClient({ apiKey: TEST_API_KEY, baseUrl: BASE_URL });

    await expect(httpClient.get({ path: '/ping' })).rejects.toBeInstanceOf(
      SoundlinkParseError,
    );
  });

  it('throws on unexpected success response shape', async () => {
    server.use(
      http.get(`${BASE_URL}/v1/ping`, () =>
        HttpResponse.json({ unexpected: true }, { status: 200 }),
      ),
    );

    const httpClient = new HttpClient({ apiKey: TEST_API_KEY, baseUrl: BASE_URL });

    await expect(httpClient.get({ path: '/ping' })).rejects.toBeInstanceOf(
      SoundlinkParseError,
    );
  });

  it('returns generic error when error body is not JSON', async () => {
    server.use(
      http.get(
        `${BASE_URL}/v1/campaigns`,
        () => new HttpResponse('bad gateway', { status: 502 }),
      ),
    );

    const httpClient = new HttpClient({ apiKey: TEST_API_KEY, baseUrl: BASE_URL });
    const { data, error } = await httpClient.get({ path: '/campaigns' });

    expect(data).toBeNull();
    expect(error?.code).toBe('internal_error');
    expect(error?.status).toBe(502);
  });

  it('retries on 500 responses', async () => {
    let attempts = 0;

    server.use(
      http.get(`${BASE_URL}/v1/ping`, () => {
        attempts += 1;
        if (attempts === 1) {
          return errorEnvelope('internal_error', 'temporary', 500);
        }

        return HttpResponse.json({
          data: { status: 'ok' },
          meta: { requestId: 'recovered' },
        });
      }),
    );

    const httpClient = new HttpClient({
      apiKey: TEST_API_KEY,
      baseUrl: BASE_URL,
      maxRetries: 1,
    });

    const { data, error } = await httpClient.get({ path: '/ping' });
    expect(error).toBeNull();
    expect(data).toEqual({ status: 'ok' });
    expect(attempts).toBe(2);
  });

  it('exposes row count metadata on jsonl streams', async () => {
    const httpClient = new HttpClient({ apiKey: TEST_API_KEY, baseUrl: BASE_URL });
    const { data } = await httpClient.getJsonl({
      path: '/campaigns/camp_abc123/metrics/breakdown/export',
    });

    expect(data).toBeDefined();
    if (!data) {
      return;
    }

    expect(getStreamRowCount(data)).toBe(2);
  });

  it('returns API errors for jsonl endpoints', async () => {
    server.use(
      http.get(`${BASE_URL}/v1/campaigns/:campaignId/metrics/breakdown/export`, () =>
        errorEnvelope('campaign_not_found', 'missing', 404),
      ),
    );

    const httpClient = new HttpClient({ apiKey: TEST_API_KEY, baseUrl: BASE_URL });
    const { data, error } = await httpClient.getJsonl({
      path: '/campaigns/missing/metrics/breakdown/export',
    });

    expect(data).toBeNull();
    expect(error?.code).toBe('campaign_not_found');
  });

  it('returns API errors when jsonl endpoint responds with JSON content type', async () => {
    server.use(
      http.get(`${BASE_URL}/v1/campaigns/:campaignId/metrics/breakdown/export`, () =>
        errorEnvelope('insufficient_scope', 'nope', 403),
      ),
    );

    const httpClient = new HttpClient({ apiKey: TEST_API_KEY, baseUrl: BASE_URL });
    const { data, error } = await httpClient.getJsonl({
      path: '/campaigns/camp_abc123/metrics/breakdown/export',
    });

    expect(data).toBeNull();
    expect(error?.code).toBe('insufficient_scope');
  });
});

describe('Export collect error path', () => {
  it('returns API errors from collect without throwing', async () => {
    server.use(
      http.get(`${BASE_URL}/v1/campaigns/:campaignId/metrics/breakdown/export`, () =>
        errorEnvelope('campaign_not_found', 'missing', 404),
      ),
    );

    const soundlink = new Soundlink({
      apiKey: TEST_API_KEY,
      baseUrl: BASE_URL,
    });

    const { data, error } = await soundlink.metrics.breakdown.export.collect('missing');
    expect(data).toBeNull();
    expect(error?.code).toBe('campaign_not_found');
  });
});
