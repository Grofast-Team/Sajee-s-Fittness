/**
 * Fitness level assessment, and the progression / regression decision.
 *
 * The loop this serves:
 *
 *   assess -> recommend -> perform -> rate -> analyse -> progress or regress
 *
 * Two things shape every rule here.
 *
 * **Never ask someone to self-classify.** "Are you a beginner?" is answered with
 * aspiration, embarrassment, or a guess at what the app wants to hear. Asking
 * whether they can hold a plank for twenty seconds gets a usable answer, and
 * the level falls out of the facts.
 *
 * **Regression has to be as easy as progression.** An app that only ever ratchets
 * up eventually prescribes something the person cannot do, and the failure feels
 * like theirs. Stepping back is a normal move here, not a punishment.
 */

export type FitnessLevel = 1 | 2 | 3 | 4;

export const LEVEL_NAMES: Record<FitnessLevel, string> = {
  1: 'Starting out',
  2: 'Building a base',
  3: 'Training regularly',
  4: 'Experienced',
};

/*
 * Names, not "Absolute Beginner".
 *
 * The label is shown to the user on the first screen after they answer honestly
 * about not having exercised in months. "Level 1 — Absolute Beginner" reads as a
 * verdict; "Starting out" describes the same thing as a position on a path.
 */

export interface AssessmentAnswers {
  /** Consistency over the last three months. */
  recentTraining?: 'never' | 'occasional' | 'two_three' | 'four_plus';
  /** Can you do ten bodyweight squats comfortably? */
  squats10?: 'yes' | 'no' | 'unsure';
  /** Can you hold a plank for twenty seconds? */
  plank20?: 'yes' | 'no' | 'unsure';
  /** Have you trained with weights before, at any point? */
  liftedBefore?: 'yes' | 'no';
}

export interface AssessmentResult {
  level: FitnessLevel;
  name: string;
  score: number;
  reasons: string[];
  /** Shown verbatim. Never phrased as a shortfall. */
  message: string;
}

/**
 * Derive a level from what someone can actually do.
 *
 * "Unsure" scores as a soft no rather than a no. Someone who does not know
 * whether they can hold a plank probably cannot, but placing them a whole level
 * down on a guess produces sessions that feel pointless — and boredom loses
 * people as reliably as difficulty does.
 */
export function assessFitnessLevel(answers: AssessmentAnswers): AssessmentResult {
  const reasons: string[] = [];
  let score = 0;

  switch (answers.recentTraining) {
    case 'four_plus':
      score += 3;
      reasons.push('You have been training four or more days a week.');
      break;
    case 'two_three':
      score += 2;
      reasons.push('You have been training two or three days a week.');
      break;
    case 'occasional':
      score += 1;
      reasons.push('You have been exercising occasionally.');
      break;
    case 'never':
      reasons.push('You have not been exercising regularly recently.');
      break;
    default:
      break;
  }

  if (answers.squats10 === 'yes') {
    score += 1.5;
    reasons.push('Ten bodyweight squats is comfortable for you.');
  } else if (answers.squats10 === 'unsure') {
    score += 0.5;
  } else if (answers.squats10 === 'no') {
    reasons.push('Ten squats is not comfortable yet, so we will start from a chair.');
  }

  if (answers.plank20 === 'yes') {
    score += 1.5;
    reasons.push('You can hold a plank for twenty seconds.');
  } else if (answers.plank20 === 'unsure') {
    score += 0.5;
  } else if (answers.plank20 === 'no') {
    reasons.push('We will build core strength from an easier position.');
  }

  if (answers.liftedBefore === 'yes') {
    score += 1;
    reasons.push('You have trained with weights before, so the movements will not be new.');
  }

  const level: FitnessLevel = score >= 6 ? 4 : score >= 4 ? 3 : score >= 1.5 ? 2 : 1;

  return {
    level,
    name: LEVEL_NAMES[level],
    score: Math.round(score * 10) / 10,
    reasons,
    message: levelMessage(level),
  };
}

function levelMessage(level: FitnessLevel): string {
  switch (level) {
    case 1:
      return (
        'We will start with movements you can do holding a chair, and build from there. ' +
        'Starting here is not a setback — it is the fastest route to being able to do more, ' +
        'because you will actually finish the sessions.'
      );
    case 2:
      return (
        'You have a base to build on. Sessions will be short and complete, and we will add ' +
        'difficulty as the current ones start to feel easy.'
      );
    case 3:
      return (
        'You are training regularly already, so we will focus on progressing the movements ' +
        'rather than just repeating them.'
      );
    case 4:
      return (
        'You have real training experience. Sessions will assume that, and progress on load ' +
        'and tempo rather than on learning the basics.'
      );
  }
}

/* ------------------------------------------------------------------ */
/* Readiness                                                           */
/* ------------------------------------------------------------------ */

export interface ProgressionSignals {
  /** Completed sessions at the current level. */
  sessionsAtLevel: number;
  /** Difficulty ratings, 1 easy to 5 too difficult, most recent last. */
  recentDifficulty: number[];
  /** Pain reports from the same sessions. */
  recentPain: ('none' | 'mild_discomfort' | 'pain')[];
  /** Share of planned sessions completed, 0-1. */
  consistency: number;
  /**
   * How many sessions were actually planned in the window.
   *
   * Without this, a consistency of 0 is ambiguous: it could mean someone
   * skipped everything, or that nothing was scheduled yet. Reporting the second
   * case as "0% of planned sessions done" accuses someone of missing sessions
   * that never existed — which is exactly the kind of unearned blame this
   * product refuses to hand out.
   */
  plannedSessions?: number;
  /** Days since the level last changed. */
  daysAtLevel: number;
  /** Withheld capabilities from the safety layer. */
  restrictions?: string[];
}

export interface ReadinessCheck {
  ready: boolean;
  checks: { label: string; passed: boolean; detail: string }[];
  verdict: string;
}

export const MIN_SESSIONS_BEFORE_PROGRESSING = 4;
export const MIN_DAYS_AT_LEVEL = 10;

const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/**
 * Is this person ready for the next level?
 *
 * Shown as a checklist rather than a yes/no, because "not yet" is far easier to
 * accept when you can see which item is outstanding and that it is a matter of
 * two more sessions rather than a judgement about you.
 */
export function checkReadiness(signals: ProgressionSignals): ReadinessCheck {
  const recent = signals.recentDifficulty.slice(-4);
  const avgDifficulty = mean(recent);
  const anyPain = signals.recentPain.slice(-4).includes('pain');
  const restricted = new Set(signals.restrictions ?? []);

  const checks = [
    {
      label: 'Sessions completed',
      passed: signals.sessionsAtLevel >= MIN_SESSIONS_BEFORE_PROGRESSING,
      detail: `${signals.sessionsAtLevel} of ${MIN_SESSIONS_BEFORE_PROGRESSING} at this level.`,
    },
    {
      label: 'Current level feels manageable',
      passed: recent.length > 0 && avgDifficulty <= 3,
      detail:
        recent.length === 0
          ? 'No difficulty ratings yet.'
          : `Averaging ${avgDifficulty.toFixed(1)} out of 5.`,
    },
    {
      label: 'No pain reported',
      passed: !anyPain,
      detail: anyPain ? 'Pain was reported recently.' : 'Nothing reported.',
    },
    {
      label: 'Consistency',
      passed: signals.consistency >= 0.6,
      detail:
        signals.plannedSessions === 0
          ? 'Nothing scheduled at this level yet — this fills in as sessions are planned.'
          : `${Math.round(signals.consistency * 100)}% of planned sessions done.`,
    },
    {
      label: 'Time at this level',
      passed: signals.daysAtLevel >= MIN_DAYS_AT_LEVEL,
      detail: `${signals.daysAtLevel} days. Adaptation takes a week or two.`,
    },
  ];

  // A safety restriction blocks progression outright, whatever the checklist says.
  const blocked = restricted.has('high_intensity_training');
  const ready = !blocked && checks.every((c) => c.passed);

  return {
    ready,
    checks,
    verdict: blocked
      ? 'We are holding your level steady because of an open safety note on your account. ' +
        'That is worth resolving with a professional before adding intensity.'
      : ready
        ? 'Everything points the same way. Worth trying the next step.'
        : 'Not yet — and that is fine. The unticked items below are the only things in the way.',
  };
}

/* ------------------------------------------------------------------ */
/* The decision                                                        */
/* ------------------------------------------------------------------ */

export type ProgressionDecision = 'progress' | 'hold' | 'regress' | 'hold_for_pain';

export interface ProgressionOutcome {
  decision: ProgressionDecision;
  fromLevel: FitnessLevel;
  toLevel: FitnessLevel;
  /** Shown to the user verbatim. */
  message: string;
  readiness: ReadinessCheck;
}

const clampLevel = (n: number): FitnessLevel => Math.min(4, Math.max(1, n)) as FitnessLevel;

/**
 * Decide whether to move a level, and which way.
 *
 * Pain is checked first and overrides everything. Two consecutive "too
 * difficult" ratings drop a level without waiting for a fourth data point,
 * because someone who cannot finish two sessions in a row is not going to
 * attend a third.
 */
export function decideProgression(
  level: FitnessLevel,
  signals: ProgressionSignals,
): ProgressionOutcome {
  const readiness = checkReadiness(signals);
  const recent = signals.recentDifficulty.slice(-3);
  const painRecently = signals.recentPain.slice(-3).includes('pain');

  // --- Pain. Always first, never traded off against progress. -------------
  if (painRecently) {
    return {
      decision: 'hold_for_pain',
      fromLevel: level,
      toLevel: level,
      readiness,
      message:
        'You reported pain in a recent session, so we are not adding difficulty. Pain is ' +
        'different from effort — effort is the point, pain is a signal to stop. If it persists ' +
        'or is sharp, please have it looked at rather than training through it.',
    };
  }

  // --- Regression. Two "too difficult" in a row is enough evidence. -------
  const tooHard = recent.slice(-2);
  if (tooHard.length === 2 && tooHard.every((d) => d >= 5)) {
    const to = clampLevel(level - 1);
    return {
      decision: level === 1 ? 'hold' : 'regress',
      fromLevel: level,
      toLevel: to,
      readiness,
      message:
        level === 1
          ? 'These sessions are still hard going. We are keeping the level where it is and will ' +
            'shorten the sessions instead — there is no level below this one, and there does not ' +
            'need to be.'
          : 'Those last sessions were too hard. We are stepping back a level for a while. This is ' +
            'a normal adjustment, not a setback — the plan is supposed to fit you, not the other ' +
            'way round.',
    };
  }

  // --- Progression. --------------------------------------------------------
  if (readiness.ready && level < 4) {
    const to = clampLevel(level + 1);
    return {
      decision: 'progress',
      fromLevel: level,
      toLevel: to,
      readiness,
      message:
        `You have been finishing your sessions comfortably and consistently, so we are moving ` +
        `you up to ${LEVEL_NAMES[to].toLowerCase()}. If it turns out to be too much, say so ` +
        `after a session and we will step straight back.`,
    };
  }

  // --- Hold. -------------------------------------------------------------
  const outstanding = readiness.checks.filter((c) => !c.passed);
  return {
    decision: 'hold',
    fromLevel: level,
    toLevel: level,
    readiness,
    message:
      level === 4 && readiness.ready
        ? 'You are at the top level here. We will keep progressing the movements themselves ' +
          'rather than the level.'
        : outstanding.length > 0
          ? `Staying at this level for now — ${outstanding[0].label.toLowerCase()} is the one ` +
            `thing outstanding. ${outstanding[0].detail}`
          : 'Staying at this level for now.',
  };
}

/* ------------------------------------------------------------------ */
/* Exercise-level progression                                          */
/* ------------------------------------------------------------------ */

export interface RepHistory {
  /** Reps achieved per session, most recent last. */
  sessions: number[];
  targetHigh: number;
}

/**
 * Should this specific exercise step up the chain?
 *
 * Separate from the level decision because they move at different speeds:
 * someone can be ready to progress their squat while their push-up is nowhere
 * near ready, and forcing both to move together holds one back and breaks the
 * other.
 */
export function shouldProgressExercise(history: RepHistory): {
  progress: boolean;
  reason: string;
} {
  const recent = history.sessions.slice(-3);

  if (recent.length < 3) {
    return {
      progress: false,
      reason: `Two or three sessions at this movement first — we have ${recent.length} so far.`,
    };
  }

  const allAtTop = recent.every((r) => r >= history.targetHigh);
  if (allAtTop) {
    return {
      progress: true,
      reason:
        `You have hit the top of the rep range three sessions running. That is the signal to ` +
        `make the movement harder rather than just doing more of it.`,
    };
  }

  const best = Math.max(...recent);
  return {
    progress: false,
    reason: `Best so far is ${best} of ${history.targetHigh}. Once that is the standard, we move on.`,
  };
}
