# Per-provider wire-schema sanitization

The response schema that rides each request is a sanitized wire copy, not the app's schema itself. Sanitization is pure and per provider family: `required` lists every property key, `additionalProperties` becomes boolean, and keywords a family cannot represent are dropped. Free aggregator routes dispatch to arbitrary backends — one backend choking on a non-boolean `additionalProperties` produced 18 midstream 502s in a single run — so the wire copy must fit the weakest consumer of each family.

## Consequences

- The non-strict Zod schemas stay the single source of truth; only the wire copy is reshaped. Providers that accepted the unsanitized schema receive an equivalent one.
- Provider family detection reuses the API client's existing provider switch.
- A provider rejecting the sanitized schema is a deterministic rejection — no retry (see [ADR-0020](0020-error-class-aware-failure-routing.md)).
