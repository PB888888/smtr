/**
 * Append-only audit log.
 *
 * Every write operation lands here as one JSON line before and after it happens.
 * The file is only ever appended to — never rewritten, never truncated — because
 * its value is as evidence. If Meta ever queries how a message came to be sent,
 * this is the record showing a human approved it.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { getConfig } from "../config.js";

export interface AuditEntry {
  /** ISO 8601, UTC. */
  timestamp: string;
  /** Tool that performed the write, e.g. `meta_reply_to_comment`. */
  tool: string;
  /** The object acted upon — comment ID, conversation ID, recipient ID. */
  target_id: string;
  /** Full payload as sent, or as it would have been sent in dry-run. */
  payload: Record<string, unknown>;
  /** `attempted` is written before the call, then `succeeded` or `failed` after. */
  outcome: "attempted" | "succeeded" | "failed" | "dry_run";
  /** Graph API response on success, or the formatted error on failure. */
  result?: unknown;
  /** True when no API call was made. */
  dry_run: boolean;
  /**
   * Where the approval came from — the runner writes its queue reference here so
   * a sent reply can be traced back to the queue item the operator approved.
   */
  approval_ref?: string;
}

/**
 * Absolute path of the audit log.
 *
 * Exported so startup can report it: a relative path resolves against the
 * working directory, which differs between an interactive shell and a cron job,
 * and "where did my audit log go" is not a question anyone should have to debug.
 */
export function auditPath(): string {
  const configured = getConfig().auditLogPath;
  return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
}

/**
 * Append one entry.
 *
 * Deliberately synchronous: an audit record that loses a race with the process
 * exiting is worse than a few milliseconds of blocking. Failures to write are
 * reported on stderr and swallowed — losing the log must not abort a write the
 * operator already approved, but it must not happen silently either.
 */
export function appendAudit(entry: AuditEntry): void {
  try {
    const path = auditPath();
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(entry)}\n`, { encoding: "utf8", flag: "a" });
  } catch (error) {
    process.stderr.write(
      `[audit] FAILED to write audit entry for ${entry.tool} on ${entry.target_id}: ` +
        `${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

/** Build an entry with the timestamp and dry-run flag filled in. */
export function auditEntry(
  fields: Omit<AuditEntry, "timestamp" | "dry_run">,
): AuditEntry {
  return {
    timestamp: new Date().toISOString(),
    dry_run: getConfig().dryRun,
    ...fields,
  };
}

/**
 * Record a write, run it, and record how it ended.
 *
 * Wrapping the call rather than logging at the call sites means a tool cannot
 * forget to write its audit record — the only way to perform a write is through
 * here. In dry-run the operation is logged and skipped entirely.
 */
export async function withAudit<T>(
  args: {
    tool: string;
    targetId: string;
    payload: Record<string, unknown>;
    approvalRef?: string;
  },
  operation: () => Promise<T>,
): Promise<{ result: T | null; dryRun: boolean }> {
  const dryRun = getConfig().dryRun;

  if (dryRun) {
    appendAudit(
      auditEntry({
        tool: args.tool,
        target_id: args.targetId,
        payload: args.payload,
        outcome: "dry_run",
        ...(args.approvalRef ? { approval_ref: args.approvalRef } : {}),
      }),
    );
    return { result: null, dryRun: true };
  }

  appendAudit(
    auditEntry({
      tool: args.tool,
      target_id: args.targetId,
      payload: args.payload,
      outcome: "attempted",
      ...(args.approvalRef ? { approval_ref: args.approvalRef } : {}),
    }),
  );

  try {
    const result = await operation();
    appendAudit(
      auditEntry({
        tool: args.tool,
        target_id: args.targetId,
        payload: args.payload,
        outcome: "succeeded",
        result,
        ...(args.approvalRef ? { approval_ref: args.approvalRef } : {}),
      }),
    );
    return { result, dryRun: false };
  } catch (error) {
    appendAudit(
      auditEntry({
        tool: args.tool,
        target_id: args.targetId,
        payload: args.payload,
        outcome: "failed",
        result: error instanceof Error ? error.message : String(error),
        ...(args.approvalRef ? { approval_ref: args.approvalRef } : {}),
      }),
    );
    throw error;
  }
}
