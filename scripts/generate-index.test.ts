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
