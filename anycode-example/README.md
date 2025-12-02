# Anycode Editor Example

Простой пример использования пакета `anycode-base` для создания редактора кода на JavaScript.

## Установка

```bash
npm install
```

или

```bash
pnpm install
```

## Запуск

```bash
npm run dev
```

Откроется браузер на `http://localhost:3000` с работающим редактором.

## Сборка

```bash
npm run build
```

## Структура проекта

- `src/main.ts` - основной файл с примером использования редактора
- `index.html` - HTML страница
- `vite.config.js` - конфигурация Vite
- `package.json` - зависимости проекта

## Использование

Редактор автоматически загружает WASM файлы из пакета `anycode-base`. Если нужно использовать кастомный путь к WASM файлам, используйте:

```typescript
import { setWasmBasePath } from 'anycode-base';

setWasmBasePath('/wasm/'); // путь к WASM файлам
```

## Особенности

- ✅ Подсветка синтаксиса TypeScript
- ✅ Автодополнение кода
- ✅ Множественный курсор
- ✅ Поиск и замена
- ✅ И многое другое!

