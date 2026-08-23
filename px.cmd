@echo off
setlocal
set NODE_NO_WARNINGS=1
cd /d "%~dp0"
if exist "node_modules\.bin\tsx.cmd" (
  "node_modules\.bin\tsx.cmd" tools\px\cli.ts %*
) else (
  npx --yes tsx tools\px\cli.ts %*
)
