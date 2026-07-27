import { describe, expect, it } from 'vitest';
import {
  errorResponse,
  isApiEnvelopeError,
  isApiEnvelopeSuccess,
  parseRetryAfterHeader,
  successResponse,
  toApiError,
} from '../../src/core/api-response.js';
import { collectNdjsonStream, parseNdjsonText } from '../../src/core/jsonl.js';
import { buildQueryString } from '../../src/utils/query.js';

describe('core helpers', () => {
  it('builds query strings skipping empty values', () => {
    expect(buildQueryString({ page: 1, sortBy: undefined, q: '' })).toBe('?page=1');
  });

  it('detects API envelope shapes', () => {
    expect(isApiEnvelopeSuccess({ data: {}, meta: { requestId: '1' } })).toBe(true);
    expect(
      isApiEnvelopeError({
        error: { code: 'x', message: 'y' },
        meta: { requestId: '1' },
      }),
    ).toBe(true);
  });

  it('maps envelope errors to ApiError', () => {
    const error = toApiError(
      {
        error: { code: 'invalid_api_key', message: 'bad key' },
        meta: { requestId: 'abc' },
      },
      401,
      5,
    );

    expect(error.code).toBe('invalid_api_key');
    expect(error.retryAfter).toBe(5);
    expect(error.details).toBeUndefined();
  });

  it('forwards error.details when present', () => {
    const error = toApiError(
      {
        error: {
          code: 'insufficient_credit',
          message: 'Insufficient wallet balance for this campaign.',
          details: { available: 120, required: 350 },
        },
        meta: { requestId: 'abc' },
      },
      402,
    );

    expect(error.code).toBe('insufficient_credit');
    expect(error.details).toEqual({ available: 120, required: 350 });
  });

  it('builds success and error ApiResponse objects', () => {
    expect(successResponse({ ok: true }, { requestId: '1' })).toEqual({
      data: { ok: true },
      error: null,
      meta: { requestId: '1' },
    });

    expect(
      errorResponse({
        code: 'invalid_api_key',
        message: 'y',
        status: 400,
        requestId: '1',
      }),
    ).toEqual({
      data: null,
      error: { code: 'invalid_api_key', message: 'y', status: 400, requestId: '1' },
      meta: { requestId: '1' },
    });
  });

  it('parses Retry-After header values', () => {
    expect(parseRetryAfterHeader('3')).toBe(3);
    expect(parseRetryAfterHeader(null)).toBeUndefined();
  });

  it('parses ndjson text and async streams', async () => {
    const rows = parseNdjsonText<{ a: number }>('{"a":1}\n\n{"a":2}\n');
    expect(rows).toEqual([{ a: 1 }, { a: 2 }]);

    async function* generator() {
      yield { a: 1 };
      yield { a: 2 };
    }

    const collected = await collectNdjsonStream(generator());
    expect(collected.rowCount).toBe(2);
  });
});
