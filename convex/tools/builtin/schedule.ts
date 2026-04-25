import { tool } from "ai";
import { z } from "zod";

import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import type { ActionCtx } from "../../_generated/server";
import {
  nextRunFromCron,
  parseIsoInTz,
  validateCron,
} from "../../lib/cron";

async function getTimezone(
  ctx: ActionCtx,
  userKey: string,
): Promise<string | null> {
  const meta = await ctx.runQuery(internal.userMetadata.getByUserKey, {
    userKey,
  });
  return meta?.timezone ?? null;
}

export function createScheduleTool(ctx: ActionCtx, userKey: string) {
  return tool({
    description:
      "Schedule a future task. The description is an instruction to yourself, in imperative second person, telling the firing run what SMS to produce — not the SMS text itself. " +
      "Examples: 'Look up the current weather in the user's city and text them a brief summary.' / 'Send the user the literal text: Hello' / 'Send the user a short reminder that they wanted to call mom.' " +
      "Use cron for recurring schedules and runAtIso for one-time. Exactly one must be provided.",
    inputSchema: z.object({
      description: z
        .string()
        .min(1)
        .describe(
          "Imperative instruction to the firing run describing what SMS to produce. Not the SMS text. E.g. 'Send the user the literal text: Hello' or 'Look up the weather in the user's city and text them a brief summary.'",
        ),
      cron: z
        .string()
        .optional()
        .describe(
          "5-field crontab in the user's timezone, e.g. '0 6 * * *' for 6am daily, '0 9 * * 1' for Mondays at 9am.",
        ),
      runAtIso: z
        .string()
        .optional()
        .describe(
          "ISO 8601 datetime for one-time schedules. If no offset is given, interpreted in the user's timezone.",
        ),
    }),
    execute: async ({ description, cron, runAtIso }) => {
      const timezone = await getTimezone(ctx, userKey);
      if (!timezone) {
        return {
          ok: false as const,
          reason:
            "I need to know where you live first — what city? (Call setUserMetadata with the city, then try again.)",
        };
      }

      if (!!cron === !!runAtIso) {
        return {
          ok: false as const,
          reason: "Provide exactly one of cron or runAtIso.",
        };
      }

      if (cron) {
        const valid = validateCron(cron, timezone);
        if (!valid.ok) {
          return { ok: false as const, reason: `Invalid cron: ${valid.reason}` };
        }
        const nextRunAt = nextRunFromCron(cron, timezone);
        const scheduleId = await ctx.runMutation(
          internal.schedule.createSchedule,
          {
            userKey,
            description,
            kind: "cron",
            cron,
            timezone,
            nextRunAt,
          },
        );
        return {
          ok: true as const,
          scheduleId,
          nextRunAt: new Date(nextRunAt).toISOString(),
        };
      }

      const runAt = parseIsoInTz(runAtIso!, timezone);
      if (runAt === null) {
        return {
          ok: false as const,
          reason: `Could not parse runAtIso "${runAtIso}".`,
        };
      }
      if (runAt <= Date.now()) {
        return {
          ok: false as const,
          reason: "runAtIso is in the past.",
        };
      }
      const scheduleId = await ctx.runMutation(
        internal.schedule.createSchedule,
        {
          userKey,
          description,
          kind: "once",
          runAt,
          timezone,
          nextRunAt: runAt,
        },
      );
      return {
        ok: true as const,
        scheduleId,
        nextRunAt: new Date(runAt).toISOString(),
      };
    },
  });
}

export function updateScheduleTool(ctx: ActionCtx, userKey: string) {
  return tool({
    description:
      "Edit an existing schedule. Use when the user wants to change the time, recurrence, or description of a reminder they already created (e.g. 'change it to 5 minutes', 'make it weekly instead', 'actually remind me to walk the dog'). " +
      "Look up the schedule first via listSchedules to get its id. Pass only the fields you want to change.",
    inputSchema: z.object({
      scheduleId: z.string().describe("The schedule's id from listSchedules."),
      description: z
        .string()
        .optional()
        .describe("New verbatim prompt to run when the schedule fires."),
      cron: z
        .string()
        .optional()
        .describe(
          "New 5-field crontab in the user's timezone. Switches the schedule to recurring.",
        ),
      runAtIso: z
        .string()
        .optional()
        .describe(
          "New ISO 8601 datetime. Switches the schedule to one-time. No offset means user's timezone.",
        ),
    }),
    execute: async ({ scheduleId, description, cron, runAtIso }) => {
      const id = scheduleId as Id<"schedule">;
      const row = await ctx.runQuery(internal.schedule.getById, {
        scheduleId: id,
      });
      if (!row || row.userKey !== userKey) {
        return { ok: false as const, reason: "schedule not found" };
      }
      if (cron && runAtIso) {
        return {
          ok: false as const,
          reason: "Provide cron or runAtIso, not both.",
        };
      }
      if (description === undefined && !cron && !runAtIso) {
        return { ok: false as const, reason: "nothing to update" };
      }

      const timezone = row.timezone;

      const patch: {
        scheduleId: Id<"schedule">;
        description?: string;
        kind?: "once" | "cron";
        cron?: string;
        runAt?: number;
        nextRunAt?: number;
      } = { scheduleId: id };

      if (description !== undefined) patch.description = description;

      if (cron) {
        const valid = validateCron(cron, timezone);
        if (!valid.ok) {
          return { ok: false as const, reason: `Invalid cron: ${valid.reason}` };
        }
        patch.kind = "cron";
        patch.cron = cron;
        patch.nextRunAt = nextRunFromCron(cron, timezone);
      } else if (runAtIso) {
        const runAt = parseIsoInTz(runAtIso, timezone);
        if (runAt === null) {
          return {
            ok: false as const,
            reason: `Could not parse runAtIso "${runAtIso}".`,
          };
        }
        if (runAt <= Date.now()) {
          return { ok: false as const, reason: "runAtIso is in the past." };
        }
        patch.kind = "once";
        patch.runAt = runAt;
        patch.nextRunAt = runAt;
      }

      await ctx.runMutation(internal.schedule.updateSchedule, patch);
      return {
        ok: true as const,
        scheduleId: id,
        nextRunAt: patch.nextRunAt
          ? new Date(patch.nextRunAt).toISOString()
          : new Date(row.nextRunAt).toISOString(),
      };
    },
  });
}

export function listSchedulesTool(ctx: ActionCtx, userKey: string) {
  return tool({
    description:
      "List the user's active schedules (reminders and recurring tasks). Use when the user asks what's scheduled or wants to review reminders.",
    inputSchema: z.object({}),
    execute: async () => {
      const rows = await ctx.runQuery(internal.schedule.listActiveByUserKey, {
        userKey,
      });
      return {
        ok: true as const,
        schedules: rows.map((r) => ({
          scheduleId: r._id,
          description: r.description,
          kind: r.kind,
          cron: r.cron,
          timezone: r.timezone,
          nextRunAt: new Date(r.nextRunAt).toISOString(),
        })),
      };
    },
  });
}

export function cancelScheduleTool(ctx: ActionCtx, userKey: string) {
  return tool({
    description:
      "Cancel a schedule by id. Get ids from listSchedules first if you don't know them.",
    inputSchema: z.object({
      scheduleId: z.string().describe("The schedule's id from listSchedules."),
    }),
    execute: async ({ scheduleId }) => {
      const row = await ctx.runQuery(internal.schedule.getById, {
        scheduleId: scheduleId as Id<"schedule">,
      });
      if (!row) {
        return { ok: false as const, reason: "schedule not found" };
      }
      if (row.userKey !== userKey) {
        return { ok: false as const, reason: "schedule not found" };
      }
      await ctx.runMutation(internal.schedule.cancelSchedule, {
        scheduleId: scheduleId as Id<"schedule">,
      });
      return { ok: true as const };
    },
  });
}
