import { useEffect, useState } from 'preact/hooks';
import { MarkdownContent } from '@/components/common';

interface MarkdownViewProps {
  file: string;
  title: string;
}

export function MarkdownView({ file, title }: MarkdownViewProps) {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(file)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load ${file}`);
        return res.text();
      })
      .then((text) => {
        setContent(text);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [file]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="text-red-400">{error}</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col p-4 min-h-0 overflow-auto">
      <div className="flex-1 bg-primary-secondary rounded-lg border border-border p-6 overflow-auto">
        <h1 className="text-xl font-bold text-white mb-4">{title}</h1>
        <div className="prose prose-invert prose-sm max-w-none">
          <MarkdownContent text={content} />
        </div>
      </div>
    </div>
  );
}
