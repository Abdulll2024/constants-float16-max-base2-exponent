@echo off
rem ============================================================
rem  DSH Console LAN launcher  (bind 0.0.0.0 so others can use IP)
rem  SPDX-License-Identifier: Apache-2.0  (see LICENSE / NOTICE)
rem  Keep this file PURE ASCII.  Same rules as start.cmd.
rem  Trusted intranet only: the console proxies full DSH APIs.
rem ============================================================
chcp 65001 >nul
cd /d "%~dp0"

set "CONSOLE_HOST=0.0.0.0"
call "%~dp0start.cmd"
exit /b %ERRORLEVEL%
