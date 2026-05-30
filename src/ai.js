'use strict';

const Groq = require('groq-sdk');
const db = require('./db');

let groq;

function getGroq() {
  if (!groq) groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return groq;
}

// ─── Embeddings (Gemini text-embedding-004, 768 dims) ─────────────────────────

async function embedText(text) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY no configurada');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`;
  const truncated = text.slice(0, 8000);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: "models/gemini-embedding-001",
      content: {
        parts: [{ text: truncated }]
      },
      outputDimensionality: 768
    }),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error?.message || `Error en la API de Gemini: ${res.status}`);
  }

  const data = await res.json();
  if (!data.embedding || !data.embedding.values) {
    throw new Error('Formato de respuesta de embedding de Gemini inesperado');
  }

  return data.embedding.values; // number[]
}

// Embed many chunks; Gemini free tier allows ~1500 req/min, so no batching needed at this scale
async function embedChunks(chunks) {
  const results = [];
  for (const chunk of chunks) {
    const embedding = await embedText(chunk.content);
    results.push({ ...chunk, embedding });
  }
  return results;
}

// ─── System prompts ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT_RAG = `Eres un asistente inteligente. Tenés acceso a fragmentos de documentos del usuario.

Reglas:
- Respondé principalmente usando los fragmentos proporcionados.
- Si la respuesta está en los fragmentos, citá el documento y la página si está disponible.
- Si la pregunta es general o no tiene que ver con los documentos, respondé igual con tu conocimiento.
- Respondé siempre en el mismo idioma que la pregunta del usuario.
- Sé conciso pero completo.`;

const SYSTEM_PROMPT_FREE = `Eres un asistente inteligente y conversacional.
Respondé siempre en el mismo idioma que el usuario. Sé conciso pero completo.`;

function buildUserContent(userMessage, relevantChunks) {
  if (relevantChunks.length === 0) return userMessage;
  const contextBlock = relevantChunks
    .map((c, i) => {
      const pageInfo = c.page_number ? ` (página ${c.page_number})` : '';
      return `[Fragmento ${i + 1} — ${c.document_name}${pageInfo}]\n${c.content}`;
    })
    .join('\n\n---\n\n');
  return `FRAGMENTOS RELEVANTES DE LOS DOCUMENTOS:\n\n${contextBlock}\n\n---\n\nPregunta: ${userMessage}`;
}

async function generateConversationTitle(userMessage, assistantResponse) {
  try {
    const prompt = `Genera un título extremadamente corto, conciso y amigable (máximo 4 palabras y en una sola línea, sin comillas ni aclaraciones) en español para una conversación que comienza con esta pregunta: "${userMessage.slice(0, 100)}" y tiene esta respuesta inicial: "${assistantResponse.slice(0, 150)}..."`;
    const completion = await getGroq().chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 30,
    });
    return completion.choices[0].message.content.trim().replace(/^["']|["']$/g, '');
  } catch (err) {
    console.error('[generateTitle] failed:', err);
    return userMessage.slice(0, 40) + '...';
  }
}

async function chat({ notebookId, userMessage, history = [], documentIds = null }) {
  const recentHistory = history.slice(-12);

  // Try RAG only if there are documents with embeddings
  let relevantChunks = [];
  try {
    const queryEmbedding = await embedText(userMessage);
    relevantChunks = await db.searchChunks(notebookId, queryEmbedding, 5, documentIds);
  } catch { /* no embeddings available — fall through to free mode */ }

  const systemPrompt = relevantChunks.length > 0 ? SYSTEM_PROMPT_RAG : SYSTEM_PROMPT_FREE;
  const userContent = buildUserContent(userMessage, relevantChunks);

  const completion = await getGroq().chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: systemPrompt },
      ...recentHistory.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: userContent },
    ],
    temperature: 0.5,
    max_tokens: 1024,
  });

  const answer = completion.choices[0].message.content.trim();
  const sources = relevantChunks.map(c => ({
    chunk_id: c.id,
    document_name: c.document_name,
    page_number: c.page_number,
    excerpt: c.content, // Return full content for premium interactive citations
    similarity: Math.round(c.similarity * 100) / 100,
  }));

  return { answer, sources };
}

// ─── Streaming version (SSE) ──────────────────────────────────────────────────

async function chatStream({ notebookId, userMessage, history = [], documentIds = null, onChunk, onDone }) {
  const recentHistory = history.slice(-12);

  let relevantChunks = [];
  try {
    const queryEmbedding = await embedText(userMessage);
    relevantChunks = await db.searchChunks(notebookId, queryEmbedding, 5, documentIds);
  } catch { /* fall through to free mode */ }

  const systemPrompt = relevantChunks.length > 0 ? SYSTEM_PROMPT_RAG : SYSTEM_PROMPT_FREE;
  const userContent = buildUserContent(userMessage, relevantChunks);

  const stream = await getGroq().chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: systemPrompt },
      ...recentHistory.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: userContent },
    ],
    temperature: 0.5,
    max_tokens: 1024,
    stream: true,
  });

  let fullAnswer = '';
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content || '';
    if (delta) {
      fullAnswer += delta;
      onChunk(delta);
    }
  }

  const sources = relevantChunks.map(c => ({
    chunk_id: c.id,
    document_name: c.document_name,
    page_number: c.page_number,
    excerpt: c.content, // Return full content for premium interactive citations
    similarity: Math.round(c.similarity * 100) / 100,
  }));

  onDone(sources, fullAnswer);
}

module.exports = { embedText, embedChunks, chat, chatStream, generateConversationTitle };

