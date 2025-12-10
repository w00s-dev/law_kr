/**
 * korea-law: Supabase Edge Function
 * 
 * audit-statute - 법령 조문 검증 API
 * 
 * ⚠️ 중요: 이 API는 AI 검증용입니다.
 * 법적 효력의 최종 판단은 국가법령정보센터(law.go.kr)를 참조하세요.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AuditRequest {
  law_name: string;
  article_number: string;
  target_date?: string;
  expected_content?: string;
}

serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body: AuditRequest = await req.json();
    const { law_name, article_number, target_date, expected_content } = body;

    if (!law_name || !article_number) {
      return new Response(
        JSON.stringify({ error: 'law_name and article_number are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const targetDateStr = target_date || new Date().toISOString().split('T')[0];

    // 법령 검색
    const { data: laws, error: lawError } = await supabase
      .from('laws')
      .select('*')
      .ilike('law_name', `%${law_name}%`)
      .lte('enforcement_date', targetDateStr)
      .eq('status', 'ACTIVE')
      .order('enforcement_date', { ascending: false })
      .limit(1);

    if (lawError || !laws || laws.length === 0) {
      return new Response(
        JSON.stringify({
          status: 'NOT_FOUND',
          warning: `⚠️ "${law_name}" 법령을 찾을 수 없습니다.`,
          verification_note: '⚠️ 이 데이터는 AI 검증용입니다.',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const law = laws[0];

    // 조문 검색
    const normalizedArticleNo = article_number.replace(/제|조/g, '').trim();
    const { data: articles, error: articleError } = await supabase
      .from('articles')
      .select('*')
      .eq('law_id', law.id)
      .or(`article_no.ilike.%${article_number}%,article_no_normalized.eq.${normalizedArticleNo}`)
      .is('effective_until', null)
      .limit(1);

    if (articleError || !articles || articles.length === 0) {
      return new Response(
        JSON.stringify({
          status: 'ARTICLE_NOT_FOUND',
          warning: `⚠️ "${law_name}"에서 ${article_number}를 찾을 수 없습니다.`,
          law_name: law.law_name,
          verification_note: '⚠️ 이 데이터는 AI 검증용입니다.',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const article = articles[0];

    // 결과 생성
    const result: any = {
      status: 'FOUND',
      law_name: law.law_name,
      article_number: article.article_no,
      article_title: article.article_title,
      content: article.content,
      enforcement_date: law.enforcement_date,
      promulgation_date: law.promulgation_date,
      verification_note: '⚠️ 이 데이터는 AI 검증용입니다. 법적 판단의 최종 근거는 국가법령정보센터(law.go.kr)를 참조하세요.',
    };

    // expected_content가 있으면 비교
    if (expected_content) {
      const similarity = calculateSimilarity(expected_content, article.content);
      result.comparison = {
        expected: expected_content,
        actual: article.content,
        similarity_score: similarity,
        match_status: similarity > 0.8 ? 'MATCH' : similarity > 0.5 ? 'PARTIAL_MATCH' : 'MISMATCH',
      };

      if (similarity < 0.8) {
        result.warning = `⚠️ AI가 인용한 내용과 실제 조문이 다릅니다! (유사도: ${(similarity * 100).toFixed(1)}%)`;
      }
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.replace(/\s+/g, '').toLowerCase();
  const s2 = str2.replace(/\s+/g, '').toLowerCase();
  
  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;
  
  const set1 = new Set(s1.split(''));
  const set2 = new Set(s2.split(''));
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  return intersection.size / union.size;
}

