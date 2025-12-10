# ⚖️ korea-law

**The Time-Aware Legal MCP for Korean Law**

> AI가 인용한 법률을 현행법 기준으로 검증하는 MCP 서버
>
> "Don't just trust AI's memory. Audit it against the current law."
> (AI의 기억을 믿지 마세요. 현행법으로 감사(Audit)하세요.)

---

## 🚨 시작하기 전에: API 권한 필요

**⚠️ 중요: 국가법령정보센터 Open API 승인이 필요합니다!**

현재 API 키만으로는 법령 검색이 불가능합니다. **법령종류 체크** 후 승인이 필요합니다.

### 빠른 해결 방법

1. **https://open.law.go.kr** 접속 후 로그인
2. **[OPEN API] → [OPEN API 신청]** 클릭
3. **법령종류 선택** (중요!):
   - ✅ 법률
   - ✅ 대통령령 (시행령)
   - ✅ 총리령/부령 (시행규칙)
4. 승인 대기 (1-2일)

📖 **자세한 안내**: [API_SETUP.md](./API_SETUP.md) 참조
📖 **시스템 구조**: [SYSTEM_ARCHITECTURE.md](./SYSTEM_ARCHITECTURE.md) 참조

---

## ⚠️ 중요 고지

**이 패키지는 AI 검증용(Verification) 도구입니다.**

- DB에 저장된 데이터는 AI의 법률 인용 정확성을 검증하기 위한 **기준값**입니다.
- **법적 효력의 최종 판단**은 반드시 [국가법령정보센터(law.go.kr)](https://www.law.go.kr)를 참조하세요.
- 이 도구의 결과를 법적 판단의 최종 근거로 사용하지 마세요.

---

## 🎯 핵심 컨셉: "Verification First"

이 MCP 서버는 **AI 사후 검증(Post-generation Verification)** 용으로 설계되었습니다.

| 기능 | 설명 |
|------|------|
| **Statute Validity** | 인용된 법령이 현재 유효한가? (시행일 확인) |
| **Article Accuracy** | 조문 내용이 실제와 일치하는가? |
| **Precedent Reality** | 판례 번호가 실제 존재하는가? (가짜 판례 방지) |
| **Future Changes** | 계약 기간 중 법령 변경 예정이 있는가? |

---

## 📦 설치

```bash
npm install korea-law
```

---

## 🚀 사용법

### MCP 서버로 사용 (Claude Desktop 등)

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "korea-law": {
      "command": "npx",
      "args": ["korea-law"],
      "env": {
        "KOREA_LAW_API_KEY": "your-api-key"
      }
    }
  }
}
```

### CLI로 사용

```bash
# 조문 검증
korea-law audit 근로기준법 제23조

# 판례 존재 확인
korea-law verify 2023다12345

# 수동 동기화
korea-law sync
```

### 라이브러리로 사용

```javascript
const { findLawByName, findArticle, verifyPrecedentExists } = require('korea-law');

// 법령 조회
const law = findLawByName('근로기준법');
const article = findArticle(law.id, '제23조');

// 판례 확인
const exists = verifyPrecedentExists('2023다12345');
```

---

## 🛠️ MCP Tools

### 1. `audit_statute` (핵심 기능)

AI가 인용한 조문이 현행법과 일치하는지 검증합니다.

```
입력: { law_name: "근로기준법", article_number: "제23조" }
출력: 조문 원문, 시행일, 불일치 경고
```

### 2. `check_enforcement_date`

법령의 시행일/개정일을 확인합니다.

### 3. `verify_case_exists`

판례 번호가 실제 존재하는지 확인합니다. (가짜 판례 방지)

### 4. `get_daily_diff`

오늘 변경/시행된 법령 목록을 반환합니다.

### 5. `audit_contract_timeline`

계약 기간 동안 법령 변경 예정이 있는지 확인합니다.

### 6. `check_legal_definition`

법률 용어의 정확한 정의를 조회합니다.

---

## 🔧 기술 스펙

### Zero Latency (지연 시간 제로)

실시간 API 호출 대신 **로컬 DB**를 사용하여 응답 속도가 즉각적입니다.

### Predictive Compliance (선제적 규제 대응)

공포일과 시행일의 차이를 분석하여, **미래에 바뀔 법령**까지 미리 경고합니다.

### Daily Diff Engine (일일 변경분 추적)

매일 전체 데이터를 스캔하여 변경분을 계산합니다.
AI는 오늘 무엇이 바뀌었는지 정확히 알고 있습니다.

---

## 📊 DB 구조

```
⚠️ 이 DB는 "검증용(Verification)" 목적입니다.

Laws          - 법령 마스터 (버전 관리, 시행일/공포일)
Articles      - 조문 데이터 (본문, 해시값)
Diff_Logs     - 변경 이력 (Diff Engine)
Precedents    - 판례 인덱스 (존재 여부만)
LegalTerms    - 법률 용어 정의
SyncMetadata  - 동기화 메타데이터
```

---

## ⚙️ 설정 (Setup)

### 1️⃣ 환경 변수 설정

`.env` 파일을 생성하고 아래 내용을 입력하세요:

```bash
# 국가법령정보센터 API 키 (필수)
LAW_API_KEY=your_api_key_here

# Supabase 설정 (클라우드 DB 사용 시)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# 로컬 DB 경로 (SQLite 캐시용)
LOCAL_DB_PATH=./data/laws.db

# Daily Sync 활성화
ENABLE_DAILY_SYNC=true
```

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `LAW_API_KEY` | 국가법령정보센터 API 키 (필수) | - |
| `SUPABASE_URL` | Supabase 프로젝트 URL | - |
| `SUPABASE_ANON_KEY` | Supabase 공개 키 | - |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 서비스 키 (Sync 작업용) | - |
| `LOCAL_DB_PATH` | 로컬 SQLite DB 경로 | `./data/laws.db` |
| `ENABLE_DAILY_SYNC` | 자동 동기화 활성화 | `true` |

**API 키 발급:**
- 국가법령정보센터 Open API: https://www.law.go.kr/LSW/openApi.do
- Supabase 프로젝트 생성: https://supabase.com/dashboard

### 2️⃣ Supabase 데이터베이스 설정

1. Supabase 대시보드 → **SQL Editor** 이동
2. `supabase-schema.sql` 파일 내용 복사
3. SQL Editor에 붙여넣기 후 실행

```bash
# 스키마 파일 확인
cat supabase-schema.sql
```

### 3️⃣ 초기 동기화

```bash
# DB 초기화
npm run init

# 법령 데이터 동기화 (최초 1회)
npm run sync
```

---

## 📚 관련 패키지

| 패키지 | 설명 |
|--------|------|
| [@2seo/law](https://www.npmjs.com/package/@2seo/law) | 통합 패키지 |
| [law-ko](https://www.npmjs.com/package/law-ko) | 한국어 법률 |
| [law-kr](https://www.npmjs.com/package/law-kr) | 한국 법률 |
| [korean-law](https://www.npmjs.com/package/korean-law) | Korean Law |

---

## 📄 License

MIT

---

## 👤 Author

2seo <iyu974895@gmail.com>

---

**⚠️ 다시 한번 강조합니다:**

이 도구는 AI의 법률 인용을 검증하기 위한 **보조 도구**입니다.
법적 효력의 최종 판단은 반드시 **국가법령정보센터(law.go.kr)**를 참조하세요.
