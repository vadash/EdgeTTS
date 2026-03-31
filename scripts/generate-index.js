import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function getTimestampEpoch(dirPath) {
  return statSync(dirPath).mtime.getTime();
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const deployDir = process.argv[2] || resolve(__dirname, '..', 'dist');
const currentSha = process.argv[3] || null;

// Collect sha/ directories
let shaDirs = [];
const shaDir = resolve(deployDir, 'sha');
try {
  shaDirs = readdirSync(shaDir)
    .filter((name) => statSync(resolve(shaDir, name)).isDirectory())
    .sort()
    .reverse(); // most recent first
} catch {
  // sha/ directory doesn't exist yet
}

// Collect v* tag directories (top-level)
const tagDirs = readdirSync(deployDir)
  .filter((name) => /^v/.test(name) && statSync(resolve(deployDir, name)).isDirectory())
  .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

// Split sha dirs into current vs previous
const currentEntry = currentSha
  ? shaDirs.find((d) => d === currentSha || d.startsWith(currentSha))
  : null;
const previousEntries = shaDirs.filter((d) => d !== currentEntry);

function renderList(items, prefix = './') {
  return items
    .map((name) => {
      const href = prefix.startsWith('sha') ? `${prefix}/${name}/` : `${prefix}${name}/`;
      const label = prefix.startsWith('sha') ? name.slice(0, 9) : name;
      return `      <li><a href="${href}">${label}</a></li>`;
    })
    .join('\n');
}

function renderSection(title, items, prefix) {
  if (items.length === 0) return '';
  return `
    <div class="versions">
      <h2>${title}</h2>
      <ul>
${renderList(items, prefix)}
      </ul>
    </div>`;
}

// Favicon: prefer current SHA, else first sha dir, else fallback
const faviconSha = currentEntry || shaDirs[0] || 'latest';
const faviconPath = `./sha/${faviconSha}/logo.png`;

// Auto-redirect script: redirect after 4s unless user interacts
const redirectScript = currentEntry
  ? `  <script>
    var t = setTimeout(function(){ window.location.replace('./sha/${currentEntry}/index.html'); }, 4000);
    function cancel(e){ clearTimeout(t); ['click','scroll','keydown','touchstart','mousemove'].forEach(function(n){ document.removeEventListener(n, cancel); }); }
    ['click','scroll','keydown','touchstart','mousemove'].forEach(function(n){ document.addEventListener(n, cancel); });
  </script>\n`
  : '';

// Current build section with Latest badge
const buildTimestamp = currentEntry
  ? getTimestampEpoch(resolve(shaDir, currentEntry))
  : '';
const currentSection = currentEntry
  ? `
    <div class="versions current">
      <h2>Current Build <span class="badge">Latest</span></h2>
      <ul>
      <li><a href="./sha/${currentEntry}/">${currentEntry.slice(0, 9)}</a> <span class="timestamp" data-t="${buildTimestamp}"></span></li>
      </ul>
    </div>`
  : '';

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EdgeTTS - Builds</title>
${redirectScript}  <link rel="icon" href="${faviconPath}">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background-color: #1a1a1a;
      color: #e0e0e0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 60px 20px;
    }
    h1 { font-size: 2.5rem; margin-bottom: 0.5rem; color: #fff; }
    .subtitle { color: #888; margin-bottom: 40px; }
    .versions {
      background: #252525;
      border: 1px solid #404040;
      border-radius: 12px;
      padding: 24px 32px;
      min-width: 300px;
      margin-bottom: 16px;
    }
    .versions.current {
      border-color: #0d6efd;
    }
    .badge {
      background: #0d6efd;
      color: #fff;
      font-size: 0.7rem;
      padding: 2px 8px;
      border-radius: 999px;
      vertical-align: middle;
      margin-left: 8px;
    }
    .versions h2 {
      font-size: 1rem;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 16px;
    }
    .versions.current h2 {
      color: #e0e0e0;
    }
    ul { list-style: none; }
    li { padding: 12px 0; border-bottom: 1px solid #333; }
    li:last-child { border-bottom: none; }
    a {
      color: #0d6efd;
      text-decoration: none;
      font-size: 1.1rem;
      font-weight: 500;
    }
    a:hover { color: #0b5ed7; text-decoration: underline; }
    .timestamp {
      color: #666;
      font-size: 0.85rem;
      margin-left: 12px;
    }
    footer {
      margin-top: auto;
      padding-top: 40px;
      color: #555;
      font-size: 0.85rem;
    }
    footer a { color: #666; }
  </style>
</head>
<body>
  <h1>EdgeTTS</h1>
  <p class="subtitle">Text to Speech Converter</p>
${currentSection}${renderSection('Previous Builds', previousEntries, './sha/')}${renderSection('Releases', tagDirs, './')}
  <footer>
    <a href="https://github.com/Vadash/EdgeTTS">GitHub</a>
  </footer>
  <script>
    function timeAgo(el) {
      var s = Math.floor((Date.now() - el.getAttribute('data-t')) / 1000);
      var v;
      if (s < 60) v = s + 's ago';
      else if (s < 3600) v = Math.round(s / 60) + 'min ago';
      else if (s < 86400) v = Math.round(s / 3600) + 'h ago';
      else v = Math.round(s / 86400) + 'd ago';
      el.textContent = v;
    }
    document.querySelectorAll('.timestamp[data-t]').forEach(timeAgo);
  </script>
</body>
</html>`;

writeFileSync(resolve(deployDir, 'index.html'), html);

const total = (currentEntry ? 1 : 0) + previousEntries.length + tagDirs.length;
console.log(
  `Generated index.html with ${total} versions (current: ${currentEntry ? currentEntry.slice(0, 9) : 'none'}, previous: ${previousEntries.length}, releases: ${tagDirs.length})`,
);
