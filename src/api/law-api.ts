/**
 * korea-law: 국가법령정보센터 API 연동 모듈
 * 
 * 공식 API 문서: https://www.law.go.kr/LSW/openApi.do
 * 
 * ⚠️ 주의: API 키 필요 (무료 발급)
 * 환경변수: KOREA_LAW_API_KEY
 */

import axios, { AxiosInstance, AxiosError, AxiosRequestConfig } from 'axios';
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

// XML Parser 설정
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: true,
  trimValues: true,
});

// API 클라이언트
const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: {
    'Accept': 'application/xml',
  },
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

export interface LawListItem {
  법령일련번호: string;
  현행연혁코드: string;
  법령명한글: string;
  법령명약칭: string;
  법령ID: number;
  공포일자: string;
  공포번호: number;
  제개정구분명: string;
  소관부처명: string;
  법령구분명: string;
  시행일자: string;
  자법타법여부: string;
  법령상세링크: string;
}

export interface LawDetail {
  기본정보: {
    법령ID: number;
    법령명_한글: string;
    법령명_영문?: string;
    법령약칭명?: string;
    공포일자: string;
    공포번호: number;
    시행일자: string;
    소관부처명: string;
    법령구분명: string;
  };
  조문: ArticleInfo[];
}

export interface ArticleInfo {
  조문번호: string;
  조문여부: string;
  조문제목?: string;
  조문내용: string;
  항?: ParagraphInfo[];
}

export interface ParagraphInfo {
  항번호: string;
  항내용: string;
  호?: SubItemInfo[];
}

export interface SubItemInfo {
  호번호: string;
  호내용: string;
  목?: MokInfo[];
}

export interface MokInfo {
  목번호: string;
  목내용: string;
}

export interface PrecedentItem {
  판례일련번호: number;
  사건번호: string;
  사건명: string;
  선고일자: string;
  법원명: string;
  사건종류명: string;
  판결유형: string;
  판시사항?: string;
  판결요지?: string;
  참조조문?: string;
  참조판례?: string;
}

// ============================================
// API 함수들
// ============================================

/**
 * 법령 목록 조회
 * @param query 검색어 (법령명)
 * @param display 결과 개수 (기본 100)
 */
export async function searchLaws(query: string, display: number = 100): Promise<LawListItem[]> {
  return requestWithRetry(async () => {
    const response = await apiClient.get('/lawSearch.do', {
      params: {
        OC: API_KEY,
        target: 'law',
        type: 'XML',
        query: query,
        display: display,
        sort: 'efcdt', // 시행일자순
      },
    });

    const parsed = xmlParser.parse(response.data);
    const items = parsed?.LawSearch?.law;

    if (!items) return [];
    return Array.isArray(items) ? items : [items];
  }, `searchLaws(${query})`);
}

/**
 * 법령 상세 조회 (조문 포함)
 * @param lawId 법령 ID
 */
export async function getLawDetail(lawId: number | string): Promise<LawDetail | null> {
  return requestWithRetry(async () => {
    const response = await apiClient.get('/lawService.do', {
      params: {
        OC: API_KEY,
        target: 'law',
        type: 'XML',
        ID: lawId,
      },
    });

    const parsed = xmlParser.parse(response.data);
    const law = parsed?.법령;

    if (!law) return null;

    // 기본정보 추출
    const 기본정보 = law.기본정보 || {};
    const 조문목록 = law.조문 || {};

    // 조문 파싱
    const articles: ArticleInfo[] = [];
    const 조문단위 = 조문목록.조문단위;

    if (조문단위) {
      const 조문배열 = Array.isArray(조문단위) ? 조문단위 : [조문단위];
      
      for (const 조문 of 조문배열) {
        articles.push({
          조문번호: 조문.조문번호 || '',
          조문여부: 조문.조문여부 || '',
          조문제목: 조문.조문제목,
          조문내용: extractTextContent(조문.조문내용),
          항: parseHangItems(조문.항),
        });
      }
    }

    return {
      기본정보: {
        법령ID: 기본정보.법령ID,
        법령명_한글: 기본정보.법령명_한글,
        법령명_영문: 기본정보.법령명_영문,
        법령약칭명: 기본정보.법령약칭명,
        공포일자: 기본정보.공포일자,
        공포번호: 기본정보.공포번호,
        시행일자: 기본정보.시행일자,
        소관부처명: 기본정보.소관부처명,
        법령구분명: 기본정보.법령구분명,
      },
      조문: articles,
    };
  }, `getLawDetail(${lawId})`);
}

/**
 * 판례 검색
 * @param query 검색어 (사건번호, 키워드 등)
 */
export async function searchPrecedents(query: string, display: number = 100): Promise<PrecedentItem[]> {
  return requestWithRetry(async () => {
    const response = await apiClient.get('/lawSearch.do', {
      params: {
        OC: API_KEY,
        target: 'prec',
        type: 'XML',
        query: query,
        display: display,
      },
    });

    const parsed = xmlParser.parse(response.data);
    const items = parsed?.PrecSearch?.prec;

    if (!items) return [];
    return Array.isArray(items) ? items : [items];
  }, `searchPrecedents(${query})`);
}

/**
 * 판례 존재 여부 확인 (사건번호로)
 * @param caseNumber 사건번호 (예: 2023다12345)
 */
export async function verifyPrecedentExistsOnline(caseNumber: string): Promise<boolean> {
  try {
    const results = await searchPrecedents(caseNumber, 10);
    
    // 정확한 사건번호 매칭 확인
    const normalized = caseNumber.replace(/\s+/g, '');
    return results.some(item => 
      item.사건번호.replace(/\s+/g, '') === normalized
    );
  } catch (error) {
    console.error('판례 존재 확인 실패:', error);
    return false;
  }
}

/**
 * 최근 개정 법령 목록 조회
 * @param days 최근 n일 이내 (기본 7일)
 */
export async function getRecentlyAmendedLaws(days: number = 7): Promise<LawListItem[]> {
  return requestWithRetry(async () => {
    // 날짜 계산
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const formatDateLocal = (d: Date) => d.toISOString().split('T')[0].replace(/-/g, '');
    
    const response = await apiClient.get('/lawSearch.do', {
      params: {
        OC: API_KEY,
        target: 'law',
        type: 'XML',
        display: 100,
        sort: 'efcdt',
        efYd: formatDateLocal(startDate), // 시행일자 시작
        efYdE: formatDateLocal(endDate),  // 시행일자 끝
      },
    });

    const parsed = xmlParser.parse(response.data);
    const items = parsed?.LawSearch?.law;

    if (!items) return [];
    return Array.isArray(items) ? items : [items];
  }, `getRecentlyAmendedLaws(${days}일)`);
}

// ============================================
// 유틸리티 함수
// ============================================

function extractTextContent(content: any): string {
  if (typeof content === 'string') return content;
  if (content?.['#text']) return content['#text'];
  if (Array.isArray(content)) {
    return content.map(extractTextContent).join(' ');
  }
  return String(content || '');
}

function parseHangItems(항: any): ParagraphInfo[] | undefined {
  if (!항) return undefined;
  
  const 항배열 = Array.isArray(항) ? 항 : [항];
  
  return 항배열.map((h: any) => ({
    항번호: h.항번호 || '',
    항내용: extractTextContent(h.항내용),
    호: parseHoItems(h.호),
  }));
}

function parseHoItems(호: any): SubItemInfo[] | undefined {
  if (!호) return undefined;
  
  const 호배열 = Array.isArray(호) ? 호 : [호];
  
  return 호배열.map((h: any) => ({
    호번호: h.호번호 || '',
    호내용: extractTextContent(h.호내용),
    목: parseMokItems(h.목),
  }));
}

function parseMokItems(목: any): MokInfo[] | undefined {
  if (!목) return undefined;

  const 목배열 = Array.isArray(목) ? 목 : [목];

  return 목배열.map((m: any) => ({
    목번호: m.목번호 || '',
    목내용: extractTextContent(m.목내용),
  }));
}

export {
  apiClient,
  xmlParser,
};

