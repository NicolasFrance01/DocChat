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
const { ingestFile, ingestUrl, detectType, chunkText } = require('./ingest');
const { embedText, chatStream } = require('./ai');

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

  // Check 48h password safety suspension
  const hrs = (Date.now() - new Date(session.user_created_at).getTime()) / (1000 * 60 * 60);
  let status = session.status;
  if (status !== 'suspended' && !session.password_changed && hrs > 48) {
    await db.updateUserStatus(session.user_id, 'suspended');
    status = 'suspended';
  }

  if (status === 'suspended') {
    return res.status(403).json({ error: 'Cuenta suspendida por políticas de seguridad (falta de cambio de contraseña inicial dentro de las 48hs). Por favor contacte al administrador.' });
  }

  req.user = { 
    id: session.user_id, 
    username: session.username, 
    full_name: session.full_name,
    role: session.role,
    password_changed: session.password_changed,
    user_created_at: session.user_created_at
  };
  next();
}

// ─── Health ────────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date() }));

// ─── Auth ──────────────────────────────────────────────────────────────────────

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Faltan campos' });

    const cleanUsername = username.startsWith('@') ? username : `@${username}`;
    const user = await db.getUserByUsername(cleanUsername);
    if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' });

    // Check suspension BEFORE login!
    const hrs = (Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60);
    let status = user.status;
    if (status !== 'suspended' && !user.password_changed && hrs > 48) {
      await db.updateUserStatus(user.id, 'suspended');
      status = 'suspended';
    }

    if (status === 'suspended') {
      return res.status(403).json({ error: 'Cuenta suspendida por políticas de seguridad (falta de cambio de contraseña inicial dentro de las 48hs). Por favor contacte al administrador.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Credenciales incorrectas' });

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    await db.createSession(token, user.id, expiresAt);

    res.json({ token, user: { id: user.id, username: user.username, role: user.role, full_name: user.full_name, password_changed: user.password_changed } });
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
    const notebooks = await db.getNotebooksByUser(req.user.id, req.user.role);
    res.json({ notebooks });
  } catch (err) {
    console.error('[notebooks:list]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/notebooks', requireAuth, async (req, res) => {
  try {
    const { name, description, ai_assistant_enabled } = req.body;
    if (!name) return res.status(400).json({ error: 'El nombre es requerido' });
    
    // Non-admin and non-creator cannot create notebooks
    if (req.user.role !== 'admin' && req.user.role !== 'creator') {
      return res.status(403).json({ error: 'No tienes permisos para crear notebooks' });
    }

    const notebook = await db.createNotebook(req.user.id, name, description, !!ai_assistant_enabled);
    await db.logActivity(req.user.id, req.user.username, 'create_notebook', notebook.id, notebook.name, null, null, `Notebook "${name}" creado`);

    res.status(201).json({ notebook });

  } catch (err) {
    console.error('[notebooks:create]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.delete('/api/notebooks/:id', requireAuth, async (req, res) => {
  try {
    const notebookId = Number(req.params.id);
    const notebook = await db.getNotebookById(notebookId, req.user.id, req.user.role);
    if (!notebook) return res.status(404).json({ error: 'Notebook no encontrado' });

    // Non-admin and non-creator (unless owner) cannot delete
    if (req.user.role !== 'admin' && notebook.user_id !== req.user.id) {
      return res.status(403).json({ error: 'No tienes permisos para eliminar este notebook' });
    }

    const deleted = await db.deleteNotebook(notebookId, req.user.id);
    if (!deleted) return res.status(404).json({ error: 'Notebook no encontrado' });

    await db.logActivity(req.user.id, req.user.username, 'delete_notebook', notebookId, notebook.name, null, null, `Notebook "${notebook.name}" eliminado`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[notebooks:delete]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});


// Helper to check if a user has creator/write permission on a notebook
async function hasCreatorPermission(notebook, user) {
  if (user.role === 'admin') return true;
  if (notebook.user_id === user.id) return true;
  const acl = await db.getNotebookUsers(notebook.id);
  const userAcl = acl.find(a => a.user_id === user.id);
  return userAcl && userAcl.role === 'creator';
}

// ─── Documents ────────────────────────────────────────────────────────────────

app.get('/api/notebooks/:id/documents', requireAuth, async (req, res) => {
  try {
    const notebook = await db.getNotebookById(Number(req.params.id), req.user.id, req.user.role);
    if (!notebook) return res.status(404).json({ error: 'Notebook no encontrado' });
    const documents = await db.getDocumentsByNotebook(notebook.id);
    res.json({ documents });
  } catch (err) {
    console.error('[documents:list]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET specific document by ID
app.get('/api/documents/:id', requireAuth, async (req, res) => {
  try {
    const docId = Number(req.params.id);
    const doc = await db.getDocumentById(docId);
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });

    const notebook = await db.getNotebookById(doc.notebook_id, req.user.id, req.user.role);
    if (!notebook) return res.status(403).json({ error: 'Sin permiso para acceder a este notebook' });

    res.json({ document: doc });
  } catch (err) {
    console.error('[documents:get]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// Upload PDF / DOCX / TXT
app.post('/api/notebooks/:id/documents', requireAuth, upload.single('file'), async (req, res) => {
  const tmpPath = req.file?.path;
  try {
    const notebook = await db.getNotebookById(Number(req.params.id), req.user.id, req.user.role);
    if (!notebook) return res.status(404).json({ error: 'Notebook no encontrado' });
    
    if (!await hasCreatorPermission(notebook, req.user)) {
      return res.status(403).json({ error: 'No tienes permisos de edición en este notebook' });
    }

    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });

    const type = detectType(req.file.originalname);
    if (!type) return res.status(400).json({ error: 'Formato no soportado (pdf, docx, txt, md)' });

    // Extract text + split into chunks
    const { rawText, chunks } = await ingestFile(tmpPath, type);
    if (chunks.length === 0) return res.status(422).json({ error: 'No se pudo extraer texto del archivo' });

    // Save document record
    const doc = await db.createDocument(notebook.id, req.file.originalname, type, req.file.originalname, rawText);
    await db.logActivity(req.user.id, req.user.username, 'upload_document', notebook.id, notebook.name, doc.id, doc.name, `Archivo "${req.file.originalname}" subido`);

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
    const notebook = await db.getNotebookById(Number(req.params.id), req.user.id, req.user.role);
    if (!notebook) return res.status(404).json({ error: 'Notebook no encontrado' });

    if (!await hasCreatorPermission(notebook, req.user)) {
      return res.status(403).json({ error: 'No tienes permisos de edición en este notebook' });
    }

    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL requerida' });

    const { rawText, chunks, title } = await ingestUrl(url);
    if (chunks.length === 0) return res.status(422).json({ error: 'No se pudo extraer texto de la URL' });

    const name = title || url;
    const doc = await db.createDocument(notebook.id, name, 'url', url, rawText);
    await db.logActivity(req.user.id, req.user.username, 'upload_document', notebook.id, notebook.name, doc.id, doc.name, `Documento URL "${name}" ingestado`);

    res.status(202).json({ document: doc, message: 'Procesando embeddings en segundo plano…' });
    embedAndStore(doc.id, chunks).catch(err => console.error('[ingest:embed:url]', err));
  } catch (err) {
    console.error('[documents:url]', err);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Error interno' });
  }
});

// Receive pre-extracted text from Vercel (no file in memory on Render)
app.post('/api/notebooks/:id/documents/text', requireAuth, async (req, res) => {
  try {
    const notebook = await db.getNotebookById(Number(req.params.id), req.user.id, req.user.role);
    if (!notebook) return res.status(404).json({ error: 'Notebook no encontrado' });

    if (!await hasCreatorPermission(notebook, req.user)) {
      return res.status(403).json({ error: 'No tienes permisos de edición en este notebook' });
    }

    const { name, type, source, text } = req.body;
    if (!name || !type || !text) return res.status(400).json({ error: 'Faltan campos: name, type, text' });
    if (text.trim().length === 0) return res.status(422).json({ error: 'El documento no contiene texto extraíble' });

    const doc = await db.createDocument(notebook.id, name, type, source || name, text);
    await db.logActivity(req.user.id, req.user.username, 'upload_document', notebook.id, notebook.name, doc.id, doc.name, `Archivo "${name}" creado vía proxy`);

    // Actualizar orden de documentos del notebook
    const currentOrder = notebook.document_order || [];
    currentOrder.push(doc.id);
    await db.updateNotebookDocumentOrder(notebook.id, currentOrder);

    // Si tiene IA activa, generar quiz de fondo
    if (notebook.ai_assistant_enabled) {
      generateAndStoreQuiz(doc.id, text).catch(err => console.error('[ingest:quiz]', err));
    }

    res.status(202).json({ document: doc, message: 'Procesando embeddings en segundo plano…' });

    const chunks = chunkText(text);
    embedAndStore(doc.id, chunks).catch(err => console.error('[ingest:text]', err));
  } catch (err) {
    console.error('[documents:text]', err);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Error interno' });
  }
});

async function generateAndStoreQuiz(docId, text) {
  const { generateQuizForDocument } = require('./ai');
  const questions = await generateQuizForDocument(text);
  await db.saveQuizForDocument(docId, questions);
  console.log(`[ingest] Quiz autogenerado y guardado para documento ${docId}`);
}


app.delete('/api/documents/:id', requireAuth, async (req, res) => {
  try {
    const doc = await db.getDocumentById(Number(req.params.id));
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });
    
    const notebook = await db.getNotebookById(doc.notebook_id, req.user.id, req.user.role);
    if (!notebook) return res.status(403).json({ error: 'Sin permiso para acceder a este notebook' });

    if (!await hasCreatorPermission(notebook, req.user)) {
      return res.status(403).json({ error: 'No tienes permisos de edición en este notebook' });
    }

    await db.deleteDocument(doc.id);
    await db.logActivity(req.user.id, req.user.username, 'delete_document', notebook.id, notebook.name, doc.id, doc.name, `Documento "${doc.name}" eliminado`);

    res.json({ ok: true });
  } catch (err) {
    console.error('[documents:delete]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});


// Background: embed chunks and persist in batches of 20 to prevent Render OOM
async function embedAndStore(documentId, rawChunks) {
  const BATCH_SIZE = 20;
  let storedCount = 0;

  for (let i = 0; i < rawChunks.length; i += BATCH_SIZE) {
    const batch = rawChunks.slice(i, i + BATCH_SIZE);
    
    // Generate embeddings in parallel for the batch (20x speedup)
    const embeddings = await Promise.all(
      batch.map(chunk => embedText(chunk.content))
    );

    const rows = batch.map((chunk, index) => ({
      documentId,
      content: chunk.content,
      embedding: embeddings[index],
      chunkIndex: chunk.chunkIndex,
      pageNumber: chunk.pageNumber ?? null,
    }));

    await db.insertChunks(rows);
    storedCount += rows.length;
    console.log(`[ingest] Document ${documentId}: batch processed (${storedCount}/${rawChunks.length} chunks)`);
  }

  await db.updateDocumentChunkCount(documentId, storedCount);
  console.log(`[ingest] Document ${documentId}: total ${storedCount} chunks stored`);
}

// ─── Admin & User Management Endpoints ────────────────────────────────────────

async function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado (requiere rol de administrador)' });
  }
  next();
}

app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await db.getUsers();
    res.json({ users });
  } catch (err) {
    console.error('[admin:get-users]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username, password, role, fullName } = req.body;
    if (!username || !password || !role || !fullName) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }
    const cleanUsername = username.startsWith('@') ? username : `@${username}`;
    const existing = await db.getUserByUsername(cleanUsername);
    if (existing) return res.status(400).json({ error: 'El nombre de usuario ya está registrado' });

    const hash = await bcrypt.hash(password, 10);
    const newUser = await db.createUser(cleanUsername, hash, role, fullName);
    await db.logActivity(req.user.id, req.user.username, 'create_user', null, null, null, null, `Usuario ${cleanUsername} creado con rol ${role}`);

    res.status(201).json({ user: newUser });
  } catch (err) {
    console.error('[admin:create-user]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const userIdToDelete = Number(req.params.id);
    if (userIdToDelete === req.user.id) {
      return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
    }
    const target = await db.getUserById(userIdToDelete);
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });

    await db.deleteUser(userIdToDelete);
    await db.logActivity(req.user.id, req.user.username, 'delete_user', null, null, null, null, `Usuario ${target.username} eliminado`);

    res.json({ ok: true });
  } catch (err) {
    console.error('[admin:delete-user]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/admin/users/:id/reset-password', requireAuth, requireAdmin, async (req, res) => {
  try {
    const targetId = Number(req.params.id);
    const { newPassword } = req.body;
    if (!newPassword) return res.status(400).json({ error: 'Nueva contraseña genérica requerida' });

    const target = await db.getUserById(targetId);
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });

    const hash = await bcrypt.hash(newPassword, 10);
    await db.resetUserPassword(targetId, hash);
    await db.logActivity(req.user.id, req.user.username, 'reset_password', null, null, null, null, `Contraseña del usuario ${target.username} restablecida por el administrador`);

    res.json({ ok: true });
  } catch (err) {
    console.error('[admin:reset-password]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.get('/api/admin/activities', requireAuth, requireAdmin, async (req, res) => {
  try {
    const activities = await db.getActivityLogs();
    res.json({ activities });
  } catch (err) {
    console.error('[admin:get-activities]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── Profile / Change Password ────────────────────────────────────────────────

app.post('/api/users/change-password', requireAuth, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 4) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
    }
    const hash = await bcrypt.hash(newPassword, 10);
    await db.updateUserPassword(req.user.id, hash);
    await db.logActivity(req.user.id, req.user.username, 'change_password', null, null, null, null, 'Contraseña cambiada por el usuario');
    res.json({ ok: true });
  } catch (err) {
    console.error('[users:change-password]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── User Search Autocomplete ─────────────────────────────────────────────────

app.get('/api/users/search', requireAuth, async (req, res) => {
  try {
    const q = req.query.q || '';
    if (q.length < 2) return res.json({ users: [] });

    const { rows } = await db.pool.query(
      `SELECT id, username, full_name, role 
       FROM users 
       WHERE (username ILIKE $1 OR full_name ILIKE $1)
         AND id != $2
       LIMIT 10`,
      [`%${q}%`, req.user.id]
    );
    res.json({ users: rows });
  } catch (err) {
    console.error('[users:search]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── Notebook Access Control & Sharing ────────────────────────────────────────

app.get('/api/notebooks/:id/users', requireAuth, async (req, res) => {
  try {
    const notebook = await db.getNotebookById(Number(req.params.id), req.user.id, req.user.role);
    if (!notebook) return res.status(404).json({ error: 'Notebook no encontrado' });

    if (req.user.role !== 'admin' && notebook.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Sin privilegios para gestionar la compartición' });
    }

    const sharedUsers = await db.getNotebookUsers(notebook.id);
    res.json({ users: sharedUsers });
  } catch (err) {
    console.error('[notebooks:get-users]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/notebooks/:id/users', requireAuth, async (req, res) => {
  try {
    const notebook = await db.getNotebookById(Number(req.params.id), req.user.id, req.user.role);
    if (!notebook) return res.status(404).json({ error: 'Notebook no encontrado' });

    if (req.user.role !== 'admin' && notebook.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Sin privilegios para gestionar la compartición' });
    }

    const { userId, role } = req.body;
    if (!userId || !role) return res.status(400).json({ error: 'Faltan campos: userId, role' });

    const targetUser = await db.getUserById(Number(userId));
    if (!targetUser) return res.status(404).json({ error: 'Usuario a agregar no encontrado' });

    await db.addNotebookUser(notebook.id, targetUser.id, role);
    await db.logActivity(req.user.id, req.user.username, 'add_user', notebook.id, notebook.name, null, null, `Usuario ${targetUser.username} habilitado con rol ${role}`);

    res.json({ ok: true });
  } catch (err) {
    console.error('[notebooks:add-user]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.delete('/api/notebooks/:id/users/:userId', requireAuth, async (req, res) => {
  try {
    const notebook = await db.getNotebookById(Number(req.params.id), req.user.id, req.user.role);
    if (!notebook) return res.status(404).json({ error: 'Notebook no encontrado' });

    if (req.user.role !== 'admin' && notebook.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Sin privilegios para gestionar la compartición' });
    }

    const targetUserId = Number(req.params.userId);
    const targetUser = await db.getUserById(targetUserId);
    if (!targetUser) return res.status(404).json({ error: 'Usuario no encontrado' });

    await db.removeNotebookUser(notebook.id, targetUserId);
    await db.logActivity(req.user.id, req.user.username, 'remove_user', notebook.id, notebook.name, null, null, `Usuario ${targetUser.username} removido del notebook`);

    res.json({ ok: true });
  } catch (err) {
    console.error('[notebooks:remove-user]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/notebooks/:id/invitations', requireAuth, async (req, res) => {
  try {
    const notebook = await db.getNotebookById(Number(req.params.id), req.user.id, req.user.role);
    if (!notebook) return res.status(404).json({ error: 'Notebook no encontrado' });

    if (req.user.role !== 'admin' && notebook.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Sin privilegios para crear invitaciones' });
    }

    const { role, expiresDays } = req.body;
    const expiresAt = expiresDays ? new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000) : null;

    const token = await db.createNotebookInvitation(notebook.id, role || 'user', expiresAt);
    await db.logActivity(req.user.id, req.user.username, 'create_invitation', notebook.id, notebook.name, null, null, `Enlace de invitación creado con rol ${role || 'user'}`);

    res.status(201).json({ token });
  } catch (err) {
    console.error('[notebooks:create-invitation]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/invitations/claim', requireAuth, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token de invitación requerido' });

    const invite = await db.getNotebookInvitation(token);
    if (!invite) return res.status(404).json({ error: 'Enlace de invitación inválido o expirado' });

    const notebook = await db.pool.query('SELECT * FROM notebooks WHERE id = $1', [invite.notebook_id]).then(r => r.rows[0]);
    if (!notebook) return res.status(404).json({ error: 'El notebook ya no existe' });

    const notebookId = await db.claimNotebookInvitation(token, req.user.id);
    await db.logActivity(req.user.id, req.user.username, 'claim_invitation', notebookId, notebook.name, null, null, `Usuario aceptó invitación al notebook`);

    res.json({ ok: true, notebookId });
  } catch (err) {
    console.error('[invitations:claim]', err);
    res.status(500).json({ error: err.message || 'Error interno' });
  }
});

// ─── Conversations ────────────────────────────────────────────────────────────

app.get('/api/notebooks/:id/conversations', requireAuth, async (req, res) => {
  try {
    const notebook = await db.getNotebookById(Number(req.params.id), req.user.id, req.user.role);
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
    let conv;
    if (req.user.role === 'admin') {
      conv = await db.pool.query('SELECT * FROM conversations WHERE id = $1', [Number(req.params.id)]).then(r => r.rows[0]);
    } else {
      conv = await db.getConversationById(Number(req.params.id), req.user.id);
    }
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
    const notebook = await db.getNotebookById(Number(req.params.id), req.user.id, req.user.role);
    if (!notebook) return res.status(404).json({ error: 'Notebook no encontrado' });

    const { message, conversation_id, parent_id, document_ids } = req.body;
    if (!message) return res.status(400).json({ error: 'Mensaje requerido' });

    // Get or create conversation
    let conversation;
    if (conversation_id) {
      if (req.user.role === 'admin') {
        conversation = await db.pool.query('SELECT * FROM conversations WHERE id = $1', [conversation_id]).then(r => r.rows[0]);
      } else {
        conversation = await db.getConversationById(conversation_id, req.user.id);
      }
      if (!conversation) return res.status(404).json({ error: 'Conversación no encontrada' });
    } else {
      conversation = await db.createConversation(notebook.id, req.user.id, message.slice(0, 80));
    }

    // Load context history resolving branches using parent_id tree traversal!
    let history = [];
    if (parent_id) {
      const allMessages = await db.getMessagesByConversation(conversation.id);
      let currParentId = parent_id;
      while (currParentId && history.length < 12) {
        const msg = allMessages.find(m => m.id === currParentId);
        if (!msg) break;
        history.push(msg);
        currParentId = msg.parent_id;
      }
      history.reverse(); // ascending chronological
    } else if (conversation_id) {
      // Default flat load if no parent_id is specified
      history = await db.getMessagesByConversation(conversation.id, 12);
    }

    // Save user message with its parent_id
    const userMsg = await db.saveMessage(conversation.id, 'user', message, parent_id);

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
      documentIds: document_ids, // Filter search chunks by active documents!
      onChunk: (delta) => {
        res.write(`data: ${JSON.stringify({ type: 'delta', content: delta })}\n\n`);
      },
      onDone: async (sources, answer) => {
        fullAnswer = answer;
        finalSources = sources;
      },
    });

    // Save assistant message with parent_id set to the user message ID!
    await db.saveMessage(conversation.id, 'assistant', fullAnswer, userMsg.id, finalSources);

    // Asynchronously generate title if it is the first interaction in a conversation!
    let conversationTitle = null;
    if (!conversation_id) {
      const { generateConversationTitle } = require('./ai');
      conversationTitle = await generateConversationTitle(message, fullAnswer);
      await db.updateConversationTitle(conversation.id, conversationTitle);
    }

    // Send final event with sources and autotitled string
    res.write(`data: ${JSON.stringify({ type: 'done', sources: finalSources, title: conversationTitle })}\n\n`);
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


// ─── Learning, Quizzes & Final Exams Endpoints ───────────────────────────────

app.get('/api/notebooks/:id/progress', requireAuth, async (req, res) => {
  try {
    const notebookId = Number(req.params.id);
    const notebook = await db.getNotebookById(notebookId, req.user.id, req.user.role);
    if (!notebook) return res.status(404).json({ error: 'Notebook no encontrado' });

    const progress = await db.getNotebookProgress(notebook.id, req.user.id);
    const finalExam = await db.getFinalExam(req.user.id, notebook.id);

    res.json({
      progress,
      document_order: notebook.document_order || [],
      ai_assistant_enabled: notebook.ai_assistant_enabled,
      final_exam: finalExam ? { passed: finalExam.passed, score: finalExam.score } : null
    });
  } catch (err) {
    console.error('[progress]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/documents/:id/read', requireAuth, async (req, res) => {
  try {
    const docId = Number(req.params.id);
    const { checked } = req.body;
    const doc = await db.getDocumentById(docId);
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });

    const notebook = await db.getNotebookById(doc.notebook_id, req.user.id, req.user.role);
    if (!notebook) return res.status(403).json({ error: 'Sin permiso para acceder a este notebook' });

    await db.updateDocumentRead(req.user.id, docId, !!checked);
    res.json({ ok: true });
  } catch (err) {
    console.error('[read]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.get('/api/documents/:id/quiz', requireAuth, async (req, res) => {
  try {
    const docId = Number(req.params.id);
    const doc = await db.getDocumentById(docId);
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });

    const notebook = await db.getNotebookById(doc.notebook_id, req.user.id, req.user.role);
    if (!notebook) return res.status(403).json({ error: 'Sin permiso para acceder a este notebook' });

    let quiz = await db.getQuizByDocument(docId);
    if (!quiz) {
      console.log(`[quiz] Quiz no pregenerado para documento ${docId}. Generando en caliente…`);
      const { generateQuizForDocument } = require('./ai');
      const questions = await generateQuizForDocument(doc.raw_text || '');
      await db.saveQuizForDocument(docId, questions);
      quiz = { document_id: docId, questions };
    }

    // Ocultar respuestas y explicaciones correctas al enviarlo al cliente
    const questionsForClient = quiz.questions.map(q => ({
      question: q.question,
      options: q.options
    }));

    res.json({ quiz: { document_id: docId, questions: questionsForClient } });
  } catch (err) {
    console.error('[quiz:get]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/documents/:id/quiz/submit', requireAuth, async (req, res) => {
  try {
    const docId = Number(req.params.id);
    const { answers } = req.body;
    if (!Array.isArray(answers)) return res.status(400).json({ error: 'Formato de respuestas inválido' });

    const doc = await db.getDocumentById(docId);
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });

    const notebook = await db.getNotebookById(doc.notebook_id, req.user.id, req.user.role);
    if (!notebook) return res.status(403).json({ error: 'Sin permiso para acceder a este notebook' });

    const quiz = await db.getQuizByDocument(docId);
    if (!quiz) return res.status(404).json({ error: 'Cuestionario no encontrado' });

    const questions = quiz.questions;
    let score = 0;
    const feedback = questions.map((q, idx) => {
      const userAns = answers[idx] || '';
      const isCorrect = userAns.trim().toUpperCase().charAt(0) === q.correct.trim().toUpperCase().charAt(0);
      if (isCorrect) score++;
      return {
        questionIndex: idx,
        userAnswer: userAns,
        correctAnswer: q.correct,
        isCorrect,
        explanation: q.explanation
      };
    });

    const passed = score === questions.length; // requiere 100% (3/3)

    if (passed) {
      await db.updateDocumentQuizPassed(req.user.id, docId, score);
      await db.logActivity(req.user.id, req.user.username, 'pass_quiz', notebook.id, notebook.name, doc.id, doc.name, `Aprobó cuestionario de "${doc.name}" con puntaje ${score}/${questions.length}`);
    }

    res.json({ passed, score, total: questions.length, feedback });
  } catch (err) {
    console.error('[quiz:submit]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.get('/api/notebooks/:id/final-exam', requireAuth, async (req, res) => {
  try {
    const notebookId = Number(req.params.id);
    const notebook = await db.getNotebookById(notebookId, req.user.id, req.user.role);
    if (!notebook) return res.status(404).json({ error: 'Notebook no encontrado' });

    // Verificar que aprobó todos los cuestionarios
    const progress = await db.getNotebookProgress(notebook.id, req.user.id);
    const documents = await db.getDocumentsByNotebook(notebook.id);

    const allPassed = documents.length > 0 && documents.every(d => {
      const p = progress.find(pr => pr.document_id === d.id);
      return p && p.quiz_passed;
    });

    if (!allPassed) {
      return res.status(400).json({ error: 'Debes completar y aprobar todos los cuestionarios previos antes de tomar el examen final.' });
    }

    let exam = await db.getFinalExam(req.user.id, notebook.id);
    let questions;

    if (exam && exam.questions) {
      questions = exam.questions;
    } else {
      console.log(`[final-exam] Generando examen final integrador para notebook ${notebookId}…`);
      const { generateFinalExam } = require('./ai');
      const docsWithText = await Promise.all(
        documents.map(async d => await db.getDocumentById(d.id))
      );
      questions = await generateFinalExam(docsWithText);
      await db.saveFinalExam(req.user.id, notebook.id, false, 0, questions);
    }

    // Ocultar respuestas y explicaciones
    const questionsForClient = questions.map(q => ({
      question: q.question,
      options: q.options
    }));

    res.json({ exam: { notebook_id: notebookId, questions: questionsForClient } });
  } catch (err) {
    console.error('[final-exam:get]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/notebooks/:id/final-exam/submit', requireAuth, async (req, res) => {
  try {
    const notebookId = Number(req.params.id);
    const { answers } = req.body;
    if (!Array.isArray(answers)) return res.status(400).json({ error: 'Formato de respuestas inválido' });

    const notebook = await db.getNotebookById(notebookId, req.user.id, req.user.role);
    if (!notebook) return res.status(404).json({ error: 'Notebook no encontrado' });

    const exam = await db.getFinalExam(req.user.id, notebook.id);
    if (!exam || !exam.questions) return res.status(404).json({ error: 'Examen final no generado previamente' });

    const questions = exam.questions;
    let score = 0;
    const feedback = questions.map((q, idx) => {
      const userAns = answers[idx] || '';
      const isCorrect = userAns.trim().toUpperCase().charAt(0) === q.correct.trim().toUpperCase().charAt(0);
      if (isCorrect) score++;
      return {
        questionIndex: idx,
        userAnswer: userAns,
        correctAnswer: q.correct,
        isCorrect,
        explanation: q.explanation
      };
    });

    const passed = score >= 4; // Aprueba con 4/5 correctas (80%)

    await db.saveFinalExam(req.user.id, notebook.id, passed, score, questions);

    if (passed) {
      await db.logActivity(req.user.id, req.user.username, 'pass_final_exam', notebook.id, notebook.name, null, null, `Aprobó examen final del notebook con puntaje ${score}/${questions.length}`);
    } else {
      await db.logActivity(req.user.id, req.user.username, 'fail_final_exam', notebook.id, notebook.name, null, null, `Reprobó examen final del notebook con puntaje ${score}/${questions.length}`);
    }

    res.json({ passed, score, total: questions.length, feedback });
  } catch (err) {
    console.error('[final-exam:submit]', err);
    res.status(500).json({ error: 'Error interno' });
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
