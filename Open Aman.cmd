@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\start-aman.ps1"
if errorlevel 1 pause
