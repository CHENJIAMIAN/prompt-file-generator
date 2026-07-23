import type { ChatMessage, ProviderProfile } from './types';

export interface CompletionOptions {
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export class OpenAICompatibleClient {
  public constructor(
    private readonly profile: ProviderProfile,
    private readonly apiKey?: string,
  ) {}

  public async complete(
    messages: readonly ChatMessage[],
    options: CompletionOptions = {},
  ): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.profile.model,
      messages,
      stream: false,
    };

    if (typeof options.temperature === 'number') {
      body.temperature = options.temperature;
    }

    if (
      typeof options.maxTokens === 'number' &&
      this.profile.maxTokensParameter !== 'none'
    ) {
      body[this.profile.maxTokensParameter ?? 'max_tokens'] = options.maxTokens;
    }

    const endpoints = completionEndpoints(this.profile.baseUrl);
    const headers = buildHeaders(this.profile, this.apiKey);

    for (const [index, endpoint] of endpoints.entries()) {
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: options.signal,
        });
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }

        throw new Error(
          `无法连接到模型服务“${this.profile.name}”：${toErrorMessage(error)}`,
        );
      }

      const responseText = await response.text();
      const payload = tryParseJson(responseText);

      if (
        !response.ok &&
        index < endpoints.length - 1 &&
        shouldTryAlternativeEndpoint(response.status)
      ) {
        continue;
      }

      if (!response.ok) {
        const details =
          extractApiError(payload) ||
          responseText.slice(0, 500) ||
          response.statusText;
        throw new Error(
          `模型服务“${this.profile.name}”在 ${endpoint} 返回 HTTP ${response.status}：${details}`,
        );
      }

      const content = extractCompletionText(payload);
      if (!content?.trim()) {
        throw new Error(
          `模型服务“${this.profile.name}”没有返回可用的文本内容。`,
        );
      }

      return content;
    }

    throw new Error(`模型服务“${this.profile.name}”没有可用的 API 端点。`);
  }
}

export function completionEndpoint(baseUrl: string): string {
  return completionEndpoints(baseUrl)[0];
}

export function completionEndpoints(baseUrl: string): string[] {
  const base = normalizeBaseUrl(baseUrl);
  const basePath = trimTrailingSlash(base.pathname);

  if (/\/chat\/completions$/i.test(basePath)) {
    return [createEndpointUrl(base, basePath)];
  }

  if (/\/chat$/i.test(basePath)) {
    return [createEndpointUrl(base, `${basePath}/completions`)];
  }

  const endpointPaths = endsWithVersionSegment(basePath)
    ? [
        joinPath(basePath, 'chat/completions'),
        joinPath(removeVersionSegment(basePath), 'chat/completions'),
      ]
    : [
        joinPath(basePath, 'v1/chat/completions'),
        joinPath(basePath, 'chat/completions'),
      ];

  return [
    ...new Set(endpointPaths.map((path) => createEndpointUrl(base, path))),
  ];
}

export function extractCompletionText(payload: unknown): string | undefined {
  const record = asRecord(payload);
  if (!record) {
    return undefined;
  }

  const choices = record.choices;
  if (Array.isArray(choices)) {
    const firstChoice = asRecord(choices[0]);
    const message = firstChoice && asRecord(firstChoice.message);
    const messageContent = message && extractContent(message.content);
    if (messageContent !== undefined) {
      return messageContent;
    }

    const legacyText = firstChoice && extractContent(firstChoice.text);
    if (legacyText !== undefined) {
      return legacyText;
    }
  }

  return extractContent(record.output_text);
}

function buildHeaders(
  profile: ProviderProfile,
  apiKey?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  for (const [name, value] of Object.entries(profile.headers ?? {})) {
    headers[name] = value.replaceAll(`\${apiKey}`, apiKey ?? '');
  }

  const hasCustomAuth = Object.keys(headers).some((name) => {
    const normalized = name.toLowerCase();
    return (
      normalized === 'authorization' ||
      normalized === 'api-key' ||
      normalized === 'x-api-key'
    );
  });

  if (apiKey && !hasCustomAuth) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

function normalizeBaseUrl(baseUrl: string): URL {
  const value = baseUrl.trim();
  if (!value) {
    throw new Error('API 基地址不能为空。');
  }

  const withProtocol = addProtocol(value);
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error('请输入有效的 API 基地址。');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('API 基地址只支持 http:// 或 https://。');
  }

  if (!url.hostname) {
    throw new Error('API 基地址缺少域名或主机地址。');
  }

  url.hash = '';
  url.pathname = trimTrailingSlash(url.pathname) || '/';
  return url;
}

function addProtocol(value: string): string {
  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  if (/^\/\//.test(value)) {
    return `https:${value}`;
  }

  if (/^https?:/i.test(value) || /^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
    throw new Error('API 基地址协议格式不正确。');
  }

  return `${isLocalHost(value) ? 'http' : 'https'}://${value}`;
}

function isLocalHost(value: string): boolean {
  const authority = value.replace(/^\/\//, '').split(/[/?#]/, 1)[0] ?? '';

  return (
    /^localhost(?::\d+)?$/i.test(authority) ||
    /^127(?:\.\d{1,3}){3}(?::\d+)?$/.test(authority) ||
    /^0\.0\.0\.0(?::\d+)?$/.test(authority) ||
    /^\[?::1\]?(?::\d+)?$/i.test(authority)
  );
}

function trimTrailingSlash(pathname: string): string {
  return pathname.replace(/\/+$/g, '');
}

function endsWithVersionSegment(pathname: string): boolean {
  return /\/v\d+(?:[a-z\d.-]*)?$/i.test(pathname);
}

function removeVersionSegment(pathname: string): string {
  return pathname.replace(/\/v\d+(?:[a-z\d.-]*)?$/i, '');
}

function joinPath(basePath: string, suffix: string): string {
  return `${basePath || ''}/${suffix}`.replace(/\/{2,}/g, '/');
}

function createEndpointUrl(base: URL, pathname: string): string {
  const url = new URL(base.toString());
  url.pathname = pathname || '/';
  return url.toString();
}

function shouldTryAlternativeEndpoint(status: number): boolean {
  return status === 404 || status === 405;
}

function extractContent(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const parts = value.flatMap((part) => {
    if (typeof part === 'string') {
      return [part];
    }

    const record = asRecord(part);
    if (!record) {
      return [];
    }

    if (typeof record.text === 'string') {
      return [record.text];
    }

    if (typeof record.content === 'string') {
      return [record.content];
    }

    return [];
  });

  return parts.length > 0 ? parts.join('') : undefined;
}

function extractApiError(payload: unknown): string | undefined {
  const record = asRecord(payload);
  const error = record && asRecord(record.error);

  if (error && typeof error.message === 'string') {
    return error.message;
  }

  return record && typeof record.message === 'string'
    ? record.message
    : undefined;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
