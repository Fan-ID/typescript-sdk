import type { WalletData } from '../types/api.js';
import { dispatch, type EmulatorRequest, type EmulatorResponse } from './dispatch.js';
import {
  listen as startListen,
  type EmulatorServer,
  type ListenOptions,
} from './server.js';
import {
  createEmulatorStore,
  type EmulatorStore,
  type EmulatorTransitionAction,
} from './store.js';
import { applyTransition, type TransitionResult } from './transitions.js';

export type { EmulatorRequest, EmulatorResponse } from './dispatch.js';
export type { EmulatorServer, ListenOptions } from './server.js';
export { LOOPBACK_HOST } from './server.js';
export type { EmulatorTransitionAction } from './store.js';

export interface CreateEmulatorOptions {
  /** Bearer token accepted by `/v1` (must start with `sk_`). Default: `sk_emulator_test`. */
  apiKey?: string;
  /** Starting wallet balance in USD. Default: `1000`. */
  initialWalletBalance?: number;
  /**
   * Service fee rate used by refund math (`computeRefundGrossFromRawSpend`).
   * Default `0` (emulator v1).
   */
  feeRate?: number;
  /** Organization id returned on campaign detail. Default: `org_emulator`. */
  organizationId?: string;
}

export interface SoundlinkEmulator {
  /** In-process request handler (no TCP). Prefer this in unit tests. */
  dispatch(request: EmulatorRequest): EmulatorResponse;
  /**
   * Bind HTTP on loopback only (`127.0.0.1`). Rejects any other `host`.
   * Use `baseUrl` as the SDK `baseUrl` (SDK prepends `/v1`).
   */
  listen(options?: ListenOptions): Promise<EmulatorServer>;
  /** Clears wallet/campaigns/idempotency and restores `initialWalletBalance`. */
  reset(): void;
  /** Sets wallet balance without deleting campaigns (402 retry path). */
  setWallet(balance: number): WalletData;
  /** Same logic as `POST /__emulator/campaigns/{id}/transition`. */
  transition(
    campaignId: string,
    action: EmulatorTransitionAction,
    mediaSpendUsd?: number,
  ): TransitionResult;
  /** Current wallet snapshot (post-settle: `reserved === 0`). */
  getWallet(): WalletData;
}

export function createEmulator(options: CreateEmulatorOptions = {}): SoundlinkEmulator {
  const apiKey = options.apiKey ?? 'sk_emulator_test';
  if (!apiKey.startsWith('sk_')) {
    throw new Error('apiKey must start with "sk_".');
  }

  const store: EmulatorStore = createEmulatorStore({
    apiKey,
    initialWalletBalance: options.initialWalletBalance ?? 1000,
    feeRate: options.feeRate ?? 0,
    organizationId: options.organizationId,
  });

  return {
    dispatch(request) {
      return dispatch(store, request);
    },
    listen(listenOptions) {
      return startListen(store, listenOptions);
    },
    reset() {
      store.reset();
    },
    setWallet(balance) {
      return store.setWalletBalance(balance);
    },
    transition(campaignId, action, mediaSpendUsd) {
      return applyTransition(store, campaignId, action, mediaSpendUsd);
    },
    getWallet() {
      return store.getWallet();
    },
  };
}
