# SHA-based immutable deployment paths

**Date:** 2026-03-30
**Status:** Approved

## Problem

GitHub Pages CDN and browsers cache files under `latest/`. After a redeploy, users may see stale assets because the URL `latest/index.html` hasn't changed. The artifact name `deploy-latest` can also collide between concurrent GitHub Actions runs.

## Solution

Replace the `latest/` directory with `sha/<short-sha>/` on every build. The short SHA is the first 9 characters of `github.sha`. The root `index.html` is regenerated on every deploy to point at the current SHA directory. Old SHA directories are cleaned up, keeping only the most recent 10.

This follows the standard immutable-deploy pattern (same as S3 + CloudFront): all assets live under content-addressed, immutable URLs. The only mutable file is the root index page, which is small enough that CDN staleness is acceptable.

## Changes

### 1. `.github/workflows/deploy.yml`

#### build-latest job

- Copy `dist/latest` to `deploy/sha/${{ github.sha }}` (full 40-char SHA used as directory name for uniqueness)
- Change artifact name from `deploy-latest` to `deploy-sha-${{ github.sha }}` to prevent artifact collisions between concurrent runs
- Still copy `dist/404.html` to `deploy/404.html`

#### build-tags job

No changes. Tags already use immutable paths (`v1.0.0`).

#### deploy job — new cleanup step

After downloading all artifacts but before generating the index, add a step that:

1. Lists all directories under `deploy/sha/`
2. Sorts by directory name (SHA, which sorts chronologically for recent commits)
3. Keeps only the 10 most recent
4. Deletes the rest

The retention count (10) is set via an environment variable `SHA_KEEP_COUNT` defaulting to 10.

#### deploy job — index generation

Pass the current commit SHA as a second argument to `scripts/generate-index.js`:

```
node scripts/generate-index.js deploy ${{ github.sha }}
```

### 2. `scripts/generate-index.js`

Current behavior: lists all directories in the deploy dir and renders them in an HTML index page, sorting `latest` first.

New behavior:

- Accept optional second argument: current SHA
- Group entries into two sections: **Current Build** (the SHA matching the argument) and **Previous Builds** (other `sha/` dirs) and **Releases** (any `v*` dirs)
- For the current SHA entry, display it with a "Latest" badge in the UI
- Replace `latest/logo.png` favicon reference with `${currentSha}/logo.png`
- Sort previous builds descending (most recent first)
- Sort releases descending (newest version first)

The "Current Build" section links to `./sha/<sha>/index.html` and optionally includes a `<meta http-equiv="refresh">` redirect for visitors who land on the root URL directly (after a short delay, e.g., 2 seconds).

## Files changed

| File | Change |
|------|--------|
| `.github/workflows/deploy.yml` | Build to `sha/<sha>/`, auto-cleanup step, pass SHA to index script, rename artifact |
| `scripts/generate-index.js` | Accept SHA argument, group into Current/Previous/Releases, display badge |

## Backward compatibility

- Existing `v*` tag directories continue to work unchanged
- Users who have bookmarked `latest/` will get a 404 after this change. The 404 page could optionally redirect to the root index, or we could leave a redirect stub. (Decision: leave a `latest/` directory that contains a single `index.html` with a meta-redirect to `/` for one deploy cycle, then remove it.)
