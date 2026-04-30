# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Package manager is **pnpm**. Do not run `npm install` — it will create a `package-lock.json` alongside `pnpm-lock.yaml` and drift dependency resolution.

- `pnpm dev` — runs `convex dev` (backend sync watcher) + `vite` (frontend) together. **The user runs this; do not start it yourself** — `convex dev` is long-running and requires interactive login on first use.
- `pnpm build` — `tsc && vite build` (typecheck + production bundle).
- `pnpm lint` — `tsc && eslint . --ext ts,tsx`. No separate `typecheck` script; lint covers it.
- No test runner is configured.

**VS Code:** Press **F5** to start the `dev` task and launch Chrome at `localhost:5173` attached to the debugger. Config in `.vscode/{tasks.json,launch.json}`.

## Architecture

Single-package repo, **not** a workspace. React frontend in `src/`, Convex backend in `convex/`. The two are linked via generated types in `convex/_generated/` — `src/` imports `../convex/_generated/api` to call backend functions with full type inference.

**Auth flow (Clerk + Convex):**
1. `src/main.tsx` wraps the app in `ClerkProvider` → `ConvexProviderWithClerk`. Clerk owns the session; Convex validates its JWT.
2. `convex/auth.config.ts` tells Convex to accept tokens from Clerk's issuer (`CLERK_JWT_ISSUER_DOMAIN`, set on the Convex dashboard — **not** in `.env.local`).
3. `src/App.tsx` uses Convex's `<Authenticated>` / `<Unauthenticated>` / `<AuthLoading>` (prefer these over raw Clerk state — they only flip to authenticated once Convex has validated the token).
4. `src/pages/Login.tsx` implements email-OTP manually via `useSignIn` / `useSignUp`. On submit it tries `signIn.create` first; if Clerk returns `form_identifier_not_found` it falls back to `signUp.create`. Only email-code is wired — **Clerk dashboard must have email password/OAuth/magic-link disabled**, only email verification code enabled. The `<div id="clerk-captcha" />` in the login form is required for Clerk's bot protection.
5. Clerk webhooks (`convex/http.ts` at path `/clerk-webhook`) sync users into the `userProfile` table via `internal.clerk.upsertUserFromClerk`. Signature is verified with `svix`. Requires `CLERK_WEBHOOK_SECRET` on the Convex dashboard. **`userProfile` rows only exist after the webhook fires — a freshly-signed-in user may briefly have `getCurrentUser` return `null` until the webhook lands.**

**Convex layout convention (mirrors `../finnear_logs`):**
- `convex/auth.ts` — public `getCurrentUser` query + `requireAuth` / `requireUserProfile` helpers. Use these in protected queries/mutations instead of re-implementing `ctx.auth.getUserIdentity()` checks.
- `convex/clerk.ts` — `internalMutation`s called only from webhooks (not exposed to the client).
- `convex/http.ts` — webhook routes.
- `convex/schema.ts` — `userProfile` indexed `by_clerkId`; always look up profiles by Clerk subject, never by Convex `_id` from the client.

**Styling:**
- Tailwind v3 + shadcn/ui. Component alias `@/components/ui/*` → `src/components/ui/*` (configured in both `vite.config.ts` and `components.json`).
- `src/index.css` defines a Linear-inspired palette as HSL CSS variables. Primary is `hsl(233 58% 60%)` (Linear purple). Dark mode activates via `.dark` class on `:root` **or** `prefers-color-scheme: dark` (the `:root:not(.light)` selector allows an explicit `.light` class to override system preference). When adding shadcn components, use the semantic tokens (`bg-background`, `text-foreground`, `border-border`, `bg-primary`, etc.) — don't hardcode colors.

## Environment

- `.env.local` — frontend only: `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_CONVEX_URL` (auto-written by `convex dev`).
- Convex dashboard env vars — backend only:
  - `CLERK_JWT_ISSUER_DOMAIN`, `CLERK_WEBHOOK_SECRET` — Clerk auth.
  - `SENDBLUE_API_KEY_ID`, `SENDBLUE_API_SECRET_KEY`, `SENDBLUE_FROM_NUMBER`, `SENDBLUE_WEBHOOK_SECRET` — SMS in/out.
  - `ANTHROPIC_API_KEY` — read by `@ai-sdk/anthropic` in `convex/chat.ts` for the chat LLM.
  - `COMPOSIO_API_KEY` — enables the `composioIntegration` in `convex/tools/integrations/composio.ts`. Each SMS user (keyed by phone number) gets only the toolkits they've connected via the `composio_connect` tool. Auth configs must be pre-created in the Composio dashboard for any toolkit you want to allow (Gmail, GitHub, Slack, Linear, etc.).

## Skills

`.claude/skills/` contains the `get-convex/agent-skills` bundle (convex, convex-quickstart, convex-setup-auth, convex-create-component, convex-migration-helper, convex-performance-audit). Consult the matching `SKILL.md` before non-trivial Convex work — schema changes, new auth providers, new components, migrations.

## Project conventions

- Branch: `feature/fin-XXX` or `fix/fin-XXX` (Linear prefix FIN).
- Route prefix `/finnear/*` for any public-facing paths (convention from the broader Finnear platform).
- Companion iOS app lives at `../finnear_mobile` (SwiftUI); reference implementation for auth/webhook patterns is `../finnear_logs` (Angular, not React — translate patterns, don't copy code).

<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->
