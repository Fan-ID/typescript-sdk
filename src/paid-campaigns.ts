import type { SoundlinkHttpClient } from "./http-client";
import type {
  CreateCheckoutPaidCampaignInput,
  CreateCheckoutPaidCampaignResponse,
  CreateManagedPaidCampaignInput,
  CreateManagedPaidCampaignResponse,
  ListPaidCampaignsQuery,
  ListPaidCampaignsResponse,
  Result,
} from "./types";

const PAID_CAMPAIGNS_PATH = "/api/v1/campaigns";
const PAID_MANAGED_PATH = "/api/v1/campaigns/managed";

export async function createPaidCampaign(
  http: SoundlinkHttpClient,
  input: CreateManagedPaidCampaignInput,
): Promise<Result<CreateManagedPaidCampaignResponse>> {
  return http.requestJson<CreateManagedPaidCampaignResponse>({
    method: "POST",
    path: PAID_MANAGED_PATH,
    body: input,
  });
}

/** POST /api/v1/campaigns — after Stripe checkout (`paymentInfo` required). */
export async function createCheckoutPaidCampaign(
  http: SoundlinkHttpClient,
  input: CreateCheckoutPaidCampaignInput,
): Promise<Result<CreateCheckoutPaidCampaignResponse>> {
  return http.requestJson<CreateCheckoutPaidCampaignResponse>({
    method: "POST",
    path: PAID_CAMPAIGNS_PATH,
    body: input,
  });
}

export async function listPaidCampaigns(
  http: SoundlinkHttpClient,
  query: ListPaidCampaignsQuery = {},
): Promise<Result<ListPaidCampaignsResponse>> {
  return http.requestJson<ListPaidCampaignsResponse>({
    method: "GET",
    path: PAID_CAMPAIGNS_PATH,
    query: {
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    },
  });
}
