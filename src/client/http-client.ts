import {
  API_KEY_PREFIX,
  API_VERSION_PREFIX,
  DEFAULT_BASE_URL,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
} from '../constants/defaults.js';
import {
  errorResponse,
  isApiEnvelopeError,
  isApiEnvelopeSuccess,
  parseRetryAfterHeader,
  successResponse,
  toApiError,
} from '../core/api-response.js';
import { parseNdjsonStream } from '../core/jsonl.js';
import { SoundlinkConfigError, SoundlinkParseError } from '../errors/sdk-error.js';
import type { ApiResponse, JsonlStream, SoundlinkOptions } from '../types/api.js';
import {
  buildQueryString,
  calculateBackoffMs,
  joinUrl,
  sleep,
} from '../utils/query.js';

export type { JsonlStream };

export interface HttpGetOptions {
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
}

export interface HttpJsonlOptions extends HttpGetOptions {
  accept?: string;
}

export interface HttpMutationOptions {
  path: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string>;
  /** Sent as the `Idempotency-Key` header when set. */
  idempotencyKey?: string;
}

export interface ResolvedSoundlinkClientOptions {
  apiKey: string;
  baseUrl: string;
  timeout: number;
  maxRetries: number;
  fetch: typeof fetch;
}

/**
 * Normalize constructor options and validate the API key format.
 *
 * @throws {@link SoundlinkConfigError} When the key is missing or does not start with `sk_`.
 */
export function resolveClientOptions(
  options: SoundlinkOptions,
): ResolvedSoundlinkClientOptions {
  const normalized = typeof options === 'string' ? { apiKey: options } : options;

  const apiKey = normalized.apiKey.trim();
  if (!apiKey) {
    throw new SoundlinkConfigError('apiKey is required.');
  }

  if (!apiKey.startsWith(API_KEY_PREFIX)) {
    throw new SoundlinkConfigError(
      `Invalid API key format. Expected a key starting with "${API_KEY_PREFIX}".`,
    );
  }

  return {
    apiKey,
    baseUrl: normalized.baseUrl ?? DEFAULT_BASE_URL,
    timeout: normalized.timeout ?? DEFAULT_TIMEOUT_MS,
    maxRetries: normalized.maxRetries ?? DEFAULT_MAX_RETRIES,
    fetch: normalized.fetch ?? globalThis.fetch.bind(globalThis),
  };
}

export class HttpClient {
  private readonly options: ResolvedSoundlinkClientOptions;

  constructor(options: SoundlinkOptions) {
    this.options = resolveClientOptions(options);
  }

  get resolvedOptions(): ResolvedSoundlinkClientOptions {
    return this.options;
  }

  async get<T>({ path, query }: HttpGetOptions): Promise<ApiResponse<T>> {
    const url = joinUrl(
      this.options.baseUrl,
      `${API_VERSION_PREFIX}${path}${buildQueryString(query ?? {})}`,
    );

    return this.requestJson<T>(url, {
      method: 'GET',
      headers: this.buildHeaders(),
    });
  }

  async post<T>({
    path,
    body,
    query,
    headers,
    idempotencyKey,
  }: HttpMutationOptions): Promise<ApiResponse<T>> {
    return this.mutateJson<T>('POST', {
      path,
      body,
      query,
      headers,
      idempotencyKey,
    });
  }

  async patch<T>({
    path,
    body,
    query,
    headers,
    idempotencyKey,
  }: HttpMutationOptions): Promise<ApiResponse<T>> {
    return this.mutateJson<T>('PATCH', {
      path,
      body,
      query,
      headers,
      idempotencyKey,
    });
  }

  async getJsonl<T>({
    path,
    query,
    accept = 'application/x-ndjson',
  }: HttpJsonlOptions): Promise<ApiResponse<JsonlStream<T>>> {
    const url = joinUrl(
      this.options.baseUrl,
      `${API_VERSION_PREFIX}${path}${buildQueryString(query ?? {})}`,
    );

    let response: Response;
    try {
      response = await this.fetchWithRetry(url, {
        method: 'GET',
        headers: {
          ...this.buildHeaders(),
          Accept: accept,
        },
      });
    } catch (error) {
      throw toTransportError(error);
    }

    const retryAfter = parseRetryAfterHeader(response.headers.get('Retry-After'));

    if (!response.ok) {
      return this.parseErrorEnvelope<JsonlStream<T>>(response, retryAfter);
    }

    const contentType = response.headers.get('Content-Type') ?? '';
    if (contentType.includes('application/json')) {
      return this.parseErrorEnvelope<JsonlStream<T>>(response, retryAfter);
    }

    const rowCountHeader = response.headers.get('X-Row-Count');
    const parsedRowCount =
      rowCountHeader !== null ? Number.parseInt(rowCountHeader, 10) : undefined;

    const stream = parseNdjsonStream<T>(response.body);
    const data = attachRowCountMetadata(stream, parsedRowCount);

    return {
      data,
      error: null,
    };
  }

  private mutateJson<T>(
    method: 'POST' | 'PATCH',
    { path, body, query, headers, idempotencyKey }: HttpMutationOptions,
  ): Promise<ApiResponse<T>> {
    const url = joinUrl(
      this.options.baseUrl,
      `${API_VERSION_PREFIX}${path}${buildQueryString(query ?? {})}`,
    );

    const requestHeaders = this.buildHeaders({
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(idempotencyKey !== undefined ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...headers,
    });

    return this.requestJson<T>(url, {
      method,
      headers: requestHeaders,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  private buildHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return {
      'x-api-key': this.options.apiKey,
      Accept: 'application/json',
      ...extra,
    };
  }

  private async requestJson<T>(
    url: string,
    init: RequestInit,
  ): Promise<ApiResponse<T>> {
    let response: Response;

    try {
      response = await this.fetchWithRetry(url, init);
    } catch (error) {
      throw toTransportError(error);
    }

    const retryAfter = parseRetryAfterHeader(response.headers.get('Retry-After'));

    if (!response.ok) {
      return this.parseErrorEnvelope<T>(response, retryAfter);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new SoundlinkParseError(
        'Failed to parse JSON response from Soundlink API.',
      );
    }

    if (isApiEnvelopeError(body)) {
      return errorResponse(toApiError(body, response.status, retryAfter));
    }

    if (isApiEnvelopeSuccess<T>(body)) {
      return successResponse(body.data, body.meta);
    }

    throw new SoundlinkParseError('Unexpected response shape from Soundlink API.');
  }

  private async parseErrorEnvelope<T>(
    response: Response,
    retryAfter?: number,
  ): Promise<ApiResponse<T>> {
    let body: unknown = null;

    try {
      body = await response.json();
    } catch {
      return errorResponse({
        code: 'internal_error',
        message: `Request failed with status ${String(response.status)}.`,
        status: response.status,
        ...(retryAfter !== undefined ? { retryAfter } : {}),
      });
    }

    if (isApiEnvelopeError(body)) {
      return errorResponse(toApiError(body, response.status, retryAfter));
    }

    return errorResponse({
      code: 'internal_error',
      message: `Request failed with status ${String(response.status)}.`,
      status: response.status,
      ...(retryAfter !== undefined ? { retryAfter } : {}),
    });
  }

  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    const { maxRetries, timeout, fetch } = this.options;
    let attempt = 0;

    let response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeout),
    });

    while (
      attempt < maxRetries &&
      (response.status === 429 || response.status >= 500)
    ) {
      const retryAfter = parseRetryAfterHeader(response.headers.get('Retry-After'));
      const delayMs =
        retryAfter !== undefined ? retryAfter * 1000 : calculateBackoffMs(attempt);

      attempt += 1;
      await sleep(delayMs);

      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeout),
      });
    }

    return response;
  }
}

function toTransportError(error: unknown): SoundlinkParseError {
  if (error instanceof Error) {
    return new SoundlinkParseError(`Network request failed: ${error.message}`);
  }

  return new SoundlinkParseError('Network request failed.');
}

function attachRowCountMetadata<T>(
  stream: AsyncIterable<T>,
  rowCount?: number,
): JsonlStream<T> {
  const jsonlStream: JsonlStream<T> = {
    async *[Symbol.asyncIterator]() {
      for await (const row of stream) {
        yield row;
      }
    },
  };

  if (rowCount !== undefined && !Number.isNaN(rowCount)) {
    jsonlStream.rowCount = rowCount;
  }

  return jsonlStream;
}

/**
 * Read `rowCount` from a {@link JsonlStream} when the API sent `X-Row-Count`.
 *
 * @returns Row count, or `undefined` if not available.
 */
export function getStreamRowCount<T>(stream: AsyncIterable<T>): number | undefined {
  if (typeof stream === 'object' && 'rowCount' in stream) {
    const value = (stream as JsonlStream<T>).rowCount;
    return typeof value === 'number' ? value : undefined;
  }

  return undefined;
}
