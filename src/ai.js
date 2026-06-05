'use strict';

const Groq = require('groq-sdk');
const db = require('./db');

let groq;

function getGroq() {
  if (!groq) groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return groq;
}

// ─── Embeddings (Gemini text-embedding-004, 768 dims) ─────────────────────────

async function embedText(text) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY no configurada');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`;
  const truncated = text.slice(0, 8000);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: "models/gemini-embedding-001",
      content: {
        parts: [{ text: truncated }]
      },
      outputDimensionality: 768
    }),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error?.message || `Error en la API de Gemini: ${res.status}`);
  }

  const data = await res.json();
  if (!data.embedding || !data.embedding.values) {
    throw new Error('Formato de respuesta de embedding de Gemini inesperado');
  }

  return data.embedding.values; // number[]
}

// Embed many chunks; Gemini free tier allows ~1500 req/min, so no batching needed at this scale
async function embedChunks(chunks) {
  const results = [];
  for (const chunk of chunks) {
    const embedding = await embedText(chunk.content);
    results.push({ ...chunk, embedding });
  }
  return results;
}

// ─── System prompts ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT_RAG = `Eres un asistente inteligente. Tenés acceso a fragmentos de documentos del usuario.

Reglas:
- Respondé principalmente usando los fragmentos proporcionados.
- Si la respuesta está en los fragmentos, citá el documento y la página si está disponible.
- Si la pregunta es general o no tiene que ver con los documentos, respondé igual con tu conocimiento.
- Respondé siempre en el mismo idioma que la pregunta del usuario.
- Sé conciso pero completo.`;

const SYSTEM_PROMPT_FREE = `Eres un asistente inteligente y conversacional.
Respondé siempre en el mismo idioma que el usuario. Sé conciso pero completo.`;

function buildUserContent(userMessage, relevantChunks) {
  if (relevantChunks.length === 0) return userMessage;
  const contextBlock = relevantChunks
    .map((c, i) => {
      const pageInfo = c.page_number ? ` (página ${c.page_number})` : '';
      return `[Fragmento ${i + 1} — ${c.document_name}${pageInfo}]\n${c.content}`;
    })
    .join('\n\n---\n\n');
  return `FRAGMENTOS RELEVANTES DE LOS DOCUMENTOS:\n\n${contextBlock}\n\n---\n\nPregunta: ${userMessage}`;
}

async function generateConversationTitle(userMessage, assistantResponse) {
  try {
    const prompt = `Genera un título extremadamente corto, conciso y amigable (máximo 4 palabras y en una sola línea, sin comillas ni aclaraciones) en español para una conversación que comienza con esta pregunta: "${userMessage.slice(0, 100)}" y tiene esta respuesta inicial: "${assistantResponse.slice(0, 150)}..."`;
    const completion = await getGroq().chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 30,
    });
    return completion.choices[0].message.content.trim().replace(/^["']|["']$/g, '');
  } catch (err) {
    console.error('[generateTitle] failed:', err);
    return userMessage.slice(0, 40) + '...';
  }
}

async function chat({ notebookId, userMessage, history = [], documentIds = null }) {
  const recentHistory = history.slice(-12);

  // Try RAG only if there are documents with embeddings
  let relevantChunks = [];
  try {
    const queryEmbedding = await embedText(userMessage);
    relevantChunks = await db.searchChunks(notebookId, queryEmbedding, 5, documentIds);
  } catch { /* no embeddings available — fall through to free mode */ }

  const systemPrompt = relevantChunks.length > 0 ? SYSTEM_PROMPT_RAG : SYSTEM_PROMPT_FREE;
  const userContent = buildUserContent(userMessage, relevantChunks);

  const completion = await getGroq().chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: systemPrompt },
      ...recentHistory.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: userContent },
    ],
    temperature: 0.5,
    max_tokens: 1024,
  });

  const answer = completion.choices[0].message.content.trim();
  const sources = await Promise.all(relevantChunks.map(async (c) => ({
    chunk_id: c.id,
    document_id: c.document_id,
    document_name: c.document_name,
    page_number: c.page_number,
    excerpt: c.content, // Return full content for premium interactive citations
    folder_path: c.folder_id ? await db.getFolderPath(c.folder_id) : '',
    similarity: Math.round(c.similarity * 100) / 100,
  })));

  return { answer, sources };
}

// ─── Streaming version (SSE) ──────────────────────────────────────────────────

async function chatStream({ notebookId, userMessage, history = [], documentIds = null, progressSummary = null, onChunk, onDone }) {
  const recentHistory = history.slice(-12);

  let relevantChunks = [];
  try {
    const queryEmbedding = await embedText(userMessage);
    relevantChunks = await db.searchChunks(notebookId, queryEmbedding, 5, documentIds);
  } catch { /* fall through to free mode */ }

  let systemPrompt = relevantChunks.length > 0 ? SYSTEM_PROMPT_RAG : SYSTEM_PROMPT_FREE;
  
  if (progressSummary) {
    systemPrompt += `\n\n[CONTEXTO DE PROGRESO DEL ALUMNO]
Eres un tutor guía. Tienes acceso al estado de lectura del alumno. Si el alumno te pregunta por dónde va, qué tiene que hacer a continuación o se muestra perdido, usa esta información para guiarle.
- Documentos leídos: ${progressSummary.readDocuments.length > 0 ? progressSummary.readDocuments.join(', ') : 'Ninguno'}
- Documentos pendientes por leer: ${progressSummary.unreadDocuments.length > 0 ? progressSummary.unreadDocuments.join(', ') : 'Ninguno (ha terminado todo)'}
- Carpetas que requieren Cuestionario para avanzar: ${progressSummary.folderProgress.filter(f => f.quizEnabled).map(f => `${f.name} (Aprobado: ${f.quizPassed ? 'Sí' : 'No'})`).join(', ') || 'Ninguna'}

Recuerda ser empático y claro al decirle al alumno qué documento exacto debe leer a continuación (típicamente el primer documento pendiente).`;
  }

  const userContent = buildUserContent(userMessage, relevantChunks);

  const stream = await getGroq().chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: systemPrompt },
      ...recentHistory.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: userContent },
    ],
    temperature: 0.5,
    max_tokens: 1024,
    stream: true,
  });

  let fullAnswer = '';
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content || '';
    if (delta) {
      fullAnswer += delta;
      onChunk(delta);
    }
  }

  const sources = await Promise.all(relevantChunks.map(async (c) => ({
    chunk_id: c.id,
    document_id: c.document_id,
    document_name: c.document_name,
    page_number: c.page_number,
    excerpt: c.content, // Return full content for premium interactive citations
    folder_path: c.folder_id ? await db.getFolderPath(c.folder_id) : '',
    similarity: Math.round(c.similarity * 100) / 100,
  })));

  onDone(sources, fullAnswer);
}

module.exports = { 
  embedText, 
  embedChunks, 
  chat, 
  chatStream, 
  generateConversationTitle,
  generateQuizForDocument,
  generateFinalExam,
  suggestDocumentOrder,
};

async function generateQuizForDocument(text) {
  try {
    const prompt = `Genera un cuestionario de exactamente 5 preguntas de opción múltiple (con opciones A, B, C, D) en base al siguiente contenido.
El cuestionario debe centrarse en los conceptos clave del texto y sus detalles de aprendizaje.
Debes responder ÚNICAMENTE con un array JSON válido, sin texto adicional antes o después del JSON (sin bloques de código markdown, solo el JSON puro).
El JSON debe seguir esta estructura exacta:
[
  {
    "question": "Pregunta...",
    "options": ["A) Opción 1", "B) Opción 2", "C) Opción 3", "D) Opción 4"],
    "correct": "A",
    "explanation": "Explicación detallada de por qué A es la respuesta correcta basada en el texto..."
  }
]

Contenido:
${text.slice(0, 25000)}
`;

    const completion = await getGroq().chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 1500,
    });

    let content = completion.choices[0].message.content.trim();
    // Clean potential markdown blocks
    if (content.startsWith('```json')) {
      content = content.replace(/^```json/, '').replace(/```$/, '').trim();
    } else if (content.startsWith('```')) {
      content = content.replace(/^```/, '').replace(/```$/, '').trim();
    }

    try {
      const quiz = JSON.parse(content);
      if (Array.isArray(quiz) && quiz.length >= 3 && quiz.length <= 5) {
        return quiz;
      }
    } catch (e) {
      console.warn('[generateQuiz] JSON parse failed, attempting regex clean:', e);
      // Fallback simple regex extraction of JSON block
      const match = content.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (match) {
        const cleanedQuiz = JSON.parse(match[0]);
        if (Array.isArray(cleanedQuiz) && cleanedQuiz.length >= 3 && cleanedQuiz.length <= 5) return cleanedQuiz;
      }
    }
  } catch (err) {
    console.error('[generateQuiz] AI generation failed:', err);
  }

  // Safe fallback quiz if everything else fails
  console.log('[generateQuiz] Using safe fallback quiz.');
  return [
    {
      question: "¿Cuál es el tema principal abordado en este documento?",
      options: [
        "A) El análisis detallado de los conceptos clave presentados.",
        "B) Una introducción histórica sin aplicaciones prácticas.",
        "C) Un debate metodológico entre autores secundarios.",
        "D) La descripción técnica de herramientas de terceros."
      ],
      correct: "A",
      explanation: "El texto se enfoca en profundizar sobre los conceptos clave de la temática presentada."
    },
    {
      question: "Según la lectura del material, ¿qué se infiere como un elemento fundamental?",
      options: [
        "A) Que la correcta asimilación del contenido facilita el aprendizaje.",
        "B) Que no se requiere análisis previo de los conceptos expuestos.",
        "C) Que los autores no llegaron a conclusiones claras.",
        "D) Que es un material meramente opcional sin relación al curso."
      ],
      correct: "A",
      explanation: "El material de estudio destaca que la asimilación del contenido presentará ventajas para el entendimiento posterior."
    },
    {
      question: "¿Cuál de las siguientes afirmaciones es consistente con lo explicado en el texto?",
      options: [
        "A) La comprensión y la práctica son necesarias para la aprobación del tema.",
        "B) El contenido está desactualizado y no aplica al contexto actual.",
        "C) No existen preguntas de autoevaluación válidas para esta sección.",
        "D) El material es exclusivamente para administradores."
      ],
      correct: "A",
      explanation: "El autor recalca la importancia del entendimiento profundo y la autoevaluación del material provisto."
    },
    {
      question: "¿Qué papel juega el contexto proporcionado en el documento?",
      options: [
        "A) Ayuda a situar los conceptos teóricos en escenarios de aplicación práctica.",
        "B) Es un simple relleno sin conexión con los objetivos del curso.",
        "C) Solo es relevante para los creadores del curso, no para los estudiantes.",
        "D) Confunde el verdadero propósito del contenido expuesto."
      ],
      correct: "A",
      explanation: "El contexto es clave para que los conceptos teóricos puedan ser comprendidos en un marco de aplicación práctica."
    },
    {
      question: "¿Cuál es el siguiente paso lógico tras comprender esta sección?",
      options: [
        "A) Aplicar los conocimientos en los cuestionarios y temas siguientes.",
        "B) Omitir las siguientes unidades porque ya se abarcó lo más importante.",
        "C) Borrar los apuntes ya que no se evaluarán de nuevo.",
        "D) Ignorar el material adicional proporcionado por el instructor."
      ],
      correct: "A",
      explanation: "El aprendizaje es acumulativo y se espera aplicar estos conocimientos en los pasos posteriores del curso."
    }
  ];
}

async function generateFinalExam(documentsArray) {
  try {
    const summaryText = documentsArray.map((d, i) => `Documento ${i+1}: ${d.name}\nResumen del contenido:\n${d.raw_text.slice(0, 4000)}`).join('\n\n');

    const prompt = `Genera un examen final integrador de entre 10 y 15 preguntas de opción múltiple (con opciones A, B, C, D) en base a todos los documentos del curso provistos a continuación.
El examen debe evaluar la comprensión general de todo el notebook y ser integrador.
Debes responder ÚNICAMENTE con un array JSON válido, sin texto adicional antes o después del JSON (sin bloques de código markdown, solo el JSON puro).
El JSON debe seguir esta estructura exacta:
[
  {
    "question": "Pregunta integradora...",
    "options": ["A) Opción 1", "B) Opción 2", "C) Opción 3", "D) Opción 4"],
    "correct": "A",
    "explanation": "Explicación detallada de por qué A es la respuesta correcta basada en los textos..."
  }
]

Documentos a evaluar:
${summaryText}
`;

    const completion = await getGroq().chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.25,
      max_tokens: 2500,
    });

    let content = completion.choices[0].message.content.trim();
    if (content.startsWith('```json')) {
      content = content.replace(/^```json/, '').replace(/```$/, '').trim();
    } else if (content.startsWith('```')) {
      content = content.replace(/^```/, '').replace(/```$/, '').trim();
    }

    try {
      const exam = JSON.parse(content);
      if (Array.isArray(exam) && exam.length >= 5) {
        return exam;
      }
    } catch (e) {
      console.warn('[generateFinalExam] JSON parse failed, attempting regex clean:', e);
      const match = content.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (match) {
        const cleanedExam = JSON.parse(match[0]);
        if (Array.isArray(cleanedExam) && cleanedExam.length >= 5) return cleanedExam;
      }
    }
  } catch (err) {
    console.error('[generateFinalExam] AI generation failed:', err);
  }

  // Safe fallback exam
  console.log('[generateFinalExam] Using safe fallback exam.');
  return [
    {
      question: "¿Cuál es el propósito integrador principal de los documentos estudiados en este notebook?",
      options: [
        "A) Articular los conceptos fundamentales de estudio para capacitar al lector de forma global.",
        "B) Demostrar que los documentos no se relacionan entre sí.",
        "C) Servir únicamente como registro de actividades de desarrollo local.",
        "D) Promover el desuso de herramientas de IA en educación."
      ],
      correct: "A",
      explanation: "El objetivo de este notebook es brindar un marco de conocimientos interconectados para una capacitación integral."
    },
    {
      question: "¿Cómo se complementan las ideas presentadas a lo largo de los archivos?",
      options: [
        "A) Aportando perspectivas teóricas y aplicaciones prácticas coherentes entre sí.",
        "B) Generando contradicciones insolubles para confundir al estudiante.",
        "C) Centrándose únicamente en aspectos de infraestructura sin contenido conceptual.",
        "D) Requiriendo lectura opcional sin evaluación final obligatoria."
      ],
      correct: "A",
      explanation: "Los documentos conforman un itinerario de estudio donde cada archivo aporta una dimensión del conocimiento necesario."
    },
    {
      question: "¿Qué rol juega la autoevaluación interactiva al final de cada tema del curso?",
      options: [
        "A) Validar la asimilación del contenido conceptual antes de permitir avanzar a temas subsiguientes.",
        "B) Restringir permanentemente el acceso a todos los usuarios del sistema sin justificación.",
        "C) Remplazar el soporte técnico del administrador de la plataforma.",
        "D) Disminuir el tiempo de uso en el sistema."
      ],
      correct: "A",
      explanation: "Los cuestionarios aseguran que cada tema esté bien comprendido antes de progresar a las siguientes secciones."
    },
    {
      question: "¿Cuál es una conclusión clave derivada de la asimilación completa de este notebook?",
      options: [
        "A) Que el aprendizaje guiado y ordenado mejora significativamente la retención conceptual.",
        "B) Que no se requiere ningún esfuerzo intelectual para comprender la temática.",
        "C) Que los archivos son redundantes y bastaba con leer el primero.",
        "D) Que la plataforma de estudio suspende a los usuarios sin avisar."
      ],
      correct: "A",
      explanation: "El diseño del curso estructurado está concebido para potenciar el entendimiento mediante secuencia lógica y validación."
    },
    {
      question: "Para lograr un desempeño satisfactorio en futuros desafíos sobre esta materia, ¿qué se recomienda?",
      options: [
        "A) Repasar activamente el contenido original guardado en formato digital y los cuestionarios respondidos.",
        "B) Abandonar la plataforma y no repasar las explicaciones.",
        "C) Memorizar las respuestas de los cuestionarios sin leer el material original.",
        "D) Solicitar al administrador un notebook completamente vacío."
      ],
      correct: "A",
      explanation: "La revisión del material nativo y el análisis de la retroalimentación de las evaluaciones consolidan el aprendizaje."
    },
    {
      question: "¿Qué estrategia se aplica típicamente para evaluar si los conceptos se integraron correctamente?",
      options: [
        "A) El uso de evaluaciones integradoras que conectan diferentes documentos.",
        "B) La lectura rápida sin prestar atención a los detalles.",
        "C) Saltarse los temas más largos.",
        "D) Completar los exámenes sin haber leído previamente los textos."
      ],
      correct: "A",
      explanation: "Las evaluaciones integradoras son clave para confirmar que los conceptos de distintos documentos han sido asimilados y relacionados."
    },
    {
      question: "¿Por qué es importante mantener una secuencia pedagógica sugerida al estudiar múltiples documentos?",
      options: [
        "A) Porque permite construir conocimientos complejos a partir de nociones básicas previas.",
        "B) Porque es la única manera técnica en que el servidor puede cargar los archivos.",
        "C) No es importante, se puede leer en cualquier orden sin consecuencias.",
        "D) Porque de otra manera el sistema borrará el progreso del usuario."
      ],
      correct: "A",
      explanation: "Una secuencia lógica o sugerida por la IA ayuda a que los conocimientos nuevos se anclen en los ya aprendidos de forma escalonada."
    },
    {
      question: "¿Cuál de estos elementos es esencial para considerar completado el proceso de aprendizaje en un módulo?",
      options: [
        "A) La aprobación de los cuestionarios asociados y la comprensión holística del tema.",
        "B) Exclusivamente abrir el documento por un par de segundos.",
        "C) Subir más documentos a la plataforma aunque no se lean.",
        "D) Fallar todos los exámenes intencionalmente."
      ],
      correct: "A",
      explanation: "La comprensión real se valida aprobando de forma satisfactoria las instancias de evaluación proporcionadas."
    },
    {
      question: "Si encuentras una contradicción aparente entre dos documentos del curso, ¿qué enfoque deberías adoptar?",
      options: [
        "A) Analizar el contexto y la fecha o propósito de cada documento para integrarlos críticamente.",
        "B) Descartar ambos documentos inmediatamente.",
        "C) Elegir el más corto y basar todo el estudio solo en ese.",
        "D) Asumir que toda la plataforma es incorrecta."
      ],
      correct: "A",
      explanation: "El pensamiento crítico y la contextualización son habilidades fundamentales frente a múltiples fuentes de información."
    },
    {
      question: "El concepto de 'aprendizaje iterativo' en el uso de esta herramienta se refiere principalmente a:",
      options: [
        "A) Volver a revisar documentos y respuestas para afianzar el conocimiento tras cada evaluación.",
        "B) Realizar intentos ciegos y aleatorios en los exámenes.",
        "C) Evitar repasar las explicaciones de las respuestas incorrectas.",
        "D) Copiar las respuestas de los cuestionarios de otros estudiantes."
      ],
      correct: "A",
      explanation: "Iterar sobre los errores y las retroalimentaciones es la esencia de usar los cuestionarios de aprendizaje."
    }
  ];
}

async function suggestDocumentOrder(documents) {
  try {
    const docList = documents.map(d => `- ID: ${d.id}, Nombre: "${d.name}"`).join('\n');
    const prompt = `Analiza los siguientes títulos de documentos de un curso de estudio y sugiere el orden de lectura/estudio más pedagógico y lógico para un estudiante (por ejemplo, conceptos introductorios o básicos primero, seguidos de temas intermedios y luego avanzados).
Debes responder ÚNICAMENTE con un objeto JSON válido, sin bloques de código markdown ni texto adicional antes o después del JSON.
El JSON debe seguir esta estructura exacta:
{
  "order": [lista de IDs numéricos en el orden sugerido, por ejemplo [2, 1, 3]],
  "explanation": "Una breve explicación en español (máximo 2 líneas) de por qué se sugiere este orden pedagógico y lógico de aprendizaje."
}

Documentos:
${docList}
`;

    const completion = await getGroq().chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 800,
    });

    let content = completion.choices[0].message.content.trim();
    if (content.startsWith('```json')) {
      content = content.replace(/^```json/, '').replace(/```$/, '').trim();
    } else if (content.startsWith('```')) {
      content = content.replace(/^```/, '').replace(/```$/, '').trim();
    }

    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed.order) || typeof parsed.explanation !== 'string') {
      throw new Error('Formato de respuesta del sugeridor de orden inválido');
    }
    return parsed;
  } catch (err) {
    console.error('[suggestDocumentOrder] failed:', err);
    // Fallback: return original order
    return {
      order: documents.map(d => d.id),
      explanation: 'No se pudo generar la sugerencia por IA. Se mantiene el orden cronológico de carga.'
    };
  }
}


