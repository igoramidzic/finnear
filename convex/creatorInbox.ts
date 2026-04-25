import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";

export const getPendingTarget = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("creatorInbox").first();
  },
});

export const setPendingTarget = internalMutation({
  args: { pendingUserPhone: v.string() },
  handler: async (ctx, { pendingUserPhone }) => {
    const existing = await ctx.db.query("creatorInbox").first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { pendingUserPhone, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("creatorInbox", {
      pendingUserPhone,
      updatedAt: now,
    });
  },
});
