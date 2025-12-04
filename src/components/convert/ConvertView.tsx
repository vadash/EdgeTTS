import { FileDropZone } from './FileDropZone';
import { QuickVoiceSelect } from './QuickVoiceSelect';
import { ConvertButton } from './ConvertButton';
import { TextEditor } from './TextEditor';
import { StatusPanel } from '@/components/status';

export function ConvertView() {
  return (
    <div className="flex-1 flex flex-col md:flex-row gap-4 p-4 min-h-0">
      {/* Left Panel - Controls & Editor */}
      <div className="flex-1 flex flex-col gap-4 min-h-0">
        {/* Controls Row */}
        <div className="flex flex-col md:flex-row gap-4">
          {/* File Upload */}
          <div className="md:w-64 flex-shrink-0">
            <FileDropZone />
          </div>

          {/* Voice + Convert */}
          <div className="flex-1 flex flex-col gap-3">
            <QuickVoiceSelect />
            <ConvertButton />
          </div>
        </div>

        {/* Text Editor */}
        <div className="flex-1 min-h-0">
          <TextEditor />
        </div>
      </div>

      {/* Right Panel - Status (Desktop only, hidden on mobile - use Logs tab) */}
      <div className="hidden md:flex w-80 lg:w-96 flex-shrink-0">
        <StatusPanel />
      </div>
    </div>
  );
}
