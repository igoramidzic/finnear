import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";

export const getByUserKey = internalQuery({
  args: { userKey: v.string() },
  handler: async (ctx, { userKey }) => {
    return await ctx.db
      .query("userMetadata")
      .withIndex("by_userKey", (q) => q.eq("userKey", userKey))
      .first();
  },
});

export const upsertByUserKey = internalMutation({
  args: {
    userKey: v.string(),
    patch: v.object({
      name: v.optional(v.string()),
      city: v.optional(v.string()),
      region: v.optional(v.string()),
      country: v.optional(v.string()),
      lat: v.optional(v.number()),
      lng: v.optional(v.number()),
      timezone: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { userKey, patch }) => {
    const existing = await ctx.db
      .query("userMetadata")
      .withIndex("by_userKey", (q) => q.eq("userKey", userKey))
      .first();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { ...patch, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("userMetadata", {
      userKey,
      ...patch,
      updatedAt: now,
    });
  },
});
