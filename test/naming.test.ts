import { describe, expect, it } from 'vitest';

import {
  createFallbackTag,
  DEFAULT_FILE_NAME_TEMPLATE,
  normalizeGeneratedTag,
  renderOutputFileName,
} from '../src/naming';

describe('文件名标签', () => {
  it('保留简短的中文提示词含义', () => {
    expect(createFallbackTag('翻译成英文')).toBe('翻译成英文');
  });

  it('清理模型返回的引号与换行说明', () => {
    expect(
      normalizeGeneratedTag('"translate-en"\n不要使用其他内容', 'fallback'),
    ).toBe('translate-en');
  });

  it('保留源文件扩展名并追加统一 AI 后缀', () => {
    expect(
      renderOutputFileName(
        'component.test.ts',
        'translate-en',
        DEFAULT_FILE_NAME_TEMPLATE,
      ),
    ).toBe('component.test.translate-en.ai.ts');
  });

  it('过滤不安全的标签字符', () => {
    const tag = normalizeGeneratedTag('../release notes', 'fallback');
    expect(tag).toBe('release-notes');
    expect(renderOutputFileName('A.txt', tag, `\${name}.\${tag}\${ext}`)).toBe(
      'A.release-notes.txt',
    );
  });
});
