#!/usr/bin/env bash
# RNK Vortex System Optimizer
# Copyright © 2026 Lisa's Dungeon
# Contributor: Lisa's Dungeon
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, version 3.
#
# macOS installer for the native whole-PC observation and planning agent.

set -eu

repository_url='https://github.com/RNK-Enterprise/rnk-vq1-optimizer-pc.git'
install_directory="${XDG_DATA_HOME:-$HOME/Library/Application Support}/rnk-vortex-optimizer"
release_ref=''
expected_signing_fingerprint="${RNK_SIGNING_KEY_FINGERPRINT:-}"
environment_mode=''
run_optimize=0
gateway_url="${OPTIMIZER_GATEWAY_URL:-}"
minimum_free_bytes=5368709120

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dir) install_directory="$2"; shift 2 ;;
    --ref) release_ref="$2"; shift 2 ;;
    --signing-fingerprint) expected_signing_fingerprint="$2"; shift 2 ;;
    --run-optimize) run_optimize=1; shift ;;
    --gateway) gateway_url="$2"; shift 2 ;;
    --min-free-bytes) minimum_free_bytes="$2"; shift 2 ;;
    --mode|--environment-mode) environment_mode="$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$release_ref" ] || ! printf '%s\n' "$release_ref" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$|^[0-9a-fA-F]{40}$'; then
  echo '--ref is required and must be a release tag (vX.Y.Z) or a full 40-character commit SHA' >&2
  exit 2
fi

if [ -z "$environment_mode" ]; then
  if [ ! -t 0 ]; then
    echo 'environment mode is required: rerun with --mode headless or --mode interactive' >&2
    exit 2
  fi
  printf '%s' 'Choose [h]eadless or [i]nteractive: '
  IFS= read -r environment_choice || { echo 'environment mode was not selected' >&2; exit 2; }
  case "$environment_choice" in
    h|headless) environment_mode='headless' ;;
    i|interactive) environment_mode='interactive' ;;
    *) echo 'choose headless or interactive' >&2; exit 2 ;;
  esac
fi

case "$environment_mode" in
  headless|interactive) ;;
  *) echo '--mode must be headless or interactive' >&2; exit 2 ;;
esac

case "$minimum_free_bytes" in
  ''|*[!0-9]*) echo '--min-free-bytes must be a non-negative integer' >&2; exit 2 ;;
esac

command -v git >/dev/null 2>&1 || { echo 'git is required' >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo 'npm is required' >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo 'Node.js 20 or newer is required' >&2; exit 1; }
node -e "if (Number(process.versions.node.split('.')[0]) < 20) process.exit(1)" || { echo 'Node.js 20 or newer is required' >&2; exit 1; }
if [ "$run_optimize" -eq 1 ] && [ -z "$gateway_url" ]; then
  echo '--run-optimize requires --gateway or OPTIMIZER_GATEWAY_URL' >&2
  exit 2
fi

probe_path="$install_directory"
while [ ! -d "$probe_path" ] && [ "$probe_path" != '/' ]; do probe_path="$(dirname "$probe_path")"; done
available_free_bytes="$(node -e 'const fs=require("fs");const stat=fs.statfsSync(process.argv[1]);process.stdout.write(String(stat.bavail*stat.bsize));' "$probe_path")"
if [ "$available_free_bytes" -lt "$minimum_free_bytes" ]; then
  echo "insufficient free space at $probe_path: ${available_free_bytes} bytes available, ${minimum_free_bytes} required" >&2
  exit 2
fi

if [ -d "$install_directory/.git" ]; then
  [ "$(git -C "$install_directory" config --get remote.origin.url || true)" = "$repository_url" ] || { echo 'existing install has a different origin; refusing to cross repository boundaries' >&2; exit 2; }
  [ -z "$(git -C "$install_directory" status --porcelain)" ] || { echo 'existing install has uncommitted changes; refusing to overwrite it' >&2; exit 2; }
else
  mkdir -p "$(dirname "$install_directory")"
  git clone --no-checkout "$repository_url" "$install_directory"
fi

if printf '%s\n' "$release_ref" | grep -Eq '^[0-9a-fA-F]{40}$'; then
  git -C "$install_directory" fetch --no-tags origin "$release_ref"
  git -C "$install_directory" checkout --detach "$release_ref"
else
  git -C "$install_directory" fetch origin "refs/tags/$release_ref:refs/tags/$release_ref"
  [ "$(git -C "$install_directory" cat-file -t "$release_ref")" = 'tag' ] || { echo 'release ref is not an annotated tag' >&2; exit 2; }
  expected_signing_fingerprint="$(printf '%s' "$expected_signing_fingerprint" | tr -d '[:space:]' | tr '[:lower:]' '[:upper:]')"
  printf '%s\n' "$expected_signing_fingerprint" | grep -Eq '^[0-9A-F]{40}$' || { echo '--signing-fingerprint or RNK_SIGNING_KEY_FINGERPRINT must be the pinned 40-character RNK signing fingerprint' >&2; exit 2; }
  command -v gpg >/dev/null 2>&1 || { echo 'gpg is required to verify the pinned release signing key' >&2; exit 2; }
  gpg --batch --with-colons --list-keys "$expected_signing_fingerprint" | awk -F: -v expected="$expected_signing_fingerprint" '$1 == "fpr" && toupper($10) == expected { found=1 } END { exit found ? 0 : 1 }' || { echo 'the pinned release signing key is not present in the local trusted keyring' >&2; exit 2; }
  signature_output="$(git -C "$install_directory" verify-tag --raw "$release_ref" 2>&1)" || { echo 'release tag signature could not be verified' >&2; printf '%s\n' "$signature_output" >&2; exit 2; }
  actual_signing_fingerprint="$(printf '%s\n' "$signature_output" | awk '$1 == "[GNUPG:]" && $2 == "VALIDSIG" { print toupper($3); exit }')"
  [ "$actual_signing_fingerprint" = "$expected_signing_fingerprint" ] || { echo 'release tag signer does not match the pinned signing fingerprint' >&2; exit 2; }
  git -C "$install_directory" checkout --detach "$release_ref^{commit}"
fi

resolved_commit="$(git -C "$install_directory" rev-parse HEAD)"
if printf '%s\n' "$release_ref" | grep -Eq '^[0-9a-fA-F]{40}$' && [ "$resolved_commit" != "$release_ref" ]; then
  echo 'resolved commit does not match requested SHA' >&2
  exit 2
fi

npm --prefix "$install_directory" ci --omit=dev
config_directory="${XDG_CONFIG_HOME:-$HOME/Library/Preferences}/rnk-vortex-optimizer"
mkdir -p "$config_directory"
printf '%s\n' "$environment_mode" > "$config_directory/environment-mode"
node "$install_directory/native/cli.mjs" facts
if [ "$run_optimize" -eq 1 ]; then node "$install_directory/native/cli.mjs" optimize --gateway "$gateway_url"; fi
printf 'Installed in %s (%s mode, commit %s).\n' "$install_directory" "$environment_mode" "$resolved_commit"
