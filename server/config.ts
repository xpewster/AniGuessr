import * as fs from "fs";
import * as path from "path";

export type ServerConfig = {
  /** Port for the HTTP/WebSocket server. */
  port: number;
  /** Shared secret. Required for player join, host login, and the
   *  /api/google-key endpoint. */
  password: string;
  /** Optional. Returned by POST /api/google-key when the password matches. */
  googleApiKey?: string;
};

const DEFAULTS = {
  port: 8080,
};

export const QUIZ_DATA_DIR = path.resolve("./quiz-data");

export function loadConfig(): ServerConfig {
  if (!fs.existsSync(QUIZ_DATA_DIR)) {
    throw new Error(`Quiz data directory does not exist: ${QUIZ_DATA_DIR}`);
  }
  const configPath = path.join(QUIZ_DATA_DIR, "config.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `${configPath} is required. Must contain at least { "password": "..." }`,
    );
  }
  const raw = fs.readFileSync(configPath, "utf-8");
  const parsed = JSON.parse(raw) as Partial<ServerConfig>;
  if (!parsed.password || typeof parsed.password !== "string") {
    throw new Error(
      `${configPath} must define a non-empty 'password' string`,
    );
  }
  // Treat empty string googleApiKey as absent.
  const googleApiKey =
    typeof parsed.googleApiKey === "string" && parsed.googleApiKey.length > 0
      ? parsed.googleApiKey
      : undefined;
  return {
    ...DEFAULTS,
    ...parsed,
    password: parsed.password,
    googleApiKey,
  };
}
