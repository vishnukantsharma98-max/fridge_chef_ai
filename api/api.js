// Vercel serverless function. Keys stay on the server (Vercel Environment Variables).
// If XAI_API_KEY is set -> uses Grok (xAI). Otherwise uses Gemini (GEMINI_API_KEY).
export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

async function callGrok(body, key) {
  const model = process.env.XAI_MODEL || 'grok-4.7';
  const parts = body?.contents?.[0]?.parts || [];
  const content = parts.map((p) =>
    p.text !== undefined
      ? { type: 'text', text: p.text }
      : { type: 'image_url', image_url: { url: `data:${p.inline_data.mime_type};base64,${p.inline_data.data}` } }
  );
  const r = await fetch('https://api.x.ai/v1/chat/completions', {
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
    const m = j?.error?.message || j?.error || j?.message || 'Grok error ' + r.status;
    return { status: r.status, json: { error: { message: String(m) } } };
  }
  const text = j?.choices?.[0]?.message?.content || '';
  // Return in Gemini's shape so the website needs no change
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
    if (process.env.XAI_API_KEY) {
      const o = await callGrok(req.body, process.env.XAI_API_KEY);
      return res.status(o.status).json(o.json);
    }
    if (process.env.GEMINI_API_KEY) {
      const o = await callGemini(req.body, process.env.GEMINI_API_KEY);
      return res.status(o.status).json(o.json);
    }
    return res.status(500).json({ error: { message: 'Set XAI_API_KEY or GEMINI_API_KEY on Vercel' } });
  } catch (e) {
    return res.status(502).json({ error: { message: String(e.message || e) } });
  }
}
