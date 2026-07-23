# 提示词文件生成器

一个 VS Code 扩展：在资源管理器中选中一个或多个文本文件，右键输入提示词，为每个源文件生成一份新文件。它使用任意支持 OpenAI Chat Completions 协议的模型服务。

例如同时选中 `A.ts`、`B.ts`、`C.ts` 并输入“将注释翻译成英文”，会在各自目录生成类似：

```text
A.translate-en.ai.ts
B.translate-en.ai.ts
C.translate-en.ai.ts
```

短标签在整个批次中一致，能简短表达提示词含义；如标签请求失败，会从提示词安全地提取短标签作为回退。已有同名文件不会被覆盖，而是自动追加 `-2`、`-3` 等序号。

## 安装

在 VS Code 扩展市场搜索“提示词文件生成器”，或运行：

```powershell
code --install-extension CHENJIAMIAN.prompt-file-generator
```

也可以从 GitHub Releases 下载 `.vsix` 离线安装包。

## 配置模型服务

提供商以 JSON 数组配置。运行命令面板中的 `提示词文件生成器: 打开提供商 JSON 配置` 后，扩展会在 User `settings.json` 写入以下可直接编辑的默认示例：

```jsonc
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
```

将 `id`、`name`、`baseUrl`、`model` 改成目标兼容服务的值即可；多个对象就是多个服务。也保留了 `提示词文件生成器: 配置模型服务...` 向导：模型信息后会先出现“设置 API Key（安全存储）”，这正是输入真实密钥的位置；其后的自定义请求头是 Azure 等特殊服务的高级选项，大多数服务保持为空。

API Key 存在 VS Code `SecretStorage`，不写入 `settings.json`、插件源码或生成的日志。普通 OpenAI 兼容服务会自动使用 `Authorization: Bearer <API Key>`。对于 Azure 等要求特殊鉴权头的服务，可填写自定义请求头：

```json
{
  "api-key": "${apiKey}"
}
```

`${apiKey}` 会在请求时替换为安全存储中的值，因此配置文件本身不含密钥。

URL 会自动处理常见的省略写法：

- `api.openai.com` 自动按 `https://api.openai.com/v1/chat/completions` 请求；如果该路径返回 404 或 405，会回退尝试 `/chat/completions`。
- `localhost:11434`、`127.0.0.1:端口` 自动使用 `http://` 并补 `/v1/chat/completions`。
- 已填写 `/v1`、自定义路径或完整 `/chat/completions` 时不会重复追加路径。

常见基地址示例：

| 服务 | 基地址示例 |
| --- | --- |
| OpenAI | `api.openai.com` 或 `https://api.openai.com/v1` |
| DeepSeek | `api.deepseek.com` 或 `https://api.deepseek.com/v1` |
| 本地 Ollama | `localhost:11434` 或 `http://localhost:11434/v1` |
| 其他兼容服务 | 使用其文档给出的 Chat Completions 基地址（无需额外写 `/chat/completions`） |

## 使用方式

1. 在 VS Code 资源管理器中选中一个或多个文件。
2. 右键选择 `根据提示词生成新文件...`。
3. 输入转换要求，例如“生成对应的单元测试”或“把此配置转换为中文说明”。
4. 扩展分别把每个文件的内容发给所选模型，并在源文件所在目录写入新文件。

默认命名模板是 `${name}.${tag}.ai${ext}`：

- `${name}`：原文件主名
- `${tag}`：由提示词生成的一次性短标签
- `${ext}`：原文件扩展名

可在设置中修改 `promptFileGenerator.fileNameTemplate`。建议始终保留 `${tag}`，避免生成文件失去来源语义。

## 设置

| 设置 | 默认值 | 作用 |
| --- | --- | --- |
| `promptFileGenerator.maxInputCharacters` | `120000` | 单个文件最大输入字符数；超过时跳过，不会静默截断。 |
| `promptFileGenerator.providers` | OpenAI 示例数组 | 可直接在 `settings.json` 编辑的 LLM 提供商 JSON。 |
| `promptFileGenerator.activeProvider` | `openai` | 当前使用的 JSON 配置档 ID。 |
| `promptFileGenerator.maxOutputTokens` | `8192` | 单个生成请求的最大输出 token 数。 |
| `promptFileGenerator.temperature` | `0.2` | 文件转换的随机性。 |
| `promptFileGenerator.concurrency` | `2` | 批量请求并发数。 |
| `promptFileGenerator.fileNameTemplate` | `${name}.${tag}.ai${ext}` | 输出文件命名格式。 |

仅支持 UTF-8 文本文件；二进制文件会被跳过。生成时，所选文件内容和提示词会发送到你配置的模型服务，请按组织的数据处理要求使用。

## 设计取舍

多提供商配置方式参考了 Cherry Studio 的 Provider Registry 思路：将提供商配置（地址、鉴权头、请求参数差异）与模型 ID 分离，并允许用户自定义配置覆盖默认行为。本扩展只实现一个通用的 OpenAI Chat Completions 适配器，避免为每家兼容服务复制生成逻辑，同时保留 `max_tokens` 参数和自定义请求头等常见差异点。

## 开发

```powershell
npm install
npm run compile
npm test
npm run package
```

按 `F5` 可在 VS Code Extension Development Host 中调试。测试不调用任何真实模型服务。
