/**
 * Error mapping.
 *
 * The brief's requirement was that errors be actionable, and that is the whole
 * purpose of this file: an expired token returns the regeneration steps, a
 * missing permission names the exact scope and where to grant it, and a rate
 * limit returns the retry-after window. An agent reading one of these messages
 * should know what to do next without going and reading Meta's documentation.
 */

import { GRAPH_API_HOST } from "../constants.js";

/** Shape of the error object Graph API returns in a non-2xx body. */
export interface GraphApiErrorBody {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
  fbtrace_id?: string;
}

/** A Graph API failure, carrying enough context to explain itself. */
export class GraphApiError extends Error {
  readonly httpStatus: number;
  readonly code: number | undefined;
  readonly subcode: number | undefined;
  readonly fbtraceId: string | undefined;
  readonly endpoint: string;
  readonly retryAfterSeconds: number | undefined;
  readonly usage: Record<string, unknown> | undefined;

  constructor(args: {
    httpStatus: number;
    body: GraphApiErrorBody;
    endpoint: string;
    retryAfterSeconds?: number;
    usage?: Record<string, unknown>;
  }) {
    super(args.body.message ?? `Graph API returned HTTP ${args.httpStatus}`);
    this.name = "GraphApiError";
    this.httpStatus = args.httpStatus;
    this.code = args.body.code;
    this.subcode = args.body.error_subcode;
    this.fbtraceId = args.body.fbtrace_id;
    this.endpoint = args.endpoint;
    this.retryAfterSeconds = args.retryAfterSeconds;
    this.usage = args.usage;
  }

  /** True when a retry has any chance of succeeding. */
  get isRetryable(): boolean {
    if (RATE_LIMIT_CODES.has(this.code ?? -1)) return true;
    if (this.httpStatus === 429) return true;
    return this.httpStatus >= 500;
  }
}

/** Raised when a write tool is called without `confirmed: true`. */
export class ConfirmationRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfirmationRequiredError";
  }
}

/** Raised when a DM send is attempted outside a window that permits it. */
export class MessagingWindowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessagingWindowError";
  }
}

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);
const AUTH_CODES = new Set([102, 190, 463, 467]);
const PERMISSION_CODES = new Set([10, 200, 299, 3]);

/**
 * Scope needed for a given operation, so a permission error can name it.
 * Keyed by the tool name rather than the endpoint, because that is what the
 * agent and the operator both recognise.
 */
const SCOPE_BY_TOOL: Record<string, string> = {
  meta_list_pages: "pages_show_list, instagram_basic",
  meta_list_recent_posts: "pages_read_engagement, instagram_basic",
  meta_list_comments: "pages_read_engagement, pages_read_user_content, instagram_manage_comments",
  meta_get_comment_thread: "pages_read_engagement, pages_read_user_content, instagram_manage_comments",
  meta_list_conversations: "pages_messaging, instagram_manage_messages",
  meta_get_conversation: "pages_messaging, instagram_manage_messages",
  meta_get_post_insights: "read_insights, instagram_basic",
  meta_reply_to_comment: "pages_manage_engagement, instagram_manage_comments",
  meta_hide_comment: "pages_manage_engagement, instagram_manage_comments",
  meta_unhide_comment: "pages_manage_engagement, instagram_manage_comments",
  meta_delete_comment: "pages_manage_engagement, instagram_manage_comments",
  meta_send_message: "pages_messaging, instagram_manage_messages",
  meta_mark_conversation_read: "pages_messaging, instagram_manage_messages",
};

const TOKEN_REGENERATION_STEPS = [
  "How to regenerate the token:",
  "  1. Open https://developers.facebook.com/tools/explorer/",
  "  2. Select the Paddock Blade app, then 'Get Token' → 'Get Page Access Token'.",
  "  3. Tick every scope listed in SETUP.md, then generate.",
  "  4. Exchange the short-lived token for a long-lived one:",
  `     ${GRAPH_API_HOST}/{version}/oauth/access_token` +
    "?grant_type=fb_exchange_token&client_id={app-id}&client_secret={app-secret}&fb_exchange_token={short-token}",
  "  5. Put the result in .env as META_ACCESS_TOKEN and restart the server.",
  "  6. Run meta_check_access to confirm it works and see its new expiry.",
  "",
  "SETUP.md section 4 walks through this with screenshots.",
].join("\n");

/**
 * Turn any thrown value into a message an agent can act on.
 *
 * `toolName` lets permission errors name the specific scope that is missing,
 * which is far more useful than Meta's own "(#200) Permissions error".
 */
export function formatError(error: unknown, toolName?: string): string {
  if (error instanceof ConfirmationRequiredError) return error.message;
  if (error instanceof MessagingWindowError) return error.message;

  if (error instanceof GraphApiError) {
    return formatGraphApiError(error, toolName);
  }

  if (error instanceof Error) {
    // Node surfaces DNS failures, refused connections and blocked proxies alike as
    // a bare "fetch failed" with the real cause nested in `cause`. Unwrapping it
    // is the difference between a useless message and a diagnosable one.
    if (error.message === "fetch failed" || error.name === "TypeError") {
      const cause = (error as { cause?: unknown }).cause;
      const detail =
        cause instanceof Error
          ? `${cause.message}${(cause as { code?: string }).code ? ` (${(cause as { code?: string }).code})` : ""}`
          : "no further detail was reported";
      return (
        "Error: could not reach Meta at all — the request failed at the network level, " +
        "before any Graph API response.\n\n" +
        `Underlying cause: ${detail}\n\n` +
        "This is a connectivity problem on this machine, not a problem with the token or the " +
        "request. Check in this order:\n" +
        "  1. Can this machine reach Meta?  curl -sS https://graph.facebook.com/v26.0/\n" +
        "     A JSON error back means connectivity is fine. A hang or a refusal does not.\n" +
        "  2. Is an outbound proxy or firewall blocking graph.facebook.com?\n" +
        "  3. Is DNS resolving?  getent hosts graph.facebook.com\n\n" +
        "Note that dry-run mode (META_DRY_RUN=true) makes no network calls for writes, so the " +
        "review pipeline can still be exercised while this is being fixed."
      );
    }
    if (error.name === "AbortError" || error.message.includes("aborted")) {
      return (
        "Error: the request to Meta timed out. This is usually transient — retry once. " +
        "If it persists, check that this machine can reach graph.facebook.com at all " +
        "(`curl -sS https://graph.facebook.com/v26.0/` should return a JSON error, not hang)."
      );
    }
    return `Error: ${error.message}`;
  }

  return `Error: an unexpected failure occurred: ${String(error)}`;
}

function formatGraphApiError(error: GraphApiError, toolName?: string): string {
  const trace = error.fbtraceId ? `\n\nMeta trace ID: ${error.fbtraceId}` : "";
  const code = error.code ?? "none";

  if (AUTH_CODES.has(error.code ?? -1) || error.httpStatus === 401) {
    const subcodeHint =
      error.subcode === 463
        ? "The token has expired."
        : error.subcode === 467
          ? "The token was invalidated — usually a password change or a revoked session."
          : "The token is expired, malformed, or was revoked.";
    return (
      `Error: authentication failed (Graph API code ${code}). ${subcodeHint}\n\n` +
      `${TOKEN_REGENERATION_STEPS}\n\n` +
      `Meta said: "${error.message}"${trace}`
    );
  }

  if (PERMISSION_CODES.has(error.code ?? -1) || error.httpStatus === 403) {
    const scopes = toolName ? SCOPE_BY_TOOL[toolName] : undefined;
    const scopeLine = scopes
      ? `This tool needs: ${scopes}\n`
      : "Check SETUP.md section 3 for the scope this endpoint needs.\n";
    return (
      `Error: permission denied (Graph API code ${code}).\n\n` +
      scopeLine +
      "\nTo grant it:\n" +
      "  1. Open https://developers.facebook.com/apps/ and select the Paddock Blade app.\n" +
      "  2. Go to App Review → Permissions and Features.\n" +
      "  3. Find the scope named above. If it shows 'Standard Access' and you are an\n" +
      "     admin of both the app and the Page, it should already work — in that case\n" +
      "     the problem is the token, not the scope: regenerate it with the scope ticked.\n" +
      "  4. If it shows that Advanced Access is required, request it there. That needs\n" +
      "     Business Verification and App Review.\n" +
      "  5. Run meta_check_access to see exactly which scopes your token currently holds.\n\n" +
      `Meta said: "${error.message}"${trace}`
    );
  }

  if (RATE_LIMIT_CODES.has(error.code ?? -1) || error.httpStatus === 429) {
    const wait = error.retryAfterSeconds ?? estimateBackoffSeconds(error);
    const usageLine = error.usage
      ? `\nCurrent usage reported by Meta: ${JSON.stringify(error.usage)}`
      : "";
    return (
      `Error: rate limited by Meta (Graph API code ${code}).\n\n` +
      `Retry after: ${wait} seconds (roughly ${Math.ceil(wait / 60)} minute(s)).\n` +
      "The client already retried with exponential backoff and still hit the limit, so\n" +
      "this is a sustained throttle rather than a burst. Reduce the polling frequency in\n" +
      "the runner's cron schedule, or narrow the date range on this call." +
      usageLine +
      `\n\nMeta said: "${error.message}"${trace}`
    );
  }

  if (error.code === 33 || error.httpStatus === 404) {
    return (
      `Error: the object was not found (Graph API code ${code}).\n\n` +
      "Graph API returns this for two different problems and does not distinguish them:\n" +
      "  a) The ID is wrong or the object was deleted.\n" +
      "  b) The ID is correct but your token has no access to it — a Page you do not\n" +
      "     administer, or an Instagram account not linked to a Page in your token.\n\n" +
      "Run meta_list_pages to see exactly which assets this token can reach. If the\n" +
      "object is not in that list, it is (b) and the fix is token scope, not the ID.\n\n" +
      `Endpoint: ${error.endpoint}\nMeta said: "${error.message}"${trace}`
    );
  }

  if (error.code === 100) {
    return (
      `Error: Meta rejected a parameter (Graph API code 100).\n\n` +
      "This usually means a field name is not valid for this object type, or a metric\n" +
      "name has been retired. Meta retires insight metrics regularly — if this came from\n" +
      "meta_get_post_insights, try the default metric set, or drop the metric named below.\n\n" +
      `Endpoint: ${error.endpoint}\nMeta said: "${error.message}"${trace}`
    );
  }

  if (error.httpStatus >= 500) {
    return (
      `Error: Meta returned a server error (HTTP ${error.httpStatus}).\n\n` +
      "This is Meta's problem, not yours. The client already retried with backoff. Wait a\n" +
      "few minutes and try again; if it persists for more than an hour, check\n" +
      "https://metastatus.com/ for a platform incident.\n\n" +
      `Meta said: "${error.message}"${trace}`
    );
  }

  return (
    `Error: Graph API request failed with HTTP ${error.httpStatus} (code ${code}).\n\n` +
    `Endpoint: ${error.endpoint}\nMeta said: "${error.message}"${trace}`
  );
}

/** Meta's documented backoff for app-level throttles when no header is given. */
function estimateBackoffSeconds(error: GraphApiError): number {
  if (error.code === 32 || error.code === 4) return 300;
  if (error.code === 17) return 600;
  return 60;
}
