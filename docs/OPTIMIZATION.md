## 💡 의견 및 보완 필요 사항

### 1. 적절성 검토
- **데이터 무결성 우선순위**: 현재 발견된 데이터 누락(항/호 미포함) 및 중복 문제를 Phase 1에서 최우선으로 다루는 전략은 매우 시급하고 적절함. 데이터가 신뢰할 수 없으면 이후의 최적화는 무의미하기 때문.
- **이력 관리 설계**: 법령 데이터의 특성상 수시로 개정되므로, `Snapshot + Delta` 방식의 Diff 저장 전략(Phase 2-2)은 저장 용량 절감과 이력 추적 두 마리 토끼를 잡는 좋은 접근임.
- **검색 효율화**: 전문 검색(FTS)과 캐싱 계층 분리는 사용자 경험(응답 속도) 향상을 위해 필수적인 요소임.

### 2. 보완 필요 사항 및 제안
- **Phase 2-1 (CAS) 도입 재고**: `article_contents`를 해시로 분리하는 Content-Addressable Storage 방식은 구현 복잡도를 크게 높임. 법령 간에 완전히 동일한 긴 텍스트가 반복되는 경우가 드물다면, 단순 DB 레벨 압축이나 Diff 저장만으로도 충분할 수 있음. 오버엔지니어링 방지를 위해 도입 전 중복률 테스트 선행 권장.
- **검색 인덱스 동기화 구체화**: 원본 `Articles` 테이블과 `law_search_index` 테이블 간의 데이터 정합성을 어떻게 유지할지(Database Trigger 사용 vs 애플리케이션 레벨 처리)에 대한 구체적인 정책 결정 필요. Trigger 방식이 안정적임.
- **특수 데이터 처리**: 조문 파싱 로직(`parseArticleContent`) 보완 시, 단순 텍스트 외에 '별표', '서식', '이미지' 등이 포함된 경우에 대한 처리 방안(링크로 저장할지, 제외할지 등)이 누락되어 있음. 이에 대한 기준 수립 필요.
- **API 에러 핸들링**: 공공데이터포털 API가 불안정할 경우(타임아웃, 포맷 변경 등)에 대한 방어 로직 및 재시도 전략이 데이터 수집 단계에 포함되어야 함.

---

# 법령 데이터베이스 효율화 방안

## 📊 현재 상태 분석

### 데이터 현황
| 항목 | 값 | 비고 |
|------|-----|------|
| DB 크기 | 1.5 MB | 일부 법령만 (전체 시 수백 MB 예상) |
| 법령 수 | 103건 | |
| 조문 수 | 3,931건 | |
| Diff 로그 | 670건 | |
| 평균 조문 크기 | 49 bytes | ⚠️ 비정상적으로 작음 |

### 🔴 발견된 문제점

#### 1. 데이터 중복 (519건)
```
근로기준법 1조: 4개 (동일 조문이 4번 저장)
```
- **원인**: `upsert` 시 UNIQUE 제약 조건 미흡
- **영향**: 스토리지 낭비, 검색 결과 왜곡

#### 2. 조문 내용 불완전 (45.7%가 20bytes 이하)
```
제2조(정의) → 7 bytes (항 내용 누락)
```
- **원인**: API 응답에서 `항(paragraph)` 데이터를 제대로 파싱하지 못함
- **영향**: 법률 검증 기능 무력화

#### 3. 장/절 제목이 조문으로 저장됨
```
"제1장 총칙" → 조문으로 저장됨
```
- **원인**: 조문 여부 필터링 부재
- **영향**: 노이즈 데이터 증가

---

## 🚀 효율화 방안

### Phase 1: 데이터 정합성 개선 (우선)

#### 1-1. 스키마 개선: UNIQUE 제약 추가
```sql
-- Articles 테이블에 복합 UNIQUE 제약
ALTER TABLE Articles ADD CONSTRAINT unique_article 
  UNIQUE (law_id, article_no, effective_from);
```

#### 1-2. 조문 파싱 개선
```typescript
// 항(paragraph) 내용을 조문 내용에 포함
function parseArticleContent(article: any): string {
  let content = article.조문내용 || '';
  
  // 항(paragraph) 내용 병합
  if (article.항) {
    const paragraphs = Array.isArray(article.항) ? article.항 : [article.항];
    paragraphs.forEach((p: any) => {
      content += `\n${p.항번호} ${p.항내용 || ''}`;
      
      // 호(subitem) 내용 병합
      if (p.호) {
        const subitems = Array.isArray(p.호) ? p.호 : [p.호];
        subitems.forEach((s: any) => {
          content += `\n  ${s.호번호}. ${s.호내용 || ''}`;
        });
      }
    });
  }
  
  return content;
}
```

#### 1-3. 장/절 필터링
```typescript
// 조문 여부 확인
function isActualArticle(article: any): boolean {
  const articleNo = String(article.조문번호 || '');
  const content = String(article.조문내용 || '');
  
  // 장/절/관 제목 제외
  if (content.match(/^\s*제\d+[장절관편]/)) return false;
  
  // 조문번호가 숫자인지 확인
  if (!articleNo.match(/^\d+/)) return false;
  
  return true;
}
```

---

### Phase 2: 저장 효율화

#### 2-1. 내용 기반 중복 제거 (Content-Addressable Storage)
```sql
-- 조문 내용 별도 테이블
CREATE TABLE article_contents (
    content_hash TEXT PRIMARY KEY,  -- MD5/SHA256 해시
    content TEXT NOT NULL,
    content_compressed BLOB,        -- ZSTD 압축 (선택)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Articles 테이블에서 참조
ALTER TABLE Articles ADD COLUMN content_hash TEXT REFERENCES article_contents(content_hash);
```

**장점**:
- 동일 내용은 1번만 저장
- 캐시 히트율 증가
- 변경 감지 간소화 (해시 비교만으로 가능)

#### 2-2. Diff 저장 최적화
```typescript
// 스냅샷 + Delta 하이브리드
interface DiffStorage {
  // 5버전마다 전체 스냅샷
  snapshot_interval: 5;
  
  // Delta 포맷
  delta_format: {
    ops: Array<['equal' | 'add' | 'del', string]>;
  };
}

// 복원 로직
function reconstructContent(articleId: number, targetVersion: number): string {
  const snapshot = findNearestSnapshot(articleId, targetVersion);
  const deltas = getDeltasSince(articleId, snapshot.version, targetVersion);
  
  let content = snapshot.content;
  for (const delta of deltas) {
    content = applyDelta(content, delta);
  }
  return content;
}
```

---

### Phase 3: 활용 효율화 (검색/조회)

#### 3-1. 계층형 캐싱
```
┌─────────────────────────────────────────────┐
│  L1: 메모리 캐시 (LRU, 100건)               │
│  - 자주 조회되는 법령 (근로기준법, 민법 등)  │
├─────────────────────────────────────────────┤
│  L2: 요약 테이블 (DB)                        │
│  - 검색용 인덱스                             │
│  - 법령별 키워드/요약                        │
├─────────────────────────────────────────────┤
│  L3: 원본 데이터 (DB)                        │
│  - 압축 저장                                 │
│  - 필요시에만 접근                           │
└─────────────────────────────────────────────┘
```

#### 3-2. 검색용 요약 테이블
```sql
-- 빠른 검색을 위한 요약 테이블
CREATE TABLE law_search_index (
    id INTEGER PRIMARY KEY,
    law_id INTEGER NOT NULL,
    law_name TEXT NOT NULL,
    article_no TEXT,
    
    -- 검색용 필드
    keywords TEXT,              -- 추출된 키워드
    summary TEXT,               -- AI 생성 요약 (선택)
    
    -- 메타데이터
    is_definition BOOLEAN,      -- 정의 조항 여부
    is_penalty BOOLEAN,         -- 벌칙 조항 여부
    has_amount BOOLEAN,         -- 금액 포함 여부
    has_period BOOLEAN,         -- 기간 포함 여부
    
    -- FTS 인덱스
    search_text TEXT,           -- 검색용 텍스트
    
    FOREIGN KEY (law_id) REFERENCES Laws(id)
);

-- Full-Text Search 인덱스
CREATE VIRTUAL TABLE law_fts USING fts5(
    law_name, article_no, search_text, 
    content='law_search_index'
);
```

#### 3-3. 시맨틱 검색용 임베딩 (선택)
```typescript
// 조문 단위 임베딩 저장
interface ArticleEmbedding {
  article_id: number;
  embedding: Float32Array;  // 768 또는 1024 차원
  model_version: string;    // 'ko-sroberta-v1.0'
}

// 검색 파이프라인
async function semanticSearch(query: string): Promise<SearchResult[]> {
  // 1. 키워드 검색으로 후보군 축소 (BM25)
  const candidates = await keywordSearch(query, { limit: 100 });
  
  // 2. 임베딩 유사도로 재정렬
  const queryEmbedding = await embed(query);
  const ranked = candidates.map(c => ({
    ...c,
    score: cosineSimilarity(queryEmbedding, c.embedding)
  })).sort((a, b) => b.score - a.score);
  
  // 3. 현행법 우선 필터링
  return ranked.filter(r => r.status === 'ACTIVE').slice(0, 10);
}
```

---

### Phase 4: 증분 동기화 최적화

#### 4-1. 변경 이벤트 로그
```sql
CREATE TABLE sync_events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    law_id INTEGER,
    article_id INTEGER,
    operation TEXT,         -- 'CREATE', 'UPDATE', 'DELETE'
    version_seq INTEGER,
    payload_hash TEXT,      -- 변경 내용 해시
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_changed_at (changed_at)
);
```

#### 4-2. 클라이언트 동기화 API
```typescript
// 증분 동기화 엔드포인트
GET /api/sync/changes?since_event_id=1234&limit=100

// 응답
{
  "events": [
    {
      "event_id": 1235,
      "law_id": 1,
      "article_id": 23,
      "operation": "UPDATE",
      "diff": { "ops": [...] },
      "effective_from": "2025-01-01"
    }
  ],
  "has_more": true,
  "next_event_id": 1335
}
```

---

## 📈 예상 효과

| 개선 항목 | Before | After | 절감률 |
|----------|--------|-------|--------|
| 저장 용량 | 100% | ~40% | 60% |
| 중복 데이터 | 519건 | 0건 | 100% |
| 검색 속도 | O(n) | O(log n) | - |
| 동기화 트래픽 | 전체 | 변경분만 | ~90% |

---

## 🛠️ 구현 우선순위

1. **즉시**: 조문 파싱 수정 (Phase 1-2)
2. **1주**: 중복 제거 및 스키마 개선 (Phase 1-1, 2-1)
3. **2주**: 검색 인덱스 구축 (Phase 3-2)
4. **장기**: 시맨틱 검색 (Phase 3-3)

---

## 📚 참고 자료

- [법령정보데이타베이스의 현황과 전망](https://repository.klri.re.kr)
- [국가법령정보 공동활용](https://open.law.go.kr)
- [PostgreSQL Full-Text Search](https://www.postgresql.org/docs/current/textsearch.html)
- [Supabase pgvector](https://supabase.com/docs/guides/ai/vector-search)
