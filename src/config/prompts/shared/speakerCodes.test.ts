import { describe, expect, it } from 'vitest';
import type { LLMCharacter } from '@/state/types';
import { buildAssignPrompt } from '../assign/builder';
import { buildQAPrompt } from '../qa/builder';
import { formatOverlapContext, formatSpeakerCodeList } from './speakerCodes';

// Representative input for the golden pins below. The goldens were captured
// from the builders before the shared-helper extraction; the user message
// tail after each golden is the constraint block covered by formatters.test.ts.
const characters: LLMCharacter[] = [
  { canonicalName: 'Alice', variations: ['Alice', 'Alice Chen'], gender: 'female' },
  { canonicalName: 'Bob', variations: ['Bob'], gender: 'male' },
  { canonicalName: 'narrator', variations: ['narrator'], gender: 'unknown' },
];
const nameToCode = new Map([
  ['Alice', 'A'],
  ['Bob', 'B'],
  ['narrator', 'N'],
  ['UNNAMED_1', 'C1'],
  ['UNNAMED_2', 'C2'],
]);
const paragraphs = '[0] "Hello there," Alice said.\n[1] Bob waved from the door.';
const overlap = ['She set down the cup.', 'The rain kept falling.'];
const drafts = { '0': 'A', '1': 'B' };

const ASSIGN_GOLDEN_USER =
  '<speaker_codes>\n- A = Alice [female] (aliases: Alice Chen)\n- B = Bob [male]\n- N = narrator\n- C1 = UNNAMED_1\n- C2 = UNNAMED_2\n</speaker_codes>\n\n<previous_context_do_not_assign>\n[-2] She set down the cup.\n[-1] The rain kept falling.\n</previous_context_do_not_assign>\n\n<numbered_paragraphs>\n[0] "Hello there," Alice said.\n[1] Bob waved from the door.\n</numbered_paragraphs>\n\n[FINAL INSTRUCTION]:\n1. Assign the Speaker Codes provided in <speaker_codes> to the paragraphs above.\n2. SKIP paragraphs that are purely narration (no dialogue, thoughts, or system brackets).\n3. Be careful of names inside quotes -- they are listeners, not speakers (Vocative trap).\n4. ONLY use the codes provided in <speaker_codes>. DO NOT use names.\n5. Only assign speaker codes to paragraphs [0] and above.\nOutput the raw JSON now.';
const QA_GOLDEN_USER =
  '<speaker_codes>\n- A = Alice [female] (aliases: Alice Chen)\n- B = Bob [male]\n- N = narrator\n- C1 = UNNAMED_1\n- C2 = UNNAMED_2\n</speaker_codes>\n\n<previous_context_do_not_assign>\n[-2] She set down the cup.\n[-1] The rain kept falling.\n</previous_context_do_not_assign>\n\n<numbered_paragraphs>\n[0] "Hello there," Alice said.\n[1] Bob waved from the door.\n</numbered_paragraphs>\n\n<draft_assignments>\n{\n  "0": "A",\n  "1": "B"\n}\n</draft_assignments>\n\n[FINAL INSTRUCTION]:\nReview the draft assignments above and correct any errors.\nOutput the corrected JSON now.';

describe('assign/qa prompt parity', () => {
  it('assign user message is byte-identical to pre-extraction output', () => {
    const messages = buildAssignPrompt(characters, nameToCode, paragraphs, overlap);
    expect(messages[1]?.content?.startsWith(ASSIGN_GOLDEN_USER)).toBe(true);
  });

  it('qa user message is byte-identical to pre-extraction output', () => {
    const messages = buildQAPrompt(characters, nameToCode, paragraphs, drafts, overlap);
    expect(messages[1]?.content?.startsWith(QA_GOLDEN_USER)).toBe(true);
  });

  it('both stages embed the identical shared skeleton', () => {
    const assignUser = buildAssignPrompt(characters, nameToCode, paragraphs, overlap)[1]?.content;
    const qaUser = buildQAPrompt(characters, nameToCode, paragraphs, drafts, overlap)[1]?.content;
    const skeletonEnd = '</numbered_paragraphs>\n\n';
    const shared = (user: string) => user.slice(0, user.indexOf(skeletonEnd) + skeletonEnd.length);
    expect(shared(assignUser!)).toBe(shared(qaUser!));
  });

  it('omits overlap context when there are no overlap sentences', () => {
    const messages = buildAssignPrompt(characters, nameToCode, paragraphs);
    expect(messages[1]?.content).not.toContain('previous_context_do_not_assign');
  });
});

describe('formatOverlapContext', () => {
  it('returns empty string for missing or empty overlap', () => {
    expect(formatOverlapContext()).toBe('');
    expect(formatOverlapContext([])).toBe('');
  });

  it('indexes sentences from negative counting', () => {
    expect(formatOverlapContext(['a', 'b', 'c'])).toBe(
      '<previous_context_do_not_assign>\n[-3] a\n[-2] b\n[-1] c\n</previous_context_do_not_assign>',
    );
  });
});

describe('formatSpeakerCodeList', () => {
  it('lists characters first, then UNNAMED map entries', () => {
    expect(formatSpeakerCodeList(characters, nameToCode)).toBe(
      [
        '- A = Alice [female] (aliases: Alice Chen)',
        '- B = Bob [male]',
        '- N = narrator',
        '- C1 = UNNAMED_1',
        '- C2 = UNNAMED_2',
      ].join('\n'),
    );
  });
});
