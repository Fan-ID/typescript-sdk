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
  const grossEquivSpend = computeGrossEquivSpend(mediaSpendUsd, feeRate);
  return Math.max(0, Number((committedUsd - grossEquivSpend).toFixed(2)));
}

/** Gross budget that media spend uses up, including the fee. */
export function computeGrossEquivSpend(mediaSpendUsd: number, feeRate: number): number {
  const rate = Math.max(0, Math.min(feeRate, 0.9999));
  return rate > 0 ? mediaSpendUsd / (1 - rate) : mediaSpendUsd;
}

/** Rounds a USD amount to cents. */
export function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}
