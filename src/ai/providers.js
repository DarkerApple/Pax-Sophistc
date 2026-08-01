// Free-tier LLM providers the game can talk to directly from the browser.
//
// Everything here is called client-side with the player's own key, which never
// leaves their machine (it lives in localStorage and goes straight to the
// provider). That is only acceptable because these are the player's own
// personal free-tier keys — the README says so plainly.

export const PROVIDERS = [
  {
    id: 'offline',
    label: 'Offline — no AI',
    kind: 'none',
    requiresKey: false,
    blurb: 'Plays fully without any API key. Briefings are generated locally from the simulation.',
    models: [],
    signupUrl: null,
  },
  {
    id: 'gemini',
    label: 'Google AI Studio (Gemini)',
    kind: 'gemini',
    requiresKey: true,
    blurb: 'Generous free tier, no card required. The best default for this game.',
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'],
    defaultModel: 'gemini-2.5-flash',
    signupUrl: 'https://aistudio.google.com/apikey',
    endpoint: (model) =>
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
  },
  {
    id: 'groq',
    label: 'Groq',
    kind: 'openai',
    requiresKey: true,
    blurb: 'Free tier with very fast inference. Rate limited per minute rather than per month.',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-120b'],
    defaultModel: 'llama-3.3-70b-versatile',
    signupUrl: 'https://console.groq.com/keys',
    endpoint: () => 'https://api.groq.com/openai/v1/chat/completions',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter (free models)',
    kind: 'openai',
    requiresKey: true,
    blurb: 'Aggregates many providers. Any model ending in ":free" costs nothing.',
    models: [
      'meta-llama/llama-3.3-70b-instruct:free',
      'google/gemma-3-27b-it:free',
      'qwen/qwen3-235b-a22b:free',
      'deepseek/deepseek-chat-v3-0324:free',
    ],
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    signupUrl: 'https://openrouter.ai/keys',
    endpoint: () => 'https://openrouter.ai/api/v1/chat/completions',
    extraHeaders: () => ({
      'HTTP-Referer': typeof location !== 'undefined' ? location.origin : 'https://localhost',
      'X-Title': 'Pax Sophistc',
    }),
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    kind: 'openai',
    requiresKey: true,
    blurb: 'Free tier, extremely fast, small model selection.',
    models: ['llama-3.3-70b', 'llama3.1-8b', 'qwen-3-32b'],
    defaultModel: 'llama-3.3-70b',
    signupUrl: 'https://cloud.cerebras.ai/',
    endpoint: () => 'https://api.cerebras.ai/v1/chat/completions',
  },
  {
    id: 'mistral',
    label: 'Mistral (La Plateforme)',
    kind: 'openai',
    requiresKey: true,
    blurb: 'Free experiment tier after phone verification.',
    models: ['mistral-small-latest', 'open-mistral-nemo', 'mistral-large-latest'],
    defaultModel: 'mistral-small-latest',
    signupUrl: 'https://console.mistral.ai/api-keys/',
    endpoint: () => 'https://api.mistral.ai/v1/chat/completions',
  },
  {
    id: 'ollama',
    label: 'Ollama (local, free forever)',
    kind: 'openai',
    requiresKey: false,
    blurb:
      'Runs on your own machine. Start it with OLLAMA_ORIGINS="*" so the browser is allowed to call it.',
    models: ['llama3.2', 'qwen2.5:7b', 'mistral-nemo'],
    defaultModel: 'llama3.2',
    signupUrl: 'https://ollama.com/download',
    endpoint: () => 'http://localhost:11434/v1/chat/completions',
  },
  {
    id: 'custom',
    label: 'Custom OpenAI-compatible endpoint',
    kind: 'openai',
    requiresKey: false,
    blurb: 'Any server that speaks /v1/chat/completions — LM Studio, llama.cpp, vLLM, a proxy.',
    models: [],
    defaultModel: '',
    signupUrl: null,
    endpoint: (model, config) => config.endpoint || 'http://localhost:8080/v1/chat/completions',
  },
];

export const PROVIDERS_BY_ID = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]));

export function defaultAiConfig() {
  return {
    providerId: 'offline',
    apiKey: '',
    model: '',
    endpoint: '',
    temperature: 0.85,
    enabled: true,
  };
}
