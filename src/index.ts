export {
  createCheckoutPaidCampaign,
  createClient,
  createOrganicCampaign,
  createPaidCampaign,
  listOrganicCampaigns,
  listPaidCampaigns,
  SoundlinkClient,
} from "./client";
export {
  assertConfigReady,
  resolveSoundlinkConfig,
  type ResolvedSoundlinkConfig,
} from "./config";
export {
  AuthenticationError,
  NetworkError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  ServerError,
  SoundlinkError,
  ValidationError,
} from "./errors";
export { readEnv, readEnvBoolean } from "./env";
export { SoundlinkHttpClient } from "./http-client";
export {
  createOrganicCampaign as createOrganicCampaignWithHttp,
  listOrganicCampaigns as listOrganicCampaignsWithHttp,
} from "./organic-campaigns";
export {
  createCheckoutPaidCampaign as createCheckoutPaidCampaignWithHttp,
  createPaidCampaign as createPaidCampaignWithHttp,
  listPaidCampaigns as listPaidCampaignsWithHttp,
} from "./paid-campaigns";
export { err, ok } from "./result";
export type {
  CalendarDailyConfigInput,
  CreateCheckoutPaidCampaignInput,
  CreateCheckoutPaidCampaignPaymentInfo,
  CreateCheckoutPaidCampaignResponse,
  CreateManagedPaidCampaignInput,
  CreateManagedPaidCampaignResponse,
  CreateOrganicCampaignInput,
  CreateOrganicCampaignResponse,
  CustomTierRequestInput,
  Err,
  ListOrganicCampaignsQuery,
  ListOrganicCampaignsResponse,
  ListPaidCampaignsQuery,
  ListPaidCampaignsResponse,
  ManagedPaidSelectedCreative,
  Ok,
  OrganicCalendarStatus,
  OrganicCampaignStats,
  OrganicCampaignSummary,
  OrganicCampaignTimeWindowRow,
  OrganicChannelType,
  OrganicInitialPostSettings,
  OrganicTimeWindow,
  PaidCampaignListItem,
  PaidCampaignSortField,
  PaidSocialPlatform,
  Result,
  SoundlinkConfig,
  StrategyType,
  TrialGraduationStrategy,
} from "./types";
export { STRATEGY_TYPES } from "./types";
