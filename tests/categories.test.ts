import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  findCategory,
  isCategoryVisible,
  visibleCategories,
} from '@/lib/engines/categories';

describe('CATEGORIES', () => {
  it('defines exactly the six categories this build ships', () => {
    const keys = CATEGORIES.map((c) => c.key).sort();
    expect(keys).toEqual(
      ['checklist', 'coach', 'cycle', 'fitness', 'money', 'reminders'].sort(),
    );
  });

  it('marks only Fitness as requiring setup', () => {
    for (const category of CATEGORIES) {
      const expected = category.key === 'fitness';
      expect(category.requiresSetup, category.key).toBe(expected);
    }
  });

  it('marks only Coach as a sub-feature, parented to fitness', () => {
    for (const category of CATEGORIES) {
      if (category.key === 'coach') {
        expect(category.parentKey).toBe('fitness');
      } else {
        expect(category.parentKey, category.key).toBeUndefined();
      }
    }
  });

  it('gives every category a route and a label', () => {
    for (const category of CATEGORIES) {
      expect(category.route.startsWith('/'), category.key).toBe(true);
      expect(category.label.length, category.key).toBeGreaterThan(0);
    }
  });
});

describe('findCategory', () => {
  it('finds a known category by key', () => {
    expect(findCategory('money')?.label).toBe('Money');
  });

  it('returns undefined for an unknown key rather than throwing', () => {
    expect(findCategory('not-a-real-category')).toBeUndefined();
  });
});

describe('isCategoryVisible', () => {
  it('is visible when a top-level category is in the enabled set', () => {
    expect(isCategoryVisible('money', new Set(['money']))).toBe(true);
  });

  it('is not visible when the enabled set is empty', () => {
    expect(isCategoryVisible('money', new Set())).toBe(false);
  });

  it('is not visible when a different category is enabled', () => {
    expect(isCategoryVisible('money', new Set(['fitness']))).toBe(false);
  });

  it('resolves a sub-feature from its parent, not its own key', () => {
    // Coach has no independent toggle - only 'fitness' ever appears in the
    // enabled set, never 'coach' itself.
    expect(isCategoryVisible('coach', new Set(['fitness']))).toBe(true);
    expect(isCategoryVisible('coach', new Set(['money']))).toBe(false);
    expect(isCategoryVisible('coach', new Set(['coach']))).toBe(false);
  });

  it('returns false for a key that is not in the registry at all', () => {
    // A stray or typo'd user_categories row must never grant visibility to
    // something the registry does not define.
    expect(isCategoryVisible('not-a-real-category', new Set(['not-a-real-category']))).toBe(
      false,
    );
  });

  it(
    'cannot be influenced by an active fitness plan - the function has ' +
      'nowhere for one to enter',
    () => {
      // This is a structural test, not a behavioural one: isCategoryVisible
      // takes only an enabled set as its second argument. There is no plan,
      // no user id, no database handle anywhere in its signature, so a
      // caller cannot make Fitness visible by any means other than putting
      // 'fitness' in the enabled set - regardless of what plans says.
      expect(isCategoryVisible('fitness', new Set())).toBe(false);
      expect(isCategoryVisible('fitness', new Set(['money']))).toBe(false);
    },
  );
});

describe('visibleCategories', () => {
  it('returns nothing when nothing is enabled', () => {
    expect(visibleCategories(new Set())).toEqual([]);
  });

  it('returns enabled top-level categories and their visible sub-features', () => {
    const visible = visibleCategories(new Set(['fitness'])).map((c) => c.key);
    expect(visible).toContain('fitness');
    expect(visible).toContain('coach');
    expect(visible).not.toContain('money');
  });

  it('preserves registry order rather than enabled-set order', () => {
    const visible = visibleCategories(new Set(['fitness', 'money'])).map((c) => c.key);
    const registryOrder = CATEGORIES.map((c) => c.key).filter((k) => visible.includes(k));
    expect(visible).toEqual(registryOrder);
  });
});
