import { beforeEach, describe, expect, it } from 'vitest';
import { createApiEmulator, type ApiEmulator } from '../../src/emulator/index.js';
import type { CreativeMetrics, CreateCampaignRequest } from '../../src/types/api.js';
import {
  asCampaignCreate,
  authHeaders,
  DEFAULT_CREATE_BODY,
  EMULATOR_API_KEY,
  envelopeData,
  envelopeError,
} from './helpers.js';

const VIDEO_A = '11111111-1111-4111-8111-111111111111';
const VIDEO_B = '22222222-2222-4222-8222-222222222222';

function fullControlBody(
  selectedCreatives: Array<Record<string, unknown>>,
): CreateCampaignRequest {
  return {
    ...DEFAULT_CREATE_BODY,
    creativeDirection: {
      type: 'full_control',
      selectedCreatives: selectedCreatives as never,
    },
  };
}

describe('emulator full_control creatives', () => {
  let emu: ApiEmulator;

  beforeEach(() => {
    emu = createApiEmulator({
      apiKey: EMULATOR_API_KEY,
      initialWalletBalance: 500,
    });
  });

  function create(idempotencyKey: string, body: unknown) {
    return emu.dispatch({
      method: 'POST',
      path: '/v1/campaigns',
      headers: authHeaders(idempotencyKey),
      body,
    });
  }

  function creativesOf(campaignId: string): CreativeMetrics {
    const response = emu.dispatch({
      method: 'GET',
      path: `/v1/campaigns/${campaignId}/metrics/creatives`,
      headers: authHeaders(),
    });
    return envelopeData(response.json) as CreativeMetrics;
  }

  it('returns one creative per stored videoId, in order', () => {
    const created = create(
      'fc-order',
      fullControlBody([{ videoId: VIDEO_A }, { videoId: VIDEO_B }]),
    );
    expect(created.status).toBe(201);
    const campaignId = asCampaignCreate(envelopeData(created.json)).campaignId;

    const data = creativesOf(campaignId);

    expect(data.creatives.map((c) => c.video_id)).toEqual([VIDEO_A, VIDEO_B]);
  });

  it('reports the stored caption on each creative, and an empty string when none was set', () => {
    const created = create(
      'fc-caption',
      fullControlBody([
        { videoId: VIDEO_A, caption: 'Hear the preview' },
        { videoId: VIDEO_B },
      ]),
    );
    const campaignId = asCampaignCreate(envelopeData(created.json)).campaignId;

    const data = creativesOf(campaignId);

    expect(data.creatives[0]?.children[0]?.caption).toBe('Hear the preview');
    expect(data.creatives[1]?.children[0]?.caption).toBe('');
  });

  it('trims the caption, and stores a whitespace-only caption as no caption', () => {
    const created = create(
      'fc-trim',
      fullControlBody([
        { videoId: VIDEO_A, caption: '  Hello  ' },
        { videoId: VIDEO_B, caption: '   ' },
      ]),
    );
    const campaignId = asCampaignCreate(envelopeData(created.json)).campaignId;

    const data = creativesOf(campaignId);

    expect(data.creatives[0]?.children[0]?.caption).toBe('Hello');
    expect(data.creatives[1]?.children[0]?.caption).toBe('');
  });

  it('accepts a caption of exactly 2048 characters after trimming', () => {
    const caption = 'a'.repeat(2048);
    const created = create(
      'fc-2048',
      fullControlBody([{ videoId: VIDEO_A, caption: ` ${caption} ` }]),
    );

    expect(created.status).toBe(201);
  });

  it('rejects a caption over 2048 characters after trimming', () => {
    const created = create(
      'fc-2049',
      fullControlBody([
        { videoId: VIDEO_A },
        { videoId: VIDEO_B, caption: `  ${'a'.repeat(2049)}  ` },
      ]),
    );

    expect(created.status).toBe(400);
    expect(envelopeError(created.json)).toMatchObject({
      code: 'invalid_request',
      message: 'selectedCreatives[1].caption must be at most 2048 characters.',
    });
  });

  it.each([
    [{ useEmbeddedVideoAudio: 'false' }, 'useEmbeddedVideoAudio must be a boolean.'],
    [{ useEmbeddedVideoAudio: null }, 'useEmbeddedVideoAudio must be a boolean.'],
    [{ caption: 123 }, 'caption must be a string.'],
    [{ caption: null }, 'caption must be a string.'],
  ])('rejects invalid creative field %o with invalid_request', (fields, message) => {
    const created = create(
      `fc-invalid-${JSON.stringify(fields)}`,
      fullControlBody([{ videoId: VIDEO_A, ...fields }]),
    );

    expect(created.status).toBe(400);
    expect(envelopeError(created.json)).toMatchObject({
      code: 'invalid_request',
      message: `selectedCreatives[0].${message}`,
    });
  });

  it('stores useEmbeddedVideoAudio false without rejecting the request', () => {
    const created = create(
      'fc-audio-false',
      fullControlBody([{ videoId: VIDEO_A, useEmbeddedVideoAudio: false }]),
    );

    expect(created.status).toBe(201);
  });

  it('rejects an empty selectedCreatives list', () => {
    const created = create('fc-empty', fullControlBody([]));

    expect(created.status).toBe(400);
    expect(envelopeError(created.json).code).toBe('invalid_request');
  });

  it('rejects more than 50 selectedCreatives', () => {
    const many = Array.from({ length: 51 }, () => ({ videoId: VIDEO_A }));

    const created = create('fc-too-many', fullControlBody(many));

    expect(created.status).toBe(400);
    expect(envelopeError(created.json).code).toBe('invalid_request');
  });

  it('replays the stored response for the same Idempotency-Key and body', () => {
    const body = fullControlBody([{ videoId: VIDEO_A, caption: 'x' }]);
    const first = create('fc-replay', body);
    const second = create('fc-replay', body);

    expect(second.status).toBe(201);
    expect(asCampaignCreate(envelopeData(second.json)).campaignId).toBe(
      asCampaignCreate(envelopeData(first.json)).campaignId,
    );
  });

  it('keeps the placeholder creative for campaigns without full_control', () => {
    const created = create('fc-placeholder', DEFAULT_CREATE_BODY);
    const campaignId = asCampaignCreate(envelopeData(created.json)).campaignId;

    const data = creativesOf(campaignId);

    expect(data.creatives).toHaveLength(1);
    expect(data.creatives[0]?.video_id).toBe('emu_partner_upload_video');
  });
});
