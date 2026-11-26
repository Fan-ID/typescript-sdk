import { randomUUID } from 'node:crypto';
import type {
  BudgetDecreaseMode,
  BudgetIncreaseMode,
  BuiltInStrategyType,
  CreateCampaignRequest,
  Pixel,
  StrategyType,
} from '../types/api.js';
import { computeCommittedUsd, computeGrossEquivSpend, roundUsd } from './money.js';
import {
  hashPayload,
  resolveFaultResponses,
  type EmulatorFault,
  type EmulatorSelectedCreative,
  type EmulatorStore,
  type EmulatorTransitionAction,
  type EmulatorVideoImportRecord,
} from './store.js';
import {
  applyPublicStop,
  applyTransition,
  TransitionError,
  type SetMetricsInput,
} from './transitions.js';

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
    value === 'set_metrics' ||
    value === 'end' ||
    value === 'disapprove_creatives'
  );
}

const CREATIVES_BATCH_MAX_IDS = 50;
const OVERVIEW_BATCH_MAX_IDS = 50;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

const SELECTED_CREATIVES_MIN = 1;
const SELECTED_CREATIVES_MAX = 50;
const CAPTION_MAX_LENGTH = 2048;

function invalidRequest(message: string): ParseCreateFailure {
  return { ok: false, status: 400, code: 'invalid_request', message };
}

/** Same rules and messages as the backend's `full_control` creative validation. */
function parseSelectedCreatives(
  creativeDirection: CreateCampaignRequest['creativeDirection'],
): { ok: true; value: EmulatorSelectedCreative[] } | ParseCreateFailure {
  if (creativeDirection?.type !== 'full_control') {
    return { ok: true, value: [] };
  }
  const list: unknown = creativeDirection.selectedCreatives;
  if (!Array.isArray(list) || list.length < SELECTED_CREATIVES_MIN) {
    return invalidRequest(
      'creativeDirection.selectedCreatives is required and must have at least one entry when creativeDirection.type is full_control.',
    );
  }
  if (list.length > SELECTED_CREATIVES_MAX) {
    return invalidRequest(
      `creativeDirection.selectedCreatives must have at most ${String(SELECTED_CREATIVES_MAX)} entries when creativeDirection.type is full_control.`,
    );
  }

  const value: EmulatorSelectedCreative[] = [];
  for (const [index, item] of list.entries()) {
    const creative = (item ?? {}) as Record<string, unknown>;
    if (typeof creative.videoId !== 'string') {
      return invalidRequest('videoId must be a string.');
    }
    if (
      creative.useEmbeddedVideoAudio !== undefined &&
      typeof creative.useEmbeddedVideoAudio !== 'boolean'
    ) {
      return invalidRequest(
        `selectedCreatives[${String(index)}].useEmbeddedVideoAudio must be a boolean.`,
      );
    }
    if (creative.caption !== undefined && typeof creative.caption !== 'string') {
      return invalidRequest(
        `selectedCreatives[${String(index)}].caption must be a string.`,
      );
    }
    const caption = creative.caption?.trim() ?? '';
    if (caption.length > CAPTION_MAX_LENGTH) {
      return invalidRequest(
        `selectedCreatives[${String(index)}].caption must be at most ${String(CAPTION_MAX_LENGTH)} characters.`,
      );
    }
    value.push({
      videoId: creative.videoId,
      useEmbeddedVideoAudio: creative.useEmbeddedVideoAudio ?? true,
      caption,
    });
  }
  return { ok: true, value };
}

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
    return { status: 408, json: null, hang: true };
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

  const pixelResponse = dispatchPixel(store, method, pathname, request.body);
  if (pixelResponse) {
    return pixelResponse;
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

  const creativesCampaignId = matchPathGroup(
    pathname,
    /^\/v1\/campaigns\/([^/]+)\/metrics\/creatives$/,
  );
  if (method === 'GET' && creativesCampaignId) {
    const campaign = store.getCampaign(decodeURIComponent(creativesCampaignId));
    if (!campaign) {
      return failure(404, 'campaign_not_found', 'Campaign not found.');
    }
    return success(200, store.buildCreatives(campaign));
  }

  if (method === 'POST' && pathname === '/v1/campaigns/metrics/creatives/batch') {
    if (
      request.body === null ||
      typeof request.body !== 'object' ||
      Array.isArray(request.body)
    ) {
      return failure(400, 'invalid_request', 'Request body must be a JSON object.');
    }
    const body = request.body as Record<string, unknown>;
    if (body.startDate !== undefined || body.endDate !== undefined) {
      return failure(
        400,
        'invalid_request',
        'startDate and endDate are not supported. This endpoint returns a lifetime snapshot.',
      );
    }
    const campaignIds = body.campaignIds;
    if (!Array.isArray(campaignIds) || campaignIds.length === 0) {
      return failure(400, 'invalid_request', 'campaignIds must be a non-empty array.');
    }
    if (campaignIds.length > CREATIVES_BATCH_MAX_IDS) {
      return failure(
        400,
        'invalid_request',
        `campaignIds must contain at most ${String(CREATIVES_BATCH_MAX_IDS)} ids.`,
      );
    }
    if (
      !campaignIds.every(
        (id): id is string => typeof id === 'string' && id.trim().length > 0,
      )
    ) {
      return failure(
        400,
        'invalid_request',
        'campaignIds must contain non-empty strings.',
      );
    }
    const uniqueIds = [...new Set(campaignIds)];
    const items = uniqueIds.flatMap((campaignId) => {
      const campaign = store.getCampaign(campaignId);
      if (!campaign) {
        return [];
      }
      return [
        {
          campaignId,
          creatives: store.buildCreatives(campaign).creatives,
        },
      ];
    });
    return success(200, { items });
  }

  if (method === 'POST' && pathname === '/v1/videos/import') {
    return handleVideoImport(store, request.body);
  }

  const videoImportSessionId = matchPathGroup(
    pathname,
    /^\/v1\/videos\/import\/([^/]+)$/,
  );
  if (method === 'GET' && videoImportSessionId) {
    return handleVideoImportStatus(store, decodeURIComponent(videoImportSessionId));
  }

  if (method === 'POST' && pathname === '/v1/campaigns/metrics/overview/batch') {
    return handleOverviewBatch(store, request);
  }

  if (method === 'POST' && pathname === '/v1/campaigns') {
    return handleCreateCampaign(store, request);
  }

  const stopCampaignId = matchPathGroup(pathname, /^\/v1\/campaigns\/([^/]+)\/stop$/);
  if (method === 'POST' && stopCampaignId) {
    return handleStopCampaign(store, decodeURIComponent(stopCampaignId), request);
  }

  const increaseBudgetCampaignId = matchPathGroup(
    pathname,
    /^\/v1\/campaigns\/([^/]+)\/budget\/increase$/,
  );
  if (method === 'POST' && increaseBudgetCampaignId) {
    return handleIncreaseBudget(
      store,
      decodeURIComponent(increaseBudgetCampaignId),
      request,
    );
  }

  const decreaseBudgetCampaignId = matchPathGroup(
    pathname,
    /^\/v1\/campaigns\/([^/]+)\/budget\/decrease$/,
  );
  if (method === 'POST' && decreaseBudgetCampaignId) {
    return handleDecreaseBudget(
      store,
      decodeURIComponent(decreaseBudgetCampaignId),
      request,
    );
  }

  const autoRenewCampaignId = matchPathGroup(
    pathname,
    /^\/v1\/campaigns\/([^/]+)\/auto-renew$/,
  );
  if (method === 'PUT' && autoRenewCampaignId) {
    return handleUpdateAutoRenew(
      store,
      decodeURIComponent(autoRenewCampaignId),
      request,
    );
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
  const parsedCreatives = parseSelectedCreatives(parsed.value.creativeDirection);
  if (!parsedCreatives.ok) {
    return failure(
      parsedCreatives.status,
      parsedCreatives.code,
      parsedCreatives.message,
    );
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
    selectedCreatives: parsedCreatives.value,
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

function isIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

/**
 * Lifetime totals per campaign, same as `GET /metrics/overview`. The emulator
 * does not model date windows, so `startDate` / `endDate` are validated but
 * do not change the totals.
 */
function handleOverviewBatch(
  store: EmulatorStore,
  request: EmulatorRequest,
): EmulatorResponse {
  if (
    request.body === null ||
    typeof request.body !== 'object' ||
    Array.isArray(request.body)
  ) {
    return failure(400, 'invalid_request', 'Request body must be a JSON object.');
  }
  const body = request.body as Record<string, unknown>;
  const campaignIds = body.campaignIds;
  if (!Array.isArray(campaignIds) || campaignIds.length === 0) {
    return failure(400, 'invalid_request', 'campaignIds must be a non-empty array.');
  }
  if (campaignIds.length > OVERVIEW_BATCH_MAX_IDS) {
    return failure(
      400,
      'invalid_request',
      `campaignIds must contain at most ${String(OVERVIEW_BATCH_MAX_IDS)} ids.`,
    );
  }
  if (
    !campaignIds.every(
      (id): id is string => typeof id === 'string' && id.trim().length > 0,
    )
  ) {
    return failure(
      400,
      'invalid_request',
      'campaignIds must contain non-empty strings.',
    );
  }
  for (const field of ['startDate', 'endDate'] as const) {
    const value = body[field];
    if (value !== undefined && (typeof value !== 'string' || !isIsoDate(value))) {
      return failure(400, 'invalid_request', `${field} must be a YYYY-MM-DD date.`);
    }
  }

  const uniqueIds = [...new Set(campaignIds)];
  const items = uniqueIds.flatMap((campaignId) => {
    const campaign = store.getCampaign(campaignId);
    if (!campaign) {
      return [];
    }
    return [{ campaignId, ...store.buildOverview(campaign) }];
  });
  return success(200, { items });
}

function handleUpdateAutoRenew(
  store: EmulatorStore,
  campaignId: string,
  request: EmulatorRequest,
): EmulatorResponse {
  const idem = readIdempotencyKey(request.headers);
  if ('status' in idem) {
    return idem;
  }

  const rawBody = request.body;
  const autoRenew =
    rawBody !== null && typeof rawBody === 'object' && !Array.isArray(rawBody)
      ? (rawBody as Record<string, unknown>).autoRenew
      : undefined;
  if (typeof autoRenew !== 'boolean') {
    return failure(400, 'invalid_request', 'autoRenew must be a boolean.');
  }

  const campaign = store.getCampaign(campaignId);
  if (!campaign) {
    return failure(404, 'campaign_not_found', 'Campaign not found.');
  }

  const requestHash = hashPayload({ campaignId, autoRenew });
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

  // Wallet campaigns only (`generation: 3`). Every emulator campaign is a wallet campaign.
  if (campaign.status !== 'active' && campaign.status !== 'renew_failed') {
    return failure(
      400,
      'invalid_request',
      `Cannot set auto-renew for campaign in status "${campaign.status}".`,
    );
  }

  if (campaign.autoRenew !== autoRenew) {
    campaign.autoRenew = autoRenew;
    store.updateCampaign(campaign);
  }

  const responseBody = {
    campaignId: campaign.campaignId,
    autoRenew: campaign.autoRenew,
  };
  store.setIdempotency(idem.key, {
    requestHash,
    status: 200,
    body: responseBody,
  });
  return success(200, responseBody);
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

function toPublicPixel(pixel: { id: string; isDefault: boolean }): Pixel {
  return {
    id: pixel.id,
    platform: 'meta',
    isDefault: pixel.isDefault,
    status: 'ok',
    lastErrorCode: null,
    errorSince: null,
  };
}

function decodePixelId(raw: string): string {
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}

function parsePixelBody(
  body: unknown,
):
  | { ok: true; accessToken?: string; isDefault?: boolean }
  | { ok: false; message: string } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, message: 'Request body must be a JSON object.' };
  }
  const record = body as Record<string, unknown>;
  const extra = Object.keys(record).filter(
    (key) => key !== 'platform' && key !== 'accessToken' && key !== 'isDefault',
  );
  const unknownKey = extra[0];
  if (unknownKey) {
    return {
      ok: false,
      message: `Invalid request body at body: Unrecognized key(s) in object: '${unknownKey}'.`,
    };
  }
  if (!('platform' in record)) {
    return { ok: false, message: 'Invalid request body at platform: Required.' };
  }
  if (record.platform !== 'meta') {
    return {
      ok: false,
      message:
        'Invalid request body at platform: Invalid literal value, expected "meta".',
    };
  }
  let accessToken: string | undefined;
  if ('accessToken' in record) {
    if (typeof record.accessToken !== 'string') {
      return {
        ok: false,
        message: `Invalid request body at accessToken: Expected string, received ${typeof record.accessToken}.`,
      };
    }
    accessToken = record.accessToken.trim();
    if (!accessToken) {
      return {
        ok: false,
        message:
          'Invalid request body at accessToken: String must contain at least 1 character(s).',
      };
    }
  }
  let isDefault: boolean | undefined;
  if ('isDefault' in record) {
    if (typeof record.isDefault !== 'boolean') {
      return {
        ok: false,
        message: `Invalid request body at isDefault: Expected boolean, received ${typeof record.isDefault}.`,
      };
    }
    isDefault = record.isDefault;
  }
  if (accessToken === undefined && isDefault === undefined) {
    return {
      ok: false,
      message:
        'Invalid request body at accessToken: accessToken or isDefault is required.',
    };
  }
  return { ok: true, accessToken, isDefault };
}

function dispatchPixel(
  store: EmulatorStore,
  method: string,
  pathname: string,
  body: unknown,
): EmulatorResponse | null {
  if (method === 'GET' && pathname === '/v1/pixels') {
    return success(200, {
      pixels: store.listPixels().map(toPublicPixel),
    });
  }

  const testPixelId = matchPathGroup(pathname, /^\/v1\/pixels\/([^/]+)\/test-events$/);
  if (testPixelId !== undefined) {
    if (method !== 'POST') {
      return failure(404, 'not_found', 'Not found.');
    }
    const pixelId = decodePixelId(testPixelId);
    const pixel = pixelId ? store.getPixel(pixelId) : undefined;
    if (!pixel) {
      return failure(404, 'not_found', 'Pixel not found.');
    }
    return success(200, { status: 'sent', pixelId: pixel.id });
  }

  const rawPixelId = matchPathGroup(pathname, /^\/v1\/pixels\/([^/]+)$/);
  if (rawPixelId === undefined) {
    return null;
  }
  const pixelId = decodePixelId(rawPixelId);
  if (!pixelId) {
    return failure(400, 'invalid_request', 'pixelId is required.');
  }

  if (method === 'PUT') {
    const parsed = parsePixelBody(body);
    if (!parsed.ok) {
      return failure(400, 'invalid_request', parsed.message);
    }
    const existing = store.getPixel(pixelId);
    if (!existing && parsed.accessToken === undefined) {
      return failure(404, 'not_found', 'Pixel not found.');
    }
    if (parsed.accessToken !== undefined) {
      const owner = store.findPixelByAccessToken(parsed.accessToken);
      if (owner && owner.id !== pixelId) {
        return failure(
          400,
          'invalid_request',
          'Access token is already in use with another pixel ID',
        );
      }
    }
    const saved = {
      id: pixelId,
      accessToken: parsed.accessToken ?? existing?.accessToken ?? '',
      isDefault: parsed.isDefault ?? existing?.isDefault ?? false,
    };
    store.savePixel(saved);
    return success(200, toPublicPixel(saved));
  }

  if (method === 'DELETE') {
    if (!store.getPixel(pixelId)) {
      return failure(404, 'not_found', 'Pixel not found.');
    }
    store.deletePixel(pixelId);
    return { status: 204, json: null };
  }

  return failure(404, 'not_found', 'Not found.');
}

const SET_METRICS_FIELDS = [
  'mediaSpendUsd',
  'listeners',
  'streams',
  'cycleDay',
] as const;

/** Rejects fields of the wrong type so they are not silently ignored. Ranges are checked per campaign. */
function parseSetMetricsBody(
  body: unknown,
): { ok: true; value: SetMetricsInput } | { ok: false; message: string } {
  const record = (body ?? {}) as Record<string, unknown>;
  for (const field of SET_METRICS_FIELDS) {
    const value = record[field];
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
      return { ok: false, message: `${field} must be a finite number.` };
    }
  }
  const value: SetMetricsInput = {};
  if (typeof record.listeners === 'number') value.listeners = record.listeners;
  if (typeof record.streams === 'number') value.streams = record.streams;
  if (typeof record.cycleDay === 'number') value.cycleDay = record.cycleDay;
  return { ok: true, value };
}

const INCREASE_MODES: readonly BudgetIncreaseMode[] = [
  'current_cycle',
  'next_renewal',
  'current_and_renewals',
];

const DECREASE_MODES: readonly BudgetDecreaseMode[] = [
  'current_cycle',
  'current_and_renewals',
];

/** A decrease needs more than this many days left in the cycle. */
const DECREASE_MAX_BLOCKED_REMAINING_DAYS = 3;

/** The emulator's create minimum stands in for the enabled-ad-set minimum gross. */
const MIN_LOWER_DAILY_BUDGET_USD = 10;

/** The backend rejects a current-cycle top-up with this many days left, or fewer. */
const TOP_UP_MIN_BLOCKED_REMAINING_DAYS = 2;

/** Days left in the current cycle, from the `cycleDay` the harness sets. */
function remainingCycleDays(campaign: {
  durationDays: number;
  cycleDay: number;
}): number {
  return Math.max(campaign.durationDays - campaign.cycleDay, 0);
}

type ParsedIncrease =
  | {
      ok: true;
      value: {
        amount: number;
        mode: BudgetIncreaseMode;
        targetDailyBudget: number | undefined;
      };
    }
  | { ok: false; message: string };

function parseIncreaseBody(body: unknown): ParsedIncrease {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, message: 'Request body must be a JSON object.' };
  }
  const raw = body as Record<string, unknown>;

  const mode = raw.mode ?? 'current_and_renewals';
  if (
    typeof mode !== 'string' ||
    !INCREASE_MODES.includes(mode as BudgetIncreaseMode)
  ) {
    return {
      ok: false,
      message: 'mode must be current_cycle | next_renewal | current_and_renewals.',
    };
  }

  const target = raw.targetDailyBudget;
  if (
    target !== undefined &&
    (typeof target !== 'number' || !Number.isFinite(target) || target <= 0)
  ) {
    return { ok: false, message: 'targetDailyBudget must be a positive number.' };
  }

  const amount = raw.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
    return { ok: false, message: 'amount must be a non-negative number.' };
  }
  const zeroAllowed = mode === 'next_renewal' && target !== undefined;
  if (amount === 0 && !zeroAllowed) {
    return {
      ok: false,
      message:
        'amount must be positive, except mode next_renewal with targetDailyBudget.',
    };
  }

  return {
    ok: true,
    value: { amount, mode: mode as BudgetIncreaseMode, targetDailyBudget: target },
  };
}

/**
 * `POST /v1/campaigns/:id/budget/increase`.
 *
 * Simplified model of the backend top-up: a current-cycle increase debits the
 * wallet by `amount`, grows the committed budget by the same amount, and raises
 * `dailyBudget` by `amount / remainingDays`. `next_renewal` never debits the
 * wallet and never hits the days-remaining rule.
 */
function handleIncreaseBudget(
  store: EmulatorStore,
  campaignId: string,
  request: EmulatorRequest,
): EmulatorResponse {
  const idem = readIdempotencyKey(request.headers);
  if ('status' in idem) {
    return idem;
  }

  const parsed = parseIncreaseBody(request.body);
  if (!parsed.ok) {
    return failure(400, 'invalid_request', parsed.message);
  }
  const { amount, mode, targetDailyBudget } = parsed.value;

  const campaign = store.getCampaign(campaignId);
  if (!campaign) {
    return failure(404, 'campaign_not_found', 'Campaign not found.');
  }

  const requestHash = hashPayload({ campaignId, amount, mode, targetDailyBudget });
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

  if (campaign.status !== 'active') {
    return failure(
      400,
      'invalid_request',
      `Cannot increase budget for campaign in status "${campaign.status}".`,
    );
  }

  const appliesToCurrentCycle = mode !== 'next_renewal';
  const remainingDays = remainingCycleDays(campaign);
  if (appliesToCurrentCycle && remainingDays <= TOP_UP_MIN_BLOCKED_REMAINING_DAYS) {
    return failure(
      400,
      'invalid_request',
      `Campaign ${campaignId} has too few days remaining for a top-up.`,
    );
  }

  if (appliesToCurrentCycle) {
    const wallet = store.getWallet();
    if (wallet.available < amount) {
      // Like create, a 402 does not store the key.
      return failure(
        402,
        'insufficient_credit',
        'Insufficient wallet balance for this campaign.',
        { available: wallet.available, required: amount },
      );
    }
    store.debitWallet(amount);
    campaign.committedUsd = roundUsd(campaign.committedUsd + amount);
    campaign.dailyBudget = roundUsd(campaign.dailyBudget + amount / remainingDays);
  }

  let walletNextCycleDailyBudget: number | null = null;
  if (mode === 'next_renewal' || mode === 'current_and_renewals') {
    if (targetDailyBudget !== undefined) {
      walletNextCycleDailyBudget = targetDailyBudget;
    } else if (mode === 'current_and_renewals') {
      walletNextCycleDailyBudget = campaign.dailyBudget;
    } else {
      walletNextCycleDailyBudget = roundUsd(
        (campaign.nextCycleDailyBudget ?? campaign.dailyBudget) +
          amount / campaign.durationDays,
      );
    }
    campaign.nextCycleDailyBudget = walletNextCycleDailyBudget;
  }
  store.updateCampaign(campaign);

  const responseBody = {
    campaignId: campaign.campaignId,
    mode,
    amount,
    walletBalance: store.getWallet().balance,
    walletNextCycleDailyBudget,
  };
  store.setIdempotency(idem.key, { requestHash, status: 200, body: responseBody });
  return success(200, responseBody);
}

type ParsedDecrease =
  | {
      ok: true;
      value: { targetDailyBudget: number; mode: BudgetDecreaseMode };
    }
  | { ok: false; message: string };

function parseDecreaseBody(body: unknown): ParsedDecrease {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, message: 'Request body must be a JSON object.' };
  }
  const raw = body as Record<string, unknown>;

  const mode = raw.mode ?? 'current_and_renewals';
  if (
    typeof mode !== 'string' ||
    !DECREASE_MODES.includes(mode as BudgetDecreaseMode)
  ) {
    return {
      ok: false,
      message: 'mode must be current_cycle | current_and_renewals.',
    };
  }

  const target = raw.targetDailyBudget;
  if (typeof target !== 'number' || !Number.isFinite(target) || target <= 0) {
    return { ok: false, message: 'targetDailyBudget must be a positive number.' };
  }

  return {
    ok: true,
    value: { targetDailyBudget: target, mode: mode as BudgetDecreaseMode },
  };
}

/**
 * `POST /v1/campaigns/:id/budget/decrease`.
 *
 * Needs more than 3 days left, a target below the current daily budget and at
 * least the minimum daily budget. The unused part of the current cycle,
 * `(dailyBudget - target) * remainingDays`, comes off the committed budget and
 * is credited to the wallet. The backend applies that refund asynchronously;
 * the emulator applies it before it responds. The decrease is rejected when the
 * committed budget would fall below the media spend already recorded.
 */
function handleDecreaseBudget(
  store: EmulatorStore,
  campaignId: string,
  request: EmulatorRequest,
): EmulatorResponse {
  const idem = readIdempotencyKey(request.headers);
  if ('status' in idem) {
    return idem;
  }

  const parsed = parseDecreaseBody(request.body);
  if (!parsed.ok) {
    return failure(400, 'invalid_request', parsed.message);
  }
  const { targetDailyBudget, mode } = parsed.value;

  const campaign = store.getCampaign(campaignId);
  if (!campaign) {
    return failure(404, 'campaign_not_found', 'Campaign not found.');
  }

  const requestHash = hashPayload({ campaignId, targetDailyBudget, mode });
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

  if (campaign.status !== 'active') {
    return failure(
      400,
      'invalid_request',
      `Cannot decrease budget for campaign in status "${campaign.status}".`,
    );
  }

  const remainingDays = remainingCycleDays(campaign);
  if (remainingDays <= DECREASE_MAX_BLOCKED_REMAINING_DAYS) {
    return failure(
      400,
      'invalid_request',
      `More than ${String(DECREASE_MAX_BLOCKED_REMAINING_DAYS)} days must remain in the current cycle to lower the daily budget.`,
    );
  }
  if (targetDailyBudget >= campaign.dailyBudget) {
    return failure(
      400,
      'invalid_request',
      `targetDailyBudget must be lower than the current daily budget (${String(campaign.dailyBudget)}).`,
    );
  }
  if (targetDailyBudget < MIN_LOWER_DAILY_BUDGET_USD) {
    return failure(
      400,
      'invalid_request',
      `targetDailyBudget must be at least ${String(MIN_LOWER_DAILY_BUDGET_USD)}.`,
    );
  }

  const refund = roundUsd((campaign.dailyBudget - targetDailyBudget) * remainingDays);
  const committedAfter = roundUsd(campaign.committedUsd - refund);
  const spentGross = roundUsd(
    computeGrossEquivSpend(campaign.mediaSpendUsd, store.feeRate),
  );
  if (committedAfter < spentGross) {
    return failure(
      400,
      'invalid_request',
      `targetDailyBudget is too low: the committed budget would fall below the ${String(spentGross)} of media spend already recorded.`,
    );
  }

  store.creditWallet(refund);
  campaign.committedUsd = committedAfter;
  campaign.dailyBudget = targetDailyBudget;
  if (mode === 'current_and_renewals') {
    campaign.nextCycleDailyBudget = targetDailyBudget;
  }
  store.updateCampaign(campaign);

  const responseBody = {
    campaignId: campaign.campaignId,
    mode,
    targetDailyBudget,
    accepted: true,
    ...(mode === 'current_and_renewals'
      ? { walletNextCycleDailyBudget: targetDailyBudget }
      : {}),
  };
  store.setIdempotency(idem.key, { requestHash, status: 200, body: responseBody });
  return success(200, responseBody);
}

const VIDEO_IMPORT_BATCH_MAX = 5;

const UNSUPPORTED_VIDEO_TYPE_MESSAGE =
  'Unsupported video content type. Use MP4 or QuickTime (.mov).';

const VIDEO_ERROR_MESSAGES: Record<string, string> = {
  video_too_large: 'Video exceeds the 50 MB limit.',
  invalid_video_content_type: UNSUPPORTED_VIDEO_TYPE_MESSAGE,
  storage_limit_exceeded: 'Video storage limit exceeded.',
  no_videos_imported: 'No videos were imported.',
  duplicate_videos: 'All videos are already in the library.',
  import_failed: 'Video import failed.',
};

const VIDEO_IMPORT_ERROR_CODES = Object.keys(VIDEO_ERROR_MESSAGES);

type VideoRejected = { ok: false; response: EmulatorResponse };
type ParsedVideoImport = { ok: true; urls: string[] } | VideoRejected;

function invalidVideoInput(message: string): VideoRejected {
  return { ok: false, response: failure(400, 'invalid_request', message) };
}

function checkVideoUrl(value: unknown): { ok: true; url: string } | VideoRejected {
  if (typeof value !== 'string' || value.length === 0) {
    return invalidVideoInput('url must be a non-empty string.');
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return invalidVideoInput('url must be a valid public HTTPS URL.');
  }
  if (parsed.protocol !== 'https:') {
    return invalidVideoInput('url must be a public HTTPS URL.');
  }
  const path = parsed.pathname.toLowerCase();
  if (!path.endsWith('.mp4') && !path.endsWith('.mov')) {
    return {
      ok: false,
      response: failure(
        400,
        'invalid_video_content_type',
        UNSUPPORTED_VIDEO_TYPE_MESSAGE,
      ),
    };
  }
  return { ok: true, url: value };
}

function parseVideoImportBody(body: unknown): ParsedVideoImport {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return invalidVideoInput('Request body must be a JSON object.');
  }
  const raw = body as Record<string, unknown>;
  if (raw.url !== undefined && raw.videos !== undefined) {
    return invalidVideoInput('Provide either url or videos, not both.');
  }
  if (raw.url === undefined && raw.videos === undefined) {
    return invalidVideoInput('Provide either url or videos.');
  }

  const candidates: unknown[] = [];
  if (raw.url !== undefined) {
    candidates.push(raw.url);
  } else {
    const videos = raw.videos;
    if (
      !Array.isArray(videos) ||
      videos.length < 1 ||
      videos.length > VIDEO_IMPORT_BATCH_MAX
    ) {
      return invalidVideoInput(
        `videos must have between 1 and ${String(VIDEO_IMPORT_BATCH_MAX)} items.`,
      );
    }
    for (const item of videos) {
      if (item === null || typeof item !== 'object') {
        return invalidVideoInput('Each videos item must be an object with a url.');
      }
      candidates.push((item as Record<string, unknown>).url);
    }
  }

  const urls: string[] = [];
  for (const candidate of candidates) {
    const checked = checkVideoUrl(candidate);
    if (!checked.ok) {
      return checked;
    }
    urls.push(checked.url);
  }
  return { ok: true, urls };
}

/**
 * `POST /v1/videos/import`. The session settles on its first status poll.
 * A single URL that already imported returns `200` with the existing video.
 */
function handleVideoImport(store: EmulatorStore, body: unknown): EmulatorResponse {
  const parsed = parseVideoImportBody(body);
  if (!parsed.ok) {
    return parsed.response;
  }
  const { urls } = parsed;

  const [onlyUrl] = urls;
  const existingVideoId =
    urls.length === 1 && onlyUrl ? store.findImportedVideo(onlyUrl) : undefined;
  if (existingVideoId) {
    const session = store.createVideoImport(urls, [existingVideoId]);
    return success(200, {
      sessionId: session.sessionId,
      status: 'ready',
      count: 1,
      videoId: existingVideoId,
    });
  }

  const session = store.createVideoImport(urls);
  return success(202, {
    sessionId: session.sessionId,
    status: 'processing',
    count: urls.length,
  });
}

function settleVideoImport(
  store: EmulatorStore,
  session: EmulatorVideoImportRecord,
): void {
  if (session.status !== 'processing') {
    return;
  }
  session.status = 'ready';
  session.videoIds = session.urls.map((url) => {
    const videoId = randomUUID();
    store.rememberImportedVideo(url, videoId);
    return videoId;
  });
}

/** `GET /v1/videos/import/:sessionId`. */
function handleVideoImportStatus(
  store: EmulatorStore,
  sessionId: string,
): EmulatorResponse {
  const session = store.getVideoImport(sessionId);
  if (!session) {
    return failure(404, 'not_found', 'Video import session not found.');
  }
  settleVideoImport(store, session);

  const total = session.urls.length;
  const isBatch = total > 1;
  if (session.status === 'failed') {
    const code = session.errorCode ?? 'import_failed';
    return success(200, {
      sessionId,
      status: 'failed',
      ...(isBatch ? { counts: { total, ready: 0, failed: total } } : {}),
      error: {
        code,
        message: VIDEO_ERROR_MESSAGES[code] ?? VIDEO_ERROR_MESSAGES.import_failed,
      },
    });
  }
  return success(200, {
    sessionId,
    status: session.status,
    ...(isBatch
      ? {
          videoIds: session.videoIds,
          counts: { total, ready: total, failed: 0 },
        }
      : { videoId: session.videoIds[0] }),
  });
}

/** Harness: fail a session that has not settled yet. */
function handleFailVideoImport(
  store: EmulatorStore,
  sessionId: string,
  body: unknown,
): EmulatorResponse {
  const session = store.getVideoImport(sessionId);
  if (!session) {
    return failure(404, 'not_found', 'Video import session not found.');
  }
  const code =
    body !== null && typeof body === 'object'
      ? (body as { code?: unknown }).code
      : undefined;
  if (
    code !== undefined &&
    (typeof code !== 'string' || !VIDEO_IMPORT_ERROR_CODES.includes(code))
  ) {
    return failure(
      400,
      'invalid_request',
      `code must be one of ${VIDEO_IMPORT_ERROR_CODES.join(' | ')}.`,
    );
  }
  if (session.status !== 'processing') {
    return failure(
      400,
      'invalid_request',
      `Cannot fail a video import in status "${session.status}".`,
    );
  }
  session.status = 'failed';
  session.errorCode = code ?? 'import_failed';
  return success(200, { sessionId, status: 'failed', code: session.errorCode });
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
    const record =
      body && typeof body === 'object'
        ? (body as { fault?: unknown; maxRetries?: unknown })
        : undefined;
    const fault = record?.fault;
    if (!isFault(fault)) {
      return failure(
        400,
        'invalid_request',
        'fault must be timeout | conflict | server_error.',
      );
    }
    const maxRetries = record?.maxRetries;
    const resolved = resolveFaultResponses(fault, maxRetries);
    if (!resolved.ok) {
      return failure(400, 'invalid_request', resolved.message);
    }
    if (!store.armFault(fault, resolved.responses)) {
      return failure(400, 'invalid_request', 'A fault is already armed.');
    }
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

  const failVideoSessionId = matchPathGroup(
    pathname,
    /^\/__emulator\/videos\/([^/]+)\/fail$/,
  );
  if (method === 'POST' && failVideoSessionId) {
    return handleFailVideoImport(store, decodeURIComponent(failVideoSessionId), body);
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
    const reason =
      body && typeof body === 'object'
        ? (body as { reason?: unknown }).reason
        : undefined;

    if (!isTransitionAction(action)) {
      return failure(
        400,
        'invalid_request',
        'action must be activate | reject_meta | set_spend | set_metrics | end | disapprove_creatives.',
      );
    }

    let metrics: SetMetricsInput | undefined;
    if (action === 'set_metrics') {
      const parsed = parseSetMetricsBody(body);
      if (!parsed.ok) {
        return failure(400, 'invalid_request', parsed.message);
      }
      metrics = parsed.value;
    }

    try {
      const result = applyTransition(
        store,
        campaignId,
        action,
        typeof mediaSpendUsd === 'number' ? mediaSpendUsd : undefined,
        typeof reason === 'string' ? reason : undefined,
        metrics,
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
