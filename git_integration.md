# Git Integration — План реализации

## Обзор
Добавление поддержки Git в редактор: панель Changes с изменёнными файлами и diff-подсветка в редакторе.

**Оценка времени:** ~2 дня

---

## Фаза 1: Backend — Git2 интеграция

### 1.1 Добавить git2 в проект
**Файл:** `anycode-backend/Cargo.toml`

```toml
[dependencies]
git2 = "0.19"
```

### 1.2 Создать модуль git_handler
**Файл:** `anycode-backend/src/handlers/git_handler.rs`

Функции:
- `get_repo_status()` — получить список изменённых файлов
- `get_file_from_head(path)` — получить содержимое файла из HEAD
- `get_changed_files()` — вернуть список с типами изменений

Структуры:
```rust
#[derive(Serialize, Clone)]
pub struct GitFileStatus {
    pub path: String,
    pub status: String,  // "modified" | "added" | "deleted" | "untracked"
}

#[derive(Serialize)]
pub struct GitStatusResponse {
    pub files: Vec<GitFileStatus>,
    pub branch: String,
}
```

### 1.3 WebSocket события
**Файл:** `anycode-backend/src/main.rs`

Добавить обработчики:
- `git:status` → возвращает `GitStatusResponse`
- `git:file-original` → возвращает содержимое файла из HEAD

---

## Фаза 2: Frontend — Панель Changes

### 2.1 Создать компонент ChangesPanel
**Файл:** `anycode/components/ChangesPanel.tsx`

```tsx
interface ChangedFile {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked';
}

interface ChangesPanelProps {
  files: ChangedFile[];
  onFileClick: (path: string) => void;
}
```

UI:
- Простой список (не дерево!)
- Иконка статуса слева (M/A/D/U)
- Имя файла + путь серым
- Hover эффект
- Клик открывает файл в diff режиме

### 2.2 Стили для ChangesPanel
**Файл:** `anycode/components/ChangesPanel.css`

- Цвета статусов:
  - Modified: желтый/оранжевый
  - Added: зеленый
  - Deleted: красный
  - Untracked: серый

### 2.3 Интеграция в App.tsx
**Файл:** `anycode/App.tsx`

- Добавить state для `changedFiles`
- Добавить sidebar tab "Changes" рядом с "Files"
- Запрашивать `git:status` при монтировании и после file save

---

## Фаза 3: Интеграция diff в редакторе

### 3.1 Получение оригинала из Git
**Файл:** `anycode/App.tsx`

При открытии файла из Changes панели:
1. Запросить `git:file-original` с путём файла
2. Получить оригинальное содержимое
3. Вызвать `editor.setOriginalCode(originalContent)`
4. Вызвать `editor.setDiffEnabled(true)`

### 3.2 Добавить метод setOriginalCode
**Файл:** `anycode-base/src/editor.ts`

```typescript
public setOriginalCode(content: string): void {
    this.originalCode = content;
    if (this.diffEnabled) {
        const currentText = this.code.getContent();
        this.diffs = computeGitChanges(this.originalCode, currentText);
        this.renderer.render(this.getEditorState(), this.search);
    }
}
```

---

## Фаза 4: Авто-обновление статуса

### 4.1 File watcher для .git
**Файл:** `anycode-backend/src/main.rs`

- Следить за изменениями в `.git/index`
- При изменении — отправлять `git:status-updated` всем клиентам

### 4.2 Frontend подписка
- Слушать `git:status-updated`
- Обновлять список файлов в ChangesPanel

---

## Структура файлов

```
anycode-backend/src/
├── handlers/
│   └── git_handler.rs    # NEW

anycode/
├── components/
│   ├── ChangesPanel.tsx  # NEW
│   └── ChangesPanel.css  # NEW

anycode-base/src/
├── editor.ts             # MODIFY (add setOriginalCode)
```

---

## Тестирование

1. [ ] `git:status` возвращает корректный список файлов
2. [ ] `git:file-original` возвращает содержимое из HEAD
3. [ ] ChangesPanel отображает файлы с правильными статусами
4. [ ] Клик по файлу открывает его с diff подсветкой
5. [ ] Diff корректно показывает изменения относительно HEAD
6. [ ] Статус обновляется после сохранения файла

---

## Будущие улучшения (v2)

- [ ] Stage/Unstage файлов
- [ ] Commit из IDE
- [ ] Показ статуса в file tree (иконки M/A/D)
- [ ] Git blame
- [ ] История коммитов
- [ ] Ветки и переключение
