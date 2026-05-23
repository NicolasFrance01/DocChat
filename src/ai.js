'use strict';

const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('./db');

let groq;
let genAI;

function getGroq() {
  if (!groq) groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return groq;
}

function getGemini() {
  if (!genAI) genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return genAI;
}

// ─── Embeddings (Gemini text-embedding-004, 768 dims) ─────────────────────────

async function embedText(text) {
  const model = getGemini().getGenerativeModel({ model: 'embedding-001' });
  // Truncate to ~8000 chars to stay within token limits
  const truncated = text.slice(0, 8000);
  const result = await model.embedContent(truncated);
  return result.embedding.values; // number[]
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

// ─── RAG: embed → search → answer ────────────────────────────────────────────

const SYSTEM_PROMPT = `Eres un asistente especializado en analizar documentos.
Tu tarea es responder preguntas basándote EXCLUSIVAMENTE en los fragmentos de documentos proporcionados.

Reglas:
- Si la respuesta está en los fragmentos, responde con detalle y cita el documento.
- Si no está en los fragmentos, di claramente: "No encontré información sobre eso en los documentos cargados."
- Cuando cites información, menciona el nombre del documento y, si está disponible, el número de página.
- Responde siempre en el mismo idioma que la pregunta del usuario.
- Sé conciso pero completo.`;

async function chat({ notebookId, conversationId, userMessage, history = [] }) {
  // 1. Embed the user's question
  const queryEmbedding = await embedText(userMessage);

  // 2. Retrieve top-5 relevant chunks
  const relevantChunks = await db.searchChunks(notebookId, queryEmbedding, 5);

  if (relevantChunks.length === 0) {
    return {
      answer: 'No hay documentos cargados en este notebook, o aún no tienen embeddings. Por favor, sube un documento primero.',
      sources: [],
    };
  }

  // 3. Build context block from chunks
  const contextBlock = relevantChunks
    .map((c, i) => {
      const pageInfo = c.page_number ? ` (página ${c.page_number})` : '';
      return `[Fragmento ${i + 1} — ${c.document_name}${pageInfo}]\n${c.content}`;
    })
    .join('\n\n---\n\n');

  // 4. Build messages array: system + history (last 6 exchanges) + context + question
  const recentHistory = history.slice(-12); // max 6 user+assistant pairs
  const messages = [
    {
      role: 'user',
      content: `FRAGMENTOS RELEVANTES DE LOS DOCUMENTOS:\n\n${contextBlock}\n\n---\n\nPregunta: ${userMessage}`,
    },
  ];

  // Interleave history before the current message
  const fullMessages = [
    ...recentHistory.map(m => ({ role: m.role, content: m.content })),
    messages[0],
  ];

  // 5. Call Groq Llama 3.3 70B
  const completion = await getGroq().chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...fullMessages],
    temperature: 0.3,
    max_tokens: 1024,
  });

  const answer = completion.choices[0].message.content.trim();

  // 6. Build sources list for storage
  const sources = relevantChunks.map(c => ({
    chunk_id: c.id,
    document_name: c.document_name,
    page_number: c.page_number,
    excerpt: c.content.slice(0, 200),
    similarity: Math.round(c.similarity * 100) / 100,
  }));

  return { answer, sources };
}

// ─── Streaming version (SSE) ──────────────────────────────────────────────────

async function chatStream({ notebookId, userMessage, history = [], onChunk, onDone }) {
  const queryEmbedding = await embedText(userMessage);
  const relevantChunks = await db.searchChunks(notebookId, queryEmbedding, 5);

  if (relevantChunks.length === 0) {
    onChunk('No hay documentos cargados en este notebook. Por favor, sube un documento primero.');
    onDone([], '');
    return;
  }

  const contextBlock = relevantChunks
    .map((c, i) => {
      const pageInfo = c.page_number ? ` (página ${c.page_number})` : '';
      return `[Fragmento ${i + 1} — ${c.document_name}${pageInfo}]\n${c.content}`;
    })
    .join('\n\n---\n\n');

  const recentHistory = history.slice(-12);
  const currentMessage = {
    role: 'user',
    content: `FRAGMENTOS RELEVANTES DE LOS DOCUMENTOS:\n\n${contextBlock}\n\n---\n\nPregunta: ${userMessage}`,
  };

  const stream = await getGroq().chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...recentHistory.map(m => ({ role: m.role, content: m.content })),
      currentMessage,
    ],
    temperature: 0.3,
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
    excerpt: c.content.slice(0, 200),
    similarity: Math.round(c.similarity * 100) / 100,
  }));

  onDone(sources, fullAnswer);
}

module.exports = { embedText, embedChunks, chat, chatStream };
