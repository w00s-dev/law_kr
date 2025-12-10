#!/usr/bin/env node
/**
 * 근로기준법 데이터 동기화 스크립트
 * Korea Law API에서 근로기준법(법령명칭: 근로기준법)을 가져와 SQLite DB에 저장
 */

const sqlite3 = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const API_KEY = process.env.KOREA_LAW_API_KEY || 'theqwe2000';
const DB_PATH = path.join(__dirname, 'data', 'korea-law.db');

// 데이터 디렉토리 확인
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  console.log(`Creating data directory: ${dataDir}`);
  fs.mkdirSync(dataDir, { recursive: true });
}

console.log(`Database path: ${DB_PATH}`);

// 데이터베이스 연결
const db = sqlite3(DB_PATH);

async function fetchLawData(lawName) {
  const url = `https://www.law.go.kr/DRF/lawSearch.do?OC=${API_KEY}&target=law&type=XML&query=${encodeURIComponent(lawName)}`;

  console.log(`📡 Fetching ${lawName}...`);
  console.log(`URL: ${url}`);

  const response = await fetch(url);
  const text = await response.text();

  return text;
}

async function fetchLawDetail(lawId) {
  const url = `https://www.law.go.kr/DRF/lawService.do?OC=${API_KEY}&target=law&type=XML&MST=${lawId}`;

  console.log(`📡 Fetching law detail for ${lawId}...`);

  const response = await fetch(url);
  const text = await response.text();

  return text;
}

function parseXMLField(xml, fieldName) {
  const regex = new RegExp(`<${fieldName}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${fieldName}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

function parseXMLSimpleField(xml, fieldName) {
  const regex = new RegExp(`<${fieldName}>([^<]*)</${fieldName}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

function parseArticles(content) {
  const articles = [];

  // 조문 파싱 (제N조, 제N조의N 등)
  const articleRegex = /제(\d+(?:의\d+)?조(?:의\d+)?)\s*\(([^)]+)\)([\s\S]*?)(?=제\d+(?:의\d+)?조(?:의\d+)?\s*\(|$)/g;

  let match;
  let articleNumber = 1;

  while ((match = articleRegex.exec(content)) !== null) {
    const [, number, title, articleContent] = match;

    articles.push({
      article_number: number,
      title: title.trim(),
      content: articleContent.trim(),
      order_index: articleNumber++
    });
  }

  return articles;
}

async function syncLaborLaw() {
  try {
    console.log('🚀 Starting Labor Standards Act sync...\n');

    // 1. 근로기준법 검색
    const searchResult = await fetchLawData('근로기준법');

    const lawId = parseXMLSimpleField(searchResult, '법령ID');
    const lawName = parseXMLField(searchResult, '법령명한글');
    const promulgationDate = parseXMLSimpleField(searchResult, '공포일자');
    const enforcementDate = parseXMLSimpleField(searchResult, '시행일자');

    if (!lawId) {
      console.error('❌ Failed to find 근로기준법');
      return;
    }

    console.log(`✅ Found law: ${lawName} (ID: ${lawId})`);
    console.log(`   Promulgation: ${promulgationDate}`);
    console.log(`   Enforcement: ${enforcementDate}\n`);

    // 2. 법령 상세 정보 가져오기
    const detailResult = await fetchLawDetail(lawId);
    const content = parseXMLField(detailResult, '조문내용');

    if (!content) {
      console.error('❌ Failed to fetch law content');
      return;
    }

    console.log(`✅ Fetched law content (${content.length} characters)\n`);

    // 3. 법령 저장
    const insertLaw = db.prepare(`
      INSERT OR REPLACE INTO Laws (
        law_id, law_name, category, promulgation_date,
        enforcement_date, full_text, last_updated
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    insertLaw.run(
      lawId,
      lawName,
      '노동법',
      promulgationDate,
      enforcementDate,
      content,
      new Date().toISOString()
    );

    console.log(`✅ Saved law to database\n`);

    // 4. 조문 파싱 및 저장
    const articles = parseArticles(content);

    if (articles.length === 0) {
      console.warn('⚠️  No articles parsed - trying alternative parsing...');

      // 대안 파싱: 단순히 "제N조"로 분리
      const simpleArticles = content.split(/(?=제\d+조)/);
      let order = 1;

      for (const articleText of simpleArticles) {
        if (!articleText.trim()) continue;

        const numberMatch = articleText.match(/제(\d+조(?:의\d+)?)/);
        const titleMatch = articleText.match(/\(([^)]+)\)/);

        if (numberMatch) {
          articles.push({
            article_number: numberMatch[1],
            title: titleMatch ? titleMatch[1] : '',
            content: articleText.trim(),
            order_index: order++
          });
        }
      }
    }

    console.log(`✅ Parsed ${articles.length} articles\n`);

    const insertArticle = db.prepare(`
      INSERT OR REPLACE INTO Articles (
        law_id, article_number, title, content, order_index
      ) VALUES (?, ?, ?, ?, ?)
    `);

    for (const article of articles.slice(0, 10)) {
      insertArticle.run(
        lawId,
        article.article_number,
        article.title,
        article.content,
        article.order_index
      );

      console.log(`   ✓ ${article.article_number}: ${article.title}`);
    }

    if (articles.length > 10) {
      console.log(`   ... and ${articles.length - 10} more articles`);

      for (const article of articles.slice(10)) {
        insertArticle.run(
          lawId,
          article.article_number,
          article.title,
          article.content,
          article.order_index
        );
      }
    }

    console.log(`\n✅ Successfully synced 근로기준법!`);
    console.log(`   Total articles: ${articles.length}`);

    // 5. 데이터 검증
    const lawCount = db.prepare('SELECT COUNT(*) as count FROM Laws').get();
    const articleCount = db.prepare('SELECT COUNT(*) as count FROM Articles').get();

    console.log(`\n📊 Database Statistics:`);
    console.log(`   Laws: ${lawCount.count}`);
    console.log(`   Articles: ${articleCount.count}`);

  } catch (error) {
    console.error('❌ Error during sync:', error.message);
    console.error(error);
  } finally {
    db.close();
  }
}

// 실행
syncLaborLaw();
