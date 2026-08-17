# United States — USD ($)

Region file for `pb-product-facts`. Read this one when the customer is in
the United States; do not generalise from another market.

- **Currency:** USD, written `$`
- **Language:** **American English** — the one market that is not British English
- **Tax:** sales tax

> **Every figure below is a `TODO(jake):` placeholder.** Until filled in, questions
> about price, delivery or warranty for this market escalate. See the rule in
> `../SKILL.md`.

## Pricing

| Product | Price (USD) | Tax shown? |
| --- | --- | --- |
| Paddock blade — per model | > **TODO(jake):** one row per model, using the exact store name | > **TODO(jake):** is the displayed price sales tax-inclusive or exclusive? |
| Horse solarium | > **TODO(jake):** | |
| e-Barrow | > **TODO(jake):** | |
| Tack lockers | > **TODO(jake):** per size | |
| Spare parts | > **TODO(jake):** or a pointer to where a customer sees part prices | |

> **TODO(jake):** the store URL for this market, so replies can point customers to
> the right one. Sending a United States customer to the wrong store is a common own goal —
> they see the wrong currency and often the wrong shipping.

Never convert from another market's price. Rates move, and a quoted conversion
reads as a promise.

## Shipping

| Field | Value |
| --- | --- |
| Delivery time | > **TODO(jake):** working days, and say whether that is dispatch-to-door or order-to-door |
| Shipping cost | > **TODO(jake):** including any free-shipping threshold |
| Areas served / surcharges | > **TODO(jake):** Contiguous 48 states, and note whether Alaska and Hawaii differ. Freight for larger items often differs from parcel shipping. |
| Carrier and tracking | > **TODO(jake):** who delivers, whether tracking is provided |
| Larger items | > **TODO(jake):** do solarium / e-Barrow / lockers ship differently from blades? Kerbside or to-door? |
| Current lead time | > **TODO(jake):** if any line is made to order or on backorder, note it — this changes the answer and goes stale, so it needs reviewing rather than being written once |

## Warranty and returns

| Field | Value |
| --- | --- |
| Warranty length | > **TODO(jake):** per product line, if they differ |
| What it covers | > **TODO(jake):** and what it excludes — wear parts, misuse, commercial use |
| How to claim | > **TODO(jake):** the process a customer follows |
| Returns window | > **TODO(jake):** |
| Return shipping | > **TODO(jake):** who pays, and whether that differs for a faulty item versus a change of mind |
| Statutory rights | State-level consumer protection plus the FTC cooling-off rule. Sales tax is normally added at checkout rather than shown in the price. |

> **A reminder.** Warranty and refund questions match `escalation-rules` rules 3
> and 7 and escalate regardless of what is written here. This section exists so
> Jake has the facts to hand and so drafts can be accurate — not so a warranty
> question can be answered without him. Consumer law differs enough between these
> five markets that a statement correct in one is wrong in another.

## Anything specific to this market

> **TODO(jake):** anything a United States customer asks that customers elsewhere do not —
> local regulations, voltage and plug type for the solarium, import duty, seasonal
> demand, terminology quirks. Worth adding to as patterns show up in the digests.
