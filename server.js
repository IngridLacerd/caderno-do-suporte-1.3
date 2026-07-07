// server.js — Caderno do Suporte Backend
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      avatar TEXT DEFAULT 'ti-user-circle',
      color TEXT DEFAULT '#880000',
      password TEXT DEFAULT '123456',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      icon TEXT DEFAULT 'ti-tool',
      fixed BOOLEAN DEFAULT false,
      sort_order INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS procedures (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      cat TEXT DEFAULT 'geral',
      status TEXT DEFAULT 'pendente',
      favorite BOOLEAN DEFAULT false,
      steps JSONB DEFAULT '[]',
      obs TEXT DEFAULT '',
      client_name TEXT DEFAULT '',
      client_phone TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS history (
      id BIGSERIAL PRIMARY KEY,
      proc_id BIGINT,
      title TEXT,
      cat TEXT,
      user_id TEXT,
      ts BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      author_id TEXT,
      author_name TEXT,
      date TEXT,
      done BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      title TEXT DEFAULT 'Sem título',
      blocks JSONB DEFAULT '[]',
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Adicionar coluna password se não existir (para migrations de bancos antigos)
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN password TEXT DEFAULT '123456'`);
  } catch (e) {
    // Coluna já existe, ignorar erro
  }
  // Adicionar coluna email se não existir
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN email TEXT`);
  } catch (e) {
    // Coluna já existe, ignorar erro
  }

  // Inserir categorias padrão se não existirem
  const { rows } = await pool.query('SELECT COUNT(*) FROM categories');
  if (parseInt(rows[0].count) === 0) {
    const defaults = [
      ['nfc',         'NFC',         'ti-device-mobile', true,  0],
      ['xml',         'XML',         'ti-file-code',     true,  1],
      ['impressao',   'Impressão',   'ti-printer',       true,  2],
      ['atualizacao', 'Atualização', 'ti-refresh',       true,  3],
      ['instalacao',  'Instalação',  'ti-package',       true,  4],
      ['geral',       'Geral',       'ti-tool',          true,  5]
    ];
    for (const [id, label, icon, fixed, sort_order] of defaults) {
      await pool.query(
        'INSERT INTO categories(id,label,icon,fixed,sort_order) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
        [id, label, icon, fixed, sort_order]
      );
    }
  }

  console.log('✅ Banco de dados pronto');
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(PUBLIC_DIR));

// ── USUÁRIOS ──────────────────────────────────────────────────────────────────

app.get('/api/users', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM users ORDER BY created_at');
  res.json(rows);
});

app.post('/api/users', async (req, res) => {
  const { id, name, email, avatar, color, password } = req.body;
  if (!id || !name) return res.status(400).json({ message: 'id e name são obrigatórios' });
  const rawEmail = String(email || '').trim().toLowerCase();
  if (!rawEmail) return res.status(400).json({ message: 'email é obrigatório' });
  // validação simples de formato de email
  const emailRegex = /^\S+@\S+\.\S+$/;
  if (!emailRegex.test(rawEmail)) return res.status(400).json({ message: 'email inválido' });
  // senha obrigatória e tamanho mínimo
  const rawPassword = String(password || '');
  if (!rawPassword || rawPassword.length < 6) return res.status(400).json({ message: 'senha deve ter pelo menos 6 caracteres' });
  // checar se email já existe em outro usuário
  try {
    const { rows: existing } = await pool.query('SELECT id FROM users WHERE email=$1 AND id<>$2', [rawEmail, id]);
    if (existing.length) return res.status(409).json({ message: 'email já está em uso' });
  } catch (e) {
    console.error('Erro ao checar email existente', e);
    return res.status(500).json({ message: 'Erro no servidor' });
  }
  const { rows } = await pool.query(
    'INSERT INTO users(id,name,email,avatar,color,password) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET name=$2,email=$3,avatar=$4,color=$5,password=$6 RETURNING *',
    [id, name, rawEmail || null, avatar || 'ti-user-circle', color || '#880000', rawPassword]
  );
  res.json(rows[0]);
});

app.delete('/api/users/:id', async (req, res) => {
  await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ── CATEGORIAS ────────────────────────────────────────────────────────────────

app.get('/api/categories', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM categories ORDER BY sort_order, created_at');
  res.json(rows);
});

app.post('/api/categories', async (req, res) => {
  const { id, label, icon, fixed } = req.body;
  const { rows: existing } = await pool.query('SELECT COUNT(*) FROM categories');
  const sort_order = parseInt(existing[0].count);
  const { rows } = await pool.query(
    'INSERT INTO categories(id,label,icon,fixed,sort_order) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET label=$2,icon=$3 RETURNING *',
    [id, label, icon || 'ti-tool', fixed || false, sort_order]
  );
  res.json(rows[0]);
});

app.delete('/api/categories/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT fixed FROM categories WHERE id=$1', [req.params.id]);
  if (rows.length && rows[0].fixed) return res.status(403).json({ message: 'Categoria padrão não pode ser removida' });
  await pool.query('DELETE FROM categories WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ── PROCEDIMENTOS ─────────────────────────────────────────────────────────────

app.get('/api/procedures', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM procedures ORDER BY created_at DESC');
  res.json(rows.map(formatProc));
});

app.post('/api/procedures', async (req, res) => {
  const { title, cat, status, favorite, steps, obs, client } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO procedures(title,cat,status,favorite,steps,obs,client_name,client_phone)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [title, cat||'geral', status||'pendente', favorite||false,
     JSON.stringify(steps||[]), obs||'',
     (client&&client.name)||'', (client&&client.phone)||'']
  );
  res.json(formatProc(rows[0]));
});

app.put('/api/procedures/:id', async (req, res) => {
  const { title, cat, status, favorite, steps, obs, client } = req.body;
  const { rows } = await pool.query(
    `UPDATE procedures SET
      title=COALESCE($1,title), cat=COALESCE($2,cat), status=COALESCE($3,status),
      favorite=COALESCE($4,favorite), steps=COALESCE($5,steps), obs=COALESCE($6,obs),
      client_name=COALESCE($7,client_name), client_phone=COALESCE($8,client_phone),
      updated_at=NOW()
     WHERE id=$9 RETURNING *`,
    [title, cat, status, favorite,
     steps !== undefined ? JSON.stringify(steps) : null,
     obs,
     client ? client.name : null,
     client ? client.phone : null,
     req.params.id]
  );
  if (!rows.length) return res.status(404).json({ message: 'Não encontrado' });
  res.json(formatProc(rows[0]));
});

app.delete('/api/procedures/:id', async (req, res) => {
  await pool.query('DELETE FROM procedures WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

function formatProc(r) {
  return {
    id: r.id,
    title: r.title,
    cat: r.cat,
    status: r.status,
    favorite: r.favorite,
    steps: r.steps || [],
    obs: r.obs || '',
    client: { name: r.client_name || '', phone: r.client_phone || '' },
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

// ── HISTÓRICO ─────────────────────────────────────────────────────────────────

app.get('/api/history', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM history ORDER BY ts DESC LIMIT 30');
  res.json(rows.map(r => ({ procId: r.proc_id, title: r.title, cat: r.cat, userId: r.user_id, timestamp: parseInt(r.ts) })));
});

app.post('/api/history', async (req, res) => {
  const { procId, title, cat, userId } = req.body;
  await pool.query('DELETE FROM history WHERE proc_id=$1', [procId]);
  await pool.query(
    'INSERT INTO history(proc_id,title,cat,user_id,ts) VALUES($1,$2,$3,$4,$5)',
    [procId, title, cat, userId, Date.now()]
  );
  // manter máximo 30
  await pool.query(`DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY ts DESC LIMIT 30)`);
  res.json({ ok: true });
});

app.delete('/api/history', async (req, res) => {
  await pool.query('DELETE FROM history');
  res.json({ ok: true });
});

// ── ALERTAS ───────────────────────────────────────────────────────────────────

app.get('/api/alerts', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM alerts ORDER BY created_at DESC');
  res.json(rows.map(r => ({
    id: r.id, text: r.text, authorId: r.author_id,
    authorName: r.author_name, date: r.date, done: r.done
  })));
});

app.post('/api/alerts', async (req, res) => {
  const { id, text, authorId, authorName, date, done } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO alerts(id,text,author_id,author_name,date,done) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
    [id, text, authorId||null, authorName||'', date||new Date().toISOString().slice(0,10), done||false]
  );
  res.json(rows[0]);
});

app.put('/api/alerts/:id', async (req, res) => {
  const { done } = req.body;
  await pool.query('UPDATE alerts SET done=$1 WHERE id=$2', [done, req.params.id]);
  res.json({ ok: true });
});

app.delete('/api/alerts/:id', async (req, res) => {
  await pool.query('DELETE FROM alerts WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ── NOTAS ─────────────────────────────────────────────────────────────────────

app.get('/api/notes', async (req, res) => {
  const userId = req.query.userId;
  let rows;
  if (userId) {
    ({ rows } = await pool.query('SELECT * FROM notes WHERE user_id=$1 ORDER BY updated_at DESC', [userId]));
  } else {
    ({ rows } = await pool.query('SELECT * FROM notes ORDER BY updated_at DESC'));
  }
  res.json(rows.map(formatNote));
});

app.post('/api/notes', async (req, res) => {
  const { id, userId, title, blocks } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO notes(id,user_id,title,blocks) VALUES($1,$2,$3,$4)
     ON CONFLICT(id) DO UPDATE SET title=$3,blocks=$4,updated_at=NOW() RETURNING *`,
    [id, userId||null, title||'Sem título', JSON.stringify(blocks||[])]
  );
  res.json(formatNote(rows[0]));
});

app.put('/api/notes/:id', async (req, res) => {
  const { title, blocks } = req.body;
  const { rows } = await pool.query(
    'UPDATE notes SET title=COALESCE($1,title), blocks=COALESCE($2,blocks), updated_at=NOW() WHERE id=$3 RETURNING *',
    [title, blocks !== undefined ? JSON.stringify(blocks) : null, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ message: 'Nota não encontrada' });
  res.json(formatNote(rows[0]));
});

app.delete('/api/notes/:id', async (req, res) => {
  await pool.query('DELETE FROM notes WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

function formatNote(r) {
  return {
    id: r.id, userId: r.user_id, title: r.title,
    blocks: r.blocks || [], updatedAt: r.updated_at, createdAt: r.created_at
  };
}

// ── FALLBACK HTML ─────────────────────────────────────────────────────────────

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'), err => {
    if (err) res.status(404).send('Não encontrado');
  });
});

// ── INICIAR ───────────────────────────────────────────────────────────────────

initDB().then(() => {
  app.listen(PORT, () => console.log(`✅ Servidor rodando em http://localhost:${PORT}`));
}).catch(e => {
  console.error('Erro ao iniciar banco:', e);
  process.exit(1);
});