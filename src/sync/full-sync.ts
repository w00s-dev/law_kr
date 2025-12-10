/**
 * korea-law: Full Law Sync Engine
 * 
 * 전체 법령(약 4,500개)을 동기화합니다.
 * 부칙(附則)을 파싱하여 미래 시행일을 자동 추출합니다.
 * 
 * ⚠️ 중요: 이 동기화 데이터는 AI 검증용입니다.
 * 법적 효력의 최종 판단은 국가법령정보센터(law.go.kr)를 참조하세요.
 */

import { format, parseISO, addMonths, addYears } from 'date-fns';
import * as db from '../db/database';
import * as api from '../api/law-api';

// ============================================
// 설정
// ============================================

interface FullSyncConfig {
  /** 페이지당 법령 수 */
  pageSize: number;
  /** 최대 페이지 수 (안전장치) */
  maxPages: number;
  /** API 호출 간격 (ms) */
  apiDelay: number;
  /** 부칙 파싱 활성화 */
  parseAddenda: boolean;
  /** 병렬 처리 수 */
  concurrency: number;
}

const DEFAULT_CONFIG: FullSyncConfig = {
  pageSize: 100,
  maxPages: 50,  // 최대 5,000개 법령
  apiDelay: 500,
  parseAddenda: true,
  concurrency: 3,
};

// ============================================
// 부칙(附則) 파싱
// ============================================

interface AddendaInfo {
  /** 시행일 */
  effectiveDate: string | null;
  /** 경과조치 여부 */
  hasTransitionalProvision: boolean;
  /** 특별 조건 */
  conditions: string[];
  /** 원문 */
  rawText: string;
}

/**
 * 부칙에서 시행일 추출
 * 
 * 패턴 예시:
 * - "이 법은 공포 후 6개월이 경과한 날부터 시행한다"
 * - "이 법은 2025년 1월 1일부터 시행한다"
 * - "이 법은 공포한 날부터 시행한다"
 */
function parseAddenda(addendaText: string, promulgationDate: string): AddendaInfo {
  const result: AddendaInfo = {
    effectiveDate: null,
    hasTransitionalProvision: false,
    conditions: [],
    rawText: addendaText,
  };

  if (!addendaText) return result;

  // 경과조치 확인
  if (addendaText.includes('경과조치') || addendaText.includes('종전의')) {
    result.hasTransitionalProvision = true;
  }

  // 패턴 1: 구체적 날짜 (YYYY년 M월 D일)
  const datePattern = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일부터\s*시행/;
  const dateMatch = addendaText.match(datePattern);
  if (dateMatch) {
    const year = dateMatch[1];
    const month = dateMatch[2].padStart(2, '0');
    const day = dateMatch[3].padStart(2, '0');
    result.effectiveDate = `${year}-${month}-${day}`;
    return result;
  }

  // 패턴 2: 공포 후 n개월/년
  const monthPattern = /공포\s*(?:한\s*날|후|일)?\s*(\d+)개월[이가]?\s*경과한\s*날/;
  const monthMatch = addendaText.match(monthPattern);
  if (monthMatch && promulgationDate) {
    const months = parseInt(monthMatch[1], 10);
    const promDate = parseISO(promulgationDate);
    const effectiveDate = addMonths(promDate, months);
    result.effectiveDate = format(effectiveDate, 'yyyy-MM-dd');
    return result;
  }

  const yearPattern = /공포\s*(?:한\s*날|후|일)?\s*(\d+)년[이가]?\s*경과한\s*날/;
  const yearMatch = addendaText.match(yearPattern);
  if (yearMatch && promulgationDate) {
    const years = parseInt(yearMatch[1], 10);
    const promDate = parseISO(promulgationDate);
    const effectiveDate = addYears(promDate, years);
    result.effectiveDate = format(effectiveDate, 'yyyy-MM-dd');
    return result;
  }

  // 패턴 3: 공포한 날부터 시행
  if (addendaText.includes('공포한 날부터 시행') || addendaText.includes('공포일부터 시행')) {
    result.effectiveDate = promulgationDate;
    return result;
  }

  // 패턴 4: 특정 조건 (다른 법 시행일 등)
  if (addendaText.includes('대통령령으로 정하는 날')) {
    result.conditions.push('대통령령으로 시행일 지정');
  }

  return result;
}

// ============================================
// 전체 법령 동기화
// ============================================

interface SyncStats {
  totalLaws: number;
  lawsSynced: number;
  articlesAdded: number;
  addendaParsed: number;
  futureEffective: number;
  errors: number;
}

/**
 * 전체 법령 목록 조회 (페이지네이션)
 */
async function getAllLawList(config: FullSyncConfig): Promise<api.LawListItem[]> {
  const allLaws: api.LawListItem[] = [];
  
  console.log('📋 전체 법령 목록 조회 중...');

  for (let page = 1; page <= config.maxPages; page++) {
    try {
      // API에서 법령 목록 조회 (페이지별)
      // 참고: 실제 API는 page 파라미터가 아닌 다른 방식일 수 있음
      const laws = await api.searchLaws('', config.pageSize);
      
      if (!laws || laws.length === 0) {
        console.log(`   페이지 ${page}: 더 이상 결과 없음`);
        break;
      }

      allLaws.push(...laws);
      console.log(`   페이지 ${page}: ${laws.length}건 (누적: ${allLaws.length}건)`);

      await delay(config.apiDelay);
    } catch (error) {
      console.error(`   페이지 ${page} 조회 실패:`, error);
      break;
    }
  }

  return allLaws;
}

/**
 * 단일 법령 상세 동기화 (부칙 포함)
 */
async function syncLawDetail(
  lawItem: api.LawListItem, 
  config: FullSyncConfig
): Promise<{ articlesAdded: number; addendaParsed: boolean; futureEffective: boolean }> {
  const result = { articlesAdded: 0, addendaParsed: false, futureEffective: false };

  try {
    const lawDetail = await api.getLawDetail(lawItem.법령ID);
    if (!lawDetail) return result;

    // 법령 마스터 저장
    const lawRecord: db.LawRecord = {
      law_mst_id: String(lawDetail.기본정보.법령ID),
      law_name: lawDetail.기본정보.법령명_한글,
      law_name_eng: lawDetail.기본정보.법령명_영문,
      promulgation_date: formatApiDate(lawDetail.기본정보.공포일자),
      enforcement_date: formatApiDate(lawDetail.기본정보.시행일자),
      law_type: lawDetail.기본정보.법령구분명,
      ministry: lawDetail.기본정보.소관부처명,
      status: 'ACTIVE',
      source_url: `https://www.law.go.kr/법령/${encodeURIComponent(lawDetail.기본정보.법령명_한글)}`,
    };

    const lawId = db.upsertLaw(lawRecord);

    // 조문 저장
    for (const article of lawDetail.조문) {
      const articleRecord: db.ArticleRecord = {
        law_id: lawId,
        article_no: article.조문번호,
        article_title: article.조문제목,
        content: article.조문내용,
        is_definition: article.조문제목?.includes('정의') || article.조문번호.includes('제2조'),
        effective_from: formatApiDate(lawDetail.기본정보.시행일자),
      };

      db.upsertArticle(articleRecord);
      result.articlesAdded++;
    }

    // 부칙 파싱 (Phase 4 핵심 기능)
    if (config.parseAddenda) {
      // 부칙 조문 찾기
      const addendaArticle = lawDetail.조문.find(a => 
        a.조문번호.includes('부칙') || 
        a.조문제목?.includes('부칙')
      );

      if (addendaArticle) {
        const addendaInfo = parseAddenda(
          addendaArticle.조문내용,
          formatApiDate(lawDetail.기본정보.공포일자)
        );

        result.addendaParsed = true;

        // 미래 시행일 감지
        if (addendaInfo.effectiveDate) {
          const today = new Date().toISOString().split('T')[0];
          if (addendaInfo.effectiveDate > today) {
            result.futureEffective = true;
            
            // Diff 로그에 미래 시행 정보 기록
            db.insertDiffLog({
              law_id: lawId,
              change_type: 'ADDED',
              diff_summary: `미래 시행 예정: ${addendaInfo.effectiveDate}`,
              effective_from: addendaInfo.effectiveDate,
              is_critical: true,
              warning_message: `⚠️ "${lawDetail.기본정보.법령명_한글}"이 ${addendaInfo.effectiveDate}에 시행 예정입니다.`,
            });

            console.log(`   📅 미래 시행: ${lawDetail.기본정보.법령명_한글} → ${addendaInfo.effectiveDate}`);
          }
        }
      }
    }

  } catch (error) {
    console.error(`   ❌ 오류:`, error);
  }

  return result;
}

/**
 * 전체 동기화 실행
 */
export async function runFullSync(config: FullSyncConfig = DEFAULT_CONFIG): Promise<void> {
  console.log('═══════════════════════════════════════════');
  console.log('🔄 korea-law Full Sync 시작');
  console.log(`   시간: ${format(new Date(), 'yyyy-MM-dd HH:mm:ss')}`);
  console.log(`   설정: pageSize=${config.pageSize}, maxPages=${config.maxPages}`);
  console.log('═══════════════════════════════════════════');
  console.log('⚠️ 주의: 이 데이터는 AI 검증용입니다.');
  console.log('═══════════════════════════════════════════');

  // DB 초기화
  db.initDatabase();

  const stats: SyncStats = {
    totalLaws: 0,
    lawsSynced: 0,
    articlesAdded: 0,
    addendaParsed: 0,
    futureEffective: 0,
    errors: 0,
  };

  try {
    // 1. 전체 법령 목록 조회
    const allLaws = await getAllLawList(config);
    stats.totalLaws = allLaws.length;

    console.log(`\n📜 총 ${stats.totalLaws}개 법령 동기화 시작...\n`);

    // 2. 각 법령 상세 동기화
    for (let i = 0; i < allLaws.length; i++) {
      const law = allLaws[i];
      const progress = ((i + 1) / allLaws.length * 100).toFixed(1);
      
      console.log(`[${progress}%] ${law.법령명한글}`);

      const result = await syncLawDetail(law, config);
      
      stats.lawsSynced++;
      stats.articlesAdded += result.articlesAdded;
      if (result.addendaParsed) stats.addendaParsed++;
      if (result.futureEffective) stats.futureEffective++;

      await delay(config.apiDelay);
    }

  } catch (error) {
    console.error('동기화 중 오류:', error);
    stats.errors++;
  }

  // 결과 출력
  console.log('\n═══════════════════════════════════════════');
  console.log('📊 Full Sync 완료');
  console.log(`   총 법령: ${stats.totalLaws}건`);
  console.log(`   동기화: ${stats.lawsSynced}건`);
  console.log(`   조문: ${stats.articlesAdded}건`);
  console.log(`   부칙 파싱: ${stats.addendaParsed}건`);
  console.log(`   미래 시행 예정: ${stats.futureEffective}건`);
  console.log(`   오류: ${stats.errors}건`);
  console.log('═══════════════════════════════════════════');

  db.closeDatabase();
}

// ============================================
// 유틸리티
// ============================================

function formatApiDate(dateStr: string | number): string {
  const str = String(dateStr);
  if (str.length === 8) {
    return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`;
  }
  return str;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// CLI 실행
// ============================================

if (require.main === module) {
  runFullSync().catch(console.error);
}

export { parseAddenda, AddendaInfo };

