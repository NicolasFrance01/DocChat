'use strict';

const fs = require('fs');
const path = require('path');

// ─── Text extraction ──────────────────────────────────────────────────────────

async function extractFromPdf(filePath) {
  const pdfParse = require('pdf-parse');
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  // data.text has all pages concatenated; data.numpages for reference
  return { text: data.text, pageCount: data.numpages };
}

async function extractFromTxt(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return { text, pageCount: null };
}

async function extractFromDocx(filePath) {
  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ path: filePath });
  return { text: result.value, pageCount: null };
}

async function extractFromUrl(url) {
  const cheerio = require('cheerio');
  // Dynamic import for node-fetch compatibility across Node versions
  const { default: fetch } = await import('node-fetch').catch(() => {
    // node 18+ has native fetch
    return { default: globalThis.fetch };
  });

  const res = await fetch(url, {
    headers: { 'User-Agent': 'DocChat/1.0 (+https://github.com/NicolasFrance01/DocChat)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  // Remove boilerplate
  $('script, style, nav, footer, header, aside, [role="banner"], [role="navigation"]').remove();

  const title = $('title').text().trim() || url;
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  return { text, title, pageCount: null };
}

// ─── Chunking ─────────────────────────────────────────────────────────────────

const CHUNK_SIZE = 500;   // approximate tokens (1 token ≈ 4 chars)
const CHUNK_OVERLAP = 50;
const CHARS_PER_TOKEN = 4;

function splitIntoPages(text) {
  const pageRegex = /--- PAGE_BREAK_P_(\d+) ---/g;
  const pages = [];
  let match;
  let lastIndex = 0;
  let currentPageNum = null;

  while ((match = pageRegex.exec(text)) !== null) {
    const matchIndex = match.index;
    
    // Slice text preceding this page break
    if (matchIndex > lastIndex) {
      const segment = text.slice(lastIndex, matchIndex).trim();
      if (segment) {
        pages.push({ pageNumber: currentPageNum, text: segment });
      }
    }
    
    currentPageNum = parseInt(match[1], 10);
    lastIndex = pageRegex.lastIndex;
  }

  // Append remaining text
  if (lastIndex < text.length) {
    const segment = text.slice(lastIndex).trim();
    if (segment) {
      pages.push({ pageNumber: currentPageNum, text: segment });
    }
  }

  if (pages.length === 0) {
    pages.push({ pageNumber: null, text: text });
  }
  return pages;
}

function chunkText(text) {
  const pages = splitIntoPages(text);
  const chunks = [];

  const chunkChars = CHUNK_SIZE * CHARS_PER_TOKEN;       // 2000 chars
  const overlapChars = CHUNK_OVERLAP * CHARS_PER_TOKEN;  // 200 chars

  for (const page of pages) {
    const pageText = page.text;
    const pageNum = page.pageNumber;
    let start = 0;

    while (start < pageText.length) {
      let end = start + chunkChars;

      // Try to break at a sentence boundary within the last 20% of the chunk
      if (end < pageText.length) {
        const searchFrom = end - Math.floor(chunkChars * 0.2);
        const sentenceEnd = pageText.lastIndexOf('.', end);
        if (sentenceEnd > searchFrom) end = sentenceEnd + 1;
      } else {
        end = pageText.length;
      }

      const sliced = pageText.slice(start, end).trim();
      if (sliced.length > 0) {
        const content = (' ' + sliced).slice(1);
        chunks.push({ 
          content, 
          chunkIndex: chunks.length, 
          pageNumber: pageNum 
        });
      }

      if (end >= pageText.length) {
        break;
      }

      start = end - overlapChars;
      if (start <= 0) break; // safety
    }
  }

  return chunks;
}


// ─── Main ingest pipeline ─────────────────────────────────────────────────────

async function ingestFile(filePath, type) {
  let extracted;
  switch (type) {
    case 'pdf':  extracted = await extractFromPdf(filePath);  break;
    case 'docx': extracted = await extractFromDocx(filePath); break;
    case 'txt':  extracted = await extractFromTxt(filePath);  break;
    default:     throw new Error(`Unsupported file type: ${type}`);
  }

  const cleanText = extracted.text.replace(/\0/g, '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const chunks = chunkText(cleanText);
  return { rawText: cleanText, chunks, pageCount: extracted.pageCount };
}

async function ingestUrl(url) {
  const extracted = await extractFromUrl(url);
  const cleanText = extracted.text.replace(/\0/g, '').replace(/\s+/g, ' ').trim();
  const chunks = chunkText(cleanText);
  return { rawText: cleanText, chunks, title: extracted.title, pageCount: null };
}

// Detect file type from original filename
function detectType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = { '.pdf': 'pdf', '.docx': 'docx', '.doc': 'docx', '.txt': 'txt', '.md': 'txt' };
  return map[ext] || null;
}

module.exports = { ingestFile, ingestUrl, detectType, chunkText };
