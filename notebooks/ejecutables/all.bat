@echo off
rem Resuelve todos los N del banco de Battarra y despues todos los de Erdogan.
rem El Excel y los JSON quedan en la carpeta de lote_trppdh3.py.
cd /d "%~dp0.."
python lote_trppdh3.py B all
if errorlevel 1 goto fin
python lote_trppdh3.py E all
:fin
pause
