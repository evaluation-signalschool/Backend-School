import { Request, Response } from "express";
import { conn } from "../dbconn";
import multer from "multer";
import path from "path";
import fs from "fs";
import { supabase } from "../config/supabase";

// multer config: ใช้ memoryStorage เพื่อเก็บไฟล์ใน RAM ชั่วคราวก่อนส่งไป Supabase
const storage = multer.memoryStorage();
export const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// Helper function สำหรับอัปโหลดขึ้น Supabase Storage
const uploadToSupabase = async (buffer: Buffer, originalName: string, mimetype: string): Promise<string> => {
  // สร้างชื่อไฟล์ไม่ซ้ำกัน
  const fileName = `news/${Date.now()}-${originalName.replace(/[^a-zA-Z0-9.]/g, "_")}`;
  
  const { data, error } = await supabase.storage
    .from('news') // ชื่อ bucket ใน Supabase
    .upload(fileName, buffer, {
      contentType: mimetype,
      upsert: false
    });

  if (error) {
    throw error;
  }

  // ดึง URL สำหรับเปิดดูไฟล์ (Public URL)
  const { data: publicUrlData } = supabase.storage
    .from('news')
    .getPublicUrl(fileName);

  return publicUrlData.publicUrl;
};

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
    let file_url = null;
    let file_name = null;

    if (file) {
      file_url = await uploadToSupabase(file.buffer, file.originalname, file.mimetype);
      file_name = file.originalname;
    }

    await conn.query(
      `INSERT INTO news (title, description, type, news_date, file_url, file_name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [title, description, type, news_date || null, file_url, file_name]
    );
    res.status(201).json({ success: true, message: "เพิ่มข่าวสารสำเร็จ" });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการบันทึก" });
  }
};

// ─── DELETE: ลบข่าวสาร ───────────────────────────────────
export const deleteNews = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    // ลบไฟล์เก่า (กรณีที่ไฟล์เก่าเป็น Local file จะลบออกจากเครื่อง)
    const [rows]: any = await conn.query("SELECT file_url FROM news WHERE id = ?", [id]);
    if (rows.length > 0 && rows[0].file_url) {
      const url = rows[0].file_url;
      if (url.startsWith('/uploads/')) {
        const filePath = path.join(process.cwd(), url);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
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

    if (req.file) {
      // อัปโหลดไฟล์ใหม่ขึ้น Supabase
      fileUrl = await uploadToSupabase(req.file.buffer, req.file.originalname, req.file.mimetype);
      fileName = req.file.originalname;

      // จัดการลบไฟล์เก่า (ถ้าเป็น Local file)
      const [rows]: any = await conn.query("SELECT file_url FROM news WHERE id = ?", [id]);
      if (rows.length > 0 && rows[0].file_url) {
        const oldUrl = rows[0].file_url;
        if (oldUrl.startsWith('/uploads/')) {
          const filePath = path.join(process.cwd(), oldUrl);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
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
