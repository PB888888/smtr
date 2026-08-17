/**
 * Meta's messaging window rules, in one place.
 *
 * The rule, from the Messenger Platform and Instagram Messaging policy:
 *
 *  - A user message to the Page opens a 24-hour window. Inside it you may reply
 *    freely. Every new user message resets the clock.
 *  - Between 24 hours and 7 days, the only route is a message tag. `HUMAN_AGENT`
 *    is the applicable one, and it carries conditions: sent by a real person,
 *    for support and issue resolution, never promotional. Meta actively detects
 *    misuse.
 *  - Past 7 days there is no organic route at all.
 *
 * This module exists so no tool has to reimplement that arithmetic, and so the
 * rule is documented once, next to the code that enforces it.
 */

import { HUMAN_AGENT_WINDOW_HOURS, STANDARD_WINDOW_HOURS } from "../constants.js";

export type WindowState = "open" | "human_agent_only" | "closed" | "unknown";

export interface WindowAssessment {
  state: WindowState;
  hours_since_last_user_message: number | null;
  /** Hours until the current window shuts. Null when closed or unknown. */
  hours_until_window_closes: number | null;
  /** Plain-language summary, safe to show an operator directly. */
  explanation: string;
  /** Whether `meta_send_message` will accept a send right now. */
  can_send: boolean;
  /** Set when a tag is mandatory for the send to be lawful. */
  required_tag?: "HUMAN_AGENT";
}

/**
 * Assess the window from the timestamp of the most recent *user* message.
 *
 * Passing the Page's own last message would be wrong — only inbound messages
 * from the customer open or reset a window.
 */
export function assessWindow(lastUserMessageAt: string | Date | null | undefined): WindowAssessment {
  if (!lastUserMessageAt) {
    return {
      state: "unknown",
      hours_since_last_user_message: null,
      hours_until_window_closes: null,
      can_send: false,
      explanation:
        "No inbound message from this person could be found, so the messaging window " +
        "cannot be determined. Fetch the conversation with meta_get_conversation first. " +
        "If the thread genuinely contains no user message, there is no window and no " +
        "reply is permitted — Meta does not allow a business to open a conversation.",
    };
  }

  const then = new Date(lastUserMessageAt).getTime();
  if (Number.isNaN(then)) {
    return {
      state: "unknown",
      hours_since_last_user_message: null,
      hours_until_window_closes: null,
      can_send: false,
      explanation: `Could not parse the timestamp '${String(lastUserMessageAt)}'.`,
    };
  }

  const hoursSince = (Date.now() - then) / 3_600_000;
  const rounded = Math.round(hoursSince * 10) / 10;

  if (hoursSince < STANDARD_WINDOW_HOURS) {
    const remaining = Math.round((STANDARD_WINDOW_HOURS - hoursSince) * 10) / 10;
    return {
      state: "open",
      hours_since_last_user_message: rounded,
      hours_until_window_closes: remaining,
      can_send: true,
      explanation:
        `The standard 24-hour window is open — the customer wrote ${rounded}h ago, ` +
        `leaving ${remaining}h. A normal reply is permitted with no tag. Note that any ` +
        `new message from them resets this to a fresh 24 hours.`,
    };
  }

  if (hoursSince < HUMAN_AGENT_WINDOW_HOURS) {
    const remaining = Math.round((HUMAN_AGENT_WINDOW_HOURS - hoursSince) * 10) / 10;
    return {
      state: "human_agent_only",
      hours_since_last_user_message: rounded,
      hours_until_window_closes: remaining,
      can_send: true,
      required_tag: "HUMAN_AGENT",
      explanation:
        `The standard 24-hour window has closed — the customer wrote ${rounded}h ago. ` +
        `The HUMAN_AGENT tag extends this to 7 days, leaving ${remaining}h. Sending now ` +
        `requires messaging_tag: "HUMAN_AGENT", and that tag is only lawful when a real ` +
        `person composed or approved the message, it resolves a support issue, and it is ` +
        `not promotional. Meta detects misuse of this tag.`,
    };
  }

  return {
    state: "closed",
    hours_since_last_user_message: rounded,
    hours_until_window_closes: null,
    can_send: false,
    explanation:
      `The messaging window is closed — the customer last wrote ${rounded}h ago, which is ` +
      `beyond the 7-day HUMAN_AGENT limit. Meta permits no organic message on this thread. ` +
      `The remaining options are: reply by email if you hold an address for them, or wait ` +
      `for them to write again, which reopens a fresh 24-hour window.`,
  };
}

/**
 * Sort key for urgency: threads about to fall out of their window first.
 *
 * Used by the runner so the queue leads with what is about to become
 * unanswerable rather than with whatever happens to be newest.
 */
export function urgencyScore(assessment: WindowAssessment): number {
  if (assessment.state === "closed") return Number.MAX_SAFE_INTEGER;
  if (assessment.state === "unknown") return Number.MAX_SAFE_INTEGER - 1;
  return assessment.hours_until_window_closes ?? Number.MAX_SAFE_INTEGER - 2;
}
