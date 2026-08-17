/**
 * Server construction, shared by both transports.
 *
 * Kept separate from the entry points so stdio and streamable HTTP register an
 * identical tool set — there is no way for the two to drift apart.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { registerCommentTools } from "./tools/comments.js";
import { registerConversationTools } from "./tools/conversations.js";
import { registerDiagnosticTools } from "./tools/diagnostics.js";
import { registerInsightTools } from "./tools/insights.js";
import { registerPageTools } from "./tools/pages.js";
import { registerPostTools } from "./tools/posts.js";

export const SERVER_NAME = "meta-mcp-server";
export const SERVER_VERSION = "0.1.0";

/** Build a fully configured server instance. */
export function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerDiagnosticTools(server);
  registerPageTools(server);
  registerPostTools(server);
  registerCommentTools(server);
  registerConversationTools(server);
  registerInsightTools(server);

  return server;
}
