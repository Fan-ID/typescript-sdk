import { randomUUID } from 'node:crypto';

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

export function parsePathname(path: string): string {
  return new URL(path, 'http://emulator.local').pathname;
}

export function matchPathGroup(pathname: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(pathname);
  const group = match?.[1];
  return typeof group === 'string' ? group : undefined;
}

export function headerValue(
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

export function success(
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

export function failure(
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

export function readIdempotencyKey(
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
