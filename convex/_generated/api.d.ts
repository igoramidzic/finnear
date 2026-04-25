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
import type * as clerk from "../clerk.js";
import type * as http from "../http.js";
import type * as sendblue from "../sendblue.js";
import type * as tools_builtin_index from "../tools/builtin/index.js";
import type * as tools_index from "../tools/index.js";
import type * as tools_integrations_index from "../tools/integrations/index.js";
import type * as tools_integrations_types from "../tools/integrations/types.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  chat: typeof chat;
  clerk: typeof clerk;
  http: typeof http;
  sendblue: typeof sendblue;
  "tools/builtin/index": typeof tools_builtin_index;
  "tools/index": typeof tools_index;
  "tools/integrations/index": typeof tools_integrations_index;
  "tools/integrations/types": typeof tools_integrations_types;
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
