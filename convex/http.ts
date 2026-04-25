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
    };
    try {
      payload = (await request.json()) as typeof payload;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (
      payload.is_outbound !== false ||
      !payload.content?.trim() ||
      !payload.from_number
    ) {
      return new Response("ok", { status: 200 });
    }

    await ctx.runMutation(internal.sendblue.ingestInboundMessage, {
      phoneNumber: payload.from_number,
      content: payload.content.trim(),
    });

    return new Response("ok", { status: 200 });
  }),
});

export default http;
