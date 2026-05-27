// Server entry point.

import * as http from "http";
import { loadConfig, type ServerConfig } from "./config";
import { loadQuiz } from "./quiz-loader";
import { GameServer } from "./ws-server";

function main(): void {
  const config = loadConfig();
  const loaded = loadQuiz();

  const httpServer = http.createServer((req, res) => {
    handleHttp(req, res, config);
  });

  const game = new GameServer(loaded, config);
  game.attach(httpServer);

  httpServer.listen(config.port, () => {
    console.log(`Quiz: ${loaded.quiz.name}`);
    console.log(`  ${loaded.quiz.rounds.length} rounds`);
    console.log(`  default time limit:  ${loaded.quiz.defaultTimeLimit}s`);
    console.log(`  submit grace period: ${loaded.quiz.submitGracePeriodSeconds}s`);
    console.log(
      `  google api key:      ${config.googleApiKey ? "configured" : "(none)"}`,
    );
    console.log();
    console.log(`Listening on http://localhost:${config.port}/`);
  });
}

// -----------------------------------------------------------------------------
// HTTP routing.
//   POST /api/google-key  body: { password }  →  { key }   (or 401 / 404)
// Player + host pages will be served from this same server when the client
// is built.
// -----------------------------------------------------------------------------

function handleHttp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: ServerConfig,
): void {
  // 1. Set headers to allow access from any origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  // 2. Handle preflight (OPTIONS) requests
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.writeHead(204); // No Content
    res.end();
    return;
  }

  if (req.method === "POST" && req.url === "/api/google-key") {
    readJsonBody(req)
      .then((body) => {
        console.log("Received request for Google API key from", req.socket.remoteAddress, "with password", body.password);
        const password = typeof body.password === "string" ? body.password : "";
        if (password !== config.password) {
          return jsonResponse(res, 401, { error: "incorrect password" });
        }
        if (!config.googleApiKey) {
          return jsonResponse(res, 404, { error: "no key configured" });
        }
        return jsonResponse(res, 200, { key: config.googleApiKey });
      })
      .catch(() => jsonResponse(res, 400, { error: "invalid request body" }));
    return;
  }
  res.writeHead(404);
  res.end();
}

function readJsonBody(
  req: http.IncomingMessage,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (chunk) => {
      buf += chunk;
      if (buf.length > 1024 * 16) {
        req.destroy();
        reject(new Error("body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(buf) as Record<string, unknown>);
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function jsonResponse(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

main();
