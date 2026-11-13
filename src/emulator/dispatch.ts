import { randomUUID } from 'node:crypto';
import type {
  BuiltInStrategyType,
  CreateCampaignRequest,
  StrategyType,
} from '../types/api.js';
import { computeCommittedUsd } from './money.js';
import {
  hashPayload,
  type EmulatorFault,
  type EmulatorStore,
  type EmulatorTransitionAction,
} from './store.js';
import { applyPublicStop, applyTransition, TransitionError } from './transitions.js';

export interface EmulatorRequest {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface EmulatorResponse {
  status: number;
  json: unknown;
  /** HTTP listen leaves the socket open until the client aborts. */
  hang?: boolean;
}

function parsePathname(path: string): string {
  return new URL(path, 'http://emulator.local').pathname;
}

function matchPathGroup(pathname: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(pathname);
  const group = match?.[1];
  return typeof group === 'string' ? group : undefined;
}

function headerValue(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return value;
    }
  }
  return undefined;
}

function success(
  status: number,
  data: unknown,
  requestId = randomUUID(),
): EmulatorResponse {
  return {
    status,
    json: {
      data,
      meta: { requestId },
    },
  };
}

function failure(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown> | null,
): EmulatorResponse {
  return {
    status,
    json: {
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
      },
      meta: { requestId: randomUUID() },
    },
  };
}

function requireApiKey(
  store: EmulatorStore,
  headers: Record<string, string> | undefined,
): EmulatorResponse | null {
  const authorization = headerValue(headers, 'authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return failure(
      401,
      'invalid_api_key',
      'Missing credentials. Send Authorization: Bearer.',
    );
  }
  const token = authorization.slice('Bearer '.length).trim();
  if (!token.startsWith('sk_') || token !== store.apiKey) {
    return failure(
      401,
      'invalid_api_key',
      'Missing credentials. Send Authorization: Bearer.',
    );
  }
  return null;
}

function readIdempotencyKey(
  headers: Record<string, string> | undefined,
): { key: string } | EmulatorResponse {
  const raw = headerValue(headers, 'idempotency-key');
  const key = raw?.trim() ?? '';
  if (!key) {
    return failure(
      400,
      'invalid_request',
      'Idempotency-Key header is required and must not be empty.',
    );
  }
  if (key.length > 255) {
    return failure(
      400,
      'invalid_request',
      'Idempotency-Key must not exceed 255 characters.',
    );
  }
  return { key };
}

function isTransitionAction(value: unknown): value is EmulatorTransitionAction {
  return (
    value === 'activate' ||
    value === 'reject_meta' ||
    value === 'set_spend' ||
    value === 'end'
  );
}

const BUILT_IN_STRATEGIES: BuiltInStrategyType[] = [
  'maximum_growth',
  'market_discovery',
  'revenue_maximization',
];

const MIN_DAILY_BUDGET_USD = 10;
const DURATION_DAYS_MIN = 7;
const DURATION_DAYS_MAX_CUSTOM = 30;
const DURATION_DAYS_EXTRAS = new Set([60, 90]);

function isValidDurationDays(durationDays: number): boolean {
  if (!Number.isInteger(durationDays)) {
    return false;
  }
  if (DURATION_DAYS_EXTRAS.has(durationDays)) {
    return true;
  }
  return durationDays >= DURATION_DAYS_MIN && durationDays <= DURATION_DAYS_MAX_CUSTOM;
}

type ParseCreateFailure = {
  ok: false;
  status: number;
  code: string;
  message: string;
};

function parseCreateBody(
  body: unknown,
): { ok: true; value: CreateCampaignRequest } | ParseCreateFailure {
  if (!body || typeof body !== 'object') {
    return {
      ok: false,
      status: 400,
      code: 'invalid_request',
      message: 'Invalid request body.',
    };
  }
  const raw = body as Record<string, unknown>;
  if (typeof raw.spotifyUrl !== 'string' || raw.spotifyUrl.length === 0) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_request',
      message: 'Missing required field: spotifyUrl.',
    };
  }
  if (typeof raw.dailyBudget !== 'number') {
    return {
      ok: false,
      status: 400,
      code: 'invalid_request',
      message: 'Missing required field: dailyBudget.',
    };
  }
  if (typeof raw.durationDays !== 'number') {
    return {
      ok: false,
      status: 400,
      code: 'invalid_request',
      message: 'Missing required field: durationDays.',
    };
  }
  if (typeof raw.genre !== 'string' || raw.genre.length === 0) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_request',
      message: 'Missing required field: genre.',
    };
  }
  if (typeof raw.strategyType !== 'string' || raw.strategyType.length === 0) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_request',
      message: 'Missing required field: strategyType.',
    };
  }
  if (!Number.isFinite(raw.dailyBudget) || raw.dailyBudget < MIN_DAILY_BUDGET_USD) {
    return {
      ok: false,
      status: 422,
      code: 'invalid_daily_budget',
      message: 'dailyBudget must be at least 10 (USD per day).',
    };
  }
  if (!Number.isFinite(raw.durationDays) || !isValidDurationDays(raw.durationDays)) {
    return {
      ok: false,
      status: 422,
      code: 'invalid_duration_days',
      message: 'durationDays must be an integer from 7 to 30, or 60, or 90.',
    };
  }
  return { ok: true, value: body as CreateCampaignRequest };
}

export function dispatch(
  store: EmulatorStore,
  request: EmulatorRequest,
): EmulatorResponse {
  const method = request.method.toUpperCase();
  const pathname = parsePathname(request.path);

  if (pathname.startsWith('/__emulator')) {
    return dispatchHarness(store, method, pathname, request.body);
  }

  if (!pathname.startsWith('/v1')) {
    return failure(404, 'not_found', 'Not found.');
  }

  const authError = requireApiKey(store, request.headers);
  if (authError) {
    return authError;
  }

  const fault = store.takeFault();
  if (fault === 'timeout') {
    return { status: 0, json: null, hang: true };
  }
  if (fault === 'conflict') {
    return failure(
      409,
      'idempotency_key_conflict',
      'This Idempotency-Key was already used with a different request body.',
    );
  }
  if (fault === 'server_error') {
    return failure(500, 'internal_error', 'Emulator fault.');
  }

  if (method === 'GET' && pathname === '/v1/ping') {
    return success(200, { status: 'ok' });
  }

  if (method === 'GET' && pathname === '/v1/wallet') {
    return success(200, store.getWallet());
  }

  if (method === 'GET' && pathname === '/v1/strategies') {
    return success(200, {
      strategies: [
        ...BUILT_IN_STRATEGIES.map((strategyType) => ({
          strategyType,
          tierTargetingAllowed: false,
        })),
        { strategyType: 'custom' as StrategyType, tierTargetingAllowed: true },
      ],
    });
  }

  if (method === 'GET' && pathname === '/v1/campaigns') {
    const items = store.listCampaigns().map((campaign) => {
      const detail = store.toCampaignDetail(campaign);
      return {
        campaignId: detail.campaignId,
        organizationId: detail.organizationId,
        status: detail.status,
        socialPlatform: detail.socialPlatform,
        dailyBudget: detail.dailyBudget,
        totalBudget: detail.totalBudget,
        campaignDuration: detail.campaignDuration,
        generation: detail.generation,
        artistId: detail.artistId,
        artistName: detail.artistName,
        trackId: detail.trackId,
        playlistId: detail.playlistId,
        trackName: detail.trackName,
        campaignUrl: detail.campaignUrl,
        createdAt: detail.createdAt,
        updatedAt: detail.updatedAt,
      };
    });
    return success(200, {
      items,
      pagination: {
        page: 1,
        pageSize: items.length || 20,
        totalCount: items.length,
        totalPages: 1,
      },
    });
  }

  const campaignIdFromPath = matchPathGroup(pathname, /^\/v1\/campaigns\/([^/]+)$/);
  if (method === 'GET' && campaignIdFromPath) {
    const campaign = store.getCampaign(decodeURIComponent(campaignIdFromPath));
    if (!campaign) {
      return failure(404, 'campaign_not_found', 'Campaign not found.');
    }
    return success(200, store.toCampaignDetail(campaign));
  }

  const overviewCampaignId = matchPathGroup(
    pathname,
    /^\/v1\/campaigns\/([^/]+)\/metrics\/overview$/,
  );
  if (method === 'GET' && overviewCampaignId) {
    const campaign = store.getCampaign(decodeURIComponent(overviewCampaignId));
    if (!campaign) {
      return failure(404, 'campaign_not_found', 'Campaign not found.');
    }
    return success(200, store.buildOverview(campaign));
  }

  if (method === 'POST' && pathname === '/v1/campaigns') {
    return handleCreateCampaign(store, request);
  }

  const stopCampaignId = matchPathGroup(pathname, /^\/v1\/campaigns\/([^/]+)\/stop$/);
  if (method === 'POST' && stopCampaignId) {
    return handleStopCampaign(store, decodeURIComponent(stopCampaignId), request);
  }

  return failure(404, 'not_found', 'Not found.');
}

function handleCreateCampaign(
  store: EmulatorStore,
  request: EmulatorRequest,
): EmulatorResponse {
  const idem = readIdempotencyKey(request.headers);
  if ('status' in idem) {
    return idem;
  }

  const parsed = parseCreateBody(request.body);
  if (!parsed.ok) {
    return failure(parsed.status, parsed.code, parsed.message);
  }

  const requestHash = hashPayload(parsed.value);
  const existing = store.getIdempotency(idem.key);
  if (existing) {
    if (existing.requestHash !== requestHash) {
      return failure(
        409,
        'idempotency_key_conflict',
        'This Idempotency-Key was already used with a different request body.',
      );
    }
    return success(existing.status, existing.body);
  }

  const { dailyBudget, durationDays, autoRenew, strategyType, spotifyUrl, genre } =
    parsed.value;
  const committedUsd = computeCommittedUsd(dailyBudget, durationDays);
  const wallet = store.getWallet();
  if (wallet.available < committedUsd) {
    // Create 402 releases the key (do not persist) — matches backend create path.
    return failure(
      402,
      'insufficient_credit',
      'Insufficient wallet balance for this campaign.',
      {
        available: wallet.available,
        required: committedUsd,
      },
    );
  }

  store.debitWallet(committedUsd);
  const campaign = store.createCampaign({
    dailyBudget,
    durationDays,
    autoRenew: autoRenew ?? false,
    strategyType,
    spotifyUrl,
    genre,
    campaignName: parsed.value.campaignName,
  });

  const responseBody = {
    campaignId: campaign.campaignId,
    status: campaign.status,
    autoRenew: campaign.autoRenew,
  };
  store.setIdempotency(idem.key, {
    requestHash,
    status: 201,
    body: responseBody,
  });
  return success(201, responseBody);
}

function handleStopCampaign(
  store: EmulatorStore,
  campaignId: string,
  request: EmulatorRequest,
): EmulatorResponse {
  const idem = readIdempotencyKey(request.headers);
  if ('status' in idem) {
    return idem;
  }

  const campaign = store.getCampaign(campaignId);
  if (!campaign) {
    return failure(404, 'campaign_not_found', 'Campaign not found.');
  }

  const requestHash = hashPayload({ campaignId });
  const existing = store.getIdempotency(idem.key);
  if (existing) {
    if (existing.requestHash !== requestHash) {
      return failure(
        409,
        'idempotency_key_conflict',
        'This Idempotency-Key was already used with a different request body.',
      );
    }
    return success(existing.status, existing.body);
  }

  const result = applyPublicStop(store, campaign);
  if (result.releasedKey) {
    store.deleteIdempotency(idem.key);
    return failure(
      400,
      'invalid_request',
      `Cannot stop campaign in status "${campaign.status}".`,
    );
  }

  const responseBody = {
    campaignId: campaign.campaignId,
    status: result.status,
  };
  store.setIdempotency(idem.key, {
    requestHash,
    status: 200,
    body: responseBody,
  });
  return success(200, responseBody);
}

function isFault(value: unknown): value is EmulatorFault {
  return value === 'timeout' || value === 'conflict' || value === 'server_error';
}

function dispatchHarness(
  store: EmulatorStore,
  method: string,
  pathname: string,
  body: unknown,
): EmulatorResponse {
  if (method === 'POST' && pathname === '/__emulator/fault') {
    const fault =
      body && typeof body === 'object'
        ? (body as { fault?: unknown }).fault
        : undefined;
    if (!isFault(fault)) {
      return failure(
        400,
        'invalid_request',
        'fault must be timeout | conflict | server_error.',
      );
    }
    store.armFault(fault);
    return success(200, { fault });
  }

  if (method === 'POST' && pathname === '/__emulator/reset') {
    store.reset();
    return success(200, { ok: true });
  }

  if (method === 'POST' && pathname === '/__emulator/wallet') {
    const balance =
      body && typeof body === 'object'
        ? (body as { balance?: unknown }).balance
        : undefined;
    if (typeof balance !== 'number' || !Number.isFinite(balance) || balance < 0) {
      return failure(400, 'invalid_request', 'balance must be a non-negative number.');
    }
    return success(200, store.setWalletBalance(balance));
  }

  const harnessCampaignId = matchPathGroup(
    pathname,
    /^\/__emulator\/campaigns\/([^/]+)\/transition$/,
  );
  if (method === 'POST' && harnessCampaignId) {
    const campaignId = decodeURIComponent(harnessCampaignId);
    const action =
      body && typeof body === 'object'
        ? (body as { action?: unknown }).action
        : undefined;
    const mediaSpendUsd =
      body && typeof body === 'object'
        ? (body as { mediaSpendUsd?: unknown }).mediaSpendUsd
        : undefined;

    if (!isTransitionAction(action)) {
      return failure(
        400,
        'invalid_request',
        'action must be activate | reject_meta | set_spend | end.',
      );
    }

    try {
      const result = applyTransition(
        store,
        campaignId,
        action,
        typeof mediaSpendUsd === 'number' ? mediaSpendUsd : undefined,
      );
      return success(200, result);
    } catch (error) {
      if (error instanceof TransitionError) {
        return failure(error.status, error.code, error.message);
      }
      throw error;
    }
  }

  return failure(404, 'not_found', 'Not found.');
}
