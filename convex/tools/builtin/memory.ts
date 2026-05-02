import { tool } from "ai";
import { MemoryClient } from "mem0ai";
import { z } from "zod";

let cachedClient: MemoryClient | null = null;

function getClient(): MemoryClient | null {
  const apiKey = process.env.MEM0_API_KEY;
  if (!apiKey) return null;
  if (!cachedClient) {
    cachedClient = new MemoryClient({ apiKey });
  }
  return cachedClient;
}

export function searchMemoriesTool(userKey: string) {
  const client = getClient();
  if (!client) return null;
  return tool({
    description:
      "Semantic search over the user's persistent memory. Call before answering ANY personal question about the user (origin, preferences, family, work, etc). Pass a short query derived from the question.",
    inputSchema: z.object({
      query: z
        .string()
        .describe("Short natural-language query, e.g. 'where was the user born'."),
    }),
    execute: async ({ query }) => {
      try {
        const res = await client.search(query, {
          filters: { user_id: userKey },
          topK: 10,
        });
        const items = (res.results ?? []).map((m) => ({
          memory: m.memory ?? m.data?.memory ?? "",
          score: (m as { score?: number }).score,
        }));
        return { ok: true as const, results: items };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(`[mem0] search failed for ${userKey}:`, reason);
        return { ok: false as const, reason };
      }
    },
  });
}

export function addMemoryTool(userKey: string) {
  const client = getClient();
  if (!client) return null;
  return tool({
    description:
      "Save a durable fact about the user. Call this PROACTIVELY whenever the user reveals anything about themselves — preferences and tastes (likes, dislikes, favorites), personal details (name, location, birthplace, age, family, relationships), work and projects (job, company, what they're building), goals and plans, recurring habits or routines, important people in their life, or opinions they hold. You do not need permission to save — save silently the moment the fact is stated. Err on the side of saving; mem0 handles deduplication. Skip only ephemeral context (what they're doing right now, one-off questions, transient moods). Pass ONE concise self-contained statement per call; call multiple times if the user shared multiple facts. Refer to the user as 'User'; use real names for OTHER people. Do not mention saving in your reply.",
    inputSchema: z.object({
      statement: z
        .string()
        .describe(
          "Self-contained sentence to remember, e.g. 'User was born in Belgrade.'",
        ),
    }),
    execute: async ({ statement }) => {
      try {
        await client.add([{ role: "user", content: statement }], {
          userId: userKey,
        });
        return { ok: true as const };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(`[mem0] add failed for ${userKey}:`, reason);
        return { ok: false as const, reason };
      }
    },
  });
}
