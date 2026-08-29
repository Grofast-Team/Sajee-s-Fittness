# FitCoach

A personalised fat-loss coaching app that answers one question better than a
generic tracker:

> "Given my body, my food, my budget, my schedule and my real life — what should
> I do today?"

Not a calorie counter with a signup form. The app interviews the user, models
their actual constraints, produces a plan they can follow, and adapts it from
observed behaviour rather than from a single day's weight.

---

## Two ideas the whole product rests on

**1. AI reasons; engines calculate.**

A language model is good at perception ("this photo has two dosa and a bowl of
sambar") and bad at arithmetic you trust it on (it will confidently invent
"637 kcal"). So the AI output schemas in `src/lib/ai/schemas.ts` contain **no
nutrition fields at all** — the model is structurally incapable of hallucinating
a calorie count. The food database supplies composition, and
`src/lib/engines/nutrition.ts` does the multiplication.

**2. Portion accuracy comes from a kitchen scale, not from guessing.**

Portion size is the largest error source in food logging — larger than
misidentifying the food. Ninety grams and two hundred and ten grams of rice look
identical in a photo, and that gap is about 160 kcal.

So the primary photo flow asks the user to put the plate on a kitchen scale,
tare it, and photograph the food **with the display visible**. The vision model
reads the digits; grams become measured rather than estimated. When the display
is not readable, the app says so and returns a **range** with clarifying
questions instead of a fake point estimate. It never silently subtracts a
guessed vessel weight.

---

## Running it

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 143 engine tests
npm run build
```

The app runs with **no configuration at all**, in a clearly-labelled sample
mode. Every number shown is real output from the real engines, computed from a
sample person — it is banner-labelled as such on every screen, because a demo
you cannot distinguish from your own data is a lie.

Configure Supabase and an AI provider (`.env.example`) to make it your data.

## Setting up Supabase

```bash
supabase link --project-ref <your-ref>
supabase db push          # schema + seed data, in order
```

Migrations are ordered and reproducible; tables are never created by hand.
Seed data ships as migrations 10-11 (idempotent, `on conflict do nothing`), so a
fresh project is fully usable after one `db push`.

| Migration | Contents |
| --- | --- |
| `...001_foundation` | extensions, enums, `private` schema, admin helper |
| `...002_identity` | profiles, lifestyle, goals, safety flags, plans |
| `...003_tracking` | measurements, daily rollups, steps, sleep, water, cycle |
| `...004_food` | foods, aliases, serving units, prices, logs, AI analyses |
| `...005_recipes_meals` | recipes, ingredients, substitutions, meal plans, groceries |
| `...006_activity` | exercises, workouts, sessions, sets |
| `...007_coaching` | habits, coach threads, reviews, notifications, lessons |
| `...008_rls` | **Row Level Security on every user table**, storage policies |
| `...009_functions` | rollup triggers, alias-aware food search, recipe nutrition |
| `...010-011` | seed data: Indian foods, exercises, workouts, habits, lessons |
| `...012-013` | search fixes: de-duplication, 0.55 match threshold |
| `...014` | rollup guards so account deletion cascades cleanly |

## Deploying to Vercel

```bash
npm i -g vercel && vercel link && vercel deploy --prod
```

Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and
`AI_GATEWAY_API_KEY` in project settings. `SUPABASE_SERVICE_ROLE_KEY` is only
needed if you run the admin tooling — leave it unset otherwise.

---

## Layout

```
docs/                  architecture, calculations spec, AI design, security checklist
supabase/migrations/   ordered SQL — the only source of schema truth
supabase/.temp/        CLI state (gitignored)
src/lib/engines/       pure, deterministic, 143 unit tests. No I/O, no AI, no React.
src/lib/ai/            prompts and output schemas (server only)
src/lib/supabase/      client / server / admin factories
src/app/               routes; server components by default
```

`src/lib/engines` is the heart of the product. Every function in it is pure —
no database, no network, not even a clock read. That is what makes the safety
limits testable, and it is why the numbers can be trusted.

## The safety limits are code, not copy

A prompt can be argued with. `Math.max` cannot. These are enforced in
`src/lib/engines/targets.ts` and `safety.ts`, and tested in `tests/`:

- Never plan a sustained intake below resting energy expenditure
- Never below 1,500 kcal (male) / 1,200 kcal (female) without supervision
- Never a deficit above 25% of maintenance, or loss above 1% bodyweight/week
- Never adjust a target by more than 8% at once, or more often than fortnightly
- Never cut calories when the real problem is incomplete logging
- Pregnancy, disordered-eating history and underweight **block deficits entirely**
  while leaving the rest of the app usable

## What is deliberately honest rather than impressive

- Photo estimates without a scale are **ranges**, not numbers.
- A trend direction is only claimed when the confidence interval excludes zero;
  otherwise the app says "too early to tell".
- Unconfigured features say they are unconfigured instead of showing placeholder
  data.
- Seed nutrition values are marked `is_verified = false` until reconciled
  against IFCT 2017 / USDA. See the header of migration `...010_seed_foods.sql`.

---

This app provides general wellness, nutrition and activity guidance. It does not
diagnose, treat or prescribe, and it is not a substitute for a doctor or a
registered dietitian.
