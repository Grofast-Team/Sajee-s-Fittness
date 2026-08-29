import type { ReactNode } from 'react';
import { clsx } from 'clsx';

/**
 * Shared presentational primitives.
 *
 * Kept small and unopinionated. The design language lives in CSS variables
 * (`globals.css`) so light and dark mode stay in step automatically and no
 * component hardcodes a hex value.
 */

export function Card({
  children,
  className,
  as: Tag = 'section',
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article' | 'li';
}) {
  return (
    <Tag
      className={clsx('rounded-2xl border p-4', className)}
      style={{ background: 'var(--surface)', boxShadow: 'var(--shadow-card)' }}
    >
      {children}
    </Tag>
  );
}

export function CardTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-base font-semibold">{children}</h2>
      {hint ? (
        <span className="text-xs" style={{ color: 'var(--fg-subtle)' }}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

/**
 * A labelled progress bar.
 *
 * The value is always written out as text next to the bar. A bar alone encodes
 * meaning in length and colour only, which fails for screen readers and for
 * anyone who cannot distinguish the fill from the track.
 */
export function Meter({
  label,
  value,
  target,
  unit,
  tone = 'brand',
  note,
}: {
  label: string;
  value: number;
  target: number;
  unit: string;
  tone?: 'brand' | 'grow' | 'warn';
  note?: string;
}) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  const over = target > 0 && value > target;
  const fill =
    tone === 'grow' ? 'var(--accent)' : tone === 'warn' ? '#f59e0b' : 'var(--primary)';

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="tabular text-sm" style={{ color: 'var(--fg-muted)' }}>
          <span className="font-semibold" style={{ color: 'var(--fg)' }}>
            {Math.round(value).toLocaleString()}
          </span>
          {' / '}
          {Math.round(target).toLocaleString()} {unit}
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full"
        style={{ background: 'var(--surface-2)' }}
        role="progressbar"
        aria-label={`${label}: ${Math.round(value)} of ${Math.round(target)} ${unit}`}
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={Math.round(target)}
      >
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{ width: `${pct}%`, background: over ? 'var(--color-warn-500, #f59e0b)' : fill }}
        />
      </div>
      {note ? (
        <p className="mt-1 text-xs" style={{ color: 'var(--fg-subtle)' }}>
          {note}
        </p>
      ) : null}
    </div>
  );
}

/** Confidence is never decorative here - it changes whether a number is shown
 *  as a value or a range, so it is labelled in words, not just colour. */
export function ConfidenceBadge({ level }: { level: 'high' | 'medium' | 'low' }) {
  const copy = {
    high: { text: 'Measured', bg: 'rgb(5 150 105 / 0.12)', fg: 'var(--accent)' },
    medium: { text: 'Estimated', bg: 'rgb(245 158 11 / 0.14)', fg: '#b45309' },
    low: { text: 'Rough estimate', bg: 'rgb(220 38 38 / 0.10)', fg: '#b91c1c' },
  }[level];

  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ background: copy.bg, color: copy.fg }}
    >
      {copy.text}
    </span>
  );
}

/**
 * The "Why?" affordance.
 *
 * Every meaningful recommendation in the app can explain itself. This is a
 * plain `<details>` so it works without JavaScript and is keyboard accessible
 * for free.
 */
export function WhyPanel({ children, label = 'Why?' }: { children: ReactNode; label?: string }) {
  return (
    <details className="mt-3 group">
      <summary
        className="cursor-pointer list-none text-sm font-medium underline decoration-dotted underline-offset-4"
        style={{ color: 'var(--primary)' }}
      >
        {label}
      </summary>
      <div className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
        {children}
      </div>
    </details>
  );
}

export function Button({
  children,
  variant = 'primary',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'quiet' }) {
  return (
    <button
      {...props}
      className={clsx(
        // 44px minimum touch target, per the accessibility baseline.
        'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      style={
        variant === 'primary'
          ? { background: 'var(--primary)', color: 'var(--primary-fg)' }
          : variant === 'ghost'
            ? { background: 'var(--surface-2)', color: 'var(--fg)' }
            : { background: 'transparent', color: 'var(--fg-muted)' }
      }
    >
      {children}
    </button>
  );
}

/**
 * Honest empty and unavailable states.
 *
 * Used wherever a feature needs configuration that is not present. Showing
 * plausible-looking placeholder data instead would be worse than showing
 * nothing, because the user cannot tell it is not real.
 */
export function Unavailable({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return (
    <Card className="border-dashed">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-sm" style={{ color: 'var(--fg-muted)' }}>
        {detail}
      </p>
      {action ? <div className="mt-3">{action}</div> : null}
    </Card>
  );
}
