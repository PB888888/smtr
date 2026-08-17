---
name: social-digest
description: Produce Paddock Blade's daily social media summary — comment and DM volume per platform, sentiment split, recurring questions worth turning into blog or reel content, and anything left unanswered past 24 hours. Use whenever asked for the daily or weekly social digest, a summary of what happened on Paddock Blade's social accounts, what people are asking about, or what is overdue. Also use when looking for content ideas grounded in what customers actually ask rather than guesswork.
---

# Social digest

A digest is worth writing only if it changes what Jake does next. So the test for
every line is: does this tell him something he would act on? Volume figures alone
fail that test. Volume plus "three people asked the same thing this week" passes,
because it points at a reel worth making.

Two sections carry most of the value: **recurring questions**, which is free
content research, and **overdue items**, which is the one part with a deadline
attached.

## Gathering the data

Read-only. A digest never sends anything.

1. `meta_list_pages` — the accounts in scope.
2. `meta_list_recent_posts` per account, covering the digest period.
3. `meta_list_comments` per post. Use `unanswered_only: false` here — the digest
   needs the whole picture, including what was answered.
4. `meta_list_conversations` per Page, both `messenger` and `instagram`, with
   `unread_only: false` for the same reason.
5. `meta_get_post_insights` on the better-performing posts, to see whether a topic
   that drew comments also drew reach.

If a metric comes back empty, say so rather than omitting it silently — "Instagram
insights unavailable" is information, whereas a missing row looks like a zero.

## Format

```
# Paddock Blade social digest — [date range]

## At a glance
- Comments: [n] ([n] Facebook, [n] Instagram) · [n] still unanswered
- DMs: [n] threads ([n] Messenger, [n] Instagram) · [n] unread
- ⏰ Windows closing within 24h: [n]
- 🔴 Overdue past 24h: [n]

## Volume
| Platform | Comments | DMs | Unanswered | Change vs previous period |

## Sentiment
| | Count | Share | Notable |
| Positive | | | |
| Neutral / questions | | | |
| Negative | | | |
Plus a sentence on anything driving a shift, not just the numbers.

## Recurring questions
Questions asked more than once. For each: the question, how many times, which
markets, and whether pb-product-facts already answers it.

## Content opportunities
Derived from the above — see below.

## 🔴 Unanswered past 24 hours
Oldest first, with age and platform. For DMs, the window state.

## Escalations still open
Anything escalated in this period that has not been resolved.

## Notes
Anything that does not fit but Jake should know.
```

## Sentiment, honestly

Three buckets is enough — positive, neutral or a question, negative. Finer grading
is false precision on samples this size.

Two things to be careful about. **A question is not negative.** "Does it work on
sand?" is a customer with an interest, and filing it as negative makes the trend
look worse than it is. And **report the absolute count alongside the percentage**:
"negative 25%" on a day with four comments means one grumpy person, which is
noise, not a trend. Percentages on small samples mislead, so give Jake both.

Where a negative comment is genuinely notable, quote it verbatim and link it rather
than paraphrasing. Paraphrase loses the thing that makes it actionable.

## Recurring questions — the useful part

A question asked three times in a week by different people is a gap in the public
material, and closing it stops the question being asked a fourth time. So for each
recurring question, record:

- The question, in the customers' own words.
- How many times, and across which platforms and markets.
- **Whether `pb-product-facts` already answers it.**

That last point splits the finding into two different actions:

- **Facts exist, question keeps coming** → the answer is not visible enough. A
  post, a reel, a pinned comment, or an FAQ line. Content problem.
- **Facts do not exist** → it is escalating every time it is asked. Filling it into
  `pb-product-facts` removes a recurring escalation. Data problem, and cheaper to
  fix.

Flag the second kind explicitly. It is the highest-leverage item the digest can
surface: one edit to a facts file that stops a weekly interruption.

## Content opportunities

Only propose ideas the comments actually support, and say which comments support
each. An idea traceable to three real questions is worth making; an invented one
wastes a filming afternoon.

```
- [Idea] — [format: reel / blog / carousel / pinned post]
  Prompted by: [n] questions across [platforms]
  Evidence: "[quoted question]" · "[quoted question]"
```

Where insights show a post that drew unusual reach, note what it was about. Topic
plus reach is a stronger signal than either alone.

## Overdue items

The section with a clock on it. A comment unanswered past 24 hours looks like
inattention. A DM past 24 hours has legal-ish consequences: Meta's standard
messaging window has closed, and past 7 days no reply is possible at all.

So for DMs, always give the window state and hours remaining, and sort by time
remaining rather than by age. A thread with three hours left is more urgent than
one that has already closed — the closed one cannot be fixed by hurrying.

Mark anything already closed clearly and note that it needs another channel. It is
not actionable on social, and leaving it looking actionable wastes Jake's time.

## Cadence

Daily by default, from the cron runner. A weekly digest works better for the
recurring-questions and content sections, since patterns need a few days to show
up. If asked for a weekly one, compare against the previous week rather than the
previous day — day-to-day variance on volumes this size is mostly noise.
