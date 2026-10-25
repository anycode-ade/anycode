# List of all recipes
default:
  @just --list

run-frontend:
    cd anycode && pnpm run dev

build-frontend:
    cd anycode && pnpm run build

run-tauri:
    pnpm --filter anycode tauri dev

build-tauri:
    pnpm --filter anycode tauri build

run-backend:
    cargo run --manifest-path ./anycode-backend/Cargo.toml

build-backend: build-frontend
    cd anycode-backend && cargo build --release

install: build-frontend
    cd anycode-backend && cargo install --path .