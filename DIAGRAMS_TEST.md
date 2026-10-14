# 🎨 Anycode Mermaid Diagrams Showcase

Этот файл предназначен для проверки и демонстрации рендеринга Mermaid-диаграмм в Markdown Preview и чате Anycode.

---

## 1. Архитектура Anycode (Flowchart)

```mermaid
flowchart TD
    subgraph Client["Frontend (React 19 + TypeScript)"]
        UI["Dockview Workspace Layout"]
        Editor["Custom Virtual Editor (Tree-Sitter WASM)"]
        TerminalUI["@wterm/dom Terminal"]
        AgentUI["ACP Agent Chat & Tools"]
        MermaidView["Mermaid Live Renderer"]
    end

    subgraph Backend["Backend (Rust + Axum + Tokio)"]
        Router["Axum Web Server & Auth Middleware"]
        SockIO["Socket.IO Gateway"]
        PTY["PTY Manager (Portable-PTY)"]
        LspMgr["LSP Process Manager"]
        AcpCore["ACP Protocol Handler"]
        DB[(SQLite / Zstd Tool Outputs)]
    end

    subgraph External["External Tools & AI"]
        Claude["Claude Code / ACP Agents"]
        RustAnalyzer["rust-analyzer / Language Servers"]
        OSShell["System Shell (zsh / bash / pwsh)"]
    end

    UI --> SockIO
    Editor --> SockIO
    TerminalUI --> SockIO
    AgentUI --> SockIO

    SockIO --> Router
    Router --> PTY
    Router --> LspMgr
    Router --> AcpCore
    AcpCore --> DB

    PTY <--> OSShell
    LspMgr <--> RustAnalyzer
    AcpCore <--> Claude
```

---

## 2. Протокол Аутентификации (Sequence Diagram)

```mermaid
sequenceDiagram
    autonumber
    actor User as Разработчик
    participant Browser as Браузер / Anycode Web
    participant Server as Axum Server
    participant Socket as Socket.IO Hub

    User->>Browser: Открытие http://localhost:3000?token=secret123
    Browser->>Server: GET /?token=secret123
    Server->>Server: Валидация токена
    Server-->>Browser: 200 OK + Set-Cookie: anycode_token=... (HttpOnly)
    
    Browser->>Socket: WebSocket Handshake (Cookie / Query token)
    Socket->>Socket: Проверка сессии
    alt Токен валиден
        Socket-->>Browser: Connection Established (sid)
        Browser->>Socket: emit('open_file', { path: 'main.rs' })
        Socket-->>Browser: on('file_content', { text: '...' })
    else Токен не указан или неверен
        Socket-->>Browser: 401 Unauthorized (Disconnect)
    end
```

---

## 3. Жизненный цикл задачи AI Агента (State Diagram)

```mermaid
stateDiagram-v2
    [*] --> Idle: Агент подключен

    Idle --> Thinking: Пользователь отправил промпт
    Thinking --> ToolCalling: Вызов инструмента (Bash / Read / Edit)
    
    state ToolCalling {
        [*] --> RequestingPermission: Требуется одобрение
        RequestingPermission --> Executing: Одобрено
        RequestingPermission --> Cancelled: Отклонено
        Executing --> StreamingOutput: Запуск процесса
        StreamingOutput --> Completed: Код возврата 0
        StreamingOutput --> ErrorState: Ошибка выполнения
    }

    ToolCalling --> Thinking: Обработка результатов
    Thinking --> StreamingMessage: Генерация ответа
    StreamingMessage --> Idle: Ответ завершен
    Thinking --> Idle: Готово
    
    Idle --> [*]: Завершение сессии
```

---

## 4. Ветвление релизов (Git Graph)

```mermaid
gitGraph
    commit id: "Initial v0.1.0"
    commit id: "Add LSP & Terminal"
    branch feature/token-auth
    checkout feature/token-auth
    commit id: "Add --token flag"
    commit id: "HttpOnly cookies"
    checkout main
    merge feature/token-auth id: "Merge auth" tag: "v0.1.2"
    branch feature/mermaid
    checkout feature/mermaid
    commit id: "Add mermaid lib"
    commit id: "Code-split chunk"
    commit id: "Zoom & Code toggle"
    checkout main
    merge feature/mermaid id: "Mermaid release"
```

---

## 5. Структура БД сессий ACP (Entity Relationship)

```mermaid
erDiagram
    SESSION ||--o{ MESSAGE : contains
    SESSION ||--o{ CHECKPOINT : has
    MESSAGE ||--o{ TOOL_CALL : invokes
    TOOL_CALL ||--o| TOOL_OUTPUT : stores

    SESSION {
        string id PK
        string agent_name
        timestamp created_at
        timestamp updated_at
    }

    MESSAGE {
        string id PK
        string session_id FK
        string role
        string content
        timestamp timestamp
    }

    TOOL_CALL {
        string id PK
        string message_id FK
        string tool_name
        string arguments
        string status
    }

    TOOL_OUTPUT {
        string tool_id PK
        blob zstd_compressed_data
        int raw_byte_size
    }

    CHECKPOINT {
        string id PK
        string session_id FK
        string file_path
        string diff_content
        timestamp created_at
    }
```
