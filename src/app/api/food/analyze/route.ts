import { NextResponse } from 'next/server';
import { generateObject } from 'ai';
import { foodPhotoAnalysisSchema } from '@/lib/ai/schemas';
import { FOOD_PHOTO_SYSTEM } from '@/lib/ai/prompts';
import { MODELS, aiConfigured, supabaseConfigured } from '@/lib/config';
import { resolvePortion, type ScaleReading } from '@/lib/engines/portion';
import { estimateNutrition, type FoodDensity } from '@/lib/engines/nutrition';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 60;

/**
 * Food photo analysis.
 *
 * The pipeline is deliberately split:
 *
 *   vision model  -> identifies food, reads the scale display   (no numbers)
 *   food database -> supplies nutrition per 100 g               (sourced)
 *   portion engine-> decides how much to trust the portion       (pure)
 *   calc engine   -> produces the energy figure                  (pure)
 *
 * The model never sees a calorie field and therefore cannot invent one.
 */
export async function POST(request: Request) {
  if (!aiConfigured) {
    // Honest failure. The client falls back to manual search, which is a pure
    // database path and works with every model offline.
    return NextResponse.json(
      {
        error: 'ai_unavailable',
        message:
          'Photo analysis is not configured on this deployment. You can search for the food ' +
          'manually instead — that works without AI.',
      },
      { status: 503 },
    );
  }

  let imageDataUrl: string;
  try {
    const body = await request.json();
    imageDataUrl = body.image;
    if (typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image/')) {
      return NextResponse.json({ error: 'bad_request', message: 'No image supplied.' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'bad_request', message: 'Malformed request.' }, { status: 400 });
  }

  // Require a signed-in user whenever auth is available: meal photos are
  // personal health data and analyses are stored against a user id.
  let userId: string | null = null;
  if (supabaseConfigured) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
    }
    userId = data.user.id;
  }

  let analysis;
  try {
    const result = await generateObject({
      model: MODELS.vision,
      schema: foodPhotoAnalysisSchema,
      system: FOOD_PHOTO_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                'Identify the food in this photo. If a kitchen weighing scale is visible, read ' +
                'its display exactly as shown. Do not guess digits you cannot clearly see.',
            },
            { type: 'image', image: imageDataUrl },
          ],
        },
      ],
    });
    analysis = result.object;
  } catch (error) {
    console.error('food photo analysis failed', error);
    return NextResponse.json(
      {
        error: 'analysis_failed',
        message:
          "We couldn't analyse this image. Your photo hasn't been lost — you can search for the " +
          'food manually, or try again with better lighting.',
      },
      { status: 502 },
    );
  }

  if (!analysis.isFood) {
    return NextResponse.json({
      error: 'not_food',
      message: "That doesn't look like food. Try another photo?",
    });
  }

  // ---- Resolve each identified item against the database and the engines ----
  const supabase = supabaseConfigured ? await createClient() : null;

  const items = await Promise.all(
    analysis.items.map(async (item) => {
      let food: FoodDensity | null = null;
      let matchedFoodId: string | null = null;

      if (supabase) {
        const { data } = await supabase.rpc('search_foods', { q: item.name, max_results: 1 });
        const row = data?.[0];
        if (row) {
          matchedFoodId = row.id;
          food = {
            id: row.id,
            name: row.name,
            kcalPer100g: Number(row.kcal_per_100g),
            proteinPer100g: Number(row.protein_per_100g),
            carbPer100g: Number(row.carb_per_100g),
            fatPer100g: Number(row.fat_per_100g),
            fibrePer100g: row.fibre_per_100g == null ? null : Number(row.fibre_per_100g),
            foodState: row.food_state,
          };
        }
      }

      const scale: ScaleReading = {
        present: analysis.scale.present,
        displayReadable: analysis.scale.displayReadable,
        value: analysis.scale.value,
        unit: analysis.scale.unit,
        containerOnScale: analysis.scale.containerOnScale,
        notes: analysis.scale.notes,
      };

      // A scale weighs the whole plate, so its reading only maps cleanly onto a
      // single item. With several foods on one plate we fall back to visual
      // estimation per item and say so, rather than splitting the weight by
      // invented proportions.
      const singleItem = analysis.items.length === 1;

      const portion = resolvePortion({
        scale: singleItem ? scale : undefined,
        visual: item.approxGrams ? { grams: item.approxGrams } : undefined,
        household: undefined,
      });

      return {
        name: item.name,
        localName: item.localName,
        count: item.count,
        preparation: item.preparation,
        visibleOil: item.visibleOil,
        identificationConfidence: item.confidence,
        matchedFoodId,
        matchedFoodName: food?.name ?? null,
        portion,
        nutrition: food ? estimateNutrition(food, portion) : null,
        // Explicit rather than silent: an unmatched food must be findable by
        // the user, not quietly dropped from the total.
        needsFoodMatch: food === null,
      };
    }),
  );

  const questions = [
    ...new Set([
      ...items.flatMap((i) => i.portion.questions.map((q) => q.question)),
      ...analysis.clarifyingQuestions,
    ]),
  ].slice(0, 3);

  // Persist the model's estimate. The user's correction is written later, to
  // the same row, so the system can learn this person's real portions.
  let analysisId: string | null = null;
  if (supabase && userId) {
    const { data } = await supabase
      .from('ai_food_analyses')
      .insert({
        user_id: userId,
        model: MODELS.vision,
        scale_present: analysis.scale.present,
        scale_readable: analysis.scale.displayReadable,
        scale_value: analysis.scale.value,
        scale_unit: analysis.scale.unit,
        container_on_scale: analysis.scale.containerOnScale,
        ai_items: analysis.items,
        ai_confidence: analysis.overallConfidence,
        clarifications: questions,
        status: questions.length > 0 ? 'needs_input' : 'pending',
      })
      .select('id')
      .single();
    analysisId = data?.id ?? null;
  }

  return NextResponse.json({
    analysisId,
    scale: analysis.scale,
    items,
    questions,
    overallConfidence: analysis.overallConfidence,
  });
}
