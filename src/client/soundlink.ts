import { HttpClient } from './http-client.js';
import {
  CampaignsResource,
  MetricsResource,
  PingResource,
} from '../resources/index.js';
import type { SoundlinkOptions } from '../types/api.js';

export class Soundlink {
  readonly ping: PingResource['ping'];
  readonly campaigns: CampaignsResource;
  readonly metrics: MetricsResource;

  constructor(options: SoundlinkOptions) {
    const http = new HttpClient(options);
    const pingResource = new PingResource(http);

    this.ping = pingResource.ping.bind(pingResource);
    this.campaigns = new CampaignsResource(http);
    this.metrics = new MetricsResource(http);
  }
}

export { HttpClient, resolveClientOptions } from './http-client.js';
