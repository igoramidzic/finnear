"use node";

import { composioIntegration } from "./composio";
import type { IntegrationDefinition } from "./types";

// Per-user integrations the agent can pull tools from. Each integration's
// `buildTools(ctx, { userKey })` runs at chat time and returns whichever tools
// the user has authorized.
export const INTEGRATIONS: IntegrationDefinition[] = [composioIntegration];
