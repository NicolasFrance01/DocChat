'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    const t = localStorage.getItem('docchat_token');
    router.replace(t ? '/notebooks' : '/login');
  }, [router]);
  return null;
}
