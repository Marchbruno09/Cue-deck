#!/bin/sh
set -eu

mkdir -p build
SWIFT_MODULECACHE_PATH="/private/tmp/cue-deck-swift-module-cache" \
  swiftc -O -Xcc -fmodules-cache-path=/private/tmp/cue-deck-swift-module-cache \
  -framework AppKit -framework PDFKit scripts/pdf-renderer.swift \
  -o build/cue-deck-pdf-renderer
