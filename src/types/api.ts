/** Stable snake_case error codes returned by the Soundlink Public API. */
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
  | 'invalid_request'
  | 'invalid_genre'
  | 'invalid_duration_or_budget'
  | 'invalid_daily_budget'
  | 'invalid_duration_days'
  | 'invalid_spotify_url'
  | 'invalid_tier_budget_allocation'
  | 'invalid_tier_status'
  | 'tier_update_cooldown'
  | 'wallet_not_enabled'
  | 'insufficient_credit'
  | 'idempotency_key_conflict'
  | 'rate_limit_exceeded'
  | 'invalid_video_url'
  | 'video_import_limit_exceeded'
  | 'video_import_session_not_found'
  | 'internal_error';

/**
 * Campaign lifecycle status.
 *
 * Includes OpenAPI values plus `inactive` (observed on wallet campaigns in
 * production; may be aligned in a later OpenAPI revision).
 */
export type CampaignStatus =
  | 'creating'
  | 'active'
  | 'paused'
  | 'stopped'
  | 'completed'
  | 'failed'
  | 'ended'
  | 'inactive';

/** Ad platform used by the campaign. */
export type SocialPlatform = 'meta';

/**
 * Campaign resource generation.
 *
 * - `1` — Stripe / one-time / subscription / legacy
 * - `2` — managed
 * - `3` — wallet (writable via Public API)
 */
export type CampaignGeneration = 1 | 2 | 3;

/**
 * Engagement context for per-track metrics.
 *
 * - `catalog` — same-artist spillover and promoted track plays.
 * - `playlist` — per-track performance inside a promoted playlist.
 */
export type EngagementContext = 'catalog' | 'playlist';

/** Allowed `sortBy` values for {@link CampaignListParams}. */
export type CampaignSortBy = 'createdAt' | 'status';

/** Allowed `sortBy` values for breakdown list requests. */
export type BreakdownSortBy = 'report_date' | 'spend_total';

/** Sort direction for list endpoints. */
export type SortOrder = 'asc' | 'desc';

/** Growth strategy for campaign create / catalog. */
export type StrategyType =
  | 'maximum_growth'
  | 'market_discovery'
  | 'revenue_maximization'
  | 'custom';

/** Non-custom strategies (platform default tiering; no `tierTargeting`). */
export type BuiltInStrategyType = Exclude<StrategyType, 'custom'>;

/** Strictly validated genre list from the Public API. */
export type Genre =
  | 'Alternative/Indie'
  | 'Ambient/Sleep'
  | 'Chill/Background'
  | 'Classical'
  | 'Country'
  | 'Electronic/Dance'
  | 'Hip-Hop/R&B'
  | 'Latin/Reggaeton'
  | 'Pop'
  | 'Rock'
  | 'Christmas';

/** Budget increase mode for wallet campaigns. */
export type BudgetIncreaseMode =
  | 'current_cycle'
  | 'next_renewal'
  | 'current_and_renewals';

/** Budget decrease mode for wallet campaigns. */
export type BudgetDecreaseMode = 'current_cycle' | 'current_and_renewals';

/** Options for write methods that require an `Idempotency-Key` header. */
export interface IdempotencyOptions {
  /** Client-generated key; reused retries must send the same body. */
  idempotencyKey: string;
}

/** Server-generated request metadata. Include `requestId` when contacting Soundlink support. */
export interface ApiMeta {
  /** UUID for this API request. */
  requestId: string;
}

/** API error returned in `{ data: null, error }` — never thrown by SDK methods. */
export interface ApiError {
  /** Stable error code from the Public API. */
  code: PublicApiErrorCode;
  /** Human-readable description. Do not parse programmatically. */
  message: string;
  /** HTTP status code. */
  status: number;
  /** Same as `meta.requestId` when present. */
  requestId?: string;
  /** Seconds to wait before retrying, from the `Retry-After` header on `429`. */
  retryAfter?: number;
  /**
   * Error-code-specific context from the API (e.g. `available` / `required` on
   * `insufficient_credit`). Absent when the API sends no `details`.
   */
  details?: Record<string, unknown> | null;
}

/**
 * Standard SDK response shape for every Public API method.
 *
 * @typeParam T - Success payload type. `null` when `error` is set.
 */
export interface ApiResponse<T> {
  /** Success payload, or `null` when the API returned an error. */
  data: T | null;
  /** API error details, or `null` on success. */
  error: ApiError | null;
  /** Request metadata (always present on successful envelope responses). */
  meta?: ApiMeta;
}

/** Pagination metadata included in list responses. */
export interface Pagination {
  /** Current page (1-indexed). */
  page: number;
  /** Items per page. */
  pageSize: number;
  /** Total items across all pages. */
  totalCount: number;
  /** Total number of pages. */
  totalPages: number;
}

/** Campaign summary returned by {@link CampaignsResource.list}. */
export interface CampaignSummary {
  campaignId: string;
  organizationId: string;
  status: CampaignStatus;
  socialPlatform: SocialPlatform;
  /** Daily budget in USD. */
  dailyBudget: number;
  /** Total budget in USD. */
  totalBudget: number;
  /** Campaign duration in days. */
  campaignDuration: number;
  /** Resource generation — writable Public API methods require `3`. */
  generation: CampaignGeneration;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 last update timestamp. */
  updatedAt: string;
}

/** Full campaign detail from {@link CampaignsResource.get}. */
export interface CampaignDetail extends CampaignSummary {
  /** Growth strategy set at creation (e.g. `custom`, `maximum_growth`). */
  strategyType?: StrategyType;
}

/** Paginated campaign list payload. */
export interface CampaignListData {
  items: CampaignSummary[];
  pagination: Pagination;
}

/** Successful `GET /v1/ping` payload. */
export interface PingData {
  status: 'ok';
}

/** One entry from `GET /v1/strategies`. */
export interface StrategyCatalogItem {
  strategyType: StrategyType;
  /** When `false`, omit `tierTargeting` on create. */
  tierTargetingAllowed: boolean;
}

/** Payload from `GET /v1/strategies`. */
export interface StrategiesCatalogData {
  strategies: StrategyCatalogItem[];
}

/** Shared fields for wallet campaign create. */
export interface CreateCampaignRequestBase {
  /** Spotify track or playlist URL. */
  spotifyUrl: string;
  /** USD per day (minimum 10). */
  dailyBudget: number;
  /** Duration in days: 7–30, or 60, or 90. */
  durationDays: number;
  genre: Genre;
  /** Optional; server generates a default when omitted. */
  campaignName?: string;
  creativeDirection?: CreativeDirection;
  trackOptions?: {
    artistIdFollow?: string;
  };
  /** Lineage only — does not copy settings from the source campaign. */
  clonedFromCampaignId?: string;
}

export interface DoItForMeCreativeDirection {
  type: 'do_it_for_me';
}

export interface FullControlCreativeDirection {
  type: 'full_control';
  selectedCreatives: Array<{ videoId: string }>;
}

export type CreativeDirection =
  | DoItForMeCreativeDirection
  | FullControlCreativeDirection;

export interface CustomTier {
  name: string;
  percentBudget: number;
  countries?: string[];
  language?: string;
}

export interface TierTargeting {
  customTierIds?: number[];
  customTiers?: CustomTier[];
}

/** Create with a built-in strategy (no `tierTargeting`). */
export interface CreateCampaignRequestBuiltIn extends CreateCampaignRequestBase {
  strategyType: BuiltInStrategyType;
  tierTargeting?: never;
}

/** Create with `custom` strategy (requires `tierTargeting`). */
export interface CreateCampaignRequestCustom extends CreateCampaignRequestBase {
  strategyType: 'custom';
  tierTargeting: TierTargeting;
}

/** Body for `POST /v1/campaigns`. */
export type CreateCampaignRequest =
  | CreateCampaignRequestBuiltIn
  | CreateCampaignRequestCustom;

/** Success payload from campaign create. */
export interface CampaignCreateData {
  campaignId: string;
  status: CampaignStatus;
}

/** Success payload from campaign stop. */
export interface CampaignStopData {
  campaignId: string;
  status: CampaignStatus;
}

export interface IncreaseCampaignBudgetRequest {
  amount: number;
  mode?: BudgetIncreaseMode;
  targetDailyBudget?: number;
}

export interface IncreaseCampaignBudgetData {
  campaignId: string;
  mode: BudgetIncreaseMode;
  amount: number;
  walletBalance: number;
  walletNextCycleDailyBudget?: number | null;
}

export interface DecreaseCampaignBudgetRequest {
  targetDailyBudget: number;
  mode?: BudgetDecreaseMode;
}

export interface DecreaseCampaignBudgetData {
  campaignId: string;
  mode: BudgetDecreaseMode;
  targetDailyBudget: number;
  accepted: true;
  walletNextCycleDailyBudget?: number | null;
}

export interface CampaignTier {
  tierId: number;
  tierName: string;
  isEnabled: boolean;
  allocationPercent: number;
}

export interface CampaignTiersData {
  lastUpdate: string | null;
  tiers: CampaignTier[];
}

export interface TierStatusUpdateItem {
  /**
   * Targeting tier id — same value as `tierId` returned by
   * `campaigns.tiers.get` (`CampaignTier.tierId`).
   */
  targetingTierId: number;
  isEnabled: boolean;
  newAllocationPercent: number;
}

export interface UpdateCampaignTiersRequest {
  items: TierStatusUpdateItem[];
}

/** Campaign-level metric totals from {@link MetricsResource.overview}. */
export interface MetricsOverview {
  listeners: number;
  streams: number;
  followers: number;
  impressions: number | null;
  ad_clicks: number | null;
  link_clicks: number | null;
  /** Meta ad spend excluding Soundlink fees (USD). */
  spend_media: number;
  /** Total billed amount including fees (USD). */
  spend_total: number;
  /** Soundlink service fee (USD). */
  fees: number;
  currency: string;
  /** Cost per listener. */
  cpl: number;
  /** Cost per follower. */
  cpf: number;
  streams_per_listener: number;
}

/** One row of the `campaign_country_daily` v1.0 schema. */
export interface BreakdownRow {
  provider: 'soundlink';
  account_id: string;
  schema_version: string;
  /** UTC calendar date (`YYYY-MM-DD`). */
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

/** One row of the `campaign_engagement_daily` v1.0 schema. */
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

/** Paginated breakdown list payload. */
export interface BreakdownListData {
  schemaVersion: string;
  items: BreakdownRow[];
  pagination: Pagination;
}

/** In-memory result from {@link ExportResource.collect}. */
export interface ExportCollection<T> {
  rows: T[];
  /** Same as `rows.length`. */
  rowCount: number;
}

/** Async iterable JSONL stream from export endpoints. May include `rowCount` from `X-Row-Count`. */
export interface JsonlStream<T> extends AsyncIterable<T> {
  /** Total rows when the API sent the `X-Row-Count` header. */
  rowCount?: number;
}

/** Options for {@link Soundlink} and {@link HttpClient}. */
export interface SoundlinkClientOptions {
  /** Soundlink API key (`sk_<prefix>_<secret>`). Sent as `Authorization: Bearer`. */
  apiKey: string;
  /** API base URL. Defaults to `https://api.getsoundlink.com`. */
  baseUrl?: string;
  /** Request timeout in milliseconds. Default: `30000`. */
  timeout?: number;
  /** Retries on `429` and `5xx`. Default: `2`. */
  maxRetries?: number;
  /** Custom `fetch` implementation (tests, Edge runtimes). */
  fetch?: typeof fetch;
}

/** API key string or full options object. */
export type SoundlinkOptions = SoundlinkClientOptions | string;

/** Query params for {@link CampaignsResource.list}. */
export interface CampaignListParams {
  /** Page number (1-indexed). Default: `1`. */
  page?: number;
  /** Items per page. Default: `10`. Max: **100**. */
  pageSize?: number;
  /** Sort field. Default: `createdAt`. */
  sortBy?: CampaignSortBy;
  /** Sort direction. Default: `desc`. */
  sortOrder?: SortOrder;
}

/** Inclusive date range filter (`YYYY-MM-DD`). */
export interface DateRangeParams {
  /** Inclusive start date. */
  startDate?: string;
  /** Inclusive end date. Must not be before `startDate`. */
  endDate?: string;
}

/** Query params for {@link BreakdownMetricsResource.list}. */
export interface BreakdownListParams extends DateRangeParams {
  page?: number;
  /** Default: `50`. Max: **500**. */
  pageSize?: number;
  /** Default: `report_date`. */
  sortBy?: BreakdownSortBy;
  /** Default: `asc`. */
  sortOrder?: SortOrder;
}

/** Query params for engagement JSONL export. */
export interface EngagementExportParams extends DateRangeParams {
  engagementContext?: EngagementContext;
}

/** Query params for breakdown JSONL export. Max **90 days** per request. */
export type BreakdownExportParams = DateRangeParams;

/** Raw success envelope from the Public API (internal). */
export interface ApiEnvelopeSuccess<T> {
  data: T;
  meta: ApiMeta;
}

/** Raw error envelope from the Public API (internal). */
export interface ApiEnvelopeError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown> | null;
  };
  meta: ApiMeta;
}
