import { tool } from "ai";
import { z } from "zod";

import { internal } from "../../_generated/api";
import type { ActionCtx } from "../../_generated/server";
import { CREATOR_PHONE_NUMBER } from "../../lib/creator";

export function forwardToCreatorTool(ctx: ActionCtx, userKey: string) {
  return tool({
    description:
      "Forward a message from the current user to Finnear's creator. Use when the user asks to send a message to the creator, the founder, the developer, or 'whoever made this'. " +
      "The destination phone number is hardcoded — do not ask for it. Always include who the message is from (the user's name if known, otherwise their phone number) so the creator can reply. " +
      "After this is called, if the creator messages back, their reply is automatically forwarded to this user.",
    inputSchema: z.object({
      message: z
        .string()
        .min(1)
        .describe("The message to forward to the creator, verbatim from the user."),
    }),
    execute: async ({ message }) => {
      const meta = await ctx.runQuery(internal.userMetadata.getByUserKey, {
        userKey,
      });
      const sender = meta?.name ? `${meta.name} (${userKey})` : userKey;
      const content = `Message from ${sender}:\n${message}\n\n(Reply to this text to send a response back to them.)`;

      await ctx.runAction(internal.sendblue.sendOutbound, {
        phoneNumber: CREATOR_PHONE_NUMBER,
        content,
      });

      await ctx.runMutation(internal.creatorInbox.setPendingTarget, {
        pendingUserPhone: userKey,
      });

      return { ok: true as const };
    },
  });
}
