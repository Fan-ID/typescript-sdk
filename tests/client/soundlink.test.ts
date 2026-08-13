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

  it('sends Authorization Bearer header on ping', async () => {
    let authorization: string | null = null;

    const soundlink = new Soundlink({
      apiKey: TEST_API_KEY,
      baseUrl: BASE_URL,
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        authorization = headers.get('Authorization');
        return fetch(input, init);
      },
    });

    const { data, error, meta } = await soundlink.ping();

    expect(authorization).toBe(`Bearer ${TEST_API_KEY}`);
    expect(error).toBeNull();
    expect(data).toEqual({ status: 'ok' });
    expect(meta?.requestId).toBeTruthy();
  });
});
