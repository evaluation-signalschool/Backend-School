import { Request, Response } from "express";
import { conn } from "../dbconn";

// ฟังก์ชันสำหรับดึงข้อมูลแบบประเมินทั้งหมด
export const getAllEvaluations = async (
  req: Request,
  res: Response,
): Promise<Response | void> => {
  try {
    // ดึงข้อมูลทั้งหมดเรียงจากรายการที่สร้างล่าสุด (หรือแก้เป็น WHERE is_active = 1 ถ้าต้องการเฉพาะที่เปิดใช้งาน)
    const sql = `SELECT * FROM evaluation_forms ORDER BY created_at DESC;`;

    const [rows]: any = await conn.query(sql);

    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error: any) {
    console.error("Error fetching all evaluations:", error);
    return res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงข้อมูลแบบประเมิน",
    });
  }
};

export const getGeneralEvaluation = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  const { batchId } = req.params;
  const { type, targetGroup } = req.query;

  try {
    let sql = `SELECT form_url FROM evaluation_forms WHERE batch_id = ? AND is_active = 1`;
    const params: any[] = [batchId];
    
    if (targetGroup) {
      sql += ` AND target_group = ?`;
      params.push(targetGroup);
    }
    if (type) {
      sql += ` AND evaluation_type = ?`;
      params.push(type);
    }
    
    sql += ` LIMIT 1;`;
    
    const [rows]: any = await conn.query(sql, params);

    if (rows.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    // ส่งแค่ Array ที่มี form_url
    return res.status(200).json({
      success: true,
      data: [{ form_url: rows[0].form_url }],
    });
  } catch (error: any) {
    console.error("Error fetching general evaluation:", error);
    return res.status(500).json({ success: false, message: "Error" });
  }
};

// สร้างฟอร์มประเมินใหม่ (พร้อมบันทึกคำถามและตัวเลือก)
export const createEvaluation = async (
  req: Request,
  res: Response,
): Promise<Response | void> => {
  // 1. รับข้อมูลโครงสร้างใหม่จาก Frontend (ตัด googleFormUrl ทิ้งไป รับ questions เข้ามาแทน)
  const { formType, formName, formDescription, generationId, subjectId, questions, targetGroup } = req.body;

  // เช็คว่ามีคำถามส่งมาด้วยไหม
  if (!questions || !Array.isArray(questions) || questions.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "กรุณาเพิ่มคำถามอย่างน้อย 1 ข้อ" });
  }

  // ดึง connection ออกมาเพื่อทำ Transaction (ป้องกันข้อมูลบันทึกไม่ครบ)
  const connection = await conn.getConnection();

  try {
    await connection.beginTransaction();

    // 2. บันทึก "หัวฟอร์ม" ลงตาราง evaluation_forms (เอา form_url ออก)
    const sqlForm = `
      INSERT INTO evaluation_forms 
      (batch_id, subject_id, evaluation_type, form_name, form_description, is_active, created_at, updated_at, target_group) 
      VALUES (?, ?, ?, ?, ?, 1, NOW(), NOW(), ?)
    `;
    const [formResult]: any = await connection.query(sqlForm, [
      generationId || null,
      subjectId || null,
      formType,
      formName,
      formDescription || null,
      targetGroup || 'student',
    ]);

    const formId = formResult.insertId; // ได้ ID ของฟอร์มมาเพื่อใช้ผูกกับคำถาม

    // 3. วนลูปบันทึก "คำถาม" และ "ตัวเลือก"
    for (const [index, q] of questions.entries()) {
      // 3.1 บันทึกคำถามลงตาราง evaluation_questions (รวม subject_for)
      const sqlQuestion = `
        INSERT INTO evaluation_questions 
        (form_id, question_text, question_type, order_num, subject_for) 
        VALUES (?, ?, ?, ?, ?)
      `;
      const cleanSubjectFor = q.subject_for && q.subject_for !== 'undefined' && q.subject_for !== 'all' ? q.subject_for : null;

      const [questionResult]: any = await connection.query(sqlQuestion, [
        formId,
        q.question_text,
        q.question_type || "choice",
        index + 1, // ให้ลำดับข้อเรียงตาม Array ที่ส่งมา
        cleanSubjectFor,
      ]);

      const questionId = questionResult.insertId; // ได้ ID ของคำถามมาผูกกับตัวเลือก

      // 3.2 ถ้าคำถามนี้เป็นแบบมีตัวเลือก (choice) ให้วนลูปบันทึกตัวเลือกลง evaluation_choices
      if (
        q.question_type === "choice" &&
        q.choices &&
        Array.isArray(q.choices)
      ) {
        const choiceValues = q.choices.map((c: any, cIndex: number) => [
          questionId,
          c.choice_text,
          c.score_value,
          cIndex + 1,
        ]);

        if (choiceValues.length > 0) {
          const sqlChoices = `
            INSERT INTO evaluation_choices (question_id, choice_text, score_value, order_num) 
            VALUES ?
          `;
          await connection.query(sqlChoices, [choiceValues]);
        }
      }
    }

    // ถ้าทุกอย่างผ่านฉลุย ให้ Commit ยืนยันการบันทึกข้อมูล
    await connection.commit();
    return res.status(201).json({
      success: true,
      message: "สร้างชุดแบบประเมินสำเร็จ",
      data: { form_id: formId },
    });
  } catch (error: any) {
    await connection.rollback(); // ถ้าระหว่างเซฟคำถามพัง ให้ยกเลิกการสร้างฟอร์มนี้ทิ้งไปเลย
    console.error("Error createEvaluation:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  } finally {
    await connection.release();
  }
};

// ดึงข้อมูลฟอร์มด้วย ID สำหรับนำไป Edit
export const getEvaluationById = async (
  req: Request,
  res: Response,
): Promise<Response | void> => {
  const { id } = req.params;
  try {
    const [forms]: any = await conn.query(
      `SELECT * FROM evaluation_forms WHERE id = ?`,
      [id]
    );

    if (forms.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบแบบประเมินที่ต้องการ" });
    }
    const form = forms[0];

    // ดึงคำถาม
    const [questions]: any = await conn.query(
      `SELECT * FROM evaluation_questions WHERE form_id = ? ORDER BY order_num ASC`,
      [form.id],
    );

    // ดึงตัวเลือก
    for (let q of questions) {
      if (q.question_type === "choice") {
        const [choices]: any = await conn.query(
          `SELECT * FROM evaluation_choices WHERE question_id = ? ORDER BY order_num ASC`,
          [q.id],
        );
        q.choices = choices;
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        form_id: form.id,
        form_name: form.form_name,
        form_description: form.form_description || '',
        evaluation_type: form.evaluation_type,
        batch_id: form.batch_id,
        subject_id: form.subject_id,
        questions: questions,
      },
    });
  } catch (error: any) {
    console.error("Error getEvaluationById:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
};


// อัปเดตข้อมูลฟอร์มประเมินและชุดคำถาม
export const updateEvaluation = async (
  req: Request,
  res: Response,
): Promise<Response | void> => {
  const { id } = req.params;
  const { formType, googleFormUrl, formName, formDescription, generationId, subjectId, questions } = req.body;

  if (!questions || !Array.isArray(questions) || questions.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "กรุณาเพิ่มคำถามอย่างน้อย 1 ข้อ" });
  }

  const connection = await conn.getConnection();
  try {
    await connection.beginTransaction();

    // 1. อัปเดตหัวฟอร์ม
    const sql = `
      UPDATE evaluation_forms 
      SET batch_id = ?, subject_id = ?, evaluation_type = ?, form_url = ?, form_name = ?, form_description = ?, updated_at = NOW() 
      WHERE id = ?
    `;

    const [result]: any = await connection.query(sql, [
      generationId || null,
      subjectId || null,
      formType,
      googleFormUrl,
      formName,
      formDescription || null,
      id,
    ]);

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบข้อมูลที่ต้องการแก้ไข" });
    }

    // 2. จัดการคำถาม
    const keptQuestionIds = questions
      .filter((q: any) => q.id)
      .map((q: any) => q.id);

    // หาคำถามเก่าที่อยู่ในฐานข้อมูลแต่ไม่ได้อยู่ใน payload (คือโดนลบออก)
    const [existingQuestions]: any = await connection.query(
      `SELECT id FROM evaluation_questions WHERE form_id = ?`,
      [id]
    );

    let unableToDeleteCount = 0;

    for (const eq of existingQuestions) {
      if (!keptQuestionIds.includes(eq.id)) {
        try {
          await connection.query(`DELETE FROM evaluation_questions WHERE id = ?`, [eq.id]);
        } catch (delErr: any) {
          if (delErr.code === "ER_ROW_IS_REFERENCED_2") {
            // ลบไม่ได้เพราะมีคนตอบแล้ว ปล่อยผ่านไปแต่จำไว้เพื่อไปแจ้งเตือน
            unableToDeleteCount++;
          } else {
            throw delErr;
          }
        }
      }
    }

    // 3. วนลูป อัปเดต หรือ เพิ่ม คำถาม
    for (const [index, q] of questions.entries()) {
      let questionId = q.id;
      const cleanSubjectFor = q.subject_for && q.subject_for !== 'undefined' && q.subject_for !== 'all' ? q.subject_for : null;

      if (questionId) {
        // อัปเดตคำถามเดิม
        await connection.query(
          `UPDATE evaluation_questions SET question_text = ?, question_type = ?, order_num = ?, subject_for = ? WHERE id = ? AND form_id = ?`,
          [q.question_text, q.question_type || "choice", index + 1, cleanSubjectFor, questionId, id]
        );
        
        // ลบตัวเลือกเก่าทิ้งทั้งหมดของคำถามนี้ (ปลอดภัยเพราะไม่มี FK โยงมาหา)
        await connection.query(`DELETE FROM evaluation_choices WHERE question_id = ?`, [questionId]);
      } else {
        // สร้างคำถามใหม่
        const sqlQuestion = `
          INSERT INTO evaluation_questions 
          (form_id, question_text, question_type, order_num, subject_for) 
          VALUES (?, ?, ?, ?, ?)
        `;
        const [questionResult]: any = await connection.query(sqlQuestion, [
          id,
          q.question_text,
          q.question_type || "choice",
          index + 1,
          cleanSubjectFor,
        ]);
        questionId = questionResult.insertId;
      }

      // 4. เพิ่มตัวเลือก (เฉพาะ choice)
      if (q.question_type === "choice" && q.choices && Array.isArray(q.choices)) {
        const choiceValues = q.choices.map((c: any, cIndex: number) => [
          questionId,
          c.choice_text,
          c.score_value,
          cIndex + 1,
        ]);

        if (choiceValues.length > 0) {
          const sqlChoices = `
            INSERT INTO evaluation_choices (question_id, choice_text, score_value, order_num) 
            VALUES ?
          `;
          await connection.query(sqlChoices, [choiceValues]);
        }
      }
    }

    await connection.commit();

    let finalMessage = "อัปเดตข้อมูลฟอร์มและคำถามสำเร็จ";
    if (unableToDeleteCount > 0) {
      finalMessage += ` (ไม่สามารถลบคำถามบางข้อได้เนื่องจากมีนักเรียนตอบแล้ว แต่บันทึกการแก้ไขคำถามอื่นๆ สำเร็จ)`;
    }

    return res
      .status(200)
      .json({ success: true, message: finalMessage });
  } catch (error: any) {
    await connection.rollback();
    console.error("Error updateEvaluation:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  } finally {
    await connection.release();
  }
};

// ลบข้อมูลฟอร์มประเมิน
export const deleteEvaluation = async (
  req: Request,
  res: Response,
): Promise<Response | void> => {
  const { id } = req.params;

  try {
    const [result]: any = await conn.query(
      `DELETE FROM evaluation_forms WHERE id = ?`,
      [id]
    );

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบแบบฟอร์มที่ต้องการลบ" });
    }

    return res.status(200).json({ success: true, message: "ลบแบบฟอร์มสำเร็จ" });
  } catch (error: any) {
    console.error("Error deleteEvaluation:", error);
    if (error.code === "ER_ROW_IS_REFERENCED_2") {
      return res.status(400).json({
        success: false,
        message: "ไม่สามารถลบแบบฟอร์มนี้ได้ เนื่องจากมีนักเรียนตอบแบบประเมินแล้ว",
      });
    }
    return res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการลบแบบฟอร์ม" });
  }
};

// ==========================================
// ส่วนที่ต้องเพิ่มใหม่ สำหรับฝั่งนักเรียน
// ==========================================

// 1. ดึงข้อมูลฟอร์มพร้อมชุดคำถามและตัวเลือก (GET)
export const getEvaluationQuestions = async (
  req: Request,
  res: Response,
): Promise<Response | void> => {
  const { batchId } = req.params;
  const { type } = req.query;
  try {
    // 1. หา form_id โดยดึงฟอร์มล่าสุดของรุ่น และประเภทนั้นๆ (ไม่สนวิชาแล้ว)
    let sqlForm = `SELECT * FROM evaluation_forms WHERE batch_id = ? AND evaluation_type = ? AND is_active = 1 ORDER BY id DESC LIMIT 1`;
    let queryParams: any[] = [batchId, type];

    const [forms]: any = await conn.query(sqlForm, queryParams);

    if (forms.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบแบบประเมินสำหรับรุ่นนี้" });
    }
    const form = forms[0];
    // 2. ดึงคำถามทั้งหมดของฟอร์มนี้
    const [questions]: any = await conn.query(
      `SELECT * FROM evaluation_questions WHERE form_id = ? ORDER BY order_num ASC`,
      [form.id],
    );
    // 3. ดึงตัวเลือกทั้งหมดของคำถามแต่ละข้อ
    for (let q of questions) {
      if (q.question_type === "choice") {
        const [choices]: any = await conn.query(
          `SELECT * FROM evaluation_choices WHERE question_id = ? ORDER BY order_num ASC`,
          [q.id],
        );
        q.choices = choices;
      }
    }
    return res.status(200).json({
      success: true,
      data: {
        form_id: form.id,
        form_name: form.form_name,
        form_description: form.form_description || '',
        evaluation_type: form.evaluation_type,
        questions: questions,
      },
    });
  } catch (error: any) {
    console.error("Error getEvaluationQuestions:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
};

// 2. บันทึกคำตอบที่นักเรียนส่งมา (POST)
export const submitEvaluationAnswer = async (
  req: Request,
  res: Response,
): Promise<Response | void> => {
  // 1. รับ student_id ที่ส่งมาจาก Frontend (ถ้าไม่มี เช่น ครู/ผู้ใช้ทั่วไป ให้เป็น null ได้)
  const { studentId, formId, subjectId, instructorName, answers } = req.body;

  // ตรวจสอบข้อมูลเบื้องต้น
  if (!formId || !answers || !Array.isArray(answers)) {
    return res
      .status(400)
      .json({
        success: false,
        message: "ข้อมูลที่ส่งมาไม่ครบถ้วน (ต้องการ formId, answers)",
      });
  }

  const connection = await conn.getConnection();
  try {
    await connection.beginTransaction();

    // ตรวจสอบว่า subjectId มีอยู่จริงในฐานข้อมูลหรือไม่ เพื่อไม่ให้ติด Foreign Key
    let cleanSubjectId: number | null = null;
    if (subjectId && !isNaN(Number(subjectId)) && Number(subjectId) > 0) {
      const [subCheck]: any = await connection.query(
        `SELECT id FROM subjects WHERE id = ?`,
        [Number(subjectId)]
      );
      if (subCheck.length > 0) {
        cleanSubjectId = Number(subjectId);
      }
    }

    // 2. บันทึกใบเสร็จ (evaluation_submissions)
    const sqlSubmission = `
      INSERT INTO evaluation_submissions (student_id, form_id, subject_id, instructor_name, created_at)
      VALUES (?, ?, ?, ?, NOW())
    `;
    const [subResult]: any = await connection.query(sqlSubmission, [
      studentId || null,
      formId,
      cleanSubjectId,
      instructorName || "ไม่ระบุ",
    ]);

    const submissionId = subResult.insertId;

    // 3. วนลูปบันทึกคำตอบ (evaluation_answers)
    for (let ans of answers) {
      const sqlAnswer = `
        INSERT INTO evaluation_answers (submission_id, question_id, score_value, comment)
        VALUES (?, ?, ?, ?)
      `;
      // ถ้าเป็นคำถามแบบ text จะไม่มีคะแนน (score_value = null) และไปใส่ช่อง comment แทน
      await connection.query(sqlAnswer, [
        submissionId,
        ans.question_id,
        ans.score_value || null,
        ans.comment || null,
      ]);
    }

    await connection.commit();
    return res
      .status(201)
      .json({ success: true, message: "บันทึกผลการประเมินสำเร็จ!" });
  } catch (error: any) {
    await connection.rollback();
    console.error("Error submitEvaluationAnswer:", error);

    // 4. ดักจับ Error กรณีประเมินซ้ำ (ติด Unique Key)
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({
        success: false,
        message: "คุณได้ประเมินวิชานี้ไปแล้ว ไม่สามารถประเมินซ้ำได้",
      });
    }

    return res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการบันทึก" });
  } finally {
    connection.release();
  }
};

// 3. ดึงข้อมูลผู้ที่ตอบแบบฟอร์มแล้วพร้อมคำตอบแต่ละข้อ (GET)
export const getFormSubmissions = async (
  req: Request,
  res: Response,
): Promise<Response | void> => {
  const { formId } = req.params;

  try {
    // 1. ดึงข้อมูลคำถามของฟอร์มนี้ เพื่อทำเป็น Header คอลัมน์
    const [questions]: any = await conn.query(
      `SELECT id, question_text, order_num FROM evaluation_questions WHERE form_id = ? ORDER BY order_num ASC`,
      [formId]
    );

    if (questions.length === 0) {
       return res.status(200).json({ success: true, data: { questions: [], submissions: [] } });
    }

    // 2. ดึงข้อมูลผู้ส่ง (Submissions)
    let sqlSubmissions = `
      SELECT 
        s.id AS submission_id,
        s.created_at AS submitted_at,
        s.instructor_name,
        st.student_code,
        st.rank_name,
        st.first_name,
        st.last_name,
        subj.subject_name,
        f.form_name
      FROM evaluation_submissions s
      LEFT JOIN students st ON s.student_id = st.id
      LEFT JOIN subjects subj ON s.subject_id = subj.id
      LEFT JOIN evaluation_forms f ON s.form_id = f.id
      WHERE s.form_id = ?
    `;
    const paramsSubmissions: any[] = [formId];

    const { subjectId } = req.query;
    if (subjectId) {
      sqlSubmissions += ` AND s.subject_id = ?`;
      paramsSubmissions.push(subjectId);
    }

    sqlSubmissions += ` ORDER BY s.created_at DESC`;

    const [submissionsRaw]: any = await conn.query(sqlSubmissions, paramsSubmissions);

    // 3. ดึงคำตอบทั้งหมดของฟอร์มนี้
    const sqlAnswers = `
      SELECT 
        a.submission_id,
        a.question_id,
        a.score_value,
        a.comment
      FROM evaluation_answers a
      INNER JOIN evaluation_submissions s ON a.submission_id = s.id
      WHERE s.form_id = ?
    `;
    const [answersRaw]: any = await conn.query(sqlAnswers, [formId]);

    // 4. ประกอบร่างข้อมูล (Transform Data)
    const submissions = submissionsRaw.map((sub: any) => {
      // ค้นหาคำตอบของ submission นี้
      const userAnswers = answersRaw.filter((a: any) => a.submission_id === sub.submission_id);
      
      const answerDict: any = {};
      for (const ans of userAnswers) {
        // ให้ค่าคะแนนเป็นหลัก ถ้าไม่มีคะแนนให้แสดง comment (สำหรับ text type)
        answerDict[`q_${ans.question_id}`] = ans.score_value !== null ? ans.score_value : (ans.comment || '-');
      }

      return {
        id: sub.submission_id,
        submittedAt: sub.submitted_at,
        name: `${sub.rank_name || ''} ${sub.first_name || ''} ${sub.last_name || ''}`.trim(),
        studentCode: sub.student_code,
        instructorName: sub.instructor_name,
        courseName: sub.subject_name || sub.form_name || '-',
        answers: answerDict
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        questions: questions,
        submissions: submissions
      }
    });

  } catch (error: any) {
    console.error("Error getFormSubmissions:", error);
    return res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการดึงข้อมูลแบบฟอร์ม" });
  }
};

