// VoicePicker
// Custom voice selection panel with gendered rows and crossed-out used voices.

import { useEffect, useRef, useState } from 'preact/hooks';
import type { VoiceOption } from '@/state/types';

interface VoicePickerProps {
  /** Full voice value currently selected for this row */
  value: string;
  /** All enabled voices, split by gender */
  maleVoices: VoiceOption[];
  femaleVoices: VoiceOption[];
  /** Voices already assigned to characters ABOVE this row (name -> character) */
  usedAbove: Map<string, string>;
  onChange: (voice: string) => void;
}

/** "en-US, JennyNeural" -> "en-US-JennyNeural" */
function shortLabel(fullValue: string): string {
  return fullValue.replace(', ', '-');
}

export function VoicePicker({
  value,
  maleVoices,
  femaleVoices,
  usedAbove,
  onChange,
}: VoicePickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const handleSelect = (voice: string) => {
    onChange(voice);
    setOpen(false);
  };

  const renderChip = (v: VoiceOption) => {
    const isSelected = v.fullValue === value;
    const usedBy = usedAbove.get(v.fullValue);
    const isUsed = usedBy !== undefined;

    return (
      <button
        key={v.fullValue}
        type="button"
        title={isUsed ? `Used by: ${usedBy}` : v.fullValue}
        onClick={() => handleSelect(v.fullValue)}
        className={[
          'px-2 py-0.5 rounded text-xs border transition-colors text-left',
          isSelected
            ? 'bg-primary/20 border-primary text-primary font-semibold'
            : 'border-border hover:bg-surface-alt',
          isUsed ? 'opacity-50' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <span className={isUsed ? 'line-through' : ''}>{shortLabel(v.fullValue)}</span>
      </button>
    );
  };

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="select-field w-full text-sm text-left flex items-center justify-between gap-1"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{shortLabel(value || '—')}</span>
        <span className="text-gray-400 shrink-0">▾</span>
      </button>

      {/* Panel */}
      {open && (
        <div
          role="listbox"
          className="absolute z-50 left-0 top-full mt-1 w-80 max-h-72 overflow-y-auto bg-surface border border-border rounded-lg shadow-xl p-3 flex flex-col gap-3"
        >
          {/* Male row */}
          {maleVoices.length > 0 && (
            <div>
              <div className="text-xs text-gray-400 font-medium mb-1.5 uppercase tracking-wide">
                Male
              </div>
              <div className="flex flex-wrap gap-1">{maleVoices.map(renderChip)}</div>
            </div>
          )}

          {/* Female row */}
          {femaleVoices.length > 0 && (
            <div>
              <div className="text-xs text-gray-400 font-medium mb-1.5 uppercase tracking-wide">
                Female
              </div>
              <div className="flex flex-wrap gap-1">{femaleVoices.map(renderChip)}</div>
            </div>
          )}

          {maleVoices.length === 0 && femaleVoices.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-2">No voices available</p>
          )}
        </div>
      )}
    </div>
  );
}
