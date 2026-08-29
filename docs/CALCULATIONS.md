# Calculation Logic

Every number the user sees originates in `src/lib/engines`. This document is the
specification those modules are tested against (`tests/`).

Language rule: all outputs are **estimates**. The UI never renders "your BMR is
1,612 kcal"; it renders "estimated resting energy ≈ 1,610 kcal/day".

## 1. Resting energy (BMR)

Default: **Mifflin–St Jeor**, the best-validated predictive equation for the general
population.

```
male:   BMR = 10·kg + 6.25·cm − 5·age + 5
female: BMR = 10·kg + 6.25·cm − 5·age − 161
```

If a *reliable* body-fat percentage is available (DEXA/BIA with a stated method),
**Katch–McArdle** is used instead, since it is more accurate at body-composition
extremes:

```
BMR = 370 + 21.6 · fatFreeMassKg
```

Self-reported "I think I'm about 25%" is **not** reliable and does not trigger this path.

Both are population regressions with roughly ±10% individual error. The engine
returns that uncertainty band alongside the point value, and the adaptive system
(§6) exists precisely because the prediction is only a starting point.

## 2. Total energy expenditure (TDEE)

`TDEE = BMR × activityFactor`

Activity factor is derived from the lifestyle interview, not asked directly — users
systematically overestimate when asked "how active are you?".

| Derived level | Factor | Typical profile |
| --- | --- | --- |
| sedentary | 1.20 | desk job, < 4k steps, no training |
| light | 1.375 | some walking, 1–2 sessions/wk |
| moderate | 1.55 | 6–9k steps, 3–4 sessions/wk |
| active | 1.725 | physical job or 5–6 sessions/wk |
| very_active | 1.90 | heavy labour + daily training |

The factor is computed from occupation type, sitting hours, measured/estimated step
baseline, and training frequency. See `activity.ts::deriveActivityLevel`.

## 3. Energy target and deficit

Target deficit is chosen as a **percentage of TDEE**, not a fixed number, because a
500 kcal deficit is trivial for a 3,200 kcal maintenance and dangerous for a 1,500 one.

| Pace | Deficit | ≈ weekly loss |
| --- | --- | --- |
| gentle | 10% | ~0.25–0.4% bodyweight |
| steady (default) | 18% | ~0.5–0.7% bodyweight |
| firm | 25% | ~0.7–1.0% bodyweight |

Then hard safety floors are applied, in this order, and the binding constraint is
reported to the user so the number is never unexplained:

1. Never below **BMR × 1.0** for a sustained plan.
2. Never below **1,500 kcal/day** (male) or **1,200 kcal/day** (female) without
   professional supervision.
3. Never a deficit greater than **25%** of TDEE.
4. Weekly loss capped at **1.0% of bodyweight**.

If the user's requested target date requires breaking a floor, the app does not
comply. It reports the achievable date range and explains which limit binds.

## 4. Macronutrients

**Protein** — the highest-leverage macro in a deficit, for satiety and lean mass
retention. Target `1.6-2.2 g/kg` of *reference weight*, where reference weight is
goal weight when BMI > 30 (dosing to actual weight overshoots in obesity).
Default 1.6 g/kg — the bottom of the evidence range, on purpose: the upper end suits
lifters chasing marginal lean-mass retention, while a beginner on a tight food
budget just gets a target they cannot afford to hit. Clamped so protein never
exceeds 40% of total energy.

**Fat** — floor of `0.6 g/kg` for hormonal and fat-soluble vitamin adequacy,
default `25%` of energy.

**Carbohydrate** — the remainder. Carbs are the flexible macro; they are what makes
a plan culturally feasible. A South Indian plan is rice-and-millet shaped and that
is fine.

**Fibre** — `14 g per 1,000 kcal` (the standard adequacy basis), capped at 40 g,
with a ramp for users currently far below target to avoid GI distress.

## 5. Weight trend (never react to a single reading)

Scale weight is a noisy signal with a slow trend underneath. Day-to-day movement is
dominated by water, glycogen, sodium, gut content and cycle phase — not fat.

The engine uses an **exponentially weighted moving average**, α = 0.25 (≈ 7-day
half-life), and reports:

- today's raw reading (shown small, de-emphasised)
- the smoothed trend value (shown large — this is "your weight")
- rate of change in kg/week from a linear fit over the trailing 14–28 days
- a **confidence interval** on that rate

A trend is only called a direction when the confidence interval excludes zero.
Otherwise the app says "too early to tell" — which is the honest answer, and one
that most apps refuse to give.

## 6. Adaptation rules

Evaluated weekly, but only fires when **all** gates pass:

- ≥ 14 days since the last change
- ≥ 10 weigh-ins in the window
- logging completeness ≥ 70% (below this: fix logging, not calories)
- no active safety flag requiring professional review

| Observed | Action |
| --- | --- |
| Loss faster than 1.0%/wk | **Increase** intake 5–8%. Too fast is a problem, not a win. |
| Loss within target band | No change. Say so explicitly. |
| Loss slower than half of target, adherence good | Reduce intake ≤ 5% **or** add steps — one lever, never both |
| No change, adherence poor | Do not touch calories. Ask what made the plan hard. |
| Weight rising, adherence good | Re-derive TDEE from observed intake vs. observed trend |

Maximum single adjustment: **±8%** of current target. The engine cannot make a larger
change; it is clamped in code.

## 7. Plateau detection

A plateau requires **≥ 21 days** of trend data with a rate-of-change confidence
interval that includes zero, *and* adequate logging. Anything shorter is normal
variance and is reported as such.

Before recommending any change, the engine ranks likely explanations by evidence:
logging gaps, portion drift, step decline, sleep deficit, cycle phase, recent
sodium/carb change, and genuine metabolic adaptation — in that order, because that
is roughly their order of real-world frequency.

## 8. Step goals

Baseline first, never a default 10,000. Initial target = baseline × 1.25, rounded
to the nearest 500, capped at +2,000 over baseline. Progression is +500/week and
only when the previous target was met on ≥ 5 of 7 days. Targets step *down* after a
missed week rather than accumulating an impossible debt.

## 9. Energy expenditure of exercise

Computed from METs × weight × duration, minus resting energy for that period
(otherwise resting burn is double-counted, which is why most apps overstate it).

```
kcal = (MET − 1) × 3.5 × kg / 200 × minutes
```

Exercise energy is displayed but **never added to the eating target by default**.
Estimates carry large error and "eat back your exercise" is a well-known adherence
trap. Advanced users can opt in.
