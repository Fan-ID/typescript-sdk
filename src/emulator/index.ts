import type { WalletData } from '../types/api.js';
import { dispatch, type EmulatorRequest, type EmulatorResponse } from './dispatch.js';
import {
  resolveEmulatorPlan,
  type EmulatorPlan,
  type ResolvedEmulatorPlan,
} from './plans.js';
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
export type { EmulatorPlan, ResolvedEmulatorPlan } from './plans.js';
export { EMULATOR_PLAN_PRESETS } from './plans.js';
export type { EmulatorServer, ListenOptions } from './server.js';
export { LOOPBACK_HOST } from './server.js';
export type { EmulatorTransitionAction } from './store.js';

export interface CreateEmulatorOptions {
  /** Bearer token accepted by `/v1` (must start with `sk_`). Default: `sk_emulator_test`. */
  apiKey?: string;
  /** Starting wallet balance in USD. Default: `1000`. */
  initialWalletBalance?: number;
  /**
   * Organization plan preset. Sets default `feeRate`, premium flag, and
   * self-serve `maxNewListeners` when applicable.
   */
  plan?: EmulatorPlan;
  /**
   * Overrides plan fee (and default `0` when no plan). Refund / overview fees
   * use this rate via `computeRefundGrossFromRawSpend`.
   */
  feeRate?: number;
  /** Organization id returned on campaign detail. Default: `org_emulator`. */
  organizationId?: string;
}

export interface SoundlinkEmulator {
  /** In-process request handler (no TCP). */
  dispatch(request: EmulatorRequest): EmulatorResponse;
  /**
   * Bind HTTP on `127.0.0.1` only. Pass `baseUrl` to the SDK (SDK prepends `/v1`).
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
  /** Wallet snapshot (`reserved` is always `0` after settle). */
  getWallet(): WalletData;
  /**
   * Resolved plan / fee / self-serve allowance for this emulator instance.
   * `premium` is metadata for partners (`PLAN_LEVEL >= 3`); it does not
   * change `/v1` response shapes yet.
   */
  getPlan(): ResolvedEmulatorPlan & {
    usedNewListeners: number;
    remainingNewListeners: number | null;
  };
}

export function createEmulator(options: CreateEmulatorOptions = {}): SoundlinkEmulator {
  const apiKey = options.apiKey ?? 'sk_emulator_test';
  if (!apiKey.startsWith('sk_')) {
    throw new Error('apiKey must start with "sk_".');
  }

  const resolved = resolveEmulatorPlan({
    plan: options.plan,
    feeRate: options.feeRate,
  });

  const store: EmulatorStore = createEmulatorStore({
    apiKey,
    initialWalletBalance: options.initialWalletBalance ?? 1000,
    feeRate: resolved.feeRate,
    organizationId: options.organizationId,
    premium: resolved.premium,
    maxNewListeners: resolved.maxNewListeners,
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
    getPlan() {
      return {
        ...resolved,
        usedNewListeners: store.usedNewListeners,
        remainingNewListeners: store.remainingNewListeners(),
      };
    },
  };
}
