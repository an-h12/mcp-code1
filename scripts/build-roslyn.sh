#!/usr/bin/env bash
# Build the Roslyn analyzer binary for the current platform.
# Requires .NET 8 SDK: https://dotnet.microsoft.com/download
set -e

PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$ARCH" in
  x86_64) ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
esac

OUTPUT_DIR="bin/roslyn/${PLATFORM}-${ARCH}"
mkdir -p "$OUTPUT_DIR"

cd roslyn-analyzer
dotnet publish -c Release -r "${PLATFORM}-${ARCH}" --self-contained true -o "../${OUTPUT_DIR}"
echo "Built: ${OUTPUT_DIR}/roslyn-analyzer"
