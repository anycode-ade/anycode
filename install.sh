#!/bin/sh

set -eu

REPO="${ANYCODE_REPO:-anycode-ide/anycode}"
VERSION="${ANYCODE_VERSION:-latest}"
PREFIX="${ANYCODE_INSTALL_DIR:-}"

usage() {
  cat <<'EOF'
Usage: install.sh [--version TAG] [--prefix DIR] [--repo OWNER/REPO]

Environment variables:
  ANYCODE_REPO           GitHub repository, default: anycode-ide/anycode
  ANYCODE_VERSION        Release tag to install, default: latest
  ANYCODE_INSTALL_DIR    Installation directory, default: ~/.local/bin or /usr/local/bin for root
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --version)
      VERSION="${2:?missing value for --version}"
      shift 2
      ;;
    --prefix)
      PREFIX="${2:?missing value for --prefix}"
      shift 2
      ;;
    --repo)
      REPO="${2:?missing value for --repo}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
  Darwin)
    asset="anycode-universal-apple-darwin.tar.gz"
    ;;
  Linux)
    case "$arch" in
      x86_64|amd64)
        asset="anycode-linux-x86_64-musl.tar.gz"
        ;;
      aarch64|arm64)
        asset="anycode-linux-aarch64-musl.tar.gz"
        ;;
      *)
        echo "Unsupported Linux architecture: $arch" >&2
        exit 1
        ;;
    esac
    ;;
  *)
    echo "Unsupported operating system: $os" >&2
    exit 1
    ;;
esac

if [ -z "$PREFIX" ]; then
  if [ "$(id -u)" -eq 0 ]; then
    PREFIX="/usr/local/bin"
  else
    PREFIX="${HOME}/.local/bin"
  fi
fi

mkdir -p "$PREFIX"

if [ ! -w "$PREFIX" ]; then
  echo "Install directory is not writable: $PREFIX" >&2
  echo "Try: sudo sh install.sh --prefix /usr/local/bin" >&2
  exit 1
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT INT TERM

archive="$tmpdir/$asset"
extract_dir="$tmpdir/extract"
mkdir -p "$extract_dir"

download_url="https://github.com/$REPO/releases/latest/download/$asset"
if [ "$VERSION" != "latest" ]; then
  download_url="https://github.com/$REPO/releases/download/$VERSION/$asset"
fi

echo "Downloading $asset from $download_url"

if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$download_url" -o "$archive"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$archive" "$download_url"
else
  echo "Need either curl or wget to download the release" >&2
  exit 1
fi

tar -xzf "$archive" -C "$extract_dir"

if [ ! -f "$extract_dir/anycode" ]; then
  echo "Archive did not contain expected binary: anycode" >&2
  exit 1
fi

install_bin="$PREFIX/anycode"
cp "$extract_dir/anycode" "$install_bin"
chmod 755 "$install_bin"

echo "Installed anycode to $install_bin"

case ":$PATH:" in
  *":$PREFIX:"*)
    ;;
  *)
    echo "Add $PREFIX to your PATH if it is not there yet."
    ;;
esac
