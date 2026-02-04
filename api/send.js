import { Redis } from '@upstash/redis';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function ok(res, body, status = 200) {
  return res.status(status).set(cors).json(body);
}

function err(res, message, status = 400) {
  return res.status(status).set(cors).json({ error: message });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).set(cors).end();
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);

  let redis;
  try {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  } catch (e) {
    return res.status(503).set(cors).json({
      error: 'Storage not configured. Add Upstash Redis to this Vercel project.',
    });
  }

  const { workspace, json } = req.body || {};
  const ws = typeof workspace === 'string' ? workspace.trim() : '';
  if (!ws) return err(res, 'workspace is required');
  if (ws.length > 64) return err(res, 'workspace too long');
  if (typeof json !== 'string') return err(res, 'json (string) is required');

  const key = `audience:payload:${ws}`;
  const value = JSON.stringify({ json, sentAt: Date.now() });

  try {
    await redis.set(key, value);
    return ok(res, { ok: true });
  } catch (e) {
    console.error(e);
    return res.status(503).set(cors).json({ error: 'Storage error' });
  }
}
