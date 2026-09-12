import { Badge, Section, Why } from '@/components/ui';
import type { CorrelationResult } from '@/lib/engines/correlate';

/**
 * Patterns found across everything the app records.
 *
 * The restraint is the feature. Most weeks this panel will say it found
 * nothing, and it says so as a result rather than an apology — a tracker that
 * always has an insight for you is one that is inventing them.
 */
export function PatternsPanel({ result }: { result: CorrelationResult }) {
  return (
    <Section
      title="Patterns in your data"
      meta={
        result.findings.length > 0 ? (
          <Badge tone="primary">{result.findings.length}</Badge>
        ) : undefined
      }
    >
      <p className="measure text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
        {result.summary}
      </p>

      {result.findings.length > 0 ? (
        <ul className="mt-4 space-y-3">
          {result.findings.map((f) => (
            <li
              key={`${f.aKey}-${f.bKey}`}
              className="border-l-2 py-1 pl-3.5"
              style={{ borderColor: 'var(--primary-border)' }}
            >
              <p className="text-sm leading-relaxed">{f.message}</p>
              <p className="data mt-1 text-[12px]" style={{ color: 'var(--fg-subtle)' }}>
                correlation {f.r > 0 ? '+' : ''}
                {f.r.toFixed(2)} · {f.n} days · p {f.p < 0.001 ? '< 0.001' : f.p.toFixed(3)}
              </p>
            </li>
          ))}
        </ul>
      ) : null}

      <Why label="How is this worked out, and what does it not mean?">
        <p>
          These are <strong>correlations, not causes</strong>. If your hardest sessions follow your
          shortest nights, poor sleep might be making them harder — or a stressful week might be
          causing both. The data cannot tell those apart, and neither can we.
        </p>
        <p className="mt-2">
          We only check a short list of relationships decided in advance, rather than comparing
          everything against everything. Testing enough pairs guarantees finding something that
          looks meaningful and is not.
        </p>
        <p className="mt-2">
          A pattern has to be strong as well as unlikely-by-chance before it appears here, and the
          whole batch is corrected together so that a run of tests does not manufacture a finding.
        </p>
        {result.skippedForData.length > 0 ? (
          <p className="mt-2">
            Still waiting on more days for: {result.skippedForData.slice(0, 4).join(', ')}.
          </p>
        ) : null}
      </Why>
    </Section>
  );
}
