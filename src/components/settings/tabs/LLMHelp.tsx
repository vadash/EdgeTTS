import type { VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';

export function LLMHelp() {
  const [expanded, setExpanded] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (expanded && !content) {
      fetch('./llm-help.md')
        .then((res) => {
          if (!res.ok) throw new Error('Failed to load');
          return res.text();
        })
        .then(setContent)
        .catch(() => setError(true));
    }
  }, [expanded, content]);

  // Simple markdown to HTML converter
  const renderMarkdown = (md: string) => {
    return md.split('\n').map((line, i) => {
      // Headers
      if (line.startsWith('# ')) {
        return (
          <h2 key={i} className="text-xl font-bold mt-4 mb-2">
            {line.slice(2)}
          </h2>
        );
      }
      if (line.startsWith('## ')) {
        return (
          <h3 key={i} className="text-lg font-semibold mt-4 mb-2 text-accent">
            {line.slice(3)}
          </h3>
        );
      }
      if (line.startsWith('### ')) {
        return (
          <h4 key={i} className="font-semibold mt-3 mb-1">
            {line.slice(4)}
          </h4>
        );
      }
      // Horizontal rule
      if (line.startsWith('---')) {
        return <hr key={i} className="border-border my-4" />;
      }
      // List items
      if (line.startsWith('- ')) {
        return (
          <li key={i} className="ml-4">
            {renderInline(line.slice(2))}
          </li>
        );
      }
      // Numbered list
      if (/^\d+\. /.test(line)) {
        return (
          <li key={i} className="ml-4 list-decimal">
            {renderInline(line.replace(/^\d+\. /, ''))}
          </li>
        );
      }
      // Empty line
      if (!line.trim()) {
        return <br key={i} />;
      }
      // Paragraph
      return (
        <p key={i} className="my-1">
          {renderInline(line)}
        </p>
      );
    });
  };

  // Inline formatting
  const renderInline = (text: string): (string | VNode)[] => {
    const parts: (string | VNode)[] = [];
    let remaining = text;
    let key = 0;

    while (remaining) {
      // Bold
      const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
      // Code
      const codeMatch = remaining.match(/`([^`]+)`/);
      // Link
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
      } else if (earliest.type === 'link') {
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
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between bg-primary/30 hover:bg-primary/50 transition-colors"
      >
        <span className="flex items-center gap-2">
          <span>💡</span>
          <span className="font-medium">Free LLM Options</span>
        </span>
        <span className="text-gray-400">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="p-4 bg-primary/20 text-sm max-h-96 overflow-y-auto">
          {error ? (
            <p className="text-red-400">Failed to load help content</p>
          ) : content ? (
            <div className="prose prose-invert prose-sm">{renderMarkdown(content)}</div>
          ) : (
            <p className="text-gray-400">Loading...</p>
          )}
        </div>
      )}
    </div>
  );
}
