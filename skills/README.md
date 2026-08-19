# Paddock Blade skills

Six skills covering customer support across website chat, Shopify Inbox, Facebook
and Instagram comments, and DMs. They are designed to be read in a precedence
order — the safety ones override the helpful ones.

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
| `escalation-rules` | The never-auto-reply list, 12 rules. Consulted first, verdict is final. Routes to Emalee or Jake per the Business Bible's approval framework. |
| `comment-triage` | Six-category classification of comments, with a defined action each. |
| `dm-funnel` | Unread threads into a numbered queue Jake approves with "1, 3, 5 yes". |
| `pb-brand-voice` | Tone per Business Bible §16, per-market spelling, vocabulary, currency. |
| `pb-product-facts` | **The single source of truth.** Every factual claim traces here. |
| `social-digest` | Daily summary: volume, sentiment, recurring questions, overdue items. |

## The three rules that hold the rest together

**1. `escalation-rules` wins.** It overrides triage, voice, and any auto-send
whitelist. The reasoning is asymmetry: a late reply costs a little goodwill; a wrong
reply about a refund or a horse's safety costs money, trust, or an animal's
wellbeing — publicly and permanently.

**2. An absent fact is an escalation, never an estimate.** `pb-product-facts` is
the only source of product truth. A near-miss — the right figure for the wrong
model, the right shipping time for the wrong country — counts as absent.

**3. Never carry a fact across markets.** Range, naming, pricing, availability and
shipping genuinely differ. The UK file is the fullest, which makes quoting a UK
price to a US customer the single most likely error in the system.

## What is verified, and what is not

| Market | Pricing & availability | Source |
| --- | --- | --- |
| **UK** | ✅ **Verified** — 20 active products with live prices | UK Shopify store, read 2026-08-17 |
| USA | ❌ Not verified | — |
| Canada | ❌ Not verified | — |
| Europe | ❌ Not verified | — |
| Australia / NZ | ❌ Not verified | — |

Only the UK could be reached. The Shopify connector authorises **one store at a
time** and was connected to the UK; switching revokes that access and needs an
interactive login. All five regional websites are blocked by the network policy of
the environment this was built in.

The Original Paddock Blade's **specifications are cross-market and verified** —
weight, towing, speed, surfaces, capacity, warranty, troubleshooting — because the
company FAQ states them globally. That is in
`pb-product-facts/references/original-paddock-blade.md` and is the file to read
first for the hero product.

**30 `TODO(jake):` markers** remain, down from 119. Nothing was invented to close
the gap.

### The gaps worth closing first

1. **Paddock Blade Pro specifications — nothing exists.** The FAQ has a "PADDOCK
   BLADE PRO" heading with every row blank. It is a global priority product at £769
   in the UK, and "what do I get for the extra £290?" currently escalates every
   time. This is the highest-value gap in the knowledge base.
2. **"How fast does it clear an acre?"** — in the FAQ with no answer, and asked
   constantly.
3. **Scotland delivery charge** — the source document literally reads
   *"Delivery to Scotland is £X"*. The placeholder was never filled in.
4. **Tack locker sizes** — a blank FAQ row, on a product line starting at £979 and
   reaching £3,879.
5. **The four unverified markets** — needs someone with access to each store.

## Two things the system must never say

`pb-product-facts/references/internal-only.md` holds facts Paddock Blade's own
documents mark do-not-disclose:

- **The blade's steel gauge** — the FAQ records it and says *"we don't say that to
  the customer must ask jake first"*.
- **Any unreleased product**, including the all-surface product referenced under
  the tag `sandblade`.

The FAQ's first column is headed *"FOR INTERNAL COMPANY OR SUBCONTRACTOR USE"*.
Internal facts sit in the same document as the answers and read exactly like them —
the only thing distinguishing them is the column heading, which is why this needed
its own file rather than a footnote.

## Source priority

1. That country's current Shopify store data
2. That country's official Paddock Blade website
3. The FAQ documents
4. Google Drive documents, including the Business Bible
5. Other verified internal information

The **Business Bible is strategy, not a catalogue** — its per-market category lists
describe intent. It says so itself. Conflicts between sources are logged in
`pb-product-facts/references/discrepancies.md` with the resolution and what to
actually say; six are recorded so far, including a live one where the FAQ's "why is
the red one cheaper" answer no longer matches UK pricing.

## Auto-send

Ships empty and disabled. Under the Business Bible's framework every customer
communication is at least an **Amber** action requiring Emalee's approval, so
enabling auto-send would move a whole class of action to no-approval — which is
Jake's call to make explicitly, not a config tweak.
