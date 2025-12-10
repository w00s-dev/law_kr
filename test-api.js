// 국가법령정보센터 API 테스트
require('dotenv').config({ path: './korea-law/.env' });
const axios = require('axios');

async function testLawAPI() {
  const apiKey = process.env.LAW_API_KEY || process.env.KOREA_LAW_API_KEY;

  console.log('🔑 API Key:', apiKey ? `${apiKey.substring(0, 10)}...` : 'NOT FOUND');

  if (!apiKey) {
    console.error('❌ API 키가 설정되지 않았습니다!');
    console.log('   .env 파일을 확인해주세요.');
    process.exit(1);
  }

  try {
    console.log('\n📡 법령정보 API 테스트 중...');

    // 국가법령정보센터 API 엔드포인트
    const url = 'http://www.law.go.kr/DRF/lawSearch.do';
    const params = {
      OC: apiKey,
      target: 'law',
      type: 'XML',
      query: '민법', // 테스트용 검색어
      display: 5
    };

    const response = await axios.get(url, {
      params,
      timeout: 10000
    });

    console.log('✅ API 응답 성공!');
    console.log('📊 상태 코드:', response.status);
    console.log('📄 응답 길이:', response.data.length, 'bytes');

    // XML 응답에서 에러 체크
    if (response.data.includes('<errMsg>')) {
      const errMatch = response.data.match(/<errMsg>(.*?)<\/errMsg>/);
      if (errMatch) {
        console.error('❌ API 에러:', errMatch[1]);
        console.log('\n💡 API 키를 다시 확인해주세요:');
        console.log('   https://www.data.go.kr/iim/main/mypageMain.do');
        process.exit(1);
      }
    }

    // 성공 확인
    if (response.data.includes('<law>') || response.data.includes('<Law>')) {
      console.log('✅ API 키가 정상 작동합니다!');
      console.log('\n🎉 korea-law MCP 서버를 사용할 준비가 되었습니다!');
    } else {
      console.log('⚠️  응답은 받았지만 법령 데이터가 없습니다.');
      console.log('   응답 미리보기:', response.data.substring(0, 200));
    }

  } catch (error) {
    console.error('❌ API 테스트 실패:', error.message);

    if (error.code === 'ENOTFOUND') {
      console.log('\n💡 인터넷 연결을 확인해주세요.');
    } else if (error.response) {
      console.log('   HTTP 상태:', error.response.status);
      console.log('   응답:', error.response.data.substring(0, 200));
    }

    console.log('\n💡 다음을 확인해주세요:');
    console.log('   1. API 키가 올바른지 확인');
    console.log('   2. 공공데이터포털에서 서비스 활용신청 승인 여부');
    console.log('   3. https://www.data.go.kr/iim/main/mypageMain.do');

    process.exit(1);
  }
}

testLawAPI();
