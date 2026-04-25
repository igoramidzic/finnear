import { paginationOptsValidator } from "convex/server";
import { v, ConvexError } from "convex/values";
import {
  Agent,
  createThread,
  createTool,
  listUIMessages,
  syncStreams,
  vStreamArgs,
} from "@convex-dev/agent";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

import { components, internal } from "./_generated/api";
import {
  internalAction,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireUserProfile } from "./auth";

const getWeather = createTool({
  description:
    "Get current weather (temperature in °F, wind speed in mph, condition code) for a city by name.",
  inputSchema: z.object({
    city: z.string().describe("City name, optionally with country, e.g. 'Tokyo' or 'Paris, France'"),
  }),
  execute: async (_ctx, { city }) => {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`;
    const geoRes = await fetch(geoUrl);
    if (!geoRes.ok) return { error: `Geocoding failed: ${geoRes.status}` };
    const geo = (await geoRes.json()) as {
      results?: Array<{ latitude: number; longitude: number; name: string; country?: string }>;
    };
    const place = geo.results?.[0];
    if (!place) return { error: "City not found" };

    const fcUrl = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,wind_speed_10m,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph`;
    const fcRes = await fetch(fcUrl);
    if (!fcRes.ok) return { error: `Forecast failed: ${fcRes.status}` };
    const fc = (await fcRes.json()) as {
      current?: { temperature_2m: number; wind_speed_10m: number; weather_code: number };
    };
    if (!fc.current) return { error: "No current weather available" };

    return {
      city: place.name,
      country: place.country ?? null,
      temperatureF: fc.current.temperature_2m,
      windMph: fc.current.wind_speed_10m,
      conditionCode: fc.current.weather_code,
    };
  },
});

const getTopNews = createTool({
  description: "Get the latest top news headlines from Hacker News.",
  inputSchema: z.object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe("Number of stories to return (1-10, default 5)"),
  }),
  execute: async (_ctx, { limit }) => {
    const n = Math.min(Math.max(limit ?? 5, 1), 10);
    const idsRes = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json");
    if (!idsRes.ok) return { error: `Top stories fetch failed: ${idsRes.status}` };
    const ids = (await idsRes.json()) as number[];
    const items = await Promise.all(
      ids.slice(0, n).map(async (id) => {
        const r = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        if (!r.ok) return null;
        return (await r.json()) as {
          title?: string;
          url?: string;
          score?: number;
          by?: string;
        } | null;
      }),
    );
    const stories = items
      .filter((x): x is { title?: string; url?: string; score?: number; by?: string } => x !== null)
      .map((s) => ({
        title: s.title ?? "(untitled)",
        url: s.url ?? null,
        score: s.score ?? 0,
        by: s.by ?? null,
      }));
    return { stories };
  },
});

export const chatAgent = new Agent(components.agent, {
  name: "Finnear Chat",
  languageModel: anthropic("claude-haiku-4-5"),
  instructions:
    "You are Finnear's helpful assistant. Be concise, friendly, and direct. " +
    "Use the getWeather tool when the user asks about weather, and the getTopNews tool when they ask for news or headlines.",
  tools: { getWeather, getTopNews },
});

async function getOrCreateUserThreadId(
  ctx: MutationCtx,
): Promise<{ threadId: string; userProfileId: string }> {
  const { userProfile } = await requireUserProfile(ctx);
  if (userProfile.chatThreadId) {
    return { threadId: userProfile.chatThreadId, userProfileId: userProfile._id };
  }
  const threadId = await createThread(ctx, components.agent, {
    userId: userProfile._id,
  });
  await ctx.db.patch(userProfile._id, { chatThreadId: threadId });
  return { threadId, userProfileId: userProfile._id };
}

async function getUserThreadId(ctx: QueryCtx): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const userProfile = await ctx.db
    .query("userProfile")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
    .first();
  return userProfile?.chatThreadId ?? null;
}

export const sendMessage = mutation({
  args: { prompt: v.string() },
  handler: async (ctx, { prompt }) => {
    const trimmed = prompt.trim();
    if (!trimmed) throw new ConvexError("Message cannot be empty");

    const { threadId } = await getOrCreateUserThreadId(ctx);
    const { messageId } = await chatAgent.saveMessage(ctx, {
      threadId,
      prompt: trimmed,
      skipEmbeddings: true,
    });

    await ctx.scheduler.runAfter(0, internal.chat.streamReply, {
      threadId,
      promptMessageId: messageId,
    });

    return { threadId };
  },
});

export const streamReply = internalAction({
  args: { threadId: v.string(), promptMessageId: v.string() },
  handler: async (ctx, { threadId, promptMessageId }) => {
    const result = await chatAgent.streamText(
      ctx,
      { threadId },
      { promptMessageId },
      { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
    );
    await result.consumeStream();
  },
});

export const listMessages = query({
  args: {
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    const threadId = await getUserThreadId(ctx);
    if (!threadId) {
      const streams =
        args.streamArgs?.kind === "deltas"
          ? ({ kind: "deltas" as const, deltas: [] })
          : ({ kind: "list" as const, messages: [] });
      return {
        page: [],
        isDone: true,
        continueCursor: "",
        streams,
      };
    }
    const streams = await syncStreams(ctx, components.agent, {
      threadId,
      streamArgs: args.streamArgs,
    });
    const paginated = await listUIMessages(ctx, components.agent, {
      threadId,
      paginationOpts: args.paginationOpts,
    });
    return { ...paginated, streams };
  },
});
