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

const MAX_RUN_IN_SECONDS = 366 * 24 * 60 * 60;

export function createScheduleTool(ctx: ActionCtx, userKey: string) {
  return tool({
    description:
      "Schedule a future task. The description is an instruction to yourself, in imperative second person, telling the firing run what SMS to produce — not the SMS text itself. " +
      "Examples: 'Look up the current weather in the user's city and text them a brief summary.' / 'Send the user the literal text: Hello' / 'Send the user a short reminder that they wanted to call mom.' " +
      "Provide exactly one of: cron (recurring), runInSeconds (relative one-time), runAtIso (absolute one-time). " +
      "Prefer runInSeconds for any 'in N minutes/hours/days' request — it avoids timezone math.",
    inputSchema: z.object({
      description: z
        .string()
        .min(1)
        .describe(
          "Imperative instruction to the firing run describing what SMS to produce. Not the SMS text. Must be self-contained: do NOT include relative time references like 'in 5 minutes', 'later today', 'tomorrow' — by the time it fires those words are wrong. E.g. 'Send the user the literal text: Hello' or 'Send the user a reminder to buy plushies.'",
        ),
      cron: z
        .string()
        .optional()
        .describe(
          "5-field crontab in the user's timezone, e.g. '0 6 * * *' for 6am daily, '0 9 * * 1' for Mondays at 9am.",
        ),
      runInSeconds: z
        .number()
        .int()
        .positive()
        .max(MAX_RUN_IN_SECONDS)
        .optional()
        .describe(
          "Seconds from now to fire. Use this for relative requests ('in 10 minutes' → 600, 'in 2 hours' → 7200, 'in 3 days' → 259200). Max ~1 year.",
        ),
      runAtIso: z
        .string()
        .optional()
        .describe(
          "ISO 8601 datetime for absolute one-time schedules ('tomorrow at 2pm', 'May 5 at 9am'). If no offset is given, interpreted as wall-clock time in the user's timezone. Do NOT use this for relative 'in N minutes' requests — use runInSeconds instead.",
        ),
    }),
    execute: async ({ description, cron, runInSeconds, runAtIso }) => {
      const timezone = await getTimezone(ctx, userKey);
      if (!timezone) {
        return {
          ok: false as const,
          reason:
            "I need to know where you live first — what city? (Call setUserMetadata with the city, then try again.)",
        };
      }

      const provided = [cron, runInSeconds, runAtIso].filter(
        (v) => v !== undefined && v !== null,
      ).length;
      if (provided !== 1) {
        return {
          ok: false as const,
          reason: "Provide exactly one of cron, runInSeconds, or runAtIso.",
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

      let runAt: number;
      if (runInSeconds !== undefined) {
        runAt = Date.now() + runInSeconds * 1000;
      } else {
        const parsed = parseIsoInTz(runAtIso!, timezone);
        if (parsed === null) {
          return {
            ok: false as const,
            reason: `Could not parse runAtIso "${runAtIso}".`,
          };
        }
        if (parsed <= Date.now()) {
          return {
            ok: false as const,
            reason: "runAtIso is in the past.",
          };
        }
        runAt = parsed;
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
      "Look up the schedule first via listSchedules to get its id. Pass only the fields you want to change. " +
      "Prefer runInSeconds for relative time changes — avoids timezone math.",
    inputSchema: z.object({
      scheduleId: z.string().describe("The schedule's id from listSchedules."),
      description: z
        .string()
        .optional()
        .describe(
          "New imperative instruction for the firing run. Must be self-contained — no relative time references like 'in 5 minutes' or 'tomorrow'.",
        ),
      cron: z
        .string()
        .optional()
        .describe(
          "New 5-field crontab in the user's timezone. Switches the schedule to recurring.",
        ),
      runInSeconds: z
        .number()
        .int()
        .positive()
        .max(MAX_RUN_IN_SECONDS)
        .optional()
        .describe(
          "Seconds from now to fire. Use for relative changes ('change it to 5 min from now' → 300). Switches the schedule to one-time.",
        ),
      runAtIso: z
        .string()
        .optional()
        .describe(
          "New ISO 8601 datetime for absolute times. Switches the schedule to one-time. No offset means user's wall-clock time. Do NOT use for relative requests — use runInSeconds.",
        ),
    }),
    execute: async ({ scheduleId, description, cron, runInSeconds, runAtIso }) => {
      const id = scheduleId as Id<"schedule">;
      const row = await ctx.runQuery(internal.schedule.getById, {
        scheduleId: id,
      });
      if (!row || row.userKey !== userKey) {
        return { ok: false as const, reason: "schedule not found" };
      }
      const timeFieldsProvided = [cron, runInSeconds, runAtIso].filter(
        (v) => v !== undefined && v !== null,
      ).length;
      if (timeFieldsProvided > 1) {
        return {
          ok: false as const,
          reason: "Provide at most one of cron, runInSeconds, or runAtIso.",
        };
      }
      if (description === undefined && timeFieldsProvided === 0) {
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
      } else if (runInSeconds !== undefined) {
        const runAt = Date.now() + runInSeconds * 1000;
        patch.kind = "once";
        patch.runAt = runAt;
        patch.nextRunAt = runAt;
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
