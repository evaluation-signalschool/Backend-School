import { Request, Response } from "express";
import { RowDataPacket } from "mysql2";
import { conn } from "../dbconn";
import { AuthRequest } from "../middleware/auth.middleware";
import { logAdminActivity } from "../utils/activityLogger";

// เกณฑ์การตัดเกรดมาตรฐาน
const GRADING_CRITERIA = [
  { grade_name: "A", grade_point: 4.0, min_percent: 91 },
  { grade_name: "B+", grade_point: 3.5, min_percent: 86 },
  { grade_name: "B", grade_point: 3.0, min_percent: 81 },
  { grade_name: "C+", grade_point: 2.5, min_percent: 71 },
  { grade_name: "C", grade_point: 2.0, min_percent: 60 },
  { grade_name: "D+", grade_point: 1.5, min_percent: 55 },
  { grade_name: "D", grade_point: 1.0, min_percent: 50 },
  { grade_name: "F", grade_point: 0.0, min_percent: 0 },
];

// ลำดับรายวิชามาตรฐานตามโครงสร้างหลักสูตร (Canonical Subject Order)
export const CANONICAL_SUBJECT_ORDER: { [name: string]: number } = {
  // M01
  การส่งกำลังและซ่อมบำรุงสายสื่อสาร: 1,
  การจัดหน่วยทหารสื่อสาร: 2,
  // M02
  วงจรไฟฟ้า: 3,
  // M03
  การสื่อสารทางยุทธวิธี: 4,
  // M04
  การสื่อสารประเภทวิทยุและการสงครามอิเล็กทรอนิกส์: 5,
  // M05
  การสื่อสารประเภทสาย: 6,
  // M06
  ภาษาอังกฤษทางทหาร: 7,
  การอำนวยการทางการสื่อสาร: 8,
  // M07
  การพัฒนาทักษะดิจิทัลที่จำเป็นระดับต้น: 9,
  // MN01 / MN08
  การรักษาความปลอดภัย: 10,
  การป้องกันและปราบปรามการก่อความไม่สงบ: 11,
  ระเบียบงานสารบรรณ: 12,
  // MN02 / MN09
  แผนที่เข็มทิศ: 13,
  // S01 / S10
  ผู้นำหน่วย: 14,
  วิชาตามนโยบายที่กองทัพบกกำหนด: 15,
  // P01 / P11
  ฝึกทบทวนการใช้เครื่องมือสื่อสาร: 16,
};

// ลำดับประเภทกลุ่มวิชา (M -> MN -> S -> P)
export const getGroupPrefixOrder = (name: string): number => {
  const upper = (name || "").trim().toUpperCase();
  if (upper.startsWith("MN") || upper.includes("รอง")) return 2;
  if (upper.startsWith("M") || upper.includes("หลัก")) return 1;
  if (upper.startsWith("S") || upper.includes("ประกอบ")) return 3;
  if (upper.startsWith("P") || upper.includes("ปฏิบัติ")) return 4;
  return 5;
};

// เปรียบเทียบชื่อกลุ่มวิชาเพื่อเรียงลำดับ (M01..M07, MN08..MN09, S10, P11)
export const compareGroupNames = (aName: string, bName: string): number => {
  const a = (aName || "").trim();
  const b = (bName || "").trim();
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
  return a.localeCompare(b, "th", { numeric: true, sensitivity: "base" });
};

// เปรียบเทียบรายวิชาภายในกลุ่มเดียวกัน
export const compareSubjectsInGroup = (a: any, b: any): number => {
  const aName = (a.name || a.subject_name || "").trim();
  const bName = (b.name || b.subject_name || "").trim();
  const orderA = CANONICAL_SUBJECT_ORDER[aName] ?? 999;
  const orderB = CANONICAL_SUBJECT_ORDER[bName] ?? 999;
  if (orderA !== orderB) return orderA - orderB;
  return (a.id || a.subject_id || 0) - (b.id || b.subject_id || 0);
};

// 1. อัปเดตคะแนนเต็มรายวิชา
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

// 2. ดึงข้อมูลคะแนนทั้งหมด (ของนักเรียน 1 คน)
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

    // เช็คสิทธิ์ว่า user ใน Token มีสิทธิ์เข้าถึงข้อมูลของ studentId หรือไม่
    const currentUser = req.user;
    if (currentUser) {
      const isOwner = String(currentUser.student_id) === String(studentId);
      const isAdmin =
        currentUser.role === "admin" || currentUser.role === "superadmin";
      if (!isOwner && !isAdmin) {
        console.warn(
          `[Security Alert] IDOR attempt detected! User: ${currentUser.student_id || currentUser.email} tried to access scores of Student ID: ${studentId} from IP: ${req.ip}`,
        );
        res.status(403).json({
          error: "คุณไม่มีสิทธิ์เข้าถึงข้อมูลคะแนนของนักเรียนท่านอื่น",
        });
        return;
      }
    }

    // ดึงคะแนนรายวิชาและสถานะการประเมิน
    const detailQuery = `
      SELECT 
        sg.group_name, 
        sub.id AS subject_id,  
        sub.subject_name, 
        sbs.max_score, 
        COALESCE(ss.raw_score, 0) AS raw_score,
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

    const [subjectDetails] = await conn.execute<RowDataPacket[]>(detailQuery, [
      studentId,
      studentId,
      batchId,
    ]);

    // แปลงผลลัพธ์ให้เป็น boolean และเรียงลำดับตามโครงสร้างหลักสูตรที่แท้จริง
    const formattedSubjectDetails = subjectDetails.map((row) => ({
      ...row,
      is_evaluated: !!row.is_evaluated,
    }));

    formattedSubjectDetails.sort((a: any, b: any) => {
      const gComp = compareGroupNames(a.group_name || "", b.group_name || "");
      if (gComp !== 0) return gComp;
      return compareSubjectsInGroup(a, b);
    });

    // ดึงผลรวมคะแนนรายกลุ่มวิชา
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
    const [groupSummaries]: any = await conn.execute<RowDataPacket[]>(
      summaryQuery,
      [studentId, batchId],
    );

    groupSummaries.sort((a: any, b: any) => {
      return compareGroupNames(a.group_name || "", b.group_name || "");
    });

    // ส่งผลลัพธ์กลับ
    res.status(200).json({
      message: "ดึงข้อมูลสำเร็จ",
      student_id: studentId,
      batch_id: batchId,
      subject_details: formattedSubjectDetails,
      group_summaries: groupSummaries,
    });
  } catch (error) {
    console.error("Error fetching student scores:", error);
    res.status(500).json({ error: "เกิดข้อผิดพลาดในการดึงข้อมูล" });
  }
};

// 3. แอดมินดึงรายชื่อนักเรียนและคะแนนดิบ 1 วิชา (ทั้งห้อง)
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

// 4. แอดมินบันทึกคะแนนทั้งห้อง
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

// 5. ตัดเกรดรายกลุ่มวิชา
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
    const criteria = GRADING_CRITERIA;

    // ดึงข้อมูลวิชาย่อยเพื่อนำไปสร้างคอลัมน์
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
    // รวมรายวิชาเพื่อส่งไปสร้างหัวตาราง
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

    // ดึงคะแนนดิบทั้งหมดแยกตามรายวิชา
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

    // จัดกลุ่มคะแนนตามนักเรียนแต่ละคน
    const studentMap = new Map();

    rawScores.forEach((row: any) => {
      // ถ้านักเรียนยังไม่อยู่ใน map ให้สร้างใหม่
      if (!studentMap.has(row.student_id)) {
        studentMap.set(row.student_id, {
          student_id: row.student_id,
          student_code: row.student_code,
          full_name:
            `${row.rank_name || ""} ${row.first_name} ${row.last_name}`.trim(),
          total_raw_score: 0,
          subject_scores: {}, // คะแนนแยกแต่ละวิชา
        });
      }

      const st = studentMap.get(row.student_id);
      const score = Number(row.raw_score) || 0;

      st.subject_scores[row.subject_id] = score;
      st.total_raw_score += score;
    });

    // ตัดเกรดและคิดค่า Index
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

      const safeGradePoint = Math.min(
        4.0,
        Math.max(0, Number(assignedGrade.grade_point) || 0),
      );
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
        subject_scores: st.subject_scores, // คะแนนแยกแต่ละวิชา
      };
    });

    // ส่งข้อมูลกลับไปที่หน้าเว็บ
    res.status(200).json({
      success: true,
      summary: {
        group_name: actualGroupName,
        total_credit: totalGroupCredit,
        total_max_score: totalGroupMaxScore,
        subjects: subjectColumns,
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

// 6. ดึงคะแนนรวม ตัดเกรด และคำนวณ GPA ทั้งรุ่น
export const getscore = async (req: Request, res: Response): Promise<void> => {
  try {
    const batchId = req.query.batch_id;
    if (!batchId) {
      res.status(400).json({ error: "กรุณาระบุ batch_id" });
      return;
    }

    const criteria = GRADING_CRITERIA;

    // ดึงคะแนนรายวิชาและคะแนนพิเศษ (เวลาฝึก เวลาสอบ ความประพฤติ)
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

    if (rows.length === 0) {
      res.json({ success: true, summary: {}, data: [] });
      return;
    }

    // จัดกลุ่มวิชา
    const groupsMap: any = {};
    const studentsMap: any = {};
    let totalMaxScoreAll = 0;
    let totalCreditAll = 0;

    rows.forEach((row: any) => {
      // จัดการกลุ่มวิชา
      if (!groupsMap[row.group_id]) {
        groupsMap[row.group_id] = {
          groupId: row.group_id,
          groupName: row.group_name || "",
          groupCode: row.group_name || "",
          credit: Number(row.credit) || 0,
          subjects: [],
          group_max_score: 0,
          is_su: Boolean(row.is_su),
        };
      }

      const group = groupsMap[row.group_id];

      // ถ้ามีวิชาที่ไม่ใช่ SU กลุ่มนี้จะไม่ใช่ SU
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
        group.group_max_score += newSubject.max_score;
        totalMaxScoreAll += newSubject.max_score;
      }

      // จัดการข้อมูลนักเรียนและคะแนนพิเศษ
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

    // เรียงกลุ่มวิชาตามลำดับที่แท้จริงของโครงสร้างหลักสูตร (M01..M07, MN08..MN09, S10, P11)
    subjectGroups.sort((a: any, b: any) => {
      return compareGroupNames(
        a.groupCode || a.groupName,
        b.groupCode || b.groupName,
      );
    });

    // เรียงวิชาภายในแต่ละกลุ่ม และสร้าง masterSubjects ที่เรียงตามลำดับวิชาที่แท้จริง
    const masterSubjects: any[] = [];
    subjectGroups.forEach((grp: any) => {
      grp.subjects.sort(compareSubjectsInGroup);
      grp.subjects.forEach((sub: any) => {
        masterSubjects.push(sub);
      });
    });

    totalCreditAll = 0;
    subjectGroups.forEach((grp: any) => {
      if (!grp.is_su) {
        totalCreditAll += grp.credit;
      }
    });

    // ตัดเกรดและคิด GPA
    const data = Object.values(studentsMap).map((student: any) => {
      student.total_raw_score = Number(
        Number(student.total_raw_score || 0).toFixed(4),
      );
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

            const gradePoint = Math.min(
              4.0,
              Math.max(0, Number(assignedGrade.grade_point) || 0),
            );
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
        totalCreditForGPA > 0 ? totalIndexForGPA / totalCreditForGPA : 0;
      student.gpa = Math.min(4.0, Math.max(0, rawGpa)).toFixed(2);
      delete student.group_raw_scores;
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
// 7. ดึงข้อมูลคะแนนพิเศษทั้งรุ่น (เวลาฝึกอบรม, เวลาสอบ, ความประพฤติ)
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

// 8. บันทึกข้อมูลคะแนนพิเศษทั้งรุ่น
export const saveBatchScores = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { batch_id, scores } = req.body;

    // เช็คความถูกต้องของข้อมูล
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

    // ตรวจสอบว่าเป็นการอัปเดตเปอร์เซ็นต์เวลา หรือคะแนนความประพฤติ
    const isUpdatingTimeScores = scores.some(
      (s: any) => "training_time_score" in s || "exam_time_score" in s,
    );
    const isUpdatingBehaviorScores = scores.some(
      (s: any) => "behavior_score" in s,
    );

    // ตรวจสอบความถูกต้องของเปอร์เซ็นต์เวลา (ห้ามค่าว่าง, ห้ามเกิน 100%, ห้ามติดลบ)
    if (isUpdatingTimeScores) {
      for (const student of scores) {
        const train = student.training_time_score;
        const exam = student.exam_time_score;

        // 1. ตรวจสอบค่าว่าง
        if (
          train === undefined ||
          train === null ||
          String(train).trim() === "" ||
          exam === undefined ||
          exam === null ||
          String(exam).trim() === ""
        ) {
          res.status(400).json({
            success: false,
            message: "กรุณากรอกเปอร์เซ็นต์เวลาให้ครบถ้วน",
          });
          return;
        }

        const numTrain = Number(train);
        const numExam = Number(exam);

        // 2. ตรวจสอบเปอร์เซ็นต์เกิน 100%
        if (numTrain > 100 || numExam > 100) {
          res.status(400).json({
            success: false,
            message: "เปอร์เซ็นต์เวลาต้องไม่เกิน 100%",
          });
          return;
        }

        // 3. ตรวจสอบค่าติดลบ หรือไม่ใช่ตัวเลข
        if (isNaN(numTrain) || isNaN(numExam) || numTrain < 0 || numExam < 0) {
          res.status(400).json({
            success: false,
            message: "รูปแบบตัวเลขไม่ถูกต้อง",
          });
          return;
        }
      }
    }

    // 4. ตรวจสอบคะแนนความประพฤติ (ถ้ามีส่งมา)
    if (isUpdatingBehaviorScores) {
      for (const student of scores) {
        if (
          student.behavior_score !== undefined &&
          student.behavior_score !== null &&
          String(student.behavior_score).trim() !== ""
        ) {
          const numBehav = Number(student.behavior_score);
          if (isNaN(numBehav) || numBehav < 0 || numBehav > 200) {
            res.status(400).json({
              success: false,
              message: "คะแนนความประพฤติต้องอยู่ระหว่าง 0 ถึง 200 คะแนน",
            });
            return;
          }
        }
      }
    }

    // เตรียมข้อมูลสำหรับบันทึก
    const values = scores.map((student: any) => {
      const trainingScore =
        student.training_time_score !== undefined &&
        student.training_time_score !== null &&
        student.training_time_score !== ""
          ? Number(student.training_time_score)
          : null;
      const examScore =
        student.exam_time_score !== undefined &&
        student.exam_time_score !== null &&
        student.exam_time_score !== ""
          ? Number(student.exam_time_score)
          : null;
      const behaviorScore =
        student.behavior_score !== undefined &&
        student.behavior_score !== null &&
        student.behavior_score !== ""
          ? Number(student.behavior_score)
          : null;

      return [
        batch_id,
        student.student_id,
        trainingScore,
        examScore,
        behaviorScore,
      ];
    });

    // บันทึกหรืออัปเดตข้อมูลคะแนนลงตาราง
    const sql = `
            INSERT INTO student_summary_scores 
            (batch_id, student_id, training_time_score, exam_time_score, behavior_score)
            VALUES ?
            ON DUPLICATE KEY UPDATE 
            training_time_score = COALESCE(VALUES(training_time_score), student_summary_scores.training_time_score, 100),
            exam_time_score = COALESCE(VALUES(exam_time_score), student_summary_scores.exam_time_score, 100),
            behavior_score = COALESCE(VALUES(behavior_score), student_summary_scores.behavior_score, 200)
        `;

    const [result]: any = await conn.query(sql, [values]);

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

// 9. ดึงข้อมูลสถานะการส่งคะแนนตามรุ่น
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

    // เรียงตามกลุ่มวิชาและลำดับรายวิชา
    rows.sort((a: any, b: any) => {
      const groupComp = compareGroupNames(
        a.group_name || "",
        b.group_name || "",
      );
      if (groupComp !== 0) return groupComp;
      return compareSubjectsInGroup(a, b);
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

// 10. บันทึกสถานะการส่งคะแนน
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

// 11. จัดลำดับผลการเรียนและแก้คะแนนเท่ากัน (Tie-Break)
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
    if (mode === "unit_selection") {
      return getUnitSelectionRanking(req, res);
    }

    // วิชาที่เลือกมาตัดสินกรณีคะแนนเท่ากัน
    let selectedSubIds: number[] = [];
    let hasExplicitSubjects = false;

    if (
      req.body?.subject_ids !== undefined &&
      Array.isArray(req.body.subject_ids)
    ) {
      selectedSubIds = req.body.subject_ids.map(Number);
      hasExplicitSubjects = true;
    } else if (req.query?.subject_ids !== undefined) {
      const qStr = String(req.query.subject_ids).trim();
      if (qStr.length === 0) {
        selectedSubIds = [];
      } else {
        selectedSubIds = qStr
          .split(",")
          .map(Number)
          .filter((n) => !isNaN(n));
      }
      hasExplicitSubjects = true;
    }

    const criteria = GRADING_CRITERIA;

    // ดึงข้อมูลนักเรียนและคะแนนทุกวิชา
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
        summary: {
          total_students: 0,
          completed_students: 0,
          incomplete_students: 0,
        },
      });
      return;
    }

    // รวบรวมวิชาและคำนวณคะแนนนักเรียนแต่ละคน
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
          full_name:
            `${row.rank_name || ""} ${row.first_name || ""} ${row.last_name || ""}`.trim(),
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
        st.group_raw_scores[row.group_id] =
          (st.group_raw_scores[row.group_id] || 0) + score;
        st.total_raw_score += score;
        st.scored_subjects_count++;
      }
    });

    // ถ้าไม่ได้ระบุวิชามา ให้เริ่มต้นเป็นค่าว่าง (ผู้ใช้เลือกวิชาตัดสินเองตามต้องการ)
    if (!hasExplicitSubjects) {
      selectedSubIds = [];
    }
    const selectedSubSet = new Set<number>(selectedSubIds);

    // ตัดเกรด คิด GPA และเช็คว่าคะแนนครบไหม
    const gradeSubjectsCount = masterSubjects.filter((s) => !s.is_su).length;

    const studentList = Object.values(studentsMap).map((student: any) => {
      let totalIndexForGPA = 0;
      let totalCreditForGPA = 0;

      Object.values(groupsMap).forEach((grp: any) => {
        const rawScore = student.group_raw_scores[grp.groupId];
        if (rawScore !== undefined) {
          if (!grp.is_su) {
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
            const gradePoint = Math.min(
              4.0,
              Math.max(0, Number(assignedGrade.grade_point) || 0),
            );
            const indexValue = grp.credit * gradePoint;
            totalIndexForGPA += indexValue;
            totalCreditForGPA += grp.credit;
          }
        }
      });

      const rawGpa =
        totalCreditForGPA > 0 ? totalIndexForGPA / totalCreditForGPA : 0;
      student.gpa = Math.min(4.0, Math.max(0, rawGpa)).toFixed(2);

      // คิดคะแนนตัดสินจากวิชาที่เลือก
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

      // เช็คว่ามีคะแนนครบทุกวิชาไหม
      student.is_completed =
        student.scored_subjects_count >= Math.max(1, gradeSubjectsCount - 2);
      student.completion_text = `${student.scored_subjects_count}/${gradeSubjectsCount}`;

      delete student.group_raw_scores;
      return student;
    });

    // จัดลำดับ: คนที่คะแนนครบมาก่อน เรียงตาม GPA และวิชาตัดสิน
    studentList.sort((a: any, b: any) => {
      // คนที่คะแนนครบมาก่อน
      if (a.is_completed !== b.is_completed) {
        return a.is_completed ? -1 : 1;
      }

      if (a.is_completed) {
        // เรียงตาม GPA สูงสุด
        const gpaDiff = Number(b.gpa) - Number(a.gpa);
        if (Math.abs(gpaDiff) > 0.0001) return gpaDiff;

        // ถ้าเกรดเท่ากัน ใช้คะแนนวิชาที่เลือกมาตัดสิน
        if (selectedSubSet.size > 0) {
          const tbDiff = b.tieBreakScore - a.tieBreakScore;
          if (Math.abs(tbDiff) > 0.001) return tbDiff;
        }

        return 0;
      } else {
        // คนที่คะแนนไม่ครบ เรียงตามคะแนนรวม
        return b.total_raw_score - a.total_raw_score;
      }
    });

    // กำหนดอันดับและหาคนที่คะแนนเท่ากัน
    const GROUP_PALETTES = [
      { bg: "#fffbe6", border: "#fa8c16", text: "#d46b08", label: "สีส้มทอง" },
      {
        bg: "#f9f0ff",
        border: "#9254de",
        text: "#531dab",
        label: "สีม่วงพาสเทล",
      },
      {
        bg: "#e6fffb",
        border: "#13c2c2",
        text: "#006d75",
        label: "สีฟ้าอมเขียวทีล",
      },
      { bg: "#fff0f6", border: "#f759ab", text: "#9e1068", label: "สีชมพูโรส" },
      {
        bg: "#e6f7ff",
        border: "#1890ff",
        text: "#003a8c",
        label: "สีน้ำเงินสกาย",
      },
      {
        bg: "#fcffe6",
        border: "#7cb305",
        text: "#389e0d",
        label: "สีเขียวมะนาว",
      },
      {
        bg: "#fff2e8",
        border: "#ff4d4f",
        text: "#a8071a",
        label: "สีแดงปะการัง",
      },
    ];

    const completedStudents = studentList.filter((s: any) => s.is_completed);
    const incompleteStudents = studentList.filter((s: any) => !s.is_completed);

    const gpaMap = new Map<string, any[]>();
    completedStudents.forEach((s: any) => {
      if (!gpaMap.has(s.gpa)) gpaMap.set(s.gpa, []);
      gpaMap.get(s.gpa)!.push(s);
    });

    const sortedGpas = Array.from(gpaMap.keys()).sort(
      (a, b) => Number(b) - Number(a),
    );
    // จัดสรรอันดับตามเกณฑ์ใหม่:
    // 1. เฉพาะอันดับ 1, 2, 3 เท่านั้นที่จะใช้คะแนนวิชาตัดสิน (tieBreakScore) เพื่อหาผู้ครองโล่รางวัลเกียรตินิยม (กรอบทอง) อย่างเด็ดขาด
    //    - หาที่ 1: หาก GPA สูงสุดซ้ำกัน ให้ใช้วิชาตัดสินหาที่ 1 (คนที่เหลือได้อันดับถัดไป)
    //    - หาที่ 2: หากที่ 1 ไม่ซ้ำ แต่ที่ 2 ซ้ำ ให้ใช้วิชาตัดสินหาที่ 2 (คนที่เหลือได้อันดับถัดไป)
    //    - หาที่ 3: หากที่ 2 ไม่ซ้ำ แต่ที่ 3 ซ้ำ ให้ใช้วิชาตัดสินหาที่ 3 (คนที่เหลือได้อันดับ 4)
    // 2. ตั้งแต่อันดับ 4 เป็นต้นไป: หากเกรดซ้ำกัน จะได้ลำดับที่เดียวกัน (Dense Ranking) และเกรดถัดไปได้ลำดับถัดไป +1
    let currentTargetRank = 1;
    let nextRankNumber = 1;

    for (const gpa of sortedGpas) {
      const cluster = gpaMap.get(gpa)!;

      if (currentTargetRank <= 3) {
        // กลุ่มนี้เข้าร่วมชิงอันดับ 1, 2, หรือ 3 (โล่รางวัลเกียรตินิยม)
        cluster.sort((a: any, b: any) => {
          const tbDiff = b.tieBreakScore - a.tieBreakScore;
          if (Math.abs(tbDiff) > 0.001) return tbDiff;
          const rawDiff = b.total_raw_score - a.total_raw_score;
          if (Math.abs(rawDiff) > 0.001) return rawDiff;
          const codeA = parseInt(a.student_code, 10);
          const codeB = parseInt(b.student_code, 10);
          if (!isNaN(codeA) && !isNaN(codeB)) return codeA - codeB;
          return a.student_code.localeCompare(b.student_code);
        });

        const slotsAvailable = 4 - currentTargetRank;
        const takeCount = Math.min(cluster.length, slotsAvailable);

        for (let i = 0; i < takeCount; i++) {
          const s = cluster[i];
          s.calculatedRank = currentTargetRank;
          s.manualRank = currentTargetRank;
          s.isTrulyTied = false;

          if (cluster.length > 1) {
            s.isTiedGpa = true;
            const sameTbCount = cluster.filter(
              (other: any) =>
                Math.abs(other.tieBreakScore - s.tieBreakScore) <= 0.001,
            ).length;

            if (selectedSubSet.size === 0) {
              s.isTrulyTied = true;
              s.tieBreakReason = `เกรด ${s.gpa} เท่ากัน (แย่งชิงอันดับที่ ${s.calculatedRank} - กรุณาเลือกวิชาด้านบนเพื่อตัดสิน)`;
            } else if (sameTbCount > 1) {
              s.isTrulyTied = true;
              s.tieBreakReason = `คะแนนวิชาที่เลือกเท่ากัน (${s.tieBreakScore.toFixed(1)}) แย่งชิงอันดับที่ ${s.calculatedRank} เลือกวิชาเพิ่มเพื่อตัดสิน`;
            } else {
              s.tieBreakReason = `เกรด ${s.gpa} (ชนะด้วยคะแนนวิชาที่เลือก: ${s.tieBreakScore.toFixed(1)} / ${s.tieBreakMaxScore})`;
            }
          } else {
            s.isTiedGpa = false;
            s.tieBreakReason = `เกรดสะสม ${s.gpa} (อันดับที่ ${s.calculatedRank} เดี่ยว)`;
          }

          currentTargetRank++;
        }

        // กรณีคนในกลุ่มที่เหลือหลุดจาก Top 3
        if (cluster.length > takeCount) {
          const rankForRest = 4;
          for (let i = takeCount; i < cluster.length; i++) {
            const s = cluster[i];
            s.calculatedRank = rankForRest;
            s.manualRank = rankForRest;
            s.isTiedGpa = true;
            s.isTrulyTied = false;
            s.tieBreakReason = `เกรดสะสม ${s.gpa} เท่ากัน ${cluster.length} คน (ได้ลำดับที่ ${rankForRest} ร่วมกัน)`;
          }
          nextRankNumber = rankForRest + 1;
        } else {
          nextRankNumber = currentTargetRank;
        }
      } else {
        // ลำดับอื่นๆ ตั้งแต่อันดับ 4 เป็นต้นไป: ถ้าเกรดซ้ำกัน ให้ได้ลำดับที่เดียวกัน
        const assignedRank = nextRankNumber;
        cluster.sort((a: any, b: any) => {
          const codeA = parseInt(a.student_code, 10);
          const codeB = parseInt(b.student_code, 10);
          if (!isNaN(codeA) && !isNaN(codeB)) return codeA - codeB;
          return a.student_code.localeCompare(b.student_code);
        });

        cluster.forEach((s: any) => {
          s.calculatedRank = assignedRank;
          s.manualRank = assignedRank;
          s.isTrulyTied = false;
          if (cluster.length > 1) {
            s.isTiedGpa = true;
            s.tieBreakReason = `เกรดสะสม ${s.gpa} เท่ากัน ${cluster.length} คน (ได้ลำดับที่ ${assignedRank} ร่วมกัน)`;
          } else {
            s.isTiedGpa = false;
            s.tieBreakReason = `เกรดสะสม ${s.gpa}`;
          }
        });

        nextRankNumber = assignedRank + 1;
      }
    }

    // กำหนดสถานะให้คนที่คะแนนไม่ครบ
    incompleteStudents.forEach((s: any) => {
      s.calculatedRank = null;
      s.manualRank = null;
      s.isTiedGpa = false;
      s.isTrulyTied = false;
      s.tieBreakReason = `คะแนนยังไม่ครบ (มีคะแนนเพียง ${s.scored_subjects_count}/${gradeSubjectsCount} วิชา - ไม่นำมาจัดอันดับ)`;
    });

    // เรียงลำดับนักเรียนที่ครบสมบูรณ์ตามอันดับ
    completedStudents.sort((a: any, b: any) => {
      if (a.manualRank !== b.manualRank) {
        return a.manualRank - b.manualRank;
      }
      const tbDiff = b.tieBreakScore - a.tieBreakScore;
      if (Math.abs(tbDiff) > 0.001) return tbDiff;
      const codeA = parseInt(a.student_code, 10);
      const codeB = parseInt(b.student_code, 10);
      if (!isNaN(codeA) && !isNaN(codeB)) return codeA - codeB;
      return a.student_code.localeCompare(b.student_code);
    });

    // กำหนดข้อมูลกลุ่มที่เกรดซ้ำ (เฉพาะกลุ่มที่เกี่ยวข้องกับการชิงอันดับ 1, 2, 3 โล่รางวัลเกียรตินิยม)
    let groupCounter = 0;
    const tiedGroupsList: any[] = [];

    sortedGpas.forEach((gpa) => {
      const cluster = gpaMap.get(gpa)!;
      if (cluster.length > 1) {
        const isTop3 = cluster.some((m: any) => m.manualRank <= 3);
        if (!isTop3) {
          // ลำดับอื่นๆ ตั้งแต่อันดับ 4 เป็นต้นไป ได้ลำดับซ้ำกันตามเกรดเฉลี่ย (Dense Ranking) อยู่แล้ว ไม่ต้องนำมาแสดงเป็นการ์ดกลุ่มแย่งชิง
          cluster.forEach((s: any) => {
            s.isTiedGpa = false;
            delete s.tiedGroupId;
            delete s.tiedGroupColor;
            delete s.tiedGroupBg;
            delete s.tiedGroupText;
            delete s.tiedGroupCount;
          });
          return;
        }

        groupCounter++;
        const palette =
          GROUP_PALETTES[(groupCounter - 1) % GROUP_PALETTES.length];
        const gId = groupCounter;

        cluster.forEach((s: any) => {
          s.isTiedGpa = true;
          s.tiedGroupId = gId;
          s.tiedGroupColor = palette.border;
          s.tiedGroupBg = palette.bg;
          s.tiedGroupText = palette.text;
          s.tiedGroupCount = cluster.length;
        });

        const minR = Math.min(...cluster.map((m: any) => m.manualRank));
        const maxR = Math.max(...cluster.map((m: any) => m.manualRank));

        tiedGroupsList.push({
          groupId: gId,
          gpa: gpa,
          studentCount: cluster.length,
          color: palette,
          isTop3Group: true,
          isResolved: !cluster
            .filter((m: any) => m.manualRank <= 3)
            .some((m: any) => m.isTrulyTied),
          minRank: minR,
          maxRank: maxR,
          studentCodes: cluster.map((s: any) => s.student_code).join(", "),
        });
      }
    });

    masterSubjects.sort((a: any, b: any) => {
      const gComp = compareGroupNames(a.group_name || "", b.group_name || "");
      if (gComp !== 0) return gComp;
      return compareSubjectsInGroup(a, b);
    });

    const availableSubjectsList = masterSubjects.map((sub: any) => ({
      ...sub,
      selected: selectedSubSet.has(sub.id),
    }));

    const finalStudentList = [...completedStudents, ...incompleteStudents];
    const top3UnresolvedCount = completedStudents.filter(
      (s: any) => s.manualRank <= 3 && s.isTrulyTied,
    ).length;

    res.json({
      success: true,
      data: finalStudentList,
      tiedGroups: tiedGroupsList,
      availableSubjects: availableSubjectsList,
      summary: {
        batch_id: Number(batchId),
        total_students: finalStudentList.length,
        completed_students: completedStudents.length,
        incomplete_students: incompleteStudents.length,
        total_subjects: masterSubjects.length,
        selected_subjects_count: selectedSubSet.size,
        tiedCount: finalStudentList.filter(
          (s: any) => s.manualRank <= 3 && s.isTiedGpa && s.is_completed,
        ).length,
        unresolvedTies: top3UnresolvedCount,
      },
    });
  } catch (error) {
    console.error("Error calculating batch ranking:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการคำนวณการจัดลำดับ",
      error: (error as any)?.message,
    });
  }
};

// 12. จัดอันดับสำหรับการเลือกลงหน่วย (สูตร 80/20 ทศนิยม 4 ตำแหน่ง)
export const getUnitSelectionRanking = async (
  req: Request,
  res: Response,
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
        summary: {
          batch_id: Number(batchId),
          total_students: 0,
          total_credit: 0,
          total_max_weighted: 0,
          total_max_weighted_formatted: "0.0000",
          max_academic_80: 0,
          max_academic_80_formatted: "0.0000",
          max_behavior_score: 0,
          max_behavior_score_formatted: "0.0000",
          max_behavior_20: 0,
          max_behavior_20_formatted: "0.0000",
          max_final_score: 0,
          max_final_score_formatted: "0.0000",
        },
      });
      return;
    }

    // จัดกลุ่มวิชา
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
          full_name:
            `${row.rank_name || ""} ${row.first_name || ""} ${row.last_name || ""}`.trim(),
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
        st.group_raw_scores[row.group_id] =
          (st.group_raw_scores[row.group_id] || 0) + score;
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

    // เรียงกลุ่มวิชาตามลำดับที่แท้จริง
    subjectGroups.sort((a: any, b: any) => {
      return compareGroupNames(a.groupName, b.groupName);
    });

    // คิดคะแนนเต็มรวมคูณหน่วยกิต
    let totalMaxWeighted = 0;
    let totalCredit = 0;

    subjectGroups.forEach((grp: any) => {
      if (grp.credit > 0 && !grp.is_su) {
        totalMaxWeighted += grp.group_max_weighted;
        totalCredit += grp.credit;
      }
    });

    // ตรวจสอบคะแนนเต็มความประพฤติ
    let maxBehaviorScore = 200;
    const allStudentsList = Object.values(studentsMap);
    const hasScoreOver100 = allStudentsList.some(
      (s: any) => s.behavior_score > 100,
    );
    if (!hasScoreOver100 && allStudentsList.length > 0) {
      maxBehaviorScore = 100;
    }

    // คำนวณคะแนนตามสูตร 80/20
    const processedStudents = allStudentsList.map((st: any) => {
      let totalWeightedScore = 0;
      const groupScores: Record<number, any> = {};

      subjectGroups.forEach((grp: any) => {
        const rawScore = Number(st.group_raw_scores[grp.groupId]) || 0;
        const credit = grp.credit;
        const weightedScore = rawScore * credit;
        const maxScore = Number(grp.group_max_score) || 0;
        const maxWeightedScore =
          Number(grp.group_max_weighted) || maxScore * credit;

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

      // สัดส่วนคะแนนเรียน 80%
      const academicScore80 = totalWeightedScore * 0.8;

      // สัดส่วนคะแนนความประพฤติ 20%
      const behaviorScore20 = behaviorScore * 0.2;

      // รวมคะแนนสุทธิ 80% + 20%
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

    // เรียงลำดับคะแนนรวมสุทธิจากมากไปน้อย
    processedStudents.sort((a: any, b: any) => {
      const diff = b.final_score - a.final_score;
      if (Math.abs(diff) > 0.000001) return diff;
      const wDiff = b.total_weighted_score - a.total_weighted_score;
      if (Math.abs(wDiff) > 0.000001) return wDiff;
      return b.behavior_score - a.behavior_score;
    });

    // กำหนดอันดับ 1 ถึง N
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
