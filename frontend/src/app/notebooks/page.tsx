'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  getNotebooks, createNotebook, deleteNotebook, logout,
  getUsers, createUser, deleteUser, resetUserPassword, getActivities, changePassword,
  type Notebook, type UserAdmin, type Activity, type User
} from '@/lib/api';

export default function NotebooksPage() {
  const router = useRouter();

  // Logged User
  const [me, setMe] = useState<User | null>(null);

  // General States
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [aiAssistantEnabled, setAiAssistantEnabled] = useState(false);
  const [error, setError] = useState('');

  // Profile Modal State
  const [showProfile, setShowProfile] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');
  const [profileError, setProfileError] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);

  // Admin Dashboard State
  const [showAdmin, setShowAdmin] = useState(false);
  const [adminTab, setAdminTab] = useState<'users' | 'activities'>('users');
  const [users, setUsers] = useState<UserAdmin[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  
  // Create User Form State
  const [adminUsername, setAdminUsername] = useState('');
  const [adminFullName, setAdminFullName] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminRole, setAdminRole] = useState('user');
  const [adminError, setAdminError] = useState('');
  const [adminSuccess, setAdminSuccess] = useState('');
  const [adminLoading, setAdminLoading] = useState(false);

  // Reset Password Modal State
  const [resettingUser, setResettingUser] = useState<UserAdmin | null>(null);
  const [resetPasswordInput, setResetPasswordInput] = useState('');
  const [resetSuccess, setResetSuccess] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('docchat_token');
    const userStr = localStorage.getItem('docchat_user');
    if (!token || !userStr) {
      router.replace('/login');
      return;
    }
    const userObj = JSON.parse(userStr) as User;
    setMe(userObj);
    load();
  }, []);

  async function load() {
    try {
      const data = await getNotebooks();
      setNotebooks(data.notebooks);
    } catch {
      router.replace('/login');
    } finally {
      setLoading(false);
    }
  }

  // ── Admin Dash Loader ───────────────────────────────────────────────────────
  async function loadAdminData() {
    try {
      const usersData = await getUsers();
      setUsers(usersData.users);
      const actsData = await getActivities();
      setActivities(actsData.activities);
    } catch (err: any) {
      alert(err.message || 'Error al cargar panel de administración');
    }
  }

  useEffect(() => {
    if (showAdmin) {
      loadAdminData();
    }
  }, [showAdmin]);

  // ── Create Notebook ─────────────────────────────────────────────────────────
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError('');
    try {
      const data = await createNotebook(name.trim(), description.trim() || undefined, aiAssistantEnabled);
      setNotebooks(prev => [data.notebook, ...prev]);
      setName(''); setDescription(''); setAiAssistantEnabled(false); setShowForm(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al crear');
    } finally {
      setCreating(false);
    }
  }

  // ── Delete Notebook ─────────────────────────────────────────────────────────
  async function handleDelete(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm('¿Eliminar este notebook y todos sus documentos?')) return;
    try {
      await deleteNotebook(id);
      setNotebooks(prev => prev.filter(n => n.id !== id));
      if (showAdmin) loadAdminData(); // Refresh logs if admin is looking
    } catch (err: any) {
      alert(err.message || 'Error al eliminar');
    }
  }

  // ── Logout ──────────────────────────────────────────────────────────────────
  async function handleLogout() {
    await logout();
    router.replace('/login');
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
      // Update local storage so warning banner disappears
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

  // ── Create User (Admin) ─────────────────────────────────────────────────────
  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setAdminError('');
    setAdminSuccess('');
    if (adminPassword.length < 4) {
      setAdminError('La contraseña debe tener al menos 4 caracteres');
      return;
    }
    setAdminLoading(true);
    try {
      await createUser(adminUsername.trim(), adminPassword, adminRole, adminFullName.trim());
      setAdminSuccess(`Usuario ${adminUsername} creado con éxito`);
      setAdminUsername('');
      setAdminFullName('');
      setAdminPassword('');
      setAdminRole('user');
      loadAdminData();
    } catch (err: any) {
      setAdminError(err.message || 'Error al crear usuario');
    } finally {
      setAdminLoading(false);
    }
  }

  // ── Delete User (Admin) ─────────────────────────────────────────────────────
  async function handleDeleteUser(userId: number, username: string) {
    if (!confirm(`¿Eliminar de forma permanente al usuario ${username}?`)) return;
    try {
      await deleteUser(userId);
      setUsers(prev => prev.filter(u => u.id !== userId));
      loadAdminData();
    } catch (err: any) {
      alert(err.message || 'Error al eliminar usuario');
    }
  }

  // ── Reset Password (Admin) ──────────────────────────────────────────────────
  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setResetError('');
    setResetSuccess('');
    if (!resettingUser) return;
    if (resetPasswordInput.length < 4) {
      setResetError('La contraseña debe tener al menos 4 caracteres');
      return;
    }
    setResetLoading(true);
    try {
      await resetUserPassword(resettingUser.id, resetPasswordInput);
      setResetSuccess(`Contraseña restablecida con éxito para ${resettingUser.username}`);
      setResetPasswordInput('');
      setTimeout(() => {
        setResettingUser(null);
        setResetSuccess('');
      }, 1500);
      loadAdminData();
    } catch (err: any) {
      setResetError(err.message || 'Error al restablecer contraseña');
    } finally {
      setResetLoading(false);
    }
  }

  if (loading || !me) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans text-gray-800">
      {/* Warning Safety Banner */}
      {!me.password_changed && (
        <div className="bg-amber-500 text-white font-medium text-xs sm:text-sm text-center py-2 px-4 flex items-center justify-center gap-2 shadow-sm animate-pulse border-b border-amber-600">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>
            <strong>Atención de Seguridad:</strong> Estás utilizando la contraseña genérica. Cambiala en <strong>Mi Perfil</strong> para evitar la suspensión automática de tu cuenta (tenés 48 horas de plazo).
          </span>
        </div>
      )}

      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shadow-sm sticky top-0 z-10">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center shadow-md shadow-indigo-100">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-base text-gray-900 leading-tight">DocChat</span>
            <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">{me.role}</span>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          {me.role === 'admin' && (
            <button
              onClick={() => setShowAdmin(true)}
              className="flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs sm:text-sm font-semibold px-3.5 py-2 rounded-xl transition-all"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              <span>Panel de Control</span>
            </button>
          )}

          <button
            onClick={() => setShowProfile(true)}
            className="flex items-center gap-1.5 hover:bg-gray-50 text-gray-700 text-xs sm:text-sm font-semibold px-3 py-2 rounded-xl transition-all border border-gray-200"
          >
            <div className="w-6 h-6 bg-indigo-100 text-indigo-700 rounded-full flex items-center justify-center font-bold text-xs">
              {me.username.slice(1, 3).toUpperCase()}
            </div>
            <span className="hidden md:inline">{me.full_name || me.username}</span>
          </button>

          <button onClick={handleLogout} className="text-xs sm:text-sm text-gray-500 hover:text-red-600 font-semibold transition-colors">
            Cerrar sesión
          </button>
        </div>
      </header>

      {/* Main Body */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className="space-y-0.5">
            <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Mis Notebooks</h2>
            <p className="text-sm text-gray-500 font-medium">Accede a tus colecciones de documentos para chatear con ellos</p>
          </div>
          {me.role !== 'user' && (
            <button
              onClick={() => setShowForm(!showForm)}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4.5 py-2.5 rounded-xl transition-all shadow-md shadow-indigo-100 hover:shadow-indigo-200"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span>Nuevo notebook</span>
            </button>
          )}
        </div>

        {/* Create form */}
        {showForm && (
          <form onSubmit={handleCreate} className="bg-white rounded-2xl border border-gray-200 p-6 mb-8 space-y-4 shadow-sm">
            <div className="space-y-1">
              <h3 className="font-bold text-gray-900 text-base">Crear Nuevo Notebook</h3>
              <p className="text-xs text-gray-500 font-medium">Asigna un título y una descripción clara a tu biblioteca</p>
            </div>
            <div className="space-y-3.5">
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Nombre del notebook"
                className="w-full border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
                required
              />
              <input
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Descripción (opcional)"
                className="w-full border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
              />
              <div className="flex items-center gap-2 pt-1 pb-1">
                <input
                  type="checkbox"
                  id="ai_assistant_enabled"
                  checked={aiAssistantEnabled}
                  onChange={e => setAiAssistantEnabled(e.target.checked)}
                  className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 cursor-pointer"
                />
                <label htmlFor="ai_assistant_enabled" className="text-xs sm:text-sm font-semibold text-gray-700 cursor-pointer select-none">
                  Habilitar ayuda del agente de IA (Cuestionarios y Camino de Aprendizaje)
                </label>
              </div>
            </div>
            {error && <p className="text-sm text-red-600 font-semibold">{error}</p>}
            <div className="flex gap-2.5 pt-1">
              <button type="submit" disabled={creating} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-semibold px-4.5 py-2.5 rounded-xl transition-all shadow-md shadow-indigo-100">
                {creating ? 'Creando...' : 'Crear'}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="text-sm text-gray-500 hover:text-gray-900 font-semibold px-4 py-2">
                Cancelar
              </button>
            </div>
          </form>
        )}

        {/* Notebooks grid */}
        {notebooks.length === 0 ? (
          <div className="text-center py-24 bg-white rounded-2xl border border-gray-200 p-8 shadow-sm">
            <div className="w-16 h-16 bg-indigo-50 text-indigo-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h3 className="font-bold text-gray-900 text-lg mb-1">Sin notebooks todavía</h3>
            {me.role === 'user' ? (
              <p className="text-sm text-gray-500 font-medium max-w-sm mx-auto leading-relaxed">
                Pídele al administrador o a un creador que te habilite en su notebook, o accede mediante un enlace de invitación.
              </p>
            ) : (
              <p className="text-sm text-gray-500 font-medium max-w-sm mx-auto leading-relaxed">
                Crea tu primer notebook haciendo clic en el botón superior para empezar a cargar documentos.
              </p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {notebooks.map(nb => (
              <div
                key={nb.id}
                onClick={() => router.push(`/notebooks/${nb.id}`)}
                className="bg-white rounded-2xl border border-gray-200 p-6 cursor-pointer hover:border-indigo-400 hover:shadow-lg hover:shadow-gray-100 transition-all duration-200 group flex flex-col justify-between"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-gray-900 group-hover:text-indigo-600 transition-colors truncate text-lg tracking-tight">{nb.name}</h3>
                      {nb.description && <p className="text-sm text-gray-500 font-medium mt-0.5 line-clamp-2 leading-relaxed">{nb.description}</p>}
                    </div>
                    {me.role === 'admin' || nb.user_id === me.id ? (
                      <button
                        onClick={e => handleDelete(nb.id, e)}
                        className="ml-3 text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 p-1 hover:bg-red-50 rounded-lg"
                      >
                        <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="mt-5 pt-4 border-t border-gray-50 flex items-center gap-1 text-xs text-gray-400 font-semibold uppercase tracking-wider">
                  <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span>{nb.document_count} documento{nb.document_count !== 1 ? 's' : ''}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

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
              <p className="text-gray-500">Nombre completo: <strong className="text-gray-800">{me.full_name || 'Sin especificar'}</strong></p>
              <p className="text-gray-500">Usuario: <strong className="text-gray-800">{me.username}</strong></p>
              <p className="text-gray-500">Rol asignado: <strong className="text-gray-800 uppercase tracking-wider">{me.role}</strong></p>
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

      {/* ─── Admin Dashboard Modal ──────────────────────────────────────────── */}
      {showAdmin && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-40 overflow-hidden animate-fade-in">
          <div className="bg-white rounded-2xl w-full max-w-4xl h-[90vh] flex flex-col shadow-2xl border border-gray-100 overflow-hidden animate-slide-up">
            
            {/* Modal Header */}
            <div className="px-6 py-4.5 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 bg-gray-100 text-gray-700 rounded-lg flex items-center justify-center font-bold">
                  ⚙️
                </div>
                <h3 className="font-bold text-gray-900 text-lg">Panel de Control General</h3>
              </div>
              
              <button onClick={() => setShowAdmin(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Sub-tabs */}
            <div className="bg-gray-50 px-6 py-2 border-b border-gray-100 flex gap-4 text-xs sm:text-sm">
              <button
                onClick={() => setAdminTab('users')}
                className={`py-2 font-bold transition-all border-b-2 ${adminTab === 'users' ? 'text-indigo-600 border-indigo-600' : 'text-gray-400 border-transparent hover:text-gray-600'}`}
              >
                Gestión de Usuarios
              </button>
              <button
                onClick={() => setAdminTab('activities')}
                className={`py-2 font-bold transition-all border-b-2 ${adminTab === 'activities' ? 'text-indigo-600 border-indigo-600' : 'text-gray-400 border-transparent hover:text-gray-600'}`}
              >
                Auditoría de Actividades
              </button>
            </div>

            {/* Modal Body (Scrollable) */}
            <div className="flex-1 overflow-y-auto p-6">
              
              {/* TAB 1: USERS */}
              {adminTab === 'users' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  
                  {/* Create user form */}
                  <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 space-y-4 h-fit">
                    <div className="space-y-1">
                      <h4 className="font-bold text-gray-900 text-base">Crear Usuario</h4>
                      <p className="text-xs text-gray-500 font-medium">Registra un nuevo usuario en la plataforma</p>
                    </div>

                    <form onSubmit={handleCreateUser} className="space-y-3.5">
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Nombre Completo</label>
                        <input
                          type="text"
                          value={adminFullName}
                          onChange={e => setAdminFullName(e.target.value)}
                          placeholder="Nombre y Apellido"
                          className="w-full border border-gray-300 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Nombre de Usuario</label>
                        <input
                          type="text"
                          value={adminUsername}
                          onChange={e => setAdminUsername(e.target.value)}
                          placeholder="@usuario"
                          className="w-full border border-gray-300 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Contraseña Genérica</label>
                        <input
                          type="text"
                          value={adminPassword}
                          onChange={e => setAdminPassword(e.target.value)}
                          placeholder="Nueva contraseña genérica"
                          className="w-full border border-gray-300 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Rol en el sistema</label>
                        <select
                          value={adminRole}
                          onChange={e => setAdminRole(e.target.value)}
                          className="w-full border border-gray-300 bg-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                        >
                          <option value="user">User (Lector / Chat)</option>
                          <option value="creator">Creator (Carga Archivos / Notebooks)</option>
                          <option value="admin">Admin (Gestor de Usuarios)</option>
                        </select>
                      </div>

                      {adminError && <p className="text-xs text-red-600 bg-red-50 rounded-lg p-2.5 font-medium">{adminError}</p>}
                      {adminSuccess && <p className="text-xs text-green-600 bg-green-50 rounded-lg p-2.5 font-medium">{adminSuccess}</p>}

                      <button
                        type="submit"
                        disabled={adminLoading}
                        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl py-2.5 text-xs transition-all shadow-md shadow-indigo-100"
                      >
                        {adminLoading ? 'Registrando...' : 'Crear Usuario'}
                      </button>
                    </form>
                  </div>

                  {/* Users table */}
                  <div className="lg:col-span-2 space-y-4">
                    <h4 className="font-bold text-gray-900 text-base">Usuarios Registrados</h4>
                    
                    <div className="border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                      <table className="w-full text-left border-collapse text-xs sm:text-sm">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200 font-bold text-gray-500 select-none">
                            <th className="px-4 py-3">Nombre</th>
                            <th className="px-4 py-3">Username</th>
                            <th className="px-4 py-3">Rol</th>
                            <th className="px-4 py-3">Estado</th>
                            <th className="px-4 py-3">¿Clave Cambiada?</th>
                            <th className="px-4 py-3 text-right">Acciones</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-150">
                          {users.map(u => (
                            <tr key={u.id} className="hover:bg-gray-50/50">
                              <td className="px-4 py-3 font-semibold text-gray-900">{u.full_name || '-'}</td>
                              <td className="px-4 py-3 text-gray-500 font-medium">{u.username}</td>
                              <td className="px-4 py-3"><span className={`uppercase text-[10px] font-bold px-2 py-0.5 rounded-full ${u.role === 'admin' ? 'bg-indigo-100 text-indigo-700' : u.role === 'creator' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'}`}>{u.role}</span></td>
                              <td className="px-4 py-3"><span className={`font-semibold ${u.status === 'suspended' ? 'text-red-600 bg-red-50 px-2 py-0.5 rounded-lg' : 'text-green-600 bg-green-50 px-2 py-0.5 rounded-lg'}`}>{u.status === 'suspended' ? 'Suspendido' : 'Activo'}</span></td>
                              <td className="px-4 py-3 font-bold text-center">
                                {u.password_changed ? (
                                  <span className="text-green-600 bg-green-50 px-1.5 py-0.5 rounded-lg">Sí</span>
                                ) : (
                                  <span className="text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-lg">No (Genérica)</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right space-x-2">
                                <button
                                  onClick={() => setResettingUser(u)}
                                  className="text-indigo-600 hover:text-indigo-800 font-bold hover:underline"
                                  title="Restablecer contraseña genérica"
                                >
                                  Clave
                                </button>
                                {u.id !== me.id ? (
                                  <button
                                    onClick={() => handleDeleteUser(u.id, u.username)}
                                    className="text-red-500 hover:text-red-700 font-bold"
                                  >
                                    Borrar
                                  </button>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: ACTIVITIES */}
              {adminTab === 'activities' && (
                <div className="space-y-4">
                  <h4 className="font-bold text-gray-900 text-base">Auditoría de Actividad del Sistema</h4>
                  
                  <div className="border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                    <table className="w-full text-left border-collapse text-xs sm:text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 font-bold text-gray-500 select-none">
                          <th className="px-4 py-3">Fecha</th>
                          <th className="px-4 py-3">Usuario</th>
                          <th className="px-4 py-3">Acción</th>
                          <th className="px-4 py-3">Notebook</th>
                          <th className="px-4 py-3">Documento</th>
                          <th className="px-4 py-3">Detalle</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-150 text-gray-600 font-medium">
                        {activities.map(act => (
                          <tr key={act.id} className="hover:bg-gray-50/50">
                            <td className="px-4 py-3 text-[11px] font-semibold text-gray-400 select-none">{new Date(act.created_at).toLocaleString()}</td>
                            <td className="px-4 py-3 font-semibold text-indigo-700">{act.username}</td>
                            <td className="px-4 py-3"><span className="uppercase text-[10px] font-bold bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{act.action}</span></td>
                            <td className="px-4 py-3 truncate max-w-[120px]">{act.notebook_name || '-'}</td>
                            <td className="px-4 py-3 truncate max-w-[120px]">{act.document_name || '-'}</td>
                            <td className="px-4 py-3 text-gray-700">{act.details || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Reset Password Modal (Admin child popup) ───────────────────────── */}
      {resettingUser && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-2xl animate-slide-up">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900 text-lg">Restablecer Clave</h3>
              <button onClick={() => { setResettingUser(null); setResetError(''); setResetSuccess(''); }} className="text-gray-400 hover:text-gray-600 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <p className="text-sm text-gray-500 font-medium leading-relaxed">
              Vas a restablecer la clave del usuario <strong className="text-gray-800">{resettingUser.username}</strong> a una nueva clave genérica. El usuario tendrá un plazo de 48 horas tras volver a ingresar para cambiarla por seguridad.
            </p>

            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Nueva Clave Genérica</label>
                <input
                  type="text"
                  value={resetPasswordInput}
                  onChange={e => setResetPasswordInput(e.target.value)}
                  placeholder="Escribe la clave genérica inicial"
                  className="w-full border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                />
              </div>

              {resetError && <p className="text-xs text-red-600 bg-red-50 rounded-lg p-2.5 font-medium">{resetError}</p>}
              {resetSuccess && <p className="text-xs text-green-600 bg-green-50 rounded-lg p-2.5 font-medium">{resetSuccess}</p>}

              <button
                type="submit"
                disabled={resetLoading}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl py-2.5 text-sm transition-all shadow-md shadow-indigo-100"
              >
                {resetLoading ? 'Restableciendo...' : 'Confirmar Restablecimiento'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
