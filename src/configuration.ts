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
        label: vscode.l10n.t('Create Model Provider'),
        detail: vscode.l10n.t('Add an OpenAI-compatible API profile'),
        action: 'create',
      },
      {
        label: vscode.l10n.t('Open Provider JSON Configuration'),
        detail: vscode.l10n.t(
          'Add the default example to settings.json and edit it directly',
        ),
        action: 'openJson',
      },
      {
        label: vscode.l10n.t('Edit Model Provider'),
        detail: vscode.l10n.t(
          'Change the URL, model, request headers, or API key',
        ),
        action: 'edit',
      },
      {
        label: vscode.l10n.t('Set as Default Provider'),
        detail: vscode.l10n.t(
          'Use this profile by default when generating from Explorer',
        ),
        action: 'setDefault',
      },
      {
        label: vscode.l10n.t('Test Model Provider'),
        detail: vscode.l10n.t('Send a very short test request'),
        action: 'test',
      },
      {
        label: vscode.l10n.t('Clear Provider API Key'),
        detail: vscode.l10n.t('Delete only the key stored in SecretStorage'),
        action: 'clearKey',
      },
      {
        label: vscode.l10n.t('Delete Model Provider'),
        detail: vscode.l10n.t(
          'Delete the profile and its API key from SecretStorage',
        ),
        action: 'delete',
      },
    ],
    {
      title: vscode.l10n.t('Prompt File Generator: Model Providers'),
      placeHolder: vscode.l10n.t('Select an action'),
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
      vscode.l10n.t('Set "{0}" as the default model provider.', profile.name),
    );
    return;
  }

  if (action.action === 'test') {
    await testProfile(store, profile);
    return;
  }

  if (action.action === 'clearKey') {
    const clearAction = vscode.l10n.t('Clear');
    const confirmation = await vscode.window.showWarningMessage(
      vscode.l10n.t('Clear the API key for "{0}"?', profile.name),
      { modal: true },
      clearAction,
    );
    if (confirmation === clearAction) {
      await store.clearApiKey(profile.id);
      void vscode.window.showInformationMessage(
        vscode.l10n.t('Cleared the API key for "{0}".', profile.name),
      );
    }
    return;
  }

  const deleteAction = vscode.l10n.t('Delete');
  const confirmation = await vscode.window.showWarningMessage(
    vscode.l10n.t('Delete "{0}" and its API key?', profile.name),
    { modal: true },
    deleteAction,
  );
  if (confirmation === deleteAction) {
    await store.removeProfile(profile.id);
    void vscode.window.showInformationMessage(
      vscode.l10n.t('Deleted "{0}".', profile.name),
    );
  }
}

async function createOrEditProfile(
  store: ProviderStore,
  existing?: ProviderProfile,
): Promise<void> {
  const name = await vscode.window.showInputBox({
    title: existing
      ? vscode.l10n.t('Edit Model Provider')
      : vscode.l10n.t('Create Model Provider'),
    prompt: vscode.l10n.t('Provider display name'),
    value: existing?.name ?? '',
    validateInput: validateRequiredText,
  });
  if (name === undefined) {
    return;
  }

  const baseUrl = await vscode.window.showInputBox({
    title: existing
      ? vscode.l10n.t('Edit Model Provider')
      : vscode.l10n.t('Create Model Provider'),
    prompt: vscode.l10n.t('OpenAI Chat Completions API base URL'),
    value: existing?.baseUrl ?? 'api.openai.com',
    placeHolder: vscode.l10n.t(
      'For example: api.openai.com, localhost:11434, or a complete API URL',
    ),
    validateInput: validateBaseUrl,
  });
  if (baseUrl === undefined) {
    return;
  }

  const model = await vscode.window.showInputBox({
    title: existing
      ? vscode.l10n.t('Edit Model Provider')
      : vscode.l10n.t('Create Model Provider'),
    prompt: vscode.l10n.t('Model ID'),
    value: existing?.model ?? '',
    placeHolder: vscode.l10n.t('For example: gpt-4.1-mini'),
    validateInput: validateRequiredText,
  });
  if (model === undefined) {
    return;
  }

  const apiKey = await vscode.window.showInputBox({
    title: existing
      ? vscode.l10n.t('Update API Key (SecretStorage)')
      : vscode.l10n.t('Set API Key (SecretStorage)'),
    prompt: existing
      ? vscode.l10n.t(
          'Enter the API key here. Leave it empty to keep the existing key; use "Clear Provider API Key" to delete it separately.',
        )
      : vscode.l10n.t(
          'Enter the API key here. Leave it empty for local providers without authentication. The key is never written to settings.json.',
        ),
    placeHolder: vscode.l10n.t(
      'For example: sk-... or the API key supplied by the provider',
    ),
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
    title: existing
      ? vscode.l10n.t('Edit Model Provider')
      : vscode.l10n.t('Create Model Provider'),
    prompt: vscode.l10n.t(
      'Advanced: custom request headers as JSON (leave empty for most providers)',
    ),
    value: existing?.headers ? JSON.stringify(existing.headers) : '',
    placeHolder: vscode.l10n.t(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: ${apiKey} is a literal SecretStorage placeholder.
      'Usually empty. Example for Azure-style authentication: {"api-key":"${apiKey}"}',
    ),
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
      ? vscode.l10n.t('Updated model provider "{0}".', profile.name)
      : vscode.l10n.t('Created model provider "{0}".', profile.name),
  );
}

async function chooseProfile(
  store: ProviderStore,
  title: string,
): Promise<ProviderProfile | undefined> {
  const profiles = store.getProfiles();
  if (profiles.length === 0) {
    void vscode.window.showWarningMessage(
      vscode.l10n.t(
        'No model providers exist yet. Select "Create Model Provider" first.',
      ),
    );
    return undefined;
  }

  const activeId = store.getActiveProviderId();
  const selection = await vscode.window.showQuickPick<ProviderQuickPickItem>(
    profiles.map((profile) => ({
      label: profile.name,
      description: profile.model,
      detail: `${profile.baseUrl}${profile.id === activeId ? vscode.l10n.t(' (default)') : ''}`,
      profile,
    })),
    {
      title,
      placeHolder: vscode.l10n.t('Select a model provider profile'),
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
      description: vscode.l10n.t('Used by most OpenAI-compatible providers'),
      value: 'max_tokens',
    },
    {
      label: 'max_completion_tokens',
      description: vscode.l10n.t('Used by some newer OpenAI-compatible models'),
      value: 'max_completion_tokens',
    },
    {
      label: vscode.l10n.t('Do not send a maximum output parameter'),
      description: vscode.l10n.t(
        'Use when the provider does not accept a max_tokens-style field',
      ),
      value: 'none',
    },
  ];

  const selected = await vscode.window.showQuickPick(choices, {
    title: vscode.l10n.t('Maximum Output Parameter'),
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
        title: vscode.l10n.t('Testing model provider "{0}"', profile.name),
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
      vscode.l10n.t(
        'Model provider "{0}" connected successfully.',
        profile.name,
      ),
    );
  } catch (error) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t('Model provider test failed: {0}', toErrorMessage(error)),
    );
  }
}

function validateRequiredText(value: string): string | undefined {
  return value.trim() ? undefined : vscode.l10n.t('This field is required.');
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
    throw new Error(
      vscode.l10n.t('Request headers must be a valid JSON object.'),
    );
  }

  if (!isRecord(parsed)) {
    throw new Error(vscode.l10n.t('Request headers must be a JSON object.'));
  }

  const headers: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(parsed)) {
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) {
      throw new Error(
        vscode.l10n.t('Invalid request header name: "{0}".', name),
      );
    }
    if (typeof headerValue !== 'string') {
      throw new Error(
        vscode.l10n.t(
          'The value of request header "{0}" must be a string.',
          name,
        ),
      );
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
