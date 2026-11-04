import { createHash, randomUUID } from 'node:crypto';
import type {
  CampaignDetail,
  CampaignStatus,
  MetricsOverview,
  StrategyType,
  WalletData,
} from '../types/api.js';
import { computeCommittedUsd } from './money.js';

export const ORG_EMULATOR_ID = 'org_emulator';

export type EmulatorTransitionAction = 'activate' | 'reject_meta' | 'set_spend' | 'end';

export interface EmulatorCampaignRecord {
  campaignId: string;
  status: CampaignStatus;
  dailyBudget: number;
  durationDays: number;
  committedUsd: number;
  mediaSpendUsd: number;
  refundedAt: string | null;
  autoRenew: boolean;
  strategyType: StrategyType;
  spotifyUrl: string;
  genre: string;
  campaignName: string;
  trackId: string | null;
  playlistId: string | null;
  artistId: string | null;
  artistName: string | null;
  trackName: string | null;
  createdAt: string;
  updatedAt: string;
  overview: MetricsOverview | null;
}

export interface IdempotencyRecord {
  requestHash: string;
  status: number;
  body: unknown;
}

export interface EmulatorStoreOptions {
  apiKey: string;
  initialWalletBalance: number;
  feeRate: number;
  organizationId?: string;
}

export interface EmulatorStore {
  readonly apiKey: string;
  readonly feeRate: number;
  readonly organizationId: string;
  readonly initialWalletBalance: number;
  reset(): void;
  getWallet(): WalletData;
  setWalletBalance(balance: number): WalletData;
  listCampaigns(): EmulatorCampaignRecord[];
  getCampaign(campaignId: string): EmulatorCampaignRecord | undefined;
  createCampaign(input: {
    dailyBudget: number;
    durationDays: number;
    autoRenew: boolean;
    strategyType: StrategyType;
    spotifyUrl: string;
    genre: string;
    campaignName?: string;
  }): EmulatorCampaignRecord;
  updateCampaign(campaign: EmulatorCampaignRecord): void;
  creditWallet(amount: number): void;
  debitWallet(amount: number): void;
  getIdempotency(key: string): IdempotencyRecord | undefined;
  setIdempotency(key: string, record: IdempotencyRecord): void;
  deleteIdempotency(key: string): void;
  toCampaignDetail(campaign: EmulatorCampaignRecord): CampaignDetail;
  buildOverview(campaign: EmulatorCampaignRecord): MetricsOverview;
}

function nowIso(): string {
  return new Date().toISOString();
}

function emptyOverview(): MetricsOverview {
  return {
    listeners: 0,
    total_listeners: 0,
    streams: 0,
    followers: 0,
    impressions: null,
    ad_clicks: null,
    link_clicks: null,
    spend_media: 0,
    spend_total: 0,
    fees: 0,
    currency: 'USD',
    cpl: 0,
    cpf: 0,
    streams_per_listener: 0,
  };
}

function seedOverviewAfterActivate(): MetricsOverview {
  const listeners = 120;
  const totalListeners = 150;
  const streams = 450;
  const followers = 18;
  return {
    listeners,
    total_listeners: totalListeners,
    streams,
    followers,
    impressions: 8000,
    ad_clicks: 400,
    link_clicks: 220,
    spend_media: 0,
    spend_total: 0,
    fees: 0,
    currency: 'USD',
    cpl: 0,
    cpf: 0,
    streams_per_listener: Number((streams / totalListeners).toFixed(4)),
  };
}

function parseSpotifyIds(spotifyUrl: string): {
  trackId: string | null;
  playlistId: string | null;
} {
  const trackMatch = /track\/([a-zA-Z0-9]+)/.exec(spotifyUrl);
  const trackId = trackMatch?.[1];
  if (typeof trackId === 'string') {
    return { trackId, playlistId: null };
  }
  const playlistMatch = /playlist\/([a-zA-Z0-9]+)/.exec(spotifyUrl);
  const playlistId = playlistMatch?.[1];
  if (typeof playlistId === 'string') {
    return { trackId: null, playlistId };
  }
  return { trackId: null, playlistId: null };
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

export function createEmulatorStore(options: EmulatorStoreOptions): EmulatorStore {
  const organizationId = options.organizationId ?? ORG_EMULATOR_ID;
  let balance = roundMoney(options.initialWalletBalance);
  let updatedAt: string | null = nowIso();
  const campaigns = new Map<string, EmulatorCampaignRecord>();
  const idempotency = new Map<string, IdempotencyRecord>();

  const store: EmulatorStore = {
    apiKey: options.apiKey,
    feeRate: options.feeRate,
    organizationId,
    initialWalletBalance: options.initialWalletBalance,

    reset() {
      balance = roundMoney(options.initialWalletBalance);
      updatedAt = nowIso();
      campaigns.clear();
      idempotency.clear();
    },

    getWallet() {
      return {
        balance,
        available: balance,
        reserved: 0,
        currency: 'USD',
        updatedAt,
      };
    },

    setWalletBalance(nextBalance: number) {
      balance = roundMoney(nextBalance);
      updatedAt = nowIso();
      return store.getWallet();
    },

    listCampaigns() {
      return [...campaigns.values()].sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : -1,
      );
    },

    getCampaign(campaignId: string) {
      return campaigns.get(campaignId);
    },

    createCampaign(input) {
      const committedUsd = computeCommittedUsd(input.dailyBudget, input.durationDays);
      const ids = parseSpotifyIds(input.spotifyUrl);
      const timestamp = nowIso();
      const campaignId = `cmp_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
      const record: EmulatorCampaignRecord = {
        campaignId,
        status: 'creating',
        dailyBudget: input.dailyBudget,
        durationDays: input.durationDays,
        committedUsd,
        mediaSpendUsd: 0,
        refundedAt: null,
        autoRenew: input.autoRenew,
        strategyType: input.strategyType,
        spotifyUrl: input.spotifyUrl,
        genre: input.genre,
        campaignName: input.campaignName ?? `Emulator campaign ${campaignId}`,
        trackId: ids.trackId,
        playlistId: ids.playlistId,
        artistId: null,
        artistName: null,
        trackName: ids.trackId ? 'Emulator Track' : null,
        createdAt: timestamp,
        updatedAt: timestamp,
        overview: null,
      };
      campaigns.set(campaignId, record);
      return record;
    },

    updateCampaign(campaign) {
      campaign.updatedAt = nowIso();
      campaigns.set(campaign.campaignId, campaign);
    },

    creditWallet(amount: number) {
      if (!Number.isFinite(amount) || amount <= 0) return;
      balance = roundMoney(balance + amount);
      updatedAt = nowIso();
    },

    debitWallet(amount: number) {
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('debitWallet requires a finite positive amount.');
      }
      if (amount > balance) {
        throw new Error('debitWallet would make wallet balance negative.');
      }
      balance = roundMoney(balance - amount);
      updatedAt = nowIso();
    },

    getIdempotency(key: string) {
      return idempotency.get(key);
    },

    setIdempotency(key: string, record: IdempotencyRecord) {
      idempotency.set(key, record);
    },

    deleteIdempotency(key: string) {
      idempotency.delete(key);
    },

    toCampaignDetail(campaign) {
      return {
        campaignId: campaign.campaignId,
        organizationId,
        status: campaign.status,
        socialPlatform: 'meta',
        dailyBudget: campaign.dailyBudget,
        totalBudget: campaign.committedUsd,
        campaignDuration: campaign.durationDays,
        generation: 3,
        artistId: campaign.artistId,
        artistName: campaign.artistName,
        trackId: campaign.trackId,
        playlistId: campaign.playlistId,
        trackName: campaign.trackName,
        campaignUrl: `https://app.getsoundlink.com/campaigns/${campaign.campaignId}`,
        createdAt: campaign.createdAt,
        updatedAt: campaign.updatedAt,
        strategyType: campaign.strategyType,
        autoRenew: campaign.autoRenew,
        nextRenewalAt: null,
      };
    },

    buildOverview(campaign) {
      const base = campaign.overview ?? emptyOverview();
      const spendMedia = campaign.mediaSpendUsd;
      const fees = 0;
      const listeners = base.listeners;
      const followers = base.followers;
      return {
        ...base,
        spend_media: spendMedia,
        spend_total: Number((spendMedia + fees).toFixed(2)),
        fees,
        cpl: listeners > 0 ? Number((spendMedia / listeners).toFixed(4)) : 0,
        cpf: followers > 0 ? Number((spendMedia / followers).toFixed(4)) : 0,
      };
    },
  };

  return store;
}

export function seedOverview(campaign: EmulatorCampaignRecord): void {
  campaign.overview = seedOverviewAfterActivate();
}

export function hashPayload(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(',')}}`;
}
