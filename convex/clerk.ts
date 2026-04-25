import { v } from "convex/values";

import { internalMutation } from "./_generated/server";

export const upsertUserFromClerk = internalMutation({
  args: {
    clerkId: v.string(),
    email: v.string(),
  },
  handler: async (ctx, { clerkId, email }) => {
    const existing = await ctx.db
      .query("userProfile")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId))
      .first();

    if (existing) {
      if (existing.email !== email) {
        await ctx.db.patch(existing._id, { email });
      }
      return existing._id;
    }

    return await ctx.db.insert("userProfile", { clerkId, email });
  },
});

export const deleteUserFromClerk = internalMutation({
  args: { clerkId: v.string() },
  handler: async (ctx, { clerkId }) => {
    const existing = await ctx.db
      .query("userProfile")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId))
      .first();
    if (existing) await ctx.db.delete(existing._id);
  },
});
