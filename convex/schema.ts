import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  userProfile: defineTable({
    clerkId: v.string(),
    email: v.string(),
    chatThreadId: v.optional(v.string()),
  }).index("by_clerkId", ["clerkId"]),

  smsUser: defineTable({
    phoneNumber: v.string(),
    chatThreadId: v.string(),
    lastMessageAt: v.number(),
  }).index("by_phone", ["phoneNumber"]),
});
