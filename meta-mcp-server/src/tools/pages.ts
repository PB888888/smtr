/**
 * `meta_list_pages` — the entry point for every other tool, since it resolves
 * the Page and Instagram account IDs everything else takes as an argument.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { getConfig } from "../config.js";
import { graphRequest, type GraphPage } from "../services/graph-client.js";
import { fail, ok } from "../services/respond.js";
import { ResponseFormatField } from "../schemas/common.js";

const TOOL = "meta_list_pages";

interface PageRow {
  id: string;
  name?: string;
  category?: string;
  tasks?: string[];
  fan_count?: number;
  link?: string;
  instagram_business_account?: { id: string; username?: string; name?: string; followers_count?: number };
}

const InputSchema = z.strictObject({
  response_format: ResponseFormatField,
});

const OutputSchema = z.object({
  count: z.number(),
  pages: z.array(
    z.object({
      id: z.string(),
      name: z.string().optional(),
      category: z.string().optional(),
      followers: z.number().optional(),
      link: z.string().optional(),
      can_moderate_comments: z.boolean(),
      can_send_messages: z.boolean(),
      instagram: z
        .object({
          id: z.string(),
          username: z.string().optional(),
          name: z.string().optional(),
          followers: z.number().optional(),
        })
        .optional(),
      in_configured_allowlist: z.boolean(),
    }),
  ),
  configured_but_unreachable: z.array(z.string()),
});

export function registerPageTools(server: McpServer): void {
  server.registerTool(
    TOOL,
    {
      title: "List Facebook Pages and Linked Instagram Accounts",
      description: `List every Facebook Page this token can act for, with each Page's linked Instagram Business account.

Call this first in any session — the Page IDs and Instagram account IDs it returns are the arguments every other tool needs. It also reports which moderation tasks the token actually permits per Page, so you can tell in advance whether a reply or a DM will be allowed.

Args:
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  {
    "count": number,
    "pages": [
      {
        "id": string,                        // Page ID — pass as page_id elsewhere
        "name": string,
        "category": string,
        "followers": number,
        "link": string,
        "can_moderate_comments": boolean,     // derived from the Page's granted tasks
        "can_send_messages": boolean,
        "instagram": { "id": string, "username": string, "followers": number },
        "in_configured_allowlist": boolean    // whether it appears in PB_PAGE_IDS in .env
      }
    ],
    "configured_but_unreachable": string[]    // IDs in PB_PAGE_IDS this token cannot reach
  }

Examples:
  - Use when: starting work and you need the Page and Instagram IDs
  - Use when: a tool returned "object not found" and you need to check the asset is reachable
  - Don't use when: you want a diagnostic on scopes and token expiry (use meta_check_access)

Error Handling:
  - Returns an empty list with an explanation if the token reaches no Pages, which almost always means the token's owner lacks an admin role on the Page.
  - 'configured_but_unreachable' is the fastest way to spot a typo in PB_PAGE_IDS.`,
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ response_format }) => {
      try {
        const cfg = getConfig();
        const response = await graphRequest<GraphPage<PageRow>>({
          path: "me/accounts",
          query: {
            fields:
              "id,name,category,tasks,fan_count,link," +
              "instagram_business_account{id,username,name,followers_count}",
            limit: 100,
          },
        });

        const rows = (response.data ?? []).map((page) => {
          const tasks = page.tasks ?? [];
          return {
            id: page.id,
            ...(page.name ? { name: page.name } : {}),
            ...(page.category ? { category: page.category } : {}),
            ...(page.fan_count !== undefined ? { followers: page.fan_count } : {}),
            ...(page.link ? { link: page.link } : {}),
            // An empty tasks array means the field was not returned rather than
            // that nothing is permitted, so treat absence as permitted and let
            // the API be the authority on the actual write.
            can_moderate_comments: tasks.length === 0 || tasks.includes("MODERATE"),
            can_send_messages: tasks.length === 0 || tasks.includes("MESSAGING"),
            ...(page.instagram_business_account
              ? {
                  instagram: {
                    id: page.instagram_business_account.id,
                    ...(page.instagram_business_account.username
                      ? { username: page.instagram_business_account.username }
                      : {}),
                    ...(page.instagram_business_account.name
                      ? { name: page.instagram_business_account.name }
                      : {}),
                    ...(page.instagram_business_account.followers_count !== undefined
                      ? { followers: page.instagram_business_account.followers_count }
                      : {}),
                  },
                }
              : {}),
            in_configured_allowlist:
              cfg.pageIds.length === 0 ? true : cfg.pageIds.includes(page.id),
          };
        });

        const reachable = new Set(rows.map((r) => r.id));
        const output = {
          count: rows.length,
          pages: rows,
          configured_but_unreachable: cfg.pageIds.filter((id) => !reachable.has(id)),
        };

        return ok(output, renderMarkdown(output), response_format);
      } catch (error) {
        return fail(error, TOOL);
      }
    },
  );
}

function renderMarkdown(o: z.infer<typeof OutputSchema>): string {
  if (o.count === 0) {
    return [
      "# Facebook Pages",
      "",
      "**No Pages are reachable with this token.**",
      "",
      "This is almost always one of:",
      "- The token belongs to a user without an admin role on the Paddock Blade Pages.",
      "- The token was generated without the `pages_show_list` scope.",
      "- The token is a Page token for a single Page, in which case `me/accounts` returns",
      "  nothing and you should use that Page's ID directly.",
      "",
      "Run `meta_check_access` for a fuller diagnosis.",
    ].join("\n");
  }

  const lines = [`# Facebook Pages (${o.count})`, ""];

  for (const page of o.pages) {
    lines.push(`## ${page.name ?? "(unnamed)"} (\`${page.id}\`)`);
    if (page.category) lines.push(`- **Category**: ${page.category}`);
    if (page.followers !== undefined) {
      lines.push(`- **Followers**: ${page.followers.toLocaleString("en-GB")}`);
    }
    lines.push(
      `- **Permissions**: comments ${page.can_moderate_comments ? "✅" : "❌"}, ` +
        `messaging ${page.can_send_messages ? "✅" : "❌"}`,
    );
    if (page.instagram) {
      const followers =
        page.instagram.followers !== undefined
          ? `, ${page.instagram.followers.toLocaleString("en-GB")} followers`
          : "";
      lines.push(
        `- **Instagram**: @${page.instagram.username ?? "?"} (\`${page.instagram.id}\`)${followers}`,
      );
    } else {
      lines.push("- **Instagram**: not linked to this Page");
    }
    if (!page.in_configured_allowlist) {
      lines.push("- ⚠️ Not listed in `PB_PAGE_IDS` in .env");
    }
    lines.push("");
  }

  if (o.configured_but_unreachable.length) {
    lines.push(
      "## ⚠️ Configured but unreachable",
      "",
      "These IDs appear in `PB_PAGE_IDS` but this token cannot reach them — most likely a typo,",
      "or an asset the token's owner does not administer:",
      "",
      ...o.configured_but_unreachable.map((id) => `- \`${id}\``),
    );
  }

  return lines.join("\n");
}
