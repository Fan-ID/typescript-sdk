import { describe, expect, it } from 'vitest';
import {
  Soundlink,
  SoundlinkConfigError,
  resolveClientOptions,
} from '../../src/index.js';
import { BASE_URL, TEST_API_KEY } from '../mocks/handlers.js';

describe('Soundlink client', () => {
  it('accepts a string API key', () => {
    const client = new Soundlink(TEST_API_KEY);
    expect(client).toBeDefined();
  });

  it('accepts an options object', () => {
    const options = resolveClientOptions({
      apiKey: TEST_API_KEY,
      baseUrl: BASE_URL,
    });

    expect(options.apiKey).toBe(TEST_API_KEY);
    expect(options.baseUrl).toBe(BASE_URL);
  });

  it('throws for missing API key', () => {
    expect(() => resolveClientOptions({ apiKey: '   ' })).toThrow(SoundlinkConfigError);
  });

  it('throws for invalid key prefix', () => {
    expect(() => resolveClientOptions('sl_invalid_key')).toThrow(SoundlinkConfigError);
  });

  it('sends x-api-key header on ping', async () => {
    const soundlink = new Soundlink({ apiKey: TEST_API_KEY, baseUrl: BASE_URL });
    const { data, error, meta } = await soundlink.ping();

    expect(error).toBeNull();
    expect(data).toEqual({ status: 'ok' });
    expect(meta?.requestId).toBeTruthy();
  });
});
