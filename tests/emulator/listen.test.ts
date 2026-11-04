import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createEmulator,
  LOOPBACK_HOST,
  type EmulatorServer,
  type SoundlinkEmulator,
} from '../../src/emulator/index.js';
import { server as mswServer } from '../mocks/server.js';
import { EMULATOR_API_KEY, envelopeData } from './helpers.js';

describe('emulator listen', () => {
  let emu: SoundlinkEmulator;
  let httpServer: EmulatorServer | undefined;

  beforeAll(() => {
    // Real TCP fetch must not be intercepted by MSW.
    mswServer.close();
  });

  afterAll(() => {
    mswServer.listen({ onUnhandledRequest: 'error' });
  });

  afterEach(async () => {
    if (httpServer) {
      await httpServer.close();
      httpServer = undefined;
    }
  });

  it('rejects non-loopback host', async () => {
    emu = createEmulator({ apiKey: EMULATOR_API_KEY });
    await expect(emu.listen({ host: '0.0.0.0' })).rejects.toThrow(
      /only allows host 127\.0\.0\.1/,
    );
    await expect(emu.listen({ host: 'localhost' })).rejects.toThrow(
      /only allows host 127\.0\.0\.1/,
    );
  });

  it('serves /v1/ping on 127.0.0.1', async () => {
    emu = createEmulator({ apiKey: EMULATOR_API_KEY });
    httpServer = await emu.listen({ host: LOOPBACK_HOST, port: 0 });

    expect(httpServer.host).toBe(LOOPBACK_HOST);
    expect(httpServer.baseUrl).toBe(
      `http://${LOOPBACK_HOST}:${String(httpServer.port)}`,
    );

    const response = await fetch(`${httpServer.baseUrl}/v1/ping`, {
      headers: { Authorization: `Bearer ${EMULATOR_API_KEY}` },
    });
    expect(response.status).toBe(200);
    const json: unknown = await response.json();
    expect((envelopeData(json) as { status: string }).status).toBe('ok');
  });

  it('rejects invalid JSON body with 400', async () => {
    emu = createEmulator({ apiKey: EMULATOR_API_KEY });
    httpServer = await emu.listen({ port: 0 });

    const response = await fetch(`${httpServer.baseUrl}/v1/campaigns`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${EMULATOR_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'bad-json',
      },
      body: '{not-json',
    });
    expect(response.status).toBe(400);
    const json: unknown = await response.json();
    expect((json as { error: { code: string } }).error.code).toBe('invalid_request');
  });
});
