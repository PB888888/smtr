---
name: pb-product-facts
description: The single source of truth for Paddock Blade product facts — the product range (paddock blades, horse solarium, e-Barrow, tack lockers, spare parts), specifications, per-region pricing and currency, shipping times and warranty terms for the UK, USA, Canada, Australia and Europe. Consult this before making ANY factual claim in a reply to a customer, on any platform. Use whenever answering a question about dimensions, weight, what tows it, compatibility, price, delivery time, warranty or spare parts. If a fact is absent or still marked TODO, that is a signal to escalate rather than estimate.
---

# Paddock Blade product facts

Every factual claim in a customer-facing reply must trace to an entry in this
skill. If it does not, it is not a fact — it is a guess with the Paddock Blade name
on it.

## The rule that matters most

**An absent fact is an escalation, never an estimate.**

When the answer to a customer's question is not here, is marked `TODO(jake):`, or
is here but does not clearly cover the case they asked about, the correct action is
to tell them you will check and to escalate to Jake. It is not to reason towards a
plausible figure.

This is worth being stubborn about, because the pull in the other direction is
strong. A number that sounds right is always available, the customer is waiting,
and producing it feels like being helpful. But a specification published under the
brand name is public, permanent, quotable, and may be the basis of a purchase.
"Let me get you the exact figure rather than guess" costs a few hours. A wrong
dimension costs a return, a refund, and a customer who tells their yard about it.

**Near-misses count as absent.** If the facts give a figure for the 4ft model and
the customer asks about the 6ft, or give a UK shipping time and the customer is in
Alberta, you do not have the fact. Escalate.

## Status of this file

> **This skill is a structure awaiting content.** Every product specification,
> price, shipping time and warranty term below is a `TODO(jake):` placeholder,
> because inventing them was not an option and no source for them was available
> when this was written.
>
> Until they are filled in, expect nearly every product question to escalate.
> That is the system behaving correctly, not failing — but it does mean filling
> this in is the highest-value thing Jake can do to make the whole system useful.
>
> Suggested order: the paddock blade range first (it will be the bulk of
> questions), then UK shipping and warranty, then the other regions.

## Product range

Five lines. Each needs its own specification block.

| Line | What it is | Detail |
| --- | --- | --- |
| **Paddock blades** | The core product | > **TODO(jake):** one-sentence description of what it is and does, and how it is towed. List every model/size currently sold, with the exact name used on the store. |
| **Horse solarium** | | > **TODO(jake):** description, models, power requirements, mounting options. |
| **e-Barrow** | | > **TODO(jake):** description, capacity, battery and range figures, charge time. |
| **Tack lockers** | | > **TODO(jake):** description, sizes, materials, locking, indoor/outdoor suitability. |
| **Spare parts** | | > **TODO(jake):** parts available, which models each fits, how a customer orders one. |

### Paddock blade specifications

The table customers ask about most. One row per model.

| Field | Value |
| --- | --- |
| Model name(s) | > **TODO(jake):** exact names as they appear on the store |
| Working width | > **TODO(jake):** per model, metric and imperial |
| Overall dimensions | > **TODO(jake):** per model |
| Weight | > **TODO(jake):** per model — asked about constantly, as it determines what can tow it |
| Towing requirement | > **TODO(jake):** minimum vehicle; does it work behind a quad/ATV, ride-on mower, compact tractor, UTV? Hitch type? |
| Coverage per pass / recommended paddock size | > **TODO(jake):** what customers actually want to know — "will this suit my 3 acres?" |
| Surface suitability | > **TODO(jake):** grass, sand, all-weather, wet ground, frozen ground, slopes |
| Materials and finish | > **TODO(jake):** including corrosion resistance, which matters for outdoor storage |
| Assembly required | > **TODO(jake):** flat-packed or assembled, tools needed, time |
| Storage footprint | > **TODO(jake):** folded/stored dimensions |
| Safety notes around horses | > **TODO(jake):** anything that must be said. See the caution below. |

> **A caution on the safety row.** `escalation-rules` rule 5 means any question
> touching horse injury or safety escalates regardless of what this file says. Fill
> this row in for Jake's own reference and for drafting, but a safety question is
> never answered from a lookup table alone.

### Horse solarium, e-Barrow, tack lockers

> **TODO(jake):** replicate the specification table above for each of these three
> lines. Their fields differ — the solarium needs power draw, mounting and timer
> details; the e-Barrow needs battery, range, load capacity and charge time; the
> tack lockers need dimensions, capacity, materials and weatherproofing. Better to
> have three accurate short tables than one generic long one.

## Regional information

Pricing, shipping, warranty and tax are all region-specific, and answering with
another region's figures is a common and expensive mistake. One file per market:

| Market | File | Currency |
| --- | --- | --- |
| United Kingdom | `references/uk.md` | GBP `£` |
| United States | `references/usa.md` | USD `$` |
| Canada | `references/canada.md` | CAD `CA$` |
| Australia | `references/australia.md` | AUD `A$` |
| Europe | `references/europe.md` | EUR `€` |

**Read the file for the customer's market. Do not generalise from another.**

Determining the market: the store or Page they came through, what they say about
their location, or the currency they quote. **Not their name.** If you cannot
tell, and the answer depends on it, ask or state your assumption — see
`pb-brand-voice`.

Customers outside these five markets are an escalation. There may be no shipping
route, and inventing one would be worse than saying you will check.

## How to cite a fact

When drafting, name the entries the draft relies on, as
`pb-product-facts › [section]` — for example
`pb-product-facts › paddock blade specifications › weight` and
`pb-product-facts › UK › shipping`.

This is not bureaucracy. It makes an ungrounded claim visible: if you cannot name
the entry a sentence rests on, that sentence is invented, and you have found the
problem before the customer did.
