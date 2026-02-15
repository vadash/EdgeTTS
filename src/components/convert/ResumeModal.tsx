import { Text } from 'preact-i18n';
import { Button } from '@/components/common';

export interface ResumeInfo {
  cachedChunks: number;
  totalChunks: number;
  cachedOutputFiles: number;
  hasLLMState: boolean;
}

interface ResumeModalProps {
  info: ResumeInfo;
  onContinue: () => void;
  onCancel: () => void;
}

export function ResumeModal({ info, onContinue, onCancel }: ResumeModalProps) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-surface border border-border rounded-lg shadow-xl max-w-md w-full">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-lg font-semibold">↻ Previous Session Found</h2>
        </div>
        <div className="px-4 py-4 space-y-2 text-sm">
          {info.hasLLMState && (
            <p className="text-green-400">✓ LLM voice assignments cached</p>
          )}
          {info.cachedChunks > 0 && (
            <p>{info.cachedChunks} audio chunks cached.</p>
          )}
          {info.cachedOutputFiles > 0 && (
            <p>{info.cachedOutputFiles} output files already exist.</p>
          )}
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={onContinue}>Continue</Button>
        </div>
      </div>
    </div>
  );
}
