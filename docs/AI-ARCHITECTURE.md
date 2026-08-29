# AI Architecture

## 1. Where AI runs

Server-side only. Route handlers and server actions under `src/app/api/**` and
`src/lib/ai/**`. No provider key ever reaches the browser; the client talks to our
own endpoints, which are authenticated by the Supabase session cookie.

Provider access goes through the **Vercel AI Gateway** using plain
`"provider/model"` strings, so models can be swapped and failed over without code
changes.

| Job | Model class | Why |
| --- | --- | --- |
| Food photo analysis | vision-capable frontier model | needs OCR of a scale display + food ID |
| Coach conversation | mid-tier chat model | latency matters more than depth |
| Voice log parsing | small/fast model | short, highly-structured extraction |
| Weekly review synthesis | frontier model | pattern-finding across a week of data |

## 2. The hard constraint: AI never emits nutrition numbers

Every AI output schema in `src/lib/ai/schemas.ts` is designed so that hallucinated
nutrition is *structurally impossible*: there is no `calories` field for the model
to fill in. The model identifies; the database and the calculation engine quantify.

This is enforced three ways:

1. **Schema** — no numeric nutrition fields in any AI output type.
2. **Validation** — Zod parse rejects unknown keys; extra fields are dropped.
3. **Prompt** — the system prompt states the model must not estimate energy content.

The same rule applies to prices (no invented rupee figures — prices come from the
price table or are shown as "estimated, update with your local price") and to device
data (never synthesised; missing means missing).

## 3. Food photo pipeline

```
image ──> private Supabase Storage bucket (signed URL, short TTL)
      ──> vision model, structured output
      ──> Zod validation
      ──> food matching against foods table (alias-aware fuzzy search)
      ──> portion resolution  (scale reading > user input > visual estimate)
      ──> calculation engine
      ──> clarifying questions if confidence < high
      ──> user confirmation / correction
      ──> persist BOTH the AI estimate and the final corrected value
```

Storing both estimate and correction is what lets the system learn this user's
actual portions ("when they say 'a bowl of rice' they mean 190 g") instead of
applying a population average forever.

## 4. Scale-reading extraction (the portion accuracy feature)

The model is asked to return a `scale` object describing what it can *see*, and is
explicitly instructed that it must report unreadable digits as unreadable rather
than guessing. Guessed digits are worse than no digits, because they arrive with
unearned confidence.

```ts
scale: {
  present: boolean          // is a weighing scale visible at all
  displayReadable: boolean  // are the digits legible
  value: number | null      // the number shown, exactly as displayed
  unit: 'g' | 'kg' | 'oz' | 'lb' | null
  containerOnScale: boolean // is the food in a vessel that is also being weighed
  notes: string | null      // e.g. "display partially glare-obscured"
}
```

Resolution order in `src/lib/engines/portion.ts`:

| Source | Confidence | Output form |
| --- | --- | --- |
| `scale.displayReadable` and user confirmed tare | high | point estimate |
| scale readable, tare unknown | medium | asks about vessel first |
| user typed grams | high | point estimate |
| household measure ("1 katori") mapped via `serving_units` | medium | point estimate |
| visual estimate only | low | **range**, ± 35% |

The tare question is asked, never assumed. A 250 g steel plate is a 40% error on a
600 g meal, and an app that silently subtracts a guessed vessel weight is fabricating
data with extra steps.

## 5. The coach

The coach is a retrieval-grounded assistant, not a free-floating chatbot. Before any
reply it is handed a compact context block built server-side from the user's real
rows: today's targets, what has been logged, remaining protein and energy, budget,
allergies, dislikes, equipment, schedule, and the current safety flags.

Guardrails in the system prompt, mirrored by server-side checks:

- Never diagnose. Never prescribe medication or supplements.
- Never recommend intake below the user's computed floor.
- Never use shame, moralising, or "good food / bad food" framing.
- If a safety flag is active, surface the professional-consultation message and
  restrict the scope of advice rather than answering as normal.
- If the answer depends on data that is missing, ask for it instead of assuming.

## 6. Degradation

AI failures are normal operating conditions, not exceptions.

| Failure | Fallback |
| --- | --- |
| Vision call fails | "Couldn't analyse that image" + manual search, image kept |
| Low confidence | Clarifying questions, range output, never a fake point estimate |
| Food not in DB | Offer closest matches + "add a custom food" |
| Coach call fails | Deterministic answer from engines where possible |
| Provider outage | Gateway failover; all logging paths remain fully usable |

Logging food must never depend on AI availability. Search and quick-add are pure
database paths and work when every model is down.
