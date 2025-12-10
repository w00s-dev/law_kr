/**
 * korea-law: Supabase Edge Function
 * 
 * daily-diff - 오늘의 법령 변경 사항 API
 * 
 * ⚠️ 중요: 이 API는 AI 검증용입니다.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DiffRequest {
  date?: string;
  category?: string;
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

    let body: DiffRequest = {};
    try {
      body = await req.json();
    } catch {
      // GET 요청 등으로 body가 없을 수 있음
    }

    const { date, category } = body;
    const targetDate = date || new Date().toISOString().split('T')[0];

    // 변경 사항 조회 (View 사용)
    let query = supabase
      .from('today_diffs')
      .select('*')
      .eq('detected_at', targetDate)
      .order('is_critical', { ascending: false });

    const { data: diffs, error } = await query;

    if (error) {
      throw error;
    }

    // 카테고리 필터링
    let filteredDiffs = diffs || [];
    if (category && filteredDiffs.length > 0) {
      filteredDiffs = filteredDiffs.filter((d: any) => 
        d.law_name?.includes(category) || 
        d.diff_summary?.includes(category)
      );
    }

    if (filteredDiffs.length === 0) {
      return new Response(
        JSON.stringify({
          status: 'NO_CHANGES',
          message: '해당 날짜에 변경된 법령이 없습니다.',
          date: targetDate,
          verification_note: '⚠️ 이 데이터는 AI 검증용입니다.',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const result = {
      status: 'FOUND',
      date: targetDate,
      total_changes: filteredDiffs.length,
      changes: filteredDiffs.map((d: any) => ({
        law_name: d.law_name,
        article: d.article_no,
        article_title: d.article_title,
        change_type: d.change_type,
        summary: d.diff_summary,
        is_critical: d.is_critical,
        warning: d.warning_message,
        effective_from: d.effective_from,
      })),
      verification_note: '⚠️ 이 데이터는 AI 검증용입니다.',
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

