'use client';

import { useRef, useState } from 'react';
import { Camera, CircleAlert, Info, Loader2, Scale } from 'lucide-react';
import { Button, Card, CardTitle, ConfidenceBadge } from '@/components/ui';
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
    <div className="space-y-4">
      <Card>
        <CardTitle hint="Most accurate">
          <span className="inline-flex items-center gap-2">
            <Scale size={18} aria-hidden /> Photograph it on a scale
          </span>
        </CardTitle>

        <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
          {WHY_THE_SCALE_HELPS}
        </p>

        <ol className="mt-3 space-y-1.5">
          {SCALE_PHOTO_TIPS.map((tip, i) => (
            <li key={tip} className="flex gap-2.5 text-sm">
              <span
                className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                style={{ background: 'var(--ground)', color: 'var(--fg)' }}
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
          className="mt-4 w-full"
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

        <p className="mt-2 text-center text-xs" style={{ color: 'var(--fg-subtle)' }}>
          No scale? Take the photo anyway — we will give you a range and ask a question or two.
        </p>
      </Card>

      {preview ? (
        <Card>
          <CardTitle>Your photo</CardTitle>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview}
            alt="The meal you photographed"
            className="w-full rounded-md object-cover"
            style={{ maxHeight: 280 }}
          />
        </Card>
      ) : null}

      {status === 'error' && error ? (
        <Card className="border-dashed">
          <div className="flex gap-2.5">
            <CircleAlert size={18} className="mt-0.5 shrink-0" style={{ color: 'var(--signal)' }} aria-hidden />
            <div>
              <p className="text-sm font-medium">Analysis unavailable</p>
              <p className="mt-1 text-sm" style={{ color: 'var(--fg-muted)' }}>
                {error}
              </p>
              <Button variant="ghost" className="mt-3">
                Search for the food instead
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {status === 'done' && result ? <AnalysisResult result={result} /> : null}
    </div>
  );
}

function AnalysisResult({ result }: { result: AnalysisResponse }) {
  const scaleUsed = result.scale.present && result.scale.displayReadable;

  return (
    <>
      <Card>
        <CardTitle hint={scaleUsed ? 'Weighed' : 'Estimated'}>What we found</CardTitle>

        <div
          className="mb-3 flex items-start gap-2.5 rounded-md p-3 text-sm"
          style={{ background: 'var(--ground)' }}
        >
          <Info size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--fg)' }} aria-hidden />
          <p>
            {scaleUsed
              ? `We read ${result.scale.value}${result.scale.unit} from your scale, so these numbers are based on a measured weight rather than a guess.`
              : 'We could not read a scale in this photo, so portions below are ranges. A photo cannot show weight, and we would rather be honest than precise-looking.'}
          </p>
        </div>

        <ul className="divide-y">
          {result.items.map((item) => (
            <li key={item.name} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">
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
                  counted in your total. Search for it or add it as a custom food.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      {result.questions.length > 0 ? (
        <Card>
          <CardTitle hint="Improves accuracy">A couple of questions</CardTitle>
          <ul className="space-y-2.5">
            {result.questions.map((q) => (
              <li key={q} className="text-sm">
                {q}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs" style={{ color: 'var(--fg-subtle)' }}>
            Your answers replace our estimate, and we remember your corrections so future guesses
            get closer to how you actually serve food.
          </p>
        </Card>
      ) : null}

      <div className="flex gap-2">
        <Button className="flex-1">Confirm and log</Button>
        <Button variant="ghost" className="flex-1">
          Edit portions
        </Button>
      </div>
    </>
  );
}
