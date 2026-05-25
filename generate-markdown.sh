#!/usr/bin/env sh

set -eu

show_help() {
  cat <<'EOF'
Generate the Markdown README from the configured Bible chapters.

Usage:
  ./generate-markdown.sh [options] [filters...]

Options:
  -s, --source <path-or-url>
                  Override the Bible source for all configured chapters.
                  The source can be:
                    - a full Version .json file
                    - a chunked manifest.json file
                    - a chunked directory containing manifest.json
                    - an HTTP URL for any of the above

                  Default: ./content/NVI_vid_128_chunked

  -f, --filter <reference>
                  Select content to render. Can be repeated.

                  Supported references:
                    GEN              full book
                    GEN.1            full chapter
                    GEN 1            full chapter
                    GEN 1:1          one verse
                    GEN 1:1-10       verse range

                  Filters can also be passed as positional arguments after
                  options. Quote references that contain spaces.

                  If no filter is provided, an interactive selector is shown.

  -o, --output <file>
                  Write Markdown to a different file.
                  Default: README.md

  --chunk-size <bytes>
                  Byte-range read size for chunked sources.
                  Default: 4096

  --join-lines
                  Join verse lines with spaces instead of Markdown paragraph
                  breaks.

  -h, --help      Show this help message.

Description:
  This script runs the TypeScript Markdown generation utility defined in
  src/index.ts. The generated output is written to README.md.

  Chapter selection is defined by CLI filters. When no filter is provided, the
  script opens a simple interactive selector for books, chapters, and verse
  ranges.

Examples:
  ./generate-markdown.sh GEN
  ./generate-markdown.sh GEN.1
  ./generate-markdown.sh "GEN 1:1-10"
  ./generate-markdown.sh -f GEN -f "JHN 3:16"
  ./generate-markdown.sh -o ./tmp/generated.md
  ./generate-markdown.sh --source ./content/NVI_vid_128.json GEN.1
  ./generate-markdown.sh --source ./content/NVI_vid_128_chunked "GEN 1:1-10"
  ./generate-markdown.sh --source ./content/NVI_vid_128_chunked/manifest.json --chunk-size 1024 GEN.24
  ./generate-markdown.sh --help

Requirements:
  - Node.js compatible with this project.
  - Dependencies installed with yarn or npm.

EOF
}

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if [ ! -f "$SCRIPT_DIR/package.json" ] || [ ! -f "$SCRIPT_DIR/src/index.ts" ]; then
  printf 'Error: this script must be run from the reading-json-files project checkout.\n' >&2
  exit 1
fi

cd "$SCRIPT_DIR"

case "${1:-}" in
  -h|--help)
    show_help
    exit 0
    ;;
esac

if [ -x "$SCRIPT_DIR/node_modules/.bin/tsx" ]; then
  exec "$SCRIPT_DIR/node_modules/.bin/tsx" "$SCRIPT_DIR/src/index.ts" "$@"
fi

if command -v yarn >/dev/null 2>&1; then
  exec yarn start "$@"
fi

if command -v npm >/dev/null 2>&1; then
  exec npm run start -- "$@"
fi

printf 'Error: tsx is not installed and neither yarn nor npm is available in PATH.\n' >&2
exit 1
