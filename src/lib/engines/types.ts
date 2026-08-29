/**
 * Shared types for the calculation engines.
 *
 * Everything in `src/lib/engines` is a pure function: no database, no network,
 * no `Date.now()`. That is what makes the nutrition and safety logic testable,
 * and it is why the numbers can be trusted.
 */

export type Sex = 'male' | 'female' | 'intersex' | 'prefer_not_to_say';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type Pace = 'gentle' | 'steady' | 'firm';
export type Confidence = 'high' | 'medium' | 'low';

/** How a body-fat number was obtained. Only some methods are trustworthy enough
 *  to switch the BMR equation. */
export type BodyFatMethod =
  | 'dexa'
  | 'bodpod'
  | 'bia_clinical'
  | 'bia_consumer'
  | 'calipers'
  | 'navy_tape'
  | 'visual_estimate';

export interface BodyInput {
  weightKg: number;
  heightCm: number;
  ageYears: number;
  sex: Sex;
  bodyFatPct?: number;
  bodyFatMethod?: BodyFatMethod;
}

export interface EnergyEstimate {
  /** Point estimate, kcal/day. Always presented to users as an estimate. */
  kcal: number;
  /** Plus/minus band reflecting the equation's real population error. */
  lowKcal: number;
  highKcal: number;
  equation: 'mifflin_st_jeor' | 'katch_mcardle';
  note: string;
}

export interface MacroTargets {
  proteinG: number;
  fatG: number;
  carbG: number;
  fibreG: number;
}

/** Which rule stopped the target from going lower. Never null in practice for a
 *  deficit plan, so the "Why?" panel always has something to say. */
export type BindingConstraint =
  | 'requested_pace'
  | 'absolute_energy_floor'
  | 'bmr_floor'
  | 'max_deficit_pct'
  | 'max_weekly_loss'
  | 'safety_flag'
  | 'none';

export interface EnergyTarget {
  targetKcal: number;
  floorKcal: number;
  maintenanceKcal: number;
  deficitKcal: number;
  deficitPct: number;
  projectedWeeklyLossKg: number;
  bindingConstraint: BindingConstraint;
  /** Plain-language explanation, rendered verbatim in the explainability UI. */
  explanation: string;
}

export interface WeighIn {
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  weightKg: number;
}

export interface TrendPoint {
  date: string;
  raw: number;
  /** Exponentially weighted moving average - "your weight" as shown to users. */
  smoothed: number;
}

export interface TrendResult {
  points: TrendPoint[];
  latestSmoothed: number | null;
  /** Fitted rate of change over the window, kg per week. */
  kgPerWeek: number | null;
  /** Half-width of the 95% confidence interval on `kgPerWeek`. */
  kgPerWeekMargin: number | null;
  /** Only ever set when the interval excludes zero. */
  direction: 'losing' | 'gaining' | 'holding' | 'unclear';
  daysOfData: number;
  readingCount: number;
  message: string;
}
