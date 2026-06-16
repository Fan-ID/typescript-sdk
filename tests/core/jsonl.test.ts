import { describe, expect, it } from 'vitest';
import { SoundlinkParseError } from '../../src/errors/sdk-error.js';
import { parseNdjsonStream, parseNdjsonText } from '../../src/core/jsonl.js';
import { parseRetryAfterHeader } from '../../src/core/api-response.js';

describe('jsonl parser', () => {
  it('throws on malformed jsonl lines', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"ok":true}\n{broken\n'));
        controller.close();
      },
    });

    const generator = parseNdjsonStream<{ ok: boolean }>(stream);
    await expect(generator.next()).resolves.toEqual({
      done: false,
      value: { ok: true },
    });
    await expect(generator.next()).rejects.toBeInstanceOf(SoundlinkParseError);
  });

  it('parses trailing line without newline', () => {
    const rows = parseNdjsonText<{ ok: boolean }>('{"ok":true}');
    expect(rows).toEqual([{ ok: true }]);
  });

  it('parses retry-after date headers', () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    expect(parseRetryAfterHeader(future)).toBeGreaterThan(0);
    expect(parseRetryAfterHeader('not-a-date')).toBeUndefined();
  });
});
