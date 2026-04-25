import type { ToolSet } from "ai";

import type { ActionCtx } from "../../_generated/server";

export type IntegrationDefinition<TConfig = unknown> = {
  id: string;
  name: string;
  description: string;
  buildTools: (ctx: ActionCtx, config: TConfig) => ToolSet;
};
