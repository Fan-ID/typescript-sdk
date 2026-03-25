export class SoundlinkError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly requestId: string | null;

  constructor(
    message: string,
    options: { code: string; status?: number; requestId?: string },
  ) {
    super(message);
    this.name = "SoundlinkError";
    this.code = options.code;
    this.status = options.status ?? null;
    this.requestId = options.requestId ?? null;
  }
}

export class AuthenticationError extends SoundlinkError {
  constructor(
    message = "Invalid or missing API key. Set SOUNDLINK_TOKEN in your environment.",
    requestId?: string,
  ) {
    super(message, { code: "authentication_error", status: 401, requestId });
    this.name = "AuthenticationError";
  }
}

export class PermissionError extends SoundlinkError {
  constructor(
    message = "You do not have permission for this action.",
    requestId?: string,
  ) {
    super(message, { code: "permission_denied", status: 403, requestId });
    this.name = "PermissionError";
  }
}

export class ValidationError extends SoundlinkError {
  /** Validation errors keyed by field name. */
  readonly fields: Record<string, string[]>;

  constructor(
    message: string,
    fields: Record<string, string[]> = {},
    requestId?: string,
  ) {
    super(message, { code: "validation_error", status: 422, requestId });
    this.name = "ValidationError";
    this.fields = fields;
  }
}

export class NotFoundError extends SoundlinkError {
  constructor(message = "Resource not found.", requestId?: string) {
    super(message, { code: "not_found", status: 404, requestId });
    this.name = "NotFoundError";
  }
}

export class RateLimitError extends SoundlinkError {
  /** Seconds to wait before retrying. */
  readonly retryAfter: number;

  constructor(retryAfter: number, requestId?: string) {
    super(`Rate limit exceeded. Retry after ${retryAfter} second(s).`, {
      code: "rate_limit",
      status: 429,
      requestId,
    });
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

export class ServerError extends SoundlinkError {
  constructor(message = "Internal server error.", requestId?: string) {
    super(message, { code: "server_error", status: 500, requestId });
    this.name = "ServerError";
  }
}

export class NetworkError extends SoundlinkError {
  constructor(cause: Error) {
    super(`Network request failed: ${cause.message}`, {
      code: "network_error",
    });
    this.name = "NetworkError";
  }
}
