#!/bin/bash
set -e

echo "🔨 Testing build process..."

if [ ! -d "anycode" ] || [ ! -d "anycode-backend" ]; then
    echo "❌ Error: Run this script from the project root"
    exit 1
fi

echo "📦 Installing dependencies..."
pnpm install --no-frozen-lockfile

echo "🏗️  Building frontend..."
cd anycode
pnpm build
cd ..

echo "✅ Verifying frontend build..."
if [ ! -d "anycode-backend/dist" ] || [ -z "$(ls -A anycode-backend/dist)" ]; then
    echo "❌ Error: dist directory is empty or missing"
    exit 1
fi

echo "Frontend build verified:"
ls -la anycode-backend/dist | head -10
echo "Total files: $(find anycode-backend/dist -type f | wc -l)"

echo "🦀 Building Rust backend..."
cd anycode-backend
cargo build --release

echo "📊 Binary info:"
ls -lh target/release/anycode
file target/release/anycode

echo "🧪 Testing --help flag..."
./target/release/anycode --help

echo "✅ Build test completed successfully!"

