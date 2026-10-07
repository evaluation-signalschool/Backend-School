import { Request, Response } from "express";
import { conn } from "../dbconn";

// 1. ดึงข้อมูลหลักสูตรทั้งหมด
export const getCourses = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    // 1. ดึงหลักสูตรและรุ่นมาพร้อมกันเลย (เรียงจากล่าสุดไปเก่าสุด)
    const sql = `
      SELECT 
        c.course_name, 
        cb.id AS batch_id, 
        cb.batch_name,
        cb.is_active
      FROM courses c
      LEFT JOIN course_batches cb ON c.id = cb.course_id
      ORDER BY c.id DESC, cb.id DESC
    `;
    const [rows]: any = await conn.query(sql);

    // 2. จัดกลุ่มข้อมูลให้ชื่อหลักสูตรไม่ซ้ำกัน (เหมือน Header)
    const groupedData = rows.reduce((acc: any, row: any) => {
      let course = acc.find((c: any) => c.course_name === row.course_name);

      if (!course) {
        course = { course_name: row.course_name, batches: [] };
        acc.push(course);
      }

      if (row.batch_id) {
        course.batches.push({
          batch_id: row.batch_id,
          batch_name: row.batch_name,
          is_active: Boolean(row.is_active)
        });
      }
      return acc;
    }, []);

    res.status(200).json({ success: true, data: groupedData });
  } catch (error) {
    console.error("Error fetching grouped courses:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการดึงข้อมูล" });
  }
};

// 2. ดึงข้อมูลรุ่น (กรองตาม course_id)
export const getBatchesByCourse = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const courseId = req.query.course_id;
  try {
    let sql = `SELECT id, batch_name FROM course_batches`;
    let params: any[] = [];

    // ถ้ามีการส่ง course_id มา ให้กรองเฉพาะรุ่นของหลักสูตรนั้น
    if (courseId && courseId !== "all") {
      sql += ` WHERE course_id = ?`;
      params.push(courseId);
    }
    sql += ` ORDER BY id DESC`;

    const [rows] = await conn.query(sql, params);
    res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error("Error fetching batches:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการดึงรุ่น" });
  }
};

// 3. ดึงข้อมูลรายวิชา (กรองตาม batch_id) พร้อมคะแนนเต็ม
export const getSubjectsByBatch = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const batchId = req.query.batch_id;
  if (!batchId) {
    res.status(400).json({ success: false, message: "กรุณาระบุ batch_id" });
    return;
  }

  try {
    // JOIN 3 ตาราง: subjects, subject_groups และ subject_batch_settings เพื่อดึงชื่อและคะแนนเต็ม
    const sql = `
      SELECT 
        sub.id AS subject_id, 
        sub.subject_name, 
        sub.is_su,
        sub.group_id, 
        sg.group_name,
        COALESCE(sbs.max_score, 0) AS max_score
      FROM subjects sub
      JOIN subject_groups sg ON sub.group_id = sg.id
      LEFT JOIN subject_batch_settings sbs ON sub.id = sbs.subject_id AND sbs.batch_id = sg.batch_id
      WHERE sg.batch_id = ?
      ORDER BY sg.id ASC, sub.id ASC
    `;
    const [rows]: any = await conn.query(sql, [batchId]);
    
    // แปลง Buffer (TINYINT) ให้เป็น Boolean 
    const formattedRows = rows.map((row: any) => ({
      ...row,
      is_su: Boolean(row.is_su)
    }));

    // จัดเรียงตามกลุ่มวิชา 1 ไปจนสุด (M01 -> M11 -> MN -> S -> P)
    const getGroupPrefixOrder = (name: string): number => {
      const upper = (name || '').trim().toUpperCase();
      if (upper.startsWith('M') && !upper.startsWith('MN')) return 1;
      if (upper.startsWith('MN')) return 2;
      if (upper.startsWith('S')) return 3;
      if (upper.startsWith('P')) return 4;
      return 5;
    };

    const compareGroupNames = (aName: string, bName: string): number => {
      const a = (aName || '').trim();
      const b = (bName || '').trim();
      const orderA = getGroupPrefixOrder(a);
      const orderB = getGroupPrefixOrder(b);
      if (orderA !== orderB) return orderA - orderB;
      const matchA = a.match(/\d+/);
      const matchB = b.match(/\d+/);
      if (matchA && matchB) {
        const numA = parseInt(matchA[0], 10);
        const numB = parseInt(matchB[0], 10);
        if (numA !== numB) return numA - numB;
      }
      return a.localeCompare(b, 'th', { numeric: true, sensitivity: 'base' });
    };

    formattedRows.sort((a: any, b: any) => {
      const groupComp = compareGroupNames(a.group_name || '', b.group_name || '');
      if (groupComp !== 0) return groupComp;
      return (a.subject_id || 0) - (b.subject_id || 0);
    });

    res.status(200).json({ success: true, data: formattedRows });
  } catch (error) {
    console.error("Error fetching subjects:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการดึงรายวิชา" });
  }
};
// ดึงข้อมูลกลุ่มวิชาตาม batch_id
export const getSubjectGroupsByBatch = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const batchId = req.query.batch_id;

  if (!batchId) {
    res.status(400).json({ success: false, message: "กรุณาระบุ batch_id" });
    return;
  }

  try {
    // อ้างอิงจากโครงสร้างตาราง subject_groups 
    const sql = `
      SELECT id, group_name, credits 
      FROM subject_groups 
      WHERE batch_id = ?
      ORDER BY group_name ASC
    `;
    const [rows]: any = await conn.query(sql, [batchId]);

    res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error("Error fetching subject groups:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงข้อมูลหมวดวิชา",
    });
  }
};
