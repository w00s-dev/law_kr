#!/usr/bin/env node

/**
 * 국가법령정보센터 API 연결 테스트
 */

const axios = require('axios');

// API 키 우선순위: 환경변수 > 기본값(sapphire_5 - 공공데이터포털 샘플키)
// ⚠️ 실제 서비스에서는 본인 API 키를 환경변수로 설정하세요
const API_KEY = process.env.KOREA_LAW_API_KEY || process.env.LAW_API_KEY || 'sapphire_5';
const BASE_URL = 'http://www.law.go.kr/DRF';

async function testAPI() {
  console.log('🔍 API 연결 테스트 시작...');
  console.log(`📝 API 키: ${API_KEY ? `${API_KEY.substring(0, 5)}***` : '없음'}`);

  if (!API_KEY) {
    console.error('❌ API 키가 설정되지 않았습니다!');
    console.error('   .env 파일에 KOREA_LAW_API_KEY 또는 LAW_API_KEY를 설정하세요.');
    process.exit(1);
  }

  try {
    // 테스트 1: 법령 목록 조회 (근로기준법 검색)
    console.log('\n[테스트 1] 법령 검색: 근로기준법');
    const searchUrl = `${BASE_URL}/lawSearch.do`;
    const searchParams = {
      OC: API_KEY,
      target: 'law',
      query: '근로기준법',
      display: 5,
      type: 'XML'
    };

    const searchResponse = await axios.get(searchUrl, {
      params: searchParams,
      timeout: 10000
    });

    console.log(`   상태 코드: ${searchResponse.status}`);
    console.log(`   응답 길이: ${searchResponse.data.length} bytes`);

    // XML 응답 일부 출력
    const preview = searchResponse.data.substring(0, 500);
    console.log('\n📄 응답 미리보기:');
    console.log(preview.replace(/\n/g, '\n   '));

    // HTML 응답 체크 (API 실패시 HTML 에러 페이지 반환)
    if (searchResponse.data.includes('<!DOCTYPE html') || searchResponse.data.includes('<html')) {
      console.error('\n❌ API 호출 실패: HTML 페이지가 반환되었습니다.');
      
      // 미신청 에러 체크
      if (searchResponse.data.includes('미신청된 목록/본문에 대한 접근입니다')) {
        console.error('\n💡 원인: OPEN API 서비스 신청이 필요합니다!');
        console.error('   1. https://open.law.go.kr/LSO/main.do 에 로그인');
        console.error('   2. [OPEN API] → [OPEN API 신청] 메뉴 이동');
        console.error('   3. API를 선택하고 법령종류 체크 필요');
      }
      process.exit(1);
    }

    // XML 에러 메시지 체크
    if (searchResponse.data.includes('<errMsg>')) {
      const errorMatch = searchResponse.data.match(/<errMsg>(.*?)<\/errMsg>/);
      if (errorMatch) {
        console.error(`\n❌ API 에러: ${errorMatch[1]}`);
        process.exit(1);
      }
    }

    // XML 형식 검증 (LawSearch 태그 확인)
    if (!searchResponse.data.includes('<LawSearch>') && !searchResponse.data.includes('<?xml')) {
      console.error('\n❌ 유효한 XML 응답이 아닙니다.');
      process.exit(1);
    }

    console.log('\n✅ API 응답 수신 성공!');
    console.log('✅ 모든 테스트 통과!');
    console.log('   국가법령정보센터 API 연결이 정상적으로 작동합니다.');

  } catch (error) {
    console.error('\n❌ API 연결 실패:');
    if (error.response) {
      console.error(`   상태 코드: ${error.response.status}`);
      console.error(`   응답: ${error.response.data}`);
    } else if (error.request) {
      console.error('   요청은 전송되었으나 응답을 받지 못했습니다.');
      console.error(`   ${error.message}`);
    } else {
      console.error(`   ${error.message}`);
    }
    process.exit(1);
  }
}

testAPI();
