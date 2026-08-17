/**
 * `meta_list_recent_posts` — find the posts worth checking for comments.
 *
 * Facebook Pages and Instagram accounts use different endpoints and different
 * field names for the same ideas, so this normalises both into one shape.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { graphRequestAll, resolvePageToken } from "../services/graph-client.js";
import { fail, ok, paginationMeta } from "../services/respond.js";
import {
  CursorField,
  IdField,
  LimitField,
  PlatformField,
  ResponseFormatField,
} from "../schemas/common.js";

const TOOL = "meta_list_recent_posts";

interface FacebookPost {
  id: string;
  message?: string;
  story?: string;
  created_time: string;
  permalink_url?: string;
  comments?: { summary?: { total_count?: number } };
  reactions?: { summary?: { total_count?: number } };
}

interface InstagramMedia {
  id: string;
  caption?: string;
  timestamp: string;
  permalink?: string;
  media_type?: string;
  comments_count?: number;
  like_count?: number;
}

const InputSchema = z.strictObject({
  platform: PlatformField,
  account_id: IdField(
    "The Page ID (platform='facebook') or the Instagram Business account ID " +
      "(platform='instagram'). Both come from meta_list_pages.",
  ),
  since: z
    .string()
    .optional()
    .describe("Only posts on or after this date. ISO 8601 date or datetime, e.g. '2026-08-01'."),
  until: z
    .string()
    .optional()
    .describe("Only posts on or before this date. ISO 8601 date or datetime."),
  limit: LimitField,
  after: CursorField,
  response_format: ResponseFormatField,
});

const PostOutput = z.object({
  id: z.string(),
  platform: z.enum(["facebook", "instagram"]),
  text: z.string(),
  created_time: z.string(),
  permalink: z.string().optional(),
  comment_count: z.number().optional(),
  reaction_count: z.number().optional(),
  media_type: z.string().optional(),
});

const OutputSchema = z.object({
  account_id: z.string(),
  platform: z.enum(["facebook", "instagram"]),
  count: z.number(),
  has_more: z.boolean(),
  next_cursor: z.string().optional(),
  posts: z.array(PostOutput),
  total_comments_across_posts: z.number(),
});

export function registerPostTools(server: McpServer): void {
  server.registerTool(
    TOOL,
    {
      title: "List Recent Posts",
      description: `List recent posts on a Facebook Page or media on an Instagram account, newest first, with a comment count for each.

Use this to find which posts have comments worth triaging, then pass a post ID to meta_list_comments. Sorting by comment_count identifies where the conversation actually is.

Args:
  - platform ('facebook' | 'instagram'): which API family to use — required, they are different endpoints
  - account_id (string): Page ID, or Instagram Business account ID
  - since (string, optional): ISO date, e.g. '2026-08-01'
  - until (string, optional): ISO date
  - limit (number): 1-100 (default: 25)
  - after (string, optional): pagination cursor from a previous next_cursor
  - response_format ('markdown' | 'json'): default 'markdown'

Returns:
  {
    "account_id": string,
    "platform": "facebook" | "instagram",
    "count": number,
    "has_more": boolean,
    "next_cursor": string,               // present only when has_more is true
    "posts": [
      {
        "id": string,                     // pass as post_id to meta_list_comments
        "platform": string,
        "text": string,                   // message (Facebook) or caption (Instagram)
        "created_time": string,           // ISO 8601
        "permalink": string,
        "comment_count": number,
        "reaction_count": number,         // Facebook: reactions; Instagram: likes
        "media_type": string              // Instagram only, e.g. IMAGE, VIDEO, CAROUSEL_ALBUM
      }
    ],
    "total_comments_across_posts": number
  }

Examples:
  - Use when: "what have we posted this week and where are the comments" -> platform='facebook', account_id=<page>, since='2026-08-10'
  - Use when: you need a post ID before calling meta_list_comments
  - Don't use when: you already have the post ID (go straight to meta_list_comments)

Error Handling:
  - An Instagram account_id passed with platform='facebook' returns "object not found" — check which ID you used; they are different numbers.
  - Instagram media has no 'story' equivalent, so text is empty for media posted without a caption.`,
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
        const posts =
          params.platform === "facebook"
            ? await listFacebookPosts(params)
            : await listInstagramMedia(params);

        const output = {
          account_id: params.account_id,
          platform: params.platform,
          ...paginationMeta({
            count: posts.items.length,
            hasMore: posts.hasMore,
            ...(posts.nextCursor ? { nextCursor: posts.nextCursor } : {}),
          }),
          posts: posts.items,
          total_comments_across_posts: posts.items.reduce(
            (sum, p) => sum + (p.comment_count ?? 0),
            0,
          ),
        } as z.infer<typeof OutputSchema>;

        return ok(output, renderMarkdown(output), params.response_format);
      } catch (error) {
        return fail(error, TOOL);
      }
    },
  );
}

type NormalisedPost = z.infer<typeof PostOutput>;

async function listFacebookPosts(params: {
  account_id: string;
  since?: string;
  until?: string;
  limit: number;
  after?: string;
}): Promise<{ items: NormalisedPost[]; hasMore: boolean; nextCursor?: string }> {
  const token = await resolvePageToken(params.account_id);
  const result = await graphRequestAll<FacebookPost>(
    {
      path: `${params.account_id}/posts`,
      accessToken: token,
      query: {
        fields:
          "id,message,story,created_time,permalink_url," +
          "comments.summary(true).limit(0),reactions.summary(true).limit(0)",
        ...(params.since ? { since: params.since } : {}),
        ...(params.until ? { until: params.until } : {}),
        ...(params.after ? { after: params.after } : {}),
      },
    },
    params.limit,
  );

  return {
    items: result.items.map((post) => ({
      id: post.id,
      platform: "facebook" as const,
      text: post.message ?? post.story ?? "",
      created_time: post.created_time,
      ...(post.permalink_url ? { permalink: post.permalink_url } : {}),
      ...(post.comments?.summary?.total_count !== undefined
        ? { comment_count: post.comments.summary.total_count }
        : {}),
      ...(post.reactions?.summary?.total_count !== undefined
        ? { reaction_count: post.reactions.summary.total_count }
        : {}),
    })),
    hasMore: result.hasMore,
    ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
  };
}

async function listInstagramMedia(params: {
  account_id: string;
  since?: string;
  until?: string;
  limit: number;
  after?: string;
}): Promise<{ items: NormalisedPost[]; hasMore: boolean; nextCursor?: string }> {
  const result = await graphRequestAll<InstagramMedia>(
    {
      path: `${params.account_id}/media`,
      query: {
        fields: "id,caption,timestamp,permalink,media_type,comments_count,like_count",
        ...(params.since ? { since: params.since } : {}),
        ...(params.until ? { until: params.until } : {}),
        ...(params.after ? { after: params.after } : {}),
      },
    },
    params.limit,
  );

  return {
    items: result.items.map((media) => ({
      id: media.id,
      platform: "instagram" as const,
      text: media.caption ?? "",
      created_time: media.timestamp,
      ...(media.permalink ? { permalink: media.permalink } : {}),
      ...(media.comments_count !== undefined ? { comment_count: media.comments_count } : {}),
      ...(media.like_count !== undefined ? { reaction_count: media.like_count } : {}),
      ...(media.media_type ? { media_type: media.media_type } : {}),
    })),
    hasMore: result.hasMore,
    ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
  };
}

function renderMarkdown(o: z.infer<typeof OutputSchema>): string {
  if (o.count === 0) {
    return [
      `# Recent posts — ${o.platform} \`${o.account_id}\``,
      "",
      "No posts found in this range. Widen the dates, or drop `since`/`until` entirely to",
      "check the account has any posts the token can see.",
    ].join("\n");
  }

  const lines = [
    `# Recent posts — ${o.platform} \`${o.account_id}\``,
    "",
    `${o.count} post(s), ${o.total_comments_across_posts} comment(s) between them.`,
    "",
  ];

  for (const post of o.posts) {
    const when = new Date(post.created_time).toLocaleString("en-GB", { timeZone: "UTC" });
    const preview = post.text.replace(/\s+/g, " ").slice(0, 120) || "(no caption)";
    lines.push(`## ${when} UTC — \`${post.id}\``);
    lines.push(`> ${preview}${post.text.length > 120 ? "…" : ""}`);
    const stats: string[] = [];
    if (post.comment_count !== undefined) stats.push(`💬 ${post.comment_count}`);
    if (post.reaction_count !== undefined) stats.push(`👍 ${post.reaction_count}`);
    if (post.media_type) stats.push(post.media_type);
    if (stats.length) lines.push(`- ${stats.join(" · ")}`);
    if (post.permalink) lines.push(`- [View post](${post.permalink})`);
    lines.push("");
  }

  if (o.has_more) {
    lines.push(`_More available. Call again with \`after: "${o.next_cursor}"\`._`);
  }

  return lines.join("\n");
}
