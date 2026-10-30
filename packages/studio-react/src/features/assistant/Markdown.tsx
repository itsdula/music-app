import { parseInline, parseMarkdown, type MdBlock } from './markdown-parser';

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((token, i) => {
        switch (token.type) {
          case 'code':
            return (
              <code key={i} className="rounded bg-surface-3 px-1 font-mono text-[11px]">
                {token.text}
              </code>
            );
          case 'strong':
            return (
              <strong key={i} className="font-semibold">
                {token.text}
              </strong>
            );
          case 'em':
            return <em key={i}>{token.text}</em>;
          default:
            return <span key={i}>{token.text}</span>;
        }
      })}
    </>
  );
}

function Block({ block }: { block: MdBlock }) {
  switch (block.type) {
    case 'heading':
      return (
        <p className="font-semibold">
          <Inline text={block.text} />
        </p>
      );
    case 'paragraph':
      return (
        <p className="leading-relaxed">
          {block.lines.map((line, i) => (
            <span key={i}>
              {i > 0 && <br />}
              <Inline text={line} />
            </span>
          ))}
        </p>
      );
    case 'list': {
      const items = block.items.map((item, i) => (
        <li key={i} className="pl-0.5">
          <Inline text={item} />
        </li>
      ));
      return block.ordered ? (
        <ol className="list-decimal space-y-0.5 pl-5">{items}</ol>
      ) : (
        <ul className="list-disc space-y-0.5 pl-5">{items}</ul>
      );
    }
    case 'code':
      return (
        <pre className="overflow-x-auto rounded-md bg-surface-0 p-2 font-mono text-[11px] leading-snug">
          <code>{block.text}</code>
        </pre>
      );
  }
}

/** Renders assistant text with paragraphs, lists, code blocks and inline emphasis. */
export function Markdown({ source }: { source: string }) {
  return (
    <div className="flex flex-col gap-2">
      {parseMarkdown(source).map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </div>
  );
}
