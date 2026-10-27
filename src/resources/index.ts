import type { HttpClient } from '../client/http-client.js';
import { LISTENING_INSIGHTS_TIMEOUT_MS } from '../constants/defaults.js';
import type { JsonlStream } from '../types/api.js';
import { collectNdjsonStream } from '../core/jsonl.js';
import type {
  ApiResponse,
  BreakdownExportParams,
  BreakdownListData,
  BreakdownListParams,
  BreakdownRow,
  CampaignActivityData,
  CampaignActivityParams,
  CampaignAutoRenewData,
  CampaignCreateData,
  CampaignDetail,
  CampaignListData,
  CampaignListParams,
  CampaignStopData,
  CampaignTiersData,
  CohortRetentionListData,
  CreateCampaignRequest,
  CreateSoundlinkRequest,
  CreativeDailyData,
  CreativeDailyParams,
  CreativeMetrics,
  DateRangeParams,
  DecreaseCampaignBudgetData,
  DecreaseCampaignBudgetRequest,
  EngagementExportParams,
  EngagementRow,
  ExportCollection,
  IdempotencyOptions,
  IncreaseCampaignBudgetData,
  IncreaseCampaignBudgetRequest,
  ListeningInsight,
  ListeningInsightsData,
  MetricsOverview,
  Pixel,
  PixelListData,
  PixelTestEventData,
  PingData,
  SoundlinkBreakdownListData,
  SoundlinkBreakdownListParams,
  SoundlinkBreakdownRow,
  SoundlinkDetail,
  SoundlinkEngagementListData,
  SoundlinkEngagementListParams,
  SoundlinkEngagementRow,
  SoundlinkListData,
  SoundlinkListParams,
  SoundlinkMetricsOverview,
  StrategiesCatalogData,
  UpdateCampaignAutoRenewRequest,
  UpdateCampaignTiersRequest,
  UpdatePixelRequest,
  WalletData,
} from '../types/api.js';

/**
 * JSONL export endpoint: stream rows with {@link ExportResource.collect} or iterate the stream directly.
 *
 * @example
 * ```ts
 * const { data: stream } = await soundlink.metrics.breakdown.export(campaignId);
 * for await (const row of stream!) { ... }
 *
 * const { data } = await soundlink.metrics.breakdown.export.collect(campaignId);
 * ```
 */
export interface ExportResource<T, P extends DateRangeParams> {
  /**
   * Stream export rows as newline-delimited JSON.
   *
   * @param id - Campaign or soundlink ID.
   * @param params - Optional date range (max 90 days per request).
   */
  (id: string, params?: P): Promise<ApiResponse<JsonlStream<T>>>;

  /**
   * Download all export rows into memory.
   *
   * Prefer {@link ExportResource | the stream} for large datasets.
   */
  collect(id: string, params?: P): Promise<ApiResponse<ExportCollection<T>>>;
}

function createExportResource<T, P extends DateRangeParams>(
  http: HttpClient,
  buildPath: (id: string) => string,
  buildQuery: (
    params: P,
  ) => Record<string, string | number | boolean | undefined | null>,
): ExportResource<T, P> {
  const exportFn = ((id: string, params: P = {} as P) => {
    return http.getJsonl<T>({
      path: buildPath(id),
      query: buildQuery(params),
    });
  }) as ExportResource<T, P>;

  exportFn.collect = async (id: string, params: P = {} as P) => {
    const response = await exportFn(id, params);

    if (response.error || !response.data) {
      return {
        data: null,
        error: response.error,
        meta: response.meta,
      };
    }

    const collected = await collectNdjsonStream(response.data);

    return {
      data: collected,
      error: null,
      meta: response.meta,
    };
  };

  return exportFn;
}

/** System endpoints (`GET /v1/ping`). */
export class PingResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Verify connectivity and API key authentication.
   *
   * Accepts any valid v1 key scope. Does not require `campaigns:read` or `metrics:read`.
   *
   * @returns `{ data: { status: 'ok' }, error: null }` on success.
   *
   * @example
   * ```ts
   * const { data, error, meta } = await soundlink.ping();
   * ```
   */
  ping(): Promise<ApiResponse<PingData>> {
    return this.http.get<PingData>({ path: '/ping' });
  }
}

/** Organization wallet (`GET /v1/wallet`). Requires `wallet:read`. */
export class WalletResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Wallet snapshot for the organization on the API key.
   *
   * Maps to `GET /v1/wallet`. `available` is balance minus active reservations.
   *
   * @example
   * ```ts
   * const { data } = await soundlink.wallet.get();
   * ```
   */
  get(): Promise<ApiResponse<WalletData>> {
    return this.http.get<WalletData>({ path: '/wallet' });
  }
}

/** Strategy catalog (`GET /v1/strategies`). Requires `campaigns:read`. */
export class StrategiesResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * List growth strategies available for wallet campaign create.
   *
   * Maps to `GET /v1/strategies`.
   *
   * @example
   * ```ts
   * const { data } = await soundlink.strategies.list();
   * ```
   */
  list(): Promise<ApiResponse<StrategiesCatalogData>> {
    return this.http.get<StrategiesCatalogData>({ path: '/strategies' });
  }
}

/**
 * Organization Meta pixels (`/v1/pixels`).
 * Read needs `pixels:read`; write and test-events need `pixels:write`.
 */
export class PixelsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * List Meta pixels saved for the organization.
   *
   * Maps to `GET /v1/pixels`. Requires `pixels:read`.
   * Returns `403 custom_pixel_not_enabled` when the feature is off.
   *
   * @example
   * ```ts
   * const { data } = await soundlink.pixels.list();
   * ```
   */
  list(): Promise<ApiResponse<PixelListData>> {
    return this.http.get<PixelListData>({ path: '/pixels' });
  }

  /**
   * Save or rotate a Meta pixel access token.
   *
   * Maps to `PUT /v1/pixels/{pixelId}`. Requires `pixels:write`.
   * Does not require an `Idempotency-Key`. The access token is never returned.
   *
   * @example
   * ```ts
   * const { data } = await soundlink.pixels.update('1234567890123456', {
   *   platform: 'meta',
   *   accessToken: process.env.META_CAPI_TOKEN!,
   * });
   * ```
   */
  update(pixelId: string, body: UpdatePixelRequest): Promise<ApiResponse<Pixel>> {
    return this.http.put<Pixel>({
      path: `/pixels/${encodeURIComponent(pixelId)}`,
      body,
    });
  }

  /**
   * Send a live Meta Conversions API test event to a saved pixel.
   *
   * Maps to `POST /v1/pixels/{pixelId}/test-events`. Requires `pixels:write`.
   * This is not a sandbox event — it appears in Events Manager.
   *
   * @example
   * ```ts
   * const { data } = await soundlink.pixels.sendTestEvent('1234567890123456');
   * ```
   */
  sendTestEvent(pixelId: string): Promise<ApiResponse<PixelTestEventData>> {
    return this.http.post<PixelTestEventData>({
      path: `/pixels/${encodeURIComponent(pixelId)}/test-events`,
    });
  }
}

/** Campaign tiers (`/v1/campaigns/{id}/tiers`). Wallet only (`generation: 3`). */
export class CampaignTiersResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Get current tier allocation for a wallet campaign.
   *
   * Maps to `GET /v1/campaigns/{campaignId}/tiers`. Wallet campaigns only (`generation: 3`).
   */
  get(campaignId: string): Promise<ApiResponse<CampaignTiersData>> {
    return this.http.get<CampaignTiersData>({
      path: `/campaigns/${encodeURIComponent(campaignId)}/tiers`,
    });
  }

  /**
   * Update tier enablement and budget shares.
   *
   * Maps to `PATCH /v1/campaigns/{campaignId}/tiers`. Requires `campaigns:write`.
   * Allocation percents across items must sum to 100.
   * Use each tier's `tierId` from {@link CampaignTiersResource.get} as `targetingTierId`.
   * Does not require an `Idempotency-Key` (unlike create / stop / budget).
   */
  update(
    campaignId: string,
    body: UpdateCampaignTiersRequest,
  ): Promise<ApiResponse<CampaignTiersData>> {
    return this.http.patch<CampaignTiersData>({
      path: `/campaigns/${encodeURIComponent(campaignId)}/tiers`,
      body,
    });
  }
}

/** Campaign listing, detail, and wallet write surface (`/v1/campaigns/*`). */
export class CampaignsResource {
  /** Tier allocation for wallet campaigns (`generation: 3`). */
  readonly tiers: CampaignTiersResource;

  constructor(private readonly http: HttpClient) {
    this.tiers = new CampaignTiersResource(http);
  }

  /**
   * List campaigns for the authenticated organization.
   *
   * Maps to `GET /v1/campaigns`. Max `pageSize` is **100**. Requires `campaigns:read`.
   *
   * @param params - Pagination and sort options.
   *
   * @example
   * ```ts
   * const { data, error } = await soundlink.campaigns.list({ page: 1, pageSize: 100 });
   * ```
   */
  list(params: CampaignListParams = {}): Promise<ApiResponse<CampaignListData>> {
    return this.http.get<CampaignListData>({
      path: '/campaigns',
      query: {
        page: params.page,
        pageSize: params.pageSize,
        sortBy: params.sortBy,
        sortOrder: params.sortOrder,
      },
    });
  }

  /**
   * Fetch full details for a single campaign.
   *
   * Maps to `GET /v1/campaigns/{campaignId}`. Requires `campaigns:read`.
   *
   * @param campaignId - Campaign identifier returned by {@link CampaignsResource.list}.
   */
  get(campaignId: string): Promise<ApiResponse<CampaignDetail>> {
    return this.http.get<CampaignDetail>({
      path: `/campaigns/${encodeURIComponent(campaignId)}`,
    });
  }

  /**
   * Page of creative adds, budget changes, and other campaign events.
   *
   * Maps to `GET /v1/campaigns/{campaignId}/activity`. Requires `campaigns:read`.
   * Omit `startDate` for the full history. Max `pageSize` is **100**.
   */
  activity(
    campaignId: string,
    params: CampaignActivityParams = {},
  ): Promise<ApiResponse<CampaignActivityData>> {
    return this.http.get<CampaignActivityData>({
      path: `/campaigns/${encodeURIComponent(campaignId)}/activity`,
      query: {
        startDate: params.startDate,
        page: params.page,
        pageSize: params.pageSize,
      },
    });
  }

  /**
   * What listeners who connected through this campaign went on to play.
   *
   * Maps to `GET /v1/campaigns/{campaignId}/listening-insights/{insight}`.
   * Requires `metrics:read` and a premium plan (`403 premium_plan_required` otherwise).
   * Date window comes from the listening graph — do not send `startDate`/`endDate`.
   * Uses a 120s timeout (insights often take 30–50s).
   */
  listeningInsights(
    campaignId: string,
    insight: ListeningInsight,
  ): Promise<ApiResponse<ListeningInsightsData>> {
    return this.http.get<ListeningInsightsData>({
      path: `/campaigns/${encodeURIComponent(campaignId)}/listening-insights/${encodeURIComponent(insight)}`,
      timeout: LISTENING_INSIGHTS_TIMEOUT_MS,
    });
  }

  /**
   * Create a wallet-funded campaign.
   *
   * Maps to `POST /v1/campaigns`. Requires `campaigns:write` and `Idempotency-Key`.
   *
   * @example
   * ```ts
   * const { data, error } = await soundlink.campaigns.create(
   *   {
   *     spotifyUrl: 'https://open.spotify.com/track/...',
   *     dailyBudget: 20,
   *     durationDays: 7,
   *     genre: 'Pop',
   *     strategyType: 'maximum_growth',
   *   },
   *   { idempotencyKey: 'create-mytrack-01' },
   * );
   * ```
   */
  create(
    body: CreateCampaignRequest,
    options: IdempotencyOptions,
  ): Promise<ApiResponse<CampaignCreateData>> {
    return this.http.post<CampaignCreateData>({
      path: '/campaigns',
      body,
      idempotencyKey: options.idempotencyKey,
    });
  }

  /**
   * Stop a wallet campaign and refund unspent budget.
   *
   * Maps to `POST /v1/campaigns/{campaignId}/stop`. Requires `campaigns:write`
   * and `Idempotency-Key`. Wallet campaigns only (`generation: 3`).
   */
  stop(
    campaignId: string,
    options: IdempotencyOptions,
  ): Promise<ApiResponse<CampaignStopData>> {
    return this.http.post<CampaignStopData>({
      path: `/campaigns/${encodeURIComponent(campaignId)}/stop`,
      idempotencyKey: options.idempotencyKey,
    });
  }

  /**
   * Increase wallet campaign budget.
   *
   * Maps to `POST /v1/campaigns/{campaignId}/budget/increase`.
   * Requires `campaigns:write` and `Idempotency-Key`. Wallet only (`generation: 3`).
   */
  increaseBudget(
    campaignId: string,
    body: IncreaseCampaignBudgetRequest,
    options: IdempotencyOptions,
  ): Promise<ApiResponse<IncreaseCampaignBudgetData>> {
    return this.http.post<IncreaseCampaignBudgetData>({
      path: `/campaigns/${encodeURIComponent(campaignId)}/budget/increase`,
      body,
      idempotencyKey: options.idempotencyKey,
    });
  }

  /**
   * Decrease wallet campaign daily budget.
   *
   * Maps to `POST /v1/campaigns/{campaignId}/budget/decrease`.
   * Requires `campaigns:write` and `Idempotency-Key`. Wallet only (`generation: 3`).
   */
  decreaseBudget(
    campaignId: string,
    body: DecreaseCampaignBudgetRequest,
    options: IdempotencyOptions,
  ): Promise<ApiResponse<DecreaseCampaignBudgetData>> {
    return this.http.post<DecreaseCampaignBudgetData>({
      path: `/campaigns/${encodeURIComponent(campaignId)}/budget/decrease`,
      body,
      idempotencyKey: options.idempotencyKey,
    });
  }

  /**
   * Set auto-renew for a wallet campaign.
   *
   * Maps to `PUT /v1/campaigns/{campaignId}/auto-renew`. Requires `campaigns:write`
   * and `Idempotency-Key`. Wallet campaigns only (`generation: 3`).
   */
  updateAutoRenew(
    campaignId: string,
    body: UpdateCampaignAutoRenewRequest,
    options: IdempotencyOptions,
  ): Promise<ApiResponse<CampaignAutoRenewData>> {
    return this.http.put<CampaignAutoRenewData>({
      path: `/campaigns/${encodeURIComponent(campaignId)}/auto-renew`,
      body,
      idempotencyKey: options.idempotencyKey,
    });
  }

  /**
   * Async iterator over every campaign across all pages.
   *
   * Stops silently if a page request returns an error.
   *
   * @param params - Same as {@link CampaignsResource.list} except `page` is managed automatically.
   *
   * @example
   * ```ts
   * for await (const campaign of soundlink.campaigns.listAll({ pageSize: 100 })) {
   *   console.log(campaign.campaignId);
   * }
   * ```
   */
  async *listAll(
    params: Omit<CampaignListParams, 'page'> = {},
  ): AsyncGenerator<CampaignListData['items'][number], void, void> {
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      const response = await this.list({ ...params, page });

      if (response.error || !response.data) {
        return;
      }

      for (const item of response.data.items) {
        yield item;
      }

      totalPages = response.data.pagination.totalPages;
      page += 1;
    }
  }
}

/**
 * Self-serve soundlinks (`/v1/soundlinks/*`).
 *
 * List, get, and metrics require `soundlinks:read`. Create and delete require
 * `soundlinks:write`. Only soundlinks that are **not** linked to a campaign.
 * Campaign-backed soundlinks are served by the Campaigns API.
 *
 * @example
 * ```ts
 * await soundlink.soundlinks.list();
 * await soundlink.soundlinks.get(soundlinkId);
 * await soundlink.soundlinks.create({ name, spotifyUrl }, { idempotencyKey });
 * await soundlink.soundlinks.delete(soundlinkId);
 * await soundlink.soundlinks.metricsOverview(soundlinkId);
 * ```
 */
export class SoundlinksResource {
  /** Per-day country breakdown and JSONL export. */
  readonly breakdown: SoundlinkBreakdownMetricsResource;

  /** Per-day track engagement and JSONL export. */
  readonly engagement: SoundlinkEngagementMetricsResource;

  constructor(private readonly http: HttpClient) {
    this.breakdown = new SoundlinkBreakdownMetricsResource(http);
    this.engagement = new SoundlinkEngagementMetricsResource(http);
  }

  /**
   * List self-serve soundlinks for the authenticated organization.
   *
   * Maps to `GET /v1/soundlinks`. Max `pageSize` is **100**. Requires `soundlinks:read`.
   *
   * @param params - Pagination and sort options.
   *
   * @example
   * ```ts
   * const { data, error } = await soundlink.soundlinks.list({ page: 1, pageSize: 100 });
   * ```
   */
  list(params: SoundlinkListParams = {}): Promise<ApiResponse<SoundlinkListData>> {
    return this.http.get<SoundlinkListData>({
      path: '/soundlinks',
      query: {
        page: params.page,
        pageSize: params.pageSize,
        sortBy: params.sortBy,
        sortOrder: params.sortOrder,
      },
    });
  }

  /**
   * Fetch details for a single self-serve soundlink.
   *
   * Maps to `GET /v1/soundlinks/{soundlinkId}`. Requires `soundlinks:read`.
   * Campaign-linked soundlinks return `404`.
   *
   * @param soundlinkId - Identifier returned by {@link SoundlinksResource.list}.
   */
  get(soundlinkId: string): Promise<ApiResponse<SoundlinkDetail>> {
    return this.http.get<SoundlinkDetail>({
      path: `/soundlinks/${encodeURIComponent(soundlinkId)}`,
    });
  }

  /**
   * Create a self-serve soundlink.
   *
   * Maps to `POST /v1/soundlinks`. Requires `soundlinks:write` and
   * `Idempotency-Key`. Does not create a campaign.
   *
   * @example
   * ```ts
   * const { data, error } = await soundlink.soundlinks.create(
   *   {
   *     name: 'Midnight Drive',
   *     spotifyUrl: 'https://open.spotify.com/track/...',
   *   },
   *   { idempotencyKey: 'create-midnight-drive-01' },
   * );
   * ```
   */
  create(
    body: CreateSoundlinkRequest,
    options: IdempotencyOptions,
  ): Promise<ApiResponse<SoundlinkDetail>> {
    return this.http.post<SoundlinkDetail>({
      path: '/soundlinks',
      body,
      idempotencyKey: options.idempotencyKey,
    });
  }

  /**
   * Archive a self-serve soundlink (`status: archived`). Same as Archive in the app.
   *
   * Maps to `DELETE /v1/soundlinks/{soundlinkId}`. Requires `soundlinks:write`.
   * Does not send `Idempotency-Key`. List and detail still return the row.
   */
  delete(soundlinkId: string): Promise<ApiResponse<SoundlinkDetail>> {
    return this.http.delete<SoundlinkDetail>({
      path: `/soundlinks/${encodeURIComponent(soundlinkId)}`,
    });
  }

  /**
   * Soundlink-level metric totals for a date range.
   *
   * Maps to `GET /v1/soundlinks/{soundlinkId}/metrics/overview`.
   * Omit `startDate` to default to the soundlink creation date.
   * No financial fields. Requires `soundlinks:read`.
   *
   * @param soundlinkId - Soundlink identifier.
   * @param params - Inclusive `YYYY-MM-DD` date range.
   */
  metricsOverview(
    soundlinkId: string,
    params: DateRangeParams = {},
  ): Promise<ApiResponse<SoundlinkMetricsOverview>> {
    return this.http.get<SoundlinkMetricsOverview>({
      path: `/soundlinks/${encodeURIComponent(soundlinkId)}/metrics/overview`,
      query: {
        startDate: params.startDate,
        endDate: params.endDate,
      },
    });
  }

  /**
   * Cohort retention for a soundlink (`soundlink_cohort_retention_daily`).
   *
   * Maps to `GET /v1/soundlinks/{soundlinkId}/metrics/retention`.
   * Requires `metrics:read` and a premium plan (`403 premium_plan_required` otherwise).
   * One row per cohort date that has first plays. Day-N fields stay `null` until that day has passed.
   */
  retention(
    soundlinkId: string,
    params: DateRangeParams = {},
  ): Promise<ApiResponse<CohortRetentionListData>> {
    return this.http.get<CohortRetentionListData>({
      path: `/soundlinks/${encodeURIComponent(soundlinkId)}/metrics/retention`,
      query: {
        startDate: params.startDate,
        endDate: params.endDate,
      },
    });
  }

  /**
   * What listeners who connected through this soundlink went on to play.
   *
   * Maps to `GET /v1/soundlinks/{soundlinkId}/listening-insights/{insight}`.
   * Requires `metrics:read` and a premium plan (`403 premium_plan_required` otherwise).
   * Date window comes from the listening graph — do not send `startDate`/`endDate`.
   * Uses a 120s timeout (insights often take 30–50s).
   */
  listeningInsights(
    soundlinkId: string,
    insight: ListeningInsight,
  ): Promise<ApiResponse<ListeningInsightsData>> {
    return this.http.get<ListeningInsightsData>({
      path: `/soundlinks/${encodeURIComponent(soundlinkId)}/listening-insights/${encodeURIComponent(insight)}`,
      timeout: LISTENING_INSIGHTS_TIMEOUT_MS,
    });
  }
}

/**
 * Country-level daily metrics (`soundlink_country_daily` schema).
 *
 * Access via `soundlink.soundlinks.breakdown`.
 */
export class SoundlinkBreakdownMetricsResource {
  /**
   * Stream full breakdown export as JSONL.
   *
   * Maps to `GET /v1/soundlinks/{soundlinkId}/metrics/breakdown/export`.
   */
  readonly export: ExportResource<SoundlinkBreakdownRow, BreakdownExportParams>;

  constructor(private readonly http: HttpClient) {
    this.export = createExportResource<SoundlinkBreakdownRow, BreakdownExportParams>(
      http,
      (soundlinkId) =>
        `/soundlinks/${encodeURIComponent(soundlinkId)}/metrics/breakdown/export`,
      (params) => ({
        startDate: params.startDate,
        endDate: params.endDate,
      }),
    );
  }

  /**
   * Paginated per-day, per-country breakdown rows.
   *
   * Maps to `GET /v1/soundlinks/{soundlinkId}/metrics/breakdown`.
   * Max `pageSize` is **500** (default 50).
   *
   * @param soundlinkId - Soundlink identifier.
   * @param params - Date range, pagination, and sort options.
   */
  list(
    soundlinkId: string,
    params: SoundlinkBreakdownListParams = {},
  ): Promise<ApiResponse<SoundlinkBreakdownListData>> {
    return this.http.get<SoundlinkBreakdownListData>({
      path: `/soundlinks/${encodeURIComponent(soundlinkId)}/metrics/breakdown`,
      query: {
        startDate: params.startDate,
        endDate: params.endDate,
        page: params.page,
        pageSize: params.pageSize,
        sortBy: params.sortBy,
        sortOrder: params.sortOrder,
      },
    });
  }
}

/**
 * Per-track engagement metrics (`soundlink_engagement_daily` schema).
 *
 * Access via `soundlink.soundlinks.engagement`.
 */
export class SoundlinkEngagementMetricsResource {
  /**
   * Stream full engagement export as JSONL.
   *
   * Maps to `GET /v1/soundlinks/{soundlinkId}/metrics/engagement/export`.
   */
  readonly export: ExportResource<SoundlinkEngagementRow, EngagementExportParams>;

  constructor(private readonly http: HttpClient) {
    this.export = createExportResource<SoundlinkEngagementRow, EngagementExportParams>(
      http,
      (soundlinkId) =>
        `/soundlinks/${encodeURIComponent(soundlinkId)}/metrics/engagement/export`,
      (params) => ({
        startDate: params.startDate,
        endDate: params.endDate,
        engagementContext: params.engagementContext,
      }),
    );
  }

  /**
   * Paginated per-day, per-track engagement rows.
   *
   * Maps to `GET /v1/soundlinks/{soundlinkId}/metrics/engagement`.
   * Max `pageSize` is **500** (default 50).
   *
   * @param soundlinkId - Soundlink identifier.
   * @param params - Date range, engagement context filter, pagination, and sort.
   */
  list(
    soundlinkId: string,
    params: SoundlinkEngagementListParams = {},
  ): Promise<ApiResponse<SoundlinkEngagementListData>> {
    return this.http.get<SoundlinkEngagementListData>({
      path: `/soundlinks/${encodeURIComponent(soundlinkId)}/metrics/engagement`,
      query: {
        startDate: params.startDate,
        endDate: params.endDate,
        engagementContext: params.engagementContext,
        page: params.page,
        pageSize: params.pageSize,
        sortBy: params.sortBy,
        sortOrder: params.sortOrder,
      },
    });
  }
}

/**
 * Campaign metrics (`/v1/campaigns/{id}/metrics/*`). Requires `metrics:read`.
 *
 * @example
 * ```ts
 * await soundlink.metrics.overview(campaignId);
 * await soundlink.metrics.breakdown.list(campaignId);
 * await soundlink.metrics.engagement.export(campaignId);
 * ```
 */
export class MetricsResource {
  /** Per-day country breakdown and JSONL export. */
  readonly breakdown: BreakdownMetricsResource;

  /** Per-track engagement JSONL export. */
  readonly engagement: EngagementMetricsResource;

  constructor(private readonly http: HttpClient) {
    this.breakdown = new BreakdownMetricsResource(http);
    this.engagement = new EngagementMetricsResource(http);
  }

  /**
   * Campaign-level metric totals for a date range.
   *
   * Maps to `GET /v1/campaigns/{campaignId}/metrics/overview`.
   * Aggregates across all countries — use {@link BreakdownMetricsResource.list} for daily rows.
   *
   * @param campaignId - Campaign identifier.
   * @param params - Inclusive `YYYY-MM-DD` date range. Omit for API defaults.
   *
   * @example
   * ```ts
   * const { data } = await soundlink.metrics.overview(campaignId, {
   *   startDate: '2026-01-01',
   *   endDate: '2026-03-31',
   * });
   * ```
   */
  overview(
    campaignId: string,
    params: DateRangeParams = {},
  ): Promise<ApiResponse<MetricsOverview>> {
    return this.http.get<MetricsOverview>({
      path: `/campaigns/${encodeURIComponent(campaignId)}/metrics/overview`,
      query: {
        startDate: params.startDate,
        endDate: params.endDate,
      },
    });
  }

  /**
   * Lifetime creative performance, grouped by background video.
   *
   * Maps to `GET /v1/campaigns/{campaignId}/metrics/creatives`.
   * Snapshot only — do not send a date range.
   */
  creatives(campaignId: string): Promise<ApiResponse<CreativeMetrics>> {
    return this.http.get<CreativeMetrics>({
      path: `/campaigns/${encodeURIComponent(campaignId)}/metrics/creatives`,
    });
  }

  /**
   * One row per day and Meta ad creative.
   *
   * Maps to `GET /v1/campaigns/{campaignId}/metrics/creative-daily`.
   * Requires `metrics:read`. Omit both dates for every day that has rows.
   * Max `pageSize` is **500**.
   */
  creativeDaily(
    campaignId: string,
    params: CreativeDailyParams = {},
  ): Promise<ApiResponse<CreativeDailyData>> {
    return this.http.get<CreativeDailyData>({
      path: `/campaigns/${encodeURIComponent(campaignId)}/metrics/creative-daily`,
      query: {
        startDate: params.startDate,
        endDate: params.endDate,
        page: params.page,
        pageSize: params.pageSize,
      },
    });
  }

  /**
   * Cohort retention for the campaign's linked soundlink (`soundlink_cohort_retention_daily`).
   *
   * Maps to `GET /v1/campaigns/{campaignId}/metrics/retention`.
   * Requires `metrics:read` and a premium plan (`403 premium_plan_required` otherwise).
   * One row per cohort date that has first plays. Day-N fields stay `null` until that day has passed.
   */
  retention(
    campaignId: string,
    params: DateRangeParams = {},
  ): Promise<ApiResponse<CohortRetentionListData>> {
    return this.http.get<CohortRetentionListData>({
      path: `/campaigns/${encodeURIComponent(campaignId)}/metrics/retention`,
      query: {
        startDate: params.startDate,
        endDate: params.endDate,
      },
    });
  }
}

/**
 * Country-level daily metrics (`campaign_country_daily` schema).
 *
 * Access via `soundlink.metrics.breakdown`.
 */
export class BreakdownMetricsResource {
  /**
   * Stream full breakdown export as JSONL.
   *
   * Maps to `GET /v1/campaigns/{campaignId}/metrics/breakdown/export`.
   */
  readonly export: ExportResource<BreakdownRow, BreakdownExportParams>;

  constructor(private readonly http: HttpClient) {
    this.export = createExportResource<BreakdownRow, BreakdownExportParams>(
      http,
      (campaignId) =>
        `/campaigns/${encodeURIComponent(campaignId)}/metrics/breakdown/export`,
      (params) => ({
        startDate: params.startDate,
        endDate: params.endDate,
      }),
    );
  }

  /**
   * Paginated per-day, per-country breakdown rows.
   *
   * Maps to `GET /v1/campaigns/{campaignId}/metrics/breakdown`.
   * Max `pageSize` is **500** (default 50).
   *
   * @param campaignId - Campaign identifier.
   * @param params - Date range, pagination, and sort options.
   */
  list(
    campaignId: string,
    params: BreakdownListParams = {},
  ): Promise<ApiResponse<BreakdownListData>> {
    return this.http.get<BreakdownListData>({
      path: `/campaigns/${encodeURIComponent(campaignId)}/metrics/breakdown`,
      query: {
        startDate: params.startDate,
        endDate: params.endDate,
        page: params.page,
        pageSize: params.pageSize,
        sortBy: params.sortBy,
        sortOrder: params.sortOrder,
      },
    });
  }
}

/**
 * Per-track engagement metrics (`campaign_engagement_daily` schema).
 *
 * Access via `soundlink.metrics.engagement`. Only JSONL export is shipped.
 */
export class EngagementMetricsResource {
  /**
   * Stream full engagement export as JSONL.
   *
   * Maps to `GET /v1/campaigns/{campaignId}/metrics/engagement/export`.
   */
  readonly export: ExportResource<EngagementRow, EngagementExportParams>;

  constructor(private readonly http: HttpClient) {
    this.export = createExportResource<EngagementRow, EngagementExportParams>(
      http,
      (campaignId) =>
        `/campaigns/${encodeURIComponent(campaignId)}/metrics/engagement/export`,
      (params) => ({
        startDate: params.startDate,
        endDate: params.endDate,
        engagementContext: params.engagementContext,
      }),
    );
  }
}
