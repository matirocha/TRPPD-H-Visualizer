@echo off
rem Resuelve N = 20 en el banco de Battarra y despues en el de Erdogan.
rem El Excel y los JSON quedan en la carpeta de lote_trppdh3.py.
cd /d "%~dp0.."
python lote_trppdh3.py B 20
if errorlevel 1 goto fin
python lote_trppdh3.py E 20
:fin
pause
