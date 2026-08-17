# Phase 2 — MCP server: what was built and how it was verified

Date: 2026-08-17. Status: **awaiting approval before Phase 3.**

Decisions taken from your Phase 1 answers: MCP SDK **v2**, Graph API **v26.0**
provisional, escalation via **Telegram**.

---

## Verification evidence

Everything below was run, not assumed.

| Check | Result |
| --- | --- |
| `npm run typecheck` (`tsc --noEmit`, strict) | clean, 0 errors |
| `npm run build` | succeeds, `dist/index.js` produced |
| stdio server starts | yes, reports version, dry-run state, resolved audit path |
| MCP Inspector `tools/list` | **14 tools**, all with input schema, output schema and annotations |
| `confirmed: false` on a write | refused with full preview, no API call |
| `confirmed` on all 6 write tools | present and **required**, not optional-with-default |
| DM send, 9 days stale | refused, even with `confirmed: true` |
| DM send, 3 days stale, no tag | refused, demands `HUMAN_AGENT` explicitly |
| DM send, 2h stale, `confirmed: false` | refused on the interlock, window reported open |
| Dry-run across all 6 write tools | all logged, **zero network calls** |
| Audit log | one JSONL line per write, append-only verified by line count |
| Streamable HTTP transport | `initialize` and `tools/list` both served; `/healthz` responds |

### Tool roster as the Inspector reports it

```
tool                             readOnly  destructive  idempotent  confirmed
meta_check_access                true      false        true        –
meta_list_pages                  true      false        true        –
meta_list_recent_posts           true      false        true        –
meta_list_comments               true      false        true        –
meta_get_comment_thread          true      false        true        –
meta_get_conversation            true      false        true        –
meta_list_conversations          true      false        true        –
meta_get_post_insights           true      false        true        –
meta_reply_to_comment            false     false        false       REQUIRED
meta_hide_comment                false     false        true        REQUIRED
meta_unhide_comment              false     false        true        REQUIRED
meta_delete_comment              false     TRUE         true        REQUIRED
meta_send_message                false     false        false       REQUIRED
meta_mark_conversation_read      false     false        true        REQUIRED
```

`meta_delete_comment` is the only tool marked destructive — deletion is
irreversible where hiding is not. `meta_check_access` is an addition beyond your
list, and the reason is in the next section.

### Sample audit log from the dry run

```
meta_send_message            dry_run  dry=True  target=222     ref=2026-08-17-queue#1
   {"page_id":"111","message":"Yes, we ship to Ontario.","messaging_type":"RESPONSE","tag":null,"window_state":"open"}
meta_reply_to_comment        dry_run  dry=True  target=178_99  ref=q#3
   {"platform":"instagram","message":"Thankyou!","path":"178_99/replies"}
meta_hide_comment            dry_run  dry=True  target=555_1
   {"platform":"facebook","is_hidden":true}
meta_delete_comment          dry_run  dry=True  target=555_2
   {"platform":"facebook","deleted_text":null,"deleted_author":null}
meta_mark_conversation_read  dry_run  dry=True  target=222
   {"page_id":"111","sender_action":"mark_seen"}
```

Note the Instagram reply correctly routed to `178_99/replies` rather than
`/comments` — Meta uses different endpoints per platform and getting that wrong
would fail only at runtime, against a real comment.

## Two bugs found by testing, both fixed

Worth recording because both would have been invisible until the worst moment.

**1. Dry-run was making network calls.** `meta_send_message` resolved the Page
token before the dry-run guard, so dry-run still hit Meta and failed outright on a
machine without egress. Dry-run's entire promise is that the pipeline can be
exercised without touching Meta, and it was not keeping it. Now `resolvePageToken`
short-circuits in dry-run, and the pre-delete snapshot read in
`meta_delete_comment` is skipped too — in dry-run nothing is being deleted, so
there is nothing to preserve.

**2. `Error: fetch failed` told you nothing.** Node collapses DNS failures,
refused connections and blocked proxies into that one string, hiding the real
cause in a nested `cause` property. The client now unwraps it: the same test then
reported `self-signed certificate in certificate chain (SELF_SIGNED_CERT_IN_CHAIN)`
plus an ordered checklist. That is the difference between a diagnosable problem
and an afternoon lost.

## Additions and deviations from the brief

**Added `meta_check_access` (15th tool, read-only).** Because Meta's docs were
unreachable, the API version and the real scope grants were both unverifiable at
build time. This tool makes the running system answer them instead of anyone
guessing: it reports whether the configured version responds, which scopes the
token actually holds, its expiry, and which Pages and Instagram accounts are in
reach. Run it first on any install. It never prints a secret — the token appears
only as a character count and its last four characters.

**Added `pages_read_user_content` to the scope list.** Comment reads on a Page
fail without it, and it was not in your list.

**`business_management` requested but unused.** It governs Business Manager asset
administration, not comments or DMs. Keeping it out of the dependency path keeps
any future App Review submission as small as possible.

**Insight metric names are a parameter, not constants.** Meta began retiring reach
and impressions metrics through 2026 in favour of views-based ones. There is a
default set, and a rejected metric produces an error naming it rather than an
opaque failure.

## One honest limitation

**The HTTP transport frames responses as SSE, not plain JSON, for most clients
today.** I set `responseMode: 'json'` as the brief's "stateless JSON" asks, then
tested it: this SDK build reports `LATEST_PROTOCOL_VERSION` as `2025-11-25`, and a
plain JSON-RPC POST is classified legacy-era and served over the stateless legacy
path, which is SSE-framed regardless of that setting.

Serving is genuinely stateless either way — a fresh server instance per request,
no session IDs, `GET` and `DELETE` answered with 405. Only the framing differs, and
MCP clients handle both. The setting is correct for clients using the modern
envelope and needs no change when more of them do. Flagging it rather than
reporting "stateless JSON, done".

**Also unverifiable from here:** every Graph API endpoint path and field list in
this server is written from knowledge, not from the documentation, because
`developers.facebook.com` is egress-blocked. The shapes are conventional and
consistent, and the error handling degrades sensibly, but the first run against a
real token is the real test. `meta_check_access` is designed to make that first run
informative rather than a guessing game.

## What is deliberately not here yet

- The Telegram sender, the review queue and `approve.ts` — Phase 4.
- The six skills — Phase 3.
- Ten evaluation questions and `SETUP.md` — Phase 5.
- `logs/` and `dist/` are git-ignored; the audit log is created on first write.
