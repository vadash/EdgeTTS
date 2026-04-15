import { StatusPanel } from '@/components/status';
import {
  cancelResume,
  cancelReview,
  confirmResume,
  confirmReview,
  isConfigured,
  pendingReview,
  resumeInfo,
} from '@/stores';
import { Text } from 'preact-i18n';
import { NotificationBanner } from '@/components/common';
import { ConvertButton } from './ConvertButton';
import { FileDropZone } from './FileDropZone';
import { QuickVoiceSelect } from './QuickVoiceSelect';
import { ResumeModal } from './ResumeModal';
import { TextEditor } from './TextEditor';
import { VoiceReviewModal } from './VoiceReviewModal';

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

        {/* Notification Banners */}
        <div className="flex flex-col gap-2 flex-shrink-0">
          <NotificationBanner
            type="warning"
            storageKey="llmRequired"
            show={!isConfigured.value}
            title={<Text id="convert.hints.llmRequiredTitle">LLM API Key Required</Text>}
          >
            <Text id="convert.hints.llmRequiredDesc">
              This app uses AI to detect characters and assign voices. It will not work without an
              API key.
            </Text>
          </NotificationBanner>
          <NotificationBanner
            type="info"
            storageKey="resumeFeatureTip"
            title={<Text id="convert.hints.resumeTitle">Crash Recovery & Resume</Text>}
          >
            <Text id="convert.hints.resumeDesc">
              Audio generation is auto-saved to your selected folder. If you close the tab, you can
              resume later.
            </Text>
          </NotificationBanner>
        </div>

        {/* Text Editor */}
        <div className="flex-1 min-h-0">
          <TextEditor />
        </div>
      </div>

      {/* Right Panel - Status (Desktop only, hidden on mobile - use Logs tab) */}
      <div className="hidden md:flex w-80 lg:w-96 flex-shrink-0 min-h-0">
        <StatusPanel />
      </div>

      {/* Voice Review Modal */}
      {pendingReview.value && (
        <VoiceReviewModal onConfirm={() => confirmReview()} onCancel={() => cancelReview()} />
      )}

      {/* Resume Modal */}
      {resumeInfo.value && (
        <ResumeModal
          info={resumeInfo.value}
          onContinue={() => confirmResume()}
          onCancel={() => cancelResume()}
        />
      )}
    </div>
  );
}
