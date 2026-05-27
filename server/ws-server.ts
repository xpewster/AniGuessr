// =============================================================================
// WebSocket server.
//
// Each connection picks its role with its first message:
//   - `join { name, password }`         → player
//   - `host_login { password }`         → host
// Wrong password closes the socket with an error. Subsequent messages on
// the connection are scoped to that role.
// =============================================================================

import * as http from "http";
import { WebSocket, WebSocketServer } from "ws";
import type { Guess, Quiz } from "../shared/types";
import type { GameState, TeamId } from "../shared/game";
import type { ClientMessage, ServerMessage } from "../shared/protocol";
import {
  addOrReconnect,
  advanceRound,
  createInitialState,
  createTeam,
  endGame,
  endGuessing,
  joinTeam,
  kickPlayer,
  removeTeam,
  resetToLobby,
  setDisconnected,
  startGame,
  submitGuess,
} from "./game-engine";
import type { LoadedQuiz } from "./quiz-loader";
import type { ServerConfig } from "./config";

type Role = "unidentified" | "player" | "host";

type SocketInfo = {
  role: Role;
  playerId?: string;
};

export class GameServer {
  private state: GameState = createInitialState();
  private playerSockets = new Map<string, WebSocket>();
  private hostSocket: WebSocket | null = null;
  private socketInfo = new WeakMap<WebSocket, SocketInfo>();
  private liveGuesses = new Map<string, Guess>();
  private guessingTimer: NodeJS.Timeout | null = null;
  private readonly quiz: Quiz;

  constructor(
    private readonly loaded: LoadedQuiz,
    private readonly config: ServerConfig,
  ) {
    this.quiz = loaded.quiz;
  }

  attach(httpServer: http.Server): void {
    const wss = new WebSocketServer({ server: httpServer });
    wss.on("connection", (socket) => this.onConnection(socket));
  }

  // ---------------------------------------------------------------------------
  // Connection lifecycle.
  // ---------------------------------------------------------------------------

  private onConnection(socket: WebSocket): void {
    this.socketInfo.set(socket, { role: "unidentified" });

    socket.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        this.sendError(socket, "Invalid JSON");
        return;
      }
      try {
        this.handleMessage(socket, msg);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Unknown error";
        this.sendError(socket, message);
      }
    });

    socket.on("close", () => this.onSocketClose(socket));
    socket.on("error", () => this.onSocketClose(socket));
  }

  private onSocketClose(socket: WebSocket): void {
    const info = this.socketInfo.get(socket);
    if (!info) return;
    this.socketInfo.delete(socket);

    if (info.role === "host" && this.hostSocket === socket) {
      this.hostSocket = null;
      return;
    }

    if (info.role === "player" && info.playerId) {
      const playerId = info.playerId;
      if (this.playerSockets.get(playerId) !== socket) return;
      this.playerSockets.delete(playerId);
      this.state = setDisconnected(this.state, playerId);
      this.broadcastState();
    }
  }

  // ---------------------------------------------------------------------------
  // Message routing.
  // ---------------------------------------------------------------------------

  private handleMessage(socket: WebSocket, msg: ClientMessage): void {
    const info = this.socketInfo.get(socket);
    if (!info) return;

    if (info.role === "unidentified") {
      if (msg.type === "join") {
        console.log("Player attempting to join with name:", msg.name, "and password:", msg.password);
        this.handleJoin(socket, msg.name, msg.password);
        return;
      }
      if (msg.type === "host_login") {
        console.log("Host attempting to login with password:", msg.password);
        this.handleHostLogin(socket, msg.password);
        return;
      }
      throw new Error("First message must be 'join' or 'host_login'");
    }

    console.log("Received message from", info.role, info.playerId ?? "", ":", msg.type);

    if (info.role === "player") {
      const playerId = info.playerId;
      if (!playerId) throw new Error("Internal: player role without id");
      switch (msg.type) {
        case "join_team":
          this.handleJoinTeam(playerId, msg.team);
          return;
        case "update_guess":
          this.handleUpdateGuess(playerId, msg.guess);
          return;
        case "submit_guess":
          this.handleSubmitGuess(playerId);
          return;
        case "join":
        case "host_login":
          throw new Error("Already identified");
        case "create_team":
        case "start_game":
        case "advance_round":
        case "end_game":
        case "reset_to_lobby":
        case "kick_player":
        case "remove_team":
          throw new Error("Only the host can do that");
      }
    }

    if (info.role === "host") {
      switch (msg.type) {
        case "create_team":
          this.handleCreateTeam(msg.name);
          return;
        case "remove_team":
          this.handleRemoveTeam(msg.name);
          return;
        case "start_game":
          this.handleStartGame();
          return;
        case "advance_round":
          this.handleAdvanceRound();
          return;
        case "end_game":
          this.handleEndGame();
          return;
        case "join":
        case "host_login":
          throw new Error("Already identified");
        case "join_team":
        case "update_guess":
        case "submit_guess":
          throw new Error("Host doesn't play");
        case "reset_to_lobby":
          this.handleResetToLobby();
          return;
        case "kick_player":
          this.handleKickPlayer(msg.playerId);
          return;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Player handlers.
  // ---------------------------------------------------------------------------

  private handleJoin(
    socket: WebSocket,
    rawName: string,
    password: string,
  ): void {
    if (password !== this.config.password) {
      this.sendError(socket, "Incorrect password");
      try {
        socket.close(1000, "Auth failed");
      } catch {
        /* ignore */
      }
      return;
    }
    const name = rawName.trim();
    if (!name) throw new Error("Name cannot be empty");

    const prior = this.playerSockets.get(name);
    if (prior && prior !== socket) {
      const priorInfo = this.socketInfo.get(prior);
      if (priorInfo) priorInfo.playerId = undefined;
      try {
        prior.close(1000, "Replaced by new connection");
      } catch {
        /* ignore */
      }
    }

    const { state, reconnected } = addOrReconnect(this.state, name);
    this.state = state;
    this.playerSockets.set(name, socket);
    this.socketInfo.set(socket, { role: "player", playerId: name });

    this.send(socket, {
      type: "welcome",
      playerId: name,
      reconnected,
      quizInfo: this.quizInfo(),
    });
    this.broadcastState();
    this.replayLiveGuessesTo(socket, name);
  }

  private handleJoinTeam(playerId: string, team: TeamId): void {
    this.state = joinTeam(this.state, playerId, team);
    this.broadcastState();
  }

  private handleUpdateGuess(playerId: string, guess: Guess): void {
    if (this.state.phase.type !== "guessing") {
      throw new Error("Not in guessing phase");
    }
    if (this.state.phase.submittedPlayerIds.includes(playerId)) {
      throw new Error("You've already submitted — can't change your guess");
    }
    this.liveGuesses.set(playerId, guess);
    this.broadcastTeammateGuess(playerId, guess);
  }

  private handleSubmitGuess(playerId: string): void {
    if (this.state.phase.type !== "guessing") {
      throw new Error("Not in guessing phase");
    }
    if (!this.liveGuesses.has(playerId)) {
      throw new Error("Place a marker before submitting");
    }
    const result = submitGuess(
      this.state,
      playerId,
      Date.now(),
      this.quiz.submitGracePeriodSeconds * 1000,
    );
    this.state = result.state;
    this.broadcastState();
    if (result.allSubmitted) {
      this.endGuessingNow();
    } else if (result.timerShortened) {
      this.scheduleGuessingEnd();
    }
  }

  // ---------------------------------------------------------------------------
  // Host handlers.
  // ---------------------------------------------------------------------------

  private handleHostLogin(socket: WebSocket, password: string): void {
    if (password !== this.config.password) {
      this.sendError(socket, "Incorrect password");
      try {
        socket.close(1000, "Auth failed");
      } catch {
        /* ignore */
      }
      return;
    }
    if (this.hostSocket && this.hostSocket !== socket) {
      try {
        this.hostSocket.close(1000, "Replaced by new host connection");
      } catch {
        /* ignore */
      }
    }
    this.hostSocket = socket;
    this.socketInfo.set(socket, { role: "host" });
    this.send(socket, {
      type: "host_welcome",
      quizInfo: this.quizInfo(),
    });
    this.send(socket, { type: "state", state: this.state });
    this.replayLiveGuessesToHost(socket);
    this.sendRoundAnswerToHost();
  }

  private handleCreateTeam(name: string): void {
    this.state = createTeam(this.state, name);
    this.broadcastState();
  }

  private handleRemoveTeam(name: string): void {
    this.state = removeTeam(this.state, name);
    this.broadcastState();
  }

  private handleStartGame(): void {
    this.state = startGame(this.state, this.quiz, Date.now());
    this.liveGuesses.clear();
    this.broadcastState();
    this.scheduleGuessingEnd();
    this.sendRoundAnswerToHost();
  }

  private handleAdvanceRound(): void {
    this.state = advanceRound(this.state, this.quiz, Date.now());
    this.liveGuesses.clear();
    this.broadcastState();
    if (this.state.phase.type === "guessing") {
      this.scheduleGuessingEnd();
      this.sendRoundAnswerToHost();
    }
  }

  private handleEndGame(): void {
    this.state = endGame(this.state);
    this.cancelGuessingTimer();
    this.liveGuesses.clear();
    this.broadcastState();
  }

  // ---------------------------------------------------------------------------
  // Guessing-phase timer (only thing the server self-triggers).
  // ---------------------------------------------------------------------------

  private scheduleGuessingEnd(): void {
    this.cancelGuessingTimer();
    if (this.state.phase.type !== "guessing") return;
    const delay = this.state.phase.endsAt - Date.now();
    this.guessingTimer = setTimeout(
      () => this.endGuessingNow(),
      Math.max(0, delay),
    );
  }

  private cancelGuessingTimer(): void {
    if (this.guessingTimer) {
      clearTimeout(this.guessingTimer);
      this.guessingTimer = null;
    }
  }

  private endGuessingNow(): void {
    this.cancelGuessingTimer();
    if (this.state.phase.type !== "guessing") return;
    const { state } = endGuessing(this.state, this.quiz, this.liveGuesses);
    this.state = state;
    this.liveGuesses.clear();
    this.broadcastState();
  }

  private handleResetToLobby(): void {
    this.cancelGuessingTimer();
    this.state = resetToLobby(this.state);
    this.liveGuesses.clear();
    this.broadcastState();
  }

  private handleKickPlayer(playerId: string): void {
    // Snapshot before kick so we know whether to close a socket.
    const socket = this.playerSockets.get(playerId);

    this.state = kickPlayer(this.state, playerId);
    this.liveGuesses.delete(playerId);

    if (socket) {
      this.playerSockets.delete(playerId);
      try {
        socket.close(1000, "Kicked by host");
      } catch {
        /* ignore */
      }
    }

    this.broadcastState();

    // If the kick removed the last unsubmitted player, end the round now.
    const phase = this.state.phase;
    if (phase.type === "guessing") {
      const connected = this.state.players.filter((p) => p.connected);
      if (
        connected.length > 0 &&
        connected.every((p) => phase.submittedPlayerIds.includes(p.id))
      ) {
        this.endGuessingNow();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers.
  // ---------------------------------------------------------------------------

  private quizInfo() {
    return {
      name: this.quiz.name,
      description: this.quiz.description,
      totalRounds: this.quiz.rounds.length,
      startingHp: this.quiz.startingHp,
    };
  }

  private replayLiveGuessesTo(socket: WebSocket, playerId: string): void {
    if (this.state.phase.type !== "guessing") return;
    const me = this.state.players.find((p) => p.id === playerId);
    if (!me || me.team === null) return;
    for (const teammate of this.state.players) {
      if (teammate.team !== me.team) continue;
      const guess = this.liveGuesses.get(teammate.id);
      if (guess) {
        this.send(socket, {
          type: "teammate_guess",
          playerId: teammate.id,
          guess,
        });
      }
    }
  }

  private replayLiveGuessesToHost(socket: WebSocket): void {
    if (this.state.phase.type !== "guessing") return;
    for (const [playerId, guess] of this.liveGuesses) {
        this.send(socket, { type: "teammate_guess", playerId, guess });
    }
  }

  private sendRoundAnswerToHost(socket?: WebSocket): void {
    const target = socket ?? this.hostSocket;
    if (!target) return;
    if (this.state.phase.type !== "guessing") return;
    const roundIndex = this.state.phase.roundIndex;
    const round = this.quiz.rounds[roundIndex];
    if (!round) return;
    this.send(target, {
        type: "round_answer",
        roundIndex,
        answer: round.answer,
    });
  }

  private broadcastState(): void {
    const msg: ServerMessage = { type: "state", state: this.state };
    const json = JSON.stringify(msg);
    for (const s of this.playerSockets.values()) {
      if (s.readyState === WebSocket.OPEN) s.send(json);
    }
    if (this.hostSocket?.readyState === WebSocket.OPEN) {
      this.hostSocket.send(json);
    }
  }

  private broadcastTeammateGuess(senderId: string, guess: Guess): void {
    const senderTeam = this.state.players.find((p) => p.id === senderId)?.team;
    if (!senderTeam) return;
    for (const teammate of this.state.players) {
      if (teammate.team !== senderTeam) continue;
      if (teammate.id === senderId) continue;
      const sock = this.playerSockets.get(teammate.id);
      if (sock) {
        this.send(sock, {
          type: "teammate_guess",
          playerId: senderId,
          guess,
        });
      }
    }

    // Also send to the host so they can spectate (any team's guesses).
    if (this.hostSocket) {
        this.send(this.hostSocket, {
            type: "teammate_guess",
            playerId: senderId,
            guess,
        });
    }
  }

  private send(socket: WebSocket, msg: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msg));
    }
  }

  private sendError(socket: WebSocket, message: string): void {
    this.send(socket, { type: "error", message });
  }
}
