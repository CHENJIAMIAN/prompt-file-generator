import * as vscode from 'vscode';

import { configureProvider } from './configuration';
import { type BatchGenerationResult, generateFiles } from './fileGeneration';
import { DEFAULT_FILE_NAME_TEMPLATE } from './naming';
import { OpenAICompatibleClient } from './openaiClient';
import { openProviderJsonConfiguration, ProviderStore } from './providerStore';
import type { GenerationSettings } from './types';

const GENERATE_COMMAND = 'promptFileGenerator.generateFiles';
const CONFIGURE_COMMAND = 'promptFileGenerator.configureProvider';
const SETTINGS_COMMAND = 'promptFileGenerator.openSettings';
const PROVIDER_JSON_COMMAND = 'promptFileGenerator.openProviderJson';

export function activate(context: vscode.ExtensionContext): void {
  const providerStore = new ProviderStore(context.secrets);
  const outputChannel = vscode.window.createOutputChannel(
    vscode.l10n.t('Prompt File Generator'),
  );

  context.subscriptions.push(
    outputChannel,
    vscode.commands.registerCommand(
      GENERATE_COMMAND,
      async (...args: unknown[]) => {
        await handleGenerateCommand(providerStore, outputChannel, args);
      },
    ),
    vscode.commands.registerCommand(CONFIGURE_COMMAND, async () => {
      await configureProvider(providerStore);
    }),
    vscode.commands.registerCommand(SETTINGS_COMMAND, async () => {
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'promptFileGenerator',
      );
    }),
    vscode.commands.registerCommand(PROVIDER_JSON_COMMAND, async () => {
      await openProviderJsonConfiguration();
    }),
  );
}

async function handleGenerateCommand(
  providerStore: ProviderStore,
  outputChannel: vscode.OutputChannel,
  args: readonly unknown[],
): Promise<void> {
  let sourceUris = collectResourceUris(args);
  if (sourceUris.length === 0) {
    sourceUris =
      (await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: true,
        title: vscode.l10n.t('Select source files for prompt-based generation'),
      })) ?? [];
  }

  if (sourceUris.length === 0) {
    return;
  }

  let profile = providerStore.getActiveProfile();
  if (!profile) {
    const configureAction = vscode.l10n.t('Configure Model Provider');
    const action = await vscode.window.showWarningMessage(
      vscode.l10n.t('Configure an OpenAI-compatible model provider first.'),
      configureAction,
    );
    if (action !== configureAction) {
      return;
    }

    await configureProvider(providerStore);
    profile = providerStore.getActiveProfile();
    if (!profile) {
      return;
    }
  }

  const prompt = await vscode.window.showInputBox({
    title: vscode.l10n.t(
      'Generate {0} new files from a prompt',
      sourceUris.length,
    ),
    prompt: vscode.l10n.t(
      'Describe the transformation to apply to each source file',
    ),
    placeHolder: vscode.l10n.t(
      'For example: Translate the content into English while preserving its structure',
    ),
    ignoreFocusOut: true,
    validateInput: (value) =>
      value.trim() ? undefined : vscode.l10n.t('The prompt cannot be empty.'),
  });
  if (prompt === undefined) {
    return;
  }

  const apiKey = await providerStore.getApiKey(profile.id);
  const client = new OpenAICompatibleClient(profile, apiKey);
  const settings = getGenerationSettings();

  outputChannel.appendLine(
    vscode.l10n.t(
      '[{0}] Started processing {1} files. Provider: {2}; model: {3}',
      new Date().toLocaleString(),
      sourceUris.length,
      profile.name,
      profile.model,
    ),
  );

  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: vscode.l10n.t('Prompt File Generator: Generating files'),
      cancellable: true,
    },
    async (progress, token) =>
      generateFiles({
        sourceUris,
        prompt: prompt.trim(),
        client,
        settings,
        token,
        onFileCompleted: (completed, total) => {
          progress.report({
            increment: 100 / Math.max(total, 1),
            message: `${completed}/${total}`,
          });
        },
      }),
  );

  writeResultToOutput(outputChannel, result);
  await showResult(result, outputChannel);
}

function collectResourceUris(args: readonly unknown[]): vscode.Uri[] {
  const uris: vscode.Uri[] = [];
  const seen = new Set<string>();

  const addCandidate = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        addCandidate(item);
      }
      return;
    }

    if (!(candidate instanceof vscode.Uri) || candidate.scheme !== 'file') {
      return;
    }

    const key = candidate.toString();
    if (!seen.has(key)) {
      seen.add(key);
      uris.push(candidate);
    }
  };

  for (const arg of args) {
    addCandidate(arg);
  }

  return uris;
}

function getGenerationSettings(): GenerationSettings {
  const configuration = vscode.workspace.getConfiguration(
    'promptFileGenerator',
  );

  return {
    maxInputCharacters: clamp(
      configuration.get<number>('maxInputCharacters', 120000),
      1000,
      500000,
    ),
    maxOutputTokens: clamp(
      configuration.get<number>('maxOutputTokens', 8192),
      1,
      128000,
    ),
    temperature: clamp(configuration.get<number>('temperature', 0.2), 0, 2),
    concurrency: clamp(
      Math.floor(configuration.get<number>('concurrency', 2)),
      1,
      8,
    ),
    fileNameTemplate: configuration.get<string>(
      'fileNameTemplate',
      DEFAULT_FILE_NAME_TEMPLATE,
    ),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function writeResultToOutput(
  outputChannel: vscode.OutputChannel,
  result: BatchGenerationResult,
): void {
  outputChannel.appendLine(
    vscode.l10n.t(
      'Unified filename tag: {0}{1}',
      result.tag,
      result.usedPromptFallbackTag
        ? vscode.l10n.t(' (generated from prompt fallback)')
        : '',
    ),
  );

  for (const generated of result.generated) {
    outputChannel.appendLine(
      vscode.l10n.t(
        'Generated: {0} -> {1}',
        generated.source.fsPath,
        generated.target.fsPath,
      ),
    );
  }

  for (const failure of result.failures) {
    outputChannel.appendLine(
      vscode.l10n.t('Failed: {0}: {1}', failure.source.fsPath, failure.message),
    );
  }

  if (result.cancelled) {
    outputChannel.appendLine(
      vscode.l10n.t(
        'The task was cancelled. Files written before cancellation were preserved.',
      ),
    );
  }
}

async function showResult(
  result: BatchGenerationResult,
  outputChannel: vscode.OutputChannel,
): Promise<void> {
  const generatedCount = result.generated.length;
  const failedCount = result.failures.length;
  const viewDetails = vscode.l10n.t('View Details');
  const openFirst = vscode.l10n.t('Open First File');

  if (generatedCount === 0) {
    const action = await vscode.window.showErrorMessage(
      result.cancelled
        ? vscode.l10n.t(
            'File generation was cancelled. No new files were written.',
          )
        : failedCount > 0
          ? vscode.l10n.t(
              'No files were generated. {0} files failed.',
              failedCount,
            )
          : vscode.l10n.t('No files were generated.'),
      viewDetails,
    );
    if (action === viewDetails) {
      outputChannel.show(true);
    }
    return;
  }

  const summary = vscode.l10n.t(
    'Generated {0} new files with the unified tag "{1}".',
    generatedCount,
    result.tag,
  );
  const details = result.cancelled
    ? vscode.l10n.t(
        '{0} The operation was cancelled, so the results may be incomplete.',
        summary,
      )
    : failedCount > 0
      ? vscode.l10n.t('{0} Another {1} files failed.', summary, failedCount)
      : summary;
  const action =
    failedCount > 0 || result.cancelled
      ? await vscode.window.showWarningMessage(details, viewDetails, openFirst)
      : await vscode.window.showInformationMessage(details, openFirst);

  if (action === viewDetails) {
    outputChannel.show(true);
  }

  if (action === openFirst) {
    const first = result.generated[0]?.target;
    if (first) {
      const document = await vscode.workspace.openTextDocument(first);
      await vscode.window.showTextDocument(document, { preview: false });
    }
  }
}

export function deactivate(): void {
  // VS Code 会处置已注册的命令和输出通道。
}
