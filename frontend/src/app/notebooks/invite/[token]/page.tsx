'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { claimInvitation } from '@/lib/api';

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const activeToken = localStorage.getItem('docchat_token');
    if (!activeToken) {
      // If not authenticated, redirect to login page, preserving the invitation redirect link!
      router.replace(`/login?redirect=/notebooks/invite/${token}`);
      return;
    }

    async function processClaim() {
      try {
        const res = await claimInvitation(token);
        if (res.ok && res.notebookId) {
          router.replace(`/notebooks/${res.notebookId}`);
        } else {
          setError('Error al reclamar la invitación.');
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Este enlace de invitación ya no es válido o ha expirado.');
      }
    }

    processClaim();
  }, [token, router]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6">
      <div className="bg-white rounded-2xl shadow-md border border-gray-100 p-8 w-full max-w-md text-center">
        {error ? (
          <div className="space-y-4">
            <div className="w-14 h-14 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-800">Invitación Inválida</h2>
            <p className="text-sm text-gray-500 font-medium leading-relaxed">
              {error}
            </p>
            <button
              onClick={() => router.replace('/notebooks')}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl py-2.5 text-sm transition-all shadow-md shadow-indigo-100 hover:shadow-indigo-200"
            >
              Ir a Mis Notebooks
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="w-14 h-14 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mx-auto animate-bounce">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-800">Reclamando Invitación...</h2>
            <p className="text-sm text-gray-500 font-medium animate-pulse">
              Vinculando el notebook a tu cuenta de DocChat de manera segura
            </p>
            <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mt-6" />
          </div>
        )}
      </div>
    </div>
  );
}
