import { Agent, createTool } from "@convex-dev/agent";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

import { components } from "./_generated/api";

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
    "You are Finnear's helpful assistant. Reply in 1-3 short sentences when possible. " +
    "Plain text only — no markdown, no bullet points, no headings. " +
    "Be direct and skip filler (\"Sure!\", \"Great question\"). " +
    "Write everything in lowercase, including proper nouns and the start of sentences, unless the user explicitly asks for normal capitalization or uppercase. " +
    "Use the getWeather tool for weather questions and the getTopNews tool for news or headlines, then summarize the result tersely.",
  tools: { getWeather, getTopNews },
  contextOptions: {
    recentMessages: 20,
    excludeToolMessages: true,
  },
});
