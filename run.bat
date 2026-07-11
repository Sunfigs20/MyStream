@echo off
echo MYSTREAM - local streaming frontend
call npm install
call npx playwright install chromium
echo.
echo starting server on http://localhost:3000
start "" cmd /k "node server.mjs"
