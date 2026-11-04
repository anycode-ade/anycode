import { describe, it, expect } from 'vitest';
import * as path from 'path';

describe('VS Code API Shim and Extension Host', () => {
  it('loads vscode module and provides complete API surface', async () => {
    // When dist/ext-host.cjs is required or when our api/vscode is imported
    const { createVsCodeApi } = await import('../src/api/vscode');
    const { ExtHostWorkspace } = await import('../src/api/workspace');
    const { ExtHostLanguages } = await import('../src/api/languages');
    const { ExtHostWindow } = await import('../src/api/window');
    const { ExtHostCommands } = await import('../src/api/commands');
    const { ExtHostEnv } = await import('../src/api/env');
    const { RpcConnection } = await import('../src/rpc');
    const { PassThrough } = await import('stream');

    const inStream = new PassThrough();
    const outStream = new PassThrough();
    const rpc = new RpcConnection(inStream, outStream);

    const workspace = new ExtHostWorkspace(rpc);
    const languages = new ExtHostLanguages(workspace, rpc);
    const window = new ExtHostWindow(workspace, rpc);
    const commands = new ExtHostCommands(window, rpc);
    const env = new ExtHostEnv(rpc);

    const vscode = createVsCodeApi(workspace, languages, window, commands, env);

    expect(vscode.Uri).toBeDefined();
    expect(vscode.Position).toBeDefined();
    expect(vscode.Range).toBeDefined();
    expect(vscode.Selection).toBeDefined();
    expect(vscode.WorkspaceEdit).toBeDefined();
    expect(vscode.workspace).toBeDefined();
    expect(vscode.languages).toBeDefined();
    expect(vscode.window).toBeDefined();
    expect(vscode.commands).toBeDefined();

    // Test Uri
    const u = vscode.Uri.file('/path/to/file.ts');
    expect(u.scheme).toBe('file');
    expect(u.fsPath).toBe('/path/to/file.ts');

    // Test Position and Range
    const p1 = new vscode.Position(1, 5);
    const p2 = new vscode.Position(2, 10);
    const range = new vscode.Range(p1, p2);
    expect(range.start.line).toBe(1);
    expect(range.end.line).toBe(2);
    expect(range.contains(new vscode.Position(1, 8))).toBe(true);

    // Test Workspace Document Lifecycle
    const doc = workspace.handleDocumentOpened(u.toString(), 'typescript', 1, 'const x: number = 42;\nconsole.log(x);');
    expect(doc.lineCount).toBe(2);
    expect(doc.getText()).toContain('const x: number = 42;');

    // Test Command Registration
    let executed = false;
    const disp = commands.registerCommand('test.command', (arg: string) => {
      executed = true;
      return `hello ${arg}`;
    });

    const res = await commands.execute('test.command', ['world']);
    expect(executed).toBe(true);
    expect(res).toBe('hello world');

    disp.dispose();
  });
});
