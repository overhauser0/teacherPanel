import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { pool } from './db.js';

const app = express();

app.use(express.json());
app.use(cookieParser());

const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = '/app/public';
app.use(express.static(PUBLIC_DIR));

// ルートは index.html を返す（staticだけでも大抵動くが、明示しておく）
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/health', (req, res) => res.json({ ok: true }));

function sign(payloadObj) {
  const raw = JSON.stringify(payloadObj);
  // 最小：改ざん検知だけ（本番はJWT/強固な署名に置換推奨）
  const b64 = Buffer.from(raw).toString('base64url');
  const sig = Buffer.from(b64 + '.' + SESSION_SECRET).toString('base64url');
  return `${b64}.${sig}`;
}
function verify(token) {
  if (!token) return null;
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return null;
  const expected = Buffer.from(b64 + '.' + SESSION_SECRET).toString(
    'base64url',
  );
  if (sig !== expected) return null;
  try {
    return JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const sess = verify(req.cookies.session);
  if (!sess) return res.status(401).json({ error: 'unauthorized' });
  req.session = sess;
  next();
}
function requireOwner(req, res, next) {
  if (req.session?.role !== 'owner')
    return res.status(403).json({ error: 'forbidden' });
  next();
}
function requireTeacher(req, res, next) {
  if (req.session?.role !== 'teacher')
    return res.status(403).json({ error: 'forbidden' });
  next();
}

/* --- health (確認用) --- */
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

/* --- auth --- */
app.post('/auth/login', async (req, res) => {
  const { id, password } = req.body;

  // owner
  if (id === process.env.OWNER_ID && password === process.env.OWNER_PASSWORD) {
    res.cookie('session', sign({ role: 'owner' }), {
      httpOnly: true,
      sameSite: 'lax',
    });
    return res.json({ role: 'owner', redirect: '/owner/top.html' });
  }

  // teacher (teacher_code)
  const teacher_code = String(id || '').trim();
  const pw = String(password || '');

  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT id, teacher_code, password_hash FROM teachers WHERE teacher_code = $1`,
      [teacher_code],
    );

    // 案2：未登録なら新規作成してログイン
    if (r.rowCount === 0) {
      const password_hash = await bcrypt.hash(pw, 10);
      const created = await client.query(
        `INSERT INTO teachers(teacher_code, name, prefecture, subjects, comment, school_id, password_hash)
         VALUES($1,'','', '', '', NULL, $2)
         RETURNING id`,
        [teacher_code, password_hash],
      );

      const teacherId = created.rows[0].id;
      res.cookie('session', sign({ role: 'teacher', teacher_id: teacherId }), {
        httpOnly: true,
        sameSite: 'lax',
      });
      return res.json({
        role: 'teacher',
        redirect: '/me/edit.html',
        created: true,
      });
    }

    // 既存：PW照合
    const t = r.rows[0];
    const ok = await bcrypt.compare(pw, t.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

    res.cookie('session', sign({ role: 'teacher', teacher_id: t.id }), {
      httpOnly: true,
      sameSite: 'lax',
    });
    return res.json({
      role: 'teacher',
      redirect: '/me/edit.html',
      created: false,
    });
  } finally {
    client.release();
  }
});

app.post('/auth/logout', (req, res) => {
  res.clearCookie('session');
  res.json({ ok: true });
});

/* --- shared master --- */
app.get('/schools', requireAuth, async (req, res) => {
  const r = await pool.query(`SELECT id, name FROM schools ORDER BY id ASC`);
  res.json(r.rows);
});

/* --- teacher: me --- */
app.get('/me', requireAuth, requireTeacher, async (req, res) => {
  const teacherId = req.session.teacher_id;
  const r = await pool.query(
    `SELECT id, teacher_code, name, prefecture, subjects, comment, school_id, photo_path
     FROM teachers WHERE id = $1`,
    [teacherId],
  );
  res.json(r.rows[0]);
});

app.put('/me', requireAuth, requireTeacher, async (req, res) => {
  const teacherId = req.session.teacher_id;
  const { name, prefecture, subjects, comment, school_id } = req.body;

  const r = await pool.query(
    `UPDATE teachers
      SET name = $1,
          prefecture = $2,
          subjects = $3,
          comment = $4,
          school_id = $5
     WHERE id = $6
     RETURNING id, teacher_code, name, prefecture, subjects, comment, school_id, photo_path`,
    [
      String(name || '').trim(),
      String(prefecture || '').trim(),
      String(subjects || ''),
      String(comment || ''),
      school_id === null || school_id === undefined ? null : Number(school_id),
      teacherId,
    ],
  );
  res.json(r.rows[0]);
});

/* --- owner: schools CRUD --- */
app.get('/owner/schools', requireAuth, requireOwner, async (req, res) => {
  const r = await pool.query(`SELECT id, name FROM schools ORDER BY id ASC`);
  res.json(r.rows);
});

app.post('/owner/schools', requireAuth, requireOwner, async (req, res) => {
  const { name } = req.body;
  const r = await pool.query(
    `INSERT INTO schools(name) VALUES($1) RETURNING id, name`,
    [String(name || '').trim()],
  );
  res.status(201).json(r.rows[0]);
});

app.put('/owner/schools/:id', requireAuth, requireOwner, async (req, res) => {
  const { name } = req.body;
  const r = await pool.query(
    `UPDATE schools SET name = $1 WHERE id = $2 RETURNING id, name`,
    [String(name || '').trim(), Number(req.params.id)],
  );
  res.json(r.rows[0]);
});

app.delete(
  '/owner/schools/:id',
  requireAuth,
  requireOwner,
  async (req, res) => {
    await pool.query(`DELETE FROM schools WHERE id = $1`, [
      Number(req.params.id),
    ]);
    res.json({ ok: true });
  },
);

/* --- owner: teachers CRUD --- */
app.get('/owner/teachers', requireAuth, requireOwner, async (req, res) => {
  const q = String(req.query.q || '').trim();
  const school_id = req.query.school_id ? Number(req.query.school_id) : null;

  const params = [];
  let where = 'WHERE 1=1';
  if (q) {
    params.push(`%${q}%`);
    params.push(`%${q}%`);
    where += ` AND (teacher_code LIKE $${params.length - 1} OR name ILIKE $${params.length})`;
  }
  if (school_id) {
    params.push(school_id);
    where += ` AND school_id = $${params.length}`;
  }

  const r = await pool.query(
    `SELECT t.id, t.teacher_code, t.name, t.prefecture, t.school_id, s.name AS school_name
       FROM teachers t
       LEFT JOIN schools s ON s.id = t.school_id
     ${where}
     ORDER BY t.teacher_code ASC`,
    params,
  );
  res.json(r.rows);
});

app.get('/owner/teachers/:id', requireAuth, requireOwner, async (req, res) => {
  const r = await pool.query(
    `SELECT id, teacher_code, name, prefecture, subjects, comment, school_id, photo_path
       FROM teachers WHERE id = $1`,
    [Number(req.params.id)],
  );
  res.json(r.rows[0]);
});

app.post('/owner/teachers', requireAuth, requireOwner, async (req, res) => {
  const {
    teacher_code,
    name,
    prefecture,
    subjects,
    comment,
    school_id,
    password,
  } = req.body;

  const password_hash = await bcrypt.hash(String(password || 'changeme'), 10);

  const r = await pool.query(
    `INSERT INTO teachers(teacher_code, name, prefecture, subjects, comment, school_id, password_hash)
     VALUES($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, teacher_code, name, prefecture, subjects, comment, school_id`,
    [
      String(teacher_code || '').trim(),
      String(name || '').trim(),
      String(prefecture || '').trim(),
      String(subjects || ''),
      String(comment || ''),
      school_id === null || school_id === undefined ? null : Number(school_id),
      password_hash,
    ],
  );
  res.status(201).json(r.rows[0]);
});

app.put('/owner/teachers/:id', requireAuth, requireOwner, async (req, res) => {
  const id = Number(req.params.id);
  const { teacher_code, name, prefecture, subjects, comment, school_id } =
    req.body;

  const r = await pool.query(
    `UPDATE teachers
        SET teacher_code = $1,
            name = $2,
            prefecture = $3,
            subjects = $4,
            comment = $5,
            school_id = $6
      WHERE id = $7
      RETURNING id, teacher_code, name, prefecture, subjects, comment, school_id, photo_path`,
    [
      String(teacher_code || '').trim(),
      String(name || '').trim(),
      String(prefecture || '').trim(),
      String(subjects || ''),
      String(comment || ''),
      school_id === null || school_id === undefined ? null : Number(school_id),
      id,
    ],
  );
  res.json(r.rows[0]);
});

app.post(
  '/owner/teachers/:id/reset-password',
  requireAuth,
  requireOwner,
  async (req, res) => {
    const id = Number(req.params.id);
    const { password } = req.body;
    const password_hash = await bcrypt.hash(String(password || 'changeme'), 10);

    await pool.query(`UPDATE teachers SET password_hash = $1 WHERE id = $2`, [
      password_hash,
      id,
    ]);
    res.json({ ok: true });
  },
);

app.delete(
  '/owner/teachers/:id',
  requireAuth,
  requireOwner,
  async (req, res) => {
    await pool.query(`DELETE FROM teachers WHERE id = $1`, [
      Number(req.params.id),
    ]);
    res.json({ ok: true });
  },
);

/* --- photo upload (後回し可だが最短で入れておく) --- */
const photoDir = process.env.PHOTO_DIR || '/data/photos';
fs.mkdirSync(photoDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, photoDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '.jpg');
      cb(null, `teacher_${Date.now()}${ext}`);
    },
  }),
});

app.post(
  '/me/photo',
  requireAuth,
  requireTeacher,
  upload.single('photo'),
  async (req, res) => {
    const teacherId = req.session.teacher_id;
    const p = req.file ? req.file.filename : null;
    const r = await pool.query(
      `UPDATE teachers SET photo_path = $1 WHERE id = $2 RETURNING photo_path`,
      [p, teacherId],
    );
    res.json(r.rows[0]);
  },
);

app.listen(PORT, () => {
  console.log(`API listening on :${PORT}`);
});
