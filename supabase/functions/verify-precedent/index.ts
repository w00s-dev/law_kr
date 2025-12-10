/**
 * korea-law: Supabase Edge Function
 * 
 * verify-precedent - 판례 존재 여부 확인 API
 * 
 * ⚠️ 중요: 이 API는 AI 검증용입니다.
 * AI가 가짜 판례를 생성했는지 확인합니다.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface VerifyRequest {
  case_id: string;
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

    const body: VerifyRequest = await req.json();
    const { case_id } = body;

    if (!case_id) {
      return new Response(
        JSON.stringify({ error: 'case_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 사건번호 정규화
    const normalized = case_id.replace(/\s+/g, '').replace(/[^\w가-힣]/g, '');

    // 판례 검색
    const { data: precedents, error } = await supabase
      .from('precedents')
      .select('*')
      .or(`case_id.eq.${case_id},case_id_normalized.eq.${normalized}`)
      .limit(1);

    if (error) {
      throw error;
    }

    const exists = precedents && precedents.length > 0;
    const precedent = exists ? precedents[0] : null;

    const result = {
      status: exists ? 'VERIFIED' : 'NOT_FOUND',
      case_id: case_id,
      exists: exists,
      ...(exists && {
        court: precedent.court,
        case_type: precedent.case_type,
        decision_date: precedent.decision_date,
        case_name: precedent.case_name,
      }),
      warning: !exists 
        ? `⚠️ 주의: "${case_id}" 판례를 찾을 수 없습니다. AI가 가짜 판례를 생성했을 수 있습니다!`
        : null,
      verification_note: '⚠️ 판례 존재 여부만 확인됨. 상세 내용은 대법원 판례정보에서 확인하세요.',
    };

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

