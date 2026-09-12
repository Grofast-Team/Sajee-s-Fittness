/**
 * What the food you logged is worth, and how that sits against your budget.
 *
 * ## This is not a record of money spent
 *
 * `food_logs.cost` is derived from `foods.typical_cost_per_100g` — a seeded
 * table of representative prices with no provenance column and no receipts
 * behind it. Real prices move with the city, the season, the shop, and above
 * all with whether the food was cooked at home or bought ready-made. The same
 * dosa is a rupee or two at home and thirty in a restaurant.
 *
 * So this produces an **estimate of what the logged food is worth at typical
 * prices**, and the wording never calls it spending. The `spends` table is the
 * ledger; this is a cross-check against it.
 *
 * ## Why it is never added to the spend total
 *
 * Someone who logs their meals *and* records a ₹340 grocery shop has described
 * the same money twice. Summing the two would silently inflate their spending
 * and then, because the money screen compares against a monthly limit, tell
 * them they had overspent when they had not. Kept side by side, the two
 * numbers are useful precisely because they are independent.
 */

export interface FoodCostDay {
  date: string;
  /** Sum of `food_logs.cost` for the day, in rupees. Null when nothing priced. */
  costRupees: number | null;
  entriesPriced: number;
  entriesTotal: number;
}

export interface FoodCostInput {
  days: FoodCostDay[];
  /** Daily food budget from onboarding, in rupees. Null when never set. */
  dailyBudgetRupees: number | null;
  /** Days in the money month so far, for a fair budget comparison. */
  daysElapsed: number;
  /**
   * How much of what this person eats actually reaches the log, as a fraction
   * of their energy target.
   *
   * Without this the comparison is quietly nonsense. Someone logging two of
   * five meals produces a cost estimate covering two of five meals, and
   * comparing that against a whole day's budget reports them as comfortably
   * under when the truth is unknown. Prices being approximate is a stated
   * caveat; the log covering a third of the food is a reason not to make the
   * claim at all.
   */
  energyCoverage?: number | null;
}

export interface FoodCostView {
  totalRupees: number;
  lowRupees: number;
  highRupees: number;
  /** Days that had at least one priced entry. */
  daysWithData: number;
  perDayRupees: number | null;
  entriesPriced: number;
  entriesUnpriced: number;
  budgetDailyRupees: number | null;
  budgetToDateRupees: number | null;
  /** Plain-language summary. Factual, never a telling-off. */
  verdict: string;
  caveats: string[];
  /** Always at best medium: these are typical prices, not receipts. */
  confidence: 'medium' | 'low';
  /** True when there is too little priced data to say anything useful. */
  insufficient: boolean;
}

/*
 * How wrong a typical price can be.
 *
 * A stated modelling assumption, not a measurement. ±25% is a conservative
 * band for the spread between a home kitchen and a shop, across cities and
 * seasons — wide enough to be honest, narrow enough to still be worth showing.
 */
const PRICE_ERROR = 0.25;

/** Below this share of entries priced, the total understates too much to use. */
const MIN_PRICED_SHARE = 0.5;

/**
 * Below this share of a day's energy logged, we will not compare to a budget.
 *
 * Two thirds is lenient — nobody logs perfectly — but it is enough to rule out
 * the case that produces the worst error: a partial log making someone look
 * far under budget because most of their food was never entered.
 */
const MIN_ENERGY_COVERAGE = 0.65;

const round = (n: number) => Math.round(n);

export function summariseFoodCost(input: FoodCostInput): FoodCostView {
  const entriesPriced = input.days.reduce((s, d) => s + d.entriesPriced, 0);
  const entriesTotal = input.days.reduce((s, d) => s + d.entriesTotal, 0);
  const entriesUnpriced = entriesTotal - entriesPriced;

  const totalRupees = input.days.reduce((s, d) => s + (d.costRupees ?? 0), 0);
  const daysWithData = input.days.filter((d) => d.entriesPriced > 0).length;

  const budgetToDate =
    input.dailyBudgetRupees === null
      ? null
      : round(input.dailyBudgetRupees * Math.max(1, input.daysElapsed));

  const caveats: string[] = [
    'Worked out from typical prices, not from what you actually paid. Cooking at home costs ' +
      'far less than buying the same dish ready-made.',
  ];

  if (entriesTotal === 0 || entriesPriced === 0) {
    return {
      totalRupees: 0,
      lowRupees: 0,
      highRupees: 0,
      daysWithData: 0,
      perDayRupees: null,
      entriesPriced: 0,
      entriesUnpriced,
      budgetDailyRupees: input.dailyBudgetRupees,
      budgetToDateRupees: budgetToDate,
      verdict: 'Nothing logged yet this month that we have a price for.',
      caveats,
      confidence: 'low',
      insufficient: true,
    };
  }

  const pricedShare = entriesTotal === 0 ? 0 : entriesPriced / entriesTotal;
  const coverage = input.energyCoverage ?? null;
  const partialLog = coverage !== null && coverage < MIN_ENERGY_COVERAGE;
  const thin = pricedShare < MIN_PRICED_SHARE || partialLog;

  if (partialLog) {
    caveats.push(
      `Only about ${Math.round((coverage as number) * 100)}% of your daily energy target is ` +
        `reaching the food log, so most of what you eat is not in this figure.`,
    );
  }

  if (entriesUnpriced > 0) {
    caveats.push(
      `${entriesUnpriced} of your ${entriesTotal} entries have no price in our data, so the real ` +
        `figure is higher than this.`,
    );
  }

  const perDay = daysWithData === 0 ? null : round(totalRupees / daysWithData);

  return {
    totalRupees: round(totalRupees),
    lowRupees: round(totalRupees * (1 - PRICE_ERROR)),
    highRupees: round(totalRupees * (1 + PRICE_ERROR)),
    daysWithData,
    perDayRupees: perDay,
    entriesPriced,
    entriesUnpriced,
    budgetDailyRupees: input.dailyBudgetRupees,
    budgetToDateRupees: budgetToDate,
    verdict: verdictFor(perDay, input.dailyBudgetRupees, thin, partialLog),
    caveats,
    confidence: thin ? 'low' : 'medium',
    insufficient: thin,
  };
}

/**
 * How the estimate sits against the budget.
 *
 * States the position and stops. No "you overspent", no exclamation marks: a
 * budget is a plan, and a plan that turns out to be wrong is information about
 * the plan at least as often as it is information about the person.
 */
function verdictFor(
  perDayRupees: number | null,
  dailyBudgetRupees: number | null,
  thin: boolean,
  partialLog: boolean,
): string {
  if (perDayRupees === null) return 'Not enough priced entries yet.';

  if (dailyBudgetRupees === null) {
    return (
      `Your logged food works out to roughly ₹${perDayRupees} a day at typical prices. ` +
      `You have not set a food budget, so there is nothing to compare it against yet.`
    );
  }

  const difference = perDayRupees - dailyBudgetRupees;
  const margin = Math.abs(difference);

  if (partialLog) {
    // The honest answer is "we cannot tell", not a number that looks like an
    // answer. Reporting "₹133 a day under budget" off a third of the food is
    // worse than reporting nothing: it is confidently wrong in the direction
    // that encourages someone to spend more.
    return (
      `We cannot compare this to your ₹${dailyBudgetRupees} a day yet — most of what you eat is ` +
      `not reaching the food log, so the figure above covers only part of your food.`
    );
  }

  if (thin) {
    return (
      `Too few of your entries are priced to compare against your ₹${dailyBudgetRupees} a day ` +
      `properly. What we can price comes to about ₹${perDayRupees} a day.`
    );
  }

  // Within a tenth of the budget is not a meaningful difference given a ±25%
  // price band. Claiming otherwise would be false precision.
  if (margin <= dailyBudgetRupees * 0.1) {
    return `About ₹${perDayRupees} a day, which is roughly your ₹${dailyBudgetRupees} budget.`;
  }

  if (difference < 0) {
    return (
      `About ₹${perDayRupees} a day against a budget of ₹${dailyBudgetRupees} — ` +
      `roughly ₹${margin} a day under.`
    );
  }

  return (
    `About ₹${perDayRupees} a day against a budget of ₹${dailyBudgetRupees} — ` +
    `roughly ₹${margin} a day over. Worth knowing whether that is the food or the budget.`
  );
}
