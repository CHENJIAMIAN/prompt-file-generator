[中文](./README.md)

# Prompt File Generator

<!-- codex-github-rules:bilingual-summary -->
> **English summary**: Generate prompt-derived files from VS Code Explorer through OpenAI-compatible APIs.

---

This VS Code extension lets you select one or more text files in Explorer, enter a prompt, and generate one derived file beside each source file. It works with any service that supports the OpenAI Chat Completions protocol.

For example, selecting A.ts, B.ts, and C.ts and asking “translate the comments into English” creates files such as:

~~~text
A.translate-en.ai.ts
B.translate-en.ai.ts
C.translate-en.ai.ts
~~~

The extension generates one short tag for the whole batch. If the model cannot create a tag, a safe short tag is extracted from the prompt. Existing files are never overwritten; -2, -3, and later suffixes are added automatically.

## Installation

Search for Prompt File Generator in the VS Code Marketplace, or run:

~~~powershell
code --install-extension CHENJIAMIAN.prompt-file-generator
~~~

You can also download a VSIX package from GitHub Releases for offline installation.

## Configure Model Services

Providers are configured as a JSON array. Run Prompt File Generator: Open Provider JSON Configuration from the Command Palette to write an editable example to the user settings.json:

~~~json
{
  "promptFileGenerator.activeProvider": "openai",
  "promptFileGenerator.providers": [
    {
      "id": "openai",
      "name": "OpenAI",
      "baseUrl": "api.openai.com",
      "model": "gpt-4.1-mini",
      "maxTokensParameter": "max_tokens"
    }
  ]
}
~~~

Change id, name, baseUrl, and model for a compatible service. Multiple objects define multiple services. The Configure Model Service wizard is also available. After entering model information, choose Set API Key (Secure Storage); custom headers are an advanced option for services such as Azure and are normally left empty.

API keys are stored in the VS Code SecretStorage and are not written to settings.json, source code, or logs. Standard OpenAI-compatible services use Authorization: Bearer <API Key>. For services such as Azure that require a different header, add one like:

~~~json
{
  "api-key": "${apiKey}"
}
~~~

The placeholder is replaced at request time with the securely stored value, so the configuration file contains no secret.

Common URL forms are normalized automatically:

- api.openai.com becomes https://api.openai.com/v1/chat/completions, with a fallback to /chat/completions for 404 or 405 responses.
- localhost:11434 and 127.0.0.1:<port> use http:// and receive /v1/chat/completions automatically.
- A supplied /v1 path, custom path, or complete /chat/completions path is not appended twice.

| Service | Example base URL |
| --- | --- |
| OpenAI | api.openai.com or https://api.openai.com/v1 |
| DeepSeek | api.deepseek.com or https://api.deepseek.com/v1 |
| Local Ollama | localhost:11434 or http://localhost:11434/v1 |
| Other compatible services | Their documented Chat Completions base URL |

## Use

1. Select one or more files in VS Code Explorer.
2. Choose Generate New File from Prompt... from the context menu.
3. Enter a request such as “generate matching unit tests” or “turn this configuration into Chinese documentation”.
4. The extension sends each file's content to the selected model and writes the generated file next to the source.

The default output template is <name>.<tag>.ai<ext>:

- <name>: source file name without its extension
- <tag>: one-time short label generated from the prompt
- <ext>: source file extension

Change promptFileGenerator.fileNameTemplate in settings. Keeping <tag> is recommended so the generated file retains its origin.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| promptFileGenerator.maxInputCharacters | 120000 | Maximum input characters per file; larger files are skipped instead of silently truncated |
| promptFileGenerator.providers | OpenAI example array | Editable provider JSON |
| promptFileGenerator.activeProvider | openai | Active provider id |
| promptFileGenerator.maxOutputTokens | 8192 | Maximum output tokens per request |
| promptFileGenerator.temperature | 0.2 | Randomness of conversion |
| promptFileGenerator.concurrency | 2 | Concurrent batch requests |
| promptFileGenerator.fileNameTemplate | <name>.<tag>.ai<ext> | Output filename format |

Only UTF-8 text files are supported; binary files are skipped. Selected file contents and prompts are sent to the configured model service, so follow your organization's data-handling requirements.

## Design

The multi-provider configuration follows Cherry Studio's Provider Registry idea: provider details (URL, authentication headers, and request-parameter differences) are separated from model IDs. The extension implements one general OpenAI Chat Completions adapter instead of duplicating generation logic for each compatible service, while retaining common differences such as max_tokens and custom headers.

## Development

~~~powershell
npm install
npm run compile
npm test
npm run package
~~~

Press F5 to debug in a VS Code Extension Development Host. Tests do not call a real model service.
