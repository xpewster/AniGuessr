import type { Guess, Quiz } from "../shared/types";
import type {
  CompletedRound,
  GameState,
  Player,
  SubmittedGuess,
  TeamId,
  TeamRoundOutcome,
} from "../shared/game";
import { scoreGuess } from "./scoring";

export function createInitialState(): GameState {
  return {
    phase: { type: "lobby" },
    players: [],
    teams: [],
    roundResults: [],
  };
}

// -----------------------------------------------------------------------------
// Roster + connection state.
// -----------------------------------------------------------------------------

export function addOrReconnect(
  state: GameState,
  name: string,
): { state: GameState; player: Player; reconnected: boolean } {
  const existing = state.players.find((p) => p.id === name);
  if (existing) {
    const updated: Player = { ...existing, connected: true };
    return {
      state: {
        ...state,
        players: state.players.map((p) => (p.id === name ? updated : p)),
      },
      player: updated,
      reconnected: true,
    };
  }
  if (state.phase.type !== "lobby") {
    throw new Error("Cannot join: a game is already in progress");
  }
  const player: Player = {
    id: name,
    name,
    team: null,
    connected: true,
  };
  return {
    state: { ...state, players: [...state.players, player] },
    player,
    reconnected: false,
  };
}

export function setDisconnected(
  state: GameState,
  playerId: string,
): GameState {
  if (!state.players.some((p) => p.id === playerId)) return state;
  return {
    ...state,
    players: state.players.map((p) =>
      p.id === playerId ? { ...p, connected: false } : p,
    ),
  };
}

// -----------------------------------------------------------------------------
// Teams.
// -----------------------------------------------------------------------------

export function createTeam(state: GameState, rawName: string): GameState {
  if (state.phase.type !== "lobby") {
    throw new Error("Can only create teams in the lobby");
  }
  const name = rawName.trim();
  if (!name) throw new Error("Team name cannot be empty");
  if (state.teams.some((t) => t.name === name)) {
    throw new Error(`Team '${name}' already exists`);
  }
  return {
    ...state,
    teams: [
      ...state.teams,
      { name, players: [], hp: 0, multiplier: 1 },
    ],
  };
}

export function joinTeam(
  state: GameState,
  playerId: string,
  teamName: TeamId,
): GameState {
  if (state.phase.type !== "lobby") {
    throw new Error("Can only join teams in the lobby");
  }
  if (!state.players.some((p) => p.id === playerId)) {
    throw new Error("Player not in game");
  }
  if (!state.teams.some((t) => t.name === teamName)) {
    throw new Error(`Team '${teamName}' does not exist`);
  }
  let oldTeam: TeamId | null = null;
  for (const team of state.teams) {
    if (team.players.includes(playerId)) {
      oldTeam = team.name;
      break;
    }
  }

  return {
    ...state,
    players: state.players.map((p) =>
      p.id === playerId ? { ...p, team: teamName } : p,
    ),
    teams: state.teams.map((t) => {
      if (t.name === teamName) {
        return { ...t, players: [...(t.players ?? []), playerId] };
      }
      if (t.name === oldTeam) {
        return { ...t, players: t.players.filter((id) => id !== playerId) };
      }
      return t;
    }),
  };
}

// -----------------------------------------------------------------------------
// Phase transitions.
// -----------------------------------------------------------------------------

export function startGame(
  state: GameState,
  quiz: Quiz,
  now: number,
): GameState {
  if (state.phase.type !== "lobby") {
    throw new Error(`Cannot start: phase is '${state.phase.type}'`);
  }
  if (state.players.length === 0) {
    throw new Error("Cannot start: no players");
  }
  if (state.teams.length === 0) {
    throw new Error("Cannot start: no teams created yet");
  }
  const teamless = state.players.filter((p) => p.team === null);
  if (teamless.length > 0) {
    throw new Error(
      `Cannot start: players not on a team: ${teamless.map((p) => p.name).join(", ")}`,
    );
  }
  const round = quiz.rounds[0];
  if (!round) throw new Error("Quiz has no rounds");
  const duration = (round.timeLimit ?? quiz.defaultTimeLimit) * 1000;
  return {
    ...state,
    teams: state.teams.map((t) => ({
      ...t,
      hp: quiz.startingHp,
      multiplier: 1,
    })),
    phase: {
      type: "guessing",
      roundIndex: 0,
      question: round.question,
      answer: { type: round.answer.type },
      startedAt: now,
      endsAt: now + duration,
      submittedPlayerIds: [],
    },
    roundResults: [],
  };
}

export function submitGuess(
  state: GameState,
  playerId: string,
  now: number,
  gracePeriodMs: number,
): { state: GameState; allSubmitted: boolean; timerShortened: boolean } {
  if (state.phase.type !== "guessing") {
    throw new Error("Not in a guessing phase");
  }
  if (!state.players.some((p) => p.id === playerId)) {
    throw new Error("Player not in game");
  }
  if (state.phase.submittedPlayerIds.includes(playerId)) {
    throw new Error("You've already submitted");
  }

  const newSubmitted = [...state.phase.submittedPlayerIds, playerId];

  let endsAt = state.phase.endsAt;
  let timerShortened = false;
  if (newSubmitted.length === 1) {
    const remaining = state.phase.endsAt - now;
    if (remaining > gracePeriodMs) {
      endsAt = now + gracePeriodMs;
      timerShortened = true;
    }
  }

  const connectedIds = state.players
    .filter((p) => p.connected)
    .map((p) => p.id);
  const allSubmitted = connectedIds.every((id) => newSubmitted.includes(id));

  return {
    state: {
      ...state,
      phase: {
        ...state.phase,
        submittedPlayerIds: newSubmitted,
        endsAt,
      },
    },
    allSubmitted,
    timerShortened,
  };
}

/**
 * Finalize the active guessing phase.
 */
export function endGuessing(
  state: GameState,
  quiz: Quiz,
  liveGuesses: ReadonlyMap<string, Guess>,
): { state: GameState; completed: CompletedRound } {
  if (state.phase.type !== "guessing") {
    throw new Error(`Cannot end: phase is '${state.phase.type}'`);
  }
  const roundIndex = state.phase.roundIndex;
  const round = quiz.rounds[roundIndex];
  if (!round) throw new Error(`Round ${roundIndex} out of bounds`);

  // ----- Per-player scoring (unchanged) -----
  const results: SubmittedGuess[] = state.players.map((player) => {
    if (player.team === null) {
      throw new Error(
        `Player ${player.name} has no team during guessing — invariant violated`,
      );
    }
    const team: TeamId = player.team;
    const guess = liveGuesses.get(player.id);
    if (!guess) {
      return { playerId: player.id, team, guess: null, score: 0 };
    }
    const scored = scoreGuess(round.answer, guess);
    return {
      playerId: player.id,
      team,
      guess,
      score: scored.score,
      distanceKm: scored.distanceKm,
    };
  });

  // ----- Per-team round score: highest individual score on the team
  // (the closest guess represents the team, GeoGuessr-style) -----
  const teamScores = new Map<TeamId, number>();
  for (const t of state.teams) teamScores.set(t.name, 0); // include 0-player teams
  for (const r of results) {
    const current = teamScores.get(r.team) ?? 0;
    if (r.score > current) teamScores.set(r.team, r.score);
  }

  // ----- Determine round winner (sole highest score, else tie/no-winner) -----
  let maxScore = -Infinity;
  let teamsAtMax: TeamId[] = [];
  for (const [team, score] of teamScores) {
    if (score > maxScore) {
      maxScore = score;
      teamsAtMax = [team];
    } else if (score === maxScore) {
      teamsAtMax.push(team);
    }
  }
  const winningTeam: TeamId | null =
    teamsAtMax.length === 1 && state.teams.length > 1 ? teamsAtMax[0]! : null;

  // ----- Apply HP / multiplier changes -----
  const winnerBefore =
    winningTeam !== null
      ? state.teams.find((t) => t.name === winningTeam)
      : undefined;
  const damageByTeam = new Map<TeamId, number>();

  const newTeams = state.teams.map((t): typeof t => {
    if (winningTeam === null) {
      damageByTeam.set(t.name, 0);
      return t;
    }
    if (t.name === winningTeam) {
      damageByTeam.set(t.name, 0);
      return { ...t, multiplier: t.multiplier + quiz.multiplierStep };
    }
    const score = teamScores.get(t.name) ?? 0;
    const damage = Math.round(
      (maxScore - score) * (winnerBefore?.multiplier ?? 1),
    );
    damageByTeam.set(t.name, damage);
    return { ...t, hp: Math.max(0, t.hp - damage) };
  });

  // ----- Build per-team outcomes for this round -----
  const teamOutcomes: TeamRoundOutcome[] = newTeams.map((t) => ({
    team: t.name,
    roundScore: teamScores.get(t.name) ?? 0,
    hpAfter: t.hp,
    multiplierAfter: t.multiplier,
    multiplierIncrease: t.multiplier - (state.teams.find((old) => old.name === t.name)?.multiplier ?? 1),
    damageTaken: damageByTeam.get(t.name) ?? 0,
  }));

  const completed: CompletedRound = {
    question: round.question,
    correctAnswer: round.answer,
    results,
    teamOutcomes,
    winningTeam,
  };

  console.log(`Round ${roundIndex} completed: winner=${winningTeam ?? "(tie)"}`);
  for (const t of newTeams) {
    console.log(
      `  Team '${t.name}': score=${teamScores.get(t.name) ?? 0}, hp=${t.hp}, multiplier=${t.multiplier}, multiplierIncrease=${t.multiplier - (state.teams.find((old) => old.name === t.name)?.multiplier ?? 1)}, damageTaken=${damageByTeam.get(t.name) ?? 0}`,
    );
  }

  const newRoundResults = [...state.roundResults];
  newRoundResults[roundIndex] = completed;

  return {
    state: {
      ...state,
      phase: { type: "results", roundIndex },
      teams: newTeams,
      roundResults: newRoundResults,
    },
    completed,
  };
}

export function advanceRound(
  state: GameState,
  quiz: Quiz,
  now: number,
): GameState {
  if (state.phase.type !== "results") {
    throw new Error(`Cannot advance: phase is '${state.phase.type}'`);
  }
  const nextIndex = state.phase.roundIndex + 1;
  if (nextIndex >= quiz.rounds.length) {
    return { ...state, phase: { type: "ended" } };
  }
  const round = quiz.rounds[nextIndex];
  if (!round) throw new Error(`Round ${nextIndex} unexpectedly missing`);
  const duration = (round.timeLimit ?? quiz.defaultTimeLimit) * 1000;
  return {
    ...state,
    phase: {
      type: "guessing",
      roundIndex: nextIndex,
      question: round.question,
      answer: { type: round.answer.type },
      startedAt: now,
      endsAt: now + duration,
      submittedPlayerIds: [],
    },
  };
}

export function endGame(state: GameState): GameState {
  if (state.phase.type === "ended") return state;
  return { ...state, phase: { type: "ended" } };
}

export function resetToLobby(state: GameState): GameState {
  if (state.phase.type === "lobby") return state;
  return {
    ...state,
    phase: { type: "lobby" },
    teams: state.teams.map((t) => ({ ...t, hp: 0, multiplier: 1 })),
    roundResults: [],
  };
}

export function kickPlayer(state: GameState, playerId: string): GameState {
  if (!state.players.some((p) => p.id === playerId)) {
    throw new Error(`Player '${playerId}' not in game`);
  }
  return {
    ...state,
    players: state.players.filter((p) => p.id !== playerId),
    teams: state.teams.map((t) => ({
      ...t,
      players: t.players.filter((id) => id !== playerId),
    })),
    phase:
      state.phase.type === "guessing"
        ? {
            ...state.phase,
            submittedPlayerIds: state.phase.submittedPlayerIds.filter(
              (id) => id !== playerId,
            ),
          }
        : state.phase,
  };
}

export function removeTeam(state: GameState, teamName: TeamId): GameState {
  if (state.phase.type !== "lobby") {
    throw new Error("Can only remove teams in the lobby");
  }
  if (!state.teams.some((t) => t.name === teamName)) {
    throw new Error(`Team '${teamName}' does not exist`);
  }
  return {
    ...state,
    teams: state.teams.filter((t) => t.name !== teamName),
    players: state.players.map((p) =>
      p.team === teamName ? { ...p, team: null } : p,
    ),
  };
}
