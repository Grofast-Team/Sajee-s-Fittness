# Design direction

## The thesis

This product's one distinctive belief is **honest measurement**. It refuses to
invent a calorie count from a photo. It shows a range when it does not know. It
says "too early to tell" rather than drawing a trend line through noise. It
separates what was *weighed* from what was *guessed*.

That belief should be visible in the interface, not just in the copy. So the
design encodes it structurally: **the visual system distinguishes measured from
estimated everywhere it appears.**

That is the idea the whole thing hangs off. Everything else stays quiet.

## What was wrong before

The first pass was a stack of identical rounded cards — same radius, same
padding, same border, same weight, one accent colour applied uniformly. It had
three specific failures:

1. **No hierarchy.** "1,053 / 1,750 kcal" — the number the screen exists to
   communicate — was set at the same size as a helper caption.
2. **No signature.** Nothing on the screen could only have come from this app.
   Swap the words and it is any dashboard.
3. **Colour carried no meaning.** Cyan on everything, because cyan was the brand
   colour, not because cyan said anything.

## Signature: the measurement rail

Progress bars are the default answer, and a filled pill cannot express
uncertainty — it forces a single position where the truth is a range.

So every quantity in the app is drawn on a **graduated rail**: a rule with tick
marks, like the face of a weighing scale.

```
  ENERGY                                     1,053 / 1,750 kcal
  ┌──────────────────────────────────────────────────────────┐
  ████████████████████████████▌ ░░░░░░░░░░
  ╵    ╵    ╵    ╵    ╵    ╵    ╵    ╵    ╵    ╵
```

- A **measured** value ends in a solid marker on the rail.
- An **estimated** value renders as a translucent amber band spanning the
  uncertainty, with no marker — because there is no single point to mark.

The rail is the thing you would remember, and it is the product's argument
made visual: this app shows you the width of what it does not know.

## Palette

Not cyan-on-everything. Colour carries meaning here.

| Token | Value | Role |
| --- | --- | --- |
| `--ink` | `#0E1113` | base, dark mode |
| `--paper` | `#F7F5F0` | base, light mode — warm, not clinical white |
| `--signal` | `#E0A126` | **estimated** — turmeric. Kitchen-native, warm, honest about doubt |
| `--confirm` | `#1F6F5C` | **measured** — deep pine. Grounded, never neon |
| `--alarm` | `#C0442E` | safety limits and destructive actions only |

Turmeric and pine come from the subject's own world — a South Indian kitchen —
rather than from a palette generator. Neither is a health-app cliché, and the
pairing is warm where most fitness apps are cold and aggressive.

Deliberately avoided: cream-and-terracotta, near-black-with-acid-green, and
medical blue. All three are defaults that appear regardless of subject.

## Type

Three faces, three jobs.

| Role | Face | Why |
| --- | --- | --- |
| Display | **Bricolage Grotesque** | Variable width and weight, genuine character, not the Space Grotesk everyone reaches for |
| Body | **Inter** | Invisible workhorse. Its job is legibility on a cheap Android screen |
| Data | **IBM Plex Mono** | Every number in the app. Tabular by nature, instrument heritage |

Numbers get their own face because **numbers are the content**. Weight, grams,
kcal and steps all read in Plex Mono, which makes a figure recognisable as *a
measurement* the instant you see it, and keeps columns from reflowing as digits
change.

## Layout

The uniform card stack is gone.

- **Hero, full bleed, no card.** The day opens with the single number that
  matters, at a size nothing else competes with.
- **The brief** is numbered — and numbering is justified here because it is a
  genuine priority order, not decoration.
- **Sections separate by ground shift and hairline rule**, not by giving every
  block its own border. Cards are now reserved for things that are genuinely
  interactive objects.

## Restraint

One bold element: the rail. Everything around it stays quiet — hairlines, flat
grounds, no gradients, no shadows doing decorative work, no scattered
animation. Motion is limited to the rail settling on load and state changes at
150–250ms, and it is disabled under `prefers-reduced-motion`.
