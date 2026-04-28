"use node";

import type { ToolSet } from "ai";

import type { ActionCtx } from "../_generated/server";
import { BUILTIN_TOOLS } from "./builtin";
import {
  cancelScheduleTool,
  createScheduleTool,
  listSchedulesTool,
  updateScheduleTool,
} from "./builtin/schedule";
import { setUserMetadataTool } from "./builtin/userMetadata";
import { INTEGRATIONS } from "./integrations";

export type BuiltTools = {
  tools: ToolSet;
  // toolkit slug -> tool names actually loaded for this user, merged across
  // every integration. Used by chat.ts to tell the model what's available.
  connected: Record<string, string[]>;
};

// Builds the toolset for a given user/thread: built-ins + per-user metadata
// and schedule tools + every registered integration's user-specific tools
// (e.g. Composio toolkits the user has connected).
export async function buildToolsFor(
  ctx: ActionCtx,
  userKey: string,
): Promise<BuiltTools> {
  const tools: ToolSet = {
    ...BUILTIN_TOOLS,
    setUserMetadata: setUserMetadataTool(ctx, userKey),
    createSchedule: createScheduleTool(ctx, userKey),
    listSchedules: listSchedulesTool(ctx, userKey),
    updateSchedule: updateScheduleTool(ctx, userKey),
    cancelSchedule: cancelScheduleTool(ctx, userKey),
  };
  const connected: Record<string, string[]> = {};

  for (const integration of INTEGRATIONS) {
    try {
      const result = await integration.buildTools(ctx, { userKey });
      Object.assign(tools, result.tools);
      for (const [slug, names] of Object.entries(result.connected)) {
        connected[slug] = [...(connected[slug] ?? []), ...names];
      }
    } catch (err) {
      console.warn(
        `Integration "${integration.id}" failed to build tools:`,
        err,
      );
    }
  }

  return { tools, connected };
}
