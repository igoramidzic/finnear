import { createThread } from "@convex-dev/agent";
import { v } from "convex/values";

import { components, internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { chatAgent } from "./chat";

const ROLLOVER_MS = 24 * 60 * 60 * 1000;

const RESET_WORDS = new Set(["reset", "new chat", "start over"]);
const RESET_REPLY = "Started a new chat. What's up?";

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
			await ctx.scheduler.runAfter(
				0,
				internal.sendblueActions.sendCannedReply,
				{ phoneNumber, content: RESET_REPLY },
			);
			return;
		}

		const { messageId } = await chatAgent.saveMessage(ctx, {
			threadId,
			prompt: content,
			skipEmbeddings: true,
		});

		await ctx.scheduler.runAfter(0, internal.sendblueActions.respondToSms, {
			phoneNumber,
			threadId,
			promptMessageId: messageId,
		});
	},
});
