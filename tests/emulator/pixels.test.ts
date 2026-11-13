import { describe, expect, it } from 'vitest';
import { createApiEmulator } from '../../src/emulator/index.js';
import {
  authHeaders,
  EMULATOR_API_KEY,
  envelopeData,
  envelopeError,
} from './helpers.js';

describe('emulator pixels', () => {
  it('saves, lists without the token, and moves the default', () => {
    const emu = createApiEmulator({ apiKey: EMULATOR_API_KEY });

    const first = emu.dispatch({
      method: 'PUT',
      path: '/v1/pixels/111',
      headers: authHeaders(),
      body: { platform: 'meta', accessToken: 'token-a', isDefault: true },
    });
    expect(first.status).toBe(200);
    expect(envelopeData(first.json)).toEqual({
      id: '111',
      platform: 'meta',
      isDefault: true,
      status: 'ok',
      lastErrorCode: null,
      errorSince: null,
    });
    expect(JSON.stringify(first.json)).not.toContain('token-a');

    const second = emu.dispatch({
      method: 'PUT',
      path: '/v1/pixels/222',
      headers: authHeaders(),
      body: { platform: 'meta', accessToken: 'token-b', isDefault: true },
    });
    expect(second.status).toBe(200);

    const list = emu.dispatch({
      method: 'GET',
      path: '/v1/pixels',
      headers: authHeaders(),
    });
    expect(envelopeData(list.json)).toEqual({
      pixels: [
        {
          id: '111',
          platform: 'meta',
          isDefault: false,
          status: 'ok',
          lastErrorCode: null,
          errorSince: null,
        },
        {
          id: '222',
          platform: 'meta',
          isDefault: true,
          status: 'ok',
          lastErrorCode: null,
          errorSince: null,
        },
      ],
    });
    expect(JSON.stringify(list.json)).not.toContain('token-a');
    expect(JSON.stringify(list.json)).not.toContain('token-b');
  });

  it('returns 404 when setting isDefault on a pixel that does not exist', () => {
    const emu = createApiEmulator({ apiKey: EMULATOR_API_KEY });
    const response = emu.dispatch({
      method: 'PUT',
      path: '/v1/pixels/missing',
      headers: authHeaders(),
      body: { platform: 'meta', isDefault: true },
    });
    expect(response.status).toBe(404);
    expect(envelopeError(response.json).message).toBe('Pixel not found.');
  });

  it('rejects a token already used by another pixel', () => {
    const emu = createApiEmulator({ apiKey: EMULATOR_API_KEY });
    emu.dispatch({
      method: 'PUT',
      path: '/v1/pixels/111',
      headers: authHeaders(),
      body: { platform: 'meta', accessToken: 'token-a' },
    });
    const response = emu.dispatch({
      method: 'PUT',
      path: '/v1/pixels/222',
      headers: authHeaders(),
      body: { platform: 'meta', accessToken: 'token-a' },
    });
    expect(response.status).toBe(400);
    expect(envelopeError(response.json).message).toBe(
      'Access token is already in use with another pixel ID',
    );
  });

  it('rejects a platform other than meta', () => {
    const emu = createApiEmulator({ apiKey: EMULATOR_API_KEY });
    const response = emu.dispatch({
      method: 'PUT',
      path: '/v1/pixels/111',
      headers: authHeaders(),
      body: { platform: 'tiktok', accessToken: 'token-a' },
    });
    expect(response.status).toBe(400);
    expect(envelopeError(response.json).message).toContain(
      'Invalid request body at platform:',
    );
  });

  it('deletes with 204 and then 404', () => {
    const emu = createApiEmulator({ apiKey: EMULATOR_API_KEY });
    emu.dispatch({
      method: 'PUT',
      path: '/v1/pixels/111',
      headers: authHeaders(),
      body: { platform: 'meta', accessToken: 'token-a' },
    });

    const deleted = emu.dispatch({
      method: 'DELETE',
      path: '/v1/pixels/111',
      headers: authHeaders(),
    });
    expect(deleted.status).toBe(204);
    expect(deleted.json).toBeNull();

    const missing = emu.dispatch({
      method: 'DELETE',
      path: '/v1/pixels/111',
      headers: authHeaders(),
    });
    expect(missing.status).toBe(404);
    expect(envelopeError(missing.json).message).toBe('Pixel not found.');
  });

  it('returns a sent test event without echoing the token', () => {
    const emu = createApiEmulator({ apiKey: EMULATOR_API_KEY });
    emu.dispatch({
      method: 'PUT',
      path: '/v1/pixels/111',
      headers: authHeaders(),
      body: { platform: 'meta', accessToken: 'token-a' },
    });

    const sent = emu.dispatch({
      method: 'POST',
      path: '/v1/pixels/111/test-events',
      headers: authHeaders(),
    });
    expect(sent.status).toBe(200);
    expect(envelopeData(sent.json)).toEqual({ status: 'sent', pixelId: '111' });
    expect(JSON.stringify(sent.json)).not.toContain('token-a');

    const missing = emu.dispatch({
      method: 'POST',
      path: '/v1/pixels/missing/test-events',
      headers: authHeaders(),
    });
    expect(missing.status).toBe(404);
  });

  it('clears pixels on reset', () => {
    const emu = createApiEmulator({ apiKey: EMULATOR_API_KEY });
    emu.dispatch({
      method: 'PUT',
      path: '/v1/pixels/111',
      headers: authHeaders(),
      body: { platform: 'meta', accessToken: 'token-a' },
    });
    emu.reset();
    const list = emu.dispatch({
      method: 'GET',
      path: '/v1/pixels',
      headers: authHeaders(),
    });
    expect(envelopeData(list.json)).toEqual({ pixels: [] });
  });
});
