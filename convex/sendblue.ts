import { createThread } from "@convex-dev/agent";
import { v } from "convex/values";

import { components, internal } from "./_generated/api";
import {
	internalMutation,
	internalQuery,
	type MutationCtx,
} from "./_generated/server";
import { chatAgent } from "./chat";
import { classifyMediaUrlByExtension } from "./lib/media";

const ROLLOVER_MS = 24 * 60 * 60 * 1000;
const RECENT_INBOUND_LIMIT = 5;

const RESET_WORDS = new Set(["reset", "new chat", "start over"]);
const RESET_REPLY = "Started a new chat. What's up?";

type RecentInboundEntry = {
	messageHandle: string;
	content: string;
	receivedAt: number;
	service?: string;
};

function appendRecentInbound(
	prior: RecentInboundEntry[] | undefined,
	entry: RecentInboundEntry | null,
): RecentInboundEntry[] | undefined {
	if (!entry) return prior;
	const next = [...(prior ?? []), entry];
	return next.slice(-RECENT_INBOUND_LIMIT);
}

export const ingestInboundMessage = internalMutation({
	args: {
		phoneNumber: v.string(),
		content: v.string(),
		mediaUrl: v.optional(v.string()),
		messageHandle: v.optional(v.string()),
		service: v.optional(v.string()),
	},
	handler: async (
		ctx,
		{ phoneNumber, content, mediaUrl, messageHandle, service },
	) => {
		if (mediaUrl) {
			const kind = classifyMediaUrlByExtension(mediaUrl);
			const action =
				kind === "image"
					? internal.sendblueActions.describeAndIngest
					: internal.sendblueActions.transcribeAndIngest;
			await ctx.scheduler.runAfter(0, action, {
				phoneNumber,
				content,
				mediaUrl,
				messageHandle,
				service,
			});
			return;
		}

		await dispatchPrompt(ctx, {
			phoneNumber,
			prompt: content,
			messageHandle,
			service,
		});
	},
});

export const dispatchTranscribedMessage = internalMutation({
	args: {
		phoneNumber: v.string(),
		prompt: v.string(),
		messageHandle: v.optional(v.string()),
		service: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		await dispatchPrompt(ctx, args);
	},
});

async function dispatchPrompt(
	ctx: MutationCtx,
	{
		phoneNumber,
		prompt,
		messageHandle,
		service,
	}: {
		phoneNumber: string;
		prompt: string;
		messageHandle?: string;
		service?: string;
	},
) {
	const existing = await ctx.db
		.query("smsUser")
		.withIndex("by_phone", (q) => q.eq("phoneNumber", phoneNumber))
		.first();

	const isReset = RESET_WORDS.has(prompt.trim().toLowerCase());

	const newEntry: RecentInboundEntry | null = messageHandle
		? {
				messageHandle,
				content: prompt,
				receivedAt: Date.now(),
				service,
			}
		: null;

	let threadId: string;
	if (existing) {
		const gap = Date.now() - existing.lastMessageAt;
		if (isReset || gap > ROLLOVER_MS) {
			threadId = await createThread(ctx, components.agent, {
				userId: phoneNumber,
			});
			// New conversation — drop prior handles, they're no longer in
			// scope for "react to an earlier message".
			await ctx.db.patch(existing._id, {
				chatThreadId: threadId,
				lastMessageAt: Date.now(),
				recentInbound: appendRecentInbound(undefined, newEntry) ?? [],
			});
		} else {
			threadId = existing.chatThreadId;
			await ctx.db.patch(existing._id, {
				lastMessageAt: Date.now(),
				recentInbound:
					appendRecentInbound(existing.recentInbound, newEntry) ?? [],
			});
		}
	} else {
		threadId = await createThread(ctx, components.agent, {
			userId: phoneNumber,
		});
		await ctx.db.insert("smsUser", {
			phoneNumber,
			chatThreadId: threadId,
			lastMessageAt: Date.now(),
			recentInbound: appendRecentInbound(undefined, newEntry) ?? [],
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
		prompt,
		skipEmbeddings: true,
	});

	await ctx.scheduler.runAfter(0, internal.sendblueActions.respondToSms, {
		phoneNumber,
		threadId,
		promptMessageId: messageId,
	});
}

export const getRecentInbound = internalQuery({
	args: { phoneNumber: v.string() },
	handler: async (ctx, { phoneNumber }) => {
		const user = await ctx.db
			.query("smsUser")
			.withIndex("by_phone", (q) => q.eq("phoneNumber", phoneNumber))
			.first();
		return user?.recentInbound ?? [];
	},
});
