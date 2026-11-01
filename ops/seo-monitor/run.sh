#!/bin/sh
set -eu
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
cd "$(dirname "$0")/../.."
exec "${FIGHTGYMS_PYTHON:-python3}" ops/seo-monitor/collect.py "$@"
