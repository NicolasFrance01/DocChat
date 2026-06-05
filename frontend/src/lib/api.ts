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
  const mergedHeaders: Record<string, string> = { ...headers(), ...(init.headers as Record<string, string> ?? {}) };
  
  if (init.body && typeof init.body === 'string' && !mergedHeaders['Content-Type']) {
    mergedHeaders['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: mergedHeaders,
  });
  if (res.status === 401) {
    localStorage.removeItem('docchat_token');
    localStorage.removeItem('docchat_user');
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
  localStorage.setItem('docchat_user', JSON.stringify(data.user));
  return data;
}

export async function logout() {
  await request('/api/auth/logout', { method: 'POST' }).catch(() => {});
  localStorage.removeItem('docchat_token');
  localStorage.removeItem('docchat_user');
}

export async function getMe() {
  return request<{ user: User }>('/api/users/me');
}

export async function changePassword(newPassword: string) {
  return request('/api/users/change-password', {
    method: 'POST',
    body: JSON.stringify({ newPassword }),
  });
}

// ─── Admin Dashboard ──────────────────────────────────────────────────────────

export async function getUsers() {
  return request<{ users: UserAdmin[] }>('/api/admin/users');
}

export async function createUser(username: string, password: string, role: string, fullName: string) {
  return request<{ user: User }>('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({ username, password, role, fullName }),
  });
}

export async function deleteUser(id: number) {
  return request(`/api/admin/users/${id}`, { method: 'DELETE' });
}

export async function resetUserPassword(id: number, newPassword: string) {
  return request(`/api/admin/users/${id}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ newPassword }),
  });
}


export async function getActivities() {
  return request<{ activities: Activity[] }>('/api/admin/activities');
}

// ─── User Search Autocomplete ─────────────────────────────────────────────────

export async function searchUsers(q: string) {
  return request<{ users: User[] }>(`/api/users/search?q=${encodeURIComponent(q)}`);
}

// ─── Notebooks ────────────────────────────────────────────────────────────────

export async function getNotebooks() {
  return request<{ notebooks: Notebook[] }>('/api/notebooks');
}

export async function createNotebook(name: string, description?: string, aiAssistantEnabled?: boolean) {
  return request<{ notebook: Notebook }>('/api/notebooks', {
    method: 'POST',
    body: JSON.stringify({ name, description, ai_assistant_enabled: aiAssistantEnabled }),
  });
}

export async function deleteNotebook(id: number) {
  return request(`/api/notebooks/${id}`, { method: 'DELETE' });
}

export async function updateNotebook(id: number, name: string, description?: string, aiAssistantEnabled?: boolean) {
  return request<{ notebook: Notebook }>(`/api/notebooks/${id}`, {
    method: 'POST',
    body: JSON.stringify({ name, description, ai_assistant_enabled: aiAssistantEnabled }),
  });
}

export async function reorderNotebookDocuments(notebookId: number, order: number[]) {
  return request<{ ok: boolean }>(`/api/notebooks/${notebookId}/reorder`, {
    method: 'POST',
    body: JSON.stringify({ order }),
  });
}

export async function reorderTree(notebookId: number, items: { id: number, type: 'folder' | 'document', parentId: number | null, sortOrder: number }[], documentOrder?: number[]) {
  return request<{ ok: boolean }>(`/api/notebooks/${notebookId}/reorder-tree`, {
    method: 'PUT',
    body: JSON.stringify({ items, documentOrder }),
  });
}

export async function suggestOptimalOrder(notebookId: number) {
  return request<{ order: number[]; explanation: string }>(`/api/notebooks/${notebookId}/suggest-order`, {
    method: 'POST',
  });
}

// ─── Notebook Access Control & Invitations ────────────────────────────────────

export async function getNotebookUsers(notebookId: number) {
  return request<{ users: NotebookUser[] }>(`/api/notebooks/${notebookId}/users`);
}

export async function addNotebookUser(notebookId: number, userId: number, role: string) {
  return request(`/api/notebooks/${notebookId}/users`, {
    method: 'POST',
    body: JSON.stringify({ userId, role }),
  });
}

export async function removeNotebookUser(notebookId: number, userId: number) {
  return request(`/api/notebooks/${notebookId}/users/${userId}`, { method: 'DELETE' });
}

export async function createInvitation(notebookId: number, role: string, expiresDays?: number) {
  return request<{ token: string }>(`/api/notebooks/${notebookId}/invitations`, {
    method: 'POST',
    body: JSON.stringify({ role, expiresDays }),
  });
}

export async function claimInvitation(token: string) {
  return request<{ ok: boolean; notebookId: number }>('/api/invitations/claim', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

// ─── Documents ────────────────────────────────────────────────────────────────

export async function getDocuments(notebookId: number) {
  return request<{ documents: Document[] }>(`/api/notebooks/${notebookId}/documents`);
}

export async function getDocument(id: number) {
  return request<{ document: DocumentText }>(`/api/documents/${id}`);
}

export async function uploadDocument(
  notebookId: number,
  file: File,
  folderId?: number | null,
  onProgress?: (pct: number) => void
) {
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

    const url = `/api/ingest/${notebookId}${folderId ? `?folder_id=${folderId}` : ''}`;
    xhr.open('POST', url);
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

export async function ingestVideo(notebookId: number, name: string, embedCode: string, folderId?: number | null) {
  return request<{ document: Document }>(`/api/notebooks/${notebookId}/documents/video`, {
    method: 'POST',
    body: JSON.stringify({ name, embed_code: embedCode, folder_id: folderId }),
  });
}

export async function updateVideoTranscription(docId: number, transcription: string) {
  return request<{ ok: boolean }>(`/api/documents/${docId}/transcription`, {
    method: 'POST',
    body: JSON.stringify({ transcription }),
  });
}

export async function uploadVideoTranscriptionFile(docId: number, file: File) {
  return new Promise<{ ok: boolean }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const t = token();

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

    xhr.open('POST', `/api/documents/${docId}/transcription/file`);
    if (t) xhr.setRequestHeader('X-Session-Token', t);
    xhr.send(form);
  });
}

export async function deleteDocument(id: number) {
  return request(`/api/documents/${id}`, { method: 'DELETE' });
}

// ─── Folders ──────────────────────────────────────────────────────────────────

export interface Folder {
  id: number;
  notebook_id: number;
  parent_id: number | null;
  name: string;
  sort_order: number;
  quiz_enabled: boolean;
  created_at: string;
}

export async function updateFolderQuizSettings(notebookId: number, folderId: number, quizEnabled: boolean) {
  return request(`/api/notebooks/${notebookId}/folders/${folderId}/quiz`, {
    method: 'PUT',
    body: JSON.stringify({ quiz_enabled: quizEnabled }),
  });
}

export async function getFolders(notebookId: number) {
  return request<{ folders: Folder[] }>(`/api/notebooks/${notebookId}/folders`);
}

export async function createFolder(notebookId: number, name: string, parentId: number | null) {
  return request<{ folder: Folder }>(`/api/notebooks/${notebookId}/folders`, {
    method: 'POST',
    body: JSON.stringify({ name, parent_id: parentId }),
  });
}

export async function deleteFolder(id: number) {
  return request(`/api/folders/${id}`, { method: 'DELETE' });
}

export async function moveDocument(id: number, folderId: number | null) {
  return request<{ document: Document }>(`/api/documents/${id}/move`, {
    method: 'POST',
    body: JSON.stringify({ folder_id: folderId }),
  });
}

export async function moveFolder(id: number, parentId: number | null) {
  return request<{ folder: Folder }>(`/api/folders/${id}/move`, {
    method: 'POST',
    body: JSON.stringify({ parent_id: parentId }),
  });
}

// ─── Chat (SSE streaming) ─────────────────────────────────────────────────────

export interface ChatCallbacks {
  onMeta: (conversationId: number) => void;
  onDelta: (text: string) => void;
  onDone: (sources: Source[], title?: string | null) => void;
  onError: (msg: string) => void;
}

export async function sendChat(
  notebookId: number,
  message: string,
  conversationId: number | null,
  parentId: number | null,
  documentIds: number[] | null,
  callbacks: ChatCallbacks
) {
  const t = token();
  const res = await fetch(`${BASE}/api/notebooks/${notebookId}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(t ? { 'X-Session-Token': t } : {}),
    },
    body: JSON.stringify({ message, conversation_id: conversationId, parent_id: parentId, document_ids: documentIds }),
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
        else if (evt.type === 'done') callbacks.onDone(evt.sources ?? [], evt.title);
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

// ─── Learning / LMS Methods ───────────────────────────────────────────────────

export async function getNotebookProgress(notebookId: number) {
  return request<NotebookProgressResponse>(`/api/notebooks/${notebookId}/progress`);
}

export async function markDocumentRead(docId: number, checked: boolean) {
  return request<{ ok: boolean }>(`/api/documents/${docId}/read`, {
    method: 'POST',
    body: JSON.stringify({ checked }),
  });
}

export async function getFolderQuiz(notebookId: number, folderId: number) {
  return request<QuizResponse>(`/api/notebooks/${notebookId}/folders/${folderId}/quiz`);
}

export async function submitFolderQuiz(notebookId: number, folderId: number, answers: string[]) {
  return request<QuizSubmitResponse>(`/api/notebooks/${notebookId}/folders/${folderId}/quiz/submit`, {
    method: 'POST',
    body: JSON.stringify({ answers }),
  });
}

export interface QuizAttempt {
  id: number;
  user_id: number;
  full_name: string;
  username: string;
  quiz_type: string;
  target_id: number;
  score: number;
  passed: boolean;
  created_at: string;
  folder_name: string | null;
  details: {
    questionIndex: number;
    question: string;
    selectedOption: string;
    correctOption: string;
    isCorrect: boolean;
    explanation: string;
  }[];
}

export async function getAttempts(notebookId: number) {
  return request<{ attempts: QuizAttempt[] }>(`/api/notebooks/${notebookId}/attempts`);
}

export async function getFinalExam(notebookId: number) {
  return request<FinalExamResponse>(`/api/notebooks/${notebookId}/final-exam`);
}

export async function submitFinalExam(notebookId: number, answers: string[]) {
  return request<QuizSubmitResponse>(`/api/notebooks/${notebookId}/final-exam/submit`, {
    method: 'POST',
    body: JSON.stringify({ answers }),
  });
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface User { id: number; username: string; role: string; full_name: string | null; password_changed: boolean; user_created_at?: string; }
export interface UserAdmin { id: number; username: string; role: string; full_name: string | null; password_changed: boolean; status: string; created_at: string; }
export interface Activity { id: number; user_id: number | null; username: string; action: string; notebook_id: number | null; notebook_name: string | null; document_id: number | null; document_name: string | null; details: string | null; created_at: string; }
export interface NotebookUser { user_id: number; role: string; username: string; full_name: string | null; }
export interface Notebook { id: number; user_id: number; name: string; description: string | null; document_count: number; created_at: string; ai_assistant_enabled?: boolean; document_order?: number[]; }
export interface Document { id: number; notebook_id: number; folder_id: number | null; name: string; type: string; source: string | null; chunk_count: number; sort_order: number; created_at: string; }
export interface DocumentText extends Document { raw_text: string | null; }
export interface Conversation { id: number; notebook_id: number; title: string | null; message_count: number; created_at: string; }
export interface Message { id: number; conversation_id: number; role: 'user' | 'assistant'; content: string; sources: Source[] | null; parent_id: number | null; created_at: string; }
export interface Source { chunk_id: number; document_id?: number; document_name: string; page_number: number | null; excerpt: string; similarity: number; folder_path?: string; }

export interface DocumentProgress {
  document_id: number;
  read_checked: boolean;
  quiz_passed: boolean;
  score: number | null;
  completed_at: string | null;
}

export interface FolderProgress {
  folder_id: number;
  quiz_passed: boolean;
  score: number | null;
  completed_at: string | null;
}

export interface NotebookProgressResponse {
  progress: DocumentProgress[];
  folder_progress: FolderProgress[];
  document_order: number[];
  ai_assistant_enabled: boolean;
  final_exam: { passed: boolean; score: number } | null;
}

export interface QuizQuestion {
  question: string;
  options: string[];
}

export interface QuizResponse {
  quiz: {
    document_id: number;
    questions: QuizQuestion[];
  };
}

export interface QuizSubmitResponse {
  passed: boolean;
  score: number;
  total: number;
  feedback: {
    questionIndex: number;
    userAnswer: string;
    correctAnswer: string;
    isCorrect: boolean;
    explanation: string;
  }[];
}

export interface FinalExamResponse {
  exam: {
    notebook_id: number;
    questions: QuizQuestion[];
  };
}


