import type { ToolSet } from "ai";

import type { ActionCtx } from "../../_generated/server";

export type IntegrationResult = {
  tools: ToolSet;
  // toolkit slug -> tool names actually loaded for this user
  // (e.g. "gmail" -> ["GMAIL_SEND_EMAIL", "GMAIL_FETCH_EMAILS"]).
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
