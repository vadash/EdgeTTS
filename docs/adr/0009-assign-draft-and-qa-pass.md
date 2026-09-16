# Assign runs a draft then a QA correction pass

With voting on, Assign produces a draft pass and then a QA pass corrects it. A failed QA falls back to the draft: the draft is always usable.

## Consequences

- QA retries the primary model only. It never uses the backup model.
