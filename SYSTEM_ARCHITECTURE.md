# Korea Law MCP Server - 시스템 아키텍처

## 🎯 핵심 개념

> **"테스트 데이터로 응답하는 것이 아닙니다"**
> 국가법령정보센터 API → 매일 자동 동기화 → SQLite DB → MCP 서버가 DB에서 조회

---

## 🏗️ 시스템 구조

```
┌─────────────────────────────────────────────────────────────┐
│  국가법령정보센터 Open API (law.go.kr)                         │
│  ├─ 법령 검색 API (lawSearch.do)                             │
│  ├─ 법령 상세 API (lawService.do)                            │
│  └─ 최근 개정 법령 API (recentLsn.do)                        │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    │ 매일 00:00 KST (자동)
                    ▼
┌─────────────────────────────────────────────────────────────┐
│  Daily Sync Engine (src/sync/daily-sync.ts)                 │
│  ├─ 우선순위 법령 동기화 (근로기준법, 민법 등 16개)           │
│  ├─ 최근 7일 개정 법령 스캔                                   │
│  ├─ Diff 감지 엔진                                            │
│  └─ 변경사항 자동 추적                                        │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    │ 데이터 저장
                    ▼
┌─────────────────────────────────────────────────────────────┐
│  SQLite Database (data/korea-law.db)                         │
│  ├─ Laws (법령 마스터)                                        │
│  ├─ Articles (조문 데이터)                                    │
│  ├─ Diff_Logs (변경 추적) ⚡ 핵심!                           │
│  ├─ Legal_Terms (법률 용어 정의)                             │
│  └─ Sync_Metadata (동기화 메타데이터)                        │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    │ 데이터 조회
                    ▼
┌─────────────────────────────────────────────────────────────┐
│  MCP Server (src/index.ts)                                   │
│  ├─ verify_statute: DB에서 조문 검증                         │
│  ├─ check_statute_revision: Diff_Logs 조회                  │
│  ├─ audit_contract_timeline: 기간 내 변경사항 예측          │
│  └─ check_legal_definition: 용어 정의 조회                  │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    │ MCP Protocol
                    ▼
┌─────────────────────────────────────────────────────────────┐
│  Claude Desktop / Claude Code                                │
│  └─ AI가 법률 인용 → MCP 도구로 실시간 검증                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 📊 데이터 흐름

### 1️⃣ 동기화 단계 (매일 자동)
```typescript
// src/sync/daily-sync.ts
async function syncLaw(lawName: string) {
  // 1. API에서 최신 법령 가져오기
  const searchResults = await api.searchLaws(lawName, 5);
  const lawDetail = await api.getLawDetail(latestLaw.법령ID);

  // 2. 기존 DB 데이터 조회
  const existingLaw = db.findLawByName(lawName);

  // 3. 법령 마스터 저장/업데이트
  const lawId = db.upsertLaw(lawRecord);

  // 4. 조문별 Diff 감지
  for (const article of lawDetail.조문) {
    const existingArticle = db.findArticle(existingLaw.id, articleNo);

    if (existingArticle.content !== article.조문내용) {
      // ⚡ Diff 감지!
      const diff = calculateDiff(existingArticle.content, article.조문내용);

      // Diff_Logs 테이블에 저장
      db.insertDiffLog({
        law_id: lawId,
        article_id: articleId,
        change_type: diff.changeType, // ADDED/MODIFIED/DELETED
        previous_content: existingArticle.content,
        current_content: article.조문내용,
        diff_summary: "금액 변경: 500만원 → 1000만원",
        is_critical: true,
        warning_message: "⚠️ 중요 변경 감지!",
        effective_from: "2025-07-01"
      });
    }
  }
}
```

### 2️⃣ 조회 단계 (실시간)
```typescript
// MCP 도구: verify_statute
async function verify_statute(law_name, article_no) {
  // DB에서 현행 조문 조회
  const article = db.getArticle(law_name, article_no);

  // 최근 변경사항 조회
  const recentChanges = db.getDiffLogs(article.id, limit: 5);

  return {
    status: "VALID",
    current_content: article.content,
    effective_date: article.effective_from,
    recent_changes: recentChanges // Diff 히스토리!
  };
}

// MCP 도구: check_statute_revision
async function check_statute_revision(law_name, from_date, to_date) {
  // Diff_Logs에서 기간별 변경사항 조회
  const changes = db.getDiffLogsByDateRange(law_name, from_date, to_date);

  return {
    changes: changes.map(c => ({
      article_no: c.article_no,
      change_type: c.change_type,
      changed_at: c.changed_at,
      summary: c.diff_summary,
      is_critical: c.is_critical
    }))
  };
}
```

---

## ⚡ Diff 감지 엔진

### 중요 변경 패턴 감지
```typescript
const criticalPatterns = [
  /\d+만원/g,    // 금액
  /\d+원/g,
  /\d+일/g,      // 기간
  /\d+개월/g,
  /\d+년/g,
  /징역/g,       // 처벌
  /벌금/g,
  /과태료/g,
  /해고/g,       // 중요 키워드
  /해지/g,
];
```

### Diff 결과 예시
```json
{
  "changeType": "MODIFIED",
  "previousContent": "근로자를 해고하려면 30일 전에 예고하여야 한다.",
  "currentContent": "근로자를 해고하려면 60일 전에 예고하여야 한다.",
  "summary": "기간 변경: 30일 → 60일",
  "isCritical": true,
  "effectiveFrom": "2025-07-01"
}
```

---

## 🔄 자동화 워크플로우

### GitHub Actions (매일 자동 실행)
```yaml
# .github/workflows/daily-sync.yml
name: Daily Law Sync
on:
  schedule:
    - cron: '0 15 * * *'  # 매일 00:00 KST (UTC+9)
  workflow_dispatch:      # 수동 실행 가능

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Build TypeScript
        run: npm run build

      - name: Run Daily Sync
        env:
          KOREA_LAW_API_KEY: ${{ secrets.KOREA_LAW_API_KEY }}
        run: npm run sync

      - name: Commit DB changes
        run: |
          git config --global user.name "korea-law-bot"
          git config --global user.email "bot@korea-law"
          git add data/korea-law.db
          git commit -m "chore: daily law sync $(date +'%Y-%m-%d')"
          git push
```

---

## 🚨 현재 문제: API 권한

### 문제 상황
```
❌ 미신청된 목록/본문에 대한 접근입니다.
```

API 키는 발급받았지만, **법령 검색/본문 조회 권한**이 없는 상태입니다.

### 해결 방법

#### 방법 1: 국가법령정보 공동활용 (open.law.go.kr)
1. https://open.law.go.kr 접속
2. 로그인 (회원가입 필요)
3. **[OPEN API]** → **[OPEN API 신청]** 클릭
4. 신청서 작성:
   - API 이름: korea-law MCP Server
   - 활용 목적: AI 법률 검증 시스템
   - 활용 분야: 법률 서비스
5. **법령종류 선택** (중요!):
   - ✅ 법률
   - ✅ 대통령령
   - ✅ 총리령/부령
   - ✅ 자치법규
6. 승인 대기 (1-2일 소요)

#### 방법 2: 공공데이터포털 (data.go.kr)
1. https://www.data.go.kr 접속
2. 로그인
3. 마이페이지 → 개발계정
4. "국가법령정보 법령" 활용신청
5. 신청 후 **법령종류 체크** (중요!)
6. 승인 대기

### API 키 테스트
```bash
# 승인 후 테스트
curl "http://www.law.go.kr/DRF/lawSearch.do?OC=YOUR_API_KEY&target=law&type=XML&query=민법&display=1"

# 성공 시: XML 응답 (<law> 태그 포함)
# 실패 시: HTML 에러 페이지
```

---

## 📦 설치 및 실행

### 1️⃣ 환경 설정
```bash
cd korea-law
cp .env.example .env
# .env 파일에 API 키 입력: KOREA_LAW_API_KEY=YOUR_KEY
```

### 2️⃣ 빌드
```bash
npm install
npm run build
```

### 3️⃣ 초기 동기화 (수동)
```bash
npm run sync
# 또는
ts-node src/sync/daily-sync.ts
```

### 4️⃣ MCP 서버 실행
```bash
# 개발 모드
npm run dev

# 프로덕션 모드
npm start
```

### 5️⃣ Claude Desktop 설정
```json
{
  "mcpServers": {
    "korea-law": {
      "command": "node",
      "args": ["/Users/seunghan/law/korea-law/dist/index.js"],
      "env": {
        "KOREA_LAW_API_KEY": "YOUR_KEY"
      }
    }
  }
}
```

---

## 🔍 데이터베이스 스키마

### Laws 테이블 (법령 마스터)
```sql
CREATE TABLE Laws (
  id INTEGER PRIMARY KEY,
  law_id TEXT UNIQUE NOT NULL,
  law_name TEXT NOT NULL,
  promulgation_date DATE,
  enforcement_date DATE,
  full_text TEXT,
  last_updated TIMESTAMP
);
```

### Articles 테이블 (조문)
```sql
CREATE TABLE Articles (
  id INTEGER PRIMARY KEY,
  law_id TEXT,
  article_number TEXT,
  title TEXT,
  content TEXT NOT NULL,
  order_index INTEGER,
  FOREIGN KEY (law_id) REFERENCES Laws(law_id)
);
```

### Diff_Logs 테이블 (변경 추적) ⚡
```sql
CREATE TABLE Diff_Logs (
  id INTEGER PRIMARY KEY,
  law_id TEXT,
  article_id INTEGER,
  change_type TEXT, -- ADDED/MODIFIED/DELETED
  previous_content TEXT,
  current_content TEXT,
  diff_summary TEXT,
  effective_from DATE,
  is_critical BOOLEAN,
  warning_message TEXT,
  detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (law_id) REFERENCES Laws(law_id),
  FOREIGN KEY (article_id) REFERENCES Articles(id)
);
```

---

## 📈 모니터링 및 알림

### 변경사항 알림 (계획)
```typescript
// 중요 변경 발생 시 알림
if (diff.isCritical) {
  // Slack, Discord, Email 등으로 알림
  notifyChange({
    law_name: "근로기준법",
    article_no: "제23조",
    summary: "해고 예고 기간 변경: 30일 → 60일",
    effective_date: "2025-07-01"
  });
}
```

---

## 🎯 사용 시나리오

### 시나리오 1: AI가 근로기준법 인용
```
AI: "근로기준법 제23조에 따르면 30일 전 해고 예고가 필요합니다."

Claude Desktop:
→ MCP 도구 호출: verify_statute("근로기준법", "제23조")
→ DB에서 최신 조문 확인
→ Diff_Logs 조회

결과:
⚠️ 주의: 2025-07-01부터 60일로 변경됩니다!
현행: 30일
변경 예정: 60일 (2025-07-01 시행)
```

### 시나리오 2: 계약 기간 검증
```
사용자: "2025년 1~12월 계약서가 근로기준법 위반 안 되나요?"

Claude Desktop:
→ MCP 도구 호출: audit_contract_timeline("근로기준법", "2025-01-01", "2025-12-31")
→ Diff_Logs에서 기간 내 변경사항 조회

결과:
⚠️ 2025-07-01 법령 변경 예정!
- 제23조: 해고 예고 기간 30일 → 60일
- 영향: 계약서에 "법령 변경 시 자동 적용" 조항 추가 권장
```

---

## 🛡️ 면책 조항

⚠️ **이 시스템은 AI 검증용입니다.**
- 법적 효력의 최종 판단: **국가법령정보센터 (law.go.kr)**
- 법률 자문 대체 불가
- 중요한 법률 판단은 전문가 상담 필수

---

## 📞 문의

- 법제처 공동활용 유지보수팀: **02-2109-6446**
- 이메일: open@moleg.go.kr
- GitHub Issues: https://github.com/YOUR_REPO/issues
