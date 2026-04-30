"use node";

import { tool } from "ai";
import { v } from "convex/values";
import { z } from "zod";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import {
	BASE_INSTRUCTIONS,
	buildIntegrationsContext,
	buildSystemContext,
	chatAgent,
} from "./chat";
import { buildToolsFor } from "./tools";

const SENDBLUE_API_BASE = "https://api.sendblue.com/api";

const TAPBACK_REACTIONS = [
	"love",
	"like",
	"dislike",
	"laugh",
	"emphasize",
	"question",
] as const;
type TapbackReaction = (typeof TAPBACK_REACTIONS)[number];

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
	path:
		| "send-message"
		| "send-typing-indicator"
		| "mark-read"
		| "send-reaction",
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

async function sendReaction(
	messageHandle: string,
	reaction: TapbackReaction,
) {
	const { fromNumber } = getSendblueConfig();
	return sendblueRequest("send-reaction", {
		from_number: fromNumber,
		message_handle: messageHandle,
		reaction,
	});
}

function reactToMessageTool(reactableHandles: string[]) {
	// reactableHandles is ordered newest-first, so messageOffset 0 = the
	// message just received this turn, 1 = the message before that, etc.
	const maxOffset = Math.max(0, reactableHandles.length - 1);
	return tool({
		description:
			"React to one of the user's recent messages with an iMessage tapback " +
			"(heart, thumbs up, etc.) instead of sending a text reply. Use this " +
			"sparingly — only when a tapback alone is the natural response and " +
			"a text reply would feel redundant (e.g. 'thanks', 'got it', 'ok', " +
			"'lol', 'np', a quick celebration). Pass messageOffset=0 to react " +
			"to the message you're currently responding to, 1 to react to the " +
			"previous user message, and so on. If the user says 'change that " +
			"to a dislike' or 'react to my last message instead', use offset 1+ " +
			"to target the earlier message. Sending a new reaction to the same " +
			"message replaces the prior one. Do NOT also send text in the same " +
			"turn — the reaction IS the reply.",
		inputSchema: z.object({
			reaction: z
				.enum(TAPBACK_REACTIONS)
				.describe(
					"love=heart, like=thumbs up, dislike=thumbs down, laugh, " +
						"emphasize=double exclamation, question=question mark.",
				),
			messageOffset: z
				.number()
				.int()
				.min(0)
				.max(maxOffset)
				.optional()
				.describe(
					"0 = current message (default), 1 = previous user message, etc.",
				),
		}),
		execute: async ({ reaction, messageOffset }) => {
			const offset = messageOffset ?? 0;
			const handle = reactableHandles[offset];
			if (!handle) {
				return {
					ok: false as const,
					reason: `no message at offset ${offset}`,
				};
			}
			try {
				await sendReaction(handle, reaction);
				return { ok: true as const, reaction, messageOffset: offset };
			} catch (err) {
				return {
					ok: false as const,
					reason: err instanceof Error ? err.message : String(err),
				};
			}
		},
	});
}

export const sendCannedReply = internalAction({
	args: { phoneNumber: v.string(), content: v.string() },
	handler: async (_ctx, { phoneNumber, content }) => {
		await sendSendblueMessage(phoneNumber, content);
	},
});

export const sendOutbound = internalAction({
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

		const { tools, connected } = await buildToolsFor(ctx, phoneNumber);

		// Tapbacks only work on iMessage. Newest-first so offset 0 = current.
		const recentInbound = await ctx.runQuery(
			internal.sendblue.getRecentInbound,
			{ phoneNumber },
		);
		const reactable = [...recentInbound]
			.reverse()
			.filter((m) => m.service === "iMessage" && m.messageHandle);
		const canReact = reactable.length > 0;
		if (canReact) {
			tools.reactToMessage = reactToMessageTool(
				reactable.map((m) => m.messageHandle),
			);
		}

		const meta = await ctx.runQuery(internal.userMetadata.getByUserKey, {
			userKey: phoneNumber,
		});
		const integrations = buildIntegrationsContext(connected);
		const reactionGuidance = canReact
			? [
					"You can call reactToMessage to send an iMessage tapback to one " +
						"of the user's recent messages instead of replying in text. " +
						"Use it sparingly — only when a tapback alone is the natural " +
						"response and words would feel redundant (e.g. 'thanks', 'got " +
						"it', 'ok', 'lol', 'np', a quick celebration). When you react, " +
						"do NOT also send text — the reaction is the entire reply.",
					"messageOffset maps to these recent messages (0 is current):",
					...reactable.map(
						(m, i) => `  ${i}: ${JSON.stringify(m.content.slice(0, 80))}`,
					),
					"If the user wants to change a previous reaction (e.g. 'make it a " +
						"dislike instead'), call reactToMessage with the offset of the " +
						"earlier message — sending a new reaction replaces the old one.",
				].join("\n")
			: "";
		const system = [
			BASE_INSTRUCTIONS,
			buildSystemContext(meta),
			integrations,
			reactionGuidance,
		]
			.filter(Boolean)
			.join("\n\n");

		const result = await chatAgent.generateText(
			ctx,
			{ threadId },
			{ promptMessageId, tools, system },
		);

		const reply = result.text.trim();
		if (!reply) {
			// Empty reply is expected when the model only sent a reaction.
			return;
		}

		await sendSendblueMessage(phoneNumber, reply);
	},
});
