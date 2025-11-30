#!/bin/bash

# スクリプトの存在確認
SCRIPT_PATH="$(cd "$(dirname "$0")" && pwd)/packages/capture/src/capture.js"

if [ ! -f "$SCRIPT_PATH" ]; then
  echo "❌ Script not found: $SCRIPT_PATH"
  exit 1
fi

# 引数を渡して実行
node "$SCRIPT_PATH" "$@"
