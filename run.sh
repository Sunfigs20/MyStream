#!/usr/bin/env bash
set -e
echo "MYSTREAM - local streaming frontend"
npm install
npx playwright install chromium
echo
echo "starting server on http://localhost:3000"
node server.mjs
