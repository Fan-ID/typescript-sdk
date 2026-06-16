import type { HttpClient } from '../client/http-client.js';
import type { JsonlStream } from '../types/api.js';
import { collectNdjsonStream } from '../core/jsonl.js';
import type {
  ApiResponse,
  BreakdownExportParams,
  BreakdownListData,
  BreakdownListParams,
  BreakdownRow,
  CampaignDetail,
  CampaignListData,
  CampaignListParams,
  DateRangeParams,
  EngagementExportParams,
  EngagementListData,
  EngagementListParams,
  EngagementRow,
  ExportCollection,
  MetricsOverview,
  PingData,
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

/** Campaign listing and detail (`/v1/campaigns/*`). Requires `campaigns:read`. */
export class CampaignsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * List campaigns for the authenticated organization.
   *
   * Maps to `GET /v1/campaigns`. Max `pageSize` is **100**.
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
   * Maps to `GET /v1/campaigns/{campaignId}`.
   *
   * @param campaignId - Campaign identifier returned by {@link CampaignsResource.list}.
   */
  get(campaignId: string): Promise<ApiResponse<CampaignDetail>> {
    return this.http.get<CampaignDetail>({
      path: `/campaigns/${encodeURIComponent(campaignId)}`,
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

  /** Per-track engagement breakdown and JSONL export. */
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
 * Access via `soundlink.metrics.engagement`.
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

  /**
   * Paginated per-day, per-track engagement rows.
   *
   * Maps to `GET /v1/campaigns/{campaignId}/metrics/engagement`.
   * Max `pageSize` is **500** (default 50).
   *
   * @param campaignId - Campaign identifier.
   * @param params - Date range, pagination, sort, and optional `engagementContext` filter.
   */
  list(
    campaignId: string,
    params: EngagementListParams = {},
  ): Promise<ApiResponse<EngagementListData>> {
    return this.http.get<EngagementListData>({
      path: `/campaigns/${encodeURIComponent(campaignId)}/metrics/engagement`,
      query: {
        startDate: params.startDate,
        endDate: params.endDate,
        page: params.page,
        pageSize: params.pageSize,
        sortBy: params.sortBy,
        sortOrder: params.sortOrder,
        engagementContext: params.engagementContext,
      },
    });
  }
}
