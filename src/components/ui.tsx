import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, CheckCircle2, ChevronDown, Info, XCircle } from 'lucide-react';

/**
 * Design primitives. See docs/DESIGN.md.
 *
 * Two rules run through all of these:
 *
 * 1. Blue is the resting state — progress, navigation, the primary action.
 *    Everything settled is blue or plain, which is what lets the interface stay
 *    calm across a whole day of use.
 * 2. Amber means "we are not certain", and nothing else may use it. A
 *    photo-estimated meal draws as a band spanning what we do not know, rather
 *    than as a confident number we invented. Keeping the ordinary case
 *    colourless is what lets the amber mean something when it appears.
 *
 * Every component adapts across mobile, tablet and desktop on its own, so a
 * screen never has to re-solve the same layout at each breakpoint.
 */

/* ------------------------------------------------------------------ */
/* Page structure                                                      */
/* ------------------------------------------------------------------ */

/**
 * The top of a screen: what this page is, and the one action it offers.
 *
 * The action sits under the title on a phone and beside it from tablet up,
 * which is the only place there is room for it without crowding the heading.
 */
export function PageHeader({
  title,
  lede,
  action,
  className,
}: {
  title: string;
  lede?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className={clsx('pb-5 pt-5 md:pb-6 md:pt-7', className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="measure">
          <h1 className="display text-[1.75rem] md:text-[2rem]">{title}</h1>
          {lede ? (
            <p className="mt-1.5 text-[15px]" style={{ color: 'var(--fg-muted)' }}>
              {lede}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </header>
  );
}

/**
 * A labelled band of the page.
 *
 * Sections separate by heading and whitespace rather than by wrapping each one
 * in its own bordered box. Nesting cards inside cards is what makes a dashboard
 * read as a pile of containers with no hierarchy.
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
    <section className={clsx('pt-7 first:pt-0', className)}>
      {title ? (
        <div className="mb-3.5 flex items-baseline justify-between gap-4">
          <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{title}</h2>
          {meta ? (
            <div className="text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
              {meta}
            </div>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/**
 * A white card on the light blue ground.
 *
 * Radius steps with importance rather than being one value everywhere: 16px for
 * an ordinary card, 20px for a feature card carrying the screen's main number.
 */
export function Panel({
  children,
  className,
  tone = 'plain',
  feature = false,
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  tone?: 'plain' | 'signal' | 'alarm' | 'primary' | 'confirm';
  feature?: boolean;
  as?: 'div' | 'article' | 'li' | 'section';
}) {
  const tones = {
    plain: { background: 'var(--surface)', borderColor: 'var(--line)' },
    primary: { background: 'var(--primary-light)', borderColor: 'var(--primary-border)' },
    signal: { background: 'var(--signal-wash)', borderColor: 'var(--signal-border)' },
    confirm: { background: 'var(--confirm-wash)', borderColor: 'var(--confirm-border)' },
    alarm: { background: 'var(--alarm-wash)', borderColor: 'var(--alarm-border)' },
  }[tone];

  return (
    <Tag
      className={clsx('border p-4 md:p-5', className)}
      style={{
        ...tones,
        borderRadius: feature ? 'var(--radius-feature)' : 'var(--radius-card)',
        boxShadow: tone === 'plain' ? 'var(--shadow-sm)' : undefined,
      }}
    >
      {children}
    </Tag>
  );
}

export function CardTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-[15px] font-semibold">{children}</h2>
      {hint ? (
        <span className="text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function Rule({ className }: { className?: string }) {
  return <div className={clsx('rule', className)} />;
}

/* ------------------------------------------------------------------ */
/* The progress ring — the signature element                           */
/* ------------------------------------------------------------------ */

export interface RingProps {
  label: string;
  value: number;
  target: number;
  unit: string;
  /** When set, the value is a range and draws as a band with no end cap,
   *  because there is no single point that would be honest to mark. */
  low?: number | null;
  high?: number | null;
  size?: 'sm' | 'md' | 'lg';
  /** Replaces the centred figure, for "697 left" style readouts. */
  centre?: ReactNode;
  /** Hides the label beneath the ring, when a caption already says it. */
  hideCaption?: boolean;
}

const RING_SIZES = {
  sm: { box: 76, stroke: 7, value: 'text-[17px]', unit: 'text-[10px]' },
  md: { box: 104, stroke: 9, value: 'text-[22px]', unit: 'text-[11px]' },
  lg: { box: 168, stroke: 12, value: 'text-[40px]', unit: 'text-[13px]' },
};

/**
 * A quantity drawn as a ring.
 *
 * This is the one place the interface spends any visual boldness, and it earns
 * it by doing something an ordinary ring cannot: a weighed value closes as a
 * solid blue arc, while a photo estimate draws as a translucent amber band
 * spanning the range we actually believe. Most trackers flatten that to an
 * invented number. Showing the width of the doubt is the product's argument.
 */
export function Ring({
  label,
  value,
  target,
  unit,
  low = null,
  high = null,
  size = 'md',
  centre,
  hideCaption = false,
}: RingProps) {
  const { box, stroke, value: valueClass, unit: unitClass } = RING_SIZES[size];
  const r = (box - stroke) / 2;
  const c = 2 * Math.PI * r;

  const frac = (n: number) => (target > 0 ? Math.min(1, Math.max(0, n / target)) : 0);
  const isRange = low !== null && high !== null;
  const over = value > target && !isRange;

  const readout = isRange
    ? `estimated between ${Math.round(low)} and ${Math.round(high)} of ${Math.round(target)} ${unit}`
    : `${Math.round(value)} of ${Math.round(target)} ${unit}`;

  return (
    <div className="flex flex-col items-center gap-2.5">
      <div
        className="relative"
        style={{ width: box, height: box }}
        role="progressbar"
        aria-label={`${label}: ${readout}`}
        aria-valuenow={isRange ? undefined : Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={Math.round(target)}
        aria-valuetext={isRange ? `${Math.round(low)} to ${Math.round(high)} ${unit}` : undefined}
      >
        <svg width={box} height={box} viewBox={`0 0 ${box} ${box}`} aria-hidden>
          <g transform={`rotate(-90 ${box / 2} ${box / 2})`}>
            <circle
              cx={box / 2}
              cy={box / 2}
              r={r}
              fill="none"
              stroke="var(--ground)"
              strokeWidth={stroke}
            />

            {isRange ? (
              /* An estimate: a band across the span we are unsure about. No
                 rounded cap, because a cap implies a value landed there. */
              <circle
                className="fade-in"
                cx={box / 2}
                cy={box / 2}
                r={r}
                fill="none"
                stroke="var(--signal)"
                strokeWidth={stroke}
                strokeOpacity={0.5}
                strokeDasharray={`${Math.max(0.02, frac(high) - frac(low)) * c} ${c}`}
                strokeDashoffset={-frac(low) * c}
              />
            ) : (
              <circle
                className="ring-arc"
                cx={box / 2}
                cy={box / 2}
                r={r}
                fill="none"
                stroke={over ? 'var(--signal)' : 'var(--primary)'}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={`${frac(value) * c} ${c}`}
                style={{ ['--ring-circumference' as string]: `${c}` }}
              />
            )}
          </g>
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          {centre ?? (
            <>
              <span className={clsx('data font-semibold leading-none', valueClass)}>
                {isRange
                  ? `${Math.round(low)}–${Math.round(high)}`
                  : Math.round(value).toLocaleString()}
              </span>
              <span
                className={clsx('mt-1 leading-none', unitClass)}
                style={{ color: 'var(--fg-subtle)' }}
              >
                {unit}
              </span>
            </>
          )}
        </div>
      </div>

      {hideCaption ? null : (
        <div className="text-center">
          <div className="text-[13px] font-medium">{label}</div>
          <div className="data text-[12px]" style={{ color: 'var(--fg-subtle)' }}>
            of {Math.round(target).toLocaleString()} {unit}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The rail — the same idea, laid flat                                 */
/* ------------------------------------------------------------------ */

export interface RailProps {
  label: string;
  value: number;
  target: number;
  unit: string;
  /** When set, the value is a range and renders as a band with no marker. */
  low?: number | null;
  high?: number | null;
  /** Measured values render in blue; anything uncertain in amber. */
  measured?: boolean;
  note?: string;
  size?: 'md' | 'lg';
}

/**
 * A quantity as a horizontal bar.
 *
 * Used where rings would crowd — four targets on a narrow phone, or a secondary
 * metric beside a primary one. It carries the same measured/estimated
 * distinction as the ring, so the two can share a screen without contradicting
 * each other.
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
  const uncertain = isRange || !measured;

  const colour = over || uncertain ? 'var(--signal)' : 'var(--primary)';
  const height = size === 'lg' ? 10 : 8;

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className={size === 'lg' ? 'text-[15px] font-medium' : 'text-sm font-medium'}>
          {label}
        </span>
        <span className="data text-sm">
          <span style={{ color: 'var(--fg)', fontWeight: 600 }}>
            {isRange ? `${Math.round(low)}–${Math.round(high)}` : Math.round(value).toLocaleString()}
          </span>
          <span style={{ color: 'var(--fg-subtle)' }}>
            {' / '}
            {Math.round(target).toLocaleString()} {unit}
          </span>
        </span>
      </div>

      <div
        className="relative w-full overflow-hidden"
        style={{ height, background: 'var(--ground)', borderRadius: height }}
        role="progressbar"
        aria-label={`${label}: ${
          isRange
            ? `estimated between ${Math.round(low)} and ${Math.round(high)}`
            : Math.round(value)
        } of ${Math.round(target)} ${unit}`}
        aria-valuenow={isRange ? undefined : Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={Math.round(target)}
        aria-valuetext={isRange ? `${Math.round(low)} to ${Math.round(high)} ${unit}` : undefined}
      >
        {isRange ? (
          <div
            className="fade-in absolute inset-y-0"
            style={{
              left: `${pct(low)}%`,
              width: `${Math.max(1.5, pct(high) - pct(low))}%`,
              background: 'var(--signal)',
              opacity: 0.5,
              borderRadius: height,
            }}
          />
        ) : (
          <div
            className="rail-fill absolute inset-y-0 left-0"
            style={{ width: `${pct(value)}%`, background: colour, borderRadius: height }}
          />
        )}
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
/* Numbers                                                             */
/* ------------------------------------------------------------------ */

/**
 * A single figure with its label and, where there is one, its direction of
 * travel. The arrow is always paired with a number, never left to carry the
 * meaning alone.
 */
export function Stat({
  label,
  value,
  unit,
  delta,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  unit?: string;
  delta?: { value: string; direction: 'up' | 'down' | 'flat' };
  tone?: 'neutral' | 'primary';
}) {
  return (
    <div>
      <div className="text-[13px]" style={{ color: 'var(--fg-muted)' }}>
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span
          className="data text-[26px] font-semibold leading-none"
          style={{ color: tone === 'primary' ? 'var(--primary)' : 'var(--fg)' }}
        >
          {value}
        </span>
        {unit ? (
          <span className="text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
            {unit}
          </span>
        ) : null}
      </div>
      {delta ? (
        <div className="data mt-1 text-[13px]" style={{ color: 'var(--fg-muted)' }}>
          {delta.direction === 'down' ? '↓' : delta.direction === 'up' ? '↑' : '→'} {delta.value}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Confidence and status                                               */
/* ------------------------------------------------------------------ */

/** Confidence decides whether a number is shown as a value or a range, so it is
 *  always labelled in words. Colour alone would fail anyone who cannot see it. */
export function ConfidenceTag({ level }: { level: 'high' | 'medium' | 'low' }) {
  const copy = {
    high: { text: 'Weighed', fg: 'var(--confirm)', bg: 'var(--confirm-wash)' },
    medium: { text: 'Estimated', fg: 'var(--signal)', bg: 'var(--signal-wash)' },
    low: { text: 'Rough guess', fg: 'var(--signal)', bg: 'var(--signal-wash)' },
  }[level];

  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium"
      style={{ background: copy.bg, color: copy.fg }}
    >
      {copy.text}
    </span>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'primary' | 'confirm' | 'signal' | 'alarm';
}) {
  const tones = {
    neutral: { background: 'var(--ground)', color: 'var(--fg-muted)' },
    primary: { background: 'var(--primary-light)', color: 'var(--primary-dark)' },
    confirm: { background: 'var(--confirm-wash)', color: 'var(--confirm)' },
    signal: { background: 'var(--signal-wash)', color: 'var(--signal)' },
    alarm: { background: 'var(--alarm-wash)', color: 'var(--alarm)' },
  }[tone];

  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium"
      style={tones}
    >
      {children}
    </span>
  );
}

/** An inline message. Icon plus words plus colour — three signals, so the
 *  meaning survives a monochrome screen or a colour-blind reader. */
export function Alert({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const map = {
    info: {
      Icon: Info,
      fg: 'var(--primary-dark)',
      bg: 'var(--primary-light)',
      bd: 'var(--primary-border)',
    },
    success: {
      Icon: CheckCircle2,
      fg: 'var(--confirm)',
      bg: 'var(--confirm-wash)',
      bd: 'var(--confirm-border)',
    },
    warning: {
      Icon: AlertTriangle,
      fg: 'var(--signal)',
      bg: 'var(--signal-wash)',
      bd: 'var(--signal-border)',
    },
    error: {
      Icon: XCircle,
      fg: 'var(--alarm)',
      bg: 'var(--alarm-wash)',
      bd: 'var(--alarm-border)',
    },
  }[tone];
  const { Icon } = map;

  return (
    <div
      className="flex gap-3 border p-3.5"
      style={{ background: map.bg, borderColor: map.bd, borderRadius: 'var(--radius-control)' }}
      role={tone === 'error' ? 'alert' : undefined}
    >
      <Icon size={18} aria-hidden className="mt-px shrink-0" style={{ color: map.fg }} />
      <div className="min-w-0 flex-1">
        {title ? (
          <p className="text-sm font-semibold" style={{ color: map.fg }}>
            {title}
          </p>
        ) : null}
        {children ? (
          <div className={clsx('text-sm', title && 'mt-0.5')} style={{ color: 'var(--fg-muted)' }}>
            {children}
          </div>
        ) : null}
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Controls                                                            */
/* ------------------------------------------------------------------ */

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className,
  disabled,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'quiet' | 'danger';
  size?: 'sm' | 'md';
  fullWidth?: boolean;
}) {
  const styles: Record<string, React.CSSProperties> = {
    primary: { background: 'var(--primary)', color: 'var(--on-primary)' },
    ghost: {
      background: 'var(--surface)',
      color: 'var(--primary-dark)',
      boxShadow: 'inset 0 0 0 1px var(--primary-border)',
    },
    quiet: { background: 'transparent', color: 'var(--fg-muted)' },
    danger: { background: 'var(--alarm)', color: '#fff' },
  };

  /*
   * A disabled primary must not stay filled.
   *
   * Fading a solid blue fill leaves a washed-out block that still reads as an
   * ordinary button — on the setup screen the disabled "Continue" looked more
   * prominent than the enabled "Skip" beside it. Disabled drops to an outline
   * so the difference is structural rather than a shade, and the label keeps
   * enough contrast to stay readable.
   */
  const style: React.CSSProperties = disabled
    ? {
        background: 'transparent',
        color: 'var(--fg-subtle)',
        boxShadow: 'inset 0 0 0 1px var(--line)',
      }
    : styles[variant];

  return (
    <button
      {...props}
      disabled={disabled}
      className={clsx(
        // 44px minimum touch target: this gets used one-handed, walking.
        'inline-flex items-center justify-center gap-2 font-medium transition-[opacity,box-shadow,background] duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:hover:opacity-100',
        size === 'sm' ? 'min-h-9 px-3 text-[13px]' : 'min-h-11 px-4 text-sm',
        fullWidth && 'w-full',
        disabled ? '' : 'cursor-pointer',
        className,
      )}
      style={{ borderRadius: 'var(--radius-control)', ...style }}
    >
      {children}
    </button>
  );
}

/**
 * A labelled form control.
 *
 * Label and description are real elements, not placeholder text: a placeholder
 * vanishes the moment someone starts typing, which is exactly when a beginner
 * still needs to know what the field wanted.
 */
export function Field({
  label,
  htmlFor,
  description,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  description?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
      </label>
      {description ? (
        <p
          id={`${htmlFor}-hint`}
          className="mt-0.5 text-[13px]"
          style={{ color: 'var(--fg-muted)' }}
        >
          {description}
        </p>
      ) : null}
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p
          id={`${htmlFor}-error`}
          className="mt-1.5 flex items-center gap-1.5 text-[13px]"
          style={{ color: 'var(--alarm)' }}
        >
          <XCircle size={14} aria-hidden className="shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Shared input styling, so a text box looks the same wherever it appears. */
export const inputClass =
  'min-h-11 w-full border px-3 text-[15px] outline-none transition-colors duration-200';

export const inputStyle: React.CSSProperties = {
  background: 'var(--surface)',
  borderColor: 'var(--line-strong)',
  borderRadius: 'var(--radius-control)',
  color: 'var(--fg)',
};

/**
 * The "why?" affordance.
 *
 * A plain <details>, so it works without JavaScript and is keyboard accessible
 * for free. Every recommendation in the app can explain itself, and none of
 * them explain themselves until asked.
 */
export function Why({ children, label = 'Why?' }: { children: ReactNode; label?: string }) {
  return (
    <details className="group mt-4">
      <summary
        className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1 text-[13px] font-medium"
        style={{ color: 'var(--primary-dark)' }}
      >
        {label}
        <ChevronDown
          size={14}
          aria-hidden
          className="transition-transform duration-200 group-open:rotate-180"
        />
      </summary>
      <div
        className="measure mt-2 border-l-2 pl-3 text-sm leading-relaxed"
        style={{ color: 'var(--fg-muted)', borderColor: 'var(--primary-border)' }}
      >
        {children}
      </div>
    </details>
  );
}

/* ------------------------------------------------------------------ */
/* Empty, unavailable and loading                                      */
/* ------------------------------------------------------------------ */

/** An empty screen is an invitation to act, so it always carries the action. */
export function EmptyState({
  icon,
  title,
  detail,
  action,
}: {
  icon?: ReactNode;
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div
      className="flex flex-col items-center border border-dashed px-6 py-10 text-center"
      style={{ borderColor: 'var(--line-strong)', borderRadius: 'var(--radius-card)' }}
    >
      {icon ? (
        <div
          className="mb-3 flex size-12 items-center justify-center rounded-full"
          style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}
        >
          {icon}
        </div>
      ) : null}
      <h3 className="text-[15px] font-semibold">{title}</h3>
      <p className="measure mt-1 text-sm" style={{ color: 'var(--fg-muted)' }}>
        {detail}
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** Honest unavailable state, for a feature that needs configuration it does not
 *  have. Showing plausible placeholder numbers instead would be worse. */
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
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="measure mt-1 text-sm" style={{ color: 'var(--fg-muted)' }}>
        {detail}
      </p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} aria-hidden />;
}

/* Kept so existing imports keep working. */
export { Panel as Card };
export { ConfidenceTag as ConfidenceBadge };
export { Why as WhyPanel };
export function Meter(props: RailProps) {
  return <Rail {...props} />;
}
