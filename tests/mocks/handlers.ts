import { http, HttpResponse, type HttpHandler, type JsonBodyType } from 'msw';

export const BASE_URL = 'https://api.getsoundlink.com';

export const TEST_API_KEY = 'sk_test_prefix_secret';

export const REQUEST_ID = '550e8400-e29b-41d4-a716-446655440000';

export function successEnvelope(data: unknown): HttpResponse<JsonBodyType> {
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
): HttpResponse<JsonBodyType> {
  return HttpResponse.json(
    {
      error: { code, message },
      meta: { requestId: REQUEST_ID },
    },
    { status, headers },
  );
}

export const handlers: HttpHandler[] = [
  http.get(`${BASE_URL}/v1/ping`, ({ request }) => {
    const authorization = request.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer sk_')) {
      return errorEnvelope('invalid_api_key', 'Missing API key.', 401);
    }
    return successEnvelope({ status: 'ok' });
  }),

  http.get(`${BASE_URL}/v1/strategies`, () => {
    return successEnvelope({
      strategies: [
        { strategyType: 'maximum_growth', tierTargetingAllowed: false },
        { strategyType: 'market_discovery', tierTargetingAllowed: false },
        { strategyType: 'revenue_maximization', tierTargetingAllowed: false },
        { strategyType: 'custom', tierTargetingAllowed: true },
      ],
    });
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
          generation: 3,
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

  http.post(`${BASE_URL}/v1/campaigns`, ({ request }) => {
    const idempotencyKey = request.headers.get('Idempotency-Key');
    if (!idempotencyKey) {
      return errorEnvelope(
        'invalid_request',
        'Idempotency-Key header is required and must not be empty.',
        400,
      );
    }

    if (idempotencyKey === 'conflict-key') {
      return errorEnvelope(
        'idempotency_key_conflict',
        'This Idempotency-Key was already used with a different request body.',
        409,
      );
    }

    return successEnvelope({
      campaignId: 'camp_new123',
      status: 'creating',
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
      generation: 3,
      strategyType: 'custom',
      createdAt: '2026-04-01T10:00:00.000Z',
      updatedAt: '2026-04-08T12:00:00.000Z',
    });
  }),

  http.post(`${BASE_URL}/v1/campaigns/:campaignId/stop`, ({ request, params }) => {
    const idempotencyKey = request.headers.get('Idempotency-Key');
    if (!idempotencyKey) {
      return errorEnvelope(
        'invalid_request',
        'Idempotency-Key header is required and must not be empty.',
        400,
      );
    }

    return successEnvelope({
      campaignId: String(params.campaignId),
      status: 'stopped',
    });
  }),

  http.post(
    `${BASE_URL}/v1/campaigns/:campaignId/budget/increase`,
    async ({ request, params }) => {
      const idempotencyKey = request.headers.get('Idempotency-Key');
      if (!idempotencyKey) {
        return errorEnvelope(
          'invalid_request',
          'Idempotency-Key header is required and must not be empty.',
          400,
        );
      }

      const body = (await request.json()) as { amount: number; mode?: string };

      return successEnvelope({
        campaignId: String(params.campaignId),
        mode: body.mode ?? 'current_and_renewals',
        amount: body.amount,
        walletBalance: 500,
        walletNextCycleDailyBudget: null,
      });
    },
  ),

  http.post(
    `${BASE_URL}/v1/campaigns/:campaignId/budget/decrease`,
    async ({ request, params }) => {
      const idempotencyKey = request.headers.get('Idempotency-Key');
      if (!idempotencyKey) {
        return errorEnvelope(
          'invalid_request',
          'Idempotency-Key header is required and must not be empty.',
          400,
        );
      }

      const body = (await request.json()) as {
        targetDailyBudget: number;
        mode?: string;
      };

      return successEnvelope({
        campaignId: String(params.campaignId),
        mode: body.mode ?? 'current_and_renewals',
        targetDailyBudget: body.targetDailyBudget,
        accepted: true,
        walletNextCycleDailyBudget: body.targetDailyBudget,
      });
    },
  ),

  http.get(`${BASE_URL}/v1/campaigns/:campaignId/tiers`, () => {
    return successEnvelope({
      lastUpdate: null,
      tiers: [
        {
          tierId: 1,
          tierName: 'Core',
          isEnabled: true,
          allocationPercent: 100,
        },
      ],
    });
  }),

  http.patch(`${BASE_URL}/v1/campaigns/:campaignId/tiers`, async ({ request }) => {
    const body = (await request.json()) as {
      items: Array<{ targetingTierId: number; newAllocationPercent: number }>;
    };

    return successEnvelope({
      lastUpdate: '2026-07-27T12:00:00.000Z',
      tiers: body.items.map((item) => ({
        tierId: item.targetingTierId,
        tierName: `Tier ${String(item.targetingTierId)}`,
        isEnabled: true,
        allocationPercent: item.newAllocationPercent,
      })),
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

  http.get(`${BASE_URL}/v1/soundlinks`, ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '10');

    return successEnvelope({
      items: [
        {
          soundlinkId: 'sl_abc123',
          organizationId: 'org_xyz',
          name: 'Midnight Drive',
          url: 'https://sndl.ink/soundlink/sl_abc123',
          targetType: 'track',
          spotifyUrl: 'https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl',
          status: 'active',
          createdAt: '2026-04-01T10:00:00.000Z',
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

  http.post(`${BASE_URL}/v1/soundlinks`, async ({ request }) => {
    const idempotencyKey = request.headers.get('Idempotency-Key');
    if (!idempotencyKey) {
      return errorEnvelope(
        'invalid_request',
        'Idempotency-Key header is required and must not be empty.',
        400,
      );
    }

    if (idempotencyKey === 'conflict-key') {
      return errorEnvelope(
        'idempotency_key_conflict',
        'This Idempotency-Key was already used with a different request body.',
        409,
      );
    }

    const body = (await request.json()) as {
      name: string;
      spotifyUrl: string;
      autoFollow?: boolean;
      metaPixelId?: string;
    };

    return HttpResponse.json(
      {
        data: {
          soundlinkId: 'sl_new123',
          organizationId: 'org_xyz',
          name: body.name,
          url: 'https://sndl.ink/soundlink/sl_new123',
          targetType: 'track',
          spotifyUrl: body.spotifyUrl,
          status: 'active',
          createdAt: '2026-04-01T10:00:00.000Z',
          autoFollow: body.autoFollow ?? false,
          metaPixelId: body.metaPixelId ?? null,
          tiktokPixelId: null,
        },
        meta: { requestId: REQUEST_ID },
      },
      { status: 201 },
    );
  }),

  http.get(`${BASE_URL}/v1/soundlinks/:soundlinkId`, ({ params }) => {
    if (params.soundlinkId === 'missing') {
      return errorEnvelope('not_found', 'Soundlink not found.', 404);
    }

    return successEnvelope({
      soundlinkId: String(params.soundlinkId),
      organizationId: 'org_xyz',
      name: 'Midnight Drive',
      url: `https://sndl.ink/soundlink/${String(params.soundlinkId)}`,
      targetType: 'track',
      spotifyUrl: 'https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl',
      status: 'active',
      createdAt: '2026-04-01T10:00:00.000Z',
      autoFollow: true,
      metaPixelId: '1234567890123456',
      tiktokPixelId: null,
    });
  }),

  http.delete(`${BASE_URL}/v1/soundlinks/:soundlinkId`, ({ params }) => {
    if (params.soundlinkId === 'missing') {
      return errorEnvelope('not_found', 'Soundlink not found.', 404);
    }

    return successEnvelope({
      soundlinkId: String(params.soundlinkId),
      organizationId: 'org_xyz',
      name: 'Midnight Drive',
      url: `https://sndl.ink/soundlink/${String(params.soundlinkId)}`,
      targetType: 'track',
      spotifyUrl: 'https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl',
      status: 'archived',
      createdAt: '2026-04-01T10:00:00.000Z',
      autoFollow: true,
      metaPixelId: '1234567890123456',
      tiktokPixelId: null,
    });
  }),

  http.get(`${BASE_URL}/v1/soundlinks/:soundlinkId/metrics/overview`, () => {
    return successEnvelope({
      views: 4821,
      link_clicks: 890,
      streams: 9340,
      listeners: 3980,
      followers: 312,
      streams_per_listener: 2.35,
      ctr_lp: 0.185,
    });
  }),

  http.get(`${BASE_URL}/v1/soundlinks/:soundlinkId/metrics/breakdown`, () => {
    return successEnvelope({
      schemaVersion: '1.0',
      items: [
        {
          provider: 'soundlink',
          account_id: 'org_xyz',
          schema_version: '1.0',
          report_date: '2026-08-01',
          report_date_timezone: 'UTC',
          exported_at: '2026-08-28T03:00:00.000Z',
          soundlink_id: 'sl_abc123',
          soundlink_name: 'Midnight Drive',
          soundlink_target_type: 'track',
          soundlink_target_isrc: 'DEXW62500259',
          soundlink_target_spotify_track_id: '11dFghVXANMlKmJXsNCbNl',
          soundlink_target_playlist_id: null,
          country_code: 'US',
          views: 4821,
          link_clicks: 890,
          streams: 203,
          listeners: 145,
          new_listeners: 120,
          returning_listeners: 25,
          new_listener_streams: 160,
          returning_listener_streams: 43,
          followers: 12,
          streams_per_listener: 1.4,
          ctr_lp: 0.185,
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

  http.get(`${BASE_URL}/v1/soundlinks/:soundlinkId/metrics/breakdown/export`, () => {
    const row = JSON.stringify({
      provider: 'soundlink',
      account_id: 'org_xyz',
      schema_version: '1.0',
      report_date: '2026-08-01',
      report_date_timezone: 'UTC',
      exported_at: '2026-08-28T03:00:00.000Z',
      soundlink_id: 'sl_abc123',
      soundlink_name: 'Midnight Drive',
      soundlink_target_type: 'track',
      soundlink_target_isrc: 'DEXW62500259',
      soundlink_target_spotify_track_id: '11dFghVXANMlKmJXsNCbNl',
      soundlink_target_playlist_id: null,
      country_code: 'US',
      views: 4821,
      link_clicks: 890,
      streams: 203,
      listeners: 145,
      new_listeners: 120,
      returning_listeners: 25,
      new_listener_streams: 160,
      returning_listener_streams: 43,
      followers: 12,
      streams_per_listener: 1.4,
      ctr_lp: 0.185,
    });

    return new HttpResponse(`${row}\n`, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson',
        'X-Row-Count': '1',
      },
    });
  }),

  http.get(`${BASE_URL}/v1/soundlinks/:soundlinkId/metrics/engagement`, () => {
    return successEnvelope({
      schemaVersion: '1.0',
      items: [
        {
          provider: 'soundlink',
          account_id: 'org_xyz',
          schema_version: '1.0',
          report_date: '2026-08-01',
          report_date_timezone: 'UTC',
          exported_at: '2026-08-28T03:00:00.000Z',
          soundlink_id: 'sl_abc123',
          soundlink_name: 'Midnight Drive',
          soundlink_target_type: 'track',
          soundlink_target_isrc: 'DEXW62500259',
          soundlink_target_spotify_track_id: '11dFghVXANMlKmJXsNCbNl',
          soundlink_target_playlist_id: null,
          engagement_context: 'catalog',
          country_code: 'US',
          engaged_track_isrc: 'DEXW62500001',
          engaged_spotify_track_id: '4cOdK2wGLETKBW3PvgPWqT',
          engaged_track_name: 'Till The Sunrise',
          playlist_position: null,
          new_listeners: 42,
          returning_listeners: 18,
          listeners: 60,
          new_listener_streams: 58,
          returning_listener_streams: 31,
          streams: 89,
          spl: 1.48,
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

  http.get(`${BASE_URL}/v1/soundlinks/:soundlinkId/metrics/engagement/export`, () => {
    const row = JSON.stringify({
      provider: 'soundlink',
      account_id: 'org_xyz',
      schema_version: '1.0',
      report_date: '2026-08-01',
      report_date_timezone: 'UTC',
      exported_at: '2026-08-28T03:00:00.000Z',
      soundlink_id: 'sl_abc123',
      soundlink_name: 'Midnight Drive',
      soundlink_target_type: 'track',
      soundlink_target_isrc: 'DEXW62500259',
      soundlink_target_spotify_track_id: '11dFghVXANMlKmJXsNCbNl',
      soundlink_target_playlist_id: null,
      engagement_context: 'catalog',
      country_code: 'US',
      engaged_track_isrc: 'DEXW62500001',
      engaged_spotify_track_id: '4cOdK2wGLETKBW3PvgPWqT',
      engaged_track_name: 'Till The Sunrise',
      playlist_position: null,
      new_listeners: 42,
      returning_listeners: 18,
      listeners: 60,
      new_listener_streams: 58,
      returning_listener_streams: 31,
      streams: 89,
      spl: 1.48,
    });

    return new HttpResponse(`${row}\n`, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson',
        'X-Row-Count': '1',
      },
    });
  }),
];
