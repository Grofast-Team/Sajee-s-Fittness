import { describe, expect, it } from 'vitest';
import { searchSampleFoods } from '@/lib/sample-foods';

/**
 * Food search precision.
 *
 * Search is the highest-frequency action in the app and the one that must work
 * with no AI and no network beyond the database. These cases lock in both
 * halves of the behaviour: it has to find the right food through regional
 * spellings, and it has to *not* return confident-looking nonsense alongside it.
 */

const names = (q: string) => searchSampleFoods(q).map((f) => f.name);

describe('regional names and spellings resolve to the right food', () => {
  it.each([
    ['dosai', 'Dosa (plain)'],
    ['thosai', 'Dosa (plain)'],
    ['dosha', 'Dosa (plain)'],
    ['idly', 'Idli'],
    ['iddli', 'Idli'],
    ['sambhar', 'Sambar'],
    ['saambar', 'Sambar'],
    ['thayir', 'Curd (dahi)'],
    ['dahi', 'Curd (dahi)'],
    ['mosaru', 'Curd (dahi)'],
    ['chawal', 'Rice, white (cooked)'],
    ['sadam', 'Rice, white (cooked)'],
    ['roti', 'Chapati / Roti'],
    ['muttai', 'Egg, boiled'],
    ['meal maker', 'Soya chunks (dry)'],
    ['kozhi kuzhambu', 'Chicken curry'],
    ['chai', 'Tea with milk and sugar'],
  ])('%s finds %s', (query, expected) => {
    expect(names(query)[0]).toBe(expected);
  });
});

describe('it does not return unrelated foods', () => {
  it('does not match curd for "dosai" through the mosaru alias', () => {
    expect(names('dosai')).not.toContain('Curd (dahi)');
  });

  it('does not match tea for "chawal"', () => {
    expect(names('chawal')).not.toContain('Tea with milk and sugar');
  });

  it('does not match boiled egg for "oil"', () => {
    // "b-oil-ed egg" is a substring hit and nothing more.
    expect(names('oil')).not.toContain('Egg, boiled');
    expect(names('oil')).toContain('Cooking oil');
  });

  it('returns nothing for gibberish rather than a nearest guess', () => {
    expect(searchSampleFoods('xyzzy')).toHaveLength(0);
    expect(searchSampleFoods('qqqqqq')).toHaveLength(0);
  });

  it('ignores queries that are too short to be meaningful', () => {
    expect(searchSampleFoods('d')).toHaveLength(0);
    expect(searchSampleFoods('')).toHaveLength(0);
  });
});

describe('raw and cooked stay distinct', () => {
  it('surfaces both rice records, so the user picks the right state', () => {
    const rice = searchSampleFoods('rice');
    const states = rice.filter((f) => f.name.startsWith('Rice')).map((f) => f.foodState);
    expect(states).toContain('cooked');
    expect(states).toContain('raw');
  });

  it('keeps their energy densities far apart', () => {
    const cooked = searchSampleFoods('rice').find((f) => f.slug === 'rice-white-cooked');
    const raw = searchSampleFoods('rice').find((f) => f.slug === 'rice-white-raw');
    // 100 g of raw rice is not 100 g of cooked rice. Conflating them roughly
    // triples the logged energy.
    expect(raw!.kcalPer100g).toBeGreaterThan(cooked!.kcalPer100g * 2);
  });
});

describe('every food is usable once found', () => {
  it('has at least one serving unit and sane composition', () => {
    for (const food of searchSampleFoods('a', 100).concat(searchSampleFoods('e', 100))) {
      expect(food.servings.length).toBeGreaterThan(0);
      expect(food.kcalPer100g).toBeGreaterThanOrEqual(0);
      // Atwater sanity: macros should roughly reconstruct the energy value.
      const fromMacros = food.proteinPer100g * 4 + food.carbPer100g * 4 + food.fatPer100g * 9;
      expect(Math.abs(fromMacros - food.kcalPer100g)).toBeLessThan(food.kcalPer100g * 0.25 + 25);
    }
  });
});
