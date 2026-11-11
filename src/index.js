import { D1Database } from '@cloudflare/workers-types';

function uid(len = 16) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function now() {
  return Date.now();
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { headers: { 'Content-Type': 'application/json' }, status });
}
async function safeBody(req) {
  try { return await req.json(); } catch { return {}; }
}

function mapConv(c) {
  return {
    id: c.id,
    name: c.visitor_name,
    preview: c.last_preview || '',
    lastMessageAt: c.last_message_at,
    createdAt: c.created_at,
    unread: c.unread ?? 0
  };
}

async function handleSession(request, env) {
  const body = await safeBody(request);
  const token = body.token;
  const name = body.name || '';

  const newToken = token || uid(40);
  const id = uid(16);
  const t = now();
  const visitorName = name || '访客';

  await env.DB.prepare(
    'INSERT INTO conversations (id, visitor_token, visitor_name, created_at, updated_at, last_message_at, last_preview, unread) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, newToken, visitorName, t, t, t, '', 0)
    .run();

  let preview = '';
  const welcomeText = (env.WELCOME_MESSAGE || '您好！欢迎来到小旗搭建在线客服，请问有什么可以帮您？').trim();
  if (welcomeText) {
    try {
      const agentName = env.AGENT_NAME || '客服';
      await env.DB.prepare(
        `INSERT INTO messages (conv_id, sender, sender_name, type, body, created_at, updated_at)
         VALUES (?, 'agent', ?, 'text', ?, ?, ?)`
      )
        .bind(id, agentName, welcomeText, t, t)
        .run();
      preview = `客服: ${welcomeText.slice(0, 40)}`;
      await env.DB.prepare(
        'UPDATE conversations SET last_message_at = ?, last_preview = ?, updated_at = ? WHERE id = ?'
      )
        .bind(t, preview, t, id)
        .run();
    } catch (e) {
      console.error('welcome message insert failed', e);
    }
  }

  return json({
    token: newToken,
    conv: { id, name: visitorName, preview, lastMessageAt: t, createdAt: t, unread: 0 },
    shop: env.SHOP_NAME || '在线客服',
  });
}

// ==========【新增：修改访客备注接口】==========
async function handleRenameConv(request, env, convId) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${env.AGENT_TOKEN}`) {
    return json({ ok: false, msg: '权限不足' }, 403);
  }
  const body = await safeBody(request);
  const newName = (body.name || '').trim();
  if (!newName) return json({ ok: false, msg: '名称不能为空' }, 400);

  const res = await env.DB.prepare(
    'UPDATE conversations SET visitor_name = ?, updated_at = ? WHERE id = ?'
  ).bind(newName, now(), convId).run();

  if (res.meta.changes === 0) {
    return json({ ok: false, msg: '会话不存在' }, 404);
  }
  return json({ ok: true, name: newName });
}

async function route(request, env) {
  const url = new URL(request.url);
  const m = request.method;
  const p = url.pathname;

  // 修改备注 PATCH /api/conv/:id/rename
  const renameMatch = p.match(/^\/api\/conv\/([a-z0-9]+)\/rename$/);
  if (renameMatch && m === 'PATCH') {
    return handleRenameConv(request, env, renameMatch[1]);
  }

  if (p === '/api/session' && m === 'POST') return handleSession(request, env);

  return json({ msg: 'not found' }, 404);
}

export default {
  async fetch(request, env) {
    return route(request, env);
  }
};
