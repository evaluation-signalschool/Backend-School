import { Request, Response } from "express";
import { conn } from "../dbconn"; // เรียกใช้ connection pool ที่เราสร้างไว้

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
    // 1. จัดการ String ที่รับมาโดยลบช่องว่างและวงเล็บออกทั้งหมด
    const normalizedNewName = course_name.replace(/[\s()]/g, '');

    // 2. ค้นหาในฐานข้อมูลโดยใช้ REPLACE ลบช่องว่างและวงเล็บของข้อมูลเดิมมาเทียบ
    const checkSql = `
      SELECT course_name, curriculum_year 
      FROM courses 
      WHERE REPLACE(REPLACE(REPLACE(course_name, ' ', ''), '(', ''), ')', '') = ?
    `;
    const [existingCourses]: any = await conn.query(checkSql, [normalizedNewName]);

    // 3. ถ้าเจอว่ามีชื่อหลักสูตรนี้ (ที่ format คล้ายกัน) อยู่ในระบบแล้ว
    if (existingCourses.length > 0) {
      // เช็คว่า ปีหลักสูตร ซ้ำด้วยไหม
      const isDuplicateYear = existingCourses.some((c: any) => c.curriculum_year == curriculum_year);
      
      if (isDuplicateYear) {
        // ถ้าชื่อซ้ำ และ ปีซ้ำ -> ไม่ให้เพิ่ม
        res.status(400).json({ 
          success: false, 
          message: `มีหลักสูตรนี้ในปี ${curriculum_year} อยู่แล้ว (${existingCourses[0].course_name})` 
        });
        return;
      }

      // ถ้าชื่อซ้ำ แต่คนละปี -> อนุญาตให้เพิ่มได้
      // **Trick:** เปลี่ยนชื่อที่รับมา ให้เป็น "ชื่อเป๊ะๆ" ตามที่เคยมีใน Database 
      // เพื่อให้เวลาแสดงผลที่ Header (ซึ่ง Group ตามชื่อ) มันจะถูกจับมัดรวมอยู่ในหมวดเดียวกันทันที
      course_name = existingCourses[0].course_name;
    }

    // 4. บันทึกข้อมูล
    const [result] = await conn.query(
      "INSERT INTO courses (course_name, curriculum_year) VALUES (?, ?)",
      [course_name, curriculum_year],
    );
    res.status(201).json({ success: true, message: "เพิ่มหลักสูตรสำเร็จ" });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการบันทึกหลักสูตร" });
  }
};
export const addBatch = async (req: Request, res: Response) => {
  const { course_id, batch_name, start_date, end_date } = req.body;
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

// เปิด-ปิดการรับสมัคร (Toggle Registration)
export const toggleRegistration = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { is_registration_open } = req.body;
  
  try {
    const [result]: any = await conn.query(
      "UPDATE course_batches SET is_registration_open = ? WHERE id = ?",
      [is_registration_open ? 1 : 0, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "ไม่พบรุ่นที่ต้องการแก้ไข" });
    }

    res.json({ success: true, message: "เปลี่ยนสถานะการรับสมัครสำเร็จ" });
  } catch (error) {
    console.error("Error toggling registration:", error);
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
