/**
 * Base error for unexpected SDK failures (configuration, parsing, transport).
 *
 * HTTP/API errors from Soundlink are returned as `{ data: null, error }` and do not throw.
 */
export class SoundlinkSdkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SoundlinkSdkError';
    Object.setPrototypeOf(this, SoundlinkSdkError.prototype);
  }
}

/** Thrown when a response body cannot be parsed or the network request fails unexpectedly. */
export class SoundlinkParseError extends SoundlinkSdkError {
  constructor(message: string) {
    super(message);
    this.name = 'SoundlinkParseError';
    Object.setPrototypeOf(this, SoundlinkParseError.prototype);
  }
}

/** Thrown when the client is misconfigured (missing or invalid API key, etc.). */
export class SoundlinkConfigError extends SoundlinkSdkError {
  constructor(message: string) {
    super(message);
    this.name = 'SoundlinkConfigError';
    Object.setPrototypeOf(this, SoundlinkConfigError.prototype);
  }
}
