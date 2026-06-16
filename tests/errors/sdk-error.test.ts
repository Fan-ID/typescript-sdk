import { describe, expect, it } from 'vitest';
import {
  SoundlinkConfigError,
  SoundlinkParseError,
  SoundlinkSdkError,
} from '../../src/errors/sdk-error.js';

describe('SDK errors', () => {
  it('exposes error names', () => {
    expect(new SoundlinkSdkError('x').name).toBe('SoundlinkSdkError');
    expect(new SoundlinkParseError('x').name).toBe('SoundlinkParseError');
    expect(new SoundlinkConfigError('x').name).toBe('SoundlinkConfigError');
  });
});
