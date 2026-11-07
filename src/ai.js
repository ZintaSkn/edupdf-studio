// SknEDU-studio — assistant IA (l'utilisateur choisit son fournisseur et utilise SA clé ou SON abonnement).
//
// • Claude (Anthropic)          : SDK officiel @anthropic-ai/sdk, streaming, lecture directe du PDF (texte, images, mise en page)
// • ChatGPT (OpenAI), Gemini (Google), Mistral : API « chat completions » compatibles, streaming
// • Ollama                      : IA locale, gratuite, hors-ligne (aucune donnée ne quitte le PC)
// • Abonnement (ChatGPT Plus, Claude Pro, Gemini, Copilot…) : les abonnements grand public n'offrent pas d'API ;
//   SknEDU-studio prépare la demande, la copie et ouvre le site de l'IA dans le navigateur (géré côté interface).
//
// Les clés API sont chiffrées par Windows (DPAPI via safeStorage) et ne repartent jamais vers l'interface.
const fs = require('fs');
const path = require('path');

const PROVIDERS = {
  anthropic: { name: 'Claude (Anthropic)', keyUrl: 'https://console.anthropic.com/settings/keys', models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], pdf: true },
  openai: { name: 'ChatGPT (OpenAI)', base: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys', models: ['gpt-5', 'gpt-5-mini'] },
  gemini: { name: 'Gemini (Google)', base: 'https://generativelanguage.googleapis.com/v1beta/openai', keyUrl: 'https://aistudio.google.com/app/apikey', models: ['gemini-2.5-pro', 'gemini-2.5-flash'] },
  mistral: { name: 'Mistral (Le Chat)', base: 'https://api.mistral.ai/v1', keyUrl: 'https://console.mistral.ai/api-keys', models: ['mistral-large-latest', 'mistral-small-latest'] },
  ollama: { name: 'Ollama (IA locale, gratuite, hors-ligne)', base: 'http://127.0.0.1:11434/v1', keyUrl: 'https://ollama.com/download', models: [], local: true }
};

let A = null; const running = new Map();
const cfgFile = () => path.join(A.app.getPath('userData'), 'ai.json');
const readCfg = () => { try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch { return { provider: 'anthropic', models: {}, keys: {} }; } };
const writeCfg = (c) => fs.writeFileSync(cfgFile(), JSON.stringify(c, null, 2));
function getKey(provider) {
  const enc = readCfg().keys[provider]; if (!enc) return '';
  try { return A.safeStorage.decryptString(Buffer.from(enc, 'base64')); } catch { return ''; }
}

/** État visible par l'interface (jamais les clés elles-mêmes). */
function status() {
  const c = readCfg();
  return {
    provider: c.provider || 'anthropic', models: c.models || {}, sendPdf: c.sendPdf !== false,
    providers: Object.fromEntries(Object.entries(PROVIDERS).map(([k, p]) => [k, { name: p.name, keyUrl: p.keyUrl, models: p.models, pdf: !!p.pdf, local: !!p.local, hasKey: !!c.keys[k] || !!p.local }])),
    encryption: A.safeStorage.isEncryptionAvailable()
  };
}
function saveSettings({ provider, model, key, sendPdf, clearKey }) {
  if (!PROVIDERS[provider]) throw new Error('Fournisseur inconnu.');
  const c = readCfg(); c.keys = c.keys || {}; c.models = c.models || {};
  c.provider = provider;
  if (model) c.models[provider] = String(model).trim().slice(0, 100);
  if (typeof sendPdf === 'boolean') c.sendPdf = sendPdf;
  if (clearKey) delete c.keys[provider];
  if (key) {
    if (!A.safeStorage.isEncryptionAvailable()) throw new Error('Chiffrement Windows indisponible : la clé ne peut pas être enregistrée en sécurité.');
    c.keys[provider] = A.safeStorage.encryptString(String(key).trim()).toString('base64');
  }
  writeCfg(c);
  return status();
}
async function ollamaModels() {
  try { const r = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(2500) }); const j = await r.json(); return (j.models || []).map((m) => m.name); }
  catch { return null; } // Ollama non lancé / non installé
}

// ---------------------------------------------------------------- Claude (SDK officiel)
async function runClaude({ id, model, key, system, prompt, pdfBase64, images, send, signal }) {
  const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: key, maxRetries: 2 });
  const content = [];
  if (pdfBase64) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } });
  for (const im of images || []) { const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/.exec(im); if (m) content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }); }
  content.push({ type: 'text', text: prompt });
  const params = {
    model, max_tokens: 16000, system,
    messages: [{ role: 'user', content }],
    output_config: { effort: model.includes('haiku') ? 'low' : 'medium' }
  };
  // Repli automatique sur un autre modèle si une protection refuse la demande (sauf Haiku, qui n'en dispose pas)
  if (!model.includes('haiku')) { params.betas = ['server-side-fallback-2026-07-01']; params.fallbacks = 'default'; }
  const stream = (params.betas ? client.beta.messages : client.messages).stream(params, { signal });
  for await (const ev of stream) {
    if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') send('ai-chunk', { id, text: ev.delta.text });
  }
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error('L\'IA a refusé cette demande' + (msg.stop_details && msg.stop_details.explanation ? ` : ${msg.stop_details.explanation}` : '.'));
  if (msg.stop_reason === 'max_tokens') send('ai-chunk', { id, text: '\n\n[… réponse tronquée : demandez la suite]' });
  return { model: msg.model, usage: msg.usage };
}
function claudeError(e) {
  const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');
  if (e instanceof Anthropic.AuthenticationError) return 'Clé API Claude invalide ou révoquée.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'Accès refusé par Anthropic (droits du compte ou du modèle).';
  if (e instanceof Anthropic.RateLimitError) return 'Limite d\'utilisation atteinte : réessayez dans un moment (ou vérifiez le crédit du compte).';
  if (e instanceof Anthropic.BadRequestError) return 'Demande refusée par Claude : ' + e.message;
  if (e instanceof Anthropic.APIConnectionError) return 'Connexion impossible à Claude : vérifiez Internet.';
  if (e instanceof Anthropic.APIError) return `Erreur Claude (${e.status}) : ${e.message}`;
  return null;
}

// ---------------------------------------------------------------- ChatGPT, Gemini, Mistral, Ollama (format « chat completions »)
async function runCompatible({ id, provider, model, key, system, prompt, images, send, signal }) {
  const P = PROVIDERS[provider];
  const r = await fetch(`${P.base}/chat/completions`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model, stream: true, messages: [{ role: 'system', content: system }, { role: 'user', content: images && images.length ? [{ type: 'text', text: prompt }, ...images.map((url) => ({ type: 'image_url', image_url: { url } }))] : prompt }] })
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    let m = t; try { const j = JSON.parse(t); m = (j.error && (j.error.message || j.error)) || (Array.isArray(j) && j[0] && j[0].error && j[0].error.message) || t; } catch { /* texte brut */ }
    if (r.status === 401 || r.status === 403) throw new Error(`Clé API ${P.name} invalide ou sans accès à ce modèle.`);
    if (r.status === 404) throw new Error(`Modèle « ${model} » introuvable chez ${P.name}.`);
    if (r.status === 429) throw new Error(`Limite d'utilisation ${P.name} atteinte (ou crédit épuisé).`);
    throw new Error(`${P.name} (${r.status}) : ${String(m).slice(0, 300)}`);
  }
  const dec = new TextDecoder(); let buf = '';
  for await (const chunk of r.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim(); if (data === '[DONE]') return { model };
      try { const j = JSON.parse(data); const t = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content; if (t) send('ai-chunk', { id, text: t }); } catch { /* ligne partielle */ }
    }
  }
  return { model };
}

async function chat(evt, { id, system, prompt, pdfBase64, images }) {
  const c = readCfg(); const provider = c.provider || 'anthropic'; const P = PROVIDERS[provider];
  const model = (c.models && c.models[provider]) || P.models[0];
  const key = getKey(provider);
  if (!P.local && !key) throw new Error(`Aucune clé API ${P.name} : ajoutez-la dans les réglages de l'assistant.`);
  if (!model) throw new Error('Choisissez un modèle dans les réglages de l\'assistant.');
  const ctrl = new AbortController(); running.set(id, ctrl);
  const send = (ch, payload) => { if (!evt.sender.isDestroyed()) evt.sender.send(ch, payload); };
  try {
    const args = { id, provider, model, key, system, prompt, images, send, signal: ctrl.signal };
    const r = provider === 'anthropic' ? await runClaude({ ...args, pdfBase64: c.sendPdf !== false ? pdfBase64 : null }) : await runCompatible(args);
    return { ok: true, provider: P.name, ...r };
  } catch (e) {
    if (ctrl.signal.aborted) return { ok: false, cancelled: true };
    if (provider === 'anthropic') { const m = claudeError(e); if (m) throw new Error(m); }
    if (provider === 'ollama' && /fetch failed|ECONNREFUSED/i.test(String(e.cause || e.message))) throw new Error('Ollama ne répond pas : installez-le (ollama.com) puis lancez « ollama run llama3.2 » une première fois.');
    throw e;
  } finally { running.delete(id); }
}

function init(deps) {
  A = deps;
  const ip = A.ipcMain;
  ip.handle('ai-status', () => status());
  ip.handle('ai-save', (_e, a) => saveSettings(a || {}));
  ip.handle('ai-ollama-models', () => ollamaModels());
  ip.handle('ai-chat', (e, a) => { A.guard('ai', 'Assistant IA'); A.logEvent('ai', { provider: PROVIDERS[readCfg().provider || 'anthropic'].name }); return chat(e, a); });
  // IA locale (Ollama) : installation guidée et téléchargement d'un modèle, avec progression
  ip.handle('ai-install-local', async (e, { model }) => {
    const send = (m) => { if (!e.sender.isDestroyed()) e.sender.send('ai-install-progress', m); };
    const mdl = String(model || 'llama3.2:3b').replace(/[^\w.:-]/g, '');
    if (!(await ollamaModels())) {
      if (process.platform !== 'win32') throw new Error('Installez Ollama depuis ollama.com, lancez-le, puis recommencez.');
      send('Installation d\'Ollama (moteur d\'IA locale)…');
      await new Promise((res) => require('child_process').execFile('winget', ['install', '-e', '--id', 'Ollama.Ollama', '--silent', '--accept-package-agreements', '--accept-source-agreements'], { timeout: 1800000, windowsHide: true }, () => res()));
      for (let i = 0; i < 30 && !(await ollamaModels()); i++) await new Promise((r) => setTimeout(r, 2000));
      if (!(await ollamaModels())) throw new Error('Ollama est installé mais ne répond pas encore : ouvrez-le une fois depuis le menu Démarrer, puis recommencez.');
    }
    send(`Téléchargement du modèle ${mdl}…`);
    const r = await fetch('http://127.0.0.1:11434/api/pull', { method: 'POST', body: JSON.stringify({ name: mdl, stream: true }) });
    const dec = new TextDecoder(); let buf = '';
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true }); let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        try { const j = JSON.parse(line); if (j.error) throw new Error(j.error); if (j.total) send(`Téléchargement du modèle ${mdl} : ${Math.round((j.completed || 0) / j.total * 100)} %`); else if (j.status) send(j.status); } catch (err) { if (/error|Erreur/i.test(err.message)) throw err; }
      }
    }
    saveSettings({ provider: 'ollama', model: mdl });
    return { ok: true, model: mdl };
  });  ip.handle('ai-cancel', (_e, { id }) => { const c = running.get(id); if (c) c.abort(); return true; });
}

module.exports = { init, PROVIDERS };
