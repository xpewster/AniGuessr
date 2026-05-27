export type LatLng = {
  lat: number;
  lng: number;
};

// -----------------------------------------------------------------------------
// Questions — what is shown to the player as the prompt.
// -----------------------------------------------------------------------------

export type ImageQuestion = {
  type: "image";
  /** Path to the image, relative to the quiz directory. */
  src: string;
  /** Optional caption shown alongside the image. */
  caption?: string;
};

export type TextQuestion = {
  type: "text";
  content: string;
};

export type Question = ImageQuestion | TextQuestion;

// -----------------------------------------------------------------------------
// Answers — the "answer key" for a round.
// Lives only on the server until the round's reveal phase.
// -----------------------------------------------------------------------------

export type MapAnswer = {
  type: "map";
  correct: LatLng;
  /**
   * GeoGuessr-style exponential decay:
   *   score = maxScore * exp(-distanceKm / scaleKm)
   * `scaleKm` controls how forgiving the scoring is. ~2000 is roughly
   * world-scale, ~200 is country-scale, ~20 is city-scale.
   */
  scoring: {
    maxScore: number;
    scaleKm: number;
  };
};

export type TextAnswer = {
  type: "text";
  /** Any of these strings count as correct. */
  correct: string[];
  caseSensitive?: boolean;
};

export type Answer = MapAnswer | TextAnswer;

// -----------------------------------------------------------------------------
// Client-safe view of an Answer — what's sent to clients during the
// guessing phase. The correct answer is stripped out.
// -----------------------------------------------------------------------------

export type ClientAnswer =
  | { type: "map" }
  | { type: "text" };

export function stripAnswer(answer: Answer): ClientAnswer {
  return { type: answer.type };
}

// -----------------------------------------------------------------------------
// Guesses — what the player submits.
// -----------------------------------------------------------------------------

export type MapGuess = {
  type: "map";
  position: LatLng;
};

export type TextGuess = {
  type: "text";
  text: string;
};

export type Guess = MapGuess | TextGuess;

// -----------------------------------------------------------------------------
// Round and Quiz.
// -----------------------------------------------------------------------------

export type Round = {
  question: Question;
  answer: Answer;
  /** Per-round override of the quiz's default time limit, in seconds. */
  timeLimit?: number;
};

export type Quiz = {
  name: string;
  description?: string;
  /** Default time limit per round, in seconds. */
  defaultTimeLimit: number;
  /**
   * After the first submission in a guessing phase, if more than this many
   * seconds remain on the clock, the timer is shortened to this value.
   */
  submitGracePeriodSeconds: number;
  /** Starting HP for every team when startGame fires. */
  startingHp: number;
  /** How much a team's damage multiplier grows after winning a round.
   *  Set to 0 to disable multiplier growth entirely. */
  multiplierStep: number;
  rounds: Round[];
};

// -----------------------------------------------------------------------------
// Exhaustiveness helper. Use at the end of switch statements over a union to
// make the compiler complain when a new variant is added but not handled.
//
//   switch (q.type) {
//     case "image": ...; break;
//     case "text":  ...; break;
//     default: assertNever(q);
//   }
// -----------------------------------------------------------------------------

export function assertNever(x: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(x)}`);
}
