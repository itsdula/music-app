import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from '../src/features/assistant/markdown';

describe('assistant markdown-lite', () => {
  it('splits paragraphs, lists and fenced code', () => {
    const blocks = parseMarkdown(
      'Here is your beat.\nIt has 4 bars.\n\n- kick\n- snare\n\n1. first\n2) second\n\n```json\n{"a": 1}\n```\nDone',
    );
    expect(blocks).toEqual([
      { type: 'paragraph', lines: ['Here is your beat.', 'It has 4 bars.'] },
      { type: 'list', ordered: false, items: ['kick', 'snare'] },
      { type: 'list', ordered: true, items: ['first', 'second'] },
      { type: 'code', lang: 'json', text: '{"a": 1}' },
      { type: 'paragraph', lines: ['Done'] },
    ]);
  });

  it('handles list continuations, headings and an unterminated fence', () => {
    expect(parseMarkdown('## Plan\n- one\n  more\ntext\n```\ncode')).toEqual([
      { type: 'heading', text: 'Plan' },
      { type: 'list', ordered: false, items: ['one more'] },
      { type: 'paragraph', lines: ['text'] },
      { type: 'code', text: 'code' },
    ]);
  });

  it('parses inline code, bold and italic without touching HTML', () => {
    expect(parseInline('Use `trk_1` for **drums**, *softly* <b>x</b>')).toEqual([
      { type: 'text', text: 'Use ' },
      { type: 'code', text: 'trk_1' },
      { type: 'text', text: ' for ' },
      { type: 'strong', text: 'drums' },
      { type: 'text', text: ', ' },
      { type: 'em', text: 'softly' },
      { type: 'text', text: ' <b>x</b>' },
    ]);
    expect(parseInline('2 * 3 * 4')).toEqual([{ type: 'text', text: '2 * 3 * 4' }]);
  });
});
