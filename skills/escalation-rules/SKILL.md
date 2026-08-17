---
name: escalation-rules
description: The never-auto-reply list for Paddock Blade social media. Consult this BEFORE drafting or sending any reply to any comment or direct message on Facebook or Instagram, and treat its verdict as final — it overrides comment-triage, dm-funnel, pb-brand-voice and any auto-send whitelist. Use whenever a customer message touches pricing negotiation, discounts, refunds, returns, a specific order, horse injury or safety, legal or regulatory matters, competitor comparisons, or press and partnership enquiries. Also use when you are unsure whether something is escalation-worthy, because uncertainty is itself a trigger.
---

# Escalation rules

This skill has authority over every other skill in this system. If it says stop,
you stop — even when `comment-triage` has classified the message, even when
`pb-brand-voice` has a perfect phrasing ready, even when the category appears on
the auto-send whitelist.

The reason for that precedence is asymmetry of harm. A reply that arrives an hour
late costs a little goodwill. A reply that concedes a refund Jake would not have
given, or reassures someone about a horse's safety and turns out to be wrong,
costs money, trust, or an animal's wellbeing — and it is public, permanent, and
quotable. When those two risks are in tension, latency is always the cheaper one.

## The never-auto-reply list

If a message matches any of these, **output the draft to Jake and stop.** Do not
call `meta_reply_to_comment` or `meta_send_message`, with or without
`confirmed: true`.

| # | Trigger | Why it is on the list |
| --- | --- | --- |
| 1 | **Pricing negotiation** — haggling, "best price?", bulk or trade rates, price matching | A price conceded in public becomes the price everyone expects. Only Jake sets it. |
| 2 | **Discounts and codes** — asking for one, claiming an expired one, asking why one failed | Same as above, plus a discount honoured in error is hard to withdraw. |
| 3 | **Refunds, returns and cancellations** | These have legal consequences that vary by market. See rule 7. |
| 4 | **Order-specific queries** — "where is my order", tracking, wrong or damaged item, delivery dates for a placed order | Answering needs order-system access this agent does not have. Any answer is a guess dressed as fact. |
| 5 | **Horse injury or safety** — any suggestion a product hurt or could hurt an animal, or a question about whether something is safe around horses | The most serious category here. A reassurance that proves wrong is both a welfare harm and an admission. Never reassure, never speculate, never deny. |
| 6 | **Legal or regulatory** — solicitors, small claims, trading standards, consumer rights, liability, GDPR or data requests, insurance | Anything that could be read as an admission or a waiver. |
| 7 | **Consumer-law claims across markets** — statutory rights, warranty entitlements, cooling-off periods | UK, EU, US, Canadian and Australian consumer law differ substantially. A statement correct in one market can be wrong in another. |
| 8 | **Competitor comparisons** — "is this better than X", or a competitor named at all | Comparative claims carry advertising-standards risk, and a careless one is a gift to a competitor. |
| 9 | **Press, partnership, sponsorship, affiliate and influencer enquiries** | Commercial decisions with long tails. Jake's call, always. |
| 10 | **Ambiguity you cannot resolve** | If you are unsure which rule applies, or unsure what the customer is actually asking, that uncertainty *is* the trigger. |

## How to recognise a match

Match on **substance, not vocabulary**. People rarely use the words above.

- "Any chance of a deal if I take two?" → rule 1, no word resembling "negotiation".
- "My mare caught her leg on it, is that normal?" → rule 5. The word "injury"
  never appears, and "is that normal" is bait for a reassuring answer.
- "Bought one last Tuesday, still nothing" → rule 4.
- "My friend said the [competitor] one is sturdier" → rule 8.

Test each message with: *if my answer were wrong, who bears the cost, and can I
take it back?* If the answer is "the customer or the horse" and "no, it is
public", escalate.

A message can match several rules; escalate on the most serious. A message can
also mix an innocuous question with an escalating one — "Great bit of kit, what's
the widest one and can you do anything on price?" contains a product question and
rule 1. **The escalating part governs the whole message.** Never split a reply so
the safe half goes out publicly and the risky half waits; the customer sees a
partial answer and reads the silence as evasion.

## What to do instead

Escalating is not a dead end — it is a handover. Produce this:

```
ESCALATE — rule [#]: [trigger name]
Platform: [Facebook | Instagram] · [comment | DM]
From: [author name or username]
Link/ID: [permalink, or the comment/conversation ID]
Window: [for DMs: open / human_agent_only / closed, and hours remaining]

What they said:
> [verbatim, no tidying]

Why this escalates:
[One or two sentences. Name the rule and the specific risk.]

Suggested reply, for Jake to approve, edit or bin:
[A draft. Write it anyway — see below.]

What I would need to answer this myself:
[The missing fact, access, or decision. Be specific.]
```

**Draft a suggested reply even though you are not sending it.** Jake approving or
lightly editing a draft is far faster than writing from scratch, and the draft
shows your reasoning. The exception is rule 5, horse injury or safety: draft only
an acknowledgement that commits to nothing and promises a direct follow-up. Never
draft an explanation of what happened or why, because you do not know.

## The DM timing wrinkle

Escalation and Meta's messaging window interact awkwardly. A DM you escalate has a
reply window that keeps shrinking, and past 7 days it closes permanently.

So when escalating a DM, always state the window state and hours remaining, and
sort escalations so the ones closing soonest are at the top of Jake's queue. If a
thread is inside 6 hours of closing, mark it **⏰ CLOSING** in the header. If it
has already closed, say so plainly and note that the reply will have to go by
another channel — that changes what Jake needs to do, and hiding it wastes his
time.

## Where this does not apply

Not everything is a hazard, and treating it that way makes the system useless.
These are fine to handle normally, via `comment-triage`:

- Praise, emoji, tagging a friend.
- Product questions whose answer is present and unambiguous in `pb-product-facts`.
- Stock or availability questions answerable from the store, phrased generally
  rather than about a placed order.
- Spam and abuse, which get hidden rather than answered.

The distinction that matters: a **general** question about the product is
ordinary; a question about **this customer's specific transaction, entitlement, or
animal** is not.
