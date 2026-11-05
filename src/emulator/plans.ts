/**
 * Local plan presets for paid-campaign fees.
 * Defaults are for emulator tests only — not a published price list.
 */
export type EmulatorPlan =
  | 'free'
  | 'artist_pro'
  | 'studio'
  | 'label_power'
  | 'enterprise';

export interface EmulatorPlanPreset {
  feeRate: number;
  /**
   * Whether this preset is treated as premium in the emulator.
   * Metadata for `getPlan()` only; does not change `/v1` payloads yet.
   */
  premium: boolean;
}

export const EMULATOR_PLAN_PRESETS: Record<EmulatorPlan, EmulatorPlanPreset> = {
  free: { feeRate: 0.2, premium: false },
  artist_pro: { feeRate: 0.2, premium: false },
  studio: { feeRate: 0.2, premium: false },
  label_power: { feeRate: 0.15, premium: true },
  enterprise: { feeRate: 0.1, premium: true },
};

export interface ResolvedEmulatorPlan {
  /** Selected preset, or `null` when only explicit `feeRate` / defaults were used. */
  plan: EmulatorPlan | null;
  feeRate: number;
  premium: boolean;
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
  };
}
