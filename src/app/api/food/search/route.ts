import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { searchSampleFoods } from '@/lib/sample-foods';

/**
 * Food search.
 *
 * A pure database path with no AI involved, so logging keeps working when every
 * model is offline. That matters: logging is the one thing a user does every
 * day, and it must never depend on a third party being up.
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get('q')?.trim() ?? '';

  if (q.length < 2) {
    return NextResponse.json({ results: [], source: 'none' });
  }

  if (!supabaseConfigured) {
    // Sample mode: the same seed rows, matched with the same fuzzy behaviour.
    return NextResponse.json({
      source: 'sample',
      results: searchSampleFoods(q).map((f) => ({
        id: f.slug,
        name: f.name,
        nameLocal: f.nameLocal,
        category: f.category,
        foodState: f.foodState,
        kcalPer100g: f.kcalPer100g,
        proteinPer100g: f.proteinPer100g,
        carbPer100g: f.carbPer100g,
        fatPer100g: f.fatPer100g,
        fibrePer100g: f.fibrePer100g,
        defaultServingG: f.defaultServingG,
        servings: f.servings,
        isVegetarian: f.isVegetarian,
      })),
    });
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });

  const { data, error } = await supabase.rpc('search_foods', { q, max_results: 15 });

  if (error) {
    console.error('food search failed', error);
    return NextResponse.json(
      { error: 'search_failed', message: 'Search is unavailable right now. Please try again.' },
      { status: 503 },
    );
  }

  const ids = (data ?? []).map((row: { id: string }) => row.id);
  const { data: servings } = await supabase
    .from('food_servings')
    .select('food_id, unit_label, grams, is_default')
    .in('food_id', ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000']);

  const byFood = new Map<string, { unitLabel: string; grams: number }[]>();
  for (const s of servings ?? []) {
    const list = byFood.get(s.food_id) ?? [];
    list.push({ unitLabel: s.unit_label, grams: Number(s.grams) });
    byFood.set(s.food_id, list);
  }

  return NextResponse.json({
    source: 'database',
    results: (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id,
      name: row.name,
      nameLocal: row.name_local,
      category: row.category,
      foodState: row.food_state,
      kcalPer100g: Number(row.kcal_per_100g),
      // Drives whether the live estimate shows a figure or a range.
      verified: row.is_verified === true,
      proteinPer100g: Number(row.protein_per_100g),
      carbPer100g: Number(row.carb_per_100g),
      fatPer100g: Number(row.fat_per_100g),
      fibrePer100g: row.fibre_per_100g == null ? null : Number(row.fibre_per_100g),
      defaultServingG: row.default_serving_g == null ? null : Number(row.default_serving_g),
      servings: byFood.get(row.id as string) ?? [],
      isVegetarian: row.is_vegetarian,
      matchedAlias: row.matched_alias,
    })),
  });
}
