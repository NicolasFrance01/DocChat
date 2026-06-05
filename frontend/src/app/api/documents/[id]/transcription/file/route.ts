import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60; // seconds — needs Vercel Pro for >10s

const API = process.env.NEXT_PUBLIC_API_URL ?? '';

async function extractText(buffer: Buffer, filename: string): Promise<{ text: string; type: string }> {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';

  if (ext === 'pdf') {
    const pdfParse = (await import('pdf-parse')).default;
    const render_page = (pageData: any) => {
      return pageData.getTextContent()
        .then(function(textContent: any) {
          let text = '';
          for (let item of textContent.items) {
            text += item.str + ' ';
          }
          return `\n--- PAGE_BREAK_P_${pageData.pageIndex + 1} ---\n` + text;
        });
    };

    const data = await pdfParse(buffer, { pagerender: render_page });
    return { text: data.text, type: 'pdf' };
  }

  if (ext === 'docx' || ext === 'doc') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return { text: result.value, type: 'docx' };
  }

  // txt / md — plain text
  return { text: buffer.toString('utf8'), type: 'txt' };
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const token = req.headers.get('x-session-token');
    if (!token) return NextResponse.json({ error: 'Token requerido' }, { status: 401 });

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'Archivo requerido' }, { status: 400 });

    const allowedExts = ['pdf', 'docx', 'doc', 'txt', 'md'];
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!allowedExts.includes(ext)) {
      return NextResponse.json({ error: 'Formato no soportado (pdf, docx, txt, md)' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { text } = await extractText(buffer, file.name);
    if (!text.trim()) {
      return NextResponse.json({ error: 'No se pudo extraer texto del archivo' }, { status: 422 });
    }

    // Forward extracted text to Render for transcription update
    const backendRes = await fetch(`${API}/api/documents/${params.id}/transcription`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Token': token,
      },
      body: JSON.stringify({ transcription: text }),
    });

    const data = await backendRes.json();
    return NextResponse.json(data, { status: backendRes.status });

  } catch (err: unknown) {
    console.error('[transcription upload route]', err);
    const msg = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
