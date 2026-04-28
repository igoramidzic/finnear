"use node";

import { createThread } from "@convex-dev/agent";
import { v } from "convex/values";

import { components, internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import {
  BASE_INSTRUCTIONS,
  buildIntegrationsContext,
  buildSystemContext,
  chatAgent,
} from "./chat";
import { nextRunFromCron } from "./lib/cron";
import { buildToolsFor } from "./tools";

export const fire = internalAction({
  args: { scheduleId: v.id("schedule") },
  handler: async (ctx, { scheduleId }) => {
    const schedule = await ctx.runQuery(internal.schedule.getById, {
      scheduleId,
    });
    if (!schedule || !schedule.active) return;

    const { userKey, description, kind, cron, timezone } = schedule;

    const { tools, connected } = await buildToolsFor(ctx, userKey);
    const meta = await ctx.runQuery(internal.userMetadata.getByUserKey, {
      userKey,
    });
    const integrations = buildIntegrationsContext(connected);
    const system = [
      BASE_INSTRUCTIONS,
      buildSystemContext(meta),
      integrations,
      "This is a scheduled run. The next user message is NOT a chat message from the user — it is an instruction the user previously committed to via createSchedule, telling you what to do for them right now. " +
        "Execute the instruction and produce the SMS that should be sent to the user. " +
        "If the instruction says to send specific literal text (e.g. \"send the user 'Hello'\"), output exactly that text and nothing else — no greeting, no commentary. " +
        "Do not call createSchedule, listSchedules, updateSchedule, or cancelSchedule.",
    ]
      .filter(Boolean)
      .join("\n\n");

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
      await ctx.runAction(internal.sendblueActions.sendOutbound, {
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
