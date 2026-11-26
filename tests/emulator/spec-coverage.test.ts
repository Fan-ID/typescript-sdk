import { describe, expect, it } from 'vitest';
import { createApiEmulator } from '../../src/emulator/index.js';
import {
  operationKey,
  readOpenApiOperations,
  type OpenApiOperation,
} from '../helpers/openapi-operations.js';
import { authHeaders, EMULATOR_API_KEY } from './helpers.js';

/**
 * Public API operations the emulator does not handle yet.
 *
 * Add an operation here only on purpose. When the emulator gains a route, the
 * test below fails until its line is removed, so this list only ever shrinks.
 */
const NOT_EMULATED: readonly string[] = [
  // Wallet ledger
  'GET /v1/wallet/transactions',
  // Campaign tiers and activity
  'GET /v1/campaigns/{campaignId}/tiers',
  'PATCH /v1/campaigns/{campaignId}/tiers',
  'GET /v1/campaigns/{campaignId}/activity',
  'POST /v1/campaigns/activity/batch',
  // Campaign metrics beyond overview and creatives, and JSONL exports
  'GET /v1/campaigns/{campaignId}/metrics/creative-daily',
  'GET /v1/campaigns/{campaignId}/metrics/breakdown',
  'GET /v1/campaigns/{campaignId}/metrics/breakdown/export',
  'GET /v1/campaigns/{campaignId}/metrics/engagement',
  'GET /v1/campaigns/{campaignId}/metrics/engagement/export',
  'GET /v1/campaigns/{campaignId}/metrics/retention',
  'GET /v1/campaigns/{campaignId}/metrics/retention-weekly',
  'GET /v1/campaigns/{campaignId}/listening-insights/{insight}',
  // Soundlinks
  'GET /v1/soundlinks',
  'POST /v1/soundlinks',
  'GET /v1/soundlinks/{soundlinkId}',
  'DELETE /v1/soundlinks/{soundlinkId}',
  'POST /v1/soundlinks/{soundlinkId}/test-events',
  'GET /v1/soundlinks/{soundlinkId}/metrics/overview',
  'GET /v1/soundlinks/{soundlinkId}/metrics/breakdown',
  'GET /v1/soundlinks/{soundlinkId}/metrics/breakdown/export',
  'GET /v1/soundlinks/{soundlinkId}/metrics/engagement',
  'GET /v1/soundlinks/{soundlinkId}/metrics/engagement/export',
  'GET /v1/soundlinks/{soundlinkId}/metrics/retention',
  'GET /v1/soundlinks/{soundlinkId}/metrics/retention-weekly',
  'GET /v1/soundlinks/{soundlinkId}/listening-insights/{insight}',
  'POST /v1/soundlinks/metrics/breakdown/export/batch',
  'POST /v1/soundlinks/metrics/retention/export/batch',
];

/** True unless the router fell through to its generic `Not found.` response. */
function isEmulated(operation: OpenApiOperation): boolean {
  const emu = createApiEmulator({ apiKey: EMULATOR_API_KEY });
  const response = emu.dispatch({
    method: operation.method,
    path: operation.path.replaceAll(/\{[^}]+\}/g, 'probe-id'),
    headers: authHeaders('coverage-probe'),
    body: {},
  });
  const error = (response.json as { error?: { message?: string } } | null)?.error;
  return !(response.status === 404 && error?.message === 'Not found.');
}

describe('emulator coverage of the Public API spec', () => {
  const operations = readOpenApiOperations();

  it('reads the operations from the spec', () => {
    expect(operations.length).toBeGreaterThan(40);
  });

  it('emulates every operation that is not on the known-gaps list', () => {
    const missing = operations
      .filter((operation) => !isEmulated(operation))
      .map(operationKey)
      .filter((key) => !NOT_EMULATED.includes(key));

    expect(missing).toEqual([]);
  });

  it('keeps the known-gaps list free of operations the emulator now handles', () => {
    const stale = operations
      .filter((operation) => NOT_EMULATED.includes(operationKey(operation)))
      .filter((operation) => isEmulated(operation))
      .map(operationKey);

    expect(stale).toEqual([]);
  });

  it('only lists operations that exist in the spec', () => {
    const known = new Set(operations.map(operationKey));

    expect(NOT_EMULATED.filter((key) => !known.has(key))).toEqual([]);
  });
});
