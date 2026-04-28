import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";

const kindValidator = v.union(v.literal("once"), v.literal("cron"));

export const getById = internalQuery({
  args: { scheduleId: v.id("schedule") },
  handler: async (ctx, { scheduleId }) => {
    return await ctx.db.get(scheduleId);
  },
});

export const listActiveByUserKey = internalQuery({
  args: { userKey: v.string() },
  handler: async (ctx, { userKey }) => {
    return await ctx.db
      .query("schedule")
      .withIndex("by_userKey_active", (q) =>
        q.eq("userKey", userKey).eq("active", true),
      )
      .collect();
  },
});

export const createSchedule = internalMutation({
  args: {
    userKey: v.string(),
    description: v.string(),
    kind: kindValidator,
    cron: v.optional(v.string()),
    runAt: v.optional(v.number()),
    timezone: v.string(),
    nextRunAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const scheduleId = await ctx.db.insert("schedule", {
      userKey: args.userKey,
      description: args.description,
      kind: args.kind,
      cron: args.cron,
      runAt: args.runAt,
      timezone: args.timezone,
      nextRunAt: args.nextRunAt,
      active: true,
      createdAt: now,
      updatedAt: now,
    });

    const scheduledFunctionId = await ctx.scheduler.runAt(
      args.nextRunAt,
      internal.scheduleActions.fire,
      { scheduleId },
    );
    await ctx.db.patch(scheduleId, { scheduledFunctionId });

    return scheduleId;
  },
});

export const updateSchedule = internalMutation({
  args: {
    scheduleId: v.id("schedule"),
    description: v.optional(v.string()),
    kind: v.optional(kindValidator),
    cron: v.optional(v.string()),
    runAt: v.optional(v.number()),
    nextRunAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.scheduleId);
    if (!row) return null;

    const patch: {
      description?: string;
      kind?: "once" | "cron";
      cron?: string;
      runAt?: number;
      nextRunAt?: number;
      scheduledFunctionId?: Id<"_scheduled_functions">;
      updatedAt: number;
    } = { updatedAt: Date.now() };

    if (args.description !== undefined) patch.description = args.description;
    if (args.kind !== undefined) {
      patch.kind = args.kind;
      if (args.kind === "cron") patch.runAt = undefined;
      if (args.kind === "once") patch.cron = undefined;
    }
    if (args.cron !== undefined) patch.cron = args.cron;
    if (args.runAt !== undefined) patch.runAt = args.runAt;

    if (args.nextRunAt !== undefined && args.nextRunAt !== row.nextRunAt) {
      if (row.scheduledFunctionId) {
        await ctx.scheduler.cancel(row.scheduledFunctionId);
      }
      patch.nextRunAt = args.nextRunAt;
      patch.scheduledFunctionId = await ctx.scheduler.runAt(
        args.nextRunAt,
        internal.scheduleActions.fire,
        { scheduleId: args.scheduleId },
      );
    }

    await ctx.db.patch(args.scheduleId, patch);
    return args.scheduleId;
  },
});

export const cancelSchedule = internalMutation({
  args: { scheduleId: v.id("schedule") },
  handler: async (ctx, { scheduleId }) => {
    const row = await ctx.db.get(scheduleId);
    if (!row) return;
    if (row.scheduledFunctionId) {
      await ctx.scheduler.cancel(row.scheduledFunctionId);
    }
    await ctx.db.patch(scheduleId, {
      active: false,
      scheduledFunctionId: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const completeOnce = internalMutation({
  args: { scheduleId: v.id("schedule") },
  handler: async (ctx, { scheduleId }) => {
    await ctx.db.patch(scheduleId, {
      active: false,
      scheduledFunctionId: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const rescheduleNext = internalMutation({
  args: {
    scheduleId: v.id("schedule"),
    nextRunAt: v.number(),
  },
  handler: async (ctx, { scheduleId, nextRunAt }) => {
    const scheduledFunctionId = await ctx.scheduler.runAt(
      nextRunAt,
      internal.scheduleActions.fire,
      { scheduleId },
    );
    await ctx.db.patch(scheduleId, {
      nextRunAt,
      scheduledFunctionId,
      updatedAt: Date.now(),
    });
  },
});

