@echo off
where codex >nul 2>nul || (echo Codex CLIが見つかりません。 & pause & exit /b 1)
where node >nul 2>nul || (echo Node.js 22.13以上が必要です。 & pause & exit /b 1)
node -e "require('node:sqlite')" >nul 2>nul || (echo SQLite対応のNode.js 22.13以上が必要です。 & pause & exit /b 1)
codex login status || codex login
set CODEX_BIN=codex
node "%~dp0bridge\server.mjs"
pause
