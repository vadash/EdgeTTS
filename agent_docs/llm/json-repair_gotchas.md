# JSON Repair Pipeline

Model JSON output is unreliable. The shared parse helper in the text utilities applies tiers in order.

- Tier 1: native parse.
- Tier 2: extract fenced JSON blocks, then run the repair library.
- Tier 3: structural recovery. Wraps a bare root array and flattens assignment forms.
- Tier 4: aggressive scrub. Removes string concatenation that the model invented.
- Tier 5: throw a retriable error.

- Companion helpers normalize whitespace and strip thinking tags and Markdown fences.
- Keep the tier order. Later tiers are lossy and must not run before the safe ones.
