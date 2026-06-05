'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  getDocuments, getDocument, uploadDocument, ingestUrl, ingestVideo, updateVideoTranscription, uploadVideoTranscriptionFile, deleteDocument,
  getConversations, getMessages, sendChat,
  searchUsers, getNotebookUsers, addNotebookUser, removeNotebookUser, createInvitation, changePassword,
  getNotebookProgress, markDocumentRead, getFolderQuiz, submitFolderQuiz, getFinalExam, submitFinalExam,
  reorderNotebookDocuments, suggestOptimalOrder,
  getFolders, createFolder, deleteFolder, moveDocument, moveFolder, reorderTree, updateFolderQuizSettings,
  type Document, type Message, type Source, type User, type NotebookUser, type Conversation,
  type DocumentProgress, type QuizQuestion, type Folder, type QuizAttempt, getAttempts
} from '@/lib/api';

export default function NotebookPage() {
  const { id } = useParams<{ id: string }>();
  const notebookId = Number(id);
  const router = useRouter();

  // Logged User
  const [me, setMe] = useState<User | null>(null);

  // Warning Banner
  const [passwordChangedState, setPasswordChangedState] = useState(true);

  // Profile Modal State
  const [showProfile, setShowProfile] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');
  const [profileError, setProfileError] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);

  // Notebook metadata / allowed checks
  const [isCreator, setIsCreator] = useState(false);

  // Documents state
  const [docs, setDocs] = useState<Document[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [modalUploadProgress, setModalUploadProgress] = useState<number | null>(null);
  const modalFileRef = useRef<HTMLInputElement>(null);
  const [urlInput, setUrlInput] = useState('');
  const [urlLoading, setUrlLoading] = useState(false);
  const [videoName, setVideoName] = useState('');
  const [videoCode, setVideoCode] = useState('');
  const [videoLoading, setVideoLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Active Document Context Selection (Checkboxes)
  const [selectedDocs, setSelectedDocs] = useState<Record<number, boolean>>({});

  // Conversations history sidebar
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convsLoading, setConvsLoading] = useState(true);
  const [conversationId, setConversationId] = useState<number | null>(null);

  // Chat tree branching state
  const [allMessages, setAllMessages] = useState<Message[]>([]); // holds all dialogue nodes
  const [renderedMessages, setRenderedMessages] = useState<Message[]>([]); // active branch messages
  const [selectedVersions, setSelectedVersions] = useState<Record<number, number>>({}); // parentId -> active child index
  const [editingMsgId, setEditingMsgId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');

  // General Chat state
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState('');
  const [sources, setSources] = useState<Source[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Share ACL Modal State
  const [showShareModal, setShowShareModal] = useState(false);
  const [sharedUsers, setSharedUsers] = useState<NotebookUser[]>([]);
  const [sharedUsersLoading, setSharedUsersLoading] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSearchResults, setUserSearchResults] = useState<User[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [invitePermission, setInvitePermission] = useState('user');
  const [generatedInviteLink, setGeneratedInviteLink] = useState('');
  const [inviteLinkLoading, setInviteLinkLoading] = useState(false);

  // Document Viewer Sidebar (Right Drawer)
  const [viewerDoc, setViewerDoc] = useState<Document | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [viewerText, setViewerText] = useState<string>('');
  const [viewerPages, setViewerPages] = useState<{ pageNumber: number | null; text: string }[]>([]);
  const [viewerSearch, setViewerSearch] = useState('');
  const [viewerHighlightPage, setViewerHighlightPage] = useState<number | null>(null);
  const [activeViewerTab, setActiveViewerTab] = useState<'content' | 'transcript'>('content');
  const [editingTranscript, setEditingTranscript] = useState(false);
  const [transcriptDraft, setTranscriptDraft] = useState('');
  const [transcriptSaving, setTranscriptSaving] = useState(false);
  const transcriptFileRef = useRef<HTMLInputElement>(null);
  const [transcriptUploading, setTranscriptUploading] = useState(false);
  const [chatWidth, setChatWidth] = useState(450);

  // Citation Detail Modal
  const [activeCitation, setActiveCitation] = useState<Source | null>(null);

  // LMS Learning Mode States
  const [aiAssistantEnabled, setAiAssistantEnabled] = useState(false);
  const [documentOrder, setDocumentOrder] = useState<number[]>([]);
  const [userProgress, setUserProgress] = useState<Record<number, DocumentProgress>>({});
  const [userFolderProgress, setUserFolderProgress] = useState<Record<number, any>>({});
  const [finalExamStatus, setFinalExamStatus] = useState<{ passed: boolean; score: number } | null>(null);

  // Course Reordering States
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [modalFolderId, setModalFolderId] = useState<number | null>(null);
  const [stagedFolders, setStagedFolders] = useState<Folder[]>([]);
  const [stagedDocs, setStagedDocs] = useState<Document[]>([]);
  const [showTreeVideoModal, setShowTreeVideoModal] = useState(false);
  const [treeVideoName, setTreeVideoName] = useState('');
  const [treeVideoCode, setTreeVideoCode] = useState('');
  const [treeVideoLoading, setTreeVideoLoading] = useState(false);
  const [suggestingOrder, setSuggestingOrder] = useState(false);
  const [suggestedExplanation, setSuggestedExplanation] = useState('');
  const [reorderLoading, setReorderLoading] = useState(false);

  // Quiz Modal States
  const [showQuizModal, setShowQuizModal] = useState(false);
  const [showAttemptsModal, setShowAttemptsModal] = useState(false);
  const [attemptsList, setAttemptsList] = useState<QuizAttempt[]>([]);
  const [attemptsLoading, setAttemptsLoading] = useState(false);
  const [attemptsSearch, setAttemptsSearch] = useState('');
  const [selectedAttempt, setSelectedAttempt] = useState<QuizAttempt | null>(null);
  const [quizDocId, setQuizDocId] = useState<number | null>(null);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [quizAnswers, setQuizAnswers] = useState<string[]>(['', '', '']);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizSubmitting, setQuizSubmitting] = useState(false);
  const [quizFeedback, setQuizFeedback] = useState<any[] | null>(null);
  const [quizError, setQuizError] = useState('');

  // Final Exam Modal States
  const [showFinalExamModal, setShowFinalExamModal] = useState(false);
  const [finalExamQuestions, setFinalExamQuestions] = useState<QuizQuestion[]>([]);
  const [finalExamAnswers, setFinalExamAnswers] = useState<string[]>(['', '', '', '', '']);
  const [finalExamLoading, setFinalExamLoading] = useState(false);
  const [finalExamSubmitting, setFinalExamSubmitting] = useState(false);
  const [finalExamFeedback, setFinalExamFeedback] = useState<any[] | null>(null);
  const [finalExamError, setFinalExamError] = useState('');

  // Folder Navigation States
  const [viewMode, setViewMode] = useState<'flat' | 'folders'>('flat');
  const [folders, setFolders] = useState<Folder[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);

  const [movingFolderId, setMovingFolderId] = useState<number | null>(null);

  // Create Folder Modal State
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);

  async function loadFolders() {
    try {
      const foldersData = await getFolders(notebookId);
      setFolders(foldersData.folders);
    } catch (err) {
      console.error('Error al cargar carpetas:', err);
    }
  }

  async function handleCreateFolder() {
    if (!newFolderName.trim()) return;
    setCreatingFolder(true);
    try {
      const targetFolderId = showOrderModal ? modalFolderId : currentFolderId;
      const res = await createFolder(notebookId, newFolderName.trim(), targetFolderId);
      
      // If modal is open, we need to show the new folder there immediately
      if (showOrderModal) {
        setStagedFolders(prev => [...prev, { ...res.folder, sort_order: stagedFolders.length }]);
      }
      
      setFolders(prev => [...prev, res.folder]);
      setShowFolderModal(false);
      setNewFolderName('');
    } catch (err: any) {
      alert(err.message || 'Error al crear carpeta');
    } finally {
      setCreatingFolder(false);
    }
  }

  async function handleDeleteFolder(folderId: number) {
    if (!confirm('¿Eliminar esta carpeta? Se eliminarán todas sus subcarpetas. Los documentos contenidos volverán a la raíz.')) return;
    try {
      await deleteFolder(folderId);
      setFolders(prev => prev.filter(f => f.id !== folderId));
      setDocs(prev => prev.map(d => d.folder_id === folderId ? { ...d, folder_id: null } : d));
      if (currentFolderId === folderId) {
        setCurrentFolderId(null);
      }
    } catch (err: any) {
      alert(err.message || 'Error al eliminar carpeta');
    }
  }

  async function handleToggleFolderQuiz(folderId: number) {
    const folder = folders.find(f => f.id === folderId) || stagedFolders.find(f => f.id === folderId);
    if (!folder) return;
    const nextVal = !folder.quiz_enabled;
    try {
      await updateFolderQuizSettings(notebookId, folderId, nextVal);
      setFolders(prev => prev.map(f => f.id === folderId ? { ...f, quiz_enabled: nextVal } : f));
      setStagedFolders(prev => prev.map(f => f.id === folderId ? { ...f, quiz_enabled: nextVal } : f));
    } catch (err: any) {
      alert(err.message || 'Error al actualizar settings de quiz para la carpeta');
    }
  }

  async function handleMoveDoc(docId: number, targetFolderId: number | null) {
    try {
      await moveDocument(docId, targetFolderId);
      setDocs(prev => prev.map(d => d.id === docId ? { ...d, folder_id: targetFolderId } : d));
    } catch (err: any) {
      alert(err.message || 'Error al mover documento');
    }
  }

  async function handleMoveFolder(folderId: number, targetParentId: number | null) {
    try {
      await moveFolder(folderId, targetParentId);
      setFolders(prev => prev.map(f => f.id === folderId ? { ...f, parent_id: targetParentId } : f));
      setMovingFolderId(null);
    } catch (err: any) {
      alert(err.message || 'Error al mover carpeta');
    }
  }

  function getFolderPathString(folderId: number): string {
    const segments: string[] = [];
    let currId: number | null = folderId;
    const visited = new Set();
    
    while (currId) {
      if (visited.has(currId)) break;
      visited.add(currId);
      const folder = folders.find(f => f.id === currId);
      if (!folder) break;
      segments.unshift(folder.name);
      currId = folder.parent_id;
    }
    return segments.join(' / ');
  }

  function getBreadcrumbs(folderId: number | null, folderList: Folder[]) {
    if (!folderId) return [{ id: null, name: 'Inicio' }];
    const crumbs: { id: number | null; name: string }[] = [];
    let currId: number | null = folderId;
    const visited = new Set();
    
    while (currId) {
      if (visited.has(currId)) break;
      visited.add(currId);
      
      const folder = folderList.find(f => f.id === currId);
      if (!folder) break;
      crumbs.unshift({ id: folder.id, name: folder.name });
      currId = folder.parent_id;
    }
    crumbs.unshift({ id: null, name: 'Inicio' });
    return crumbs;
  }

  // Combined Items for Main View
  const mainCombinedItems = [
    ...folders.filter(f => f.parent_id === currentFolderId).map(f => ({ ...f, itemType: 'folder' as const })),
    ...docs.filter(d => d.folder_id === currentFolderId).map(d => ({ ...d, itemType: 'document' as const }))
  ].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  // Combined Items for Modal View
  const modalCombinedItems = [
    ...stagedFolders.filter(f => f.parent_id === modalFolderId).map(f => ({ ...f, itemType: 'folder' as const })),
    ...stagedDocs.filter(d => d.folder_id === modalFolderId).map(d => ({ ...d, itemType: 'document' as const }))
  ].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));


  useEffect(() => {
    const token = localStorage.getItem('docchat_token');
    const userStr = localStorage.getItem('docchat_user');
    if (!token || !userStr) {
      router.replace('/login');
      return;
    }
    const userObj = JSON.parse(userStr) as User;
    setMe(userObj);
    setPasswordChangedState(userObj.password_changed);
    loadDocs();
    loadConvs();
  }, [notebookId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [renderedMessages, streamBuffer]);

  // Re-render conversation history path whenever selected versions or complete messages set updates
  useEffect(() => {
    if (allMessages.length === 0) {
      setRenderedMessages([]);
      return;
    }
    
    // Group children by parent_id
    const childrenMap: Record<string, Message[]> = {};
    allMessages.forEach(m => {
      const pid = m.parent_id === null ? 'root' : m.parent_id.toString();
      if (!childrenMap[pid]) childrenMap[pid] = [];
      childrenMap[pid].push(m);
    });

    const activePath: Message[] = [];
    let currentParent = 'root';

    while (childrenMap[currentParent] && childrenMap[currentParent].length > 0) {
      const siblings = childrenMap[currentParent];
      siblings.sort((a, b) => a.id - b.id); // sort by creation ID

      // Determine which version/sibling is selected
      const selectKey = Number(currentParent === 'root' ? 0 : currentParent);
      const selectedIdx = selectedVersions[selectKey] ?? (siblings.length - 1);
      const chosen = siblings[selectedIdx] || siblings[siblings.length - 1];

      activePath.push(chosen);
      currentParent = chosen.id.toString();
    }

    setRenderedMessages(activePath);
  }, [allMessages, selectedVersions]);

  // ── Course Reordering Handlers ─────────────────────────────────────────────
  function handleOpenReorderModal() {
    setStagedFolders(JSON.parse(JSON.stringify(folders)));
    setStagedDocs(JSON.parse(JSON.stringify(docs)));
    setModalFolderId(null);
    setSuggestedExplanation('');
    setShowOrderModal(true);
  }

  function handleMoveModalItem(index: number, direction: 'up' | 'down') {
    const nextIndex = direction === 'up' ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= modalCombinedItems.length) return;

    const newCombined = [...modalCombinedItems];
    newCombined.forEach((item, i) => item.sort_order = i);

    const temp = newCombined[index].sort_order;
    newCombined[index].sort_order = newCombined[nextIndex].sort_order;
    newCombined[nextIndex].sort_order = temp;

    const updatedFolders = [...stagedFolders];
    const updatedDocs = [...stagedDocs];
    
    newCombined.forEach(item => {
      if (item.itemType === 'folder') {
        const idx = updatedFolders.findIndex(f => f.id === item.id);
        if (idx !== -1) updatedFolders[idx].sort_order = item.sort_order;
      } else {
        const idx = updatedDocs.findIndex(d => d.id === item.id);
        if (idx !== -1) updatedDocs[idx].sort_order = item.sort_order;
      }
    });

    setStagedFolders(updatedFolders);
    setStagedDocs(updatedDocs);
  }

  async function handleModalDrop(dragId: number, dragType: 'document' | 'folder', targetFolderId: number | null) {
    if (dragType === 'folder' && dragId === targetFolderId) return;

    const updatedFolders = [...stagedFolders];
    const updatedDocs = [...stagedDocs];

    if (dragType === 'folder') {
      const idx = updatedFolders.findIndex(f => f.id === dragId);
      if (idx !== -1) updatedFolders[idx].parent_id = targetFolderId;
    } else {
      const idx = updatedDocs.findIndex(d => d.id === dragId);
      if (idx !== -1) updatedDocs[idx].folder_id = targetFolderId;
    }
    
    setStagedFolders(updatedFolders);
    setStagedDocs(updatedDocs);
  }

  async function handleAISuggestOrder() {
    setSuggestingOrder(true);
    setSuggestedExplanation('');
    try {
      const data = await suggestOptimalOrder(notebookId);
      const updatedDocs = [...stagedDocs];
      data.order.forEach((docId, index) => {
        const docIdx = updatedDocs.findIndex(d => d.id === docId);
        if (docIdx !== -1 && updatedDocs[docIdx].folder_id === modalFolderId) {
           updatedDocs[docIdx].sort_order = index;
        }
      });
      setStagedDocs(updatedDocs);
      setSuggestedExplanation(data.explanation);
    } catch (err: any) {
      alert(err.message || 'Error al obtener sugerencias de la IA');
    } finally {
      setSuggestingOrder(false);
    }
  }

  async function handleSaveReorder() {
    setReorderLoading(true);
    try {
      const items = [
        ...stagedFolders.map(f => ({ id: f.id, type: 'folder' as const, parentId: f.parent_id, sortOrder: f.sort_order || 0, quizEnabled: !!f.quiz_enabled })),
        ...stagedDocs.map(d => ({ id: d.id, type: 'document' as const, parentId: d.folder_id, sortOrder: d.sort_order || 0 }))
      ];

      const computedOrder: number[] = [];
      const traverse = (folderId: number | null) => {
        const children = [
          ...stagedFolders.filter(f => f.parent_id === folderId).map(f => ({ ...f, itemType: 'folder' })),
          ...stagedDocs.filter(d => d.folder_id === folderId).map(d => ({ ...d, itemType: 'document' }))
        ].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        
        for (const child of children) {
          if (child.itemType === 'document') computedOrder.push(child.id);
          else traverse(child.id);
        }
      };
      traverse(null);

      await reorderTree(notebookId, items, computedOrder);
      
      setDocumentOrder(computedOrder);
      setFolders(stagedFolders);
      setDocs(stagedDocs);
      setShowOrderModal(false);
    } catch (err: any) {
      alert(err.message || 'Error al guardar el nuevo orden.');
    } finally {
      setReorderLoading(false);
    }
  }

  async function handleIngestTreeVideo(e: React.FormEvent) {
    e.preventDefault();
    if (!treeVideoName.trim() || !treeVideoCode.trim()) return;
    setTreeVideoLoading(true);
    try {
      const targetFolderId = modalFolderId;
      const data = await ingestVideo(notebookId, treeVideoName.trim(), treeVideoCode.trim(), targetFolderId);
      setDocs(prev => [data.document, ...prev]);
      setStagedDocs(prev => [...prev, { ...data.document, sort_order: stagedDocs.length }]);
      setTreeVideoName('');
      setTreeVideoCode('');
      setShowTreeVideoModal(false);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error al ingestar video');
    } finally {
      setTreeVideoLoading(false);
    }
  }

  // ── Loaders ────────────────────────────────────────────────────────────────
  async function loadDocs() {
    try {
      const data = await getDocuments(notebookId);
      
      // Cargar progreso del curso (LMS)
      let currentDocs = data.documents;
      try {
        const progressRes = await getNotebookProgress(notebookId);
        setAiAssistantEnabled(progressRes.ai_assistant_enabled);
        setDocumentOrder(progressRes.document_order || []);
        setFinalExamStatus(progressRes.final_exam);

        // Convertir array de progreso a mapa O(1) de busqueda rápida
        const progMap: Record<number, DocumentProgress> = {};
        progressRes.progress.forEach(p => {
          progMap[p.document_id] = p;
        });
        setUserProgress(progMap);

        const folderProgMap: Record<number, any> = {};
        if (progressRes.folder_progress) {
          progressRes.folder_progress.forEach((fp: any) => {
            folderProgMap[fp.folder_id] = fp;
          });
        }
        setUserFolderProgress(folderProgMap);

        // Si la IA está habilitada, ordenar los documentos según document_order
        if (progressRes.ai_assistant_enabled && progressRes.document_order && progressRes.document_order.length > 0) {
          currentDocs = [...data.documents].sort((a, b) => {
            const idxA = progressRes.document_order.indexOf(a.id);
            const idxB = progressRes.document_order.indexOf(b.id);
            if (idxA === -1 && idxB === -1) return 0;
            if (idxA === -1) return 1;
            if (idxB === -1) return -1;
            return idxA - idxB;
          });
        }
      } catch (err) {
        console.error('Error al cargar progreso del LMS:', err);
      }

      await loadFolders();
      setDocs(currentDocs);
      
      // Check if logged-in user is creator of this notebook
      const userStr = localStorage.getItem('docchat_user');
      if (userStr) {
        const meUser = JSON.parse(userStr) as User;
        if (meUser.role === 'admin') {
          setIsCreator(true);
        } else {
          // Check notebooks in list
          const { getNotebooks } = await import('@/lib/api');
          const nbs = await getNotebooks();
          const currentNotebook = nbs.notebooks.find(n => n.id === notebookId);
          if (currentNotebook) {
            setIsCreator(true);
          } else {
            setIsCreator(false);
          }
        }
      }
      
      // Default select all documents
      const defaults: Record<number, boolean> = {};
      currentDocs.forEach(d => { defaults[d.id] = true; });
      setSelectedDocs(defaults);
    } catch {
      router.replace('/login');
    } finally {
      setDocsLoading(false);
    }
  }

  async function loadConvs() {
    try {
      const data = await getConversations(notebookId);
      setConversations(data.conversations);
    } catch (err) {
      console.error(err);
    } finally {
      setConvsLoading(false);
    }
  }

  async function selectConversation(convId: number) {
    newConversation();
    setConversationId(convId);
    try {
      const data = await getMessages(convId);
      setAllMessages(data.messages);
      // Reset version switchers to defaults
      setSelectedVersions({});
    } catch (err: any) {
      alert(err.message || 'Error al cargar mensajes');
    }
  }

  // ── ACL sharing data loader ────────────────────────────────────────────────
  async function loadShareAcl() {
    setShowShareModal(true);
    setSharedUsersLoading(true);
    try {
      const usersData = await getNotebookUsers(notebookId);
      setSharedUsers(usersData.users);
    } catch (err: any) {
      alert(err.message || 'Error al cargar compartidos');
    } finally {
      setSharedUsersLoading(false);
    }
  }

  // User Autocomplete Search
  useEffect(() => {
    if (userSearchQuery.trim().length < 2) {
      setUserSearchResults([]);
      return;
    }
    const delayDebounce = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const results = await searchUsers(userSearchQuery);
        setUserSearchResults(results.users);
      } catch (err) {
        console.error(err);
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => clearTimeout(delayDebounce);
  }, [userSearchQuery]);

  async function handleAddNotebookUser(userId: number, role: string) {
    try {
      await addNotebookUser(notebookId, userId, role);
      setUserSearchQuery('');
      setUserSearchResults([]);
      // Reload sharing list
      const usersData = await getNotebookUsers(notebookId);
      setSharedUsers(usersData.users);
    } catch (err: any) {
      alert(err.message || 'Error al agregar usuario');
    }
  }

  async function handleRemoveNotebookUser(userId: number) {
    if (!confirm('¿Quitar acceso a este notebook para este usuario?')) return;
    try {
      await removeNotebookUser(notebookId, userId);
      setSharedUsers(prev => prev.filter(u => u.user_id !== userId));
    } catch (err: any) {
      alert(err.message || 'Error al remover acceso');
    }
  }

  async function handleCreateInvitationLink() {
    setInviteLinkLoading(true);
    try {
      const res = await createInvitation(notebookId, invitePermission, 30); // 30 days
      const claimUrl = `${window.location.origin}/notebooks/invite/${res.token}`;
      setGeneratedInviteLink(claimUrl);
    } catch (err: any) {
      alert(err.message || 'Error al crear enlace');
    } finally {
      setInviteLinkLoading(false);
    }
  }

  // ── Document Viewer Panel (Slide Drawer) ────────────────────────────────────
  async function handleOpenDocumentViewer(doc: Document) {
    setViewerDoc(doc);
    setViewerLoading(true);
    setViewerText('');
    setViewerPages([]);
    setViewerSearch('');
    setViewerHighlightPage(null);
    setActiveViewerTab('content');
    setEditingTranscript(false);
    try {
      const res = await getDocument(doc.id);
      const rawText = res.document.raw_text || 'Documento sin texto extraído.';
      setViewerText(rawText);

      // Split into pages based on delimiter
      const pageRegex = /--- PAGE_BREAK_P_(\d+) ---/g;
      const pagesList: { pageNumber: number | null; text: string }[] = [];
      let match;
      let lastIndex = 0;
      let currentPageNum: number | null = null;

      while ((match = pageRegex.exec(rawText)) !== null) {
        const matchIndex = match.index;
        if (matchIndex > lastIndex) {
          const segment = rawText.slice(lastIndex, matchIndex).trim();
          if (segment) {
            pagesList.push({ pageNumber: currentPageNum, text: segment });
          }
        }
        currentPageNum = parseInt(match[1], 10);
        lastIndex = pageRegex.lastIndex;
      }
      if (lastIndex < rawText.length) {
        const segment = rawText.slice(lastIndex).trim();
        if (segment) {
          pagesList.push({ pageNumber: currentPageNum, text: segment });
        }
      }
      if (pagesList.length === 0) {
        pagesList.push({ pageNumber: null, text: rawText });
      }
      setViewerPages(pagesList);
    } catch (err: any) {
      alert(err.message || 'Error al abrir visor');
      setViewerDoc(null);
    } finally {
      setViewerLoading(false);
    }
  }

  async function handleSaveTranscript() {
    if (!viewerDoc) return;
    setTranscriptSaving(true);
    try {
      await updateVideoTranscription(viewerDoc.id, transcriptDraft);
      setViewerText(transcriptDraft);
      setEditingTranscript(false);
      // Actualizamos el chunk count localmente para simular que se va a procesar
      setDocs(prev => prev.map(d => d.id === viewerDoc.id ? { ...d, chunk_count: 1 } : d));
    } catch (err: any) {
      alert(err.message || 'Error al guardar la transcripción');
    } finally {
      setTranscriptSaving(false);
    }
  }

  async function handleUploadTranscript(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !viewerDoc) return;
    setTranscriptUploading(true);
    try {
      await uploadVideoTranscriptionFile(viewerDoc.id, file);
      // Recargar el documento para ver la transcripción actualizada
      const res = await getDocument(viewerDoc.id);
      setViewerText(res.document.raw_text || '');
      setDocs(prev => prev.map(d => d.id === viewerDoc.id ? { ...d, chunk_count: 1 } : d));
    } catch (err: any) {
      alert(err.message || 'Error al subir el archivo de transcripción');
    } finally {
      setTranscriptUploading(false);
      if (transcriptFileRef.current) transcriptFileRef.current.value = '';
    }
  }

  function handleCitationClick(cite: Source) {
    // 1. Find matching document from docs list
    const matchedDoc = docs.find(d => d.name === cite.document_name);
    if (!matchedDoc) {
      // If document is deleted or not found, just show excerpt in citation modal
      setActiveCitation(cite);
      return;
    }

    // 2. Open viewer
    handleOpenDocumentViewer(matchedDoc).then(() => {
      // 3. Scroll to page element once viewer text is populated!
      if (cite.page_number) {
        setViewerHighlightPage(cite.page_number);
        setTimeout(() => {
          const el = document.getElementById(`viewer-page-${cite.page_number}`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 800);
      }
    });
  }

  // Helper to split document text into pages and highlight occurrences
  function renderViewerPageContent(text: string, search: string) {
    if (!search.trim()) return <p className="whitespace-pre-wrap leading-relaxed text-sm select-text text-gray-700">{text}</p>;

    // Regex to match search string safely
    const escaped = search.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    const parts = text.split(regex);

    return (
      <p className="whitespace-pre-wrap leading-relaxed text-sm select-text text-gray-700">
        {parts.map((part, i) => 
          regex.test(part) ? (
            <mark key={i} className="bg-yellow-200 text-gray-900 font-semibold rounded px-0.5">{part}</mark>
          ) : part
        )}
      </p>
    );
  }

  // ── LMS Cuestionarios y Evaluaciones ─────────────────────────────────────────

  async function handleOpenAttemptsModal() {
    setShowAttemptsModal(true);
    setAttemptsLoading(true);
    try {
      const res = await getAttempts(notebookId);
      setAttemptsList(res.attempts);
    } catch (err: any) {
      alert(err.message || 'Error al cargar intentos');
    } finally {
      setAttemptsLoading(false);
    }
  }

  async function handleLaunchQuiz(folderId: number) {
    setQuizDocId(folderId); // Reutilizamos state para simplificar (deberia llamarse quizFolderId)
    setShowQuizModal(true);
    setQuizLoading(true);
    setQuizError('');
    setQuizFeedback(null);
    setQuizAnswers(['', '', '']);
    try {
      const data = await getFolderQuiz(notebookId, folderId);
      setQuizQuestions(data.quiz.questions);
    } catch (err: any) {
      setQuizError(err.message || 'Error al cargar el cuestionario de IA.');
    } finally {
      setQuizLoading(false);
    }
  }

  function handleQuizAnswerSelect(questionIdx: number, optionLetter: string) {
    setQuizAnswers(prev => {
      const updated = [...prev];
      updated[questionIdx] = optionLetter;
      return updated;
    });
  }

  async function handleQuizSubmit() {
    if (!quizDocId) return;
    if (quizAnswers.some(a => !a)) {
      alert('Por favor responde todas las preguntas del cuestionario.');
      return;
    }
    setQuizSubmitting(true);
    setQuizError('');
    try {
      const res = await submitFolderQuiz(notebookId, quizDocId, quizAnswers);
      setQuizFeedback(res.feedback);
      
      if (res.passed) {
        // Actualizar progreso localmente de la carpeta
        setUserFolderProgress(prev => ({
          ...prev,
          [quizDocId]: {
            ...(prev[quizDocId] || {}),
            folder_id: quizDocId,
            quiz_passed: true,
            score: res.score,
            completed_at: new Date().toISOString()
          }
        }));
        // Recargar documentos para desbloquear de forma animada el siguiente candado
        await loadDocs();
      }
    } catch (err: any) {
      setQuizError(err.message || 'Error al enviar las respuestas.');
    } finally {
      setQuizSubmitting(false);
    }
  }

  async function handleLaunchFinalExam() {
    setShowFinalExamModal(true);
    setFinalExamLoading(true);
    setFinalExamError('');
    setFinalExamFeedback(null);
    setFinalExamAnswers(['', '', '', '', '']);
    try {
      const data = await getFinalExam(notebookId);
      setFinalExamQuestions(data.exam.questions);
    } catch (err: any) {
      setFinalExamError(err.message || 'Error al cargar el examen final.');
    } finally {
      setFinalExamLoading(false);
    }
  }

  function handleFinalExamAnswerSelect(questionIdx: number, optionLetter: string) {
    setFinalExamAnswers(prev => {
      const updated = [...prev];
      updated[questionIdx] = optionLetter;
      return updated;
    });
  }

  async function handleFinalExamSubmit() {
    if (finalExamAnswers.some(a => !a)) {
      alert('Por favor responde todas las preguntas del examen integrador.');
      return;
    }
    setFinalExamSubmitting(true);
    setFinalExamError('');
    try {
      const res = await submitFinalExam(notebookId, finalExamAnswers);
      setFinalExamFeedback(res.feedback);
      
      if (res.passed) {
        setFinalExamStatus({ passed: true, score: res.score });
      }
    } catch (err: any) {
      setFinalExamError(err.message || 'Error al enviar el examen final.');
    } finally {
      setFinalExamSubmitting(false);
    }
  }

  // ── Upload file ──────────────────────────────────────────────────────────────
  async function handleModalUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setModalUploadProgress(0);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const onProgress = (pct: number) => {
          const overallPct = Math.round(((i + pct / 100) / files.length) * 100);
          setModalUploadProgress(overallPct);
        };
        const targetFolder = modalFolderId; // save currently navigated folder in modal
        const data = await uploadDocument(notebookId, file, targetFolder, onProgress);
        
        // Add to main docs list
        setDocs(prev => [data.document, ...prev]);
        
        // Add to modal staged docs list
        setStagedDocs(prev => [...prev, { ...data.document, sort_order: prev.length }]);
      }
      loadDocs();
    } catch (err: any) {
      alert(err.message || 'Error al subir');
    } finally {
      setModalUploadProgress(null);
      if (modalFileRef.current) modalFileRef.current.value = '';
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploadProgress(0);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const onProgress = (pct: number) => {
          const overallPct = Math.round(((i + pct / 100) / files.length) * 100);
          setUploadProgress(overallPct);
        };
        const data = await uploadDocument(notebookId, file, currentFolderId, onProgress);
        setDocs(prev => [data.document, ...prev]);
        
        // Select newly uploaded file by default
        setSelectedDocs(prev => ({ ...prev, [data.document.id]: true }));
      }
      loadDocs(); // refresh list to load fragment counts once parsed
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
      setSelectedDocs(prev => ({ ...prev, [data.document.id]: true }));
      setUrlInput('');
      loadDocs();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error al ingestar URL');
    } finally {
      setUrlLoading(false);
    }
  }

  // ── Ingest Video (Embed) ──────────────────────────────────────────────────────
  async function handleVideoIngest(e: React.FormEvent) {
    e.preventDefault();
    if (!videoName.trim() || !videoCode.trim()) return;
    setVideoLoading(true);
    try {
      const data = await ingestVideo(notebookId, videoName.trim(), videoCode.trim(), currentFolderId);
      setDocs(prev => [data.document, ...prev]);
      setSelectedDocs(prev => ({ ...prev, [data.document.id]: true }));
      setVideoName('');
      setVideoCode('');
      loadDocs();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error al ingestar video');
    } finally {
      setVideoLoading(false);
    }
  }

  // ── Delete document ──────────────────────────────────────────────────────────
  async function handleDeleteDoc(docId: number) {
    if (!confirm('¿Eliminar este documento?')) return;
    await deleteDocument(docId);
    setDocs(prev => prev.filter(d => d.id !== docId));
    setSelectedDocs(prev => {
      const updated = { ...prev };
      delete updated[docId];
      return updated;
    });
  }

  // Toggle Single Document Checkbox
  function toggleDocSelection(docId: number) {
    setSelectedDocs(prev => ({ ...prev, [docId]: !prev[docId] }));
  }

  // Toggle All Documents Checkboxes
  function toggleAllDocs(select: boolean) {
    const updated: Record<number, boolean> = {};
    docs.forEach(d => { updated[d.id] = select; });
    setSelectedDocs(updated);
  }

  // ── Change Password (Profile) ──────────────────────────────────────────────
  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setProfileError('');
    setProfileSuccess('');
    if (newPassword.length < 4) {
      setProfileError('La contraseña debe tener al menos 4 caracteres');
      return;
    }
    setProfileLoading(true);
    try {
      await changePassword(newPassword);
      setProfileSuccess('Contraseña cambiada con éxito');
      setNewPassword('');
      setPasswordChangedState(true);
      if (me) {
        const updated = { ...me, password_changed: true };
        setMe(updated);
        localStorage.setItem('docchat_user', JSON.stringify(updated));
      }
    } catch (err: any) {
      setProfileError(err.message || 'Error al cambiar contraseña');
    } finally {
      setProfileLoading(false);
    }
  }

  // ── Send chat (SSE streaming) ───────────────────────────────────────────────
  async function handleSend(textInput?: string, parentIdOverride?: number | null) {
    const text = (textInput ?? input).trim();
    if (!text || streaming) return;
    if (!textInput) setInput('');
    setSources([]);

    // Document Context IDs Filter
    const activeDocIds = Object.keys(selectedDocs)
      .map(Number)
      .filter(id => selectedDocs[id]);

    const activeParentId = parentIdOverride !== undefined ? parentIdOverride : (renderedMessages.length > 0 ? renderedMessages[renderedMessages.length - 1].id : null);

    // Optimistically push client-side user message node
    const clientUserMsgId = Date.now();
    const userMsg: Message = {
      id: clientUserMsgId,
      conversation_id: conversationId ?? 0,
      role: 'user',
      content: text,
      parent_id: activeParentId,
      sources: null,
      created_at: new Date().toISOString(),
    };
    
    // Add User Message to full Dialogue Tree
    setAllMessages(prev => [...prev, userMsg]);
    setStreaming(true);
    setStreamBuffer('');

    await sendChat(notebookId, text, conversationId, activeParentId, activeDocIds.length > 0 ? activeDocIds : null, {
      onMeta: (cid) => {
        setConversationId(cid);
        // Refresh conversations list in background
        loadConvs();
      },
      onDelta: (delta) => setStreamBuffer(prev => prev + delta),
      onDone: (srcs, generatedTitle) => {
        setSources(srcs);
        setStreamBuffer(prev => {
          // Create assistant message node
          const assistantMsg: Message = {
            id: Date.now() + 1,
            conversation_id: conversationId ?? 0,
            role: 'assistant',
            content: prev,
            parent_id: clientUserMsgId, // child of the optimistic user message ID
            sources: srcs,
            created_at: new Date().toISOString(),
          };
          
          // Re-fetch complete dialogue nodes from backend to sync up perfectly (keeps IDs matching exactly!)
          if (conversationId) {
            getMessages(conversationId).then(data => {
              setAllMessages(data.messages);
            });
          } else {
            // First exchange: let's do a hard fetch in a second to sync conversationId
            setTimeout(() => {
              const activeConvId = localStorage.getItem('docchat_active_conv');
              const realId = activeConvId ? Number(activeConvId) : null;
              if (realId) {
                getMessages(realId).then(data => {
                  setAllMessages(data.messages);
                  setConversationId(realId);
                });
                loadConvs();
              }
            }, 1000);
          }
          
          return '';
        });
        
        // Cache conversationId so async first exchange resolves it
        if (conversationId) {
          localStorage.setItem('docchat_active_conv', conversationId.toString());
        }

        setStreaming(false);
      },
      onError: (msg) => {
        setStreamBuffer('');
        setAllMessages(m => [...m, {
          id: Date.now() + 2,
          conversation_id: conversationId ?? 0,
          role: 'assistant',
          content: `Error: ${msg}`,
          parent_id: clientUserMsgId,
          sources: null,
          created_at: new Date().toISOString(),
        }]);
        setStreaming(false);
      },
    });
  }

  // Handle Edit User Message (Dialogue Branching)
  async function handleConfirmEdit(msgId: number) {
    const text = editingText.trim();
    if (!text) return;
    
    // Find the message being edited
    const originalMsg = allMessages.find(m => m.id === msgId);
    if (!originalMsg) return;

    setEditingMsgId(null);
    setEditingText('');

    // Trigger sendChat with the parentId of the edited message!
    await handleSend(text, originalMsg.parent_id);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  function newConversation() {
    setConversationId(null);
    setAllMessages([]);
    setRenderedMessages([]);
    setSelectedVersions({});
    setSources([]);
    setStreamBuffer('');
  }

  // ── Custom Safe Markdown Renderer ──────────────────────────────────────────
  function renderMarkdown(text: string) {
    if (!text) return '';
    
    // Clean HTML tags to prevent injection (strict XSS prevention)
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Fenced Code blocks
    html = html.replace(/```([\s\S]*?)```/g, (_, code) => {
      return `<pre class="bg-gray-800 text-gray-100 p-4 rounded-xl font-mono text-xs overflow-x-auto my-3 border border-gray-700 select-text">${code.trim()}</pre>`;
    });

    // Inline Code
    html = html.replace(/`([^`\n]+)`/g, '<code class="bg-gray-100 text-indigo-600 px-1.5 py-0.5 rounded font-mono text-xs border border-gray-200">$1</code>');

    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-bold text-gray-900">$1</strong>');

    // Headers
    html = html.replace(/^### (.*$)/gim, '<h4 class="text-xs font-bold text-gray-900 mt-4 mb-2 select-none uppercase tracking-wider">$1</h4>');
    html = html.replace(/^## (.*$)/gim, '<h3 class="text-sm font-bold text-gray-900 mt-5 mb-2.5 select-none">$1</h3>');
    html = html.replace(/^# (.*$)/gim, '<h2 class="text-base font-bold text-gray-900 mt-6 mb-3 select-none border-b border-gray-100 pb-1">$1</h2>');

    // Lists
    html = html.replace(/^\s*[-*]\s+(.*$)/gim, '<li class="ml-4 list-disc text-gray-700 leading-relaxed">$1</li>');

    // Paragraph returns
    html = html.replace(/\n/g, '<br />');

    return <div className="space-y-1 text-sm text-gray-800 select-text leading-relaxed select-text" dangerouslySetInnerHTML={{ __html: html }} />;
  }

  // ── Dialogue Sibling Switcher Helper ────────────────────────────────────────
  function renderVersionSelector(msg: Message) {
    // Find siblings (messages sharing the same parent_id)
    const siblings = allMessages
      .filter(m => m.parent_id === msg.parent_id)
      .sort((a, b) => a.id - b.id);

    if (siblings.length <= 1) return null;

    const currentIdx = siblings.findIndex(s => s.id === msg.id);
    const selectKey = msg.parent_id === null ? 0 : msg.parent_id;

    function handleSwitch(idx: number) {
      if (idx < 0 || idx >= siblings.length) return;
      setSelectedVersions(prev => ({
        ...prev,
        [selectKey]: idx
      }));
    }

    return (
      <div className="flex items-center gap-2 mt-2 select-none text-[10px] font-bold text-gray-400">
        <button
          onClick={() => handleSwitch(currentIdx - 1)}
          disabled={currentIdx === 0}
          className="hover:text-indigo-600 disabled:opacity-30 disabled:hover:text-gray-400 transition-colors"
        >
          ◀
        </button>
        <span>{currentIdx + 1} / {siblings.length}</span>
        <button
          onClick={() => handleSwitch(currentIdx + 1)}
          disabled={currentIdx === siblings.length - 1}
          className="hover:text-indigo-600 disabled:opacity-30 disabled:hover:text-gray-400 transition-colors"
        >
          ▶
        </button>
      </div>
    );
  }

  const typeIcon: Record<string, string> = { pdf: '📄', docx: '📝', txt: '📃', url: '🔗', video: '🎥' };

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-800 font-sans overflow-hidden">
      
      {/* Warning Safety Banner */}
      {!passwordChangedState && (
        <div className="bg-amber-500 text-white font-medium text-xs sm:text-sm text-center py-2 px-4 flex items-center justify-center gap-2 shadow-sm border-b border-amber-600 z-25">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>
            <strong>Atención de Seguridad:</strong> Debés cambiar tu clave genérica desde <strong>Mi Perfil</strong> antes de cumplirse las 48hs de plazo para evitar la suspensión de tu cuenta.
          </span>
        </div>
      )}

      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shadow-sm z-20">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/notebooks')} className="text-gray-400 hover:text-gray-700 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-md shadow-indigo-100">
            <svg className="w-4.5 h-4.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-sm text-gray-900 leading-tight">DocChat</span>
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Notebook #{notebookId}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {isCreator && (
            <button
              onClick={loadShareAcl}
              className="flex items-center gap-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold px-3 py-2 rounded-xl transition-all"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 10.742a3 3 0 110-2.284 3 3 0 010 2.284zM2 17h18a2 2 0 002-2v-.5a7 7 0 00-14 0V15a2 2 0 002 2z" />
              </svg>
              <span>Compartir</span>
            </button>
          )}

          {me && (
            <button
              onClick={() => setShowProfile(true)}
              className="flex items-center gap-1.5 hover:bg-gray-50 text-gray-700 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-gray-200 transition-all"
            >
              <div className="w-5 h-5 bg-indigo-100 text-indigo-700 rounded-full flex items-center justify-center font-bold text-[10px]">
                {me.username.slice(1, 3).toUpperCase()}
              </div>
              <span className="hidden sm:inline font-semibold">{me.full_name || me.username}</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Panel Content */}
      <div className="flex flex-1 overflow-hidden relative">
        
        {/* ── Left Sidebar: Documents & Checkboxes ────────────────────────────── */}
        <aside className="w-72 bg-white border-r border-gray-200 flex flex-col flex-shrink-0 z-10">
          
          {/* Notebook Role Controls */}
          {me?.role !== 'user' && (
            <div className="p-4 border-b border-gray-100 space-y-3 bg-gray-50/50">
              <h3 className="font-bold text-xs text-gray-500 uppercase tracking-wider select-none">Cargar Recursos</h3>

              {/* Upload file */}
              <input ref={fileRef} type="file" accept=".pdf,.docx,.doc,.txt,.md" className="hidden" onChange={handleFileChange} multiple />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploadProgress !== null}
                className="w-full flex items-center justify-center gap-2 border border-dashed border-gray-300 bg-white hover:bg-gray-50 hover:border-indigo-400 rounded-xl py-2 text-xs font-semibold text-gray-600 hover:text-indigo-600 transition-all disabled:opacity-50 shadow-sm"
              >
                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                {uploadProgress !== null ? `Subiendo ${uploadProgress}%...` : 'Subir Archivo'}
              </button>

              {uploadProgress !== null && (
                <div className="w-full bg-gray-150 rounded-full h-1">
                  <div className="bg-indigo-600 h-1 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
                </div>
              )}

              {/* URL ingest */}
              <form onSubmit={handleUrlIngest} className="flex gap-1.5">
                <input
                  type="url"
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  placeholder="Insertar URL (cheerio)"
                  className="flex-1 border border-gray-300 rounded-xl px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                />
                <button
                  type="submit"
                  disabled={urlLoading}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold px-3 py-1.5 rounded-xl transition-all shadow-sm"
                >
                  {urlLoading ? '...' : 'URL'}
                </button>
              </form>

              {/* Video ingest */}
              <form onSubmit={handleVideoIngest} className="flex flex-col gap-1.5 mt-2">
                <input
                  type="text"
                  value={videoName}
                  onChange={e => setVideoName(e.target.value)}
                  placeholder="Nombre del Video"
                  className="w-full border border-gray-300 rounded-xl px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                />
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={videoCode}
                    onChange={e => setVideoCode(e.target.value)}
                    placeholder="Código iframe o Embed URL"
                    className="flex-1 border border-gray-300 rounded-xl px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                  />
                  <button
                    type="submit"
                    disabled={videoLoading}
                    className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold px-3 py-1.5 rounded-xl transition-all shadow-sm"
                  >
                    {videoLoading ? '...' : 'Embed'}
                  </button>
                </div>
              </form>
              {aiAssistantEnabled && docs.length > 0 && (
                <button
                  onClick={handleOpenReorderModal}
                  className="w-full mt-2 flex items-center justify-center gap-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl py-2.5 text-xs font-bold transition-all shadow-sm border border-indigo-100/40"
                >
                  ⚙️ Organizar Temario
                </button>
              )}
              {me?.role === 'admin' && (
                <button
                  onClick={handleOpenAttemptsModal}
                  className="w-full mt-2 flex items-center justify-center gap-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-xl py-2.5 text-xs font-bold transition-all shadow-sm border border-purple-100/40"
                >
                  📈 Intentos y Evaluaciones
                </button>
              )}
            </div>
          )}

          {/* Documents Selection & List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="flex items-center justify-between select-none">
              <h3 className="font-bold text-xs text-gray-500 uppercase tracking-wider">Documentos ({docs.length})</h3>
              
            </div>

            <div className="space-y-1.5">
              {docsLoading ? (
                <div className="flex justify-center py-8">
                  <div className="w-6 h-6 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : docs.length === 0 && folders.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-8 font-medium">Sin documentos todavía.</p>
              ) : (
                <div className="space-y-3">
                  {/* Breadcrumbs */}
                  <div className="flex flex-wrap items-center gap-1.5 pb-2 text-[11px] border-b border-gray-100 select-none">
                    {getBreadcrumbs(currentFolderId, folders).map((crumb, index, arr) => (
                      <div key={index} className="flex items-center gap-1">
                        <button
                          onClick={() => setCurrentFolderId(crumb.id)}
                          onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('underline', 'text-indigo-600', 'scale-105'); }}
                          onDragLeave={(e) => { e.currentTarget.classList.remove('underline', 'text-indigo-600', 'scale-105'); }}
                          onDrop={async (e) => {
                            e.preventDefault();
                            e.currentTarget.classList.remove('underline', 'text-indigo-600', 'scale-105');
                            try {
                              const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                              if (data.type === 'document') await handleMoveDoc(data.id, crumb.id);
                              else if (data.type === 'folder' && data.id !== crumb.id) await handleMoveFolder(data.id, crumb.id);
                            } catch {}
                          }}
                          className={`font-bold hover:text-indigo-650 transition-colors ${
                            crumb.id === currentFolderId ? 'text-indigo-600 underline font-extrabold' : 'text-gray-500'
                          }`}
                        >
                          {crumb.name}
                        </button>
                        {index < arr.length - 1 && <span className="text-gray-300">/</span>}
                      </div>
                    ))}
                  </div>

                  {/* Create Folder button inside explorer */}
                  {me?.role !== 'user' && (
                    <button
                      onClick={() => setShowFolderModal(true)}
                      className="w-full flex items-center justify-center gap-1.5 border border-dashed border-gray-300 hover:border-indigo-400 hover:text-indigo-650 rounded-xl py-2 text-[11px] font-bold text-gray-500 hover:text-indigo-600 transition-all shadow-sm"
                    >
                      📁 Nueva Carpeta
                    </button>
                  )}

                  {/* Combined Explorer Items */}
                  {mainCombinedItems.map((item, idx) => {
                    if (item.itemType === 'folder') {
                      const folder = item;
                      return (
                        <div
                          key={'folder-' + folder.id}
                          draggable={true}
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'folder', id: folder.id }));
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.currentTarget.classList.add('border-indigo-400', 'bg-indigo-50/50', 'shadow-md');
                          }}
                          onDragLeave={(e) => {
                            e.currentTarget.classList.remove('border-indigo-400', 'bg-indigo-50/50', 'shadow-md');
                          }}
                          onDrop={async (e) => {
                            e.preventDefault();
                            e.currentTarget.classList.remove('border-indigo-400', 'bg-indigo-50/50', 'shadow-md');
                            try {
                              const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                              if (data.type === 'document') await handleMoveDoc(data.id, folder.id);
                              else if (data.type === 'folder' && data.id !== folder.id) await handleMoveFolder(data.id, folder.id);
                            } catch {}
                          }}
                          className="flex items-center justify-between p-2.5 rounded-2xl border border-gray-200 bg-gray-50 hover:bg-gray-100/70 hover:border-indigo-200 transition-all select-none cursor-pointer group"
                          onDoubleClick={() => setCurrentFolderId(folder.id)}
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1" onClick={() => setCurrentFolderId(folder.id)}>
                            <span className="text-xs">📁</span>
                            <span className="text-xs font-bold text-gray-800 truncate" title={folder.name}>
                              {folder.name}
                            </span>
                          </div>
                          
                          <div className="flex items-center gap-1 shrink-0">
                            <div className="relative">
                              <button
                                onClick={(e) => { e.stopPropagation(); setMovingFolderId(movingFolderId === folder.id ? null : folder.id); }}
                                className="text-gray-450 hover:text-indigo-650 p-1 hover:bg-indigo-50 rounded transition-colors text-[10px]"
                                title="Mover carpeta"
                              >
                                🔄
                              </button>
                              {movingFolderId === folder.id && (
                                <div className="absolute right-0 top-6 bg-white border border-gray-200 rounded-xl shadow-lg p-2 z-35 min-w-[160px] text-left">
                                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-2 py-1">Mover carpeta a...</p>
                                  <div className="max-h-40 overflow-y-auto space-y-1">
                                    <button
                                      onClick={async (e) => {
                                        e.stopPropagation();
                                        await handleMoveFolder(folder.id, null);
                                      }}
                                      className="w-full text-left text-xs hover:bg-indigo-50 px-2 py-1.5 rounded-lg text-gray-700 font-semibold"
                                    >
                                      📁 Raíz (Inicio)
                                    </button>
                                    {folders.filter(f => f.id !== folder.id).map(f => (
                                      <button
                                        key={f.id}
                                        onClick={async (e) => {
                                          e.stopPropagation();
                                          await handleMoveFolder(folder.id, f.id);
                                        }}
                                        className="w-full text-left text-xs hover:bg-indigo-50 px-2 py-1.5 rounded-lg text-gray-700 font-medium truncate"
                                      >
                                        📂 {getFolderPathString(f.id)}
                                      </button>
                                    ))}
                                  </div>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setMovingFolderId(null); }}
                                    className="w-full mt-1.5 text-center text-[10px] font-bold hover:bg-gray-100 px-2 py-1 rounded text-gray-500"
                                  >
                                    Cancelar
                                  </button>
                                </div>
                              )}
                            </div>

                            {me?.role !== 'user' && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteFolder(folder.id); }}
                                className="text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-50 rounded"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    } else {
                      const doc = item as Document;
                      const docIdx = documentOrder.indexOf(doc.id);
                      let isLocked = false;
                      if (aiAssistantEnabled && docIdx > 0) {
                        const prevDocId = documentOrder[docIdx - 1];
                        const prevDoc = docs.find(d => d.id === prevDocId);
                        const prevDocProgress = userProgress[prevDocId];
                        
                        if (!prevDocProgress?.read_checked) {
                          isLocked = true;
                        } else if (prevDoc && prevDoc.folder_id) {
                          const prevFolderDocs = docs.filter(d => d.folder_id === prevDoc.folder_id);
                          const lastDocInPrevFolder = prevFolderDocs[prevFolderDocs.length - 1];
                          
                          if (prevDoc.id === lastDocInPrevFolder?.id) {
                            const prevFolder = folders.find(f => f.id === prevDoc.folder_id);
                            if (prevFolder?.quiz_enabled && !userFolderProgress[prevFolder.id]?.quiz_passed) {
                              isLocked = true;
                            }
                          }
                        }
                      }
                      
                      const isPassed = false; // Quizzes por documento están obsoletos
                      const isRead = aiAssistantEnabled && userProgress[doc.id]?.read_checked;

                      return (
                        <div
                          key={'doc-' + doc.id}
                          draggable={!isLocked}
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'document', id: doc.id }));
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          className={`flex flex-col gap-1.5 p-3 rounded-2xl border transition-all duration-200 group select-none relative ${
                            isLocked 
                              ? 'bg-gray-100/40 border-gray-200/50 opacity-50 cursor-not-allowed'
                              : selectedDocs[doc.id] 
                                ? 'border-indigo-200 bg-indigo-50/15 shadow-sm' 
                                : 'border-gray-200 bg-white hover:border-indigo-300 hover:shadow-sm'
                          }`}
                        >
                          <div className="flex items-start gap-2.5">
                            {!isLocked && (
                              <input
                                type="checkbox"
                                checked={!!selectedDocs[doc.id]}
                                onChange={() => toggleDocSelection(doc.id)}
                                className="mt-0.5 w-3.5 h-3.5 rounded text-indigo-600 border-gray-300 focus:ring-indigo-500 cursor-pointer"
                              />
                            )}
                            {isLocked && (
                              <span className="mt-0.5 text-xs text-gray-400 select-none">🔒</span>
                            )}
                            
                            <div 
                              className={`flex-1 min-w-0 ${isLocked ? 'pointer-events-none' : 'cursor-pointer'}`}
                              onClick={() => handleOpenDocumentViewer(doc)}
                            >
                              <p className={`text-xs font-bold truncate transition-colors ${isLocked ? 'text-gray-400' : 'text-gray-800 group-hover:text-indigo-600'}`} title={doc.name}>
                                {typeIcon[doc.type] ?? '📄'} {doc.name}
                              </p>
                              <p className="text-[10px] text-gray-400 font-semibold mt-0.5">
                                {doc.chunk_count > 0 ? `${doc.chunk_count} fragmentos` : 'Procesando embeddings…'}
                              </p>
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              {me?.role !== 'user' && !isLocked && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleDeleteDoc(doc.id); }}
                                  className="text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-50 rounded"
                                  title="Eliminar documento"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          </div>

                          {aiAssistantEnabled && (
                            <div className="mt-1.5 flex items-center justify-between border-t border-gray-100 pt-2 text-[10px] select-none font-bold uppercase tracking-wider">
                              {isLocked ? (
                                <span className="text-gray-400">🔒 Bloqueado</span>
                              ) : isPassed ? (
                                <span className="text-green-600 bg-green-50 px-2 py-0.5 rounded-lg flex items-center gap-1">✅ Aprobado</span>
                              ) : isRead ? (
                                <div className="w-full flex items-center justify-between gap-1">
                                  <span className="text-amber-600 bg-amber-50 px-2 py-0.5 rounded-lg">📖 Leído</span>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleLaunchQuiz(doc.id); }}
                                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold px-2.5 py-1 rounded-lg text-[9px] tracking-normal normal-case transition-all shadow-sm"
                                  >
                                    📝 Hacer Cuestionario
                                  </button>
                                </div>
                              ) : (
                                <span className="text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-lg">📖 Pendiente de lectura</span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    }
                  })}                  {folders.filter(f => f.parent_id === currentFolderId).length === 0 &&
                   docs.filter(d => d.folder_id === currentFolderId).length === 0 && (
                     <p className="text-xs text-gray-400 text-center py-8 font-medium">Esta carpeta está vacía.</p>
                   )}
                </div>

              )}

              {/* Examen Final Integrador en Modo LMS */}
              {aiAssistantEnabled && docs.length > 0 && (() => {
                const allQuizzesPassed = docs.every(d => userProgress[d.id]?.quiz_passed);
                if (finalExamStatus?.passed) {
                  return (
                    <div className="mt-4 bg-gradient-to-r from-amber-500 to-yellow-500 text-white rounded-2xl p-4 text-center shadow-lg select-none">
                      <h4 className="font-extrabold text-sm flex items-center justify-center gap-1.5">🎓 Notebook Aprobado</h4>
                      <p className="text-[10px] font-semibold mt-1">¡Felicitaciones! Completaste el examen integrador final con éxito ({finalExamStatus.score}/5).</p>
                    </div>
                  );
                } else if (allQuizzesPassed) {
                  return (
                    <button
                      onClick={handleLaunchFinalExam}
                      className="w-full mt-4 bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-600 hover:to-yellow-750 text-white font-extrabold rounded-2xl py-3.5 text-xs tracking-wider uppercase transition-all shadow-md shadow-amber-100 flex items-center justify-center gap-2 select-none animate-pulse"
                    >
                      🎓 Tomar Examen Final
                    </button>
                  );
                } else {
                  return (
                    <div className="w-full mt-4 bg-gray-100 text-gray-400 font-bold border border-gray-200/50 rounded-2xl py-3 text-center text-xs select-none flex items-center justify-center gap-2 opacity-50 cursor-not-allowed">
                      <span>🔒 Examen Final (Bloqueado)</span>
                    </div>
                  );
                }
              })()}
            </div>
          </div>
        </aside>

        {/* ── Right Panel: Document Viewer (SlideDrawer) ─────────────────────── */}
        {viewerDoc && (
          <main className="flex-1 bg-white border-l border-gray-200 flex flex-col relative select-text h-full z-10 overflow-hidden">
            
            {/* Viewer Header */}
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <div className="min-w-0">
                <h3 className="font-bold text-gray-900 truncate text-sm sm:text-base" title={viewerDoc.name}>
                  👁️ Visor: {viewerDoc.name}
                </h3>
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Modo lectura integrada</p>
              </div>

              <div className="flex items-center gap-2">
                {viewerDoc.source && viewerDoc.source.startsWith('http') && (
                  <button
                    onClick={() => window.open(viewerDoc.source || '', '_blank')}
                    className="text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold px-3 py-1.5 rounded-xl transition-all flex items-center gap-1 select-none"
                    title="Abrir el archivo original en una pestaña nueva"
                  >
                    <span>📄 Abrir original</span>
                  </button>
                )}
                <button onClick={() => setViewerDoc(null)} className="text-gray-400 hover:text-gray-600 transition-colors p-1">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Viewer Tabs for Video */}
            {viewerDoc?.type === 'video' && (
              <div className="flex border-b border-gray-100 bg-white select-none">
                <button 
                  onClick={() => setActiveViewerTab('content')}
                  className={`flex-1 py-2 text-xs font-bold transition-colors ${activeViewerTab === 'content' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  🎥 Reproductor
                </button>
                <button 
                  onClick={() => setActiveViewerTab('transcript')}
                  className={`flex-1 py-2 text-xs font-bold transition-colors ${activeViewerTab === 'transcript' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  📝 Transcripción
                </button>
              </div>
            )}

            {/* Viewer Search Bar */}
            {viewerDoc?.type !== 'video' || activeViewerTab === 'transcript' ? (
              <div className="p-3 border-b border-gray-100">
                <input
                  type="text"
                  value={viewerSearch}
                  onChange={e => setViewerSearch(e.target.value)}
                  placeholder="Buscar términos en este documento..."
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            ) : null}

            {/* Viewer Content list */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6 select-text bg-gray-50/10">
              {viewerLoading ? (
                <div className="flex flex-col items-center justify-center h-full space-y-3 select-none">
                  <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                  <p className="text-xs text-gray-400 font-bold uppercase tracking-wider animate-pulse">Cargando Texto...</p>
                </div>
              ) : viewerDoc.type === 'video' ? (
                activeViewerTab === 'content' ? (
                  <div className="w-full h-full flex flex-col gap-4">
                    <div 
                      className="w-full aspect-video rounded-xl overflow-hidden shadow-lg bg-black flex items-center justify-center [&>iframe]:w-full [&>iframe]:h-full" 
                      dangerouslySetInnerHTML={{ __html: viewerDoc.source || '' }} 
                    />
                  </div>
                ) : (
                  <div className="w-full flex flex-col gap-3 h-full">
                    <div className="flex justify-between items-center select-none">
                      <p className="text-xs text-gray-500 font-bold">Transcripción del Video</p>
                      {me?.role !== 'user' && !editingTranscript && (
                        <div className="flex gap-2">
                          <input type="file" ref={transcriptFileRef} onChange={handleUploadTranscript} accept=".txt,.pdf,.doc,.docx,.md" className="hidden" />
                          <button 
                            onClick={() => transcriptFileRef.current?.click()}
                            disabled={transcriptUploading}
                            className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-[10px] font-bold px-2 py-1 rounded transition-colors disabled:opacity-50"
                          >
                            {transcriptUploading ? 'Subiendo...' : '📄 Subir Archivo'}
                          </button>
                          <button 
                            onClick={() => { setTranscriptDraft(viewerText); setEditingTranscript(true); }}
                            className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[10px] font-bold px-2 py-1 rounded transition-colors"
                          >
                            ✏️ Editar Manual
                          </button>
                        </div>
                      )}
                    </div>
                    {editingTranscript ? (
                      <div className="flex flex-col h-full gap-2">
                        <textarea
                          value={transcriptDraft}
                          onChange={e => setTranscriptDraft(e.target.value)}
                          className="flex-1 w-full border border-gray-300 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none font-sans"
                          placeholder="Pegá la transcripción acá para que la IA la procese..."
                        />
                        <div className="flex justify-end gap-2 shrink-0">
                          <button onClick={() => setEditingTranscript(false)} className="text-xs font-bold text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200">Cancelar</button>
                          <button onClick={handleSaveTranscript} disabled={transcriptSaving} className="text-xs font-bold text-white px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
                            {transcriptSaving ? 'Guardando...' : 'Guardar y Procesar'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 border border-gray-200 rounded-xl bg-white shadow-sm flex-1 overflow-y-auto whitespace-pre-wrap text-sm text-gray-700 leading-relaxed font-serif">
                        {viewerText ? renderViewerPageContent(viewerText, viewerSearch) : <span className="text-gray-400 italic">No hay transcripción disponible. Podés editar para agregarla.</span>}
                      </div>
                    )}
                  </div>
                )
              ) : (
                viewerPages.map((page, i) => (
                  <div
                    key={i}
                    id={`viewer-page-${page.pageNumber || 1}`}
                    className={`p-4 border rounded-xl space-y-2.5 transition-all select-text ${viewerHighlightPage === page.pageNumber ? 'border-indigo-400 bg-indigo-50/20 shadow-md ring-2 ring-indigo-500/20' : 'border-gray-200 bg-white shadow-sm'}`}
                  >
                    <div className="flex items-center justify-between border-b border-gray-50 pb-1.5 select-none">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                        Página {page.pageNumber || 1}
                      </span>
                      {viewerHighlightPage === page.pageNumber && (
                        <span className="text-[9px] font-bold bg-indigo-100 text-indigo-700 uppercase px-1.5 py-0.5 rounded">
                          Referencia Citada
                        </span>
                      )}
                    </div>
                    {renderViewerPageContent(page.text, viewerSearch)}
                  </div>
                ))
              )}
            </div>

            {/* LMS Section at the bottom of the viewer */}
            {aiAssistantEnabled && (
              <div className="p-4 border-t border-gray-150 bg-gray-50/50 space-y-3 select-none shrink-0">
                <div className="flex items-start gap-2.5 bg-white border border-gray-200 rounded-xl p-3 shadow-sm">
                  <input
                    type="checkbox"
                    id="mark_as_read"
                    checked={!!userProgress[viewerDoc.id]?.read_checked}
                    onChange={async (e) => {
                      const checked = e.target.checked;
                      try {
                        await markDocumentRead(viewerDoc.id, checked);
                        setUserProgress(prev => ({
                          ...prev,
                          [viewerDoc.id]: {
                            ...(prev[viewerDoc.id] || { document_id: viewerDoc.id, quiz_passed: false, score: null, completed_at: null }),
                            read_checked: checked
                          }
                        }));
                      } catch (err: any) {
                        alert(err.message || 'Error al actualizar lectura.');
                      }
                    }}
                    className="mt-0.5 w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 cursor-pointer"
                  />
                  <div 
                    className="flex flex-col cursor-pointer" 
                    onClick={async () => {
                      const nextVal = !userProgress[viewerDoc.id]?.read_checked;
                      try {
                        await markDocumentRead(viewerDoc.id, nextVal);
                        setUserProgress(prev => ({
                          ...prev,
                          [viewerDoc.id]: {
                            ...(prev[viewerDoc.id] || { document_id: viewerDoc.id, quiz_passed: false, score: null, completed_at: null }),
                            read_checked: nextVal
                          }
                        }));
                      } catch (err: any) {
                        alert(err.message || 'Error al actualizar lectura.');
                      }
                    }}
                  >
                    <span className="text-xs font-bold text-gray-800">He completado la lectura</span>
                    <span className="text-[9px] text-gray-400 font-semibold uppercase leading-tight mt-0.5">Activar el cuestionario de evaluación</span>
                  </div>
                </div>

                {(() => {
                  if (!viewerDoc.folder_id) return null;
                  const folderDocs = docs.filter(d => d.folder_id === viewerDoc.folder_id);
                  const isLastDoc = folderDocs.length > 0 && folderDocs[folderDocs.length - 1].id === viewerDoc.id;
                  const folder = folders.find(f => f.id === viewerDoc.folder_id);
                  if (!isLastDoc || !folder?.quiz_enabled) return null;

                  const folderProg = userFolderProgress[folder.id];
                  
                  if (userProgress[viewerDoc.id]?.read_checked && !folderProg?.quiz_passed) {
                    return (
                      <button
                        onClick={() => handleLaunchQuiz(folder.id)}
                        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded-xl py-2.5 text-xs tracking-wider uppercase transition-all shadow-md shadow-indigo-100 flex items-center justify-center gap-1.5 animate-pulse"
                      >
                        📝 Hacer Cuestionario Final de Carpeta
                      </button>
                    );
                  }
                  
                  if (folderProg?.quiz_passed) {
                    return (
                      <div className="bg-green-50 border border-green-150 rounded-xl p-3 flex items-center justify-center gap-1.5 text-green-700 text-xs font-bold select-none">
                        <span>✅ Cuestionario Aprobado ({folderProg.score || 3}/3)</span>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
            )}
          </main>
        )}
        {/* Draggable Divider */}
        {viewerDoc && (
          <div 
            className="w-1.5 bg-gray-200 hover:bg-indigo-400 cursor-col-resize z-20 flex-shrink-0 transition-colors"
            onMouseDown={(e) => {
              const startX = e.clientX;
              const startWidth = chatWidth;
              const onMouseMove = (moveEvent: MouseEvent) => {
                const deltaX = startX - moveEvent.clientX; 
                setChatWidth(Math.max(300, Math.min(startWidth + deltaX, window.innerWidth - 400)));
              };
              const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
              };
              document.addEventListener('mousemove', onMouseMove);
              document.addEventListener('mouseup', onMouseUp);
            }}
          />
        )}
{/* ── Center: Chat Dialogue ─────────────────────────────────────────── */}
        <aside className="flex flex-col overflow-hidden bg-white z-0 border-l border-gray-200" style={{ width: viewerDoc ? `${chatWidth}px` : '100%', flex: viewerDoc ? 'none' : '1' }}>
          
          {/* Chat Toolbar: Conversation switcher dropdown */}
          <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between shadow-sm select-none">
            <div className="flex items-center gap-3">
              <select
                value={conversationId ?? ''}
                onChange={e => {
                  const val = e.target.value;
                  if (val) selectConversation(Number(val));
                  else newConversation();
                }}
                className="border border-gray-300 rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white font-semibold text-gray-700 max-w-[200px]"
              >
                <option value="">+ Nueva Conversación</option>
                {conversations.map(c => (
                  <option key={c.id} value={c.id}>
                    💬 {c.title || `Chat #${c.id}`}
                  </option>
                ))}
              </select>
              {convsLoading && <div className="w-3.5 h-3.5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />}
            </div>

            {renderedMessages.length > 0 && (
              <button
                onClick={newConversation}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-bold transition-colors"
              >
                + Limpiar Pantalla
              </button>
            )}
          </div>

          {/* Messages Display (Tree rendering active branch) */}
          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6 bg-gray-50/20">
            {renderedMessages.length === 0 && !streaming && (
              aiAssistantEnabled && docs.length === 0 ? (
                <div className="max-w-xl mx-auto flex flex-col items-center justify-center h-full space-y-6 text-center select-none animate-fade-in p-6 my-auto">
                  <div className="w-14 h-14 bg-indigo-55 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center shadow-md animate-pulse">
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                  </div>
                  <div className="space-y-1">
                    <h3 className="font-extrabold text-gray-900 text-lg tracking-tight">🎓 Modo Curso con Agente de IA</h3>
                    <p className="text-xs text-gray-400 max-w-sm mx-auto leading-relaxed">
                      Este notebook está configurado como un camino de aprendizaje estructurado secuencialmente por IA.
                    </p>
                  </div>

                  <div className="w-full bg-white border border-gray-200 rounded-2xl p-5 shadow-sm text-left space-y-3.5">
                    <h4 className="font-bold text-[10px] text-gray-450 uppercase tracking-wider select-none">Pasos para estructurar tu curso</h4>
                    
                    <div className="space-y-3.5">
                      <div className="flex gap-3">
                        <div className="w-6 h-6 bg-indigo-50 text-indigo-700 rounded-full flex items-center justify-center font-extrabold text-xs shrink-0 select-none">
                          1
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-xs font-bold text-gray-800">Cargar tu material de estudio</p>
                          <p className="text-[10px] text-gray-400 leading-relaxed">Usa la barra lateral izquierda para subir tus archivos PDF, Word o insertar URLs web.</p>
                          {me?.role !== 'user' && (
                            <button
                              onClick={() => fileRef.current?.click()}
                              className="mt-1 text-[10px] text-indigo-650 hover:text-indigo-800 font-extrabold flex items-center gap-1 hover:underline"
                            >
                              ➕ Cargar primer archivo ahora
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-3">
                        <div className="w-6 h-6 bg-indigo-50 text-indigo-700 rounded-full flex items-center justify-center font-extrabold text-xs shrink-0 select-none">
                          2
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-xs font-bold text-gray-800">Estructurar secuencia y etapas</p>
                          <p className="text-[10px] text-gray-400 leading-relaxed">Tras subir tus archivos, dispondrás de la herramienta **"⚙️ Organizar Temario"** para ordenarlos manualmente o dejar que la IA sugiera una secuencia pedagógica óptima.</p>
                        </div>
                      </div>

                      <div className="flex gap-3">
                        <div className="w-6 h-6 bg-indigo-50 text-indigo-700 rounded-full flex items-center justify-center font-extrabold text-xs shrink-0 select-none">
                          3
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-xs font-bold text-gray-800">Cuestionarios interactivos y Examen Final</p>
                          <p className="text-[10px] text-gray-400 leading-relaxed">La IA autogenerará cuestionarios interactivos de 3 preguntas para cada archivo y un examen integrador final de 5 preguntas al completar el curso.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-3.5 text-center select-none animate-fade-in">
                  <div className="w-16 h-16 bg-indigo-50/50 text-indigo-500 rounded-2xl flex items-center justify-center shadow-inner">
                    <svg className="w-9 h-9" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                  </div>
                  <div className="space-y-1">
                    <p className="font-bold text-gray-800 text-base">Hacé una pregunta sobre tus documentos</p>
                    <p className="text-xs text-gray-400 max-w-xs leading-relaxed">
                      La IA buscará en las páginas de tus archivos seleccionados y responderá con citas detalladas
                    </p>
                  </div>
                </div>
              )
            )}

            {renderedMessages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}>
                <div className={`max-w-[78%] group relative flex flex-col`}>
                  
                  <div className={`rounded-2xl px-4 py-3 shadow-sm border ${
                    msg.role === 'user'
                      ? 'bg-indigo-600 text-white rounded-br-sm border-indigo-600'
                      : 'bg-white border-gray-200 text-gray-800 rounded-bl-sm shadow-gray-100'
                  }`}>
                    
                    {/* User Edit Box */}
                    {editingMsgId === msg.id ? (
                      <div className="space-y-2 py-1 select-text">
                        <textarea
                          value={editingText}
                          onChange={e => setEditingText(e.target.value)}
                          className="w-full text-sm text-gray-800 bg-white border border-gray-300 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-sans resize-none"
                          rows={2}
                        />
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => handleConfirmEdit(msg.id)}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg transition-all"
                          >
                            Reenviar y Recalcular
                          </button>
                          <button
                            onClick={() => { setEditingMsgId(null); setEditingText(''); }}
                            className="bg-gray-100 hover:bg-gray-200 text-gray-600 text-[11px] font-bold px-3 py-1.5 rounded-lg transition-all"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {/* Text rendering */}
                        {msg.role === 'user' ? (
                          <p className="whitespace-pre-wrap text-sm leading-relaxed select-text">{msg.content}</p>
                        ) : (
                          renderMarkdown(msg.content)
                        )}

                        {/* Citation Links */}
                        {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
                          <div className="mt-3.5 pt-3 border-t border-gray-100 space-y-1.5 select-none">
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Fuentes utilizadas:</p>
                            {msg.sources.map((s, i) => (
                              <button
                                key={i}
                                onClick={() => handleCitationClick(s)}
                                className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800 font-bold transition-colors text-left bg-indigo-50/20 hover:bg-indigo-50/60 border border-indigo-100/40 rounded-lg px-2 py-1"
                              >
                                📎 {s.folder_path ? `${s.folder_path} / ` : ''}{s.document_name}
                                {s.page_number ? ` · pág. ${s.page_number}` : ''} 
                                <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider ml-1">({Math.round(s.similarity * 100)}%)</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Sibling Version Switche & User Edit Trigger */}
                  <div className={`flex items-center justify-between mt-1 px-1`}>
                    {renderVersionSelector(msg)}
                    
                    {msg.role === 'user' && editingMsgId !== msg.id && (
                      <button
                        onClick={() => { setEditingMsgId(msg.id); setEditingText(msg.content); }}
                        className="text-[10px] font-bold text-gray-400 hover:text-indigo-600 transition-colors opacity-0 group-hover:opacity-100 ml-auto flex items-center gap-1"
                      >
                        ✏️ Editar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* Streaming Bubble */}
            {streaming && (
              <div className="flex justify-start animate-fade-in">
                <div className="max-w-[78%] bg-white border border-gray-200 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm shadow-gray-50 flex flex-col">
                  {streamBuffer ? (
                    <>
                      {renderMarkdown(streamBuffer)}
                      <span className="inline-block w-1.5 h-4 bg-indigo-500 ml-0.5 animate-pulse rounded-sm self-start mt-1" />
                    </>
                  ) : (
                    <div className="flex gap-1.5 items-center py-2 select-none">
                      <span className="w-2.5 h-2.5 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-2.5 h-2.5 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-2.5 h-2.5 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  )}
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Chat Form Textarea */}
          <div className="bg-white border-t border-gray-200 p-4 sticky bottom-0 z-10 shadow-md">
            
            {/* Show Citations Context previews before sending */}
            {sources.length > 0 && (
              <div className="mb-3.5 flex gap-2 overflow-x-auto pb-1.5 select-none">
                {sources.map((s, i) => (
                  <span key={i} className="flex-shrink-0 text-xs bg-indigo-50/50 text-indigo-700 font-semibold rounded-lg px-2.5 py-1 border border-indigo-100/50">
                    {s.document_name}{s.page_number ? ` p.${s.page_number}` : ''}
                  </span>
                ))}
              </div>
            )}

            <div className="flex gap-3 items-end">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Preguntá sobre tus documentos… (Enter para enviar)"
                rows={1}
                className="flex-1 border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white font-sans resize-none max-h-32 shadow-inner"
                style={{ height: 'auto' }}
                onInput={e => {
                  const t = e.currentTarget;
                  t.style.height = 'auto';
                  t.style.height = `${t.scrollHeight}px`;
                }}
              />
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || streaming}
                className="flex-shrink-0 w-11 h-11 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-xl flex items-center justify-center transition-all shadow-md shadow-indigo-100 hover:shadow-indigo-200"
              >
                {streaming ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                )}
              </button>
            </div>
            <p className="text-[10px] text-gray-400 font-semibold mt-2 text-center uppercase tracking-wider select-none">
              Enter para enviar · Shift+Enter para nueva línea
            </p>
          </div>
        </aside>

        
      </div>

      {/* ─── Profile Modal ──────────────────────────────────────────────────── */}
      {showProfile && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-xl border border-gray-100 animate-slide-up">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900 text-lg">Mi Perfil</h3>
              <button onClick={() => { setShowProfile(false); setProfileError(''); setProfileSuccess(''); }} className="text-gray-400 hover:text-gray-600 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="bg-gray-50 rounded-xl p-3 text-xs sm:text-sm font-medium space-y-1">
              <p className="text-gray-500">Nombre completo: <strong className="text-gray-800">{me?.full_name || 'Sin especificar'}</strong></p>
              <p className="text-gray-500">Usuario: <strong className="text-gray-800">{me?.username}</strong></p>
              <p className="text-gray-500">Rol asignado: <strong className="text-gray-800 uppercase tracking-wider">{me?.role}</strong></p>
            </div>

            <form onSubmit={handlePasswordChange} className="space-y-3.5">
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">Cambiar Contraseña</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Nueva contraseña"
                  className="w-full border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
                  required
                />
              </div>

              {profileError && <p className="text-xs text-red-600 bg-red-50 rounded-lg p-2.5 font-medium">{profileError}</p>}
              {profileSuccess && <p className="text-xs text-green-600 bg-green-50 rounded-lg p-2.5 font-medium">{profileSuccess}</p>}

              <button
                type="submit"
                disabled={profileLoading}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl py-2.5 text-sm transition-all shadow-md shadow-indigo-100"
              >
                {profileLoading ? 'Guardando...' : 'Cambiar Contraseña'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ─── Share ACL / Invitations Modal ──────────────────────────────────── */}
      {showShareModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-40 animate-fade-in">
          <div className="bg-white rounded-2xl w-full max-w-xl flex flex-col shadow-2xl border border-gray-100 overflow-hidden animate-slide-up">
            
            {/* Modal Header */}
            <div className="px-6 py-4.5 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">🔗</span>
                <h3 className="font-bold text-gray-900 text-lg">Compartir Notebook</h3>
              </div>
              <button onClick={() => { setShowShareModal(false); setUserSearchQuery(''); setUserSearchResults([]); setGeneratedInviteLink(''); }} className="text-gray-400 hover:text-gray-600 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-6 overflow-y-auto max-h-[75vh]">
              
              {/* SECTION 1: LINK GENERATOR */}
              <div className="space-y-3">
                <h4 className="font-bold text-gray-900 text-sm">Generar Enlace de Invitación</h4>
                
                <div className="flex flex-col sm:flex-row gap-3">
                  <select
                    value={invitePermission}
                    onChange={e => setInvitePermission(e.target.value)}
                    className="border border-gray-300 bg-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                  >
                    <option value="user">User (Lector / Chat únicamente)</option>
                    <option value="creator">Creator (Habilidad de Cargar / Editar)</option>
                  </select>
                  
                  <button
                    onClick={handleCreateInvitationLink}
                    disabled={inviteLinkLoading}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl px-4 py-2.5 text-xs transition-all shadow-md shadow-indigo-100"
                  >
                    {inviteLinkLoading ? 'Generando...' : 'Generar Enlace'}
                  </button>
                </div>

                {generatedInviteLink && (
                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex gap-2.5 items-center justify-between">
                    <span className="text-xs text-gray-600 font-mono select-all truncate flex-1">{generatedInviteLink}</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(generatedInviteLink);
                        alert('¡Enlace de invitación copiado al portapapeles!');
                      }}
                      className="bg-indigo-100 hover:bg-indigo-200 text-indigo-700 font-bold px-3 py-1.5 rounded-lg text-[10px] tracking-wider uppercase transition-colors shrink-0"
                    >
                      Copiar
                    </button>
                  </div>
                )}
              </div>

              <hr className="border-gray-150" />

              {/* SECTION 2: ADD USER VIA SEARCH AUTOCOMPLETE */}
              <div className="space-y-3 relative">
                <h4 className="font-bold text-gray-900 text-sm">Habilitar Usuario Específico</h4>
                <div className="relative">
                  <input
                    type="text"
                    value={userSearchQuery}
                    onChange={e => setUserSearchQuery(e.target.value)}
                    placeholder="Buscar por @username o Nombre Completo..."
                    className="w-full border border-gray-300 rounded-xl px-3.5 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  {searchLoading && <div className="absolute right-3.5 top-3 w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />}
                </div>

                {/* Dropdown search results */}
                {userSearchResults.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 divide-y divide-gray-50 max-h-48 overflow-y-auto">
                    {userSearchResults.map(u => (
                      <div
                        key={u.id}
                        className="p-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-gray-900">{u.full_name || 'Sin especificar'}</span>
                          <span className="text-[10px] text-gray-400 font-semibold">{u.username}</span>
                        </div>
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => handleAddNotebookUser(u.id, 'user')}
                            className="bg-gray-100 hover:bg-indigo-50 text-gray-600 hover:text-indigo-700 font-bold px-2 py-1 rounded text-[10px] transition-colors"
                          >
                            Lector
                          </button>
                          <button
                            onClick={() => handleAddNotebookUser(u.id, 'creator')}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-2 py-1 rounded text-[10px] transition-colors"
                          >
                            Editor
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <hr className="border-gray-150" />

              {/* SECTION 3: ACL LIST */}
              <div className="space-y-3">
                <h4 className="font-bold text-gray-900 text-sm">Usuarios Habilitados en este Notebook</h4>
                
                {sharedUsersLoading ? (
                  <div className="flex justify-center py-4">
                    <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : sharedUsers.length === 0 ? (
                  <p className="text-xs text-gray-400 font-medium">Ningún usuario externo tiene acceso a este notebook todavía.</p>
                ) : (
                  <div className="border border-gray-200 rounded-xl divide-y divide-gray-150 overflow-hidden">
                    {sharedUsers.map(u => (
                      <div key={u.user_id} className="p-3 flex items-center justify-between hover:bg-gray-50/50">
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-gray-900">{u.full_name || 'Sin especificar'}</span>
                          <span className="text-[10px] text-gray-400 font-semibold">{u.username}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${u.role === 'creator' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'}`}>
                            {u.role === 'creator' ? 'Editor' : 'Lector'}
                          </span>
                          <button
                            onClick={() => handleRemoveNotebookUser(u.user_id)}
                            className="text-red-500 hover:text-red-700 text-xs font-bold"
                          >
                            Quitar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Citation Excerpt Detail Modal (Backup popup if doc is deleted) ─── */}
      {activeCitation && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-xl border border-gray-100 animate-slide-up">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-gray-900 text-base truncate max-w-[280px]">
                  📌 Cita: {activeCitation.document_name}
                </h3>
                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider mt-0.5">
                  Similitud: {Math.round(activeCitation.similarity * 100)}% {activeCitation.page_number ? ` · Página ${activeCitation.page_number}` : ''}
                </p>
              </div>
              
              <button onClick={() => setActiveCitation(null)} className="text-gray-400 hover:text-gray-600 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-xs sm:text-sm select-text text-gray-700 leading-relaxed max-h-60 overflow-y-auto select-text font-serif">
              "{activeCitation.excerpt}"
            </div>
          </div>
        </div>
      )}

      {/* ─── Cuestionario (Quiz) Modal ────────────────────────────────────────── */}
      {showQuizModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center p-4 z-50 overflow-y-auto animate-fade-in">
          <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl border border-gray-100 overflow-hidden my-8 animate-slide-up flex flex-col max-h-[90vh]">
            
            {/* Modal Header */}
            <div className="px-6 py-4.5 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <div className="flex items-center gap-2">
                <span className="text-xl">📝</span>
                <div>
                  <h3 className="font-bold text-gray-950 text-base sm:text-lg">Cuestionario de IA</h3>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Respondé 3 de 3 correctas para aprobar</p>
                </div>
              </div>
              {!quizSubmitting && (
                <button 
                  onClick={() => { setShowQuizModal(false); setQuizFeedback(null); setQuizDocId(null); }} 
                  className="text-gray-400 hover:text-gray-600 transition-colors p-1"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {quizLoading ? (
                <div className="flex flex-col items-center justify-center py-16 space-y-3">
                  <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                  <p className="text-xs text-gray-400 font-bold uppercase tracking-wider animate-pulse">Generando cuestionario con Llama 3.3…</p>
                </div>
              ) : quizError ? (
                <div className="bg-red-50 border border-red-150 rounded-2xl p-4 text-center">
                  <p className="text-xs sm:text-sm text-red-600 font-semibold">{quizError}</p>
                  <button 
                    onClick={() => quizDocId && handleLaunchQuiz(quizDocId)} 
                    className="mt-3 bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-4 py-2 rounded-xl transition-all shadow-sm"
                  >
                    Volver a intentar
                  </button>
                </div>
              ) : (
                <div className="space-y-8 select-text">
                  {quizQuestions.map((q, qIdx) => {
                    const feedback = quizFeedback ? quizFeedback.find(f => f.questionIndex === qIdx) : null;
                    const selected = quizAnswers[qIdx];

                    return (
                      <div key={qIdx} className="space-y-3.5 border-b border-gray-100 pb-6 last:border-0 last:pb-0">
                        <h4 className="font-bold text-gray-900 text-sm sm:text-base select-text">
                          <span className="text-indigo-600 font-extrabold mr-1.5">{qIdx + 1}.</span> 
                          {q.question}
                        </h4>

                        <div className="grid grid-cols-1 gap-2.5">
                          {q.options.map((opt, optIdx) => {
                            const optionLetter = opt.trim().charAt(0).toUpperCase(); // "A", "B", etc.
                            const isCurrentSelected = selected === optionLetter;

                            let btnStyle = 'border-gray-200 bg-white text-gray-700 hover:border-indigo-300';
                            if (isCurrentSelected) {
                              btnStyle = 'border-indigo-600 bg-indigo-50/10 text-indigo-700 font-semibold ring-2 ring-indigo-500/10';
                            }

                            if (feedback) {
                              const isThisCorrect = feedback.correctAnswer.trim().toUpperCase().charAt(0) === optionLetter;
                              const isThisUserSelection = feedback.userAnswer.trim().toUpperCase().charAt(0) === optionLetter;

                              if (isThisCorrect) {
                                btnStyle = 'border-green-600 bg-green-50/20 text-green-800 font-semibold';
                              } else if (isThisUserSelection && !feedback.isCorrect) {
                                btnStyle = 'border-red-600 bg-red-50/20 text-red-800 font-semibold';
                              } else {
                                btnStyle = 'border-gray-200 bg-white text-gray-400 opacity-60 pointer-events-none';
                              }
                            }

                            return (
                              <button
                                key={optIdx}
                                type="button"
                                disabled={!!feedback}
                                onClick={() => handleQuizAnswerSelect(qIdx, optionLetter)}
                                className={`w-full text-left border rounded-xl px-4 py-3 text-xs sm:text-sm transition-all duration-150 font-medium ${btnStyle}`}
                              >
                                {opt}
                              </button>
                            );
                          })}
                        </div>

                        {feedback && (
                          <div className={`mt-3 p-3.5 rounded-2xl border text-xs leading-relaxed ${feedback.isCorrect ? 'bg-green-50/30 border-green-150 text-green-800' : 'bg-red-50/30 border-red-150 text-red-800'}`}>
                            <p className="font-extrabold mb-1">{feedback.isCorrect ? '✅ ¡Correcto!' : '❌ Incorrecto'}</p>
                            <p className="font-medium text-gray-700">{feedback.explanation}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            {!quizLoading && !quizError && (
              <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-between shrink-0">
                {quizFeedback ? (
                  (() => {
                    const allCorrect = quizFeedback.every(f => f.isCorrect);
                    return (
                      <div className="w-full flex flex-col sm:flex-row items-center justify-between gap-3">
                        <span className={`text-xs sm:text-sm font-bold ${allCorrect ? 'text-green-700' : 'text-amber-700'}`}>
                          {allCorrect 
                            ? '🎉 ¡Excelente! Aprobaste con 3/3 respuestas correctas.' 
                            : `⚠️ Obtuviste ${quizFeedback.filter(f => f.isCorrect).length}/3 correctas. Debés aprobar el 100% para continuar.`
                          }
                        </span>
                        {allCorrect ? (
                          <button
                            onClick={() => { setShowQuizModal(false); setQuizFeedback(null); setQuizDocId(null); }}
                            className="bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl px-5 py-2 text-xs transition-all shadow-md"
                          >
                            Cerrar y Continuar
                          </button>
                        ) : (
                          <button
                            onClick={() => setQuizFeedback(null)}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl px-5 py-2 text-xs transition-all shadow-md"
                          >
                            Reintentar Cuestionario
                          </button>
                        )}
                      </div>
                    );
                  })()
                ) : (
                  <button
                    onClick={handleQuizSubmit}
                    disabled={quizSubmitting || quizAnswers.some(a => !a)}
                    className="w-full sm:w-auto ml-auto bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-extrabold rounded-xl px-6 py-2.5 text-xs tracking-wider uppercase transition-all shadow-md shadow-indigo-100"
                  >
                    {quizSubmitting ? 'Enviando...' : 'Enviar Respuestas'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Examen Final Modal ──────────────────────────────────────────────── */}
      {showFinalExamModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center p-4 z-50 overflow-y-auto animate-fade-in">
          <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl border border-gray-100 overflow-hidden my-8 animate-slide-up flex flex-col max-h-[90vh]">
            
            {/* Modal Header */}
            <div className="px-6 py-4.5 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <div className="flex items-center gap-2">
                <span className="text-xl">🎓</span>
                <div>
                  <h3 className="font-bold text-gray-950 text-base sm:text-lg">Examen Final Integrador</h3>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Respondé al menos 4 de 5 correctas para aprobar</p>
                </div>
              </div>
              {!finalExamSubmitting && (
                <button 
                  onClick={() => { setShowFinalExamModal(false); setFinalExamFeedback(null); }} 
                  className="text-gray-400 hover:text-gray-600 transition-colors p-1"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {finalExamLoading ? (
                <div className="flex flex-col items-center justify-center py-16 space-y-3">
                  <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                  <p className="text-xs text-gray-400 font-bold uppercase tracking-wider animate-pulse">Generando examen integrador con Llama 3.3…</p>
                </div>
              ) : finalExamError ? (
                <div className="bg-red-50 border border-red-150 rounded-2xl p-4 text-center">
                  <p className="text-xs sm:text-sm text-red-600 font-semibold">{finalExamError}</p>
                  <button 
                    onClick={handleLaunchFinalExam} 
                    className="mt-3 bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-4 py-2 rounded-xl transition-all shadow-sm"
                  >
                    Volver a intentar
                  </button>
                </div>
              ) : (
                <div className="space-y-8 select-text">
                  {finalExamQuestions.map((q, qIdx) => {
                    const feedback = finalExamFeedback ? finalExamFeedback.find(f => f.questionIndex === qIdx) : null;
                    const selected = finalExamAnswers[qIdx];

                    return (
                      <div key={qIdx} className="space-y-3.5 border-b border-gray-100 pb-6 last:border-0 last:pb-0">
                        <h4 className="font-bold text-gray-900 text-sm sm:text-base select-text">
                          <span className="text-amber-500 font-extrabold mr-1.5">{qIdx + 1}.</span> 
                          {q.question}
                        </h4>

                        <div className="grid grid-cols-1 gap-2.5">
                          {q.options.map((opt, optIdx) => {
                            const optionLetter = opt.trim().charAt(0).toUpperCase();
                            const isCurrentSelected = selected === optionLetter;

                            let btnStyle = 'border-gray-200 bg-white text-gray-700 hover:border-indigo-300';
                            if (isCurrentSelected) {
                              btnStyle = 'border-amber-500 bg-amber-50/10 text-amber-800 font-semibold ring-2 ring-amber-500/10';
                            }

                            if (feedback) {
                              const isThisCorrect = feedback.correctAnswer.trim().toUpperCase().charAt(0) === optionLetter;
                              const isThisUserSelection = feedback.userAnswer.trim().toUpperCase().charAt(0) === optionLetter;

                              if (isThisCorrect) {
                                btnStyle = 'border-green-600 bg-green-50/20 text-green-800 font-semibold';
                              } else if (isThisUserSelection && !feedback.isCorrect) {
                                btnStyle = 'border-red-600 bg-red-50/20 text-red-800 font-semibold';
                              } else {
                                btnStyle = 'border-gray-200 bg-white text-gray-400 opacity-60 pointer-events-none';
                              }
                            }

                            return (
                              <button
                                key={optIdx}
                                type="button"
                                disabled={!!feedback}
                                onClick={() => handleFinalExamAnswerSelect(qIdx, optionLetter)}
                                className={`w-full text-left border rounded-xl px-4 py-3 text-xs sm:text-sm transition-all duration-150 font-medium ${btnStyle}`}
                              >
                                {opt}
                              </button>
                            );
                          })}
                        </div>

                        {feedback && (
                          <div className={`mt-3 p-3.5 rounded-2xl border text-xs leading-relaxed ${feedback.isCorrect ? 'bg-green-50/30 border-green-150 text-green-800' : 'bg-red-50/30 border-red-150 text-red-800'}`}>
                            <p className="font-extrabold mb-1">{feedback.isCorrect ? '✅ ¡Correcto!' : '❌ Incorrecto'}</p>
                            <p className="font-medium text-gray-700">{feedback.explanation}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            {!finalExamLoading && !finalExamError && (
              <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-between shrink-0">
                {finalExamFeedback ? (
                  (() => {
                    const hasPassed = finalExamFeedback.filter(f => f.isCorrect).length >= 4;
                    const correctCount = finalExamFeedback.filter(f => f.isCorrect).length;
                    return (
                      <div className="w-full flex flex-col sm:flex-row items-center justify-between gap-3">
                        <span className={`text-xs sm:text-sm font-bold ${hasPassed ? 'text-green-700 animate-bounce' : 'text-red-700'}`}>
                          {hasPassed 
                            ? `🏆 ¡Felicitaciones! Aprobaste el curso con ${correctCount}/5 respuestas correctas.` 
                            : `⚠️ Obtuviste ${correctCount}/5 correctas. Necesitás al menos 4 correctas para aprobar.`
                          }
                        </span>
                        {hasPassed ? (
                          <button
                            onClick={() => { setShowFinalExamModal(false); setFinalExamFeedback(null); }}
                            className="bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl px-5 py-2 text-xs transition-all shadow-md"
                          >
                            Cerrar y Finalizar Notebook
                          </button>
                        ) : (
                          <button
                            onClick={() => setFinalExamFeedback(null)}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl px-5 py-2 text-xs transition-all shadow-md"
                          >
                            Reintentar Examen
                          </button>
                        )}
                      </div>
                    );
                  })()
                ) : (
                  <button
                    onClick={handleFinalExamSubmit}
                    disabled={finalExamSubmitting || finalExamAnswers.some(a => !a)}
                    className="w-full sm:w-auto ml-auto bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white font-extrabold rounded-xl px-6 py-2.5 text-xs tracking-wider uppercase transition-all shadow-md shadow-amber-100"
                  >
                    {finalExamSubmitting ? 'Enviando...' : 'Enviar Respuestas'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
{/* ─── Modal: Intentos y Evaluaciones ─────────────────────────────── */}
      {showAttemptsModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                <span>📈</span> Historial de Evaluaciones
              </h2>
              <button onClick={() => { setShowAttemptsModal(false); setSelectedAttempt(null); }} className="text-gray-400 hover:text-gray-600 transition-colors bg-white p-2 rounded-full shadow-sm hover:shadow">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 flex flex-col">
              {!selectedAttempt ? (
                <>
                  <div className="mb-4">
                    <input
                      type="text"
                      placeholder="Buscar por nombre o usuario..."
                      value={attemptsSearch}
                      onChange={e => setAttemptsSearch(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none transition-all"
                    />
                  </div>
                  {attemptsLoading ? (
                    <div className="flex-1 flex justify-center items-center py-12"><div className="w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin"></div></div>
                  ) : (
                    <div className="overflow-x-auto border border-gray-100 rounded-xl shadow-sm">
                      <table className="w-full text-left text-sm text-gray-600">
                        <thead className="bg-gray-50 text-xs uppercase text-gray-500 font-semibold">
                          <tr>
                            <th className="px-4 py-3">Alumno</th>
                            <th className="px-4 py-3">Evaluación</th>
                            <th className="px-4 py-3">Puntaje</th>
                            <th className="px-4 py-3">Estado</th>
                            <th className="px-4 py-3">Fecha</th>
                            <th className="px-4 py-3 text-right">Acción</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {attemptsList.filter(a => (a.full_name||'').toLowerCase().includes(attemptsSearch.toLowerCase()) || a.username.toLowerCase().includes(attemptsSearch.toLowerCase())).map(a => (
                            <tr key={a.id} className="hover:bg-gray-50/50 transition-colors">
                              <td className="px-4 py-3 font-medium text-gray-800">{a.full_name || a.username}</td>
                              <td className="px-4 py-3">{a.quiz_type === 'folder' ? `Carpeta: ${a.folder_name}` : 'Examen Final'}</td>
                              <td className="px-4 py-3 font-mono">{a.score}/{a.details.length}</td>
                              <td className="px-4 py-3">
                                <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${a.passed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                  {a.passed ? 'APROBADO' : 'REPROBADO'}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-xs text-gray-500">{new Date(a.created_at).toLocaleString()}</td>
                              <td className="px-4 py-3 text-right">
                                <button onClick={() => setSelectedAttempt(a)} className="text-purple-600 hover:text-purple-800 font-semibold text-xs bg-purple-50 hover:bg-purple-100 px-3 py-1.5 rounded-lg transition-colors">
                                  Revisión
                                </button>
                              </td>
                            </tr>
                          ))}
                          {attemptsList.length === 0 && (
                            <tr><td colSpan={6} className="text-center py-8 text-gray-400">No hay intentos registrados</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-col gap-6">
                  <div className="flex items-center gap-4 border-b border-gray-100 pb-4">
                    <button onClick={() => setSelectedAttempt(null)} className="text-gray-500 hover:text-gray-800 transition-colors flex items-center gap-1 font-semibold text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg">
                      ← Volver
                    </button>
                    <div>
                      <h3 className="font-bold text-gray-900">{selectedAttempt.full_name || selectedAttempt.username}</h3>
                      <p className="text-xs text-gray-500">{selectedAttempt.quiz_type === 'folder' ? `Carpeta: ${selectedAttempt.folder_name}` : 'Examen Final'} - {new Date(selectedAttempt.created_at).toLocaleString()}</p>
                    </div>
                    <div className="ml-auto">
                      <span className={`px-3 py-1.5 rounded-xl text-sm font-bold ${selectedAttempt.passed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {selectedAttempt.score}/{selectedAttempt.details.length} ({selectedAttempt.passed ? 'Aprobado' : 'Reprobado'})
                      </span>
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    {selectedAttempt.details.map((q, i) => (
                      <div key={i} className={`p-4 rounded-xl border ${q.isCorrect ? 'bg-green-50/30 border-green-100' : 'bg-red-50/30 border-red-100'}`}>
                        <div className="flex items-start gap-3">
                          <div className={`mt-1 w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-white font-bold text-xs ${q.isCorrect ? 'bg-green-500' : 'bg-red-500'}`}>
                            {q.isCorrect ? '✓' : '×'}
                          </div>
                          <div>
                            <h4 className="font-bold text-gray-800 text-sm mb-2">{i+1}. {q.question}</h4>
                            <div className="text-sm text-gray-600 mb-2">
                              <span className="font-semibold">Respuesta del alumno:</span> 
                              <span className={`ml-1 ${q.isCorrect ? 'text-green-700' : 'text-red-600 font-medium'}`}>{q.selectedOption || '(Sin responder)'}</span>
                            </div>
                            {!q.isCorrect && (
                              <div className="text-sm text-gray-600 mb-2">
                                <span className="font-semibold">Respuesta correcta:</span> 
                                <span className="ml-1 text-green-700 font-medium">{q.correctOption}</span>
                              </div>
                            )}
                            <div className="text-xs text-gray-500 bg-white/60 p-2 rounded border border-gray-200/50 mt-2">
                              <strong>Explicación:</strong> {q.explanation}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Modal: Organizar Temario del Curso ─────────────────────────────── */}
      {showOrderModal && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl border border-gray-100 overflow-hidden animate-slide-up flex flex-col max-h-[85vh]">
            
            {/* Header */}
            <div className="px-6 py-4.5 border-b border-gray-100 flex items-center justify-between bg-gray-50/50 select-none">
              <div className="flex items-center gap-2">
                <span className="text-lg">⚙️</span>
                <div>
                  <h3 className="font-bold text-gray-950 text-sm sm:text-base text-gray-900">Organizar Camino de Aprendizaje</h3>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Establece la secuencia ordenada de lectura del curso</p>
                </div>
              </div>
              <button
                disabled={reorderLoading || suggestingOrder}
                onClick={() => setShowOrderModal(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors p-1"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* Destino de Carga (Modal) */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="font-bold text-gray-500 uppercase tracking-wider">Destino de carga:</span>
                    <span className="font-extrabold text-indigo-600 truncate">
                      {modalFolderId === null ? 'Inicio (Raíz)' : (stagedFolders.find(f => f.id === modalFolderId)?.name || 'Carpeta')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      ref={modalFileRef}
                      onChange={handleModalUpload}
                    />
                    <button
                      type="button"
                      disabled={modalUploadProgress !== null}
                      onClick={() => modalFileRef.current?.click()}
                      className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-extrabold text-[10px] px-3.5 py-2 rounded-xl transition-all shadow-sm flex items-center gap-1 disabled:opacity-50"
                    >
                      {modalUploadProgress !== null ? `Subiendo ${modalUploadProgress}%...` : '📤 Subir Archivos Aquí'}
                    </button>
                  </div>
                </div>
                {modalUploadProgress !== null && (
                  <div className="w-full bg-gray-100 rounded-full h-1 mt-1 overflow-hidden">
                    <div className="bg-indigo-600 h-1 rounded-full transition-all" style={{ width: `${modalUploadProgress}%` }} />
                  </div>
                )}
              </div>

              {/* Breadcrumbs for Modal Navigation */}
              {modalFolderId !== null && (
                <div className="flex items-center gap-1.5 px-1 pb-2">
                  <button
                    onClick={() => setModalFolderId(null)}
                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('underline', 'text-indigo-600', 'scale-105'); }}
                    onDragLeave={(e) => { e.currentTarget.classList.remove('underline', 'text-indigo-600', 'scale-105'); }}
                    onDrop={async (e) => {
                      e.preventDefault();
                      e.currentTarget.classList.remove('underline', 'text-indigo-600', 'scale-105');
                      try {
                        const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                        await handleModalDrop(data.id, data.type, null);
                      } catch {}
                    }}
                    className="font-bold text-gray-500 hover:text-indigo-650 transition-colors"
                  >
                    Inicio
                  </button>
                  <span className="text-gray-300">/</span>
                  <span className="font-extrabold text-indigo-600 underline truncate">
                    {stagedFolders.find(f => f.id === modalFolderId)?.name || 'Carpeta'}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between select-none">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                  Temario ({modalCombinedItems.length} ítems)
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowFolderModal(true)}
                    className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-extrabold text-[10px] px-3.5 py-2 rounded-xl transition-all shadow-sm flex items-center gap-1"
                  >
                    📁 Nueva Carpeta
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowTreeVideoModal(true)}
                    className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-extrabold text-[10px] px-3.5 py-2 rounded-xl transition-all shadow-sm flex items-center gap-1"
                  >
                    🎥 Añadir Video
                  </button>
                  <button
                    type="button"
                    disabled={suggestingOrder || modalCombinedItems.length <= 1}
                    onClick={handleAISuggestOrder}
                    className="bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-600 hover:to-yellow-700 disabled:opacity-50 text-white font-extrabold text-[10px] px-3.5 py-2 rounded-xl transition-all shadow-sm flex items-center gap-1 hover:shadow"
                  >
                    {suggestingOrder ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Analizando...</span>
                      </>
                    ) : (
                      <>
                        <span>🪄 Sugerir secuencia con IA</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {suggestedExplanation && (
                <div className="bg-amber-50/40 border border-amber-150 rounded-2xl p-4 animate-fade-in select-text">
                  <p className="text-[10px] font-bold text-amber-800 uppercase tracking-wider mb-1">Fundamentación Pedagógica de la IA:</p>
                  <p className="text-xs text-amber-900 font-medium leading-relaxed select-text">{suggestedExplanation}</p>
                </div>
              )}

              {modalCombinedItems.length === 0 ? (
                <p className="text-xs text-gray-405 text-gray-450 text-center py-8">Carga documentos o crea carpetas para organizar el temario.</p>
              ) : (
                <div className="space-y-2 select-none">
                  {modalCombinedItems.map((item, index) => {
                    const isFolder = item.itemType === 'folder';
                    return (
                      <div
                        key={isFolder ? `f-${item.id}` : `d-${item.id}`}
                        draggable={true}
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', JSON.stringify({ type: isFolder ? 'folder' : 'document', id: item.id }));
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragOver={isFolder ? (e) => {
                          e.preventDefault();
                          e.currentTarget.classList.add('border-indigo-400', 'bg-indigo-50/50', 'shadow-md');
                        } : undefined}
                        onDragLeave={isFolder ? (e) => {
                          e.currentTarget.classList.remove('border-indigo-400', 'bg-indigo-50/50', 'shadow-md');
                        } : undefined}
                        onDrop={isFolder ? async (e) => {
                          e.preventDefault();
                          e.currentTarget.classList.remove('border-indigo-400', 'bg-indigo-50/50', 'shadow-md');
                          try {
                            const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                            await handleModalDrop(data.id, data.type, item.id);
                          } catch {}
                        } : undefined}
                        onDoubleClick={isFolder ? () => setModalFolderId(item.id) : undefined}
                        className={`flex items-center justify-between bg-gray-50/50 border border-gray-150 rounded-2xl p-3.5 shadow-sm hover:border-indigo-300 hover:shadow-md transition-all cursor-grab active:cursor-grabbing ${isFolder ? 'border-dashed border-gray-300 bg-gray-50/80' : ''}`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0" onClick={isFolder ? () => setModalFolderId(item.id) : undefined}>
                          <div className="w-6 h-6 bg-indigo-50 text-indigo-700 font-extrabold text-[11px] rounded-lg flex items-center justify-center shrink-0">
                            {index + 1}
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="text-xs font-bold text-gray-800 truncate" title={item.name}>
                              {isFolder ? '📁 ' : '📄 '} {item.name}
                            </span>
                            {!isFolder && (
                              <span className="text-[10px] text-gray-400 font-semibold truncate">
                                📍 {item.folder_id ? stagedFolders.find(f => f.id === item.folder_id)?.name || 'Carpeta' : 'Raíz'}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {isFolder && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleToggleFolderQuiz(item.id); }}
                              className={`text-[10px] font-bold px-2 py-1 rounded-full transition-colors flex items-center gap-1 ${item.quiz_enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                              title={item.quiz_enabled ? 'Quiz obligatorio al terminar la carpeta' : 'Sin quiz'}
                            >
                              {item.quiz_enabled ? '📝 Quiz ON' : 'Quiz OFF'}
                            </button>
                          )}
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={index === 0 || reorderLoading || suggestingOrder}
                              onClick={() => handleMoveModalItem(index, 'up')}
                              className="text-gray-400 hover:text-indigo-600 disabled:opacity-30 disabled:hover:text-gray-400 p-1 hover:bg-white rounded transition-colors"
                              title="Subir nivel"
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              disabled={index === modalCombinedItems.length - 1 || reorderLoading || suggestingOrder}
                              onClick={() => handleMoveModalItem(index, 'down')}
                              className="text-gray-400 hover:text-indigo-600 disabled:opacity-30 disabled:hover:text-gray-400 p-1 hover:bg-white rounded transition-colors"
                              title="Bajar nivel"
                            >
                              ▼
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-2 shrink-0">
              <button
                type="button"
                disabled={reorderLoading || suggestingOrder}
                onClick={() => setShowOrderModal(false)}
                className="text-xs text-gray-500 hover:text-gray-855 hover:text-gray-700 font-extrabold px-4 py-2 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={reorderLoading || suggestingOrder}
                onClick={handleSaveReorder}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-extrabold rounded-xl px-5 py-2.5 text-xs transition-all shadow-md shadow-indigo-100"
              >
                {reorderLoading ? 'Guardando...' : 'Guardar Secuencia'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ─── CREATE TREE VIDEO MODAL ──────────────────────────────────────────────── */}
      {showTreeVideoModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl w-full max-w-sm flex flex-col shadow-2xl border border-gray-100 overflow-hidden animate-slide-up">
            
            {/* Modal Header */}
            <div className="px-6 py-4.5 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">🎥</span>
                <h3 className="font-bold text-gray-900 text-lg">Añadir Video</h3>
              </div>
              <button onClick={() => { setShowTreeVideoModal(false); setTreeVideoName(''); setTreeVideoCode(''); }} className="text-gray-400 hover:text-gray-600 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleIngestTreeVideo} className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-700">Nombre del Video</label>
                <input
                  type="text"
                  autoFocus
                  value={treeVideoName}
                  onChange={(e) => setTreeVideoName(e.target.value)}
                  placeholder="Ej: Clase 1 - Introducción"
                  className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-700">Código iframe o Embed URL</label>
                <input
                  type="text"
                  value={treeVideoCode}
                  onChange={(e) => setTreeVideoCode(e.target.value)}
                  placeholder="<iframe src='...'></iframe>"
                  className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                />
              </div>
              <button
                type="submit"
                disabled={treeVideoLoading || !treeVideoName.trim() || !treeVideoCode.trim()}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-extrabold rounded-xl py-3 transition-all shadow-md shadow-indigo-100"
              >
                {treeVideoLoading ? 'Añadiendo...' : 'Añadir Video'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ─── CREATE FOLDER MODAL ──────────────────────────────────────────────── */}
      {showFolderModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl w-full max-w-sm flex flex-col shadow-2xl border border-gray-100 overflow-hidden animate-slide-up">
            
            {/* Modal Header */}
            <div className="px-6 py-4.5 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">📁</span>
                <h3 className="font-bold text-gray-900 text-lg">Nueva Carpeta</h3>
              </div>
              <button onClick={() => { setShowFolderModal(false); setNewFolderName(''); }} className="text-gray-400 hover:text-gray-600 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-700">Nombre de la Carpeta</label>
                <input
                  type="text"
                  autoFocus
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder(); }}
                  placeholder="Ej. Finanzas, Contabilidad..."
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all placeholder:text-gray-400 font-medium"
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
              <button
                onClick={() => { setShowFolderModal(false); setNewFolderName(''); }}
                className="px-4 py-2 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-100 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateFolder}
                disabled={creatingFolder || !newFolderName.trim()}
                className="px-4 py-2 rounded-xl text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors shadow-md shadow-indigo-100 disabled:opacity-50"
              >
                {creatingFolder ? 'Creando...' : 'Crear Carpeta'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

