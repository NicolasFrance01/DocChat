const BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

function token(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('docchat_token');
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const t = token();
  return {
    'Content-Type': 'application/json',
    ...(t ? { 'X-Session-Token': t } : {}),
    ...extra,
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...headers(), ...(init.headers as Record<string, string> ?? {}) },
  });
  if (res.status === 401) {
    localStorage.removeItem('docchat_token');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function login(username: string, password: string) {
  const data = await request<{ token: string; user: User }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  localStorage.setItem('docchat_token', data.token);
  return data;
}

export async function logout() {
  await request('/api/auth/logout', { method: 'POST' }).catch(() => {});
  localStorage.removeItem('docchat_token');
}

export async function getMe() {
  return request<{ user: User }>('/api/users/me');
}

// ─── Notebooks ────────────────────────────────────────────────────────────────

export async function getNotebooks() {
  return request<{ notebooks: Notebook[] }>('/api/notebooks');
}

export async function createNotebook(name: string, description?: string) {
  return request<{ notebook: Notebook }>('/api/notebooks', {
    method: 'POST',
    body: JSON.stringify({ name, description }),
  });
}

export async function deleteNotebook(id: number) {
  return request(`/api/notebooks/${id}`, { method: 'DELETE' });
}

// ─── Documents ────────────────────────────────────────────────────────────────

export async function getDocuments(notebookId: number) {
  return request<{ documents: Document[] }>(`/api/notebooks/${notebookId}/documents`);
}

export async function uploadDocument(notebookId: number, file: File, onProgress?: (pct: number) => void) {
  return new Promise<{ document: Document }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const t = token();

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        const body = JSON.parse(xhr.responseText ?? '{}');
        reject(new Error(body.error ?? `HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Error de red'));

    const form = new FormData();
    form.append('file', file);

    // Upload goes to Vercel API route — extracts text there, sends only text to Render
    // This avoids OOM on Render free tier (512MB RAM)
    xhr.open('POST', `/api/ingest/${notebookId}`);
    if (t) xhr.setRequestHeader('X-Session-Token', t);
    xhr.send(form);
  });
}

export async function ingestUrl(notebookId: number, url: string) {
  return request<{ document: Document }>(`/api/notebooks/${notebookId}/documents/url`, {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

export async function deleteDocument(id: number) {
  return request(`/api/documents/${id}`, { method: 'DELETE' });
}

// ─── Chat (SSE streaming) ─────────────────────────────────────────────────────

export interface ChatCallbacks {
  onMeta: (conversationId: number) => void;
  onDelta: (text: string) => void;
  onDone: (sources: Source[]) => void;
  onError: (msg: string) => void;
}

export async function sendChat(
  notebookId: number,
  message: string,
  conversationId: number | null,
  callbacks: ChatCallbacks
) {
  const t = token();
  const res = await fetch(`${BASE}/api/notebooks/${notebookId}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(t ? { 'X-Session-Token': t } : {}),
    },
    body: JSON.stringify({ message, conversation_id: conversationId }),
  });

  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    callbacks.onError(body.error ?? `HTTP ${res.status}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const evt = JSON.parse(line.slice(6));
        if (evt.type === 'meta') callbacks.onMeta(evt.conversation_id);
        else if (evt.type === 'delta') callbacks.onDelta(evt.content);
        else if (evt.type === 'done') callbacks.onDone(evt.sources ?? []);
        else if (evt.type === 'error') callbacks.onError(evt.message);
      } catch {}
    }
  }
}

// ─── Conversations ────────────────────────────────────────────────────────────

export async function getConversations(notebookId: number) {
  return request<{ conversations: Conversation[] }>(`/api/notebooks/${notebookId}/conversations`);
}

export async function getMessages(conversationId: number) {
  return request<{ messages: Message[] }>(`/api/conversations/${conversationId}/messages`);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface User { id: number; username: string; role: string; }
export interface Notebook { id: number; name: string; description: string | null; document_count: number; created_at: string; }
export interface Document { id: number; notebook_id: number; name: string; type: string; source: string | null; chunk_count: number; created_at: string; }
export interface Conversation { id: number; notebook_id: number; title: string | null; message_count: number; created_at: string; }
export interface Message { id: number; conversation_id: number; role: 'user' | 'assistant'; content: string; sources: Source[] | null; created_at: string; }
export interface Source { chunk_id: number; document_name: string; page_number: number | null; excerpt: string; similarity: number; }
