import { ConvexError } from "convex/values";
import type {
  GenericActionCtx,
  GenericMutationCtx,
  GenericQueryCtx,
} from "convex/server";

import { query } from "./_generated/server";
import type { DataModel } from "./_generated/dataModel";

type QueryCtx = GenericQueryCtx<DataModel>;
type MutationCtx = GenericMutationCtx<DataModel>;
type ActionCtx = GenericActionCtx<DataModel>;

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const userProfile = await ctx.db
      .query("userProfile")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .first();

    return userProfile;
  },
});

export async function requireAuth(ctx: QueryCtx | MutationCtx | ActionCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Authentication required");
  return identity;
}

export async function requireUserProfile(ctx: QueryCtx | MutationCtx) {
  const identity = await requireAuth(ctx);

  const userProfile = await ctx.db
    .query("userProfile")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
    .first();

  if (!userProfile) throw new ConvexError("User profile not found");
  return { identity, userProfile };
}
