@echo off
rem Inicia la Pagina Web 2 en http://localhost:3001 y la abre en el navegador.
rem Doble clic para usarlo; cierra esta ventana (o Ctrl+C) para detener el servidor.
title Pagina Web 2 - TRPPD-H3
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo No se encontro Node.js. Instalalo desde https://nodejs.org ^(version 20 o superior^).
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instalando dependencias, solo la primera vez...
  call npm install
  if errorlevel 1 (
    echo Fallo npm install.
    pause
    exit /b 1
  )
)

rem El navegador se abre un par de segundos despues, cuando el servidor ya responde.
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3001"
call npm start
pause
