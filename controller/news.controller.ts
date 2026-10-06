import { Request, Response } from "express";
import { conn } from "../dbconn";
import multer from "multer";
import path from "path";
import fs from "fs";
import { supabase } from "../config/supabase";
import { AuthRequest } from "../middleware/auth.middleware";
import { logAdminActivity } from "../utils/activityLogger";

// multer config: ใช้ memoryStorage เพื่อเก็บไฟล์ใน RAM ชั่วคราวก่อนส่งไป Supabase
const storage = multer.memoryStorage();
export const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// Helper function สำหรับอัปโหลดขึ้น Supabase Storage
const uploadToSupabase = async (buffer: Buffer, originalName: string, mimetype: string): Promise<string> => {
  // สร้างชื่อไฟล์ไม่ซ้ำกัน (ลบ news/ ออกเพื่อให้ไปอยู่หน้าแรกของ bucket เลย จะได้ไม่บั๊ก)
  const fileName = `${Date.now()}-${originalName.replace(/[^a-zA-Z0-9.]/g, "_")}`;
  
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

// ─── POST: เพิ่มข่าวสารใหม่ (พร้อมไฟล์แนบ หรือ ลิงก์ Google Drive) ──────────────
export const addNews = async (req: Request, res: Response): Promise<void> => {
  try {
    const { title, description, type, news_date } = req.body;
    const file = req.file;
    let file_url = req.body.file_url ? String(req.body.file_url).trim() : null;
    let file_name = req.body.file_name ? String(req.body.file_name).trim() : null;

    if (file) {
      file_url = await uploadToSupabase(file.buffer, file.originalname, file.mimetype);
      file_name = file.originalname;
    } else if (file_url) {
      if (!file_name) {
        file_name = "เอกสารแนบ (Google Drive)";
      }
    } else {
      file_url = null;
      file_name = null;
    }

    await conn.query(
      `INSERT INTO news (title, description, type, news_date, file_url, file_name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [title, description, type, news_date || null, file_url, file_name]
    );

    const user = (req as AuthRequest).user;
    if (user?.admin_id) {
      logAdminActivity({
        adminId: user.admin_id,
        adminName: user.name,
        adminEmail: user.email,
        action: "CREATE_NEWS",
        category: "NEWS",
        details: `เพิ่มข่าวสาร/ประกาศ: "${title}" (ประเภท: ${type})`,
        req,
      });
    }

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

    const user = (req as AuthRequest).user;
    if (user?.admin_id) {
      logAdminActivity({
        adminId: user.admin_id,
        adminName: user.name,
        adminEmail: user.email,
        action: "DELETE_NEWS",
        category: "NEWS",
        details: `ลบข่าวสาร/ประกาศ ID: ${id}`,
        req,
      });
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
    let fileUrl: string | null | undefined = req.body.file_url !== undefined ? (req.body.file_url ? String(req.body.file_url).trim() : null) : undefined;
    let fileName: string | null | undefined = req.body.file_name !== undefined ? (req.body.file_name ? String(req.body.file_name).trim() : null) : undefined;

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
    } else if (fileUrl !== undefined) {
      if (fileUrl) {
        fileName = fileName ? fileName : "เอกสารแนบ (Google Drive)";
      } else {
        fileName = null;
      }
    }

    let query = "UPDATE news SET title = ?, description = ?, type = ?, news_date = ?";
    const values: any[] = [title, description, type, news_date || null];

    if (fileUrl !== undefined) {
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

    const user = (req as AuthRequest).user;
    if (user?.admin_id) {
      logAdminActivity({
        adminId: user.admin_id,
        adminName: user.name,
        adminEmail: user.email,
        action: "UPDATE_NEWS",
        category: "NEWS",
        details: `แก้ไขข่าวสาร ID ${id}: "${title}" (ประเภท: ${type})`,
        req,
      });
    }

    res.status(200).json({ success: true, message: "แก้ไขข่าวสารสำเร็จ" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการแก้ไขข่าวสาร" });
  }
};
