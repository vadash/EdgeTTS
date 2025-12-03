// Test Factories - Text Data
// Factory functions for creating test text content

/**
 * Create sample narrative text
 */
export function createTestText(): string {
  return `The Story Begins

It was a dark and stormy night. John walked into the room.

"Hello, Sarah," he said with a smile.

"Hello, John," she replied. "I've been waiting for you."

They sat down at the table. The conversation was about to begin.`;
}

/**
 * Create sample dialogue text
 */
export function createTestDialogue(): string {
  return `"I have something important to tell you," John said.

"What is it?" Sarah asked, leaning forward.

"Everything is about to change," he replied mysteriously.

She looked at him with concern. "What do you mean?"

"You'll see," he said with a knowing smile.`;
}

/**
 * Create sample text with dictionary words to replace
 */
export function createTestTextWithReplacements(): string {
  return `Dr. Smith arrived at the lab. He checked the temp readings.
The exp showed promising results. Prof. Johnson was impressed.`;
}

/**
 * Create sample dictionary rules
 */
export function createTestDictionaryRules(): string[] {
  return [
    'Dr.=Doctor',
    'Prof.=Professor',
    '"temp"="temperature"',
    '"exp"="experiment"',
    'regex"\\blab\\b"="laboratory"',
  ];
}

/**
 * Create sample long text for block splitting tests
 */
export function createLongTestText(paragraphs: number = 10): string {
  const sampleParagraph = `This is a sample paragraph for testing. It contains multiple sentences.
The text should be long enough to trigger block splitting.
Each paragraph adds to the total length of the content.`;

  return Array(paragraphs).fill(sampleParagraph).join('\n\n');
}
