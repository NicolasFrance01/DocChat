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

  // Pre-create tables and columns needed by index creation inside schema.sql
  await pool.query(`
    CREATE TABLE IF NOT EXISTS folders (
      id          SERIAL PRIMARY KEY,
      notebook_id INTEGER NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
      parent_id   INTEGER REFERENCES folders(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(notebook_id, parent_id, name)
    );
  `).catch(() => {});
  await pool.query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL;`).catch(() => {});

  await pool.query(schema);

  // Apply explicit migrations for existing tables to ensure backward compatibility
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name TEXT;`).catch(() => {});
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed BOOLEAN NOT NULL DEFAULT FALSE;`).catch(() => {});
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';`).catch(() => {});
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES messages(id) ON DELETE CASCADE;`).catch(() => {});
  await pool.query(`ALTER TABLE notebooks ADD COLUMN IF NOT EXISTS ai_assistant_enabled BOOLEAN NOT NULL DEFAULT FALSE;`).catch(() => {});
  await pool.query(`ALTER TABLE notebooks ADD COLUMN IF NOT EXISTS document_order INTEGER[] DEFAULT '{}';`).catch(() => {});


  // Seed admin if not exists
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  // Migrate old 'admin' username to new '@admin' format if present
  await pool.query("UPDATE users SET username = '@admin' WHERE username = 'admin';").catch(() => {});

  // Force seed admin to have password_changed = TRUE and active status to prevent accidental 48h history suspensions
  await pool.query("UPDATE users SET password_changed = TRUE, status = 'active' WHERE username = '@admin';").catch(() => {});

  const existing = await pool.query('SELECT id FROM users WHERE username = $1', ['@admin']);
  if (existing.rowCount === 0) {
    const hash = await bcrypt.hash(adminPassword, 10);
    await pool.query(
      "INSERT INTO users (username, password_hash, role, full_name, password_changed) VALUES ($1, $2, 'admin', 'Administrador', TRUE)",
      ['@admin', hash]
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
  const { rows } = await pool.query('SELECT id, username, full_name, role, password_changed, status, created_at FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

async function getUsers() {
  const { rows } = await pool.query(
    'SELECT id, username, full_name, role, password_changed, status, created_at FROM users ORDER BY created_at DESC'
  );
  return rows;
}

async function createUser(username, passwordHash, role = 'user', fullName = null) {
  const { rows } = await pool.query(
    'INSERT INTO users (username, password_hash, role, full_name, password_changed) VALUES ($1, $2, $3, $4, FALSE) RETURNING id, username, full_name, role, created_at',
    [username, passwordHash, role, fullName]
  );
  return rows[0];
}

async function deleteUser(id) {
  const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [id]);
  return rowCount > 0;
}

async function updateUserRole(id, role) {
  const { rows } = await pool.query(
    'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, username, role',
    [role, id]
  );
  return rows[0] || null;
}

async function updateUserPassword(id, passwordHash) {
  const { rowCount } = await pool.query(
    "UPDATE users SET password_hash = $1, password_changed = TRUE, status = 'active' WHERE id = $2",
    [passwordHash, id]
  );
  return rowCount > 0;
}

async function resetUserPassword(id, passwordHash) {
  const { rowCount } = await pool.query(
    "UPDATE users SET password_hash = $1, password_changed = FALSE, status = 'active', created_at = NOW() WHERE id = $2",
    [passwordHash, id]
  );
  return rowCount > 0;
}

async function updateUserStatus(id, status) {
  await pool.query('UPDATE users SET status = $1 WHERE id = $2', [status, id]);
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
    `SELECT s.*, u.username, u.full_name, u.role, u.status, u.password_changed, u.created_at AS user_created_at
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

async function getNotebooksByUser(userId, role = 'user') {
  if (role === 'admin') {
    const { rows } = await pool.query(
      `SELECT n.*, COUNT(d.id)::int AS document_count
       FROM notebooks n
       LEFT JOIN documents d ON d.notebook_id = n.id
       GROUP BY n.id
       ORDER BY n.created_at DESC`
    );
    return rows;
  }

  const { rows } = await pool.query(
    `SELECT n.*, COUNT(d.id)::int AS document_count
     FROM notebooks n
     LEFT JOIN documents d ON d.notebook_id = n.id
     LEFT JOIN notebook_users nu ON nu.notebook_id = n.id
     WHERE n.user_id = $1 OR nu.user_id = $1
     GROUP BY n.id
     ORDER BY n.created_at DESC`,
    [userId]
  );
  return rows;
}

async function getNotebookById(id, userId, role = 'user') {
  if (role === 'admin') {
    const { rows } = await pool.query('SELECT * FROM notebooks WHERE id = $1', [id]);
    return rows[0] || null;
  }
  const { rows } = await pool.query(
    `SELECT DISTINCT n.* FROM notebooks n
     LEFT JOIN notebook_users nu ON nu.notebook_id = n.id
     WHERE n.id = $1 AND (n.user_id = $2 OR nu.user_id = $2)`,
    [id, userId]
  );
  return rows[0] || null;
}

async function createNotebook(userId, name, description = null, aiAssistantEnabled = false) {
  const { rows } = await pool.query(
    'INSERT INTO notebooks (user_id, name, description, ai_assistant_enabled) VALUES ($1, $2, $3, $4) RETURNING *',
    [userId, name, description, aiAssistantEnabled]
  );

  return rows[0];
}

async function deleteNotebook(id, userId) {
  // If user is admin, allow deletion directly
  const user = await getUserById(userId);
  if (user && user.role === 'admin') {
    const { rowCount } = await pool.query('DELETE FROM notebooks WHERE id = $1', [id]);
    return rowCount > 0;
  }

  const { rowCount } = await pool.query(
    'DELETE FROM notebooks WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return rowCount > 0;
}

// ─── Control de Acceso por Notebook (ACL) ────────────────────────────────────

async function getNotebookUsers(notebookId) {
  const { rows } = await pool.query(
    `SELECT nu.user_id, nu.role, u.username, u.full_name
     FROM notebook_users nu
     JOIN users u ON u.id = nu.user_id
     WHERE nu.notebook_id = $1
     ORDER BY nu.created_at DESC`,
    [notebookId]
  );
  return rows;
}

async function addNotebookUser(notebookId, userId, role = 'user') {
  await pool.query(
    `INSERT INTO notebook_users (notebook_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (notebook_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [notebookId, userId, role]
  );
}

async function removeNotebookUser(notebookId, userId) {
  const { rowCount } = await pool.query(
    'DELETE FROM notebook_users WHERE notebook_id = $1 AND user_id = $2',
    [notebookId, userId]
  );
  return rowCount > 0;
}

// ─── Invitaciones a Notebooks ───────────────────────────────────────────────

async function createNotebookInvitation(notebookId, role = 'user', expiresAt = null) {
  const { v4: uuidv4 } = require('uuid');
  const token = uuidv4();
  await pool.query(
    'INSERT INTO notebook_invitations (token, notebook_id, role, expires_at) VALUES ($1, $2, $3, $4)',
    [token, notebookId, role, expiresAt]
  );
  return token;
}

async function getNotebookInvitation(token) {
  const { rows } = await pool.query(
    `SELECT * FROM notebook_invitations 
     WHERE token = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
    [token]
  );
  return rows[0] || null;
}

async function claimNotebookInvitation(token, userId) {
  const invite = await getNotebookInvitation(token);
  if (!invite) throw new Error('Enlace de invitación inválido o expirado');

  await addNotebookUser(invite.notebook_id, userId, invite.role);
  return invite.notebook_id;
}

// ─── Auditoría de Actividad ──────────────────────────────────────────────────

async function logActivity(userId, username, action, notebookId, notebookName, documentId = null, documentName = null, details = null) {
  await pool.query(
    `INSERT INTO activity_logs (user_id, username, action, notebook_id, notebook_name, document_id, document_name, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [userId, username, action, notebookId, notebookName, documentId, documentName, details]
  );
}

async function getActivityLogs() {
  const { rows } = await pool.query(
    'SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 100'
  );
  return rows;
}

// ─── Documents ────────────────────────────────────────────────────────────────

async function getDocumentsByNotebook(notebookId) {
  const { rows } = await pool.query(
    'SELECT id, notebook_id, folder_id, name, type, source, chunk_count, sort_order, created_at FROM documents WHERE notebook_id = $1 ORDER BY sort_order ASC, created_at DESC',
    [notebookId]
  );
  return rows;
}

async function getDocumentById(id) {
  const { rows } = await pool.query('SELECT * FROM documents WHERE id = $1', [id]);
  return rows[0] || null;
}

async function createDocument(notebookId, name, type, source, rawText, folderId = null) {
  const { rows } = await pool.query(
    'INSERT INTO documents (notebook_id, folder_id, name, type, source, raw_text) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [notebookId, folderId, name, type, source, rawText]
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

async function insertChunks(chunks) {
  if (chunks.length === 0) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const c of chunks) {
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

async function searchChunks(notebookId, queryEmbedding, topK = 5, documentIds = null) {
  const embStr = `[${queryEmbedding.join(',')}]`;
  let query = `
     SELECT dc.id, dc.document_id, dc.content, dc.chunk_index, dc.page_number,
            d.name AS document_name, d.folder_id,
            1 - (dc.embedding <=> $1::vector) AS similarity
     FROM document_chunks dc
     JOIN documents d ON d.id = dc.document_id
     WHERE d.notebook_id = $2
       AND dc.embedding IS NOT NULL
  `;
  const params = [embStr, notebookId];

  if (Array.isArray(documentIds) && documentIds.length > 0) {
    params.push(documentIds);
    query += ` AND dc.document_id = ANY($${params.length})`;
  }

  query += ` ORDER BY dc.embedding <=> $1::vector LIMIT $${params.length + 1}`;
  params.push(topK);

  const { rows } = await pool.query(query, params);
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

async function updateConversationTitle(conversationId, title) {
  await pool.query(
    'UPDATE conversations SET title = $1 WHERE id = $2',
    [title, conversationId]
  );
}

// ─── Messages ─────────────────────────────────────────────────────────────────

async function getMessagesByConversation(conversationId, limit = 100) {
  const { rows } = await pool.query(
    `SELECT * FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC
     LIMIT $2`,
    [conversationId, limit]
  );
  return rows; // Return directly in ascending order
}

async function saveMessage(conversationId, role, content, parentId = null, sources = null) {
  const { rows } = await pool.query(
    'INSERT INTO messages (conversation_id, role, content, parent_id, sources) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [conversationId, role, content, parentId, sources ? JSON.stringify(sources) : null]
  );
  return rows[0];
}

// ─── Folders ──────────────────────────────────────────────────────────────────

async function getFoldersByNotebook(notebookId) {
  const { rows } = await pool.query(
    'SELECT id, notebook_id, parent_id, name, sort_order, created_at FROM folders WHERE notebook_id = $1 ORDER BY sort_order ASC, name ASC',
    [notebookId]
  );
  return rows;
}

async function getFolderById(id) {
  const { rows } = await pool.query('SELECT * FROM folders WHERE id = $1', [id]);
  return rows[0] || null;
}

async function createFolder(notebookId, name, parentId = null) {
  const { rows } = await pool.query(
    'INSERT INTO folders (notebook_id, name, parent_id) VALUES ($1, $2, $3) RETURNING *',
    [notebookId, name, parentId]
  );
  return rows[0];
}

async function deleteFolder(id) {
  const { rowCount } = await pool.query('DELETE FROM folders WHERE id = $1', [id]);
  return rowCount > 0;
}

async function moveDocumentToFolder(docId, folderId) {
  const { rows } = await pool.query(
    'UPDATE documents SET folder_id = $1 WHERE id = $2 RETURNING *',
    [folderId, docId]
  );
  return rows[0] || null;
}

async function moveFolderToParent(folderId, parentId) {
  if (parentId !== null) {
    let currentId = parentId;
    const visited = new Set();
    while (currentId) {
      if (currentId === folderId) {
        throw new Error('No se puede mover una carpeta dentro de sí misma o de sus subcarpetas');
      }
      if (visited.has(currentId)) break;
      visited.add(currentId);
      const { rows } = await pool.query('SELECT parent_id FROM folders WHERE id = $1', [currentId]);
      if (rows.length === 0) break;
      currentId = rows[0].parent_id;
    }
  }

  const { rows } = await pool.query(
    'UPDATE folders SET parent_id = $1 WHERE id = $2 RETURNING *',
    [parentId, folderId]
  );
  return rows[0] || null;
}

async function getFolderPath(folderId) {
  if (!folderId) return '';
  const pathSegments = [];
  let currentId = folderId;
  const visited = new Set();
  
  while (currentId) {
    if (visited.has(currentId)) break;
    visited.add(currentId);
    
    const { rows } = await pool.query('SELECT name, parent_id FROM folders WHERE id = $1', [currentId]);
    if (rows.length === 0) break;
    
    pathSegments.unshift(rows[0].name);
    currentId = rows[0].parent_id;
  }
  
  return pathSegments.join(' / ');
}

module.exports = {
  pool,
  initDb,
  // users
  getUserByUsername,
  getUserById,
  getUsers,
  createUser,
  deleteUser,
  updateUserRole,
  updateUserPassword,
  resetUserPassword,
  updateUserStatus,
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
  updateNotebook,
  // notebook ACL & sharing
  getNotebookUsers,
  addNotebookUser,
  removeNotebookUser,
  // notebook invitations
  createNotebookInvitation,
  getNotebookInvitation,
  claimNotebookInvitation,
  // activity logging
  logActivity,
  getActivityLogs,
  // folders
  getFoldersByNotebook,
  getFolderById,
  createFolder,
  deleteFolder,
  moveDocumentToFolder,
  moveFolderToParent,
  getFolderPath,
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
  updateConversationTitle,
  // messages
  getMessagesByConversation,
  saveMessage,
  // learning methods
  getNotebookProgress,
  updateDocumentRead,
  updateDocumentQuizPassed,
  getQuizByDocument,
  saveQuizForDocument,
  getFinalExam,
  saveFinalExam,
  updateNotebookDocumentOrder,
  updateTreeOrder,
};

async function getNotebookProgress(notebookId, userId) {
  const { rows } = await pool.query(
    `SELECT d.id AS document_id, 
            COALESCE(p.read_checked, FALSE) AS read_checked, 
            COALESCE(p.quiz_passed, FALSE) AS quiz_passed, 
            p.score, 
            p.completed_at
     FROM documents d
     LEFT JOIN user_document_progress p ON p.document_id = d.id AND p.user_id = $2
     WHERE d.notebook_id = $1`,
    [notebookId, userId]
  );
  return rows;
}

async function updateDocumentRead(userId, docId, checked) {
  await pool.query(
    `INSERT INTO user_document_progress (user_id, document_id, read_checked)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, document_id) 
     DO UPDATE SET read_checked = EXCLUDED.read_checked`,
    [userId, docId, checked]
  );
}

async function updateDocumentQuizPassed(userId, docId, score) {
  await pool.query(
    `INSERT INTO user_document_progress (user_id, document_id, read_checked, quiz_passed, score, completed_at)
     VALUES ($1, $2, TRUE, TRUE, $3, NOW())
     ON CONFLICT (user_id, document_id) 
     DO UPDATE SET quiz_passed = TRUE, score = EXCLUDED.score, completed_at = NOW()`,
    [userId, docId, score]
  );
}

async function getQuizByDocument(docId) {
  const { rows } = await pool.query('SELECT * FROM document_quizzes WHERE document_id = $1', [docId]);
  return rows[0] || null;
}

async function saveQuizForDocument(docId, questions) {
  await pool.query(
    `INSERT INTO document_quizzes (document_id, questions)
     VALUES ($1, $2)
     ON CONFLICT (document_id) DO UPDATE SET questions = EXCLUDED.questions`,
    [docId, JSON.stringify(questions)]
  );
}

async function getFinalExam(userId, notebookId) {
  const { rows } = await pool.query(
    'SELECT * FROM user_final_exams WHERE user_id = $1 AND notebook_id = $2',
    [userId, notebookId]
  );
  return rows[0] || null;
}

async function saveFinalExam(userId, notebookId, passed, score, questions) {
  await pool.query(
    `INSERT INTO user_final_exams (user_id, notebook_id, passed, score, questions, completed_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (user_id, notebook_id) 
     DO UPDATE SET passed = EXCLUDED.passed, score = EXCLUDED.score, questions = EXCLUDED.questions, completed_at = NOW()`,
    [userId, notebookId, passed, score, JSON.stringify(questions)]
  );
}

async function updateNotebookDocumentOrder(notebookId, order) {
  await pool.query(
    'UPDATE notebooks SET document_order = $1 WHERE id = $2',
    [order, notebookId]
  );
}

async function updateTreeOrder(notebookId, items, documentOrderArray) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    for (const item of items) {
      if (item.type === 'folder') {
        await client.query(
          'UPDATE folders SET parent_id = $1, sort_order = $2 WHERE id = $3 AND notebook_id = $4',
          [item.parentId, item.sortOrder, item.id, notebookId]
        );
      } else if (item.type === 'document') {
        await client.query(
          'UPDATE documents SET folder_id = $1, sort_order = $2 WHERE id = $3 AND notebook_id = $4',
          [item.parentId, item.sortOrder, item.id, notebookId]
        );
      }
    }

    if (documentOrderArray) {
      await client.query(
        'UPDATE notebooks SET document_order = $1 WHERE id = $2',
        [documentOrderArray, notebookId]
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

async function updateNotebook(id, name, description, aiAssistantEnabled) {
  const { rows } = await pool.query(
    'UPDATE notebooks SET name = $1, description = $2, ai_assistant_enabled = $3 WHERE id = $4 RETURNING *',
    [name, description, aiAssistantEnabled, id]
  );
  return rows[0] || null;
}


