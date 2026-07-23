export type MaxTokensParameter =
  | 'max_tokens'
  | 'max_completion_tokens'
  | 'none';

export interface ProviderProfile {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  maxTokensParameter?: MaxTokensParameter;
  headers?: Record<string, string>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerationSettings {
  maxInputCharacters: number;
  maxOutputTokens: number;
  temperature: number;
  concurrency: number;
  fileNameTemplate: string;
}
