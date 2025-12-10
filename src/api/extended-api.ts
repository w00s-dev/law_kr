/**
 * korea-law: 확장 API 모듈
 * 
 * 국가법령정보센터의 추가 API들을 연동합니다.
 * - 행정규칙
 * - 자치법규
 * - 헌재결정례
 * - 법령해석례
 * - 행정심판례
 * 
 * ⚠️ 주의: 이 데이터는 AI 검증용입니다.
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { XMLParser } from 'fast-xml-parser';

const BASE_URL = 'http://www.law.go.kr/DRF';
// API 키: 환경변수 설정 권장, 기본값은 공공데이터포털 샘플키
const API_KEY = process.env.KOREA_LAW_API_KEY || 'sapphire_5';

// Retry 설정
const RETRY_CONFIG = {
  maxRetries: 3,
  retryDelay: 1000, // 1초
  retryableStatuses: [408, 429, 500, 502, 503, 504],
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: true,
  trimValues: true,
});

const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: { 'Accept': 'application/xml' },
});

// ============================================
// Retry 로직 구현
// ============================================

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function requestWithRetry<T>(
  requestFn: () => Promise<T>,
  context: string
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      return await requestFn();
    } catch (error) {
      lastError = error as Error;
      
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status;
      
      // 재시도 가능한 에러인지 확인
      const isRetryable = 
        !status || // 네트워크 에러
        RETRY_CONFIG.retryableStatuses.includes(status) ||
        axiosError.code === 'ECONNRESET' ||
        axiosError.code === 'ETIMEDOUT' ||
        axiosError.code === 'ECONNABORTED';
      
      if (!isRetryable || attempt === RETRY_CONFIG.maxRetries) {
        console.error(`[${context}] 최종 실패 (시도 ${attempt}/${RETRY_CONFIG.maxRetries}):`, 
          axiosError.message || error);
        throw error;
      }
      
      // 지수 백오프
      const delay = RETRY_CONFIG.retryDelay * Math.pow(2, attempt - 1);
      console.warn(`[${context}] 재시도 ${attempt}/${RETRY_CONFIG.maxRetries} (${delay}ms 후)...`);
      await sleep(delay);
    }
  }
  
  throw lastError;
}

// ============================================
// 타입 정의
// ============================================

export interface AdminRuleItem {
  행정규칙일련번호: string;
  행정규칙명: string;
  행정규칙종류명: string;
  소관부처명: string;
  발령일자: string;
  시행일자: string;
  행정규칙상세링크: string;
}

export interface LocalLawItem {
  자치법규일련번호: string;
  자치법규명: string;
  자치단체코드: string;
  자치단체명: string;
  공포일자: string;
  시행일자: string;
}

export interface ConstitutionalDecisionItem {
  헌재결정일련번호: string;
  사건번호: string;
  사건명: string;
  선고일자: string;
  결정유형: string;
  주문: string;
  결정요지: string;
}

export interface LegalInterpretationItem {
  법령해석일련번호: string;
  사안명: string;
  회신기관명: string;
  안건번호: string;
  회신일자: string;
  질의요지: string;
  회답: string;
}

export interface AdminAppealItem {
  행정심판일련번호: string;
  사건번호: string;
  사건명: string;
  재결일자: string;
  재결결과: string;
  재결요지: string;
}

// ============================================
// 행정규칙 API
// ============================================

/**
 * 행정규칙 검색
 */
export async function searchAdminRules(query: string, display: number = 100): Promise<AdminRuleItem[]> {
  return requestWithRetry(async () => {
    const response = await apiClient.get('/lawSearch.do', {
      params: {
        OC: API_KEY,
        target: 'admrul',  // 행정규칙
        type: 'XML',
        query: query,
        display: display,
      },
    });

    const parsed = xmlParser.parse(response.data);
    const items = parsed?.AdmRulSearch?.admrul;

    if (!items) return [];
    return Array.isArray(items) ? items : [items];
  }, `searchAdminRules(${query})`);
}

/**
 * 행정규칙 상세 조회
 */
export async function getAdminRuleDetail(ruleId: string): Promise<any | null> {
  return requestWithRetry(async () => {
    const response = await apiClient.get('/lawService.do', {
      params: {
        OC: API_KEY,
        target: 'admrul',
        type: 'XML',
        ID: ruleId,
      },
    });

    const parsed = xmlParser.parse(response.data);
    return parsed?.행정규칙 || null;
  }, `getAdminRuleDetail(${ruleId})`);
}

// ============================================
// 자치법규 API
// ============================================

/**
 * 자치법규 검색
 */
export async function searchLocalLaws(query: string, display: number = 100): Promise<LocalLawItem[]> {
  return requestWithRetry(async () => {
    const response = await apiClient.get('/lawSearch.do', {
      params: {
        OC: API_KEY,
        target: 'ordin',  // 자치법규
        type: 'XML',
        query: query,
        display: display,
      },
    });

    const parsed = xmlParser.parse(response.data);
    const items = parsed?.OrdinSearch?.ordin;

    if (!items) return [];
    return Array.isArray(items) ? items : [items];
  }, `searchLocalLaws(${query})`);
}

// ============================================
// 헌재결정례 API
// ============================================

/**
 * 헌재결정례 검색
 */
export async function searchConstitutionalDecisions(
  query: string, 
  display: number = 100
): Promise<ConstitutionalDecisionItem[]> {
  return requestWithRetry(async () => {
    const response = await apiClient.get('/lawSearch.do', {
      params: {
        OC: API_KEY,
        target: 'detc',  // 헌재결정례
        type: 'XML',
        query: query,
        display: display,
      },
    });

    const parsed = xmlParser.parse(response.data);
    const items = parsed?.DetcSearch?.detc;

    if (!items) return [];
    return Array.isArray(items) ? items : [items];
  }, `searchConstitutionalDecisions(${query})`);
}

/**
 * 헌재결정례 존재 확인
 */
export async function verifyConstitutionalDecisionExists(caseNumber: string): Promise<boolean> {
  try {
    const results = await searchConstitutionalDecisions(caseNumber, 10);
    const normalized = caseNumber.replace(/\s+/g, '');
    return results.some(item => 
      item.사건번호?.replace(/\s+/g, '') === normalized
    );
  } catch (error) {
    return false;
  }
}

// ============================================
// 법령해석례 API
// ============================================

/**
 * 법령해석례 검색
 */
export async function searchLegalInterpretations(
  query: string, 
  display: number = 100
): Promise<LegalInterpretationItem[]> {
  return requestWithRetry(async () => {
    const response = await apiClient.get('/lawSearch.do', {
      params: {
        OC: API_KEY,
        target: 'expc',  // 법령해석례
        type: 'XML',
        query: query,
        display: display,
      },
    });

    const parsed = xmlParser.parse(response.data);
    const items = parsed?.ExpcSearch?.expc;

    if (!items) return [];
    return Array.isArray(items) ? items : [items];
  }, `searchLegalInterpretations(${query})`);
}

// ============================================
// 행정심판례 API
// ============================================

/**
 * 행정심판례 검색
 */
export async function searchAdminAppeals(
  query: string, 
  display: number = 100
): Promise<AdminAppealItem[]> {
  return requestWithRetry(async () => {
    const response = await apiClient.get('/lawSearch.do', {
      params: {
        OC: API_KEY,
        target: 'flgn',  // 행정심판례
        type: 'XML',
        query: query,
        display: display,
      },
    });

    const parsed = xmlParser.parse(response.data);
    const items = parsed?.FlgnSearch?.flgn;

    if (!items) return [];
    return Array.isArray(items) ? items : [items];
  }, `searchAdminAppeals(${query})`);
}

// ============================================
// 조약 API
// ============================================

export interface TreatyItem {
  조약일련번호: string;
  조약명: string;
  조약종류명: string;
  체결일자: string;
  발효일자: string;
  당사국: string;
}

/**
 * 조약 검색
 */
export async function searchTreaties(query: string, display: number = 100): Promise<TreatyItem[]> {
  return requestWithRetry(async () => {
    const response = await apiClient.get('/lawSearch.do', {
      params: {
        OC: API_KEY,
        target: 'trty',  // 조약
        type: 'XML',
        query: query,
        display: display,
      },
    });

    const parsed = xmlParser.parse(response.data);
    const items = parsed?.TrtySearch?.trty;

    if (!items) return [];
    return Array.isArray(items) ? items : [items];
  }, `searchTreaties(${query})`);
}

// ============================================
// 통합 검증 함수
// ============================================

export type SourceType = 'prec' | 'detc' | 'expc' | 'flgn' | 'admrul';

/**
 * 여러 소스에서 사건/결정 존재 확인
 * AI가 인용한 판례/결정례/해석례의 진위 검증용
 */
export async function verifyLegalSourceExists(
  identifier: string, 
  sourceType: SourceType
): Promise<{ exists: boolean; source: string; details?: any }> {
  try {
    let results: any[] = [];
    let sourceName = '';

    switch (sourceType) {
      case 'prec':
        sourceName = '대법원 판례';
        // 기존 api.searchPrecedents 사용
        break;
      case 'detc':
        sourceName = '헌재결정례';
        results = await searchConstitutionalDecisions(identifier, 10);
        break;
      case 'expc':
        sourceName = '법령해석례';
        results = await searchLegalInterpretations(identifier, 10);
        break;
      case 'flgn':
        sourceName = '행정심판례';
        results = await searchAdminAppeals(identifier, 10);
        break;
      case 'admrul':
        sourceName = '행정규칙';
        results = await searchAdminRules(identifier, 10);
        break;
    }

    const exists = results.length > 0;

    return {
      exists,
      source: sourceName,
      details: exists ? results[0] : undefined,
    };
  } catch (error) {
    return {
      exists: false,
      source: '검색 실패',
    };
  }
}

export {
  apiClient,
  xmlParser,
};

