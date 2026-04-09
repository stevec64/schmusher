#!/bin/bash
# Install the native messaging host for LinkedIn Profile Schmusher (macOS/Linux).
# Usage: ./install.sh <chrome-extension-id>
#
# To find your extension ID:
#   1. Go to chrome://extensions
#   2. Enable "Developer mode"
#   3. Find "LinkedIn Profile Schmusher"
#   4. Copy the ID

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_NAME="com.schmusher.host"
HOST_PY="$SCRIPT_DIR/schmusher_host.py"

if [ -z "$1" ]; then
    echo "Usage: $0 <chrome-extension-id>"
    echo ""
    echo "Find your extension ID at chrome://extensions"
    exit 1
fi

EXT_ID="$1"

# Determine manifest directory based on OS
if [ "$(uname)" = "Darwin" ]; then
    MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
else
    MANIFEST_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
fi

MANIFEST_DEST="$MANIFEST_DIR/$HOST_NAME.json"

# Ensure the host script is executable
chmod +x "$HOST_PY"

# Check Python is available
if ! command -v python3 &> /dev/null; then
    echo "Error: python3 is required but not found."
    echo "Install Python 3 from https://python.org"
    exit 1
fi

# Create the manifest
mkdir -p "$MANIFEST_DIR"

cat > "$MANIFEST_DEST" << EOF
{
  "name": "$HOST_NAME",
  "description": "LinkedIn Profile Schmusher native messaging host",
  "path": "$HOST_PY",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXT_ID/"
  ]
}
EOF

echo ""
echo "Installed native messaging host:"
echo "  Manifest: $MANIFEST_DEST"
echo "  Host:     $HOST_PY"
echo "  Extension ID: $EXT_ID"
echo ""
echo "Restart Chrome for changes to take effect."
