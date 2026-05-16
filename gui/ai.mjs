import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  kimi: 'https://api.moonshot.cn/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
};

export const DEFAULT_MODELS = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  deepseek: 'deepseek-chat',
  gemini: 'gemini-2.0-flash',
  qwen: 'qwen-plus',
  kimi: 'moonshot-v1-8k',
  custom: '',
};

async function readFileSafe(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

async function buildSystemPrompt() {
  const [shared, oferta, cv] = await Promise.all([
    readFileSafe(join(root, 'modes', '_shared.md')),
    readFileSafe(join(root, 'modes', 'oferta.md')),
    readFileSafe(join(root, 'cv.md')),
  ]);
  return [
    shared && `# Shared Context\n${shared}`,
    oferta && `# Evaluation Mode\n${oferta}`,
    cv && `# Candidate CV\n${cv}`,
  ]
    .filter(Boolean)
    .join('\n\n---\n\n');
}

export async function loadAiConfig() {
  const raw = await readFileSafe(join(root, 'config', 'profile.yml'));
  const provider = raw.match(/ai_provider:\s*["']?([^"'\n]+)["']?/)?.[1]?.trim() || '';
  const apiKey = raw.match(/ai_api_key:\s*["']?([^"'\n]+)["']?/)?.[1]?.trim() || '';
  const model = raw.match(/ai_model:\s*["']?([^"'\n]+)["']?/)?.[1]?.trim() || '';
  const baseUrl = raw.match(/ai_base_url:\s*["']?([^"'\n]+)["']?/)?.[1]?.trim() || '';
  return { provider, apiKey, model, baseUrl };
}

export async function evaluate(jdText) {
  const { provider, apiKey, model, baseUrl } = await loadAiConfig();

  if (!provider || !apiKey) {
    throw new Error('AI provider not configured. Complete setup first.');
  }

  const systemPrompt = await buildSystemPrompt();
  const userMessage = `Please evaluate this job opportunity:\n\n${jdText}`;

  if (provider === 'anthropic') {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: model || DEFAULT_MODELS.anthropic,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    return message.content[0].type === 'text' ? message.content[0].text : '';
  }

  // OpenAI-compatible providers
  const { default: OpenAI } = await import('openai');
  const resolvedBaseUrl = provider === 'custom' ? baseUrl : (BASE_URLS[provider] || BASE_URLS.openai);
  const client = new OpenAI({ apiKey, baseURL: resolvedBaseUrl });
  const completion = await client.chat.completions.create({
    model: model || DEFAULT_MODELS[provider] || 'gpt-4o',
    max_tokens: 4096,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  });
  return completion.choices[0]?.message?.content || '';
}
