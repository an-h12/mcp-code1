export type AiConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

export type AiAdapter = {
  explain(context: string, question: string): Promise<string>;
};

export function createAiAdapter(config: AiConfig): AiAdapter | null {
  if (!config.apiKey) return null;
  return {
    async explain(context, question) {
      // Lazy import so the openai package is optional at runtime
      const { default: OpenAI } = await import('openai');
      const client = new OpenAI({
        apiKey: config.apiKey,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      });
      const res = await client.chat.completions.create({
        model: config.model || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a code intelligence assistant. Answer concisely.' },
          { role: 'user', content: `Context:\n${context}\n\nQuestion: ${question}` },
        ],
        max_tokens: 512,
      });
      return res.choices[0]?.message.content ?? '';
    },
  };
}
