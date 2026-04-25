import type { ToolSet } from "ai";

import type { ActionCtx } from "../_generated/server";
import { BUILTIN_TOOLS } from "./builtin";

// Builds the toolset for a given user/thread. Today this is just built-ins;
// once user integrations exist this will look up `userIntegration` rows for
// `userKey`, instantiate each connected integration's tools via its
// `buildTools(config)`, and merge them into the result.
export async function buildToolsFor(_ctx: ActionCtx, _userKey: string): Promise<ToolSet> {
  return { ...BUILTIN_TOOLS };
}
