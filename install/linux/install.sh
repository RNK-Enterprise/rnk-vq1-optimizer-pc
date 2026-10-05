#!/usr/bin/env bash
# RNK Vortex System Optimizer
# Copyright © 2025 Asgard Innovations / RNK™
# Contributor: Lisa's Dungeon
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, version 3 of the License.
#
# Linux installer for the native whole-PC agent.

set -eu

repository_url=''
install_directory="${XDG_DATA_HOME:-$HOME/.local/share}/rnk-vortex-optimizer"
run_optimize=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo) repository_url="$2"; shift 2 ;;
    --dir) install_directory="$2"; shift 2 ;;
    --run-optimize) run_optimize=1; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

command -v git >/dev/null 2>&1 || { echo 'git is required' >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo 'npm is required' >&2; exit 1; }

if [ -d "$install_directory/.git" ]; then
  git -C "$install_directory" pull --ff-only
else
  [ -n "$repository_url" ] || { echo '--repo is required for a fresh install' >&2; exit 2; }
  mkdir -p "$(dirname "$install_directory")"
  git clone "$repository_url" "$install_directory"
fi

npm --prefix "$install_directory" ci
node "$install_directory/native/cli.mjs" facts
if [ "$run_optimize" -eq 1 ]; then
  node "$install_directory/native/cli.mjs" optimize
fi

