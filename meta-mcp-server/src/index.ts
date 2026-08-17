#!/usr/bin/env node
/**
 * stdio entry point — the transport for local use, and what the MCP Inspector
 * and Claude Desktop connect to.
 *
 * Note that nothing here writes to stdout: on a stdio transport stdout carries
 * the JSON-RPC stream, so any stray log line corrupts the protocol. All
 * diagnostics go to stderr.
 */

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { getConfig } from "./config.js";
import { auditPath } from "./services/audit.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

function main(): void {
  let config;
  try {
    config = getConfig();
  } catch (error) {
    process.stderr.write(
      `\n${SERVER_NAME} cannot start.\n\n${error instanceof Error ? error.message : String(error)}\n\n`,
    );
    process.exit(1);
  }

  serveStdio(() => createServer());

  process.stderr.write(
    `${SERVER_NAME} ${SERVER_VERSION} running on stdio\n` +
      `  Graph API version: ${config.graphApiVersion}\n` +
      `  Dry run: ${config.dryRun ? "ON — writes are logged, not sent" : "off"}\n` +
      `  Audit log: ${auditPath()}\n` +
      `Run the meta_check_access tool first to verify the token and scopes.\n`,
  );
}

main();
