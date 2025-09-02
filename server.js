// server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import multer from 'multer';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import axios from 'axios';

const app = express();

// ---------- basic middlewares ----------
app.use(cors());   // DEV: เปิดไว้ก่อน (โปรดักชันค่อยจำกัด origin)
app.use(helmet());
app.use(morgan('dev'));

// ---------- ensure uploads dir ----------
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
await fsp.mkdir(UPLOAD_DIR, { recursive: true });

// ---------- upload config ----------
const maxMB = Number(process.env.MAX_FILE_SIZE_MB || 10);
const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: maxMB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // รับเฉพาะ jpg/jpeg/png
    const ok = /image\/(jpeg|png)/i.test(file.mimetype);
    cb(ok ? null : new Error('Unsupported file type: only jpg/jpeg/png allowed'), ok);
  },
});

// ---------- env (from .env) ----------
const BASE = process.env.IAPP_BASE_URL;   // เช่น https://api.iapp.co.th
const PATH_ = process.env.IAPP_OCR_PATH;  // เช่น /document-ocr/ocr
const KEY  = process.env.IAPP_API_KEY;    // apikey ของ iApp
const PORT = process.env.PORT || 8080;

if (!BASE || !PATH_ || !KEY) {
  console.warn('⚠️  Please set IAPP_BASE_URL, IAPP_OCR_PATH and IAPP_API_KEY in .env');
}

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ---------- main OCR endpoint ----------
app.post('/api/ocr/receipt', upload.single('file'), async (req, res, next) => {
  const tempPath = req.file?.path;
  if (!tempPath) {
    return res.status(400).json({ ok: false, error: 'No file uploaded (field name must be "file")' });
  }

  try {
    // ใช้ form-data แบบ dynamic import
    const FormData = (await import('form-data')).default;
    const form = new FormData();

    // ✅ สำคัญมาก: ส่ง filename จริง + contentType ไปให้ iApp
    form.append('file', fs.createReadStream(tempPath), {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });

    // ถ้า iApp รองรับ param อื่น เช่นภาษา ให้ส่งเพิ่มได้
    // form.append('lang', 'th,en');

    const url = `${BASE}${PATH_}`;
    const resp = await axios.post(url, form, {
      headers: {
        apikey: KEY,           // iApp ใช้ header ชื่อนี้
        ...form.getHeaders(),
      },
      timeout: 30000,
      validateStatus: () => true,
    });

    // ทำให้โครงสร้างคืนให้แอปอ่านง่าย { ok:true, data:{ text } }
    if (resp.status >= 200 && resp.status < 300) {
      const raw = resp.data;

      // พยายามดึง text จากโครงสร้างต่าง ๆ ที่ iApp อาจส่งมา
      let text = '';
      if (typeof raw === 'string') text = raw;
      if (raw?.text) text = raw.text;
      if (!text && raw?.data?.text) text = raw.data.text;
      if (!text && raw?.result?.text) text = raw.result.text;

      return res.json({ ok: true, data: { text, raw } });
    }

    // upstream error
    return res.status(resp.status || 502).json({
      ok: false,
      error: resp.data || `Upstream error: ${resp.status}`,
    });
  } catch (err) {
    return next(err);
  } finally {
    // ลบไฟล์ชั่วคราวเสมอ
    try { if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
  }
});

// ---------- Multer & global error handlers ----------
app.use((err, _req, res, _next) => {
  // error จาก multer (เช่นไฟล์ใหญ่เกิน/ชนิดไม่ถูก)
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ ok: false, error: `File too large (>${maxMB}MB)` });
  }
  if (err?.message?.startsWith('Unsupported file type')) {
    return res.status(400).json({ ok: false, error: err.message });
  }
  console.error('[ERROR]', err);
  res.status(500).json({ ok: false, error: err.message || 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`✅ OCR proxy running at http://localhost:${PORT}`);
  console.log(`🔧 Using iApp endpoint: ${BASE}${PATH_}`);
});
