#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOMEBRIDGE_DIR="${HOMEBRIDGE_DIR:-$HOME/.homebridge}"

printf 'Building plugin...\n'
cd "$ROOT_DIR"
yarn build
npm link

printf 'Linking plugin into %s...\n' "$HOMEBRIDGE_DIR"
mkdir -p "$HOMEBRIDGE_DIR"
cd "$HOMEBRIDGE_DIR"

if [[ ! -f package.json ]]; then
  printf '{"name":"homebridge-local-test","private":true}\n' > package.json
fi

npm link homebridge-levoit-air-purifier

printf '\nStarting Homebridge in debug mode...\n'
printf 'Config: %s/config.json\n' "$HOMEBRIDGE_DIR"
printf 'Edit email/password there before testing if needed.\n\n'

exec homebridge -U "$HOMEBRIDGE_DIR" -D
