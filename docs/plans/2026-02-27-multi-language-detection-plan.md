# Implementation Plan - Multi-Language Book Detection

> **Reference:** `docs/designs/2026-02-27-multi-language-detection-design.md`
> **Execution:** Use `executing-plans` skill.

---

### Task 1: Widen DetectedLanguage type

**Goal:** Change `DetectedLanguage` from `'en' | 'ru'` to `string` so all downstream code accepts any language code.

**Step 1: Write the Failing Test**
- File: `src/utils/languageDetection.test.ts`
- Add test at the end of the `describe('detectLanguage')` block:
  ```typescript
  it('should detect German text', () => {
    const text = 'Der Mann ging mit seinem Hund in den Park und die Kinder spielten auf der Wiese.';
    expect(detectLanguage(text).language).toBe('de');
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npx vitest run src/utils/languageDetection.test.ts`
- Expect: Fail — `detectLanguage` returns `'en'` string, not an object with `.language`.

**Step 3: Implementation (Green)**
- File: `src/utils/languageDetection.ts`
- Replace the entire file with the new detection API skeleton that still only handles EN/RU but returns `DetectionResult`:
  ```typescript
  export type DetectedLanguage = string;

  export interface DetectionResult {
    language: string;
    confidence: 'high' | 'medium' | 'low';
    method: 'script' | 'stopwords' | 'fallback';
  }

  const DEFAULT_MAX_LENGTH = 5000;

  export function detectLanguage(text: string, maxLength: number = DEFAULT_MAX_LENGTH): DetectionResult {
    if (!text || text.trim().length === 0) {
      return { language: 'en', confidence: 'low', method: 'fallback' };
    }
    const sample = text.length > maxLength ? text.slice(0, maxLength) : text;

    let cyrillicCount = 0;
    let latinCount = 0;
    for (const char of sample) {
      const code = char.charCodeAt(0);
      if (code >= 0x0400 && code <= 0x04FF) cyrillicCount++;
      else if ((code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A)) latinCount++;
    }

    const lang = cyrillicCount > latinCount ? 'ru' : 'en';
    return { language: lang, confidence: 'medium', method: 'script' };
  }
  ```

- File: `src/stores/DataStore.ts`
  - Update import: `import { detectLanguage, type DetectedLanguage, type DetectionResult } from '@/utils/languageDetection';`
  - Change `detectLanguageFromContent` return type and body:
    ```typescript
    detectLanguageFromContent(): DetectionResult {
      const text = this.textContent.value;
      const bookText = this.book.value?.allSentences.join(' ') ?? '';
      const contentToAnalyze = text || bookText;
      const result = detectLanguage(contentToAnalyze);
      this.detectedLanguage.value = result.language;
      return result;
    }
    ```

- File: `src/hooks/useTTSConversion.ts`
  - In `buildInput`, change line:
    ```typescript
    // BEFORE
    detectedLanguage: stores.data.detectLanguageFromContent(),
    // AFTER
    detectedLanguage: stores.data.detectLanguageFromContent().language,
    ```

- Fix all existing tests in `languageDetection.test.ts` to use `.language` accessor:
  - `expect(detectLanguage(text).language).toBe('en');` etc.

- Fix DataStore tests that call `detectLanguageFromContent()` directly:
  - `const detected = store.detectLanguageFromContent();` → `expect(detected.language).toBe('ru');`
  - Tests that check `store.detectedLanguage.value` stay the same (it's still a string).

**Step 4: Verify (Green)**
- Command: `npx vitest run src/utils/languageDetection.test.ts src/stores/DataStore.test.ts`
- Expect: All pass except the new German test (still returns `'en'`). That's expected — it goes green in Task 3.

**Step 5: Git Commit**
- Command: `git add -A && git commit -m "refactor: widen DetectedLanguage type to string, return DetectionResult"`

---

### Task 2: Add script detection layer

**Goal:** Detect dominant Unicode script from text. Unique-script languages resolve immediately.

**Step 1: Write the Failing Tests**
- File: `src/utils/languageDetection.test.ts`
- Add tests:
  ```typescript
  it('should detect Japanese text (Hiragana/Katakana)', () => {
    const text = 'むかしむかし、あるところにおじいさんとおばあさんがいました。';
    expect(detectLanguage(text).language).toBe('ja');
  });

  it('should detect Korean text (Hangul)', () => {
    const text = '옛날 옛적에 한 마을에 착한 소년이 살고 있었습니다.';
    expect(detectLanguage(text).language).toBe('ko');
  });

  it('should detect Chinese text (CJK)', () => {
    const text = '从前有一个小村庄，村庄里住着一位老人和他的孙子。';
    expect(detectLanguage(text).language).toBe('zh');
  });

  it('should detect Thai text', () => {
    const text = 'กาลครั้งหนึ่งนานมาแล้ว มีชายหนุ่มคนหนึ่งอาศัยอยู่ในหมู่บ้านเล็กๆ';
    expect(detectLanguage(text).language).toBe('th');
  });

  it('should detect Greek text', () => {
    const text = 'Μια φορά και έναν καιρό ζούσε ένας νεαρός σε ένα μικρό χωριό.';
    expect(detectLanguage(text).language).toBe('el');
  });

  it('should detect Hebrew text', () => {
    const text = 'פעם היה ילד קטן שגר בכפר קטן ליד הים הגדול.';
    expect(detectLanguage(text).language).toBe('he');
  });

  it('should detect Georgian text', () => {
    const text = 'იყო და არა იყო რა, იყო ერთი პატარა სოფელი მთებში.';
    expect(detectLanguage(text).language).toBe('ka');
  });

  it('should detect Bengali text', () => {
    const text = 'একসময় এক ছোট্ট গ্রামে এক বৃদ্ধ লোক বাস করত।';
    expect(detectLanguage(text).language).toBe('bn');
  });

  it('should detect Tamil text', () => {
    const text = 'ஒரு காலத்தில் ஒரு சிறிய கிராமத்தில் ஒரு முதியவர் வாழ்ந்தார்.';
    expect(detectLanguage(text).language).toBe('ta');
  });

  it('should return high confidence for unique-script languages', () => {
    const text = 'むかしむかし、あるところにおじいさんとおばあさんがいました。';
    expect(detectLanguage(text).confidence).toBe('high');
    expect(detectLanguage(text).method).toBe('script');
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npx vitest run src/utils/languageDetection.test.ts`
- Expect: Fail — current code only counts Cyrillic vs Latin.

**Step 3: Implementation (Green)**
- File: `src/utils/languageDetection.ts`
- Add script definitions data structure and `detectDominantScript()` function:
  ```typescript
  interface ScriptRange { start: number; end: number; }
  interface ScriptDef {
    name: string;
    ranges: ScriptRange[];
    directLanguage?: string;        // unique script → language
    candidateLanguages?: string[];   // shared script → needs stopwords
    fallbackLanguage?: string;       // default if stopwords fail
  }

  const SCRIPTS: ScriptDef[] = [
    { name: 'hiragana_katakana', ranges: [{ start: 0x3040, end: 0x30FF }, { start: 0x31F0, end: 0x31FF }], directLanguage: 'ja' },
    { name: 'hangul', ranges: [{ start: 0xAC00, end: 0xD7AF }, { start: 0x1100, end: 0x11FF }], directLanguage: 'ko' },
    { name: 'thai', ranges: [{ start: 0x0E00, end: 0x0E7F }], directLanguage: 'th' },
    { name: 'georgian', ranges: [{ start: 0x10A0, end: 0x10FF }], directLanguage: 'ka' },
    { name: 'greek', ranges: [{ start: 0x0370, end: 0x03FF }], directLanguage: 'el' },
    { name: 'hebrew', ranges: [{ start: 0x0590, end: 0x05FF }], directLanguage: 'he' },
    { name: 'bengali', ranges: [{ start: 0x0980, end: 0x09FF }], directLanguage: 'bn' },
    { name: 'tamil', ranges: [{ start: 0x0B80, end: 0x0BFF }], directLanguage: 'ta' },
    { name: 'telugu', ranges: [{ start: 0x0C00, end: 0x0C7F }], directLanguage: 'te' },
    { name: 'kannada', ranges: [{ start: 0x0C80, end: 0x0CFF }], directLanguage: 'kn' },
    { name: 'malayalam', ranges: [{ start: 0x0D00, end: 0x0D7F }], directLanguage: 'ml' },
    { name: 'gujarati', ranges: [{ start: 0x0A80, end: 0x0AFF }], directLanguage: 'gu' },
    { name: 'myanmar', ranges: [{ start: 0x1000, end: 0x109F }], directLanguage: 'my' },
    { name: 'khmer', ranges: [{ start: 0x1780, end: 0x17FF }], directLanguage: 'km' },
    { name: 'lao', ranges: [{ start: 0x0E80, end: 0x0EFF }], directLanguage: 'lo' },
    { name: 'sinhala', ranges: [{ start: 0x0D80, end: 0x0DFF }], directLanguage: 'si' },
    { name: 'ethiopic', ranges: [{ start: 0x1200, end: 0x137F }], directLanguage: 'am' },
    { name: 'cjk', ranges: [{ start: 0x4E00, end: 0x9FFF }], directLanguage: 'zh' },
    { name: 'devanagari', ranges: [{ start: 0x0900, end: 0x097F }], candidateLanguages: ['hi', 'mr', 'ne'], fallbackLanguage: 'hi' },
    { name: 'arabic', ranges: [{ start: 0x0600, end: 0x06FF }], candidateLanguages: ['ar', 'fa', 'ur', 'ps'], fallbackLanguage: 'ar' },
    { name: 'cyrillic', ranges: [{ start: 0x0400, end: 0x04FF }], candidateLanguages: ['ru', 'uk', 'bg', 'sr', 'mk', 'kk'], fallbackLanguage: 'ru' },
    { name: 'latin', ranges: [{ start: 0x0041, end: 0x005A }, { start: 0x0061, end: 0x007A }, { start: 0x00C0, end: 0x024F }], candidateLanguages: ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'cs', 'sk', 'ro', 'hu', 'sv', 'nb', 'da', 'fi', 'et', 'lt', 'lv', 'hr', 'bs', 'sl', 'sq', 'tr', 'az', 'id', 'ms', 'vi', 'ca', 'gl', 'cy', 'ga', 'is', 'mt', 'sw', 'so', 'af', 'zu', 'fil', 'jv', 'su', 'uz'], fallbackLanguage: 'en' },
  ];
  ```
- Add `detectDominantScript()`:
  ```typescript
  function classifyChar(code: number): string | null {
    for (const script of SCRIPTS) {
      for (const range of script.ranges) {
        if (code >= range.start && code <= range.end) return script.name;
      }
    }
    return null;
  }

  function detectDominantScript(text: string): ScriptDef | null {
    const counts: Record<string, number> = {};
    for (const char of text) {
      const script = classifyChar(char.charCodeAt(0));
      if (script) counts[script] = (counts[script] || 0) + 1;
    }
    // Special case: if both CJK and hiragana/katakana present, it's Japanese
    if (counts['hiragana_katakana'] && counts['cjk']) {
      return SCRIPTS.find(s => s.name === 'hiragana_katakana')!;
    }
    let maxScript: string | null = null;
    let maxCount = 0;
    for (const [name, count] of Object.entries(counts)) {
      if (count > maxCount) { maxCount = count; maxScript = name; }
    }
    return maxScript ? SCRIPTS.find(s => s.name === maxScript) ?? null : null;
  }
  ```
- Update `detectLanguage()` to use script detection:
  ```typescript
  export function detectLanguage(text: string, maxLength: number = DEFAULT_MAX_LENGTH): DetectionResult {
    if (!text || text.trim().length === 0) {
      return { language: 'en', confidence: 'low', method: 'fallback' };
    }
    const sample = text.length > maxLength ? text.slice(0, maxLength) : text;
    const script = detectDominantScript(sample);
    if (!script) {
      return { language: 'en', confidence: 'low', method: 'fallback' };
    }
    if (script.directLanguage) {
      return { language: script.directLanguage, confidence: 'high', method: 'script' };
    }
    // TODO: stopword disambiguation — Task 3
    // Temporary: use fallback
    return { language: script.fallbackLanguage ?? 'en', confidence: 'low', method: 'fallback' };
  }
  ```

**Step 4: Verify (Green)**
- Command: `npx vitest run src/utils/languageDetection.test.ts`
- Expect: All unique-script tests pass. German test still fails (Latin falls back to `'en'`). Cyrillic tests pass (fallback is `'ru'`).

**Step 5: Git Commit**
- Command: `git add -A && git commit -m "feat: add Unicode script detection layer for 20+ scripts"`

---

### Task 3: Add stopword disambiguation for Latin-script languages

**Goal:** When dominant script is Latin, use stopword matching to distinguish EN, DE, FR, ES, IT, PT, NL, and ~30 other languages.

**Step 1: Write the Failing Tests**
- File: `src/utils/languageDetection.test.ts`
- Add tests:
  ```typescript
  it('should detect German text', () => {
    const text = 'Der Mann ging mit seinem Hund in den Park und die Kinder spielten auf der Wiese. Er hatte einen langen Tag hinter sich und wollte sich ausruhen.';
    expect(detectLanguage(text).language).toBe('de');
  });

  it('should detect French text', () => {
    const text = "L'homme est allé dans le parc avec son chien et les enfants jouaient sur la pelouse. Il avait eu une longue journée et voulait se reposer.";
    expect(detectLanguage(text).language).toBe('fr');
  });

  it('should detect Spanish text', () => {
    const text = 'El hombre fue al parque con su perro y los niños jugaban en el césped. Había tenido un largo día y quería descansar.';
    expect(detectLanguage(text).language).toBe('es');
  });

  it('should detect Italian text', () => {
    const text = "L'uomo è andato al parco con il suo cane e i bambini giocavano sul prato. Aveva avuto una lunga giornata e voleva riposarsi.";
    expect(detectLanguage(text).language).toBe('it');
  });

  it('should detect Portuguese text', () => {
    const text = 'O homem foi ao parque com o seu cão e as crianças brincavam na relva. Ele tinha tido um longo dia e queria descansar.';
    expect(detectLanguage(text).language).toBe('pt');
  });

  it('should detect Dutch text', () => {
    const text = 'De man ging naar het park met zijn hond en de kinderen speelden op het gras. Hij had een lange dag gehad en wilde uitrusten.';
    expect(detectLanguage(text).language).toBe('nl');
  });

  it('should detect Polish text', () => {
    const text = 'Mężczyzna poszedł do parku ze swoim psem a dzieci bawiły się na trawniku. Miał za sobą długi dzień i chciał odpocząć.';
    expect(detectLanguage(text).language).toBe('pl');
  });

  it('should detect Turkish text', () => {
    const text = 'Adam köpeğiyle birlikte parka gitti ve çocuklar çimlerde oynuyorlardı. Uzun bir günün ardından dinlenmek istiyordu.';
    expect(detectLanguage(text).language).toBe('tr');
  });

  it('should detect Czech text', () => {
    const text = 'Muž šel do parku se svým psem a děti si hrály na trávníku. Měl za sebou dlouhý den a chtěl si odpočinout.';
    expect(detectLanguage(text).language).toBe('cs');
  });

  it('should detect Swedish text', () => {
    const text = 'Mannen gick till parken med sin hund och barnen lekte på gräsmattan. Han hade haft en lång dag och ville vila sig.';
    expect(detectLanguage(text).language).toBe('sv');
  });

  it('should detect Indonesian text', () => {
    const text = 'Pria itu pergi ke taman dengan anjingnya dan anak-anak bermain di rumput. Dia sudah memiliki hari yang panjang dan ingin beristirahat.';
    expect(detectLanguage(text).language).toBe('id');
  });

  it('should return medium confidence for stopword-detected languages', () => {
    const text = 'Der Mann ging mit seinem Hund in den Park und die Kinder spielten auf der Wiese.';
    const result = detectLanguage(text);
    expect(result.confidence).toBe('medium');
    expect(result.method).toBe('stopwords');
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npx vitest run src/utils/languageDetection.test.ts`
- Expect: Fail — all Latin-script languages return `'en'` (fallback).

**Step 3: Implementation (Green)**
- File: `src/utils/languageDetection.ts`
- Add stopword map for all Latin-script candidate languages (top 20 words each). Create a new file `src/utils/stopwords.ts` to keep `languageDetection.ts` clean:

  ```typescript
  // src/utils/stopwords.ts
  /** Top 20 stopwords per language (lowercase). Only for scripts shared by multiple languages. */
  export const STOPWORDS: Record<string, Set<string>> = {
    // Latin-script languages
    en: new Set(['the', 'and', 'to', 'of', 'a', 'in', 'is', 'it', 'that', 'was', 'for', 'on', 'with', 'he', 'she', 'his', 'her', 'they', 'this', 'have']),
    de: new Set(['der', 'die', 'und', 'den', 'das', 'ist', 'ein', 'eine', 'nicht', 'sich', 'mit', 'auf', 'des', 'dem', 'ich', 'auch', 'als', 'wie', 'von', 'aber']),
    fr: new Set(['le', 'la', 'les', 'de', 'des', 'un', 'une', 'et', 'est', 'que', 'pas', 'pour', 'qui', 'dans', 'sur', 'avec', 'son', 'mais', 'nous', 'vous']),
    es: new Set(['el', 'la', 'los', 'las', 'de', 'en', 'un', 'una', 'que', 'es', 'por', 'con', 'para', 'del', 'al', 'como', 'pero', 'fue', 'más', 'su']),
    it: new Set(['il', 'la', 'di', 'che', 'un', 'una', 'del', 'dei', 'nel', 'con', 'non', 'per', 'sono', 'suo', 'sua', 'era', 'gli', 'anche', 'più', 'come']),
    pt: new Set(['o', 'a', 'os', 'as', 'de', 'do', 'da', 'em', 'um', 'uma', 'que', 'com', 'para', 'por', 'não', 'seu', 'sua', 'mais', 'como', 'foi']),
    nl: new Set(['de', 'het', 'een', 'van', 'en', 'in', 'is', 'dat', 'op', 'voor', 'met', 'niet', 'zijn', 'aan', 'hij', 'maar', 'ook', 'nog', 'als', 'naar']),
    pl: new Set(['nie', 'się', 'na', 'jest', 'to', 'że', 'do', 'jak', 'ale', 'co', 'tak', 'za', 'od', 'już', 'był', 'jej', 'jego', 'tylko', 'czy', 'po']),
    cs: new Set(['je', 'že', 'na', 'se', 'to', 'jak', 'ale', 'jsem', 'byl', 'pro', 'tak', 'jako', 'jeho', 'její', 'nebo', 'aby', 'jsou', 'jen', 'které', 'než']),
    sk: new Set(['je', 'na', 'sa', 'že', 'som', 'ako', 'ale', 'pri', 'bol', 'aby', 'tak', 'jeho', 'jej', 'len', 'alebo', 'sú', 'bolo', 'ešte', 'podľa', 'veľmi']),
    ro: new Set(['de', 'la', 'în', 'pe', 'un', 'și', 'cu', 'care', 'din', 'mai', 'nu', 'sau', 'dar', 'este', 'sunt', 'fost', 'pentru', 'prin', 'acest', 'avea']),
    hu: new Set(['egy', 'az', 'hogy', 'nem', 'is', 'volt', 'már', 'csak', 'meg', 'még', 'mint', 'van', 'fel', 'lett', 'majd', 'igen', 'után', 'ahol', 'nagy', 'vagy']),
    sv: new Set(['och', 'att', 'det', 'som', 'den', 'för', 'med', 'var', 'har', 'inte', 'till', 'ett', 'kan', 'han', 'hon', 'hade', 'sig', 'från', 'men', 'alla']),
    nb: new Set(['og', 'det', 'som', 'til', 'med', 'den', 'har', 'han', 'var', 'hun', 'seg', 'fra', 'men', 'eller', 'kan', 'skal', 'ble', 'alle', 'noe', 'sin']),
    da: new Set(['og', 'det', 'som', 'til', 'med', 'den', 'har', 'han', 'var', 'hun', 'sig', 'fra', 'men', 'eller', 'kan', 'skal', 'blev', 'alle', 'noget', 'sin']),
    fi: new Set(['ja', 'on', 'oli', 'hän', 'ei', 'se', 'että', 'kun', 'niin', 'mutta', 'kuin', 'olla', 'sen', 'voi', 'sitä', 'siitä', 'mitä', 'ovat', 'kanssa', 'tämä']),
    et: new Set(['ja', 'on', 'oli', 'ei', 'ka', 'kui', 'see', 'mis', 'aga', 'nii', 'oma', 'siis', 'seda', 'veel', 'tema', 'kuid', 'olid', 'olla', 'mida', 'ning']),
    lt: new Set(['ir', 'kad', 'tai', 'yra', 'buvo', 'bet', 'jis', 'jos', 'kaip', 'nuo', 'tik', 'dar', 'jau', 'apie', 'arba', 'labai', 'savo', 'nes', 'gali', 'nors']),
    lv: new Set(['un', 'ir', 'ka', 'tas', 'ar', 'bet', 'kā', 'par', 'lai', 'gan', 'nav', 'bija', 'jau', 'tā', 'tad', 'vēl', 'vai', 'arī', 'viņš', 'viņa']),
    hr: new Set(['je', 'da', 'na', 'se', 'su', 'za', 'ali', 'bio', 'kao', 'ili', 'sam', 'sve', 'još', 'samo', 'biti', 'nije', 'već', 'ima', 'koji', 'ovo']),
    bs: new Set(['je', 'da', 'na', 'se', 'su', 'za', 'ali', 'bio', 'kao', 'ili', 'sam', 'sve', 'još', 'samo', 'biti', 'nije', 'već', 'ima', 'koji', 'ovo']),
    sl: new Set(['je', 'da', 'na', 'se', 'za', 'ali', 'bil', 'kot', 'ali', 'sem', 'vse', 'še', 'samo', 'biti', 'ni', 'že', 'ima', 'ki', 'tudi', 'tako']),
    sq: new Set(['dhe', 'në', 'një', 'për', 'që', 'nga', 'me', 'por', 'ishte', 'kanë', 'ka', 'pas', 'nuk', 'kjo', 'ky', 'janë', 'ose', 'duke', 'do', 'edhe']),
    tr: new Set(['bir', 've', 'bu', 'için', 'ile', 'olan', 'gibi', 'ama', 'daha', 'çok', 'var', 'kadar', 'ancak', 'sonra', 'olarak', 'bunu', 'hem', 'ise', 'nasıl', 'değil']),
    az: new Set(['bir', 'və', 'bu', 'üçün', 'ilə', 'olan', 'kimi', 'amma', 'daha', 'çox', 'var', 'sonra', 'olaraq', 'bunu', 'həm', 'isə', 'necə', 'yox', 'belə', 'edir']),
    id: new Set(['dan', 'yang', 'di', 'ini', 'itu', 'dengan', 'untuk', 'dari', 'tidak', 'ada', 'pada', 'juga', 'akan', 'sudah', 'bisa', 'oleh', 'tetapi', 'atau', 'saya', 'mereka']),
    ms: new Set(['dan', 'yang', 'di', 'ini', 'itu', 'dengan', 'untuk', 'dari', 'tidak', 'ada', 'pada', 'juga', 'akan', 'sudah', 'boleh', 'oleh', 'tetapi', 'atau', 'saya', 'mereka']),
    vi: new Set(['của', 'và', 'là', 'có', 'trong', 'được', 'một', 'cho', 'không', 'này', 'với', 'các', 'đã', 'người', 'cũng', 'như', 'từ', 'đến', 'khi', 'những']),
    ca: new Set(['de', 'la', 'el', 'les', 'dels', 'un', 'una', 'amb', 'que', 'per', 'com', 'però', 'més', 'són', 'tot', 'era', 'han', 'seva', 'seu', 'això']),
    gl: new Set(['de', 'do', 'da', 'os', 'as', 'un', 'unha', 'que', 'con', 'para', 'por', 'non', 'máis', 'como', 'pero', 'seu', 'súa', 'foi', 'hai', 'ten']),
    cy: new Set(['yn', 'ac', 'ar', 'yr', 'mae', 'ei', 'eu', 'gan', 'ond', 'bod', 'wedi', 'oedd', 'nid', 'roedd', 'hyn', 'fod', 'fel', 'dim', 'yw', 'hefyd']),
    ga: new Set(['agus', 'ar', 'an', 'na', 'go', 'le', 'bhí', 'sé', 'sí', 'iad', 'atá', 'sin', 'ach', 'ann', 'nach', 'mar', 'ní', 'leis', 'tá', 'aon']),
    is: new Set(['og', 'að', 'sem', 'um', 'var', 'með', 'til', 'hans', 'hennar', 'hún', 'hann', 'það', 'þetta', 'ekki', 'frá', 'eða', 'eru', 'hefur', 'sín', 'allt']),
    mt: new Set(['li', 'ta', 'il', 'fil', 'għal', 'ma', 'dan', 'minn', 'kienu', 'kien', 'fuq', 'jew', 'imma', 'biss', 'kellu', 'wara', 'meta', 'għandu', 'jista', 'qatt']),
    sw: new Set(['na', 'ya', 'kwa', 'ni', 'wa', 'ili', 'katika', 'hii', 'kama', 'lakini', 'hata', 'hiyo', 'kuwa', 'yake', 'wake', 'baada', 'sana', 'zaidi', 'pia', 'kwamba']),
    so: new Set(['waa', 'iyo', 'oo', 'ka', 'ku', 'in', 'ay', 'ee', 'laga', 'ugu', 'lakin', 'sida', 'waxaa', 'ama', 'kale', 'dheer', 'jiray', 'leh', 'aad', 'waxa']),
    af: new Set(['die', 'en', 'van', 'het', 'dat', 'vir', 'met', 'nie', 'ook', 'maar', 'was', 'kan', 'sal', 'aan', 'nog', 'wat', 'hulle', 'haar', 'ons', 'hom']),
    zu: new Set(['uma', 'futhi', 'ukuthi', 'ngoba', 'kodwa', 'kwa', 'noma', 'yena', 'bona', 'naye', 'nabo', 'kanje', 'lapho', 'okwa', 'ngale', 'bonke', 'kuyo', 'kube', 'wathi', 'eya']),
    fil: new Set(['ang', 'ng', 'mga', 'sa', 'na', 'ay', 'niya', 'siya', 'ako', 'ito', 'para', 'kung', 'nang', 'din', 'lang', 'hindi', 'pag', 'dahil', 'pero', 'sila']),
    jv: new Set(['lan', 'ing', 'kang', 'sing', 'ora', 'ana', 'iku', 'iki', 'wis', 'arep', 'nanging', 'bisa', 'amarga', 'kanggo', 'uwong', 'kabeh', 'isih', 'saka', 'maneh', 'saiki']),
    su: new Set(['jeung', 'teh', 'kana', 'anu', 'henteu', 'pikeun', 'dina', 'mah', 'téh', 'bisa', 'jadi', 'naon', 'ogé', 'boga', 'anjeun', 'urang', 'maneh', 'kitu', 'atuh', 'lamun']),
    uz: new Set(['va', 'bir', 'bu', 'uchun', 'bilan', 'emas', 'ham', 'lekin', 'yoki', 'keyin', 'bor', 'har', 'edi', 'shu', 'hech', 'yana', 'kabi', 'shunday', 'juda', 'qanday']),

    // Cyrillic-script languages
    ru: new Set(['что', 'это', 'как', 'так', 'его', 'она', 'они', 'было', 'уже', 'все', 'для', 'был', 'она', 'ещё', 'или', 'при', 'тоже', 'мне', 'даже', 'вот']),
    uk: new Set(['що', 'це', 'як', 'його', 'вона', 'вони', 'було', 'вже', 'всі', 'для', 'був', 'ще', 'або', 'при', 'також', 'мені', 'навіть', 'ось', 'тому', 'коли']),
    bg: new Set(['на', 'от', 'за', 'се', 'да', 'са', 'като', 'също', 'има', 'бил', 'само', 'все', 'още', 'след', 'без', 'при', 'много', 'така', 'тези', 'тя']),
    sr: new Set(['је', 'да', 'на', 'се', 'су', 'за', 'али', 'био', 'као', 'или', 'сам', 'све', 'још', 'само', 'бити', 'није', 'већ', 'има', 'који', 'ово']),
    mk: new Set(['на', 'од', 'за', 'се', 'да', 'како', 'исто', 'има', 'бил', 'само', 'сè', 'уште', 'после', 'без', 'при', 'многу', 'така', 'овие', 'тие', 'таа']),
    kk: new Set(['бір', 'және', 'бұл', 'үшін', 'мен', 'жоқ', 'бар', 'деп', 'сол', 'осы', 'оның', 'біз', 'оны', 'кейін', 'ғана', 'яғни', 'бойынша', 'бірақ', 'неге', 'қалай']),

    // Arabic-script languages
    ar: new Set(['في', 'من', 'على', 'إلى', 'أن', 'هذا', 'هذه', 'التي', 'الذي', 'عن', 'كان', 'لم', 'ما', 'مع', 'بعد', 'قد', 'أو', 'بين', 'ذلك', 'حتى']),
    fa: new Set(['از', 'که', 'در', 'این', 'با', 'است', 'آن', 'برای', 'هم', 'یا', 'بود', 'نه', 'ما', 'تا', 'اما', 'شد', 'خود', 'بر', 'هر', 'پس']),
    ur: new Set(['کے', 'کا', 'کی', 'میں', 'سے', 'نے', 'پر', 'ہے', 'اور', 'یہ', 'کو', 'بھی', 'وہ', 'تھا', 'ایک', 'لیے', 'ہو', 'جو', 'مگر', 'اس']),
    ps: new Set(['د', 'په', 'چې', 'دا', 'هم', 'او', 'یو', 'لره', 'نه', 'تر', 'سره', 'ته', 'وه', 'کې', 'دې', 'هغه', 'خو', 'پورې', 'بل', 'ډېر']),

    // Devanagari-script languages
    hi: new Set(['का', 'के', 'की', 'में', 'से', 'है', 'और', 'यह', 'को', 'पर', 'ने', 'भी', 'वह', 'था', 'एक', 'लिए', 'हो', 'जो', 'मगर', 'इस']),
    mr: new Set(['आणि', 'हा', 'ही', 'हे', 'या', 'ला', 'ने', 'च्या', 'केले', 'होता', 'होती', 'असे', 'त्या', 'पण', 'एक', 'काही', 'म्हणून', 'नाही', 'आहे', 'तो']),
    ne: new Set(['र', 'को', 'मा', 'ले', 'छ', 'यो', 'त्यो', 'गर्न', 'भएको', 'गरेको', 'हो', 'थियो', 'पनि', 'एक', 'तर', 'कुनै', 'यस', 'भने', 'सबै', 'गर्दा']),
  };
  ```

- File: `src/utils/languageDetection.ts`
  - Import stopwords: `import { STOPWORDS } from './stopwords';`
  - Add `disambiguateByStopwords()` function:
    ```typescript
    function disambiguateByStopwords(
      text: string,
      candidateLanguages: string[],
      fallbackLanguage: string
    ): DetectionResult {
      // Tokenize: split on non-letter characters, lowercase
      const words = text.toLowerCase().split(/[^a-zA-Z\u00C0-\u024F\u0400-\u04FF\u0600-\u06FF\u0900-\u097F]+/).filter(w => w.length > 0);

      let bestLang = fallbackLanguage;
      let bestCount = 0;

      for (const lang of candidateLanguages) {
        const stopwords = STOPWORDS[lang];
        if (!stopwords) continue;
        let count = 0;
        for (const word of words) {
          if (stopwords.has(word)) count++;
        }
        if (count > bestCount) {
          bestCount = count;
          bestLang = lang;
        }
      }

      if (bestCount === 0) {
        return { language: fallbackLanguage, confidence: 'low', method: 'fallback' };
      }
      return { language: bestLang, confidence: 'medium', method: 'stopwords' };
    }
    ```
  - Update `detectLanguage()` to call `disambiguateByStopwords` instead of returning fallback:
    ```typescript
    // Replace the TODO line:
    if (script.candidateLanguages && script.fallbackLanguage) {
      return disambiguateByStopwords(sample, script.candidateLanguages, script.fallbackLanguage);
    }
    ```

**Step 4: Verify (Green)**
- Command: `npx vitest run src/utils/languageDetection.test.ts`
- Expect: All tests pass including German, French, Spanish, etc.

**Step 5: Git Commit**
- Command: `git add -A && git commit -m "feat: add stopword disambiguation for Latin, Cyrillic, Arabic, Devanagari scripts"`

---

### Task 4: Add stopword tests for Cyrillic and Arabic disambiguation

**Goal:** Verify Cyrillic (RU vs UK vs BG) and Arabic (AR vs FA) disambiguation works.

**Step 1: Write the Failing Tests**
- File: `src/utils/languageDetection.test.ts`
- Add tests:
  ```typescript
  it('should detect Ukrainian text (Cyrillic disambiguation)', () => {
    const text = 'Чоловік пішов у парк зі своїм собакою і діти грали на газоні. Він мав довгий день і хотів відпочити. Це було дуже гарно.';
    expect(detectLanguage(text).language).toBe('uk');
  });

  it('should detect Bulgarian text (Cyrillic disambiguation)', () => {
    const text = 'Мъжът отиде в парка с кучето си и децата играеха на тревата. Той имаше дълъг ден и искаше да си почине. Това беше много хубаво.';
    expect(detectLanguage(text).language).toBe('bg');
  });

  it('should detect Persian/Farsi text (Arabic script disambiguation)', () => {
    const text = 'مرد با سگش به پارک رفت و بچه ها روی چمن بازی می کردند. او یک روز طولانی داشت و می خواست استراحت کند.';
    expect(detectLanguage(text).language).toBe('fa');
  });

  it('should detect Hindi text (Devanagari disambiguation)', () => {
    const text = 'आदमी अपने कुत्ते के साथ पार्क में गया और बच्चे घास पर खेल रहे थे। उसका एक लंबा दिन था और वह आराम करना चाहता था।';
    expect(detectLanguage(text).language).toBe('hi');
  });
  ```

**Step 2: Run Test (Red or Green)**
- Command: `npx vitest run src/utils/languageDetection.test.ts`
- These may already pass from Task 3 implementation. If they fail, the stopword lists need tuning.

**Step 3: Tune stopwords if needed**
- If UK/BG/FA/HI tests fail, examine which stopwords are matching incorrectly and adjust the lists in `src/utils/stopwords.ts`.

**Step 4: Verify (Green)**
- Command: `npx vitest run src/utils/languageDetection.test.ts`
- Expect: All tests pass.

**Step 5: Git Commit**
- Command: `git add -A && git commit -m "test: add Cyrillic, Arabic, Devanagari disambiguation tests"`

---

### Task 5: Add DataStore methods and update tests

**Goal:** Add `clearDetectedLanguage()`, `setDetectedLanguage()`, `loadedFileName` signal to DataStore. Update existing tests.

**Step 1: Write the Failing Tests**
- File: `src/stores/DataStore.test.ts`
- Add tests inside the `detectedLanguage` describe block:
  ```typescript
  it('clears detected language', () => {
    store.setTextContent('Это русский текст с множеством слов.');
    store.detectLanguageFromContent();
    expect(store.detectedLanguage.value).toBe('ru');
    store.clearDetectedLanguage();
    expect(store.detectedLanguage.value).toBe('');
  });

  it('allows manual language override', () => {
    store.setTextContent('This is English text.');
    store.detectLanguageFromContent();
    expect(store.detectedLanguage.value).toBe('en');
    store.setDetectedLanguage('de');
    expect(store.detectedLanguage.value).toBe('de');
  });

  it('stores loaded file name', () => {
    expect(store.loadedFileName.value).toBe('');
    store.setLoadedFileName('mybook.epub');
    expect(store.loadedFileName.value).toBe('mybook.epub');
  });

  it('clears loaded file name on clear()', () => {
    store.setLoadedFileName('mybook.epub');
    store.clear();
    expect(store.loadedFileName.value).toBe('');
  });

  it('returns DetectionResult from detectLanguageFromContent', () => {
    store.setTextContent('Der Mann ging mit seinem Hund in den Park und die Kinder spielten.');
    const result = store.detectLanguageFromContent();
    expect(result.language).toBe('de');
    expect(result.confidence).toBeDefined();
    expect(result.method).toBeDefined();
    expect(store.detectedLanguage.value).toBe('de');
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npx vitest run src/stores/DataStore.test.ts`
- Expect: Fail — `clearDetectedLanguage`, `setDetectedLanguage`, `loadedFileName`, `setLoadedFileName` don't exist.

**Step 3: Implementation (Green)**
- File: `src/stores/DataStore.ts`
- Add new signal and methods:
  ```typescript
  // After existing detectedLanguage signal:
  readonly loadedFileName = signal<string>('');

  // New methods:
  clearDetectedLanguage(): void {
    this.detectedLanguage.value = '';
  }

  setDetectedLanguage(lang: DetectedLanguage): void {
    this.detectedLanguage.value = lang;
  }

  setLoadedFileName(name: string): void {
    this.loadedFileName.value = name;
  }
  ```
- In the `clear()` method, add:
  ```typescript
  this.loadedFileName.value = '';
  ```
- Update the existing `detectLanguageFromContent` to return `DetectionResult` (already done in Task 1).
- Fix the test that checks `const detected = store.detectLanguageFromContent();` to use `detected.language`.

**Step 4: Verify (Green)**
- Command: `npx vitest run src/stores/DataStore.test.ts`
- Expect: All tests pass.

**Step 5: Git Commit**
- Command: `git add -A && git commit -m "feat: add clearDetectedLanguage, setDetectedLanguage, loadedFileName to DataStore"`

---

### Task 6: Add language badge UI to FileDropZone

**Goal:** Show detected language as a selectable badge next to the filename after book is loaded.

**Step 1: Write the Failing Test**
- File: `src/components/convert/FileDropZone.test.tsx` (new file)
- Basic render test:
  ```typescript
  import { describe, it, expect, vi } from 'vitest';
  import { render, screen } from '@testing-library/preact';
  import { FileDropZone } from './FileDropZone';
  // Mock stores as needed based on project patterns

  describe('FileDropZone', () => {
    it('does not show language badge when no book loaded', () => {
      // Render with default store state (bookLoaded = false)
      // Assert no select element with language options exists
    });

    it('shows language badge when book is loaded', () => {
      // Set bookLoaded = true, detectedLanguage = 'de', loadedFileName = 'test.epub'
      // Assert select element exists with value 'de'
      // Assert filename is displayed
    });
  });
  ```
- Note: The exact test setup depends on how the project mocks stores. Follow existing test patterns.

**Step 2: Run Test (Red)**
- Command: `npx vitest run src/components/convert/FileDropZone.test.tsx`
- Expect: Fail — no badge component exists.

**Step 3: Implementation (Green)**
- File: `src/components/convert/FileDropZone.tsx`
- Add available locales constant (extract unique 2-letter codes from voices.ts, or import):
  ```typescript
  // Can be imported from a shared location or defined here
  const AVAILABLE_LOCALES = [
    'af','am','ar','az','bg','bn','bs','ca','cs','cy','da','de','el','en','es',
    'et','fa','fi','fil','fr','ga','gl','gu','he','hi','hr','hu','id','is','it',
    'iu','ja','jv','ka','kk','km','kn','ko','lo','lt','lv','mk','ml','mn','mr',
    'ms','mt','my','nb','ne','nl','pl','ps','pt','ro','ru','si','sk','sl','so',
    'sq','sr','su','sv','sw','ta','te','th','tr','uk','ur','uz','vi','zh','zu'
  ];
  ```

- Add `LanguageBadge` component inside the file (or as separate file):
  ```tsx
  function LanguageBadge() {
    const dataStore = useData();
    const lang = dataStore.detectedLanguage.value;
    const bookLoaded = dataStore.bookLoaded.value;
    const fileName = dataStore.loadedFileName.value;

    if (!bookLoaded || !lang) return null;

    return (
      <div className="flex items-center justify-between mt-3 px-2 py-1.5 bg-primary/50 rounded border border-border">
        <span className="text-xs text-gray-400 truncate mr-2">
          ✅ {fileName}
        </span>
        <select
          value={lang}
          onChange={(e) => {
            e.stopPropagation();
            dataStore.setDetectedLanguage((e.target as HTMLSelectElement).value);
          }}
          onClick={(e) => e.stopPropagation()}
          className="bg-primary border border-border rounded px-2 py-0.5 text-xs text-accent font-mono cursor-pointer"
        >
          {AVAILABLE_LOCALES.map(code => (
            <option key={code} value={code}>{code.toUpperCase()}</option>
          ))}
        </select>
      </div>
    );
  }
  ```

- Render `<LanguageBadge />` inside the FileDropZone return, after the drop zone `<div>` and before the Dictionary button:
  ```tsx
  return (
    <div className="space-y-3">
      {/* File Drop Zone */}
      <div className={`border-2 border-dashed ...`} ...>
        {/* existing content */}
      </div>

      {/* Language Badge - shown after book loaded */}
      <LanguageBadge />

      {/* Dictionary Upload */}
      <div className="flex items-center gap-2">
        {/* existing dictionary button */}
      </div>
    </div>
  );
  ```

**Step 4: Verify (Green)**
- Command: `npx vitest run src/components/convert/FileDropZone.test.tsx`
- Expect: Tests pass.
- Also do a visual check: load the app, drop a file, confirm badge appears.

**Step 5: Git Commit**
- Command: `git add -A && git commit -m "feat: add language badge to FileDropZone with manual override dropdown"`

---

### Task 7: Update book loading flow (clear → load → detect → show)

**Goal:** When a new book is loaded, clear the language badge, then detect and re-show. Log fallback warnings.

**Step 1: Write the Failing Test**
- File: `src/components/convert/FileDropZone.test.tsx`
- Add test:
  ```typescript
  it('clears and re-detects language on new file load', () => {
    // Set initial state: bookLoaded = true, detectedLanguage = 'de'
    // Simulate loading a new file (Russian text)
    // Assert detectedLanguage was cleared then set to 'ru'
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npx vitest run src/components/convert/FileDropZone.test.tsx`
- Expect: Fail.

**Step 3: Implementation (Green)**
- File: `src/components/convert/FileDropZone.tsx`
- In `handleFileChange`, add at the beginning of the try block:
  ```typescript
  try {
    // Clear previous language detection
    dataStore.clearDetectedLanguage();

    const allConverted: Array<{ filename: string; content: string }> = [];
    // ... existing loading logic ...
  ```
- After `dataStore.setBook(...)`, add:
  ```typescript
    dataStore.setBook({ fileNames, allSentences, fullText });

    // Detect language from loaded content
    const result = dataStore.detectLanguageFromContent();

    // Store the display filename
    const displayName = files.length === 1
      ? (files[0] as File).name
      : `${(files[0] as File).name} (+${files.length - 1})`;
    dataStore.setLoadedFileName(displayName);

    // Log if detection was uncertain
    if (result.confidence === 'low') {
      logs.warn(`Could not reliably detect book language, falling back to EN`);
    } else {
      logs.info(`Detected book language: ${result.language.toUpperCase()}`);
    }
  ```
- Apply the **same changes** to `handleDrop` (same pattern: clear at start, detect after setBook, set filename, log).

**Step 4: Verify (Green)**
- Command: `npx vitest run src/components/convert/FileDropZone.test.tsx`
- Expect: All tests pass.
- Command: `npx vitest run` (full suite)
- Expect: All tests pass.

**Step 5: Git Commit**
- Command: `git add -A && git commit -m "feat: clear and re-detect language on book load, log fallback warnings"`

---

### Task 8: Full integration verification

**Goal:** Run the full test suite and verify everything works end-to-end.

**Step 1: Run all tests**
- Command: `npx vitest run`
- Expect: All pass.

**Step 2: Manual verification**
- Load the app in browser.
- Drop an English `.txt` file → badge shows `EN`.
- Drop a Russian `.fb2` file → badge clears, then shows `RU`.
- Drop a German `.epub` → badge clears, then shows `DE`.
- Click the badge dropdown → select `FR` manually → badge shows `FR`.
- Check logs panel for detection messages.

**Step 3: Git Commit (final)**
- Command: `git add -A && git commit -m "feat: multi-language book detection with UI badge"`

**Step 4: Verify no regressions**
- Command: `npx vitest run`
- Expect: All pass. Done.
