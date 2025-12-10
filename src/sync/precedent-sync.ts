/**
 * korea-law: 판례 동기화 모듈
 * 
 * 대법원 판례 데이터를 동기화하여 AI의 가짜 판례 인용을 방지합니다.
 * 
 * ⚠️ 중요: 이 데이터는 "검증용(Verification)" 목적입니다.
 * 판례의 존재 여부만 확인하며, 전문은 저장하지 않습니다.
 */

import * as api from '../api/law-api';
import * as db from '../db/database';
import { format } from 'date-fns';

// ============================================
// 타입 정의
// ============================================

interface PrecedentSyncStats {
  added: number;
  updated: number;
  errors: number;
}

// ============================================
// 판례 동기화 함수
// ============================================

/**
 * 주요 판례 키워드 목록
 * 노동, 민사, 형사 등 주요 분야
 */
const PRECEDENT_KEYWORDS = [
  // 노동법 관련
  '해고', '부당해고', '정리해고', '권고사직',
  '임금', '퇴직금', '연차휴가', '근로시간',
  '노동조합', '단체교섭', '파업',
  
  // 민사 관련
  '손해배상', '채무불이행', '불법행위',
  '계약해제', '계약해지', '이행청구',
  '소유권', '저당권', '임대차',
  
  // 형사 관련
  '사기', '횡령', '배임',
  '명예훼손', '모욕',
  
  // 상사/기업 관련
  '주주총회', '이사회', '대표이사',
  '합병', '분할', '회생',
  
  // 세무/행정 관련
  '부가가치세', '법인세', '소득세',
  '과세처분', '조세포탈',
];

/**
 * 키워드별 판례 동기화
 */
async function syncPrecedentsByKeyword(keyword: string): Promise<PrecedentSyncStats> {
  const stats: PrecedentSyncStats = { added: 0, updated: 0, errors: 0 };

  try {
    console.log(`  📚 검색 중: "${keyword}"`);
    
    const results = await api.searchPrecedents(keyword, 50);
    
    for (const prec of results) {
      try {
        // 사건번호 정규화
        const caseId = prec.사건번호?.trim();
        if (!caseId) continue;

        // 기존 데이터 확인
        const exists = db.verifyPrecedentExists(caseId);
        
        // DB에 저장
        const dbInstance = db.getDatabase();
        const stmt = dbInstance.prepare(`
          INSERT INTO Precedents (case_id, case_id_normalized, court, case_type, decision_date, case_name, exists_verified)
          VALUES (?, ?, ?, ?, ?, ?, 1)
          ON CONFLICT(case_id) DO UPDATE SET
            court = excluded.court,
            case_type = excluded.case_type,
            decision_date = excluded.decision_date,
            case_name = excluded.case_name,
            last_verified_at = CURRENT_TIMESTAMP
        `);

        stmt.run(
          caseId,
          normalizeCaseId(caseId),
          prec.법원명 || null,
          prec.사건종류명 || null,
          formatDate(prec.선고일자),
          prec.사건명 || null
        );

        if (exists) {
          stats.updated++;
        } else {
          stats.added++;
        }
      } catch (err) {
        stats.errors++;
      }
    }

    console.log(`     ✅ ${keyword}: ${results.length}건 처리`);
  } catch (error) {
    console.error(`     ❌ ${keyword} 검색 실패:`, error);
    stats.errors++;
  }

  return stats;
}

/**
 * 최근 판례 동기화 (날짜 기준)
 */
async function syncRecentPrecedents(days: number = 30): Promise<PrecedentSyncStats> {
  const stats: PrecedentSyncStats = { added: 0, updated: 0, errors: 0 };

  try {
    console.log(`\n📅 최근 ${days}일 판례 동기화...`);

    // 최근 날짜 범위 계산
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // 연도별 검색 (API 제한 고려)
    const years = [endDate.getFullYear()];
    if (startDate.getFullYear() !== endDate.getFullYear()) {
      years.push(startDate.getFullYear());
    }

    for (const year of years) {
      const results = await api.searchPrecedents(`${year}`, 100);
      
      for (const prec of results) {
        try {
          const caseId = prec.사건번호?.trim();
          if (!caseId) continue;

          const exists = db.verifyPrecedentExists(caseId);
          
          const dbInstance = db.getDatabase();
          const stmt = dbInstance.prepare(`
            INSERT INTO Precedents (case_id, case_id_normalized, court, case_type, decision_date, case_name, exists_verified)
            VALUES (?, ?, ?, ?, ?, ?, 1)
            ON CONFLICT(case_id) DO UPDATE SET
              last_verified_at = CURRENT_TIMESTAMP
          `);

          stmt.run(
            caseId,
            normalizeCaseId(caseId),
            prec.법원명 || null,
            prec.사건종류명 || null,
            formatDate(prec.선고일자),
            prec.사건명 || null
          );

          if (exists) {
            stats.updated++;
          } else {
            stats.added++;
          }
        } catch (err) {
          stats.errors++;
        }
      }
    }

    console.log(`   ✅ 최근 판례: 추가 ${stats.added}건, 업데이트 ${stats.updated}건`);
  } catch (error) {
    console.error('   ❌ 최근 판례 동기화 실패:', error);
    stats.errors++;
  }

  return stats;
}

/**
 * 전체 판례 동기화 실행
 */
export async function runPrecedentSync(): Promise<void> {
  console.log('═══════════════════════════════════════════');
  console.log('📚 korea-law 판례 동기화 시작');
  console.log(`   시간: ${format(new Date(), 'yyyy-MM-dd HH:mm:ss')}`);
  console.log('═══════════════════════════════════════════');
  console.log('⚠️ 주의: 이 데이터는 AI 검증용입니다.');
  console.log('   판례 존재 여부만 확인합니다.');
  console.log('═══════════════════════════════════════════\n');

  // DB 초기화
  db.initDatabase();

  const totalStats: PrecedentSyncStats = { added: 0, updated: 0, errors: 0 };

  // 키워드별 동기화
  console.log('🔍 키워드별 판례 검색...');
  for (const keyword of PRECEDENT_KEYWORDS) {
    const stats = await syncPrecedentsByKeyword(keyword);
    totalStats.added += stats.added;
    totalStats.updated += stats.updated;
    totalStats.errors += stats.errors;

    // API 부하 방지
    await delay(500);
  }

  // 최근 판례 동기화
  const recentStats = await syncRecentPrecedents(30);
  totalStats.added += recentStats.added;
  totalStats.updated += recentStats.updated;
  totalStats.errors += recentStats.errors;

  // 결과 출력
  console.log('\n═══════════════════════════════════════════');
  console.log('📊 판례 동기화 완료');
  console.log(`   추가: ${totalStats.added}건`);
  console.log(`   업데이트: ${totalStats.updated}건`);
  console.log(`   오류: ${totalStats.errors}건`);
  console.log('═══════════════════════════════════════════');

  db.closeDatabase();
}

// ============================================
// 유틸리티 함수
// ============================================

function normalizeCaseId(caseId: string): string {
  return caseId.replace(/\s+/g, '').replace(/[^\w가-힣]/g, '');
}

function formatDate(dateStr: string | number | undefined): string | null {
  if (!dateStr) return null;
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
  runPrecedentSync().catch(console.error);
}

