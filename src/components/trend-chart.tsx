import type { TrendPoint } from '@/lib/engines/types';

/**
 * Weight chart.
 *
 * Two series: the faint raw readings and the bold smoothed trend. Showing both
 * is the point - it makes visible, at a glance, that the daily scatter is noise
 * and the line through it is the actual signal.
 *
 * Rendered as inline SVG on the server: no charting library, no client
 * JavaScript, no layout shift while a bundle loads.
 */
export function TrendChart({
  points,
  height = 160,
}: {
  points: TrendPoint[];
  height?: number;
}) {
  if (points.length < 2) {
    return (
      <p className="py-8 text-center text-sm" style={{ color: 'var(--fg-subtle)' }}>
        Not enough weigh-ins to draw a trend yet.
      </p>
    );
  }

  const width = 320;
  const pad = { top: 10, right: 6, bottom: 18, left: 30 };

  const values = points.flatMap((p) => [p.raw, p.smoothed]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Never start the y-axis at zero for bodyweight: it compresses the real
  // change into a flat line and hides genuine progress.
  const span = Math.max(max - min, 1);
  const yMin = min - span * 0.15;
  const yMax = max + span * 0.15;

  const x = (i: number) =>
    pad.left + (i / (points.length - 1)) * (width - pad.left - pad.right);
  const y = (v: number) =>
    pad.top + (1 - (v - yMin) / (yMax - yMin)) * (height - pad.top - pad.bottom);

  const trendPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.smoothed)}`).join(' ');

  const ticks = [yMax, (yMax + yMin) / 2, yMin];

  return (
    <figure>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label={`Weight over ${points.length} readings, from ${points[0].smoothed.toFixed(1)} to ${points[points.length - 1].smoothed.toFixed(1)} kilograms.`}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--line)"
              strokeWidth={1}
            />
            <text
              x={pad.left - 5}
              y={y(t) + 3.5}
              textAnchor="end"
              fontSize={9}
              fill="var(--fg-subtle)"
            >
              {t.toFixed(1)}
            </text>
          </g>
        ))}

        {/* Raw readings, deliberately de-emphasised. */}
        {points.map((p, i) => (
          <circle key={p.date} cx={x(i)} cy={y(p.raw)} r={1.8} fill="var(--fg-subtle)" opacity={0.45} />
        ))}

        <path d={trendPath} fill="none" stroke="var(--fg)" strokeWidth={2.5} strokeLinecap="round" />

        <text x={pad.left} y={height - 4} fontSize={9} fill="var(--fg-subtle)">
          {points[0].date.slice(5)}
        </text>
        <text x={width - pad.right} y={height - 4} textAnchor="end" fontSize={9} fill="var(--fg-subtle)">
          {points[points.length - 1].date.slice(5)}
        </text>
      </svg>

      <figcaption className="mt-1 flex items-center gap-4 text-xs" style={{ color: 'var(--fg-subtle)' }}>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: 'var(--fg)' }} />
          Trend (kg)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-1.5 rounded-full" style={{ background: 'var(--fg-subtle)' }} />
          Daily readings
        </span>
      </figcaption>
    </figure>
  );
}
