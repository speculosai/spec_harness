/**
 * A small, safe markdown renderer for assistant text.
 *
 * The workspace ships no markdown dependency: a chat bubble needs headings, lists,
 * fenced code and a few inline marks, and that is a hundred lines. Everything is
 * rendered as React elements - there is no `dangerouslySetInnerHTML` anywhere in this
 * package, so model output can never inject markup into the host page. Link hrefs are
 * additionally restricted to http(s), which rules out `javascript:` URLs.
 */

import type { ReactElement, ReactNode } from 'react';

const SAFE_HREF = /^https?:\/\//i;

/** Split one line into inline marks: code, bold, italic, links. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\([^)\s]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-i${index++}`;
    if (token.startsWith('`')) {
      out.push(
        <code key={key} className="harness-code-inline">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**')) {
      out.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*')) {
      out.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      const split = token.indexOf('](');
      const label = token.slice(1, split);
      const href = token.slice(split + 2, -1);
      out.push(
        SAFE_HREF.test(href) ? (
          <a key={key} href={href} target="_blank" rel="noreferrer noopener">
            {label}
          </a>
        ) : (
          <span key={key}>{label}</span>
        ),
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * Render markdown-ish assistant text as React nodes. Unsupported syntax degrades to
 * the literal text rather than disappearing, which is the right failure for a chat
 * transcript.
 */
export function Markdown({ text }: { text: string }): ReactElement {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    const body = paragraph.join('\n');
    blocks.push(
      <p key={`p${key++}`} className="harness-md-p">
        {renderInline(body, `p${key}`)}
      </p>,
    );
    paragraph = [];
  };

  const flushList = (): void => {
    if (!list) return;
    const items = list.items.map((item, i) => <li key={i}>{renderInline(item, `l${key}-${i}`)}</li>);
    blocks.push(
      list.ordered ? (
        <ol key={`l${key++}`} className="harness-md-list">
          {items}
        </ol>
      ) : (
        <ul key={`l${key++}`} className="harness-md-list">
          {items}
        </ul>
      ),
    );
    list = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';

    if (line.startsWith('```')) {
      flushParagraph();
      flushList();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) {
        body.push(lines[i] ?? '');
        i += 1;
      }
      blocks.push(
        <pre key={`c${key++}`} className="harness-code-block">
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = (heading[1] ?? '#').length;
      const content = renderInline(heading[2] ?? '', `h${key}`);
      blocks.push(
        level === 1 ? (
          <h3 key={`h${key++}`} className="harness-md-h">
            {content}
          </h3>
        ) : level === 2 ? (
          <h4 key={`h${key++}`} className="harness-md-h">
            {content}
          </h4>
        ) : (
          <h5 key={`h${key++}`} className="harness-md-h">
            {content}
          </h5>
        ),
      );
      continue;
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = !!numbered;
      const item = (bullet ?? numbered)?.[1] ?? '';
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(item);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();

  return <div className="harness-md">{blocks}</div>;
}
