/**
 * korea-law: 법률 용어 자동 추출 모듈
 * 
 * 법령의 "제2조(정의)" 조항에서 법률 용어와 정의를 자동 추출합니다.
 * AI가 용어를 잘못 사용하는 것을 방지하기 위한 검증 데이터입니다.
 * 
 * ⚠️ 중요: 이 데이터는 "검증용(Verification)" 목적입니다.
 */

import * as api from '../api/law-api';
import * as db from '../db/database';
import { format } from 'date-fns';

// ============================================
// 타입 정의
// ============================================

interface ExtractedTerm {
  term: string;
  definition: string;
  articleRef: string;
}

interface TermExtractionStats {
  lawsProcessed: number;
  termsExtracted: number;
  errors: number;
}

// ============================================
// 용어 추출 함수
// ============================================

/**
 * 조문 내용에서 법률 용어와 정의 추출
 */
function extractTermsFromContent(content: string, articleRef: string): ExtractedTerm[] {
  const terms: ExtractedTerm[] = [];
  
  // 패턴 1: "XXX"란 ... 을 말한다.
  const pattern1 = /"([^"]+)"[이란은는]([^.]+(?:을|를)\s*말한다)/g;
  let match;
  
  while ((match = pattern1.exec(content)) !== null) {
    terms.push({
      term: match[1].trim(),
      definition: match[2].trim(),
      articleRef: articleRef,
    });
  }

  // 패턴 2: "XXX"이란 ... 를 말한다.
  const pattern2 = /"([^"]+)"(?:이란|란)\s+([^.]+를\s*말한다)/g;
  
  while ((match = pattern2.exec(content)) !== null) {
    if (!terms.some(t => t.term === match![1].trim())) {
      terms.push({
        term: match[1].trim(),
        definition: match[2].trim(),
        articleRef: articleRef,
      });
    }
  }

  // 패턴 3: X. "XXX" ... (호 형식)
  const pattern3 = /\d+\.\s*"([^"]+)"[^:：]*[:：]?\s*([^.\d]+)/g;
  
  while ((match = pattern3.exec(content)) !== null) {
    const term = match[1].trim();
    const def = match[2].trim();
    
    if (def.length > 5 && !terms.some(t => t.term === term)) {
      terms.push({
        term: term,
        definition: def,
        articleRef: articleRef,
      });
    }
  }

  // 패턴 4: 가. "XXX" (목 형식)
  const pattern4 = /[가-힣]\.\s*"([^"]+)"\s*[:：]?\s*([^.\n가-힣]+)/g;
  
  while ((match = pattern4.exec(content)) !== null) {
    const term = match[1].trim();
    const def = match[2].trim();
    
    if (def.length > 5 && !terms.some(t => t.term === term)) {
      terms.push({
        term: term,
        definition: def,
        articleRef: articleRef,
      });
    }
  }

  return terms;
}

/**
 * 단일 법령에서 용어 추출
 */
async function extractTermsFromLaw(lawName: string): Promise<TermExtractionStats> {
  const stats: TermExtractionStats = { lawsProcessed: 0, termsExtracted: 0, errors: 0 };

  try {
    console.log(`  📖 처리 중: ${lawName}`);

    // API에서 법령 상세 조회
    const searchResults = await api.searchLaws(lawName, 1);
    if (searchResults.length === 0) {
      console.log(`     ⚠️ "${lawName}" 검색 결과 없음`);
      return stats;
    }

    const lawDetail = await api.getLawDetail(searchResults[0].법령ID);
    if (!lawDetail) {
      console.log(`     ⚠️ 상세 정보 조회 실패`);
      return stats;
    }

    stats.lawsProcessed++;

    // 법령 ID 확인/저장
    const existingLaw = db.findLawByName(lawName);
    let lawId: number;

    if (existingLaw) {
      lawId = existingLaw.id!;
    } else {
      // 법령이 없으면 저장
      lawId = db.upsertLaw({
        law_mst_id: String(lawDetail.기본정보.법령ID),
        law_name: lawDetail.기본정보.법령명_한글,
        promulgation_date: formatDate(lawDetail.기본정보.공포일자),
        enforcement_date: formatDate(lawDetail.기본정보.시행일자),
        law_type: lawDetail.기본정보.법령구분명,
        ministry: lawDetail.기본정보.소관부처명,
        status: 'ACTIVE',
      });
    }

    // 정의 조항 찾기 (제2조, 제3조 등)
    const definitionArticles = lawDetail.조문.filter(a => 
      a.조문제목?.includes('정의') ||
      a.조문번호.includes('제2조') ||
      a.조문번호.includes('제3조')
    );

    for (const article of definitionArticles) {
      const content = article.조문내용;
      const articleRef = `${lawDetail.기본정보.법령명_한글} ${article.조문번호}`;

      // 용어 추출
      const extractedTerms = extractTermsFromContent(content, articleRef);

      for (const term of extractedTerms) {
        try {
          // DB에 저장
          const dbInstance = db.getDatabase();
          const stmt = dbInstance.prepare(`
            INSERT INTO LegalTerms (law_id, term, term_normalized, definition, article_ref)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT DO UPDATE SET
              definition = excluded.definition,
              article_ref = excluded.article_ref
          `);

          stmt.run(
            lawId,
            term.term,
            term.term.replace(/\s+/g, '').toLowerCase(),
            term.definition,
            term.articleRef
          );

          stats.termsExtracted++;
        } catch (err) {
          stats.errors++;
        }
      }

      // 항 단위 추출
      if (article.항) {
        for (const hang of article.항) {
          const hangContent = hang.항내용;
          const hangRef = `${articleRef} 제${hang.항번호}항`;

          const hangTerms = extractTermsFromContent(hangContent, hangRef);
          
          for (const term of hangTerms) {
            try {
              const dbInstance = db.getDatabase();
              const stmt = dbInstance.prepare(`
                INSERT INTO LegalTerms (law_id, term, term_normalized, definition, article_ref)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT DO NOTHING
              `);

              stmt.run(
                lawId,
                term.term,
                term.term.replace(/\s+/g, '').toLowerCase(),
                term.definition,
                term.articleRef
              );

              stats.termsExtracted++;
            } catch (err) {
              stats.errors++;
            }
          }

          // 호 단위 추출
          if (hang.호) {
            for (const ho of hang.호) {
              const hoContent = ho.호내용;
              const hoRef = `${hangRef} 제${ho.호번호}호`;

              const hoTerms = extractTermsFromContent(hoContent, hoRef);
              
              for (const term of hoTerms) {
                try {
                  const dbInstance = db.getDatabase();
                  const stmt = dbInstance.prepare(`
                    INSERT INTO LegalTerms (law_id, term, term_normalized, definition, article_ref)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT DO NOTHING
                  `);

                  stmt.run(
                    lawId,
                    term.term,
                    term.term.replace(/\s+/g, '').toLowerCase(),
                    term.definition,
                    term.articleRef
                  );

                  stats.termsExtracted++;
                } catch (err) {
                  stats.errors++;
                }
              }
            }
          }
        }
      }
    }

    console.log(`     ✅ ${stats.termsExtracted}개 용어 추출`);
  } catch (error) {
    console.error(`     ❌ 오류:`, error);
    stats.errors++;
  }

  return stats;
}

/**
 * 주요 법령 목록
 */
const LAWS_TO_EXTRACT = [
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
  '개인정보보호법',
  '정보통신망이용촉진및정보보호등에관한법률',
  '전자상거래등에서의소비자보호에관한법률',
  '공정거래법',
];

/**
 * 전체 용어 추출 실행
 */
export async function runTermExtraction(): Promise<void> {
  console.log('═══════════════════════════════════════════');
  console.log('📚 korea-law 법률 용어 추출 시작');
  console.log(`   시간: ${format(new Date(), 'yyyy-MM-dd HH:mm:ss')}`);
  console.log('═══════════════════════════════════════════');
  console.log('⚠️ 주의: 이 데이터는 AI 검증용입니다.');
  console.log('═══════════════════════════════════════════\n');

  // DB 초기화
  db.initDatabase();

  const totalStats: TermExtractionStats = { lawsProcessed: 0, termsExtracted: 0, errors: 0 };

  for (const lawName of LAWS_TO_EXTRACT) {
    const stats = await extractTermsFromLaw(lawName);
    totalStats.lawsProcessed += stats.lawsProcessed;
    totalStats.termsExtracted += stats.termsExtracted;
    totalStats.errors += stats.errors;

    // API 부하 방지
    await delay(500);
  }

  // 결과 출력
  console.log('\n═══════════════════════════════════════════');
  console.log('📊 용어 추출 완료');
  console.log(`   처리된 법령: ${totalStats.lawsProcessed}건`);
  console.log(`   추출된 용어: ${totalStats.termsExtracted}건`);
  console.log(`   오류: ${totalStats.errors}건`);
  console.log('═══════════════════════════════════════════');

  db.closeDatabase();
}

// ============================================
// 유틸리티 함수
// ============================================

function formatDate(dateStr: string | number): string {
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
  runTermExtraction().catch(console.error);
}

