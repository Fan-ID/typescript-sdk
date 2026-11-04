import { randomUUID } from 'node:crypto';
import type {
  BuiltInStrategyType,
  CreateCampaignRequest,
  StrategyType,
} from '../types/api.js';
import { computeCommittedUsd } from './money.js';
import {
  hashPayload,
  type EmulatorStore,
  type EmulatorTransitionAction,
} from './store.js';
import { applyPublicStop, applyTransition, TransitionError } from './transitions.js';

export interface EmulatorRequest {
  method: string;
  /** Pathname with optional query string (e.g. `/v1/campaigns/x/metrics/overview?startDate=…`). */
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface EmulatorResponse {
  status: number;
  json: unknown;
}

interface ParsedPath {
  pathname: string;
  searchParams: URLSearchParams;
}

function parsePath(path: string): ParsedPath {
  const url = new URL(path, 'http://emulator.local');
  return { pathname: url.pathname, searchParams: url.searchParams };
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
    return failure(401, 'invalid_api_key', 'Missing API key.');
  }
  const token = authorization.slice('Bearer '.length).trim();
  if (!token.startsWith('sk_') || token !== store.apiKey) {
    return failure(401, 'invalid_api_key', 'Invalid API key.');
  }
  return null;
}

function readIdempotencyKey(
  headers: Record<string, string> | undefined,
): { key: string } | EmulatorResponse {
  const key = headerValue(headers, 'idempotency-key');
  if (!key || key.length === 0 || key.length > 255) {
    return failure(
      400,
      'invalid_request',
      'Idempotency-Key header is required and must be at most 255 characters.',
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

function parseCreateBody(
  body: unknown,
): { ok: true; value: CreateCampaignRequest } | { ok: false; message: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, message: 'Request body must be a JSON object.' };
  }
  const raw = body as Record<string, unknown>;
  if (typeof raw.spotifyUrl !== 'string' || raw.spotifyUrl.length === 0) {
    return { ok: false, message: 'spotifyUrl is required.' };
  }
  if (typeof raw.dailyBudget !== 'number' || raw.dailyBudget < 10) {
    return { ok: false, message: 'dailyBudget must be a number >= 10.' };
  }
  if (typeof raw.durationDays !== 'number') {
    return { ok: false, message: 'durationDays is required.' };
  }
  if (typeof raw.genre !== 'string') {
    return { ok: false, message: 'genre is required.' };
  }
  if (typeof raw.strategyType !== 'string') {
    return { ok: false, message: 'strategyType is required.' };
  }
  return { ok: true, value: body as CreateCampaignRequest };
}

export function dispatch(
  store: EmulatorStore,
  request: EmulatorRequest,
): EmulatorResponse {
  const method = request.method.toUpperCase();
  const { pathname } = parsePath(request.path);

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
    // startDate/endDate accepted and ignored (parity with partner clients).
    void parsePath(request.path).searchParams;
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
    return failure(400, 'invalid_request', parsed.message);
  }

  const requestHash = hashPayload(parsed.value);
  const existing = store.getIdempotency(idem.key);
  if (existing) {
    if (existing.requestHash !== requestHash) {
      return failure(
        409,
        'idempotency_key_conflict',
        'Idempotency-Key was already used with a different request body.',
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
    return failure(402, 'insufficient_credit', 'Insufficient wallet credit.', {
      available: wallet.available,
      required: committedUsd,
    });
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
        'Idempotency-Key was already used with a different request body.',
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

function dispatchHarness(
  store: EmulatorStore,
  method: string,
  pathname: string,
  body: unknown,
): EmulatorResponse {
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
