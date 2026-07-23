export const DEFAULT_FILE_NAME_TEMPLATE = `\${name}.\${tag}.ai\${ext}`;

const MAX_TAG_LENGTH = 24;
const MAX_FILE_NAME_LENGTH = 180;
// biome-ignore lint/suspicious/noControlCharactersInRegex: Windows 文件名不能包含控制字符。
const INVALID_FILE_NAME_CHARACTERS = /[\u0000-\u001F<>:"/\\|?*]+/g;

export function createFallbackTag(prompt: string): string {
  return normalizeTag(prompt) || 'generated';
}

export function normalizeGeneratedTag(value: string, fallback: string): string {
  const firstLine = value.trim().split(/\r?\n/, 1)[0] ?? '';
  return normalizeTag(firstLine) || fallback;
}

export function renderOutputFileName(
  sourceFileName: string,
  tag: string,
  template: string,
): string {
  const { name, ext } = splitExtension(sourceFileName);
  const selectedTemplate = template.trim() || DEFAULT_FILE_NAME_TEMPLATE;
  const rendered = selectedTemplate.replace(
    /\$\{(name|tag|ext)\}/g,
    (_match, token) => {
      if (token === 'name') {
        return name;
      }

      if (token === 'tag') {
        return tag;
      }

      return ext;
    },
  );

  const safeName = sanitizeFileName(rendered);
  if (!safeName || safeName === sourceFileName) {
    return sanitizeFileName(`${name}.${tag}.ai${ext}`) || `generated.${tag}.ai`;
  }

  return limitFileName(safeName);
}

function normalizeTag(value: string): string {
  const normalized = value
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return Array.from(normalized)
    .slice(0, MAX_TAG_LENGTH)
    .join('')
    .replace(/-+$/g, '');
}

function splitExtension(fileName: string): { name: string; ext: string } {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0) {
    return { name: fileName, ext: '' };
  }

  return {
    name: fileName.slice(0, dotIndex),
    ext: fileName.slice(dotIndex),
  };
}

function sanitizeFileName(value: string): string {
  return value
    .replace(INVALID_FILE_NAME_CHARACTERS, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
}

function limitFileName(fileName: string): string {
  if (Array.from(fileName).length <= MAX_FILE_NAME_LENGTH) {
    return fileName;
  }

  const { name, ext } = splitExtension(fileName);
  const availableNameLength = Math.max(
    1,
    MAX_FILE_NAME_LENGTH - Array.from(ext).length,
  );
  return `${Array.from(name).slice(0, availableNameLength).join('')}${ext}`;
}
