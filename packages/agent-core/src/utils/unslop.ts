const WORD_REPLACEMENTS: { [key: string]: string } = {
  leverage: 'use',
  utilize: 'use',
  robust: 'reliable',
  streamline: 'simplify',
  pivotal: 'important',
  'testament to': 'evidence of',
  foster: 'encourage',
  delve: 'explore',
  underscore: 'highlight',
  realm: 'field',
  meticulous: 'careful',
  comprehensive: 'complete',
  embark: 'start',
  seamless: 'smooth',
  seamlessly: 'smoothly',
  bespoke: 'custom',
  'game-changer': 'major change',
  revolutionary: 'new',
  dynamic: 'adaptive',
  fostering: 'encouraging',
  embarked: 'started',
  'cutting-edge': 'modern',
  landscape: 'scene',
  holistic: 'complete',
  actionable: 'practical',
  impactful: 'significant',
  navigate: 'work through',
  elevate: 'improve',
  harness: 'use',
  unleash: 'enable',
  empower: 'enable',
};

const ENGLISH_SLOP_SIGNALS: RegExp[] = [
  /\bleverage\b/i,
  /\butilize\b/i,
  /\brobust\b/i,
  /\bstreamline\b/i,
  /\bpivotal\b/i,
  /\btestament to\b/i,
  /\bfoster(?:ing)?\b/i,
  /\bdelve\b/i,
  /\bunderscore\b/i,
  /\bmeticulous(?:ly)?\b/i,
  /\bcomprehensive\b/i,
  /\bembark(?:ed|ing)?\b/i,
  /\bseamless(?:ly)?\b/i,
  /\bbespoke\b/i,
  /\bgame-changer\b/i,
  /\bcutting-edge\b/i,
  /\bholistic(?:ally)?\b/i,
  /In today's rapidly evolving/i,
  /It is worth noting that/i,
  /It's worth noting that/i,
  /\bMoreover,\s/i,
  /\bFurthermore,\s/i,
  /\bIn conclusion,\s/i,
];

const KOREAN_SLOP_SIGNALS: RegExp[] = [
  /(?:의|하는)\s+역할을\s+합니다/,
  /(?:의|하는)\s+역할을\s+수행합니다/,
  /을 활용하여/,
  /를 활용하여/,
  /하고자 합니다/,
  /그럼에도 불구하고/,
];

const KOREAN_PATTERNS: [RegExp, string][] = [
  [/(?:의|하는)\s+역할을\s+합니다/g, '합니다'],
  [/(?:의|하는)\s+역할을\s+수행합니다/g, '합니다'],
  [/을 가능하게 합니다/g, '을 지원합니다'],
  [/를 가능하게 합니다/g, '를 지원합니다'],
  [/을 가능하게 만듭니다/g, '을 지원합니다'],
  [/를 가능하게 만듭니다/g, '를 지원합니다'],
  [/을 통해 /g, '으로 '],
  [/를 통해 /g, '로 '],
  [/을 활용하여/g, '하여'],
  [/를 활용하여/g, '하여'],
  [/하고자 합니다/g, '하겠습니다'],
  [/하고자 노력합니다/g, '합니다'],
  [/이에 따라,/g, '따라서'],
  [/이에 따라 /g, '따라서 '],
  [/그럼에도 불구하고/g, '하지만'],
  [/임을 알 수 있습니다/g, '입니다'],
  [/것으로 보입니다/g, '입니다'],
  [/것으로 예상됩니다/g, '입니다'],
];

const MIN_UNSLOP_LENGTH = 40;

function isCodeHeavy(text: string): boolean {
  const trimmed = text.trim();
  if (/^```[\s\S]*```$/m.test(trimmed)) return true;
  const backticks = (trimmed.match(/`/g) ?? []).length;
  return backticks >= 4 && backticks > trimmed.length / 25;
}

/** Cheap pre-check — only run full cleanup when slop signals or locale calques are present. */
export function hasSlopPatterns(text: string): boolean {
  if (!text || text.trim().length < MIN_UNSLOP_LENGTH || isCodeHeavy(text)) return false;
  if (ENGLISH_SLOP_SIGNALS.some((pattern) => pattern.test(text))) return true;
  if (/[\uAC00-\uD7AF]/.test(text) && KOREAN_SLOP_SIGNALS.some((pattern) => pattern.test(text))) {
    return true;
  }
  return false;
}

export function unslopText(text: string): string {
  if (!text || !hasSlopPatterns(text)) return text;

  let cleaned = text;

  for (const [word, replacement] of Object.entries(WORD_REPLACEMENTS)) {
    const patterns = [
      { regex: new RegExp(`\\b${word}\\b`, 'g'), repl: replacement },
      { regex: new RegExp(`\\b${word.toUpperCase()}\\b`, 'g'), repl: replacement.toUpperCase() },
      {
        regex: new RegExp(`\\b${word.charAt(0).toUpperCase() + word.slice(1)}\\b`, 'g'),
        repl: replacement.charAt(0).toUpperCase() + replacement.slice(1),
      },
    ];

    for (const { regex, repl } of patterns) {
      cleaned = cleaned.replace(regex, repl);
    }
  }

  const phraseReplacements: [RegExp, string][] = [
    [/In today's rapidly evolving world(?: of)?,\s*/gi, ''],
    [/In today's rapidly changing landscape(?: of)?,\s*/gi, ''],
    [/It is worth noting that\s*/gi, ''],
    [/It's worth noting that\s*/gi, ''],
    [/Moreover,\s*/g, 'also, '],
    [/Moreover,\s*/gi, 'Also, '],
    [/Furthermore,\s*/g, 'also, '],
    [/Furthermore,\s*/gi, 'Also, '],
    [/Additionally,\s*/g, 'also, '],
    [/Additionally,\s*/gi, 'Also, '],
    [/At its core,\s*/gi, ''],
    [/In order to\s*/gi, 'To '],
    [/delve into\s*/gi, 'look at '],
    [/deep dive into\s*/gi, 'review '],
    [/deep dive\s*/gi, 'review '],
    [/unpack(?:ing)?\s*/gi, 'explain '],
    [/It is important to note that\s*/gi, ''],
    [/It's important to note that\s*/gi, ''],
    [/In conclusion,\s*/gi, ''],
    [/To sum up,\s*/gi, ''],
    [/Ultimately,\s*/gi, ''],
  ];

  for (const [regex, repl] of phraseReplacements) {
    cleaned = cleaned.replace(regex, repl);
  }

  if (/[\uAC00-\uD7AF]/.test(cleaned)) {
    for (const [regex, replacement] of KOREAN_PATTERNS) {
      cleaned = cleaned.replace(regex, replacement);
    }
  }

  cleaned = cleaned.replace(/ {2,}/g, ' ');
  return cleaned.trim();
}
