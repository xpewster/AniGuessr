import type { Answer, ClientAnswer, Question, Guess } from "./types";

/** A team name. Doubles as a unique team identifier. */
export type TeamId = string;

export type Team = {
  name: string;
  players: string[];
  /** Current HP. 0 in lobby, set to quiz.startingHp by startGame, mutated
   *  by endGuessing. Floored at 0. */
  hp: number;
  /** Damage multiplier applied to losses this team inflicts. Starts at 1
   *  and grows by quiz.multiplierStep each round this team wins. */
  multiplier: number;
};

export type Player = {
  /** Same as `name`. */
  id: string;
  name: string;
  /** Null until the player joins a team (only possible in lobby phase). */
  team: TeamId | null;
  connected: boolean;
};

// -----------------------------------------------------------------------------
// Phases.
// -----------------------------------------------------------------------------

export type LobbyPhase = {
  type: "lobby";
};

export type GuessingPhase = {
  type: "guessing";
  roundIndex: number;
  question: Question;
  /** Type-only view of the answer (no correct location). */
  answer: ClientAnswer;
  /** Server timestamps (ms since epoch). Display-only on the client. */
  startedAt: number;
  endsAt: number;
  /** Players who have explicitly submitted. Order = submission order. */
  submittedPlayerIds: string[];
};

export type ResultsPhase = {
  type: "results";
  /** Look up the full round in state.roundResults[roundIndex]. */
  roundIndex: number;
};

export type EndedPhase = {
  type: "ended";
};

export type GamePhase = LobbyPhase | GuessingPhase | ResultsPhase | EndedPhase;

// -----------------------------------------------------------------------------
// Completed rounds.
// -----------------------------------------------------------------------------

export type SubmittedGuess = {
  playerId: string;
  /** Always defined for finalized rounds — startGame requires all players
   *  to be on a team. */
  team: TeamId;
  /** Null if the player never placed a marker before the timer ran out. */
  guess: Guess | null;
  score: number;
  distanceKm?: number;
};

// New: per-team outcome captured at end of each round.
export type TeamRoundOutcome = {
  team: TeamId;
  /** This team's score this round — the highest individual score among
   *  teammates. The closest guess represents the team. */
  roundScore: number;
  /** HP at the end of the round (after damage applied). */
  hpAfter: number;
  /** Multiplier at the end of the round (after step applied if this team
   *  won). */
  multiplierAfter: number;
  multiplierIncrease: number;
  /** Damage taken this round (0 if the team won or tied at the top). */
  damageTaken: number;
};

export type CompletedRound = {
  question: Question;
  correctAnswer: Answer;
  results: SubmittedGuess[];
  /** Per-team outcome for this round. */
  teamOutcomes: TeamRoundOutcome[];
  /** Round winner (team with sole highest roundScore). Null if tied. */
  winningTeam: TeamId | null;
};

// -----------------------------------------------------------------------------
// Top-level state.
// -----------------------------------------------------------------------------

export type GameState = {
  phase: GamePhase;
  players: Player[];
  /** Host-created teams. Insertion order. */
  teams: Team[];
  /** Indexed by round number. */
  roundResults: CompletedRound[];
};

// -----------------------------------------------------------------------------
// Helpers.
// -----------------------------------------------------------------------------

export function teamOf(state: GameState, playerId: string): TeamId | null {
  return state.players.find((p) => p.id === playerId)?.team ?? null;
}

export function teamScore(state: GameState, team: TeamId): number {
  let total = 0;
  for (const round of state.roundResults) {
    for (const g of round.results) {
      if (g.team === team) total += g.score;
    }
  }
  return total;
}
