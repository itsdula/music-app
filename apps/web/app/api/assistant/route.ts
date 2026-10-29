/**
 * `POST /api/assistant`: one assistant turn for hosts that cannot call the server action
 * (Electron renderer, Vite host). Same service and response shape (`AssistantResult`) as
 * `app/actions/assistant.ts`. See docs/assistant.md.
 */
import { handleAssistantOptions, handleAssistantPost } from '../../../lib/assistant/http';
import { getAssistantServer } from '../../../lib/assistant/server';

export const dynamic = 'force-dynamic';
/** Upper bound for one provider round trip (seconds; honoured on Vercel). */
export const maxDuration = 60;

export function OPTIONS(request: Request): Response {
  return handleAssistantOptions(request, process.env);
}

export function POST(request: Request): Promise<Response> {
  return handleAssistantPost(request, getAssistantServer(), process.env);
}
