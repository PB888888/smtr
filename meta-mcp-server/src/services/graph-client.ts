/**
 * Graph API client.
 *
 * Responsibilities kept deliberately in one place so no tool has to think about
 * them: authentication, `appsecret_proof` signing, client-side throttling,
 * exponential backoff with jitter, parsing Meta's usage headers, and turning
 * failures into `GraphApiError` for `errors.ts` to explain.
 */

import { createHmac } from "node:crypto";
import {
  BASE_BACKOFF_MS,
  GRAPH_API_HOST,
  MAX_BACKOFF_MS,
  MAX_RETRIES,
  MIN_REQUEST_INTERVAL_MS,
  REQUEST_TIMEOUT_MS,
} from "../constants.js";
import { getConfig } from "../config.js";
import { GraphApiError, type GraphApiErrorBody } from "./errors.js";

export type HttpMethod = "GET" | "POST" | "DELETE";

export interface GraphRequest {
  /** Path without the version prefix or leading slash, e.g. `me/accounts`. */
  path: string;
  method?: HttpMethod;
  /** Query string parameters. `undefined` values are dropped. */
  query?: Record<string, string | number | boolean | undefined>;
  /** POST body, form-encoded as Graph API expects. */
  body?: Record<string, string | number | boolean | undefined>;
  /**
   * Token override. Page-scoped endpoints need the Page's own token, which
   * `me/accounts` hands back — see `resolvePageToken`.
   */
  accessToken?: string;
}

/** A Graph API cursor-paginated envelope. */
export interface GraphPage<T> {
  data: T[];
  paging?: {
    cursors?: { before?: string; after?: string };
    next?: string;
    previous?: string;
  };
}

/** Serialised rate-limit state from Meta's usage headers. */
export interface UsageSnapshot {
  appUsage?: unknown;
  businessUseCaseUsage?: unknown;
  adAccountUsage?: unknown;
}

let lastRequestAt = 0;

/** Politeness floor between calls so we never burst into a penalty. */
async function throttle(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await sleep(MIN_REQUEST_INTERVAL_MS - elapsed);
  }
  lastRequestAt = Date.now();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Full jitter, so concurrent callers do not retry in lockstep. */
function backoffDelay(attempt: number): number {
  const ceiling = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  return Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
}

/**
 * Sign the token with the app secret.
 *
 * Meta recommends this on server-to-server calls: it proves the caller holds
 * the app secret, so a stolen token alone cannot be replayed. Skipped silently
 * when no secret is configured, since it is optional.
 */
function appSecretProof(token: string, appSecret: string | undefined): string | undefined {
  if (!appSecret) return undefined;
  return createHmac("sha256", appSecret).update(token).digest("hex");
}

function parseUsage(headers: Headers): UsageSnapshot | undefined {
  const read = (name: string): unknown => {
    const raw = headers.get(name);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  };
  const snapshot: UsageSnapshot = {
    appUsage: read("x-app-usage"),
    businessUseCaseUsage: read("x-business-use-case-usage"),
    adAccountUsage: read("x-ad-account-usage"),
  };
  return snapshot.appUsage || snapshot.businessUseCaseUsage || snapshot.adAccountUsage
    ? snapshot
    : undefined;
}

/**
 * Perform one Graph API call, retrying transient failures.
 *
 * Retries cover 5xx, 429, and Meta's rate-limit codes. Everything else fails
 * fast — retrying a permission error just wastes the quota.
 */
export async function graphRequest<T>(request: GraphRequest): Promise<T> {
  const cfg = getConfig();
  const token = request.accessToken ?? cfg.accessToken;
  const method = request.method ?? "GET";

  const url = new URL(`${GRAPH_API_HOST}/${cfg.graphApiVersion}/${request.path}`);
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const proof = appSecretProof(token, cfg.appSecret);
  if (proof) url.searchParams.set("appsecret_proof", proof);

  // The token travels in the Authorization header rather than the query string
  // so it stays out of any intermediate proxy's access log.
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };

  let requestBody: string | undefined;
  if (method === "POST" && request.body) {
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(request.body)) {
      if (value !== undefined) form.set(key, String(value));
    }
    requestBody = form.toString();
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }

  let lastError: GraphApiError | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    await throttle();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: requestBody,
        signal: controller.signal,
      });

      const text = await response.text();
      const parsed: unknown = text ? safeJsonParse(text) : {};

      if (response.ok) {
        return parsed as T;
      }

      const retryAfterHeader = response.headers.get("retry-after");
      const errorBody: GraphApiErrorBody =
        isRecord(parsed) && isRecord(parsed.error)
          ? (parsed.error as GraphApiErrorBody)
          : { message: text.slice(0, 500) || `HTTP ${response.status}` };

      lastError = new GraphApiError({
        httpStatus: response.status,
        body: errorBody,
        endpoint: `${method} ${request.path}`,
        ...(retryAfterHeader ? { retryAfterSeconds: Number(retryAfterHeader) } : {}),
        ...(parseUsage(response.headers)
          ? { usage: parseUsage(response.headers) as Record<string, unknown> }
          : {}),
      });

      if (!lastError.isRetryable || attempt === MAX_RETRIES) throw lastError;

      // Honour Meta's own retry-after when it gives one, but never sleep past
      // our ceiling — a multi-hour header should surface as an error, not a hang.
      const headerDelay = lastError.retryAfterSeconds
        ? Math.min(lastError.retryAfterSeconds * 1000, MAX_BACKOFF_MS)
        : 0;
      await sleep(Math.max(headerDelay, backoffDelay(attempt)));
    } catch (error) {
      if (error instanceof GraphApiError) {
        if (!error.isRetryable || attempt === MAX_RETRIES) throw error;
        lastError = error;
        await sleep(backoffDelay(attempt));
        continue;
      }
      // Network-level failure or timeout. Retry, since both are often transient.
      if (attempt === MAX_RETRIES) throw error;
      await sleep(backoffDelay(attempt));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error("Graph API request failed after exhausting retries");
}

/** Walk cursor pagination until `limit` items are collected or pages run out. */
export async function graphRequestAll<T>(
  request: GraphRequest,
  limit: number,
): Promise<{ items: T[]; nextCursor?: string; hasMore: boolean }> {
  const items: T[] = [];
  let after: string | undefined = request.query?.after as string | undefined;

  while (items.length < limit) {
    const remaining = limit - items.length;
    const page = await graphRequest<GraphPage<T>>({
      ...request,
      query: {
        ...request.query,
        limit: Math.min(remaining, 100),
        ...(after ? { after } : {}),
      },
    });

    const batch = page.data ?? [];
    items.push(...batch);

    const nextCursor = page.paging?.cursors?.after;
    // Meta omits `next` on the final page even when a cursor is present, so the
    // presence of `next` is the reliable signal, not the cursor.
    if (!page.paging?.next || !nextCursor || batch.length === 0) {
      return { items: items.slice(0, limit), hasMore: false };
    }
    after = nextCursor;
  }

  return {
    items: items.slice(0, limit),
    hasMore: true,
    ...(after ? { nextCursor: after } : {}),
  };
}

/**
 * Look up the Page-scoped token for a Page ID.
 *
 * Page endpoints — comments, messages, insights — require the Page's own token
 * rather than the user token. Cached for the process lifetime because it does
 * not change between calls and every write would otherwise pay for a lookup.
 */
const pageTokenCache = new Map<string, string>();

export async function resolvePageToken(pageId: string): Promise<string> {
  const config = getConfig();

  // In dry-run, make no network call at all — not even this read. Dry-run's whole
  // promise is that the pipeline can be exercised without touching Meta, and a
  // token lookup here would break that (and fail outright on a machine with no
  // egress to graph.facebook.com). The returned value is never used to send
  // anything, because the write itself is skipped.
  if (config.dryRun) return config.accessToken;

  const cached = pageTokenCache.get(pageId);
  if (cached) return cached;

  const response = await graphRequest<GraphPage<{ id: string; access_token?: string }>>({
    path: "me/accounts",
    query: { fields: "id,access_token" },
  });

  for (const page of response.data ?? []) {
    if (page.access_token) pageTokenCache.set(page.id, page.access_token);
  }

  const token = pageTokenCache.get(pageId);
  if (token) return token;

  // Falling back to the configured token is correct when META_ACCESS_TOKEN is
  // itself already a Page token, which is the common single-Page setup.
  return getConfig().accessToken;
}

/** Clear the Page token cache. Tests and token rotation only. */
export function clearPageTokenCache(): void {
  pageTokenCache.clear();
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
