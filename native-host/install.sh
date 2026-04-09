#!/bin/bash
# Install the native messaging host for LinkedIn Profile Schmusher.
# Usage: ./install.sh <chrome-extension-id>
#
# To find your extension ID:
#   1. Go to chrome://extensions
#   2. Find "LinkedIn Profile Schmusher"
#   3. Copy the ID (e.g., abcdefghijklmnopabcdefghijklmnop)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_NAME="com.schmusher.host"
HOST_PY="$SCRIPT_DIR/schmusher_host.py"
MANIFEST_SRC="$SCRIPT_DIR/$HOST_NAME.json"
MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
MANIFEST_DEST="$MANIFEST_DIR/$HOST_NAME.json"

if [ -z "$1" ]; then
    echo "Usage: $0 <chrome-extension-id>"
    echo ""
    echo "Find your extension ID at chrome://extensions"
    echo "(Look for 'LinkedIn Profile Schmusher' and copy the ID)"
    exit 1
fi

EXT_ID="$1"

# Ensure the host script is executable
chmod +x "$HOST_PY"

# Create the manifest with the correct extension ID and path
mkdir -p "$MANIFEST_DIR"

cat > "$MANIFEST_DEST" << EOF
{
  "name": "$HOST_NAME",
  "description": "LinkedIn Profile Schmusher - Evernote integration via AppleScript",
  "path": "$HOST_PY",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXT_ID/"
  ]
}
EOF

echo "Installed native messaging host:"
echo "  Manifest: $MANIFEST_DEST"
echo "  Host:     $HOST_PY"
echo "  Extension ID: $EXT_ID"
echo ""
echo "Done! Restart Chrome for the changes to take effect."
