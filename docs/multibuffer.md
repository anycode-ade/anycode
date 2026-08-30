# Anycode Multi-buffer Review System / Система Мультибуферного Ревью



---

## 🇬🇧 English Documentation

### 1. Overview
The **Multi-buffer Review System** is an advanced feature in Anycode that allows users to review and edit multiple changed files (or historical Git commit diffs) within a single, continuous virtual editor workspace — similar to multi-file diff reviews in Cursor or VS Code.

Instead of forcing developers to switch back and forth between separate file tabs, the Multi-buffer architecture concatenates multiple file buffers into a single virtual coordinate space managed by `MultiBufferCode`.

---

### 2. Architecture & Core Components

```
┌─────────────────────────────────────────────────────────────────┐
│                      React Application                          │
│     App.tsx  ──►  useEditors  ──►  MultibufferPanel.tsx        │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Core Editor                              │
│  AnycodeEditorReact ──► AnycodeEditor (options: focusedDiff)    │
│                               │                                 │
│                               ▼                                 │
│                         MultiBufferCode                         │
│               (Virtual Document Index: IndexedRow[])            │
├───────────────────────────────┬─────────────────────────────────┤
│  fileDiffs (Map<string, ...>) │  collapsedFiles (Set<string>)   │
└───────────────┬───────────────┴─────────────────┬───────────────┘
                │                                 │
                ▼                                 ▼
┌───────────────────────────────┐ ┌───────────────────────────────┐
│       File 1: Code            │ │       File 2: Code            │
│  Current & Original Baseline  │ │  Current & Original Baseline  │
└───────────────────────────────┘ └───────────────────────────────┘
```

#### Key Classes & Modules:
- **`MultiBufferCode` (`anycode-base/src/multibuffer.ts`)**:
  Extends `Code`. Creates a unified virtual document index (`IndexedRow[]`) comprising header rows and file content rows. Maps global line numbers and character offsets to local file buffer coordinates.
- **`DiffRenderer` & `LineRenderer` (`anycode-base/src/renderer/`)**:
  Renders custom file headers (`▾ filename.ts +A −B`), applies display line numbers (local 1-based line numbers for each file), and folds/collapses unchanged lines in **Focused Diff Mode**.
- **`MultibufferPanel.tsx` (`anycode/features/editor/MultibufferPanel.tsx`)**:
  React component managing the lifecycle of the shared `AnycodeEditor` instance, loading pending file buffers, subscribing to external change events, and preserving cursor position.
- **Per-Pane State (`App.tsx`)**:
  `multibufferReviews: Record<string, MultibufferReview>` manages independent multi-buffer reviews per editor split pane (`paneId`).

---

### 3. Key Design Highlights & Features

1. **Incremental Per-File Diff Caching**:
   Diff stats and hunk calculations are cached per file (`fileDiffs: Map<string, CachedFileDiff>`). When a single file is edited, only that file's diff is re-evaluated; other files maintain cached diffs without re-diffing.
2. **Bi-Directional Real-Time Synchronization**:
   - Edits in Multibuffer ──► Emits `onFileChange` ──► Calls `notifyExternalChange()` on the target file's `AnycodeEditor`.
   - Edits in Individual File Editor ──► `addOnChangeListener` ──► Calls `notifyFileChanged()` on `MultiBufferCode` ──► Refreshes Multibuffer view.
3. **Cross-File Edit Safety**:
   - **Header Protection**: File headers are marked `contentEditable = 'false'` and any `insertRaw`/`removeRaw` targeting header rows returns immediately.
   - **Cross-File Delete Prevention**: `removeRaw` validates that deletion start and end positions belong to the *same* file (`start.fileIndex === end.fileIndex`). Attempts to select across file boundaries or delete headers are safely blocked.
4. **Cursor Position Preservation**:
   When external file changes rebuild the virtual index, `MultibufferPanel` records the active `fileId` and `localLine` before refresh and restores the cursor to the exact local line within that file afterward.
5. **Async Original Content Resolution**:
   `AnycodeEditor` exposes `pendingOriginalContent` so `getOriginalText()` immediately provides the Git HEAD baseline content even while Tree-Sitter WASM parsers initialize asynchronously in the background.

---

## 🇷🇺 Документация на русском языке

### 1. Обзор
**Система мультибуферного ревью (Multi-buffer Review)** — это возможность Anycode, позволяющая просматривать и редактировать все изменённые файлы (или исторический Git-коммит) в едином непрерывном виртуальном полотне редактора (как в Cursor или VS Code).

Вместо постоянного переключения между десятками вкладок, архитектура мультибуфера объединяет буферы нескольких файлов в единую виртуальную систему координат под управлением класса `MultiBufferCode`.

---

### 2. Архитектура и ключевые компоненты

#### Основные модули:
- **`MultiBufferCode` (`anycode-base/src/multibuffer.ts`)**:
  Наследует `Code`. Строит единый виртуальный индекс строк (`IndexedRow[]`), состоящий из строк-заголовков и строк содержимого файлов. Транслирует глобальные офсеты и номера строк в локальные координаты каждого файла.
- **`DiffRenderer` и `LineRenderer` (`anycode-base/src/renderer/`)**:
  Рендерят кастомные заголовки файлов (`▾ filename.ts +A −B`), отображают локальную нумерацию строк (1, 2, 3... для каждого файла заново) и сворачивают неизмененный контекст в режиме **Focused Diff**.
- **`MultibufferPanel.tsx` (`anycode/features/editor/MultibufferPanel.tsx`)**:
  React-компонент, управляющий жизненным циклом общего `AnycodeEditor`, асинхронной подгрузкой файлов, подпиской на внешние изменения и сохранением позиции курсора.
- **Состояние по панелям (`App.tsx`)**:
  `multibufferReviews: Record<string, MultibufferReview>` обеспечивает независимые мультибуферы для каждой разделенной панели IDE (`paneId`).

---

### 3. Главные особенности и защитные механизмы

1. **Инкрементальное кэширование диффов по файлам**:
   Кэш `fileDiffs: Map<string, CachedFileDiff>` привязан к строковому `fileId`. Редактирование одного файла вызывает перерасчет диффа только для него, не затрагивая остальные файлы.
2. **Двусторонняя синхронизация в реальном времени**:
   - Правка в Мультибуфере ──► `onFileChange` ──► `notifyExternalChange()` у `AnycodeEditor` файла.
   - Правка в обычном вкладке файла ──► `addOnChangeListener` ──► `notifyFileChanged()` у `MultiBufferCode` ──► Обновление Мультибуфера.
3. **Защита от некорректных правок**:
   - **Защита заголовков**: Заголовки имеют `contentEditable = 'false'`, а методы `insertRaw` и `removeRaw` игнорируют попытки ввода/стирания на строке заголовка.
   - **Блокировка межфайлового удаления**: `removeRaw` проверяет, чтобы начало и конец удаляемого фрагмента находились в одном файле (`start.fileIndex === end.fileIndex`). Выделение через заголовок нескольких файлов не ломает структуру.
4. **Сохранение позиции курсора**:
   При обновлении индекса из-за внешних изменений `MultibufferPanel` запоминает `fileId` и `localLine` курсора и восстанавливает его в том же файле и на той же строке.
5. **Асинхронная инициализация оригиналов**:
   В `AnycodeEditor` добавлен `pendingOriginalContent`, благодаря чему `getOriginalText()` сразу отдаёт эталонный текст из Git HEAD, даже если Tree-Sitter WASM-парсер ещё загружается в фоне.
