import dotenv from 'dotenv';
import express from 'express';
import mongoose from 'mongoose';

dotenv.config({ path: '.env.api' });

const app = express();
app.use(express.json());

// เชื่อม MongoDB
mongoose.set('strictQuery', true);
mongoose.connect(process.env.MONGO_URI, {
  dbName: "expensetracking"   // 👈 ใช้ database ที่คุณสร้าง
})
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// ---------------- Schema & Model ----------------
const receiptSchema = new mongoose.Schema({
  shopName: String,
  date: Date,
  items: [String],
  total: Number,
  createdAt: { type: Date, default: Date.now }
});

const Receipt = mongoose.model('Receipt', receiptSchema, 'receipts');
// 👆 ตัวสุดท้าย 'receipts' = collection ที่คุณสร้างใน Atlas

// ---------------- Routes ----------------

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', db: mongoose.connection.readyState });
});

// GET ทั้งหมด
app.get('/receipts', async (_req, res) => {
  try {
    const receipts = await Receipt.find();
    res.json(receipts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST สร้างใหม่
app.post('/receipts', async (req, res) => {
  try {
    const receipt = new Receipt(req.body);
    await receipt.save();
    res.json(receipt);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT อัปเดตตาม id
app.put('/receipts/:id', async (req, res) => {
  try {
    const receipt = await Receipt.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    res.json(receipt);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE ตาม id
app.delete('/receipts/:id', async (req, res) => {
  try {
    await Receipt.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------- Start server ----------------
const PORT = process.env.PORT || 4000;
app.listen(PORT, () =>
  console.log(`🚀 API Server running at http://localhost:${PORT}`)
);
