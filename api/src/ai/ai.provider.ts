export interface AiTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiRequest {
  // Instructions, then the contract text; the contract part is the same across a contract's
  // requests, so providers can cache it.
  instructions: string;
  context: string;
  turns: AiTurn[];
  // How much effort the answer deserves: a quick explanation or a fuller summary.
  depth: 'quick' | 'thorough';
}

/**
 * The only AI surface the application knows about. Claude lives behind it, so switching to
 * another company is one new provider file and the factory in ai.module.ts.
 */
export interface AiProvider {
  answer(request: AiRequest): Promise<string>;
}

export const AI_PROVIDER = Symbol('AI_PROVIDER');
