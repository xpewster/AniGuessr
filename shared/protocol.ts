import type { Answer, Guess } from "./types";
import type { GameState, TeamId } from "./game";

// -----------------------------------------------------------------------------
// Client → Server.
// -----------------------------------------------------------------------------

export type ClientMessage =
  | JoinMessage
  | HostLoginMessage
  | JoinTeamMessage
  | UpdateGuessMessage
  | SubmitGuessMessage
  | CreateTeamMessage
  | StartGameMessage
  | AdvanceRoundMessage
  | EndGameMessage
  | ResetToLobbyMessage
  | KickPlayerMessage
  | RemoveTeamMessage;

/** First message from a player connection. Password is the shared secret. */
export type JoinMessage = {
  type: "join";
  name: string;
  password: string;
};

/** First message from a host connection. */
export type HostLoginMessage = {
  type: "host_login";
  password: string;
};

/** Player-only. Lobby only. Joins or switches to an existing team. */
export type JoinTeamMessage = {
  type: "join_team";
  team: TeamId;
};

/**
 * Player-only. During guessing phase only, before submission.
 * Latest call wins; broadcast to teammates.
 */
export type UpdateGuessMessage = {
  type: "update_guess";
  guess: Guess;
};

/**
 * Player-only. Locks in the current marker. First submission shortens the
 * timer to submitGracePeriodSeconds if remaining > that. After submitting,
 * update_guess is rejected. Round ends when all connected players have
 * submitted, or the timer expires.
 */
export type SubmitGuessMessage = {
  type: "submit_guess";
};

/** Host-only. Lobby only. Creates a new team. Names must be unique. */
export type CreateTeamMessage = {
  type: "create_team";
  name: string;
};

/** Host-only. Lobby → Guessing(0). Requires all players on teams. */
export type StartGameMessage = {
  type: "start_game";
};

/** Host-only. Results(N) → Guessing(N+1) or Ended. */
export type AdvanceRoundMessage = {
  type: "advance_round";
};

/** Host-only. Any phase → Ended (terminal). */
export type EndGameMessage = {
  type: "end_game";
};

/** Host-only. Any phase → Lobby (resets game). */
export type ResetToLobbyMessage = {
  type: "reset_to_lobby";
};

/** Host-only. Any phase */
export type KickPlayerMessage = {
  type: "kick_player";
  playerId: string;
};

/** Host-only. Lobby only. */
export type RemoveTeamMessage = {
  type: "remove_team";
  name: TeamId;
};


// -----------------------------------------------------------------------------
// Server → Client.
// -----------------------------------------------------------------------------

export type ServerMessage =
  | WelcomeMessage
  | HostWelcomeMessage
  | StateMessage
  | TeammateGuessMessage
  | ErrorMessage
  | RoundAnswerMessage;

export type WelcomeMessage = {
  type: "welcome";
  playerId: string;
  reconnected: boolean;
  quizInfo: {
    name: string;
    description?: string;
    totalRounds: number;
    startingHp: number;
  };
};

export type HostWelcomeMessage = {
  type: "host_welcome";
  quizInfo: {
    name: string;
    description?: string;
    totalRounds: number;
    startingHp: number;
  };
};

export type StateMessage = {
  type: "state";
  state: GameState;
};

export type TeammateGuessMessage = {
  type: "teammate_guess";
  playerId: string;
  guess: Guess | null;
};

export type ErrorMessage = {
  type: "error";
  message: string;
};

export type RoundAnswerMessage = {
  type: "round_answer";
  roundIndex: number;
  answer: Answer;
};
