# AI assistant: transports and configuration

Nawa's chat panel talks to a model through `PlatformServices.assistant`, an
`AssistantTransport` (contract: `packages/platform-contracts/src/assistant.ts`). This document
covers how each host provides that transport, how to configure it, and the security model.

**Current state.** Nawa has no server. The website on GitHub Pages is static, so it passes **no
transport** and the chat panel explains that the assistant is unavailable. The desktop app can
be built to call an assistant endpoint (below), but the repository no longer contains one: the
reference server (a Next.js server action and `/api/assistant` route in `apps/web`) was removed
with the Next.js host. It is still in git history at commit `3c5140b` (`apps/web/lib/assistant/`,
`apps/web/app/api/assistant/route.ts`) if a hosted endpoint is wanted again. The planned direction
is a bring-your-own-provider client on the device (last section).

## Architecture

```
chat panel (studio-react)            host-provided transport               endpoint / provider
─────────────────────────            ───────────────────────               ─────────────────
build messages + tool list ──► transport.complete(request) ──► one model turn ──► model API
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

### Transports per host

| Host                       | Transport                                                                             | Where the key lives                         |
| -------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------- |
| Website (`apps/site`)      | none: the chat panel shows "Assistant unavailable"                                    | —                                           |
| Desktop (`apps/desktop`)   | `POST {STUDIO_ASSISTANT_URL}` when set at build time (`createHttpAssistantTransport`) | on that endpoint's server; never in the app |
| Future: on-device provider | `createAssistantClient()` from `@studio/assistant-core`, direct                       | user's own key / local model, on the device |

### Code map

| Piece                                                      | Role                                                                                                                                                                                                                  |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/assistant-core` (class A, portable)              | OpenAI-compatible client with injected `fetch`; request/response mapping; error normalisation with redaction; request guards; presets for OpenRouter and generic OpenAI-compatible servers; `AssistantResult` helpers |
| `packages/platform-browser/src/assistant`                  | `createHttpAssistantTransport` (endpoint) and `createResultAssistantTransport` (wraps any function returning `AssistantResult`)                                                                                       |
| `packages/studio-react/src/features/assistant`             | Chat panel, tool loop, system prompt; shows the "not configured" state when no transport is injected                                                                                                                  |
| `apps/desktop/src/renderer/main.tsx`, `src/main/policy.ts` | Endpoint transport; CSP `connect-src` allows exactly the endpoint origin                                                                                                                                              |
| `apps/site/src/studio/main.tsx`                            | Mounts `<Studio />` without a transport                                                                                                                                                                               |

An endpoint answers with this JSON shape:

```ts
type AssistantResult =
  | { ok: true; response: AssistantResponse }
  | { ok: false; code: AssistantErrorCode; message: string };
```

and the matching HTTP status: 200 ok, 400 `bad-request`, 401 `unauthorized`, 429
`rate-limited`, 502 `provider-error`/`network`, 503 `not-configured`. It must allow the CORS
origin `studio://app` (the desktop renderer's origin).

**Default model.** `anthropic/claude-haiku-4.5` (`DEFAULT_OPENROUTER_MODEL` in
`packages/assistant-core/src/presets.ts`): dependable tool calling, low latency for a chat loop
that makes several turns per user request, and low cost. Any OpenRouter model id that lists
_tools_ support works (<https://openrouter.ai/models?supported_parameters=tools>).

## Configuration

### Desktop app

The renderer has no key. At build time point it at an assistant endpoint:

```sh
STUDIO_ASSISTANT_URL=https://assistant.example.com/api/assistant \
  pnpm turbo run build --filter=@studio/desktop...
```

- `STUDIO_ASSISTANT_URL` must be `https:` (plain `http:` only for `localhost`/`127.0.0.1`);
  the build fails otherwise. Unset → `platform.assistant` is undefined and the chat panel says no
  assistant is configured. Release builds (`release.yml`) do not set it.
- The main process adds **exactly that origin** to the renderer CSP `connect-src`; all other
  directives are unchanged (`apps/desktop/tests/policy.test.ts`).
- Optional `STUDIO_ASSISTANT_TOKEN` is baked into the renderer bundle (see security notes).
- Both variables are declared in `apps/desktop/turbo.json`, so Turbo passes them through and
  includes them in the build cache key.

### Website

Nothing to configure. GitHub Pages serves static files only, so there is nowhere to keep a key.
Adding an assistant to the site needs either a separately hosted endpoint (and a site build that
injects `createHttpAssistantTransport`) or the on-device provider below.

## Security notes

- **A key never ships in a client.** Neither the site nor the desktop app holds a provider key.
  An endpoint keeps it server-side; `assistant-core`'s `safeProviderMessage` redacts keys,
  bearer tokens and `sk-…` strings from provider error messages before they reach a client.
- **Endpoints are public.** Anyone who finds an endpoint can spend its key. Mitigations an
  endpoint should apply, all available in `@studio/assistant-core`:
  - **Guards** (`validateAssistantRequest`, also used by the provider client): full structural
    validation of untrusted input, unknown fields dropped, ≤ 200 messages, ≤ 64 tools with valid
    unique names, ≤ 200 000 characters across contents, tool-call arguments and tool schemas,
    model id ≤ 200 chars, `max_tokens` capped at 4096 per turn.
  - **Model pinning**, a **rate limit**, CORS limited to known origins, and a **spend limit on
    the provider key**, which is the real budget control.
  - An optional shared **token**. A token built into a distributed desktop bundle can be
    extracted by its users, so it keeps out casual abuse, not determined callers.
- **Electron CSP** stays locked: only the configured endpoint origin is added to `connect-src`.
- **Prompt injection:** tool results and project content go back to the model; tools execute
  locally with the user's own permissions and the UI's confirmation rules. An endpoint adds no
  capabilities.

## Testing

- `packages/assistant-core/tests`: mapping both ways, finish reasons, error normalisation per HTTP
  status, HTTP-200 error envelopes, key redaction, aborts, guards and presets — all with a fake
  `fetch`.
- `packages/platform-browser/tests/assistant`: HTTP and result transports, error codes, aborts.
- `apps/desktop/tests/policy.test.ts`: `connect-src` for the assistant origin.
- `e2e/studio/assistant.spec.ts`: the chat panel on the site, without a transport.

No test calls a real model API.

## Plan: bring-your-own provider and local models

`@studio/assistant-core` is deliberately portable (no DOM/Node types; `fetch` injected) so a host
can call providers directly from the device:

1. A settings screen offers `ASSISTANT_PROVIDER_PRESETS`: OpenRouter (API key) or an
   OpenAI-compatible server (base URL such as `http://localhost:11434/v1` for Ollama or
   `http://localhost:1234/v1` for LM Studio, optional key, model id).
2. On the desktop app the key is stored by the main process (OS keychain via `safeStorage`),
   never in IndexedDB or localStorage, and requests go through the main process so browser CORS
   does not apply and the key never enters the renderer. A future native (Tauri) host would do
   the same with a Rust command ([hosts.md §2](hosts.md)).
3. In the browser, local servers that send CORS headers can be called directly; a user-supplied
   cloud key would have to live in the page, which needs an explicit warning.
4. The same guards, mapping and error codes apply, so the chat UI is unchanged.
5. Later: streaming (`stream: true` + SSE parsing in assistant-core).
