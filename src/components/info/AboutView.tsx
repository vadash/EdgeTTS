import { Text } from 'preact-i18n';

export function AboutView() {
  return (
    <div class="about-view max-w-3xl mx-auto p-6 prose prose-slate dark:prose-invert">
      <header class="mb-8">
        <h1 class="text-3xl font-bold mb-2">
          <Text id="about.headline">Edge TTS Web</Text>
        </h1>
        <p class="text-lg text-muted-foreground">
          <Text id="about.subtitle">Convert text files to high-quality audiobooks...</Text>
        </p>
      </header>

      <section class="mb-8">
        <h2 class="text-2xl font-semibold mb-4">
          <Text id="about.whatItDoes.title">What It Does</Text>
        </h2>
        <p class="mb-4">
          <Text id="about.whatItDoes.description">Upload a book...</Text>
        </p>
        <p>
          <Text id="about.whatItDoes.sampleLink" />
          {' '}
          <a
            href="https://files.catbox.moe/x6boa8.opus"
            target="_blank"
            rel="noopener noreferrer"
            class="text-blue-600 dark:text-blue-400 hover:underline"
          >
            Sample (Opus)
          </a>
        </p>
      </section>

      <section class="mb-8">
        <h2 class="text-2xl font-semibold mb-4">
          <Text id="about.features.title">Features</Text>
        </h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FeatureRow
            label={<Text id="about.features.multiFormat.label">Multi-Format Input</Text>}
            value={<Text id="about.features.multiFormat.value">TXT, FB2, EPUB, ZIP archives</Text>}
          />
          <FeatureRow
            label={<Text id="about.features.audioOutput.label">Audio Output</Text>}
            value={<Text id="about.features.audioOutput.value">MP3 or Opus...</Text>}
          />
          <FeatureRow
            label={<Text id="about.features.multiVoice.label">Multi-Voice</Text>}
            value={<Text id="about.features.multiVoice.value">LLM-powered...</Text>}
          />
          <FeatureRow
            label={<Text id="about.features.genderAware.label">Gender-Aware</Text>}
            value={<Text id="about.features.genderAware.value">Male/female voices...</Text>}
          />
          <FeatureRow
            label={<Text id="about.features.parallel.label">Parallel Processing</Text>}
            value={<Text id="about.features.parallel.value">Multi-threaded...</Text>}
          />
          <FeatureRow
            label={<Text id="about.features.audioProcessing.label">Audio Processing</Text>}
            value={<Text id="about.features.audioProcessing.value">Silence removal...</Text>}
          />
          <FeatureRow
            label={<Text id="about.features.dictionary.label">Dictionary Support</Text>}
            value={<Text id="about.features.dictionary.value">Custom pronunciation...</Text>}
          />
          <FeatureRow
            label={<Text id="about.features.dragDrop.label">Drag & Drop</Text>}
            value={<Text id="about.features.dragDrop.value">Simple file upload...</Text>}
          />
          <FeatureRow
            label={<Text id="about.features.progress.label">Progress Tracking</Text>}
            value={<Text id="about.features.progress.value">Real-time status...</Text>}
          />
          <FeatureRow
            label={<Text id="about.features.backup.label">Settings Backup</Text>}
            value={<Text id="about.features.backup.value">Export/import...</Text>}
          />
        </div>
      </section>

      <section class="mb-8">
        <h2 class="text-2xl font-semibold mb-4">
          <Text id="about.howItWorks.title">How It Works</Text>
        </h2>
        <ol class="list-decimal list-inside space-y-3">
          <StepItem
            title={<Text id="about.howItWorks.step1.title">Text Splitting</Text>}
            desc={<Text id="about.howItWorks.step1.desc">Input is split...</Text>}
          />
          <StepItem
            title={<Text id="about.howItWorks.step2.title">Character Extraction</Text>}
            desc={<Text id="about.howItWorks.step2.desc">LLM identifies...</Text>}
          />
          <StepItem
            title={<Text id="about.howItWorks.step3.title">Speaker Assignment</Text>}
            desc={<Text id="about.howItWorks.step3.desc">Each sentence gets...</Text>}
          />
          <StepItem
            title={<Text id="about.howItWorks.step4.title">Voice Mapping</Text>}
            desc={<Text id="about.howItWorks.step4.desc">Top characters get...</Text>}
          />
          <StepItem
            title={<Text id="about.howItWorks.step5.title">TTS Conversion</Text>}
            desc={<Text id="about.howItWorks.step5.desc">Sentences are sent...</Text>}
          />
          <StepItem
            title={<Text id="about.howItWorks.step6.title">Audio Merge</Text>}
            desc={<Text id="about.howItWorks.step6.desc">FFmpeg combines...</Text>}
          />
        </ol>
      </section>

      <section class="mb-8">
        <h2 class="text-2xl font-semibold mb-4">
          <Text id="about.quickStart.title">Quick Start</Text>
        </h2>
        <ol class="list-decimal list-inside space-y-2">
          <li><Text id="about.quickStart.step1">Upload — Drop a file or paste text</Text></li>
          <li><Text id="about.quickStart.step2">Configure — Pick voice, speed, pitch in Settings</Text></li>
          <li><Text id="about.quickStart.step3">Enable LLM (optional) — For multi-voice books, add an API key in Settings → LLM</Text></li>
          <li><Text id="about.quickStart.step4">Convert — Click "Save to MP3" and pick an output folder</Text></li>
        </ol>
      </section>

      <section class="mb-8">
        <h2 class="text-2xl font-semibold mb-4">
          <Text id="about.llmSetup.title">LLM Setup</Text>
        </h2>
        <p class="mb-4">
          <Text id="about.llmSetup.description">For multi-voice audiobooks, you need an OpenAI-compatible API:</Text>
        </p>
        <ul class="list-disc list-inside space-y-1 mb-4">
          <li><Text id="about.llmSetup.gemini">Google Gemini — free tier available</Text></li>
          <li><Text id="about.llmSetup.openRouter">OpenRouter — many free models</Text></li>
          <li><Text id="about.llmSetup.anyProvider">Any OpenAI-compatible provider</Text></li>
        </ul>
        <p class="text-sm">
          <Text id="about.llmSetup.instructions.before" />
          <strong><Text id="about.llmSetup.instructions.link" /></strong>
          <Text id="about.llmSetup.instructions.after" />
        </p>
        <p class="text-sm mt-2">
          <Text id="about.llmSetup.help.before" />
          <strong><Text id="about.llmSetup.help.icon" /></strong>
          <Text id="about.llmSetup.help.after" />
        </p>
      </section>

      <section class="mb-8">
        <h2 class="text-2xl font-semibold mb-4">
          <Text id="about.techStack.title">Tech Stack</Text>
        </h2>
        <ul class="list-disc list-inside space-y-1">
          <li><Text id="about.techStack.ui">UI: Preact + TypeScript + Tailwind CSS</Text></li>
          <li><Text id="about.techStack.tts">TTS: Microsoft Edge WebSocket API</Text></li>
          <li><Text id="about.techStack.audio">Audio: FFmpeg WASM</Text></li>
          <li><Text id="about.techStack.llm">LLM: OpenAI-compatible API</Text></li>
          <li><Text id="about.techStack.storage">Storage: IndexedDB + File System Access API</Text></li>
          <li><Text id="about.techStack.state">State: @preact/signals</Text></li>
          <li><Text id="about.techStack.build">Build: Vite</Text></li>
        </ul>
      </section>

      <footer class="mt-12 pt-6 border-t border-border text-sm text-muted-foreground text-center">
        <Text id="about.footer">Everything runs locally in your browser. No server, no uploads, no tracking.</Text>
      </footer>
    </div>
  );
}

interface FeatureRowProps {
  label: JSX.Element | string;
  value: JSX.Element | string;
}

function FeatureRow({ label, value }: FeatureRowProps) {
  return (
    <div class="flex gap-4 p-3 rounded-lg bg-muted/50">
      <span class="font-semibold min-w-[140px]">{label}</span>
      <span class="text-muted-foreground">{value}</span>
    </div>
  );
}

interface StepItemProps {
  title: JSX.Element | string;
  desc: JSX.Element | string;
}

function StepItem({ title, desc }: StepItemProps) {
  return (
    <li class="pl-2">
      <span class="font-semibold">{title}</span>
      {' — '}
      <span class="text-muted-foreground">{desc}</span>
    </li>
  );
}
