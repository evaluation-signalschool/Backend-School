import { Request, Response } from "express";
import { RowDataPacket } from "mysql2";
import { conn } from "../dbconn";
import { AuthRequest } from "../middleware/auth.middleware";
import { logAdminActivity } from "../utils/activityLogger";

// ==========================================
// 3. อัปเดตคะแนนเต็มรายวิชา (Max Score)
// ==========================================
export const updateSubjectMaxScore = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { batch_id, subject_id, max_score } = req.body;

    if (!batch_id || !subject_id || max_score === undefined) {
      res.status(400).json({
        error: "กรุณาระบุ batch_id, subject_id และ max_score ให้ครบถ้วน",
      });
      return;
    }

    // ✅ เปลี่ยนมาใช้ INSERT ... ON DUPLICATE KEY UPDATE
    // ถ้าไม่มีข้อมูล จะทำการสร้างให้ใหม่ (แก้ปัญหา 404)
    // ถ้ามีข้อมูลอยู่แล้ว จะอัปเดตค่าให้แทน
    const updateQuery = `
      INSERT INTO subject_batch_settings (batch_id, subject_id, max_score) 
      VALUES (?, ?, ?) 
      ON DUPLICATE KEY UPDATE max_score = VALUES(max_score)
    `;

    const [result]: any = await conn.execute(updateQuery, [
      batch_id,
      subject_id,
      max_score,
    ]);

    res.status(200).json({
      message: "อัปเดตคะแนนเต็มสำเร็จ",
      batch_id: batch_id,
      subject_id: subject_id,
      new_max_score: max_score,
    });
  } catch (error) {
    console.error("Error updating max score:", error);
    res.status(500).json({ error: "เกิดข้อผิดพลาดในการอัปเดตคะแนนเต็ม" });
  }
};

// ==========================================
// 4. ดึงข้อมูลคะแนนทั้งหมด (ของนักเรียน 1 คน) ฝั่งนร
// ==========================================
export const getStudentScores = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const studentId = req.params.student_id as string;
    const batchId = req.query.batch_id as string;

    if (!studentId || !batchId) {
      res.status(400).json({ error: "กรุณาระบุ student_id และ batch_id" });
      return;
    }

    // 🛡️ ป้องกัน IDOR: ตรวจสอบสิทธิ์ว่า user ใน Token มีสิทธิ์เข้าถึงข้อมูลของ studentId หรือไม่
    const currentUser = req.user;
    if (currentUser) {
      const isOwner = String(currentUser.student_id) === String(studentId);
      const isAdmin = currentUser.role === "admin" || currentUser.role === "superadmin";
      if (!isOwner && !isAdmin) {
        console.warn(
          `[Security Alert] IDOR attempt detected! User: ${currentUser.student_id || currentUser.email} tried to access scores of Student ID: ${studentId} from IP: ${req.ip}`
        );
        res.status(403).json({
          error: "คุณไม่มีสิทธิ์เข้าถึงข้อมูลคะแนนของนักเรียนท่านอื่น",
        });
        return;
      }
    }

    // 1. อัปเดต detailQuery เพื่อเช็คประวัติการประเมิน
    const detailQuery = `
      SELECT 
        sg.group_name, 
        sub.id AS subject_id,   -- เพิ่ม subject_id ส่งกลับไปด้วย เผื่อต้องใช้ทำเงื่อนไขหน้าบ้าน
        sub.subject_name, 
        sbs.max_score, 
        COALESCE(ss.raw_score, 0) AS raw_score,
        -- เช็คว่าใน evaluation_submissions มีข้อมูลหรือไม่ (ถ้ามี=1(true), ถ้าไม่มี=0(false))
        IF(eval.id IS NOT NULL, true, false) AS is_evaluated
      FROM subject_batch_settings sbs
      JOIN subjects sub ON sbs.subject_id = sub.id
      JOIN subject_groups sg ON sub.group_id = sg.id
      LEFT JOIN student_scores ss ON sbs.id = ss.setting_id AND ss.student_id = ?
      
      LEFT JOIN evaluation_submissions eval 
        ON eval.subject_id = sub.id 
        AND eval.student_id = ? 
        
      WHERE sbs.batch_id = ?
      ORDER BY sg.id, sub.id;
    `;

    // สังเกตว่าเรามี ? 3 ตัว (ss.student_id, eval.student_id, sbs.batch_id)
    const [subjectDetails] = await conn.execute<RowDataPacket[]>(detailQuery, [
      studentId,
      studentId, // ส่ง studentId เข้าไปเทียบใน LEFT JOIN ด้วย
      batchId,
    ]);

    // 2. แปลงผลลัพธ์จาก MySQL ให้เป็น boolean เป๊ะๆ (1/0 -> true/false)
    const formattedSubjectDetails = subjectDetails.map((row) => ({
      ...row,
      is_evaluated: !!row.is_evaluated, // บังคับแปลงเป็น boolean ให้ Angular รับค่าง่ายๆ
    }));

    // 3. summaryQuery ใช้ตัวเดิมได้เลย (คะแนนรวมไม่ได้รับผลกระทบ)
    const summaryQuery = `
      SELECT 
        sg.group_name, 
        sg.credits, 
        SUM(sbs.max_score) AS group_max_score,
        COALESCE(SUM(ss.raw_score), 0) AS group_raw_score,
        COALESCE((SUM(ss.raw_score) / SUM(sbs.max_score)) * 100, 0) AS group_percentage
      FROM subject_groups sg
      JOIN subjects sub ON sg.id = sub.group_id
      JOIN subject_batch_settings sbs ON sub.id = sbs.subject_id
      LEFT JOIN student_scores ss ON sbs.id = ss.setting_id AND ss.student_id = ?
      WHERE sg.batch_id = ?
      GROUP BY sg.id;
    `;
    const [groupSummaries] = await conn.execute<RowDataPacket[]>(summaryQuery, [
      studentId,
      batchId,
    ]);

    // 4. ส่งผลลัพธ์กลับ
    res.status(200).json({
      message: "ดึงข้อมูลสำเร็จ",
      student_id: studentId,
      batch_id: batchId,
      subject_details: formattedSubjectDetails, // ใช้ตัวที่เราแปลง boolean แล้ว
      group_summaries: groupSummaries,
    });
  } catch (error) {
    console.error("Error fetching student scores:", error);
    res.status(500).json({ error: "เกิดข้อผิดพลาดในการดึงข้อมูล" });
  }
};

// ==========================================
//  5. (NEW) แอดมินดึงรายชื่อนักเรียนและคะแนนดิบ 1 วิชา (ทั้งห้อง)
// ==========================================
export const getAdminSubjectScores = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const batch_id = req.query.batch_id;
  const subject_id = req.query.subject_id;

  if (!batch_id || !subject_id) {
    res
      .status(400)
      .json({ success: false, message: "กรุณาส่ง batch_id และ subject_id" });
    return;
  }

  try {
    const settingSql = `
      SELECT sbs.id as setting_id, sbs.max_score, sub.is_su 
      FROM subject_batch_settings sbs
      JOIN subjects sub ON sub.id = sbs.subject_id
      WHERE sbs.batch_id = ? AND sbs.subject_id = ? 
      LIMIT 1
    `;
    const [settingRows]: any = await conn.query(settingSql, [
      batch_id,
      subject_id,
    ]);

    if (settingRows.length === 0) {
      res.status(404).json({
        success: false,
        message: "ยังไม่ได้ตั้งค่าคะแนนเต็ม (max_score) สำหรับวิชานี้",
      });
      return;
    }

    const setting = settingRows[0];

    const studentSql = `
      SELECT 
        st.id AS student_id, 
        st.student_code, 
        st.rank_name, 
        st.first_name, 
        st.last_name, 
        ss.raw_score 
      FROM students st
      LEFT JOIN student_scores ss ON st.id = ss.student_id AND ss.setting_id = ?
      WHERE st.batch_id = ?
      ORDER BY st.student_code ASC
    `;
    const [studentRows]: any = await conn.query(studentSql, [
      setting.setting_id,
      batch_id,
    ]);

    res.status(200).json({
      success: true,
      max_score: setting.max_score,
      is_su: setting.is_su === 1,
      data: studentRows,
    });
  } catch (error) {
    console.error("Get Admin Scores Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดที่เซิร์ฟเวอร์" });
  }
};

// ==========================================
// 6. (NEW) แอดมินบันทึกคะแนนรวดเดียวทั้งห้อง
// ==========================================
export const saveAdminBulkScores = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { batch_id, subject_id, scores } = req.body;

  if (!batch_id || !subject_id || !scores || !Array.isArray(scores)) {
    res
      .status(400)
      .json({ success: false, message: "ข้อมูลที่ส่งมาไม่ถูกต้อง" });
    return;
  }

  const connection = await conn.getConnection();

  try {
    const settingSql = `SELECT id as setting_id FROM subject_batch_settings WHERE batch_id = ? AND subject_id = ? LIMIT 1`;
    const [settingRows]: any = await connection.query(settingSql, [
      batch_id,
      subject_id,
    ]);

    if (settingRows.length === 0) {
      res
        .status(404)
        .json({ success: false, message: "ไม่พบข้อมูลการตั้งค่ารายวิชานี้" });
      return;
    }

    const setting_id = settingRows[0].setting_id;

    await connection.beginTransaction();

    const insertQuery = `
      INSERT INTO student_scores (student_id, setting_id, raw_score) 
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE raw_score = VALUES(raw_score), updated_at = CURRENT_TIMESTAMP
    `;

    for (const scoreItem of scores) {
      await connection.execute(insertQuery, [
        scoreItem.student_id,
        setting_id,
        scoreItem.raw_score,
      ]);
    }

    await connection.commit();

    const user = (req as AuthRequest).user;
    if (user?.admin_id) {
      logAdminActivity({
        adminId: user.admin_id,
        adminName: user.name,
        adminEmail: user.email,
        action: "UPDATE_SCORE",
        category: "SCORE",
        details: `บันทึกคะแนนนักเรียนจำนวน ${scores.length} คน (รายวิชา ID: ${subject_id}, รุ่น ID: ${batch_id})`,
        req,
      });
    }

    res.status(200).json({
      success: true,
      message: "บันทึกคะแนนทั้งหมดเรียบร้อยแล้ว",
      saved_count: scores.length,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Save Admin Bulk Scores Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการบันทึกข้อมูล" });
  } finally {
    connection.release();
  }
};

//ตัดเกรด
export const processGroupGrades = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const batchId = req.query.batch_id;
  const groupId = req.query.group_id;

  if (!batchId || !groupId) {
    res.status(400).json({
      success: false,
      message: "กรุณาระบุ batch_id และ group_id ให้ครบถ้วน",
    });
    return;
  }

  try {
    // 1. ดึงเกณฑ์การตัดเกรด
    let [criteria]: any = await conn.query(
      `SELECT grade_name, grade_point, min_percent FROM grading_criteria 
       WHERE batch_id = ? OR batch_id IS NULL ORDER BY min_percent DESC`,
      [batchId],
    );

    if (criteria.length === 0) {
      criteria = [
        { grade_name: "A", grade_point: 4.0, min_percent: 91 },
        { grade_name: "B+", grade_point: 3.5, min_percent: 86 },
        { grade_name: "B", grade_point: 3.0, min_percent: 81 },
        { grade_name: "C+", grade_point: 2.5, min_percent: 76 },
        { grade_name: "C", grade_point: 2.0, min_percent: 70 },
        { grade_name: "D+", grade_point: 1.5, min_percent: 60 },
        { grade_name: "D", grade_point: 1.0, min_percent: 50 },
        { grade_name: "F", grade_point: 0.0, min_percent: 0 },
      ];
    }

    // 🌟 2. [ส่วนที่แก้ไข] ดึงข้อมูลวิชาย่อย เพื่อนำไปสร้างเป็นคอลัมน์ 🌟
    const groupSql = `
      SELECT sg.group_name, sg.credits AS total_credit, sub.id AS subject_id, sub.subject_name, sbs.max_score, sub.is_su
      FROM subject_groups sg
      JOIN subjects sub ON sg.id = sub.group_id
      JOIN subject_batch_settings sbs ON sub.id = sbs.subject_id
      WHERE sg.id = ? AND sbs.batch_id = ?
    `;
    const [subjectsInGroup]: any = await conn.query(groupSql, [
      groupId,
      batchId,
    ]);

    if (subjectsInGroup.length === 0) {
      res
        .status(404)
        .json({ success: false, message: "ไม่พบข้อมูลรายวิชาในกลุ่มนี้" });
      return;
    }

    const actualGroupName = subjectsInGroup[0].group_name;
    const totalGroupCredit = Number(subjectsInGroup[0].total_credit) || 0;

    let totalGroupMaxScore = 0;
    // สร้าง Array เก็บรายวิชาเพื่อส่งไปวาดหัวตารางใน Angular
    const subjectColumns = subjectsInGroup.map((s: any) => {
      totalGroupMaxScore += Number(s.max_score) || 0;
      return {
        subject_id: s.subject_id,
        subject_name: s.subject_name,
        max_score: Number(s.max_score) || 0,
        is_su: Boolean(s.is_su),
      };
    });

    const isGroupSU =
      subjectColumns.length > 0 && subjectColumns.every((s: any) => s.is_su);

    // 🌟 3. [ส่วนที่แก้ไข] ดึงคะแนนดิบทั้งหมดแยกตามรายวิชา ไม่ใช้ SUM() แล้ว 🌟
    const scoreSql = `
      SELECT 
        st.id AS student_id, st.student_code, st.rank_name, st.first_name, st.last_name,
        ss.raw_score, sub.id AS subject_id
      FROM students st
      JOIN student_scores ss ON st.id = ss.student_id
      JOIN subject_batch_settings sbs ON ss.setting_id = sbs.id
      JOIN subjects sub ON sbs.subject_id = sub.id
      WHERE sbs.batch_id = ? AND sub.group_id = ?
    `;
    const [rawScores]: any = await conn.query(scoreSql, [batchId, groupId]);

    // นำคะแนนมาจัดกลุ่มตามนักเรียนแต่ละคน
    const studentMap = new Map();

    rawScores.forEach((row: any) => {
      // ถ้านักเรียนคนนี้ยังไม่มีใน Map ให้สร้างใหม่พร้อมกระเป๋าเก็บคะแนนแยกวิชา (subject_scores)
      if (!studentMap.has(row.student_id)) {
        studentMap.set(row.student_id, {
          student_id: row.student_id,
          student_code: row.student_code,
          full_name:
            `${row.rank_name || ""} ${row.first_name} ${row.last_name}`.trim(),
          total_raw_score: 0,
          subject_scores: {}, // 👈 กระเป๋าเก็บคะแนนแต่ละวิชา
        });
      }

      const st = studentMap.get(row.student_id);
      const score = Number(row.raw_score) || 0;

      st.subject_scores[row.subject_id] = score; // หยอดคะแนนลงวิชาที่ตรงกัน
      st.total_raw_score += score; // บวกคะแนนรวม
    });

    // 4. ตัดเกรดและคำนวณค่าประกอบ (Index)
    const finalResults = Array.from(studentMap.values()).map((st: any) => {
      if (isGroupSU) {
        const isPassed = st.total_raw_score > 0;
        const suGrade = isPassed ? "S" : "U";
        const percent = isPassed ? 100 : 0;
        return {
          student_id: st.student_id,
          student_code: st.student_code,
          full_name: st.full_name,
          total_raw_score: st.total_raw_score.toFixed(2),
          total_max_score: totalGroupMaxScore,
          percent: percent.toFixed(2),
          grade: suGrade,
          grade_point: suGrade,
          index_value: suGrade,
          subject_scores: st.subject_scores,
        };
      }

      const percent =
        totalGroupMaxScore > 0
          ? (st.total_raw_score / totalGroupMaxScore) * 100
          : 0;

      let assignedGrade = criteria[criteria.length - 1];
      for (const c of criteria) {
        if (percent >= Number(c.min_percent)) {
          assignedGrade = c;
          break;
        }
      }

      const safeGradePoint = Math.min(4.0, Math.max(0, Number(assignedGrade.grade_point) || 0));
      const indexValue = totalGroupCredit * safeGradePoint;

      return {
        student_id: st.student_id,
        student_code: st.student_code,
        full_name: st.full_name,
        total_raw_score: st.total_raw_score.toFixed(2),
        total_max_score: totalGroupMaxScore,
        percent: percent.toFixed(2),
        grade: assignedGrade.grade_name,
        grade_point: safeGradePoint.toFixed(2),
        index_value: indexValue.toFixed(2),
        subject_scores: st.subject_scores, // 👈 ส่งกระเป๋าคะแนนแยกวิชากลับไปด้วย
      };
    });

    // 5. ส่งกลับข้อมูลไปให้หน้าเว็บ
    res.status(200).json({
      success: true,
      summary: {
        group_name: actualGroupName,
        total_credit: totalGroupCredit,
        total_max_score: totalGroupMaxScore,
        subjects: subjectColumns, // 👈 ส่งหัวตารางกลับไปให้ Angular วนลูป
        is_su: isGroupSU,
      },
      data: finalResults,
    });
  } catch (error) {
    console.error("Error processing group grades:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการประมวลผลคะแนน" });
  }
};

export const getscore = async (req: Request, res: Response): Promise<void> => {
  try {
    const batchId = req.query.batch_id;
    if (!batchId) {
      res.status(400).json({ error: "กรุณาระบุ batch_id" });
      return;
    }

    // 1. ดึงเกณฑ์การตัดเกรดมาเตรียมไว้
    let [criteria]: any = await conn.query(
      `SELECT grade_name, grade_point, min_percent FROM grading_criteria 
       WHERE batch_id = ? OR batch_id IS NULL ORDER BY min_percent DESC`,
      [batchId],
    );

    if (criteria.length === 0) {
      criteria = [
        { grade_name: "A", grade_point: 4.0, min_percent: 91 },
        { grade_name: "B+", grade_point: 3.5, min_percent: 86 },
        { grade_name: "B", grade_point: 3.0, min_percent: 81 },
        { grade_name: "C+", grade_point: 2.5, min_percent: 76 },
        { grade_name: "C", grade_point: 2.0, min_percent: 70 },
        { grade_name: "D+", grade_point: 1.5, min_percent: 60 },
        { grade_name: "D", grade_point: 1.0, min_percent: 50 },
        { grade_name: "F", grade_point: 0.0, min_percent: 0 },
      ];
    }

    // 🌟 2. ดึงข้อมูลวิชา คะแนนรายวิชา และ "คะแนนพิเศษ 3 ก้อน" 🌟
    const query = `
      SELECT 
        st.id AS student_id, st.student_code, st.rank_name, st.first_name, st.last_name,
        sub.id AS subject_id, sub.subject_name,
        sub.group_id, 
        sg.group_name, 
        sg.credits AS credit, 
        sbs.max_score, 
        sub.is_su,
        sc.raw_score,
        -- ดึงคะแนนพิเศษ 3 ตัวมาจาก student_summary_scores
        sss.training_time_score,
        sss.exam_time_score,
        sss.behavior_score
      FROM students st
      JOIN subject_batch_settings sbs ON st.batch_id = sbs.batch_id
      JOIN subjects sub ON sbs.subject_id = sub.id
      JOIN subject_groups sg ON sub.group_id = sg.id 
      LEFT JOIN student_scores sc ON st.id = sc.student_id AND sbs.id = sc.setting_id 
      -- เพิ่ม JOIN ตารางสรุปคะแนน
      LEFT JOIN student_summary_scores sss ON st.id = sss.student_id AND st.batch_id = sss.batch_id
      WHERE st.batch_id = ?
      ORDER BY st.student_code ASC, sub.id ASC
    `;

    const [rows]: any = await conn.query(query, [batchId]);

    if (rows.length === 0) {
      res.json({ success: true, summary: {}, data: [] });
      return;
    }

    // 3. จัดกลุ่มวิชา
    const groupsMap: any = {};
    const studentsMap: any = {};
    const masterSubjects: any[] = [];
    let totalMaxScoreAll = 0;
    let totalCreditAll = 0;

    rows.forEach((row: any) => {
      // --- จัดการข้อมูลหัวตาราง (กลุ่มวิชา) ---
      if (!groupsMap[row.group_id]) {
        groupsMap[row.group_id] = {
          groupId: row.group_id,
          groupName: row.group_name || "",
          groupCode: row.group_name || "", // เก็บชื่อดั้งเดิม (เช่น M01, MN01) ไว้ตรวจสอบสี
          credit: Number(row.credit) || 0,
          subjects: [],
          group_max_score: 0,
          is_su: Boolean(row.is_su),
        };
      }

      const group = groupsMap[row.group_id];

      // If any subject in group is not SU, the group is not fully SU
      if (!row.is_su) {
        group.is_su = false;
      }

      const isSubjectExist = group.subjects.find(
        (s: any) => s.id === row.subject_id,
      );
      if (!isSubjectExist) {
        const newSubject = {
          id: row.subject_id,
          name: row.subject_name,
          max_score: Number(row.max_score) || 0,
          is_su: Boolean(row.is_su),
        };
        group.subjects.push(newSubject);
        masterSubjects.push(newSubject);
        group.group_max_score += newSubject.max_score;
        totalMaxScoreAll += newSubject.max_score;
      }

      // --- 🌟 จัดการข้อมูลนักเรียน (เพิ่มคะแนนพิเศษ 3 ก้อนเข้าไปที่นี่) 🌟 ---
      if (!studentsMap[row.student_id]) {
        studentsMap[row.student_id] = {
          student_id: row.student_id,
          student_code: row.student_code,
          full_name:
            `${row.rank_name || ""} ${row.first_name || ""} ${row.last_name || ""}`.trim(),
          total_raw_score: 0,
          total_max_score: 0,
          percent: "0.00",
          gpa: "0.00",
          subject_scores: {},
          group_raw_scores: {},
          // แมปคะแนนทั้ง 3 ตัวส่งกลับไป ถ้าเป็น null (ยังไม่เคยบันทึก) ให้เป็น 0
          training_time_score: Number(row.training_time_score) || 0,
          exam_time_score: Number(row.exam_time_score) || 0,
          behavior_score: Number(row.behavior_score) || 0,
        };
      }

      const student = studentsMap[row.student_id];

      if (row.raw_score !== null && row.raw_score !== undefined) {
        const score = Number(row.raw_score);
        student.subject_scores[row.subject_id] = score;
        student.group_raw_scores[row.group_id] =
          (student.group_raw_scores[row.group_id] || 0) + score;
        student.total_raw_score += score;
      }
    });

    const subjectGroups = Object.values(groupsMap).map((grp: any) => {
      grp.isSingle = grp.subjects.length === 1;
      if (grp.isSingle) {
        grp.groupName = `${grp.subjects[0].name} ${grp.credit} นก.`;
      } else {
        grp.groupName = `รวม ${grp.subjects.length} วิชา ${grp.credit} นก.`;
      }
      return grp;
    });

    totalCreditAll = 0;
    subjectGroups.forEach((grp: any) => {
      if (!grp.is_su) {
        totalCreditAll += grp.credit;
      }
    });

    // 4. ตัดเกรดและคำนวณ GPA
    const data = Object.values(studentsMap).map((student: any) => {
      student.total_raw_score = Number(Number(student.total_raw_score || 0).toFixed(4));
      student.total_max_score = totalMaxScoreAll;
      student.percent =
        totalMaxScoreAll > 0
          ? ((student.total_raw_score / totalMaxScoreAll) * 100).toFixed(2)
          : "0.00";

      let totalIndexForGPA = 0;
      let totalCreditForGPA = 0;
      student.group_results = {};

      Object.values(groupsMap).forEach((grp: any) => {
        const rawScore = student.group_raw_scores[grp.groupId];
        if (rawScore !== undefined) {
          if (grp.is_su) {
            const isPassed = rawScore > 0;
            const suGrade = isPassed ? "S" : "U";
            student.group_results[grp.groupId] = {
              grade: suGrade,
              index_value: suGrade,
              raw_score: rawScore,
            };
          } else {
            const percent =
              grp.group_max_score > 0
                ? (rawScore / grp.group_max_score) * 100
                : 0;

            let assignedGrade = criteria[criteria.length - 1];
            for (const c of criteria) {
              if (percent >= Number(c.min_percent)) {
                assignedGrade = c;
                break;
              }
            }

            const gradePoint = Math.min(4.0, Math.max(0, Number(assignedGrade.grade_point) || 0));
            const indexValue = grp.credit * gradePoint;
            student.group_results[grp.groupId] = {
              grade: assignedGrade.grade_name,
              grade_point: gradePoint,
              index_value: indexValue.toFixed(2),
              raw_score: rawScore,
            };

            if (
              assignedGrade.grade_name !== "S" &&
              assignedGrade.grade_name !== "U"
            ) {
              totalIndexForGPA += indexValue;
              totalCreditForGPA += grp.credit;
            }
          }
        }
      });

      const rawGpa =
        totalCreditForGPA > 0
          ? totalIndexForGPA / totalCreditForGPA
          : 0;
      student.gpa = Math.min(4.0, Math.max(0, rawGpa)).toFixed(2);
      delete student.group_raw_scores; // ลบตัวแปรทดเลขทิ้ง
      return student;
    });

    res.json({
      success: true,
      summary: {
        batch_id: Number(batchId),
        total_credit: totalCreditAll,
        total_max_score: totalMaxScoreAll,
        subjectGroups: subjectGroups,
        masterSubjects: masterSubjects,
      },
      data: data,
    });
  } catch (error) {
    console.error("Error fetching batch score:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการประมวลผลข้อมูล" });
  }
};
export const getBatchSummaryScores = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const batchId = req.query.batch_id;

  if (!batchId) {
    res.status(400).json({
      success: false,
      message: "กรุณาระบุ batch_id",
    });
    return;
  }

  try {
    const query = `
      SELECT 
        st.id AS student_id,
        st.student_code,
        st.rank_name,
        st.first_name,
        st.last_name,
        st.affiliation,
        sss.training_time_score,
        sss.exam_time_score,
        sss.behavior_score
      FROM students st
      LEFT JOIN student_summary_scores sss ON st.id = sss.student_id AND st.batch_id = sss.batch_id
      WHERE st.batch_id = ?
      ORDER BY CAST(st.student_code AS UNSIGNED) ASC, st.id ASC
    `;

    const [rows]: any = await conn.query(query, [batchId]);

    res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error: any) {
    console.error("Error getBatchSummaryScores:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงข้อมูลคะแนนสรุป",
      error: error.message,
    });
  }
};

export const saveBatchScores = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { batch_id, scores } = req.body;

    // --- Validate ข้อมูลเบื้องต้น ---
    if (!batch_id || !Array.isArray(scores)) {
      res.status(400).json({
        success: false,
        message: "รูปแบบข้อมูลไม่ถูกต้อง กรุณาส่ง batch_id และ scores (Array)",
      });
      return;
    }

    if (scores.length === 0) {
      res.status(200).json({
        success: true,
        message: "ไม่มีข้อมูลนักเรียนให้บันทึก",
      });
      return;
    }

    // --- เตรียมข้อมูลสำหรับ Bulk Insert ---
    // หากฟิลด์ใดไม่ได้ส่งมา (undefined) ให้เป็น null เพื่อไม่ให้เขียนทับค่าเดิมใน DB ผ่าน COALESCE
    const values = scores.map((student: any) => [
      batch_id,
      student.student_id,
      student.training_time_score !== undefined && student.training_time_score !== null && student.training_time_score !== ""
        ? Number(student.training_time_score)
        : null,
      student.exam_time_score !== undefined && student.exam_time_score !== null && student.exam_time_score !== ""
        ? Number(student.exam_time_score)
        : null,
      student.behavior_score !== undefined && student.behavior_score !== null && student.behavior_score !== ""
        ? Number(student.behavior_score)
        : null,
    ]);

    // --- คำสั่ง SQL (Upsert โดยใช้ COALESCE เพื่อรักษาค่าฟิลด์เดิมไว้หากไม่ได้ส่งฟิลด์นั้นมา) ---
    const sql = `
            INSERT INTO student_summary_scores 
            (batch_id, student_id, training_time_score, exam_time_score, behavior_score)
            VALUES ?
            ON DUPLICATE KEY UPDATE 
            training_time_score = COALESCE(VALUES(training_time_score), student_summary_scores.training_time_score, 100),
            exam_time_score = COALESCE(VALUES(exam_time_score), student_summary_scores.exam_time_score, 100),
            behavior_score = COALESCE(VALUES(behavior_score), student_summary_scores.behavior_score, 200)
        `;

    // --- สั่งรัน Query ---
    const [result]: any = await conn.query(sql, [values]);

    // ส่ง Response
    res.status(200).json({
      success: true,
      message: "บันทึกข้อมูลคะแนนเรียบร้อยแล้ว",
      affectedRows: result.affectedRows,
    });
  } catch (error: any) {
    console.error("Error saving scores:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการบันทึกข้อมูล",
      error: error.message,
    });
  }
};

// ==========================================
// 7. ดึงข้อมูลสถานะการส่งคะแนนตามรุ่น (Score Submissions)
// ==========================================
export const getScoreSubmissions = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const batchId = req.query.batch_id;

  if (!batchId) {
    res.status(400).json({ success: false, message: "กรุณาระบุ batch_id" });
    return;
  }

  try {
    const sql = `
      SELECT 
        sub.id AS subject_id, 
        sub.subject_name,
        sg.id AS group_id,
        sg.group_name,
        sg.credits,
        IFNULL(sss.is_submitted, 0) AS is_submitted,
        sss.submitted_at,
        sss.note,
        (
            SELECT COUNT(*) 
            FROM student_scores sc
            JOIN subject_batch_settings sbs ON sc.setting_id = sbs.id
            WHERE sbs.batch_id = sg.batch_id AND sbs.subject_id = sub.id
        ) > 0 AS has_scores_in_db,
        (
            SELECT MAX(sc.updated_at)
            FROM student_scores sc
            JOIN subject_batch_settings sbs ON sc.setting_id = sbs.id
            WHERE sbs.batch_id = sg.batch_id AND sbs.subject_id = sub.id
        ) AS last_score_date
      FROM subjects sub
      JOIN subject_groups sg ON sub.group_id = sg.id
      LEFT JOIN subject_score_submissions sss 
        ON sub.id = sss.subject_id AND sss.batch_id = ?
      WHERE sg.batch_id = ?
      ORDER BY sg.id ASC, sub.id ASC
    `;

    const [rows]: any = await conn.query(sql, [batchId, batchId]);

    // จัดเรียงตามกลุ่มวิชา (วิชาหลัก M -> วิชารอง MN -> วิชาประกอบ S -> ภาคปฏิบัติ P)
    const getGroupPrefixOrder = (name: string): number => {
      const upper = (name || '').trim().toUpperCase();
      if (upper.startsWith('MN') || upper.includes('รอง')) return 2;
      if (upper.startsWith('M') || upper.includes('หลัก')) return 1;
      if (upper.startsWith('S') || upper.includes('ประกอบ')) return 3;
      if (upper.startsWith('P') || upper.includes('ปฏิบัติ')) return 4;
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

    rows.sort((a: any, b: any) => {
      const groupComp = compareGroupNames(a.group_name || '', b.group_name || '');
      if (groupComp !== 0) return groupComp;
      return (a.subject_id || 0) - (b.subject_id || 0);
    });

    res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error("Error fetching score submissions:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการดึงข้อมูล" });
  }
};

// ==========================================
// 8. บันทึกสถานะการส่งคะแนน
// ==========================================
export const saveScoreSubmissions = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { batch_id, submissions } = req.body;

  if (!batch_id || !Array.isArray(submissions)) {
    res
      .status(400)
      .json({ success: false, message: "ข้อมูลที่ส่งมาไม่ถูกต้อง" });
    return;
  }

  const connection = await conn.getConnection();

  try {
    await connection.beginTransaction();

    const insertQuery = `
      INSERT INTO subject_score_submissions (batch_id, subject_id, is_submitted, submitted_at, note) 
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
        is_submitted = VALUES(is_submitted), 
        submitted_at = VALUES(submitted_at), 
        note = VALUES(note)
    `;

    for (const item of submissions) {
      await connection.execute(insertQuery, [
        batch_id,
        item.subject_id,
        item.is_submitted,
        item.submitted_at || null,
        item.note || null,
      ]);
    }

    await connection.commit();

    res.status(200).json({
      success: true,
      message: "บันทึกข้อมูลการตรวจสอบสำเร็จ",
    });
  } catch (error) {
    await connection.rollback();
    console.error("Error saving score submissions:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการบันทึกข้อมูล" });
  } finally {
    connection.release();
  }
};

// ==========================================
// 10. ระบบจัดลำดับผลการเรียน 1 ถึง N และ Tie-Breaking (คำนวณที่ Backend)
// ==========================================
export const getBatchRanking = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const batchId = req.query.batch_id || req.body?.batch_id;
    if (!batchId) {
      res.status(400).json({ success: false, message: "กรุณาระบุ batch_id" });
      return;
    }

    const mode = req.query.mode || req.body?.mode;
    if (mode === 'unit_selection') {
      return getUnitSelectionRanking(req, res);
    }

    // วิชาที่แอดมินเลือกสำหรับตัดสิน Tie-Break
    let selectedSubIds: number[] = [];
    let hasExplicitSubjects = false;

    if (req.body?.subject_ids !== undefined && Array.isArray(req.body.subject_ids)) {
      selectedSubIds = req.body.subject_ids.map(Number);
      hasExplicitSubjects = true;
    } else if (req.query?.subject_ids !== undefined) {
      const qStr = String(req.query.subject_ids).trim();
      if (qStr.length === 0) {
        selectedSubIds = [];
      } else {
        selectedSubIds = qStr.split(",").map(Number).filter((n) => !isNaN(n));
      }
      hasExplicitSubjects = true;
    }

    // 1. ดึงเกณฑ์การตัดเกรด
    let [criteria]: any = await conn.query(
      `SELECT grade_name, grade_point, min_percent FROM grading_criteria 
       WHERE batch_id = ? OR batch_id IS NULL ORDER BY min_percent DESC`,
      [batchId],
    );

    if (!criteria || criteria.length === 0) {
      criteria = [
        { grade_name: "A", grade_point: 4.0, min_percent: 91 },
        { grade_name: "B+", grade_point: 3.5, min_percent: 86 },
        { grade_name: "B", grade_point: 3.0, min_percent: 81 },
        { grade_name: "C+", grade_point: 2.5, min_percent: 76 },
        { grade_name: "C", grade_point: 2.0, min_percent: 70 },
        { grade_name: "D+", grade_point: 1.5, min_percent: 60 },
        { grade_name: "D", grade_point: 1.0, min_percent: 50 },
        { grade_name: "F", grade_point: 0.0, min_percent: 0 },
      ];
    }

    // 2. ดึงข้อมูลนักเรียนและคะแนนทุกวิชา
    const query = `
      SELECT 
        st.id AS student_id, st.student_code, st.rank_name, st.first_name, st.last_name, st.affiliation,
        sub.id AS subject_id, sub.subject_name,
        sub.group_id, 
        sg.group_name, 
        sg.credits AS credit, 
        sbs.max_score, 
        sub.is_su,
        sc.raw_score,
        sss.training_time_score,
        sss.exam_time_score,
        sss.behavior_score
      FROM students st
      JOIN subject_batch_settings sbs ON st.batch_id = sbs.batch_id
      JOIN subjects sub ON sbs.subject_id = sub.id
      JOIN subject_groups sg ON sub.group_id = sg.id 
      LEFT JOIN student_scores sc ON st.id = sc.student_id AND sbs.id = sc.setting_id 
      LEFT JOIN student_summary_scores sss ON st.id = sss.student_id AND st.batch_id = sss.batch_id
      WHERE st.batch_id = ?
      ORDER BY st.student_code ASC, sub.id ASC
    `;

    const [rows]: any = await conn.query(query, [batchId]);

    if (!rows || rows.length === 0) {
      res.json({
        success: true,
        data: [],
        tiedGroups: [],
        availableSubjects: [],
        summary: { total_students: 0, completed_students: 0, incomplete_students: 0 },
      });
      return;
    }

    // 3. รวบรวมวิชาทั้งหมด และคำนวณคะแนนนักเรียนแต่ละคน
    const groupsMap: Record<number, any> = {};
    const studentsMap: Record<number, any> = {};
    const masterSubjects: any[] = [];
    const masterSubjectIds = new Set<number>();

    rows.forEach((row: any) => {
      // กลุ่มวิชา
      if (!groupsMap[row.group_id]) {
        groupsMap[row.group_id] = {
          groupId: row.group_id,
          groupName: row.group_name || "",
          credit: Number(row.credit) || 0,
          subjects: [],
          group_max_score: 0,
          is_su: Boolean(row.is_su),
        };
      }
      const group = groupsMap[row.group_id];
      if (!row.is_su) group.is_su = false;

      // รายวิชา
      if (!masterSubjectIds.has(row.subject_id)) {
        masterSubjectIds.add(row.subject_id);
        const newSub = {
          id: row.subject_id,
          name: row.subject_name,
          max_score: Number(row.max_score) || 0,
          group_name: row.group_name || "",
          is_su: Boolean(row.is_su),
        };
        group.subjects.push(newSub);
        masterSubjects.push(newSub);
        group.group_max_score += newSub.max_score;
      }

      // นักเรียน
      if (!studentsMap[row.student_id]) {
        studentsMap[row.student_id] = {
          student_id: row.student_id,
          student_code: String(row.student_code || "").padStart(2, "0"),
          rank_name: row.rank_name || "",
          first_name: row.first_name || "",
          last_name: row.last_name || "",
          affiliation: row.affiliation || "",
          full_name: `${row.rank_name || ""} ${row.first_name || ""} ${row.last_name || ""}`.trim(),
          total_raw_score: 0,
          total_max_score: 0,
          percent: "0.00",
          gpa: "0.00",
          subject_scores: {},
          group_raw_scores: {},
          scored_subjects_count: 0,
          training_time_score: Number(row.training_time_score) || 0,
          exam_time_score: Number(row.exam_time_score) || 0,
          behavior_score: Number(row.behavior_score) || 0,
        };
      }

      const st = studentsMap[row.student_id];
      if (row.raw_score !== null && row.raw_score !== undefined) {
        const score = Number(row.raw_score);
        st.subject_scores[row.subject_id] = score;
        st.group_raw_scores[row.group_id] = (st.group_raw_scores[row.group_id] || 0) + score;
        st.total_raw_score += score;
        st.scored_subjects_count++;
      }
    });

    // หาก Client ไม่ได้ส่ง subject_ids มาเลย (เช่น Initial Batch Load) ให้เลือกเฉพาะวิชาหลัก (M) หรือวิชาที่มีเกรดเป็นค่าเริ่มต้น
    if (!hasExplicitSubjects) {
      const mainSubs = masterSubjects.filter((s) => {
        const g = (s.group_name || "").toUpperCase();
        return (g.startsWith("M") && !g.startsWith("MN")) || g.includes("หลัก");
      });
      if (mainSubs.length > 0) {
        selectedSubIds = mainSubs.map((s) => s.id);
      } else {
        selectedSubIds = masterSubjects.filter((s) => !s.is_su).map((s) => s.id);
      }
    }
    const selectedSubSet = new Set<number>(selectedSubIds);

    // 4. ตัดเกรด GPA และตรวจเช็คความสมบูรณ์ของหลักสูตร
    const gradeSubjectsCount = masterSubjects.filter(s => !s.is_su).length;

    const studentList = Object.values(studentsMap).map((student: any) => {
      let totalIndexForGPA = 0;
      let totalCreditForGPA = 0;

      Object.values(groupsMap).forEach((grp: any) => {
        const rawScore = student.group_raw_scores[grp.groupId];
        if (rawScore !== undefined) {
          if (!grp.is_su) {
            const percent = grp.group_max_score > 0 ? (rawScore / grp.group_max_score) * 100 : 0;
            let assignedGrade = criteria[criteria.length - 1];
            for (const c of criteria) {
              if (percent >= Number(c.min_percent)) {
                assignedGrade = c;
                break;
              }
            }
            const gradePoint = Math.min(4.0, Math.max(0, Number(assignedGrade.grade_point) || 0));
            const indexValue = grp.credit * gradePoint;
            totalIndexForGPA += indexValue;
            totalCreditForGPA += grp.credit;
          }
        }
      });

      const rawGpa = totalCreditForGPA > 0 ? totalIndexForGPA / totalCreditForGPA : 0;
      student.gpa = Math.min(4.0, Math.max(0, rawGpa)).toFixed(2);

      // คำนวณคะแนนตัดสิน Tie-Break ตามวิชาที่เลือก
      let tbScore = 0;
      let tbMaxScore = 0;
      let selectedScoredCount = 0;

      masterSubjects.forEach((sub: any) => {
        if (selectedSubSet.has(sub.id)) {
          tbMaxScore += sub.max_score;
          if (student.subject_scores[sub.id] !== undefined) {
            tbScore += Number(student.subject_scores[sub.id]);
            selectedScoredCount++;
          }
        }
      });

      student.tieBreakScore = tbScore;
      student.tieBreakMaxScore = tbMaxScore;
      student.scoredSubjectsCount = selectedScoredCount;

      // ตรวจสอบความสมบูรณ์: นักเรียนมีคะแนนครบทุกวิชาหรือไม่
      // หากมีคะแนนไม่ถึง 80% ของวิชาทั้งหมดในหลักสูตร ถือว่าคะแนนยังไม่สมบูรณ์
      student.is_completed = student.scored_subjects_count >= Math.max(1, gradeSubjectsCount - 2);
      student.completion_text = `${student.scored_subjects_count}/${gradeSubjectsCount}`;

      delete student.group_raw_scores;
      return student;
    });

    // 5. จัดเรียงลำดับ (Sorting Strategy):
    // - คนที่คะแนนครบ (is_completed = true) ได้รับการจัดอันดับ 1 ถึง N
    // - คนที่คะแนนไม่ครบ (เช่น มีแค่ 1 วิชา) ถูกผลักไปอยู่ท้ายตาราง ไม่ให้มาแย่งที่ 1
    studentList.sort((a: any, b: any) => {
      // 1. คนที่คะแนนครบมาก่อน
      if (a.is_completed !== b.is_completed) {
        return a.is_completed ? -1 : 1;
      }

      if (a.is_completed) {
        // 2. เรียงตาม GPA สูงสุด
        const gpaDiff = Number(b.gpa) - Number(a.gpa);
        if (Math.abs(gpaDiff) > 0.0001) return gpaDiff;

        // 3. ปลดล็อคด้วยคะแนนวิชาที่เลือก
        if (selectedSubSet.size > 0) {
          const tbDiff = b.tieBreakScore - a.tieBreakScore;
          if (Math.abs(tbDiff) > 0.001) return tbDiff;
        }

        return 0; // ห้ามใช้ student_code ตัดสิน
      } else {
        // คนไม่ครบ เรียงตามคะแนนรวม
        return b.total_raw_score - a.total_raw_score;
      }
    });

    // 6. กำหนดอันดับและตรวจจับกลุ่มซ้ำ (Tied Groups Detection)
    const GROUP_PALETTES = [
      { bg: '#fffbe6', border: '#fa8c16', text: '#d46b08', label: 'สีส้มทอง' },
      { bg: '#f9f0ff', border: '#9254de', text: '#531dab', label: 'สีม่วงพาสเทล' },
      { bg: '#e6fffb', border: '#13c2c2', text: '#006d75', label: 'สีฟ้าอมเขียวทีล' },
      { bg: '#fff0f6', border: '#f759ab', text: '#9e1068', label: 'สีชมพูโรส' },
      { bg: '#e6f7ff', border: '#1890ff', text: '#003a8c', label: 'สีน้ำเงินสกาย' },
      { bg: '#fcffe6', border: '#7cb305', text: '#389e0d', label: 'สีเขียวมะนาว' },
      { bg: '#fff2e8', border: '#ff4d4f', text: '#a8071a', label: 'สีแดงปะการัง' },
    ];

    const completedStudents = studentList.filter((s: any) => s.is_completed);
    const incompleteStudents = studentList.filter((s: any) => !s.is_completed);

    const gpaMap = new Map<string, any[]>();
    completedStudents.forEach((s: any) => {
      if (!gpaMap.has(s.gpa)) gpaMap.set(s.gpa, []);
      gpaMap.get(s.gpa)!.push(s);
    });

    const sortedGpas = Array.from(gpaMap.keys()).sort((a, b) => Number(b) - Number(a));
    const tiedGroupsList: any[] = [];
    let groupCounter = 0;

    sortedGpas.forEach((gpa) => {
      const cluster = gpaMap.get(gpa)!;
      if (cluster.length > 1) {
        groupCounter++;
        const palette = GROUP_PALETTES[(groupCounter - 1) % GROUP_PALETTES.length];
        const gId = groupCounter;

        cluster.forEach((s: any) => {
          s.isTiedGpa = true;
          s.tiedGroupId = gId;
          s.tiedGroupColor = palette.border;
          s.tiedGroupBg = palette.bg;
          s.tiedGroupText = palette.text;
          s.tiedGroupCount = cluster.length;
        });

        tiedGroupsList.push({
          groupId: gId,
          gpa: gpa,
          studentCount: cluster.length,
          color: palette,
          isResolved: false,
          minRank: 0,
          maxRank: 0,
          studentCodes: cluster.map((s: any) => s.student_code).join(', '),
        });
      }
    });

    // กำหนด Rank ให้คนที่คะแนนครบ
    completedStudents.forEach((s: any, idx: number) => {
      s.calculatedRank = idx + 1;
      s.manualRank = idx + 1;
      s.isTrulyTied = false;

      if (s.isTiedGpa) {
        const cluster = gpaMap.get(s.gpa)!;
        const sameScoreCount = cluster.filter(
          (other: any) => Math.abs(other.tieBreakScore - s.tieBreakScore) <= 0.001
        ).length;

        if (selectedSubSet.size === 0) {
          s.isTrulyTied = true;
          s.tieBreakReason = `⚠️ เกรดเท่ากัน (กรุณาติ๊กเลือกวิชาด้านบนเพื่อตัดสิน)`;
        } else if (sameScoreCount > 1) {
          s.isTrulyTied = true;
          s.tieBreakReason = `⚠️ คะแนนวิชาที่เลือกเท่ากัน (${s.tieBreakScore.toFixed(1)}) ติ๊กเลือกวิชาเพิ่มเพื่อตัดสิน`;
        } else {
          s.tieBreakReason = `เกรด ${s.gpa} (ชนะด้วยคะแนนวิชาที่เลือก: ${s.tieBreakScore.toFixed(1)} / ${s.tieBreakMaxScore})`;
        }
      } else {
        s.tieBreakReason = `เกรดสะสม ${s.gpa}`;
      }
    });

    // กำหนดสถานะให้คนที่ไม่ครบ (Incomplete)
    incompleteStudents.forEach((s: any) => {
      s.calculatedRank = null;
      s.manualRank = null;
      s.isTiedGpa = false;
      s.isTrulyTied = false;
      s.tieBreakReason = `⚠️ คะแนนยังไม่สมบูรณ์ (มีคะแนนเพียง ${s.scored_subjects_count}/${gradeSubjectsCount} วิชา - ไม่นำมาจัดอันดับ)`;
    });

    // อัปเดต minRank, maxRank และ isResolved สำหรับ tiedGroups
    tiedGroupsList.forEach((tg) => {
      const members = completedStudents.filter((s: any) => s.tiedGroupId === tg.groupId);
      if (members.length > 0) {
        tg.minRank = Math.min(...members.map((m: any) => m.manualRank));
        tg.maxRank = Math.max(...members.map((m: any) => m.manualRank));
        tg.studentCodes = members.map((m: any) => m.student_code).join(', ');
        tg.isResolved = !members.some((m: any) => m.isTrulyTied);
      }
    });

    const availableSubjectsList = masterSubjects.map((sub: any) => ({
      ...sub,
      selected: selectedSubSet.has(sub.id),
    }));

    res.json({
      success: true,
      data: studentList,
      tiedGroups: tiedGroupsList,
      availableSubjects: availableSubjectsList,
      summary: {
        batch_id: Number(batchId),
        total_students: studentList.length,
        completed_students: completedStudents.length,
        incomplete_students: incompleteStudents.length,
        total_subjects: masterSubjects.length,
        selected_subjects_count: selectedSubSet.size,
      },
    });
  } catch (error) {
    console.error("Error calculating batch ranking:", error);
    res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการคำนวณการจัดลำดับ" });
  }
};

/**
 * 🌟 คำนวณการจัดลำดับสำหรับการเลือกลงหน่วย (Unit Selection Ranking)
 * สูตรการคำนวณ:
 * 1. แต่ละกลุ่มวิชา/วิชา:
 *    - คะแนนดิบ (raw_score) = ผลรวมคะแนนดิบของวิชาในกลุ่ม (กรณีวิชาที่เมิร์จกัน)
 *    - คะแนนคูณหน่วยกิต (weighted_score) = คะแนนดิบ * หน่วยกิต
 * 2. คะแนนรวมทั้งหมด (total_weighted_score) = ผลรวมของคะแนนคูณหน่วยกิตทุกวิชา
 * 3. คะแนนความประพฤติ (behavior_score) ดึงมาจากตาราง student_summary_scores (ค่าเริ่มต้น 200)
 * 4. คิดเป็นร้อยละ 80 (academic_score_80) = (คะแนนรวมทั้งหมด / คะแนนเต็มรวมคูณหน่วยกิต) * 80
 * 5. คะแนนความประพฤติคิดเป็นร้อยละ 20 (behavior_score_20) = (คะแนนความประพฤติ / คะแนนเต็มความประพฤติ) * 20
 * 6. คะแนนรวมสุทธิ (final_score) = ร้อยละ 80 + ร้อยละ 20
 * 7. เรียงลำดับ (Rank 1 ถึง N) จากคะแนนรวมสุทธิ (final_score) จากมากไปน้อย
 * 8. การคำนวณทั้งหมดทำที่แบ็กเอนด์ แสดงทศนิยม 4 ตำแหน่ง
 */
export const getUnitSelectionRanking = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const batchId = req.query.batch_id || req.body?.batch_id;
    if (!batchId) {
      res.status(400).json({ success: false, message: "กรุณาระบุ batch_id" });
      return;
    }

    const query = `
      SELECT 
        st.id AS student_id, st.student_code, st.rank_name, st.first_name, st.last_name, st.affiliation,
        sub.id AS subject_id, sub.subject_name,
        sub.group_id, 
        sg.group_name, 
        sg.credits AS credit, 
        sbs.max_score, 
        sub.is_su,
        sc.raw_score,
        sss.training_time_score,
        sss.exam_time_score,
        sss.behavior_score
      FROM students st
      JOIN subject_batch_settings sbs ON st.batch_id = sbs.batch_id
      JOIN subjects sub ON sbs.subject_id = sub.id
      JOIN subject_groups sg ON sub.group_id = sg.id 
      LEFT JOIN student_scores sc ON st.id = sc.student_id AND sbs.id = sc.setting_id 
      LEFT JOIN student_summary_scores sss ON st.id = sss.student_id AND st.batch_id = sss.batch_id
      WHERE st.batch_id = ?
      ORDER BY st.student_code ASC, sub.group_id ASC, sub.id ASC
    `;

    const [rows]: any = await conn.query(query, [batchId]);

    if (!rows || rows.length === 0) {
      res.json({
        success: true,
        data: [],
        subjectGroups: [],
        summary: { total_students: 0 },
      });
      return;
    }

    // 1. จัดกลุ่มวิชา
    const groupsMap: Record<number, any> = {};
    const studentsMap: Record<number, any> = {};

    rows.forEach((row: any) => {
      // โครงสร้างกลุ่มวิชา
      if (!groupsMap[row.group_id]) {
        groupsMap[row.group_id] = {
          groupId: row.group_id,
          groupName: row.group_name || "",
          credit: Number(row.credit) || 0,
          subjects: [],
          group_max_score: 0,
          is_su: Boolean(row.is_su),
        };
      }
      const grp = groupsMap[row.group_id];
      if (!row.is_su) grp.is_su = false;

      const subExists = grp.subjects.find((s: any) => s.id === row.subject_id);
      if (!subExists) {
        grp.subjects.push({
          id: row.subject_id,
          name: row.subject_name,
          max_score: Number(row.max_score) || 0,
          is_su: Boolean(row.is_su),
        });
        grp.group_max_score += Number(row.max_score) || 0;
      }

      // ข้อมูลนักเรียน
      if (!studentsMap[row.student_id]) {
        studentsMap[row.student_id] = {
          student_id: row.student_id,
          student_code: String(row.student_code || "").padStart(2, "0"),
          rank_name: row.rank_name || "",
          first_name: row.first_name || "",
          last_name: row.last_name || "",
          affiliation: row.affiliation || "",
          full_name: `${row.rank_name || ""} ${row.first_name || ""} ${row.last_name || ""}`.trim(),
          behavior_score:
            row.behavior_score !== null && row.behavior_score !== undefined
              ? Number(row.behavior_score)
              : 200,
          subject_raw_scores: {},
          group_raw_scores: {},
        };
      }

      const st = studentsMap[row.student_id];
      if (row.raw_score !== null && row.raw_score !== undefined) {
        const score = Number(row.raw_score);
        st.subject_raw_scores[row.subject_id] = score;
        st.group_raw_scores[row.group_id] = (st.group_raw_scores[row.group_id] || 0) + score;
      }
    });

    const subjectGroups = Object.values(groupsMap).map((grp: any) => {
      const maxScore = Number(grp.group_max_score || 0);
      const credit = Number(grp.credit || 0);
      const maxWeighted = maxScore * credit;
      const isMerged = grp.subjects.length > 1;
      const subjectNames = grp.subjects.map((s: any) => s.name).join(" + ");
      const fullName = isMerged
        ? `${grp.groupName} ${subjectNames}`
        : `${grp.groupName} ${grp.subjects[0]?.name || ""}`.trim();

      return {
        ...grp,
        group_max_score: maxScore,
        group_max_score_formatted: maxScore.toFixed(4),
        group_max_weighted: maxWeighted,
        group_max_weighted_formatted: maxWeighted.toFixed(4),
        isMerged: isMerged,
        subjectNames: subjectNames,
        fullName: fullName,
        displayName: `${fullName} (${credit} นก.)`,
        subjectsCount: grp.subjects.length,
      };
    });

    // เรียงวิชาจากวิชาแรกไปวิชาท้ายสุด (เช่น M01, M02, ..., M21) ตามลำดับธรรมชาติ
    subjectGroups.sort((a: any, b: any) => {
      return a.groupName.localeCompare(b.groupName, undefined, { numeric: true, sensitivity: 'base' });
    });

    // คำนวณคะแนนเต็มรวมคูณหน่วยกิต (total_max_weighted)
    let totalMaxWeighted = 0;
    let totalCredit = 0;

    subjectGroups.forEach((grp: any) => {
      if (grp.credit > 0 && !grp.is_su) {
        totalMaxWeighted += grp.group_max_weighted;
        totalCredit += grp.credit;
      }
    });

    // ตรวจสอบคะแนนเต็มความประพฤติ (ปกติ 200)
    let maxBehaviorScore = 200;
    const allStudentsList = Object.values(studentsMap);
    const hasScoreOver100 = allStudentsList.some((s: any) => s.behavior_score > 100);
    if (!hasScoreOver100 && allStudentsList.length > 0) {
      maxBehaviorScore = 100;
    }

    // 2. คำนวณคะแนนของนักเรียนแต่ละคนตามสูตร
    const processedStudents = allStudentsList.map((st: any) => {
      let totalWeightedScore = 0;
      const groupScores: Record<number, any> = {};

      subjectGroups.forEach((grp: any) => {
        const rawScore = Number(st.group_raw_scores[grp.groupId]) || 0;
        const credit = grp.credit;
        const weightedScore = rawScore * credit;
        const maxScore = Number(grp.group_max_score) || 0;
        const maxWeightedScore = Number(grp.group_max_weighted) || (maxScore * credit);

        if (credit > 0 && !grp.is_su) {
          totalWeightedScore += weightedScore;
        }

        groupScores[grp.groupId] = {
          groupId: grp.groupId,
          groupName: grp.groupName,
          max_score: maxScore,
          max_score_formatted: maxScore.toFixed(4),
          raw_score: rawScore,
          raw_score_formatted: rawScore.toFixed(4),
          credit: credit,
          credit_formatted: Number(credit).toFixed(2),
          weighted_score: weightedScore,
          weighted_score_formatted: weightedScore.toFixed(4),
          max_weighted_score: maxWeightedScore,
          max_weighted_score_formatted: maxWeightedScore.toFixed(4),
        };
      });

      const behaviorScore = Number(st.behavior_score) || 0;

      // ช่อง 80% ของคะแนนรวม: เอาคะแนนรวมทั้งหมดคูณ 0.80 โดยตรง
      const academicScore80 = totalWeightedScore * 0.8;

      // ช่อง 20% ของคะแนนประพฤติ: เอาคะแนนความประพฤติคูณ 0.20 โดยตรง (เช่น 200 * 0.20 = 40.0000, 190 * 0.20 = 38.0000)
      const behaviorScore20 = behaviorScore * 0.2;

      // คะแนนรวมสุทธิ: (คะแนนรวมทั้งหมด * 0.80) + (คะแนนประพฤติ * 0.20)
      const finalScore = academicScore80 + behaviorScore20;

      return {
        student_id: st.student_id,
        student_code: st.student_code,
        rank_name: st.rank_name,
        first_name: st.first_name,
        last_name: st.last_name,
        full_name: st.full_name,
        affiliation: st.affiliation,
        group_scores: groupScores,
        total_weighted_score: totalWeightedScore,
        total_weighted_score_formatted: totalWeightedScore.toFixed(4),
        behavior_score: behaviorScore,
        behavior_score_formatted: behaviorScore.toFixed(4),
        academic_score_80: academicScore80,
        academic_score_80_formatted: academicScore80.toFixed(4),
        behavior_score_20: behaviorScore20,
        behavior_score_20_formatted: behaviorScore20.toFixed(4),
        final_score: finalScore,
        final_score_formatted: finalScore.toFixed(4),
        total_max_weighted: totalMaxWeighted,
        max_behavior_score: maxBehaviorScore,
      };
    });

    // 3. เรียงลำดับจากคะแนนรวมสุทธิ (final_score) มากไปหาน้อย
    processedStudents.sort((a: any, b: any) => {
      const diff = b.final_score - a.final_score;
      if (Math.abs(diff) > 0.000001) return diff;
      const wDiff = b.total_weighted_score - a.total_weighted_score;
      if (Math.abs(wDiff) > 0.000001) return wDiff;
      return b.behavior_score - a.behavior_score;
    });

    // กำหนด Rank 1 ถึง N
    processedStudents.forEach((st: any, idx: number) => {
      st.rank = idx + 1;
    });

    const maxAcad80 = totalMaxWeighted * 0.8;
    const maxBeh20 = maxBehaviorScore * 0.2;
    const maxFinal = maxAcad80 + maxBeh20;

    res.json({
      success: true,
      data: processedStudents,
      subjectGroups: subjectGroups,
      summary: {
        batch_id: Number(batchId),
        total_students: processedStudents.length,
        total_credit: totalCredit,
        total_max_weighted: totalMaxWeighted,
        total_max_weighted_formatted: totalMaxWeighted.toFixed(4),
        max_academic_80: maxAcad80,
        max_academic_80_formatted: maxAcad80.toFixed(4),
        max_behavior_score: maxBehaviorScore,
        max_behavior_score_formatted: maxBehaviorScore.toFixed(4),
        max_behavior_20: maxBeh20,
        max_behavior_20_formatted: maxBeh20.toFixed(4),
        max_final_score: maxFinal,
        max_final_score_formatted: maxFinal.toFixed(4),
      },
    });
  } catch (error) {
    console.error("Error calculating unit selection ranking:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการคำนวณการจัดลำดับสำหรับการเลือกลงหน่วย",
    });
  }
};


