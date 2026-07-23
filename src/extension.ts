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
  const outputChannel = vscode.window.createOutputChannel('提示词文件生成器');

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
        title: '选择要根据提示词生成新文件的源文件',
      })) ?? [];
  }

  if (sourceUris.length === 0) {
    return;
  }

  let profile = providerStore.getActiveProfile();
  if (!profile) {
    const action = await vscode.window.showWarningMessage(
      '请先配置一个 OpenAI 兼容的模型服务。',
      '配置模型服务',
    );
    if (action !== '配置模型服务') {
      return;
    }

    await configureProvider(providerStore);
    profile = providerStore.getActiveProfile();
    if (!profile) {
      return;
    }
  }

  const prompt = await vscode.window.showInputBox({
    title: `根据提示词生成 ${sourceUris.length} 个新文件`,
    prompt: '描述要基于每个源文件完成的转换',
    placeHolder: '例如：将内容翻译成英文，并保持原有结构',
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() ? undefined : '提示词不能为空。'),
  });
  if (prompt === undefined) {
    return;
  }

  const apiKey = await providerStore.getApiKey(profile.id);
  const client = new OpenAICompatibleClient(profile, apiKey);
  const settings = getGenerationSettings();

  outputChannel.appendLine(
    `[${new Date().toLocaleString()}] 开始处理 ${sourceUris.length} 个文件，服务：${profile.name}，模型：${profile.model}`,
  );

  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: '提示词文件生成器：正在生成文件',
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
    `统一文件名标签：${result.tag}${result.usedPromptFallbackTag ? '（由提示词回退生成）' : ''}`,
  );

  for (const generated of result.generated) {
    outputChannel.appendLine(
      `已生成：${generated.source.fsPath} -> ${generated.target.fsPath}`,
    );
  }

  for (const failure of result.failures) {
    outputChannel.appendLine(
      `失败：${failure.source.fsPath}：${failure.message}`,
    );
  }

  if (result.cancelled) {
    outputChannel.appendLine('任务已取消，已保留取消前成功写入的文件。');
  }
}

async function showResult(
  result: BatchGenerationResult,
  outputChannel: vscode.OutputChannel,
): Promise<void> {
  const generatedCount = result.generated.length;
  const failedCount = result.failures.length;

  if (generatedCount === 0) {
    const action = await vscode.window.showErrorMessage(
      result.cancelled
        ? '文件生成已取消，未写入新文件。'
        : `没有生成文件。${failedCount > 0 ? `有 ${failedCount} 个文件失败。` : ''}`,
      '查看详情',
    );
    if (action === '查看详情') {
      outputChannel.show(true);
    }
    return;
  }

  const summary = `已生成 ${generatedCount} 个新文件，统一标签为“${result.tag}”。`;
  const details = result.cancelled
    ? `${summary} 操作已取消，结果可能不完整。`
    : failedCount > 0
      ? `${summary} 另有 ${failedCount} 个文件失败。`
      : summary;
  const action =
    failedCount > 0 || result.cancelled
      ? await vscode.window.showWarningMessage(
          details,
          '查看详情',
          '打开第一个',
        )
      : await vscode.window.showInformationMessage(details, '打开第一个');

  if (action === '查看详情') {
    outputChannel.show(true);
  }

  if (action === '打开第一个') {
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
