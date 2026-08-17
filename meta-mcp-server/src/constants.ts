/**
 * Shared constants. No secrets here — everything sensitive comes from `.env`
 * via `config.ts`.
 */

/** Graph API host. Version is deliberately NOT baked in — see `config.ts`. */
export const GRAPH_API_HOST = "https://graph.facebook.com";

/**
 * Default Graph API version, overridable with `META_GRAPH_API_VERSION`.
 *
 * PROVISIONAL. Meta's documentation was unreachable when this was written
 * (the build environment's egress policy denies developers.facebook.com), so
 * this was triangulated from Meta's own published `facebook-nodejs-business-sdk`
 * package and its release cadence rather than read off the changelog. Run
 * `meta_check_access` against a real token to confirm it, and see
 * `docs/phase-1-plan.md` section 1 for the full reasoning.
 *
 * Meta retires versions on a rolling ~2-year clock, so this needs to be
 * operator-changeable regardless of whether the default is right today.
 */
export const DEFAULT_GRAPH_API_VERSION = "v26.0";

/** Maximum characters in any single tool response before truncation kicks in. */
export const CHARACTER_LIMIT = 25_000;

/** HTTP request timeout in milliseconds. */
export const REQUEST_TIMEOUT_MS = 30_000;

/** Retry policy for transient failures and rate limits. */
export const MAX_RETRIES = 4;
export const BASE_BACKOFF_MS = 1_000;
export const MAX_BACKOFF_MS = 32_000;

/**
 * Client-side throttle. Meta's limits are per-app and per-business-use-case
 * rather than a simple requests-per-second, so this is a politeness floor to
 * avoid bursting into a penalty, not a substitute for reading the usage
 * headers (which `graph-client.ts` does).
 */
export const MIN_REQUEST_INTERVAL_MS = 120;

/** Messaging window boundaries, per Meta's Messenger Platform policy. */
export const STANDARD_WINDOW_HOURS = 24;
export const HUMAN_AGENT_WINDOW_HOURS = 24 * 7;

/** Default page size for list operations. */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/** Where the append-only write log lives, relative to the repository root. */
export const DEFAULT_AUDIT_LOG_PATH = "logs/audit.jsonl";
