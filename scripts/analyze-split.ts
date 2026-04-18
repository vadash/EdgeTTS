import { readFileSync } from 'node:fs';

interface Assignment {
  sentenceIndex: number;
  text: string;
  speaker: string;
  voiceId: string;
}

interface PipelineState {
  assignments: Assignment[];
}

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: npm run analyze-split <path-to-pipeline_state.json>');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as PipelineState;
const assignments = raw.assignments;

if (!assignments?.length) {
  console.error('No assignments found in pipeline state.');
  process.exit(1);
}

const lengths = assignments.map((a) => a.text.length);
const total = assignments.length;
const totalChars = lengths.reduce((s, l) => s + l, 0);
const avg = totalChars / total;
const max = Math.max(...lengths);
const min = Math.min(...lengths);

const sorted = [...lengths].sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)];
const p95 = sorted[Math.floor(sorted.length * 0.95)];

const buckets = {
  short: lengths.filter((l) => l <= 100).length,
  medium: lengths.filter((l) => l > 100 && l <= 200).length,
  long: lengths.filter((l) => l > 200 && l <= 300).length,
  wall: lengths.filter((l) => l > 300).length,
};

const speakerCounts: Record<string, number> = {};
for (const a of assignments) {
  speakerCounts[a.speaker] = (speakerCounts[a.speaker] || 0) + 1;
}

console.log('=== Pipeline Split Analysis ===\n');
console.log(`File:       ${filePath}`);
console.log(`Sentences:  ${total}`);
console.log(`Total chars: ${totalChars.toLocaleString()}`);
console.log('');
console.log('--- Length Stats ---');
console.log(`Min:     ${min}`);
console.log(`Avg:     ${avg.toFixed(1)}`);
console.log(`Median:  ${median}`);
console.log(`P95:     ${p95}`);
console.log(`Max:     ${max}`);
console.log('');
console.log('--- Distribution ---');
console.log(`SHORT (<=100):  ${buckets.short} (${((buckets.short / total) * 100).toFixed(1)}%)`);
console.log(
  `MEDIUM (101-200): ${buckets.medium} (${((buckets.medium / total) * 100).toFixed(1)}%)`,
);
console.log(`LONG (201-300):  ${buckets.long} (${((buckets.long / total) * 100).toFixed(1)}%)`);
console.log(`WALL OF TEXT (>300): ${buckets.wall} (${((buckets.wall / total) * 100).toFixed(1)}%)`);
console.log('');
console.log('--- Speakers ---');
for (const [speaker, count] of Object.entries(speakerCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${speaker}: ${count}`);
}
console.log('');

// Top 10 offenders by length
const offenders = assignments
  .map((a) => ({ idx: a.sentenceIndex, text: a.text, len: a.text.length, speaker: a.speaker }))
  .sort((a, b) => b.len - a.len)
  .slice(0, 10);

console.log('--- Top 10 Longest Sentences ---');
for (let i = 0; i < offenders.length; i++) {
  const o = offenders[i];
  const label = o.len > 300 ? 'WALL' : o.len > 200 ? 'LONG' : '';
  const tag = label ? ` [${label}]` : '';
  console.log(`\n#${i + 1} (idx ${o.idx}, ${o.len} chars, ${o.speaker})${tag}`);
  const preview = o.text.length > 200 ? `${o.text.slice(0, 200)}...` : o.text;
  console.log(`  "${preview}"`);
}
