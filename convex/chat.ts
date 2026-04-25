import { Agent, stepCountIs } from "@convex-dev/agent";
import { anthropic } from "@ai-sdk/anthropic";

import { components } from "./_generated/api";
import { BUILTIN_TOOLS } from "./tools/builtin";

export const chatAgent = new Agent(components.agent, {
  name: "Finnear Chat",
  languageModel: anthropic("claude-haiku-4-5"),
  // Allow the model to step past a tool call into a final text reply.
  // Default in AI SDK is stepCountIs(1), which leaves tool-only turns empty.
  stopWhen: stepCountIs(5),
  instructions:
    "You are Finnear's helpful assistant. Reply in 1-3 short sentences when possible. " +
    "Plain text only — no markdown, no bullet points, no headings. " +
    "Be direct and skip filler (\"Sure!\", \"Great question\"). " +
    "Write everything in lowercase, including proper nouns and the start of sentences, unless the user explicitly asks for normal capitalization or uppercase.",
  tools: BUILTIN_TOOLS,
  contextOptions: {
    recentMessages: 20,
    excludeToolMessages: true,
  },
});
