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
   * @param campaignId - Soundlink campaign ID.
   * @param params - Optional date range (max 90 days per request).
   */
  (campaignId: string, params?: P): Promise<ApiResponse<JsonlStream<T>>>;

  /**
   * Download all export rows into memory.
   *
   * Prefer {@link ExportResource | the stream} for large datasets.
   */
  collect(campaignId: string, params?: P): Promise<ApiResponse<ExportCollection<T>>>;
}

function createExportResource<T, P extends DateRangeParams>(
  http: HttpClient,
  buildPath: (campaignId: string) => string,
  buildQuery: (
    params: P,
  ) => Record<string, string | number | boolean | undefined | null>,
): ExportResource<T, P> {
  const exportFn = ((campaignId: string, params: P = {} as P) => {
    return http.getJsonl<T>({
      path: buildPath(campaignId),
      query: buildQuery(params),
    });
  }) as ExportResource<T, P>;

  exportFn.collect = async (campaignId: string, params: P = {} as P) => {
    const response = await exportFn(campaignId, params);

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
