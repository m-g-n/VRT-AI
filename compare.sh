#!/bin/bash

VENV_PATH="$(cd "$(dirname "$0")" && pwd)/packages/compare/venv"
SCRIPT_PATH="$(cd "$(dirname "$0")" && pwd)/packages/compare/src/compare.py"

# venv の確認
if [ ! -d "$VENV_PATH" ]; then
  echo "❌ Virtual environment not found at $VENV_PATH"
  echo "Please run: cd packages/compare && python -m venv venv && source venv/bin/activate && pip install -r requirements.txt"
  exit 1
fi

# venv を有効化して実行
source "$VENV_PATH/bin/activate"
python "$SCRIPT_PATH" "$@"
