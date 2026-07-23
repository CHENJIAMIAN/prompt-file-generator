import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  completionEndpoint,
  completionEndpoints,
  extractCompletionText,
  OpenAICompatibleClient,
} from '../src/openaiClient';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAI 兼容响应解析', () => {
  it('补全 Chat Completions 路径', () => {
    expect(completionEndpoint('https://api.example.com/v1/')).toBe(
      'https://api.example.com/v1/chat/completions',
    );
  });

  it('为裸域名自动补 https、/v1 和备用路径', () => {
    expect(completionEndpoints('api.openai.com')).toEqual([
      'https://api.openai.com/v1/chat/completions',
      'https://api.openai.com/chat/completions',
    ]);
  });

  it('为本地服务自动补 http 和 /v1', () => {
    expect(completionEndpoint('localhost:11434')).toBe(
      'http://localhost:11434/v1/chat/completions',
    );
  });

  it('保留已有的 /v1 基地址', () => {
    expect(completionEndpoint('https://api.example.com/openai/v1')).toBe(
      'https://api.example.com/openai/v1/chat/completions',
    );
  });

  it('不会重复补全已有路径', () => {
    expect(
      completionEndpoint('http://localhost:11434/v1/chat/completions'),
    ).toBe('http://localhost:11434/v1/chat/completions');
  });

  it('读取普通 Chat Completions 文本', () => {
    expect(
      extractCompletionText({
        choices: [{ message: { content: '生成内容' } }],
      }),
    ).toBe('生成内容');
  });

  it('读取分段内容响应', () => {
    expect(
      extractCompletionText({
        choices: [
          {
            message: {
              content: [
                { type: 'text', text: '第一段' },
                { type: 'text', text: '第二段' },
              ],
            },
          },
        ],
      }),
    ).toBe('第一段第二段');
  });

  it('按 OpenAI 兼容协议发送模型、鉴权头和最大输出参数', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: '完成' } }] }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new OpenAICompatibleClient(
      {
        id: 'test',
        name: 'Test Provider',
        baseUrl: 'https://api.example.com/v1',
        model: 'test-model',
      },
      'test-key',
    );

    await expect(
      client.complete([{ role: 'user', content: '生成文件' }], {
        maxTokens: 123,
        temperature: 0.2,
      }),
    ).resolves.toBe('完成');

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect(request.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-key',
    });
    expect(JSON.parse(request.body as string)).toMatchObject({
      model: 'test-model',
      max_tokens: 123,
      temperature: 0.2,
      stream: false,
    });
  });

  it('用自定义 api-key 头替代默认 Bearer 鉴权', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: '完成' } }] }),
        {
          status: 200,
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new OpenAICompatibleClient(
      {
        id: 'test',
        name: 'Custom Auth Provider',
        baseUrl: 'https://api.example.com/v1',
        model: 'test-model',
        headers: { 'api-key': `\${apiKey}` },
      },
      'test-key',
    );

    await client.complete([{ role: 'user', content: '生成文件' }]);

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(request.headers).toEqual({
      'Content-Type': 'application/json',
      'api-key': 'test-key',
    });
  });

  it('当自动补出的 /v1 路径返回 404 时回退到无版本路径', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: '完成' } }] }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const client = new OpenAICompatibleClient({
      id: 'fallback',
      name: 'Fallback Provider',
      baseUrl: 'api.example.com',
      model: 'test-model',
    });

    await expect(
      client.complete([{ role: 'user', content: '生成文件' }]),
    ).resolves.toBe('完成');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.example.com/v1/chat/completions',
      'https://api.example.com/chat/completions',
    ]);
  });
});
