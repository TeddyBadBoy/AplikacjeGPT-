export const MODELS = {
  chatgpt: {
    id: 'chatgpt',
    name: 'ChatGPT',
    role: 'rozmowa, porządkowanie, audyt, fakt-check, przygotowanie wsadu'
  },
  claude: {
    id: 'claude',
    name: 'Claude',
    role: 'duży kod, architektura, długie dokumenty, złożone wykonanie'
  },
  perplexity: {
    id: 'perplexity',
    name: 'Perplexity',
    role: 'świeży research, źródła, porównania informacji z sieci'
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    role: 'multimodalność, Google ecosystem, alternatywny werdykt'
  }
};

const RULES = [
  {
    model: 'perplexity',
    weight: 5,
    words: ['szukaj', 'wyszukaj', 'research', 'aktualne', 'najnowsze', 'cena', 'ceny', 'dokumentacja', 'źródła', 'api', 'news', 'wiadomości', 'porównaj oferty']
  },
  {
    model: 'claude',
    weight: 5,
    words: ['zbuduj', 'napisz kod', 'refactor', 'refaktoryz', 'architektura', 'implementuj', 'repo', 'debug', 'napraw kod', 'duży dokument', 'specyfikacja']
  },
  {
    model: 'gemini',
    weight: 4,
    words: ['zdjęcie', 'obraz', 'wideo', 'youtube', 'google maps', 'mapa', 'gemini', 'multimodal']
  },
  {
    model: 'chatgpt',
    weight: 4,
    words: ['audyt', 'fakt', 'sprawdź', 'zweryfikuj', 'alternatywa', 'alt', 'pogadajmy', 'pomysł', 'uporządkuj', 'do claude']
  }
];

const HIGH_STAKES = [
  'bezpieczeństwo', 'security', 'podatność', 'cve', 'prawo', 'prawny', 'medycz', 'zdrowie', 'finanse', 'podatek', 'pieniądze', 'produkcja', 'production'
];

const COMPLEXITY = [
  'wielopliki', 'multi-file', 'całe repo', 'pełna aplikacja', 'end-to-end', 'e2e', 'migracja', 'architektura', 'wdrożenie', 'deploy', 'agent'
];

function normalize(text = '') {
  return text.toLocaleLowerCase('pl-PL');
}

function containsAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

export function scoreModels(input = '') {
  const text = normalize(input);
  const scores = Object.fromEntries(Object.keys(MODELS).map((id) => [id, 0]));

  for (const rule of RULES) {
    for (const word of rule.words) {
      if (text.includes(word)) scores[rule.model] += rule.weight;
    }
  }

  // Default: rozmowa i przygotowanie kontekstu zostają w ChatGPT.
  scores.chatgpt += 1;
  return scores;
}

export function chooseMode(input = '', requestedMode = 'AUTO') {
  const mode = String(requestedMode || 'AUTO').toUpperCase();
  if (['SOLO', 'DUEL', 'JURY'].includes(mode)) return mode;

  const text = normalize(input);
  const highStakes = containsAny(text, HIGH_STAKES);
  const complex = containsAny(text, COMPLEXITY) || input.length > 4500;

  if (highStakes && complex) return 'JURY';
  if (highStakes) return 'DUEL';
  return 'SOLO';
}

export function routeTask(input = '', requestedMode = 'AUTO') {
  const scores = scoreModels(input);
  const ranked = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => ({ ...MODELS[id], score }));

  const mode = chooseMode(input, requestedMode);
  let selected;

  if (mode === 'SOLO') selected = ranked.slice(0, 1);
  else if (mode === 'DUEL') selected = ranked.slice(0, 2);
  else selected = ranked.slice(0, 4);

  return {
    mode,
    selected,
    scores,
    reason: buildReason(input, mode, selected)
  };
}

function buildReason(input, mode, selected) {
  const text = normalize(input);
  const reasons = [];
  if (containsAny(text, HIGH_STAKES)) reasons.push('temat wysokiej wagi → potrzebny drugi werdykt');
  if (containsAny(text, COMPLEXITY) || input.length > 4500) reasons.push('zadanie złożone → opłaca się model wykonawczy');
  if (selected[0]?.id === 'perplexity') reasons.push('dominują świeże dane / źródła');
  if (selected[0]?.id === 'claude') reasons.push('dominują kod / architektura / wykonanie');
  if (selected[0]?.id === 'gemini') reasons.push('dominują dane multimodalne / Google');
  if (selected[0]?.id === 'chatgpt') reasons.push('dominują rozmowa / kontrola / przygotowanie kontekstu');
  return `${mode}: ${reasons.join('; ') || 'najprostsza ścieżka wystarcza'}`;
}

export function compactContext(context = '', maxChars = 2400) {
  const clean = String(context)
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (clean.length <= maxChars) return clean;

  const head = Math.floor(maxChars * 0.72);
  const tail = maxChars - head - 80;
  return `${clean.slice(0, head)}\n\n[… KONTEKST SKRÓCONY …]\n\n${clean.slice(-tail)}`;
}

export function buildPacket({ task = '', context = '', requestedMode = 'AUTO' } = {}) {
  const route = routeTask(`${task}\n${context}`, requestedMode);
  const compact = compactContext(context);
  const models = route.selected.map((m) => `${m.name} — ${m.role}`).join('\n');

  return {
    route,
    packet: [
      `TRYB: ${route.mode}`,
      `MODELE:\n${models}`,
      '',
      `ZADANIE:\n${task.trim() || '(brak)'}`,
      '',
      `KONTEKST MINIMALNY:\n${compact || '(brak)'}`,
      '',
      'ZASADA: Nie rozszerzaj zakresu. Zwróć wynik, dowód/test oraz niepewności.'
    ].join('\n')
  };
}
