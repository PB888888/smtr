/**
 * Zod fragments shared across tool schemas, so constraints and wording stay
 * consistent and are defined once.
 */

import { z } from "zod";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../constants.js";
import { RESPONSE_FORMATS } from "../services/respond.js";

export const ResponseFormatField = z
  .enum(RESPONSE_FORMATS)
  .default("markdown")
  .describe("Output format: 'markdown' for human-readable, 'json' for machine-readable");

export const PlatformField = z
  .enum(["facebook", "instagram"])
  .describe(
    "Which platform the target belongs to. 'facebook' for Page posts, comments and " +
      "Messenger; 'instagram' for IG media, comments and IG Direct. The two use " +
      "different Graph API endpoints, so this must be correct.",
  );

export const LimitField = z
  .number()
  .int()
  .min(1)
  .max(MAX_PAGE_SIZE)
  .default(DEFAULT_PAGE_SIZE)
  .describe(`Maximum items to return (1-${MAX_PAGE_SIZE})`);

export const CursorField = z
  .string()
  .optional()
  .describe("Pagination cursor from a previous call's next_cursor. Omit for the first page.");

/**
 * A Graph API object ID.
 *
 * Accepts a number as well as a string and coerces it. Graph API IDs are long
 * digit strings, and both LLM clients and command-line tools routinely emit them
 * as JSON numbers; rejecting those would be technically correct and practically
 * useless. Coercing is safe because the value is only ever interpolated into a
 * URL path, and the character check below still applies afterwards.
 */
export const IdField = (what: string) =>
  z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim())
    .refine((value) => value.length > 0, { message: `${what} must not be empty` })
    .refine((value) => /^[A-Za-z0-9_\-.:]+$/.test(value), {
      message: `${what} should be a Graph API object ID — digits, or digits joined by an underscore`,
    })
    .describe(what);

/**
 * The write interlock parameter.
 *
 * Required, not optional with a default — an agent must state its intent
 * explicitly. A default of `false` would still be a decision the caller did not
 * make consciously, and this gate is the last thing standing between a draft and
 * a real customer seeing it.
 */
export const ConfirmedField = z
  .boolean()
  .describe(
    "Safety interlock. Must be true for this write to execute. When false, the tool " +
      "makes no API call and instead returns exactly what it would have done, so a " +
      "human can review it first. Only set true after Jake has approved this specific " +
      "action.",
  );

export const ApprovalRefField = z
  .string()
  .optional()
  .describe(
    "Optional reference tying this write to an approved review-queue item, e.g. " +
      "'2026-08-17-queue#3'. Recorded in the audit log so a sent reply can be traced " +
      "back to the approval that authorised it.",
  );

/** Output fragment describing a rate-limit or pagination envelope. */
export const PaginationOutput = {
  count: z.number().describe("Number of items in this response"),
  has_more: z.boolean().describe("Whether more items are available"),
  next_cursor: z.string().optional().describe("Cursor to pass as 'after' for the next page"),
};

export const CommentOutput = z.object({
  id: z.string(),
  platform: z.enum(["facebook", "instagram"]),
  author_name: z.string().optional(),
  author_id: z.string().optional(),
  text: z.string(),
  created_time: z.string(),
  like_count: z.number().optional(),
  reply_count: z.number().optional(),
  parent_id: z.string().optional(),
  is_hidden: z.boolean().optional(),
  /** True when no reply from the Page appears beneath this comment. */
  appears_unanswered: z.boolean().optional(),
  permalink: z.string().optional(),
});

export const WindowOutput = z.object({
  state: z.enum(["open", "human_agent_only", "closed", "unknown"]),
  hours_since_last_user_message: z.number().nullable(),
  hours_until_window_closes: z.number().nullable(),
  can_send: z.boolean(),
  required_tag: z.literal("HUMAN_AGENT").optional(),
  explanation: z.string(),
});
