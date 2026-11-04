# VS Code Extensions Support in Anycode — Architecture & Agent Implementation Spec

> **Назначение документа**: Полное техническое задание и архитектурная спецификация для ИИ-агента по реализации полноценной поддержки расширений VS Code (`.vsix` / Open VSX) в Anycode.
> Цель — обеспечить работу **всех классов расширений VS Code**: тем, иконок, грамматик, сниппетов, языковых серверов (LSP), форматтеров, линтеров, команд, TreeView-панелей, StatusBar-элементов и Webview-панелей.

---

## 1. Обзор архитектуры (High-Level Architecture)

Поскольку Anycode использует связку **Rust Backend (`anycode-backend`)** + **React Frontend (`anycode`)** + **Кастомный виртуальный редактор (`anycode-editor`)**, поддержка расширений VS Code строится на **четырёх столпах**:

1. **Extension Manager & Open VSX Registry (`anycode-backend/src/extensions/`)**
   Поиск, скачивание `.vsix` из Open VSX (`https://open-vsx.org/api`), установка из локального `.vsix`, распаковка в `~/.anycode/extensions/<publisher>.<name>-<version>/`, парсинг `package.json` (`contributes`, `activationEvents`, `main`, `browser`) и управление жизненным циклом (enable / disable / uninstall / update).
2. **Declarative Contributions Engine (Rust + Frontend + Core Editor)**
   Нативная обработка статических контрибуций без запуска JS:
   - `contributes.themes` и `contributes.iconThemes`
   - `contributes.languages` и `contributes.grammars` (TextMate `.tmLanguage.json` как фоллбэк/дополнение к Tree-Sitter в `anycode-editor`)
   - `contributes.snippets`
   - `contributes.configuration` и `contributes.keybindings`
3. **Node.js Extension Host Sidecar (`anycode-ext-host/` + `anycode-backend/src/ext_host.rs`)**
   Отдельный процесс Node.js, управляемый Rust-бэкендом по `stdio` / Local IPC через двунаправленный **JSON-RPC 2.0**. Внутри процессах-воркера перехватывается `require('vscode')` (через `Module._load`) и предоставляется полная реализация неймспейса `vscode.*`.
4. **UI & Editor Integration (`anycode/` + `anycode-editor/`)**
   Проброс событий через Socket.IO между `anycode-backend` и фронтендом:
   - Мост `vscode.languages.*` ⇄ существующий пайплайн LSP (`lsp:completion`, `lsp:hover`, `lsp:definition`, `lsp:references`, `lsp:diagnostics` + новые `lsp:code_actions`, `lsp:format`, `lsp:rename`).
   - Панель управления расширениями (`ExtensionsPanel.tsx`).
   - Command Palette (`vscode.commands`), Уведомления и QuickPick (`vscode.window`), Output Channels, StatusBar, динамические `TreeView` и изолированные `WebviewPanel` внутри Dockview.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                               React Frontend (anycode/)                          │
│  ExtensionsPanel │ CommandPalette │ QuickPick/Input │ TreeViewPanel │ Webview    │
│  StatusBar       │ OutputPanel    │ AnycodeEditor (LSP + Snippets + TextMate)    │
└─────────────────────────────────────────▲────────────────────────────────────────┘
                                          │ Socket.IO (ext:*, lsp:*, theme:*)
                                          ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                            Rust Backend (anycode-backend/)                       │
│  ┌─────────────────────────┐  ┌────────────────────────┐  ┌───────────────────┐  │
│  │ ExtensionRegistry       │  │ DeclarativeEngine      │  │ LspManager +      │  │
│  │ (Open VSX + .vsix zip)  │  │ (Themes/Langs/Snippets)│  │ ExtProviderBridge │  │
│  └─────────────────────────┘  └────────────────────────┘  └─────────▲─────────┘  │
│                                                                     │            │
│  ┌──────────────────────────────────────────────────────────────────┴─────────┐  │
│  │                     ExtHostManager (ext_host.rs)                           │  │
│  │        Spawns Node.js sidecar, routes JSON-RPC <-> AppState & Socket.IO    │  │
│  └──────────────────────────────────────▲─────────────────────────────────────┘  │
└─────────────────────────────────────────┼────────────────────────────────────────┘
                                          │ JSON-RPC 2.0 over stdio / Unix Socket
                                          ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                         Node.js Extension Host (anycode-ext-host/)               │
│  ┌────────────────────────────────────────────────────────────────────────────┐  │
│  │  Module._load('vscode') shim -> Full `vscode.*` API Implementation         │  │
│  │  workspace │ languages │ window │ commands │ env │ debug │ tasks │ scm     │  │
│  └──────────────────────────────────────▲─────────────────────────────────────┘  │
│                                         │                                        │
│  ┌──────────────────┐  ┌────────────────┴───┐  ┌──────────────────────────────┐  │
│  │ Extension A      │  │ Extension B        │  │ Extension C (vscode-language │  │
│  │ (activate/main)  │  │ (Formatter/Linter) │  │ client -> spawns LSP binary) │  │
│  └──────────────────┘  └────────────────────┘  └──────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Детальный план подсистем и файлов

### Фаза 1: Менеджер расширений, Open VSX и хранилище `.vsix` (Backend)

Создать модуль `anycode-backend/src/extensions/` (по образцу существующего [`acp_registry.rs`](file:///Users/max/dev/anycode/anycode-backend/src/acp_registry.rs)):

#### 1.1. Структура файлов
- `anycode-backend/src/extensions/mod.rs` — публичный интерфейс `ExtensionManager`.
- `anycode-backend/src/extensions/manifest.rs` — структуры десериализации `package.json` стандарта VS Code:
  - `VsCodeManifest`: `name`, `publisher`, `version`, `displayName`, `description`, `icon`, `main`, `browser`, `activationEvents: Vec<String>`, `contributes: Option<VsCodeContributes>`, `extensionDependencies: Option<Vec<String>>`, `extensionPack: Option<Vec<String>>`.
  - `VsCodeContributes`:
    - `themes: Vec<ThemeContribution>` (`label`, `uiTheme`, `path`)
    - `icon_themes: Vec<IconThemeContribution>` (`id`, `label`, `path`)
    - `languages: Vec<LanguageContribution>` (`id`, `extensions`, `aliases`, `filenames`, `configuration`)
    - `grammars: Vec<GrammarContribution>` (`language`, `scopeName`, `path`, `embeddedLanguages`)
    - `snippets: Vec<SnippetContribution>` (`language`, `path`)
    - `commands: Vec<CommandContribution>` (`command`, `title`, `category`, `icon`)
    - `keybindings: Vec<KeybindingContribution>` (`command`, `key`, `mac`, `when`)
    - `configuration: Value` (JSON Schema настроек расширения)
    - `viewsContainers` / `views` (`explorer`, `scm`, кастомные контейнеры)
- `anycode-backend/src/extensions/openvsx.rs` — клиент к `https://open-vsx.org/api`:
  - Поиск: `GET https://open-vsx.org/api/-/search?query={q}&size={size}&offset={offset}`
  - Метаданные: `GET https://open-vsx.org/api/{publisher}/{name}/{version}`
  - Скачивание `.vsix` с проверкой SHA-256 (если предоставлен) и распаковкой ZIP-архива (`zip` crate).
- `anycode-backend/src/extensions/storage.rs`:
  - Директория установки: `~/.anycode/extensions/` (или `$ANYCODE_HOME/extensions/`).
  - Каждое расширение распаковывается из папки `extension/` внутри `.vsix` в `~/.anycode/extensions/{publisher}.{name}-{version}/`.
  - Состояние (`enabled`/`disabled`, установленные версии) хранится в `~/.anycode/extensions/state.json`.
  - Автоматическая рекурсивная установка `extensionDependencies` и `extensionPack`.
- `anycode-backend/src/handlers/extension_handler.rs` — обработчики Socket.IO:
  - `ext:search` — поиск в Open VSX.
  - `ext:list` — список установленных расширений + статус (enabled, active, version, README, contributes).
  - `ext:install` — установка по `{ id: "publisher.name", version?: "..." }` или из локального пути `.vsix`.
  - `ext:uninstall` — удаление расширения.
  - `ext:toggle` — включение/выключение расширения.
  - `ext:assets` — HTTP роут в Axum `GET /api/ext-asset/:ext_id/*path` для отдачи иконок, шрифтов, стилей и локальных ресурсов Webview из папки установленного расширения.

---

### Фаза 2: Декларативные контрибуции (Темы, Иконки, Языки, Сниппеты, TextMate)

#### 2.1. Конвертер тем VS Code (`anycode-backend/src/extensions/theme_converter.rs`)
Темы в VS Code используют JSON/JSONC (часто с комментариями и висячими запятыми — парсить через `json5` или стриппер комментариев + поддержку поля `"include"`).
- Извлекать `colors` (UI цвета: `editor.background`, `sideBar.background`, `statusBar.background`, `terminal.background` и т.д.) и маппить их на цветовую схему Anycode в [`theme_handler.rs`](file:///Users/max/dev/anycode/anycode-backend/src/handlers/theme_handler.rs) и [`useTheme.ts`](file:///Users/max/dev/anycode/anycode/hooks/useTheme.ts).
- Извлекать `tokenColors` (TextMate scopes: `comment`, `string`, `keyword`, `entity.name.function`, `entity.name.type`, `variable` и т.д.) и `semanticTokenColors`, транслируя их в ключи палитры `anycode-editor` (`string`, `keyword`, `function`, `type`, `comment`, `variable`, `number`, `constant`, `property`, `tag` и т.д.) + сохранять полные правила `tokenColors` для TextMate-токенизатора.
- Интегрировать темы из активных расширений в `handle_theme_list` и `handle_theme_get`, чтобы любая тема из Open VSX (One Dark Pro, Catppuccin, Dracula, Tokyo Night, GitHub Theme) сразу появлялась в списке тем Anycode.

#### 2.2. Иконки файлов (`contributes.iconThemes`)
- Парсить JSON темы иконок (`iconDefinitions`, `fileExtensions`, `fileNames`, `folderNames`, `folderNamesExpanded`, `languageIds`).
- Отдавать карту иконок фронтенду через `ext:icon_theme:get`, рендерить SVG/шрифтовые иконки в `FilesPanel` и табах редактора.

#### 2.3. Языковые конфигурации и сниппеты (`contributes.languages` & `contributes.snippets`)
- Парсить `language-configuration.json` каждого языкового расширения:
  - `comments.lineComment`, `comments.blockComment`
  - `brackets`, `autoClosingPairs`, `surroundingPairs`
  - `indentationRules`
- Динамически дополнять рантайм-конфигурацию языков в `AppState` (поверх статического `config.toml` из [`config.rs`](file:///Users/max/dev/anycode/anycode-backend/src/config.rs)).
- Парсить файлы сниппетов (`.json` / `.code-snippets`), преобразовывать placeholders (`$1`, `${1:default}`, `$0`) и подмешивать их в выдачу `handle_completion` или на клиенте в `anycode-editor`.

#### 2.4. Поддержка грамматик TextMate в `anycode-editor` (`contributes.grammars`)
В `anycode-editor/core/` сейчас используется Tree-Sitter для базовых языков. Чтобы работали **любые** языки из расширений VS Code (Astro, Svelte, Prisma, GraphQL, Dockerfile, Terraform, Nix, Vue, Solidity и тысячи других):
- Добавить в `anycode-editor/core` поддержку `vscode-textmate` + `vscode-oniguruma` (WASM) как универсального токенизатора для языков, у которых нет встроенного Tree-Sitter парсера (или для инъекций грамматик `injectTo`).
- При открытии файла с расширением, зарегистрированным через `contributes.languages`, редактор запрашивает с бэкенда `GrammarContribution` (`.tmLanguage.json` / `.plist`) и подсвечивает строки токенами TextMate.

---

### Фаза 3: Node.js Extension Host (`anycode-ext-host/`) и API `vscode`

Это ядро для исполнения кода расширений (`main` / `browser` бандлы).

#### 3.1. Архитектура пакета `anycode-ext-host`
Создать пакет `anycode-ext-host/` (TypeScript, собираемый через `esbuild`/`tsup` в один компактный бандл `dist/ext-host.cjs`, который встраивается или поставляется рядом с бинарником `anycode-backend`):
- **Транспорт**: Чтение/запись сообщений JSON-RPC 2.0 с заголовками `Content-Length: ...\r\n\r\n` (как в протоколе LSP) через `stdin`/`stdout` или локальный Unix-сокет / Named Pipe.
- **Перехватчик `require('vscode')`**:
  Через переопределение `Module._load` любой вызов `require('vscode')` внутри загружаемых расширений возвращает объект API, созданный `anycode-ext-host`.
- **Поддержка `vscode-languageclient`**:
  Многие расширения (Python, ESLint, Rust Analyzer, TailwindCSS, Prisma, Volar, Clangd) используют npm-пакет `vscode-languageclient/node` внутри расширения для запуска собственного LSP-процесса. Поскольку наш полифилл реализует `vscode.workspace`, `vscode.languages`, `vscode.window` и `vscode.commands`, `vscode-languageclient` работает **нативно без модификаций** — он сам спавнит языковой сервер и регистрирует провайдеры через `vscode.languages.register*`!

#### 3.2. Поверхность API `vscode`, обязательная к реализации в `anycode-ext-host`

1. **Базовые типы и классы (`src/api/types.ts`)**:
   - `Uri` (`file`, `parse`, `joinPath`, `from`, `fsPath`, `scheme`, `path`, `query`, `fragment`)
   - `Position`, `Range`, `Selection`, `Location`, `LocationLink`
   - `TextEdit`, `WorkspaceEdit`, `SnippetString`, `MarkdownString`
   - `Diagnostic`, `DiagnosticSeverity`, `DiagnosticRelatedInformation`, `DiagnosticTag`
   - `CompletionItem`, `CompletionItemKind`, `CompletionList`, `CompletionTriggerKind`
   - `Hover`, `SignatureHelp`, `SignatureInformation`, `ParameterInformation`
   - `CodeAction`, `CodeActionKind`, `CodeActionContext`, `CodeLens`, `DocumentHighlight`, `DocumentSymbol`, `SymbolInformation`, `SymbolKind`
   - `FoldingRange`, `FoldingRangeKind`, `InlayHint`, `InlayHintKind`, `SemanticTokens`, `SemanticTokensBuilder`, `SemanticTokensLegend`
   - `EventEmitter<T>`, `Disposable`, `CancellationTokenSource`, `CancellationError`
   - `ThemeColor`, `ThemeIcon`, `TreeItem`, `TreeItemCollapsibleState`, `StatusBarAlignment`, `ViewColumn`, `ConfigurationTarget`, `ProgressLocation`

2. **`vscode.workspace` (`src/api/workspace.ts`)**:
   - `workspaceFolders`, `name`, `rootPath`, `getWorkspaceFolder(uri)`, `onDidChangeWorkspaceFolders` (синхронизировано с мульти-проектами `WorkspaceManager` в `anycode-backend/src/workspace.rs`).
   - `textDocuments`, `openTextDocument(uriOrOptions)`
   - События документов: `onDidOpenTextDocument`, `onDidChangeTextDocument`, `onDidSaveTextDocument`, `onWillSaveTextDocument`, `onDidCloseTextDocument` (транслируются из `io_handler.rs`: `handle_file_open`, `handle_file_change`, `handle_file_save`, `handle_file_close`).
   - `applyEdit(edit: WorkspaceEdit)` — применяет текстовые правки и операции создания/переименования/удаления файлов через бэкенд и рассылает обновления открытым редакторам.
   - `getConfiguration(section?, scope?)` + `onDidChangeConfiguration` — чтение и запись настроек (`~/.anycode/settings.json` + `.vscode/settings.json` в проекте + дефолты из `contributes.configuration`).
   - `fs` (`FileSystem` API: `readFile`, `writeFile`, `stat`, `readDirectory`, `createDirectory`, `delete`, `rename`, `copy`).
   - `createFileSystemWatcher(globPattern)` — поверх файлового вотчера в `background_tasks.rs`, пробрасывая `onDidCreate`, `onDidChange`, `onDidDelete`.
   - `findFiles(include, exclude, maxResults)` — поверх существующего быстрого поиска файлов в `search.rs`.

3. **`vscode.languages` (`src/api/languages.ts`)**:
   - `createDiagnosticCollection(name)` — агрегирует диагностики от расширений (ESLint, TypeScript, Mypy и т.д.) и отправляет их в канал `diagnostic_tx` (`PublishDiagnosticsParams`) в `AppState`, чтобы они сразу отображались в `anycode-editor` вместе с LSP-ошибками.
   - Регистрация провайдеров:
     - `registerCompletionItemProvider`
     - `registerHoverProvider`
     - `registerDefinitionProvider`, `registerTypeDefinitionProvider`, `registerImplementationProvider`, `registerDeclarationProvider`
     - `registerReferenceProvider`
     - `registerDocumentFormattingEditProvider`, `registerDocumentRangeFormattingEditProvider`, `registerOnTypeFormattingEditProvider`
     - `registerCodeActionsProvider`
     - `registerCodeLensProvider`
     - `registerRenameProvider`
     - `registerDocumentSymbolProvider`, `registerWorkspaceSymbolProvider`
     - `registerSignatureHelpProvider`
     - `registerDocumentHighlightProvider`
     - `registerFoldingRangeProvider`
     - `registerInlayHintsProvider`
     - `registerDocumentSemanticTokensProvider`
   - Матчинг `DocumentSelector` (по `language`, `scheme`, `pattern` glob).

4. **`vscode.commands` (`src/api/commands.ts`)**:
   - `registerCommand(id, handler)`, `registerTextEditorCommand(id, handler)`
   - `executeCommand(id, ...args)` — умеет вызывать как команды, зарегистрированные расширениями, так и встроенные команды (`vscode.open`, `editor.action.formatDocument`, `setContext`, `workbench.action.*`).
   - `getCommands(filterInternal?)`

5. **`vscode.window` (`src/api/window.ts`)**:
   - `activeTextEditor`, `visibleTextEditors`, `onDidChangeActiveTextEditor`, `onDidChangeVisibleTextEditors`, `onDidChangeTextEditorSelection`, `onDidChangeTextEditorVisibleRanges`.
   - Объект `TextEditor` (`document`, `selection`, `selections`, `edit(callback)`, `insertSnippet(snippet)`, `setDecorations(decorationType, rangesOrOptions)`, `revealRange(range)`).
   - `createTextEditorDecorationType(options)` — поддержка декораций в `anycode-editor` (inline-текст `after`/`before` для GitLens и Error Lens, подсветка фона, бордеры, иконки в gutter).
   - Диалоги и уведомления:
     - `showInformationMessage`, `showWarningMessage`, `showErrorMessage` (с кнопками выбора действия, возвращающими `Promise<string | undefined>`).
     - `showQuickPick(items, options)` (сингл- и мульти-селект через UI-модалку во фронтенде).
     - `showInputBox(options)`, `showOpenDialog(options)`, `showSaveDialog(options)`.
   - `withProgress(options, task)` — индикатор прогресса в статус-баре или тосте.
   - `createOutputChannel(name, options)` — логи расширений в панели Output.
   - `createStatusBarItem(idOrAlignment, alignmentOrPriority, priority)` — элементы в нижней панели статуса с поддержкой `text` (включая иконки `$(icon)`), `tooltip`, `command`, `color`, `backgroundColor`.
   - `createTerminal(options)` — создание PTY-терминала через существующий `Terminal` менеджер в `anycode-backend/src/terminal.rs`.
   - `registerTreeDataProvider(viewId, provider)` / `createTreeView(viewId, options)` — кастомные деревья в сайдбаре.
   - `createWebviewPanel(viewType, title, showOptions, options)` и `registerWebviewViewProvider(viewId, provider)` — рендеринг HTML-интерфейсов расширений.

6. **`vscode.env`, `ExtensionContext` и `SecretStorage` (`src/api/context.ts`)**:
   - `ExtensionContext`:
     - `subscriptions: Disposable[]`
     - `extensionPath`, `extensionUri`, `extensionMode`
     - `globalState` и `workspaceState` (`Memento` API с персистентностью в SQLite или JSON в `~/.anycode/extensions/storage/`).
     - `secrets` (`SecretStorage`: `get`, `store`, `delete`, `onDidChange`).
     - `globalStorageUri`, `storageUri`, `logUri`, `asAbsolutePath(relativePath)`.
   - `vscode.env`: `appName` (`"Anycode"`), `appRoot`, `language`, `clipboard` (`readText`, `writeText`), `openExternal(uri)`, `uriScheme`.

---

### Фаза 4: Интеграция провайдеров в Rust Backend (`ext_host.rs` & `lsp_handler.rs`)

В `anycode-backend` запросы от редактора (`lsp:completion`, `lsp:hover`, `lsp:definition`, `lsp:references`, и новые `lsp:code_actions`, `lsp:format`, `lsp:rename`, `lsp:signature_help`) должны объединять результаты из двух источников:
1. Нативный `LspManager` (`anycode-backend/src/lsp.rs`), если для языка настроен прямой LSP в `config.toml`.
2. `ExtHostManager` (`anycode-backend/src/ext_host.rs`), который вызывает зарегистрированные провайдеры в Node.js Extension Host (включая языковые серверы, поднятые самими расширениями через `vscode-languageclient`).

#### События активации (`activationEvents`)
`ExtHostManager` отслеживает и триггерит активацию расширений по правилам:
- `*` и `onStartupFinished` — при старте Extension Host.
- `onLanguage:<langId>` — при первом открытии файла данного языка.
- `workspaceContains:<glob>` — при открытии проекта в `WorkspaceManager`, если найден файл по паттерну (например, `package.json`, `Cargo.toml`, `pyproject.toml`).
- `onCommand:<commandId>` — перед вызовом команды.
- `onView:<viewId>` — при открытии соответствующей TreeView/Webview панели.
- `onFileSystem:<scheme>` / `onWebviewPanel:<viewType>`.
- В VS Code >= 1.74 расширения также активируются неявно по записям в `contributes.languages`, `contributes.commands`, `contributes.views` — это поведение тоже обязательно поддержать.

---

### Фаза 5: Доработки в Core Editor (`anycode-editor/core/`)

Чтобы расширения вроде **GitLens**, **Error Lens**, **Prettier**, **ESLint**, **Tailwind CSS IntelliSense** работали полноценно, в [`editor.ts`](file:///Users/max/dev/anycode/anycode-editor/core/src/editor.ts) и [`Renderer.ts`](file:///Users/max/dev/anycode/anycode-editor/core/src/renderer/Renderer.ts) необходимо добавить:

1. **API Декораций (`setDecorations`)**:
   - Поддержка динамических декораций от расширений:
     - `after` / `before` виртуальный текст в конце/начале строки (с `contentText`, `color`, `backgroundColor`, `fontStyle`, `margin`) — критично для GitLens (blame в конце строки) и Error Lens.
     - `backgroundColor`, `border`, `textDecoration` на произвольных `Range`.
     - `gutterIconPath` — иконки в гуттере строки.
     - `overviewRulerColor` — маркеры на скроллбаре.
2. **Code Actions (Лампочка / `Cmd+.` / `Ctrl+.`) и Quick Fix**:
   - Запрос `lsp:code_actions` для текущего курсора/выделения и отображение компактного попап-меню с применением `WorkspaceEdit` или вызовом `Command`.
3. **Formatting (`Shift+Alt+F` / Format on Save)**:
   - Запрос `lsp:format` и применение массива `TextEdit` через `applyEditsKeepingPoints`.
4. **Snippets Expansion**:
   - Поддержка вставки сниппетов с таб-стопами (`$1`, `$2`, `$0`) при выборе сниппета или `CompletionItem` с `insertTextFormat === Snippet`.

---

### Фаза 6: Фронтенд и UI-компоненты (`anycode/`)

1. **`ExtensionsPanel.tsx` (`anycode/features/extensions/ExtensionsPanel.tsx`)**:
   - Вкладка в левой панели / Dockview.
   - Поиск по Open VSX с дебаунсом, отображение иконки, названия, автора, количества скачиваний, описания.
   - Кнопки **Install**, **Uninstall**, **Enable/Disable**, а также кнопка **Install from VSIX...**.
   - Просмотр деталей расширения (README.md рендеринг, список команд, тем и настроек).
2. **`CommandPalette.tsx` (`anycode/components/CommandPalette.tsx`) + `QuickPickModal.tsx`**:
   - Открытие по `Cmd+Shift+P` / `Ctrl+Shift+P` или `F1`.
   - Список всех встроенных команд Anycode + команд из `contributes.commands` всех расширений.
   - Обслуживание запросов `ext:window:quick_pick` и `ext:window:input_box` от Extension Host (когда расширение вызывает `vscode.window.showQuickPick` или `showInputBox`).
3. **`StatusBar.tsx` (`anycode/components/StatusBar.tsx`)**:
   - Нижняя полоска статуса (высота ~24px), отображающая элементы `StatusBarItem` от расширений (слева и справа, отсортированные по `priority`), текущий язык, позицию курсора и ветку Git.
   - Поддержка иконок Codicons (`$(sync~spin)`, `$(check)`, `$(error)` и т.д. через `@vscode/codicons`).
4. **Динамические `TreeViewPanel.tsx` и `WebviewPanel.tsx`**:
   - Рендеринг деревьев из `vscode.window.registerTreeDataProvider` с ленивой подгрузкой дочерних узлов (`getChildren(element)`), контекстным меню и кликом по `command`.
   - Изолированный `<iframe sandbox="allow-scripts allow-forms allow-same-origin">` для `vscode.window.createWebviewPanel`, инжектирующий скрипт `acquireVsCodeApi = () => ({ postMessage, getState, setState })`, связанный через `window.postMessage` ⇄ Socket.IO (`ext:webview:message`) ⇄ Extension Host.
   - Переписывание локальных URI внутри Webview (`vscode-resource:` / `https://file+.vscode-resource.vscode-cdn.net/...`) на `/api/ext-asset/:ext_id/...`.
5. **Тосты и диалоги от расширений**:
   - Поддержка `ext:window:message` (Info / Warning / Error) с кнопками действий, клик по которым отправляет выбранный пункт обратно в ожидающий `Promise` внутри Extension Host.

---

## 3. Протокол Socket.IO (Новые события)

| Событие | Направление | Назначение |
|---|---|---|
| `ext:search` | Client -> Server (Ack) | Поиск расширений в Open VSX (`{ query, offset, size }`) |
| `ext:list` | Client -> Server (Ack) | Список установленных расширений и их статусов |
| `ext:install` | Client -> Server (Ack) | Установка из Open VSX (`{ id, version? }`) или `.vsix` (`{ vsixPath }`) |
| `ext:uninstall` | Client -> Server (Ack) | Удаление расширения (`{ id }`) |
| `ext:toggle` | Client -> Server (Ack) | Включение/выключение (`{ id, enabled }`) |
| `ext:commands:list` | Client -> Server (Ack) | Получение всех доступных команд для Command Palette |
| `ext:command:execute` | Client ⇄ Server | Выполнение команды (`{ command, args }`) |
| `ext:window:message` | Server -> Client | Показ уведомления с кнопками (`{ requestId, severity, message, items }`) |
| `ext:window:message:reply`| Client -> Server | Ответ пользователя на уведомление (`{ requestId, selectedItem }`) |
| `ext:window:quick_pick` | Server -> Client | Открытие QuickPick от расширения (`{ requestId, items, options }`) |
| `ext:window:input_box` | Server -> Client | Открытие InputBox от расширения (`{ requestId, options }`) |
| `ext:statusbar:update` | Server -> Client | Обновление элементов StatusBar |
| `ext:decorations:set` | Server -> Client | Установка декораций в редакторе (`{ file, key, options, ranges }`) |
| `ext:treeview:register` | Server -> Client | Регистрация нового TreeView (`{ viewId, title, container }`) |
| `ext:treeview:children` | Client -> Server (Ack) | Запрос дочерних элементов узла дерева (`{ viewId, elementId? }`) |
| `ext:webview:create` | Server -> Client | Открытие панели Webview (`{ panelId, viewType, title, html, options }`) |
| `ext:webview:message` | Client ⇄ Server | Обмен сообщениями `postMessage` внутри Webview |
| `lsp:code_actions` | Client -> Server (Ack) | Запрос Code Actions (Quick Fix / Refactor) |
| `lsp:format` | Client -> Server (Ack) | Форматирование документа |
| `lsp:rename` | Client -> Server (Ack) | Переименование символа (`WorkspaceEdit`) |

---

## 4. Пошаговый чеклист выполнения для Агента

Агент должен выполнять реализацию последовательно по этапам, проверяя сборку (`cargo test`, `pnpm build`, `pnpm test`) на каждом шаге:

- [ ] **Этап 1: Инфраструктура расширений и Open VSX в `anycode-backend`**
  - Добавить зависимости в `anycode-backend/Cargo.toml` (`zip`, `json5` или стриппер JSONC).
  - Реализовать `src/extensions/manifest.rs`, `src/extensions/openvsx.rs`, `src/extensions/storage.rs`, `src/extensions/mod.rs`.
  - Добавить `extension_manager: Arc<Mutex<ExtensionManager>>` в `AppState` ([`app_state.rs`](file:///Users/max/dev/anycode/anycode-backend/src/app_state.rs)).
  - Реализовать `src/handlers/extension_handler.rs` и HTTP роут `/api/ext-asset/:ext_id/*path` в [`lib.rs`](file:///Users/max/dev/anycode/anycode-backend/src/lib.rs).
  - Написать unit-тесты на парсинг `package.json`, скачивание/распаковку `.vsix` и работу хранилища.

- [ ] **Этап 2: Декларативные контрибуции (Темы, Иконки, Языки, Сниппеты, TextMate)**
  - Реализовать конвертер тем VS Code (`theme_converter.rs`) с поддержкой JSONC и `include`, интегрировать в [`theme_handler.rs`](file:///Users/max/dev/anycode/anycode-backend/src/handlers/theme_handler.rs) и [`useTheme.ts`](file:///Users/max/dev/anycode/anycode/hooks/useTheme.ts).
  - Подключить `contributes.iconThemes` в `FilesPanel.tsx`.
  - Подключить `contributes.languages` и `contributes.snippets`.
  - Добавить поддержку TextMate грамматик (`contributes.grammars`) в `anycode-editor/core`.

- [ ] **Этап 3: Пакет `anycode-ext-host` (Node.js Sidecar и полифилл `vscode`)**
  - Создать пакет `anycode-ext-host/` с JSON-RPC 2.0 транспортом по `stdio`.
  - Реализовать `Module._load` перехватчик для `require('vscode')`.
  - Реализовать все базовые классы (`Uri`, `Range`, `Position`, `Diagnostic`, `WorkspaceEdit`, `EventEmitter`, `Disposable` и т.д.).
  - Реализовать неймспейсы `vscode.workspace`, `vscode.languages`, `vscode.commands`, `vscode.window`, `vscode.env` и `ExtensionContext`.
  - Собрать бандл `anycode-ext-host/dist/ext-host.cjs` и подключить его запуск из `anycode-backend/src/ext_host.rs`.

- [ ] **Этап 4: Мост `ExtHostManager` ⇄ `AppState` / `LspManager` / `io_handler`**
  - Пробросить события открытия/изменения/сохранения/закрытия файлов из `io_handler.rs` в `ExtHostManager`.
  - Объединить выдачу `lsp_handler.rs` (`completion`, `hover`, `definition`, `references`, `diagnostics`, `format`, `code_actions`, `rename`) с провайдерами из `ExtHostManager`.
  - Реализовать обработку `workspace.applyEdit` на бэкенде с синхронизацией в открытые редакторы.

- [ ] **Этап 5: Доработка `anycode-editor` (Декорации, Code Actions, Formatting)**
  - Реализовать рендеринг текстовых и линейных декораций (`after`/`before` inline hints, фоны, бордеры, gutter icons) в `anycode-editor/core/src/renderer/`.
  - Добавить хоткеи и UI для Форматирования (`Shift+Alt+F`) и Code Actions (`Cmd+.` / `Ctrl+.`).

- [ ] **Этап 6: UI во фронтенде (`anycode/`)**
  - Создать `ExtensionsPanel.tsx` и зарегистрировать его в `Layout.tsx` и `Toolbar.tsx`.
  - Создать `CommandPalette.tsx` (`Cmd+Shift+P`), `QuickPickModal.tsx`, `StatusBar.tsx` (с поддержкой `@vscode/codicons`).
  - Реализовать `TreeViewPanel.tsx` и `WebviewPanel.tsx` для UI-расширений.

- [ ] **Этап 7: End-to-End верификация на реальных расширениях из Open VSX**
  - Проверить установку и работу темы (например, `zhuangtongfa.material-theme` / `catppuccin.catppuccin-vsc`).
  - Проверить тему иконок (`PKief.material-icon-theme`).
  - Проверить линтер/форматтер (`esbenp.prettier-vscode`, `dbaeumer.vscode-eslint`, `usernamehw.errorlens`).
  - Проверить расширение с собственным LSP через `vscode-languageclient` (например, `rust-lang.rust-analyzer` или `bradlc.vscode-tailwindcss`).
  - Проверить расширение с декорациями, TreeView и Webview (например, `eamodio.gitlens`).
