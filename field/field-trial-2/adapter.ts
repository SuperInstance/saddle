/**
 * adapter.ts — network-facing Z.ai client for field trial 2.
 * Unlike trial 1's adapter, this one reports provider `usage` so the v3
 * token accounting lands real numbers in the ledger (estimated: false).
 */

import type { CellRequest, CellAdapter, Usage } from '../../src/cellrunner.ts';
export type { CellRequest, CellAdapter, Usage } from '../../src/cellrunner.ts';

class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];
  constructor(permits: number) { this.permits = permits; }
  async acquire(): Promise<void> {
    if (this.permits > 0) { this.permits--; return; }
    return new Promise((resolve) => { this.queue.push(() => { this.permits--; resolve(); }); });
  }
  release(): void {
    this.permits++;
    const next = this.queue.shift();
    if (next) next();
  }
}

export function makeZaiAdapter(opts?: { model?: string; concurrency?: number; timeoutMs?: number }): CellAdapter {
  const apiKey = process.env.ZAI_API_KEY || process.env.FLEET_GATEWAY__PROVIDERS__ZAI__KEYS;
  if (!apiKey) throw new Error('Z.ai API key not configured — set ZAI_API_KEY');
  const baseUrl = process.env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4';
  const model = opts?.model || 'glm-5-turbo';
  const concurrency = opts?.concurrency ?? 6;
  const timeoutMs = opts?.timeoutMs ?? 30_000;
  const semaphore = new Semaphore(concurrency);

  return {
    name: `zai/${model}`,
    async call(input: CellRequest): Promise<{ raw: string; latencyMs: number; usage?: Usage }> {
      await semaphore.acquire();
      try {
        const startMs = performance.now();
        const body = {
          model,
          messages: [
            { role: 'system', content: input.prompt.system },
            { role: 'user', content: input.prompt.user },
          ],
          temperature: (input.params.temperature as number) ?? 0.1,
          max_tokens: 600,
          ...((input.params as { thinking?: string }).thinking === 'disabled'
            ? { thinking: { type: 'disabled' } }
            : {}),
        };
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        let response;
        try {
          response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
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
        const data = (await response.json()) as {
          choices?: { message?: { content?: string } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        };
        const content = data.choices?.[0]?.message?.content;
        if (!content) throw new Error('no content in response');
        const latencyMs = Math.round(performance.now() - startMs);
        const usage: Usage | undefined =
          data.usage && typeof data.usage.total_tokens === 'number'
            ? {
                promptTokens: data.usage.prompt_tokens ?? 0,
                completionTokens: data.usage.completion_tokens ?? 0,
                totalTokens: data.usage.total_tokens,
                estimated: false,
              }
            : undefined;
        return { raw: content, latencyMs, usage };
      } finally {
        semaphore.release();
      }
    },
  };
}
