#!/usr/bin/env sh

set -eu

REPO="${AGENTOS_REPO:-SapienXai/AgentOS}"
INSTALL_ROOT="${AGENTOS_INSTALL_ROOT:-$HOME/.agentos}"
BIN_DIR="${AGENTOS_BIN_DIR:-$HOME/.local/bin}"
REQUESTED_VERSION="${AGENTOS_VERSION:-latest}"
ASSET_PLATFORM=""
ASSET_ARCH=""

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

detect_platform() {
  case "$(uname -s)" in
    Darwin)
      ASSET_PLATFORM="darwin"
      ;;
    Linux)
      ASSET_PLATFORM="linux"
      ;;
    *)
      echo "Unsupported operating system: $(uname -s). Use install.ps1 on Windows." >&2
      exit 1
      ;;
  esac

  case "$(uname -m)" in
    arm64|aarch64)
      ASSET_ARCH="arm64"
      ;;
    x86_64|amd64)
      ASSET_ARCH="x64"
      ;;
    *)
      echo "Unsupported CPU architecture: $(uname -m)" >&2
      exit 1
      ;;
  esac
}

assert_node_version() {
  require_command node

  if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 20 || (major === 20 && minor >= 9) ? 0 : 1);'; then
    echo "AgentOS requires Node.js 20.9 or newer." >&2
    exit 1
  fi
}

download_file() {
  url="$1"
  target="$2"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$target"
    return
  fi

  if command -v wget >/dev/null 2>&1; then
    wget -qO "$target" "$url"
    return
  fi

  echo "Missing downloader: install curl or wget first." >&2
  exit 1
}

verify_checksum() {
  checksum_file="$1"
  artifact_file="$2"

  if command -v shasum >/dev/null 2>&1; then
    (
      cd "$(dirname "$artifact_file")"
      shasum -a 256 -c "$(basename "$checksum_file")"
    )
    return
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    (
      cd "$(dirname "$artifact_file")"
      sha256sum -c "$(basename "$checksum_file")"
    )
    return
  fi

  echo "No checksum tool found; skipping SHA-256 verification."
}

render_launcher() {
  launcher_path="$1"
  install_root="$2"

  cat >"$launcher_path" <<EOF
#!/usr/bin/env sh
exec node "$install_root/package/bin/agentos.js" "\$@"
EOF

  chmod +x "$launcher_path"
}

print_completion() {
  launcher_path="$1"

  echo "Installed AgentOS to $INSTALL_ROOT/package"
  echo "Launcher: $launcher_path"
  echo "Try: agentos doctor"
  echo "Then: agentos start --open"
  echo "Stop later: agentos stop"
  echo "Remove later: agentos uninstall"

  case ":$PATH:" in
    *":$BIN_DIR:"*)
      ;;
    *)
      echo "Add $BIN_DIR to your PATH if 'agentos' is not found."
      echo "Example:"
      echo "  export PATH=\"$BIN_DIR:\$PATH\""
      ;;
  esac
}

detect_platform
assert_node_version

ARTIFACT_NAME="agentos-${ASSET_PLATFORM}-${ASSET_ARCH}.tgz"
CHECKSUM_NAME="${ARTIFACT_NAME}.sha256"

if [ "$REQUESTED_VERSION" = "latest" ]; then
  RELEASE_PATH="latest/download"
else
  RELEASE_PATH="download/agentos-v${REQUESTED_VERSION}"
fi

BASE_URL="https://github.com/${REPO}/releases/${RELEASE_PATH}"
ARTIFACT_URL="${BASE_URL}/${ARTIFACT_NAME}"
CHECKSUM_URL="${BASE_URL}/${CHECKSUM_NAME}"

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agentos-install.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

ARTIFACT_FILE="$TMP_DIR/$ARTIFACT_NAME"
CHECKSUM_FILE="$TMP_DIR/$CHECKSUM_NAME"
LAUNCHER_PATH="$BIN_DIR/agentos"

echo "Downloading ${ARTIFACT_URL}"
download_file "$ARTIFACT_URL" "$ARTIFACT_FILE"

if download_file "$CHECKSUM_URL" "$CHECKSUM_FILE"; then
  verify_checksum "$CHECKSUM_FILE" "$ARTIFACT_FILE"
fi

mkdir -p "$INSTALL_ROOT" "$BIN_DIR"
rm -rf "$INSTALL_ROOT/package"
tar -xzf "$ARTIFACT_FILE" -C "$INSTALL_ROOT"
render_launcher "$LAUNCHER_PATH" "$INSTALL_ROOT"
print_completion "$LAUNCHER_PATH"
