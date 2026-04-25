import { tool } from "ai";
import { z } from "zod";
// @ts-expect-error tz-lookup ships no type definitions
import tzLookup from "tz-lookup";

import { internal } from "../../_generated/api";
import type { ActionCtx } from "../../_generated/server";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "Finnear/1.0 (https://finnear.app)";

type Geo = {
  lat: number;
  lng: number;
  region?: string;
  country?: string;
};

async function geocodeCity(city: string): Promise<Geo | null> {
  const params = new URLSearchParams({
    q: city,
    format: "jsonv2",
    addressdetails: "1",
    limit: "1",
  });
  const res = await fetch(`${NOMINATIM_URL}?${params}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) return null;

  const results = (await res.json()) as Array<{
    lat: string;
    lon: string;
    address?: { state?: string; region?: string; country_code?: string };
  }>;
  const hit = results[0];
  if (!hit) return null;

  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    lat,
    lng,
    region: hit.address?.state ?? hit.address?.region,
    country: hit.address?.country_code?.toUpperCase(),
  };
}

export function setUserMetadataTool(ctx: ActionCtx, userKey: string) {
  return tool({
    description:
      "Save what you've learned about the user. Call this whenever the user " +
      "mentions their name or where they live (city). Timezone is derived " +
      "from city automatically — never ask the user for their timezone.",
    inputSchema: z.object({
      name: z.string().optional().describe("User's first name or preferred name."),
      city: z
        .string()
        .optional()
        .describe("City the user lives in, e.g. 'Austin' or 'Austin, TX'."),
    }),
    execute: async ({ name, city }) => {
      const patch: {
        name?: string;
        city?: string;
        region?: string;
        country?: string;
        lat?: number;
        lng?: number;
        timezone?: string;
      } = {};

      if (name) patch.name = name;

      if (city) {
        const geo = await geocodeCity(city);
        if (!geo) {
          return {
            ok: false as const,
            reason: `could not resolve city "${city}"`,
          };
        }
        patch.city = city;
        patch.lat = geo.lat;
        patch.lng = geo.lng;
        if (geo.region) patch.region = geo.region;
        if (geo.country) patch.country = geo.country;
        try {
          patch.timezone = tzLookup(geo.lat, geo.lng) as string;
        } catch (err) {
          console.warn("tz-lookup failed", err);
        }
      }

      if (Object.keys(patch).length === 0) {
        return { ok: false as const, reason: "nothing to save" };
      }

      await ctx.runMutation(internal.userMetadata.upsertByUserKey, {
        userKey,
        patch,
      });

      return { ok: true as const, saved: Object.keys(patch) };
    },
  });
}
