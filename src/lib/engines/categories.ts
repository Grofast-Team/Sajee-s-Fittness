/**
 * What categories this app supports, and whether a given user has one
 * switched on.
 *
 * Categories are a code-defined registry, not a database table. A category
 * only exists once its pages ship, so a table of category *definitions*
 * would only be a join for something the code already knows. The one thing
 * that genuinely is per-user data is *enabled state*, which lives in
 * `public.user_categories` (see the migration in this same phase) and is
 * read by a later data-layer function - never by this module.
 *
 * Everything here is pure: no database read, no clock, no framework
 * import with runtime cost - the same discipline as the rest of
 * `src/lib/engines`. Icons are kebab-case strings rather than live
 * `lucide-react` component references, so this module stays free of a
 * framework dependency; the render layer resolves the string to a
 * component where it already imports icons.
 */

export interface CategoryDefinition {
  key: string;
  label: string;
  route: string;
  requiresSetup: boolean;
  icon: string;
  /** Sub-features (currently only Coach) have no user_categories row of
   *  their own - their visibility is computed from this parent's enabled
   *  state. See isCategoryVisible. */
  parentKey?: string;
}

export const CATEGORIES: CategoryDefinition[] = [
  { key: 'money', label: 'Money', route: '/money', requiresSetup: false, icon: 'wallet' },
  { key: 'fitness', label: 'Fitness', route: '/today', requiresSetup: true, icon: 'footprints' },
  { key: 'reminders', label: 'Reminders', route: '/reminders', requiresSetup: false, icon: 'bell' },
  { key: 'checklist', label: 'Checklist', route: '/checklist', requiresSetup: false, icon: 'check-square' },
  { key: 'cycle', label: 'Cycle', route: '/cycle', requiresSetup: false, icon: 'droplet' },
  {
    key: 'coach',
    label: 'Coach',
    route: '/coach',
    requiresSetup: false,
    icon: 'message-circle-heart',
    parentKey: 'fitness',
  },
];

export function findCategory(key: string): CategoryDefinition | undefined {
  return CATEGORIES.find((c) => c.key === key);
}

/**
 * Is this category visible to a user who has the given top-level
 * categories enabled?
 *
 * The algorithm is generic, not special-cased for Coach: a category with no
 * parentKey is gated on its own key; a category with a parentKey is gated
 * on the parent's key instead. The next sub-feature (a future `Food >
 * Kitchen`, say) costs one registry entry, not new logic here.
 *
 * Takes only the enabled set - never a user id, a plan, or a database
 * handle - so a caller has no way to make a category visible except by
 * putting its gating key in that set. In particular, nothing about an
 * active fitness plan can make Fitness visible; only user_categories can.
 */
export function isCategoryVisible(key: string, enabled: ReadonlySet<string>): boolean {
  const category = findCategory(key);
  if (!category) return false;

  const gateKey = category.parentKey ?? category.key;
  // A parentKey pointing at a typo'd or removed category must not silently
  // grant visibility to anyone.
  if (!findCategory(gateKey)) return false;

  return enabled.has(gateKey);
}

/** Every category currently visible to this user, in registry order. */
export function visibleCategories(enabled: ReadonlySet<string>): CategoryDefinition[] {
  return CATEGORIES.filter((c) => isCategoryVisible(c.key, enabled));
}
