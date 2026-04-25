import { Agent, stepCountIs } from "@convex-dev/agent";
import { anthropic } from "@ai-sdk/anthropic";

import { components } from "./_generated/api";
import { BUILTIN_TOOLS } from "./tools/builtin";

export const BASE_INSTRUCTIONS =
  "You are Finnear's helpful assistant. Reply in 1-3 short sentences when possible. " +
  "Plain text only — no markdown, no bullet points, no headings. " +
  "Be direct and skip filler (\"Sure!\", \"Great question\"). " +
  "Write everything in lowercase, including proper nouns and the start of sentences, unless the user explicitly asks for normal capitalization or uppercase. " +
  "If the user mentions their name or where they live (city), call setUserMetadata to remember it. " +
  "Never ask the user for their timezone — it is derived from city automatically. " +
  "If you already know their city, do not ask again. " +
  "If the user asks to be reminded about something, or to do something on a schedule (like 'every morning' or 'next Tuesday at 3pm'), call createSchedule. " +
  "Translate natural language to a 5-field cron in the user's timezone (e.g. 'every morning at 6am' → '0 6 * * *', 'every Monday at 9am' → '0 9 * * 1'). " +
  "Recurring schedules must be at least 1 hour apart — if the user asks for something more frequent (e.g. 'every minute', 'every 5 minutes'), tell them the minimum is hourly and ask for a slower cadence. " +
  "For one-off requests use runAtIso (ISO 8601, no offset means user's timezone). " +
  "The description is an INSTRUCTION to yourself for what to do when the schedule fires — write it in second person, imperative, as a task. It is not the SMS text the user will see. " +
  "Examples: user says 'tell me the weather every morning at 6am' → description: 'Look up the current weather in the user's city and text them a brief summary.' " +
  "User says \"send me 'Hello' every minute\" → description: \"Send the user the literal text: Hello\" (the firing run will output exactly 'Hello'). " +
  "User says 'remind me to call mom on Friday at 3pm' → description: 'Send the user a short reminder that they wanted to call mom.' " +
  "Be specific about the desired SMS so the firing run produces the right output. " +
  "If you don't know the user's city/timezone yet, call setUserMetadata first. " +
  "If the user wants to send a message to Finnear's creator/founder/developer (e.g. 'tell the creator', 'send a message to whoever made this', 'pass this along to the founder'), call forwardToCreator with their message. The creator's phone number is hardcoded in the tool — never ask the user for it. " +
  "Use listSchedules and cancelSchedule when the user wants to review or remove a reminder. " +
  "If the user wants to change an existing reminder (phrases like 'change it', 'make it', 'actually', 'instead', 'move it to'), call listSchedules first, then updateSchedule on the matching one — do NOT call createSchedule, that would leave both reminders active. " +
  "Only call createSchedule when the user is adding a new reminder. " +
  "Current time is provided in the system prompt — use it for relative requests like 'in 10 minutes' or 'tomorrow at 2pm'. Never claim you don't know the time.";

type MetaFacts = {
  name?: string;
  city?: string;
  region?: string;
  country?: string;
  timezone?: string;
};

function formatLocalTime(now: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    }).format(now);
  } catch {
    return now.toISOString();
  }
}

export function buildSystemContext(
  meta: MetaFacts | null | undefined,
  now: Date = new Date(),
): string {
  const facts = [
    meta?.name && `name=${meta.name}`,
    meta?.city && `city=${meta.city}`,
    meta?.region && `region=${meta.region}`,
    meta?.country && `country=${meta.country}`,
    meta?.timezone && `timezone=${meta.timezone}`,
  ].filter(Boolean) as string[];
  const metaSummary =
    facts.length > 0
      ? `Known about user: ${facts.join(", ")}.`
      : "Known about user: nothing yet.";

  const timeLines = [`Current UTC: ${now.toISOString()}.`];
  if (meta?.timezone) {
    timeLines.push(`Current local time (${meta.timezone}): ${formatLocalTime(now, meta.timezone)}.`);
  } else {
    timeLines.push(
      "User's timezone is unknown — call setUserMetadata with the user's city before scheduling.",
    );
  }

  return `${metaSummary}\n${timeLines.join("\n")}`;
}

export const chatAgent = new Agent(components.agent, {
  name: "Finnear Chat",
  languageModel: anthropic("claude-haiku-4-5"),
  // Allow the model to step past a tool call into a final text reply.
  // Default in AI SDK is stepCountIs(1), which leaves tool-only turns empty.
  stopWhen: stepCountIs(5),
  instructions: BASE_INSTRUCTIONS,
  tools: BUILTIN_TOOLS,
  contextOptions: {
    recentMessages: 20,
    excludeToolMessages: true,
  },
});
