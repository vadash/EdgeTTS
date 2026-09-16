# Tiered JSON parse and repair

Model JSON output is unreliable, so the shared parse helper in the text utilities applies tiers in order: (1) native parse, (2) extract fenced JSON blocks then run the repair library, (3) structural recovery — wrap a bare root array and flatten assignment forms, (4) aggressive scrub of string concatenation the model invented. The tier order is part of the contract: later tiers are lossy and must not run before the safe ones.

## Consequences

- Companion helpers normalize whitespace and strip thinking tags and Markdown fences before parsing.
- If the cleaned text has no brace or bracket, the parser rejects it before any repair tier. This prevents the repair library from inventing a wrong object from prose.
