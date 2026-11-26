import { computeRefundGrossFromRawSpend } from './money.js';
import {
  emptyOverview,
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

/** Metrics the `set_metrics` action can set. `mediaSpendUsd` is passed separately. */
export interface SetMetricsInput {
  listeners?: number;
  streams?: number;
  cycleDay?: number;
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
  reason?: string,
  metrics?: SetMetricsInput,
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
      campaign.status = 'active';
      seedOverview(campaign);
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
    case 'set_metrics': {
      if (
        campaign.status !== 'creating' &&
        campaign.status !== 'active' &&
        campaign.status !== 'inactive'
      ) {
        throw new TransitionError(
          400,
          'invalid_request',
          `Cannot set_metrics campaign in status "${campaign.status}".`,
        );
      }
      if (campaign.refundedAt) {
        throw new TransitionError(
          400,
          'invalid_request',
          'Cannot set_metrics after refund.',
        );
      }
      const listeners = metrics?.listeners;
      const streams = metrics?.streams;
      const cycleDay = metrics?.cycleDay;
      if (
        mediaSpendUsd === undefined &&
        listeners === undefined &&
        streams === undefined &&
        cycleDay === undefined
      ) {
        throw new TransitionError(
          400,
          'invalid_request',
          'set_metrics needs at least one of mediaSpendUsd, listeners, streams, cycleDay.',
        );
      }
      if (
        mediaSpendUsd !== undefined &&
        (!Number.isFinite(mediaSpendUsd) ||
          mediaSpendUsd < 0 ||
          mediaSpendUsd > campaign.committedUsd)
      ) {
        throw new TransitionError(
          400,
          'invalid_request',
          `mediaSpendUsd must be between 0 and ${String(campaign.committedUsd)}.`,
        );
      }
      for (const [name, value] of [
        ['listeners', listeners],
        ['streams', streams],
      ] as const) {
        if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
          throw new TransitionError(
            400,
            'invalid_request',
            `${name} must be a non-negative integer.`,
          );
        }
      }
      if (
        cycleDay !== undefined &&
        (!Number.isInteger(cycleDay) ||
          cycleDay < 1 ||
          cycleDay > campaign.durationDays)
      ) {
        throw new TransitionError(
          400,
          'invalid_request',
          `cycleDay must be an integer between 1 and ${String(campaign.durationDays)}.`,
        );
      }

      if (mediaSpendUsd !== undefined) {
        campaign.mediaSpendUsd = Number(mediaSpendUsd.toFixed(2));
      }
      if (cycleDay !== undefined) {
        campaign.cycleDay = cycleDay;
      }
      if (listeners !== undefined || streams !== undefined) {
        const overview = campaign.overview ?? emptyOverview();
        if (listeners !== undefined) {
          overview.listeners = listeners;
          overview.total_listeners = Math.max(overview.total_listeners, listeners);
        }
        if (streams !== undefined) {
          overview.streams = streams;
        }
        overview.streams_per_listener =
          overview.total_listeners > 0
            ? Number((overview.streams / overview.total_listeners).toFixed(4))
            : 0;
        campaign.overview = overview;
      }
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
    case 'disapprove_creatives': {
      campaign.partnerUploadDisapproved = true;
      if (reason !== undefined) {
        campaign.partnerUploadDisapprovalReason = reason.trim() || null;
      }
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
