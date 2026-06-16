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

export interface ExportResource<T, P extends DateRangeParams> {
  (campaignId: string, params?: P): Promise<ApiResponse<JsonlStream<T>>>;
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

export class PingResource {
  constructor(private readonly http: HttpClient) {}

  ping(): Promise<ApiResponse<PingData>> {
    return this.http.get<PingData>({ path: '/ping' });
  }
}

export class CampaignsResource {
  constructor(private readonly http: HttpClient) {}

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

  get(campaignId: string): Promise<ApiResponse<CampaignDetail>> {
    return this.http.get<CampaignDetail>({
      path: `/campaigns/${encodeURIComponent(campaignId)}`,
    });
  }

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

export class MetricsResource {
  readonly breakdown: BreakdownMetricsResource;
  readonly engagement: EngagementMetricsResource;

  constructor(private readonly http: HttpClient) {
    this.breakdown = new BreakdownMetricsResource(http);
    this.engagement = new EngagementMetricsResource(http);
  }

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

class BreakdownMetricsResource {
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

class EngagementMetricsResource {
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

export { BreakdownMetricsResource, EngagementMetricsResource };
