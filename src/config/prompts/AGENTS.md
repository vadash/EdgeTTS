# Prompts Module

Chain-of-Draft prompts, tuned for mid-tier instruct models.

## Layout

- Stage order: extract, merge, assign, QA.
- Each stage holds a role, rules, a schema, a builder, and examples.

## Message topology

- System message: preamble, role, examples.
- User message: content, language rule, task rules, schema, trigger.
- Assistant message: optional prefill. It defaults to empty.

## Rules

- Put the schema and the task rules in the user message. Models weight recent tokens more.
- Output values must match the source text language. Keys stay in English.
- The reasoning field must hold terse drafts. The limit is five words per step.
- With prompt repetition on, the user message is sent twice for bidirectional attention.
- Assign and QA stages receive trailing context sentences with negative indices. They are read-only.
