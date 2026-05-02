"use node";

import { Composio } from "@composio/core";
import { VercelProvider } from "@composio/vercel";
import { tool, type ToolSet } from "ai";
import { z } from "zod";

import type { ActionCtx } from "../../_generated/server";
import type { IntegrationDefinition, IntegrationResult } from "./types";

let cachedClient: Composio<VercelProvider> | null = null;

// Toolkits that should be auto-connected for every user the first time we
// see them. Empty by default — add API-key toolkits here if you want them
// available without a connect step.
const ALWAYS_ON_TOOLKITS: readonly string[] = [];

function getClient(): Composio<VercelProvider> | null {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return null;
  if (!cachedClient) {
    cachedClient = new Composio({ apiKey, provider: new VercelProvider() });
  }
  return cachedClient;
}

async function listConnectedToolkitSlugs(
  composio: Composio<VercelProvider>,
  userKey: string,
): Promise<Set<string>> {
  const accounts = await composio.connectedAccounts.list({
    userIds: [userKey],
    statuses: ["ACTIVE"],
  });
  const slugs = new Set<string>();
  for (const acct of accounts.items ?? []) {
    if (acct.toolkit?.slug) slugs.add(acct.toolkit.slug);
  }
  return slugs;
}

async function ensureAlwaysOnConnections(
  composio: Composio<VercelProvider>,
  userKey: string,
  alreadyConnected: Set<string>,
) {
  for (const slug of ALWAYS_ON_TOOLKITS) {
    if (alreadyConnected.has(slug)) continue;
    try {
      const configs = await composio.authConfigs.list({ toolkit: slug });
      const cfg =
        configs.items?.find((c) => c.isComposioManaged) ?? configs.items?.[0];
      if (!cfg) {
        console.warn(
          `[composio] no auth config found for ${slug}; create one in the Composio dashboard`,
        );
        continue;
      }
      const linked = await composio.connectedAccounts.link(userKey, cfg.id);
      const status = (linked as { status?: string }).status;
      if (status === "ACTIVE") {
        alreadyConnected.add(slug);
      } else {
        // INITIATED means the auth config isn't Composio-managed; the user
        // would need to finish auth through linked.redirectUrl. Don't surface
        // the toolkit's tools to the model — they'd 401 at call time.
        console.warn(
          `[composio] auto-connect for ${slug} returned status=${status}; make the auth config Composio-managed so link() activates immediately.`,
        );
      }
    } catch (err) {
      console.warn(
        `[composio] failed to auto-connect "${slug}" for ${userKey}`,
        err,
      );
    }
  }
}

function connectComposioTool(
  composio: Composio<VercelProvider>,
  userKey: string,
) {
  return tool({
    description:
      "Start a new Composio connection so the user can authorize a third-party app (any toolkit slug, e.g. gmail, github, slack, linear, googlecalendar, notion, etc). For OAuth toolkits returns a URL the user opens to finish auth; for API-key toolkits the connection is created immediately. After connecting, the toolkit's tools become available on the next message.",
    inputSchema: z.object({
      toolkit: z
        .string()
        .describe(
          "Toolkit slug to connect, lowercase. Examples: 'gmail', 'github', 'slack', 'linear', 'googlecalendar', 'notion'.",
        ),
    }),
    execute: async ({ toolkit }) => {
      const slug = toolkit.toLowerCase().trim();

      const configs = await composio.authConfigs.list({ toolkit: slug });
      const authConfig =
        configs.items?.find((c) => c.isComposioManaged) ?? configs.items?.[0];
      if (!authConfig) {
        return {
          ok: false as const,
          reason: `No auth config found for toolkit "${slug}". Create one in the Composio dashboard first.`,
        };
      }

      const conn = await composio.connectedAccounts.link(userKey, authConfig.id);
      if (conn.redirectUrl) {
        return { ok: true as const, toolkit: slug, url: conn.redirectUrl };
      }
      // API-key style toolkits link without a redirect; the connection is
      // already active.
      return { ok: true as const, toolkit: slug, connected: true as const };
    },
  });
}

function groupToolsByToolkit(loaded: ToolSet, toolkits: string[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const slug of toolkits) result[slug] = [];
  for (const name of Object.keys(loaded)) {
    const prefix = name.split("_", 1)[0]?.toLowerCase();
    if (prefix && result[prefix]) result[prefix].push(name);
  }
  // Drop toolkits where Composio didn't expose any tools.
  for (const slug of Object.keys(result)) {
    if (result[slug].length === 0) delete result[slug];
  }
  return result;
}

export const composioIntegration: IntegrationDefinition = {
  id: "composio",
  name: "Composio",
  description:
    "Per-user toolkit connections (Gmail, GitHub, Slack, Linear, etc.) backed by Composio.",
  async buildTools(_ctx: ActionCtx, { userKey }): Promise<IntegrationResult> {
    const composio = getClient();
    if (!composio) return { tools: {}, connected: {} };

    const tools: ToolSet = {
      composio_connect: connectComposioTool(composio, userKey),
    };
    const connected: Record<string, string[]> = {};

    try {
      const slugSet = await listConnectedToolkitSlugs(composio, userKey);
      await ensureAlwaysOnConnections(composio, userKey, slugSet);
      const toolkits = [...slugSet];
      if (toolkits.length === 0) return { tools, connected };

      // Fetch per-toolkit. A single tools.get with multiple toolkits competes
      // for one global `limit`, and toolkits with many tools (e.g. Gmail)
      // alphabetically crowd out smaller toolkits.
      const loaded: ToolSet = {};
      for (const slug of toolkits) {
        try {
          const t = (await composio.tools.get(userKey, {
            toolkits: [slug],
            limit: 50,
          })) as ToolSet;
          Object.assign(loaded, t);
        } catch (err) {
          console.warn(`[composio] tools.get(${slug}) failed`, err);
        }
      }
      Object.assign(tools, loaded);
      Object.assign(connected, groupToolsByToolkit(loaded, toolkits));
    } catch (err) {
      console.warn("Composio: failed to load connected tools", err);
    }

    return { tools, connected };
  },
};
