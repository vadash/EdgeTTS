# Native sentence segmenter for Split

Text splits into sentences with the platform's native segmenter (Intl.Segmenter). There is no hand-written parser, no abbreviation list, and no alternative path, and none should be added: segmentation correctness is the platform's job, and callers must tolerate its behavior.

## Consequences

- Splits happen on sentence punctuation even inside quotation marks of any style; quoted speech does not stay in one segment.
- Abbreviations are not kept joined: a title followed by a period starts a new sentence. Callers must not depend on joined abbreviations.
- An invalid locale tag falls back to English; the fallback fires only for tags that throw.
- Segmenters are cached per raw locale string at module scope (construction is expensive). The cache is never cleared; entries are small.
- Long segments are cut downstream: first a comma and structure split, then a hard character cut.
- Block token limits come from the central config (one value for extract, one for assign). The split function has no default token limit; factories never hardcode limits. Block-boundary tests derive fixture sizes from config values.
- Typecheck requires the ES2022 internationalization library types or the segmenter fails to typecheck.
