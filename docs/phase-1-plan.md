# Paddock Blade Social — Phase 1: Research and Plan

Date: 2026-08-17. Status: **awaiting approval before Phase 2.**

---

## 0. Blocker you need to know about first

I could not reach Meta's documentation from this session. Both routes are refused by
the network egress policy, not by a transient failure:

| Attempt | Result |
| --- | --- |
| `developers.facebook.com/docs/graph-api/changelog` | `EGRESS_BLOCKED` by the proxy's domain policy |
| `https://graph.facebook.com/v{23..28}/me` via curl | `CONNECT tunnel failed, response 403` (organisation egress policy) |

The brief says do not rely on training data for the version number, and I have not.
Instead I triangulated from sources I *can* reach, and I have designed the version
out of the code path entirely (below). Everything in sections 1 and 2 is marked with
its evidence quality. **Two of the three things I need from you are in section 7.**

---

## 1. Graph API version

Evidence actually gathered this session:

| Source | Quality | What it says |
| --- | --- | --- |
| `facebook-nodejs-business-sdk` on npm — Meta's own published SDK | **Primary-ish** (Meta-authored, reachable) | Latest is `24.0.1`, published 2025-11-21. Implies v24.0 was current in Nov 2025. |
| Publish history of that same package | **Primary-ish** | v21.0 Oct 2024 → v22.0 Feb 2025 → v23.0 Jun 2025 → v24.0 Oct 2025. A ~4-month cadence. |
| Three independent trade blogs | **Secondary, treat with suspicion** | v25.0 released 18 Feb 2026; v26.0 released 29 Jul 2026. |

The cadence extrapolates to v25.0 in Feb 2026 and v26.0 in Jun–Jul 2026, which is
consistent with the secondary sources. Today is 2026-08-17, so **v26.0 is most likely
current, roughly three weeks old.**

I am not willing to hard-code a number I could not verify against Meta. So:

- `META_GRAPH_API_VERSION` in `.env`, defaulting to `v26.0`. Never a literal in code.
- A `meta_check_access` diagnostic tool (read-only) that calls `/me/permissions` and
  `/debug_token` and reports back the **live** version acceptance, the exact scopes the
  token actually carries, its expiry, and the app/Page IDs it is valid for. That turns
  the version and scope question into something the running system answers, rather than
  something I guess.
- `SETUP.md` will tell you how to check the current version on the changelog page in
  thirty seconds and change one line.

This is the right design regardless of the egress block — Meta deprecates versions on a
rolling ~2-year clock, so this value must be operator-changeable anyway.

## 2. Permission scopes

Confirmed as the correct set for your topology (Facebook Pages with linked Instagram
Business accounts). One correction to the brief's list, and one significant finding.

| Scope | Needed for | Tools that depend on it |
| --- | --- | --- |
| `pages_show_list` | Enumerating the Pages the token can act for | `meta_list_pages` |
| `pages_read_engagement` | Reading posts, comments, Page metadata | `meta_list_recent_posts`, `meta_list_comments`, `meta_get_comment_thread` |
| `pages_manage_engagement` | Replying to, hiding, and deleting Page comments | `meta_reply_to_comment`, `meta_hide_comment`, `meta_unhide_comment`, `meta_delete_comment` |
| `pages_messaging` | Reading and sending Messenger messages | `meta_list_conversations`, `meta_get_conversation`, `meta_send_message` |
| `pages_read_user_content` | Reading user-generated comments on the Page | `meta_list_comments` (needed alongside `pages_read_engagement`) |
| `instagram_basic` | Resolving the IG Business account and its media | `meta_list_pages`, `meta_list_recent_posts` |
| `instagram_manage_comments` | Reading and replying to IG comments, hiding/deleting | IG paths of all comment tools |
| `instagram_manage_messages` | Reading and sending IG DMs | IG paths of the conversation tools |
| `read_insights` | Post-level insights | `meta_get_post_insights` |
| `business_management` | Only if assets are resolved via Business Manager rather than directly | none by default — requested but unused unless needed |

**Correction to the brief:** `pages_read_user_content` is required and was not on your
list; comment reads on a Page fail without it. I have added it. `business_management`
is on your list but is not needed for comment or DM work — it governs Business Manager
asset administration. I will request it but not depend on it, so App Review scope stays
as small as possible.

**Also worth knowing:** there are now *two* Instagram API families with different scope
names. The `instagram_business_*` scopes belong to "Instagram API with Instagram Login",
for Business accounts **not** linked to a Facebook Page. Yours are linked to Pages, so
the `instagram_*` family above is correct. If any of your IG accounts turn out not to be
Page-linked, that account needs the other family and a separate token — tell me and I
will handle both.

### Standard vs Advanced Access — this may save you App Review entirely

Meta's split is: **Standard Access** works for data owned by people who hold a role on
the app (admin, developer, tester). **Advanced Access** is what lets an app act on
assets belonging to the general public, and that is what requires App Review plus
Business Verification.

You are building a single-business internal tool. If you are an admin of the Paddock
Blade app *and* the Pages and IG accounts sit in the same Business portfolio, then
every scope above plausibly works under **Standard Access with no App Review at all.**
Third-party write-ups insist `instagram_manage_comments` and `instagram_manage_messages`
need Advanced — but those are written for agencies serving *clients'* accounts, which is
exactly the case Standard Access excludes. Your case is different.

I have flagged this as **likely but unverified** — I could not open Meta's access-level
docs. The definitive answer is one you can read directly and I cannot: your App
Dashboard → App Review → Permissions and Features lists each scope with its current
level for *your* app. `SETUP.md` will be written to cover both outcomes, and
`meta_check_access` will tell you which scopes you actually hold once a token exists.

Do not start Business Verification or an App Review submission until we have checked
that screen. It may be unnecessary work.

## 3. The 24-hour messaging window

The rule, and what it does to the design:

- A user messaging your Page — or replying to a Story, or triggering a comment-to-DM
  flow, or tapping an Ice Breaker — opens a **24-hour window**. Inside it you may send
  freely. **Each new user reply resets the clock.**
- Outside 24 hours, ordinary sends are refused. The only way through is a message tag.
- The **`HUMAN_AGENT` tag extends the window to 7 days**, on three conditions: sent by a
  real human, not a bot; for support and issue resolution only; never promotional. Meta
  actively detects misuse of this tag.
- Past 7 days there is no organic route. Full stop.

Design consequences, all of which I will build:

1. `meta_list_conversations` and `meta_get_conversation` compute and return
   `hours_since_last_user_message` and a `window_state` of `open` (<24h),
   `human_agent_only` (24h–7d), or `closed` (>7d). You should never have to work this
   out yourself.
2. `meta_send_message` **refuses outright** when `window_state` is `closed`, with an
   error explaining why and what the remaining options are (email, or wait for the
   customer to write again).
3. In `human_agent_only`, the send requires an explicit `messaging_tag: "HUMAN_AGENT"`
   argument. It will not be applied silently.
4. Because v1 sends nothing without you approving it, `HUMAN_AGENT` use here is
   genuinely compliant — a human really is deciding each message. The audit log records
   your approval, which is the evidence trail if Meta ever asks.
5. The digest and review queue sort by time-to-window-close, so the things about to
   become unanswerable rise to the top.

## 4. Repository layout

```
smtr/
├── docs/                  phase plans, research notes, scope decisions
├── meta-mcp-server/       Phase 2 — the MCP server
│   ├── src/
│   │   ├── index.ts               stdio entry point
│   │   ├── http.ts                streamable HTTP entry (stateless JSON)
│   │   ├── server.ts              tool registration, shared by both transports
│   │   ├── constants.ts           CHARACTER_LIMIT, defaults, no secrets
│   │   ├── config.ts              .env loading and validation at startup
│   │   ├── services/
│   │   │   ├── graph-client.ts    auth, rate limiting, exponential backoff, retry-after
│   │   │   ├── errors.ts          actionable error mapping (see below)
│   │   │   ├── audit.ts           append-only JSONL write log
│   │   │   ├── dry-run.ts         intercepts writes, logs intent, calls nothing
│   │   │   └── window.ts          24h/7d messaging-window calculation
│   │   ├── schemas/               Zod input and output schemas per tool
│   │   └── tools/
│   │       ├── pages.ts  posts.ts  comments.ts  conversations.ts  insights.ts
│   │       └── diagnostics.ts     meta_check_access
│   └── evaluations/               Phase 5 — ten read-only eval questions
├── skills/                Phase 3 — six skill directories
├── runner/                Phase 4 — cron runner, approve.ts, queue writer
├── tiktok/                stub + README explaining why (see section 6)
├── .env.example           committed
├── .env                   git-ignored, yours, never read into a commit
└── SETUP.md               Phase 5 — written for a non-developer
```

## 5. MCP server plan

**Stack decision.** The MCP TypeScript SDK has moved to a v2 line:
`@modelcontextprotocol/server` and `@modelcontextprotocol/express`, both `2.0.0`,
on Zod v4. I verified against the installed typings that v2's `registerTool` accepts
`title`, `description`, `inputSchema`, `outputSchema` and `annotations`, and that
`ToolAnnotations` carries all four hints we need. The older `@modelcontextprotocol/sdk`
1.30.0 also works and is what most existing tutorials assume.

**I recommend v2**, because it is the current stable line and this is a system you will
run for years; 1.x is now the legacy branch. Say the word if you would rather I target
1.30.0 for the larger body of examples online.

**Tools.** Sixteen, all `meta_` prefixed, all with full Zod input and output schemas.

| Tool | readOnly | destructive | idempotent |
| --- | --- | --- | --- |
| `meta_check_access` | ✅ | ❌ | ✅ |
| `meta_list_pages` | ✅ | ❌ | ✅ |
| `meta_list_recent_posts` | ✅ | ❌ | ✅ |
| `meta_list_comments` | ✅ | ❌ | ✅ |
| `meta_get_comment_thread` | ✅ | ❌ | ✅ |
| `meta_list_conversations` | ✅ | ❌ | ✅ |
| `meta_get_conversation` | ✅ | ❌ | ✅ |
| `meta_get_post_insights` | ✅ | ❌ | ✅ |
| `meta_reply_to_comment` | ❌ | ❌ | ❌ |
| `meta_hide_comment` | ❌ | ❌ | ✅ |
| `meta_unhide_comment` | ❌ | ❌ | ✅ |
| `meta_delete_comment` | ❌ | **✅** | ✅ |
| `meta_send_message` | ❌ | ❌ | ❌ |
| `meta_mark_conversation_read` | ❌ | ❌ | ✅ |

`meta_delete_comment` is the only genuinely destructive one — a deleted comment is
unrecoverable. Hiding is reversible, which is why `destructiveHint` is false there and
why `comment-triage` will always prefer hide over delete.

**The `confirmed` interlock.** Every write tool takes `confirmed: boolean`. When false
or absent, the tool returns an error that states what *would* have happened — target ID,
resolved author, full message text — and instructs the caller to re-invoke with
`confirmed: true`. It is a real gate: the API client is never reached. Combined with
dry-run mode, that is two independent barriers between the agent and your customers.

**Actionable errors**, mapped from Graph API error codes:

| Condition | What the error says |
| --- | --- |
| Code 190, expired/invalid token | The exact regeneration steps, and which `.env` key to update |
| Code 200/10, missing permission | Names the specific scope, and the App Dashboard path to grant it |
| Code 4/17/32, rate limited | Parses `X-App-Usage` / `X-Business-Use-Case-Usage`, returns the retry-after window |
| Code 33, object not found | Distinguishes "wrong ID" from "token lacks access to this asset" |
| Messaging window closed | Hours since last user message, and the remaining options |

**Audit log.** Every write appends one JSON line to `logs/audit.jsonl`: ISO timestamp,
tool name, target ID, full payload, result or error, dry-run flag, and the approval
reference from the runner. Opened `O_APPEND`, never rewritten, never truncated.

## 6. TikTok — out of scope, confirmed

I checked rather than taking it on faith. TikTok exposes no public API for reading,
hiding, deleting or replying to organic comments; the only comment-related API control
is `allow_comment` at post creation. Read-only comment access exists in the Research
API, restricted to approved academic researchers. `tiktok/README.md` will record this
with the date checked, so nobody re-litigates it in six months. DMs via the Business
Messaging API stay a Phase 5 stretch goal, untouched.

## 7. What I need from you

**Blocking — I cannot finish Phase 4 without this:**

1. **Escalation destination.** Email address or Slack webhook URL. This changes the
   code, so I am asking before I write it. I will ask this as a question alongside
   this plan.

**Needed before Phase 5 verification, not before Phase 2:**

2. **Page IDs and linked IG Business account IDs.** Put them in `.env` as
   `PB_PAGE_IDS` and `PB_IG_ACCOUNT_IDS`, comma-separated, once I have committed
   `.env.example`. If you would rather paste them in chat that is fine too — they are
   not secrets.
3. **App ID, App Secret, long-lived token.** **Do not paste these in chat.** Put them
   in `.env` yourself; `.env` is git-ignored from the first commit. I never need to see
   their values — `meta_check_access` will validate them for you, and I will not make a
   live write of any kind without asking you first.

**Two forks I would like a ruling on:**

4. **SDK line** — v2 (my recommendation) or 1.30.0. Section 5.
5. **Egress** — if you can allow `developers.facebook.com` and `graph.facebook.com` for
   this environment, I will verify the version and scopes against Meta directly and
   correct sections 1 and 2. Otherwise we proceed on the provisional default, which is
   safe because the version is configuration.

## 8. Phase gates

| Phase | Deliverable | Gate |
| --- | --- | --- |
| 1 | This document | **You are here** |
| 2 | MCP server, building, typechecking, verified under MCP Inspector | Your approval |
| 3 | Six skills, `TODO(jake):` wherever I lack a business fact | Your approval |
| 4 | Cron runner, review queue, `approve.ts`, whitelist shipped empty and disabled | Your approval |
| 5 | Ten evals, `SETUP.md`, dry-run proof of the full pipeline | Your approval |

Nothing sends in v1. The whitelist ships empty *and* disabled, needing two separate
changes to activate, and `SETUP.md` will document how — and the risk — without me
enabling any part of it.

## 9. Standing constraints I am working under

- British English throughout documentation and code comments.
- No live API write, publish or delete without your explicit approval in-session.
- No secrets in code or commits; `.env.example` committed, `.env` git-ignored.
- No invented product facts. Where `pb-product-facts` needs a spec, price, warranty
  term or shipping time I do not have, it gets a `TODO(jake):` marker, never a guess.
- I will not report a phase complete unless I have built it and checked it.
