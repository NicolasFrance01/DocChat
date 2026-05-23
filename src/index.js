'use strict';

require('dotenv').config();

const express = require('express');
const multer = require('multer');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const os = require('os');

const db = require('./db');
const { ingestFile, ingestUrl, detectType } = require('./ingest');
const { embedChunks, chatStream } = require('./ai');

const app = express();
app.use(express.json());

// CORS permisivo para desarrollo (Vercel frontend)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Token');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Multer: store uploads in OS temp dir (works on both Windows dev and Render/Linux prod)
const upload = multer({
  dest: path.join(os.tmpdir(), 'docchat_uploads'),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});

// ─── Auth middleware ───────────────────────────────────────────────────────────

async function requireAuth(req, res, next) {
  const token = req.headers['x-session-token'];
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  const session = await db.getSession(token);
  if (!session) return res.status(401).json({ error: 'Sesión inválida o expirada' });
  req.user = { id: session.user_id, username: session.username, role: session.role };
  next();
}

// ─── Health ────────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date() }));

// ─── Auth ──────────────────────────────────────────────────────────────────────

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Faltan campos' });

    const user = await db.getUserByUsername(username);
    if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Credenciales incorrectas' });

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    await db.createSession(token, user.id, expiresAt);

    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.get('/api/users/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  await db.deleteSession(req.headers['x-session-token']);
  res.json({ ok: true });
});

// ─── Notebooks ────────────────────────────────────────────────────────────────

app.get('/api/notebooks', requireAuth, async (req, res) => {
  try {
    const notebooks = await db.getNotebooksByUser(req.user.id);
    res.json({ notebooks });
  } catch (err) {
    console.error('[notebooks:list]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/notebooks', requireAuth, async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'El nombre es requerido' });
    const notebook = await db.createNotebook(req.user.id, name, description);
    res.status(201).json({ notebook });
  } catch (err) {
    console.error('[notebooks:create]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.delete('/api/notebooks/:id', requireAuth, async (req, res) => {
  try {
    const deleted = await db.deleteNotebook(Number(req.params.id), req.user.id);
    if (!deleted) return res.status(404).json({ error: 'Notebook no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[notebooks:delete]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── Documents ────────────────────────────────────────────────────────────────

app.get('/api/notebooks/:id/documents', requireAuth, async (req, res) => {
  try {
    const notebook = await db.getNotebookById(Number(req.params.id), req.user.id);
    if (!notebook) return res.status(404).json({ error: 'Notebook no encontrado' });
    const documents = await db.getDocumentsByNotebook(notebook.id);
    res.json({ documents });
  } catch (err) {
    console.error('[documents:list]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// Upload PDF / DOCX / TXT
app.post('/api/notebooks/:id/documents', requireAuth, upload.single('file'), async (req, res) => {
  const tmpPath = req.file?.path;
  try {
    const notebook = await db.getNotebookById(Number(req.params.id), req.user.id);
    if (!notebook) return res.status(404).json({ error: 'Notebook no encontrado' });
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });

    const type = detectType(req.file.originalname);
    if (!type) return res.status(400).json({ error: 'Formato no soportado (pdf, docx, txt, md)' });

    // Extract text + split into chunks
    const { rawText, chunks } = await ingestFile(tmpPath, type);
    if (chunks.length === 0) return res.status(422).json({ error: 'No se pudo extraer texto del archivo' });

    // Save document record
    const doc = await db.createDocument(notebook.id, req.file.originalname, type, req.file.originalname, rawText);

    // Generate embeddings and store chunks (async, respond 202 immediately to avoid timeout)
    res.status(202).json({ document: doc, message: 'Procesando embeddings en segundo plano…' });

    // Continue in background
    embedAndStore(doc.id, chunks).catch(err => console.error('[ingest:embed]', err));
  } catch (err) {
    console.error('[documents:upload]', err);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Error interno' });
  } finally {
    if (tmpPath) fs.unlink(tmpPath, () => {});
  }
});

// Ingest from URL
app.post('/api/notebooks/:id/documents/url', requireAuth, async (req, res) => {
  try {
    const notebook = await db.getNotebookById(Number(req.params.id), req.user.id);
    if (!notebook) return res.status(404).json({ error: 'Notebook no encontrado' });
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL requerida' });

    const { rawText, chunks, title } = await ingestUrl(url);
    if (chunks.length === 0) return res.status(422).json({ error: 'No se pudo extraer texto de la URL' });

    const name = title || url;
    const doc = await db.createDocument(notebook.id, name, 'url', url, rawText);

    res.status(202).json({ document: doc, message: 'Procesando embeddings en segundo plano…' });
    embedAndStore(doc.id, chunks).catch(err => console.error('[ingest:embed:url]', err));
  } catch (err) {
    console.error('[documents:url]', err);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Error interno' });
  }
});

app.delete('/api/documents/:id', requireAuth, async (req, res) => {
  try {
    const doc = await db.getDocumentById(Number(req.params.id));
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });
    // Verify ownership via notebook
    const notebook = await db.getNotebookById(doc.notebook_id, req.user.id);
    if (!notebook) return res.status(403).json({ error: 'Sin permiso' });

    await db.deleteDocument(doc.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[documents:delete]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// Background: embed chunks and persist
async function embedAndStore(documentId, rawChunks) {
  const chunksWithEmbeddings = await embedChunks(rawChunks);
  const rows = chunksWithEmbeddings.map(c => ({
    documentId,
    content: c.content,
    embedding: c.embedding,
    chunkIndex: c.chunkIndex,
    pageNumber: c.pageNumber ?? null,
  }));
  await db.insertChunks(rows);
  await db.updateDocumentChunkCount(documentId, rows.length);
  console.log(`[ingest] Document ${documentId}: ${rows.length} chunks stored`);
}

// ─── Conversations ────────────────────────────────────────────────────────────

app.get('/api/notebooks/:id/conversations', requireAuth, async (req, res) => {
  try {
    const notebook = await db.getNotebookById(Number(req.params.id), req.user.id);
    if (!notebook) return res.status(404).json({ error: 'Notebook no encontrado' });
    const conversations = await db.getConversationsByNotebook(notebook.id, req.user.id);
    res.json({ conversations });
  } catch (err) {
    console.error('[conversations:list]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.get('/api/conversations/:id/messages', requireAuth, async (req, res) => {
  try {
    const conv = await db.getConversationById(Number(req.params.id), req.user.id);
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });
    const messages = await db.getMessagesByConversation(conv.id);
    res.json({ messages });
  } catch (err) {
    console.error('[messages:list]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── Chat (SSE streaming) ─────────────────────────────────────────────────────

app.post('/api/notebooks/:id/chat', requireAuth, async (req, res) => {
  try {
    const notebook = await db.getNotebookById(Number(req.params.id), req.user.id);
    if (!notebook) return res.status(404).json({ error: 'Notebook no encontrado' });

    const { message, conversation_id } = req.body;
    if (!message) return res.status(400).json({ error: 'Mensaje requerido' });

    // Get or create conversation
    let conversation;
    if (conversation_id) {
      conversation = await db.getConversationById(conversation_id, req.user.id);
      if (!conversation) return res.status(404).json({ error: 'Conversación no encontrada' });
    } else {
      conversation = await db.createConversation(notebook.id, req.user.id, message.slice(0, 80));
    }

    // Load recent history for context
    const history = await db.getMessagesByConversation(conversation.id, 12);

    // Save user message
    await db.saveMessage(conversation.id, 'user', message);

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Send conversation_id first so client can track it
    res.write(`data: ${JSON.stringify({ type: 'meta', conversation_id: conversation.id })}\n\n`);

    let fullAnswer = '';
    let finalSources = [];

    await chatStream({
      notebookId: notebook.id,
      userMessage: message,
      history,
      onChunk: (delta) => {
        res.write(`data: ${JSON.stringify({ type: 'delta', content: delta })}\n\n`);
      },
      onDone: async (sources, answer) => {
        fullAnswer = answer;
        finalSources = sources;
      },
    });

    // Save assistant message
    await db.saveMessage(conversation.id, 'assistant', fullAnswer, finalSources);

    // Send final event with sources
    res.write(`data: ${JSON.stringify({ type: 'done', sources: finalSources })}\n\n`);
    res.end();
  } catch (err) {
    console.error('[chat]', err);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Error interno' });
    else {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      res.end();
    }
  }
});

// ─── Keep-alive (Render free tier: suspende a los 15 min sin tráfico) ────────
// Ping propio cada 13m35s para mantenerse activo sin gastar el límite de 15m.
const KEEP_ALIVE_MS = 13 * 60 * 1000 + 35 * 1000; // 815 000 ms

function startKeepAlive(port) {
  // En Render, RENDER_EXTERNAL_URL = "https://tu-app.onrender.com"
  // En local, no existe → usamos localhost (el ping no hace daño)
  const base = process.env.RENDER_EXTERNAL_URL
    ? process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '')
    : `http://localhost:${port}`;

  setInterval(async () => {
    try {
      const res = await fetch(`${base}/health`);
      console.log(`[keep-alive] ping ${base}/health → ${res.status}`);
    } catch (err) {
      console.warn('[keep-alive] ping falló:', err.message);
    }
  }, KEEP_ALIVE_MS);

  console.log(`[keep-alive] activo — ping cada 13m35s a ${base}/health`);
}

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

db.initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[server] DocChat running on port ${PORT}`);
      startKeepAlive(PORT);
    });
    // Clean expired sessions every hour
    setInterval(
      () => db.cleanExpiredSessions().then(n => n > 0 && console.log(`[cron] ${n} sesiones expiradas eliminadas`)),
      60 * 60 * 1000
    );
  })
  .catch(err => {
    console.error('[startup] DB init failed:', err);
    process.exit(1);
  });
