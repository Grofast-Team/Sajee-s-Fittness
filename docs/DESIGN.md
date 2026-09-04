# Design direction

## The thesis

This product's one distinctive belief is **honest measurement**. It refuses to
invent a calorie count from a photo. It shows a range when it does not know. It
says "too early to tell" rather than drawing a trend line through noise. It
separates what was *weighed* from what was *guessed*.

The interface has a second job alongside that one: it has to feel like a **calm
personal coach**, not a bodybuilding app and not a clinical dashboard. The
audience is a beginner who does not know nutrition, using a cheap Android phone
while cooking or walking. Everything below serves those two things together —
the design stays quiet so that the one moment of uncertainty stands out.

## Palette

Blue is the resting state. It carries progress, navigation and the primary
action — everything that is settled. Amber carries doubt, and nothing else may
use it.

| Token | Value | Role |
| --- | --- | --- |
| `--primary` | `#2563EB` | primary actions, progress, active navigation, links |
| `--primary-dark` | `#1D4ED8` | text on light blue, hover |
| `--primary-light` | `#EFF6FF` | active nav background, empty progress track |
| `--bg` | `#F8FAFC` | the page |
| `--surface` | `#FFFFFF` | cards |
| `--fg` / `--fg-muted` / `--fg-subtle` | `#0F172A` / `#64748B` / `#94A3B8` | text |
| `--line` | `#E2E8F0` | borders |
| `--signal` | `#B45309` | **estimated** — moderate confidence, a range, a photo guess |
| `--confirm` | `#047857` | **measured** — weighed, completed, target met |
| `--alarm` | `#DC2626` | invalid input, failed save, safety limits, destructive actions |

The whole interface is deliberately *not* blue. White cards on a very light
blue ground, with blue reserved for the things you can act on, is what keeps it
from getting tiring across a day of use — and it is what lets the amber read as
a genuine signal rather than one more colour.

Dark mode exists but is not the designed experience. Light is primary; the dark
palette is there so a phone set to dark at 11pm does not flashbang someone
logging dinner.

## Signature: the range-aware ring

Progress rings are the default answer for a wellness app, and an ordinary ring
cannot express uncertainty — it forces a single position where the truth is a
range.

This one can:

- A **measured** value closes as a solid blue arc with a rounded cap.
- An **estimated** value draws as a translucent amber band spanning the range we
  actually believe, with no cap — because a cap implies a value landed there.

That is the product's argument made visual: the app shows you the width of what
it does not know. `Rail` carries the same distinction laid flat, for places
where rings would crowd — four targets on a narrow phone, or a secondary metric
beside a primary one.

Rings are used sparingly. One per screen, at hero size; everything else is a
rail. A dashboard of six competing rings communicates less than one.

## Type

One family, two jobs.

| Role | Treatment | Why |
| --- | --- | --- |
| Display | Inter, weight 640, `-0.025em` | Tight tracking and heavier optical weight give headings presence without a second font download |
| Body | Inter, 15–16px | Legibility on a cheap Android screen is the whole requirement |
| Data | Inter with `tabular-nums` | Numbers are the content; tabular figures stop columns twitching as digits change |

A separate display face and a monospace for numbers were both removed. They
cost two font downloads on what may be a shared 4G connection, and Inter set
properly does both jobs. Section labels are **sentence case**, not tracked-out
capitals — this app talks to beginners, and shouting in capitals above every
block reads as an interface for people who already know the vocabulary.

## Layout and responsiveness

One application with responsive layouts, never a separate mobile and desktop
build. The same components and the same data adapt to the viewport.

| Width | Shape |
| --- | --- |
| < 768px | Compact header, one column, bottom navigation |
| 768–1023px | Compact header, two-column grids, bottom navigation |
| ≥ 1024px | Fixed 248px sidebar, multi-column content, no bottom bar |

The sidebar and the bottom bar are never on screen together — two navigations
competing is how a responsive app ends up feeling like two apps stitched
together. Content stops at 1280px so text does not stretch into an unreadable
line on a 1920px monitor. Page gutters step 16 / 24 / 32px with the viewport.

Desktop is not the phone layout with wider cards. On Today, the day's decisions
take the left column and the slower-moving picture — weight, hydration, sleep —
takes the right. Coach keeps a single centred column at every width, because it
is a conversation and chat stretched to 1200px is unreadable.

## Restraint

One bold element: the ring. Everything around it stays quiet — thin borders,
barely-there shadows, no gradients, no decorative animation. Radius steps with
importance rather than being one value everywhere: 10px controls, 16px cards,
20px feature cards.

Motion is limited to progress settling on load and state changes at 180–260ms,
and everything is disabled under `prefers-reduced-motion`.

## Rules that are not negotiable

- **Never communicate with colour alone.** Confidence is labelled in words
  ("Weighed", "Estimated"); alerts pair an icon with text.
- **Never invent a number.** Missing stays missing — "not recorded", with the
  action to fix it.
- **Never ship a dead control.** A button that looks pressable and does nothing
  is worse than a sentence saying the feature is not built yet.
- **44px minimum touch target.** This gets used one-handed, walking.
- **Labels are real elements, never placeholders.** A placeholder disappears the
  moment someone starts typing, which is exactly when a beginner still needs it.
- **No shame.** A missed target is a distance still to cover, never a failure.
