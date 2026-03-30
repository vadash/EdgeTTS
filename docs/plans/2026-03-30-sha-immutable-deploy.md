# SHA-based Immutable Deploy Paths — Implementation Plan

**Goal:** Replace mutable `latest/` directory with content-addressed `sha/<sha>/` directories so every deploy produces a fresh, cache-busting URL.
**Architecture:** The build-latest job copies build output to `deploy/sha/<full-sha>/` instead of `deploy/latest/`. The deploy job runs a cleanup step (keep N most recent) and passes the SHA to `generate-index.js`, which groups entries into Current / Previous / Releases sections.
**Tech Stack:** Bash (GitHub Actions), Node.js (`scripts/generate-index.js`), Vitest

---

### File Structure Overview

- Modify: `.github/workflows/deploy.yml` — change build output path, artifact name, add cleanup step, pass SHA to index script
- Modify: `scripts/generate-index.js` — accept SHA argument, group into Current/Previous/Releases, favicon from current SHA
- Modify: `vitest.config.ts` — add `scripts/**/*.test.ts` to include pattern
- Create: `scripts/generate-index.test.ts` — unit tests for the index generator

---

### Task 1: Refactor `generate-index.js` to accept a current SHA argument

**Files:**
- Modify: `scripts/generate-index.js`
- Modify: `vitest.config.ts`
- Create: `scripts/generate-index.test.ts`
- Test: `scripts/generate-index.test.ts`

**Common Pitfalls:**
- The current script reads `process.argv[2]` as `deployDir`. The SHA must be `process.argv[3]`.
- The script uses `import.meta.url` for `__dirname` — tests must not rely on that; pass `deployDir` explicitly.
- Vitest config currently only includes `src/**/*.test.{ts,tsx}` — must add `scripts/**/*.test.ts`.
- Tests must create/tear down temp directories using Node `fs` and `os.tmpdir()`.

- [ ] Step 1: Write failing tests

Create `scripts/generate-index.test.ts`:

```typescript
import { readdirSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { describe, it, beforeEach, afterEach, expect } from 'vitest';

function createFakeDeployDir(): string {
  const dir = resolve(tmpdir(), `deploy-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });

  // Create sha subdirs
  mkdirSync(join(dir, 'sha', 'aaa1111111111111111111111111111111111111'), { recursive: true });
  mkdirSync(join(dir, 'sha', 'bbb2222222222222222222222222222222222222'), { recursive: true });
  mkdirSync(join(dir, 'sha', 'ccc3333333333333333333333333333333333333'), { recursive: true });

  // Create tag subdirs
  mkdirSync(join(dir, 'v1.0.0'), { recursive: true });
  mkdirSync(join(dir, 'v2.0.0'), { recursive: true });

  // Put a logo in the current sha dir
  writeFileSync(join(dir, 'sha', 'ccc3333333333333333333333333333333333333', 'logo.png'), 'fake');

  return dir;
}

function runScript(deployDir: string, sha?: string) {
  const args = sha ? `"${deployDir}" "${sha}"` : `"${deployDir}"`;
  execSync(`node --experimental-vm-modules scripts/generate-index.js ${args}`, {
    cwd: resolve(import.meta.dirname, '..'),
  });
}

describe('generate-index.js', () => {
  let deployDir: string;

  beforeEach(() => {
    deployDir = createFakeDeployDir();
  });

  afterEach(() => {
    rmSync(deployDir, { recursive: true, force: true });
  });

  it('generates index.html in deploy dir', () => {
    runScript(deployDir, 'ccc3333333333333333333333333333333333333');
    expect(existsSync(join(deployDir, 'index.html'))).toBe(true);
  });

  it('links to current SHA directory', () => {
    runScript(deployDir, 'ccc3333333333333333333333333333333333333');
    const html = readFileSync(join(deployDir, 'index.html'), 'utf-8');
    expect(html).toContain('./sha/ccc3333333333333333333333333333333333333/');
  });

  it('marks current SHA with Latest badge', () => {
    runScript(deployDir, 'ccc3333333333333333333333333333333333333');
    const html = readFileSync(join(deployDir, 'index.html'), 'utf-8');
    expect(html).toContain('Latest');
  });

  it('lists previous SHA builds in separate section', () => {
    runScript(deployDir, 'ccc3333333333333333333333333333333333333');
    const html = readFileSync(join(deployDir, 'index.html'), 'utf-8');
    expect(html).toContain('./sha/aaa1111111111111111111111111111111111111/');
    expect(html).toContain('./sha/bbb2222222222222222222222222222222222222/');
    expect(html).toContain('Previous Builds');
  });

  it('lists release tags in separate section', () => {
    runScript(deployDir, 'ccc3333333333333333333333333333333333333');
    const html = readFileSync(join(deployDir, 'index.html'), 'utf-8');
    expect(html).toContain('./v2.0.0/');
    expect(html).toContain('./v1.0.0/');
    expect(html).toContain('Releases');
  });

  it('uses current SHA for favicon', () => {
    runScript(deployDir, 'ccc3333333333333333333333333333333333333');
    const html = readFileSync(join(deployDir, 'index.html'), 'utf-8');
    expect(html).toContain('./sha/ccc3333333333333333333333333333333333333/logo.png');
    expect(html).not.toContain('./latest/logo.png');
  });

  it('works without SHA argument (backward compat — lists all dirs)', () => {
    runScript(deployDir);
    const html = readFileSync(join(deployDir, 'index.html'), 'utf-8');
    expect(html).toContain('./sha/');
    expect(existsSync(join(deployDir, 'index.html'))).toBe(true);
  });

  it('includes meta refresh redirect to current SHA', () => {
    runScript(deployDir, 'ccc3333333333333333333333333333333333333');
    const html = readFileSync(join(deployDir, 'index.html'), 'utf-8');
    expect(html).toContain('http-equiv="refresh"');
    expect(html).toContain('./sha/ccc3333333333333333333333333333333333333/index.html');
  });
});
```

- [ ] Step 2: Extend vitest config to find script tests

Modify `vitest.config.ts` — change the `include` array:

```typescript
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
```

- [ ] Step 3: Run tests to verify they fail

Run: `npx vitest run scripts/generate-index.test.ts`
Expected: FAIL — the current script does not accept a SHA argument and does not produce SHA-grouped HTML.

- [ ] Step 4: Rewrite `scripts/generate-index.js`

Replace the entire content of `scripts/generate-index.js` with:

```javascript
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const currentEntry = currentSha ? shaDirs.find((d) => d === currentSha || d.startsWith(currentSha)) : null;
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

// Meta refresh (only when we have a current SHA)
const metaRefresh = currentEntry
  ? `  <meta http-equiv="refresh" content="2;url=./sha/${currentEntry}/index.html">\n`
  : '';

// Current build section with Latest badge
const currentSection = currentEntry
  ? `
    <div class="versions current">
      <h2>Current Build <span class="badge">Latest</span></h2>
      <ul>
      <li><a href="./sha/${currentEntry}/">${currentEntry.slice(0, 9)}</a></li>
      </ul>
    </div>`
  : '';

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
${metaRefresh}  <title>EdgeTTS - Builds</title>
  <link rel="icon" href="${faviconPath}">
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
</body>
</html>`;

writeFileSync(resolve(deployDir, 'index.html'), html);

const total = (currentEntry ? 1 : 0) + previousEntries.length + tagDirs.length;
console.log(`Generated index.html with ${total} versions (current: ${currentEntry ? currentEntry.slice(0, 9) : 'none'}, previous: ${previousEntries.length}, releases: ${tagDirs.length})`);
```

- [ ] Step 5: Run tests to verify they pass

Run: `npx vitest run scripts/generate-index.test.ts`
Expected: All 8 tests PASS.

- [ ] Step 6: Commit

```bash
git add -A && git commit -m "refactor: rewrite generate-index.js with SHA-based immutable paths"
```

---

### Task 2: Update `deploy.yml` — build-latest job

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] Step 1: Modify the `build-latest` job

In `.github/workflows/deploy.yml`, replace the "Build and stage latest" step:

```yaml
      - name: Build and stage latest
        shell: bash
        run: |
          set -euo pipefail

          npm run build

          # Guard: fail loudly if the build didn't produce the expected output.
          [[ -d dist/latest ]] || { echo "::error::dist/latest not found after build"; exit 1; }
          [[ -f dist/404.html ]] || { echo "::error::dist/404.html not found after build"; exit 1; }

          mkdir -p "deploy/sha"
          cp -r dist/latest "deploy/sha/${GITHUB_SHA}"
          cp dist/404.html deploy/404.html
```

And change the artifact name:

```yaml
      - uses: actions/upload-artifact@v4
        with:
          name: deploy-sha-${{ github.sha }}
          path: deploy/
```

- [ ] Step 2: Verify the YAML is valid (visual check, no tests for YAML)

Review the changed job. Key changes:
- `deploy/latest` → `deploy/sha/${GITHUB_SHA}`
- artifact name `deploy-latest` → `deploy-sha-${{ github.sha }}`
- `rm -rf deploy/latest` guard removed (SHA dir is unique, no stale content possible)

- [ ] Step 3: Commit

```bash
git add -A && git commit -m "ci: build to sha/<sha> instead of latest for cache-busting"
```

---

### Task 3: Update `deploy.yml` — deploy job (cleanup + index generation)

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] Step 1: Add cleanup step and update index generation

In the `deploy` job, after "Download and merge all build artifacts" and before "Generate version index page", add a cleanup step. Also update the index generation to pass the SHA:

```yaml
      - name: Cleanup old SHA builds (keep newest 10)
        env:
          SHA_KEEP_COUNT: 10
        shell: bash
        run: |
          if [[ -d deploy/sha ]]; then
            cd deploy/sha
            # List directories, sort (most recent = highest SHA first), skip the newest 10
            ls -1d */ 2>/dev/null \
              | sort -r \
              | tail -n +$((SHA_KEEP_COUNT + 1)) \
              | xargs -r rm -rf
            echo "Cleaned up old SHA builds"
          fi

      - name: Generate version index page
        run: node scripts/generate-index.js deploy ${{ github.sha }}
```

- [ ] Step 2: Verify the full deploy job YAML looks correct

The deploy job should now be:

```yaml
  deploy:
    needs: [build-latest, build-tags]
    if: always() && needs.build-latest.result == 'success'
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4

      - name: Download and merge all build artifacts
        uses: actions/download-artifact@v4
        with:
          pattern: deploy-*
          path: deploy/
          merge-multiple: true

      - name: Cleanup old SHA builds (keep newest 10)
        env:
          SHA_KEEP_COUNT: 10
        shell: bash
        run: |
          if [[ -d deploy/sha ]]; then
            cd deploy/sha
            ls -1d */ 2>/dev/null \
              | sort -r \
              | tail -n +$((SHA_KEEP_COUNT + 1)) \
              | xargs -r rm -rf
            echo "Cleaned up old SHA builds"
          fi

      - name: Generate version index page
        run: node scripts/generate-index.js deploy ${{ github.sha }}

      - uses: actions/configure-pages@v4

      - uses: actions/upload-pages-artifact@v3
        with:
          path: deploy/

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] Step 3: Commit

```bash
git add -A && git commit -m "ci: add SHA cleanup step and pass SHA to index generator"
```

---

### Task 4: Handle backward compatibility — `latest/` redirect stub

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] Step 1: Add a latest redirect stub in the deploy job

After the cleanup step and before index generation, add a step that writes a redirect stub to `deploy/latest/index.html` so users with old bookmarks are redirected to the root:

```yaml
      - name: Write latest/ redirect stub for backward compatibility
        shell: bash
        run: |
          mkdir -p deploy/latest
          cat > deploy/latest/index.html << 'STUB'
          <!DOCTYPE html>
          <html>
          <head><meta http-equiv="refresh" content="0;url=/"></head>
          <body><p>Redirecting to <a href="/">EdgeTTS Builds</a>...</p></body>
          </html>
          STUB
```

- [ ] Step 2: Commit

```bash
git add -A && git commit -m "ci: add latest/ redirect stub for backward compatibility"
```

---

### Task 5: Final verification

- [ ] Step 1: Run the full test suite

Run: `npm test`
Expected: All tests PASS (existing src tests + new script tests).

- [ ] Step 2: Run typecheck

Run: `npm run typecheck`
Expected: No errors.

- [ ] Step 3: Review the complete diff

Run: `git diff HEAD~4`
Verify all changes match the plan. No unintended modifications.

- [ ] Step 4: Squash or leave as-is (user preference)

The plan produces 4 commits:
1. `refactor: rewrite generate-index.js with SHA-based immutable paths`
2. `ci: build to sha/<sha> instead of latest for cache-busting`
3. `ci: add SHA cleanup step and pass SHA to index generator`
4. `ci: add latest/ redirect stub for backward compatibility`

These can be squashed into one if desired.
