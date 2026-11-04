import { createServer, type IncomingMessage, type Server } from 'node:http';
import { dispatch } from './dispatch.js';
import type { EmulatorStore } from './store.js';

export const LOOPBACK_HOST = '127.0.0.1';

export interface ListenOptions {
  /** TCP port. `0` (default) binds an ephemeral port. */
  port?: number;
  /**
   * Bind address. Must be `127.0.0.1` — any other value is rejected
   * so harness admin routes are never exposed on a public interface.
   */
  host?: string;
}

export interface EmulatorServer {
  host: string;
  port: number;
  /** `http://127.0.0.1:<port>` — pass as SDK `baseUrl` (SDK adds `/v1`). */
  baseUrl: string;
  close(): Promise<void>;
}

function normalizeHeaders(headers: IncomingMessage['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    out[key] = Array.isArray(value) ? (value[0] ?? '') : value;
  }
  return out;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
    } else if (chunk instanceof Uint8Array) {
      chunks.push(Buffer.from(chunk));
    }
  }
  if (chunks.length === 0) {
    return undefined;
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (raw.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { __parseError: true, raw };
  }
}

export function listen(
  store: EmulatorStore,
  options: ListenOptions = {},
): Promise<EmulatorServer> {
  const host = options.host ?? LOOPBACK_HOST;
  if (host !== LOOPBACK_HOST) {
    return Promise.reject(
      new Error(`Emulator listen only allows host ${LOOPBACK_HOST} (got "${host}").`),
    );
  }

  const port = options.port ?? 0;

  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      void (async () => {
        const method = req.method ?? 'GET';
        const path = req.url ?? '/';
        const headers = normalizeHeaders(req.headers);
        const body = await readBody(req);

        if (
          body &&
          typeof body === 'object' &&
          (body as { __parseError?: boolean }).__parseError
        ) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: {
                code: 'invalid_request',
                message: 'Request body must be valid JSON.',
              },
              meta: { requestId: 'emulator-invalid-json' },
            }),
          );
          return;
        }

        const response = dispatch(store, { method, path, headers, body });
        res.writeHead(response.status, {
          'Content-Type': 'application/json',
        });
        res.end(JSON.stringify(response.json));
      })().catch(() => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              code: 'internal_error',
              message: 'Emulator request handler failed.',
            },
            meta: { requestId: 'emulator-internal' },
          }),
        );
      });
    });

    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to bind emulator server.'));
        return;
      }

      resolve({
        host,
        port: address.port,
        baseUrl: `http://${host}:${String(address.port)}`,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) => {
              if (error) {
                closeReject(error);
                return;
              }
              closeResolve();
            });
          }),
      });
    });
  });
}
