/** Matches fan-id-backend credit.service debit rounding. */
export function computeCommittedUsd(dailyBudget: number, durationDays: number): number {
  return Math.round(dailyBudget * durationDays * 100) / 100;
}

/**
 * Matches `CampaignBudgetService.computeRefundGrossFromRawSpend`
 * (feeRate default 0 in the emulator).
 */
export function computeRefundGrossFromRawSpend(
  mediaSpendUsd: number,
  committedUsd: number,
  feeRate: number,
): number {
  const rate = Math.max(0, Math.min(feeRate, 0.9999));
  const grossEquivSpend = rate > 0 ? mediaSpendUsd / (1 - rate) : mediaSpendUsd;
  return Math.max(0, Number((committedUsd - grossEquivSpend).toFixed(2)));
}
