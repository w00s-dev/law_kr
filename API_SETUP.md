# 국가법령정보 Open API 설정 가이드

## 현재 문제
```
미신청된 목록/본문에 대한 접근입니다.
OPEN API 로그인 후 [OPEN API] -> [OPEN API 신청] -> 등록된 API 선택 후 법령종류를 체크해 주세요.
```

API 키는 있지만 **법령 검색 권한**이 없는 상태입니다.

---

## 해결 방법

### 1️⃣ 공공데이터포털 접속
https://www.data.go.kr

### 2️⃣ 로그인 후 마이페이지
- 우측 상단 로그인
- 마이페이지 → **개발계정** 클릭

### 3️⃣ Open API 활용신청 목록 확인
- "국가법령정보 법령" 또는 "법령 Open API" 찾기
- 상태: **승인** 확인

### 4️⃣ 법령종류 체크 (중요!)
- API 상세보기 클릭
- **법령종류 선택**란에서 다음 체크:
  - ✅ 법률
  - ✅ 대통령령 (시행령)
  - ✅ 총리령/부령 (시행규칙)
  - ✅ 자치법규
  - ✅ 조약/규칙

### 5️⃣ 재신청 또는 수정
- 변경사항 저장
- 승인까지 **최대 1-2시간** 소요

---

## 대안: 국가법령정보센터 직접 신청

### Open API 포털 (권장)
https://open.law.go.kr

1. 회원가입 및 로그인
2. **[OPEN API]** 메뉴 클릭
3. **[OPEN API 신청]** 클릭
4. 신청서 작성:
   - API 종류: **법령 검색, 법령 본문**
   - 활용 목적: AI 법률 검증 시스템
   - 활용 분야: 법률 서비스
5. 승인 후 API 키 발급

---

## API 키 테스트

### 방법 1: curl 명령어
```bash
curl "http://www.law.go.kr/DRF/lawSearch.do?OC=YOUR_API_KEY&target=law&type=XML&query=민법"
```

### 방법 2: 테스트 스크립트
```bash
cd /Users/seunghan/law/korea-law
KOREA_LAW_API_KEY=YOUR_API_KEY node dist/cli.js search "근로기준법"
```

---

## 문의처
- 법제처 공동활용 유지보수팀: **02-2109-6446**
- 이메일: open@moleg.go.kr

---

## 임시 해결책

API 승인 대기 중일 때는 수동으로 법령 데이터를 입력하거나,
법제처 웹사이트에서 직접 법령 본문을 복사해서 사용할 수 있습니다.

```bash
# 테스트 데이터로 MCP 서버 검증
npm run test:mock
```
