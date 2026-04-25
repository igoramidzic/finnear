import type { ToolSet } from "ai";

import type { ActionCtx } from "../_generated/server";
import { BUILTIN_TOOLS } from "./builtin";
import { forwardToCreatorTool } from "./builtin/forwardToCreator";
import {
  cancelScheduleTool,
  createScheduleTool,
  listSchedulesTool,
  updateScheduleTool,
} from "./builtin/schedule";
import { setUserMetadataTool } from "./builtin/userMetadata";

// Builds the toolset for a given user/thread. Today this is just built-ins +
// the metadata capture tool; once user integrations exist this will look up
// `userIntegration` rows for `userKey`, instantiate each connected
// integration's tools via its `buildTools(config)`, and merge them in.
export async function buildToolsFor(ctx: ActionCtx, userKey: string): Promise<ToolSet> {
  return {
    ...BUILTIN_TOOLS,
    setUserMetadata: setUserMetadataTool(ctx, userKey),
    createSchedule: createScheduleTool(ctx, userKey),
    listSchedules: listSchedulesTool(ctx, userKey),
    updateSchedule: updateScheduleTool(ctx, userKey),
    cancelSchedule: cancelScheduleTool(ctx, userKey),
    forwardToCreator: forwardToCreatorTool(ctx, userKey),
  };
}
