import * as vscode from 'vscode';

import { completionEndpoint, OpenAICompatibleClient } from './openaiClient';
import {
  createProviderId,
  openProviderJsonConfiguration,
  type ProviderStore,
} from './providerStore';
import type { MaxTokensParameter, ProviderProfile } from './types';

type ConfigurationAction =
  | 'create'
  | 'openJson'
  | 'edit'
  | 'setDefault'
  | 'test'
  | 'clearKey'
  | 'delete';

interface ConfigurationActionItem extends vscode.QuickPickItem {
  action: ConfigurationAction;
}

interface ProviderQuickPickItem extends vscode.QuickPickItem {
  profile: ProviderProfile;
}

export async function configureProvider(store: ProviderStore): Promise<void> {
  const action = await vscode.window.showQuickPick<ConfigurationActionItem>(
    [
      {
        label: '新建模型服务',
        detail: '添加一个 OpenAI 兼容 API 配置档',
        action: 'create',
      },
      {
        label: '打开提供商 JSON 配置',
        detail: '写入默认示例到 settings.json 后直接编辑',
        action: 'openJson',
      },
      {
        label: '编辑模型服务',
        detail: '修改地址、模型、请求头或 API Key',
        action: 'edit',
      },
      {
        label: '设为默认服务',
        detail: '右键生成时默认使用的配置档',
        action: 'setDefault',
      },
      {
        label: '测试模型服务',
        detail: '发送一条极短的测试请求',
        action: 'test',
      },
      {
        label: '清除服务 API Key',
        detail: '仅删除安全存储中的密钥',
        action: 'clearKey',
      },
      {
        label: '删除模型服务',
        detail: '删除配置档及其安全存储中的 API Key',
        action: 'delete',
      },
    ],
    {
      title: '提示词文件生成器：模型服务',
      placeHolder: '选择要执行的操作',
    },
  );

  if (!action) {
    return;
  }

  if (action.action === 'create') {
    await createOrEditProfile(store);
    return;
  }

  if (action.action === 'openJson') {
    await openProviderJsonConfiguration();
    return;
  }

  const profile = await chooseProfile(store, action.label);
  if (!profile) {
    return;
  }

  if (action.action === 'edit') {
    await createOrEditProfile(store, profile);
    return;
  }

  if (action.action === 'setDefault') {
    await store.setActiveProvider(profile.id);
    void vscode.window.showInformationMessage(
      `已将“${profile.name}”设为默认模型服务。`,
    );
    return;
  }

  if (action.action === 'test') {
    await testProfile(store, profile);
    return;
  }

  if (action.action === 'clearKey') {
    const confirmation = await vscode.window.showWarningMessage(
      `确定清除“${profile.name}”的 API Key 吗？`,
      { modal: true },
      '清除',
    );
    if (confirmation === '清除') {
      await store.clearApiKey(profile.id);
      void vscode.window.showInformationMessage(
        `已清除“${profile.name}”的 API Key。`,
      );
    }
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    `确定删除“${profile.name}”及其 API Key 吗？`,
    { modal: true },
    '删除',
  );
  if (confirmation === '删除') {
    await store.removeProfile(profile.id);
    void vscode.window.showInformationMessage(`已删除“${profile.name}”。`);
  }
}

async function createOrEditProfile(
  store: ProviderStore,
  existing?: ProviderProfile,
): Promise<void> {
  const name = await vscode.window.showInputBox({
    title: existing ? '编辑模型服务' : '新建模型服务',
    prompt: '服务显示名称',
    value: existing?.name ?? '',
    validateInput: validateRequiredText,
  });
  if (name === undefined) {
    return;
  }

  const baseUrl = await vscode.window.showInputBox({
    title: existing ? '编辑模型服务' : '新建模型服务',
    prompt: 'OpenAI Chat Completions API 基地址',
    value: existing?.baseUrl ?? 'api.openai.com',
    placeHolder: '例如 api.openai.com、localhost:11434 或完整 API 地址',
    validateInput: validateBaseUrl,
  });
  if (baseUrl === undefined) {
    return;
  }

  const model = await vscode.window.showInputBox({
    title: existing ? '编辑模型服务' : '新建模型服务',
    prompt: '模型 ID',
    value: existing?.model ?? '',
    placeHolder: '例如 gpt-4.1-mini',
    validateInput: validateRequiredText,
  });
  if (model === undefined) {
    return;
  }

  const apiKey = await vscode.window.showInputBox({
    title: existing ? '更新 API Key（安全存储）' : '设置 API Key（安全存储）',
    prompt: existing
      ? '在这里输入真实 API Key。留空会保留原有密钥；可通过“清除服务 API Key”单独删除。'
      : '在这里输入真实 API Key。本地无鉴权服务可留空；密钥不会写入 settings.json。',
    placeHolder: '例如 sk-... 或服务商提供的 API Key',
    password: true,
    ignoreFocusOut: true,
  });
  if (apiKey === undefined) {
    return;
  }

  const maxTokensParameter = await chooseMaxTokensParameter(
    existing?.maxTokensParameter,
  );
  if (!maxTokensParameter) {
    return;
  }

  const headerJson = await vscode.window.showInputBox({
    title: existing ? '编辑模型服务' : '新建模型服务',
    prompt: '高级选项：自定义请求头 JSON（大多数服务留空）',
    value: existing?.headers ? JSON.stringify(existing.headers) : '',
    placeHolder: `一般留空；Azure 等特殊鉴权示例：{"api-key":"\${apiKey}"}`,
    validateInput: validateHeaders,
  });
  if (headerJson === undefined) {
    return;
  }

  const profile: ProviderProfile = {
    id: existing?.id ?? createProviderId(name),
    name: name.trim(),
    baseUrl: baseUrl.trim(),
    model: model.trim(),
    maxTokensParameter,
    headers: parseHeaders(headerJson),
  };

  await store.upsertProfile(profile);
  if (apiKey.trim()) {
    await store.setApiKey(profile.id, apiKey.trim());
  }

  if (!store.getActiveProfile()) {
    await store.setActiveProvider(profile.id);
  }

  void vscode.window.showInformationMessage(
    existing
      ? `已更新模型服务“${profile.name}”。`
      : `已创建模型服务“${profile.name}”。`,
  );
}

async function chooseProfile(
  store: ProviderStore,
  title: string,
): Promise<ProviderProfile | undefined> {
  const profiles = store.getProfiles();
  if (profiles.length === 0) {
    void vscode.window.showWarningMessage(
      '还没有模型服务，请先选择“新建模型服务”。',
    );
    return undefined;
  }

  const activeId = store.getActiveProviderId();
  const selection = await vscode.window.showQuickPick<ProviderQuickPickItem>(
    profiles.map((profile) => ({
      label: profile.name,
      description: profile.model,
      detail: `${profile.baseUrl}${profile.id === activeId ? '（默认）' : ''}`,
      profile,
    })),
    {
      title,
      placeHolder: '选择模型服务配置档',
    },
  );

  return selection?.profile;
}

async function chooseMaxTokensParameter(
  current?: MaxTokensParameter,
): Promise<MaxTokensParameter | undefined> {
  const choices: Array<vscode.QuickPickItem & { value: MaxTokensParameter }> = [
    {
      label: 'max_tokens',
      description: '大多数 OpenAI 兼容服务使用此字段',
      value: 'max_tokens',
    },
    {
      label: 'max_completion_tokens',
      description: '部分较新的 OpenAI 兼容模型使用此字段',
      value: 'max_completion_tokens',
    },
    {
      label: '不发送最大输出参数',
      description: '服务不接受 max_tokens 类字段时使用',
      value: 'none',
    },
  ];

  const selected = await vscode.window.showQuickPick(choices, {
    title: '最大输出参数',
    placeHolder: current ?? 'max_tokens',
  });

  return selected?.value;
}

async function testProfile(
  store: ProviderStore,
  profile: ProviderProfile,
): Promise<void> {
  const apiKey = await store.getApiKey(profile.id);
  const client = new OpenAICompatibleClient(profile, apiKey);

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `正在测试模型服务“${profile.name}”`,
        cancellable: true,
      },
      async (_progress, token) => {
        const controller = new AbortController();
        const subscription = token.onCancellationRequested(() =>
          controller.abort(),
        );
        try {
          await client.complete(
            [
              {
                role: 'user',
                content: 'Reply with exactly: OK',
              },
            ],
            { maxTokens: 8, temperature: 0, signal: controller.signal },
          );
        } finally {
          subscription.dispose();
        }
      },
    );
    void vscode.window.showInformationMessage(
      `模型服务“${profile.name}”连接成功。`,
    );
  } catch (error) {
    void vscode.window.showErrorMessage(
      `模型服务测试失败：${toErrorMessage(error)}`,
    );
  }
}

function validateRequiredText(value: string): string | undefined {
  return value.trim() ? undefined : '此项不能为空。';
}

function validateBaseUrl(value: string): string | undefined {
  try {
    completionEndpoint(value);
  } catch (error) {
    return toErrorMessage(error);
  }

  return undefined;
}

function validateHeaders(value: string): string | undefined {
  try {
    parseHeaders(value);
    return undefined;
  } catch (error) {
    return toErrorMessage(error);
  }
}

function parseHeaders(value: string): Record<string, string> | undefined {
  if (!value.trim()) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error('请求头必须是有效的 JSON 对象。');
  }

  if (!isRecord(parsed)) {
    throw new Error('请求头必须是 JSON 对象。');
  }

  const headers: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(parsed)) {
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) {
      throw new Error(`请求头名称“${name}”无效。`);
    }
    if (typeof headerValue !== 'string') {
      throw new Error(`请求头“${name}”的值必须是字符串。`);
    }
    headers[name] = headerValue;
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
