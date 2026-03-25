import type { SoundlinkHttpClient } from "./http-client";
import type {
  CreateOrganicCampaignInput,
  CreateOrganicCampaignResponse,
  ListOrganicCampaignsQuery,
  ListOrganicCampaignsResponse,
  Result,
} from "./types";

const ORGANIC_CAMPAIGNS_PATH = "/api/v1/organic-growth/campaigns";

function listOrganicQueryParams(
  query: ListOrganicCampaignsQuery,
): Record<string, string | number | boolean | undefined | null> {
  const q: Record<string, string | number | boolean | undefined | null> = {
    page: query.page,
    pageSize: query.pageSize,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    socialAccountId: query.socialAccountId,
    startDate: query.startDate,
    endDate: query.endDate,
    search: query.search,
  };
  if (query.status?.length) {
    q.status = query.status.join(",");
  }
  if (query.platform?.length) {
    q.platform = query.platform.join(",");
  }
  return q;
}

export async function createOrganicCampaign(
  http: SoundlinkHttpClient,
  input: CreateOrganicCampaignInput,
): Promise<Result<CreateOrganicCampaignResponse>> {
  return http.requestJson<CreateOrganicCampaignResponse>({
    method: "POST",
    path: ORGANIC_CAMPAIGNS_PATH,
    body: input,
  });
}

export async function listOrganicCampaigns(
  http: SoundlinkHttpClient,
  query: ListOrganicCampaignsQuery = {},
): Promise<Result<ListOrganicCampaignsResponse>> {
  return http.requestJson<ListOrganicCampaignsResponse>({
    method: "GET",
    path: ORGANIC_CAMPAIGNS_PATH,
    query: listOrganicQueryParams(query),
  });
}
