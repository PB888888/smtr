---
name: pb-product-facts
description: The single source of truth for Paddock Blade product facts across the UK, USA, Canada, Europe and Australia/New Zealand — product range per market, specifications, dimensions, weight, capacity, towing and vehicle compatibility, materials, warranty, pricing, shipping, assembly, accessories and colours. Consult this before making ANY factual claim to a customer on website chat, Shopify Inbox, social comments or DMs. Use whenever answering anything about what a product does, costs, weighs, tows behind, ships in, or is covered by. Identify the customer's country first — specifications and availability genuinely differ between markets. If a fact is absent or marked TODO, escalate rather than estimate.
---

# Paddock Blade product facts

Every factual claim in a customer-facing reply must trace to an entry in this skill.
If it does not, it is not a fact — it is a guess with the Paddock Blade name on it.

## Two rules that override the instinct to be helpful

**1. An absent fact is an escalation, never an estimate.**

When the answer is not here, is marked `TODO(jake):`, or is here but does not
clearly cover the case asked about, tell the customer you will confirm and
escalate. Do not reason towards a plausible figure.

The pull the other way is strong: a number that sounds right is always available,
the customer is waiting, and producing it feels like service. But a specification
published under the brand name is public, permanent, quotable, and may be the basis
of a £2,000 purchase. "Let me confirm that for you rather than guess" costs hours.
A wrong dimension costs a return, a refund, and a customer who tells their yard.

**Near-misses count as absent.** A figure for the Original blade when they asked
about the Pro, or a UK shipping time when they are in Alberta, is not the fact.

**2. Never carry a fact from one country to another.**

The range, naming, pricing, availability and shipping genuinely differ per market.
A UK price quoted to a US customer is not a small error — it is the specific
mistake the country separation exists to prevent, and it is the one most likely to
happen, because the UK file is the fullest and it is right there.

Specifications that the FAQ states **globally** — weight, towing, speed, surfaces,
capacity, warranty terms — are safe across markets and live in
`references/original-paddock-blade.md`. Everything else is per-market.

## Identify the country first

Before giving country-specific information, establish the market. Use the store or
Page they contacted through, the currency they quote, or what they say about their
location. **Never infer it from their name.**

If it is obvious from context, do not ask again — that is irritating and looks
inattentive. If it is unclear **and it materially affects the answer**, ask simply:

> "Of course — which country are you based in?"

If it is unclear and it does **not** affect the answer — how to empty the blade,
what it tows behind, whether it damages grass — just answer. Asking unnecessarily
is friction for no gain.

Where a customer needs a different store, point them at the right regional one. If
their country is unclear or they need the full set, the Paddock Blade Linktree
carries links to all regional stores.

> **TODO(jake):** the Linktree URL. It is referenced as the fallback for customers
> whose market is unclear, and it cannot be used until it is recorded here.

## Source priority

When sources disagree, prefer them in this order:

1. The relevant country's **current Shopify store / product data** — live prices,
   variants, stock
2. The relevant country's **official Paddock Blade website**
3. **Paddock Blade FAQ and product documents** (`PB_FAQs.pdf` and its Google Sheet)
4. **Google Drive documents and spreadsheets**, including the Business Bible
5. Other verified internal information

Do not guess between conflicting sources. Prefer the most current
country-specific one, and log the conflict in `references/discrepancies.md` so it
is resolved once rather than rediscovered.

A caution about source 4: the **Business Bible is a strategy document, not a
catalogue.** Its per-market category lists describe intent, and it says so itself —
availability "must always be checked against the current regional SKU matrix". Its
listing a product for a market is not evidence that the product is buyable there.

## Never disclose

Some facts in Paddock Blade's own documents are marked internal — the steel gauge,
and an unreleased product. **Read `references/internal-only.md` before answering
anything about steel thickness or about sand surfaces.**

The FAQ's first column is headed "FOR INTERNAL COMPANY OR SUBCONTRACTOR USE".
Check which column a fact came from before repeating it.

## Where things are

| File | Contents |
| --- | --- |
| `references/original-paddock-blade.md` | **Start here for the hero product.** Verified specs, towing, surfaces, warranty, troubleshooting. Cross-market. |
| `references/uk.md` | **Verified live.** Full 20-product catalogue with real prices, delivery, payment, Klarna. |
| `references/usa.md` | Unverified pricing. Shop Pay, "American made" wording, imperial units. |
| `references/canada.md` | Unverified pricing. Made-in-Canada and bilingual questions open. |
| `references/australia.md` | Unverified pricing. AfterPay/ZipPay. Includes the New Zealand questions. |
| `references/europe.md` | Unverified pricing. Two conflicting routes to purchase — read before answering. |
| `references/internal-only.md` | **Do-not-disclose register.** |
| `references/discrepancies.md` | Conflicts between sources, with the resolution and what to say. |

## Product range

Paddock Blade is no longer a single-product business. Four platforms, per the
Business Bible:

| Platform | Products |
| --- | --- |
| **Core cleaning** | Original Paddock Blade (hero) · Paddock Blade Pro |
| **Storage and show-yard** | Tack Lockers · Show Tack Trunks · Rug Boxes · Rug Trunks |
| **Care, conditioning and welfare** | Aurora horse solariums · Rug dryers · PEMF therapy · Vibration therapy |
| **Utility, feeding and yard mobility** | e-Barrow · Round pens · Tie posts · Water drinkers · Hay OptiMizer slow feeders |

**Which of these a given customer can actually buy depends on their market.** Only
the UK range is confirmed here.

### Paddock Blade Pro

The premium heavy-duty version of the core blade. Per the Business Bible it is for
rougher ground, larger properties, longer grass, rocks, flint, granite, and
professional or higher-frequency use.

> **TODO(jake): the Pro has no documented specifications anywhere.** The FAQ has a
> "PADDOCK BLADE PRO" section heading with every row blank. So there is no verified
> answer to what the Pro weighs, how big it is, how it differs in construction, or
> what it tows behind.
>
> This is the **highest-value gap in the whole knowledge base.** The Pro is a global
> priority product at £769 in the UK — a 60% step up from the Original — and the
> obvious customer question is "what do I get for the extra?" Right now every such
> question escalates.
>
> Needed: weight, dimensions, working width, construction differences, minimum
> vehicle and power, and a plain statement of when to recommend Pro over Original.

Until then: describe the Pro's *purpose* from the Business Bible positioning, which
is safe, and escalate any request for figures or a direct comparison.

## Citing a fact

When drafting, name what the draft rests on, as
`pb-product-facts › [file] › [section]` — for example
`pb-product-facts › original-paddock-blade › towing` or
`pb-product-facts › uk › delivery`.

This makes an ungrounded claim visible. If you cannot name the entry a sentence
rests on, that sentence is invented, and you have found the problem before the
customer did.

## Freshness

The UK catalogue was read live on **2026-08-17**. Prices, stock and product lists
change — treat that file as a cache. Stock figures go stale within days, and three
UK lines were in single digits when checked.

If a price or availability is decisive to a customer's decision, re-read the live
store rather than trusting this file.
