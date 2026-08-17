/**
 * Comment tools: read, reply, hide, unhide, delete.
 *
 * Facebook and Instagram diverge more here than anywhere else — different field
 * names (`message` vs `text`), different reply endpoints (`/comments` vs
 * `/replies`), and different hide parameters (`is_hidden` vs `hide`). All of that
 * is normalised behind one shape so callers think about comments, not endpoints.
 *
 * On hide versus delete: hiding is reversible and leaves the comment visible to
 * its author, so they do not know they were moderated. Deleting cannot be undone.
 * `meta_delete_comment` is the only tool here marked destructive, and triage
 * should always prefer hiding.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { withAudit } from "../services/audit.js";
import { getConfig } from "../config.js";
import { graphRequest, graphRequestAll, resolvePageToken } from "../services/graph-client.js";
import { fail, ok, paginationMeta, requireConfirmation } from "../services/respond.js";
import {
  ApprovalRefField,
  CommentOutput,
  ConfirmedField,
  CursorField,
  IdField,
  LimitField,
  PlatformField,
  ResponseFormatField,
} from "../schemas/common.js";

/* ------------------------------------------------------------------ *
 * Graph API shapes
 * ------------------------------------------------------------------ */

interface FacebookComment {
  id: string;
  message?: string;
  from?: { id?: string; name?: string };
  created_time: string;
  like_count?: number;
  comment_count?: number;
  parent?: { id: string };
  is_hidden?: boolean;
  permalink_url?: string;
  comments?: { data?: Array<{ id: string; from?: { id?: string; name?: string } }> };
}

interface InstagramComment {
  id: string;
  text?: string;
  username?: string;
  from?: { id?: string; username?: string };
  timestamp: string;
  like_count?: number;
  hidden?: boolean;
  parent_id?: string;
  replies?: { data?: Array<{ id: string; username?: string; text?: string; timestamp?: string }> };
}

type NormalisedComment = z.infer<typeof CommentOutput>;

/* ------------------------------------------------------------------ *
 * meta_list_comments
 * ------------------------------------------------------------------ */

const ListInputSchema = z.strictObject({
  platform: PlatformField,
  post_id: IdField(
    "The post or media ID from meta_list_recent_posts. Facebook post IDs look like " +
      "'{page-id}_{post-id}'; Instagram media IDs are a single long number.",
  ),
  unanswered_only: z
    .boolean()
    .default(false)
    .describe(
      "When true, return only comments with no reply from your own Page or Instagram " +
        "account. This is the filter to use for triage — it is what stops you drafting a " +
        "second reply to something already handled.",
    ),
  include_hidden: z
    .boolean()
    .default(false)
    .describe("When true, include comments already hidden. Off by default, since they need no action."),
  limit: LimitField,
  after: CursorField,
  response_format: ResponseFormatField,
});

const ListOutputSchema = z.object({
  post_id: z.string(),
  platform: z.enum(["facebook", "instagram"]),
  count: z.number(),
  has_more: z.boolean(),
  next_cursor: z.string().optional(),
  unanswered_count: z.number(),
  filters_applied: z.object({ unanswered_only: z.boolean(), include_hidden: z.boolean() }),
  comments: z.array(CommentOutput),
  note: z.string().optional(),
});

/* ------------------------------------------------------------------ *
 * Registration
 * ------------------------------------------------------------------ */

export function registerCommentTools(server: McpServer): void {
  registerList(server);
  registerThread(server);
  registerReply(server);
  registerHide(server);
  registerUnhide(server);
  registerDelete(server);
}

function registerList(server: McpServer): void {
  const TOOL = "meta_list_comments";

  server.registerTool(
    TOOL,
    {
      title: "List Comments on a Post",
      description: `List comments on a Facebook Page post or an Instagram media item, with an 'unanswered_only' filter for triage.

Each comment comes back with its ID, author, text, timestamp, like count, reply count, parent ID, hidden state, and whether it appears unanswered by your own account.

How 'appears_unanswered' is determined: replies are fetched inline with each comment and checked against your own Page ID or Instagram username. A comment is unanswered when no reply beneath it comes from you. This is reliable for the most recent replies on a comment; on a comment with a very long reply chain, only the first 10 replies are inspected, and the 'note' field says so when that limit is reached.

Args:
  - platform ('facebook' | 'instagram'): required
  - post_id (string): post or media ID
  - unanswered_only (boolean): only comments you have not replied to (default: false)
  - include_hidden (boolean): include already-hidden comments (default: false)
  - limit (number): 1-100 (default: 25)
  - after (string, optional): pagination cursor
  - response_format ('markdown' | 'json'): default 'markdown'

Returns:
  {
    "post_id": string,
    "platform": string,
    "count": number,
    "has_more": boolean,
    "next_cursor": string,
    "unanswered_count": number,
    "filters_applied": { "unanswered_only": boolean, "include_hidden": boolean },
    "comments": [
      {
        "id": string,                    // pass to meta_reply_to_comment etc.
        "platform": string,
        "author_name": string,
        "author_id": string,             // Facebook only; Instagram gives a username
        "text": string,
        "created_time": string,          // ISO 8601
        "like_count": number,
        "reply_count": number,
        "parent_id": string,             // present when this is itself a reply
        "is_hidden": boolean,
        "appears_unanswered": boolean,
        "permalink": string
      }
    ],
    "note": string                       // caveats about this particular result, when any apply
  }

Examples:
  - Use when: triaging a post -> platform='facebook', post_id='123_456', unanswered_only=true
  - Use when: auditing what was hidden -> include_hidden=true
  - Don't use when: you want the full reply chain on one comment (use meta_get_comment_thread)

Error Handling:
  - "object not found" on a valid-looking ID usually means the platform argument is wrong for that ID type.
  - Instagram does not expose commenter user IDs on organic comments, only usernames, so 'author_id' is absent there. That is a platform limitation, not a bug.`,
      inputSchema: ListInputSchema,
      outputSchema: ListOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result =
          params.platform === "facebook"
            ? await listFacebookComments(params)
            : await listInstagramComments(params);

        let comments = result.items;
        if (!params.include_hidden) comments = comments.filter((c) => !c.is_hidden);
        if (params.unanswered_only) comments = comments.filter((c) => c.appears_unanswered);

        const output = {
          post_id: params.post_id,
          platform: params.platform,
          ...paginationMeta({
            count: comments.length,
            hasMore: result.hasMore,
            ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
          }),
          unanswered_count: comments.filter((c) => c.appears_unanswered).length,
          filters_applied: {
            unanswered_only: params.unanswered_only,
            include_hidden: params.include_hidden,
          },
          comments,
          ...(result.note ? { note: result.note } : {}),
        } as z.infer<typeof ListOutputSchema>;

        return ok(output, renderCommentList(output), params.response_format);
      } catch (error) {
        return fail(error, TOOL);
      }
    },
  );
}

/**
 * Facebook comments.
 *
 * Replies are requested inline via nested field expansion rather than one call
 * per comment — an N+1 here would burn the rate limit on a busy post.
 */
async function listFacebookComments(params: {
  post_id: string;
  limit: number;
  after?: string;
}): Promise<{ items: NormalisedComment[]; hasMore: boolean; nextCursor?: string; note?: string }> {
  // A Facebook post ID is '{page-id}_{post-id}', so the Page ID is derivable —
  // which is what tells us whether a reply is ours.
  const pageId = params.post_id.includes("_") ? params.post_id.split("_")[0] : undefined;
  const token = pageId ? await resolvePageToken(pageId) : undefined;

  const result = await graphRequestAll<FacebookComment>(
    {
      path: `${params.post_id}/comments`,
      ...(token ? { accessToken: token } : {}),
      query: {
        fields:
          "id,message,from,created_time,like_count,comment_count,parent,is_hidden," +
          "permalink_url,comments.limit(10){id,from}",
        filter: "toplevel",
        order: "reverse_chronological",
        ...(params.after ? { after: params.after } : {}),
      },
    },
    params.limit,
  );

  let hitReplyLimit = false;

  const items = result.items.map((comment) => {
    const replies = comment.comments?.data ?? [];
    if (replies.length >= 10) hitReplyLimit = true;
    const answeredByUs = pageId ? replies.some((r) => r.from?.id === pageId) : replies.length > 0;

    return {
      id: comment.id,
      platform: "facebook" as const,
      ...(comment.from?.name ? { author_name: comment.from.name } : {}),
      ...(comment.from?.id ? { author_id: comment.from.id } : {}),
      text: comment.message ?? "",
      created_time: comment.created_time,
      ...(comment.like_count !== undefined ? { like_count: comment.like_count } : {}),
      ...(comment.comment_count !== undefined ? { reply_count: comment.comment_count } : {}),
      ...(comment.parent?.id ? { parent_id: comment.parent.id } : {}),
      ...(comment.is_hidden !== undefined ? { is_hidden: comment.is_hidden } : {}),
      appears_unanswered: !answeredByUs,
      ...(comment.permalink_url ? { permalink: comment.permalink_url } : {}),
    };
  });

  const notes: string[] = [];
  if (!pageId) {
    notes.push(
      "The post ID has no '{page-id}_' prefix, so replies could not be attributed to your " +
        "Page specifically. 'appears_unanswered' fell back to 'has no replies at all', which " +
        "may under-report comments needing attention.",
    );
  }
  if (hitReplyLimit) {
    notes.push(
      "At least one comment has 10 or more replies; only the first 10 were inspected, so its " +
        "'appears_unanswered' may be wrong. Use meta_get_comment_thread on those.",
    );
  }

  return {
    items,
    hasMore: result.hasMore,
    ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
    ...(notes.length ? { note: notes.join(" ") } : {}),
  };
}

/**
 * Instagram comments.
 *
 * Instagram identifies commenters by username only, so "is this reply ours" is
 * answered by comparing usernames — which means we need our own username first.
 */
async function listInstagramComments(params: {
  post_id: string;
  limit: number;
  after?: string;
}): Promise<{ items: NormalisedComment[]; hasMore: boolean; nextCursor?: string; note?: string }> {
  const ownUsername = await resolveInstagramUsernameForMedia(params.post_id);

  const result = await graphRequestAll<InstagramComment>(
    {
      path: `${params.post_id}/comments`,
      query: {
        fields:
          "id,text,username,timestamp,like_count,hidden,parent_id," +
          "replies.limit(10){id,username,text,timestamp}",
        ...(params.after ? { after: params.after } : {}),
      },
    },
    params.limit,
  );

  let hitReplyLimit = false;

  const items = result.items.map((comment) => {
    const replies = comment.replies?.data ?? [];
    if (replies.length >= 10) hitReplyLimit = true;
    const answeredByUs = ownUsername
      ? replies.some((r) => r.username === ownUsername)
      : replies.length > 0;

    return {
      id: comment.id,
      platform: "instagram" as const,
      ...(comment.username ? { author_name: comment.username } : {}),
      text: comment.text ?? "",
      created_time: comment.timestamp,
      ...(comment.like_count !== undefined ? { like_count: comment.like_count } : {}),
      reply_count: replies.length,
      ...(comment.parent_id ? { parent_id: comment.parent_id } : {}),
      ...(comment.hidden !== undefined ? { is_hidden: comment.hidden } : {}),
      appears_unanswered: !answeredByUs,
    };
  });

  const notes: string[] = [];
  if (!ownUsername) {
    notes.push(
      "Your own Instagram username could not be resolved, so replies could not be attributed " +
        "to you. 'appears_unanswered' fell back to 'has no replies at all'.",
    );
  }
  if (hitReplyLimit) {
    notes.push(
      "At least one comment has 10 or more replies; only the first 10 were inspected.",
    );
  }
  notes.push(
    "Instagram does not expose commenter user IDs on organic comments, so 'author_id' is " +
      "absent throughout and 'author_name' holds the username.",
  );

  return {
    items,
    hasMore: result.hasMore,
    ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
    note: notes.join(" "),
  };
}

/** Resolve the owning account's username from a media ID, cached per process. */
const igUsernameByMedia = new Map<string, string | undefined>();

async function resolveInstagramUsernameForMedia(mediaId: string): Promise<string | undefined> {
  if (igUsernameByMedia.has(mediaId)) return igUsernameByMedia.get(mediaId);
  try {
    const media = await graphRequest<{ username?: string; owner?: { id?: string } }>({
      path: mediaId,
      query: { fields: "username,owner" },
    });
    igUsernameByMedia.set(mediaId, media.username);
    return media.username;
  } catch {
    igUsernameByMedia.set(mediaId, undefined);
    return undefined;
  }
}

/* ------------------------------------------------------------------ *
 * meta_get_comment_thread
 * ------------------------------------------------------------------ */

const ThreadInputSchema = z.strictObject({
  platform: PlatformField,
  comment_id: IdField("The comment ID to expand."),
  limit: LimitField,
  response_format: ResponseFormatField,
});

const ThreadOutputSchema = z.object({
  comment_id: z.string(),
  platform: z.enum(["facebook", "instagram"]),
  root: CommentOutput,
  replies: z.array(CommentOutput),
  reply_count: z.number(),
  conversation_transcript: z.string(),
});

function registerThread(server: McpServer): void {
  const TOOL = "meta_get_comment_thread";

  server.registerTool(
    TOOL,
    {
      title: "Get a Comment Thread",
      description: `Fetch one comment and every reply beneath it, in chronological order, plus a flat transcript of the exchange.

Use this before replying to anything with existing replies — it is how you avoid answering a question a colleague already answered, or missing that the customer added context in a follow-up.

Args:
  - platform ('facebook' | 'instagram'): required
  - comment_id (string): the comment to expand
  - limit (number): maximum replies to fetch, 1-100 (default: 25)
  - response_format ('markdown' | 'json'): default 'markdown'

Returns:
  {
    "comment_id": string,
    "platform": string,
    "root": { ...comment fields as in meta_list_comments... },
    "replies": [ { ...comment fields... } ],
    "reply_count": number,
    "conversation_transcript": string     // "Author: text" lines, oldest first, for quick reading
  }

Examples:
  - Use when: a comment shows reply_count > 0 and you need to know what was already said
  - Use when: a comment reads ambiguously and earlier replies may disambiguate it
  - Don't use when: sweeping a whole post for what needs attention (use meta_list_comments)

Error Handling:
  - Returns the root comment with an empty replies array when the comment has no replies — not an error.
  - A deleted comment returns "object not found"; that is expected and means someone removed it.`,
      inputSchema: ThreadInputSchema,
      outputSchema: ThreadOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const output =
          params.platform === "facebook"
            ? await getFacebookThread(params)
            : await getInstagramThread(params);
        return ok(output, renderThread(output), params.response_format);
      } catch (error) {
        return fail(error, TOOL);
      }
    },
  );
}

async function getFacebookThread(params: {
  comment_id: string;
  limit: number;
}): Promise<z.infer<typeof ThreadOutputSchema>> {
  const data = await graphRequest<FacebookComment & { comments?: { data?: FacebookComment[] } }>({
    path: params.comment_id,
    query: {
      fields:
        "id,message,from,created_time,like_count,comment_count,parent,is_hidden,permalink_url," +
        `comments.limit(${params.limit}){id,message,from,created_time,like_count,is_hidden}`,
    },
  });

  const toComment = (c: FacebookComment): NormalisedComment => ({
    id: c.id,
    platform: "facebook" as const,
    ...(c.from?.name ? { author_name: c.from.name } : {}),
    ...(c.from?.id ? { author_id: c.from.id } : {}),
    text: c.message ?? "",
    created_time: c.created_time,
    ...(c.like_count !== undefined ? { like_count: c.like_count } : {}),
    ...(c.comment_count !== undefined ? { reply_count: c.comment_count } : {}),
    ...(c.parent?.id ? { parent_id: c.parent.id } : {}),
    ...(c.is_hidden !== undefined ? { is_hidden: c.is_hidden } : {}),
    ...(c.permalink_url ? { permalink: c.permalink_url } : {}),
  });

  const root = toComment(data);
  const replies = (data.comments?.data ?? []).map(toComment).sort(byTimeAscending);

  return {
    comment_id: params.comment_id,
    platform: "facebook",
    root,
    replies,
    reply_count: replies.length,
    conversation_transcript: buildTranscript(root, replies),
  };
}

async function getInstagramThread(params: {
  comment_id: string;
  limit: number;
}): Promise<z.infer<typeof ThreadOutputSchema>> {
  const data = await graphRequest<InstagramComment & { replies?: { data?: InstagramComment[] } }>({
    path: params.comment_id,
    query: {
      fields:
        "id,text,username,timestamp,like_count,hidden,parent_id," +
        `replies.limit(${params.limit}){id,text,username,timestamp,like_count,hidden}`,
    },
  });

  const toComment = (c: InstagramComment): NormalisedComment => ({
    id: c.id,
    platform: "instagram" as const,
    ...(c.username ? { author_name: c.username } : {}),
    text: c.text ?? "",
    created_time: c.timestamp,
    ...(c.like_count !== undefined ? { like_count: c.like_count } : {}),
    ...(c.parent_id ? { parent_id: c.parent_id } : {}),
    ...(c.hidden !== undefined ? { is_hidden: c.hidden } : {}),
  });

  const root = toComment(data);
  const replies = (data.replies?.data ?? []).map(toComment).sort(byTimeAscending);

  return {
    comment_id: params.comment_id,
    platform: "instagram",
    root: { ...root, reply_count: replies.length },
    replies,
    reply_count: replies.length,
    conversation_transcript: buildTranscript(root, replies),
  };
}

function byTimeAscending(a: NormalisedComment, b: NormalisedComment): number {
  return new Date(a.created_time).getTime() - new Date(b.created_time).getTime();
}

function buildTranscript(root: NormalisedComment, replies: NormalisedComment[]): string {
  return [root, ...replies]
    .map((c) => `${c.author_name ?? "unknown"}: ${c.text.replace(/\s+/g, " ")}`)
    .join("\n");
}

/* ------------------------------------------------------------------ *
 * meta_reply_to_comment
 * ------------------------------------------------------------------ */

function registerReply(server: McpServer): void {
  const TOOL = "meta_reply_to_comment";

  const InputSchema = z.strictObject({
    platform: PlatformField,
    comment_id: IdField("The comment to reply beneath."),
    message: z
      .string()
      .min(1, "The reply cannot be empty")
      .max(8000, "Meta rejects comment replies over roughly 8000 characters")
      .describe("The reply text, exactly as it will appear publicly."),
    confirmed: ConfirmedField,
    approval_ref: ApprovalRefField,
    response_format: ResponseFormatField,
  });

  const OutputSchema = z.object({
    reply_id: z.string().optional(),
    comment_id: z.string(),
    platform: z.enum(["facebook", "instagram"]),
    message_sent: z.string(),
    dry_run: z.boolean(),
    status: z.string(),
  });

  server.registerTool(
    TOOL,
    {
      title: "Reply to a Comment",
      description: `Publish a public reply beneath a Facebook or Instagram comment.

THIS IS A PUBLIC WRITE. The reply is visible to everyone who can see the post, under the Paddock Blade name, and cannot be edited afterwards — only deleted.

Requires confirmed: true. Called with confirmed: false it makes no API call and instead returns the exact text that would be published, so it can be shown to Jake first. Do not set confirmed: true unless he has approved this specific reply.

Args:
  - platform ('facebook' | 'instagram'): required
  - comment_id (string): the comment to reply beneath
  - message (string): the reply text, 1-8000 characters
  - confirmed (boolean): required safety interlock
  - approval_ref (string, optional): e.g. '2026-08-17-queue#3', recorded in the audit log
  - response_format ('markdown' | 'json'): default 'markdown'

Returns:
  {
    "reply_id": string,          // the new comment's ID; absent in dry-run
    "comment_id": string,
    "platform": string,
    "message_sent": string,
    "dry_run": boolean,
    "status": string
  }

Examples:
  - Use when: Jake has approved a drafted reply -> confirmed=true, approval_ref='2026-08-17-queue#3'
  - Use when: you want to show him what would be posted -> confirmed=false
  - Don't use when: the comment is a complaint, warranty claim, refund or safety matter — those escalate and are never replied to automatically. See the escalation-rules skill.

Error Handling:
  - Refuses with a full preview when confirmed is not true.
  - Permission errors name pages_manage_engagement or instagram_manage_comments specifically.
  - Instagram rejects replies to a reply — you can only reply to a top-level comment. Check parent_id is absent before calling.`,
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        requireConfirmation({
          confirmed: params.confirmed,
          toolName: TOOL,
          action: `Publish a public reply on ${params.platform}`,
          targetId: params.comment_id,
          content: params.message,
          details: { platform: params.platform, visibility: "public, under the Paddock Blade name" },
        });

        // Instagram replies go to /replies; Facebook nests under /comments.
        const path =
          params.platform === "instagram"
            ? `${params.comment_id}/replies`
            : `${params.comment_id}/comments`;

        const { result, dryRun } = await withAudit(
          {
            tool: TOOL,
            targetId: params.comment_id,
            payload: { platform: params.platform, message: params.message, path },
            ...(params.approval_ref ? { approvalRef: params.approval_ref } : {}),
          },
          () => graphRequest<{ id: string }>({ path, method: "POST", body: { message: params.message } }),
        );

        const output = {
          ...(result?.id ? { reply_id: result.id } : {}),
          comment_id: params.comment_id,
          platform: params.platform,
          message_sent: params.message,
          dry_run: dryRun,
          status: dryRun
            ? "DRY RUN — nothing was published. The reply was recorded in the audit log only."
            : `Published. The reply is now publicly visible beneath comment ${params.comment_id}.`,
        };

        return ok(output, renderWriteResult("Reply to comment", output.status, output), params.response_format);
      } catch (error) {
        return fail(error, TOOL);
      }
    },
  );
}

/* ------------------------------------------------------------------ *
 * hide / unhide / delete
 * ------------------------------------------------------------------ */

function registerHide(server: McpServer): void {
  const TOOL = "meta_hide_comment";

  const InputSchema = z.strictObject({
    platform: PlatformField,
    comment_id: IdField("The comment to hide."),
    confirmed: ConfirmedField,
    approval_ref: ApprovalRefField,
    response_format: ResponseFormatField,
  });

  const OutputSchema = z.object({
    comment_id: z.string(),
    platform: z.enum(["facebook", "instagram"]),
    hidden: z.boolean(),
    dry_run: z.boolean(),
    status: z.string(),
  });

  server.registerTool(
    TOOL,
    {
      title: "Hide a Comment",
      description: `Hide a comment so it is no longer visible to the public.

Hiding is the preferred moderation action for spam and abuse, and is reversible with meta_unhide_comment. The comment's author still sees it as normal, so they are not alerted that they were moderated — which avoids the escalation that deleting often provokes.

Requires confirmed: true.

Args:
  - platform ('facebook' | 'instagram'): required
  - comment_id (string): the comment to hide
  - confirmed (boolean): required safety interlock
  - approval_ref (string, optional): recorded in the audit log
  - response_format ('markdown' | 'json'): default 'markdown'

Returns:
  { "comment_id": string, "platform": string, "hidden": boolean, "dry_run": boolean, "status": string }

Examples:
  - Use when: triage classified a comment as spam or abuse
  - Don't use when: the comment is a genuine complaint — hiding a real customer's grievance makes things worse. Escalate instead.
  - Don't use when: you want it gone permanently (that is meta_delete_comment, and it cannot be undone)

Error Handling:
  - Hiding an already-hidden comment succeeds and is a no-op.
  - Some comment types cannot be hidden — replies to your own comments, for instance. Meta returns a parameter error in that case.`,
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => setHidden(params, TOOL, true),
  );
}

function registerUnhide(server: McpServer): void {
  const TOOL = "meta_unhide_comment";

  const InputSchema = z.strictObject({
    platform: PlatformField,
    comment_id: IdField("The comment to make visible again."),
    confirmed: ConfirmedField,
    approval_ref: ApprovalRefField,
    response_format: ResponseFormatField,
  });

  const OutputSchema = z.object({
    comment_id: z.string(),
    platform: z.enum(["facebook", "instagram"]),
    hidden: z.boolean(),
    dry_run: z.boolean(),
    status: z.string(),
  });

  server.registerTool(
    TOOL,
    {
      title: "Unhide a Comment",
      description: `Make a previously hidden comment publicly visible again. The reverse of meta_hide_comment.

Requires confirmed: true.

Args:
  - platform ('facebook' | 'instagram'): required
  - comment_id (string): the comment to unhide
  - confirmed (boolean): required safety interlock
  - approval_ref (string, optional): recorded in the audit log
  - response_format ('markdown' | 'json'): default 'markdown'

Returns:
  { "comment_id": string, "platform": string, "hidden": boolean, "dry_run": boolean, "status": string }

Examples:
  - Use when: a comment was hidden in error and should be restored
  - Use when: reviewing hidden comments with meta_list_comments include_hidden=true and one was misjudged

Error Handling:
  - Unhiding a visible comment succeeds and is a no-op.`,
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => setHidden(params, TOOL, false),
  );
}

/** Hide and unhide differ only in one parameter, so they share an implementation. */
async function setHidden(
  params: {
    platform: "facebook" | "instagram";
    comment_id: string;
    confirmed: boolean;
    approval_ref?: string;
    response_format: "markdown" | "json";
  },
  toolName: string,
  hide: boolean,
) {
  try {
    requireConfirmation({
      confirmed: params.confirmed,
      toolName,
      action: `${hide ? "Hide" : "Unhide"} a comment on ${params.platform}`,
      targetId: params.comment_id,
      details: {
        effect: hide
          ? "The comment becomes invisible to the public. Its author still sees it. Reversible."
          : "The comment becomes publicly visible again.",
      },
    });

    // Facebook uses is_hidden; Instagram uses hide. Same idea, different name.
    const body =
      params.platform === "instagram" ? { hide } : { is_hidden: hide };

    const { result, dryRun } = await withAudit(
      {
        tool: toolName,
        targetId: params.comment_id,
        payload: { platform: params.platform, ...body },
        ...(params.approval_ref ? { approvalRef: params.approval_ref } : {}),
      },
      () => graphRequest<{ success?: boolean }>({ path: params.comment_id, method: "POST", body }),
    );

    void result;

    const output = {
      comment_id: params.comment_id,
      platform: params.platform,
      hidden: hide,
      dry_run: dryRun,
      status: dryRun
        ? `DRY RUN — nothing changed. The intended ${hide ? "hide" : "unhide"} was logged only.`
        : `Comment ${params.comment_id} is now ${hide ? "hidden from" : "visible to"} the public.`,
    };

    return ok(output, renderWriteResult(hide ? "Hide comment" : "Unhide comment", output.status, output), params.response_format);
  } catch (error) {
    return fail(error, toolName);
  }
}

function registerDelete(server: McpServer): void {
  const TOOL = "meta_delete_comment";

  const InputSchema = z.strictObject({
    platform: PlatformField,
    comment_id: IdField("The comment to delete permanently."),
    confirmed: ConfirmedField,
    approval_ref: ApprovalRefField,
    response_format: ResponseFormatField,
  });

  const OutputSchema = z.object({
    comment_id: z.string(),
    platform: z.enum(["facebook", "instagram"]),
    deleted: z.boolean(),
    dry_run: z.boolean(),
    status: z.string(),
  });

  server.registerTool(
    TOOL,
    {
      title: "Delete a Comment (Permanent)",
      description: `Permanently delete a comment. THIS CANNOT BE UNDONE.

Prefer meta_hide_comment in nearly every case. Hiding achieves the same public outcome, is reversible, and does not alert the author. Deleting is irreversible, and if the author notices, it tends to escalate a small problem into a public one.

Reserve this for content that must not exist at all — illegal material, or a comment exposing someone's personal data.

Requires confirmed: true.

Args:
  - platform ('facebook' | 'instagram'): required
  - comment_id (string): the comment to delete
  - confirmed (boolean): required safety interlock
  - approval_ref (string, optional): recorded in the audit log
  - response_format ('markdown' | 'json'): default 'markdown'

Returns:
  { "comment_id": string, "platform": string, "deleted": boolean, "dry_run": boolean, "status": string }

Examples:
  - Use when: a comment publishes someone's phone number or address and must be removed entirely
  - Don't use when: the comment is merely spam or rude (hide it)
  - Don't use when: you are unsure (hide it — hiding buys time, deleting does not)

Error Handling:
  - "object not found" means it is already gone.
  - The audit log records the full comment text before deletion, so the content survives even though the comment does not.`,
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        // Capture the text first: once deleted it is unrecoverable from Meta, so
        // the audit log is the only remaining record of what was removed. Skipped
        // in dry-run, where nothing is deleted and so nothing needs preserving —
        // dry-run's guarantee is that no API call happens, reads included.
        const existing = getConfig().dryRun
          ? {}
          : await captureCommentForAudit(params.platform, params.comment_id);

        requireConfirmation({
          confirmed: params.confirmed,
          toolName: TOOL,
          action: `PERMANENTLY DELETE a comment on ${params.platform}`,
          targetId: params.comment_id,
          ...(existing.text ? { content: existing.text } : {}),
          details: {
            author: existing.author ?? "unknown",
            warning: "This is irreversible. Consider meta_hide_comment instead — it is reversible.",
          },
        });

        const { dryRun } = await withAudit(
          {
            tool: TOOL,
            targetId: params.comment_id,
            payload: {
              platform: params.platform,
              deleted_text: existing.text ?? null,
              deleted_author: existing.author ?? null,
            },
            ...(params.approval_ref ? { approvalRef: params.approval_ref } : {}),
          },
          () => graphRequest<{ success?: boolean }>({ path: params.comment_id, method: "DELETE" }),
        );

        const output = {
          comment_id: params.comment_id,
          platform: params.platform,
          deleted: !dryRun,
          dry_run: dryRun,
          status: dryRun
            ? "DRY RUN — nothing was deleted. The intended deletion was logged only."
            : `Comment ${params.comment_id} was permanently deleted. Its text is preserved in the audit log.`,
        };

        return ok(output, renderWriteResult("Delete comment", output.status, output), params.response_format);
      } catch (error) {
        return fail(error, TOOL);
      }
    },
  );
}

/** Best-effort read of a comment before deleting it, for the audit record. */
async function captureCommentForAudit(
  platform: "facebook" | "instagram",
  commentId: string,
): Promise<{ text?: string; author?: string }> {
  try {
    if (platform === "instagram") {
      const c = await graphRequest<InstagramComment>({
        path: commentId,
        query: { fields: "id,text,username" },
      });
      return { ...(c.text ? { text: c.text } : {}), ...(c.username ? { author: c.username } : {}) };
    }
    const c = await graphRequest<FacebookComment>({
      path: commentId,
      query: { fields: "id,message,from" },
    });
    return {
      ...(c.message ? { text: c.message } : {}),
      ...(c.from?.name ? { author: c.from.name } : {}),
    };
  } catch {
    // Not fatal — proceed without the snapshot rather than blocking the deletion.
    return {};
  }
}

/* ------------------------------------------------------------------ *
 * Markdown rendering
 * ------------------------------------------------------------------ */

function renderCommentList(o: z.infer<typeof ListOutputSchema>): string {
  const lines = [`# Comments on \`${o.post_id}\` (${o.platform})`, ""];

  if (o.count === 0) {
    lines.push(
      o.filters_applied.unanswered_only
        ? "No unanswered comments. Everything here has had a reply from you."
        : "No comments on this post.",
    );
    if (o.note) lines.push("", `_${o.note}_`);
    return lines.join("\n");
  }

  lines.push(`${o.count} comment(s) shown, ${o.unanswered_count} unanswered.`);
  if (o.filters_applied.unanswered_only) lines.push("_Filtered to unanswered only._");
  lines.push("");

  for (const c of o.comments) {
    const when = new Date(c.created_time).toLocaleString("en-GB", { timeZone: "UTC" });
    lines.push(`## ${c.author_name ?? "unknown"} — ${when} UTC`);
    lines.push(`- **ID**: \`${c.id}\``);
    lines.push(`> ${c.text.replace(/\n/g, "\n> ") || "(no text)"}`);
    const stats: string[] = [];
    if (c.like_count !== undefined) stats.push(`👍 ${c.like_count}`);
    if (c.reply_count !== undefined) stats.push(`💬 ${c.reply_count}`);
    if (c.is_hidden) stats.push("🚫 hidden");
    if (c.appears_unanswered) stats.push("**needs a reply**");
    if (stats.length) lines.push(`- ${stats.join(" · ")}`);
    if (c.permalink) lines.push(`- [View](${c.permalink})`);
    lines.push("");
  }

  if (o.has_more) lines.push(`_More available. Call again with \`after: "${o.next_cursor}"\`._`, "");
  if (o.note) lines.push(`_Note: ${o.note}_`);

  return lines.join("\n");
}

function renderThread(o: z.infer<typeof ThreadOutputSchema>): string {
  const lines = [`# Comment thread \`${o.comment_id}\` (${o.platform})`, ""];
  const when = new Date(o.root.created_time).toLocaleString("en-GB", { timeZone: "UTC" });

  lines.push(`## Root — ${o.root.author_name ?? "unknown"}, ${when} UTC`);
  lines.push(`> ${o.root.text.replace(/\n/g, "\n> ") || "(no text)"}`);
  lines.push("");

  if (o.reply_count === 0) {
    lines.push("_No replies yet._");
    return lines.join("\n");
  }

  lines.push(`## Replies (${o.reply_count}, oldest first)`, "");
  for (const reply of o.replies) {
    const rwhen = new Date(reply.created_time).toLocaleString("en-GB", { timeZone: "UTC" });
    lines.push(`**${reply.author_name ?? "unknown"}** — ${rwhen} UTC · \`${reply.id}\``);
    lines.push(`> ${reply.text.replace(/\n/g, "\n> ") || "(no text)"}`);
    lines.push("");
  }

  return lines.join("\n");
}

function renderWriteResult(
  title: string,
  status: string,
  detail: Record<string, unknown>,
): string {
  const lines = [`# ${title}`, "", status, ""];
  for (const [key, value] of Object.entries(detail)) {
    if (key === "status") continue;
    lines.push(`- **${key}**: ${typeof value === "string" ? value : JSON.stringify(value)}`);
  }
  return lines.join("\n");
}
