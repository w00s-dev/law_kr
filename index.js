/**
 * law-kr - Korean Law Library (KR)
 * 
 * 이 패키지는 korea-law의 wrapper입니다.
 * 모든 기능은 korea-law에서 제공됩니다.
 * 
 * @see https://www.npmjs.com/package/korea-law
 */

// korea-law의 모든 기능을 re-export
module.exports = require('korea-law');

// 패키지 메타 정보
module.exports.packageName = 'law-kr';
module.exports.mainPackage = 'korea-law';
