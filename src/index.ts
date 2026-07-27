/**
 * Official TypeScript SDK for the [Soundlink Public API](https://docs.getsoundlink.com).
 *
 * @packageDocumentation
 */
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
  BudgetDecreaseMode,
  BudgetIncreaseMode,
  BuiltInStrategyType,
  CampaignCreateData,
  CampaignDetail,
  CampaignGeneration,
  CampaignListData,
  CampaignListParams,
  CampaignSortBy,
  CampaignStatus,
  CampaignStopData,
  CampaignSummary,
  CampaignTier,
  CampaignTiersData,
  CreateCampaignRequest,
  CreateCampaignRequestBase,
  CreateCampaignRequestBuiltIn,
  CreateCampaignRequestCustom,
  CreativeDirection,
  CustomTier,
  DateRangeParams,
  DecreaseCampaignBudgetData,
  DecreaseCampaignBudgetRequest,
  DoItForMeCreativeDirection,
  EngagementContext,
  EngagementExportParams,
  EngagementRow,
  ExportCollection,
  FullControlCreativeDirection,
  Genre,
  IdempotencyOptions,
  IncreaseCampaignBudgetData,
  IncreaseCampaignBudgetRequest,
  JsonlStream,
  MetricsOverview,
  Pagination,
  PingData,
  PublicApiErrorCode,
  SocialPlatform,
  SortOrder,
  SoundlinkClientOptions,
  SoundlinkOptions,
  StrategiesCatalogData,
  StrategyCatalogItem,
  StrategyType,
  TierStatusUpdateItem,
  TierTargeting,
  UpdateCampaignTiersRequest,
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
