'use client';

import { useRef, useState } from 'react';
import { Camera, Loader2, Scale } from 'lucide-react';
import { Alert, Button, ConfidenceBadge } from '@/components/ui';
import { SCALE_PHOTO_TIPS, WHY_THE_SCALE_HELPS } from '@/lib/engines/portion';

type AnalysisItem = {
  name: string;
  localName: string | null;
  count: number | null;
  matchedFoodName: string | null;
  needsFoodMatch: boolean;
  portion: {
    grams: number | null;
    gramsLow: number | null;
    gramsHigh: number | null;
    basis: string;
    confidence: 'high' | 'medium' | 'low';
    explanation: string;
    questions: { id: string; question: string; options?: string[]; because: string }[];
  };
  nutrition: { display: string; proteinG: number; confidence: string } | null;
};

type AnalysisResponse = {
  analysisId: string | null;
  scale: { present: boolean; displayReadable: boolean; value: number | null; unit: string | null };
  items: AnalysisItem[];
  questions: string[];
  overallConfidence: 'high' | 'medium' | 'low';
};

/**
 * The scale-first photo flow.
 *
 * The instructions come *before* the camera opens, not after the photo fails.
 * Teaching the habit up front is the entire difference between a measured
 * portion and a guessed one, and portion error dwarfs every other source of
 * error in food tracking.
 *
 * This draws no card of its own — the Food screen supplies the panel.
 */
export function ScalePhotoLogger() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<AnalysisResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setStatus('working');
    setError(null);
    setResult(null);

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('read failed'));
      reader.readAsDataURL(file);
    });
    setPreview(dataUrl);

    try {
      const res = await fetch('/api/food/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(body.message ?? 'Something went wrong analysing that photo.');
        setStatus('error');
        return;
      }
      setResult(body as AnalysisResponse);
      setStatus('done');
    } catch {
      setError(
        "We couldn't reach the analysis service. Your photo hasn't been lost — you can search " +
          'for the food manually instead.',
      );
      setStatus('error');
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="inline-flex items-center gap-2 text-[15px] font-semibold">
          <Scale size={17} aria-hidden style={{ color: 'var(--primary)' }} />
          Photograph it on a scale
        </h3>
        <span className="shrink-0 text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
          Most accurate
        </span>
      </div>

      <p className="text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
        {WHY_THE_SCALE_HELPS}
      </p>

      {/* Numbered because this genuinely is a sequence — do these in order and
          the photo works; do them out of order and it does not. */}
      <ol className="mt-3 space-y-2">
        {SCALE_PHOTO_TIPS.map((tip, i) => (
          <li key={tip} className="flex gap-2.5 text-sm">
            <span
              className="data mt-px flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
              style={{ background: 'var(--primary-light)', color: 'var(--primary-dark)' }}
              aria-hidden
            >
              {i + 1}
            </span>
            <span>{tip}</span>
          </li>
        ))}
      </ol>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      <Button
        className="mt-4"
        fullWidth
        onClick={() => inputRef.current?.click()}
        disabled={status === 'working'}
      >
        {status === 'working' ? (
          <>
            <Loader2 size={18} className="animate-spin" aria-hidden /> Analysing…
          </>
        ) : (
          <>
            <Camera size={18} aria-hidden /> Take a photo
          </>
        )}
      </Button>

      <p className="mt-2 text-center text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
        No scale? Take the photo anyway — we will give you a range and ask a question or two.
      </p>

      {preview ? (
        <figure className="mt-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview}
            alt="The meal you photographed"
            className="w-full object-cover"
            style={{ maxHeight: 280, borderRadius: 'var(--radius-control)' }}
          />
          <figcaption className="mt-1.5 text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
            {status === 'working' ? 'Analysing this photo…' : 'Your photo'}
          </figcaption>
        </figure>
      ) : null}

      {status === 'error' && error ? (
        <div className="mt-4">
          <Alert tone="warning" title="Analysis unavailable">
            {error} Search for the food below instead — it works without AI.
          </Alert>
        </div>
      ) : null}

      {status === 'done' && result ? <AnalysisResult result={result} /> : null}
    </div>
  );
}

function AnalysisResult({ result }: { result: AnalysisResponse }) {
  const scaleUsed = result.scale.present && result.scale.displayReadable;

  return (
    <div className="mt-5 border-t pt-5" style={{ borderColor: 'var(--line)' }}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold">What we found</h3>
        <span className="shrink-0 text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
          {scaleUsed ? 'Weighed' : 'Estimated'}
        </span>
      </div>

      <Alert tone={scaleUsed ? 'success' : 'warning'}>
        {scaleUsed
          ? `We read ${result.scale.value}${result.scale.unit} from your scale, so these numbers are based on a measured weight rather than a guess.`
          : 'We could not read a scale in this photo, so the portions below are ranges. A photo cannot show weight, and we would rather be honest than precise-looking.'}
      </Alert>

      <ul className="mt-3 divide-y">
        {result.items.map((item) => (
          <li key={item.name} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {item.count ? `${item.count} × ` : ''}
                  {item.name}
                  {item.localName ? (
                    <span className="font-normal" style={{ color: 'var(--fg-subtle)' }}>
                      {' '}
                      ({item.localName})
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-sm" style={{ color: 'var(--fg-muted)' }}>
                  {item.portion.explanation}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="data text-sm font-semibold">
                  {item.nutrition ? item.nutrition.display : '—'}
                </p>
                <div className="mt-1">
                  <ConfidenceBadge level={item.portion.confidence} />
                </div>
              </div>
            </div>

            {item.needsFoodMatch ? (
              <p className="mt-2 text-sm" style={{ color: 'var(--signal)' }}>
                We do not have &ldquo;{item.name}&rdquo; in the food database yet, so it is not
                counted in your total. Search for it below instead.
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      {result.questions.length > 0 ? (
        <div className="mt-4">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h4 className="text-sm font-semibold">A couple of questions</h4>
            <span className="shrink-0 text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
              Improves accuracy
            </span>
          </div>
          <ul className="space-y-2">
            {result.questions.map((q) => (
              <li key={q} className="flex gap-2.5 text-sm">
                <span aria-hidden style={{ color: 'var(--fg-subtle)' }}>
                  —
                </span>
                <span>{q}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/*
       * There is no "Confirm and log" button here yet, and that is deliberate
       * rather than an oversight. Saving an analysed photo needs a server action
       * that does not exist, so a button offering it would silently do nothing
       * with a meal someone believes they have just recorded. Saying so is worse
       * looking and better behaved.
       */}
      <div className="mt-4">
        <Alert tone="info" title="Logging straight from a photo is not built yet">
          The analysis above is real, but nothing saves it to your day so far. Use the search below
          to log what you ate — your photo stays on screen while you do.
        </Alert>
      </div>
    </div>
  );
}
