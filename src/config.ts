import type { SoundlinkConfig } from "./types";
import { readEnv, readEnvBoolean } from "./env";

export interface ResolvedSoundlinkConfig {
  apiKey: string;
  organizationId: string;
  baseUrl: string;
  timeoutMs: number;
  debug: boolean;
  fetchImpl: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export function resolveSoundlinkConfig(
  partial?: SoundlinkConfig,
): ResolvedSoundlinkConfig {
  const apiKey =
    partial?.apiKey ?? readEnv("SOUNDLINK_TOKEN") ?? "";
  const organizationId =
    partial?.organizationId ?? readEnv("SOUNDLINK_ORGANIZATION_ID") ?? "";
  const baseUrl = (
    partial?.baseUrl ??
    readEnv("SOUNDLINK_BASE_URL") ??
    ""
  ).replace(/\/+$/, "");
  const timeoutMs = partial?.timeout ?? DEFAULT_TIMEOUT_MS;
  const debug =
    partial?.debug ?? readEnvBoolean("SOUNDLINK_DEBUG");

  return {
    apiKey,
    organizationId,
    baseUrl,
    timeoutMs,
    debug,
    fetchImpl: globalThis.fetch.bind(globalThis) as typeof fetch,
  };
}

export function assertConfigReady(config: ResolvedSoundlinkConfig): void {
  if (!config.apiKey) {
    throw new Error(
      "Soundlink: missing API token. Set SOUNDLINK_TOKEN or pass apiKey to createClient().",
    );
  }
  if (!config.organizationId) {
    throw new Error(
      "Soundlink: missing organization. Set SOUNDLINK_ORGANIZATION_ID or pass organizationId to createClient().",
    );
  }
  if (!config.baseUrl) {
    throw new Error(
      "Soundlink: missing API base URL. Set SOUNDLINK_BASE_URL or pass baseUrl to createClient().",
    );
  }
}
