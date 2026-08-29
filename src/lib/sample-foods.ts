import type { FoodDensity } from './engines/nutrition';

/**
 * A small subset of the seed food data, bundled for sample mode so food search
 * is demonstrable before Supabase is configured.
 *
 * These are the same rows as `supabase/seed/0001_foods.sql`, and carry the same
 * caveat: approximate published values, not yet reconciled against IFCT 2017 or
 * USDA. They are not invented — but they are not verified either.
 *
 * Once Supabase is configured, search goes to `search_foods()` instead and this
 * file is unused.
 */

export interface SampleFood extends FoodDensity {
  slug: string;
  nameLocal: string | null;
  category: string;
  isVegetarian: boolean;
  defaultServingG: number;
  servings: { unitLabel: string; grams: number }[];
  aliases: string[];
}

export const SAMPLE_FOODS: SampleFood[] = [
  {
    slug: 'idli', name: 'Idli', nameLocal: 'இட்லி', category: 'grain_dish',
    kcalPer100g: 128, proteinPer100g: 3.4, carbPer100g: 26, fatPer100g: 0.6, fibrePer100g: 1.0,
    foodState: 'cooked', isVegetarian: true, defaultServingG: 40,
    servings: [{ unitLabel: 'piece', grams: 40 }],
    aliases: ['idly', 'iddli', 'itly'],
  },
  {
    slug: 'dosa-plain', name: 'Dosa (plain)', nameLocal: 'தோசை', category: 'grain_dish',
    kcalPer100g: 168, proteinPer100g: 3.9, carbPer100g: 29, fatPer100g: 3.7, fibrePer100g: 1.2,
    foodState: 'cooked', isVegetarian: true, defaultServingG: 80,
    servings: [{ unitLabel: 'piece', grams: 80 }],
    aliases: ['dosai', 'thosai', 'dosha', 'dose'],
  },
  {
    slug: 'sambar', name: 'Sambar', nameLocal: 'சாம்பார்', category: 'curry',
    kcalPer100g: 85, proteinPer100g: 3.8, carbPer100g: 11, fatPer100g: 2.8, fibrePer100g: 2.5,
    foodState: 'cooked', isVegetarian: true, defaultServingG: 150,
    servings: [{ unitLabel: 'katori', grams: 150 }, { unitLabel: 'ladle', grams: 80 }],
    aliases: ['sambhar', 'saambar'],
  },
  {
    slug: 'rice-white-cooked', name: 'Rice, white (cooked)', nameLocal: 'சாதம்', category: 'grain',
    kcalPer100g: 130, proteinPer100g: 2.6, carbPer100g: 28, fatPer100g: 0.2, fibrePer100g: 0.3,
    foodState: 'cooked', isVegetarian: true, defaultServingG: 150,
    servings: [
      { unitLabel: 'katori', grams: 150 },
      { unitLabel: 'cup', grams: 190 },
      { unitLabel: 'plate', grams: 250 },
    ],
    aliases: ['sadam', 'chawal', 'anna', 'steamed rice'],
  },
  {
    slug: 'rice-white-raw', name: 'Rice, white (raw)', nameLocal: null, category: 'grain',
    kcalPer100g: 345, proteinPer100g: 6.8, carbPer100g: 78, fatPer100g: 0.5, fibrePer100g: 0.6,
    foodState: 'raw', isVegetarian: true, defaultServingG: 60,
    servings: [{ unitLabel: 'katori', grams: 60 }],
    aliases: ['uncooked rice'],
  },
  {
    slug: 'chapati', name: 'Chapati / Roti', nameLocal: 'रोटी', category: 'grain_dish',
    kcalPer100g: 250, proteinPer100g: 8, carbPer100g: 46, fatPer100g: 3.5, fibrePer100g: 5,
    foodState: 'cooked', isVegetarian: true, defaultServingG: 40,
    servings: [{ unitLabel: 'piece', grams: 40 }],
    aliases: ['roti', 'phulka', 'chappathi'],
  },
  {
    slug: 'dal-tadka', name: 'Dal (tadka)', nameLocal: 'दाल तड़का', category: 'curry',
    kcalPer100g: 120, proteinPer100g: 6, carbPer100g: 15, fatPer100g: 4, fibrePer100g: 4,
    foodState: 'cooked', isVegetarian: true, defaultServingG: 150,
    servings: [{ unitLabel: 'katori', grams: 150 }],
    aliases: ['dal', 'daal', 'paruppu'],
  },
  {
    slug: 'curd-plain', name: 'Curd (dahi)', nameLocal: 'தயிர்', category: 'dairy',
    kcalPer100g: 62, proteinPer100g: 3.4, carbPer100g: 4.8, fatPer100g: 3.3, fibrePer100g: 0,
    foodState: 'as_sold', isVegetarian: true, defaultServingG: 150,
    servings: [{ unitLabel: 'katori', grams: 150 }],
    aliases: ['yogurt', 'dahi', 'thayir', 'mosaru', 'perugu'],
  },
  {
    slug: 'egg-whole-boiled', name: 'Egg, boiled', nameLocal: 'முட்டை', category: 'protein',
    kcalPer100g: 155, proteinPer100g: 13, carbPer100g: 1.1, fatPer100g: 11, fibrePer100g: 0,
    foodState: 'cooked', isVegetarian: false, defaultServingG: 50,
    servings: [{ unitLabel: 'piece', grams: 50 }],
    aliases: ['muttai', 'anda', 'boiled egg'],
  },
  {
    slug: 'chicken-curry', name: 'Chicken curry', nameLocal: 'கோழி குழம்பு', category: 'curry',
    kcalPer100g: 180, proteinPer100g: 16, carbPer100g: 4, fatPer100g: 11, fibrePer100g: 1,
    foodState: 'cooked', isVegetarian: false, defaultServingG: 150,
    servings: [{ unitLabel: 'katori', grams: 150 }],
    aliases: ['kozhi kuzhambu', 'chicken gravy'],
  },
  {
    slug: 'paneer', name: 'Paneer', nameLocal: 'पनीर', category: 'dairy',
    kcalPer100g: 265, proteinPer100g: 18, carbPer100g: 3.5, fatPer100g: 20, fibrePer100g: 0,
    foodState: 'as_sold', isVegetarian: true, defaultServingG: 100,
    servings: [{ unitLabel: 'piece', grams: 25 }],
    aliases: ['cottage cheese'],
  },
  {
    slug: 'soya-chunks', name: 'Soya chunks (dry)', nameLocal: null, category: 'legume',
    kcalPer100g: 345, proteinPer100g: 52, carbPer100g: 33, fatPer100g: 0.5, fibrePer100g: 13,
    foodState: 'dry', isVegetarian: true, defaultServingG: 30,
    servings: [{ unitLabel: 'katori', grams: 30 }],
    aliases: ['meal maker', 'soya nuggets'],
  },
  {
    slug: 'oil-sunflower', name: 'Cooking oil', nameLocal: 'எண்ணெய்', category: 'fat',
    kcalPer100g: 884, proteinPer100g: 0, carbPer100g: 0, fatPer100g: 100, fibrePer100g: 0,
    foodState: 'as_sold', isVegetarian: true, defaultServingG: 5,
    servings: [{ unitLabel: 'teaspoon', grams: 5 }, { unitLabel: 'tablespoon', grams: 15 }],
    aliases: ['ennai', 'tel', 'refined oil'],
  },
  {
    slug: 'tea-with-milk-sugar', name: 'Tea with milk and sugar', nameLocal: 'சாய்', category: 'beverage',
    kcalPer100g: 62, proteinPer100g: 1.4, carbPer100g: 9, fatPer100g: 2, fibrePer100g: 0,
    foodState: 'cooked', isVegetarian: true, defaultServingG: 150,
    servings: [{ unitLabel: 'cup', grams: 150 }],
    aliases: ['chai', 'tea'],
  },
  {
    slug: 'banana', name: 'Banana', nameLocal: 'வாழைப்பழம்', category: 'fruit',
    kcalPer100g: 89, proteinPer100g: 1.1, carbPer100g: 23, fatPer100g: 0.3, fibrePer100g: 2.6,
    foodState: 'raw', isVegetarian: true, defaultServingG: 110,
    servings: [{ unitLabel: 'piece', grams: 110 }],
    aliases: ['vazhaipazham', 'kela'],
  },
];

/**
 * Trigram-ish fuzzy match, mirroring what `search_foods()` does in SQL so the
 * sample mode behaves the same way the real thing will.
 */
export function searchSampleFoods(query: string, limit = 12): SampleFood[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const scored = SAMPLE_FOODS.map((food) => {
    const haystacks = [food.name, food.nameLocal ?? '', food.category, ...food.aliases].map((h) =>
      h.toLowerCase(),
    );

    let score = 0;
    for (const h of haystacks) {
      score = Math.max(score, scoreOne(h, q));
    }
    return { food, score };
  });

  // 0.55 rather than pg_trgm's default 0.3. At 0.3, "dosai" matches curd via its
  // "mosaru" alias and "chawal" matches "chai" — shared bigrams, unrelated
  // foods. That is exactly the confident-looking nonsense that makes a search
  // box feel broken.
  //
  // Every real spelling variant clears 0.55 comfortably: thosai/dosai and
  // idly/idli both score 0.67, sambhar/sambar 0.73. The near misses sit at 0.44
  // and 0.50, so the gap is wide enough not to be fragile.
  return scored
    .filter((s) => s.score >= 0.55)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.food);
}

/**
 * Score one haystack string against the query.
 *
 * Word-boundary matches rank far above mid-word ones. Without that distinction,
 * searching "oil" returns "b-oil-ed egg" alongside cooking oil, which looks
 * like a bug to everyone except the substring operator.
 */
function scoreOne(haystack: string, q: string): number {
  if (haystack === q) return 1;
  if (haystack.startsWith(q)) return 0.9;
  if (haystack.split(/[\s(),/-]+/).some((word) => word.startsWith(q))) return 0.85;
  // Mid-word containment scores below the cutoff on its own. It survives only
  // when a fuzzy match on the same food also clears the bar.
  if (haystack.includes(q)) return 0.5;
  return dice(haystack, q);
}

/** Dice coefficient over bigrams — tolerant of the "dosai"/"thosai" class of
 *  spelling difference, which is the whole point. */
function dice(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = (s: string) => {
    const out: string[] = [];
    for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
    return out;
  };
  const A = bigrams(a);
  const B = bigrams(b);
  const pool = [...B];
  let hits = 0;
  for (const g of A) {
    const i = pool.indexOf(g);
    if (i >= 0) {
      hits++;
      pool.splice(i, 1);
    }
  }
  return (2 * hits) / (A.length + B.length);
}
