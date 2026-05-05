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
        "Your ONLY output channel is your text reply, which is sent to the user as an SMS. " +
        "When the instruction says 'send the user', 'remind the user', 'tell the user', or anything similar, that means: produce the SMS text in your reply. It does NOT mean send an email, Slack message, Gmail draft, calendar invite, or any other integration message — even if the user has Gmail/Slack/etc. connected. " +
        "Do NOT call any messaging, email, chat, calendar, or notification tool to deliver the reminder (no GMAIL_*, SLACK_*, DISCORD_*, GOOGLECALENDAR_*, etc. send/create/draft tools). Only call read/lookup tools if the instruction requires fetching information first (e.g. 'look up the weather and text it'). " +
        "If the instruction says to send specific literal text (e.g. \"send the user 'Hello'\"), output exactly that text and nothing else — no greeting, no commentary. " +
        "Critical phrasing rule: the instruction is written in second person addressing YOU; the SMS you produce is addressed to the user. Transform, don't paraphrase the verb. " +
        "Examples — instruction \"Send the user a reminder to text bandeguz about grabbing a beer\" → SMS \"don't forget to text bandeguz about grabbing a beer\" (NOT \"remind bandeguz...\"). " +
        "Instruction \"Send the user a reminder to call mom\" → SMS \"reminder: call mom\" or \"don't forget to call mom\" (NOT \"remind mom...\"). " +
        "Instruction \"Send the user a reminder that they wanted to buy plushies\" → SMS \"heads up — you wanted to buy plushies\". " +
        "Any third-party name in the instruction (bandeguz, mom, a coworker) is a person the USER wants to contact or do something with — never the recipient of your SMS. The SMS recipient is always the user. " +
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
