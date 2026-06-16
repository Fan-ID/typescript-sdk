/**
 * Live smoke test against the Soundlink Public API.
 *
 * Usage (pick one):
 *   SOUNDLINK_API_KEY=sk_prefix_secret npm run test:live
 *   npm run test:live -- sk_prefix_secret
 *
 * Or create a .env file (gitignored):
 *   SOUNDLINK_API_KEY=sk_prefix_secret
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Soundlink } from '../src/index.js';

const DEFAULT_BASE_URL = 'https://api.getsoundlink.com';

function loadDotEnv(): void {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) {
    return;
  }

  const contents = readFileSync(envPath, 'utf8');
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separator = trimmed.indexOf('=');
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function resolveApiKey(): string {
  loadDotEnv();

  const cliKey = process.argv[2];
  const envKey = process.env.SOUNDLINK_API_KEY;

  const apiKey = (cliKey ?? envKey ?? '').trim();
  if (!apiKey) {
    console.error(`
Missing API key.

Option A — inline:
  SOUNDLINK_API_KEY=sk_your_prefix_your_secret npm run test:live

Option B — argument:
  npm run test:live -- sk_your_prefix_your_secret

Option C — .env file in repo root:
  SOUNDLINK_API_KEY=sk_your_prefix_your_secret
`);
    process.exit(1);
  }

  if (!apiKey.startsWith('sk_')) {
    console.error('Invalid key format. Expected sk_<prefix>_<secret>.');
    process.exit(1);
  }

  return apiKey;
}

function printStep(label: string): void {
  console.log(`\n→ ${label}`);
}

function printOk(message: string, meta?: { requestId?: string }): void {
  console.log(`  ✓ ${message}`);
  if (meta?.requestId) {
    console.log(`    requestId: ${meta.requestId}`);
  }
}

function printError(
  label: string,
  error: { code: string; message: string; requestId?: string },
): void {
  console.log(`  ✗ ${label}`);
  console.log(`    code: ${error.code}`);
  console.log(`    message: ${error.message}`);
  if (error.requestId) {
    console.log(`    requestId: ${error.requestId}`);
  }
}

async function main(): Promise<void> {
  const apiKey = resolveApiKey();
  const baseUrl = process.env.SOUNDLINK_BASE_URL ?? DEFAULT_BASE_URL;

  console.log('Soundlink SDK — live smoke test');
  console.log(`Base URL: ${baseUrl}`);
  console.log(`API key:  ${apiKey.slice(0, 12)}…`);

  const soundlink = new Soundlink({ apiKey, baseUrl });
  let failed = false;

  printStep('GET /v1/ping');
  const ping = await soundlink.ping();
  if (ping.error || !ping.data) {
    printError(
      'Ping failed',
      ping.error ?? { code: 'unknown', message: 'No data returned.' },
    );
    process.exit(1);
  }
  printOk(`status: ${ping.data.status}`, ping.meta);

  printStep('GET /v1/campaigns?page=1&pageSize=5');
  const campaigns = await soundlink.campaigns.list({ page: 1, pageSize: 5 });
  if (campaigns.error || !campaigns.data) {
    printError(
      'List campaigns failed',
      campaigns.error ?? { code: 'unknown', message: 'No data.' },
    );
    failed = true;
  } else {
    printOk(
      `${String(campaigns.data.items.length)} item(s) on page 1 · total ${String(campaigns.data.pagination.totalCount)}`,
      campaigns.meta,
    );

    const first = campaigns.data.items[0];
    if (first) {
      printStep(`GET /v1/campaigns/${first.campaignId}`);
      const detail = await soundlink.campaigns.get(first.campaignId);
      if (detail.error || !detail.data) {
        printError(
          'Get campaign failed',
          detail.error ?? { code: 'unknown', message: 'No data.' },
        );
        failed = true;
      } else {
        printOk(
          `campaign ${detail.data.campaignId} · status ${detail.data.status}`,
          detail.meta,
        );
      }

      printStep(`GET /v1/campaigns/${first.campaignId}/metrics/overview`);
      const overview = await soundlink.metrics.overview(first.campaignId);
      if (overview.error || !overview.data) {
        printError(
          'Metrics overview failed (key may lack metrics:read scope)',
          overview.error ?? { code: 'unknown', message: 'No data.' },
        );
      } else {
        printOk(
          `listeners ${String(overview.data.listeners)} · streams ${String(overview.data.streams)} · spend $${String(overview.data.spend_total)}`,
          overview.meta,
        );
      }
    } else {
      console.log('  · No campaigns returned — skipping detail/metrics checks.');
    }
  }

  console.log('\n---');
  if (failed) {
    console.log('Smoke test finished with errors.');
    process.exit(1);
  }

  console.log('Smoke test passed.');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nUnexpected SDK error: ${message}`);
  process.exit(1);
});
