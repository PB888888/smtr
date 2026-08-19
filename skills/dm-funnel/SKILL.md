---
name: dm-funnel
description: Process unread Facebook Messenger, Instagram Direct, website chat and Shopify Inbox threads for Paddock Blade into a numbered approval queue that Jake can action with a single message like "1, 3, 5 yes". Use whenever working through any Paddock Blade conversational inbox, triaging unread messages, building the daily DM review queue, or when asked what is waiting in DMs. Handles Meta's 24-hour messaging window (which applies to Messenger and Instagram only) and orders the queue so threads about to become unanswerable come first. Always checked against escalation-rules before anything is drafted.
---

# DM funnel

Direct messages differ from comments in two ways that shape everything here.
They are private, so the cost of a clumsy reply is lower but the expectation of a
real answer is higher. And they **expire**: Meta only permits a reply within 24
hours of the customer's last message, extended to 7 days with the `HUMAN_AGENT`
tag, and after that there is no organic route at all.

That second point is why this queue is ordered by time remaining rather than by
recency. A thread with two hours left matters more than one that arrived this
morning with a full day on the clock.

## Procedure

For each unread thread:

1. **Fetch the history** with `meta_get_conversation`. The `window` field it
   returns is authoritative — read it rather than working out the arithmetic
   yourself. It reports `open`, `human_agent_only`, `closed` or `unknown`.
2. **Check `escalation-rules`.** DMs match it more often than comments do, because
   people raise orders, refunds and faults in private. Order queries especially.
3. **Summarise** the thread in one or two sentences: what they want, and anything
   already promised to them.
4. **Classify**, using the same six categories as `comment-triage`.
5. **Draft a reply**, grounded in `pb-product-facts` and in the register
   `pb-brand-voice` sets for their market. Where the market is not obvious, say so
   rather than assuming — a name gives no reliable signal, and neither does the
   platform.
6. **Write a one-line recommendation** for Jake: what you think should happen and
   why, in one sentence he can agree with at a glance.

## Queue format

Order by urgency: closing soonest first, then closed threads, then everything
else. Number sequentially from 1 so Jake can reply "1, 3, 5 yes".

```
## DM queue — [date] · [n] threads, [n] need a decision

[1] ⏰ CLOSING (2.1h left) · Instagram · @stablesatmoss
    Summary: Asked on Tuesday whether the blade suits a 3-acre paddock with
             two horses; nudged again today.
    Category: product question
    Window: open, 2.1h remaining
    Recipient ID: 178294...
    Draft:
      "[the reply]"
    Grounding: pb-product-facts › coverage per pass; pb-product-facts › UK
    → Recommendation: send as drafted, it is a straight spec answer.

[2] 🔴 ESCALATE — rule 4: order-specific · Messenger · Claire H.
    Summary: Ordered nine days ago, no tracking, asking where it is.
    Category: complaint (order)
    Window: human_agent_only, 62h remaining — HUMAN_AGENT tag required
    Recipient ID: 992841...
    Draft: acknowledgement only —
      "[the holding reply]"
    → Recommendation: you need the order system for this; I cannot see it.
      Worth answering today while the tag still works.
```

Close with a summary: how many can be sent as drafted, how many need Jake's input,
how many have closed windows and need another channel.

## Approving

Jake replies in plain language and you act on it:

- `1, 3, 5 yes` → send items 1, 3 and 5 exactly as drafted.
- `all yes except 2` → send everything but item 2.
- `1 yes, 4 with changes: ...` → send 1 as drafted; revise 4 as instructed and
  show it back before sending.
- `2 no` → do not send; leave it in the queue.

When sending, call `meta_send_message` with `confirmed: true`, and pass
`approval_ref` as `[date]-dm#[n]` — for example `2026-08-17-dm#3`. That reference
lands in the audit log, so a sent message can always be traced back to the
approval that authorised it. That trail is the evidence that a human decided, which
is what makes `HUMAN_AGENT` use legitimate.

**An approval covers only the draft as shown.** If you have changed a word since
Jake read it, show it again. If the customer has sent a new message in the
meantime, the situation has changed and the approval no longer applies — re-queue
it. Silently re-using an approval for different text is the one thing that would
make this whole queue untrustworthy.

## The messaging window in practice

| State | What it means | What to do |
| --- | --- | --- |
| `open` | Under 24h since they last wrote | Reply normally, no tag. |
| `human_agent_only` | 24h–7d | `messaging_tag: "HUMAN_AGENT"` is required. Only legitimate because Jake personally approved it, it resolves a support issue, and it is not promotional. |
| `closed` | Over 7d | No reply is possible. Say so, and suggest email if an address is known. |
| `unknown` | No inbound message found | Fetch the thread properly. Never guess — `meta_send_message` will refuse, correctly. |

Two things worth internalising. **Every new message from the customer resets the
clock to a fresh 24 hours**, so a thread you saw as urgent yesterday may be
comfortable today. And `HUMAN_AGENT` is not a workaround — Meta detects misuse, and
using it on promotional content or on a bot-composed message risks the Page's
messaging access. It exists for exactly the case this queue creates: a real person
deciding, a little late.

## Only Meta channels have a window

The 24-hour and 7-day rules are **Meta platform policy**, and they apply to
Facebook Messenger and Instagram Direct only. **Website chat and Shopify Inbox have
no such constraint** — you can reply whenever, and there is no tag to apply.

Worth stating plainly because the mistake runs in both directions. Do not apply
`HUMAN_AGENT` reasoning to a Shopify Inbox thread, where it is meaningless. And do
not assume a website chat that has gone quiet for three days is closed — it is not.

Set `window: n/a` for non-Meta threads and sort them by age, since that is all the
urgency signal available. They still belong in the same queue: the customer does not
care which pipe their question came down, and splitting the queue by channel just
means two things to check.

## Do not open conversations

Meta does not permit a business to message someone who has not messaged first, and
there is no tag that changes this. If a thread has no inbound message, there is
nothing to reply to. `window: unknown` on a thread with no customer message means
exactly this, and the answer is not to find a way around it.
