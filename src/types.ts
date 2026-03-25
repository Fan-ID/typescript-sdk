/**
 * Types aligned with fan-id-backend + ui call sites.
 * See PLAN.md for route mapping and caveats.
 */

// ─── Shared API config ───────────────────────────────────────────────────────

export interface SoundlinkConfig {
  /**
   * Bearer token (same as UI Authorization header).
   * Default: process.env.SOUNDLINK_TOKEN
   */
  apiKey?: string;
  /**
   * Organization scope (header x-organization-id).
   * Default: process.env.SOUNDLINK_ORGANIZATION_ID
   */
  organizationId?: string;
  /**
   * API root without trailing slash (same role as FAN_ID_API_BASE_URL in ui).
   * Default: process.env.SOUNDLINK_BASE_URL
   */
  baseUrl?: string;
  timeout?: number;
  debug?: boolean;
}

// ─── Paid: StrategyType (backend models/campaigns.ts) ─────────────────────

/** Paid campaigns only. Sent as JSON field `strategyType`. */
export type StrategyType =
  | "maximum_growth"
  | "market_discovery"
  | "revenue_maximization"
  | "custom"
  | "custom_default"
  | "custom_localized";

export const STRATEGY_TYPES: readonly StrategyType[] = [
  "maximum_growth",
  "market_discovery",
  "revenue_maximization",
  "custom",
  "custom_default",
  "custom_localized",
] as const;

/** Ad platform for paid managed create (backend SocialPlatform). */
export type PaidSocialPlatform = "meta" | "tiktok";

// ─── Paid: POST /api/v1/campaigns/managed ───────────────────────────────────
// campaign.controller.ts — CreateManagedCampaignRequestBody

export interface ManagedPaidSelectedCreative {
  videoUri: string;
  caption: string;
  videoId?: string;
  captionGroupId?: string | null;
}

/**
 * Body for POST /api/v1/campaigns/managed (mirrors UI `actions.ts` / controller).
 * Required fields are enforced by the API; optional match backend.
 */
export interface CreateManagedPaidCampaignInput {
  spotifyLink: string;
  dailyBudget: number;
  campaignDuration: number;
  /** Display name for the smart link (API field `smartLinkName`). */
  smartLinkName: string;
  /** User id string (API field `createdBy`). */
  createdBy: string;
  selectedGenre?: string;
  /** Paid-only targeting strategy; omit when not using strategy selection. */
  strategyType?: StrategyType;
  platform?: PaidSocialPlatform;
  customTierIds?: number[];
  customTiers?: CustomTierRequestInput[];
  creativeStrategyTag?: string;
  creativeStrategyTags?: string[];
  audioUri?: string;
  captionTypes?: string[];
  creativeDirectionType?: "do_it_for_me" | "full_control" | string;
  selectedCreatives?: ManagedPaidSelectedCreative[];
}

export interface CustomTierRequestInput {
  id?: number;
  name: string;
  countries?: string[];
  language?: string | null;
  percentBudget: number;
}

export interface CreateManagedPaidCampaignResponse {
  campaignId: string;
  smartLinkId: string;
}

// ─── Paid: POST /api/v1/campaigns (Stripe checkout completion) ──────────────
// For automation after checkout; not used by createManagedPaidCampaign.

export interface CreateCheckoutPaidCampaignPaymentInfo {
  sessionId: string;
  paymentIntentId: string;
  eventId: string;
  invoiceId?: string;
}

export interface CreateCheckoutPaidCampaignInput {
  spotifyLink: string;
  dailyBudget: number;
  campaignDuration: number;
  smartLinkName: string;
  createdBy: string;
  paymentInfo: CreateCheckoutPaidCampaignPaymentInfo;
  selectedGenre?: string;
  strategyType?: StrategyType;
  paymentMode?: string;
  autoRenewConfiguration?: {
    stripeSubscriptionId: string;
    stripeCustomerId: string;
  };
}

export interface CreateCheckoutPaidCampaignResponse {
  campaignId: string;
  smartLinkId: string;
}

// ─── Paid: GET /api/v1/campaigns ────────────────────────────────────────────
// campaigns.repository findCampaignByOrganizationIdWithPagination shape

export type PaidCampaignSortField =
  | "totalBudget"
  | "dailyBudget"
  | "organizationId"
  | "createdAt"
  | "updatedAt"
  | "metaCampaignId";

export interface ListPaidCampaignsQuery {
  page?: number;
  pageSize?: number;
  sortBy?: PaidCampaignSortField | string;
  sortOrder?: "asc" | "desc";
}

/** Subset returned by list pagination (camelCase as API JSON). */
export interface PaidCampaignListItem {
  id: string;
  organizationId: string;
  status: string;
  dailyBudget: number;
  totalBudget: number;
  campaignDuration: number;
  createdAt: string;
  updatedAt: string;
  metaCampaignId: string;
  autoOptimizeEnabled: boolean;
}

export interface ListPaidCampaignsResponse {
  items: PaidCampaignListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages?: number;
}

// ─── Organic: enums (calendars + social-account) ───────────────────────────

export type OrganicCalendarStatus =
  | "active"
  | "inactive"
  | "ended"
  | "archived";

export type OrganicTimeWindow = "morning" | "afternoon" | "evening" | "night";

export type OrganicChannelType = "tiktok" | "instagram";

export interface CalendarDailyConfigInput {
  timeWindow: OrganicTimeWindow;
  /** 0–23 */
  startHour: number;
  /** 0–23 */
  endHour: number;
}

/**
 * TikTok trial graduation (organic initial post settings only).
 * Backend allows: MANUAL | SS_PERFORMANCE
 */
export type TrialGraduationStrategy = "MANUAL" | "SS_PERFORMANCE";

export interface OrganicInitialPostSettings {
  title?: string;
  description?: string;
  privacyLevel?: string;
  shareToFeed?: boolean;
  trialGraduationStrategy?: TrialGraduationStrategy | null;
}

// ─── Organic: POST /api/v1/organic-growth/campaigns ───────────────────────

export interface CreateOrganicCampaignInput {
  socialAccountId: string;
  name: string;
  spotifyLink: string;
  color: string;
  dailyPostsQuantity: number;
  /** ISO date string */
  startDate: string;
  endDate?: string | null;
  timeZone?: string | null;
  timeDailyConfigs?: CalendarDailyConfigInput[];
  creativeTag?: string[];
  captionType?: string[];
  audioUri?: string;
  language?: string;
  initialPostSettings?: OrganicInitialPostSettings;
}

export interface CreateOrganicCampaignResponse {
  calendarId: string;
}

// ─── Organic: GET /api/v1/organic-growth/campaigns ──────────────────────────

export interface ListOrganicCampaignsQuery {
  status?: OrganicCalendarStatus[];
  platform?: OrganicChannelType[];
  socialAccountId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: "name" | "createdAt" | "updatedAt";
  sortOrder?: "asc" | "desc";
}

export interface OrganicCampaignStats {
  totalPosts: number;
  pendingPosts: number;
  approvedPosts: number;
  publishedPosts: number;
  failedPosts: number;
  totalViews?: number;
  totalLikes?: number;
  totalComments?: number;
  totalShares?: number;
}

export interface OrganicCampaignTimeWindowRow {
  id: string;
  timeWindow: string;
  startHour: string;
  endHour: string;
}

/** Mirrors ui/src/lib/organic-growth.ts OrganicCampaignSummary. */
export interface OrganicCampaignSummary {
  id: string;
  name: string;
  color: string;
  status: OrganicCalendarStatus;
  socialAccountId: string;
  socialAccountName: string;
  platform: OrganicChannelType;
  startDate: string;
  endDate: string | null;
  periodDays: number | null;
  timeZone: string | null;
  spotifyLink: string;
  dailyPostsQuantity?: number;
  timeWindows?: OrganicCampaignTimeWindowRow[];
  language?: string;
  creatorUsername?: string;
  creatorNickname?: string;
  createdAt: string;
  updatedAt: string;
  stats: OrganicCampaignStats;
  captionType?: string[] | null;
  creativeTag?: string[] | null;
}

export interface ListOrganicCampaignsResponse {
  campaigns: OrganicCampaignSummary[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

// ─── Result wrapper (SDK public API) ─────────────────────────────────────────

export type Ok<T> = { data: T; error: null };
export type Err<E> = { data: null; error: E };
export type Result<T, E = import("./errors").SoundlinkError> = Ok<T> | Err<E>;
