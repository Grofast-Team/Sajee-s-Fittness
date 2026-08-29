/**
 * Adherence scoring.
 *
 * The point of this score is diagnostic, not judgmental. It exists so that when
 * progress stalls we can tell the difference between "the plan is wrong" and
 * "the plan was not run", and so the user gets told which *one* thing to change
 * rather than a list of everything they did imperfectly.
 *
 * Weighting reflects real-world leverage on fat loss, not tidiness.
 */

export interface AdherenceInput {
  daysInPeriod: number;
  daysLogged: number;
  daysWithinKcalRange: number;
  daysProteinMet: number;
  daysStepGoalMet: number;
  workoutsPlanned: number;
  workoutsCompleted: number;
  daysSleepTargetMet: number;
  weighIns: number;
}

export interface AdherenceComponent {
  key: string;
  label: string;
  score: number;   // 0-1
  weight: number;
  detail: string;
}

export interface AdherenceResult {
  score: number;   // 0-100
  band: 'excellent' | 'good' | 'mixed' | 'struggling';
  components: AdherenceComponent[];
  /** The single component with the most score left on the table. */
  biggestOpportunity: AdherenceComponent | null;
  summary: string;
}

const safeRatio = (num: number, den: number) => (den <= 0 ? 1 : Math.min(1, Math.max(0, num / den)));

export function scoreAdherence(input: AdherenceInput): AdherenceResult {
  const days = Math.max(1, input.daysInPeriod);

  const components: AdherenceComponent[] = [
    {
      key: 'logging',
      label: 'Food logging',
      score: safeRatio(input.daysLogged, days),
      weight: 0.25,
      detail: `Logged on ${input.daysLogged} of ${days} days.`,
    },
    {
      key: 'energy',
      label: 'Calorie range',
      score: safeRatio(input.daysWithinKcalRange, days),
      weight: 0.25,
      detail: `Within your range on ${input.daysWithinKcalRange} of ${days} days.`,
    },
    {
      key: 'protein',
      label: 'Protein target',
      score: safeRatio(input.daysProteinMet, days),
      weight: 0.2,
      detail: `Hit your protein target on ${input.daysProteinMet} of ${days} days.`,
    },
    {
      key: 'steps',
      label: 'Daily steps',
      score: safeRatio(input.daysStepGoalMet, days),
      weight: 0.15,
      detail: `Reached your step goal on ${input.daysStepGoalMet} of ${days} days.`,
    },
    {
      key: 'training',
      label: 'Workouts',
      score: safeRatio(input.workoutsCompleted, input.workoutsPlanned),
      weight: 0.1,
      detail:
        input.workoutsPlanned > 0
          ? `Completed ${input.workoutsCompleted} of ${input.workoutsPlanned} planned sessions.`
          : 'No sessions were scheduled this period.',
    },
    {
      key: 'sleep',
      label: 'Sleep',
      score: safeRatio(input.daysSleepTargetMet, days),
      weight: 0.05,
      detail: `Met your sleep target on ${input.daysSleepTargetMet} of ${days} days.`,
    },
  ];

  const total = components.reduce((sum, c) => sum + c.score * c.weight, 0);
  const score = Math.round(total * 1000) / 10;

  const band: AdherenceResult['band'] =
    score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 50 ? 'mixed' : 'struggling';

  // "Biggest opportunity" is the component leaking the most weighted score,
  // which is not the same as the lowest-scoring one - missing every workout
  // matters less than missing half your logging.
  const ranked = [...components]
    .filter((c) => !(c.key === 'training' && input.workoutsPlanned === 0))
    .sort((a, b) => (1 - a.score) * a.weight - (1 - b.score) * b.weight)
    .reverse();
  const biggestOpportunity = ranked.length > 0 && ranked[0].score < 0.95 ? ranked[0] : null;

  return {
    score,
    band,
    components,
    biggestOpportunity,
    summary: buildSummary(score, band, biggestOpportunity),
  };
}

function buildSummary(
  score: number,
  band: AdherenceResult['band'],
  opportunity: AdherenceComponent | null,
): string {
  const opener =
    band === 'excellent'
      ? `You followed your plan ${score}% of the time this week. That is genuinely hard to do.`
      : band === 'good'
        ? `You followed your plan ${score}% of the time this week. That is a solid week.`
        : band === 'mixed'
          ? `You followed your plan ${score}% of the time this week.`
          : `You followed your plan ${score}% of the time this week, which sounds like it was a hard one.`;

  if (!opportunity) {
    return `${opener} There is nothing obvious to fix - keep going.`;
  }

  return (
    `${opener} The one thing worth changing is ${opportunity.label.toLowerCase()}: ` +
    `${opportunity.detail} Pick that one and leave everything else exactly as it is - ` +
    `changing several things at once means we learn nothing about what worked.`
  );
}

/**
 * Recovery guidance after missed days.
 *
 * Never recommends compensating - no fasting after overeating, no double
 * workouts after a missed session. Compensation behaviour is the mechanism that
 * turns a bad day into a bad month.
 */
export function recoveryPlan(missedDays: number): { headline: string; steps: string[]; ask: string | null } {
  if (missedDays <= 1) {
    return {
      headline: 'One day off plan. That is genuinely fine.',
      steps: [
        'Go back to your normal plan at the next meal - not a lighter one.',
        'Drink water as usual.',
        'Keep your normal walk if you can.',
        'Do not skip meals or add extra exercise to make up for it.',
      ],
      ask: null,
    };
  }

  if (missedDays <= 3) {
    return {
      headline: `${missedDays} days off plan. Nothing here needs undoing.`,
      steps: [
        'Log your next meal, even roughly. Getting the record going again matters more than accuracy today.',
        'Return to your usual target - do not lower it to compensate.',
        'Take one short walk today.',
      ],
      ask: 'What got in the way? If it is likely to happen again, the plan should change, not you.',
    };
  }

  return {
    headline: `It has been ${missedDays} days. Let us make the plan easier rather than trying harder.`,
    steps: [
      'Restart with one meal logged today. That is the whole goal.',
      'Keep your current calorie target - going lower to catch up backfires reliably.',
      'Pick the single easiest habit from your list and do only that this week.',
    ],
    ask: 'What made it hard - time, money, hunger, cooking, work, travel, or motivation?',
  };
}
