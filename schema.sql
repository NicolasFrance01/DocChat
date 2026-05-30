-- DocChat schema — run once against Neon PostgreSQL
-- Requires: CREATE EXTENSION IF NOT EXISTS vector (pgvector must be enabled in Neon)

CREATE EXTENSION IF NOT EXISTS vector;

-- ─── Users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id           SERIAL PRIMARY KEY,
  username     TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'user',  -- 'user' | 'creator' | 'admin'
  full_name    TEXT,
  password_changed BOOLEAN NOT NULL DEFAULT FALSE,
  status       TEXT NOT NULL DEFAULT 'active', -- 'active' | 'suspended'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Sessions ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

-- ─── Notebooks ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notebooks (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notebooks_user_id_idx ON notebooks(user_id);

-- ─── Control de Acceso por Notebook (ACL) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS notebook_users (
  notebook_id INTEGER REFERENCES notebooks(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'user', -- 'user' | 'creator'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (notebook_id, user_id)
);

-- ─── Invitaciones a Notebooks ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notebook_invitations (
  token       TEXT PRIMARY KEY,
  notebook_id INTEGER REFERENCES notebooks(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'user', -- 'user' | 'creator'
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Registro de Actividad (Auditoría) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username TEXT NOT NULL,
  action TEXT NOT NULL,          -- 'create_notebook', 'delete_notebook', 'upload_document', 'delete_document', 'add_user', 'remove_user', 'reset_password'
  notebook_id INTEGER,
  notebook_name TEXT,
  document_id INTEGER,
  document_name TEXT,
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Documents ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id          SERIAL PRIMARY KEY,
  notebook_id INTEGER NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,          -- 'pdf' | 'docx' | 'url' | 'txt'
  source      TEXT,                   -- original URL or filename
  raw_text    TEXT,                   -- full extracted text
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS documents_notebook_id_idx ON documents(notebook_id);

-- ─── Document chunks (pgvector) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_chunks (
  id          SERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  embedding   vector(768),            -- Gemini text-embedding-004 = 768 dims
  chunk_index INTEGER NOT NULL,
  page_number INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chunks_document_id_idx ON document_chunks(document_id);

-- ─── Conversations ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id          SERIAL PRIMARY KEY,
  notebook_id INTEGER NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS conversations_notebook_id_idx ON conversations(notebook_id);
CREATE INDEX IF NOT EXISTS conversations_user_id_idx ON conversations(user_id);

-- ─── Messages ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id              SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,       -- 'user' | 'assistant'
  content         TEXT NOT NULL,
  sources         JSONB,               -- [{chunk_id, document_name, page_number, excerpt}]
  parent_id       INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS messages_conversation_id_idx ON messages(conversation_id);
