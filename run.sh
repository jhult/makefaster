#!/usr/bin/env bash
# Start the Makefaster server: migrates MariaDB, seeds the leaderboards on a
# fresh database, then serves the SPA and the write APIs on $PORT (8787).
set -euo pipefail

cd "$(dirname "$0")"

# Docker's MariaDB accepts the default root:root DSN. Homebrew and apt
# installs usually authenticate the OS user over the unix socket instead, and
# reject that DSN with Error 1698. When MARIADB_DSN is unset, pick whichever
# of those actually answers and make sure the schema exists.
if [[ -z "${MARIADB_DSN:-}" ]] && command -v mariadb >/dev/null 2>&1; then
  if mariadb -h127.0.0.1 -uroot -proot --connect-timeout=2 -e 'SELECT 1' >/dev/null 2>&1; then
    mariadb -h127.0.0.1 -uroot -proot -e \
      'CREATE DATABASE IF NOT EXISTS makefaster CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  elif mariadb -e 'SELECT 1' >/dev/null 2>&1; then
    mariadb -e \
      'CREATE DATABASE IF NOT EXISTS makefaster CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    user="$(whoami)"
    socket="$(mariadb -N -e 'SELECT @@socket')"
    export MARIADB_DSN="${user}@unix(${socket})/makefaster?parseTime=true"
  fi
fi

cd backend && exec go run ./cmd/server
