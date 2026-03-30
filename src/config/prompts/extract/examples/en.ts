// 4 few-shot examples for character extraction — EN language, SFW content
// Progresses: simple dialogue → system messages → vocative trap → gender inference + variations

import type { PromptExample } from '../../shared/formatters';

export const extractExamplesEN: PromptExample[] = [
  {
    label: '(EN/Simple)',
    input: `John smiled. "Good morning, Mary!"
"Morning," she replied.`,
    thinking: `Step 1: Found two quotes — "Good morning, Mary!" and "Morning,".
Step 2: John is speaker via action beat "John smiled." Mary is speaker via "she replied."
Step 3: Mary's name is in the first quote but as vocative (listener), not speaker.
Step 4: John uses "he" implied, Mary uses "she" — male and female.
Step 5: No variation merging needed.
Step 6: Two characters found.`,
    output: `{
  "reasoning": "John speaks first with an action beat. Mary replies with 'she replied.' Mary's name in the first quote is vocative — she is the listener, not speaker.",
  "characters": [
    {
      "canonicalName": "John",
      "variations": ["John"],
      "gender": "male"
    },
    {
      "canonicalName": "Mary",
      "variations": ["Mary"],
      "gender": "female"
    }
  ]
}`,
  },
  {
    label: '(EN/SystemAndFirstPerson)',
    input: `"Watch out, Captain!" shouted the guard.
I grabbed my sword. "Thanks."
[Level Up! You have reached Level 5.]`,
    thinking: `Step 1: Found three items — a quote, a first-person quote, and a bracket message.
Step 2: "shouted the guard" identifies the first speaker as Guard. "I grabbed my sword" — "I said" pattern — speaker is Protagonist. [Level Up!] is a system message.
Step 3: "Captain" is inside quotes — vocative trap. Captain is the listener, not speaker.
Step 4: Guard has no pronouns → unknown. Protagonist is first-person → unknown (cannot infer from "I"). System → female per rules.
Step 5: No merging needed.
Step 6: Three characters: Guard, Protagonist, System.`,
    output: `{
  "reasoning": "The guard shouts a warning. The narrator (I) replies. The Captain is spoken to, but doesn't speak. [Level Up!] is a system message.",
  "characters": [
    {
      "canonicalName": "Guard",
      "variations": ["Guard", "the guard"],
      "gender": "unknown"
    },
    {
      "canonicalName": "Protagonist",
      "variations": ["Protagonist"],
      "gender": "unknown"
    },
    {
      "canonicalName": "System",
      "variations": ["System"],
      "gender": "female"
    }
  ]
}`,
  },
  {
    label: '(EN/VocativeTrap)',
    input: `"John, come here!" said Mary.
"Right away," John replied.
"Have you seen Marcus?" Mary asked.
John shook his head. "No, not since yesterday."`,
    thinking: `Step 1: Four quotes found across two exchanges.
Step 2: First quote — "said Mary" → Mary speaks. Second — "John replied" → John speaks. Third — "Mary asked" → Mary speaks. Fourth — action beat "John shook his head" → John speaks.
Step 3: "John" appears inside Mary's first quote as vocative. "Marcus" appears inside Mary's third quote as vocative. Neither John nor Marcus should be extracted from those sentences as speakers. But John is a confirmed speaker from other sentences, so he stays. Marcus is ONLY mentioned (vocative + third-person reference) and never speaks → do NOT extract.
Step 4: "she" not present, but "Mary" is female name convention. John is male name convention. Marcus is mentioned but doesn't speak → exclude.
Step 5: No merging needed.
Step 6: Two characters: Mary (female), John (male).`,
    output: `{
  "reasoning": "Mary speaks in quotes 1 and 3 (explicit tags). John speaks in quotes 2 and 4 (tag + action beat). 'John' inside Mary's first quote is vocative — he is the listener. Marcus is only mentioned as vocative in quote 3 and never speaks — do NOT extract.",
  "characters": [
    {
      "canonicalName": "Mary",
      "variations": ["Mary"],
      "gender": "female"
    },
    {
      "canonicalName": "John",
      "variations": ["John"],
      "gender": "male"
    }
  ]
}`,
  },
  {
    label: '(EN/GenderAndVariations)',
    input: `The old wizard raised his staff. "You shall not pass!"
"No!" cried Galdor. "He's too strong!"
"Don't worry," the wizard said calmly. "I have faced worse."
[Warning: Dark Magic Detected!]`,
    thinking: `Step 1: Four items — three quotes and one bracket message.
Step 2: "the wizard" speaks first (action beat). "Galdor" speaks second ("cried Galdor"). "the wizard" speaks third ("the wizard said").
Step 3: No vocative traps. "He" in Galdor's quote refers to the wizard — not a vocative.
Step 4: "his staff" → wizard is male. Galdor has no explicit pronouns but "he's too strong" uses male pronoun for the wizard. Galdor's gender is unknown from this text alone. Actually — looking again, Galdor could be male by convention but no pronouns directly reference Galdor → unknown. System → female.
Step 5: The wizard is the same person in quotes 1 and 3. Already one entry. No merging needed since same canonicalName "wizard" — but better to use "the old wizard" as canonicalName? No — the text just says "the wizard" so canonicalName = "Wizard" is cleaner with variation "the wizard".
Step 6: Three characters: Wizard (male), Galdor (unknown), System (female).`,
    output: `{
  "reasoning": "The wizard speaks twice (action beat + 'the wizard said'). Galdor speaks once ('cried Galdor'). System sends a bracket message. 'He' in Galdor's quote refers to the wizard, not a vocative. Wizard uses 'his' → male. System → female.",
  "characters": [
    {
      "canonicalName": "Wizard",
      "variations": ["Wizard", "the wizard", "the old wizard"],
      "gender": "male"
    },
    {
      "canonicalName": "Galdor",
      "variations": ["Galdor"],
      "gender": "unknown"
    },
    {
      "canonicalName": "System",
      "variations": ["System"],
      "gender": "female"
    }
  ]
}`,
  },
];
