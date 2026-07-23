import * as vscode from 'vscode';

import type { MaxTokensParameter, ProviderProfile } from './types';

const CONFIG_SECTION = 'promptFileGenerator';
const PROVIDERS_KEY = 'providers';
const ACTIVE_PROVIDER_KEY = 'activeProvider';
const SECRET_PREFIX = 'prompt-file-generator.api-key.';

interface ConfigurationInspection<T> {
  globalValue?: T;
  workspaceValue?: T;
  workspaceFolderValue?: T;
}

export const DEFAULT_PROVIDER_PROFILES: readonly ProviderProfile[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'api.openai.com',
    model: 'gpt-4.1-mini',
    maxTokensParameter: 'max_tokens',
  },
];

export const DEFAULT_ACTIVE_PROVIDER_ID = 'openai';

export class ProviderStore {
  public constructor(private readonly secrets: vscode.SecretStorage) {}

  public getProfiles(): ProviderProfile[] {
    const rawProfiles = vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<unknown[]>(PROVIDERS_KEY, []);

    return rawProfiles.flatMap((rawProfile) => {
      const profile = readProfile(rawProfile);
      return profile ? [profile] : [];
    });
  }

  public getActiveProviderId(): string {
    return vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<string>(ACTIVE_PROVIDER_KEY, '');
  }

  public getActiveProfile(): ProviderProfile | undefined {
    const activeId = this.getActiveProviderId();
    return this.getProfiles().find((profile) => profile.id === activeId);
  }

  public async getApiKey(profileId: string): Promise<string | undefined> {
    return this.secrets.get(this.secretKey(profileId));
  }

  public async setApiKey(profileId: string, apiKey: string): Promise<void> {
    await this.secrets.store(this.secretKey(profileId), apiKey);
  }

  public async clearApiKey(profileId: string): Promise<void> {
    await this.secrets.delete(this.secretKey(profileId));
  }

  public async upsertProfile(profile: ProviderProfile): Promise<void> {
    const profiles = this.getProfiles();
    const index = profiles.findIndex((current) => current.id === profile.id);

    if (index === -1) {
      profiles.push(profile);
    } else {
      profiles[index] = profile;
    }

    await this.saveProfiles(profiles);
  }

  public async removeProfile(profileId: string): Promise<void> {
    const profiles = this.getProfiles().filter(
      (profile) => profile.id !== profileId,
    );
    await this.saveProfiles(profiles);
    await this.clearApiKey(profileId);

    if (this.getActiveProviderId() === profileId) {
      await this.setActiveProvider(profiles[0]?.id ?? '');
    }
  }

  public async setActiveProvider(profileId: string): Promise<void> {
    await vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .update(
        ACTIVE_PROVIDER_KEY,
        profileId,
        vscode.ConfigurationTarget.Global,
      );
  }

  private async saveProfiles(profiles: ProviderProfile[]): Promise<void> {
    await vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .update(PROVIDERS_KEY, profiles, vscode.ConfigurationTarget.Global);
  }

  private secretKey(profileId: string): string {
    return `${SECRET_PREFIX}${profileId}`;
  }
}

export function createProviderId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);

  return `${slug || 'provider'}-${Date.now().toString(36)}`;
}

export async function openProviderJsonConfiguration(): Promise<void> {
  const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const providersInspection = configuration.inspect<unknown[]>(PROVIDERS_KEY);
  const activeProviderInspection =
    configuration.inspect<string>(ACTIVE_PROVIDER_KEY);

  if (!hasExplicitValue(providersInspection)) {
    await configuration.update(
      PROVIDERS_KEY,
      DEFAULT_PROVIDER_PROFILES.map((profile) => ({ ...profile })),
      vscode.ConfigurationTarget.Global,
    );
  }

  if (!hasExplicitValue(activeProviderInspection)) {
    await configuration.update(
      ACTIVE_PROVIDER_KEY,
      DEFAULT_ACTIVE_PROVIDER_ID,
      vscode.ConfigurationTarget.Global,
    );
  }

  await vscode.commands.executeCommand('workbench.action.openSettingsJson');
}

function readProfile(value: unknown): ProviderProfile | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = readNonEmptyString(value.id);
  const name = readNonEmptyString(value.name);
  const baseUrl = readNonEmptyString(value.baseUrl);
  const model = readNonEmptyString(value.model);

  if (!id || !name || !baseUrl || !model) {
    return undefined;
  }

  return {
    id,
    name,
    baseUrl,
    model,
    maxTokensParameter: readMaxTokensParameter(value.maxTokensParameter),
    headers: readHeaders(value.headers),
  };
}

function readMaxTokensParameter(
  value: unknown,
): MaxTokensParameter | undefined {
  if (
    value === 'max_tokens' ||
    value === 'max_completion_tokens' ||
    value === 'none'
  ) {
    return value;
  }

  return undefined;
}

function readHeaders(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const headers: Record<string, string> = {};
  for (const [key, headerValue] of Object.entries(value)) {
    if (typeof headerValue === 'string' && key.trim()) {
      headers[key] = headerValue;
    }
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const text = value.trim();
  return text || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExplicitValue<T>(
  inspection: ConfigurationInspection<T> | undefined,
): boolean {
  return Boolean(
    inspection &&
      (inspection.globalValue !== undefined ||
        inspection.workspaceValue !== undefined ||
        inspection.workspaceFolderValue !== undefined),
  );
}
