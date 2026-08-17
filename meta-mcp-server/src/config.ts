/**
 * Configuration loading and validation.
 *
 * Every secret arrives through the environment. Nothing is hard-coded, and
 * nothing is logged — `describeConfig()` exists specifically so diagnostics can
 * report on configuration without ever printing a token.
 */

import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { DEFAULT_AUDIT_LOG_PATH, DEFAULT_GRAPH_API_VERSION } from "./constants.js";

/** Load `.env` from the repository root if present. Real env vars always win. */
function bootstrapEnv(): void {
  for (const candidate of [".env", "../.env", "../../.env"]) {
    const path = resolve(process.cwd(), candidate);
    if (existsSync(path)) {
      loadDotenv({ path, override: false, quiet: true });
      return;
    }
  }
}

bootstrapEnv();

/** Comma-separated env value to a trimmed, de-duplicated list. */
function parseIdList(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
}

const BooleanEnv = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1" || v === "yes");

const ConfigSchema = z.object({
  /** Long-lived Page or User access token. The only credential tools need. */
  accessToken: z.string().min(20, "META_ACCESS_TOKEN looks too short to be a valid token"),
  /** App ID and secret, used only for token debugging and appsecret_proof. */
  appId: z.string().optional(),
  appSecret: z.string().optional(),
  graphApiVersion: z
    .string()
    .regex(/^v\d+\.\d+$/, "META_GRAPH_API_VERSION must look like 'v26.0'")
    .default(DEFAULT_GRAPH_API_VERSION),
  pageIds: z.array(z.string()).default([]),
  igAccountIds: z.array(z.string()).default([]),
  auditLogPath: z.string().default(DEFAULT_AUDIT_LOG_PATH),
  /**
   * When true, every write tool logs its intent and returns without touching
   * the Graph API. Phase 5 uses this to prove the pipeline end to end without
   * posting anything to real customers.
   */
  dryRun: z.boolean().default(false),
});

export type Config = z.infer<typeof ConfigSchema>;

let cached: Config | null = null;

/**
 * Read and validate configuration.
 *
 * Throws a message written for a human operator, not a stack-trace reader —
 * this is the first thing anyone hits when the server will not start.
 */
export function getConfig(): Config {
  if (cached) return cached;

  const parsed = ConfigSchema.safeParse({
    accessToken: process.env.META_ACCESS_TOKEN,
    appId: process.env.META_APP_ID,
    appSecret: process.env.META_APP_SECRET,
    graphApiVersion: process.env.META_GRAPH_API_VERSION || undefined,
    pageIds: parseIdList(process.env.PB_PAGE_IDS),
    igAccountIds: parseIdList(process.env.PB_IG_ACCOUNT_IDS),
    auditLogPath: process.env.META_AUDIT_LOG_PATH || undefined,
    dryRun: BooleanEnv.parse(process.env.META_DRY_RUN),
  });

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Configuration is not usable:\n${problems}\n\n` +
        `Fix this by copying .env.example to .env and filling it in:\n` +
        `  cp .env.example .env\n\n` +
        `META_ACCESS_TOKEN is the only mandatory value. See SETUP.md for how to\n` +
        `generate one, and never commit .env — it is git-ignored for that reason.`,
    );
  }

  cached = parsed.data;
  return cached;
}

/** Reset the cache. Tests only. */
export function resetConfigCache(): void {
  cached = null;
}

/**
 * A safe summary of the configuration for diagnostics.
 *
 * Tokens are reduced to a length and a four-character tail — enough to tell two
 * tokens apart when debugging, useless to anyone who intercepts it.
 */
export function describeConfig(cfg: Config): Record<string, unknown> {
  return {
    graph_api_version: cfg.graphApiVersion,
    graph_api_version_is_default: cfg.graphApiVersion === DEFAULT_GRAPH_API_VERSION,
    access_token: `${cfg.accessToken.length} chars, ending …${cfg.accessToken.slice(-4)}`,
    app_id_configured: Boolean(cfg.appId),
    app_secret_configured: Boolean(cfg.appSecret),
    configured_page_ids: cfg.pageIds,
    configured_ig_account_ids: cfg.igAccountIds,
    audit_log_path: cfg.auditLogPath,
    dry_run: cfg.dryRun,
  };
}
