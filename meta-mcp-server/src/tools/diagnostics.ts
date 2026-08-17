/**
 * `meta_check_access` — the tool that answers the questions this build could not
 * answer from documentation.
 *
 * Because Meta's docs were unreachable when this server was written, the API
 * version and the true set of granted scopes were both unverifiable. This tool
 * turns them into something the running system reports rather than something
 * anyone has to guess: point it at a real token and it says which version
 * responds, which scopes are actually held, when the token expires, and which
 * Pages and Instagram accounts are in reach.
 *
 * Run it first, before anything else, on any new installation.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { describeConfig, getConfig } from "../config.js";
import { DEFAULT_GRAPH_API_VERSION } from "../constants.js";
import { graphRequest, type GraphPage } from "../services/graph-client.js";
import { fail, ok } from "../services/respond.js";
import { ResponseFormatField } from "../schemas/common.js";

const TOOL = "meta_check_access";

/** Scopes this server needs, and what stops working without each one. */
const REQUIRED_SCOPES: Array<{ scope: string; neededFor: string }> = [
  { scope: "pages_show_list", neededFor: "listing Pages at all" },
  { scope: "pages_read_engagement", neededFor: "reading posts and comments" },
  { scope: "pages_read_user_content", neededFor: "reading customers' comments" },
  { scope: "pages_manage_engagement", neededFor: "replying to, hiding and deleting comments" },
  { scope: "pages_messaging", neededFor: "reading and sending Messenger messages" },
  { scope: "instagram_basic", neededFor: "resolving the Instagram account and its media" },
  { scope: "instagram_manage_comments", neededFor: "reading and replying to Instagram comments" },
  { scope: "instagram_manage_messages", neededFor: "reading and sending Instagram DMs" },
  { scope: "read_insights", neededFor: "post insights" },
];

interface PermissionRow {
  permission: string;
  status: "granted" | "declined" | "expired" | string;
}

interface DebugTokenData {
  app_id?: string;
  type?: string;
  application?: string;
  expires_at?: number;
  data_access_expires_at?: number;
  is_valid?: boolean;
  scopes?: string[];
  granular_scopes?: Array<{ scope: string; target_ids?: string[] }>;
  profile_id?: string;
}

const InputSchema = z.strictObject({
  response_format: ResponseFormatField,
});

const OutputSchema = z.object({
  version_probe: z.object({
    configured_version: z.string(),
    is_unverified_default: z.boolean(),
    responded: z.boolean(),
    note: z.string(),
  }),
  identity: z.object({ id: z.string().optional(), name: z.string().optional() }).optional(),
  token: z
    .object({
      is_valid: z.boolean().optional(),
      type: z.string().optional(),
      expires_at: z.string().optional(),
      data_access_expires_at: z.string().optional(),
      scopes: z.array(z.string()).optional(),
      debug_available: z.boolean(),
      debug_note: z.string().optional(),
    })
    .optional(),
  scopes: z.object({
    granted: z.array(z.string()),
    declined: z.array(z.string()),
    missing_required: z.array(z.object({ scope: z.string(), needed_for: z.string() })),
    all_required_present: z.boolean(),
  }),
  reachable_assets: z.object({
    pages: z.array(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        instagram_account_id: z.string().optional(),
        instagram_username: z.string().optional(),
      }),
    ),
    page_count: z.number(),
    instagram_account_count: z.number(),
  }),
  configuration: z.record(z.string(), z.unknown()),
  verdict: z.string(),
});

export function registerDiagnosticTools(server: McpServer): void {
  server.registerTool(
    TOOL,
    {
      title: "Check Meta API Access",
      description: `Diagnose this server's Meta API access: confirm the Graph API version responds, report which permission scopes the token actually holds, when it expires, and which Pages and Instagram accounts are reachable.

Run this FIRST on any new installation, and whenever a tool returns a permission or token error.

This tool is the authority on two things the documentation could not settle at build time:
  1. Whether the configured Graph API version (META_GRAPH_API_VERSION) is valid. The default was triangulated rather than read off Meta's changelog, because developers.facebook.com was unreachable from the build environment.
  2. Which scopes are genuinely granted, as opposed to requested. Standard Access may cover everything for a single-business tool with no App Review at all — this reports what is actually in force.

Args:
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  {
    "version_probe":     { "configured_version": string, "is_unverified_default": boolean, "responded": boolean, "note": string },
    "identity":          { "id": string, "name": string },
    "token":             { "is_valid": boolean, "type": string, "expires_at": string, "scopes": string[], "debug_available": boolean },
    "scopes":            { "granted": string[], "declined": string[], "missing_required": [{ "scope": string, "needed_for": string }], "all_required_present": boolean },
    "reachable_assets":  { "pages": [{ "id": string, "name": string, "instagram_account_id": string }], "page_count": number, "instagram_account_count": number },
    "configuration":     object,   // secrets redacted to a length and 4-character tail
    "verdict":           string    // plain-language summary of whether this install is usable
  }

Examples:
  - Use when: setting up for the first time, to see what works before building anything on it
  - Use when: any tool returns a permission error, to find out which scope is actually missing
  - Use when: checking how long the token has left before it needs regenerating
  - Don't use when: you want the list of Pages for ordinary work (use meta_list_pages)

Never returns secret values. The access token appears only as a character count and its last four characters.

Error Handling:
  - Reports partial results rather than failing outright: if /me/permissions is denied it still reports reachable Pages, because knowing which half works is what makes the error diagnosable.`,
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

        // Each probe is independent and allowed to fail on its own, because a
        // half-working install is exactly when this tool matters most.
        const identity = await attempt(() =>
          graphRequest<{ id: string; name?: string }>({ path: "me", query: { fields: "id,name" } }),
        );

        const permissions = await attempt(() =>
          graphRequest<GraphPage<PermissionRow>>({ path: "me/permissions" }),
        );

        const pages = await attempt(() =>
          graphRequest<GraphPage<{ id: string; name?: string; instagram_business_account?: { id: string; username?: string } }>>(
            {
              path: "me/accounts",
              query: { fields: "id,name,instagram_business_account{id,username}" },
            },
          ),
        );

        const tokenDebug = await debugToken(cfg.accessToken, cfg.appId, cfg.appSecret);

        const granted = (permissions?.data ?? [])
          .filter((p) => p.status === "granted")
          .map((p) => p.permission);
        const declined = (permissions?.data ?? [])
          .filter((p) => p.status !== "granted")
          .map((p) => p.permission);
        const missing = REQUIRED_SCOPES.filter((r) => !granted.includes(r.scope)).map((r) => ({
          scope: r.scope,
          needed_for: r.neededFor,
        }));

        const pageRows = (pages?.data ?? []).map((p) => ({
          id: p.id,
          ...(p.name ? { name: p.name } : {}),
          ...(p.instagram_business_account?.id
            ? { instagram_account_id: p.instagram_business_account.id }
            : {}),
          ...(p.instagram_business_account?.username
            ? { instagram_username: p.instagram_business_account.username }
            : {}),
        }));

        const versionResponded = identity !== null || permissions !== null || pages !== null;

        const output = {
          version_probe: {
            configured_version: cfg.graphApiVersion,
            is_unverified_default: cfg.graphApiVersion === DEFAULT_GRAPH_API_VERSION,
            responded: versionResponded,
            note: versionResponded
              ? `Graph API responded on ${cfg.graphApiVersion}, so this version is valid and supported.`
              : `No call succeeded on ${cfg.graphApiVersion}. Either the token is unusable or this ` +
                `version is wrong. Check the current version at ` +
                `https://developers.facebook.com/docs/graph-api/changelog and set ` +
                `META_GRAPH_API_VERSION in .env accordingly.`,
          },
          ...(identity ? { identity: { id: identity.id, ...(identity.name ? { name: identity.name } : {}) } } : {}),
          token: tokenDebug,
          scopes: {
            granted,
            declined,
            missing_required: missing,
            all_required_present: missing.length === 0,
          },
          reachable_assets: {
            pages: pageRows,
            page_count: pageRows.length,
            instagram_account_count: pageRows.filter((p) => p.instagram_account_id).length,
          },
          configuration: describeConfig(cfg),
          verdict: buildVerdict({
            versionResponded,
            missingCount: missing.length,
            pageCount: pageRows.length,
            igCount: pageRows.filter((p) => p.instagram_account_id).length,
            permissionsReadable: permissions !== null,
            dryRun: cfg.dryRun,
          }),
        };

        return ok(output, renderMarkdown(output), response_format);
      } catch (error) {
        return fail(error, TOOL);
      }
    },
  );
}

/** Run a probe, returning null instead of throwing so one failure is survivable. */
async function attempt<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

/**
 * Inspect the token via `/debug_token`.
 *
 * This needs an app access token (`{app-id}|{app-secret}`), so it only works
 * when both are configured. Absent them the rest of the report is still useful,
 * which is why this degrades rather than fails.
 */
async function debugToken(
  token: string,
  appId: string | undefined,
  appSecret: string | undefined,
): Promise<z.infer<typeof OutputSchema>["token"]> {
  if (!appId || !appSecret) {
    return {
      debug_available: false,
      debug_note:
        "Token expiry could not be checked: META_APP_ID and META_APP_SECRET are not both set " +
        "in .env. Everything else in this report is unaffected. Add them to see the token's " +
        "expiry date, which is worth knowing before it lapses mid-week.",
    };
  }

  const result = await attempt(() =>
    graphRequest<{ data: DebugTokenData }>({
      path: "debug_token",
      query: { input_token: token, access_token: `${appId}|${appSecret}` },
    }),
  );

  if (!result?.data) {
    return {
      debug_available: false,
      debug_note:
        "/debug_token did not return data. The app ID and secret may not match the app that " +
        "issued this token.",
    };
  }

  const d = result.data;
  return {
    debug_available: true,
    ...(d.is_valid !== undefined ? { is_valid: d.is_valid } : {}),
    ...(d.type ? { type: d.type } : {}),
    ...(d.expires_at !== undefined ? { expires_at: formatExpiry(d.expires_at) } : {}),
    ...(d.data_access_expires_at !== undefined
      ? { data_access_expires_at: formatExpiry(d.data_access_expires_at) }
      : {}),
    ...(d.scopes ? { scopes: d.scopes } : {}),
  };
}

/** Meta uses 0 to mean "never expires", which is what a long-lived Page token does. */
function formatExpiry(epochSeconds: number): string {
  if (epochSeconds === 0) return "never (long-lived token)";
  const date = new Date(epochSeconds * 1000);
  const days = Math.round((date.getTime() - Date.now()) / 86_400_000);
  return `${date.toISOString()} (${days} day(s) from now)`;
}

function buildVerdict(args: {
  versionResponded: boolean;
  missingCount: number;
  pageCount: number;
  igCount: number;
  permissionsReadable: boolean;
  dryRun: boolean;
}): string {
  const parts: string[] = [];

  if (!args.versionResponded) {
    return (
      "NOT USABLE. No Graph API call succeeded. Fix the token or the API version before " +
      "anything else — nothing else in this report can be trusted until a call works."
    );
  }

  if (!args.permissionsReadable) {
    parts.push(
      "PARTIAL. Calls succeed but /me/permissions was denied, so granted scopes could not be " +
        "listed. This usually means the token is a Page token rather than a User token; that is " +
        "fine for day-to-day work but hides the scope list.",
    );
  } else if (args.missingCount > 0) {
    parts.push(
      `PARTIAL. ${args.missingCount} required scope(s) are not granted — see missing_required. ` +
        `Tools depending on them will fail with a permission error naming the scope.`,
    );
  } else {
    parts.push("READY. All required scopes are granted.");
  }

  parts.push(
    `${args.pageCount} Page(s) reachable, ${args.igCount} with a linked Instagram account.`,
  );

  if (args.pageCount === 0) {
    parts.push(
      "No Pages are reachable, which will block everything. Confirm the token belongs to a user " +
        "with an admin role on the Paddock Blade Pages.",
    );
  }

  parts.push(
    args.dryRun
      ? "DRY-RUN IS ON: writes will be logged and skipped, nothing will reach Meta."
      : "Dry-run is OFF: confirmed writes will reach Meta for real.",
  );

  return parts.join(" ");
}

function renderMarkdown(o: z.infer<typeof OutputSchema>): string {
  const lines = ["# Meta API Access Check", "", `**Verdict:** ${o.verdict}`, ""];

  lines.push("## Graph API version", "");
  lines.push(`- Configured: \`${o.version_probe.configured_version}\``);
  lines.push(`- Responded: ${o.version_probe.responded ? "yes" : "**no**"}`);
  if (o.version_probe.is_unverified_default) {
    lines.push("- This is the unverified built-in default — see the note below.");
  }
  lines.push(`- ${o.version_probe.note}`, "");

  if (o.identity) {
    lines.push("## Identity", "", `- ${o.identity.name ?? "(unnamed)"} (\`${o.identity.id}\`)`, "");
  }

  lines.push("## Token", "");
  if (o.token?.debug_available) {
    lines.push(`- Valid: ${o.token.is_valid ? "yes" : "**no**"}`);
    if (o.token.type) lines.push(`- Type: ${o.token.type}`);
    if (o.token.expires_at) lines.push(`- Expires: ${o.token.expires_at}`);
    if (o.token.data_access_expires_at) {
      lines.push(`- Data access expires: ${o.token.data_access_expires_at}`);
    }
  } else {
    lines.push(`- ${o.token?.debug_note ?? "Not checked."}`);
  }
  lines.push("");

  lines.push("## Scopes", "");
  lines.push(`- Granted (${o.scopes.granted.length}): ${o.scopes.granted.join(", ") || "none"}`);
  if (o.scopes.declined.length) {
    lines.push(`- Not granted: ${o.scopes.declined.join(", ")}`);
  }
  if (o.scopes.missing_required.length) {
    lines.push("", "**Missing required scopes:**", "");
    for (const m of o.scopes.missing_required) {
      lines.push(`- \`${m.scope}\` — needed for ${m.needed_for}`);
    }
  } else if (o.scopes.granted.length) {
    lines.push("- All required scopes are present.");
  }
  lines.push("");

  lines.push("## Reachable assets", "");
  if (!o.reachable_assets.pages.length) {
    lines.push("- **None.** No Pages are reachable with this token.");
  }
  for (const p of o.reachable_assets.pages) {
    const ig = p.instagram_account_id
      ? ` — IG: ${p.instagram_username ?? "?"} (\`${p.instagram_account_id}\`)`
      : " — no linked Instagram account";
    lines.push(`- **${p.name ?? "(unnamed)"}** (\`${p.id}\`)${ig}`);
  }
  lines.push("");

  lines.push("## Configuration", "");
  for (const [key, value] of Object.entries(o.configuration)) {
    lines.push(`- \`${key}\`: ${typeof value === "string" ? value : JSON.stringify(value)}`);
  }

  return lines.join("\n");
}
