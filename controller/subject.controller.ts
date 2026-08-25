import { Request, Response } from "express";
import { conn } from "../dbconn";

export const getSubjectsByBatch = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  const { batchId } = req.params;

  try {
    // แก้ SQL โดยเพิ่ม LEFT JOIN กับตาราง evaluation_forms
    const sql = `
      SELECT 
        sg.id AS group_id,
        sg.group_name,
        s.id AS subject_id,
        s.subject_name,
        s.is_su,
        ef.form_url  -- ดึงฟิลด์ url ของฟอร์มออกมา
      FROM subject_groups sg
      LEFT JOIN subjects s ON sg.id = s.group_id
      -- JOIN เพื่อหาฟอร์มของวิชานี้ ในรุ่นนี้ ที่เป็นประเภท 'instructor'
      LEFT JOIN evaluation_forms ef ON s.id = ef.subject_id 
           AND ef.batch_id = sg.batch_id 
           AND ef.evaluation_type = 'instructor'
      WHERE sg.batch_id = ?
      ORDER BY sg.id ASC, s.id ASC;
    `;

    const [rows]: any = await conn.query(sql, [batchId]);

    if (rows.length === 0) {
      return res.status(200).json({
        success: true,
        message: "ไม่พบข้อมูลวิชาสำหรับ Batch นี้",
        data: [],
      });
    }

    const groupsMap: Record<number, any> = {};

    rows.forEach((row: any) => {
      if (!groupsMap[row.group_id]) {
        groupsMap[row.group_id] = {
          group_name: row.group_name,
          subjects: [],
        };
      }

      if (row.subject_id) {
        // ป้องกันรายวิชาซ้ำกัน (กรณีมีฟอร์มซ้ำในฐานข้อมูลทำให้ LEFT JOIN คืนค่ามาหลายแถว)
        const isExist = groupsMap[row.group_id].subjects.some((s: any) => s.subject_id === row.subject_id);
        if (!isExist) {
          groupsMap[row.group_id].subjects.push({
            subject_id: row.subject_id,
            subject_name: row.subject_name,
            is_su: Boolean(row.is_su),
            form_url: row.form_url || null,
          });
        }
      }
    });

    return res.status(200).json({
      success: true,
      data: Object.values(groupsMap),
    });
  } catch (error: any) {
    console.error("Database Error:", error);

    return res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดที่ฐานข้อมูล",
      errorDetails: error.message,
    });
  }
};

export const addSubjectGroup = async (req: Request, res: Response): Promise<void> => {
  const { batch_id, group_name, credits } = req.body;
  try {
    // เช็คว่ามีกลุ่มวิชานี้ในรุ่นนี้แล้วหรือไม่
    const [existing]: any = await conn.query(
      "SELECT id FROM subject_groups WHERE batch_id = ? AND group_name = ?",
      [batch_id, group_name]
    );

    if (existing.length > 0) {
      res.status(400).json({ success: false, message: "กลุ่มวิชานี้ถูกเพิ่มไปแล้ว" });
      return;
    }

    const [result] = await conn.query(
      "INSERT INTO subject_groups (batch_id, group_name, credits) VALUES (?, ?, ?)",
      [batch_id, group_name, credits],
    );
    res.status(201).json({ success: true, message: "เพิ่มกลุ่มวิชาสำเร็จ" });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการบันทึกกลุ่มวิชา" });
  }
};

export const addSubject = async (req: Request, res: Response): Promise<void> => {
  const { group_id, subject_name, is_su = 0 } = req.body;
  try {
    // เช็คว่ามีรายวิชานี้ในกลุ่มนี้แล้วหรือไม่
    const [existing]: any = await conn.query(
      "SELECT id FROM subjects WHERE group_id = ? AND subject_name = ?",
      [group_id, subject_name]
    );

    if (existing.length > 0) {
      res.status(400).json({ success: false, message: `รายวิชา "${subject_name}" ถูกเพิ่มไปแล้วในกลุ่มวิชานี้` });
      return;
    }

    const [result] = await conn.query(
      "INSERT INTO subjects (group_id, subject_name, is_su) VALUES (?, ?, ?)",
      [group_id, subject_name, is_su ? 1 : 0],
    );
    res.status(201).json({ success: true, message: "เพิ่มรายวิชาสำเร็จ" });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการบันทึกรายวิชา" });
  }
};
// ดึงกลุ่มวิชาทั้งหมด
export const getAllSubjectGroups = async (req: Request, res: Response) => {
  try {
    const [groups] = await conn.query(
      "SELECT * FROM subject_groups ORDER BY id DESC",
    );
    res.json({ success: true, data: groups });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "เกิดข้อผิดพลาด" });
  }
};

// เช็คว่ามีคะแนนในกลุ่มวิชานี้หรือไม่
export const checkGroupScores = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    const sql = `
      SELECT COUNT(sc.id) AS score_count
      FROM student_scores sc
      JOIN subject_batch_settings sbs ON sc.setting_id = sbs.id
      JOIN subjects sub ON sbs.subject_id = sub.id
      WHERE sub.group_id = ?
    `;
    const [rows]: any = await conn.query(sql, [id]);
    const hasScores = rows[0].score_count > 0;
    res.json({ success: true, hasScores });
  } catch (error) {
    console.error("Error checking group scores:", error);
    res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการตรวจสอบคะแนน" });
  }
};

// ลบกลุ่มวิชา
export const deleteSubjectGroup = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const connection = await conn.getConnection();
  try {
    await connection.beginTransaction();

    // 1. หา subjects ในกลุ่มนี้
    const [subjects]: any = await connection.query("SELECT id FROM subjects WHERE group_id = ?", [id]);
    const subjectIds = subjects.map((s: any) => s.id);

    if (subjectIds.length > 0) {
      // 2. หา setting_id ใน subject_batch_settings
      const [settings]: any = await connection.query("SELECT id FROM subject_batch_settings WHERE subject_id IN (?)", [subjectIds]);
      const settingIds = settings.map((s: any) => s.id);

      if (settingIds.length > 0) {
        // 3. ลบ student_scores
        await connection.query("DELETE FROM student_scores WHERE setting_id IN (?)", [settingIds]);
      }
      
      // 4. ลบ subject_score_submissions
      await connection.query("DELETE FROM subject_score_submissions WHERE subject_id IN (?)", [subjectIds]);

      // 5. ลบ subject_batch_settings
      await connection.query("DELETE FROM subject_batch_settings WHERE subject_id IN (?)", [subjectIds]);
      
      // 6. ลบ evaluation_forms
      await connection.query("DELETE FROM evaluation_forms WHERE subject_id IN (?)", [subjectIds]);
      
      // 7. ลบ evaluation_submissions
      await connection.query("DELETE FROM evaluation_submissions WHERE subject_id IN (?)", [subjectIds]);

      // 8. ลบ subjects
      await connection.query("DELETE FROM subjects WHERE group_id = ?", [id]);
    }

    // 9. ลบ subject_groups
    await connection.query("DELETE FROM subject_groups WHERE id = ?", [id]);

    await connection.commit();
    res.json({ success: true, message: "ลบกลุ่มวิชาและข้อมูลที่เกี่ยวข้องเรียบร้อยแล้ว" });
  } catch (error) {
    await connection.rollback();
    console.error("Error deleting subject group:", error);
    res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการลบกลุ่มวิชา" });
  } finally {
    connection.release();
  }
};

// เช็คว่ามีคะแนนในวิชานี้หรือไม่
export const checkSubjectScores = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    const sql = `
      SELECT COUNT(sc.id) AS score_count
      FROM student_scores sc
      JOIN subject_batch_settings sbs ON sc.setting_id = sbs.id
      WHERE sbs.subject_id = ?
    `;
    const [rows]: any = await conn.query(sql, [id]);
    const hasScores = rows[0].score_count > 0;
    res.json({ success: true, hasScores });
  } catch (error) {
    console.error("Error checking subject scores:", error);
    res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการตรวจสอบคะแนน" });
  }
};

// ลบรายวิชา
export const deleteSubject = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const connection = await conn.getConnection();
  try {
    await connection.beginTransaction();

    // 1. หา setting_id
    const [settings]: any = await connection.query("SELECT id FROM subject_batch_settings WHERE subject_id = ?", [id]);
    const settingIds = settings.map((s: any) => s.id);

    if (settingIds.length > 0) {
      // 2. ลบ student_scores
      await connection.query("DELETE FROM student_scores WHERE setting_id IN (?)", [settingIds]);
    }
    
    // 3. ลบ subject_score_submissions
    await connection.query("DELETE FROM subject_score_submissions WHERE subject_id = ?", [id]);

    // 4. ลบ subject_batch_settings
    await connection.query("DELETE FROM subject_batch_settings WHERE subject_id = ?", [id]);
    
    // 5. ลบ evaluation_forms
    await connection.query("DELETE FROM evaluation_forms WHERE subject_id = ?", [id]);
    
    // 6. ลบ evaluation_submissions
    await connection.query("DELETE FROM evaluation_submissions WHERE subject_id = ?", [id]);

    // 7. ลบ subjects
    await connection.query("DELETE FROM subjects WHERE id = ?", [id]);

    await connection.commit();
    res.json({ success: true, message: "ลบรายวิชาและข้อมูลที่เกี่ยวข้องเรียบร้อยแล้ว" });
  } catch (error) {
    await connection.rollback();
    console.error("Error deleting subject:", error);
    res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการลบรายวิชา" });
  } finally {
    connection.release();
  }
};
