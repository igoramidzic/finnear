/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as chat from "../chat.js";
import type * as http from "../http.js";
import type * as lib_cron from "../lib/cron.js";
import type * as lib_media from "../lib/media.js";
import type * as schedule from "../schedule.js";
import type * as scheduleActions from "../scheduleActions.js";
import type * as sendblue from "../sendblue.js";
import type * as sendblueActions from "../sendblueActions.js";
import type * as tools_builtin_index from "../tools/builtin/index.js";
import type * as tools_builtin_memory from "../tools/builtin/memory.js";
import type * as tools_builtin_schedule from "../tools/builtin/schedule.js";
import type * as tools_builtin_userMetadata from "../tools/builtin/userMetadata.js";
import type * as tools_index from "../tools/index.js";
import type * as tools_integrations_composio from "../tools/integrations/composio.js";
import type * as tools_integrations_index from "../tools/integrations/index.js";
import type * as tools_integrations_types from "../tools/integrations/types.js";
import type * as userMetadata from "../userMetadata.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  chat: typeof chat;
  http: typeof http;
  "lib/cron": typeof lib_cron;
  "lib/media": typeof lib_media;
  schedule: typeof schedule;
  scheduleActions: typeof scheduleActions;
  sendblue: typeof sendblue;
  sendblueActions: typeof sendblueActions;
  "tools/builtin/index": typeof tools_builtin_index;
  "tools/builtin/memory": typeof tools_builtin_memory;
  "tools/builtin/schedule": typeof tools_builtin_schedule;
  "tools/builtin/userMetadata": typeof tools_builtin_userMetadata;
  "tools/index": typeof tools_index;
  "tools/integrations/composio": typeof tools_integrations_composio;
  "tools/integrations/index": typeof tools_integrations_index;
  "tools/integrations/types": typeof tools_integrations_types;
  userMetadata: typeof userMetadata;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
};
