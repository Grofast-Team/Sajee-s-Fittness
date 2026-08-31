import type { ReactNode } from 'react';
import { clsx } from 'clsx';

/**
 * Design primitives. See docs/DESIGN.md.
 *
 * The one idea running through all of these: the interface distinguishes what
 * was measured from what was estimated. Colour and form carry that meaning —
 * pine for measured, turmeric for estimated — so a user can see the difference
 * without reading a word.
 */

/* ------------------------------------------------------------------ */
/* Structure                                                           */
/* ------------------------------------------------------------------ */

/**
 * A section of the page.
 *
 * Sections separate by a hairline rule and a shift in ground, not by wrapping
 * every block in its own bordered card. Uniform cards were what made the first
 * pass read as a template — when everything has the same weight, nothing leads.
 */
export function Section({
  title,
  meta,
  children,
  className,
}: {
  title?: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={clsx('border-t py-6', className)}
      style={{ borderColor: 'var(--line)' }}
    >
      {title ? (
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="eyebrow">{title}</h2>
          {meta ? <div className="eyebrow">{meta}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** A raised surface. Reserved for genuinely interactive objects — a form, a
 *  list you can act on — rather than used as default packaging for text. */
export function Panel({
  children,
  className,
  tone = 'plain',
}: {
  children: ReactNode;
  className?: string;
  tone?: 'plain' | 'signal' | 'alarm';
}) {
  const border =
    tone === 'signal' ? 'var(--signal)' : tone === 'alarm' ? 'var(--alarm)' : 'var(--line)';
  const background =
    tone === 'signal' ? 'var(--signal-wash)' : tone === 'alarm' ? 'var(--alarm-wash)' : 'var(--surface)';

  return (
    <div
      className={clsx('rounded-lg border p-4', className)}
      style={{ background, borderColor: border }}
    >
      {children}
    </div>
  );
}

export function Rule({ className }: { className?: string }) {
  return <div className={clsx('rule', className)} />;
}

/* ------------------------------------------------------------------ */
/* The measurement rail — the signature element                        */
/* ------------------------------------------------------------------ */

export interface RailProps {
  label: string;
  value: number;
  target: number;
  unit: string;
  /** When set, the value is a range and renders as a band with no marker,
   *  because there is no single point that would be honest to mark. */
  low?: number | null;
  high?: number | null;
  /** Measured values resolve in pine; estimates in turmeric. */
  measured?: boolean;
  note?: string;
  size?: 'md' | 'lg';
}

/**
 * A quantity drawn against a graduated rule, like the face of a weighing scale.
 *
 * A filled pill cannot express uncertainty — it forces a single position where
 * the truth is a range. The rail can: a measured value ends in a solid marker,
 * an estimate spans a translucent band. That is the product's whole argument,
 * made visual.
 */
export function Rail({
  label,
  value,
  target,
  unit,
  low = null,
  high = null,
  measured = true,
  note,
  size = 'md',
}: RailProps) {
  const pct = (n: number) => (target > 0 ? Math.min(100, Math.max(0, (n / target) * 100)) : 0);

  const isRange = low !== null && high !== null;
  const over = value > target;

  /*
   * Monochrome by default; turmeric only ever means "we are not certain".
   *
   * The first pass filled these bars with a mint green, which is the colour
   * every fitness app already uses and which said nothing. Making the ordinary
   * case neutral means the amber genuinely stands out on the one screen where
   * it matters — the estimate.
   */
  const colour = over || isRange || !measured ? 'var(--signal)' : 'var(--fg)';

  const height = size === 'lg' ? 10 : 7;

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className={size === 'lg' ? 'text-sm font-medium' : 'text-sm'}>{label}</span>
        <span className="data text-sm" style={{ color: 'var(--fg-muted)' }}>
          <span style={{ color: 'var(--fg)', fontWeight: 500 }}>
            {isRange
              ? `${Math.round(low)}–${Math.round(high)}`
              : Math.round(value).toLocaleString()}
          </span>
          <span style={{ color: 'var(--fg-subtle)' }}> / {Math.round(target).toLocaleString()}</span>
          <span className="eyebrow ml-1.5">{unit}</span>
        </span>
      </div>

      <div
        className="relative w-full overflow-hidden"
        style={{ height, background: 'var(--ground)' }}
        role="progressbar"
        aria-label={`${label}: ${
          isRange ? `estimated between ${Math.round(low)} and ${Math.round(high)}` : Math.round(value)
        } of ${Math.round(target)} ${unit}`}
        aria-valuenow={isRange ? undefined : Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={Math.round(target)}
        aria-valuetext={isRange ? `${Math.round(low)} to ${Math.round(high)} ${unit}` : undefined}
      >
        {isRange ? (
          /* An estimate: a band spanning what we do not know, no marker. */
          <div
            className="rail-fill absolute inset-y-0"
            style={{
              left: `${pct(low)}%`,
              width: `${Math.max(1.5, pct(high) - pct(low))}%`,
              background: 'var(--signal)',
              opacity: 0.42,
            }}
          />
        ) : (
          <div
            className="rail-fill absolute inset-y-0 left-0"
            style={{ width: `${pct(value)}%`, background: colour }}
          />
        )}

        {/* The marker. Only drawn for a measured point — an estimate has no
            single position it would be honest to mark. */}
        {!isRange ? (
          <div
            className="absolute inset-y-0"
            style={{
              left: `calc(${pct(value)}% - 1px)`,
              width: 2,
              background: over ? 'var(--alarm)' : 'var(--fg)',
            }}
          />
        ) : null}
      </div>

      {/*
       * The graduations, as a ruler beneath the bar rather than over it.
       *
       * Drawn on top of the fill they were invisible — a tick has to contrast
       * with both the filled and empty parts of the bar, which nothing does.
       * Below it, the rule reads as the face of a weighing scale, which is the
       * whole idea.
       */}
      <div className="relative mt-1 h-2" aria-hidden>
        {Array.from({ length: 11 }, (_, i) => (
          <span
            key={i}
            className="absolute top-0"
            style={{
              left: `${i * 10}%`,
              width: 1,
              height: i % 5 === 0 ? 7 : 4,
              background: i % 5 === 0 ? 'var(--fg-subtle)' : 'var(--line-strong)',
            }}
          />
        ))}
      </div>

      {note ? (
        <p className="mt-2 text-sm" style={{ color: 'var(--fg-muted)' }}>
          {note}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Confidence                                                          */
/* ------------------------------------------------------------------ */

/** Confidence is never decorative here — it decides whether a number is shown
 *  as a value or a range — so it is labelled in words, never colour alone. */
export function ConfidenceTag({ level }: { level: 'high' | 'medium' | 'low' }) {
  const copy = {
    high: { text: 'Weighed', fg: 'var(--confirm)', bg: 'var(--confirm-wash)' },
    medium: { text: 'Estimated', fg: 'var(--signal)', bg: 'var(--signal-wash)' },
    low: { text: 'Rough guess', fg: 'var(--signal)', bg: 'var(--signal-wash)' },
  }[level];

  return (
    <span
      className="eyebrow inline-flex items-center rounded px-1.5 py-0.5"
      style={{ background: copy.bg, color: copy.fg, letterSpacing: '0.1em' }}
    >
      {copy.text}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Controls                                                            */
/* ------------------------------------------------------------------ */

export function Button({
  children,
  variant = 'primary',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'quiet' | 'danger';
}) {
  const styles: Record<string, React.CSSProperties> = {
    primary: { background: 'var(--fg)', color: 'var(--bg)' },
    ghost: { background: 'transparent', color: 'var(--fg)', boxShadow: 'inset 0 0 0 1px var(--line-strong)' },
    quiet: { background: 'transparent', color: 'var(--fg-muted)' },
    danger: { background: 'var(--alarm)', color: '#fff' },
  };

  return (
    <button
      {...props}
      className={clsx(
        // 44px minimum touch target. Square-ish corners: this is an instrument,
        // not a consumer toy.
        'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-opacity duration-200 hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
      style={styles[variant]}
    >
      {children}
    </button>
  );
}

/**
 * The "Why?" affordance.
 *
 * A plain <details>, so it works without JavaScript and is keyboard accessible
 * for free. Every meaningful recommendation in the app can explain itself.
 */
export function Why({ children, label = 'Why?' }: { children: ReactNode; label?: string }) {
  return (
    <details className="group mt-4">
      <summary
        className="eyebrow cursor-pointer list-none border-b pb-1 transition-colors duration-200"
        style={{ color: 'var(--fg-muted)', borderColor: 'var(--line-strong)', width: 'fit-content' }}
      >
        {label} +
      </summary>
      <div className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
        {children}
      </div>
    </details>
  );
}

/** Honest unavailable state. Used wherever a feature needs configuration that
 *  is not present — showing plausible placeholder data would be worse. */
export function Unavailable({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="border-l-2 py-1 pl-4" style={{ borderColor: 'var(--line-strong)' }}>
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="mt-1 text-sm" style={{ color: 'var(--fg-muted)' }}>
        {detail}
      </p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

/* Kept so existing imports keep working while screens are migrated. */
export { Panel as Card };
export function CardTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-base font-medium">{children}</h2>
      {hint ? <span className="eyebrow">{hint}</span> : null}
    </div>
  );
}
export { ConfidenceTag as ConfidenceBadge };
export { Why as WhyPanel };
export function Meter(props: RailProps) {
  return <Rail {...props} />;
}
