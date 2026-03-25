import { resolveSoundlinkConfig, type ResolvedSoundlinkConfig } from "./config";
import { SoundlinkHttpClient } from "./http-client";
import {
  createOrganicCampaign as createOrganicCampaignSvc,
  listOrganicCampaigns as listOrganicCampaignsSvc,
} from "./organic-campaigns";
import {
  createCheckoutPaidCampaign as createCheckoutPaidCampaignSvc,
  createPaidCampaign as createPaidCampaignSvc,
  listPaidCampaigns as listPaidCampaignsSvc,
} from "./paid-campaigns";
import type {
  CreateCheckoutPaidCampaignInput,
  CreateCheckoutPaidCampaignResponse,
  CreateManagedPaidCampaignInput,
  CreateManagedPaidCampaignResponse,
  CreateOrganicCampaignInput,
  CreateOrganicCampaignResponse,
  ListOrganicCampaignsQuery,
  ListOrganicCampaignsResponse,
  ListPaidCampaignsQuery,
  ListPaidCampaignsResponse,
  Result,
  SoundlinkConfig,
} from "./types";

export class SoundlinkClient {
  private readonly http: SoundlinkHttpClient;
  readonly config: ResolvedSoundlinkConfig;

  constructor(
    config: ResolvedSoundlinkConfig,
    fetchOverride?: typeof fetch,
  ) {
    this.config = config;
    this.http = new SoundlinkHttpClient(config, fetchOverride);
  }

  createPaidCampaign(
    input: CreateManagedPaidCampaignInput,
  ): Promise<Result<CreateManagedPaidCampaignResponse>> {
    return createPaidCampaignSvc(this.http, input);
  }

  createCheckoutPaidCampaign(
    input: CreateCheckoutPaidCampaignInput,
  ): Promise<Result<CreateCheckoutPaidCampaignResponse>> {
    return createCheckoutPaidCampaignSvc(this.http, input);
  }

  listPaidCampaigns(
    query?: ListPaidCampaignsQuery,
  ): Promise<Result<ListPaidCampaignsResponse>> {
    return listPaidCampaignsSvc(this.http, query);
  }

  createOrganicCampaign(
    input: CreateOrganicCampaignInput,
  ): Promise<Result<CreateOrganicCampaignResponse>> {
    return createOrganicCampaignSvc(this.http, input);
  }

  listOrganicCampaigns(
    query?: ListOrganicCampaignsQuery,
  ): Promise<Result<ListOrganicCampaignsResponse>> {
    return listOrganicCampaignsSvc(this.http, query);
  }
}

export function createClient(
  config?: SoundlinkConfig,
  fetchOverride?: typeof fetch,
): SoundlinkClient {
  const resolved = resolveSoundlinkConfig(config);
  return new SoundlinkClient(resolved, fetchOverride);
}

let defaultClient: SoundlinkClient | null = null;

function getDefaultClient(): SoundlinkClient {
  if (!defaultClient) {
    defaultClient = createClient();
  }
  return defaultClient;
}

/** Uses `process.env` via {@link createClient}() with no arguments. */
export function createPaidCampaign(
  input: CreateManagedPaidCampaignInput,
): Promise<Result<CreateManagedPaidCampaignResponse>> {
  return getDefaultClient().createPaidCampaign(input);
}

export function createCheckoutPaidCampaign(
  input: CreateCheckoutPaidCampaignInput,
): Promise<Result<CreateCheckoutPaidCampaignResponse>> {
  return getDefaultClient().createCheckoutPaidCampaign(input);
}

export function listPaidCampaigns(
  query?: ListPaidCampaignsQuery,
): Promise<Result<ListPaidCampaignsResponse>> {
  return getDefaultClient().listPaidCampaigns(query);
}

export function createOrganicCampaign(
  input: CreateOrganicCampaignInput,
): Promise<Result<CreateOrganicCampaignResponse>> {
  return getDefaultClient().createOrganicCampaign(input);
}

export function listOrganicCampaigns(
  query?: ListOrganicCampaignsQuery,
): Promise<Result<ListOrganicCampaignsResponse>> {
  return getDefaultClient().listOrganicCampaigns(query);
}
