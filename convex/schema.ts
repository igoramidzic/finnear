import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  smsUser: defineTable({
    phoneNumber: v.string(),
    chatThreadId: v.string(),
    lastMessageAt: v.number(),
  }).index("by_phone", ["phoneNumber"]),

  userMetadata: defineTable({
    userKey: v.string(),
    name: v.optional(v.string()),
    city: v.optional(v.string()),
    region: v.optional(v.string()),
    country: v.optional(v.string()),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    timezone: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_userKey", ["userKey"]),

  creatorInbox: defineTable({
    pendingUserPhone: v.string(),
    updatedAt: v.number(),
  }),

  schedule: defineTable({
    userKey: v.string(),
    description: v.string(),
    kind: v.union(v.literal("once"), v.literal("cron")),
    cron: v.optional(v.string()),
    runAt: v.optional(v.number()),
    timezone: v.string(),
    nextRunAt: v.number(),
    scheduledFunctionId: v.optional(v.id("_scheduled_functions")),
    active: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userKey", ["userKey"])
    .index("by_userKey_active", ["userKey", "active"]),
});
