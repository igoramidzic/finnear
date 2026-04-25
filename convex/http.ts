import { httpRouter } from "convex/server";
import { Webhook } from "svix";

import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

const http = httpRouter();

http.route({
  path: "/clerk-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error("Missing CLERK_WEBHOOK_SECRET");
      return new Response("Webhook secret not configured", { status: 500 });
    }

    const svixId = request.headers.get("svix-id");
    const svixTimestamp = request.headers.get("svix-timestamp");
    const svixSignature = request.headers.get("svix-signature");
    if (!svixId || !svixTimestamp || !svixSignature) {
      return new Response("Missing svix headers", { status: 400 });
    }

    const body = await request.text();
    const wh = new Webhook(webhookSecret);

    let payload: Record<string, unknown>;
    try {
      payload = wh.verify(body, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      }) as Record<string, unknown>;
    } catch (err) {
      console.error("Invalid webhook signature", err);
      return new Response("Invalid webhook signature", { status: 400 });
    }

    const eventType = payload.type as string;
    const data = payload.data as Record<string, unknown>;

    switch (eventType) {
      case "user.created":
      case "user.updated": {
        const clerkId = data.id as string;
        const emailAddresses = data.email_addresses as
          | Array<Record<string, unknown>>
          | undefined;
        const email =
          (emailAddresses?.[0]?.email_address as string | undefined) ?? "";

        await ctx.runMutation(internal.clerk.upsertUserFromClerk, {
          clerkId,
          email,
        });
        return new Response("ok", { status: 200 });
      }
      case "user.deleted": {
        const clerkId = data.id as string;
        await ctx.runMutation(internal.clerk.deleteUserFromClerk, { clerkId });
        return new Response("ok", { status: 200 });
      }
      default:
        return new Response("ok", { status: 200 });
    }
  }),
});

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
