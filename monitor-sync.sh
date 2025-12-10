#!/bin/bash

LOG_FILE="/Users/seunghan/law/korea-law/full-sync.log"
DB_FILE="/Users/seunghan/law/korea-law/data/korea-law.db"
LAST_PROGRESS=0

echo "🔔 동기화 모니터링 시작 (5% 단위 알림)"
echo "=========================================="

while true; do
  sleep 30
  
  # 로그에서 마지막 진행률 추출
  LAST_LINE=$(tail -5 "$LOG_FILE" 2>/dev/null | grep -E '\[[0-9]+\.[0-9]+%\]' | tail -1)
  
  if [ ! -z "$LAST_LINE" ]; then
    # 진행률 추출 (예: [5.0%] -> 5.0)
    PROGRESS=$(echo "$LAST_LINE" | grep -oE '\[[0-9]+\.[0-9]+%\]' | grep -oE '[0-9]+\.[0-9]+')
    
    if [ ! -z "$PROGRESS" ]; then
      # 정수 부분만 추출 (5.0 -> 5)
      PROGRESS_INT=$(echo "$PROGRESS" | cut -d. -f1)
      LAST_PROGRESS_INT=$(echo "$LAST_PROGRESS" | cut -d. -f1)
      
      # 5% 단위로 증가했는지 확인
      if [ "$PROGRESS_INT" -gt "$LAST_PROGRESS_INT" ] && [ $(($PROGRESS_INT % 5)) -eq 0 ]; then
        # DB 상태 확인
        LAWS=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM Laws;" 2>/dev/null || echo "0")
        ARTICLES=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM Articles;" 2>/dev/null || echo "0")
        
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "📊 진행률: ${PROGRESS_INT}%"
        echo "   법령: ${LAWS}건"
        echo "   조문: ${ARTICLES}건"
        echo "   시간: $(date '+%Y-%m-%d %H:%M:%S')"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        
        LAST_PROGRESS=$PROGRESS
      fi
    fi
  fi
  
  # 동기화 완료 확인
  if grep -q "Full Sync v2 완료" "$LOG_FILE" 2>/dev/null; then
    echo ""
    echo "✅ 동기화 완료!"
    tail -10 "$LOG_FILE" | grep -A 10 "Full Sync v2 완료"
    break
  fi
done

