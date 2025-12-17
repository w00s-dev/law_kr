/**
 * korea-law: Database Module
 * 
 * ⚠️ 중요: 이 DB는 "검증용(Verification)" 목적입니다.
 * AI가 생성한 법률 인용의 정확성을 검증하기 위한 기준 데이터입니다.
 * 법적 효력의 최종 판단은 국가법령정보센터(law.go.kr)를 참조하세요.
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const DB_PATH = process.env.KOREA_LAW_DB_PATH || path.join(__dirname, '../../data/korea-law.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let db: Database.Database | null = null;

/**
 * DB 초기화 및 연결
 */
export function initDatabase(): Database.Database {
  if (db) return db;

  // 데이터 디렉토리 생성
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // 스키마 적용
  if (fs.existsSync(SCHEMA_PATH)) {
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    db.exec(schema);
  }

  console.log(`✅ Database initialized: ${DB_PATH}`);
  console.log('⚠️  주의: 이 DB는 AI 검증용입니다. 법적 판단의 최종 근거로 사용하지 마세요.');
  
  return db;
}

/**
 * DB 연결 가져오기
 */
export function getDatabase(): Database.Database {
  if (!db) {
    return initDatabase();
  }
  return db;
}

/**
 * DB 연결 종료
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// ============================================
// 법령 관련 함수
// ============================================

export interface LawRecord {
  id?: number;
  law_mst_id: string;
  law_name: string;
  law_name_eng?: string;
  promulgation_date: string;
  enforcement_date: string;
  law_type?: string;
  ministry?: string;
  status?: string;
  source_url?: string;
}

export interface ArticleRecord {
  id?: number;
  law_id: number;
  article_no: string;
  article_no_normalized?: string;
  article_title?: string;
  content: string;
  paragraph_count?: number;
  is_definition?: boolean;
  effective_from?: string;
  effective_until?: string;
}

export interface DiffRecord {
  id?: number;
  law_id: number;
  article_id?: number;
  change_type: 'ADDED' | 'MODIFIED' | 'DELETED';
  previous_content?: string;
  current_content?: string;
  diff_summary?: string;
  detected_at?: string;
  effective_from?: string;
  is_critical?: boolean;
  warning_message?: string;
}

export interface SyncMetadataRecord {
  sync_type: 'FULL' | 'INCREMENTAL' | 'DIFF';
  started_at: string;
  completed_at?: string;
  status?: 'RUNNING' | 'SUCCESS' | 'FAILED';
  laws_added?: number;
  laws_updated?: number;
  articles_added?: number;
  articles_updated?: number;
  diffs_detected?: number;
  error_message?: string;
  source_data_date?: string;
}

/**
 * 법령 추가/업데이트
 */
export function upsertLaw(law: LawRecord): number {
  const db = getDatabase();
  const normalized = normalizeLawName(law.law_name);
  const checksum = generateChecksum(JSON.stringify(law));

  const stmt = db.prepare(`
    INSERT INTO Laws (law_mst_id, law_name, law_name_eng, promulgation_date, enforcement_date, 
                      law_type, ministry, status, source_url, law_name_normalized, checksum, last_synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(law_mst_id) DO UPDATE SET
      law_name = excluded.law_name,
      promulgation_date = excluded.promulgation_date,
      enforcement_date = excluded.enforcement_date,
      law_type = excluded.law_type,
      ministry = excluded.ministry,
      status = excluded.status,
      source_url = excluded.source_url,
      checksum = excluded.checksum,
      last_synced_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `);

  const result = stmt.run(
    law.law_mst_id,
    law.law_name,
    law.law_name_eng || null,
    law.promulgation_date,
    law.enforcement_date,
    law.law_type || null,
    law.ministry || null,
    law.status || 'ACTIVE',
    law.source_url || null,
    normalized,
    checksum
  );

  // ON CONFLICT UPDATE시 lastInsertRowid가 0이므로 SELECT로 ID 조회
  if (result.lastInsertRowid === 0 || result.changes === 1) {
    const selectStmt = db.prepare('SELECT id FROM Laws WHERE law_mst_id = ?');
    const row = selectStmt.get(law.law_mst_id) as { id: number } | undefined;
    return row?.id || 0;
  }

  return result.lastInsertRowid as number;
}

/**
 * 조문 추가/업데이트
 */
export function upsertArticle(article: ArticleRecord): number {
  const db = getDatabase();
  const normalized = normalizeArticleNo(article.article_no);
  const contentHash = generateChecksum(article.content);

  // 먼저 기존 레코드 확인
  const checkStmt = db.prepare(`
    SELECT id FROM Articles WHERE law_id = ? AND article_no = ?
  `);
  const existing = checkStmt.get(article.law_id, article.article_no) as { id: number } | undefined;

  if (existing) {
    // 업데이트
    const updateStmt = db.prepare(`
      UPDATE Articles SET
        article_no_normalized = ?,
        article_title = ?,
        content = ?,
        paragraph_count = ?,
        is_definition = ?,
        content_hash = ?,
        effective_from = ?,
        effective_until = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    updateStmt.run(
      normalized,
      article.article_title || null,
      article.content,
      article.paragraph_count || 1,
      article.is_definition ? 1 : 0,
      contentHash,
      article.effective_from || null,
      article.effective_until || null,
      existing.id
    );

    return existing.id;
  } else {
    // 신규 삽입
    const insertStmt = db.prepare(`
      INSERT INTO Articles (law_id, article_no, article_no_normalized, article_title, content,
                            paragraph_count, is_definition, content_hash, effective_from, effective_until)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = insertStmt.run(
      article.law_id,
      article.article_no,
      normalized,
      article.article_title || null,
      article.content,
      article.paragraph_count || 1,
      article.is_definition ? 1 : 0,
      contentHash,
      article.effective_from || null,
      article.effective_until || null
    );

    return result.lastInsertRowid as number;
  }
}

/**
 * 변경 이력 기록
 */
export function insertDiffLog(diff: DiffRecord): number {
  const db = getDatabase();

  const stmt = db.prepare(`
    INSERT INTO Diff_Logs (law_id, article_id, change_type, previous_content, current_content,
                           diff_summary, effective_from, is_critical, warning_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    diff.law_id,
    diff.article_id || null,
    diff.change_type,
    diff.previous_content || null,
    diff.current_content || null,
    diff.diff_summary || null,
    diff.effective_from || null,
    diff.is_critical ? 1 : 0,
    diff.warning_message || null
  );

  return result.lastInsertRowid as number;
}

/**
 * 동기화 메타데이터 기록
 */
export function insertSyncMetadata(metadata: SyncMetadataRecord): number {
  const db = getDatabase();

  const stmt = db.prepare(`
    INSERT INTO SyncMetadata (sync_type, started_at, completed_at, status, laws_added, laws_updated,
                              articles_added, articles_updated, diffs_detected, error_message, source_data_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    metadata.sync_type,
    metadata.started_at,
    metadata.completed_at || null,
    metadata.status || 'SUCCESS',
    metadata.laws_added || 0,
    metadata.laws_updated || 0,
    metadata.articles_added || 0,
    metadata.articles_updated || 0,
    metadata.diffs_detected || 0,
    metadata.error_message || null,
    metadata.source_data_date || null
  );

  return result.lastInsertRowid as number;
}

/**
 * 동기화 메타데이터 업데이트
 */
export function updateSyncMetadata(
  syncId: number,
  updates: Partial<Omit<SyncMetadataRecord, 'sync_type' | 'started_at'>>
): void {
  const db = getDatabase();

  const stmt = db.prepare(`
    UPDATE SyncMetadata SET
      completed_at = COALESCE(?, completed_at),
      status = COALESCE(?, status),
      laws_added = COALESCE(?, laws_added),
      laws_updated = COALESCE(?, laws_updated),
      articles_added = COALESCE(?, articles_added),
      articles_updated = COALESCE(?, articles_updated),
      diffs_detected = COALESCE(?, diffs_detected),
      error_message = COALESCE(?, error_message),
      source_data_date = COALESCE(?, source_data_date)
    WHERE id = ?
  `);

  stmt.run(
    updates.completed_at || null,
    updates.status || null,
    updates.laws_added !== undefined ? updates.laws_added : null,
    updates.laws_updated !== undefined ? updates.laws_updated : null,
    updates.articles_added !== undefined ? updates.articles_added : null,
    updates.articles_updated !== undefined ? updates.articles_updated : null,
    updates.diffs_detected !== undefined ? updates.diffs_detected : null,
    updates.error_message || null,
    updates.source_data_date || null,
    syncId
  );
}

// ============================================
// 검색/조회 함수 (MCP Tools에서 사용)
// ============================================

/**
 * 법령명으로 검색 (현행 기준)
 */
export function findLawByName(lawName: string, targetDate?: string): LawRecord | null {
  const db = getDatabase();
  const normalized = normalizeLawName(lawName);
  const date = targetDate || new Date().toISOString().split('T')[0];

  const stmt = db.prepare(`
    SELECT * FROM Laws 
    WHERE law_name_normalized LIKE ? 
    AND enforcement_date <= ?
    AND status = 'ACTIVE'
    ORDER BY enforcement_date DESC
    LIMIT 1
  `);

  return stmt.get(`%${normalized}%`, date) as LawRecord | null;
}

/**
 * 특정 조문 조회
 */
export function findArticle(lawId: number, articleNo: string): ArticleRecord | null {
  const db = getDatabase();
  const normalized = normalizeArticleNo(articleNo);

  const stmt = db.prepare(`
    SELECT * FROM Articles 
    WHERE law_id = ? 
    AND (article_no = ? OR article_no_normalized = ?)
    AND (effective_until IS NULL OR effective_until > DATE('now'))
    ORDER BY effective_from DESC
    LIMIT 1
  `);

  return stmt.get(lawId, articleNo, normalized) as ArticleRecord | null;
}

/**
 * 오늘의 변경 사항 조회
 */
export function getTodayDiffs(): any[] {
  const db = getDatabase();
  
  const stmt = db.prepare(`
    SELECT 
      d.*,
      l.law_name,
      a.article_no,
      a.article_title
    FROM Diff_Logs d
    JOIN Laws l ON d.law_id = l.id
    LEFT JOIN Articles a ON d.article_id = a.id
    WHERE d.detected_at = DATE('now')
    ORDER BY d.is_critical DESC, d.created_at DESC
  `);

  return stmt.all();
}

/**
 * 기간 내 변경 예정 법령 조회
 */
export function getFutureChanges(startDate: string, endDate: string): any[] {
  const db = getDatabase();
  
  const stmt = db.prepare(`
    SELECT 
      d.*,
      l.law_name,
      a.article_no,
      a.article_title
    FROM Diff_Logs d
    JOIN Laws l ON d.law_id = l.id
    LEFT JOIN Articles a ON d.article_id = a.id
    WHERE d.effective_from BETWEEN ? AND ?
    ORDER BY d.effective_from ASC
  `);

  return stmt.all(startDate, endDate);
}

/**
 * 판례 존재 여부 확인
 */
export function verifyPrecedentExists(caseId: string): boolean {
  const db = getDatabase();
  const normalized = normalizeCaseId(caseId);

  const stmt = db.prepare(`
    SELECT 1 FROM Precedents 
    WHERE case_id = ? OR case_id_normalized = ?
    LIMIT 1
  `);

  const result = stmt.get(caseId, normalized);
  return !!result;
}

// ============================================
// 유틸리티 함수
// ============================================

function normalizeLawName(name: string): string {
  return name
    .replace(/\s+/g, '')
    .replace(/[^\w가-힣]/g, '')
    .toLowerCase();
}

function normalizeArticleNo(articleNo: string | number): string {
  // "제23조" → "23", "제23조의2" → "23-2"
  const str = String(articleNo || '');
  return str
    .replace(/제/g, '')
    .replace(/조의/g, '-')
    .replace(/조/g, '')
    .replace(/항/g, '.')
    .replace(/호/g, '-')
    .trim();
}

function normalizeCaseId(caseId: string): string {
  // "2023다12345" → "2023다12345" (공백/특수문자 제거)
  return caseId.replace(/\s+/g, '').replace(/[^\w가-힣]/g, '');
}

function generateChecksum(data: string): string {
  return crypto.createHash('md5').update(data).digest('hex');
}

export {
  normalizeLawName,
  normalizeArticleNo,
  normalizeCaseId,
  generateChecksum
};

