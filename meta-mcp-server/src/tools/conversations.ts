/**
 * Direct message tools: list threads, read one, send, mark read.
 *
 * Everything here is governed by Meta's messaging window, so every read reports
 * the window state and `meta_send_message` refuses sends the window does not
 * permit. See `services/window.ts` for the rule itself.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { withAudit } from "../services/audit.js";
import { MessagingWindowError } from "../services/errors.js";
import { graphRequest, graphRequestAll, resolvePageToken } from "../services/graph-client.js";
import { fail, ok, paginationMeta, requireConfirmation } from "../services/respond.js";
import { assessWindow, urgencyScore, type WindowAssessment } from "../services/window.js";
import {
  ApprovalRefField,
  ConfirmedField,
  CursorField,
  IdField,
  LimitField,
  ResponseFormatField,
  WindowOutput,
} from "../schemas/common.js";

/* ------------------------------------------------------------------ *
 * Graph API shapes
 * ------------------------------------------------------------------ */

interface ConversationRow {
  id: string;
  snippet?: string;
  updated_time?: string;
  unread_count?: number;
  message_count?: number;
  participants?: { data?: Array<{ id: string; name?: string; username?: string; email?: string }> };
  messages?: { data?: MessageRow[] };
}

interface MessageRow {
  id: string;
  created_time: string;
  message?: string;
  from?: { id?: string; name?: string; username?: string };
  to?: { data?: Array<{ id: string; name?: string }> };
}

const PlatformField = z
  .enum(["messenger", "instagram"])
  .describe(
    "Which inbox. 'messenger' for Facebook Page messages, 'instagram' for Instagram Direct. " +
      "Both hang off the Page ID, not the Instagram account ID.",
  );

/* ------------------------------------------------------------------ *
 * meta_list_conversations
 * ------------------------------------------------------------------ */

const ListInputSchema = z.strictObject({
  page_id: IdField(
    "The Facebook Page ID from meta_list_pages. Instagram Direct threads are also " +
      "reached through the Page ID, not the Instagram account ID.",
  ),
  platform: PlatformField,
  unread_only: z
    .boolean()
    .default(false)
    .describe("When true, return only threads with unread messages. Use this for the DM funnel."),
  limit: LimitField,
  after: CursorField,
  response_format: ResponseFormatField,
});

const ConversationSummary = z.object({
  id: z.string(),
  platform: z.enum(["messenger", "instagram"]),
  participant_name: z.string().optional(),
  participant_id: z.string().optional(),
  snippet: z.string().optional(),
  updated_time: z.string().optional(),
  unread_count: z.number().optional(),
  message_count: z.number().optional(),
  window: WindowOutput,
});

const ListOutputSchema = z.object({
  page_id: z.string(),
  platform: z.enum(["messenger", "instagram"]),
  count: z.number(),
  has_more: z.boolean(),
  next_cursor: z.string().optional(),
  unread_total: z.number(),
  closing_soon: z
    .array(z.object({ conversation_id: z.string(), hours_left: z.number().nullable() }))
    .describe("Threads whose reply window shuts within 6 hours"),
  conversations: z.array(ConversationSummary),
});

export function registerConversationTools(server: McpServer): void {
  registerList(server);
  registerGet(server);
  registerSend(server);
  registerMarkRead(server);
}

function registerList(server: McpServer): void {
  const TOOL = "meta_list_conversations";

  server.registerTool(
    TOOL,
    {
      title: "List Message Threads",
      description: `List Messenger or Instagram Direct threads for a Page, newest activity first, each with its messaging-window state.

Every thread reports how long is left to reply. This is the important part: Meta only permits a reply within 24 hours of the customer's last message, extended to 7 days with the HUMAN_AGENT tag. Threads are ordered so the ones about to become unanswerable surface first, and 'closing_soon' names those with under 6 hours left.

Args:
  - page_id (string): the Facebook Page ID — also for Instagram threads
  - platform ('messenger' | 'instagram'): which inbox
  - unread_only (boolean): only threads with unread messages (default: false)
  - limit (number): 1-100 (default: 25)
  - after (string, optional): pagination cursor
  - response_format ('markdown' | 'json'): default 'markdown'

Returns:
  {
    "page_id": string,
    "platform": string,
    "count": number,
    "has_more": boolean,
    "next_cursor": string,
    "unread_total": number,
    "closing_soon": [ { "conversation_id": string, "hours_left": number } ],
    "conversations": [
      {
        "id": string,                    // pass to meta_get_conversation
        "platform": string,
        "participant_name": string,
        "participant_id": string,        // pass as recipient_id to meta_send_message
        "snippet": string,               // preview of the latest message
        "updated_time": string,
        "unread_count": number,
        "message_count": number,
        "window": {
          "state": "open" | "human_agent_only" | "closed" | "unknown",
          "hours_since_last_user_message": number,
          "hours_until_window_closes": number,
          "can_send": boolean,
          "required_tag": "HUMAN_AGENT",  // present only when a tag is mandatory
          "explanation": string
        }
      }
    ]
  }

Examples:
  - Use when: building the DM queue -> unread_only=true
  - Use when: checking what is about to time out -> read 'closing_soon'
  - Don't use when: you need the full message history of one thread (use meta_get_conversation)

Error Handling:
  - Passing an Instagram account ID as page_id returns "object not found" — Instagram threads are reached through the Page ID.
  - A window state of 'unknown' means no inbound message was found in the thread preview; fetch the thread with meta_get_conversation to resolve it.`,
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
        const token = await resolvePageToken(params.page_id);

        const result = await graphRequestAll<ConversationRow>(
          {
            path: `${params.page_id}/conversations`,
            accessToken: token,
            query: {
              platform: params.platform,
              fields:
                "id,snippet,updated_time,unread_count,message_count," +
                "participants,messages.limit(5){id,created_time,from}",
              ...(params.after ? { after: params.after } : {}),
            },
          },
          params.limit,
        );

        let conversations = result.items.map((row) =>
          summariseConversation(row, params.platform, params.page_id),
        );

        if (params.unread_only) {
          conversations = conversations.filter((c) => (c.unread_count ?? 0) > 0);
        }

        // Most urgent first: least time left before the window shuts.
        conversations.sort((a, b) => urgencyScoreOf(a) - urgencyScoreOf(b));

        const output = {
          page_id: params.page_id,
          platform: params.platform,
          ...paginationMeta({
            count: conversations.length,
            hasMore: result.hasMore,
            ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
          }),
          unread_total: conversations.reduce((sum, c) => sum + (c.unread_count ?? 0), 0),
          closing_soon: conversations
            .filter(
              (c) =>
                c.window.state === "open" &&
                c.window.hours_until_window_closes !== null &&
                c.window.hours_until_window_closes < 6,
            )
            .map((c) => ({
              conversation_id: c.id,
              hours_left: c.window.hours_until_window_closes,
            })),
          conversations,
        } as z.infer<typeof ListOutputSchema>;

        return ok(output, renderConversationList(output), params.response_format);
      } catch (error) {
        return fail(error, TOOL);
      }
    },
  );
}

/** Build a thread summary, working out the window from the inbound messages. */
function summariseConversation(
  row: ConversationRow,
  platform: "messenger" | "instagram",
  pageId: string,
): z.infer<typeof ConversationSummary> {
  const participants = row.participants?.data ?? [];
  // The Page itself is a participant, so the customer is whoever is not the Page.
  const customer = participants.find((p) => p.id !== pageId);

  const messages = row.messages?.data ?? [];
  const lastInbound = messages
    .filter((m) => m.from?.id && m.from.id !== pageId)
    .sort((a, b) => new Date(b.created_time).getTime() - new Date(a.created_time).getTime())[0];

  const window = assessWindow(lastInbound?.created_time ?? null);

  return {
    id: row.id,
    platform,
    ...(customer?.name || customer?.username
      ? { participant_name: customer.name ?? customer.username ?? "" }
      : {}),
    ...(customer?.id ? { participant_id: customer.id } : {}),
    ...(row.snippet ? { snippet: row.snippet } : {}),
    ...(row.updated_time ? { updated_time: row.updated_time } : {}),
    ...(row.unread_count !== undefined ? { unread_count: row.unread_count } : {}),
    ...(row.message_count !== undefined ? { message_count: row.message_count } : {}),
    window: toWindowOutput(window),
  };
}

function toWindowOutput(w: WindowAssessment): z.infer<typeof WindowOutput> {
  return {
    state: w.state,
    hours_since_last_user_message: w.hours_since_last_user_message,
    hours_until_window_closes: w.hours_until_window_closes,
    can_send: w.can_send,
    ...(w.required_tag ? { required_tag: w.required_tag } : {}),
    explanation: w.explanation,
  };
}

function urgencyScoreOf(c: z.infer<typeof ConversationSummary>): number {
  return urgencyScore({
    state: c.window.state,
    hours_since_last_user_message: c.window.hours_since_last_user_message,
    hours_until_window_closes: c.window.hours_until_window_closes,
    can_send: c.window.can_send,
    explanation: c.window.explanation,
  });
}

/* ------------------------------------------------------------------ *
 * meta_get_conversation
 * ------------------------------------------------------------------ */

function registerGet(server: McpServer): void {
  const TOOL = "meta_get_conversation";

  const InputSchema = z.strictObject({
    conversation_id: IdField("Thread ID from meta_list_conversations."),
    page_id: IdField(
      "The Page ID that owns the thread. Required so messages can be attributed — it is " +
        "how we tell your replies from the customer's messages.",
    ),
    limit: LimitField,
    response_format: ResponseFormatField,
  });

  const MessageOutput = z.object({
    id: z.string(),
    created_time: z.string(),
    text: z.string(),
    from_name: z.string().optional(),
    from_id: z.string().optional(),
    is_from_us: z.boolean(),
  });

  const OutputSchema = z.object({
    conversation_id: z.string(),
    participant_name: z.string().optional(),
    participant_id: z.string().optional(),
    message_count: z.number(),
    messages: z.array(MessageOutput),
    window: WindowOutput,
    transcript: z.string(),
  });

  server.registerTool(
    TOOL,
    {
      title: "Get a Message Thread",
      description: `Fetch the full message history of one thread, oldest first, with each message attributed to you or the customer, plus the current messaging-window state.

Read this before drafting any DM reply. It gives you the history, and it tells you whether a reply is permitted at all — the 'window' field is the authority on that, and meta_send_message will refuse anything it says is closed.

Args:
  - conversation_id (string): thread ID from meta_list_conversations
  - page_id (string): the Page that owns the thread, needed to attribute messages
  - limit (number): maximum messages, 1-100 (default: 25). Returns the most recent, ordered oldest first.
  - response_format ('markdown' | 'json'): default 'markdown'

Returns:
  {
    "conversation_id": string,
    "participant_name": string,
    "participant_id": string,          // pass as recipient_id to meta_send_message
    "message_count": number,
    "messages": [
      { "id": string, "created_time": string, "text": string, "from_name": string, "from_id": string, "is_from_us": boolean }
    ],
    "window": { ...as in meta_list_conversations... },
    "transcript": string               // "Name: text" lines, oldest first
  }

Examples:
  - Use when: drafting a DM reply and you need the history and the window state
  - Use when: a thread's window shows 'unknown' in the list and you need the real answer
  - Don't use when: sweeping the inbox (use meta_list_conversations)

Error Handling:
  - A wrong page_id yields every message marked is_from_us: false and an unreliable window. Check the Page ID matches the thread.`,
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const token = await resolvePageToken(params.page_id);

        const data = await graphRequest<ConversationRow>({
          path: params.conversation_id,
          accessToken: token,
          query: {
            fields:
              "id,participants,message_count," +
              `messages.limit(${params.limit}){id,created_time,message,from,to}`,
          },
        });

        const raw = (data.messages?.data ?? [])
          .slice()
          .sort((a, b) => new Date(a.created_time).getTime() - new Date(b.created_time).getTime());

        const messages = raw.map((m) => ({
          id: m.id,
          created_time: m.created_time,
          text: m.message ?? "",
          ...(m.from?.name || m.from?.username
            ? { from_name: m.from.name ?? m.from.username ?? "" }
            : {}),
          ...(m.from?.id ? { from_id: m.from.id } : {}),
          is_from_us: m.from?.id === params.page_id,
        }));

        const lastInbound = [...messages].reverse().find((m) => !m.is_from_us);
        const participants = data.participants?.data ?? [];
        const customer = participants.find((p) => p.id !== params.page_id);
        const window = assessWindow(lastInbound?.created_time ?? null);

        const output = {
          conversation_id: params.conversation_id,
          ...(customer?.name || customer?.username
            ? { participant_name: customer.name ?? customer.username ?? "" }
            : {}),
          ...(customer?.id ? { participant_id: customer.id } : {}),
          message_count: data.message_count ?? messages.length,
          messages,
          window: toWindowOutput(window),
          transcript: messages
            .map((m) => `${m.is_from_us ? "Paddock Blade" : (m.from_name ?? "Customer")}: ${m.text}`)
            .join("\n"),
        };

        return ok(output, renderConversation(output), params.response_format);
      } catch (error) {
        return fail(error, TOOL);
      }
    },
  );
}

/* ------------------------------------------------------------------ *
 * meta_send_message
 * ------------------------------------------------------------------ */

function registerSend(server: McpServer): void {
  const TOOL = "meta_send_message";

  const InputSchema = z.strictObject({
    page_id: IdField("The Page ID sending the message."),
    recipient_id: IdField(
      "The customer's participant_id from meta_get_conversation, not the thread ID.",
    ),
    message: z
      .string()
      .min(1, "The message cannot be empty")
      .max(2000, "Meta's limit for a single message is 2000 characters")
      .describe("The message text, exactly as the customer will receive it."),
    messaging_tag: z
      .literal("HUMAN_AGENT")
      .optional()
      .describe(
        "Required when the standard 24-hour window has closed but the thread is within 7 days. " +
          "Only lawful when a real person composed or approved this message, it resolves a " +
          "support issue, and it is not promotional. Meta detects misuse. Never set this to " +
          "work around a closed window — past 7 days no tag helps.",
      ),
    last_user_message_at: z
      .string()
      .optional()
      .describe(
        "ISO timestamp of the customer's most recent message, from meta_get_conversation. " +
          "Supply it so the window can be checked before sending. Omitting it forces a lookup, " +
          "and if that fails the send is refused rather than risking a policy breach.",
      ),
    confirmed: ConfirmedField,
    approval_ref: ApprovalRefField,
    response_format: ResponseFormatField,
  });

  const OutputSchema = z.object({
    message_id: z.string().optional(),
    recipient_id: z.string(),
    message_sent: z.string(),
    messaging_type: z.string(),
    tag_used: z.string().optional(),
    window_at_send: WindowOutput,
    dry_run: z.boolean(),
    status: z.string(),
  });

  server.registerTool(
    TOOL,
    {
      title: "Send a Direct Message",
      description: `Send a Messenger or Instagram Direct message to a customer.

THIS IS A REAL MESSAGE TO A REAL PERSON. It arrives as a notification on their phone, from Paddock Blade, and cannot be recalled.

Two independent gates apply:
  1. confirmed must be true, as with every write tool.
  2. The messaging window must permit it. Inside 24 hours of the customer's last message, an ordinary reply is fine. Between 24 hours and 7 days, messaging_tag: "HUMAN_AGENT" is mandatory. Past 7 days the send is REFUSED — Meta permits no organic message and there is no argument that overrides this.

Args:
  - page_id (string): the sending Page
  - recipient_id (string): participant_id from meta_get_conversation (NOT the conversation ID)
  - message (string): 1-2000 characters
  - messaging_tag ('HUMAN_AGENT', optional): required in the 24h-7d window
  - last_user_message_at (string, optional): ISO timestamp, from meta_get_conversation
  - confirmed (boolean): required safety interlock
  - approval_ref (string, optional): recorded in the audit log
  - response_format ('markdown' | 'json'): default 'markdown'

Returns:
  {
    "message_id": string,            // absent in dry-run
    "recipient_id": string,
    "message_sent": string,
    "messaging_type": "RESPONSE" | "MESSAGE_TAG",
    "tag_used": string,
    "window_at_send": { ...window fields... },
    "dry_run": boolean,
    "status": string
  }

Examples:
  - Use when: Jake approved a reply and the window is open -> confirmed=true
  - Use when: previewing what would be sent -> confirmed=false
  - Don't use when: the window state is 'closed' — it will refuse, and correctly
  - Don't use when: the message is promotional and the window needs HUMAN_AGENT — that combination breaches Meta's policy

Error Handling:
  - Refuses with a full preview when confirmed is not true.
  - Refuses when the window is closed, reporting how long ago the customer wrote and what the remaining options are.
  - Refuses when the window needs HUMAN_AGENT and no tag was supplied, rather than silently adding it.`,
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
        const window = assessWindow(params.last_user_message_at ?? null);

        // Window check runs before the confirmation gate: there is no point asking
        // a human to approve something Meta will not permit in any case.
        if (window.state === "closed") {
          throw new MessagingWindowError(
            `Refused: the messaging window is closed.\n\n${window.explanation}\n\n` +
              "No tag can reopen it. Nothing was sent and no API call was made.",
          );
        }

        if (window.state === "unknown") {
          throw new MessagingWindowError(
            `Refused: the messaging window could not be determined.\n\n${window.explanation}\n\n` +
              "Call meta_get_conversation for this thread and pass its window's " +
              "hours_since_last_user_message back as last_user_message_at. Refusing rather than " +
              "guessing, because sending outside the window is a policy breach.",
          );
        }

        if (window.state === "human_agent_only" && params.messaging_tag !== "HUMAN_AGENT") {
          throw new MessagingWindowError(
            `Refused: this thread is past the standard 24-hour window.\n\n${window.explanation}\n\n` +
              'To proceed, re-invoke with messaging_tag: "HUMAN_AGENT" — but only if a real ' +
              "person composed or approved this message and it resolves a support issue. The tag " +
              "is not being added automatically, because whether its conditions are met is a " +
              "judgement only a human can make.",
          );
        }

        requireConfirmation({
          confirmed: params.confirmed,
          toolName: TOOL,
          action: `Send a direct message to a real customer`,
          targetId: params.recipient_id,
          content: params.message,
          details: {
            window_state: window.state,
            tag: params.messaging_tag ?? "none (standard reply)",
            delivery: "arrives as a phone notification from Paddock Blade, cannot be recalled",
          },
        });

        const token = await resolvePageToken(params.page_id);
        const messagingType = params.messaging_tag ? "MESSAGE_TAG" : "RESPONSE";

        const body = {
          recipient: JSON.stringify({ id: params.recipient_id }),
          message: JSON.stringify({ text: params.message }),
          messaging_type: messagingType,
          ...(params.messaging_tag ? { tag: params.messaging_tag } : {}),
        };

        const { result, dryRun } = await withAudit(
          {
            tool: TOOL,
            targetId: params.recipient_id,
            payload: {
              page_id: params.page_id,
              message: params.message,
              messaging_type: messagingType,
              tag: params.messaging_tag ?? null,
              window_state: window.state,
            },
            ...(params.approval_ref ? { approvalRef: params.approval_ref } : {}),
          },
          () =>
            graphRequest<{ message_id?: string; recipient_id?: string }>({
              path: `${params.page_id}/messages`,
              method: "POST",
              accessToken: token,
              body,
            }),
        );

        const output = {
          ...(result?.message_id ? { message_id: result.message_id } : {}),
          recipient_id: params.recipient_id,
          message_sent: params.message,
          messaging_type: messagingType,
          ...(params.messaging_tag ? { tag_used: params.messaging_tag } : {}),
          window_at_send: toWindowOutput(window),
          dry_run: dryRun,
          status: dryRun
            ? "DRY RUN — nothing was sent. The intended message was recorded in the audit log only."
            : `Sent to ${params.recipient_id}.`,
        };

        return ok(output, renderSendResult(output), params.response_format);
      } catch (error) {
        return fail(error, TOOL);
      }
    },
  );
}

/* ------------------------------------------------------------------ *
 * meta_mark_conversation_read
 * ------------------------------------------------------------------ */

function registerMarkRead(server: McpServer): void {
  const TOOL = "meta_mark_conversation_read";

  const InputSchema = z.strictObject({
    page_id: IdField("The Page that owns the thread."),
    recipient_id: IdField(
      "The customer's participant_id, from meta_get_conversation.",
    ),
    confirmed: ConfirmedField,
    approval_ref: ApprovalRefField,
    response_format: ResponseFormatField,
  });

  const OutputSchema = z.object({
    recipient_id: z.string(),
    marked_read: z.boolean(),
    dry_run: z.boolean(),
    status: z.string(),
  });

  server.registerTool(
    TOOL,
    {
      title: "Mark a Thread as Read",
      description: `Mark a thread as seen, which shows the customer a read receipt.

This is a write because it is visible to the customer: they see that Paddock Blade has read their message. Marking read without replying can read as being ignored, so prefer doing it alongside a reply rather than instead of one.

Requires confirmed: true.

Args:
  - page_id (string): the Page that owns the thread
  - recipient_id (string): the customer's participant_id
  - confirmed (boolean): required safety interlock
  - approval_ref (string, optional): recorded in the audit log
  - response_format ('markdown' | 'json'): default 'markdown'

Returns:
  { "recipient_id": string, "marked_read": boolean, "dry_run": boolean, "status": string }

Examples:
  - Use when: clearing a thread already handled elsewhere, e.g. answered by phone
  - Don't use when: you are about to reply anyway — sending the reply marks it read

Error Handling:
  - Subject to the same messaging window as sending: a sender_action on a long-dormant thread may be rejected by Meta.`,
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        requireConfirmation({
          confirmed: params.confirmed,
          toolName: TOOL,
          action: "Mark a thread as read, showing the customer a read receipt",
          targetId: params.recipient_id,
          details: { visible_to_customer: true },
        });

        const token = await resolvePageToken(params.page_id);

        const { dryRun } = await withAudit(
          {
            tool: TOOL,
            targetId: params.recipient_id,
            payload: { page_id: params.page_id, sender_action: "mark_seen" },
            ...(params.approval_ref ? { approvalRef: params.approval_ref } : {}),
          },
          () =>
            graphRequest<{ recipient_id?: string }>({
              path: `${params.page_id}/messages`,
              method: "POST",
              accessToken: token,
              body: {
                recipient: JSON.stringify({ id: params.recipient_id }),
                sender_action: "mark_seen",
              },
            }),
        );

        const output = {
          recipient_id: params.recipient_id,
          marked_read: !dryRun,
          dry_run: dryRun,
          status: dryRun
            ? "DRY RUN — nothing changed. The intended mark-read was logged only."
            : `Thread with ${params.recipient_id} marked as read.`,
        };

        return ok(
          output,
          `# Mark thread read\n\n${output.status}`,
          params.response_format,
        );
      } catch (error) {
        return fail(error, TOOL);
      }
    },
  );
}

/* ------------------------------------------------------------------ *
 * Markdown rendering
 * ------------------------------------------------------------------ */

function renderConversationList(o: z.infer<typeof ListOutputSchema>): string {
  const lines = [`# ${o.platform === "messenger" ? "Messenger" : "Instagram Direct"} threads`, ""];

  if (o.count === 0) {
    lines.push("No threads match. Nothing needs attention in this inbox.");
    return lines.join("\n");
  }

  lines.push(`${o.count} thread(s), ${o.unread_total} unread message(s) in total.`);
  lines.push("_Ordered by urgency — least time left to reply first._", "");

  if (o.closing_soon.length) {
    lines.push("## ⏰ Closing within 6 hours", "");
    for (const c of o.closing_soon) {
      lines.push(`- \`${c.conversation_id}\` — ${c.hours_left}h left`);
    }
    lines.push("");
  }

  for (const c of o.conversations) {
    const icon =
      c.window.state === "open" ? "🟢" : c.window.state === "human_agent_only" ? "🟡" : "🔴";
    lines.push(`## ${icon} ${c.participant_name ?? "Unknown"} — \`${c.id}\``);
    if (c.participant_id) lines.push(`- **Recipient ID**: \`${c.participant_id}\``);
    if (c.snippet) lines.push(`> ${c.snippet.replace(/\s+/g, " ").slice(0, 200)}`);
    if (c.unread_count) lines.push(`- **Unread**: ${c.unread_count}`);
    if (c.message_count !== undefined) lines.push(`- **Messages**: ${c.message_count}`);
    lines.push(`- **Window**: ${c.window.state} — ${c.window.explanation}`);
    lines.push("");
  }

  if (o.has_more) lines.push(`_More available. Call again with \`after: "${o.next_cursor}"\`._`);

  return lines.join("\n");
}

function renderConversation(o: {
  conversation_id: string;
  participant_name?: string;
  participant_id?: string;
  message_count: number;
  messages: Array<{ created_time: string; text: string; from_name?: string; is_from_us: boolean }>;
  window: z.infer<typeof WindowOutput>;
}): string {
  const lines = [
    `# Thread with ${o.participant_name ?? "unknown"}`,
    "",
    `- **Conversation ID**: \`${o.conversation_id}\``,
  ];
  if (o.participant_id) lines.push(`- **Recipient ID**: \`${o.participant_id}\``);
  lines.push(`- **Messages**: ${o.message_count}`, "");

  const icon =
    o.window.state === "open" ? "🟢" : o.window.state === "human_agent_only" ? "🟡" : "🔴";
  lines.push(`## ${icon} Messaging window: ${o.window.state}`, "", o.window.explanation, "");

  lines.push("## History (oldest first)", "");
  for (const m of o.messages) {
    const when = new Date(m.created_time).toLocaleString("en-GB", { timeZone: "UTC" });
    const who = m.is_from_us ? "**Paddock Blade**" : `**${m.from_name ?? "Customer"}**`;
    lines.push(`${who} — ${when} UTC`);
    lines.push(`> ${m.text.replace(/\n/g, "\n> ") || "(no text)"}`);
    lines.push("");
  }

  return lines.join("\n");
}

function renderSendResult(o: {
  status: string;
  recipient_id: string;
  message_sent: string;
  messaging_type: string;
  tag_used?: string;
  window_at_send: z.infer<typeof WindowOutput>;
}): string {
  return [
    "# Send direct message",
    "",
    o.status,
    "",
    `- **Recipient**: \`${o.recipient_id}\``,
    `- **Type**: ${o.messaging_type}${o.tag_used ? ` (tag: ${o.tag_used})` : ""}`,
    `- **Window**: ${o.window_at_send.state}`,
    "",
    "**Message:**",
    "",
    o.message_sent
      .split("\n")
      .map((l) => `> ${l}`)
      .join("\n"),
  ].join("\n");
}
