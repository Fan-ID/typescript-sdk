export class SoundlinkSdkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SoundlinkSdkError';
    Object.setPrototypeOf(this, SoundlinkSdkError.prototype);
  }
}

export class SoundlinkParseError extends SoundlinkSdkError {
  constructor(message: string) {
    super(message);
    this.name = 'SoundlinkParseError';
    Object.setPrototypeOf(this, SoundlinkParseError.prototype);
  }
}

export class SoundlinkConfigError extends SoundlinkSdkError {
  constructor(message: string) {
    super(message);
    this.name = 'SoundlinkConfigError';
    Object.setPrototypeOf(this, SoundlinkConfigError.prototype);
  }
}
