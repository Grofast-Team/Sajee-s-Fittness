# FitCoach — Product & System Architecture

## 1. What this product is

A personalized fat-loss coaching system that answers exactly one question better than
any generic tracker:

> "Given MY body, MY food, MY budget, MY schedule, MY habits and MY real life —
> what should I do today?"

It is **not** a calorie counter with a signup form. It is a coach that interviews the
user, models their real constraints, produces a plan they can actually follow, and
adapts that plan from observed behaviour.

## 2. Non-negotiable product rules

These are enforced in code, not just in copy. See `src/lib/engines/safety.ts`.

| Rule | Enforcement |
| --- | --- |
| Never prescribe dangerously low energy intake | `clampEnergyTarget()` hard floors |
| Never promise an exact weight-loss result | Expectation engine emits ranges only |
| Never claim photo calorie estimation is exact | Confidence is a required field |
| Never shame the user | Copy layer + coach system prompt constraints |
| Never fabricate nutrition, prices, or device data | AI is forbidden from emitting numbers |
| Never let a user read another user's row | Row Level Security on every user table |
| Never ship the service-role key to a browser | Key only read in `src/lib/supabase/admin.ts` |

## 3. Layered architecture

```
Browser (React Server Components + Client islands)
        |
        v
Next.js App Router  ──  Server Actions / Route Handlers   [ trust boundary ]
        |
        +--> Safety layer            (screens every recommendation)
        +--> Deterministic engines   (all numbers originate here)
        +--> AI layer                (language + perception only)
        |
        v
Supabase Postgres (RLS) + Supabase Auth + Supabase Storage (private buckets)
```

The trust boundary is the server. The browser never holds an AI provider key, never
holds the service-role key, and never receives another user's rows.

## 4. The central separation: AI reasons, engines calculate

This is the most important architectural decision in the product.

A language model is good at *perception and language*: "this photo appears to contain
two dosa and a bowl of sambar", "the user is asking whether they can eat biryani".

A language model is bad at *arithmetic it is trusted on*: it will happily invent
"637 kcal" with false precision.

Therefore:

- The AI layer returns **structured identifications**, never nutrition numbers.
  Its output schema (`src/lib/ai/schemas.ts`) has no calorie field at all — it is
  structurally incapable of hallucinating one.
- The **food database** supplies nutrition per 100 g.
- The **calculation engine** multiplies grams by density and produces the numbers.
- Every produced number carries a `confidence` and, when confidence is not high,
  is rendered as a **range**, never a point estimate.

```
photo ──> AI vision ──> { food: "dosa", count: 2, scaleReadingGrams: 180 }
                              |
                              v
                    food DB lookup: dosa = 168 kcal / 100 g
                              |
                              v
                 calc engine: 180 g × 1.68 = 302 kcal  (confidence: high)
```

## 5. Scale-first portion protocol

Portion size is the single largest error source in food logging — larger than food
misidentification. A model looking at a plate cannot know if that is 90 g or 210 g of
rice, and any app that pretends otherwise is fabricating data.

So the primary photo flow asks the user to **photograph the food sitting on a kitchen
weighing scale with the display visible**.

1. Put the plate/bowl on the scale, press tare, add the food.
2. Photograph so both the food and the lit display are readable.
3. Vision extracts the food identity **and** reads the digits on the display.
4. Grams are then *measured*, not guessed → confidence `high`, point estimate allowed.

Degradation is explicit and honest:

| Situation | Behaviour |
| --- | --- |
| Display readable + tared | `high` confidence, exact grams, point estimate |
| Display readable, not tared | Ask about the vessel; subtract only a user-confirmed weight |
| Display unreadable | Fall back to visual estimation, `low`/`medium`, emit a range |
| No scale in frame | Visual estimation path, range output, offer the scale tip once |

The app never silently guesses a tare weight. See `docs/AI-ARCHITECTURE.md` §4.

## 6. Adaptation loop

```
   plan ──> user lives their week ──> logs ──> trend engine (smoothed, multi-week)
     ^                                              |
     |                                              v
     +──── adaptation engine <──── adherence engine + user feedback
```

Adaptation is deliberately slow and evidence-gated:

- Never react to a single day's weight. Minimum 14 days of trend data.
- Never change energy targets when logging completeness is below threshold —
  the problem is measurement, not metabolism.
- Never change more than one lever at a time.
- Changes are capped in magnitude (see `docs/CALCULATIONS.md` §6).

## 7. Directory map

```
docs/                     architecture, schema, AI design, calculations, checklists
supabase/migrations/      ordered, reproducible SQL — the only source of schema truth
supabase/seed/            food, recipe, exercise and education seed data
src/lib/engines/          pure, deterministic, unit-tested. No I/O, no AI, no React.
src/lib/ai/               prompts + output schemas + provider access (server only)
src/lib/supabase/         client / server / admin factories
src/app/                  routes; server components by default
src/components/           presentational + client islands
tests/                    vitest suites, mirroring src/lib/engines
```

`src/lib/engines` is the heart of the product. Every file in it is a pure function
of its inputs — no database, no network, no clock reads. That is what makes the
nutrition and safety logic testable, and it is why the numbers can be trusted.

---

## 8. Decision record: the "Life OS" proposal (September 2026)

A proposal arrived to rebuild this as a general personal operating system —
health, money and life on one data model. The **product direction was
adopted**. Three of its **architectural recommendations were not**, and the
reasons are recorded here so the question does not have to be re-argued.

### Rejected: Prisma and Better Auth in place of the Supabase client and Auth

Isolation between users is enforced **inside Postgres** by row-level security:
every user-owned table carries owner-only policies keyed on `auth.uid()`, which
comes from the Supabase Auth JWT. At the time of writing that is over seventy
policies.

Prisma connects as a single database role and does not set the JWT claims
those policies read. Adopting it means either running as a role that bypasses
RLS — moving authorization for salary, spending and menstrual-cycle data into
application code, where one missing `where user_id = …` is a cross-user leak —
or re-implementing per-request claim setting, which interacts badly with
transaction-mode connection pooling. Replacing Supabase Auth breaks
`auth.uid()` outright.

The proposal's own security section asks that "user A cannot read user B's
expenses" be enforced server-side. RLS is a stronger guarantee than that, not a
weaker one: it holds even when the application code is wrong.

### Rejected: a duplicated `events` table as the source of truth

Writing every action to both its own table and a generic event log creates two
records of the same fact, and they drift. This codebase has consistently
avoided that — paying a commitment writes an ordinary `spends` row rather than a
separate paid flag, and the food cost estimate is never summed into spending.

A unified timeline, when built, should be a **read-time view** unioning the real
tables, not a second ledger.

### Rejected: restructuring into features / services / repositories

The existing split already is that layering: `lib/engines/` holds pure,
tested domain logic with no I/O; `lib/data/` holds reads; `lib/actions/` holds
validated writes; pages compose them. Renaming folders to match a template
would be churn with no behavioural gain.

### Adopted

- Answer questions rather than display numbers.
- Rules before AI; the model explains, it does not compute.
- Source, timestamp and confidence on data that has provenance.
- Income as a ledger with history, never an overwritten figure.
- No bank credentials. Automatic transaction import, when it comes, goes
  through India's consent-based Account Aggregator framework via a regulated
  partner, and lands as raw records normalized separately — never directly
  into `spends`.
- Need / want classification, with ambiguous categories left unclassified
  rather than guessed.
