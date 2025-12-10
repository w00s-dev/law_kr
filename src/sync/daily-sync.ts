/**
 * korea-law: Daily Sync & Diff Engine
 * 
 * 매일 자정(00:00 KST) 실행되어 법령 변경사항을 추적합니다.
 * 
 * ⚠️ 중요: 이 동기화 데이터는 AI 검증용입니다.
 * 법적 효력의 최종 판단은 국가법령정보센터(law.go.kr)를 참조하세요.
 */

import * as cron from 'node-cron';
import { format, subDays, parseISO } from 'date-fns';
import * as db from '../db/database';
import * as api from '../api/law-api';
import * as crypto from 'crypto';

// ============================================
// 동기화 설정
// ============================================

interface SyncConfig {
  /** 동기화할 주요 법령 목록 (MVP용) */
  priorityLaws: string[];
  /** 최근 n일 내 변경 법령 스캔 */
  scanDays: number;
  /** API 호출 간격 (ms) */
  apiDelay: number;
}

const DEFAULT_CONFIG: SyncConfig = {
  priorityLaws: [
    '근로기준법',
    '민법',
    '형법',
    '상법',
    '노동조합및노동관계조정법',
    '근로자퇴직급여보장법',
    '최저임금법',
    '산업안전보건법',
    '남녀고용평등과일가정양립지원에관한법률',
    '소득세법',
    '법인세법',
    '부가가치세법',
    '국민건강보험법',
    '국민연금법',
    '고용보험법',
    '산업재해보상보험법',
  ],
  scanDays: 7,
  apiDelay: 500, // API 부하 방지
};

// ============================================
// Diff 엔진
// ============================================

interface DiffResult {
  changeType: 'ADDED' | 'MODIFIED' | 'DELETED';
  previousContent?: string;
  currentContent: string;
  summary: string;
  isCritical: boolean;
}

/**
 * 두 텍스트의 차이를 분석
 */
function calculateDiff(previous: string | null, current: string): DiffResult {
  if (!previous) {
    return {
      changeType: 'ADDED',
      currentContent: current,
      summary: '신설됨',
      isCritical: true,
    };
  }

  if (!current || current.trim() === '') {
    return {
      changeType: 'DELETED',
      previousContent: previous,
      currentContent: '',
      summary: '삭제됨',
      isCritical: true,
    };
  }

  // 내용 비교
  const prevNormalized = previous.replace(/\s+/g, '');
  const currNormalized = current.replace(/\s+/g, '');

  if (prevNormalized === currNormalized) {
    return {
      changeType: 'MODIFIED',
      previousContent: previous,
      currentContent: current,
      summary: '형식 변경 (내용 동일)',
      isCritical: false,
    };
  }

  // 중요 변경 감지 (금액, 기간, 처벌 등)
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

  const isCritical = criticalPatterns.some(pattern => {
    const prevMatches = previous.match(pattern) || [];
    const currMatches = current.match(pattern) || [];
    return JSON.stringify(prevMatches) !== JSON.stringify(currMatches);
  });

  // 변경 요약 생성
  const summary = generateDiffSummary(previous, current);

  return {
    changeType: 'MODIFIED',
    previousContent: previous,
    currentContent: current,
    summary: summary,
    isCritical: isCritical,
  };
}

/**
 * 변경 요약 생성
 */
function generateDiffSummary(previous: string, current: string): string {
  const summaries: string[] = [];

  // 금액 변경 감지
  const prevAmounts = previous.match(/\d+(?:만)?원/g) || [];
  const currAmounts = current.match(/\d+(?:만)?원/g) || [];
  if (JSON.stringify(prevAmounts) !== JSON.stringify(currAmounts)) {
    summaries.push(`금액 변경: ${prevAmounts.join(', ')} → ${currAmounts.join(', ')}`);
  }

  // 기간 변경 감지
  const prevPeriods = previous.match(/\d+(?:일|개월|년)/g) || [];
  const currPeriods = current.match(/\d+(?:일|개월|년)/g) || [];
  if (JSON.stringify(prevPeriods) !== JSON.stringify(currPeriods)) {
    summaries.push(`기간 변경: ${prevPeriods.join(', ')} → ${currPeriods.join(', ')}`);
  }

  if (summaries.length === 0) {
    summaries.push('내용 일부 변경');
  }

  return summaries.join('; ');
}

// ============================================
// 동기화 함수
// ============================================

/**
 * 단일 법령 동기화
 */
async function syncLaw(lawName: string): Promise<{
  lawsAdded: number;
  lawsUpdated: number;
  articlesAdded: number;
  articlesUpdated: number;
  diffsDetected: number;
}> {
  const stats = {
    lawsAdded: 0,
    lawsUpdated: 0,
    articlesAdded: 0,
    articlesUpdated: 0,
    diffsDetected: 0,
  };

  try {
    console.log(`📜 동기화 중: ${lawName}`);

    // 1. API에서 법령 검색
    const searchResults = await api.searchLaws(lawName, 5);
    if (searchResults.length === 0) {
      console.log(`  ⚠️ "${lawName}" 검색 결과 없음`);
      return stats;
    }

    // 2. 가장 최신 법령 선택
    const latestLaw = searchResults[0];
    const lawDetail = await api.getLawDetail(latestLaw.법령ID);

    if (!lawDetail) {
      console.log(`  ⚠️ 상세 정보 조회 실패`);
      return stats;
    }

    // 3. 기존 DB 데이터 조회
    const existingLaw = db.findLawByName(lawName);

    // 4. 법령 마스터 저장/업데이트
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
    
    if (existingLaw) {
      stats.lawsUpdated++;
    } else {
      stats.lawsAdded++;
    }

    // 5. 조문 동기화 및 Diff 감지
    for (const article of lawDetail.조문) {
      const articleNo = String(article.조문번호 || '');
      
      // 장/절/관 제목 필터링 (조문이 아닌 것 제외)
      const rawContent = article.조문내용 || '';
      if (isChapterTitle(rawContent) || !isValidArticleNo(articleNo)) {
        continue;
      }
      
      // 조문 내용 구성 (항/호 포함)
      const content = buildFullArticleContent(article);

      // 기존 조문 조회
      const existingArticle = existingLaw 
        ? db.findArticle(existingLaw.id!, articleNo)
        : null;

      // 조문 저장
      const articleRecord: db.ArticleRecord = {
        law_id: lawId,
        article_no: articleNo,
        article_title: article.조문제목,
        content: content,
        paragraph_count: countParagraphs(article),
        is_definition: (article.조문제목 || '').includes('정의') || articleNo.includes('2'),
        effective_from: formatApiDate(lawDetail.기본정보.시행일자),
      };

      const articleId = db.upsertArticle(articleRecord);

      if (existingArticle) {
        stats.articlesUpdated++;

        // Diff 감지
        if (existingArticle.content !== content) {
          const diff = calculateDiff(existingArticle.content, content);
          
          db.insertDiffLog({
            law_id: lawId,
            article_id: articleId,
            change_type: diff.changeType,
            previous_content: diff.previousContent,
            current_content: diff.currentContent,
            diff_summary: diff.summary,
            effective_from: formatApiDate(lawDetail.기본정보.시행일자),
            is_critical: diff.isCritical,
            warning_message: diff.isCritical
              ? `⚠️ 중요 변경: ${lawDetail.기본정보.법령명_한글} ${articleNo} - ${diff.summary}`
              : undefined,
          });

          stats.diffsDetected++;
          console.log(`  📝 변경 감지: ${articleNo} - ${diff.summary}`);
        }
      } else {
        stats.articlesAdded++;
      }
    }

    console.log(`  ✅ 완료: 조문 ${stats.articlesAdded + stats.articlesUpdated}개 처리, Diff ${stats.diffsDetected}개`);

  } catch (error) {
    console.error(`  ❌ 오류: ${error}`);
  }

  return stats;
}

/**
 * 전체 동기화 실행
 */
export async function runFullSync(config: SyncConfig = DEFAULT_CONFIG): Promise<void> {
  console.log('═══════════════════════════════════════════');
  console.log('🔄 korea-law Daily Sync 시작');
  console.log(`   시간: ${format(new Date(), 'yyyy-MM-dd HH:mm:ss')}`);
  console.log('═══════════════════════════════════════════');
  console.log('⚠️ 주의: 이 데이터는 AI 검증용입니다.');
  console.log('   법적 판단의 최종 근거로 사용하지 마세요.');
  console.log('═══════════════════════════════════════════');

  // DB 초기화
  db.initDatabase();

  const totalStats = {
    lawsAdded: 0,
    lawsUpdated: 0,
    articlesAdded: 0,
    articlesUpdated: 0,
    diffsDetected: 0,
  };

  // 우선순위 법령 동기화
  for (const lawName of config.priorityLaws) {
    const stats = await syncLaw(lawName);
    
    totalStats.lawsAdded += stats.lawsAdded;
    totalStats.lawsUpdated += stats.lawsUpdated;
    totalStats.articlesAdded += stats.articlesAdded;
    totalStats.articlesUpdated += stats.articlesUpdated;
    totalStats.diffsDetected += stats.diffsDetected;

    // API 부하 방지
    await delay(config.apiDelay);
  }

  // 최근 개정 법령 스캔
  console.log('\n📅 최근 개정 법령 스캔...');
  try {
    const recentLaws = await api.getRecentlyAmendedLaws(config.scanDays);
    console.log(`   ${recentLaws.length}건 발견`);

    for (const law of recentLaws) {
      // 이미 동기화한 법령은 제외
      if (config.priorityLaws.some(p => law.법령명한글.includes(p))) {
        continue;
      }

      const stats = await syncLaw(law.법령명한글);
      
      totalStats.lawsAdded += stats.lawsAdded;
      totalStats.lawsUpdated += stats.lawsUpdated;
      totalStats.articlesAdded += stats.articlesAdded;
      totalStats.articlesUpdated += stats.articlesUpdated;
      totalStats.diffsDetected += stats.diffsDetected;

      await delay(config.apiDelay);
    }
  } catch (error) {
    console.error(`   ❌ 최근 개정 법령 스캔 실패: ${error}`);
  }

  // 결과 출력
  console.log('\n═══════════════════════════════════════════');
  console.log('📊 동기화 완료');
  console.log(`   법령 추가: ${totalStats.lawsAdded}건`);
  console.log(`   법령 업데이트: ${totalStats.lawsUpdated}건`);
  console.log(`   조문 추가: ${totalStats.articlesAdded}건`);
  console.log(`   조문 업데이트: ${totalStats.articlesUpdated}건`);
  console.log(`   변경 감지(Diff): ${totalStats.diffsDetected}건`);
  console.log('═══════════════════════════════════════════');

  db.closeDatabase();
}

/**
 * Cron Job 스케줄링 (매일 자정)
 */
export function scheduleDailySync(): void {
  // 매일 00:00 KST 실행
  cron.schedule('0 0 * * *', async () => {
    console.log('\n⏰ 스케줄된 Daily Sync 시작...\n');
    await runFullSync();
  }, {
    timezone: 'Asia/Seoul',
  });

  console.log('📆 Daily Sync 스케줄 등록됨 (매일 00:00 KST)');
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

/**
 * 장/절/관 제목인지 확인
 */
function isChapterTitle(content: string): boolean {
  const trimmed = content.trim();
  // 장/절/관/편 제목 패턴
  return /^\s*제\d+[장절관편]\s/.test(trimmed) || 
         /^\s*제\d+[장절관편]$/.test(trimmed) ||
         trimmed.length < 10 && /^제\d+[장절관편]/.test(trimmed);
}

/**
 * 유효한 조문번호인지 확인
 */
function isValidArticleNo(articleNo: string): boolean {
  // 숫자로 시작하는 조문번호만 유효
  return /^\d+/.test(articleNo);
}

/**
 * 조문 전체 내용 구성 (항/호 포함)
 */
function buildFullArticleContent(article: api.ArticleInfo): string {
  const parts: string[] = [];
  
  // 조문 본문
  const mainContent = article.조문내용 || '';
  if (mainContent.trim()) {
    parts.push(mainContent.trim());
  }
  
  // 항(paragraph) 내용 추가
  if (article.항 && Array.isArray(article.항)) {
    for (const paragraph of article.항) {
      const paragraphNo = paragraph.항번호 || '';
      const paragraphContent = paragraph.항내용 || '';
      
      if (paragraphContent.trim()) {
        parts.push(`${paragraphNo} ${paragraphContent.trim()}`);
      }
      
      // 호(subitem) 내용 추가
      if (paragraph.호 && Array.isArray(paragraph.호)) {
        for (const subitem of paragraph.호) {
          const subitemNo = subitem.호번호 || '';
          const subitemContent = subitem.호내용 || '';
          
          if (subitemContent.trim()) {
            parts.push(`  ${subitemNo} ${subitemContent.trim()}`);
          }

          // 목(sub-subitem) 내용 추가
          if (subitem.목 && Array.isArray(subitem.목)) {
            for (const mok of subitem.목) {
              const mokNo = mok.목번호 || '';
              const mokContent = mok.목내용 || '';
              if (mokContent.trim()) {
                parts.push(`    ${mokNo} ${mokContent.trim()}`);
              }
            }
          }
        }
      }
    }
  }
  
  return parts.join('\n');
}

/**
 * 항 개수 계산
 */
function countParagraphs(article: api.ArticleInfo): number {
  if (!article.항) return 1;
  return Array.isArray(article.항) ? article.항.length : 1;
}

// ============================================
// CLI 실행
// ============================================

if (require.main === module) {
  runFullSync().catch(console.error);
}

