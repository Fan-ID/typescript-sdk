import type { CreateCampaignRequest } from '../../src/types/api.js';

export const EMULATOR_API_KEY = 'sk_emulator_test';

export const DEFAULT_CREATE_BODY: CreateCampaignRequest = {
  spotifyUrl: 'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh',
  dailyBudget: 10,
  durationDays: 7,
  genre: 'Pop',
  strategyType: 'maximum_growth',
  autoRenew: false,
};

/** Committed debit for {@link DEFAULT_CREATE_BODY}: 10 * 7 = 70. */
export const DEFAULT_COMMITTED_USD = 70;

export function authHeaders(
  idempotencyKey?: string,
  apiKey: string = EMULATOR_API_KEY,
): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
  };
  if (idempotencyKey !== undefined) {
    headers['idempotency-key'] = idempotencyKey;
  }
  return headers;
}

export function envelopeData(json: unknown): unknown {
  if (!json || typeof json !== 'object' || !('data' in json)) {
    throw new Error('Missing envelope data');
  }
  return json.data;
}

export function envelopeError(json: unknown): {
  code: string;
  message: string;
  details?: Record<string, unknown> | null;
} {
  if (!json || typeof json !== 'object' || !('error' in json)) {
    throw new Error('Missing envelope error');
  }
  const error = json.error;
  if (
    !error ||
    typeof error !== 'object' ||
    !('code' in error) ||
    !('message' in error)
  ) {
    throw new Error('Invalid envelope error');
  }
  if (typeof error.code !== 'string' || typeof error.message !== 'string') {
    throw new Error('Invalid envelope error fields');
  }
  return {
    code: error.code,
    message: error.message,
    details:
      'details' in error
        ? (error.details as Record<string, unknown> | null | undefined)
        : undefined,
  };
}

export function asCampaignCreate(data: unknown): {
  campaignId: string;
  status: string;
  autoRenew: boolean;
} {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid create payload');
  }
  const record = data as Record<string, unknown>;
  if (
    typeof record.campaignId !== 'string' ||
    typeof record.status !== 'string' ||
    typeof record.autoRenew !== 'boolean'
  ) {
    throw new Error('Invalid create payload fields');
  }
  return {
    campaignId: record.campaignId,
    status: record.status,
    autoRenew: record.autoRenew,
  };
}

export function asWallet(data: unknown): {
  balance: number;
  available: number;
  reserved: number;
  currency: string;
  updatedAt: string | null;
} {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid wallet payload');
  }
  const record = data as Record<string, unknown>;
  if (
    typeof record.balance !== 'number' ||
    typeof record.available !== 'number' ||
    typeof record.reserved !== 'number' ||
    typeof record.currency !== 'string'
  ) {
    throw new Error('Invalid wallet fields');
  }
  return {
    balance: record.balance,
    available: record.available,
    reserved: record.reserved,
    currency: record.currency,
    updatedAt:
      record.updatedAt === null || typeof record.updatedAt === 'string'
        ? record.updatedAt
        : null,
  };
}
