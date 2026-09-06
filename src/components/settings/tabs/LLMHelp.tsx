import { useEffect, useState } from 'preact/hooks';
import { MarkdownContent } from '@/components/common';

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

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        type="button"
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
            <div className="prose prose-invert prose-sm">
              <MarkdownContent text={content} />
            </div>
          ) : (
            <p className="text-gray-400">Loading...</p>
          )}
        </div>
      )}
    </div>
  );
}
