/**
 * Emulator plan presets. Fees mirror typical `AD_PROCESSING_FEE` plan_limits
 * (percent → rate): free/pro ~20%, label ~15%, enterprise ~10%.
 * Self-serve adds a listener allowance used to cap overview attribution.
 */
export type EmulatorPlan =
  | 'free'
  | 'artist_pro'
  | 'label_power'
  | 'enterprise'
  | 'self_serve_5000'
  | 'self_serve_25000';

export interface EmulatorPlanPreset {
  feeRate: number;
  /** When false, premium-only Public API routes would return 403 (future endpoints). */
  premium: boolean;
  /** Self-serve listener allowance across activated campaigns. */
  maxNewListeners?: number;
}

export const EMULATOR_PLAN_PRESETS: Record<EmulatorPlan, EmulatorPlanPreset> = {
  free: { feeRate: 0.2, premium: false },
  artist_pro: { feeRate: 0.2, premium: false },
  label_power: { feeRate: 0.15, premium: true },
  enterprise: { feeRate: 0.1, premium: true },
  self_serve_5000: { feeRate: 0.2, premium: false, maxNewListeners: 5000 },
  self_serve_25000: { feeRate: 0.2, premium: false, maxNewListeners: 25_000 },
};

export interface ResolvedEmulatorPlan {
  /** Selected preset, or `null` when only explicit `feeRate` / defaults were used. */
  plan: EmulatorPlan | null;
  feeRate: number;
  premium: boolean;
  maxNewListeners: number | null;
}

export function resolveEmulatorPlan(options: {
  plan?: EmulatorPlan;
  feeRate?: number;
}): ResolvedEmulatorPlan {
  const preset = options.plan ? EMULATOR_PLAN_PRESETS[options.plan] : null;
  const feeRate = options.feeRate ?? preset?.feeRate ?? 0;

  if (
    typeof feeRate !== 'number' ||
    !Number.isFinite(feeRate) ||
    feeRate < 0 ||
    feeRate >= 1
  ) {
    throw new Error('feeRate must be a finite number in [0, 1).');
  }

  return {
    plan: options.plan ?? null,
    feeRate,
    premium: preset?.premium ?? true,
    maxNewListeners: preset?.maxNewListeners ?? null,
  };
}
