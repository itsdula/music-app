import type { AssistantResponse } from '@studio/platform-contracts';
import type { MidiClip } from '@studio/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_STUDIO_CONFIG } from '../src/config';
import {
  AssistantConversation,
  getConversation,
  NOT_CONFIGURED_MESSAGE,
} from '../src/features/assistant/conversation';
import { createStudioSession, type StudioSession } from '../src/session/studio-session';
import {
  assistantError,
  createTestPlatform,
  FakeAssistantTransport,
} from './helpers/test-platform';

const sessions: StudioSession[] = [];

async function startSession(transport?: FakeAssistantTransport) {
  const platform = createTestPlatform(transport ? { assistant: transport } : {});
  const session = createStudioSession(platform, { ...DEFAULT_STUDIO_CONFIG, autosaveDelayMs: 5 });
  sessions.push(session);
  await session.start();
  return session;
}

afterEach(async () => {
  while (sessions.length) await sessions.pop()!.dispose();
});

function conversationFor(session: StudioSession, maxSteps?: number) {
  return new AssistantConversation({
    session,
    transport: () => session.platform.assistant,
    ...(maxSteps ? { maxSteps } : {}),
  });
}

describe('assistant conversation loop', () => {
  it('runs tool calls, feeds results back and shows the final answer', async () => {
    const transport = new FakeAssistantTransport();
    transport.enqueue(
      transport.toolCalls(
        [
          { name: 'add_track', input: { instrument: 'drums', name: 'Beat' } },
          {
            name: 'add_drum_pattern',
            input: { trackId: 'Beat', bars: 4, pattern: { kick: 'x---x---x---x---' } },
          },
        ],
        'Building a beat…',
      ),
      transport.toolCalls([{ name: 'navigate', input: { view: 'editor' } }]),
      FakeAssistantTransport.reply('Here is a **4-bar** house beat on the `Beat` track.'),
    );
    const session = await startSession(transport);
    const convo = conversationFor(session);
    await convo.send('Make a 4-bar house beat');

    // Project and UI changed through the tools.
    const project = session.history.present;
    const beat = Object.values(project.tracks).find((t) => t.name === 'Beat')!;
    expect(beat.instrument?.kind).toBe('drums');
    const clip = Object.values(project.clips).find((c) => c.trackId === beat.id) as MidiClip;
    expect(clip.notes).toHaveLength(16);
    expect(session.uiStore.getState().view).toBe('editor');

    // Transcript: user, assistant text, three tool chips, final answer.
    const items = convo.state.items;
    expect(items.map((i) => i.kind)).toEqual([
      'user',
      'assistant',
      'tool',
      'tool',
      'tool',
      'assistant',
    ]);
    expect(
      items.filter((i) => i.kind === 'tool').map((i) => i.kind === 'tool' && i.status),
    ).toEqual(['ok', 'ok', 'ok']);
    expect(convo.state.status).toBe('idle');
    expect(convo.state.error).toBeNull();

    // Requests: system prompt with project context + every registry tool; results fed back.
    expect(transport.requests).toHaveLength(3);
    const first = transport.requests[0]!;
    expect(first.messages[0]).toMatchObject({ role: 'system' });
    expect(first.messages[0]!.role === 'system' && first.messages[0]!.content).toContain(
      'Page: arrange',
    );
    expect(first.messages[1]).toEqual({ role: 'user', content: 'Make a 4-bar house beat' });
    expect(first.tools.map((t) => t.name)).toEqual(session.tools.list().map((t) => t.name));
    expect(first.tools.find((t) => t.name === 'add_drum_pattern')?.parameters.type).toBe('object');
    const second = transport.requests[1]!.messages;
    const toolMessages = second.filter((m) => m.role === 'tool');
    expect(toolMessages).toHaveLength(2);
    expect(toolMessages[0]).toMatchObject({ toolCallId: 'call_1' });
    expect(
      JSON.parse(toolMessages[1]!.role === 'tool' ? toolMessages[1]!.content : ''),
    ).toMatchObject({
      clip: { lengthBars: 4, noteCount: 16 },
    });
    // The system prompt is rebuilt each turn with the updated project.
    const third = transport.requests[2]!.messages[0]!;
    expect(third.role === 'system' && third.content).toContain('Page: editor');
    expect(third.role === 'system' && third.content).toContain('"Beat"');
  });

  it('reports tool errors to the model so it can fix its input', async () => {
    const transport = new FakeAssistantTransport();
    transport.enqueue(
      transport.toolCalls([{ name: 'set_tempo', input: { bpm: 9000 } }]),
      (request) => {
        const last = request.messages.at(-1)!;
        expect(last.role).toBe('tool');
        expect(last.role === 'tool' && last.content).toContain('bpm must be ≤ 400');
        return transport.toolCalls([{ name: 'set_tempo', input: { bpm: 128 } }]);
      },
      FakeAssistantTransport.reply('Tempo set to 128 BPM.'),
    );
    const session = await startSession(transport);
    const convo = conversationFor(session);
    await convo.send('Set the tempo to 128');
    expect(session.history.present.bpm).toBe(128);
    const tools = convo.state.items.filter((i) => i.kind === 'tool');
    expect(tools.map((t) => t.kind === 'tool' && t.status)).toEqual(['error', 'ok']);
  });

  it('handles invalid JSON arguments and unknown tools without crashing', async () => {
    const transport = new FakeAssistantTransport();
    const broken: AssistantResponse = {
      message: {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'a', name: 'set_tempo', arguments: '{bpm: 1' },
          { id: 'b', name: 'make_coffee', arguments: '{}' },
        ],
      },
      model: 'fake',
      finishReason: 'tool_calls',
    };
    transport.enqueue(broken, FakeAssistantTransport.reply('Sorry about that.'));
    const session = await startSession(transport);
    const convo = conversationFor(session);
    await convo.send('hi');
    const tools = convo.state.items.filter((i) => i.kind === 'tool');
    expect(tools.map((t) => t.kind === 'tool' && t.error)).toEqual([
      expect.stringContaining('not valid JSON'),
      expect.stringContaining('Unknown tool "make_coffee"'),
    ]);
    expect(convo.messages.filter((m) => m.role === 'tool')).toHaveLength(2);
  });

  it('states deletions in the transcript and keeps them undoable', async () => {
    const transport = new FakeAssistantTransport();
    transport.enqueue(
      transport.toolCalls([{ name: 'delete_track', input: { trackId: 'Keys' } }]),
      FakeAssistantTransport.reply('Deleted the Keys track.'),
    );
    const session = await startSession(transport);
    session.edits.createMidiClip(session.history.present.trackOrder[0]!, 0);
    const convo = conversationFor(session);
    await convo.send('Delete the keys track');
    const chip = convo.state.items.find((i) => i.kind === 'tool');
    expect(chip?.kind === 'tool' && chip.deleted).toBe('Deleted track “Keys” and its 1 clip.');
    expect(session.history.present.trackOrder).toHaveLength(0);
    session.history.undo();
    expect(session.history.present.trackOrder).toHaveLength(1);
  });

  it('stops at the step limit with a notice', async () => {
    const transport = new FakeAssistantTransport();
    for (let i = 0; i < 5; i++)
      transport.enqueue(transport.toolCalls([{ name: 'list_tracks', input: {} }]));
    const session = await startSession(transport);
    const convo = conversationFor(session, 3);
    await convo.send('loop forever');
    expect(transport.requests).toHaveLength(3);
    const last = convo.state.items.at(-1);
    expect(last?.kind).toBe('notice');
    expect(last?.kind === 'notice' && last.text).toContain('Stopped after 3 steps');
  });

  it('aborts a pending model turn immediately and keeps applied changes', async () => {
    const transport = new FakeAssistantTransport();
    transport.enqueue(
      transport.toolCalls([{ name: 'set_tempo', input: { bpm: 100 } }]),
      () => new Promise<AssistantResponse>(() => undefined), // never resolves
    );
    const session = await startSession(transport);
    const convo = conversationFor(session);
    const done = convo.send('slow down');
    await new Promise((r) => setTimeout(r, 10));
    expect(convo.state.status).toBe('running');
    convo.abort();
    await done;
    expect(convo.state.status).toBe('idle');
    expect(session.history.present.bpm).toBe(100);
    const last = convo.state.items.at(-1);
    expect(last?.kind === 'notice' && last.text).toContain('Stopped.');
  });

  it('shows transport errors (not configured, rate limit) and retries the last message', async () => {
    const transport = new FakeAssistantTransport([
      assistantError('not-configured', 'OPENROUTER_API_KEY missing'),
      assistantError('rate-limited', 'Too many requests'),
      FakeAssistantTransport.reply('Hello!'),
    ]);
    const session = await startSession(transport);
    const convo = conversationFor(session);
    await convo.send('hi');
    expect(convo.state.error).toEqual({ code: 'not-configured', message: NOT_CONFIGURED_MESSAGE });
    await convo.retry();
    expect(convo.state.error?.code).toBe('rate-limited');
    expect(convo.state.error?.message).toContain('Too many requests');
    await convo.retry();
    expect(convo.state.error).toBeNull();
    expect(convo.state.items.map((i) => i.kind)).toEqual(['user', 'assistant']);
    expect(convo.messages.filter((m) => m.role === 'user')).toHaveLength(1);
  });

  it('explains a missing transport and clears the chat', async () => {
    const session = await startSession();
    const convo = conversationFor(session);
    expect(convo.isConfigured).toBe(false);
    await convo.send('hi');
    expect(convo.state.error).toEqual({ code: 'not-configured', message: NOT_CONFIGURED_MESSAGE });
    convo.clear();
    expect(convo.state.items).toHaveLength(0);
    expect(convo.messages).toHaveLength(0);
  });

  it('keeps one in-memory transcript per project and session', async () => {
    const session = await startSession(new FakeAssistantTransport());
    const a = getConversation(session, 'prj_a');
    expect(getConversation(session, 'prj_a')).toBe(a);
    expect(getConversation(session, 'prj_b')).not.toBe(a);
    const other = await startSession(new FakeAssistantTransport());
    expect(getConversation(other, 'prj_a')).not.toBe(a);
  });

  it('follows the user into a project the assistant opened', async () => {
    const transport = new FakeAssistantTransport();
    transport.enqueue(
      transport.toolCalls([{ name: 'new_project', input: { template: 'empty' } }]),
      FakeAssistantTransport.reply('Done.'),
    );
    const session = await startSession(transport);
    const first = session.history.present.id;
    const convo = getConversation(session, first);
    await convo.send('start a new song');
    const second = session.history.present.id;
    expect(second).not.toBe(first);
    expect(getConversation(session, second)).toBe(convo);
    expect(getConversation(session, first)).not.toBe(convo);
  });
});
