import { createThread } from "@convex-dev/agent";
import { v } from "convex/values";

import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { BASE_INSTRUCTIONS, buildSystemContext, chatAgent } from "./chat";
import { nextRunFromCron } from "./lib/cron";
import { buildToolsFor } from "./tools";

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
      internal.schedule.fire,
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
        internal.schedule.fire,
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
      internal.schedule.fire,
      { scheduleId },
    );
    await ctx.db.patch(scheduleId, {
      nextRunAt,
      scheduledFunctionId,
      updatedAt: Date.now(),
    });
  },
});

export const fire = internalAction({
  args: { scheduleId: v.id("schedule") },
  handler: async (ctx, { scheduleId }) => {
    const schedule = await ctx.runQuery(internal.schedule.getById, {
      scheduleId,
    });
    if (!schedule || !schedule.active) return;

    const { userKey, description, kind, cron, timezone } = schedule;

    const tools = await buildToolsFor(ctx, userKey);
    const meta = await ctx.runQuery(internal.userMetadata.getByUserKey, {
      userKey,
    });
    const system =
      `${BASE_INSTRUCTIONS}\n\n${buildSystemContext(meta)}\n\n` +
      "This is a scheduled run. The next user message is NOT a chat message from the user — it is an instruction the user previously committed to via createSchedule, telling you what to do for them right now. " +
      "Execute the instruction and produce the SMS that should be sent to the user. " +
      "If the instruction says to send specific literal text (e.g. \"send the user 'Hello'\"), output exactly that text and nothing else — no greeting, no commentary. " +
      "Do not call createSchedule, listSchedules, updateSchedule, or cancelSchedule.";

    const threadId = await createThread(ctx, components.agent, {
      userId: userKey,
      title: `scheduled: ${description.slice(0, 40)}`,
    });

    const result = await chatAgent.generateText(
      ctx,
      { threadId },
      { prompt: description, tools, system },
    );

    const reply = result.text.trim();
    if (reply) {
      await ctx.runAction(internal.sendblue.sendOutbound, {
        phoneNumber: userKey,
        content: reply,
      });
    } else {
      console.warn("Scheduled fire produced empty reply", { scheduleId });
    }

    if (kind === "once") {
      await ctx.runMutation(internal.schedule.completeOnce, { scheduleId });
      return;
    }

    if (kind === "cron" && cron) {
      const next = nextRunFromCron(cron, timezone);
      await ctx.runMutation(internal.schedule.rescheduleNext, {
        scheduleId,
        nextRunAt: next,
      });
    }
  },
});
