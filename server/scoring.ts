// Score a guess against an Answer.
//
// Dispatches on the discriminant pair (answer.type, guess.type). Adding a
// new Answer/Guess pair means adding a new branch here

import type {
  Answer,
  Guess,
  LatLng,
  MapAnswer,
  MapGuess,
  TextAnswer,
  TextGuess,
} from "../shared/types";

export type ScoreResult = {
  score: number;
  /** Present for map answers; distance from correct location in km. */
  distanceKm?: number;
};

export function scoreGuess(answer: Answer, guess: Guess): ScoreResult {
  if (answer.type === "map" && guess.type === "map") {
    return scoreMapGuess(answer, guess);
  }
  if (answer.type === "text" && guess.type === "text") {
    return scoreTextGuess(answer, guess);
  }
  throw new Error(
    `Mismatched answer type '${answer.type}' and guess type '${guess.type}'`,
  );
}

// -----------------------------------------------------------------------------
// Map scoring.
// -----------------------------------------------------------------------------

function scoreMapGuess(answer: MapAnswer, guess: MapGuess): ScoreResult {
  const distanceKm = haversineKm(answer.correct, guess.position);
  const score = Math.round(
    answer.scoring.maxScore * Math.exp(-distanceKm / answer.scoring.scaleKm),
  );
  return { score, distanceKm };
}

/** Great-circle distance between two lat/lng points, in kilometers. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// -----------------------------------------------------------------------------
// Text scoring.
// -----------------------------------------------------------------------------

function scoreTextGuess(answer: TextAnswer, guess: TextGuess): ScoreResult {
  const submitted = guess.text.trim();
  const matched = answer.correct.some((c) =>
    answer.caseSensitive
      ? c === submitted
      : c.toLowerCase() === submitted.toLowerCase(),
  );
  // For now: binary scoring. Easy to evolve later (e.g. Levenshtein-based
  // partial credit) without changing the public type signature.
  return { score: matched ? 1 : 0 };
}
