import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const deployDir = process.argv[2] || resolve(__dirname, '..', 'dist');

// Get all version directories
const dirs = readdirSync(deployDir).filter((name) => {
  const path = resolve(deployDir, name);
  return statSync(path).isDirectory();
});

// Sort: latest first, then versions descending
const versions = dirs.sort((a, b) => {
  if (a === 'latest') return -1;
  if (b === 'latest') return 1;
  return b.localeCompare(a, undefined, { numeric: true });
});

const versionList = versions.map((v) => `      <li><a href="./${v}/">${v}</a></li>`).join('\n');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EdgeTTS - Builds</title>
  <link rel="icon" href="./latest/logo.png">
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
    }
    .versions h2 {
      font-size: 1rem;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 16px;
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
  <div class="versions">
    <h2>Available Builds</h2>
    <ul>
${versionList}
    </ul>
  </div>
  <footer>
    <a href="https://github.com/Vadash/EdgeTTS">GitHub</a>
  </footer>
</body>
</html>`;

writeFileSync(resolve(deployDir, 'index.html'), html);
console.log(`Generated index.html with ${versions.length} versions: ${versions.join(', ')}`);
