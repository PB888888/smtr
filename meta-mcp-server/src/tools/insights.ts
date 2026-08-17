/**
 * `meta_get_post_insights` — performance figures for one post.
 *
 * A caution that shaped this file: Meta retires insight metrics regularly, and
 * during 2026 it began replacing reach and impressions metrics with views-based
 * ones. Metric names are therefore treated as data, not as constants: they are a
 * parameter with a conservative default, and a rejected metric produces an error
 * that names it rather than failing the whole call opaquely.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { graphRequest, resolvePageToken, type GraphPage } from "../services/graph-client.js";
import { fail, ok } from "../services/respond.js";
import {
  IdField,
  PlatformField,
  ResponseFormatField,
} from "../schemas/common.js";

const TOOL = "meta_get_post_insights";

/**
 * Default metric sets, chosen to be the least likely to have been retired.
 * Override with the `metrics` parameter when Meta changes the names again.
 */
const DEFAULT_FACEBOOK_METRICS = [
  "post_impressions",
  "post_impressions_unique",
  "post_engaged_users",
  "post_clicks",
  "post_reactions_by_type_total",
];

const DEFAULT_INSTAGRAM_METRICS = ["reach", "saved", "likes", "comments", "shares"];

interface InsightRow {
  name: string;
  period?: string;
  title?: string;
  description?: string;
  values?: Array<{ value: unknown; end_time?: string }>;
}

const InputSchema = z.strictObject({
  platform: PlatformField,
  post_id: IdField(
    "The Facebook post ID or Instagram media ID from meta_list_recent_posts.",
  ),
  metrics: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "Metric names to request. Omit for a sensible default set. Supply explicitly when Meta " +
        "has retired a metric and the default set errors — the error message names the " +
        "offending metric.",
    ),
  response_format: ResponseFormatField,
});

const OutputSchema = z.object({
  post_id: z.string(),
  platform: z.enum(["facebook", "instagram"]),
  metrics_requested: z.array(z.string()),
  metrics: z.array(
    z.object({
      name: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      period: z.string().optional(),
      value: z.unknown(),
    }),
  ),
  metrics_returned_count: z.number(),
  note: z.string().optional(),
});

export function registerInsightTools(server: McpServer): void {
  server.registerTool(
    TOOL,
    {
      title: "Get Post Insights",
      description: `Fetch performance metrics for one Facebook post or Instagram media item — impressions, reach, engagement, clicks and reactions, depending on the platform.

Used by the social-digest skill to work out which posts drew attention, and therefore which topics are worth turning into more content.

A warning about metric names: Meta retires insight metrics on its own schedule, and through 2026 it has been replacing reach and impressions metrics with views-based equivalents. If the default set errors with a parameter complaint, pass 'metrics' explicitly with names Meta currently accepts. The error message will name which metric it rejected.

Args:
  - platform ('facebook' | 'instagram'): required
  - post_id (string): the post or media ID
  - metrics (string[], optional): metric names; omit for the default set
  - response_format ('markdown' | 'json'): default 'markdown'

Default metric sets:
  - facebook:  post_impressions, post_impressions_unique, post_engaged_users, post_clicks, post_reactions_by_type_total
  - instagram: reach, saved, likes, comments, shares

Returns:
  {
    "post_id": string,
    "platform": string,
    "metrics_requested": string[],
    "metrics": [
      { "name": string, "title": string, "description": string, "period": string, "value": unknown }
    ],
    "metrics_returned_count": number,
    "note": string          // present when fewer metrics came back than were asked for
  }

Examples:
  - Use when: building the daily digest and you need engagement figures per post
  - Use when: deciding whether a topic resonated enough to make a reel about
  - Don't use when: you only need the comment count (meta_list_recent_posts already returns it, at no extra API cost)

Error Handling:
  - Graph API code 100 means a metric name is not valid for this object. The error names it; drop it from 'metrics' and retry.
  - Insights are unavailable on very recent posts — Meta needs time to aggregate. An empty metrics array on a post from the last hour is normal, not an error.`,
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
        const requested =
          params.metrics && params.metrics.length > 0
            ? params.metrics
            : params.platform === "facebook"
              ? DEFAULT_FACEBOOK_METRICS
              : DEFAULT_INSTAGRAM_METRICS;

        // Facebook post insights need the owning Page's token; the Page ID is the
        // part of the post ID before the underscore.
        const pageId =
          params.platform === "facebook" && params.post_id.includes("_")
            ? params.post_id.split("_")[0]
            : undefined;
        const token = pageId ? await resolvePageToken(pageId) : undefined;

        const response = await graphRequest<GraphPage<InsightRow>>({
          path: `${params.post_id}/insights`,
          ...(token ? { accessToken: token } : {}),
          query: { metric: requested.join(",") },
        });

        const metrics = (response.data ?? []).map((row) => ({
          name: row.name,
          ...(row.title ? { title: row.title } : {}),
          ...(row.description ? { description: row.description } : {}),
          ...(row.period ? { period: row.period } : {}),
          value: row.values?.[0]?.value ?? null,
        }));

        const missing = requested.filter((m) => !metrics.some((r) => r.name === m));

        const output = {
          post_id: params.post_id,
          platform: params.platform,
          metrics_requested: requested,
          metrics,
          metrics_returned_count: metrics.length,
          ...(missing.length
            ? {
                note:
                  `Meta returned no data for: ${missing.join(", ")}. This means either the ` +
                  `metric has been retired, or it does not apply to this object type, or the ` +
                  `post is too recent to have been aggregated yet.`,
              }
            : {}),
        };

        return ok(output, renderMarkdown(output), params.response_format);
      } catch (error) {
        return fail(error, TOOL);
      }
    },
  );
}

function renderMarkdown(o: z.infer<typeof OutputSchema>): string {
  const lines = [`# Insights — \`${o.post_id}\` (${o.platform})`, ""];

  if (o.metrics_returned_count === 0) {
    lines.push(
      "No metrics returned.",
      "",
      o.note ?? "Meta returned an empty set. If the post is less than an hour old, this is normal.",
    );
    return lines.join("\n");
  }

  for (const metric of o.metrics) {
    const value =
      typeof metric.value === "object" && metric.value !== null
        ? JSON.stringify(metric.value)
        : String(metric.value);
    lines.push(`- **${metric.title ?? metric.name}**: ${value}`);
    if (metric.name !== (metric.title ?? metric.name)) {
      lines.push(`  - \`${metric.name}\`${metric.period ? ` · period: ${metric.period}` : ""}`);
    }
  }

  if (o.note) lines.push("", `_Note: ${o.note}_`);

  return lines.join("\n");
}
