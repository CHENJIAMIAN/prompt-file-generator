# Changelog

> [中文](CHANGELOG.md)

## 0.2.2 - 2026-07-28

- Completed English and Simplified Chinese localization for the extension
  manifest, configuration wizard, notifications, error messages, and output log.
- Added runtime language packs and VS Code module test doubles, restoring unit
  test coverage for the OpenAI client.

## 0.2.1

- Reordered the configuration wizard: enter the real API key before showing
  advanced custom request headers, preventing confusion between secure keys and
  JSON request headers.

## 0.2.0

- Provider configuration is now directly editable JSON and includes a default
  OpenAI example that can be written to `settings.json`.
- API addresses support bare domain names, omitted protocols, local addresses,
  missing `/v1`, custom paths, and full Chat Completions endpoints.
- When an automatically completed versioned path returns HTTP 404 or 405, the
  extension automatically tries an unversioned fallback path.

## 0.1.0

- Supports generating new files in batches from prompts after right-clicking one
  or more files in the Explorer.
- Supports OpenAI Chat Completions-compatible APIs, multiple profiles, model
  switching, and custom request headers.
- Stores API keys in VS Code secure storage rather than settings files.
- Uses consistent, concise output filenames that reflect prompt semantics.
- Supports concurrency control, cancellation, conflicting-name avoidance, and
  detailed failed-item output.
