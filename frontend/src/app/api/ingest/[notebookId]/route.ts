import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';

export const maxDuration = 60; // seconds — needs Vercel Pro for >10s, but short PDFs fit in 10s

const API = process.env.NEXT_PUBLIC_API_URL ?? '';

async function extractText(buffer: Buffer, filename: string): Promise<{ text: string; type: string }> {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  let text = '';
  let type = '';

  if (ext === 'pdf') {
    // Dynamic import avoids the pdf-parse test-file issue in Next.js
    const pdfParse = (await import('pdf-parse')).default;
    
    // Custom page rendering function to inject page breaks
    const render_page = (pageData: any) => {
      return pageData.getTextContent()
        .then(function(textContent: any) {
          let pageText = '';
          for (let item of textContent.items) {
            pageText += item.str + ' ';
          }
          return `\n--- PAGE_BREAK_P_${pageData.pageIndex + 1} ---\n` + pageText;
        });
    };

    const data = await pdfParse(buffer, { pagerender: render_page });
    text = data.text;
    type = 'pdf';
  } else if (ext === 'docx' || ext === 'doc') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
    type = 'docx';
  } else {
    // txt / md — plain text
    text = buffer.toString('utf8');
    type = 'txt';
  }

  // Remove null bytes which crash PostgreSQL
  text = text.replace(/\0/g, '');
  return { text, type };
}


export async function POST(
  req: NextRequest,
  { params }: { params: { notebookId: string } }
) {
  try {
    const token = req.headers.get('x-session-token');
    if (!token) return NextResponse.json({ error: 'Token requerido' }, { status: 401 });

    const folderId = req.nextUrl.searchParams.get('folder_id');

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'Archivo requerido' }, { status: 400 });

    const allowedExts = ['pdf', 'docx', 'doc', 'txt', 'md'];
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!allowedExts.includes(ext)) {
      return NextResponse.json({ error: 'Formato no soportado (pdf, docx, txt, md)' }, { status: 400 });
    }

    // Load file into memory — happens on Vercel (1GB RAM), not Render (512MB)
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { text, type } = await extractText(buffer, file.name);
    if (!text.trim()) {
      return NextResponse.json({ error: 'No se pudo extraer texto del archivo' }, { status: 422 });
    }

    // Subir el archivo original a Vercel Blob si el token está configurado
    let fileUrl = file.name;
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      try {
        const blob = await put(file.name, buffer, {
          access: 'public',
          token: process.env.BLOB_READ_WRITE_TOKEN,
        });
        fileUrl = blob.url;
        console.log('[ingest] Subido exitosamente a Vercel Blob:', fileUrl);
      } catch (blobErr) {
        console.error('[ingest] Falló la subida a Vercel Blob, usando fallback:', blobErr);
      }
    } else {
      console.warn('[ingest] BLOB_READ_WRITE_TOKEN no configurado en Next.js. Usando fallback de nombre de archivo local.');
    }

    // Forward extracted text (lightweight string) to Render for embedding
    const backendRes = await fetch(`${API}/api/notebooks/${params.notebookId}/documents/text`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Token': token,
      },
      body: JSON.stringify({ name: file.name, type, source: fileUrl, text, folder_id: folderId ? Number(folderId) : null }),
    });

    const data = await backendRes.json();
    return NextResponse.json(data, { status: backendRes.status });

  } catch (err: unknown) {
    console.error('[ingest route]', err);
    const msg = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
