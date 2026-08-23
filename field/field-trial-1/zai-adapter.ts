/**
 * zai-adapter.ts — the ONLY module that talks to the network.
 * Wraps Z.ai API calls with concurrency control and error handling.
 */

import type { CellAdapter, CellCallInput, CellCallOutput } from './cellrunner.ts';

export interface ZaiAdapterOptions {
  baseUrl?: string;
  model?: string;
  concurrency?: number;
  timeoutMs?: number;
}

class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise((resolve) => {
      this.queue.push(() => {
        this.permits--;
        resolve();
      });
    });
  }

  release(): void {
    this.permits++;
    const next = this.queue.shift();
    if (next) next();
  }
}

export function makeZaiAdapter(opts?: ZaiAdapterOptions): CellAdapter & { fetchChat: (messages: any[], params: any) => Promise<any> } {
  const apiKey = process.env.ZAI_API_KEY || process.env.FLEET_GATEWAY__PROVIDERS__ZAI__KEYS;
  if (!apiKey) {
    throw new Error('Z.ai API key not configured — set ZAI_API_KEY or FLEET_GATEWAY__PROVIDERS__ZAI__KEYS');
  }

  const baseUrl = opts?.baseUrl || process.env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4';
  const model = opts?.model || 'glm-5-turbo';
  const concurrency = opts?.concurrency ?? 8;
  const timeoutMs = opts?.timeoutMs ?? 30_000;
  const semaphore = new Semaphore(concurrency);

  const adapter: CellAdapter & { fetchChat: (messages: any[], params: any) => Promise<any> } = {
    name: `zai/${model}`,

    async call(input: CellCallInput): Promise<CellCallOutput> {
      const startMs = performance.now();
      const result = await this.fetchChat(
        [{ role: 'system', content: input.systemPrompt }, { role: 'user', content: input.userPrompt }],
        input.params
      );
      const latencyMs = Math.round(performance.now() - startMs);
      return { raw: result, latencyMs };
    },

    async fetchChat(messages: any[], params: any): Promise<string> {
      await semaphore.acquire();
      try {
        const body = {
          model,
          messages,
          temperature: params.temperature ?? 1.0,
          max_tokens: 600,
          ...(params.thinking === 'disabled' ? { thinking: { type: 'disabled' } } : {}),
        };

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        let response;
        try {
          response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        if (!content) {
          throw new Error('no content in response');
        }

        return content;
      } finally {
        semaphore.release();
      }
    },
  };

  return adapter;
}
