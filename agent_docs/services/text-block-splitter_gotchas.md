# TextBlockSplitter Gotchas

The splitter uses the native sentence segmenter. There is no hand-written parser, no abbreviation list, and no alternative path.

## Segmenter behavior

- The segmenter splits on sentence punctuation even inside quotation marks of any style.
- Do not assume quoted speech stays in one segment.
- Long segments are cut downstream: first by a comma and structure split, then by a hard character cut.
- The segmenter does not keep abbreviations joined. A title followed by a period starts a new sentence.
- Callers must not depend on abbreviations staying joined.

## Locale handling

- An invalid locale tag falls back to English.
- The runtime accepts some malformed tags without error, so the fallback fires only for tags that throw.
- Segmenters are cached per locale at module scope, because construction is expensive.
- The cache key is the raw locale string. Do not clear the cache. Entries are small.
- The type library must include the ES2022 internationalization types, or the segmenter fails typecheck.

## Public API

- The paragraph and block factory functions take an optional language argument. It defaults to English.
- Only the orchestrator passes a real detected locale. Tests and helpers use the default.

## Block sizes

- Block token limits come from the central config, one value for extract and one for assign.
- The split function has no default token limit. Every caller must state its limit.
- Change limits in the config only. Never hardcode them in the factory functions.
- Oversized extract blocks can exceed the context window of a small backup model.
- Block-boundary tests must derive fixture sizes from the config values, not from hardcoded numbers.
- Semantic break priority applies only above a fill threshold. Below it, dividers and headers are ordinary text.
