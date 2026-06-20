#!/bin/bash
cd /home/z/my-project
while true; do
  bun run dev 2>&1
  echo "[Restart] Next.js dev server died, restarting in 3s..."
  sleep 3
done
