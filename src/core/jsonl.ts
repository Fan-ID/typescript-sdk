import { SoundlinkParseError } from '../errors/sdk-error.js';

export async function* parseNdjsonStream<T>(
  body: ReadableStream<Uint8Array> | null,
  onMalformedLine?: (line: string, error: unknown) => void,
): AsyncGenerator<T> {
  if (!body) {
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        try {
          yield JSON.parse(trimmed) as T;
        } catch (error) {
          onMalformedLine?.(trimmed, error);
          throw new SoundlinkParseError('Failed to parse JSONL export line.');
        }
      }
    }

    const trailing = buffer.trim();
    if (trailing) {
      try {
        yield JSON.parse(trailing) as T;
      } catch (error) {
        onMalformedLine?.(trailing, error);
        throw new SoundlinkParseError('Failed to parse JSONL export line.');
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function collectNdjsonStream<T>(
  stream: AsyncIterable<T>,
): Promise<{ rows: T[]; rowCount: number }> {
  const rows: T[] = [];
  for await (const row of stream) {
    rows.push(row);
  }
  return {
    rows,
    rowCount: rows.length,
  };
}

export function parseNdjsonText<T>(text: string): T[] {
  const rows: T[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    rows.push(JSON.parse(trimmed) as T);
  }

  return rows;
}
