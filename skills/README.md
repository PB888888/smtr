# Paddock Blade skills

Six skills. They are designed to be read in a precedence order, not
independently — the safety ones override the helpful ones.

```
escalation-rules          ← authority over everything below
        │
        ├── comment-triage ──┐
        └── dm-funnel ───────┤
                             ├── pb-brand-voice   (how to say it)
                             └── pb-product-facts (what is true)

social-digest             ← read-only reporting, sends nothing
```

| Skill | Purpose |
| --- | --- |
| `escalation-rules` | The never-auto-reply list. Consulted first, verdict is final. |
| `comment-triage` | Six-category classification of comments, with a defined action each. |
| `dm-funnel` | Unread DMs into a numbered queue Jake approves with "1, 3, 5 yes". |
| `pb-brand-voice` | Tone, per-market spelling, vocabulary and currency format. |
| `pb-product-facts` | **The single source of truth.** Every factual claim traces here. |
| `social-digest` | Daily summary: volume, sentiment, recurring questions, overdue items. |

## The two rules that hold the rest together

**1. `escalation-rules` wins.** It overrides triage, voice, and any auto-send
whitelist. The reasoning is asymmetry: a late reply costs a little goodwill, a
wrong reply about a refund or a horse's safety costs money, trust, or an animal's
wellbeing — publicly and permanently.

**2. An absent fact is an escalation, never an estimate.** `pb-product-facts` is
the only source of product truth. `pb-brand-voice` governs *how* something is said
and never supplies *what* is true. A near-miss — the right figure for the wrong
model, the right shipping time for the wrong country — counts as absent.

## Current state: pb-product-facts is empty

Every specification, price, shipping time and warranty term in `pb-product-facts`
is a `TODO(jake):` placeholder — **119 of them.** Nothing was invented, because a
fabricated specification is worse than a missing one.

Until they are filled in, most product questions will escalate. That is the system
working as designed, but it does mean **filling this in is the single highest-value
thing to do next.** Suggested order:

1. The paddock blade range — it will be the bulk of the questions.
2. `references/uk.md` shipping and warranty.
3. The remaining four regions.
4. The other three product lines.

Each region file has the same structure, so filling the first makes the rest quick.

## Auto-send

Ships empty and disabled. Only the praise/emoji category is ever a candidate, and
even once enabled it will never auto-send anything that `escalation-rules` matched,
anything containing a question mark, or anything making a factual claim about the
product.
