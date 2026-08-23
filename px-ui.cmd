@echo off
setlocal
set NODE_NO_WARNINGS=1
cd /d "%~dp0"
call npm run px:ui
