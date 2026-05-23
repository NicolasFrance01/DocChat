'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  getDocuments, uploadDocument, ingestUrl, deleteDocument,
  getConversations, getMessages, sendChat,
  type Document, type Message, type Source,
} from '@/lib/api';

export default function NotebookPage() {
  const { id } = useParams<{ id: string }>();
  const notebookId = Number(id);
  const router = useRouter();

  // Documents
  const [docs, setDocs] = useState<Document[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [urlLoading, setUrlLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Chat
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState('');
  const [sources, setSources] = useState<Source[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!localStorage.getItem('docchat_token')) { router.replace('/login'); return; }
    loadDocs();
  }, [notebookId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamBuffer]);

  async function loadDocs() {
    try {
      const data = await getDocuments(notebookId);
      setDocs(data.documents);
    } catch { router.replace('/login'); }
    finally { setDocsLoading(false); }
  }

  // ── Upload file ──────────────────────────────────────────────────────────────
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadProgress(0);
    try {
      const data = await uploadDocument(notebookId, file, setUploadProgress);
      setDocs(prev => [data.document, ...prev]);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error al subir');
    } finally {
      setUploadProgress(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  // ── Ingest URL ───────────────────────────────────────────────────────────────
  async function handleUrlIngest(e: React.FormEvent) {
    e.preventDefault();
    if (!urlInput.trim()) return;
    setUrlLoading(true);
    try {
      const data = await ingestUrl(notebookId, urlInput.trim());
      setDocs(prev => [data.document, ...prev]);
      setUrlInput('');
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error al ingestar URL');
    } finally {
      setUrlLoading(false);
    }
  }

  // ── Delete document ──────────────────────────────────────────────────────────
  async function handleDeleteDoc(docId: number) {
    if (!confirm('¿Eliminar este documento?')) return;
    await deleteDocument(docId);
    setDocs(prev => prev.filter(d => d.id !== docId));
  }

  // ── Send chat ────────────────────────────────────────────────────────────────
  async function handleSend() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    setSources([]);

    const userMsg: Message = {
      id: Date.now(),
      conversation_id: conversationId ?? 0,
      role: 'user',
      content: text,
      sources: null,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setStreaming(true);
    setStreamBuffer('');

    await sendChat(notebookId, text, conversationId, {
      onMeta: (cid) => setConversationId(cid),
      onDelta: (delta) => setStreamBuffer(prev => prev + delta),
      onDone: (srcs) => {
        setSources(srcs);
        setStreamBuffer(prev => {
          const assistantMsg: Message = {
            id: Date.now() + 1,
            conversation_id: conversationId ?? 0,
            role: 'assistant',
            content: prev,
            sources: srcs,
            created_at: new Date().toISOString(),
          };
          setMessages(m => [...m, assistantMsg]);
          return '';
        });
        setStreaming(false);
      },
      onError: (msg) => {
        setStreamBuffer('');
        setMessages(m => [...m, {
          id: Date.now() + 1,
          conversation_id: conversationId ?? 0,
          role: 'assistant',
          content: `Error: ${msg}`,
          sources: null,
          created_at: new Date().toISOString(),
        }]);
        setStreaming(false);
      },
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  function newConversation() {
    setConversationId(null);
    setMessages([]);
    setSources([]);
    setStreamBuffer('');
  }

  const typeIcon: Record<string, string> = { pdf: '📄', docx: '📝', txt: '📃', url: '🔗' };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        <button onClick={() => router.push('/notebooks')} className="text-gray-400 hover:text-gray-700 transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </button>
        <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <span className="font-semibold text-gray-900">DocChat</span>
        <span className="text-gray-300 text-lg">/</span>
        <span className="text-gray-600 text-sm">Notebook #{notebookId}</span>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left sidebar: Documents ─────────────────────────────────────────── */}
        <aside className="w-72 bg-white border-r border-gray-200 flex flex-col">
          <div className="p-4 border-b border-gray-100">
            <h3 className="font-semibold text-sm text-gray-900 mb-3">Documentos</h3>

            {/* Upload file */}
            <input ref={fileRef} type="file" accept=".pdf,.docx,.doc,.txt,.md" className="hidden" onChange={handleFileChange} />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploadProgress !== null}
              className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-gray-300 hover:border-indigo-400 rounded-lg py-2.5 text-sm text-gray-500 hover:text-indigo-600 transition-colors disabled:opacity-50"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              {uploadProgress !== null ? `Subiendo ${uploadProgress}%...` : 'Subir PDF / DOCX / TXT'}
            </button>

            {uploadProgress !== null && (
              <div className="mt-2 bg-gray-100 rounded-full h-1.5">
                <div className="bg-indigo-600 h-1.5 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
              </div>
            )}

            {/* URL ingest */}
            <form onSubmit={handleUrlIngest} className="mt-2 flex gap-1.5">
              <input
                type="url"
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                placeholder="https://..."
                className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="submit"
                disabled={urlLoading}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors"
              >
                {urlLoading ? '...' : 'URL'}
              </button>
            </form>
          </div>

          {/* Doc list */}
          <div className="flex-1 overflow-y-auto p-2">
            {docsLoading ? (
              <div className="flex justify-center py-6">
                <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : docs.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">Sin documentos todavía</p>
            ) : (
              docs.map(doc => (
                <div key={doc.id} className="flex items-start gap-2 px-2 py-2 rounded-lg hover:bg-gray-50 group">
                  <span className="text-base leading-none mt-0.5">{typeIcon[doc.type] ?? '📄'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-800 truncate">{doc.name}</p>
                    <p className="text-xs text-gray-400">
                      {doc.chunk_count > 0 ? `${doc.chunk_count} fragmentos` : 'procesando…'}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDeleteDoc(doc.id)}
                    className="text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 mt-0.5"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* ── Main: Chat ──────────────────────────────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Chat toolbar */}
          <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between">
            <span className="text-sm text-gray-500">
              {conversationId ? `Conversación #${conversationId}` : 'Nueva conversación'}
            </span>
            {messages.length > 0 && (
              <button onClick={newConversation} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium transition-colors">
                + Nueva conversación
              </button>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {messages.length === 0 && !streaming && (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-2">
                <svg className="w-10 h-10 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                <p className="text-sm font-medium">Hacé una pregunta sobre tus documentos</p>
                <p className="text-xs">Subí al menos un documento para empezar</p>
              </div>
            )}

            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-indigo-600 text-white rounded-br-sm'
                    : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm shadow-sm'
                }`}>
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                  {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
                      {msg.sources.map((s, i) => (
                        <p key={i} className="text-xs text-gray-400">
                          📎 {s.document_name}{s.page_number ? ` · p.${s.page_number}` : ''} · {Math.round(s.similarity * 100)}%
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Streaming bubble */}
            {streaming && (
              <div className="flex justify-start">
                <div className="max-w-[75%] bg-white border border-gray-200 rounded-2xl rounded-bl-sm px-4 py-3 text-sm shadow-sm">
                  {streamBuffer ? (
                    <p className="whitespace-pre-wrap text-gray-800">{streamBuffer}<span className="inline-block w-1.5 h-4 bg-indigo-500 ml-0.5 animate-pulse rounded-sm" /></p>
                  ) : (
                    <div className="flex gap-1 items-center py-1">
                      <span className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  )}
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="bg-white border-t border-gray-200 p-3">
            {sources.length > 0 && (
              <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
                {sources.map((s, i) => (
                  <span key={i} className="flex-shrink-0 text-xs bg-indigo-50 text-indigo-700 rounded-full px-2.5 py-1 border border-indigo-100">
                    {s.document_name}{s.page_number ? ` p.${s.page_number}` : ''}
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2 items-end">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Preguntá sobre tus documentos… (Enter para enviar)"
                rows={1}
                className="flex-1 border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none max-h-32"
                style={{ height: 'auto' }}
                onInput={e => {
                  const t = e.currentTarget;
                  t.style.height = 'auto';
                  t.style.height = `${t.scrollHeight}px`;
                }}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || streaming}
                className="flex-shrink-0 w-10 h-10 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-xl flex items-center justify-center transition-colors"
              >
                {streaming ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                )}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1.5 text-center">Enter para enviar · Shift+Enter para nueva línea</p>
          </div>
        </main>
      </div>
    </div>
  );
}
