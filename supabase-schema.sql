-- ============================================
-- korea-law: Supabase (PostgreSQL) Schema
-- ============================================
-- ⚠️ 중요: 이 DB는 "검증용(Verification)" 목적입니다.
-- AI가 생성한 법률 인용의 정확성을 검증하기 위한 기준 데이터입니다.
-- 법적 효력의 최종 판단은 국가법령정보센터(law.go.kr)를 참조하세요.
-- ============================================

-- 법령 마스터 테이블 (버전 관리)
-- 용도: AI 인용 검증의 "기준값" 저장
CREATE TABLE IF NOT EXISTS laws (
    id BIGSERIAL PRIMARY KEY,
    law_mst_id TEXT UNIQUE NOT NULL,    -- 국가법령정보센터 법령 ID
    law_name TEXT NOT NULL,              -- 법령명 (예: 근로기준법)
    law_name_eng TEXT,                   -- 영문 법령명
    promulgation_date DATE NOT NULL,     -- 공포일 (법이 세상에 알려진 날)
    enforcement_date DATE NOT NULL,      -- 시행일 (실제 효력 발생일)
    law_type TEXT,                       -- 법률/시행령/시행규칙 등
    ministry TEXT,                       -- 소관부처
    status TEXT DEFAULT 'ACTIVE',        -- ACTIVE(현행)/PENDING(미시행)/EXPIRED(폐지)

    -- 검증용 메타데이터
    source_url TEXT,                     -- 원본 출처 URL
    last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    checksum TEXT,                       -- 데이터 무결성 확인용 해시

    -- 인덱스를 위한 정규화된 검색 필드
    law_name_normalized TEXT,            -- 검색용 정규화 (공백/특수문자 제거)

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 조문 데이터 테이블
-- 용도: AI가 "제23조"를 인용했을 때, 실제 내용과 대조하는 "정답지"
CREATE TABLE IF NOT EXISTS articles (
    id BIGSERIAL PRIMARY KEY,
    law_id BIGINT NOT NULL,
    article_no TEXT NOT NULL,            -- "제23조", "제23조의2" 등
    article_no_normalized TEXT,          -- 정규화된 조문번호 (23, 23-2)
    article_title TEXT,                  -- 조문 제목 (예: 해고의 제한)
    content TEXT NOT NULL,               -- 조문 본문 전체
    paragraph_count INTEGER DEFAULT 1,   -- 항 개수

    -- ⚠️ 검증 전용 필드
    content_hash TEXT,                   -- 내용 해시 (변경 감지용)
    is_definition BOOLEAN DEFAULT FALSE, -- 제2조(정의) 여부 (용어 검증용)

    effective_from DATE,                 -- 이 조문의 시행일
    effective_until DATE,                -- 효력 종료일 (NULL = 현행)

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (law_id) REFERENCES laws(id) ON DELETE CASCADE
);

-- 변경 이력 테이블 (Diff Engine)
-- 용도: "어제와 오늘 뭐가 바뀌었나?" 추적
CREATE TABLE IF NOT EXISTS diff_logs (
    id BIGSERIAL PRIMARY KEY,
    law_id BIGINT NOT NULL,
    article_id BIGINT,                   -- NULL이면 법령 전체 변경

    change_type TEXT NOT NULL,           -- 'ADDED', 'MODIFIED', 'DELETED'

    -- 변경 전후 내용 (검증용)
    previous_content TEXT,
    current_content TEXT,
    diff_summary TEXT,                   -- 변경 요약 (예: "과태료 500만원 → 1000만원")

    -- 시점 정보
    detected_at DATE DEFAULT CURRENT_DATE,
    effective_from DATE,                 -- 변경 시행일

    -- ⚠️ AI 경고용 플래그
    is_critical BOOLEAN DEFAULT FALSE,   -- 중요 변경 여부 (금액/기간/처벌 등)
    warning_message TEXT,                -- AI에게 전달할 경고 메시지

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (law_id) REFERENCES laws(id) ON DELETE CASCADE,
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE SET NULL
);

-- 판례 인덱스 테이블
-- 용도: AI가 인용한 판례가 실제 존재하는지 "가짜 판례 방지"
CREATE TABLE IF NOT EXISTS precedents (
    id BIGSERIAL PRIMARY KEY,
    case_id TEXT UNIQUE NOT NULL,        -- 사건번호 (예: 2023다12345)
    case_id_normalized TEXT,             -- 정규화된 사건번호
    court TEXT,                          -- 법원명 (대법원, 서울고등법원 등)
    case_type TEXT,                      -- 민사/형사/행정 등
    decision_date DATE,                  -- 선고일
    case_name TEXT,                      -- 사건명

    -- ⚠️ 검증 전용: 존재 여부만 확인 (전문은 저장 안 함)
    exists_verified BOOLEAN DEFAULT TRUE,
    last_verified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 용어 정의 테이블 (법률 용어 사전)
-- 용도: AI가 "해고"라고 썼는데 "권고사직"이 맞는지 검증
CREATE TABLE IF NOT EXISTS legal_terms (
    id BIGSERIAL PRIMARY KEY,
    law_id BIGINT NOT NULL,
    term TEXT NOT NULL,                  -- 용어 (예: 해고, 근로자)
    term_normalized TEXT,                -- 정규화된 용어
    definition TEXT NOT NULL,            -- 정의 내용
    article_ref TEXT,                    -- 출처 조문 (예: 제2조제1항제1호)

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (law_id) REFERENCES laws(id) ON DELETE CASCADE
);

-- ============================================
-- 인덱스 생성 (검색 성능 최적화)
-- ============================================
CREATE INDEX IF NOT EXISTS idx_laws_name ON laws(law_name);
CREATE INDEX IF NOT EXISTS idx_laws_name_normalized ON laws(law_name_normalized);
CREATE INDEX IF NOT EXISTS idx_laws_enforcement ON laws(enforcement_date);
CREATE INDEX IF NOT EXISTS idx_laws_status ON laws(status);

CREATE INDEX IF NOT EXISTS idx_articles_law_id ON articles(law_id);
CREATE INDEX IF NOT EXISTS idx_articles_no ON articles(article_no);
CREATE INDEX IF NOT EXISTS idx_articles_no_normalized ON articles(article_no_normalized);

CREATE INDEX IF NOT EXISTS idx_diff_law_id ON diff_logs(law_id);
CREATE INDEX IF NOT EXISTS idx_diff_detected ON diff_logs(detected_at);
CREATE INDEX IF NOT EXISTS idx_diff_effective ON diff_logs(effective_from);

CREATE INDEX IF NOT EXISTS idx_precedents_case_id ON precedents(case_id);
CREATE INDEX IF NOT EXISTS idx_precedents_case_normalized ON precedents(case_id_normalized);

CREATE INDEX IF NOT EXISTS idx_terms_term ON legal_terms(term);
CREATE INDEX IF NOT EXISTS idx_terms_normalized ON legal_terms(term_normalized);

-- ============================================
-- 검증 메타데이터 테이블
-- 용도: DB 자체의 신뢰성 및 최신성 확인
-- ============================================
CREATE TABLE IF NOT EXISTS sync_metadata (
    id BIGSERIAL PRIMARY KEY,
    sync_type TEXT NOT NULL,             -- 'FULL', 'INCREMENTAL', 'DIFF'
    started_at TIMESTAMP NOT NULL,
    completed_at TIMESTAMP,
    status TEXT DEFAULT 'RUNNING',       -- 'RUNNING', 'SUCCESS', 'FAILED'

    laws_added INTEGER DEFAULT 0,
    laws_updated INTEGER DEFAULT 0,
    articles_added INTEGER DEFAULT 0,
    articles_updated INTEGER DEFAULT 0,
    diffs_detected INTEGER DEFAULT 0,

    error_message TEXT,

    -- ⚠️ 검증용: 마지막 동기화 시점 확인
    source_data_date DATE,               -- 원본 데이터의 기준 날짜

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 뷰 생성 (자주 사용하는 쿼리)
-- ============================================

-- 현행 유효 법령만 조회
CREATE OR REPLACE VIEW current_laws AS
SELECT * FROM laws
WHERE status = 'ACTIVE'
AND enforcement_date <= CURRENT_DATE;

-- 오늘 변경된 사항
CREATE OR REPLACE VIEW today_diffs AS
SELECT
    d.*,
    l.law_name,
    a.article_no,
    a.article_title
FROM diff_logs d
JOIN laws l ON d.law_id = l.id
LEFT JOIN articles a ON d.article_id = a.id
WHERE d.detected_at = CURRENT_DATE;

-- 미래 시행 예정 (공포됨/미시행)
CREATE OR REPLACE VIEW pending_laws AS
SELECT * FROM laws
WHERE status = 'PENDING'
OR enforcement_date > CURRENT_DATE;

-- ============================================
-- Row Level Security (RLS) 설정
-- ============================================

-- Enable RLS on all tables
ALTER TABLE laws ENABLE ROW LEVEL SECURITY;
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE diff_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE precedents ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_metadata ENABLE ROW LEVEL SECURITY;

-- Public read access (anyone can read)
CREATE POLICY "Public read access on laws" ON laws FOR SELECT USING (true);
CREATE POLICY "Public read access on articles" ON articles FOR SELECT USING (true);
CREATE POLICY "Public read access on diff_logs" ON diff_logs FOR SELECT USING (true);
CREATE POLICY "Public read access on precedents" ON precedents FOR SELECT USING (true);
CREATE POLICY "Public read access on legal_terms" ON legal_terms FOR SELECT USING (true);
CREATE POLICY "Public read access on sync_metadata" ON sync_metadata FOR SELECT USING (true);

-- Service role can do everything (for sync operations)
CREATE POLICY "Service role full access on laws" ON laws FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access on articles" ON articles FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access on diff_logs" ON diff_logs FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access on precedents" ON precedents FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access on legal_terms" ON legal_terms FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access on sync_metadata" ON sync_metadata FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- Functions & Triggers
-- ============================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_laws_updated_at BEFORE UPDATE ON laws
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_articles_updated_at BEFORE UPDATE ON articles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
