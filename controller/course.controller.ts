import { Request, Response } from "express";
import { conn } from "../dbconn"; 
export const getGroupedCourses = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const sql = `
            SELECT 
                c.id AS course_id, 
                c.course_name, 
                c.curriculum_year,
                b.id AS batch_id, 
                b.batch_name, 
                b.start_date,
                b.end_date,
                b.is_active,
                b.is_registration_open
            FROM courses c
            LEFT JOIN course_batches b ON c.id = b.course_id
            ORDER BY c.course_name ASC, c.curriculum_year ASC, b.start_date ASC;
        `;

    const [rows]: any = await conn.query(sql);

    interface BatchItem {
      course_id: number;
      curriculum_year: number;
      batch_id: number;
      batch_name: string;
      start_date: string;
      end_date: string;
      is_active: boolean;
      is_registration_open: boolean;
    }

    interface CourseGroup {
      course_name: string;
      batches: BatchItem[];
    }

    const coursesMap: Record<string, CourseGroup> = {};

    rows.forEach((row: any) => {
      const name = row.course_name;

      if (!coursesMap[name]) {
        coursesMap[name] = {
          course_name: name,
          batches: [],
        };
      }

      if (row.batch_id) {
        coursesMap[name].batches.push({
          course_id: row.course_id,
          curriculum_year: row.curriculum_year,
          batch_id: row.batch_id,
          batch_name: row.batch_name,
          start_date: row.start_date,
          end_date: row.end_date,
          is_active: Boolean(row.is_active),
          is_registration_open: Boolean(row.is_registration_open),
        });
      }
    });

    res.status(200).json({
      success: true,
      data: Object.values(coursesMap),
    });
  } catch (error) {
    console.error("Database Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};
export const addCourse = async (req: Request, res: Response): Promise<void> => {
  let { course_name, curriculum_year } = req.body;
  try {
    // ตัดช่องว่างหน้าและหลัง
    course_name = typeof course_name === "string" ? course_name.trim() : "";
    const yearStr =
      curriculum_year != null ? String(curriculum_year).trim() : "";

    // 1. ตรวจสอบชื่อหลักสูตร
    if (!course_name) {
      res.status(400).json({
        success: false,
        message: "กรุณาเลือกหรือกรอกชื่อหลักสูตร",
      });
      return;
    }

    if (/\d/.test(course_name)) {
      res.status(400).json({
        success: false,
        message: "ชื่อหลักสูตรต้องเป็นตัวอักษรเท่านั้น ห้ามใส่ตัวเลข",
      });
      return;
    }

    // 2. ตรวจสอบปีหลักสูตร
    if (!yearStr) {
      res.status(400).json({
        success: false,
        message: "กรุณากรอกปีหลักสูตร",
      });
      return;
    }

    if (!/^\d+$/.test(yearStr)) {
      res.status(400).json({
        success: false,
        message: "กรุณากรอกปีเป็นตัวเลขเท่านั้น",
      });
      return;
    }

    if (yearStr.length !== 4) {
      res.status(400).json({
        success: false,
        message: "กรุณากรอกปี พ.ศ./ค.ศ. จำนวน 4 หลักให้ถูกต้อง",
      });
      return;
    }

    curriculum_year = parseInt(yearStr, 10);

    // 3. จัดการสตริงเพื่อตรวจสอบความซ้ำซ้อน
    const normalizedNewName = course_name.replace(/[\s()]/g, "");

    // 4. ตรวจสอบชื่อหลักสูตรซ้ำในฐานข้อมูล
    const checkSql = `
      SELECT course_name, curriculum_year 
      FROM courses 
      WHERE REPLACE(REPLACE(REPLACE(course_name, ' ', ''), '(', ''), ')', '') = ?
    `;
    const [existingCourses]: any = await conn.query(checkSql, [
      normalizedNewName,
    ]);

    // 5. หากพบชื่อหลักสูตรเดียวกันในระบบ
    if (existingCourses.length > 0) {
      const isDuplicateYear = existingCourses.some(
        (c: any) => c.curriculum_year == curriculum_year,
      );

      if (isDuplicateYear) {
        res.status(400).json({
          success: false,
          message: "หลักสูตรนี้ในปีดังกล่าวมีอยู่ในระบบแล้ว",
        });
        return;
      }

      course_name = existingCourses[0].course_name;
    }

    // 6. บันทึกข้อมูล
    const [result] = await conn.query(
      "INSERT INTO courses (course_name, curriculum_year) VALUES (?, ?)",
      [course_name, curriculum_year],
    );
    res.status(201).json({ success: true, message: "บันทึกข้อมูลสำเร็จ" });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการบันทึกหลักสูตร" });
  }
};
const parseDateToTimestamp = (dStr: any): number | null => {
  if (!dStr || typeof dStr !== "string" || !dStr.trim()) return null;
  const str = dStr.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const parts = str.split("T")[0].split("-");
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    return new Date(y, m, d).getTime();
  }
  const parts = str.split(/[\/\-\.]/);
  if (parts.length === 3) {
    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    let y = parseInt(parts[2], 10);
    if (y >= 2400) y -= 543;
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      return new Date(y, m, d).getTime();
    }
  }
  const dt = new Date(str);
  return isNaN(dt.getTime()) ? null : dt.getTime();
};

export const addBatch = async (req: Request, res: Response) => {
  const { course_id, batch_name, start_date, end_date } = req.body;

  if (start_date && end_date) {
    const startTs = parseDateToTimestamp(start_date);
    const endTs = parseDateToTimestamp(end_date);
    if (startTs !== null && endTs !== null && endTs < startTs) {
      return res.status(400).json({
        success: false,
        message: "วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มต้น",
      });
    }
  }

  try {
    const [result] = await conn.query(
      "INSERT INTO course_batches (course_id, batch_name, start_date, end_date) VALUES (?, ?, ?, ?)",
      [course_id, batch_name, start_date || null, end_date || null],
    );
    res.status(201).json({ success: true, message: "เพิ่มรุ่นสำเร็จ" });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการบันทึกรุ่น" });
  }
};
// ดึงหลักสูตรทั้งหมด
export const getAllCourses = async (req: Request, res: Response) => {
  try {
    const [courses] = await conn.query(
      "SELECT * FROM courses ORDER BY id DESC",
    );
    res.json({ success: true, data: courses });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "เกิดข้อผิดพลาด" });
  }
};

// ดึงรุ่นทั้งหมด
export const getAllBatches = async (req: Request, res: Response) => {
  try {
    const [batches] = await conn.query(
      "SELECT * FROM course_batches ORDER BY id DESC",
    );
    res.json({ success: true, data: batches });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "เกิดข้อผิดพลาด" });
  }
};

// อัปเดตรุ่น (Batch)
export const updateBatch = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { batch_name, start_date, end_date } = req.body;
  
  if (start_date && end_date) {
    const startTs = parseDateToTimestamp(start_date);
    const endTs = parseDateToTimestamp(end_date);
    if (startTs !== null && endTs !== null && endTs < startTs) {
      return res.status(400).json({
        success: false,
        message: "วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มต้น",
      });
    }
  }

  try {
    const [result]: any = await conn.query(
      "UPDATE course_batches SET batch_name = ?, start_date = ?, end_date = ? WHERE id = ?",
      [batch_name, start_date || null, end_date || null, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "ไม่พบรุ่นที่ต้องการแก้ไข" });
    }

    res.json({ success: true, message: "แก้ไขรุ่นสำเร็จ" });
  } catch (error) {
    console.error("Error updating batch:", error);
    res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการแก้ไขรุ่น" });
  }
};

// เปิด-ปิดการแสดงผลรุ่น (Toggle Active)
export const toggleBatchActive = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { is_active } = req.body;
  
  try {
    const [result]: any = await conn.query(
      "UPDATE course_batches SET is_active = ? WHERE id = ?",
      [is_active ? 1 : 0, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "ไม่พบรุ่นที่ต้องการแก้ไข" });
    }

    res.json({ success: true, message: "เปลี่ยนสถานะสำเร็จ" });
  } catch (error) {
    console.error("Error toggling batch active:", error);
    res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการเปลี่ยนสถานะ" });
  }
};

// ลบรุ่น (Batch)
export const deleteBatch = async (req: Request, res: Response) => {
  const { id } = req.params;
  
  try {
    // ลบรุ่น ข้อมูลที่เกี่ยวเนื่อง (นักเรียน, คะแนน, วิชา, ฟอร์ม) จะถูกลบตามทันทีด้วย ON DELETE CASCADE
    const [result]: any = await conn.query(
      "DELETE FROM course_batches WHERE id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "ไม่พบรุ่นที่ต้องการลบ" });
    }

    res.json({ success: true, message: "ลบรุ่นและข้อมูลที่เกี่ยวข้องสำเร็จ" });
  } catch (error) {
    console.error("Error deleting batch:", error);
    res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการลบรุ่น" });
  }
};

// ลบหลักสูตร (Course)
export const deleteCourse = async (req: Request, res: Response) => {
  const { id } = req.params;
  
  try {
    // ลบหลักสูตร ข้อมูลที่เกี่ยวเนื่อง (รุ่น, นักเรียน, คะแนน, วิชา, ฟอร์ม) จะถูกลบตามทันทีด้วย ON DELETE CASCADE
    const [result]: any = await conn.query(
      "DELETE FROM courses WHERE id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "ไม่พบหลักสูตรที่ต้องการลบ" });
    }

    res.json({ success: true, message: "ลบหลักสูตรและข้อมูลที่เกี่ยวข้องสำเร็จ" });
  } catch (error) {
    console.error("Error deleting course:", error);
    res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการลบหลักสูตร" });
  }
};
