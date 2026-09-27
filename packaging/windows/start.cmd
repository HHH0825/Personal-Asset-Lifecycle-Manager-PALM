@echo off
"%~dp0PALM.exe" %*
if errorlevel 1 (
    echo.
    echo PALM could not complete the requested action. Review the message above.
    pause
)
