/**
 * korea-law: Supabase Client Module
 * 
 * Supabase (PostgreSQL) 연동 모듈
 * SQLite와 동일한 인터페이스를 제공하여 쉽게 전환 가능
 * 
 * ⚠️ 중요: 이 DB는 "검증용(Verification)" 목적입니다.
 * AI가 생성한 법률 인용의 정확성을 검증하기 위한 기준 데이터입니다.
 * 법적 효력의 최종 판단은 국가법령정보센터(law.go.kr)를 참조하세요.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';

// 환경 변수
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

let supabase: SupabaseClient | null = null;

// ============================================
// 타입 정의
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
  law_name_normalized?: string;
  checksum?: string;
}

export interface ArticleRecord {
  id?: number;
  law_id: number;
  article_no: string;
  article_no_normalized?: string;
  article_title?: string;
  content: string;
  paragraph_count?: number;
  content_hash?: string;
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

export interface PrecedentRecord {
  id?: number;
  case_id: string;
  case_id_normalized?: string;
  court?: string;
  case_type?: string;
  decision_date?: string;
  case_name?: string;
  exists_verified?: boolean;
}

export interface LegalTermRecord {
  id?: number;
  law_id: number;
  term: string;
  term_normalized?: string;
  definition: string;
  article_ref?: string;
}

// ============================================
// Supabase 초기화
// ============================================

/**
 * Supabase 클라이언트 초기화 (Service Role)
 * 데이터 쓰기용 - 동기화 작업에 사용
 */
export function initSupabaseAdmin(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
  }

  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  console.log('✅ Supabase Admin Client initialized');
  console.log('⚠️  주의: 이 DB는 AI 검증용입니다. 법적 판단의 최종 근거로 사용하지 마세요.');

  return supabase;
}

/**
 * Supabase 클라이언트 초기화 (Anon Key)
 * 읽기 전용 - MCP 서버에서 사용
 */
export function initSupabaseClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required');
  }

  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  console.log('✅ Supabase Client initialized (read-only)');

  return supabase;
}

/**
 * Supabase 클라이언트 가져오기
 */
export function getSupabase(): SupabaseClient {
  if (!supabase) {
    // 기본적으로 읽기 전용 클라이언트 사용
    if (SUPABASE_SERVICE_KEY) {
      return initSupabaseAdmin();
    }
    return initSupabaseClient();
  }
  return supabase;
}

// ============================================
// 법령 관련 함수
// ============================================

/**
 * 법령 추가/업데이트 (Upsert)
 */
export async function upsertLaw(law: LawRecord): Promise<number> {
  const db = getSupabase();
  const normalized = normalizeLawName(law.law_name);
  const checksum = generateChecksum(JSON.stringify(law));

  const { data, error } = await db
    .from('laws')
    .upsert({
      ...law,
      law_name_normalized: normalized,
      checksum: checksum,
      last_synced_at: new Date().toISOString(),
    }, {
      onConflict: 'law_mst_id',
    })
    .select('id')
    .single();

  if (error) {
    console.error('법령 upsert 실패:', error);
    throw error;
  }

  return data?.id || 0;
}

/**
 * 조문 추가/업데이트
 */
export async function upsertArticle(article: ArticleRecord): Promise<number> {
  const db = getSupabase();
  const normalized = normalizeArticleNo(article.article_no);
  const contentHash = generateChecksum(article.content);

  const { data, error } = await db
    .from('articles')
    .upsert({
      ...article,
      article_no_normalized: normalized,
      content_hash: contentHash,
    }, {
      onConflict: 'law_id,article_no',
      ignoreDuplicates: false,
    })
    .select('id')
    .single();

  if (error) {
    console.error('조문 upsert 실패:', error);
    throw error;
  }

  return data?.id || 0;
}

/**
 * 변경 이력 기록
 */
export async function insertDiffLog(diff: DiffRecord): Promise<number> {
  const db = getSupabase();

  const { data, error } = await db
    .from('diff_logs')
    .insert(diff)
    .select('id')
    .single();

  if (error) {
    console.error('Diff 기록 실패:', error);
    throw error;
  }

  return data?.id || 0;
}

/**
 * 판례 추가
 */
export async function upsertPrecedent(precedent: PrecedentRecord): Promise<number> {
  const db = getSupabase();
  const normalized = normalizeCaseId(precedent.case_id);

  const { data, error } = await db
    .from('precedents')
    .upsert({
      ...precedent,
      case_id_normalized: normalized,
      last_verified_at: new Date().toISOString(),
    }, {
      onConflict: 'case_id',
    })
    .select('id')
    .single();

  if (error) {
    console.error('판례 upsert 실패:', error);
    throw error;
  }

  return data?.id || 0;
}

/**
 * 법률 용어 추가
 */
export async function upsertLegalTerm(term: LegalTermRecord): Promise<number> {
  const db = getSupabase();
  const normalized = term.term.replace(/\s+/g, '').toLowerCase();

  const { data, error } = await db
    .from('legal_terms')
    .upsert({
      ...term,
      term_normalized: normalized,
    }, {
      onConflict: 'law_id,term',
      ignoreDuplicates: false,
    })
    .select('id')
    .single();

  if (error) {
    console.error('용어 upsert 실패:', error);
    throw error;
  }

  return data?.id || 0;
}

// ============================================
// 검색/조회 함수 (MCP Tools에서 사용)
// ============================================

/**
 * 법령명으로 검색 (현행 기준)
 */
export async function findLawByName(lawName: string, targetDate?: string): Promise<LawRecord | null> {
  const db = getSupabase();
  const normalized = normalizeLawName(lawName);
  const date = targetDate || new Date().toISOString().split('T')[0];

  const { data, error } = await db
    .from('laws')
    .select('*')
    .ilike('law_name_normalized', `%${normalized}%`)
    .lte('enforcement_date', date)
    .eq('status', 'ACTIVE')
    .order('enforcement_date', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('법령 검색 실패:', error);
  }

  return data;
}

/**
 * 특정 조문 조회
 */
export async function findArticle(lawId: number, articleNo: string): Promise<ArticleRecord | null> {
  const db = getSupabase();
  const normalized = normalizeArticleNo(articleNo);

  const { data, error } = await db
    .from('articles')
    .select('*')
    .eq('law_id', lawId)
    .or(`article_no.eq.${articleNo},article_no_normalized.eq.${normalized}`)
    .is('effective_until', null)
    .order('effective_from', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('조문 검색 실패:', error);
  }

  return data;
}

/**
 * 오늘의 변경 사항 조회
 */
export async function getTodayDiffs(): Promise<any[]> {
  const db = getSupabase();
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await db
    .from('today_diffs')
    .select('*')
    .eq('detected_at', today)
    .order('is_critical', { ascending: false });

  if (error) {
    console.error('오늘 Diff 조회 실패:', error);
    return [];
  }

  return data || [];
}

/**
 * 기간 내 변경 예정 법령 조회
 */
export async function getFutureChanges(startDate: string, endDate: string): Promise<any[]> {
  const db = getSupabase();

  const { data, error } = await db
    .from('diff_logs')
    .select(`
      *,
      laws(law_name),
      articles(article_no, article_title)
    `)
    .gte('effective_from', startDate)
    .lte('effective_from', endDate)
    .order('effective_from', { ascending: true });

  if (error) {
    console.error('미래 변경 조회 실패:', error);
    return [];
  }

  return data || [];
}

/**
 * 판례 존재 여부 확인
 */
export async function verifyPrecedentExists(caseId: string): Promise<boolean> {
  const db = getSupabase();
  const normalized = normalizeCaseId(caseId);

  const { data, error } = await db
    .from('precedents')
    .select('id')
    .or(`case_id.eq.${caseId},case_id_normalized.eq.${normalized}`)
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('판례 확인 실패:', error);
  }

  return !!data;
}

/**
 * 법률 용어 검색
 */
export async function findLegalTerm(lawId: number, term: string): Promise<LegalTermRecord | null> {
  const db = getSupabase();
  const normalized = term.replace(/\s+/g, '').toLowerCase();

  const { data, error } = await db
    .from('legal_terms')
    .select('*')
    .eq('law_id', lawId)
    .or(`term.ilike.%${term}%,term_normalized.eq.${normalized}`)
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('용어 검색 실패:', error);
  }

  return data;
}

/**
 * 동기화 메타데이터 기록
 */
export async function recordSyncMetadata(metadata: {
  sync_type: string;
  started_at: string;
  completed_at?: string;
  status: string;
  laws_added?: number;
  laws_updated?: number;
  articles_added?: number;
  articles_updated?: number;
  diffs_detected?: number;
  error_message?: string;
  source_data_date?: string;
}): Promise<number> {
  const db = getSupabase();

  const { data, error } = await db
    .from('sync_metadata')
    .insert(metadata)
    .select('id')
    .single();

  if (error) {
    console.error('동기화 메타데이터 기록 실패:', error);
    throw error;
  }

  return data?.id || 0;
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

function normalizeArticleNo(articleNo: string): string {
  return articleNo
    .replace(/제/g, '')
    .replace(/조의/g, '-')
    .replace(/조/g, '')
    .replace(/항/g, '.')
    .replace(/호/g, '-')
    .trim();
}

function normalizeCaseId(caseId: string): string {
  return caseId.replace(/\s+/g, '').replace(/[^\w가-힣]/g, '');
}

function generateChecksum(data: string): string {
  return crypto.createHash('md5').update(data).digest('hex');
}

export {
  normalizeLawName,
  normalizeArticleNo,
  normalizeCaseId,
  generateChecksum,
};

