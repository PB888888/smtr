/**
 * Response shaping shared by every tool: format selection, character-limit
 * truncation, and the `confirmed` write interlock.
 */

import type { CallToolResult } from "@modelcontextprotocol/server";
import { CHARACTER_LIMIT } from "../constants.js";
import { ConfirmationRequiredError, formatError } from "./errors.js";

export const RESPONSE_FORMATS = ["markdown", "json"] as const;
export type ResponseFormat = (typeof RESPONSE_FORMATS)[number];

/**
 * What a tool handler returns.
 *
 * Aliased to the SDK's own result type rather than redeclared, so the two cannot
 * drift apart as the SDK evolves.
 */
export type ToolResponse = CallToolResult;

/**
 * Build a successful tool response.
 *
 * `structuredContent` always carries the full structured object; the text block
 * carries either markdown or the same JSON, depending on what was asked for.
 */
export function ok(
  output: Record<string, unknown>,
  markdown: string,
  format: ResponseFormat,
): ToolResponse {
  const text = format === "markdown" ? markdown : JSON.stringify(output, null, 2);
  return {
    content: [{ type: "text", text: truncate(text) }],
    structuredContent: output,
  };
}

/** Build a failed tool response, with the error explained actionably. */
export function fail(error: unknown, toolName: string): ToolResponse {
  return {
    content: [{ type: "text", text: truncate(formatError(error, toolName)) }],
    isError: true,
  };
}

/**
 * Truncate at the character limit, telling the reader how to get the rest
 * rather than just cutting off mid-sentence.
 */
export function truncate(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  const notice =
    `\n\n---\n[Response truncated at ${CHARACTER_LIMIT} characters. ` +
    `Narrow the request — reduce 'limit', add a date range, or set ` +
    `unanswered_only/unread_only — then page through with the returned cursor.]`;
  return text.slice(0, CHARACTER_LIMIT - notice.length) + notice;
}

/**
 * The write interlock.
 *
 * Every write tool calls this first. When `confirmed` is not exactly `true` it
 * throws, and the thrown message states precisely what would have happened —
 * target, and the content that would have been published — so the caller can
 * show the operator the consequence before re-invoking with `confirmed: true`.
 *
 * This is a real gate, not a formality: it runs before the Graph API client is
 * touched, so an unconfirmed call cannot reach Meta even in principle.
 */
export function requireConfirmation(args: {
  confirmed: boolean;
  toolName: string;
  action: string;
  targetId: string;
  /** Content that would be published, if any. Shown verbatim. */
  content?: string;
  /** Extra context worth showing before approval, e.g. the author's name. */
  details?: Record<string, unknown>;
}): void {
  if (args.confirmed === true) return;

  const lines = [
    `Refused: ${args.toolName} requires confirmation and was called with confirmed: false.`,
    "",
    "Nothing was sent. No API call was made.",
    "",
    "What this call WOULD do:",
    `  Action: ${args.action}`,
    `  Target: ${args.targetId}`,
  ];

  if (args.details) {
    for (const [key, value] of Object.entries(args.details)) {
      lines.push(`  ${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
    }
  }

  if (args.content !== undefined) {
    lines.push("", "Content that would be published, verbatim:", "  ---", ...args.content.split("\n").map((l) => `  ${l}`), "  ---");
  }

  lines.push(
    "",
    "This is a safety interlock. Show the above to Jake, and only if he approves it,",
    "call this tool again with confirmed: true. Do not set confirmed: true on his",
    "behalf, and do not assume approval from an earlier, different call.",
  );

  throw new ConfirmationRequiredError(lines.join("\n"));
}

/** Standard pagination metadata, shaped consistently across list tools. */
export function paginationMeta(args: {
  count: number;
  hasMore: boolean;
  nextCursor?: string;
}): Record<string, unknown> {
  return {
    count: args.count,
    has_more: args.hasMore,
    ...(args.nextCursor ? { next_cursor: args.nextCursor } : {}),
  };
}
