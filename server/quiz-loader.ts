import * as fs from "fs";
import * as path from "path";
import type { Answer, Question, Quiz } from "../shared/types";
import { assertNever } from "../shared/types";
import { QUIZ_DATA_DIR } from "./config";

export class LoadedQuiz {
  readonly quiz: Quiz;
  readonly directory: string;

  constructor(quiz: Quiz, directory: string) {
    this.quiz = quiz;
    this.directory = directory;
  }
}

export function loadQuiz(): LoadedQuiz {
  const quizFile = path.join(QUIZ_DATA_DIR, "quiz.json");
  if (!fs.existsSync(quizFile)) {
    throw new Error(`No quiz.json found in ${QUIZ_DATA_DIR}`);
  }
  const raw = fs.readFileSync(quizFile, "utf-8");
  const quiz = JSON.parse(raw) as Quiz;
  validateQuiz(quiz);
  return new LoadedQuiz(quiz, QUIZ_DATA_DIR);
}

// ---------------------------------------------------------------------------
// Validation.
// ---------------------------------------------------------------------------

function validateQuiz(quiz: Quiz): void {
  if (typeof quiz.name !== "string" || !quiz.name) {
    throw new Error("Quiz: missing or empty 'name'");
  }
  if (typeof quiz.startingHp !== "number" || quiz.startingHp <= 0) {
    throw new Error("Quiz: 'startingHp' must be a positive number");
  }
  if (typeof quiz.multiplierStep !== "number" || quiz.multiplierStep < 0) {
    throw new Error("Quiz: 'multiplierStep' must be a non-negative number");
  }
  if (
    typeof quiz.defaultTimeLimit !== "number" ||
    quiz.defaultTimeLimit <= 0
  ) {
    throw new Error("Quiz: 'defaultTimeLimit' must be a positive number");
  }
  if (
    typeof quiz.submitGracePeriodSeconds !== "number" ||
    quiz.submitGracePeriodSeconds < 0
  ) {
      throw new Error(
          "Quiz: 'submitGracePeriodSeconds' must be a non-negative number",
      );
  }
  if (!Array.isArray(quiz.rounds) || quiz.rounds.length === 0) {
    throw new Error("Quiz: must have at least one round");
  }
  for (const [i, round] of quiz.rounds.entries()) {
    validateQuestion(round.question, i);
    validateAnswer(round.answer, i);
  }
}

function validateQuestion(q: Question, roundIdx: number): void {
  switch (q.type) {
    case "image":
      if (typeof q.src !== "string" || !q.src) {
        throw new Error(`Round ${roundIdx}: image question missing 'src'`);
      }
      return;
    case "text":
      if (typeof q.content !== "string" || !q.content) {
        throw new Error(`Round ${roundIdx}: text question missing 'content'`);
      }
      return;
    default:
      assertNever(q);
  }
}

function validateAnswer(a: Answer, roundIdx: number): void {
  switch (a.type) {
    case "map": {
      if (
        !a.correct ||
        typeof a.correct.lat !== "number" ||
        typeof a.correct.lng !== "number"
      ) {
        throw new Error(
          `Round ${roundIdx}: map answer needs 'correct: { lat, lng }'`,
        );
      }
      if (
        !a.scoring ||
        typeof a.scoring.maxScore !== "number" ||
        typeof a.scoring.scaleKm !== "number" ||
        a.scoring.scaleKm <= 0
      ) {
        throw new Error(
          `Round ${roundIdx}: map answer needs 'scoring.maxScore' and positive 'scoring.scaleKm'`,
        );
      }
      return;
    }
    case "text": {
      if (!Array.isArray(a.correct) || a.correct.length === 0) {
        throw new Error(
          `Round ${roundIdx}: text answer needs non-empty 'correct: string[]'`,
        );
      }
      return;
    }
    default:
      assertNever(a);
  }
}