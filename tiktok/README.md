# TikTok — deliberately not implemented

**Status: out of scope. Do not implement comment moderation here.**
Checked 2026-08-17.

## Why this directory is empty

TikTok exposes **no public API for organic comment moderation**. There is no
endpoint to read, reply to, hide, or delete comments on your own posts. This is
categorically different from Facebook, Instagram and YouTube, all of which provide
full comment management APIs.

What TikTok does offer, and why none of it helps:

| Capability | Verdict |
| --- | --- |
| `allow_comment` at post creation | The only comment-related API control. On or off for the whole post; no per-comment action. |
| Research API comment read | Read-only, and restricted to approved academic researchers. Not available to a business for its own account. |
| Display API | Profile and video metadata only. No comments. |
| Business Messaging API | Direct messages only, not comments. See below. |

So the moderation options for TikTok remain:

1. **Manual**, in the app: Settings → Privacy → Comments. Keyword filters (up to
   200 words) and spam filtering are genuinely useful and worth configuring once.
2. **Third-party aggregators** (Sprinklr, Phyllo and similar) that reach comments
   by means other than a public organic API. Each is a paid dependency and a data
   processor with access to customer conversations — a decision with commercial and
   GDPR consequences, not a technical shortcut.

## If you are tempted to revisit this

Re-check before writing any code, because the answer is a fact about TikTok's
platform rather than about this codebase. Two things would have to change:

- TikTok publishing an organic comment management API for business accounts, and
- that API covering read, reply and hide, not just read.

Until both hold, anything built here would be scraping or an unofficial endpoint.
That means logging in as a user outside the terms of service, with account
suspension as the realistic downside. It is not worth it for comment triage.

## TikTok DMs — a Phase 5 stretch goal only

The Business Messaging API does cover direct messages, and that is a genuinely
separate question from comments. It is explicitly deferred: not in v1, not
started, and not to be picked up without asking Jake first. It carries its own
app review, its own permission model and its own messaging window rules, none of
which are shared with Meta's.

## Verified

The claim above was checked against current sources on 2026-08-17 rather than
assumed from prior knowledge. If you are reading this more than six months later,
re-check before relying on it.
