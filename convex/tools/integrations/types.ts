import type { ToolSet } from "ai";

import type { ActionCtx } from "../../_generated/server";

export type IntegrationResult = {
  tools: ToolSet;
  // toolkit slug -> tool names actually loaded for this user
  // (e.g. "mem0" -> ["MEM0_ADD_MEMORY", "MEM0_SEARCH_MEMORIES"]).
  connected: Record<string, string[]>;
};

export type IntegrationDefinition = {
  id: string;
  name: string;
  description: string;
  buildTools: (
    ctx: ActionCtx,
    opts: { userKey: string },
  ) => Promise<IntegrationResult> | IntegrationResult;
};
