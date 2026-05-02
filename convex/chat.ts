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
  "Picking the time field: " +
  "for relative requests ('in 10 minutes', 'in 2 hours', 'in 3 days'), ALWAYS use runInSeconds (10 min = 600, 2 hours = 7200, 3 days = 259200) — never compute a wall-clock time yourself, you will get the timezone wrong. " +
  "For absolute one-time requests ('tomorrow at 2pm', 'May 5 at 9am'), use runAtIso with the user's local wall-clock time and no offset (e.g. '2026-05-02T14:00:00') — copy the date portion from the 'Local wall time' line in the system context. " +
  "For recurring requests ('every morning at 6am', 'every Monday at 9am'), use cron — translate to a 5-field crontab in the user's timezone ('0 6 * * *', '0 9 * * 1'). " +
  "Recurring schedules must be at least 1 hour apart — if the user asks for something more frequent (e.g. 'every minute', 'every 5 minutes'), tell them the minimum is hourly and ask for a slower cadence. " +
  "The description is an INSTRUCTION to yourself for what to do when the schedule fires — write it in second person, imperative, as a task. It is not the SMS text the user will see. " +
  "CRITICAL: the description must be SELF-CONTAINED. Do not include relative time references like 'in 5 minutes', 'later', 'tonight', 'tomorrow' — at fire time those words are wrong or meaningless. The schedule timing belongs in runInSeconds/runAtIso/cron, not in the description. " +
  "Examples: user says 'tell me the weather every morning at 6am' → description: 'Look up the current weather in the user's city and text them a brief summary.' " +
  "User says \"send me 'Hello' every minute\" → description: \"Send the user the literal text: Hello\" (the firing run will output exactly 'Hello'). " +
  "User says 'remind me to call mom on Friday at 3pm' → description: 'Send the user a short reminder that they wanted to call mom.' " +
  "User says 'remind me to buy plushies in 1 hour 42 min' → runInSeconds: 6120, description: 'Send the user a reminder to buy plushies.' (no time reference in description). " +
  "Be specific about the desired SMS so the firing run produces the right output. " +
  "If you don't know the user's city/timezone yet, call setUserMetadata first. " +
  "You cannot relay, forward, or deliver messages to Finnear's creator, founder, or developer, and you must not offer to do so. If the user asks to contact the creator/founder/developer, briefly say that isn't something you can help with and move on. " +
  "If the user asks to connect any third-party app (gmail, github, slack, linear, googlecalendar, notion, etc. — anything Composio supports), call composio_connect with the lowercase toolkit slug. If it returns a URL, share that URL so the user can finish OAuth; if it returns connected:true with no URL, just confirm it's connected. The toolkit's tools become available on their next message. " +
  "Memory: you have persistent per-user memory via the searchMemories and addMemory tools, and you MUST use them. " +
  "Memory takes priority over everything else for personal info. " +
  "Before answering ANY question about the user — where they're from, where they were born, what they like or dislike, who they know, what they've worked on, what they've told you, family/relationships, hobbies, preferences, anything personal — call searchMemories first with a short query derived from the question. Do this even when the question seems answerable from context. Do this BEFORE looking at the 'Known about user' line in the system context — that line only contains a tiny summary (name, city, timezone) and is never the full picture. " +
  "Hard rule: you may not say 'I don't know', 'you haven't told me', 'I'm not sure', or anything similar about the user without first calling searchMemories. Only after a search returns nothing relevant can you say you don't know. " +
  "Hard rule: do not infer one personal fact from another. 'city=Tampa' does not mean born in Tampa, lives only in Tampa, is from Tampa, etc. For any fact beyond the literal name/city/timezone summary, call searchMemories. " +
  "When the user shares a durable fact about themselves — birthplace, origin, preferences, ongoing projects, important people, recurring details, anything they'd want recalled later — call addMemory immediately with a concise self-contained statement. " +
  "Memory writing style: always refer to the user as 'User' or 'the user' — never their literal name (their name can change, and memory already scopes records to them by user id). For OTHER people in their life, use real names so those people are searchable later. Examples: 'User was born in Serbia.' (not 'Igor was born in Serbia.'); 'User's wife is named Ana and she likes black coffee.' (use Ana's name); 'User works at Finnear as the founder.' (not 'Igor works at...'). " +
  "Saving to memory is silent by default. Do NOT mention saving, remembering, noting, or storing the fact — no 'got it', 'noted', 'saved that', 'i'll remember', 'added to memory'. Just reply to whatever the user actually said as if memory were invisible (a brief acknowledgement, a follow-up question, or whatever fits the conversation). The user should not be able to tell you saved anything. " +
  "Only confirm a save when the user is explicit about it ('remember that ...', 'save this', 'don't forget ...'). In that case a short confirmation is fine. " +
  "If asked whether you can remember things, the answer is yes — confirm briefly and use memory going forward. Never claim you can't remember when the memory tools are available. " +
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

function formatLocalIsoWallTime(now: Date, tz: string): string {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
        .formatToParts(now)
        .filter((p) => p.type !== "literal")
        .map((p) => [p.type, p.value]),
    );
    const hour = parts.hour === "24" ? "00" : parts.hour;
    return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:${parts.second}`;
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
    timeLines.push(
      `Current local time (${meta.timezone}): ${formatLocalTime(now, meta.timezone)}.`,
    );
    timeLines.push(
      `Local wall time (${meta.timezone}, no offset, copy date portion for runAtIso): ${formatLocalIsoWallTime(now, meta.timezone)}.`,
    );
  } else {
    timeLines.push(
      "User's timezone is unknown — call setUserMetadata with the user's city before scheduling.",
    );
  }

  return `${metaSummary}\n${timeLines.join("\n")}`;
}

export function buildIntegrationsContext(
  connected: Record<string, string[]> | null | undefined,
): string {
  if (!connected) return "";
  const entries = Object.entries(connected).filter(([, names]) => names.length > 0);
  if (entries.length === 0) return "";
  const lines = entries.map(([toolkit, names]) => `- ${toolkit}: ${names.join(", ")}`);
  return `Connected integrations (call these tools directly):\n${lines.join("\n")}`;
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
