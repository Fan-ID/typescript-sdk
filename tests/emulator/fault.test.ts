import { afterEach, describe, expect, it } from 'vitest';
import { Soundlink } from '../../src/index.js';
import {
  createApiEmulator,
  type ApiEmulator,
  type EmulatorServer,
} from '../../src/emulator/index.js';
import { SERVER_ERROR_FAULT_RESPONSES } from '../../src/emulator/store.js';
import {
  authHeaders,
  DEFAULT_CREATE_BODY,
  EMULATOR_API_KEY,
  envelopeError,
} from './helpers.js';

describe('emulator failNext', () => {
  let emu: ApiEmulator;
  let httpServer: EmulatorServer | undefined;

  afterEach(async () => {
    if (httpServer) {
      await httpServer.close();
      httpServer = undefined;
    }
  });

  it('returns 409 once and does not debit the wallet', () => {
    emu = createApiEmulator({ apiKey: EMULATOR_API_KEY, initialWalletBalance: 1000 });
    emu.failNext('conflict');

    const denied = emu.dispatch({
      method: 'POST',
      path: '/v1/campaigns',
      headers: authHeaders('create-fault'),
      body: DEFAULT_CREATE_BODY,
    });
    expect(denied.status).toBe(409);
    expect(envelopeError(denied.json).code).toBe('idempotency_key_conflict');
    expect(emu.getWallet().balance).toBe(1000);

    const ping = emu.dispatch({
      method: 'GET',
      path: '/v1/ping',
      headers: authHeaders(),
    });
    expect(ping.status).toBe(200);
  });

  it('returns 500 for the call and the SDK default retries', () => {
    emu = createApiEmulator({ apiKey: EMULATOR_API_KEY });
    emu.failNext('server_error');

    for (let i = 0; i < SERVER_ERROR_FAULT_RESPONSES; i += 1) {
      const failed = emu.dispatch({
        method: 'GET',
        path: '/v1/wallet',
        headers: authHeaders(),
      });
      expect(failed.status).toBe(500);
      expect(envelopeError(failed.json).code).toBe('internal_error');
    }

    const wallet = emu.dispatch({
      method: 'GET',
      path: '/v1/wallet',
      headers: authHeaders(),
    });
    expect(wallet.status).toBe(200);
  });

  it('surfaces server_error through the default Soundlink client', async () => {
    emu = createApiEmulator({ apiKey: EMULATOR_API_KEY });
    httpServer = await emu.listen({ port: 0 });
    emu.failNext('server_error');
    const client = new Soundlink({
      apiKey: EMULATOR_API_KEY,
      baseUrl: httpServer.baseUrl,
    });

    const failed = await client.wallet.get();
    expect(failed.error?.status).toBe(500);
    expect(failed.error?.code).toBe('internal_error');

    const wallet = await client.wallet.get();
    expect(wallet.error).toBeNull();
    expect(wallet.data?.currency).toBe('USD');
  });

  it('keeps the fault armed when the API key is missing', () => {
    emu = createApiEmulator({ apiKey: EMULATOR_API_KEY });
    emu.failNext('server_error');

    const denied = emu.dispatch({ method: 'GET', path: '/v1/ping' });
    expect(denied.status).toBe(401);

    const failed = emu.dispatch({
      method: 'GET',
      path: '/v1/ping',
      headers: authHeaders(),
    });
    expect(failed.status).toBe(500);
  });

  it('clears an armed fault on reset', () => {
    emu = createApiEmulator({ apiKey: EMULATOR_API_KEY });
    emu.failNext('conflict');
    emu.reset();

    const ping = emu.dispatch({
      method: 'GET',
      path: '/v1/ping',
      headers: authHeaders(),
    });
    expect(ping.status).toBe(200);
  });

  it('arms the next fault over HTTP and hangs until the client aborts', async () => {
    emu = createApiEmulator({ apiKey: EMULATOR_API_KEY });
    httpServer = await emu.listen({ port: 0 });

    const armed = await fetch(`${httpServer.baseUrl}/__emulator/fault`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fault: 'timeout' }),
    });
    expect(armed.status).toBe(200);

    await expect(
      fetch(`${httpServer.baseUrl}/v1/ping`, {
        headers: { Authorization: `Bearer ${EMULATOR_API_KEY}` },
        signal: AbortSignal.timeout(200),
      }),
    ).rejects.toThrow();

    const ping = await fetch(`${httpServer.baseUrl}/v1/ping`, {
      headers: { Authorization: `Bearer ${EMULATOR_API_KEY}` },
    });
    expect(ping.status).toBe(200);
  });

  it('returns hang instead of an HTTP status for an in-process timeout', () => {
    emu = createApiEmulator({ apiKey: EMULATOR_API_KEY });
    emu.failNext('timeout');

    const hung = emu.dispatch({
      method: 'GET',
      path: '/v1/ping',
      headers: authHeaders(),
    });
    expect(hung.hang).toBe(true);
    expect(hung.status).toBe(408);
    expect(hung.json).toBeNull();

    const ping = emu.dispatch({
      method: 'GET',
      path: '/v1/ping',
      headers: authHeaders(),
    });
    expect(ping.status).toBe(200);
    expect(ping.hang).toBeUndefined();
  });

  it('rejects a second fault while one is armed', () => {
    emu = createApiEmulator({ apiKey: EMULATOR_API_KEY });
    emu.failNext('conflict');
    expect(() => {
      emu.failNext('timeout');
    }).toThrow('A fault is already armed.');

    const denied = emu.dispatch({
      method: 'POST',
      path: '/__emulator/fault',
      body: { fault: 'server_error' },
    });
    expect(denied.status).toBe(400);
    expect(envelopeError(denied.json).message).toBe('A fault is already armed.');

    const conflict = emu.dispatch({
      method: 'GET',
      path: '/v1/ping',
      headers: authHeaders(),
    });
    expect(conflict.status).toBe(409);
  });

  it('covers a custom maxRetries on server_error', () => {
    emu = createApiEmulator({ apiKey: EMULATOR_API_KEY });
    emu.failNext('server_error', 0);

    const failed = emu.dispatch({
      method: 'GET',
      path: '/v1/wallet',
      headers: authHeaders(),
    });
    expect(failed.status).toBe(500);

    const wallet = emu.dispatch({
      method: 'GET',
      path: '/v1/wallet',
      headers: authHeaders(),
    });
    expect(wallet.status).toBe(200);
  });

  it('rejects a maxRetries that is not a non-negative integer', () => {
    emu = createApiEmulator({ apiKey: EMULATOR_API_KEY });
    expect(() => { emu.failNext('server_error', -1); }).toThrow(
      'maxRetries must be a non-negative integer.',
    );
    expect(() => { emu.failNext('server_error', 1.5); }).toThrow(
      'maxRetries must be a non-negative integer.',
    );

    const response = emu.dispatch({
      method: 'POST',
      path: '/__emulator/fault',
      body: { fault: 'server_error', maxRetries: '0' },
    });
    expect(response.status).toBe(400);
    expect(envelopeError(response.json).message).toBe(
      'maxRetries must be a non-negative integer.',
    );
  });

  it('rejects maxRetries on a fault the SDK does not retry', () => {
    emu = createApiEmulator({ apiKey: EMULATOR_API_KEY });
    expect(() => {
      emu.failNext('timeout', 0);
    }).toThrow('maxRetries applies only to server_error.');
  });

  it('rejects an unknown fault', () => {
    emu = createApiEmulator({ apiKey: EMULATOR_API_KEY });
    const response = emu.dispatch({
      method: 'POST',
      path: '/__emulator/fault',
      body: { fault: 'nope' },
    });
    expect(response.status).toBe(400);
    expect(envelopeError(response.json).code).toBe('invalid_request');
  });
});
