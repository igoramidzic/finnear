import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  userProfile: defineTable({
    clerkId: v.string(),
    email: v.string(),
  }).index("by_clerkId", ["clerkId"]),
});
