'use client';
import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { login } from '@/lib/api';

function LoginFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get('redirect') || '/notebooks';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      router.push(redirectPath);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm border border-gray-100">
      <div className="flex flex-col items-center mb-8">
        <img src="/logoDocChat.png" alt="DocChat Logo" className="w-48 h-auto mb-2 object-contain" />
        <p className="text-sm text-gray-500 font-medium text-center">Chatea con tus documentos</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Nombre de usuario</label>
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            className="w-full border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all placeholder:text-gray-400"
            placeholder="@usuario"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Contraseña</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all placeholder:text-gray-400"
            placeholder="••••••••"
            required
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3.5 py-2.5 font-medium">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-semibold rounded-xl py-3 text-sm transition-all shadow-md shadow-indigo-100 hover:shadow-indigo-200"
        >
          {loading ? 'Entrando...' : 'Iniciar sesión'}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <Suspense fallback={
        <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm flex flex-col items-center justify-center min-h-[300px]">
          <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-sm text-gray-500 font-medium animate-pulse">Cargando acceso...</p>
        </div>
      }>
        <LoginFormContent />
      </Suspense>
    </div>
  );
}
