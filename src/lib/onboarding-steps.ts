/**
 * The onboarding interview.
 *
 * Structured as data rather than hardcoded JSX so that steps can be reordered,
 * skipped conditionally, and — eventually — served from the content tables
 * without a redeploy.
 *
 * Three principles run through it:
 *   1. Every question says why it is being asked. "What is your budget?" with
 *      no reason reads as nosy; with a reason it reads as a coach doing its job.
 *   2. Questions are conditional. A vegetarian is never asked how they cook
 *      chicken, and someone without a gym is never asked about machines.
 *   3. Only name, height, weight, age and sex are required. Everything else can
 *      be skipped, because a half-finished profile that produces a usable plan
 *      beats an abandoned perfect one.
 */

export type FieldType = 'text' | 'number' | 'choice' | 'multi' | 'time' | 'boolean' | 'scale';

export interface Field {
  id: string;
  label: string;
  type: FieldType;
  /** Rendered under the label, in muted text. Answers "why are you asking?" */
  because?: string;
  options?: { value: string; label: string; hint?: string }[];
  unit?: string;
  min?: number;
  max?: number;
  placeholder?: string;
  required?: boolean;
  /** Show this field only when the predicate passes. */
  showIf?: (answers: Record<string, unknown>) => boolean;
}

export interface Step {
  id: string;
  title: string;
  intro?: string;
  fields: Field[];
}

const yesNo = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

export const STEPS: Step[] = [
  {
    id: 'about',
    title: 'About you',
    intro: 'Five quick things. These set your starting numbers, so they are the only ones we really need.',
    fields: [
      { id: 'name', label: 'What should we call you?', type: 'text', required: true, placeholder: 'First name is fine' },
      { id: 'age', label: 'Age', type: 'number', unit: 'years', min: 13, max: 100, required: true },
      {
        id: 'sex',
        label: 'Sex at birth',
        type: 'choice',
        because: 'The energy equations we use were built separately for males and females. If you would rather not say, we average the two and tell you we did.',
        options: [
          { value: 'male', label: 'Male' },
          { value: 'female', label: 'Female' },
          { value: 'intersex', label: 'Intersex' },
          { value: 'prefer_not_to_say', label: 'Prefer not to say' },
        ],
        required: true,
      },
      { id: 'heightCm', label: 'Height', type: 'number', unit: 'cm', min: 90, max: 250, required: true },
      { id: 'weightKg', label: 'Current weight', type: 'number', unit: 'kg', min: 25, max: 400, required: true },
    ],
  },

  {
    id: 'safety',
    title: 'A few health questions',
    intro:
      'We ask these because some situations make a standard weight-loss plan a bad idea. Nothing here is stored as a diagnosis, and answering yes does not lock you out — it changes what we are willing to recommend.',
    fields: [
      { id: 'pregnant', label: 'Are you pregnant?', type: 'choice', options: yesNo, showIf: (a) => a.sex === 'female' },
      { id: 'breastfeeding', label: 'Are you breastfeeding?', type: 'choice', options: yesNo, showIf: (a) => a.sex === 'female' },
      {
        id: 'eatingDisorderHistory',
        label: 'Have you ever had an eating disorder, or struggled with disordered eating?',
        type: 'choice',
        because: 'Calorie targets, daily weighing and streaks can make things harder rather than easier. If yes, we switch those off.',
        options: yesNo,
      },
      {
        id: 'conditions',
        label: 'Do any of these apply to you?',
        type: 'multi',
        because: 'Some conditions change what is safe, and some change how your medication behaves when you eat differently.',
        options: [
          { value: 'diabetesOnMedication', label: 'Diabetes, on medication' },
          { value: 'kidneyDisease', label: 'Kidney condition' },
          { value: 'liverDisease', label: 'Liver condition' },
          { value: 'cardiovascularCondition', label: 'Heart condition' },
          { value: 'recentSurgery', label: 'Surgery in the last three months' },
          { value: 'severeMobilityLimits', label: 'Significant difficulty walking' },
          { value: 'weightAffectingMedication', label: 'Medication that affects weight or appetite' },
          { value: 'unexplainedWeightLoss', label: 'Losing weight without trying' },
        ],
      },
    ],
  },

  {
    id: 'goal',
    title: 'What you want',
    fields: [
      {
        id: 'goal',
        label: 'What is your main goal?',
        type: 'choice',
        options: [
          { value: 'fat_loss', label: 'Lose fat' },
          { value: 'weight_loss', label: 'Lose weight' },
          { value: 'recomposition', label: 'Lose fat and build some muscle' },
          { value: 'waist_reduction', label: 'Reduce my waist' },
          { value: 'health_habits', label: 'Build better habits' },
          { value: 'fitness', label: 'Get fitter' },
        ],
      },
      { id: 'targetWeightKg', label: 'Goal weight', type: 'number', unit: 'kg', min: 25, max: 400, because: 'If your timeline turns out to be faster than we will safely plan for, we keep your goal and move the date — not the other way round.' },
      { id: 'targetWeeks', label: 'In how many weeks?', type: 'number', unit: 'weeks', min: 2, max: 260 },
      {
        id: 'pace',
        label: 'How fast do you want to go?',
        type: 'choice',
        options: [
          { value: 'gentle', label: 'Gently', hint: 'Easiest to stick to' },
          { value: 'steady', label: 'Steady', hint: 'Recommended' },
          { value: 'firm', label: 'Faster', hint: 'Harder, and we still cap it' },
        ],
      },
    ],
  },

  {
    id: 'work',
    title: 'Your day',
    intro: 'This is how we work out what you burn, rather than asking you to rate your own activity — almost everyone overestimates that.',
    fields: [
      {
        id: 'workPattern',
        label: 'What is your work like?',
        type: 'choice',
        options: [
          { value: 'desk', label: 'Mostly sitting' },
          { value: 'mixed', label: 'A mix of sitting and moving' },
          { value: 'standing', label: 'Mostly on my feet' },
          { value: 'physical', label: 'Physically demanding' },
          { value: 'shift', label: 'Shift work' },
          { value: 'home', label: 'At home / not working' },
          { value: 'student', label: 'Student' },
        ],
      },
      { id: 'sittingHours', label: 'Roughly how many hours a day do you sit?', type: 'number', unit: 'hours', min: 0, max: 24 },
      { id: 'nightShift', label: 'Do you work nights?', type: 'choice', options: yesNo, showIf: (a) => a.workPattern === 'shift' },
      { id: 'shiftStart', label: 'When does your shift start?', type: 'time', showIf: (a) => a.nightShift === 'yes' },
      { id: 'shiftEnd', label: 'When does it end?', type: 'time', showIf: (a) => a.nightShift === 'yes' },
      { id: 'wakeTime', label: 'What time do you usually wake up?', type: 'time' },
      { id: 'sleepTime', label: 'What time do you usually get to bed?', type: 'time' },
      { id: 'sleepHours', label: 'How many hours do you usually sleep?', type: 'number', unit: 'hours', min: 0, max: 16 },
      {
        id: 'baselineSteps',
        label: 'Roughly how many steps do you walk a day?',
        type: 'number',
        unit: 'steps',
        min: 0,
        max: 60000,
        because: 'We build your step goal up from where you actually are. Nobody gets handed 10,000 on day one.',
      },
    ],
  },

  {
    id: 'food',
    title: 'How you eat',
    fields: [
      {
        id: 'diet',
        label: 'What do you eat?',
        type: 'choice',
        options: [
          { value: 'vegetarian', label: 'Vegetarian' },
          { value: 'eggetarian', label: 'Vegetarian, plus eggs' },
          { value: 'vegan', label: 'Vegan' },
          { value: 'non_vegetarian', label: 'Non-vegetarian' },
          { value: 'pescatarian', label: 'Vegetarian, plus fish' },
          { value: 'jain', label: 'Jain' },
        ],
      },
      {
        id: 'cuisines',
        label: 'What kind of food do you usually eat?',
        type: 'multi',
        options: [
          { value: 'south_indian', label: 'South Indian' },
          { value: 'north_indian', label: 'North Indian' },
          { value: 'bengali', label: 'Bengali' },
          { value: 'gujarati', label: 'Gujarati' },
          { value: 'maharashtrian', label: 'Maharashtrian' },
          { value: 'chinese', label: 'Indo-Chinese' },
          { value: 'continental', label: 'Continental' },
        ],
      },
      { id: 'allergies', label: 'Any allergies?', type: 'text', placeholder: 'peanuts, shellfish…', because: 'We remove these from every plan and every substitution we offer.' },
      { id: 'dislikes', label: 'Anything you really do not want to eat?', type: 'text', placeholder: 'oats, karela…', because: 'We will not put it in your plan. A plan built on food you hate is a plan you will drop.' },
      { id: 'favourites', label: 'Anything you especially like?', type: 'text', placeholder: 'dosa, curd rice…' },
      { id: 'mealsPerDay', label: 'How many times a day do you usually eat?', type: 'number', min: 1, max: 8 },
    ],
  },

  {
    id: 'cooking',
    title: 'Cooking and budget',
    intro: 'This is where most plans fall apart — they assume time and money that people do not have.',
    fields: [
      { id: 'cooksOwnFood', label: 'Do you cook your own food?', type: 'choice', options: yesNo },
      { id: 'cookIdentity', label: 'Who cooks?', type: 'text', placeholder: 'my mother, my partner, a cook…', showIf: (a) => a.cooksOwnFood === 'no' },
      {
        id: 'cookMinutes',
        label: 'Realistically, how long can you spend cooking on a weekday?',
        type: 'choice',
        options: [
          { value: '5', label: '5 minutes' },
          { value: '10', label: '10 minutes' },
          { value: '15', label: '15 minutes' },
          { value: '30', label: '30 minutes' },
          { value: '45', label: '45 minutes' },
          { value: '60', label: 'An hour or more' },
        ],
      },
      {
        id: 'kitchenEquipment',
        label: 'What do you have in the kitchen?',
        type: 'multi',
        options: [
          { value: 'fridge', label: 'Refrigerator' },
          { value: 'freezer', label: 'Freezer' },
          { value: 'microwave', label: 'Microwave' },
          { value: 'pressure_cooker', label: 'Pressure cooker' },
          { value: 'air_fryer', label: 'Air fryer' },
          { value: 'gas', label: 'Gas stove' },
          { value: 'induction', label: 'Induction' },
        ],
      },
      {
        id: 'budgetPerDay',
        label: 'What can you spend on food a day?',
        type: 'choice',
        because: 'We build the plan to fit this. A plan you cannot afford is not a plan.',
        options: [
          { value: '100', label: '₹100' },
          { value: '150', label: '₹150' },
          { value: '200', label: '₹200' },
          { value: '300', label: '₹300' },
          { value: '500', label: '₹500 or more' },
          { value: 'unsure', label: 'Not sure' },
        ],
      },
      { id: 'sharedHousehold', label: 'Is the food shared with your household?', type: 'choice', options: yesNo },
    ],
  },

  {
    id: 'movement',
    title: 'Exercise',
    fields: [
      {
        id: 'experience',
        label: 'How much exercise experience do you have?',
        type: 'choice',
        options: [
          { value: 'none', label: 'None at all' },
          { value: 'beginner', label: 'A little' },
          { value: 'returning', label: 'Used to train, stopped' },
          { value: 'intermediate', label: 'Train regularly' },
        ],
      },
      {
        id: 'equipment',
        label: 'What do you have access to?',
        type: 'choice',
        options: [
          { value: 'none', label: 'Nothing' },
          { value: 'bands', label: 'Resistance bands' },
          { value: 'dumbbells', label: 'Dumbbells at home' },
          { value: 'home_basic', label: 'A few bits at home' },
          { value: 'full_gym', label: 'A gym' },
        ],
      },
      { id: 'trainingDays', label: 'How many days a week can you realistically train?', type: 'number', min: 0, max: 7, because: 'Realistically — not aspirationally. We would rather give you three days you actually do than six you do not.' },
      { id: 'sessionMinutes', label: 'How long can a session be?', type: 'number', unit: 'minutes', min: 0, max: 240 },
      {
        id: 'activities',
        label: 'Anything you actually enjoy?',
        type: 'multi',
        because: 'Enjoyment predicts adherence better than almost anything else we could ask.',
        options: [
          { value: 'walking', label: 'Walking' }, { value: 'running', label: 'Running' },
          { value: 'cycling', label: 'Cycling' }, { value: 'swimming', label: 'Swimming' },
          { value: 'badminton', label: 'Badminton' }, { value: 'cricket', label: 'Cricket' },
          { value: 'football', label: 'Football' }, { value: 'dancing', label: 'Dancing' },
          { value: 'yoga', label: 'Yoga' }, { value: 'gym', label: 'Gym training' },
        ],
      },
      { id: 'injuries', label: 'Any injuries or joints that give you trouble?', type: 'text', placeholder: 'left knee, lower back…', because: 'We swap out anything that would aggravate it, rather than telling you to push through.' },
    ],
  },

  {
    id: 'history',
    title: 'What has happened before',
    intro: 'Knowing what has failed before is the fastest way to avoid repeating it.',
    fields: [
      {
        id: 'previousAttempts',
        label: 'Have you tried to lose weight before?',
        type: 'choice',
        options: [
          { value: 'never', label: 'Never' },
          { value: 'once', label: 'Once or twice' },
          { value: 'many', label: 'Many times' },
        ],
      },
      {
        id: 'whatWentWrong',
        label: 'What usually gets in the way?',
        type: 'multi',
        showIf: (a) => a.previousAttempts === 'once' || a.previousAttempts === 'many',
        options: [
          { value: 'hunger', label: 'I got too hungry' },
          { value: 'time', label: 'No time' },
          { value: 'money', label: 'Cost' },
          { value: 'cooking', label: 'Too much cooking' },
          { value: 'boring', label: 'The food was boring' },
          { value: 'social', label: 'Social events and family food' },
          { value: 'motivation', label: 'Motivation faded' },
          { value: 'travel', label: 'Travel and work' },
          { value: 'plateau', label: 'It stopped working' },
        ],
      },
      { id: 'stress', label: 'How stressed are you most days?', type: 'scale', min: 1, max: 5 },
      { id: 'emotionalEating', label: 'Do you eat when stressed or bored?', type: 'choice', options: yesNo },
    ],
  },
];

/** Steps whose fields are all conditionally hidden are skipped entirely. */
export function visibleFields(step: Step, answers: Record<string, unknown>): Field[] {
  return step.fields.filter((f) => !f.showIf || f.showIf(answers));
}
