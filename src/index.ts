/**
 * korea-law: Main Entry Point
 * 
 * AI Legal Auditor - 한국 법률 검증 MCP 서버
 * 
 * ⚠️ 중요: 이 패키지는 AI의 법률 인용을 "검증"하기 위한 도구입니다.
 * - DB에 저장된 데이터는 AI 검증용 기준값입니다.
 * - 법적 효력의 최종 판단은 국가법령정보센터(law.go.kr)를 참조하세요.
 * 
 * @packageDocumentation
 */

// 환경 변수 로드
import 'dotenv/config';

// DB 모듈 (SQLite) - 기본 DB
import * as sqlite from './db/database';
export { sqlite };
export {
  initDatabase,
  getDatabase,
  closeDatabase,
  upsertLaw,
  upsertArticle,
  insertDiffLog,
  findLawByName,
  findArticle,
  getTodayDiffs,
  getFutureChanges,
  verifyPrecedentExists,
} from './db/database';

// DB 모듈 (Supabase) - 클라우드 DB
import * as supabase from './db/supabase';
export { supabase };

// API 모듈
export * from './api/law-api';

// Sync 모듈
export { runFullSync, scheduleDailySync } from './sync/daily-sync';
export { runPrecedentSync } from './sync/precedent-sync';
export { runTermExtraction } from './sync/term-extractor';

// MCP 서버
export { startMcpServer } from './mcp/server';

// 버전 정보
export const VERSION = '1.1.0';
export const PACKAGE_NAME = 'korea-law';

// 타입 export
export type { LawRecord, ArticleRecord, DiffRecord } from './db/database';

// 기본 실행 (MCP 서버)
import { startMcpServer } from './mcp/server';

if (require.main === module) {
  startMcpServer().catch(console.error);
}

