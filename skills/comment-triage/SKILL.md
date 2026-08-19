---
name: comment-triage
description: Classify Facebook Page and Instagram comments for Paddock Blade into one of six categories and take the defined action for each — draft a reply, escalate to Jake, or recommend hiding. Use this whenever working through comments on Paddock Blade's social posts, triaging an unanswered comment backlog, deciding whether a comment needs a reply at all, or building the daily review queue. Also use when asked what to do about a specific comment. Every classification is grounded in pb-product-facts and checked against escalation-rules first.
---

# Comment triage

Your job is to sort comments into six categories and take the action each one
defines. Most of the value is not in the writing — it is in correctly separating
the comments that need Jake from the ones that do not, so his attention goes only
where it is actually needed.

## Order of operations

Follow this sequence. It is ordered by cost of getting it wrong, most expensive
first.

1. **Check `escalation-rules` first, before classifying.** If it matches, you are
   finished with that comment — output the escalation and move on. Do not continue
   to step 2 hoping to find a friendlier category.
2. **Read the thread if there are existing replies.** Use
   `meta_get_comment_thread`. A comment that looks unanswered may already have a
   reply from Jake, and answering twice looks careless. `meta_list_comments` with
   `unanswered_only: true` filters most of this, but it only inspects the first 10
   replies and says so in its `note` field when it hits that limit.
3. **Classify** into exactly one of the six categories below.
4. **Establish the customer's market before giving country-specific information.**
   Price, delivery and availability differ per market, and the UK is the only market
   verified in `pb-product-facts`. If the market is unclear and the answer depends on
   it, ask; if it does not depend on it, just answer.
5. **Ground every factual claim in `pb-product-facts`.** If the fact is not there,
   the category becomes *product question with a missing fact*, which escalates.
   Check `internal-only.md` before answering on steel thickness or sand surfaces.
6. **Draft in the register `pb-brand-voice` sets for that market.**

## The six categories

### 1. Buying intent
Signals a purchase is being considered: asking how to order, about delivery to
their country, about price, about which model suits their situation, "need one of
these", tagging a partner.

**Action: draft a reply AND flag to Jake.** Both, not either. The draft should
answer the question and make the next step obvious. Flagging matters because a
buying-intent comment is the highest-value thing in the queue and Jake may want to
follow up personally or in DM.

Note the overlap with `escalation-rules` rule 1: a question about *price* is a
product question if they are asking what it costs, and a negotiation if they are
asking for a better one. "How much is it?" is answerable from `pb-product-facts`.
"What's your best price?" escalates.

### 2. Product question
A factual question about the product: dimensions, weight, what tows it, materials,
compatibility, spare parts, how it performs in given conditions.

**Action: answer strictly from `pb-product-facts`.** If the fact is present,
answer it plainly. If the fact is absent, marked `TODO(jake):`, or does not clearly
cover the case asked about, **escalate rather than guess.**

This is the rule most likely to be quietly broken, because a plausible-sounding
answer is always available and inventing one feels helpful. It is not. A wrong
specification published under the Paddock Blade name is a public, permanent,
quotable error that a customer may buy on the strength of. "Let me check and come
back to you" costs nothing by comparison.

Watch specifically for questions that are *nearly* covered: the facts give a
figure for one model and the customer asks about another, or give a UK shipping
time and they are in Alberta. A near-miss is a miss. Escalate.

### 3. Complaint or warranty
Dissatisfaction, a fault, something broken, wear, a warranty claim, or
disappointment.

**Action: escalate only. Draft nothing.**

This is deliberately stricter than the other categories, and the reason is that
early wording in a complaint sets its trajectory. A sympathetic public reply that
implies fault, or a defensive one that implies none, both narrow Jake's options
before he has seen the case. Even a neutral holding reply is a public statement
about a dispute you know one side of.

So: produce the escalation record, and leave the drafting to Jake. Do include the
verbatim complaint and any thread history — that is the useful part.

### 4. Spam or abuse
Bot content, unrelated promotion, scam links, crypto, adult content, or abuse
aimed at Paddock Blade, staff, or other commenters.

**Action: recommend hiding. Do not reply.**

Recommend `meta_hide_comment`, not `meta_delete_comment`. Hiding is reversible and
leaves the comment visible to its author, so they are not alerted and do not
escalate. Deleting is permanent and, when noticed, reliably makes a small problem
into a public one. Recommend deletion only for content that must not exist at all
— someone's phone number or address, or illegal material — and flag those to Jake
rather than acting alone.

Do not reply to abuse, including to defend the brand. It gives the comment
reach it would not otherwise get.

Be careful distinguishing abuse from a **rudely-worded complaint**. "This thing is
useless, total waste of money" is bad-tempered, but it is a customer with a
grievance, which is category 3. Hiding it would be the worst available action.
Abuse is unrelated to a transaction, or is directed at a person rather than the
product.

### 5. Praise or emoji
Compliments, "love mine", 🙌, a tagged friend with no question, a photo of theirs.

**Action: a short branded reply.** Two sentences at most, warm, no sales pitch, no
question that obliges them to reply. This is the one category eligible for the
auto-send whitelist later — see below.

Match their energy: a single emoji deserves a brief warm answer, not a paragraph.
Where they have posted a photo of their own horse or field, acknowledging it
specifically is what makes the reply feel human rather than automated.

### 6. Ambiguous
You cannot tell what they are asking, the comment is a fragment, it is in a
language you cannot reliably read, or it could reasonably be two categories with
different actions.

**Action: escalate.** Ambiguity is a real finding, not a failure. Say specifically
what is unclear and what the plausible readings are — that is what makes it quick
for Jake to resolve.

Do not classify by coin-flip to avoid escalating. A comment mis-sorted into
"praise" that was actually a complaint is worse than one honestly marked unclear.

## Output format

Work through comments in one list, most urgent first — buying intent and
complaints above praise. For each:

```
[n] [CATEGORY] · [Facebook|Instagram] · [author]
    "[comment text, verbatim]"
    ID: [comment id]
    → Action: [reply | reply + flag | escalate | hide]
    → Draft: [the reply, or "none — escalated"]
    → Grounding: [which pb-product-facts entries the draft relies on, or "n/a"]
```

Then a summary line: how many in each category, and how many need Jake.

The `Grounding` line matters more than it looks. Naming the facts a draft depends
on makes an ungrounded claim visible — if you cannot fill that line, the draft is
inventing something.

## The auto-send whitelist

Ships **empty and disabled**, and it needs two separate changes to activate. Only
category 5, praise and emoji, is ever a candidate, because it is the only one where
the worst realistic outcome of a wrong reply is mild awkwardness.

Even when enabled, these never auto-send:
- Anything `escalation-rules` matched, for any reason.
- Anything containing a question mark. A question in a praise comment means it was
  not really praise.
- Anything where the draft makes a factual claim about the product. Praise replies
  should not need to.

Until Jake explicitly enables it, treat every category as approval-required,
including praise.
