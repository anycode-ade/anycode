#!/bin/sh

set -eu

REPO="${ANYCODE_REPO:-anycode-ade/anycode}"
VERSION="${ANYCODE_VERSION:-latest}"
COMMIT="${ANYCODE_COMMIT:-}"
PREFIX="${ANYCODE_INSTALL_DIR:-}"

usage() {
  cat <<'EOF'
Usage: install.sh [--version TAG] [--commit SHA] [--prefix DIR] [--repo OWNER/REPO]

Environment variables:
  ANYCODE_REPO           GitHub repository, default: anycode-ade/anycode
  ANYCODE_VERSION        Release tag to install, default: latest (or nightly)
  ANYCODE_COMMIT         Commit SHA to install (e.g. 582dd95)
  ANYCODE_INSTALL_DIR    Installation directory, default: ~/.local/bin or /usr/local/bin for root
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --version)
      VERSION="${2:?missing value for --version}"
      shift 2
      ;;
    --commit)
      COMMIT="${2:?missing value for --commit}"
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

# Resolve commit or version tag
if [ -n "$COMMIT" ]; then
  clean_commit="${COMMIT#commit-}"
  short_commit="$(echo "$clean_commit" | cut -c1-7)"
  VERSION="commit-$short_commit"
elif [ "$VERSION" != "latest" ] && [ "$VERSION" != "nightly" ] && [ "$VERSION" != "dev" ]; then
  case "$VERSION" in
    commit-*)
      ;;
    v*)
      ;;
    *)
      if echo "$VERSION" | grep -Eq '^[0-9a-fA-F]{7,40}$'; then
        short_commit="$(echo "$VERSION" | cut -c1-7)"
        VERSION="commit-$short_commit"
      fi
      ;;
  esac
fi

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

download_failed=0
if command -v curl >/dev/null 2>&1; then
  if ! curl -fsSL "$download_url" -o "$archive"; then
    download_failed=1
  fi
elif command -v wget >/dev/null 2>&1; then
  if ! wget -qO "$archive" "$download_url"; then
    download_failed=1
  fi
else
  echo "Need either curl or wget to download the release" >&2
  exit 1
fi

if [ "$download_failed" -eq 1 ]; then
  echo "Error: Failed to download $asset from $download_url" >&2
  if [ -n "$COMMIT" ] || [ "${VERSION#commit-}" != "$VERSION" ]; then
    echo "Make sure the Test Build workflow for this commit has completed successfully on GitHub:" >&2
    echo "  https://github.com/$REPO/actions" >&2
  fi
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

if command -v anycode >/dev/null 2>&1; then
  echo "anycode is already available in PATH."
else
  echo "anycode is not in PATH yet."
  shell_name="$(basename "${SHELL:-}")"
  case "$shell_name" in
    zsh)
      rc_file="${HOME}/.zshrc"
      ;;
    bash)
      rc_file="${HOME}/.bashrc"
      ;;
    *)
      rc_file="${HOME}/.profile"
      ;;
  esac
  echo "Run this command to add it:"
  echo "  echo 'export PATH=\"$PREFIX:\$PATH\"' >> \"$rc_file\""
  echo "Then run:"
  echo "  . \"$rc_file\""
  echo "Or for just this terminal session, run:"
  echo "  export PATH=\"$PREFIX:\$PATH\""
fi
