import type { VNode } from 'preact';

/**
 * Minimal markdown renderer shared by help/info views.
 * Block level: headers, horizontal rules, list items, blank lines,
 * paragraphs. Inline: bold, code spans, links.
 */
export function MarkdownContent({ text }: { text: string }) {
  const lines = text.split('\n');
  return <>{lines.map(renderLine)}</>;
}

function renderLine(line: string, i: number): VNode {
  // Create a stable key from line content and position
  const key = `line-${i}-${line.slice(0, 20).replace(/\s/g, '-')}`;

  if (line.startsWith('# ')) {
    return (
      <h2 key={key} className="text-xl font-bold mt-4 mb-2">
        {line.slice(2)}
      </h2>
    );
  }
  if (line.startsWith('## ')) {
    return (
      <h3 key={key} className="text-lg font-semibold mt-4 mb-2 text-accent">
        {line.slice(3)}
      </h3>
    );
  }
  if (line.startsWith('### ')) {
    return (
      <h4 key={key} className="font-semibold mt-3 mb-1">
        {line.slice(4)}
      </h4>
    );
  }
  if (line.startsWith('---')) {
    return <hr key={key} className="border-border my-4" />;
  }
  if (line.startsWith('- ')) {
    return (
      <li key={key} className="ml-4">
        {renderInline(line.slice(2))}
      </li>
    );
  }
  if (/^\d+\. /.test(line)) {
    return (
      <li key={key} className="ml-4 list-decimal">
        {renderInline(line.replace(/^\d+\. /, ''))}
      </li>
    );
  }
  if (!line.trim()) {
    return <br key={key} />;
  }
  return (
    <p key={key} className="my-1">
      {renderInline(line)}
    </p>
  );
}

function renderInline(text: string): (string | VNode)[] {
  const parts: (string | VNode)[] = [];
  let remaining = text;
  let key = 0;

  while (remaining) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    const codeMatch = remaining.match(/`([^`]+)`/);
    const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)]+)\)/);

    const matches = [
      boldMatch && { type: 'bold', match: boldMatch, index: boldMatch.index! },
      codeMatch && { type: 'code', match: codeMatch, index: codeMatch.index! },
      linkMatch && { type: 'link', match: linkMatch, index: linkMatch.index! },
    ].filter(Boolean) as { type: string; match: RegExpMatchArray; index: number }[];

    if (matches.length === 0) {
      parts.push(remaining);
      break;
    }

    // Process earliest match
    const earliest = matches.sort((a, b) => a.index - b.index)[0];

    if (earliest.index > 0) {
      parts.push(remaining.slice(0, earliest.index));
    }

    if (earliest.type === 'bold') {
      parts.push(<strong key={key++}>{earliest.match[1]}</strong>);
      remaining = remaining.slice(earliest.index + earliest.match[0].length);
    } else if (earliest.type === 'code') {
      parts.push(
        <code key={key++} className="bg-primary/50 px-1 rounded text-accent">
          {earliest.match[1]}
        </code>,
      );
      remaining = remaining.slice(earliest.index + earliest.match[0].length);
    } else {
      parts.push(
        <a
          key={key++}
          href={earliest.match[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          {earliest.match[1]}
        </a>,
      );
      remaining = remaining.slice(earliest.index + earliest.match[0].length);
    }
  }

  return parts;
}
