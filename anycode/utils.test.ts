import { describe, it, expect } from 'vitest';
import {
  uriToFilePath,
  normalizePath,
  getFileName,
  getParentPath,
  joinPath,
  getLanguageFromFileName,
} from './utils';

describe('uriToFilePath', () => {
  it('handles standard Unix/macOS file URIs', () => {
    expect(uriToFilePath('file:///Users/max/dev/anycode/App.tsx')).toBe('/Users/max/dev/anycode/App.tsx');
    expect(uriToFilePath('file:///etc/hosts')).toBe('/etc/hosts');
  });

  it('handles canonical Windows file URIs with 3 slashes', () => {
    expect(uriToFilePath('file:///C:/Users/max/project/Program.cs')).toBe('C:/Users/max/project/Program.cs');
    expect(uriToFilePath('file:///d:/workspace/test.ts')).toBe('d:/workspace/test.ts');
  });

  it('handles Windows file URIs with 2 slashes', () => {
    expect(uriToFilePath('file://C:/Users/max/project/Program.cs')).toBe('C:/Users/max/project/Program.cs');
  });

  it('decodes percent-encoded characters (spaces, cyrillic, etc.)', () => {
    expect(uriToFilePath('file:///C:/My%20Projects/Awesome%20App/main.cs')).toBe('C:/My Projects/Awesome App/main.cs');
    expect(uriToFilePath('file:///Users/max/%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82.ts')).toBe('/Users/max/привет.ts');
  });

  it('handles non-URI paths and empty strings without modifying them', () => {
    expect(uriToFilePath('')).toBe('');
    expect(uriToFilePath('/Users/max/dev/file.ts')).toBe('/Users/max/dev/file.ts');
    expect(uriToFilePath('C:/Users/max/dev/file.ts')).toBe('C:/Users/max/dev/file.ts');
    expect(uriToFilePath('src/utils.ts')).toBe('src/utils.ts');
  });

  it('gracefully handles malformed URI encoding without throwing', () => {
    expect(uriToFilePath('file:///C:/Users/max/%E0%A4%A')).toBe('C:/Users/max/%E0%A4%A');
  });
});

describe('path utils', () => {
  it('normalizePath replaces backslashes with forward slashes', () => {
    expect(normalizePath('C:\\Users\\max\\file.ts')).toBe('C:/Users/max/file.ts');
    expect(normalizePath('foo/bar/baz')).toBe('foo/bar/baz');
  });

  it('getFileName extracts filename from path', () => {
    expect(getFileName('/Users/max/dev/file.ts')).toBe('file.ts');
    expect(getFileName('C:\\Users\\max\\file.ts')).toBe('file.ts');
    expect(getFileName('')).toBe('untitled');
  });

  it('getParentPath returns directory path', () => {
    expect(getParentPath('/Users/max/dev/file.ts')).toBe('/Users/max/dev');
    expect(getParentPath('file.ts')).toBe('.');
  });

  it('joinPath joins path components', () => {
    expect(joinPath('src', 'components', 'App.tsx')).toBe('src/components/App.tsx');
  });

  it('getLanguageFromFileName detects language', () => {
    expect(getLanguageFromFileName('App.tsx')).toBe('tsx');
    expect(getLanguageFromFileName('main.rs')).toBe('rust');
    expect(getLanguageFromFileName('Program.cs')).toBe('csharp');
  });
});
