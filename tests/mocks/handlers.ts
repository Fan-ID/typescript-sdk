import { http, HttpResponse } from 'msw';

export const BASE_URL = 'https://api.getsoundlink.com';

export const TEST_API_KEY = 'sk_test_prefix_secret';

export const REQUEST_ID = '550e8400-e29b-41d4-a716-446655440000';

export function successEnvelope(data: unknown) {
  return HttpResponse.json({
    data,
    meta: { requestId: REQUEST_ID },
  });
}

export function errorEnvelope(
  code: string,
  message: string,
  status = 400,
  headers?: Record<string, string>,
) {
  return HttpResponse.json(
    {
      error: { code, message },
      meta: { requestId: REQUEST_ID },
    },
    { status, headers },
  );
}

export const handlers = [
  http.get(`${BASE_URL}/v1/ping`, ({ request }) => {
    const apiKey = request.headers.get('x-api-key');
    if (!apiKey) {
      return errorEnvelope('invalid_api_key', 'Missing API key.', 401);
    }
    return successEnvelope({ status: 'ok' });
  }),

  http.get(`${BASE_URL}/v1/campaigns`, ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '10');

    return successEnvelope({
      items: [
        {
          campaignId: 'camp_abc123',
          organizationId: 'org_xyz',
          status: 'active',
          socialPlatform: 'meta',
          dailyBudget: 20,
          totalBudget: 140,
          campaignDuration: 7,
          createdAt: '2026-04-01T10:00:00.000Z',
          updatedAt: '2026-04-08T12:00:00.000Z',
        },
      ],
      pagination: {
        page,
        pageSize,
        totalCount: 1,
        totalPages: 1,
      },
    });
  }),

  http.get(`${BASE_URL}/v1/campaigns/:campaignId`, ({ params }) => {
    if (params.campaignId === 'missing') {
      return errorEnvelope('campaign_not_found', 'Campaign not found.', 404);
    }

    return successEnvelope({
      campaignId: String(params.campaignId),
      organizationId: 'org_xyz',
      status: 'active',
      socialPlatform: 'meta',
      dailyBudget: 20,
      totalBudget: 140,
      campaignDuration: 7,
      strategyType: 'custom',
      createdAt: '2026-04-01T10:00:00.000Z',
      updatedAt: '2026-04-08T12:00:00.000Z',
    });
  }),

  http.get(`${BASE_URL}/v1/campaigns/:campaignId/metrics/overview`, () => {
    return successEnvelope({
      listeners: 100,
      streams: 200,
      followers: 10,
      impressions: null,
      ad_clicks: null,
      link_clicks: null,
      spend_media: 50,
      spend_total: 50,
      fees: 0,
      currency: 'USD',
      cpl: 0.5,
      cpf: 5,
      streams_per_listener: 2,
    });
  }),

  http.get(`${BASE_URL}/v1/campaigns/:campaignId/metrics/breakdown`, () => {
    return successEnvelope({
      schemaVersion: '1.0',
      items: [
        {
          provider: 'soundlink',
          account_id: 'org_xyz',
          schema_version: '1.0',
          report_date: '2026-04-01',
          report_date_timezone: 'UTC',
          exported_at: '2026-05-20T03:00:00.000Z',
          campaign_id: 'camp_abc123',
          campaign_name: 'Sleep Playlist',
          campaign_target_type: 'track',
          campaign_target_isrc: 'DEXW62500259',
          campaign_target_spotify_track_id: '6habFhsOp2NvndAvgiJ01P',
          campaign_target_playlist_id: null,
          country_code: 'US',
          impressions: null,
          ad_clicks: null,
          link_clicks: null,
          streams: 203,
          listeners: 145,
          followers: 12,
          streams_per_listener: 1.4,
          spend_media: 42.5,
          spend_total: 42.5,
          fees: 0,
          currency: 'USD',
          currency_account: 'USD',
          cpl: 0.293,
          cpf: 3.542,
          cpc_linkclick: null,
          ctr_linkclick: null,
          ctr_adclick: null,
          cost_per_result: 3.542,
          result_type: 'follow',
        },
      ],
      pagination: {
        page: 1,
        pageSize: 50,
        totalCount: 1,
        totalPages: 1,
      },
    });
  }),

  http.get(`${BASE_URL}/v1/campaigns/:campaignId/metrics/breakdown/export`, () => {
    const body = [
      '{"provider":"soundlink","country_code":"US","streams":10}',
      '{"provider":"soundlink","country_code":"DE","streams":20}',
    ].join('\n');

    return new HttpResponse(`${body}\n`, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson',
        'X-Row-Count': '2',
      },
    });
  }),

  http.get(`${BASE_URL}/v1/campaigns/:campaignId/metrics/engagement`, ({ params }) => {
    if (params.campaignId === 'missing') {
      return errorEnvelope('not_found', 'Not found.', 404);
    }

    return successEnvelope({
      schemaVersion: '1.0',
      items: [],
      pagination: {
        page: 1,
        pageSize: 50,
        totalCount: 0,
        totalPages: 0,
      },
    });
  }),

  http.get(`${BASE_URL}/v1/campaigns/:campaignId/metrics/engagement/export`, () => {
    const body = '{"provider":"soundlink","streams":89}\n';

    return new HttpResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson',
        'X-Row-Count': '1',
      },
    });
  }),
];
