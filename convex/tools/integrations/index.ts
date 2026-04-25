import type { IntegrationDefinition } from "./types";

// Per-user integrations the agent can pull tools from. Each user picks which to
// connect; their stored config gets passed to `buildTools` at chat time.
//
// Empty for now — connect/disconnect UI and the `userIntegration` table land in
// follow-up PRs. Example shape for when we add Kualia first:
//
// const kualia: IntegrationDefinition<{ apiKey: string; workspaceId: string }> = {
//   id: "kualia",
//   name: "Kualia",
//   description: "Query budget envelopes, transactions, and spending reports.",
//   buildTools: (_ctx, { apiKey, workspaceId }) => ({
//     kualia_listTransactions: createTool({ ... }),
//     kualia_getEnvelopeStatus: createTool({ ... }),
//   }),
// };
export const INTEGRATIONS: IntegrationDefinition[] = [];
