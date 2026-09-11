#!/usr/bin/env bash
set -euo pipefail

PORT="${WEB_PORT:-8787}"

if ! command -v tailscale >/dev/null 2>&1; then
  echo "Instale o Tailscale: curl -fsSL https://tailscale.com/install.sh | sh"
  echo "Depois: sudo tailscale up"
  exit 1
fi

if ! tailscale status >/dev/null 2>&1; then
  echo "Faça login no Tailscale: sudo tailscale up"
  exit 1
fi

echo "Expondo http://127.0.0.1:${PORT} via Tailscale Funnel (HTTPS)."
echo "Use a URL .ts.net como WEB_API_BASE_URL na Vercel."
tailscale funnel --bg "${PORT}"
tailscale funnel status
