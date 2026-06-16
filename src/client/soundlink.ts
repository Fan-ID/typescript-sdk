import { HttpClient } from './http-client.js';
import {
  CampaignsResource,
  MetricsResource,
  PingResource,
} from '../resources/index.js';
import type { SoundlinkOptions } from '../types/api.js';

/**
 * Official Soundlink Public API client.
 *
 * All methods return `{ data, error, meta? }` and never throw on HTTP/API errors.
 * SDK configuration, parsing, and transport failures throw {@link SoundlinkSdkError}.
 *
 * @example
 * ```ts
 * import { Soundlink } from 'soundlink';
 *
 * const soundlink = new Soundlink(process.env.SOUNDLINK_API_KEY!);
 *
 * const { data, error } = await soundlink.ping();
 * if (error) {
 *   console.error(error.code, error.message);
 * } else {
 *   console.log(data.status);
 * }
 * ```
 *
 * @see https://docs.getsoundlink.com
 */
export class Soundlink {
  /** Verify connectivity and authentication. Maps to `GET /v1/ping`. */
  readonly ping: PingResource['ping'];

  /** List and fetch campaigns. Requires `campaigns:read` scope. */
  readonly campaigns: CampaignsResource;

  /** Campaign metrics, breakdowns, and JSONL exports. Requires `metrics:read` scope. */
  readonly metrics: MetricsResource;

  /**
   * Create a Soundlink client.
   *
   * @param options - API key string (`sk_*`) or {@link SoundlinkClientOptions}.
   */
  constructor(options: SoundlinkOptions) {
    const http = new HttpClient(options);
    const pingResource = new PingResource(http);

    this.ping = pingResource.ping.bind(pingResource);
    this.campaigns = new CampaignsResource(http);
    this.metrics = new MetricsResource(http);
  }
}

export { HttpClient, resolveClientOptions } from './http-client.js';
