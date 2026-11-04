/** Committed wallet debit: dailyBudget × durationDays, cents-rounded. */
export function computeCommittedUsd(dailyBudget: number, durationDays: number): number {
  return Math.round(dailyBudget * durationDays * 100) / 100;
}

/**
 * Unspent gross refund after media spend, given feeRate
 * (default 0 in the emulator when no plan / fee is set).
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
