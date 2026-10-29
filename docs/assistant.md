# AI assistant: model routes

Studio's chat panel talks to a model through `PlatformServices.assistant`, an
`AssistantTransport` (contract: `packages/platform-contracts/src/assistant.ts`). This document
covers how each host provides that transport, how to configure it, and the security model.

## Architecture

```
chat panel (studio-react)            host-provided transport               server / provider
─────────────────────────            ───────────────────────               ─────────────────
build messages + tool list ──► transport.complete(request) ──► one model turn ──► OpenRouter
◄── AssistantResponse (text and/or toolCalls) ◄──────────────────────────────────┘
run tool calls locally (tool registry), append tool messages, call complete() again …
```

- **One turn per call.** A transport sends the conversation and the tool definitions and returns
  the model's next assistant message. It never runs tools and never loops.
- **Tools run on the client.** The chat UI executes `toolCalls` against the local tool registry,
  appends `role: 'tool'` messages and calls `complete()` again until `finishReason` is not
  `tool_calls`. The server never sees or touches the project except through what the client sends.
- **OpenAI-compatible wire format.** Messages and tools follow the Chat Completions shape, so
  the same request works for OpenRouter, OpenAI-compatible local servers (Ollama, LM Studio,
  vLLM, llama.cpp) and future providers.
- **Errors.** Transports reject with `AssistantError` (`name === 'AssistantError'`,
  `code: AssistantErrorCode`, user-safe `message`). An aborted request rejects with a DOM
  `AbortError`. Codes: `not-configured`, `unauthorized`, `rate-limited`, `bad-request`,
  `provider-error`, `network`.

### Routes per host

| Host            | Transport                                                       | Where the key lives                         |
| --------------- | --------------------------------------------------------------- | ------------------------------------------- |
| Next.js (web)   | server action `completeAssistant` (`apps/web/app/actions`)      | server env `OPENROUTER_API_KEY` (Vercel)    |
| Electron        | `POST {STUDIO_ASSISTANT_URL}` → `apps/web/app/api/assistant`    | same server; the desktop app holds no key   |
| Vite host       | `POST {VITE_STUDIO_ASSISTANT_URL}` → same endpoint              | same server                                 |
| Tauri (planned) | `createAssistantClient()` from `@studio/assistant-core`, direct | user's own key / local model, on the device |

### Code map

| Piece                                                            | Role                                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/assistant-core` (class A, portable)                    | OpenAI-compatible client with injected `fetch`; request/response mapping; error normalisation with redaction; request guards; presets for OpenRouter and generic OpenAI-compatible servers; `AssistantResult` helpers |
| `apps/web/lib/assistant/server.ts`                               | Server-only service: env, guards, per-client rate limit, OpenRouter call; returns `AssistantResult`                                                                                                                   |
| `apps/web/lib/assistant/http.ts`                                 | `/api/assistant` handling: CORS, optional bearer token, body limits, HTTP status mapping                                                                                                                              |
| `apps/web/app/actions/assistant.ts`                              | `'use server'` action `completeAssistant(request)`                                                                                                                                                                    |
| `apps/web/app/api/assistant/route.ts`                            | `OPTIONS`/`POST` route for Electron and Vite                                                                                                                                                                          |
| `packages/platform-browser/src/assistant`                        | `createResultAssistantTransport` (wraps the server action) and `createHttpAssistantTransport` (endpoint)                                                                                                              |
| `apps/web/app/studio/studio-client.tsx`                          | Injects the browser platform + server-action transport into `<Studio />`                                                                                                                                              |
| `apps/electron-host/src/renderer/main.tsx`, `src/main/policy.ts` | Endpoint transport; CSP `connect-src` allows exactly the endpoint origin                                                                                                                                              |
| `apps/vite-host/src/main.tsx`                                    | Optional endpoint transport                                                                                                                                                                                           |

Both server routes return the same JSON shape:

```ts
type AssistantResult =
  | { ok: true; response: AssistantResponse }
  | { ok: false; code: AssistantErrorCode; message: string };
```

The HTTP endpoint also sets a status: 200 ok, 400 `bad-request`, 401 `unauthorized`,
429 `rate-limited`, 502 `provider-error`/`network`, 503 `not-configured`.

## Configuration

### Vercel (server action + endpoint)

Set these under **Project → Settings → Environment Variables** for **Production** and
**Preview** (use a separate, spend-limited OpenRouter key for Preview if previews are public),
then redeploy. All are read at request time; none are needed at build time, so
`pnpm --filter @studio/web build` succeeds without them.

| Variable                           | Required | Purpose                                                                                                                           |
| ---------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `OPENROUTER_API_KEY`               | yes      | OpenRouter key. Without it every call returns `not-configured` with a message asking the operator to set it.                      |
| `OPENROUTER_MODEL`                 | no       | Model id. Default `anthropic/claude-haiku-4.5` (see below).                                                                       |
| `OPENROUTER_ALLOWED_MODELS`        | no       | Comma list of ids a client may request via `request.model`. Default: none — the server model is always used.                      |
| `STUDIO_PUBLIC_URL`                | no       | Public site URL, e.g. `https://studio.example.com`. Sent as OpenRouter `HTTP-Referer` (app attribution) and allowed as an origin. |
| `STUDIO_ASSISTANT_RATE_LIMIT`      | no       | Requests per client IP per minute, per server instance. Default `30`; `0` disables.                                               |
| `STUDIO_ASSISTANT_ALLOWED_ORIGINS` | no       | Extra browser origins for `/api/assistant`, comma separated (e.g. `http://localhost:3001` for the Vite dev host).                 |
| `STUDIO_ASSISTANT_TOKEN`           | no       | When set, `/api/assistant` requires `Authorization: Bearer <token>`. Does not apply to the server action.                         |

**Default model.** `anthropic/claude-haiku-4.5` (`DEFAULT_OPENROUTER_MODEL` in
`packages/assistant-core/src/presets.ts`): dependable tool calling, low latency for a chat loop
that makes several turns per user request, and low cost on an operator-paid key. To change it,
set `OPENROUTER_MODEL` to any OpenRouter model id that lists _tools_ support (check
<https://openrouter.ai/models?supported_parameters=tools>), for example a larger Claude Sonnet or
GPT model for harder multi-step edits; or change the constant to change the code default. The
id must exist in OpenRouter's catalogue at deploy time — an unknown id returns `bad-request` from
the provider.

Local development: put the same variables in `apps/web/.env.local` (covered by the
repository's `.env*` ignore rule) and run `pnpm dev`.

### Electron

The renderer has no key. At build time point it at a deployed Studio server:

```sh
STUDIO_ASSISTANT_URL=https://studio.example.com/api/assistant \
  pnpm turbo run build --filter=@studio/electron-host...
```

- `STUDIO_ASSISTANT_URL` must be `https:` (plain `http:` only for `localhost`/`127.0.0.1`);
  the build fails otherwise. Unset → `platform.assistant` is undefined and the chat panel says no
  assistant is configured.
- The main process adds **exactly that origin** to the renderer CSP `connect-src`; all other
  directives are unchanged (`apps/electron-host/tests/policy.test.ts`).
- The renderer's origin is `studio://app`, which the endpoint always allows.
- Optional `STUDIO_ASSISTANT_TOKEN` is baked into the renderer bundle (see security notes).
- Both variables are declared in `apps/electron-host/turbo.json`, so Turbo passes them through and
  includes them in the build cache key.

### Vite host

`VITE_STUDIO_ASSISTANT_URL=https://studio.example.com/api/assistant` (and optionally
`VITE_STUDIO_ASSISTANT_TOKEN`) at dev/build time. Add the Vite origin (e.g.
`http://localhost:3001`) to the server's `STUDIO_ASSISTANT_ALLOWED_ORIGINS`.

## Security notes

- **The key never reaches a browser.** It is read only in `apps/web/lib/assistant/server.ts`
  (which refuses to load in a browser) and sent only to OpenRouter. Provider error messages are
  passed through `safeProviderMessage`, which redacts the key, bearer tokens and `sk-…` strings
  and truncates; unexpected exceptions become a generic message. The client bundle was checked to
  contain neither `OPENROUTER_API_KEY` nor the OpenRouter URL.
- **The routes are public.** Server actions are ordinary POST endpoints, and `/api/assistant`
  must be reachable by desktop apps, so anyone who finds them can spend the key. Mitigations:
  - **Guards** (`validateAssistantRequest`, shared by every route and by the provider client):
    full structural validation of untrusted input, unknown fields dropped, ≤ 200 messages,
    ≤ 64 tools with valid unique names, ≤ 200 000 characters across contents, tool-call
    arguments and tool schemas, model id ≤ 200 chars. `max_tokens` is capped at 4096 per turn.
    The endpoint also rejects bodies over 1 MB before parsing.
  - **Model pinning:** clients cannot pick a model unless it is in `OPENROUTER_ALLOWED_MODELS`.
  - **Rate limit:** per client IP (Vercel's `x-vercel-forwarded-for`/`x-real-ip`), fixed
    one-minute window, in memory. It is best effort — each serverless instance counts separately
    and counters reset on cold starts. **Set a credit/spend limit on the OpenRouter key**; that is
    the real budget control. A shared store (e.g. Vercel KV/Upstash) can replace
    `createRateLimiter` later without touching callers.
  - **CORS** on `/api/assistant`: only `studio://app`, the site's own origin, `STUDIO_PUBLIC_URL`
    and `STUDIO_ASSISTANT_ALLOWED_ORIGINS` get CORS headers; other browser origins get 401/403
    without reaching the provider. CORS only constrains browsers: non-browser clients are limited
    by the token and rate limit.
  - **Optional token** (`STUDIO_ASSISTANT_TOKEN`), compared in constant time. A token built into
    a distributed Electron/Vite bundle can be extracted by its users, so it keeps out casual
    abuse, not determined callers. Real per-user auth is future work (see below).
- **Electron CSP** stays locked: only the configured endpoint origin is added to `connect-src`.
- **Prompt injection:** tool results and project content go back to the model; tools execute
  locally with the user's own permissions and the UI's confirmation rules. The server adds no
  capabilities.

## Testing

- `packages/assistant-core/tests`: mapping both ways, finish reasons, error normalisation per HTTP
  status, HTTP-200 error envelopes, key redaction, aborts, guards and presets — all with a fake
  `fetch`.
- `packages/platform-browser/tests/assistant`: HTTP and result transports, error codes, aborts.
- `apps/web/tests`: the server service with an env stub and fake fetch (including
  `not-configured` without a key, model allow-list, rate limit), `/api/assistant` CORS/token/body
  handling, and the real `route.ts` and server action with no key (`not-configured`) and with a
  stubbed key + global fetch. Run with `pnpm test` or `pnpm --filter @studio/web test`.
- `apps/electron-host/tests/policy.test.ts`: `connect-src` for the assistant origin.

No test calls the real OpenRouter API; verify a live deployment by opening the chat panel on a
Preview with `OPENROUTER_API_KEY` set.

## Plan: Tauri, bring-your-own provider, local models

`@studio/assistant-core` is deliberately portable (no DOM/Node types; `fetch` injected) so the
Tauri host can call providers directly:

1. A settings screen offers `ASSISTANT_PROVIDER_PRESETS`: OpenRouter (API key) or an
   OpenAI-compatible server (base URL such as `http://localhost:11434/v1` for Ollama or
   `http://localhost:1234/v1` for LM Studio, optional key, model id).
2. The key is stored in the OS keychain via a Tauri command (not in IndexedDB/localStorage).
3. The Tauri platform sets `assistant: createAssistantClient(config, fetch)`, using Tauri's HTTP
   plugin `fetch` (wrapped to the `FetchLike` shape) so requests are not subject to browser CORS
   and the key can stay on the Rust side if we later move the call into a command.
4. The same guards, mapping and error codes apply, so the chat UI is unchanged. The server route
   can remain as an optional "Studio cloud" provider.
5. Later: streaming (`stream: true` + SSE parsing in assistant-core), per-user auth for the hosted
   route, and a shared rate-limit store.
