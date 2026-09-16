# Fixed audio filter chain order

Filters run in a fixed order: de-esser, silence removal, loudness normalization, fade. The order is load-bearing: silence removal must run before loudness normalization so trimming uses source levels.

## Consequences

- EQ and compressor default to off for new users: Edge TTS speech is already clean and level. The de-esser stays on by default to control harsh sibilance.
- Deliberate silence (gap) files are inserted between chunks before the filter chain runs, and the silence-removal stop duration is clamped to at least the configured gap length. Gap insertion and that clamp must stay in sync, or the gap setting breaks silently at larger values.
