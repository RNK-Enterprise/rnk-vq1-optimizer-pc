#!/usr/bin/env bash
# RNK Vortex System Optimizer
# Copyright © 2026 RNK Enterprise
# Contributor: RNK Enterprise
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
environment_mode=''

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo) repository_url="$2"; shift 2 ;;
    --dir) install_directory="$2"; shift 2 ;;
    --run-optimize) run_optimize=1; shift ;;
    --mode|--environment-mode)
      [ "$#" -ge 2 ] || { echo '--mode requires headless or interactive' >&2; exit 2; }
      environment_mode="$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$environment_mode" ]; then
  if [ ! -t 0 ]; then
    printf '\033[1mEnvironment mode is required: rerun with --mode headless or --mode interactive.\033[0m\n' >&2
    exit 2
  fi
  printf '\033[1mRNK Vortex System Optimizer installation mode is required.\033[0m\n'
  printf 'Choose [h]eadless or [i]nteractive: '
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
config_directory="${XDG_CONFIG_HOME:-$HOME/.config}/rnk-vortex-optimizer"
mkdir -p "$config_directory"
printf '%s\n' "$environment_mode" > "$config_directory/environment-mode"
node "$install_directory/native/cli.mjs" facts
if [ "$run_optimize" -eq 1 ]; then
  node "$install_directory/native/cli.mjs" optimize
fi
printf 'Installed in %s (%s mode).\n' "$install_directory" "$environment_mode"
