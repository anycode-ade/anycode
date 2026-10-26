import { describe, it, expect, beforeAll } from 'vitest';
import { Code } from '../src/code';
import { setWasmBasePath } from '../src/utils';
import * as path from 'path';

describe('Folding and AST Parsing Smoke Tests', () => {
    beforeAll(() => {
        // Set path for local wasm binaries
        setWasmBasePath(path.resolve(__dirname, '../wasm') + '/');
    });

    describe('C and C++', () => {
        it('should parse C code and return fold ranges', async () => {
            const cCode = `
#include <stdio.h>

#define MAX_VAL 100

// Helper struct
struct Point {
    int x;
    int y;
};

/*
 * Multi-line comment
 * for test.
 */
int add(int a, int b) {
    return a + b;
}

int main() {
    struct Point p = {10, 20};
    int sum = add(p.x, p.y);

    #if DEBUG
    printf("Debug mode\\n");
    #else
    printf("Release mode: %d\\n", sum);
    #endif

    for (int i = 0; i < 10; i++) {
        if (i % 2 == 0) {
            printf("%d is even\\n", i);
        }
    }

    return 0;
}
`;
            const code = new Code(cCode, 'test.c', 'c');
            await code.init();

            const foldRanges = code.getFoldRanges();
            expect(foldRanges).toEqual([
                { startLine: 6, endLine: 9, kind: 'struct_specifier' },
                { startLine: 11, endLine: 14, kind: 'comment' },
                { startLine: 15, endLine: 17, kind: 'function_definition' },
                { startLine: 19, endLine: 36, kind: 'function_definition' },
                { startLine: 23, endLine: 27, kind: 'preproc_if' },
                { startLine: 25, endLine: 26, kind: 'preproc_else' },
                { startLine: 29, endLine: 33, kind: 'compound_statement' },
                { startLine: 30, endLine: 32, kind: 'compound_statement' }
            ]);
        });

        it('should parse C++ code and return fold ranges', async () => {
            const cppCode = `
#include <iostream>
#include <vector>

namespace Geometry {
    class Shape {
    public:
        virtual double area() const = 0;
    };

    class Circle : public Shape {
    private:
        double radius;
    public:
        Circle(double r) : radius(r) {}
        double area() const override {
            return 3.14159 * radius * radius;
        }
    };
}

template <typename T>
T add(T a, T b) {
    return a + b;
}

int main() {
    Geometry::Circle c(5.0);
    std::cout << c.area() << std::endl;
    return 0;
}
`;
            const code = new Code(cppCode, 'test.cpp', 'cpp');
            await code.init();

            const foldRanges = code.getFoldRanges();
            expect(foldRanges).toEqual([
                { startLine: 4, endLine: 19, kind: 'namespace_definition' },
                { startLine: 5, endLine: 8, kind: 'class_specifier' },
                { startLine: 10, endLine: 18, kind: 'class_specifier' },
                { startLine: 15, endLine: 17, kind: 'function_definition' },
                { startLine: 21, endLine: 24, kind: 'template_declaration' },
                { startLine: 22, endLine: 24, kind: 'function_definition' },
                { startLine: 26, endLine: 30, kind: 'function_definition' }
            ]);
        });
    });

    describe('Go', () => {
        it('should parse Go code and return fold ranges', async () => {
            const goCode = `
package main

import (
	"fmt"
	"sync"
)

// Main struct
type Config struct {
	Host string
	Port int
}

type Runner interface {
	Run() error
	Stop()
}

const (
	StatusOk = 200
	StatusErr = 500
)

var (
	mu sync.Mutex
	cache = make(map[string]string)
)

func main() {
	cfg := Config{
		Host: "localhost",
		Port: 8080,
	}

	fmt.Println(cfg)

	if cfg.Port > 0 {
		fmt.Println("Port is configured")
	}

	switch cfg.Port {
	case 8080:
		fmt.Println("Standard port")
	default:
		fmt.Println("Other port")
	}

	var i interface{} = "hello"
	switch v := i.(type) {
	case string:
		fmt.Println(v)
	case int:
		fmt.Println(v)
	}

	ch := make(chan int)
	select {
	case x := <-ch:
		fmt.Println(x)
	default:
		fmt.Println("no communication")
	}
}
`;
            const code = new Code(goCode, 'test.go', 'go');
            await code.init();

            const foldRanges = code.getFoldRanges();
            expect(foldRanges).toEqual([
                { startLine: 3, endLine: 6, kind: 'import_spec_list' },
                { startLine: 9, endLine: 12, kind: 'struct_type' },
                { startLine: 14, endLine: 17, kind: 'interface_type' },
                { startLine: 19, endLine: 22, kind: 'const_declaration' },
                { startLine: 24, endLine: 27, kind: 'var_declaration' },
                { startLine: 29, endLine: 63, kind: 'function_declaration' },
                { startLine: 30, endLine: 33, kind: 'literal_value' },
                { startLine: 37, endLine: 39, kind: 'block' },
                { startLine: 41, endLine: 46, kind: 'expression_switch_statement' },
                { startLine: 42, endLine: 44, kind: 'expression_case' },
                { startLine: 44, endLine: 46, kind: 'default_case' },
                { startLine: 49, endLine: 54, kind: 'type_switch_statement' },
                { startLine: 50, endLine: 52, kind: 'type_case' },
                { startLine: 52, endLine: 54, kind: 'type_case' },
                { startLine: 57, endLine: 62, kind: 'select_statement' },
                { startLine: 58, endLine: 60, kind: 'communication_case' },
                { startLine: 60, endLine: 62, kind: 'default_case' }
            ]);
        });
    });

    describe('Java and Kotlin', () => {
        it('should parse Java code and return fold ranges', async () => {
            const javaCode = `
package com.example;

import java.util.List;
import java.util.ArrayList;

/**
 * Main Class comment
 */
public class App {
    private final List<String> items = new ArrayList<String>() {{
        add("hello");
        add("world");
    }};

    public static void main(String[] args) {
        System.out.println("Java Main");
        
        for (int i = 0; i < 5; i++) {
            if (i % 2 == 0) {
                System.out.println(i);
            }
        }

        switch (args.length) {
            case 0:
                System.out.println("No args");
                break;
            default:
                System.out.println("Args");
                break;
        }
    }
}
`;
            const code = new Code(javaCode, 'App.java', 'java');
            await code.init();

            const foldRanges = code.getFoldRanges();
            expect(foldRanges).toEqual([
                { startLine: 6, endLine: 8, kind: 'block_comment' },
                { startLine: 9, endLine: 33, kind: 'class_declaration' },
                { startLine: 10, endLine: 13, kind: 'class_body' },
                { startLine: 15, endLine: 32, kind: 'method_declaration' },
                { startLine: 18, endLine: 22, kind: 'block' },
                { startLine: 19, endLine: 21, kind: 'block' },
                { startLine: 24, endLine: 31, kind: 'switch_block' },
                { startLine: 25, endLine: 27, kind: 'switch_block_statement_group' },
                { startLine: 28, endLine: 30, kind: 'switch_block_statement_group' }
            ]);
        });

        it('should parse Kotlin code and return fold ranges', async () => {
            const kotlinCode = `
package com.example

import java.util.ArrayList

/**
 * Kotlin Class comment
 */
class MainApp {
    val items = listOf("hello", "world")

    fun run(args: Array<String>) {
        println("Kotlin Run")

        items.forEach { item ->
            println(item)
        }

        when (args.size) {
            0 -> println("No args")
            else -> println("Args")
        }
    }
}
`;
            const code = new Code(kotlinCode, 'MainApp.kt', 'kotlin');
            await code.init();

            const foldRanges = code.getFoldRanges();
            expect(foldRanges).toEqual([
                { startLine: 3, endLine: 7, kind: 'import_list' },
                { startLine: 5, endLine: 7, kind: 'multiline_comment' },
                { startLine: 8, endLine: 23, kind: 'class_declaration' },
                { startLine: 11, endLine: 22, kind: 'function_declaration' },
                { startLine: 12, endLine: 21, kind: 'statements' },
                { startLine: 14, endLine: 16, kind: 'lambda_literal' },
                { startLine: 18, endLine: 21, kind: 'when_expression' }
            ]);
        });
    });

    describe('Lua', () => {
        it('should parse Lua code and return fold ranges', async () => {
            const luaCode = `-- Lua test file for Anycode folding validation
-- Covers tables, functions, control flow, and nested blocks.

local M = {}

-- Application configuration
local config = {
    host = "127.0.0.1",
    port = 8080,
    tags = { "ide", "editor", "lsp" },
    owner = {
        name = "Max",
        email = "max@example.com",
    },
}

local function validate_config(cfg)
    if cfg.host == "" then
        return false, "empty host"
    end
    if cfg.port <= 0 then
        return false, "invalid port"
    end
    return true
end

function M.start(mode)
    local ok, err = validate_config(config)
    if not ok then
        error(err)
    end

    print("Starting in mode: " .. mode)

    for i = 1, 5 do
        if i % 2 == 0 then
            print(i .. " is even")
        else
            print(i .. " is odd")
        end
    end

    local n = 3
    while n > 0 do
        print("countdown: " .. n)
        n = n - 1
    end

    repeat
        print("repeat once more")
        n = n - 1
    until n <= 0

    do
        local nested = {
            enabled = true,
            retries = 3,
        }
        if nested.enabled then
            for _, tag in ipairs(config.tags) do
                print("tag: " .. tag)
            end
        end
    end
end

function M.describe_services()
    local services = {
        backend = { image = "anycode/backend:latest", port = 8080 },
        frontend = { image = "anycode/frontend:latest", port = 5173 },
    }
    return services
end

return M
`;
            const code = new Code(luaCode, 'test.lua', 'lua');
            await code.init();

            const foldRanges = code.getFoldRanges();
            expect(foldRanges).toEqual([
                { startLine: 0, endLine: 1, kind: 'comment' },
                { startLine: 3, endLine: 5, kind: 'comment' },
                { startLine: 6, endLine: 14, kind: 'tableconstructor' },
                { startLine: 7, endLine: 13, kind: 'fieldlist' },
                { startLine: 10, endLine: 13, kind: 'tableconstructor' },
                { startLine: 11, endLine: 12, kind: 'fieldlist' },
                { startLine: 17, endLine: 19, kind: 'if_statement' },
                { startLine: 17, endLine: 23, kind: 'function_body' },
                { startLine: 20, endLine: 22, kind: 'if_statement' },
                { startLine: 27, endLine: 63, kind: 'function_body' },
                { startLine: 28, endLine: 30, kind: 'if_statement' },
                { startLine: 34, endLine: 40, kind: 'for_statement' },
                { startLine: 35, endLine: 39, kind: 'if_statement' },
                { startLine: 43, endLine: 46, kind: 'while_statement' },
                { startLine: 48, endLine: 51, kind: 'repeat_statement' },
                { startLine: 53, endLine: 63, kind: 'do_statement' },
                { startLine: 54, endLine: 57, kind: 'tableconstructor' },
                { startLine: 55, endLine: 56, kind: 'fieldlist' },
                { startLine: 58, endLine: 62, kind: 'if_statement' },
                { startLine: 59, endLine: 61, kind: 'for_statement' },
                { startLine: 67, endLine: 70, kind: 'tableconstructor' },
                { startLine: 67, endLine: 71, kind: 'function_body' },
                { startLine: 68, endLine: 69, kind: 'fieldlist' }
            ]);
        });

    });

    describe('YAML', () => {
        it('should parse YAML code and return fold ranges', async () => {
            const yamlCode = `# YAML Test File for Anycode folding validation
# This file contains various block mappings, sequences, flow styles,
# and block scalars to test fold toggle visibility and action.

version: "3.8"

# Metadata section
metadata:
  name: "anycode-refactor-service"
  environment: "production"
  tags:
    - "ide"
    - "editor"
    - "lsp"
    - "acp"
  owner:
    name: "Max"
    email: "max@example.com"
    teams: [frontend, backend, ai]

# Services configuration
services:
  # Axum-based Rust backend
  backend:
    image: "anycode/backend:latest"
    build:
      context: "./anycode-backend"
      dockerfile: "Dockerfile.prod"
    ports:
      - "8080:8080"
    environment:
      - RUST_LOG=info
      - DATABASE_URL=postgres://user:password@db:5432/anycode
      - REDIS_URL=redis://redis:6379/0
    depends_on:
      - db
      - redis
    volumes:
      - "/var/run/docker.sock:/var/run/docker.sock"
      - "./anycode-backend/data:/app/data"
    deploy:
      resources:
        limits:
          cpus: "2.0"
          memory: "2gb"

  # React 19 Frontend
  frontend:
    image: "anycode/frontend:latest"
    build:
      context: "./anycode"
      dockerfile: "Dockerfile.dev"
    ports:
      - "5173:5173"
    environment:
      - VITE_BACKEND_URL=http://localhost:8080
      - VITE_ENABLE_ACP=true
    depends_on:
      - backend

  # Database service
  db:
    image: "postgres:15-alpine"
    volumes:
      - "postgres_data:/var/lib/postgresql/data"
    environment:
      POSTGRES_USER: "user"
      POSTGRES_PASSWORD: "password"
      POSTGRES_DB: "anycode"

  # Cache service
  redis:
    image: "redis:7-alpine"
    command: "redis-server --appendonly yes"
    volumes:
      - "redis_data:/data"

# Volumes mapping
volumes:
  postgres_data:
    driver: "local"
  redis_data:
    driver: "local"

# Custom commands or configuration profiles
profiles:
  development:
    # Flow mappings
    features: { lsp: true, autocomplete: true, terminal: true, copilot: false }
    allowed_hosts: ["localhost", "127.0.0.1", "[::1]"]
    
  production:
    features: { lsp: true, autocomplete: true, terminal: true, copilot: true }
    # Block scalar representing configuration templates
    nginx_config: |
      server {
          listen 80;
          server_name anycode.dev;
          location / {
              proxy_pass http://frontend:5173;
              proxy_http_version 1.1;
              proxy_set_header Upgrade $http_upgrade;
              proxy_set_header Connection 'upgrade';
              proxy_set_header Host $host;
              proxy_cache_bypass $http_upgrade;
          }
      }
    
    release_notes: >
      This release brings a complete rewrite of the virtual rendering logic in anycode-base,
      offering up to 10x faster scroll speeds on large files and full integration of Tree-Sitter
      syntax parsing directly inside web-tree-sitter. It also introduces optional code folding!
`;
            const code = new Code(yamlCode, 'test.yaml', 'yaml');
            await code.init();

            const foldRanges = code.getFoldRanges();
            expect(foldRanges).toEqual([
                { startLine: 7, endLine: 20, kind: 'block_mapping_pair' },
                { startLine: 10, endLine: 14, kind: 'block_mapping_pair' },
                { startLine: 15, endLine: 20, kind: 'block_mapping_pair' },
                { startLine: 21, endLine: 77, kind: 'block_mapping_pair' },
                { startLine: 23, endLine: 46, kind: 'block_mapping_pair' },
                { startLine: 25, endLine: 27, kind: 'block_mapping_pair' },
                { startLine: 28, endLine: 29, kind: 'block_mapping_pair' },
                { startLine: 30, endLine: 33, kind: 'block_mapping_pair' },
                { startLine: 34, endLine: 36, kind: 'block_mapping_pair' },
                { startLine: 37, endLine: 39, kind: 'block_mapping_pair' },
                { startLine: 40, endLine: 46, kind: 'block_mapping_pair' },
                { startLine: 41, endLine: 46, kind: 'block_mapping_pair' },
                { startLine: 42, endLine: 46, kind: 'block_mapping_pair' },
                { startLine: 47, endLine: 60, kind: 'block_mapping_pair' },
                { startLine: 49, endLine: 51, kind: 'block_mapping_pair' },
                { startLine: 52, endLine: 53, kind: 'block_mapping_pair' },
                { startLine: 54, endLine: 56, kind: 'block_mapping_pair' },
                { startLine: 57, endLine: 60, kind: 'block_mapping_pair' },
                { startLine: 61, endLine: 70, kind: 'block_mapping_pair' },
                { startLine: 63, endLine: 64, kind: 'block_mapping_pair' },
                { startLine: 65, endLine: 70, kind: 'block_mapping_pair' },
                { startLine: 71, endLine: 77, kind: 'block_mapping_pair' },
                { startLine: 74, endLine: 77, kind: 'block_mapping_pair' },
                { startLine: 78, endLine: 84, kind: 'block_mapping_pair' },
                { startLine: 79, endLine: 80, kind: 'block_mapping_pair' },
                { startLine: 81, endLine: 84, kind: 'block_mapping_pair' },
                { startLine: 85, endLine: 112, kind: 'block_mapping_pair' },
                { startLine: 86, endLine: 89, kind: 'block_mapping_pair' },
                { startLine: 91, endLine: 112, kind: 'block_mapping_pair' },
                { startLine: 94, endLine: 106, kind: 'block_mapping_pair' },
                { startLine: 108, endLine: 112, kind: 'block_mapping_pair' }
            ]);
        });
    });

    describe('Zig', () => {
        it('should parse Zig code and return fold ranges', async () => {
            const zigCode = `// Zig test file for Anycode folding validation
// Covers structs, enums, functions, control flow, and nested blocks.

const std = @import("std");

/// Application configuration
pub const Config = struct {
    host: []const u8,
    port: u16,
    tags: []const []const u8,

    pub fn init(host: []const u8, port: u16) Config {
        return Config{
            .host = host,
            .port = port,
            .tags = &.{},
        };
    }

    pub fn validate(self: Config) !void {
        if (self.host.len == 0) {
            return error.EmptyHost;
        }
        if (self.port == 0) {
            return error.InvalidPort;
        }
    }
};

pub const Mode = enum {
    dev,
    staging,
    prod,

    pub fn label(self: Mode) []const u8 {
        return switch (self) {
            .dev => "development",
            .staging => "staging",
            .prod => "production",
        };
    }
};

pub fn formatAddress(host: []const u8, port: u16) []const u8 {
    return std.fmt.allocPrint(std.heap.page_allocator, "{s}:{d}", .{ host, port }) catch "unknown";
}

pub fn main() !void {
    const cfg = Config.init("127.0.0.1", 8080);
    try cfg.validate();

    const mode = Mode.prod;
    std.debug.print("Mode: {s}\\n", .{mode.label()});
    std.debug.print("Addr: {s}\\n", .{formatAddress(cfg.host, cfg.port)});

    var sum: usize = 0;
    for (0..10) |i| {
        if (i % 2 == 0) {
            sum += i;
        } else {
            sum +%= 1;
        }
    }

    var n: i32 = 5;
    while (n > 0) : (n -= 1) {
        switch (n) {
            1, 2, 3 => std.debug.print("small {d}\\n", .{n}),
            else => std.debug.print("large {d}\\n", .{n}),
        }
    }

    defer std.debug.print("done\\n", .{});
}

test "config defaults" {
    const cfg = Config.init("localhost", 3000);
    try std.testing.expectEqual(@as(u16, 3000), cfg.port);
}

test "mode labels" {
    try std.testing.expectEqualStrings("production", Mode.prod.label());
}
`;
            const code = new Code(zigCode, 'test.zig', 'zig');
            await code.init();

            const foldRanges = code.getFoldRanges();
            expect(foldRanges).toEqual([
                { startLine: 5, endLine: 6, kind: 'doc_comment' },
                { startLine: 6, endLine: 27, kind: 'ContainerDecl' },
                { startLine: 11, endLine: 17, kind: 'Block' },
                { startLine: 12, endLine: 16, kind: 'InitList' },
                { startLine: 19, endLine: 26, kind: 'Block' },
                { startLine: 20, endLine: 22, kind: 'IfStatement' },
                { startLine: 23, endLine: 25, kind: 'IfStatement' },
                { startLine: 29, endLine: 41, kind: 'ContainerDecl' },
                { startLine: 34, endLine: 40, kind: 'Block' },
                { startLine: 43, endLine: 45, kind: 'Block' },
                { startLine: 47, endLine: 73, kind: 'Block' },
                { startLine: 56, endLine: 62, kind: 'LoopStatement' },
                { startLine: 57, endLine: 59, kind: 'BlockExpr' },
                { startLine: 57, endLine: 61, kind: 'IfStatement' },
                { startLine: 59, endLine: 61, kind: 'Block' },
                { startLine: 65, endLine: 70, kind: 'LoopStatement' },
                { startLine: 75, endLine: 78, kind: 'Block' },
                { startLine: 80, endLine: 82, kind: 'Block' }
            ]);
        });
    });

    describe('Rust', () => {
        it('should parse Rust code and return fold ranges', async () => {
            const rustCode = `// Rust test code
struct User {
    username: String,
    active: bool,
}

impl User {
    fn new(username: String) -> Self {
        User {
            username,
            active: true,
        }
    }
}

fn main() {
    let user = User::new(String::from("max"));
    if user.active {
        println!("User {} is active", user.username);
    }
}
`;
            const code = new Code(rustCode, 'main.rs', 'rust');
            await code.init();

            const foldRanges = code.getFoldRanges();
            expect(foldRanges).toEqual([
                { startLine: 1, endLine: 4, kind: 'struct_item' },
                { startLine: 6, endLine: 13, kind: 'impl_item' },
                { startLine: 7, endLine: 12, kind: 'function_item' },
                { startLine: 15, endLine: 20, kind: 'function_item' },
                { startLine: 17, endLine: 19, kind: 'block' }
            ]);
        });
    });

    describe('JavaScript', () => {
        it('should parse JavaScript code and return fold ranges', async () => {
            const jsCode = `// JS test code
const config = {
    host: 'localhost',
    port: 8080
};

class Logger {
    log(msg) {
        console.log(msg);
    }
}

function run() {
    const logger = new Logger();
    for (let i = 0; i < 3; i++) {
        logger.log(\`Run \${i}\`);
    }
}
`;
            const code = new Code(jsCode, 'main.js', 'javascript');
            await code.init();

            const foldRanges = code.getFoldRanges();
            expect(foldRanges).toEqual([
                { startLine: 1, endLine: 4, kind: 'object' },
                { startLine: 6, endLine: 10, kind: 'class_declaration' },
                { startLine: 7, endLine: 9, kind: 'method_definition' },
                { startLine: 12, endLine: 17, kind: 'function_declaration' },
                { startLine: 14, endLine: 16, kind: 'for_statement' }
            ]);
        });
    });

    describe('TypeScript', () => {
        it('should parse TypeScript code and return fold ranges', async () => {
            const tsCode = `// TS test code
interface Account {
    id: number;
    email: string;
}

class Session implements Account {
    id: number;
    email: string;
    constructor(id: number, email: string) {
        this.id = id;
        this.email = email;
    }
}

function processAccount(account: Account): void {
    if (account.id > 0) {
        console.log(\`Processing: \${account.email}\`);
    }
}
`;
            const code = new Code(tsCode, 'main.ts', 'typescript');
            await code.init();

            const foldRanges = code.getFoldRanges();
            expect(foldRanges).toEqual([
                { startLine: 1, endLine: 4, kind: 'interface_body' },
                { startLine: 6, endLine: 13, kind: 'class_declaration' },
                { startLine: 9, endLine: 12, kind: 'method_definition' },
                { startLine: 15, endLine: 19, kind: 'function_declaration' },
                { startLine: 16, endLine: 18, kind: 'if_statement' }
            ]);
        });
    });

    describe('Bash', () => {
        it('should parse Bash code and return fold ranges', async () => {
            const bashCode = `if [ "$1" = "hello" ]; then
    echo "Hello World"
else
    echo "Goodbye"
fi

for i in 1 2 3; do
    echo $i
done

my_func() {
    echo "Function"
}
`;
            const code = new Code(bashCode, 'main.sh', 'bash');
            await code.init();

            const foldRanges = code.getFoldRanges();
            expect(foldRanges).toEqual([
                { startLine: 0, endLine: 4, kind: 'if_statement' },
                { startLine: 6, endLine: 8, kind: 'for_statement' },
                { startLine: 10, endLine: 12, kind: 'function_definition' }
            ]);
        });
    });

    describe('C#', () => {
        it('should parse C# code and return fold ranges', async () => {
            const csharpCode = `using System;

namespace HelloWorld {
    class Program {
        static void Main(string[] args) {
            Console.WriteLine("Hello World");
            if (args.Length > 0) {
                for (int i = 0; i < args.Length; i++) {
                    Console.WriteLine(args[i]);
                }
            }
        }
    }
}
`;
            const code = new Code(csharpCode, 'main.cs', 'csharp');
            await code.init();

            const foldRanges = code.getFoldRanges();
            expect(foldRanges).toEqual([
                { startLine: 2, endLine: 13, kind: 'namespace_declaration' },
                { startLine: 3, endLine: 12, kind: 'class_declaration' },
                { startLine: 4, endLine: 11, kind: 'method_declaration' },
                { startLine: 6, endLine: 10, kind: 'block' },
                { startLine: 7, endLine: 9, kind: 'block' }
            ]);
        });
    });

    describe('CSS', () => {
        it('should parse CSS code and return fold ranges', async () => {
            const cssCode = `.container {
    margin: 0 auto;
    padding: 20px;
}

@media (max-width: 600px) {
    .container {
        padding: 10px;
    }
}
`;
            const code = new Code(cssCode, 'main.css', 'css');
            await code.init();

            const foldRanges = code.getFoldRanges();
            expect(foldRanges).toEqual([
                { startLine: 0, endLine: 3, kind: 'rule_set' },
                { startLine: 5, endLine: 9, kind: 'media_statement' },
                { startLine: 6, endLine: 8, kind: 'rule_set' }
            ]);
        });
    });

    describe('HTML', () => {
        it('should parse HTML code and return fold ranges', async () => {
            const htmlCode = `<!DOCTYPE html>
<html>
<head>
    <title>Test Page</title>
</head>
<body>
    <div class="content">
        <h1>Hello World</h1>
        <p>Paragraph</p>
    </div>
</body>
</html>
`;
            const code = new Code(htmlCode, 'main.html', 'html');
            await code.init();

            const foldRanges = code.getFoldRanges();
            expect(foldRanges).toEqual([
                { startLine: 1, endLine: 11, kind: 'element' },
                { startLine: 2, endLine: 4, kind: 'element' },
                { startLine: 5, endLine: 10, kind: 'element' },
                { startLine: 6, endLine: 9, kind: 'element' }
            ]);
        });
    });

    describe('JSON', () => {
        it('should parse JSON code and return fold ranges', async () => {
            const jsonCode = `{
    "name": "anycode",
    "version": "1.0.0",
    "settings": {
        "theme": "dark",
        "fontSize": 14
    }
}
`;
            const code = new Code(jsonCode, 'main.json', 'json');
            await code.init();

            const foldRanges = code.getFoldRanges();
            expect(foldRanges).toEqual([
                { startLine: 0, endLine: 7, kind: 'object' },
                { startLine: 3, endLine: 6, kind: 'object' }
            ]);
        });
    });

    describe('Python', () => {
        it('should parse Python code and return fold ranges', async () => {
            const pythonCode = `def greet(name):
    if name:
        print(f"Hello, {name}")
    else:
        print("Hello, Guest")

class Calculator:
    def add(self, a, b):
        return a + b
`;
            const code = new Code(pythonCode, 'main.py', 'python');
            await code.init();

            const foldRanges = code.getFoldRanges();
            expect(foldRanges).toEqual([
                { startLine: 0, endLine: 4, kind: 'function_definition' },
                { startLine: 1, endLine: 4, kind: 'block' },
                { startLine: 6, endLine: 8, kind: 'class_definition' },
                { startLine: 7, endLine: 8, kind: 'block' }
            ]);
        });
    });

    describe('TOML', () => {
        it('should parse TOML code and return fold ranges', async () => {
            const tomlCode = `[package]
name = "anycode"
version = "1.0.0"

[dependencies]
serde = "1.0"
tokio = { version = "1.0", features = ["full"] }
`;
            const code = new Code(tomlCode, 'main.toml', 'toml');
            await code.init();

            const foldRanges = code.getFoldRanges();
            expect(foldRanges).toEqual([
                { startLine: 0, endLine: 4, kind: 'table' },
                { startLine: 4, endLine: 7, kind: 'table' }
            ]);
        });
    });
});
