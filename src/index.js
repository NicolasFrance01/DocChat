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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// CORS permisivo para desarrollo (Vercel frontend)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
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

app.post('/api/notebooks/:id', requireAuth, async (req, res) => {
  try {
    const notebookId = Number(req.params.id);
    const { name, description, ai_assistant_enabled } = req.body;
    if (!name) return res.status(400).json({ error: 'El nombre es requerido' });

    const notebook = await db.getNotebookById(notebookId, req.user.id, req.user.role);
    if (!notebook) return res.status(404).json({ error: 'Notebook no encontrado' });

    if (!await hasCreatorPermission(notebook, req.user)) {
      return res.status(403).json({ error: 'No tienes permisos para modificar este notebook' });
    }

    const updated = await db.updateNotebook(notebookId, name, description, !!ai_assistant_enabled);
    await db.logActivity(req.user.id, req.user.username, 'update_notebook', notebookId, updated.name, null, null, `Notebook "${updated.name}" modificado`);

    res.json({ notebook: updated });
  } catch (err) {
    console.error('[notebooks:update]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/notebooks/:id/reorder', requireAuth, async (req, res) => {
  try {
    const notebookId = Number(req.params.id);
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'Formato de orden inválido' });

    const notebook = await db.getNotebookById(notebookId, req.user.id, req.user.role);
    if (!notebook) return res.status(404).json({ error: 'Notebook no encontrado' });

    if (!await hasCreatorPermission(notebook, req.user)) {
      return res.status(403).json({ error: 'No tienes permisos de edición en este notebook' });
    }

    await db.updateNotebookDocumentOrder(notebookId, order);
    await db.logActivity(req.user.id, req.user.username, 'reorder_documents', notebookId, notebook.name, null, null, `Se actualizó el orden del camino de aprendizaje de "${notebook.name}"`);

    res.json({ ok: true });
  } catch (err) {
    console.error('[notebooks:reorder]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});


app.put('/api/notebooks/:id/folders/:folderId/quiz', requireAuth, async (req, res) => {
  try {
    const notebookId = Number(req.params.id);
    const folderId = Number(req.params.folderId);
    const { quiz_enabled } = req.body;

    const notebook = await db.getNotebookById(notebookId, req.user.id, req.user.role);
    if (!notebook) return res.status(404).json({ error: 'Notebook no encontrado' });

    if (!await hasCreatorPermission(notebook, req.user)) {
      return res.status(403).json({ error: 'No tienes permisos de edición en este notebook' });
    }

    await db.updateFolderQuizEnabled(folderId, notebookId, !!quiz_enabled);

    // If quiz is enabled, generate it asynchronously
    if (quiz_enabled) {
      generateAndStoreFolderQuiz(notebookId, folderId).catch(err => console.error('[folder:quiz:generate]', err));
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[folders:quiz]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

async function generateAndStoreFolderQuiz(notebookId, folderId) {
  const documents = await db.getDocumentsByNotebook(notebookId);
  const folderDocs = documents.filter(d => d.folder_id === folderId);
  if (folderDocs.length === 0) return;

  const combinedText = folderDocs.map(d => `Documento: ${d.name}\n${d.raw_text}`).join('\n\n--- \n\n');
  
  const { generateQuizForDocument } = require('./ai');
  const questions = await generateQuizForDocument(combinedText);
  await db.saveQuizForFolder(folderId, questions);
  console.log(`[ingest] Quiz autogenerado y guardado para carpeta ${folderId}`);
}

app.put('/api/notebooks/:id/reorder-tree', requireAuth, async (req, res) => {
  try {
    const notebookId = Number(req.params.id);
    const { items, documentOrder } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: 'Formato de ítems inválido' });

    const notebook = await db.getNotebookById(notebookId, req.user.id, req.user.role);
    if (!notebook) return res.status(404).json({ error: 'Notebook no encontrado' });

    if (!await hasCreatorPermission(notebook, req.user)) {
      return res.status(403).json({ error: 'No tienes permisos de edición en este notebook' });
    }

    await db.updateTreeOrder(notebookId, items, documentOrder);
    await db.logActivity(req.user.id, req.user.username, 'reorder_tree', notebookId, notebook.name, null, null, `Se actualizó la estructura y orden de carpetas de "${notebook.name}"`);

    res.json({ ok: true });
  } catch (err) {
    console.error('[notebooks:reorder-tree]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/notebooks/:id/suggest-order', requireAuth, async (req, res) => {
  try {
    const notebookId = Number(req.params.id);
    const notebook = await db.getNotebookById(notebookId, req.user.id, req.user.role);
    if (!notebook) return res.status(404).json({ error: 'Notebook no encontrado' });

    if (!await hasCreatorPermission(notebook, req.user)) {
      return res.status(403).json({ error: 'No tienes permisos de edición en este notebook' });
    }

    const documents = await db.getDocumentsByNotebook(notebookId);
    if (documents.length <= 1) {
      return res.json({
        order: documents.map(d => d.id),
        explanation: 'Se necesitan al menos 2 documentos para que la IA sugiera una secuencia pedagógica.'
      });
    }

    const { suggestDocumentOrder } = require('./ai');
    const docMetaList = documents.map(d => ({ id: d.id, name: d.name }));
    const suggestion = await suggestDocumentOrder(docMetaList);

    res.json(suggestion);
  } catch (err) {
    console.error('[notebooks:suggest-order]', err);
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

// ─── Folders ──────────────────────────────────────────────────────────────────

// GET all folders of a notebook
app.get('/api/notebooks/:id/folders', requireAuth, async (req, res) => {
  try {
    const notebookId = Number(req.params.id);
    const notebook = await db.getNotebookById(notebookId, req.user.id, req.user.role);
    if (!notebook) return res.status(404).json({ error: 'Notebook no encontrado' });

    const folders = await db.getFoldersByNotebook(notebookId);
    res.json({ folders });
  } catch (err) {
    console.error('[folders:list]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// POST create folder
app.post('/api/notebooks/:id/folders', requireAuth, async (req, res) => {
  try {
    const notebookId = Number(req.params.id);
    const { name, parent_id } = req.body;
    if (!name) return res.status(400).json({ error: 'El nombre es requerido' });

    const notebook = await db.getNotebookById(notebookId, req.user.id, req.user.role);
    if (!notebook) return res.status(404).json({ error: 'Notebook no encontrado' });

    if (!await hasCreatorPermission(notebook, req.user)) {
      return res.status(403).json({ error: 'No tienes permisos de edición en este notebook' });
    }

    const folder = await db.createFolder(notebookId, name, parent_id ? Number(parent_id) : null);
    await db.logActivity(req.user.id, req.user.username, 'create_folder', notebookId, notebook.name, null, null, `Carpeta "${name}" creada`);

    res.status(201).json({ folder });
  } catch (err) {
    console.error('[folders:create]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// DELETE folder
app.put('/api/folders/:id', requireAuth, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Nombre inválido' });

    const folderId = Number(req.params.id);
    const folder = await db.getFolderById(folderId);
    if (!folder) return res.status(404).json({ error: 'Carpeta no encontrada' });

    const notebook = await db.getNotebookById(folder.notebook_id, req.user.id, req.user.role);
    if (!notebook) return res.status(403).json({ error: 'Sin permiso' });

    if (!await hasCreatorPermission(notebook, req.user)) {
      return res.status(403).json({ error: 'No tienes permisos de edición en este notebook' });
    }

    const updated = await db.renameFolder(folderId, name);
    res.json({ folder: updated });
  } catch (err) {
    console.error('[folders:rename]', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.delete('/api/folders/:id', requireAuth, async (req, res) => {
  try {
    const folderId = Number(req.params.id);
    const folder = await db.getFolderById(folderId);
    if (!folder) return res.status(404).json({ error: 'Carpeta no encontrada' });

    const notebook = await db.getNotebookById(folder.notebook_id, req.user.id, req.user.role);
    if (!notebook) return res.status(403).json({ error: 'Sin permiso para acceder a este notebook' });

    if (!await hasCreatorPermission(notebook, req.user)) {
      return res.status(403).json({ error: 'No tienes permisos de edición en este notebook' });
    }

    await db.deleteFolder(folderId);
    await db.logActivity(req.user.id, req.user.username, 'delete_folder', notebook.id, notebook.name, null, null, `Carpeta "${folder.name}" eliminada`);

    res.json({ ok: true });
  } catch (err) {
    console.error('[folders:delete]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// POST move document
app.post('/api/documents/:id/move', requireAuth, async (req, res) => {
  try {
    const docId = Number(req.params.id);
    const { folder_id } = req.body;

    const doc = await db.getDocumentById(docId);
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });

    const notebook = await db.getNotebookById(doc.notebook_id, req.user.id, req.user.role);
    if (!notebook) return res.status(403).json({ error: 'Sin permiso para acceder a este notebook' });

    if (!await hasCreatorPermission(notebook, req.user)) {
      return res.status(403).json({ error: 'No tienes permisos de edición en este notebook' });
    }

    // Verify folder belongs to the same notebook
    let targetFolderId = folder_id ? Number(folder_id) : null;
    if (targetFolderId) {
      const folder = await db.getFolderById(targetFolderId);
      if (!folder || folder.notebook_id !== notebook.id) {
        return res.status(400).json({ error: 'Carpeta de destino inválida o pertenece a otro notebook' });
      }
    }

    const updated = await db.moveDocumentToFolder(docId, targetFolderId);
    const pathStr = targetFolderId ? await db.getFolderPath(targetFolderId) : 'raíz';
    await db.logActivity(req.user.id, req.user.username, 'move_document', notebook.id, notebook.name, doc.id, doc.name, `Documento "${doc.name}" movido a ${pathStr}`);

    res.json({ document: updated });
  } catch (err) {
    console.error('[documents:move]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// POST move folder
app.post('/api/folders/:id/move', requireAuth, async (req, res) => {
  try {
    const folderId = Number(req.params.id);
    const { parent_id } = req.body;

    const folder = await db.getFolderById(folderId);
    if (!folder) return res.status(404).json({ error: 'Carpeta no encontrada' });

    const notebook = await db.getNotebookById(folder.notebook_id, req.user.id, req.user.role);
    if (!notebook) return res.status(403).json({ error: 'Sin permiso para acceder a este notebook' });

    if (!await hasCreatorPermission(notebook, req.user)) {
      return res.status(403).json({ error: 'No tienes permisos de edición en este notebook' });
    }

    let targetParentId = parent_id ? Number(parent_id) : null;
    if (targetParentId) {
      const parentFolder = await db.getFolderById(targetParentId);
      if (!parentFolder || parentFolder.notebook_id !== notebook.id) {
        return res.status(400).json({ error: 'Carpeta padre de destino inválida o pertenece a otro notebook' });
      }
    }

    const updated = await db.moveFolderToParent(folderId, targetParentId);
    const pathStr = targetParentId ? await db.getFolderPath(targetParentId) : 'raíz';
    await db.logActivity(req.user.id, req.user.username, 'move_folder', notebook.id, notebook.name, null, null, `Carpeta "${folder.name}" movida a ${pathStr}`);

    res.json({ folder: updated });
  } catch (err) {
    console.error('[folders:move]', err);
    res.status(500).json({ error: err.message || 'Error interno' });
  }
});

// ─── Documents ────────────────────────────────────────────────────────────────

app.get('/api/notebooks/:id/documents', requireAuth, async (req, res) => {
  try {
    const notebook = await db.getNotebookById(Number(req.params.id), req.user.id, req.user.role);
    if (!notebook) return res.status(404).json({ error: 'Notebook no encontrado' });
    const documents = await db.getDocumentsByNotebook(notebook.id);
    res.json({ documents, notebookName: notebook.name });
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
    const folder_id = req.body.folder_id || req.query.folder_id;
    const doc = await db.createDocument(notebook.id, req.file.originalname, type, req.file.originalname, rawText, folder_id ? Number(folder_id) : null);
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
    const folder_id = req.body.folder_id || req.query.folder_id;
    const doc = await db.createDocument(notebook.id, name, 'url', url, rawText, folder_id ? Number(folder_id) : null);
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

    const { name, type, source, text, folder_id } = req.body;
    if (!name || !type || !text) return res.status(400).json({ error: 'Faltan campos: name, type, text' });
    if (text.trim().length === 0) return res.status(422).json({ error: 'El documento no contiene texto extraíble' });

    const doc = await db.createDocument(notebook.id, name, type, source || name, text, folder_id ? Number(folder_id) : null);
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

app.post('/api/notebooks/:id/documents/video', requireAuth, async (req, res) => {
  try {
    const notebook = await db.getNotebookById(Number(req.params.id), req.user.id, req.user.role);
    if (!notebook) return res.status(404).json({ error: 'Notebook no encontrado' });

    if (!await hasCreatorPermission(notebook, req.user)) {
      return res.status(403).json({ error: 'No tienes permisos de edición en este notebook' });
    }

    const { name, embed_code, folder_id } = req.body;
    if (!name || !embed_code) return res.status(400).json({ error: 'Faltan campos: name, embed_code' });

    const doc = await db.createDocument(notebook.id, name, 'video', embed_code, '', folder_id ? Number(folder_id) : null);
    await db.logActivity(req.user.id, req.user.username, 'upload_document', notebook.id, notebook.name, doc.id, doc.name, `Video "${name}" añadido`);

    // Actualizar orden de documentos del notebook
    const currentOrder = notebook.document_order || [];
    currentOrder.push(doc.id);
    await db.updateNotebookDocumentOrder(notebook.id, currentOrder);

    res.status(201).json({ document: doc });
  } catch (err) {
    console.error('[documents:video]', err);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Error interno' });
  }
});

app.post('/api/documents/:id/transcription', requireAuth, async (req, res) => {
  try {
    const docId = Number(req.params.id);
    const { transcription } = req.body;
    
    const doc = await db.getDocumentById(docId);
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });

    const notebook = await db.getNotebookById(doc.notebook_id, req.user.id, req.user.role);
    if (!notebook) return res.status(403).json({ error: 'Sin permiso para acceder a este notebook' });

    if (!await hasCreatorPermission(notebook, req.user)) {
      return res.status(403).json({ error: 'No tienes permisos de edición en este notebook' });
    }

    // Update raw_text
    await db.pool.query('UPDATE documents SET raw_text = $1 WHERE id = $2', [transcription, docId]);
    await db.logActivity(req.user.id, req.user.username, 'update_document', notebook.id, notebook.name, doc.id, doc.name, `Transcripción actualizada para "${doc.name}"`);

    // Borrar chunks viejos
    await db.deleteChunksByDocument(docId);
    
    res.status(202).json({ ok: true, message: 'Procesando transcripción en segundo plano…' });

    // Procesar embeddings de la nueva transcripción
    if (transcription && transcription.trim()) {
      const { chunkText } = require('./ingest');
      const chunks = chunkText(transcription);
      embedAndStore(docId, chunks).catch(err => console.error('[transcription:embed]', err));
    } else {
      await db.updateDocumentChunkCount(docId, 0);
    }
  } catch (err) {
    console.error('[documents:transcription]', err);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Error interno' });
  }
});

async function generateAndStoreQuiz(docId, text) {
  const { generateQuizForDocument } = require('./ai');
  const questions = await generateQuizForDocument(text);
  await db.saveQuizForDocument(docId, questions);
  console.log(`[ingest] Quiz autogenerado y guardado para documento ${docId}`);
}


app.put('/api/documents/:id', requireAuth, upload.single('file'), async (req, res) => {
  const tmpPath = req.file?.path;
  try {
    const { name, embed_code } = req.body;

    const doc = await db.getDocumentById(Number(req.params.id));
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });
    
    const notebook = await db.getNotebookById(doc.notebook_id, req.user.id, req.user.role);
    if (!notebook) return res.status(403).json({ error: 'Sin permiso para acceder a este notebook' });

    if (!await hasCreatorPermission(notebook, req.user)) {
      return res.status(403).json({ error: 'No tienes permisos de edición en este notebook' });
    }

    const updates = {};
    if (name) updates.name = name;

    // Si es un archivo y subieron uno nuevo
    if (req.file && ['pdf', 'docx', 'txt'].includes(doc.type)) {
      const type = detectType(req.file.originalname);
      if (!type) return res.status(400).json({ error: 'Formato no soportado' });
      
      const { rawText, chunks } = await ingestFile(tmpPath, type);
      await db.deleteChunksByDocument(doc.id);
      
      updates.content_url = req.file.originalname;
      updates.transcription = rawText;
      updates.chunk_count = chunks.length;

      // Generar embeddings en background
      embedAndStore(doc.id, chunks).catch(err => console.error('[ingest:update:embed]', err));
    }

    // Si es un video y se actualizó el iframe
    if (doc.type === 'video' && embed_code) {
      updates.content_url = embed_code;
    }

    const updated = await db.updateDocumentData(doc.id, updates);
    res.json({ document: updated });
  } catch (err) {
    console.error('[documents:update]', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (tmpPath) {
      const fs = require('fs');
      fs.unlink(tmpPath, () => {});
    }
  }
});

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

    const progress = await db.getNotebookProgress(notebook.id, req.user.id);
    const folderProgressList = await db.getAllFolderProgressForUser(req.user.id);
    // filter folder progress for this notebook's folders
    const documents = await db.getDocumentsByNotebook(notebook.id);
    const folders = await db.getFoldersByNotebook(notebook.id);
    
    // Create an object to summarize the progress state to guide the user
    const progressSummary = {
      readDocuments: progress.filter(p => p.read_checked).map(p => documents.find(d => d.id === p.document_id)?.name),
      unreadDocuments: documents.filter(d => !progress.find(p => p.document_id === d.id && p.read_checked)).map(d => d.name),
      folderProgress: folders.map(f => {
        const fp = folderProgressList.find(p => p.folder_id === f.id);
        return { name: f.name, quizEnabled: f.quiz_enabled, quizPassed: fp?.quiz_passed };
      })
    };

    await chatStream({
      notebookId: notebook.id,
      userMessage: message,
      history,
      progressSummary,
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
    
    // Get folder progress
    const { rows: folderProgressRows } = await db.pool.query(
      'SELECT folder_id, quiz_passed, score, completed_at FROM user_folder_progress WHERE user_id = $1',
      [req.user.id]
    );

    res.json({
      progress,
      folder_progress: folderProgressRows,
      document_order: notebook.document_order || [],
      ai_assistant_enabled: notebook.ai_assistant_enabled,
      final_exam: finalExam ? { passed: finalExam.passed, score: finalExam.score } : null
    });
  } catch (err) {
    console.error('[progress]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.get('/api/notebooks/:id/folders/:folderId/quiz', requireAuth, async (req, res) => {
  try {
    const notebookId = Number(req.params.id);
    const folderId = Number(req.params.folderId);
    
    const notebook = await db.getNotebookById(notebookId, req.user.id, req.user.role);
    if (!notebook) return res.status(403).json({ error: 'Sin permiso para acceder a este notebook' });

    let quiz = await db.getQuizForFolder(folderId);
    if (!quiz) {
      console.log(`[quiz] Quiz no pregenerado para carpeta ${folderId}. Generando en caliente…`);
      const documents = await db.getDocumentsByNotebook(notebookId);
      const folderDocs = documents.filter(d => d.folder_id === folderId);
      if (folderDocs.length === 0) return res.status(404).json({ error: 'Carpeta vacía' });

      const combinedText = folderDocs.map(d => `Documento: ${d.name}\n${d.raw_text}`).join('\n\n--- \n\n');
      const { generateQuizForDocument } = require('./ai');
      const questions = await generateQuizForDocument(combinedText);
      await db.saveQuizForFolder(folderId, questions);
      quiz = questions;
    }

    const questionsForClient = quiz.map(q => ({
      question: q.question,
      options: q.options
    }));

    res.json({ quiz: { document_id: folderId, questions: questionsForClient } });
  } catch (err) {
    console.error('[quiz:get]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/notebooks/:id/folders/:folderId/quiz/submit', requireAuth, async (req, res) => {
  try {
    const notebookId = Number(req.params.id);
    const folderId = Number(req.params.folderId);
    const { answers } = req.body;

    const notebook = await db.getNotebookById(notebookId, req.user.id, req.user.role);
    if (!notebook) return res.status(403).json({ error: 'Sin permiso para acceder a este notebook' });

    const quiz = await db.getQuizForFolder(folderId);
    if (!quiz) return res.status(404).json({ error: 'Cuestionario no encontrado' });

    let score = 0;
    const selectedAnswersArray = [];
    quiz.forEach((q, idx) => {
      const isCorrect = answers[idx] && answers[idx].startsWith(q.correct);
      if (isCorrect) score++;
      
      selectedAnswersArray.push({
        questionIndex: idx,
        question: q.question,
        selectedOption: answers[idx] || '',
        correctOption: q.correct,
        isCorrect,
        explanation: q.explanation
      });
    });

    const passed = score === quiz.length;
    
    // Save detailed attempt
    await db.saveQuizAttempt(req.user.id, 'folder', folderId, notebookId, score, passed, selectedAnswersArray);

    if (passed) {
      await db.saveUserFolderProgress(req.user.id, folderId, true, score);
    }

    const feedback = quiz.map((q, idx) => ({
      questionIndex: idx,
      userAnswer: answers[idx] || '',
      isCorrect: answers[idx] && answers[idx].startsWith(q.correct),
      correctAnswer: q.options.find(o => o.startsWith(q.correct)) || q.correct,
      explanation: q.explanation
    }));

    res.json({ passed, score, total: quiz.length, feedback });
  } catch (err) {
    console.error('[quiz:submit]', err);
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

app.post('/api/documents/:id/quiz/submit', requireAuth, async (req, res) => {
  try {
    const docId = Number(req.params.id);
    const { answers } = req.body;
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

app.get('/api/notebooks/:id/attempts', requireAuth, async (req, res) => {
  try {
    const notebookId = Number(req.params.id);
    const notebook = await db.getNotebookById(notebookId, req.user.id, req.user.role);
    if (!notebook) return res.status(404).json({ error: 'Notebook no encontrado' });

    if (req.user.role !== 'admin' && req.user.id !== notebook.user_id) {
      return res.status(403).json({ error: 'Sin permiso para ver intentos de este notebook' });
    }

    const { rows } = await db.pool.query(`
      SELECT qa.id, qa.user_id, u.full_name, u.username, qa.entity_type as quiz_type, qa.entity_id as target_id, qa.score, qa.passed, qa.created_at, qa.selected_answers as details, f.name as folder_name
      FROM quiz_attempts qa
      JOIN users u ON qa.user_id = u.id
      LEFT JOIN folders f ON qa.entity_type = 'folder' AND qa.entity_id = f.id
      WHERE qa.notebook_id = $1
      ORDER BY qa.created_at DESC
    `, [notebookId]);

    res.json({ attempts: rows });
  } catch (err) {
    console.error('[attempts:get]', err);
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
