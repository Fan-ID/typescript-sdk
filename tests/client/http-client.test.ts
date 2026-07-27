import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { Soundlink } from '../../src/index.js';
import { BASE_URL, TEST_API_KEY, errorEnvelope } from '../mocks/handlers.js';
import { server } from '../mocks/server.js';

describe('HttpClient errors and retries', () => {
  it('returns API errors without throwing', async () => {
    server.use(
      http.get(`${BASE_URL}/v1/campaigns/missing`, () =>
        errorEnvelope('campaign_not_found', 'Campaign not found.', 404),
      ),
    );

    const soundlink = new Soundlink({ apiKey: TEST_API_KEY, baseUrl: BASE_URL });
    const { data, error } = await soundlink.campaigns.get('missing');

    expect(data).toBeNull();
    expect(error?.code).toBe('campaign_not_found');
    expect(error?.status).toBe(404);
    expect(error?.requestId).toBeTruthy();
  });

  it('retries on 429 and succeeds', async () => {
    let attempts = 0;

    server.use(
      http.get(`${BASE_URL}/v1/ping`, () => {
        attempts += 1;
        if (attempts === 1) {
          return errorEnvelope('rate_limit_exceeded', 'Slow down.', 429, {
            'Retry-After': '0',
          });
        }

        return HttpResponse.json({
          data: { status: 'ok' },
          meta: { requestId: 'retry-success' },
        });
      }),
    );

    const soundlink = new Soundlink({
      apiKey: TEST_API_KEY,
      baseUrl: BASE_URL,
      maxRetries: 2,
    });

    const { data, error } = await soundlink.ping();
    expect(error).toBeNull();
    expect(data).toEqual({ status: 'ok' });
    expect(attempts).toBe(2);
  });

  it('retries POST writes on 5xx with the same Idempotency-Key', async () => {
    let attempts = 0;
    const keys: Array<string | null> = [];

    server.use(
      http.post(`${BASE_URL}/v1/campaigns/:campaignId/stop`, ({ request }) => {
        attempts += 1;
        keys.push(request.headers.get('Idempotency-Key'));
        if (attempts === 1) {
          return errorEnvelope('internal_error', 'Temporary failure.', 503);
        }

        return HttpResponse.json({
          data: { campaignId: 'camp_abc123', status: 'stopped' },
          meta: { requestId: 'retry-write' },
        });
      }),
    );

    const soundlink = new Soundlink({
      apiKey: TEST_API_KEY,
      baseUrl: BASE_URL,
      maxRetries: 2,
    });

    const { data, error } = await soundlink.campaigns.stop('camp_abc123', {
      idempotencyKey: 'stop-retry-01',
    });

    expect(error).toBeNull();
    expect(data?.status).toBe('stopped');
    expect(attempts).toBe(2);
    expect(keys).toEqual(['stop-retry-01', 'stop-retry-01']);
  });
});
