@echo off
chcp 65001 >nul
echo ========================================
echo 비용 데이터 전처리 실행
echo ========================================
echo.

cd /d "%~dp0"

echo Python 환경 확인 중...
python --version
if errorlevel 1 (
    echo 오류: Python이 설치되어 있지 않습니다.
    echo Python을 설치한 후 다시 실행해주세요.
    pause
    exit /b 1
)

echo.
echo [1/2] 전처리 스크립트 실행 중...
python scripts/preprocess_expense.py

if errorlevel 1 (
    echo.
    echo 오류가 발생했습니다. 위의 오류 메시지를 확인해주세요.
    pause
    exit /b 1
)

echo.
echo [2/2] 최신월 AI 보고서 생성 중 (당월 · 누적)...
echo   ※ /api/ai-report 는 파일이 있으면 다시 만들지 않고, 배포 환경은
echo      파일시스템이 읽기 전용이라 여기서 미리 만들어 커밋해야 합니다.
node --version >nul 2>&1
if errorlevel 1 (
    echo   경고: Node.js 가 없어 AI 보고서를 건너뜁니다.
    echo         나중에 아래를 직접 실행하세요:
    echo         node scripts/build-latest-ai-reports.mjs
) else (
    node scripts/build-latest-ai-reports.mjs
    if errorlevel 1 (
        echo   경고: AI 보고서 생성에 실패했습니다. 데이터 전처리는 정상 완료되었습니다.
    )
)

echo.
echo ========================================
echo 전처리 완료!
echo   생성된 data/ai-reports/*.txt 도 함께 커밋해야
echo   배포 환경에서 보고서가 보입니다.
echo ========================================
pause
