import Anthropic from '@anthropic-ai/sdk';
import { BadGatewayException, Logger, ServiceUnavailableException } from '@nestjs/common';

import type { AiConfig } from '../config/configuration.js';
import type { AiProvider, AiRequest } from './ai.provider.js';

export class ClaudeProvider implements AiProvider {
  private readonly logger = new Logger(ClaudeProvider.name);
  private readonly client: Anthropic | null;

  constructor(private readonly config: AiConfig) {
    // Created only with a key, so the app still starts before one is added.
    this.client = config.apiKey ? new Anthropic({ apiKey: config.apiKey }) : null;
  }

  async answer(request: AiRequest): Promise<string> {
    if (!this.client) {
      throw new ServiceUnavailableException('AI is not set up yet. Add ANTHROPIC_API_KEY to the API settings.');
    }
    try {
      const response = await this.client.beta.messages.create({
        model: this.config.model,
        max_tokens: 16000,
        output_config: { effort: request.depth === 'quick' ? 'low' : 'medium' },
        // If the model declines, the API retries on a suitable fallback model in the same call.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: [
          { type: 'text', text: request.instructions },
          { type: 'text', text: request.context, cache_control: { type: 'ephemeral' } },
        ],
        messages: request.turns,
      });
      if (response.stop_reason === 'refusal') {
        return "Sorry, I can't help with that request.";
      }
      return response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('').trim();
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError) {
        throw new ServiceUnavailableException('The AI is busy right now. Try again in a moment.');
      }
      if (err instanceof Anthropic.APIError) {
        this.logger.error(`Claude request failed (${err.status}): ${err.message}`);
        throw new BadGatewayException("The AI couldn't answer just now. Try again later.");
      }
      throw err;
    }
  }
}
