PRD: korea-law (Korea Law MCP Server)
1. 개요 (Overview)
제품명: korea-law

목적: LLM(Claude, ChatGPT)이 한국 법률 정보를 인용할 때 발생시키는 환각(Hallucination)을 방지하고, 최신 개정 사항(Diff)을 반영하여 법적 유효성을 검증(Audit)한다.

핵심 가치: "단순 검색이 아닌, 시점(Time-aware) 기반의 무결성 검증."

2. 시스템 아키텍처 (System Architecture)
시스템은 크게 데이터 수집기(Crawler), Diff 엔진, 로컬 DB, MCP 인터페이스로 구성됩니다.

2.1 데이터 파이프라인 (Daily Sync)
Source: 국가법령정보센터 Open API (XML).

Scheduler: 매일 00:00 KST 실행 (Cron Job).

Crawler & Parser:

전체 법령 목록 스캔.

개정일자가 어제/오늘인 법령만 필터링하여 다운로드.

XML → JSON 변환 (조문 단위 파싱: 제1조, 제2조...).

Diff Engine (핵심):

Previous_Ver vs Current_Ver 텍스트 비교.

변경 유형 태깅: [신설], [개정], [삭제].

시점 로직 적용:

공포일(Promulgation): 법이 세상에 알려진 날.

시행일(Enforcement): 실제 효력이 발생하는 날.

DB에 status 필드 저장: ACTIVE (현재 시행중), PENDING (공포됨/미시행), EXPIRED (폐지됨).

Storage: SQLite (경량화 배포용) 또는 PostgreSQL (서버 호스팅용).

테이블 구조: Law_Master, Articles, Diff_Logs.

3. 기능 명세 (Feature Specifications)
LLM이 호출하게 될 MCP Tool의 구체적인 명세입니다.

3.1 audit_statute_integrity (법령 무결성 검사)
Description: 특정 조문의 텍스트가 현행법과 일치하는지, 그리고 계약 기간 내에 유효한지 검증.

Input Schema:

JSON

{
  "law_name": "근로기준법",
  "article_number": "23",
  "target_date": "2025-12-09" (옵션: 기본값 오늘)
}
Logic:

DB에서 law_name 검색.

target_date 기준으로 effective_date <= target_date인 가장 최신 버전 조회.

해당 조문(article_number) 추출.

(선택) 미래 날짜 조회 시, 현재와 내용이 다르면 warning: "FUTURE_CHANGE_DETECTED" 플래그 반환.

Output: 조문 원문(Text), 상태 코드(Valid/Modified).

3.2 get_daily_diff (일일 변경 사항 브리핑)
Description: 어제와 오늘 사이 변경되거나 새로 공포된 법령 리스트 반환.

Input Schema: 없음 (또는 날짜 지정).

Logic:

Diff_Logs 테이블에서 created_at == Today 조회.

중요도 높은 법령(노동, 세무, 상법 등) 우선 정렬.

Output:

"산업안전보건법 시행규칙 (일부개정) - 2024.12.09 시행"

"주요 변경 조문: 제XX조 안전조치 강화..."

3.3 verify_precedent_existence (판례 실존 여부)
Description: 사건번호가 대법원 DB에 실제 존재하는지 확인 (가짜 판례 방지).

Logic:

Local DB에 판례 인덱스가 있다면 조회 (속도 빠름).

없다면 실시간 API Fallback 호출 (정확도).

결과가 없으면 Found: False 반환.

4. 데이터베이스 스키마 설계 (예시)
가장 중요한 '시간'과 'Diff'를 담는 구조입니다.

SQL

-- 법령 마스터 (버전 관리)
CREATE TABLE Laws (
    id INTEGER PRIMARY KEY,
    law_name TEXT,
    promulgation_date DATE, -- 공포일
    enforcement_date DATE,  -- 시행일
    version_id TEXT,        -- 법령 ID (국가법령센터 기준)
    is_active BOOLEAN       -- 현재 유효 여부
);

-- 조문 데이터
CREATE TABLE Articles (
    id INTEGER PRIMARY KEY,
    law_id INTEGER,         -- FK
    article_no TEXT,        -- "제23조"
    content TEXT,           -- 본문 내용
    FOREIGN KEY(law_id) REFERENCES Laws(id)
);

-- 변경 이력 (Diff)
CREATE TABLE Diff_Logs (
    id INTEGER PRIMARY KEY,
    law_id INTEGER,
    changed_article_no TEXT,
    change_type TEXT,       -- "MODIFIED", "ADDED", "DELETED"
    diff_content TEXT,      -- 변경된 내용 요약
    detected_at DATE DEFAULT CURRENT_DATE
);
5. 개발 로드맵 (Milestones)
Phase 1 (MVP):

국가법령센터 API 연동 및 기본 파서 개발 (xml2json).

주요 법령(노동법, 민법, 형법) 100종 대상 로컬 DB 구축.

audit_statute 기능 구현.

NPM 패키지 배포.

Phase 2 (Automation):

AWS Lambda/GitHub Actions를 이용한 Daily Cron Job 구축.

Diff 알고리즘 고도화 (텍스트 유사도 비교).

전체 법령으로 DB 확장.

Phase 3 (Forecasting):

'부칙' 파싱을 통한 미래 시행일 자동 계산 로직 구현.

사용자 맞춤형 알림 ("님 계약서 관련 법 다음 달에 바뀝니다").