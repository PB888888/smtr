#!/usr/bin/env node
/**
 * Streamable HTTP entry point — stateless JSON, for later remote hosting.
 *
 * Not needed for the cron runner or for local use; it exists so the server can
 * move to a host without being rewritten. It binds to 127.0.0.1 by default,
 * which switches on the SDK's DNS-rebinding protection.
 *
 * Bearer authentication is deliberately NOT configured here. Exposing this
 * beyond localhost without putting authentication in front of it would hand
 * anyone who can reach the port the ability to post as Paddock Blade. See the
 * warning printed at startup.
 */

import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { createMcpHandler } from "@modelcontextprotocol/server";
import type { Request as ExpressRequest, Response as ExpressResponse } from "express";
import { getConfig } from "./config.js";
import { auditPath } from "./services/audit.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "127.0.0.1";

/** Convert an Express request into the web-standard Request the handler expects. */
function toWebRequest(req: ExpressRequest, host: string, port: number): Request {
  const url = new URL(req.originalUrl || req.url, `http://${host}:${port}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  const hasBody = req.method !== "GET" && req.method !== "HEAD";

  return new Request(url, {
    method: req.method,
    headers,
    ...(hasBody && req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
  });
}

/** Copy a web-standard Response back onto the Express response. */
async function sendWebResponse(webResponse: Response, res: ExpressResponse): Promise<void> {
  res.status(webResponse.status);
  webResponse.headers.forEach((value, key) => {
    // Express manages the transfer encoding itself; copying it corrupts the stream.
    if (key.toLowerCase() !== "transfer-encoding") res.setHeader(key, value);
  });

  if (!webResponse.body) {
    res.end();
    return;
  }

  const reader = webResponse.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
    res.end();
  }
}

async function main(): Promise<void> {
  let config;
  try {
    config = getConfig();
  } catch (error) {
    process.stderr.write(
      `\n${SERVER_NAME} cannot start.\n\n${error instanceof Error ? error.message : String(error)}\n\n`,
    );
    process.exit(1);
  }

  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  const host = process.env.HOST ?? DEFAULT_HOST;

  // A fresh server per request keeps this stateless — no sessions to track, and
  // no risk of request IDs colliding between clients.
  //
  // responseMode 'json' returns a single JSON body rather than upgrading to an SSE
  // stream. None of these tools emit mid-call progress notifications, so there is
  // nothing to lose by never streaming, and a plain JSON response is far easier to
  // put behind an ordinary reverse proxy or load balancer later.
  //
  // Note this governs modern-envelope exchanges only, and verified behaviour with
  // SDK 2.0.0 is that a plain JSON-RPC POST is classified as legacy-era and served
  // over the stateless legacy path, which is SSE-framed regardless of this setting.
  // So in practice today most clients get `event: message` framing here. That is the
  // SDK's classification, not a session: serving is still stateless either way — a
  // fresh instance per request, no session IDs, GET and DELETE answered with 405.
  // The setting is correct for clients that do use the modern envelope, and needs no
  // change when more of them do.
  const handler = createMcpHandler(() => createServer(), {
    responseMode: "json",
    onerror: (error: Error) => {
      process.stderr.write(`[http] ${error.message}\n`);
    },
  });
  const app = createMcpExpressApp({ host });

  app.post("/mcp", async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const webResponse = await handler.fetch(toWebRequest(req, host, port), {
        parsedBody: req.body,
      });
      await sendWebResponse(webResponse, res);
    } catch (error) {
      process.stderr.write(
        `[http] request failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  app.get("/healthz", (_req: ExpressRequest, res: ExpressResponse) => {
    res.json({ status: "ok", server: SERVER_NAME, version: SERVER_VERSION });
  });

  app.listen(port, host, () => {
    process.stderr.write(
      `${SERVER_NAME} ${SERVER_VERSION} listening on http://${host}:${port}/mcp\n` +
        `  Graph API version: ${config.graphApiVersion}\n` +
        `  Dry run: ${config.dryRun ? "ON — writes are logged, not sent" : "off"}\n` +
        `  Audit log: ${auditPath()}\n`,
    );
    if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
      process.stderr.write(
        "\n  ⚠️  WARNING: bound to a non-localhost address with no authentication.\n" +
          "     Anyone who can reach this port can post publicly as Paddock Blade and read\n" +
          "     your customers' private messages. Put a reverse proxy with authentication in\n" +
          "     front of it, or bind to 127.0.0.1 and tunnel over SSH instead.\n\n",
      );
    }
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`Server error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
