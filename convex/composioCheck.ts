"use node";

import { Composio } from "@composio/core";
import { VercelProvider } from "@composio/vercel";
import { v } from "convex/values";

import { internalAction } from "./_generated/server";

const COMPOSIO_BASE = "https://backend.composio.dev";

// Diagnostic: run from the Convex dashboard's Functions tab.
// - With no args: uses process.env.COMPOSIO_API_KEY.
// - With { apiKey: "ck_..." }: uses the raw value, bypassing env vars entirely.
//   Use this to confirm whether the env var got mangled vs. the key itself is invalid.
export const ping = internalAction({
  args: { apiKey: v.optional(v.string()) },
  handler: async (_ctx, { apiKey: argKey }) => {
    const apiKey = argKey ?? process.env.COMPOSIO_API_KEY;
    if (!apiKey) {
      return { ok: false as const, reason: "No apiKey arg and COMPOSIO_API_KEY not set" };
    }

    const source = argKey ? "arg" : "env";
    const fingerprint = {
      source,
      length: apiKey.length,
      prefix: apiKey.slice(0, 4),
      hasWhitespace: /\s/.test(apiKey),
      hasQuotes: apiKey.startsWith('"') || apiKey.startsWith("'"),
    };

    let raw: { status: number; body: string };
    try {
      const res = await fetch(`${COMPOSIO_BASE}/api/v3/auth_configs?limit=1`, {
        headers: { "x-api-key": apiKey },
      });
      raw = { status: res.status, body: (await res.text()).slice(0, 400) };
    } catch (err) {
      raw = { status: -1, body: err instanceof Error ? err.message : String(err) };
    }

    let sdk: { ok: boolean; detail: string };
    try {
      const composio = new Composio({ apiKey, provider: new VercelProvider() });
      const authConfigs = await composio.authConfigs.list({ limit: 1 });
      sdk = {
        ok: true,
        detail: `authConfigs.list returned ${authConfigs.items?.length ?? 0} item(s)`,
      };
    } catch (err) {
      sdk = { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }

    return { fingerprint, raw, sdk };
  },
});

// End-to-end mem0 diagnostic. Run from the Convex dashboard with
// { userKey: "<your phone number, exactly as stored>" }. This walks the same
// code path as the chat integration so you can see at which step it fails
// without needing to send an SMS.
export const inspectUser = internalAction({
  args: { userKey: v.string(), toolkit: v.optional(v.string()) },
  handler: async (_ctx, { userKey, toolkit }) => {
    const apiKey = process.env.COMPOSIO_API_KEY;
    if (!apiKey) return { ok: false as const, reason: "COMPOSIO_API_KEY not set" };
    const slug = (toolkit ?? "mem0").toLowerCase();
    const composio = new Composio({ apiKey, provider: new VercelProvider() });

    const accounts = await composio.connectedAccounts.list({
      userIds: [userKey],
      statuses: ["ACTIVE"],
    });
    const existing = (accounts.items ?? []).map((a) => ({
      id: a.id,
      toolkit: a.toolkit?.slug,
      status: (a as { status?: unknown }).status,
    }));

    const configs = await composio.authConfigs.list({ toolkit: slug });
    const configSummary = (configs.items ?? []).map((c) => ({
      id: c.id,
      isComposioManaged: c.isComposioManaged,
      authScheme: (c as { authScheme?: unknown }).authScheme,
    }));

    let linkResult: unknown = "not attempted (already connected or no config)";
    const alreadyConnected = existing.some((e) => e.toolkit === slug);
    if (!alreadyConnected) {
      const cfg =
        configs.items?.find((c) => c.isComposioManaged) ?? configs.items?.[0];
      if (!cfg) {
        linkResult = `no auth config for ${slug}`;
      } else {
        try {
          const linked = await composio.connectedAccounts.link(userKey, cfg.id);
          linkResult = {
            id: linked.id,
            status: (linked as { status?: unknown }).status,
            hasRedirectUrl: Boolean(linked.redirectUrl),
            redirectUrl: linked.redirectUrl ?? null,
          };
        } catch (err) {
          linkResult = {
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }
    }

    let loadedTools: string[] = [];
    let toolsError: string | null = null;
    try {
      const loaded = await composio.tools.get(userKey, {
        toolkits: [slug],
        limit: 50,
      });
      loadedTools = Object.keys(loaded as Record<string, unknown>);
    } catch (err) {
      toolsError = err instanceof Error ? err.message : String(err);
    }

    return {
      ok: true as const,
      userKey,
      toolkit: slug,
      existingConnections: existing,
      authConfigs: configSummary,
      linkResult,
      loadedTools,
      toolsError,
    };
  },
});
