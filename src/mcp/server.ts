/**
 * korea-law: MCP Server
 * 
 * AI Legal Auditor - 한국 법률 검증 MCP 서버
 * 
 * ⚠️ 이 서버는 AI의 법률 인용을 "검증"하기 위한 도구입니다.
 * 법적 판단의 최종 근거로 사용하지 마세요.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  Tool,
  Prompt,
} from '@modelcontextprotocol/sdk/types.js';

import * as db from '../db/database';
import * as api from '../api/law-api';
import * as extendedApi from '../api/extended-api';
import { format, parseISO, isAfter, isBefore, isWithinInterval } from 'date-fns';

// ============================================
// 법령 직접 링크 생성 유틸리티
// ============================================

function getLawGoKrLink(lawName: string, articleNo?: string): string {
  const encodedLawName = encodeURIComponent(lawName);
  if (articleNo) {
    return `https://www.law.go.kr/법령/${encodedLawName}/${articleNo}`;
  }
  return `https://www.law.go.kr/법령/${encodedLawName}`;
}

function getPrecedentLink(caseId: string): string {
  return `https://www.law.go.kr/판례/(${encodeURIComponent(caseId)})`;
}

// ============================================
// MCP Prompts 정의 (rule.md 기반)
// ============================================

const PROMPTS: Prompt[] = [
  {
    name: 'legal-auditor',
    description: `대한민국 법률 규정 감사관(Korea Legal Compliance Auditor) 페르소나 - 
AI가 법적 사고방식(Legal Mind)으로 헌법부터 시작해 법률, 판례 순으로 논리를 전개하도록 합니다.`,
  },
  {
    name: 'legal-reasoning',
    description: `단계별 법적 추론(Chain of Thought) 프롬프트 - 
헌법적 가치 검토 → 법률 검토 → 판례 검토 → 종합 조언 순서로 답변하도록 합니다.`,
  },
];

// System Prompt 전문 (rule.md 기반)
const LEGAL_AUDITOR_PROMPT = `# Role: Korea Legal Compliance Auditor (대한민국 법률 규정 감사관)

## 1. Core Mission
당신은 대한민국 법령 체계에 대한 깊은 이해를 바탕으로, 사용자의 질문이나 AI의 답변이 **'법적 정합성'**을 갖추고 있는지 검증하고 조언하는 최고 권위의 감사관입니다. 단순한 텍스트 매칭이 아니라, 법의 **위계(Hierarchy)**와 **취지(Spirit)**를 고려하여 판단하십시오.

## 2. The Hierarchy of Laws (법령의 위계)
모든 판단은 아래의 우선순위를 엄격히 따릅니다. 상위 단계는 하위 단계를 기속합니다.

1.  **[헌법 (Constitution)]**: 최상위 규범. (인권, 노동3권, 평등권 등 기본권 침해 여부 최우선 검토)
2.  **[법률 (Act)]**: 국회 제정 법률. (권리와 의무의 기본 기준)
3.  **[명령 (Decree)]**: 대통령령(시행령) > 총리령/부령(시행규칙). (구체적 절차와 위임 사항)
4.  **[행정규칙 (Administrative Rules)]**: 훈령, 예규, 고시. (실무적 지침이나, 상위법을 거스를 수 없음)
5.  **[자치법규/판례]**: 조례/규칙 및 대법원 판례(해석 기준).

## 3. Judgment Principles (판단 원칙)
정보가 충돌할 경우 다음 원칙을 적용하여 해결책을 제시하십시오.

* **상위법 우선 (Lex Superior):** 노동부 지침이 근로기준법(법률)보다 근로자에게 불리하거나 법 취지를 왜곡한다면, **법률**을 따르도록 경고하십시오.
* **신법 우선 (Lex Posterior):** \`korea-law\` 도구를 통해 확인된 **가장 최신의 '시행일(Enforcement Date)'** 기준 법령을 정답으로 간주하십시오.
* **특별법 우선 (Lex Specialis):** 일반법(민법)보다 특별법(상법, 근로기준법)을 먼저 적용하십시오.
* **유리한 조건 우선 (노동법 특칙):** 근로계약, 취업규칙, 법령 중 근로자에게 가장 유리한 조건을 우선 적용하십시오.

## 4. Verification Workflow (검증 절차)
사용자의 입력이나 초안을 검토할 때 반드시 다음 단계를 거쳐 생각하십시오(Chain of Thought).

1.  **[Fact Check]**: 인용된 법령(제 몇 조)이 \`audit_statute\` 도구를 통해 확인된 **현행 실제 텍스트**와 일치하는가?
2.  **[Hierarchy Check]**: 해당 조항이 헌법적 가치(예: 직업의 자유, 적법절차)나 상위법에 위배되지 않는가?
3.  **[Status Check]**: 해당 조항이 현재 시행 중인가, 아니면 단순 공포(미시행) 상태인가? (Diff 확인)

## 5. Output Format (답변 양식)
최종 답변은 반드시 아래 구조를 따르십시오.

* **🔍 검토 결과 (Verdict):** [적법 / 위법 / 주의 필요]
* **📜 근거 법령 (Authority):** 검증된 법령명과 조문 (예: 근로기준법 제23조 [현행])
* **⚖️ 법적 조언 (Advisory):**
    * 위계에 따른 해석 (예: "지침은 이렇게 되어 있으나, 상위법인 XX법에 따라...")
    * 실무적 리스크 경고 (예: "판례(2023다XXXX)는 다르게 해석하고 있으므로 주의가 필요합니다.")

## 6. Disclaimer (면책 조항)
모든 답변의 끝에는 반드시 다음 문구를 포함하십시오:
"⚠️ 본 답변은 법률적 참고 자료이며, 변호사의 전문적인 법률 자문을 대체할 수 없습니다. 정확한 법령 원문은 국가법령정보센터(law.go.kr)에서 확인하세요."`;

const LEGAL_REASONING_PROMPT = `# 단계별 법적 추론 (Legal Reasoning Chain of Thought)

당신은 대한민국 법 체계에 정통한 법률 전문가 AI입니다. 사용자의 질문에 대해 헌법적 가치에서 출발하여 구체적인 법률, 시행령, 판례 순으로 논리를 전개하여 답변해야 합니다.

## 단계 1: 헌법적 가치 검토
- 이 사안과 관련된 '대한민국 헌법'의 기본권(예: 행복추구권, 재산권, 신체의 자유 등)이나 헌법 원칙(예: 법치주의, 적법절차의 원칙)은 무엇인가?
- 헌법 재판소의 위헌 결정이나 헌법 해석이 이 사안에 영향을 미치는가?

## 단계 2: 법률(Act) 및 하위 법령 검토
- 헌법적 가치를 구체화한 핵심 '법률'은 무엇인가? (예: 민법, 형법, 근로기준법 등)
- 해당 법률의 구체적인 절차를 규정하는 '시행령' 및 '시행규칙'은 무엇인가?
- *중요*: 적용하려는 법령이 현재 유효한 최신 법령인지 \`check_enforcement_date\` 도구로 확인하십시오.

## 단계 3: 판례 및 해석 (Precedents)
- 대법원 판례나 하급심 판례 중 이 사안과 가장 유사한 사례는 무엇인가?
- 법령의 문언적 의미를 넘어선 사법부의 해석 태도는 어떠한가?
- *중요*: AI가 인용하는 판례가 실제 존재하는지 \`verify_case_exists\` 도구로 검증하십시오.

## 단계 4: 종합 조언 (Conclusion & Advice)
- 위 검토를 종합했을 때, 사용자가 취할 수 있는 가장 적절한 법적 조치는 무엇인가?
- 예상되는 법적 리스크와 현실적인 대응 방안은?
- 필요시 "최선의 시나리오"와 "최악의 시나리오"를 구분하여 제시하십시오.

## Disclaimer
답변의 끝에는 반드시 "본 답변은 법률적 참고 자료이며, 변호사의 전문적인 법률 자문을 대체할 수 없습니다."라는 문구를 포함하세요.`;

// ============================================
// MCP Tools 정의
// ============================================

const TOOLS: Tool[] = [
  {
    name: 'audit_statute',
    description: `[핵심 기능] 법령 조문 검증 - AI가 인용한 법령 조문이 현행법과 일치하는지 검증합니다.

⚠️ 중요: 이 도구는 AI의 법률 인용 정확성을 검증하기 위한 "감사(Audit)" 도구입니다.
- AI가 "근로기준법 제23조"를 인용했다면, 실제 현행 조문과 비교합니다.
- 조문이 삭제/개정되었거나, 내용이 다르면 경고합니다.
- 국가법령정보센터 직접 링크도 함께 제공합니다.

사용 예시: "근로기준법 제23조가 정말 해고 제한에 관한 조항인가요?"`,
    inputSchema: {
      type: 'object',
      properties: {
        law_name: {
          type: 'string',
          description: '법령명 (예: 근로기준법, 민법, 형법)',
        },
        article_number: {
          type: 'string',
          description: '조문 번호 (예: 제23조, 23, 제23조의2)',
        },
        target_date: {
          type: 'string',
          description: '검증 기준일 (YYYY-MM-DD, 기본값: 오늘)',
        },
        expected_content: {
          type: 'string',
          description: '(선택) AI가 인용한 내용 - 실제 조문과 비교',
        },
      },
      required: ['law_name', 'article_number'],
    },
  },
  {
    name: 'check_enforcement_date',
    description: `법령 시행일 확인 - 법령이 현재 유효한지, 언제 개정되었는지 확인합니다.

AI가 오래된 법령을 인용하는 것을 방지합니다.
- 공포일 vs 시행일 구분
- 미래 시행 예정 법령 감지

사용 예시: "근로기준법이 최근에 개정되었나요? 언제부터 시행인가요?"`,
    inputSchema: {
      type: 'object',
      properties: {
        law_name: {
          type: 'string',
          description: '법령명',
        },
      },
      required: ['law_name'],
    },
  },
  {
    name: 'verify_case_exists',
    description: `판례 실존 여부 확인 - AI가 인용한 판례가 실제로 존재하는지 확인합니다.

⚠️ AI는 가짜 판례번호를 만들어내는 경우가 있습니다.
이 도구는 해당 사건번호가 실제 대법원/하급심 DB에 존재하는지 검증합니다.

사용 예시: "대법원 2023다12345 판결이 실제로 있나요?"`,
    inputSchema: {
      type: 'object',
      properties: {
        case_id: {
          type: 'string',
          description: '사건번호 (예: 2023다12345, 2022나98765)',
        },
      },
      required: ['case_id'],
    },
  },
  {
    name: 'get_daily_diff',
    description: `오늘의 법령 변경 사항 - 오늘 시행되거나 개정된 법령을 확인합니다.

"오늘 바뀐 노동법이 있나요?" 같은 질문에 답합니다.
매일 동기화된 Diff 엔진이 변경 사항을 추적합니다.`,
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: '법령 분야 필터 (노동, 세무, 민사, 형사 등)',
        },
      },
    },
  },
  {
    name: 'audit_contract_timeline',
    description: `[고급 기능] 계약 기간 기준 법령 유효성 검사

계약 기간 동안 법이 바뀌는지 확인합니다.
"지금은 합법이지만, 3개월 뒤 계약 기간 중에는 위법이 됩니다" 같은 경고를 제공합니다.

사용 예시: "2025년 1월~12월 근로계약에 적용될 근로기준법 변경 예정이 있나요?"`,
    inputSchema: {
      type: 'object',
      properties: {
        law_name: {
          type: 'string',
          description: '검토할 법령명',
        },
        contract_start: {
          type: 'string',
          description: '계약 시작일 (YYYY-MM-DD)',
        },
        contract_end: {
          type: 'string',
          description: '계약 종료일 (YYYY-MM-DD)',
        },
      },
      required: ['law_name', 'contract_start', 'contract_end'],
    },
  },
  {
    name: 'check_legal_definition',
    description: `법률 용어 정의 확인 - 특정 법령에서 용어가 어떻게 정의되는지 확인합니다.

법률에서 "근로자", "해고", "임금" 등의 정확한 법적 정의를 조회합니다.
AI가 용어를 잘못 사용하는 것을 방지합니다.`,
    inputSchema: {
      type: 'object',
      properties: {
        law_name: {
          type: 'string',
          description: '법령명',
        },
        term: {
          type: 'string',
          description: '검색할 용어 (예: 근로자, 해고, 임금)',
        },
      },
      required: ['law_name', 'term'],
    },
  },
  {
    name: 'get_related_laws',
    description: `[법령 위계 기능] 상위법/하위법 관련법령 조회 - 법령의 위계 구조를 파악합니다.

법의 위계(헌법 > 법률 > 명령 > 규칙)를 이해하기 위해:
- 시행령/시행규칙 (하위법령)
- 모법/위임근거 (상위법령)  
- 관련 행정규칙, 조례 등

을 조회합니다. "상위법 우선의 원칙"을 적용하기 위한 핵심 도구입니다.

사용 예시: "근로기준법의 시행령과 시행규칙을 알려줘"`,
    inputSchema: {
      type: 'object',
      properties: {
        law_name: {
          type: 'string',
          description: '검색할 법령명 (예: 근로기준법, 민법)',
        },
        relation_type: {
          type: 'string',
          enum: ['all', 'upper', 'lower', 'enforcement'],
          description: '관계 유형: all(전체), upper(상위법), lower(하위법), enforcement(시행령/규칙)',
        },
      },
      required: ['law_name'],
    },
  },
  {
    name: 'check_law_hierarchy',
    description: `[법령 위계 판단] 두 법령 간 위계 관계 확인 - 상위법 우선 원칙 적용을 위한 도구

두 법령이 충돌할 때 어느 법령을 우선 적용해야 하는지 판단합니다.
- 헌법 > 법률 > 대통령령(시행령) > 총리령/부령(시행규칙) > 행정규칙
- 특별법 > 일반법
- 신법 > 구법

사용 예시: "근로기준법과 노동부 지침이 충돌하면 어떤 것이 우선인가요?"`,
    inputSchema: {
      type: 'object',
      properties: {
        law_name_1: {
          type: 'string',
          description: '첫 번째 법령명',
        },
        law_name_2: {
          type: 'string',
          description: '두 번째 법령명',
        },
      },
      required: ['law_name_1', 'law_name_2'],
    },
  },
  {
    name: 'search_admin_rules',
    description: `행정규칙 검색 - 훈령, 예규, 고시 등 행정규칙을 검색합니다.

⚠️ 주의: 행정규칙은 상위법(법률, 시행령)을 거스를 수 없습니다.
법률 vs 행정규칙이 충돌하면 법률이 우선합니다.

노동부 지침, 국세청 예규 등 실무에서 자주 참조되는 행정규칙을 검색합니다.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '검색어 (예: 해고, 임금, 퇴직금)',
        },
        limit: {
          type: 'number',
          description: '검색 결과 수 (기본값: 20)',
        },
      },
      required: ['query'],
    },
  },
];

// ============================================
// Tool 핸들러
// ============================================

async function handleAuditStatute(args: {
  law_name: string;
  article_number: string;
  target_date?: string;
  expected_content?: string;
}): Promise<string> {
  const { law_name, article_number, target_date, expected_content } = args;
  const targetDateStr = target_date || format(new Date(), 'yyyy-MM-dd');

  // 1. 로컬 DB에서 먼저 조회
  let law = db.findLawByName(law_name, targetDateStr);
  
  // 2. DB에 없으면 API로 조회
  if (!law) {
    try {
      const apiResults = await api.searchLaws(law_name, 10);
      if (apiResults.length === 0) {
        return JSON.stringify({
          status: 'NOT_FOUND',
          warning: `⚠️ "${law_name}" 법령을 찾을 수 없습니다.`,
          suggestion: '법령명을 정확히 입력했는지 확인하세요. (예: 근로기준법, 민법)',
        });
      }

      // 가장 최신 시행 법령 선택
      const latestLaw = apiResults[0];
      const lawDetail = await api.getLawDetail(latestLaw.법령ID);

      if (!lawDetail) {
        return JSON.stringify({
          status: 'API_ERROR',
          warning: '법령 상세 정보를 가져올 수 없습니다.',
        });
      }

      // 조문 찾기
      const normalizedArticleNo = article_number.replace(/제|조/g, '').trim();
      const article = lawDetail.조문.find(a => 
        a.조문번호.includes(normalizedArticleNo) || 
        a.조문번호.replace(/제|조/g, '').trim() === normalizedArticleNo
      );

      if (!article) {
        return JSON.stringify({
          status: 'ARTICLE_NOT_FOUND',
          warning: `⚠️ "${law_name}"에서 ${article_number}를 찾을 수 없습니다.`,
          available_articles: lawDetail.조문.slice(0, 10).map(a => a.조문번호),
          suggestion: '조문 번호를 확인하세요. 해당 조문이 삭제되었을 수 있습니다.',
        });
      }

      // 결과 반환
      const result: any = {
        status: 'FOUND',
        law_name: lawDetail.기본정보.법령명_한글,
        article_number: article.조문번호,
        article_title: article.조문제목 || null,
        content: article.조문내용,
        enforcement_date: lawDetail.기본정보.시행일자,
        promulgation_date: lawDetail.기본정보.공포일자,
        
        // 국가법령정보센터 직접 링크
        source_url: getLawGoKrLink(lawDetail.기본정보.법령명_한글, article.조문번호),
        
        // 검증 메타데이터
        verification_note: '⚠️ 이 데이터는 AI 검증용입니다. 법적 판단의 최종 근거는 국가법령정보센터(law.go.kr)를 참조하세요.',
      };

      // expected_content가 있으면 비교
      if (expected_content) {
        const similarity = calculateSimilarity(expected_content, article.조문내용);
        result.comparison = {
          expected: expected_content,
          actual: article.조문내용,
          similarity_score: similarity,
          match_status: similarity > 0.8 ? 'MATCH' : similarity > 0.5 ? 'PARTIAL_MATCH' : 'MISMATCH',
        };

        if (similarity < 0.8) {
          result.warning = `⚠️ AI가 인용한 내용과 실제 조문이 다릅니다! (유사도: ${(similarity * 100).toFixed(1)}%)`;
        }
      }

      return JSON.stringify(result, null, 2);
    } catch (error) {
      return JSON.stringify({
        status: 'ERROR',
        error: String(error),
      });
    }
  }

  // DB에서 찾은 경우
  const article = db.findArticle(law.id!, article_number);
  if (!article) {
    return JSON.stringify({
      status: 'ARTICLE_NOT_FOUND',
      warning: `⚠️ ${article_number}를 찾을 수 없습니다.`,
    });
  }

  return JSON.stringify({
    status: 'FOUND',
    law_name: law.law_name,
    article_number: article.article_no,
    article_title: article.article_title,
    content: article.content,
    enforcement_date: law.enforcement_date,
    verification_note: '⚠️ 이 데이터는 AI 검증용입니다.',
  }, null, 2);
}

async function handleCheckEnforcementDate(args: { law_name: string }): Promise<string> {
  const { law_name } = args;

  try {
    const apiResults = await api.searchLaws(law_name, 5);
    
    if (apiResults.length === 0) {
      return JSON.stringify({
        status: 'NOT_FOUND',
        warning: `"${law_name}" 법령을 찾을 수 없습니다.`,
      });
    }

    const laws = apiResults.map(l => ({
      법령명: l.법령명한글,
      공포일자: l.공포일자,
      시행일자: l.시행일자,
      제개정구분: l.제개정구분명,
      소관부처: l.소관부처명,
      현행여부: isAfter(new Date(), parseISO(formatDate(l.시행일자))) ? '현행' : '미시행',
    }));

    const current = laws.find(l => l.현행여부 === '현행');
    const pending = laws.filter(l => l.현행여부 === '미시행');

    return JSON.stringify({
      status: 'FOUND',
      current_law: current,
      pending_amendments: pending,
      warning: pending.length > 0 
        ? `⚠️ ${pending.length}건의 개정 예정 법령이 있습니다. 계약/문서 작성 시 주의하세요.`
        : null,
      verification_note: '⚠️ 이 데이터는 AI 검증용입니다.',
    }, null, 2);
  } catch (error) {
    return JSON.stringify({
      status: 'ERROR',
      error: String(error),
    });
  }
}

async function handleVerifyCaseExists(args: { case_id: string }): Promise<string> {
  const { case_id } = args;

  // 1. 로컬 DB 먼저 확인
  const existsLocal = db.verifyPrecedentExists(case_id);
  
  if (existsLocal) {
    return JSON.stringify({
      status: 'VERIFIED',
      case_id: case_id,
      exists: true,
      source: 'local_db',
      source_url: getPrecedentLink(case_id),
      verification_note: '⚠️ 판례 존재 여부만 확인됨. 상세 내용은 대법원 판례정보에서 확인하세요.',
    });
  }

  // 2. API로 확인
  try {
    const existsOnline = await api.verifyPrecedentExistsOnline(case_id);
    
    return JSON.stringify({
      status: existsOnline ? 'VERIFIED' : 'NOT_FOUND',
      case_id: case_id,
      exists: existsOnline,
      source: 'api_search',
      source_url: existsOnline ? getPrecedentLink(case_id) : null,
      warning: !existsOnline 
        ? `⚠️ 주의: "${case_id}" 판례를 찾을 수 없습니다. AI가 가짜 판례를 생성했을 수 있습니다!`
        : null,
      verification_note: '⚠️ 판례 존재 여부만 확인됨.',
    });
  } catch (error) {
    return JSON.stringify({
      status: 'ERROR',
      case_id: case_id,
      error: String(error),
    });
  }
}

async function handleGetDailyDiff(args: { category?: string }): Promise<string> {
  const diffs = db.getTodayDiffs();
  
  if (diffs.length === 0) {
    return JSON.stringify({
      status: 'NO_CHANGES',
      message: '오늘 변경된 법령이 없습니다.',
      date: format(new Date(), 'yyyy-MM-dd'),
    });
  }

  // 카테고리 필터링
  let filtered = diffs;
  if (args.category) {
    filtered = diffs.filter(d => 
      d.law_name?.includes(args.category) || 
      d.diff_summary?.includes(args.category)
    );
  }

  return JSON.stringify({
    status: 'FOUND',
    date: format(new Date(), 'yyyy-MM-dd'),
    total_changes: filtered.length,
    changes: filtered.map(d => ({
      law_name: d.law_name,
      article: d.article_no,
      change_type: d.change_type,
      summary: d.diff_summary,
      is_critical: d.is_critical,
      warning: d.warning_message,
    })),
    verification_note: '⚠️ 이 데이터는 AI 검증용입니다.',
  }, null, 2);
}

async function handleAuditContractTimeline(args: {
  law_name: string;
  contract_start: string;
  contract_end: string;
}): Promise<string> {
  const { law_name, contract_start, contract_end } = args;

  const futureChanges = db.getFutureChanges(contract_start, contract_end);
  
  // 해당 법령만 필터
  const relevantChanges = futureChanges.filter(c => 
    c.law_name?.includes(law_name)
  );

  if (relevantChanges.length === 0) {
    return JSON.stringify({
      status: 'NO_CHANGES_IN_PERIOD',
      law_name: law_name,
      period: { start: contract_start, end: contract_end },
      message: `계약 기간(${contract_start} ~ ${contract_end}) 동안 "${law_name}"의 변경 예정 사항이 없습니다.`,
    });
  }

  return JSON.stringify({
    status: 'CHANGES_DETECTED',
    law_name: law_name,
    period: { start: contract_start, end: contract_end },
    warning: `⚠️ 주의: 계약 기간 중 법령 변경이 예정되어 있습니다!`,
    changes: relevantChanges.map(c => ({
      effective_date: c.effective_from,
      article: c.article_no,
      change_type: c.change_type,
      summary: c.diff_summary,
      impact: c.warning_message || '계약서 내용 검토 필요',
    })),
    recommendation: '계약서에 법령 변경 시 조항 수정 조건을 명시하는 것을 권장합니다.',
  }, null, 2);
}

async function handleCheckLegalDefinition(args: {
  law_name: string;
  term: string;
}): Promise<string> {
  const { law_name, term } = args;

  try {
    const apiResults = await api.searchLaws(law_name, 1);
    if (apiResults.length === 0) {
      return JSON.stringify({
        status: 'NOT_FOUND',
        warning: `"${law_name}" 법령을 찾을 수 없습니다.`,
      });
    }

    const lawDetail = await api.getLawDetail(apiResults[0].법령ID);
    if (!lawDetail) {
      return JSON.stringify({
        status: 'ERROR',
        warning: '법령 상세 정보를 가져올 수 없습니다.',
      });
    }

    // 제2조(정의) 조문 찾기
    const definitionArticle = lawDetail.조문.find(a => 
      a.조문제목?.includes('정의') || 
      a.조문번호.includes('제2조')
    );

    if (!definitionArticle) {
      return JSON.stringify({
        status: 'NO_DEFINITION_ARTICLE',
        message: `"${law_name}"에 정의 조항(제2조)이 없습니다.`,
      });
    }

    // 용어 검색
    const content = definitionArticle.조문내용;
    const termRegex = new RegExp(`["']?${term}["']?[은는이가]?\\s*[:]?\\s*([^.]+)`, 'gi');
    const match = content.match(termRegex);

    return JSON.stringify({
      status: match ? 'FOUND' : 'NOT_IN_DEFINITIONS',
      law_name: lawDetail.기본정보.법령명_한글,
      term: term,
      definition: match ? match[0] : null,
      full_definition_article: {
        article_number: definitionArticle.조문번호,
        title: definitionArticle.조문제목,
        content: definitionArticle.조문내용,
      },
      suggestion: !match 
        ? `"${term}"은 이 법령의 정의 조항에 명시되어 있지 않습니다. 일반적인 법적 해석이 적용될 수 있습니다.`
        : null,
      verification_note: '⚠️ 이 데이터는 AI 검증용입니다.',
    }, null, 2);
  } catch (error) {
    return JSON.stringify({
      status: 'ERROR',
      error: String(error),
    });
  }
}

// ============================================
// 새로운 핸들러: 관련법령 조회
// ============================================

async function handleGetRelatedLaws(args: {
  law_name: string;
  relation_type?: 'all' | 'upper' | 'lower' | 'enforcement';
}): Promise<string> {
  const { law_name, relation_type = 'all' } = args;

  try {
    // 먼저 법령 검색
    const apiResults = await api.searchLaws(law_name, 5);
    
    if (apiResults.length === 0) {
      return JSON.stringify({
        status: 'NOT_FOUND',
        warning: `"${law_name}" 법령을 찾을 수 없습니다.`,
      });
    }

    const mainLaw = apiResults[0];
    const lawType = mainLaw.법령구분명;
    
    // 법령 유형에 따른 위계 정보 생성
    const hierarchyInfo = determineLawHierarchy(lawType);
    
    // 관련 법령 검색 (법령명으로 시행령/시행규칙 검색)
    const relatedResults: any = {
      status: 'FOUND',
      main_law: {
        name: mainLaw.법령명한글,
        type: lawType,
        hierarchy_level: hierarchyInfo.level,
        hierarchy_description: hierarchyInfo.description,
        enforcement_date: mainLaw.시행일자,
        department: mainLaw.소관부처명,
        source_url: getLawGoKrLink(mainLaw.법령명한글),
      },
      related_laws: {
        upper: [] as any[],
        lower: [] as any[],
      },
    };

    // 하위법령 검색 (시행령/시행규칙)
    if (relation_type === 'all' || relation_type === 'lower' || relation_type === 'enforcement') {
      // 시행령 검색
      const enforcementDecree = await api.searchLaws(`${law_name} 시행령`, 5);
      for (const decree of enforcementDecree) {
        if (decree.법령명한글.includes('시행령')) {
          relatedResults.related_laws.lower.push({
            name: decree.법령명한글,
            type: decree.법령구분명,
            relation: '시행령 (하위법령)',
            enforcement_date: decree.시행일자,
            source_url: getLawGoKrLink(decree.법령명한글),
          });
        }
      }

      // 시행규칙 검색
      const enforcementRule = await api.searchLaws(`${law_name} 시행규칙`, 5);
      for (const rule of enforcementRule) {
        if (rule.법령명한글.includes('시행규칙')) {
          relatedResults.related_laws.lower.push({
            name: rule.법령명한글,
            type: rule.법령구분명,
            relation: '시행규칙 (하위법령)',
            enforcement_date: rule.시행일자,
            source_url: getLawGoKrLink(rule.법령명한글),
          });
        }
      }
    }

    // 상위법령 추론 (법령 유형에 따라)
    if (relation_type === 'all' || relation_type === 'upper') {
      if (lawType === '대통령령' || lawType === '시행령') {
        // 모법 추론 (시행령 -> 법률)
        const parentLawName = law_name.replace(/\s*시행령$/, '').replace(/에\s*관한/, '에 관한');
        if (parentLawName !== law_name) {
          const parentLaw = await api.searchLaws(parentLawName, 3);
          if (parentLaw.length > 0 && parentLaw[0].법령구분명 === '법률') {
            relatedResults.related_laws.upper.push({
              name: parentLaw[0].법령명한글,
              type: parentLaw[0].법령구분명,
              relation: '모법 (상위법령)',
              enforcement_date: parentLaw[0].시행일자,
              source_url: getLawGoKrLink(parentLaw[0].법령명한글),
              priority_note: '⚠️ 시행령이 모법(법률)과 충돌하면 법률이 우선합니다.',
            });
          }
        }
      }
      
      // 헌법은 항상 최상위
      if (lawType === '법률') {
        relatedResults.related_laws.upper.push({
          name: '대한민국헌법',
          type: '헌법',
          relation: '최상위 규범',
          source_url: getLawGoKrLink('대한민국헌법'),
          priority_note: '⚠️ 모든 법률은 헌법에 위배될 수 없습니다.',
        });
      }
    }

    relatedResults.hierarchy_principle = `
📚 법령 위계 원칙 (상위법 우선):
1. 헌법 (Constitution) - 최상위
2. 법률 (Act) - 국회 제정
3. 대통령령/시행령 (Presidential Decree)
4. 총리령/부령/시행규칙 (Ministerial Decree)
5. 행정규칙 (훈령, 예규, 고시) - 상위법을 거스를 수 없음

⚠️ 하위법령이 상위법령과 충돌하면 상위법령이 우선 적용됩니다.
`;

    relatedResults.verification_note = '⚠️ 이 데이터는 AI 검증용입니다.';

    return JSON.stringify(relatedResults, null, 2);
  } catch (error) {
    return JSON.stringify({
      status: 'ERROR',
      error: String(error),
    });
  }
}

// ============================================
// 새로운 핸들러: 법령 위계 비교
// ============================================

async function handleCheckLawHierarchy(args: {
  law_name_1: string;
  law_name_2: string;
}): Promise<string> {
  const { law_name_1, law_name_2 } = args;

  try {
    // 두 법령 검색
    const [law1Results, law2Results] = await Promise.all([
      api.searchLaws(law_name_1, 3),
      api.searchLaws(law_name_2, 3),
    ]);

    if (law1Results.length === 0) {
      return JSON.stringify({
        status: 'NOT_FOUND',
        warning: `"${law_name_1}" 법령을 찾을 수 없습니다.`,
      });
    }

    if (law2Results.length === 0) {
      return JSON.stringify({
        status: 'NOT_FOUND',
        warning: `"${law_name_2}" 법령을 찾을 수 없습니다.`,
      });
    }

    const law1 = law1Results[0];
    const law2 = law2Results[0];

    const hierarchy1 = determineLawHierarchy(law1.법령구분명);
    const hierarchy2 = determineLawHierarchy(law2.법령구분명);

    let comparison: string;
    let priority: string;
    let priorityReason: string;

    if (hierarchy1.level < hierarchy2.level) {
      priority = law1.법령명한글;
      priorityReason = '상위법 우선의 원칙 (Lex Superior)';
      comparison = `"${law1.법령명한글}"(${law1.법령구분명})이 "${law2.법령명한글}"(${law2.법령구분명})보다 상위 법령입니다.`;
    } else if (hierarchy1.level > hierarchy2.level) {
      priority = law2.법령명한글;
      priorityReason = '상위법 우선의 원칙 (Lex Superior)';
      comparison = `"${law2.법령명한글}"(${law2.법령구분명})이 "${law1.법령명한글}"(${law1.법령구분명})보다 상위 법령입니다.`;
    } else {
      // 같은 레벨일 경우 신법 우선 원칙 적용
      const date1 = law1.시행일자;
      const date2 = law2.시행일자;
      
      if (date1 > date2) {
        priority = law1.법령명한글;
        priorityReason = '신법 우선의 원칙 (Lex Posterior)';
        comparison = `동일 위계에서 "${law1.법령명한글}"이 더 최신입니다.`;
      } else if (date1 < date2) {
        priority = law2.법령명한글;
        priorityReason = '신법 우선의 원칙 (Lex Posterior)';
        comparison = `동일 위계에서 "${law2.법령명한글}"이 더 최신입니다.`;
      } else {
        priority = '동등';
        priorityReason = '특별법 우선의 원칙 (Lex Specialis) 검토 필요';
        comparison = `두 법령의 위계와 시행일이 동일합니다. 특별법-일반법 관계를 검토하세요.`;
      }
    }

    return JSON.stringify({
      status: 'COMPARED',
      law_1: {
        name: law1.법령명한글,
        type: law1.법령구분명,
        hierarchy_level: hierarchy1.level,
        hierarchy_name: hierarchy1.description,
        enforcement_date: law1.시행일자,
        source_url: getLawGoKrLink(law1.법령명한글),
      },
      law_2: {
        name: law2.법령명한글,
        type: law2.법령구분명,
        hierarchy_level: hierarchy2.level,
        hierarchy_name: hierarchy2.description,
        enforcement_date: law2.시행일자,
        source_url: getLawGoKrLink(law2.법령명한글),
      },
      comparison_result: {
        priority_law: priority,
        reason: priorityReason,
        explanation: comparison,
      },
      legal_principles: {
        lex_superior: '상위법 우선 - 헌법 > 법률 > 시행령 > 시행규칙 > 행정규칙',
        lex_posterior: '신법 우선 - 동일 위계에서 최신 법령 적용',
        lex_specialis: '특별법 우선 - 일반법보다 특별법 적용 (예: 민법 < 상법)',
      },
      verification_note: '⚠️ 이 데이터는 AI 검증용입니다. 복잡한 법률 충돌은 전문가 상담이 필요합니다.',
    }, null, 2);
  } catch (error) {
    return JSON.stringify({
      status: 'ERROR',
      error: String(error),
    });
  }
}

// ============================================
// 새로운 핸들러: 행정규칙 검색
// ============================================

async function handleSearchAdminRules(args: {
  query: string;
  limit?: number;
}): Promise<string> {
  const { query, limit = 20 } = args;

  try {
    const results = await extendedApi.searchAdminRules(query, limit);

    if (results.length === 0) {
      return JSON.stringify({
        status: 'NOT_FOUND',
        message: `"${query}"와 관련된 행정규칙을 찾을 수 없습니다.`,
      });
    }

    return JSON.stringify({
      status: 'FOUND',
      total_count: results.length,
      warning: `⚠️ 행정규칙(훈령, 예규, 고시)은 법적 구속력이 제한적입니다.
상위법(법률, 시행령)과 충돌하면 상위법이 우선 적용됩니다.
법원 판결은 행정규칙에 구속되지 않습니다.`,
      results: results.map(r => ({
        name: r.행정규칙명,
        type: r.행정규칙종류명,
        department: r.소관부처명,
        issue_date: r.발령일자,
        enforcement_date: r.시행일자,
        hierarchy_note: '행정규칙 (법령 위계 최하위)',
      })),
      verification_note: '⚠️ 이 데이터는 AI 검증용입니다.',
    }, null, 2);
  } catch (error) {
    return JSON.stringify({
      status: 'ERROR',
      error: String(error),
    });
  }
}

// ============================================
// 유틸리티: 법령 위계 판단
// ============================================

function determineLawHierarchy(lawType: string): { level: number; description: string } {
  const hierarchyMap: Record<string, { level: number; description: string }> = {
    '헌법': { level: 1, description: '최상위 규범 (Constitutional Law)' },
    '법률': { level: 2, description: '국회 제정 법률 (Act)' },
    '대통령령': { level: 3, description: '대통령령/시행령 (Presidential Decree)' },
    '시행령': { level: 3, description: '대통령령/시행령 (Presidential Decree)' },
    '총리령': { level: 4, description: '총리령 (Prime Ministerial Decree)' },
    '부령': { level: 4, description: '부령/시행규칙 (Ministerial Decree)' },
    '시행규칙': { level: 4, description: '부령/시행규칙 (Ministerial Decree)' },
    '조례': { level: 5, description: '자치법규 (Local Ordinance)' },
    '규칙': { level: 5, description: '자치규칙 (Local Rule)' },
  };

  return hierarchyMap[lawType] || { level: 6, description: '행정규칙/기타 (Administrative Rule)' };
}

// ============================================
// 유틸리티
// ============================================

function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.replace(/\s+/g, '').toLowerCase();
  const s2 = str2.replace(/\s+/g, '').toLowerCase();
  
  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;
  
  // 간단한 Jaccard 유사도
  const set1 = new Set(s1.split(''));
  const set2 = new Set(s2.split(''));
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  return intersection.size / union.size;
}

function formatDate(dateStr: string): string {
  // "20231209" -> "2023-12-09"
  if (dateStr.length === 8) {
    return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
  }
  return dateStr;
}

// ============================================
// MCP Server 초기화
// ============================================

export async function startMcpServer(): Promise<void> {
  const server = new Server(
    {
      name: 'korea-law',
      version: '1.1.0',
    },
    {
      capabilities: {
        tools: {},
        prompts: {},
      },
    }
  );

  // Tools 목록 제공
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  // Prompts 목록 제공
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: PROMPTS,
  }));

  // Prompt 상세 내용 제공
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name } = request.params;

    switch (name) {
      case 'legal-auditor':
        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: LEGAL_AUDITOR_PROMPT,
              },
            },
          ],
        };
      case 'legal-reasoning':
        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: LEGAL_REASONING_PROMPT,
              },
            },
          ],
        };
      default:
        throw new Error(`Unknown prompt: ${name}`);
    }
  });

  // Tool 실행
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result: string;

      switch (name) {
        case 'audit_statute':
          result = await handleAuditStatute(args as any);
          break;
        case 'check_enforcement_date':
          result = await handleCheckEnforcementDate(args as any);
          break;
        case 'verify_case_exists':
          result = await handleVerifyCaseExists(args as any);
          break;
        case 'get_daily_diff':
          result = await handleGetDailyDiff(args as any);
          break;
        case 'audit_contract_timeline':
          result = await handleAuditContractTimeline(args as any);
          break;
        case 'check_legal_definition':
          result = await handleCheckLegalDefinition(args as any);
          break;
        case 'get_related_laws':
          result = await handleGetRelatedLaws(args as any);
          break;
        case 'check_law_hierarchy':
          result = await handleCheckLawHierarchy(args as any);
          break;
        case 'search_admin_rules':
          result = await handleSearchAdminRules(args as any);
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return {
        content: [{ type: 'text', text: result }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error}` }],
        isError: true,
      };
    }
  });

  // 서버 시작
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  console.error('🏛️ korea-law MCP Server started');
  console.error('⚠️  주의: 이 서버는 AI 검증용입니다. 법적 판단의 최종 근거로 사용하지 마세요.');
}

