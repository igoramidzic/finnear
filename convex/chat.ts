import { paginationOptsValidator } from "convex/server";
import { v, ConvexError } from "convex/values";
import {
  Agent,
  createThread,
  listUIMessages,
  syncStreams,
  vStreamArgs,
} from "@convex-dev/agent";
import { anthropic } from "@ai-sdk/anthropic";

import { components, internal } from "./_generated/api";
import {
  internalAction,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireUserProfile } from "./auth";

export const chatAgent = new Agent(components.agent, {
  name: "Finnear Chat",
  languageModel: anthropic("claude-haiku-4-5"),
  instructions:
    "You are Finnear's helpful assistant. Be concise, friendly, and direct.",
});

async function getOrCreateUserThreadId(
  ctx: MutationCtx,
): Promise<{ threadId: string; userProfileId: string }> {
  const { userProfile } = await requireUserProfile(ctx);
  if (userProfile.chatThreadId) {
    return { threadId: userProfile.chatThreadId, userProfileId: userProfile._id };
  }
  const threadId = await createThread(ctx, components.agent, {
    userId: userProfile._id,
  });
  await ctx.db.patch(userProfile._id, { chatThreadId: threadId });
  return { threadId, userProfileId: userProfile._id };
}

async function getUserThreadId(ctx: QueryCtx): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const userProfile = await ctx.db
    .query("userProfile")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
    .first();
  return userProfile?.chatThreadId ?? null;
}

export const sendMessage = mutation({
  args: { prompt: v.string() },
  handler: async (ctx, { prompt }) => {
    const trimmed = prompt.trim();
    if (!trimmed) throw new ConvexError("Message cannot be empty");

    const { threadId } = await getOrCreateUserThreadId(ctx);
    const { messageId } = await chatAgent.saveMessage(ctx, {
      threadId,
      prompt: trimmed,
      skipEmbeddings: true,
    });

    await ctx.scheduler.runAfter(0, internal.chat.streamReply, {
      threadId,
      promptMessageId: messageId,
    });

    return { threadId };
  },
});

export const streamReply = internalAction({
  args: { threadId: v.string(), promptMessageId: v.string() },
  handler: async (ctx, { threadId, promptMessageId }) => {
    const result = await chatAgent.streamText(
      ctx,
      { threadId },
      { promptMessageId },
      { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
    );
    await result.consumeStream();
  },
});

export const listMessages = query({
  args: {
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    const threadId = await getUserThreadId(ctx);
    if (!threadId) {
      const streams =
        args.streamArgs?.kind === "deltas"
          ? ({ kind: "deltas" as const, deltas: [] })
          : ({ kind: "list" as const, messages: [] });
      return {
        page: [],
        isDone: true,
        continueCursor: "",
        streams,
      };
    }
    const streams = await syncStreams(ctx, components.agent, {
      threadId,
      streamArgs: args.streamArgs,
    });
    const paginated = await listUIMessages(ctx, components.agent, {
      threadId,
      paginationOpts: args.paginationOpts,
    });
    return { ...paginated, streams };
  },
});
