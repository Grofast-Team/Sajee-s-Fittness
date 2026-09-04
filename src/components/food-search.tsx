'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Plus, Scale, Search, X } from 'lucide-react';
import { Alert, Button, ConfidenceBadge, Field, inputClass, inputStyle } from '@/components/ui';
import { resolvePortion } from '@/lib/engines/portion';
import { estimateNutrition, type FoodDensity } from '@/lib/engines/nutrition';
import { logFood } from '@/lib/actions/food';

interface FoodResult extends FoodDensity {
  id: string;
  nameLocal: string | null;
  category: string;
  defaultServingG: number | null;
  servings: { unitLabel: string; grams: number }[];
  matchedAlias?: string | null;
}

/**
 * Food search and quick add.
 *
 * The portion control is the interesting part. Grams is offered first and
 * labelled as the accurate option, with household measures beside it — the aim
 * is to nudge towards weighing without making the person who does not own a
 * scale feel locked out.
 *
 * Nutrition is computed client-side by the same pure engine the server uses, so
 * the preview updates instantly while typing and cannot disagree with what gets
 * saved.
 *
 * Neither this nor the portion picker draws its own card: the Food screen
 * supplies the panel, and a card inside a card reads as a stack of boxes.
 */
export function FoodSearch({ canSave = false }: { canSave?: boolean }) {
  const [saved, setSaved] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoodResult[]>([]);
  const [source, setSource] = useState<string>('none');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<FoodResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Below the minimum length we simply do not render whatever is in state,
  // rather than clearing it from an effect. Same behaviour, no extra render
  // pass, and it keeps the last results warm if the user retypes.
  const active = query.trim().length >= 2;
  const visible = active ? results : [];

  // Debounced so a fast typist does not fire a request per keystroke.
  useEffect(() => {
    if (query.trim().length < 2) return;

    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);

      try {
        const res = await fetch(`/api/food/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        const body = await res.json();
        setResults(body.results ?? []);
        setSource(body.source ?? 'none');
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  if (selected) {
    return (
      <PortionPicker
        food={selected}
        canSave={canSave}
        onCancel={() => setSelected(null)}
        onSaved={(message) => {
          setSaved(message);
          setSelected(null);
          setQuery('');
          setResults([]);
        }}
      />
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold">Search for a food</h3>
        <span className="text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
          Works without AI
        </span>
      </div>

      {saved ? (
        <div className="mb-3" role="status">
          <Alert tone="success">{saved}</Alert>
        </div>
      ) : null}

      <div className="relative">
        <Search
          size={18}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
          style={{ color: 'var(--fg-subtle)' }}
          aria-hidden
        />
        <label htmlFor="food-search" className="sr-only">
          Search for a food
        </label>
        <input
          id="food-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="dosai, thayir, 2 idli…"
          autoComplete="off"
          className={`${inputClass} !pl-10 !pr-10`}
          style={inputStyle}
        />
        {loading ? (
          <Loader2
            size={16}
            className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin"
            style={{ color: 'var(--fg-subtle)' }}
            aria-hidden
          />
        ) : null}
      </div>

      <p className="mt-2 text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
        Regional names and rough spellings both work — &ldquo;thosai&rdquo;, &ldquo;dosai&rdquo; and
        &ldquo;dosa&rdquo; all find the same food.
      </p>

      {visible.length > 0 ? (
        <ul className="mt-3 divide-y">
          {visible.map((food) => (
            <li key={food.id}>
              <button
                type="button"
                onClick={() => setSelected(food)}
                className="flex min-h-14 w-full cursor-pointer items-center justify-between gap-3 py-2.5 text-left"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {food.name}
                    {food.nameLocal ? (
                      <span className="font-normal" style={{ color: 'var(--fg-subtle)' }}>
                        {' '}
                        · {food.nameLocal}
                      </span>
                    ) : null}
                  </span>
                  <span className="block text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
                    {food.kcalPer100g} kcal · {food.proteinPer100g} g protein per 100 g
                    {/* Raw and cooked are never interchangeable, so the state is
                        always visible rather than buried in the record. */}
                    {food.foodState === 'raw' || food.foodState === 'dry'
                      ? ` · ${food.foodState}, uncooked`
                      : ''}
                  </span>
                </span>
                <Plus
                  size={18}
                  className="shrink-0"
                  style={{ color: 'var(--primary)' }}
                  aria-hidden
                />
              </button>
            </li>
          ))}
        </ul>
      ) : active && !loading ? (
        /* No dead "add a custom food" button here: custom foods are not built
           yet, and a control that looks pressable but does nothing is worse
           than saying so plainly. */
        <p className="mt-4 text-sm" style={{ color: 'var(--fg-muted)' }}>
          Nothing matched &ldquo;{query}&rdquo;. Try a shorter word, or the name you would use at
          home. Adding your own foods is not built yet.
        </p>
      ) : null}

      {source === 'sample' && visible.length > 0 ? (
        <p className="mt-3 text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
          Searching a bundled sample of the food database. Connect Supabase for the full set.
        </p>
      ) : null}
    </div>
  );
}

const MEALS = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'morning_snack', label: 'Mid-morning' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'afternoon_snack', label: 'Afternoon' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'evening_snack', label: 'Evening' },
] as const;

/** Guess the meal from the clock, so the common case is one fewer tap. */
function defaultMeal(hour: number): string {
  if (hour < 10) return 'breakfast';
  if (hour < 12) return 'morning_snack';
  if (hour < 15) return 'lunch';
  if (hour < 18) return 'afternoon_snack';
  if (hour < 22) return 'dinner';
  return 'evening_snack';
}

function PortionPicker({
  food,
  canSave,
  onCancel,
  onSaved,
}: {
  food: FoodResult;
  canSave: boolean;
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  const [mode, setMode] = useState<'grams' | 'serving'>(
    food.servings.length > 0 ? 'serving' : 'grams',
  );
  const [grams, setGrams] = useState<number>(food.defaultServingG ?? 100);
  const [servingIndex, setServingIndex] = useState(0);
  const [count, setCount] = useState(1);
  const [meal, setMeal] = useState<string>(() => defaultMeal(new Date().getHours()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const serving = food.servings[servingIndex];

  const portion =
    mode === 'grams'
      ? resolvePortion({ userGrams: grams })
      : resolvePortion({
          household: { unitLabel: serving.unitLabel, grams: serving.grams, count },
        });

  const estimate = estimateNutrition(food, portion);

  /**
   * Only the food id, the meal and the portion go to the server — never the
   * calorie figure computed above. The server looks the food up and recomputes,
   * so this preview is a convenience, not the source of truth.
   */
  async function handleSave() {
    setSaving(true);
    setError(null);

    const result = await logFood({
      foodId: food.id,
      meal,
      ...(mode === 'grams' ? { grams } : { serving: { unitLabel: serving.unitLabel, count } }),
    });

    if (result.ok) {
      onSaved(`Added ${food.name} — ${result.kcal} kcal, ${result.proteinG} g protein.`);
      return;
    }

    setError(result.error);
    setSaving(false);
  }

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold">{food.name}</h3>
          {food.nameLocal ? (
            <p className="text-sm" style={{ color: 'var(--fg-subtle)' }}>
              {food.nameLocal}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg"
          style={{ background: 'var(--ground)', color: 'var(--fg-muted)' }}
        >
          <X size={16} aria-hidden />
        </button>
      </div>

      {/* Weighed sits first and is named for what it is. The interface should
          make the accurate option the obvious one without shutting out the
          person who has no scale. */}
      <div
        className="mb-4 flex gap-1 p-1"
        style={{ background: 'var(--ground)', borderRadius: 'var(--radius-control)' }}
      >
        {(
          [
            { key: 'grams', label: 'Weighed', icon: true },
            { key: 'serving', label: 'Household measure', icon: false },
          ] as const
        ).map((tab) => {
          const on = mode === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setMode(tab.key)}
              disabled={tab.key === 'serving' && food.servings.length === 0}
              aria-pressed={on}
              className="inline-flex min-h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg text-sm font-semibold transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                background: on ? 'var(--surface)' : 'transparent',
                color: on ? 'var(--primary-dark)' : 'var(--fg-muted)',
                boxShadow: on ? 'var(--shadow-sm)' : undefined,
              }}
            >
              {tab.icon ? <Scale size={15} aria-hidden /> : null}
              {tab.label}
            </button>
          );
        })}
      </div>

      {mode === 'grams' ? (
        <Field
          label="How many grams?"
          htmlFor="grams"
          description="Weighed portions are exact. This is the accurate option."
        >
          <div className="flex items-center gap-2">
            <input
              id="grams"
              type="number"
              inputMode="decimal"
              min={1}
              max={5000}
              value={grams}
              onChange={(e) => setGrams(Number(e.target.value) || 0)}
              className={`data ${inputClass}`}
              style={inputStyle}
            />
            <span className="shrink-0 text-sm" style={{ color: 'var(--fg-subtle)' }}>
              g
            </span>
          </div>
        </Field>
      ) : (
        <Field
          label="How many?"
          htmlFor="count"
          description="Household measures vary between kitchens, so this is close rather than exact."
        >
          <div className="flex gap-2">
            <input
              id="count"
              type="number"
              inputMode="decimal"
              min={0.25}
              step={0.25}
              value={count}
              onChange={(e) => setCount(Number(e.target.value) || 0)}
              className={`data ${inputClass} !w-20`}
              style={inputStyle}
            />
            <select
              aria-label="Unit"
              value={servingIndex}
              onChange={(e) => setServingIndex(Number(e.target.value))}
              className={`${inputClass} !flex-1`}
              style={inputStyle}
            >
              {food.servings.map((s, i) => (
                <option key={s.unitLabel} value={i}>
                  {s.unitLabel} ({s.grams} g)
                </option>
              ))}
            </select>
          </div>
        </Field>
      )}

      <div className="mt-4">
        <Field label="Which meal?" htmlFor="meal">
          <select
            id="meal"
            value={meal}
            onChange={(e) => setMeal(e.target.value)}
            className={inputClass}
            style={inputStyle}
          >
            {MEALS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div
        className="mt-4 p-3.5"
        style={{ background: 'var(--ground)', borderRadius: 'var(--radius-control)' }}
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="data text-2xl font-semibold">{estimate.display}</span>
          <ConfidenceBadge level={estimate.confidence} />
        </div>
        <p className="data mt-1 text-sm" style={{ color: 'var(--fg-muted)' }}>
          {estimate.proteinG} g protein · {estimate.carbG} g carbs · {estimate.fatG} g fat
          {estimate.fibreG != null ? ` · ${estimate.fibreG} g fibre` : ''}
        </p>
        <p className="mt-1.5 text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
          {portion.explanation}
        </p>
      </div>

      {error ? (
        <div className="mt-3">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}

      <Button
        className="mt-4"
        fullWidth
        disabled={saving || !canSave || estimate.kcal <= 0}
        onClick={handleSave}
      >
        {saving ? (
          <>
            <Loader2 size={18} className="animate-spin" aria-hidden /> Saving…
          </>
        ) : (
          'Add to today'
        )}
      </Button>

      {!canSave ? (
        <p className="mt-2 text-center text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
          Sign in and finish setup to save entries to your day.
        </p>
      ) : null}
    </div>
  );
}
