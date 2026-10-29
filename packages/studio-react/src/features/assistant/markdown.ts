/**
 * "Markdown-lite" for assistant replies: paragraphs, bullet/numbered lists, fenced code blocks
 * and inline `code` / **bold** / *italic*. Parsed into plain data and rendered as React
 * elements (never as HTML), so model output cannot inject markup.
 */

export type MdInline =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'code'; readonly text: string }
  | { readonly type: 'strong'; readonly text: string }
  | { readonly type: 'em'; readonly text: string };

export type MdBlock =
  | { readonly type: 'paragraph'; readonly lines: readonly string[] }
  | { readonly type: 'list'; readonly ordered: boolean; readonly items: readonly string[] }
  | { readonly type: 'code'; readonly text: string; readonly lang?: string }
  | { readonly type: 'heading'; readonly text: string };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const FENCE = /^\s*```\s*([\w-]*)\s*$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

export function parseMarkdown(source: string): MdBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MdBlock[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flush = () => {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', lines: paragraph });
    if (list) blocks.push({ type: 'list', ordered: list.ordered, items: list.items });
    paragraph = [];
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i]!)) code.push(lines[i++]!);
      blocks.push({ type: 'code', text: code.join('\n'), ...(fence[1] ? { lang: fence[1] } : {}) });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: 'heading', text: heading[1]! });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const item = bullet ?? numbered;
    if (item) {
      const ordered = Boolean(numbered);
      if (paragraph.length > 0 || (list && list.ordered !== ordered)) flush();
      list ??= { ordered, items: [] };
      list.items.push(item[1]!);
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) {
      // Indented continuation of the previous list item.
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    if (list) flush();
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\s][^*\n]*\*)/g;

export function parseInline(text: string): MdInline[] {
  const out: MdInline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index;
    if (index > last) out.push({ type: 'text', text: text.slice(last, index) });
    const token = match[0];
    if (match[1]) out.push({ type: 'code', text: token.slice(1, -1) });
    else if (match[2] || match[3]) out.push({ type: 'strong', text: token.slice(2, -2) });
    else out.push({ type: 'em', text: token.slice(1, -1) });
    last = index + token.length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}
