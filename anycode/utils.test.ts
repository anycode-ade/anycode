import { describe, it, expect } from 'vitest';
import {
  uriToFilePath,
  normalizePath,
  getFileName,
  getParentPath,
  joinPath,
  getLanguageFromFileName,
  setWorkspaceRoot,
  getWorkspaceRoot,
  toRelativeDisplayPath,
  toFileUri,
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

describe('toRelativeDisplayPath', () => {
  it('strips workspace root prefix when file is inside workspace', () => {
    expect(
      toRelativeDisplayPath(
        '/Users/max/dev/anycode/anycode-base/src/renderer/StickyHeaderRenderer.ts',
        '/Users/max/dev/anycode',
      ),
    ).toBe('anycode-base/src/renderer/StickyHeaderRenderer.ts');
  });

  it('works with global workspace root if workspaceRoot argument is omitted', () => {
    setWorkspaceRoot('/workspace/my-project');
    expect(getWorkspaceRoot()).toBe('/workspace/my-project');
    expect(
      toRelativeDisplayPath('/workspace/my-project/src/index.ts'),
    ).toBe('src/index.ts');
    setWorkspaceRoot(null);
  });

  it('handles file:// URIs correctly', () => {
    expect(
      toRelativeDisplayPath(
        'file:///Users/max/dev/anycode/src/App.tsx',
        '/Users/max/dev/anycode',
      ),
    ).toBe('src/App.tsx');
  });

  it('returns original normalized path if outside workspace', () => {
    expect(
      toRelativeDisplayPath('/var/log/syslog', '/Users/max/dev/anycode'),
    ).toBe('/var/log/syslog');
  });

  it('returns relative path as is when already relative', () => {
    expect(toRelativeDisplayPath('src/App.tsx')).toBe('src/App.tsx');
  });
});

describe('toFileUri', () => {
  it('generates canonical file URI with line range fragment', () => {
    expect(
      toFileUri('/Users/max/dev/anycode/src/App.tsx', [94, 105]),
    ).toBe('file:///Users/max/dev/anycode/src/App.tsx#L94-L105');
  });

  it('generates canonical file URI for single line', () => {
    expect(
      toFileUri('/Users/max/dev/anycode/src/App.tsx', [42, 42]),
    ).toBe('file:///Users/max/dev/anycode/src/App.tsx#L42');
  });

  it('handles Windows drive letters properly', () => {
    expect(
      toFileUri('C:/projects/app/main.ts', [10, 20]),
    ).toBe('file:///C:/projects/app/main.ts#L10-L20');
  });

  it('handles relative paths without prepending leading slash', () => {
    expect(
      toFileUri('src/main.ts', [5, 5]),
    ).toBe('file://src/main.ts#L5');
  });

  it('handles empty filePath by returning empty string', () => {
    expect(toFileUri('')).toBe('');
  });

  it('generates file URI without line range when range is omitted', () => {
    expect(
      toFileUri('/Users/max/dev/anycode/README.md'),
    ).toBe('file:///Users/max/dev/anycode/README.md');
  });
});

describe('language and path edge cases', () => {
  it('detects Dockerfile and dockerfile variants case-insensitively', () => {
    expect(getLanguageFromFileName('Dockerfile')).toBe('dockerfile');
    expect(getLanguageFromFileName('dockerfile')).toBe('dockerfile');
    expect(getLanguageFromFileName('Dockerfile.dev')).toBe('dockerfile');
    expect(getLanguageFromFileName('dockerfile.production')).toBe('dockerfile');
  });

  it('detects languages with uppercase extensions', () => {
    expect(getLanguageFromFileName('APP.TSX')).toBe('tsx');
    expect(getLanguageFromFileName('MAIN.RS')).toBe('rust');
    expect(getLanguageFromFileName('STYLE.CSS')).toBe('css');
    expect(getLanguageFromFileName('DATA.JSON')).toBe('json');
  });

  it('handles files with multiple dots correctly', () => {
    expect(getLanguageFromFileName('component.test.tsx')).toBe('tsx');
    expect(getLanguageFromFileName('config.local.json')).toBe('json');
    expect(getLanguageFromFileName('bundle.min.js')).toBe('javascript');
  });

  it('returns empty string for files without extension or unknown extension', () => {
    expect(getLanguageFromFileName('Makefile')).toBe('');
    expect(getLanguageFromFileName('LICENSE')).toBe('');
    expect(getLanguageFromFileName('somefile.unknownext123')).toBe('');
  });

  it('getParentPath handles root and relative parent directories', () => {
    expect(getParentPath('/root')).toBe('/');
    expect(getParentPath('single-file.txt')).toBe('.');
    expect(getParentPath('a/b/c.txt')).toBe('a/b');
  });

  it('joinPath handles empty and dot segments properly', () => {
    expect(joinPath('.', 'src', '.', 'index.ts')).toBe('src/index.ts');
    expect(joinPath('src', '', 'utils', 'helper.ts')).toBe('src/utils/helper.ts');
    expect(joinPath('C:\\Users', 'max\\dev')).toBe('C:/Users/max/dev');
  });

  it('toRelativeDisplayPath returns dot when path equals workspace root', () => {
    expect(toRelativeDisplayPath('/Users/max/project', '/Users/max/project')).toBe('.');
  });

  it('toRelativeDisplayPath returns empty string for empty input', () => {
    expect(toRelativeDisplayPath('')).toBe('');
  });
});
