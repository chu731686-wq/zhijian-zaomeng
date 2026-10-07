#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="$APP_DIR/data"
BACKUP_DIR="${BACKUP_DIR:-$SCRIPT_DIR/backups}"

if [[ ! -d "$DATA_DIR" ]]; then
  echo "数据目录不存在：$DATA_DIR" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
archive="$BACKUP_DIR/data-$(date +%Y%m%d-%H%M%S).tar.gz"
tar -czf "$archive" -C "$APP_DIR" data
printf '备份完成：%s\n' "$archive"

shopt -s nullglob
archives=("$BACKUP_DIR"/data-*.tar.gz)
for ((i = 0; i < ${#archives[@]} - 14; i++)); do
  rm -- "${archives[i]}"
done
