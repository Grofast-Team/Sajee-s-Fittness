import type { DayNutrition } from '@/lib/data/nutrition-history';

/**
 * The week's logged calories, against target.
 *
 * One bar colour, always — never a red bar for an over-target day. This app
 * does not colour-code food or calories as good or bad (see the safety and
 * coach copy rules elsewhere in this codebase), and a bar chart with a "you
 * failed today" colour is exactly that judgment wearing a different shape.
 * The target line lets someone draw their own conclusion; the chart's job is
 * only to show what actually happened.
 *
 * Same rendering approach as `TrendChart`: inline SVG on the server, no
 * charting library, no client JavaScript.
 */
export function NutritionHistoryChart({
  history,
  targetKcal,
  height = 140,
}: {
  history: DayNutrition[];
  targetKcal: number;
  height?: number;
}) {
  if (history.length === 0) {
    return (
      <p className="py-8 text-center text-sm" style={{ color: 'var(--fg-subtle)' }}>
        Nothing logged yet this week.
      </p>
    );
  }

  const width = 320;
  const pad = { top: 10, right: 6, bottom: 18, left: 30 };

  // Bars are a quantity, so the axis starts at zero - unlike the weight
  // chart, where starting at zero would flatten a real change into nothing.
  const maxValue = Math.max(...history.map((d) => d.kcal), targetKcal);
  const yMax = maxValue * 1.15;

  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const barGap = 6;
  const barWidth = (plotWidth - barGap * (history.length - 1)) / history.length;

  const x = (i: number) => pad.left + i * (barWidth + barGap);
  const y = (v: number) => pad.top + (1 - v / yMax) * plotHeight;

  const dayLabel = (iso: string) => {
    try {
      return new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(new Date(`${iso}T00:00:00Z`));
    } catch {
      return iso.slice(5);
    }
  };

  const totalKcal = history.reduce((s, d) => s + d.kcal, 0);
  const avgKcal = Math.round(totalKcal / history.length);

  return (
    <figure className="mx-auto max-w-xl">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label={`Calories logged over the last ${history.length} days, averaging ${avgKcal} against a target of ${targetKcal}.`}
      >
        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={y(targetKcal)}
          y2={y(targetKcal)}
          stroke="var(--fg-subtle)"
          strokeWidth={1}
          strokeDasharray="3 3"
        />

        {history.map((day, i) => (
          <rect
            key={day.date}
            x={x(i)}
            y={y(day.kcal)}
            width={barWidth}
            height={Math.max(plotHeight - (y(day.kcal) - pad.top), 0)}
            rx={2}
            fill="var(--primary)"
            opacity={0.75}
          />
        ))}

        {history.map((day, i) => (
          <text
            key={day.date}
            x={x(i) + barWidth / 2}
            y={height - 4}
            textAnchor="middle"
            fontSize={9}
            fill="var(--fg-subtle)"
          >
            {dayLabel(day.date)}
          </text>
        ))}
      </svg>

      <figcaption
        className="mt-2 flex items-center justify-center gap-4 text-[13px]"
        style={{ color: 'var(--fg-subtle)' }}
      >
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm" style={{ background: 'var(--primary)', opacity: 0.75 }} />
          Logged, {avgKcal} kcal/day average
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4" style={{ background: 'var(--fg-subtle)' }} />
          Target ({targetKcal})
        </span>
      </figcaption>
    </figure>
  );
}
