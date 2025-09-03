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
app.set('trust proxy', true);

// ================= Env & Defaults =================
const PORT  = Number(process.env.PORT) || 8080;
const BASE  = (process.env.IAPP_BASE_URL || 'https://api.iapp.co.th').trim();  // ตัวอย่าง: https://api.iapp.co.th
const PATH_ = (process.env.IAPP_OCR_PATH  || '/document-ocr/ocr').trim();      // ตัวอย่าง: /document-ocr/ocr
const KEY   = (process.env.IAPP_API_KEY   || '').trim();                        // apikey ของ iAPP
const CORS_ORIGIN = (process.env.CORS_ORIGIN || '*').trim();
const MAX_MB = Number(process.env.MAX_FILE_SIZE_MB || 10);

// ================= Middlewares =================
app.use(cors({ origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',') }));
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());

// ================= Upload dir & Multer =================
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
await fsp.mkdir(UPLOAD_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /image\/(jpeg|png)/i.test(file.mimetype);
    cb(ok ? null : new Error('Unsupported file type: only jpg/jpeg/png allowed'), ok);
  },
});

// ================= Health =================
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    ts: Date.now(),
    config: {
      base: BASE,
      path: PATH_,
      maxFileSizeMB: MAX_MB,
      apikeyPresent: Boolean(KEY),
      corsOrigin: CORS_ORIGIN,
    },
  });
});

// ================= OCR Proxy =================
app.post('/api/ocr/receipt', upload.single('file'), async (req, res, next) => {
  const tempPath = req.file?.path;
  if (!tempPath) {
    return res.status(400).json({ ok: false, error: 'No file uploaded (field name must be "file")' });
  }

  try {
    const FormData = (await import('form-data')).default;
    const form = new FormData();

    // แนบไฟล์ไปให้ iAPP (ใส่ชื่อไฟล์/คอนเทนต์ไทป์ให้ครบ)
    form.append('file', fs.createReadStream(tempPath), {
      filename: req.file.originalname || 'receipt.jpg',
      contentType: req.file.mimetype || 'image/jpeg',
    });

    const url = `${BASE}${PATH_}`;
    const resp = await axios.post(url, form, {
      headers: {
        apikey: KEY,                // << iAPP ใช้ header ชื่อ apikey
        ...form.getHeaders(),
      },
      timeout: 60000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      validateStatus: () => true,  // ให้เราจัดการ status เอง
    });

    if (resp.status >= 200 && resp.status < 300) {
      const raw = resp.data;

      // ดึงข้อความ OCR จากหลายรูปแบบ response ที่อาจเจอ
      let text = '';
      if (typeof raw === 'string') text = raw;
      if (!text && raw?.text) text = raw.text;
      if (!text && raw?.data?.text) text = raw.data.text;
      if (!text && raw?.result?.text) text = raw.result.text;
      if (!text && raw?.data?.data?.text) text = raw.data.data.text; // บางตัวห่อสองชั้น

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

// ================= Error Handlers =================
app.use((err, _req, res, _next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ ok: false, error: `File too large (>${MAX_MB}MB)` });
  }
  if (err?.message?.startsWith('Unsupported file type')) {
    return res.status(400).json({ ok: false, error: err.message });
  }
  console.error('[ERROR]', err);
  res.status(500).json({ ok: false, error: err.message || 'Internal Server Error' });
});

// ================= Start =================
const missing = [];
if (!BASE)  missing.push('IAPP_BASE_URL');
if (!PATH_) missing.push('IAPP_OCR_PATH');
if (!KEY)   missing.push('IAPP_API_KEY');
if (missing.length) console.warn('⚠️  Missing required env:', missing.join(', '));

app.listen(PORT, () => {
  console.log(`✅ OCR proxy running at http://localhost:${PORT}`);
  console.log(`🔧 Using iAPP endpoint: ${BASE}${PATH_}`);
  console.log(`🧰 Max upload: ${MAX_MB} MB`);
  console.log(`🔒 API key present: ${Boolean(KEY)}`);
});
