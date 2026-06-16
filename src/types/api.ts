export type PublicApiErrorCode =
  | 'invalid_api_key'
  | 'api_key_revoked'
  | 'api_key_expired'
  | 'mixed_credentials'
  | 'insufficient_scope'
  | 'not_found'
  | 'campaign_not_found'
  | 'invalid_query_parameter'
  | 'invalid_date_range'
  | 'page_size_exceeded'
  | 'rate_limit_exceeded'
  | 'internal_error';

export type CampaignStatus = 'creating' | 'active' | 'paused' | 'completed' | 'failed';

export type SocialPlatform = 'meta';

export type EngagementContext = 'catalog' | 'playlist';

export type CampaignSortBy = 'createdAt' | 'status';

export type BreakdownSortBy = 'report_date' | 'spend_total';

export type EngagementSortBy = 'report_date' | 'streams' | 'listeners';

export type SortOrder = 'asc' | 'desc';

export interface ApiMeta {
  requestId: string;
}

export interface ApiError {
  code: PublicApiErrorCode;
  message: string;
  status: number;
  requestId?: string;
  retryAfter?: number;
}

export interface ApiResponse<T> {
  data: T | null;
  error: ApiError | null;
  meta?: ApiMeta;
}

export interface Pagination {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export interface CampaignSummary {
  campaignId: string;
  organizationId: string;
  status: CampaignStatus;
  socialPlatform: SocialPlatform;
  dailyBudget: number;
  totalBudget: number;
  campaignDuration: number;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignDetail extends CampaignSummary {
  strategyType?: string;
}

export interface CampaignListData {
  items: CampaignSummary[];
  pagination: Pagination;
}

export interface PingData {
  status: 'ok';
}

export interface MetricsOverview {
  listeners: number;
  streams: number;
  followers: number;
  impressions: number | null;
  ad_clicks: number | null;
  link_clicks: number | null;
  spend_media: number;
  spend_total: number;
  fees: number;
  currency: string;
  cpl: number;
  cpf: number;
  streams_per_listener: number;
}

export interface BreakdownRow {
  provider: 'soundlink';
  account_id: string;
  schema_version: string;
  report_date: string;
  report_date_timezone: 'UTC';
  exported_at: string;
  campaign_id: string;
  campaign_name: string;
  campaign_target_type: 'track' | 'playlist' | null;
  campaign_target_isrc: string | null;
  campaign_target_spotify_track_id: string | null;
  campaign_target_playlist_id: string | null;
  country_code: string;
  impressions: number | null;
  ad_clicks: number | null;
  link_clicks: number | null;
  streams: number;
  listeners: number;
  followers: number;
  streams_per_listener: number;
  spend_media: number;
  spend_total: number;
  fees: number;
  currency: string;
  currency_account: string;
  cpl: number;
  cpf: number;
  cpc_linkclick: number | null;
  ctr_linkclick: number | null;
  ctr_adclick: number | null;
  cost_per_result: number;
  result_type: 'lp_click' | 'stream' | 'follow' | null;
}

export interface EngagementRow {
  provider: 'soundlink';
  account_id: string;
  schema_version: string;
  report_date: string;
  report_date_timezone: 'UTC';
  exported_at: string;
  campaign_id: string;
  campaign_name: string;
  campaign_target_type: 'track' | 'playlist' | null;
  campaign_target_isrc: string | null;
  campaign_target_spotify_track_id: string | null;
  campaign_target_playlist_id: string | null;
  status: string;
  engagement_context: EngagementContext;
  country_code: string;
  engaged_track_isrc: string | null;
  engaged_spotify_track_id: string;
  engaged_track_name: string;
  playlist_position: number | null;
  new_listeners: number;
  returning_listeners: number;
  listeners: number;
  new_listener_streams: number;
  returning_listener_streams: number;
  streams: number;
  spl: number;
}

export interface BreakdownListData {
  schemaVersion: string;
  items: BreakdownRow[];
  pagination: Pagination;
}

export interface EngagementListData {
  schemaVersion: string;
  items: EngagementRow[];
  pagination: Pagination;
}

export interface ExportCollection<T> {
  rows: T[];
  rowCount: number;
}

export interface JsonlStream<T> extends AsyncIterable<T> {
  rowCount?: number;
}

export interface SoundlinkClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
}

export type SoundlinkOptions = SoundlinkClientOptions | string;

export interface CampaignListParams {
  page?: number;
  pageSize?: number;
  sortBy?: CampaignSortBy;
  sortOrder?: SortOrder;
}

export interface DateRangeParams {
  startDate?: string;
  endDate?: string;
}

export interface BreakdownListParams extends DateRangeParams {
  page?: number;
  pageSize?: number;
  sortBy?: BreakdownSortBy;
  sortOrder?: SortOrder;
}

export interface EngagementListParams extends DateRangeParams {
  page?: number;
  pageSize?: number;
  sortBy?: EngagementSortBy;
  sortOrder?: SortOrder;
  engagementContext?: EngagementContext;
}

export interface EngagementExportParams extends DateRangeParams {
  engagementContext?: EngagementContext;
}

export type BreakdownExportParams = DateRangeParams;

export interface ApiEnvelopeSuccess<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiEnvelopeError {
  error: {
    code: string;
    message: string;
  };
  meta: ApiMeta;
}
