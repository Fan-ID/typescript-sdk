export { Soundlink, HttpClient, resolveClientOptions } from './client/soundlink.js';

export {
  SoundlinkSdkError,
  SoundlinkParseError,
  SoundlinkConfigError,
} from './errors/sdk-error.js';

export type {
  ApiError,
  ApiMeta,
  ApiResponse,
  BreakdownExportParams,
  BreakdownListData,
  BreakdownListParams,
  BreakdownRow,
  CampaignDetail,
  CampaignListData,
  CampaignListParams,
  CampaignSortBy,
  CampaignStatus,
  CampaignSummary,
  DateRangeParams,
  EngagementContext,
  EngagementExportParams,
  EngagementListData,
  EngagementListParams,
  EngagementRow,
  EngagementSortBy,
  ExportCollection,
  JsonlStream,
  MetricsOverview,
  Pagination,
  PingData,
  PublicApiErrorCode,
  SocialPlatform,
  SortOrder,
  SoundlinkClientOptions,
  SoundlinkOptions,
} from './types/api.js';

export type { ExportResource } from './resources/index.js';

export {
  DEFAULT_BASE_URL,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  API_KEY_PREFIX,
  CAMPAIGNS_MAX_PAGE_SIZE,
  METRICS_MAX_PAGE_SIZE,
} from './constants/defaults.js';

export { getStreamRowCount } from './client/http-client.js';
