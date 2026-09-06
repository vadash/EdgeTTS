import { Button, Modal } from '@/components/common';

export interface ResumeInfo {
  cachedChunks: number;
  hasLLMState: boolean;
}

interface ResumeModalProps {
  info: ResumeInfo;
  onContinue: () => void;
  onCancel: () => void;
}

export function ResumeModal({ info, onContinue, onCancel }: ResumeModalProps) {
  return (
    <Modal title="↻ Previous Session Found" className="max-w-md w-full">
      <div className="px-4 py-4 space-y-2 text-sm">
        {info.hasLLMState && <p className="text-green-400">✓ LLM voice assignments cached</p>}
        {info.cachedChunks > 0 && <p>{info.cachedChunks} audio chunks cached.</p>}
      </div>
      <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={onContinue}>
          Continue
        </Button>
      </div>
    </Modal>
  );
}
