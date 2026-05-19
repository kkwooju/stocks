@echo off
REM portfolio.html을 로컬 HTTP server로 띄워 가격 API 호출이 정상 동작하게 합니다.
REM 더블클릭하면: (1) 이 폴더에서 Python http.server 시작 (2) 기본 브라우저로 페이지 자동 오픈.
REM 창을 닫으면 서버도 함께 종료됩니다.

setlocal
cd /d "%~dp0"

REM 사용 가능한 첫 빈 포트(8765 → 8766 → ...)를 찾기
set PORT=8765
:CHECKPORT
netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul 2>&1
if not errorlevel 1 (
    set /a PORT+=1
    if %PORT% GTR 8800 (
        echo [오류] 사용 가능한 포트를 못 찾았습니다 ^(8765~8800 모두 사용 중^).
        pause
        exit /b 1
    )
    goto CHECKPORT
)

REM Python 설치 확인
where python >nul 2>&1
if errorlevel 1 (
    echo [오류] Python이 설치되어 있지 않거나 PATH에 없습니다.
    echo  Python 3.x 설치 후 다시 실행해주세요. https://www.python.org/downloads/
    pause
    exit /b 1
)

echo.
echo ===============================================
echo  주식 포트폴리오 서버 시작 (포트 %PORT%)
echo  주소: http://localhost:%PORT%/portfolio.html
echo  이 창을 닫으면 서버도 종료됩니다.
echo ===============================================
echo.

REM 브라우저 자동 오픈 (서버가 뜨는 동안)
start "" "http://localhost:%PORT%/portfolio.html"

REM 서버 시작 (포그라운드 — 창 닫으면 서버 종료)
python -m http.server %PORT%

endlocal
