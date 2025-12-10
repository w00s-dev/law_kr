/**
 * korea-law: TypeScript Type Definitions
 */

// ============================================
// Core Law Types
// ============================================

export interface Law {
  law_id: string;
  law_name: string;
  law_name_en?: string;
  law_type: LawType;
  status: LawStatus;
  enforcement_date: string;
  promulgation_date: string;
  department: string;
  content_summary?: string;
  full_text?: string;
  created_at: string;
  updated_at: string;
}

export type LawType = '헌법' | '법률' | '대통령령' | '총리령' | '부령' | '조례' | '규칙';

export type LawStatus = 'active' | 'abolished' | 'pending';

// ============================================
// Law Article Types
// ============================================

export interface LawArticle {
  article_id: string;
  law_id: string;
  article_number: string; // "제1조", "제2조의2"
  article_title?: string; // "(목적)", "(정의)"
  article_content: string;
  parent_article_id?: string; // 조항 계층 구조
  created_at: string;
  updated_at: string;
}

// ============================================
// Law Change Log Types
// ============================================

export interface LawChange {
  law_id: string;
  law_name: string;
  change_type: ChangeType;
  changed_at: string;
  before_value: string | null;
  after_value: string | null;
  description: string;
}

export type ChangeType = 'new' | 'modified' | 'abolished';

// ============================================
// Verification Types
// ============================================

export interface VerificationRequest {
  law_citation: string; // "민법 제1조"
  claimed_content: string; // AI가 주장하는 내용
  context?: string; // 추가 컨텍스트
}

export interface VerificationResult {
  is_valid: boolean;
  confidence: number; // 0.0 ~ 1.0
  verification_type: VerificationType;
  details: VerificationDetails;
}

export type VerificationType =
  | 'exact_match'       // 정확히 일치
  | 'partial_match'     // 부분 일치
  | 'outdated'          // 구법 인용 (개정됨)
  | 'incorrect'         // 틀린 인용
  | 'not_found';        // 법령 존재 안 함

export interface VerificationDetails {
  law_id?: string;
  law_name?: string;
  article_number?: string;
  correct_content?: string;
  diff?: string; // 차이점 설명
  suggestion?: string; // 수정 제안
  source_url?: string; // 국가법령정보센터 링크
}

// ============================================
// API Response Types
// ============================================

export interface LawAPIResponse {
  success: boolean;
  total_count: number;
  page: number;
  page_size: number;
  laws: Law[];
}

export interface LawDetailResponse {
  success: boolean;
  law: Law | null;
  articles: LawArticle[];
}

// ============================================
// Search Types
// ============================================

export interface SearchQuery {
  query: string;
  law_type?: LawType;
  department?: string;
  status?: LawStatus;
  date_from?: string;
  date_to?: string;
  page?: number;
  pageSize?: number;
}

export interface SearchResult {
  total_count: number;
  laws: Law[];
  suggestions?: string[];
}

// ============================================
// MCP Tool Types
// ============================================

export interface VerifyLawToolArgs {
  law_citation: string;
  claimed_content: string;
  context?: string;
}

export interface SearchLawToolArgs {
  query: string;
  law_type?: LawType;
  limit?: number;
}

export interface GetLawDetailToolArgs {
  law_id: string;
  include_articles?: boolean;
}

export interface GetRecentChangesToolArgs {
  days?: number;
  change_type?: ChangeType;
  limit?: number;
}
