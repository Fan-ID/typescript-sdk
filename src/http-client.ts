import { assertConfigReady, type ResolvedSoundlinkConfig } from "./config";
import {
  AuthenticationError,
  NetworkError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  ServerError,
  SoundlinkError,
  ValidationError,
} from "./errors";
import { err, ok } from "./result";
import type { Result } from "./types";

export interface RequestOptions {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
}

function buildUrl(
  baseUrl: string,
  path: string,
  query?: RequestOptions["query"],
): string {
  const url = new URL(
    path.startsWith("http")
      ? path
      : `${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`,
  );
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

function parseErrorMessage(payload: unknown): string {
  if (payload === null || payload === undefined) {
    return "Request failed";
  }
  if (typeof payload === "string") {
    return payload;
  }
  if (typeof payload === "object") {
    const o = payload as Record<string, unknown>;
    if (typeof o.message === "string" && o.message) {
      return o.message;
    }
    if (typeof o.error === "string" && o.error) {
      return o.error;
    }
    if (Array.isArray(o.errors) && o.errors.length) {
      return o.errors.map(String).join("; ");
    }
  }
  return "Request failed";
}

function toSoundlinkError(
  status: number,
  message: string,
  retryAfterSec?: number,
): SoundlinkError {
  if (status === 401) {
    return new AuthenticationError(message);
  }
  if (status === 403) {
    return new PermissionError(message);
  }
  if (status === 404) {
    return new NotFoundError(message);
  }
  if (status === 429) {
    return new RateLimitError(retryAfterSec ?? 60);
  }
  if (status >= 400 && status < 500) {
    return new ValidationError(message);
  }
  return new ServerError(message);
}

export class SoundlinkHttpClient {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly config: ResolvedSoundlinkConfig,
    fetchOverride?: typeof fetch,
  ) {
    this.fetchImpl = fetchOverride ?? config.fetchImpl;
  }

  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.debug("[soundlink]", ...args);
    }
  }

  async requestJson<T>(options: RequestOptions): Promise<Result<T>> {
    assertConfigReady(this.config);
    const url = buildUrl(this.config.baseUrl, options.path, options.query);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
      "x-organization-id": this.config.organizationId,
    };

    this.log(options.method, url);

    try {
      const res = await this.fetchImpl(url, {
        method: options.method,
        headers,
        body:
          options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      const retryAfterHeader = res.headers.get("retry-after");
      const retryAfterSec = retryAfterHeader
        ? parseInt(retryAfterHeader, 10)
        : undefined;

      const text = await res.text();
      let json: unknown;
      if (text) {
        try {
          json = JSON.parse(text) as unknown;
        } catch {
          json = { message: text };
        }
      }

      this.log("<-", res.status, res.statusText);

      if (!res.ok) {
        const message = parseErrorMessage(json);
        return err(toSoundlinkError(res.status, message, retryAfterSec));
      }

      return ok(json as T);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        return err(
          new NetworkError(
            new Error(`Request timed out after ${this.config.timeoutMs}ms`),
          ),
        );
      }
      if (e instanceof SoundlinkError) {
        return err(e);
      }
      return err(
        new NetworkError(e instanceof Error ? e : new Error(String(e))),
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
