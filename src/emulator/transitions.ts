import { computeRefundGrossFromRawSpend } from './money.js';
import {
  seedOverview,
  type EmulatorCampaignRecord,
  type EmulatorStore,
  type EmulatorTransitionAction,
} from './store.js';

export class TransitionError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'TransitionError';
    this.status = status;
    this.code = code;
  }
}

export interface TransitionResult {
  campaignId: string;
  status: EmulatorCampaignRecord['status'];
  mediaSpendUsd: number;
  refundedAt: string | null;
}

function applyRefundIfNeeded(
  store: EmulatorStore,
  campaign: EmulatorCampaignRecord,
): void {
  if (campaign.refundedAt) {
    return;
  }
  const refund = computeRefundGrossFromRawSpend(
    campaign.mediaSpendUsd,
    campaign.committedUsd,
    store.feeRate,
  );
  store.creditWallet(refund);
  campaign.refundedAt = new Date().toISOString();
}

export function applyTransition(
  store: EmulatorStore,
  campaignId: string,
  action: EmulatorTransitionAction,
  mediaSpendUsd?: number,
): TransitionResult {
  const campaign = store.getCampaign(campaignId);
  if (!campaign) {
    throw new TransitionError(404, 'campaign_not_found', 'Campaign not found.');
  }

  switch (action) {
    case 'activate': {
      if (campaign.status !== 'creating') {
        throw new TransitionError(
          400,
          'invalid_request',
          `Cannot activate campaign in status "${campaign.status}".`,
        );
      }
      if (store.maxNewListeners !== null && store.remainingNewListeners() === 0) {
        throw new TransitionError(
          400,
          'invalid_request',
          `Self-serve listener limit reached (${String(store.maxNewListeners)}).`,
        );
      }
      campaign.status = 'active';
      seedOverview(store, campaign);
      store.updateCampaign(campaign);
      break;
    }
    case 'reject_meta': {
      if (campaign.status !== 'creating' && campaign.status !== 'active') {
        throw new TransitionError(
          400,
          'invalid_request',
          `Cannot reject_meta campaign in status "${campaign.status}".`,
        );
      }
      campaign.status = 'inactive';
      store.updateCampaign(campaign);
      break;
    }
    case 'set_spend': {
      if (
        campaign.status !== 'creating' &&
        campaign.status !== 'active' &&
        campaign.status !== 'inactive'
      ) {
        throw new TransitionError(
          400,
          'invalid_request',
          `Cannot set_spend campaign in status "${campaign.status}".`,
        );
      }
      if (campaign.refundedAt) {
        throw new TransitionError(
          400,
          'invalid_request',
          'Cannot set_spend after refund.',
        );
      }
      if (
        typeof mediaSpendUsd !== 'number' ||
        !Number.isFinite(mediaSpendUsd) ||
        mediaSpendUsd < 0 ||
        mediaSpendUsd > campaign.committedUsd
      ) {
        throw new TransitionError(
          400,
          'invalid_request',
          `mediaSpendUsd must be between 0 and ${String(campaign.committedUsd)}.`,
        );
      }
      campaign.mediaSpendUsd = Number(mediaSpendUsd.toFixed(2));
      store.updateCampaign(campaign);
      break;
    }
    case 'end': {
      if (campaign.status !== 'active' && campaign.status !== 'inactive') {
        throw new TransitionError(
          400,
          'invalid_request',
          `Cannot end campaign in status "${campaign.status}".`,
        );
      }
      campaign.status = 'ended';
      applyRefundIfNeeded(store, campaign);
      store.updateCampaign(campaign);
      break;
    }
    default: {
      const _exhaustive: never = action;
      throw new TransitionError(
        400,
        'invalid_request',
        `Unknown action "${String(_exhaustive)}".`,
      );
    }
  }

  return {
    campaignId: campaign.campaignId,
    status: campaign.status,
    mediaSpendUsd: campaign.mediaSpendUsd,
    refundedAt: campaign.refundedAt,
  };
}

export function applyPublicStop(
  store: EmulatorStore,
  campaign: EmulatorCampaignRecord,
): { status: EmulatorCampaignRecord['status']; releasedKey: boolean } {
  if (campaign.status === 'creating' || campaign.status === 'renewing') {
    return { status: campaign.status, releasedKey: true };
  }

  if (campaign.status === 'stopped' || campaign.status === 'ended') {
    return { status: campaign.status, releasedKey: false };
  }

  if (campaign.status !== 'active' && campaign.status !== 'inactive') {
    return { status: campaign.status, releasedKey: true };
  }

  campaign.status = 'stopped';
  applyRefundIfNeeded(store, campaign);
  store.updateCampaign(campaign);
  return { status: 'stopped', releasedKey: false };
}
