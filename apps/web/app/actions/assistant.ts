'use server';

/**
 * Server action for the Studio AI chat panel: runs one model turn with the server-held
 * OpenRouter key. Returns `{ ok: true, response } | { ok: false, code, message }` and never
 * throws provider errors to the client. Server actions are public POST endpoints, so the input is
 * validated as untrusted (shared guards) and rate limited per client. See docs/assistant.md.
 */
import type { AssistantRequest, AssistantResult } from '@studio/assistant-core';
import { headers } from 'next/headers';
import { clientKeyFromHeaders, getAssistantServer } from '../../lib/assistant/server';

export async function completeAssistant(request: AssistantRequest): Promise<AssistantResult> {
  const requestHeaders = await headers();
  return getAssistantServer().complete(request, {
    clientKey: clientKeyFromHeaders(requestHeaders),
  });
}
