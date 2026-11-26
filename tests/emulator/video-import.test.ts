import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createApiEmulator,
  type ApiEmulator,
  type EmulatorServer,
} from '../../src/emulator/index.js';
import {
  authHeaders,
  EMULATOR_API_KEY,
  envelopeData,
  envelopeError,
} from './helpers.js';

const MP4 = 'https://cdn.example.com/promo.mp4';
const MOV = 'https://cdn.example.com/clip.MOV';

interface StartData {
  sessionId: string;
  status: string;
  count?: number;
  videoId?: string;
}

interface StatusData {
  sessionId: string;
  status: string;
  videoId?: string;
  videoIds?: string[];
  counts?: { total: number; ready: number; failed: number };
  error?: { code: string; message: string };
}

describe('emulator video import', () => {
  let emu: ApiEmulator;
  let httpServer: EmulatorServer | undefined;

  beforeEach(() => {
    emu = createApiEmulator({ apiKey: EMULATOR_API_KEY });
  });

  afterEach(async () => {
    if (httpServer) {
      await httpServer.close();
      httpServer = undefined;
    }
  });

  function startImport(body: unknown) {
    return emu.dispatch({
      method: 'POST',
      path: '/v1/videos/import',
      headers: authHeaders(),
      body,
    });
  }

  function importStatus(sessionId: string) {
    return emu.dispatch({
      method: 'GET',
      path: `/v1/videos/import/${sessionId}`,
      headers: authHeaders(),
    });
  }

  function failSession(sessionId: string, body?: unknown) {
    return emu.dispatch({
      method: 'POST',
      path: `/__emulator/videos/${sessionId}/fail`,
      body,
    });
  }

  it('accepts a single URL with 202 and settles to ready with a videoId on the first poll', () => {
    const started = startImport({ url: MP4 });

    expect(started.status).toBe(202);
    const data = envelopeData(started.json) as StartData;
    expect(data).toMatchObject({ status: 'processing', count: 1 });

    const polled = importStatus(data.sessionId);

    expect(polled.status).toBe(200);
    const status = envelopeData(polled.json) as StatusData;
    expect(status).toMatchObject({ sessionId: data.sessionId, status: 'ready' });
    expect(typeof status.videoId).toBe('string');
    expect(status.videoIds).toBeUndefined();
    expect(status.counts).toBeUndefined();
  });

  it('accepts a batch with videoIds and counts, including QuickTime', () => {
    const started = startImport({ videos: [{ url: MP4 }, { url: MOV }] });

    expect(started.status).toBe(202);
    const data = envelopeData(started.json) as StartData;
    expect(data.count).toBe(2);

    const status = envelopeData(importStatus(data.sessionId).json) as StatusData;

    expect(status.status).toBe('ready');
    expect(status.videoIds).toHaveLength(2);
    expect(status.counts).toEqual({ total: 2, ready: 2, failed: 0 });
    expect(status.videoId).toBeUndefined();
  });

  it('returns 200 with the existing video for a single URL that already imported', () => {
    const first = envelopeData(startImport({ url: MP4 }).json) as StartData;
    const firstStatus = envelopeData(importStatus(first.sessionId).json) as StatusData;

    const repeat = startImport({ url: MP4 });

    expect(repeat.status).toBe(200);
    const data = envelopeData(repeat.json) as StartData;
    expect(data).toMatchObject({
      status: 'ready',
      count: 1,
      videoId: firstStatus.videoId,
    });
    expect(data.sessionId).not.toBe(first.sessionId);
    const status = envelopeData(importStatus(data.sessionId).json) as StatusData;
    expect(status).toMatchObject({ status: 'ready', videoId: firstStatus.videoId });
  });

  it.each([
    ['both url and videos', { url: MP4, videos: [{ url: MP4 }] }],
    ['neither url nor videos', {}],
    ['an empty videos list', { videos: [] }],
    ['more than 5 videos', { videos: Array.from({ length: 6 }, () => ({ url: MP4 })) }],
    ['a plain HTTP URL', { url: 'http://cdn.example.com/promo.mp4' }],
    ['a URL that does not parse', { url: 'not a url' }],
    ['a non-string url', { url: 42 }],
    ['a videos item without a url', { videos: [{}] }],
    ['a non-object body', 'nope'],
  ])('rejects %s', (_name, body) => {
    const response = startImport(body);

    expect(response.status).toBe(400);
    expect(envelopeError(response.json).code).toBe('invalid_request');
  });

  it('rejects an unsupported file type with invalid_video_content_type', () => {
    const response = startImport({ url: 'https://cdn.example.com/promo.gif' });

    expect(response.status).toBe(400);
    expect(envelopeError(response.json).code).toBe('invalid_video_content_type');
  });

  it('returns 404 for an unknown session', () => {
    const response = importStatus('3f2b8c1e-4a5d-4e6f-8a7b-9c0d1e2f3a4b');

    expect(response.status).toBe(404);
  });

  it('requires an API key', () => {
    const response = emu.dispatch({
      method: 'POST',
      path: '/v1/videos/import',
      body: { url: MP4 },
    });

    expect(response.status).toBe(401);
  });

  describe('harness fail', () => {
    it('fails a session that has not settled, with the chosen error code', () => {
      const data = envelopeData(startImport({ url: MP4 }).json) as StartData;

      const failed = failSession(data.sessionId, { code: 'video_too_large' });
      const status = envelopeData(importStatus(data.sessionId).json) as StatusData;

      expect(failed.status).toBe(200);
      expect(status.status).toBe('failed');
      expect(status.error?.code).toBe('video_too_large');
      expect(status.videoId).toBeUndefined();
    });

    it('defaults to import_failed and reports batch counts', () => {
      const data = envelopeData(
        startImport({ videos: [{ url: MP4 }, { url: MOV }] }).json,
      ) as StartData;

      failSession(data.sessionId);
      const status = envelopeData(importStatus(data.sessionId).json) as StatusData;

      expect(status.status).toBe('failed');
      expect(status.error?.code).toBe('import_failed');
      expect(status.counts).toEqual({ total: 2, ready: 0, failed: 2 });
    });

    it('does not remember the URLs of a failed session as imported', () => {
      const data = envelopeData(startImport({ url: MP4 }).json) as StartData;
      failSession(data.sessionId);
      importStatus(data.sessionId);

      const retry = startImport({ url: MP4 });

      expect(retry.status).toBe(202);
    });

    it('rejects an unknown error code', () => {
      const data = envelopeData(startImport({ url: MP4 }).json) as StartData;

      const response = failSession(data.sessionId, { code: 'because' });

      expect(response.status).toBe(400);
    });

    it('cannot fail a session that already settled', () => {
      const data = envelopeData(startImport({ url: MP4 }).json) as StartData;
      importStatus(data.sessionId);

      const response = failSession(data.sessionId);

      expect(response.status).toBe(400);
      expect(envelopeError(response.json).message).toContain('ready');
    });

    it('returns 404 for an unknown session', () => {
      expect(failSession('missing').status).toBe(404);
    });
  });

  it('clears sessions and imported videos on reset', () => {
    const data = envelopeData(startImport({ url: MP4 }).json) as StartData;
    importStatus(data.sessionId);

    emu.dispatch({ method: 'POST', path: '/__emulator/reset' });

    expect(importStatus(data.sessionId).status).toBe(404);
    expect(startImport({ url: MP4 }).status).toBe(202);
  });

  it('answers over HTTP with 202', async () => {
    httpServer = await emu.listen({ port: 0 });

    const response = await fetch(`${httpServer.baseUrl}/v1/videos/import`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ url: MP4 }),
    });

    expect(response.status).toBe(202);
    const json = (await response.json()) as { data: StartData };
    expect(json.data.status).toBe('processing');
  });
});
