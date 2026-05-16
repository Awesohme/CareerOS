export const DEFAULT_MODELS = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  deepseek: 'deepseek-chat',
  gemini: 'gemini-2.0-flash',
  qwen: 'qwen-plus',
  kimi: 'moonshot-v1-8k',
  custom: '',
};

const BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  kimi: 'https://api.moonshot.cn/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
};

export function getAiConfig() {
  return {
    provider: (process.env.AI_PROVIDER || '').toLowerCase().trim(),
    apiKey: (process.env.AI_API_KEY || '').trim(),
    model: (process.env.AI_MODEL || '').trim(),
    baseUrl: (process.env.AI_BASE_URL || '').trim(),
  };
}

export async function evaluate(systemPrompt, jdText) {
  const { provider, apiKey, model, baseUrl } = getAiConfig();

  if (!provider || !apiKey) {
    throw new Error('AI_PROVIDER and AI_API_KEY environment variables are not set.');
  }

  const resolvedModel = model || DEFAULT_MODELS[provider] || 'gpt-4o';
  const userMessage = `Please evaluate this job opportunity:\n\n${jdText}`;

  if (provider === 'anthropic') {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: resolvedModel,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    return message.content[0].type === 'text' ? message.content[0].text : '';
  }

  const { default: OpenAI } = await import('openai');
  const resolvedBaseUrl = provider === 'custom' ? baseUrl : (BASE_URLS[provider] || BASE_URLS.openai);
  const client = new OpenAI({ apiKey, baseURL: resolvedBaseUrl });
  const completion = await client.chat.completions.create({
    model: resolvedModel,
    max_tokens: 4096,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  });
  return completion.choices[0]?.message?.content || '';
}
