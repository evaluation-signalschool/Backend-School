import { Request, Response } from "express";
import { conn } from "../dbconn";
import multer from "multer";
import path from "path";
import fs from "fs";
// ตรวจสอบว่ามีโฟลเดอร์ uploads/news หรือไม่ ถ้าไม่มีให้สร้าง
const uploadDir = path.join(process.cwd(), "uploads", "news");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// multer config
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// ─── GET: ดึงข่าวสารทั้งหมด ───────────────────────────────
export const getNews = async (_req: Request, res: Response): Promise<void> => {
  try {
    const [rows] = await conn.query(
      "SELECT * FROM news ORDER BY created_at DESC"
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "เกิดข้อผิดพลาด" });
  }
};

// ─── POST: เพิ่มข่าวสารใหม่ (พร้อมไฟล์แนบ) ──────────────
export const addNews = async (req: Request, res: Response): Promise<void> => {
  try {
    const { title, description, type, news_date } = req.body;
    const file = req.file;
    const file_url = file ? `/uploads/news/${file.filename}` : null;
    const file_name = file ? file.originalname : null;

    await conn.query(
      `INSERT INTO news (title, description, type, news_date, file_url, file_name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [title, description, type, news_date || null, file_url, file_name]
    );
    res.status(201).json({ success: true, message: "เพิ่มข่าวสารสำเร็จ" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการบันทึก" });
  }
};

// ─── DELETE: ลบข่าวสาร ───────────────────────────────────
export const deleteNews = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    // ดึง file_url ของข่าวก่อนลบ เพื่อลบไฟล์ออกด้วย
    const [rows]: any = await conn.query("SELECT file_url FROM news WHERE id = ?", [id]);
    if (rows.length > 0 && rows[0].file_url) {
      const filePath = path.join(process.cwd(), rows[0].file_url);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    const [result]: any = await conn.query("DELETE FROM news WHERE id = ?", [id]);
    if (result.affectedRows === 0) {
      res.status(404).json({ success: false, message: "ไม่พบข่าวที่ต้องการลบ" });
      return;
    }
    res.json({ success: true, message: "ลบข่าวสารสำเร็จ" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "เกิดข้อผิดพลาด" });
  }
};

// API สำหรับแก้ไขข่าวสาร
export const updateNews = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { title, description, type, news_date } = req.body;
    let fileUrl: string | undefined = undefined;
    let fileName: string | undefined = undefined;

    // ถ้ามีการอัปโหลดไฟล์ใหม่ ให้ดึงไฟล์เก่าออกมาลบ แล้วอัปเดตไฟล์ใหม่
    if (req.file) {
      fileUrl = `/uploads/news/${req.file.filename}`;
      fileName = req.file.originalname;

      // ลบไฟล์เก่า
      const [rows]: any = await conn.query("SELECT file_url FROM news WHERE id = ?", [id]);
      if (rows.length > 0 && rows[0].file_url) {
        const filePath = path.join(process.cwd(), rows[0].file_url);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    }

    let query = "UPDATE news SET title = ?, description = ?, type = ?, news_date = ?";
    const values: any[] = [title, description, type, news_date || null];

    if (fileUrl && fileName) {
      query += ", file_url = ?, file_name = ?";
      values.push(fileUrl, fileName);
    }
    
    query += " WHERE id = ?";
    values.push(id);

    const [result]: any = await conn.query(query, values);

    if (result.affectedRows === 0) {
      res.status(404).json({ success: false, message: "ไม่พบข่าวที่ต้องการแก้ไข" });
      return;
    }

    res.status(200).json({ success: true, message: "แก้ไขข่าวสารสำเร็จ" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการแก้ไขข่าวสาร" });
  }
};
