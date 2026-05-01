import { httpRouter } from "convex/server";

import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

const http = httpRouter();

http.route({
  path: "/sendblue-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const expected = process.env.SENDBLUE_WEBHOOK_SECRET;
    if (!expected) {
      console.error("Missing SENDBLUE_WEBHOOK_SECRET");
      return new Response("Webhook secret not configured", { status: 500 });
    }

    if (request.headers.get("sb-signing-secret") !== expected) {
      return new Response("Forbidden", { status: 403 });
    }

    let payload: {
      content?: string;
      is_outbound?: boolean;
      from_number?: string;
      to_number?: string;
      message_handle?: string;
      service?: string;
      media_url?: string;
    };
    try {
      payload = (await request.json()) as typeof payload;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const trimmedContent = payload.content?.trim() ?? "";
    const mediaUrl = payload.media_url?.trim() || undefined;

    if (
      payload.is_outbound !== false ||
      !payload.from_number ||
      (!trimmedContent && !mediaUrl)
    ) {
      return new Response("ok", { status: 200 });
    }

    await ctx.runMutation(internal.sendblue.ingestInboundMessage, {
      phoneNumber: payload.from_number,
      content: trimmedContent,
      mediaUrl,
      messageHandle: payload.message_handle,
      service: payload.service,
    });

    return new Response("ok", { status: 200 });
  }),
});

export default http;
