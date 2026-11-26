// Vercel serverless function. Keys stay on the server (Vercel Environment Variables).
// Priority: GROQ_API_KEY -> XAI_API_KEY (Grok) -> GEMINI_API_KEY
export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

// Groq and xAI both use the OpenAI-style chat API. Convert the site's Gemini-style
// request to it, and return a Gemini-shaped answer so index.html needs no change.
async function callOpenAIStyle(url, key, model, body) {
  const parts = body?.contents?.[0]?.parts || [];
  const content = parts.map((p) =>
    p.text !== undefined
      ? { type: 'text', text: p.text }
      : { type: 'image_url', image_url: { url: `data:${p.inline_data.mime_type};base64,${p.inline_data.data}` } }
  );
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content }],
      response_format: { type: 'json_object' },
      temperature: 0.6,
    }),
  });
  const j = await r.json();
  if (!r.ok) {
    const m = j?.error?.message || j?.error || j?.message || 'API error ' + r.status;
    return { status: r.status, json: { error: { message: String(m) } } };
  }
  const text = String(j?.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  return { status: 200, json: { candidates: [{ content: { parts: [{ text }] } }] } };
}

async function callGemini(body, key) {
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    }
  );
  return { status: r.status, json: await r.json() };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'POST only' } });
  try {
    let o;
    if (process.env.GROQ_API_KEY) {
      o = await callOpenAIStyle(
        'https://api.groq.com/openai/v1/chat/completions',
        process.env.GROQ_API_KEY,
        process.env.GROQ_MODEL || 'qwen/qwen3.8-27b',
        req.body
      );
    } else if (process.env.XAI_API_KEY) {
      o = await callOpenAIStyle(
        'https://api.x.ai/v1/chat/completions',
        process.env.XAI_API_KEY,
        process.env.XAI_MODEL || 'grok-4.7',
        req.body
      );
    } else if (process.env.GEMINI_API_KEY) {
      o = await callGemini(req.body, process.env.GEMINI_API_KEY);
    } else {
      return res.status(500).json({ error: { message: 'Set GROQ_API_KEY, XAI_API_KEY or GEMINI_API_KEY on Vercel' } });
    }
    return res.status(o.status).json(o.json);
  } catch (e) {
    return res.status(502).json({ error: { message: String(e.message || e) } });
  }
}
