"use node";

import { v } from "convex/values";

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

		const meta = await ctx.runQuery(internal.userMetadata.getByUserKey, {
			userKey: phoneNumber,
		});
		const integrations = buildIntegrationsContext(connected);
		const system = [
			BASE_INSTRUCTIONS,
			buildSystemContext(meta),
			integrations,
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
			console.warn("Agent produced empty reply for thread", threadId);
			return;
		}

		await sendSendblueMessage(phoneNumber, reply);
	},
});
