import { createThread } from "@convex-dev/agent";
import { v } from "convex/values";

import { components, internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { chatAgent } from "./chat";
import { buildToolsFor } from "./tools";

const SENDBLUE_API_BASE = "https://api.sendblue.com/api";

const ROLLOVER_MS = 24 * 60 * 60 * 1000;

const RESET_WORDS = new Set(["reset", "new chat", "start over"]);
const RESET_REPLY = "Started a new chat. What's up?";

function getSendblueConfig() {
  const apiKeyId = process.env.SENDBLUE_API_KEY_ID;
  const apiSecretKey = process.env.SENDBLUE_API_SECRET_KEY;
  const fromNumber = process.env.SENDBLUE_FROM_NUMBER;
  if (!apiKeyId || !apiSecretKey || !fromNumber) {
    throw new Error(
      "Missing SendBlue env vars: SENDBLUE_API_KEY_ID, SENDBLUE_API_SECRET_KEY, SENDBLUE_FROM_NUMBER",
    );
  }
  return { apiKeyId, apiSecretKey, fromNumber };
}

async function sendblueRequest(
  path: "send-message" | "send-typing-indicator" | "mark-read",
  body: Record<string, unknown>,
) {
  const { apiKeyId, apiSecretKey } = getSendblueConfig();
  const res = await fetch(`${SENDBLUE_API_BASE}/${path}`, {
    method: "POST",
    headers: {
      "sb-api-key-id": apiKeyId,
      "sb-api-secret-key": apiSecretKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SendBlue ${path} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

async function sendSendblueMessage(toNumber: string, content: string) {
  const { fromNumber } = getSendblueConfig();
  return sendblueRequest("send-message", {
    number: toNumber,
    from_number: fromNumber,
    content,
  });
}

async function sendTypingIndicator(toNumber: string) {
  const { fromNumber } = getSendblueConfig();
  return sendblueRequest("send-typing-indicator", {
    number: toNumber,
    from_number: fromNumber,
  });
}

async function markRead(toNumber: string) {
  const { fromNumber } = getSendblueConfig();
  return sendblueRequest("mark-read", {
    number: toNumber,
    from_number: fromNumber,
  });
}

export const ingestInboundMessage = internalMutation({
  args: { phoneNumber: v.string(), content: v.string() },
  handler: async (ctx, { phoneNumber, content }) => {
    const existing = await ctx.db
      .query("smsUser")
      .withIndex("by_phone", (q) => q.eq("phoneNumber", phoneNumber))
      .first();

    const isReset = RESET_WORDS.has(content.trim().toLowerCase());

    let threadId: string;
    if (existing) {
      const gap = Date.now() - existing.lastMessageAt;
      if (isReset || gap > ROLLOVER_MS) {
        threadId = await createThread(ctx, components.agent, {
          userId: phoneNumber,
        });
        await ctx.db.patch(existing._id, {
          chatThreadId: threadId,
          lastMessageAt: Date.now(),
        });
      } else {
        threadId = existing.chatThreadId;
        await ctx.db.patch(existing._id, { lastMessageAt: Date.now() });
      }
    } else {
      threadId = await createThread(ctx, components.agent, {
        userId: phoneNumber,
      });
      await ctx.db.insert("smsUser", {
        phoneNumber,
        chatThreadId: threadId,
        lastMessageAt: Date.now(),
      });
    }

    if (isReset) {
      await ctx.scheduler.runAfter(0, internal.sendblue.sendCannedReply, {
        phoneNumber,
        content: RESET_REPLY,
      });
      return;
    }

    const { messageId } = await chatAgent.saveMessage(ctx, {
      threadId,
      prompt: content,
      skipEmbeddings: true,
    });

    await ctx.scheduler.runAfter(0, internal.sendblue.respondToSms, {
      phoneNumber,
      threadId,
      promptMessageId: messageId,
    });
  },
});

export const sendCannedReply = internalAction({
  args: { phoneNumber: v.string(), content: v.string() },
  handler: async (_ctx, { phoneNumber, content }) => {
    await sendSendblueMessage(phoneNumber, content);
  },
});

export const respondToSms = internalAction({
  args: {
    phoneNumber: v.string(),
    threadId: v.string(),
    promptMessageId: v.string(),
  },
  handler: async (ctx, { phoneNumber, threadId, promptMessageId }) => {
    try {
      await markRead(phoneNumber);
    } catch (err) {
      console.warn("SendBlue mark-read failed (ok if not enabled):", err);
    }
    try {
      await sendTypingIndicator(phoneNumber);
    } catch (err) {
      console.warn("SendBlue typing indicator failed:", err);
    }

    const tools = await buildToolsFor(ctx, phoneNumber);
    const result = await chatAgent.generateText(
      ctx,
      { threadId },
      { promptMessageId, tools },
    );

    const reply = result.text.trim();
    if (!reply) {
      console.warn("Agent produced empty reply for thread", threadId);
      return;
    }

    await sendSendblueMessage(phoneNumber, reply);
  },
});
