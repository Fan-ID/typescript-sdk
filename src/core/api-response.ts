import type {
  ApiEnvelopeError,
  ApiEnvelopeSuccess,
  ApiMeta,
  ApiError,
  ApiResponse,
  PublicApiErrorCode,
} from '../types/api.js';

export function isApiEnvelopeError(body: unknown): body is ApiEnvelopeError {
  if (typeof body !== 'object' || body === null) {
    return false;
  }

  const record = body as Record<string, unknown>;
  return (
    typeof record.error === 'object' &&
    record.error !== null &&
    typeof (record.error as Record<string, unknown>).code === 'string' &&
    typeof (record.error as Record<string, unknown>).message === 'string'
  );
}

export function isApiEnvelopeSuccess<T>(body: unknown): body is ApiEnvelopeSuccess<T> {
  if (typeof body !== 'object' || body === null) {
    return false;
  }

  const record = body as Record<string, unknown>;
  return 'data' in record && typeof record.meta === 'object' && record.meta !== null;
}

export function toApiError(
  envelope: ApiEnvelopeError,
  status: number,
  retryAfter?: number,
): ApiError {
  return {
    code: envelope.error.code as PublicApiErrorCode,
    message: envelope.error.message,
    status,
    requestId: envelope.meta.requestId,
    ...(retryAfter !== undefined ? { retryAfter } : {}),
  };
}

export function successResponse<T>(data: T, meta: ApiMeta): ApiResponse<T> {
  return {
    data,
    error: null,
    meta,
  };
}

export function errorResponse<T>(error: ApiError): ApiResponse<T> {
  return {
    data: null,
    error,
    ...(error.requestId ? { meta: { requestId: error.requestId } } : {}),
  };
}

export function parseRetryAfterHeader(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds;
  }

  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) {
    const deltaSeconds = Math.ceil((dateMs - Date.now()) / 1000);
    return Math.max(deltaSeconds, 0);
  }

  return undefined;
}
