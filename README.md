# Storyloom

A personal, browser-native fiction writing room. Start with what you know; add context when the story needs it.

## Current delivery status

The production build is deployed at `https://storyloom-writing-194d3ec4-max-agent94.vercel.app`. Vercel Authentication protects the app. The Supabase database is provisioned, its initial schema is applied, all five public tables have row-level security, and security advisors found no issues.

Source repository: [MaxAgent94/Storyloom](https://github.com/MaxAgent94/Storyloom).

The production deployment contains the Supabase public connection values and an independently generated server-only `KEY_ENCRYPTION_SECRET`. The secret was transmitted only to Vercel after explicit user authorization; it is absent from GitHub and browser code.

The personal Supabase Auth user is confirmed and allowlisted. Its authenticated database role passes the production allowlist policy. Remaining acceptance work is to sign in through the hosted interface, add an OpenRouter key, run the creative workflow, and physically verify the iPad experience. No live OpenRouter inference or physical iPad verification has been completed. The connector created deployments successfully but cannot read deployment status/logs under the account scope, so the protected alias response plus the production database policy check are the current verification boundary.

## Pinned runtime

| Dependency             | Version |
| ---------------------- | ------- |
| Next.js                | 16.2.12 |
| React / React DOM      | 19.2.8  |
| TypeScript             | 6.0.3   |
| Node (local, `.nvmrc`) | 24.19.0 |
| Node (Vercel major)    | 24.x    |
| Supabase JS            | 2.116.0 |

Core packages use exact versions and package-lock.json is included. Vercel controls Node patch releases; `.nvmrc` pins the reproducible local runtime. Do not upgrade to Next.js 16.3.x or TypeScript 7.x without explicit user approval. No build errors are suppressed.

## Run

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Without Supabase environment variables the app presents an explicitly **unsaved interface preview**. It does not claim to persist local preview content. Do not write your only manuscript copy in that mode.

```sh
npm test
npm run typecheck
npm run build
npm start
```

The PGlite development dependency runs actual PostgreSQL schema/RLS/transaction tests locally. It is not application storage and is not used in production.

## New-project deployment procedure

1. **Complete:** the new `storyloom` Supabase project is `mozpgfkmdhnukfqthslg`. Reuse this isolated resource; do not provision a duplicate.
2. **Complete:** `database/schema.sql` was applied as `storyloom_initial_schema`; security advisors found no issues. Do not reapply the initial schema. Use new migrations for changes.
3. **Owner account complete:** one confirmed password-authenticated personal user exists and is present in `public.allowed_users`. Disable public signups in the Supabase dashboard if its toggle is still enabled. Do not ask the writer to paste a password into chat. No custom email or signup infrastructure is needed.
4. Source belongs in the supplied `MaxAgent94/Storyloom` repository. Do not use another application repository.
5. Create and verify a **new** Vercel project linked only to that repository. Use the Next.js framework preset and Node 24.x. Check project/team/repository IDs before any deployment or environment mutation.
6. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and server-only `KEY_ENCRYPTION_SECRET` in the new project's Vercel environment. The encryption secret must be 32 random bytes encoded as 64 hex characters (`openssl rand -hex 32`). Retain it securely; rotation without migration makes saved OpenRouter keys unreadable. Never commit `.env.local` or log secrets.
7. Run `npm ci`, `npm test`, and `npm run build`, then deploy to the verified new project. Inspect the deployment's terminal ready/error status.
8. Sign in, add an OpenRouter key using the app's Settings form, and choose a model in the Model pane. The app retrieves OpenRouter's catalog and current prices; preset model IDs intentionally start blank so no paid provider is silently chosen.
9. Complete the production acceptance flow below. Until it passes, the deployment is a candidate, not accepted production.

## Implemented vertical slice

- Book Outline now offers **Create Chapters / Scenes from Outline**. Explicit `## Chapter` and `### Scene` headings are parsed locally. Loose outlines use the selected OpenRouter preset with only book synopsis/outline and selected project canon/research. Review chapter/scene names, intent, ordering, additions and removals before approval. Append preserves existing nodes; alternative copy creates a separate Book. Only chapter outline and scene synopsis fields are populated. Production browser acceptance of this addition is pending.

- Project → Book → Chapter → Scene, with touch-visible create, rename, move up/down, duplicate, and reversible archive controls. Archiving requires confirmation; permanent deletion is intentionally omitted.
- Editable Markdown synopsis, outline, scene plan, beats, detailed beats, manuscript, and scratchpad.
- Optional project canon/research/voice and book act/recent-state sections. No required fields beyond item names.
- Select outline text and create scenes. `##` / `###` headings delimit scenes; text without headings creates one scene. The review dialog allows edits before creation. It creates a chapter when the selected book needs one.
- Persistent project-level brainstorming chat and human-directed transformations. Select the destination section and use `Chat → [section]` to turn decisions into a proposal.
- Server-only OpenRouter routing, encrypted per-owner key configuration, editable model IDs, catalog/prices, saved model presets and context recipes.
- Explicit context checkboxes. Only ancestor project/book/chapter and current-scene sections are eligible; another book's text is not automatically included. Paste external Markdown into Research or scratchpad and select it when needed. Last 20 chat messages are an independent opt-in toggle.
- Exact chat request inspector includes the system instruction, attached text, conversation, and current guidance. Generation actions add the clearly labeled transformation instruction to that guidance. Character-based token estimates are approximate and do not guarantee provider token limits.
- Editable proposals, comparison with current content, accept/reject, copy branches, and section history. Applying stale proposals is blocked; keep the current section and save an alternative copy instead.
- Optimistic revision checks prevent silent cross-tab overwrites. A conflict keeps the unsaved in-memory draft open and offers full JSON download before reloading.
- Completed model responses are checkpointed server-side and recoverable from Settings. A checkpoint error is surfaced; the received output remains in the client pending a successful project save.
- Markdown copy/download/import, subtree export, and complete JSON project backup/import. Markdown import targets the current section; JSON import makes an independent project copy. Version-history rows are not contained in the JSON backup; export them from Supabase for a complete database backup.
- Large writing surface, focus mode, left navigation collapse below 1190px, and AI drawer below 860px. Primary buttons use 44px minimum heights. Physical iPad keyboard/touch testing remains outstanding.

## Architecture

`lib/domain.ts` owns portable types, hierarchy rules, context assembly, export, and prompt construction. `lib/browser.ts` contains authenticated transport. `lib/server.ts` validates Supabase identity and encrypts/decrypts provider keys. `app/api/*` separates project persistence, versions, model catalog, credentials, and inference from the React editor.

Supabase stores one JSON document per project, with an integer revision. The `save_project` PostgreSQL function locks the row, compares the revision, writes the project, and appends changed section versions in one transaction. This is a small single-user aggregate model, not a normalized giant codex. At commercial scale, split the project aggregate into entity/section/chat tables behind the same APIs; whole-project saves and growing chat/proposal arrays are explicit V1 limitations. The API limits request bodies to approximately 3.5 MB. For very large multi-book series, use separate project files until incremental entity persistence is introduced.

All exposed tables have RLS. The app uses the owner's validated access token, never a service-role key. The `allowed_users` table prevents arbitrary authenticated accounts from creating workspaces. API routes require a fresh `getUser` result and allowlist membership. Provider keys are AES-256-GCM ciphertext at rest. The encryption secret stays exclusively in the server environment. Markdown is rendered as text; no raw HTML is injected.

The product has no RAG, embeddings, vector database, autonomous agents, queues, workers, teams, billing, analytics, or background prose pipeline. Voice can later use the same authenticated project/context/generation routes.

## Reference decisions

Studied [logicalor/llm-story-writer](https://github.com/logicalor/llm-story-writer) and its [architecture notes](https://github.com/logicalor/llm-story-writer/blob/development/.github/notes/architecture.md).

Retained operational ideas: editable stage outputs, selected context handoffs, review before application, recoverable checkpoints, optional recaps, and Markdown portability.

Not ported: Python/Textual runtime, ChromaDB, agent orchestration, mandatory phase gates, character/setting encyclopedia generation, automated chapter loops, and full-book assembly pipelines. This is an independent TypeScript implementation; no reference-repository source was copied.

Implementation documentation consulted: [Supabase SSR/auth](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [Supabase changelog](https://supabase.com/changelog), and [OpenRouter API](https://openrouter.ai/docs/api_reference/overview). This app uses explicit bearer-token validation in route handlers rather than SSR cookies, keeping creative state entirely behind authenticated API requests.

## Production acceptance checklist — pending

On a 13-inch iPad in landscape and a laptop:

1. Sign in; create project and book; save a synopsis.
2. Choose a low-cost model and inspect the checked context. Generate an outline; edit the proposal and apply it.
3. Edit the outline manually and verify cloud save.
4. Select part of the outline, review scene headings, and create scenes.
5. Generate beats and detailed beats; apply or reject outputs.
6. Brainstorm a scene, choose Beats, and use Chat → Beats. Confirm a new proposal does not overwrite the editor until accepted.
7. Compare/restore a previous version and confirm later versions remain.
8. Create an alternative copy; archive/unarchive an item; reorder siblings with touch controls.
9. Close and reopen the browser; sign in on a second device and verify project, scenes, chat, and presets.
10. Open the same project in two tabs; edit/save in each. Verify stale save rejection and backup recovery.
11. Test the narrow layout, focus mode, scrolling with the software keyboard, and text selection using touch.
12. Confirm an unauthenticated request cannot read project data or call the AI route, and inspect production logs for secret leakage without printing credentials.

## Validation completed locally

Production build passes on pinned Next.js/TypeScript. Five meaningful tests cover explicit context isolation, invalid hierarchies, portable Markdown subtree export, prompt order, and real PostgreSQL save/version/restore/conflict/RLS behavior. The PostgreSQL test verifies a second authenticated owner cannot read another owner's project or section history. The hosted Supabase schema, RLS security advisors, confirmed owner allowlist, and authenticated-role policy have been verified. Vercel serves the protected production alias. Live OpenRouter inference, authenticated browser interaction, and physical iPad use remain to be accepted through the checklist above.
