import type { HttpClient } from '../client/http-client.js';
import type { JsonlStream } from '../types/api.js';
import { collectNdjsonStream } from '../core/jsonl.js';
import type {
  ApiResponse,
  BreakdownExportParams,
  BreakdownListData,
  BreakdownListParams,
  BreakdownRow,
  CampaignCreateData,
  CampaignDetail,
  CampaignListData,
  CampaignListParams,
  CampaignStopData,
  CampaignTiersData,
  CreateCampaignRequest,
  CreateSoundlinkRequest,
  DateRangeParams,
  DecreaseCampaignBudgetData,
  DecreaseCampaignBudgetRequest,
  EngagementExportParams,
  EngagementRow,
  ExportCollection,
  IdempotencyOptions,
  IncreaseCampaignBudgetData,
  IncreaseCampaignBudgetRequest,
  MetricsOverview,
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
  UpdateCampaignTiersRequest,
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
 * await soundlink.soundlinks.create(
 *   { name: 'Midnight Drive', spotifyUrl: 'https://open.spotify.com/track/...' },
 *   { idempotencyKey: 'create-midnight-drive-01' },
 * );
 * await soundlink.soundlinks.delete(soundlinkId);
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
   * Archive a self-serve soundlink (`status: archived`).
   *
   * Maps to `DELETE /v1/soundlinks/{soundlinkId}`. Same as Archive in the app.
   * Requires `soundlinks:write`. No `Idempotency-Key`. A second delete, unknown
   * id, other org, campaign-linked id, or a soundlink that is not `active`
   * returns `404 not_found`. List and detail still return the row.
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
