export type AiConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

export type AiAdapter = {
  explain(context: string, question: string): Promise<string>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LocalLLMClient = any;
let clientPromise: Promise<LocalLLMClient> | null = null;

export function createAiAdapter(config: AiConfig): AiAdapter | null {
  if (!config.apiKey) return null;

  // MEDIUM #8: cache the client across explain() calls to avoid leaking
  // HTTP agents / connection pools per tool invocation.
  const getClient = async (): Promise<LocalLLMClient> => {
    if (!clientPromise) {
      clientPromise = (async () => {
        const { OpenAI } = await import('openai');
        return new OpenAI({
          apiKey: config.apiKey,
          ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
        });
      })();
    }
    return clientPromise;
  };

  return {
    async explain(context, question) {
      const client = await getClient();
      const res = await client.chat.completions.create({
        model: config.model || 'qwen2.5-coder',
        messages: [
          { role: 'system', content: 'You are a code intelligence assistant. Answer concisely.' },
          { role: 'user', content: `Context:\n${context}\n\nQuestion: ${question}` },
        ],
        max_tokens: 512,
      });
      return res.choices[0]?.message?.content ?? '';
    },
  };
}
