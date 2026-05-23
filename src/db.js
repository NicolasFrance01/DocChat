'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
});

// Run at startup: apply schema migrations and seed admin user
async function initDb() {
  const fs = require('fs');
  const path = require('path');
  const bcrypt = require('bcrypt');

  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  await pool.query(schema);

  // Seed admin if not exists
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  const existing = await pool.query('SELECT id FROM users WHERE username = $1', ['admin']);
  if (existing.rowCount === 0) {
    const hash = await bcrypt.hash(adminPassword, 10);
    await pool.query(
      "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'admin')",
      ['admin', hash]
    );
    console.log('[db] Admin user created');
  }
}

// ─── Users ────────────────────────────────────────────────────────────────────

async function getUserByUsername(username) {
  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  return rows[0] || null;
}

async function getUserById(id) {
  const { rows } = await pool.query('SELECT id, username, role, created_at FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

async function createUser(username, passwordHash, role = 'user') {
  const { rows } = await pool.query(
    'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role, created_at',
    [username, passwordHash, role]
  );
  return rows[0];
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

async function createSession(token, userId, expiresAt) {
  await pool.query(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)',
    [token, userId, expiresAt]
  );
}

async function getSession(token) {
  const { rows } = await pool.query(
    `SELECT s.*, u.username, u.role
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > NOW()`,
    [token]
  );
  return rows[0] || null;
}

async function deleteSession(token) {
  await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
}

async function cleanExpiredSessions() {
  const { rowCount } = await pool.query('DELETE FROM sessions WHERE expires_at <= NOW()');
  return rowCount;
}

// ─── Notebooks ────────────────────────────────────────────────────────────────

async function getNotebooksByUser(userId) {
  const { rows } = await pool.query(
    `SELECT n.*, COUNT(d.id)::int AS document_count
     FROM notebooks n
     LEFT JOIN documents d ON d.notebook_id = n.id
     WHERE n.user_id = $1
     GROUP BY n.id
     ORDER BY n.created_at DESC`,
    [userId]
  );
  return rows;
}

async function getNotebookById(id, userId) {
  const { rows } = await pool.query(
    'SELECT * FROM notebooks WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return rows[0] || null;
}

async function createNotebook(userId, name, description = null) {
  const { rows } = await pool.query(
    'INSERT INTO notebooks (user_id, name, description) VALUES ($1, $2, $3) RETURNING *',
    [userId, name, description]
  );
  return rows[0];
}

async function deleteNotebook(id, userId) {
  const { rowCount } = await pool.query(
    'DELETE FROM notebooks WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return rowCount > 0;
}

// ─── Documents ────────────────────────────────────────────────────────────────

async function getDocumentsByNotebook(notebookId) {
  const { rows } = await pool.query(
    'SELECT id, notebook_id, name, type, source, chunk_count, created_at FROM documents WHERE notebook_id = $1 ORDER BY created_at DESC',
    [notebookId]
  );
  return rows;
}

async function getDocumentById(id) {
  const { rows } = await pool.query('SELECT * FROM documents WHERE id = $1', [id]);
  return rows[0] || null;
}

async function createDocument(notebookId, name, type, source, rawText) {
  const { rows } = await pool.query(
    'INSERT INTO documents (notebook_id, name, type, source, raw_text) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [notebookId, name, type, source, rawText]
  );
  return rows[0];
}

async function updateDocumentChunkCount(id, count) {
  await pool.query('UPDATE documents SET chunk_count = $1 WHERE id = $2', [count, id]);
}

async function deleteDocument(id) {
  const { rowCount } = await pool.query('DELETE FROM documents WHERE id = $1', [id]);
  return rowCount > 0;
}

// ─── Document chunks ──────────────────────────────────────────────────────────

// Insert many chunks in a single transaction
async function insertChunks(chunks) {
  // chunks: [{documentId, content, embedding: number[], chunkIndex, pageNumber}]
  if (chunks.length === 0) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const c of chunks) {
      // pgvector expects the vector as a string '[n1,n2,...]' or a JS array
      const embStr = `[${c.embedding.join(',')}]`;
      await client.query(
        `INSERT INTO document_chunks (document_id, content, embedding, chunk_index, page_number)
         VALUES ($1, $2, $3::vector, $4, $5)`,
        [c.documentId, c.content, embStr, c.chunkIndex, c.pageNumber ?? null]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Cosine similarity search — returns top-k chunks across all documents in a notebook
async function searchChunks(notebookId, queryEmbedding, topK = 5) {
  const embStr = `[${queryEmbedding.join(',')}]`;
  const { rows } = await pool.query(
    `SELECT dc.id, dc.document_id, dc.content, dc.chunk_index, dc.page_number,
            d.name AS document_name,
            1 - (dc.embedding <=> $1::vector) AS similarity
     FROM document_chunks dc
     JOIN documents d ON d.id = dc.document_id
     WHERE d.notebook_id = $2
       AND dc.embedding IS NOT NULL
     ORDER BY dc.embedding <=> $1::vector
     LIMIT $3`,
    [embStr, notebookId, topK]
  );
  return rows;
}

async function deleteChunksByDocument(documentId) {
  await pool.query('DELETE FROM document_chunks WHERE document_id = $1', [documentId]);
}

// ─── Conversations ────────────────────────────────────────────────────────────

async function getConversationsByNotebook(notebookId, userId) {
  const { rows } = await pool.query(
    `SELECT c.*, COUNT(m.id)::int AS message_count
     FROM conversations c
     LEFT JOIN messages m ON m.conversation_id = c.id
     WHERE c.notebook_id = $1 AND c.user_id = $2
     GROUP BY c.id
     ORDER BY c.created_at DESC`,
    [notebookId, userId]
  );
  return rows;
}

async function getConversationById(id, userId) {
  const { rows } = await pool.query(
    'SELECT * FROM conversations WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return rows[0] || null;
}

async function createConversation(notebookId, userId, title = null) {
  const { rows } = await pool.query(
    'INSERT INTO conversations (notebook_id, user_id, title) VALUES ($1, $2, $3) RETURNING *',
    [notebookId, userId, title]
  );
  return rows[0];
}

// ─── Messages ─────────────────────────────────────────────────────────────────

async function getMessagesByConversation(conversationId, limit = 20) {
  const { rows } = await pool.query(
    `SELECT * FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [conversationId, limit]
  );
  return rows.reverse(); // chronological order
}

async function saveMessage(conversationId, role, content, sources = null) {
  const { rows } = await pool.query(
    'INSERT INTO messages (conversation_id, role, content, sources) VALUES ($1, $2, $3, $4) RETURNING *',
    [conversationId, role, content, sources ? JSON.stringify(sources) : null]
  );
  return rows[0];
}

module.exports = {
  pool,
  initDb,
  // users
  getUserByUsername,
  getUserById,
  createUser,
  // sessions
  createSession,
  getSession,
  deleteSession,
  cleanExpiredSessions,
  // notebooks
  getNotebooksByUser,
  getNotebookById,
  createNotebook,
  deleteNotebook,
  // documents
  getDocumentsByNotebook,
  getDocumentById,
  createDocument,
  updateDocumentChunkCount,
  deleteDocument,
  // chunks
  insertChunks,
  searchChunks,
  deleteChunksByDocument,
  // conversations
  getConversationsByNotebook,
  getConversationById,
  createConversation,
  // messages
  getMessagesByConversation,
  saveMessage,
};
