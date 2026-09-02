import { Request, Response } from "express";
import { conn } from "../dbconn";

export const getEvaluationSummary = async (req: Request, res: Response) => {
  const { batchId } = req.params;

  try {
    // 1. Get all students in this batch
    const [students]: any = await conn.query(
      `SELECT id, student_code, first_name, last_name, rank_name FROM students WHERE batch_id = ?`,
      [batchId]
    );

    // 2. Get all forms for this batch
    const [forms]: any = await conn.query(
      `SELECT f.id as form_id, f.subject_id, f.evaluation_type, f.target_group, f.form_name, s.subject_name
       FROM evaluation_forms f
       LEFT JOIN subjects s ON f.subject_id = s.id
       WHERE f.batch_id = ? AND f.is_active = 1`,
      [batchId]
    );

    // 3. Get all submissions
    const [submissions]: any = await conn.query(
      `SELECT sub.id as submission_id, sub.form_id, sub.student_id, sub.subject_id, sub.instructor_name 
       FROM evaluation_submissions sub
       INNER JOIN evaluation_forms f ON sub.form_id = f.id
       WHERE f.batch_id = ?`,
      [batchId]
    );

    // 4. Get all answers (including dropdown & text)
    const [allAnswers]: any = await conn.query(
      `SELECT a.submission_id, a.question_id, a.score_value, a.comment, q.question_text, q.question_type, q.order_num
       FROM evaluation_answers a
       INNER JOIN evaluation_submissions sub ON a.submission_id = sub.id
       INNER JOIN evaluation_forms f ON sub.form_id = f.id
       LEFT JOIN evaluation_questions q ON a.question_id = q.id
       WHERE f.batch_id = ?`,
      [batchId]
    );
    const answers = allAnswers.filter((a: any) => a.score_value !== null && a.score_value !== undefined);

    // Helper: format full name
    const formatName = (s: any) => `${s.rank_name || ''} ${s.first_name || ''} ${s.last_name || ''}`.trim();

    // 2.5 Get all subjects for this batch
    const [subjectsQuery]: any = await conn.query(
      `SELECT s.id as subject_id, s.subject_name 
       FROM subjects s
       INNER JOIN subject_groups sg ON s.group_id = sg.id
       WHERE sg.batch_id = ?`,
      [batchId]
    );

    // 2.6 Get all questions to map order_num
    const [questions]: any = await conn.query(
      `SELECT id, question_text, question_type, order_num FROM evaluation_questions`
    );
    const questionOrderMap: any = {};
    questions.forEach((q: any) => {
      questionOrderMap[q.id] = q.order_num;
    });

    // ==========================================
    // A. Overview (Evaluated vs Pending per Subject)
    // ==========================================
    const overview = subjectsQuery.map((subject: any) => {
      // Find all submissions for this subject (for instructor evaluations)
      const subjectSubs = submissions.filter((s: any) => s.subject_id === subject.subject_id);
      
      // Get unique student IDs who submitted for this subject
      const evaluatedStudentIds = new Set(subjectSubs.map((s: any) => String(s.student_id)));
      
      // Calculate pending users
      const pendingUsers = students
        .filter((student: any) => !evaluatedStudentIds.has(String(student.id)))
        .map((student: any) => ({
          id: student.id,
          name: formatName(student),
          studentCode: student.student_code
        }));

      return {
        formId: subject.subject_id, 
        courseName: subject.subject_name,
        evaluationType: 'instructor',
        evaluatedCount: evaluatedStudentIds.size,
        pendingCount: pendingUsers.length,
        pendingUsers: pendingUsers
      };
    });

    // ==========================================
    // B. Teacher Results (evaluation_type = 'instructor' / target_group='instructor')
    // ==========================================
    // We group answers by subject
    const teacherMap: any = {};
    const teacherForms = forms.filter((f: any) => f.evaluation_type === 'instructor');
    
    // 1. นำรายวิชาทั้งหมดมาใส่ไว้ใน map ก่อน เพื่อให้วิชาที่ยังไม่มีคนประเมินแสดงผลด้วย
    subjectsQuery.forEach((subject: any) => {
      const key = subject.subject_name;
      teacherMap[key] = {
        courseName: subject.subject_name,
        instructors: new Set<string>(),
        curriculumId: batchId,
        courseId: subject.subject_id,
        scores: { q1: 0, q2: 0, q3: 0, q4: 0, q5: 0, q6: 0, q7: 0 },
        counts: { q1: 0, q2: 0, q3: 0, q4: 0, q5: 0, q6: 0, q7: 0 },
        totalScore: 0,
        scoreCount: 0,
        isPlaceholder: true
      };
    });
    
    // 2. อัปเดตข้อมูลจากคำตอบที่มีจริง
    teacherForms.forEach((form: any) => {
      const formSubs = submissions.filter((s: any) => s.form_id === form.form_id);
      formSubs.forEach((sub: any) => {
        let courseName = form.subject_name || form.form_name;
        
        // ถ้า submission มี subject_id ระบุไว้ ให้ดึงชื่อวิชาจาก subjectsQuery แทน (อิงตามข้อมูลจริงตอนประเมิน)
        if (sub.subject_id) {
          const actualSubject = subjectsQuery.find((sq: any) => sq.subject_id === sub.subject_id);
          if (actualSubject) {
            courseName = actualSubject.subject_name;
          }
        }
        
        const key = courseName;

        if (!teacherMap[key]) {
          teacherMap[key] = {
            courseName: courseName,
            instructors: new Set<string>(),
            curriculumId: batchId,
            courseId: form.subject_id || '0',
            scores: { q1: 0, q2: 0, q3: 0, q4: 0, q5: 0, q6: 0, q7: 0 },
            counts: { q1: 0, q2: 0, q3: 0, q4: 0, q5: 0, q6: 0, q7: 0 },
            totalScore: 0,
            scoreCount: 0,
            isPlaceholder: false
          };
        } else if (teacherMap[key].isPlaceholder) {
          teacherMap[key].isPlaceholder = false;
        }
        
        const instrName = sub.instructor_name || 'ไม่ระบุ';
        teacherMap[key].instructors.add(instrName);
        
        // Get answers for this submission
        const subAnswers = answers.filter((a: any) => a.submission_id === sub.submission_id);
        subAnswers.forEach((a: any) => {
          const order = questionOrderMap[a.question_id];
          if (order && order <= 7) {
            teacherMap[key].scores[`q${order}`] += Number(a.score_value);
            teacherMap[key].counts[`q${order}`] += 1;
          }
          teacherMap[key].totalScore += Number(a.score_value);
          teacherMap[key].scoreCount += 1;
        });
      });
    });

    const teacherResults = Object.values(teacherMap).map((t: any) => {
      const avg = t.scoreCount > 0 ? (t.totalScore / t.scoreCount) : 0;
      let level = "ปรับปรุง";
      if (avg >= 4.51) level = "มากที่สุด";
      else if (avg >= 3.51) level = "มาก";
      else if (avg >= 2.51) level = "ปานกลาง";
      else if (avg >= 1.51) level = "พอใช้";

      const finalScores: any = {};
      for (let i = 1; i <= 7; i++) {
        const qKey = `q${i}`;
        finalScores[qKey] = t.counts[qKey] > 0 
          ? Number((t.scores[qKey] / t.counts[qKey]).toFixed(2)) 
          : (t.isPlaceholder ? '-' : 0);
      }

      const instructorsArray = Array.from(t.instructors as Set<string>);
      const joinedInstructors = instructorsArray.length > 0 ? instructorsArray.join(' / ') : '-';

      return {
        ...t,
        instructorName: joinedInstructors,
        scores: finalScores,
        averageScore: Number(avg.toFixed(2)),
        level: t.isPlaceholder ? '-' : level
      };
    });

    // ==========================================
    // C. Student Results (evaluation_type = 'teacher_course' or 'student')
    // ==========================================
    const studentMap: any = {};
    
    // 1. นำรายวิชาทั้งหมดมาใส่ไว้ใน map ก่อน เพื่อให้ทุกวิชาในรุ่นนี้แสดงผลเหมือนในตาราง
    subjectsQuery.forEach((subject: any) => {
      const key = subject.subject_name;
      studentMap[key] = {
        courseName: subject.subject_name,
        curriculumId: batchId,
        courseId: subject.subject_id,
        scores: { q1: 0, q2: 0, q3: 0, q4: 0, q5: 0 },
        counts: { q1: 0, q2: 0, q3: 0, q4: 0, q5: 0 },
        totalScore: 0,
        scoreCount: 0,
        isPlaceholder: true
      };
    });

    const studentForms = forms.filter(
      (f: any) =>
        f.evaluation_type === "teacher_course" ||
        f.evaluation_type === "student" ||
        f.target_group === "teacher"
    );

    studentForms.forEach((form: any) => {
      const formSubs = submissions.filter((s: any) => s.form_id === form.form_id);
      formSubs.forEach((sub: any) => {
        let courseName = "";

        const subAnswersAll = allAnswers.filter((a: any) => a.submission_id === sub.submission_id);
        const dropdownAns = subAnswersAll.find(
          (a: any) =>
            a.question_type === "dropdown" ||
            (a.question_text && a.question_text.includes("วิชา"))
        );
        if (dropdownAns && dropdownAns.comment) {
          courseName = dropdownAns.comment.trim();
        }

        if (!courseName && sub.subject_id) {
          const actualSubject = subjectsQuery.find((sq: any) => sq.subject_id === sub.subject_id);
          if (actualSubject) {
            courseName = actualSubject.subject_name;
          }
        }

        if (!courseName) {
          courseName = form.subject_name || form.form_name;
        }

        if (!courseName) return;

        let matchedKey = Object.keys(studentMap).find(
          (k) => k.trim().toLowerCase() === courseName.trim().toLowerCase()
        );

        if (!matchedKey) {
          matchedKey = courseName;
          studentMap[matchedKey] = {
            courseName: courseName,
            curriculumId: batchId,
            courseId: form.subject_id || "0",
            scores: { q1: 0, q2: 0, q3: 0, q4: 0, q5: 0 },
            counts: { q1: 0, q2: 0, q3: 0, q4: 0, q5: 0 },
            totalScore: 0,
            scoreCount: 0,
            isPlaceholder: false,
          };
        } else {
          studentMap[matchedKey].isPlaceholder = false;
        }

        const scoredAnswers = subAnswersAll.filter(
          (a: any) => a.score_value !== null && a.score_value !== undefined
        );
        scoredAnswers.sort((a: any, b: any) => (a.order_num || 0) - (b.order_num || 0));

        scoredAnswers.forEach((a: any, index: number) => {
          const val = Number(a.score_value);
          if (isNaN(val) || val <= 0) return;

          let qIdx = index + 1;
          const qText = a.question_text || "";
          if (qText.includes("ความตั้งใจ") || qText.includes("ร่วมมือ")) qIdx = 1;
          else if (qText.includes("ความพร้อม") || qText.includes("กระตือรือร้น")) qIdx = 2;
          else if (qText.includes("กฎระเบียบ") || qText.includes("วินัย")) qIdx = 3;
          else if (qText.includes("ซื่อสัตย์") || qText.includes("ตรงต่อเวลา")) qIdx = 4;
          else if (qText.includes("คุณลักษณะ")) qIdx = 5;

          if (qIdx >= 1 && qIdx <= 5) {
            studentMap[matchedKey].scores[`q${qIdx}`] += val;
            studentMap[matchedKey].counts[`q${qIdx}`] += 1;
          }

          studentMap[matchedKey].totalScore += val;
          studentMap[matchedKey].scoreCount += 1;
        });
      });
    });

    const studentResults = Object.values(studentMap).map((s: any) => {
      if (s.isPlaceholder || s.scoreCount === 0) {
        return {
          courseName: s.courseName,
          curriculumId: batchId,
          score1: "-",
          score2: "-",
          score3: "-",
          score4: "-",
          score5: "-",
          avgScore: "-",
          level: "-",
        };
      }

      const avg = s.totalScore / s.scoreCount;
      let level = "ปรับปรุง";
      if (avg >= 4.51) level = "มากที่สุด";
      else if (avg >= 3.51) level = "มาก";
      else if (avg >= 2.51) level = "ปานกลาง";
      else if (avg >= 1.51) level = "พอใช้";

      const score1 = s.counts.q1 > 0 ? Number((s.scores.q1 / s.counts.q1).toFixed(2)) : "-";
      const score2 = s.counts.q2 > 0 ? Number((s.scores.q2 / s.counts.q2).toFixed(2)) : "-";
      const score3 = s.counts.q3 > 0 ? Number((s.scores.q3 / s.counts.q3).toFixed(2)) : "-";
      const score4 = s.counts.q4 > 0 ? Number((s.scores.q4 / s.counts.q4).toFixed(2)) : "-";
      const score5 = s.counts.q5 > 0 ? Number((s.scores.q5 / s.counts.q5).toFixed(2)) : "-";

      return {
        courseName: s.courseName,
        curriculumId: batchId,
        score1,
        score2,
        score3,
        score4,
        score5,
        avgScore: Number(avg.toFixed(2)),
        level,
      };
    });

    // ==========================================
    // D. Course Results (Parts 1, 2, 3: course, director, committee)
    // ==========================================
    const [allBatchQuestions]: any = await conn.query(
      `SELECT q.id, q.form_id, q.question_text, q.question_type, q.order_num 
       FROM evaluation_questions q
       INNER JOIN evaluation_forms f ON q.form_id = f.id
       WHERE f.batch_id = ?
       ORDER BY q.form_id, q.order_num ASC`,
      [batchId]
    );

    const getFormPartSummary = (evalType: string, defaultTitle: string) => {
      const targetForm = forms.find((f: any) => f.evaluation_type === evalType);
      if (!targetForm) {
        return {
          formId: null,
          formName: defaultTitle,
          title: defaultTitle,
          topics: [],
          scores: [],
          levels: [],
          hasData: false,
          totalSubmissions: 0
        };
      }

      const formQuestions = allBatchQuestions.filter(
        (q: any) =>
          q.form_id === targetForm.form_id &&
          q.question_type !== 'dropdown' &&
          !q.question_text.includes('ตำแหน่ง') &&
          !q.question_text.includes('ความรับผิดชอบ')
      );
      const formSubs = submissions.filter((s: any) => s.form_id === targetForm.form_id);

      const topics: string[] = [];
      const scores: (number | string)[] = [];
      const percentages: (number | string)[] = [];
      const levels: string[] = [];

      formQuestions.forEach((q: any) => {
        topics.push(q.question_text);
        if (q.question_type === 'choice') {
          const qAnswers = answers.filter((a: any) => a.question_id === q.id && a.score_value !== null && a.score_value !== undefined);
          if (qAnswers.length > 0) {
            const sum = qAnswers.reduce((acc: number, a: any) => acc + Number(a.score_value), 0);
            const avg = Number((sum / qAnswers.length).toFixed(2));
            const pct = Number(((avg / 5) * 100).toFixed(2));
            scores.push(avg);
            percentages.push(pct);

            let lvl = 'ปรับปรุง';
            if (avg >= 4.51) lvl = 'มากที่สุด';
            else if (avg >= 3.51) lvl = 'มาก';
            else if (avg >= 2.51) lvl = 'ปานกลาง';
            else if (avg >= 1.51) lvl = 'พอใช้';
            levels.push(lvl);
          } else {
            scores.push('-');
            percentages.push('-');
            levels.push('-');
          }
        } else {
          // text หรือ dropdown
          scores.push('-');
          percentages.push('-');
          levels.push('-');
        }
      });

      return {
        formId: targetForm.form_id,
        formName: targetForm.form_name,
        formDescription: targetForm.form_description || '',
        title: targetForm.form_name || defaultTitle,
        topics,
        scores,
        percentages,
        levels,
        hasData: topics.length > 0,
        totalSubmissions: formSubs.length
      };
    };

    const courseResults = {
      part1: getFormPartSummary('course', 'ผู้เรียนประเมินหลักสูตร'),
      part2: getFormPartSummary('director', 'ผู้เรียนประเมินคณะกำกับหลักสูตร'),
      part3: getFormPartSummary('committee', 'คณะกำกับหลักสูตรประเมินหลักสูตร'),
    };

    res.status(200).json({
      success: true,
      data: {
        totalStudents: students.length,
        totalSubjects: subjectsQuery.length,
        overview,
        teacherResults,
        studentResults,
        courseResults
      }
    });

  } catch (error: any) {
    console.error("Error getEvaluationSummary:", error);
    res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการดึงข้อมูลแบบฟอร์ม" });
  }
};

// ==========================================
// สรุปผลและสถิติการฝึกอบรม (Training Statistics & Summary)
// ดึงข้อมูลวิชาจริงและคะแนนจริงตามหลักสูตร พร้อมตรวจสอบสถานะการเปิด/ปิด (is_active)
// ==========================================
export const getTrainingSummary = async (req: Request, res: Response) => {
  const { courseId, courseName } = req.query;

  try {
    // 1. ดึงข้อมูลหลักสูตรทั้งหมดพร้อมรุ่น เพื่อนำมาตรวจสอบและสร้าง dropdown เลือกหลักสูตร
    const coursesSql = `
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
      ORDER BY c.course_name ASC, b.id ASC;
    `;

    const [courseRows]: any = await conn.query(coursesSql);

    interface CourseGroupItem {
      course_id: number;
      course_name: string;
      curriculum_year: number;
      is_active: boolean;
      batches: any[];
    }

    const coursesMap: Record<number, CourseGroupItem> = {};

    courseRows.forEach((row: any) => {
      const cId = Number(row.course_id);
      if (!coursesMap[cId]) {
        coursesMap[cId] = {
          course_id: cId,
          course_name: row.course_name,
          curriculum_year: row.curriculum_year,
          is_active: false,
          batches: []
        };
      }

      if (row.batch_id) {
        const isBatchActive = Boolean(row.is_active);
        if (isBatchActive) {
          coursesMap[cId].is_active = true;
        }
        coursesMap[cId].batches.push({
          batch_id: row.batch_id,
          batch_name: row.batch_name,
          start_date: row.start_date,
          end_date: row.end_date,
          is_active: isBatchActive,
          is_registration_open: Boolean(row.is_registration_open)
        });
      }
    });

    const availableCourses = Object.values(coursesMap);

    if (availableCourses.length === 0) {
      return res.status(200).json({
        success: true,
        isActive: false,
        message: "ยังไม่มีหลักสูตรในระบบ",
        data: null,
        availableCourses: []
      });
    }

    // 2. ค้นหาหลักสูตรเป้าหมาย (ให้ความสำคัญกับ courseName ก่อน)
    let targetCourse: CourseGroupItem | undefined;

    if (courseName) {
      const normalizedQuery = String(courseName).replace(/[\s()]/g, '').toLowerCase();
      // 1) ค้นหาชื่อที่ตรงกันเป๊ะ
      targetCourse = availableCourses.find((c) => {
        const cNorm = c.course_name.replace(/[\s()]/g, '').toLowerCase();
        return cNorm === normalizedQuery;
      });
      // 2) ถ้าไม่เจอ ให้ค้นหาแบบข้อความบางส่วน
      if (!targetCourse) {
        targetCourse = availableCourses.find((c) => {
          const cNorm = c.course_name.replace(/[\s()]/g, '').toLowerCase();
          return cNorm.includes(normalizedQuery) || normalizedQuery.includes(cNorm);
        });
      }
    }

    if (!targetCourse && courseId) {
      targetCourse = availableCourses.find((c) => c.course_id === Number(courseId));
    }

    // หากไม่ระบุ หรือหาไม่เจอ ให้เลือกหลักสูตรแรกที่เปิดใช้งานอยู่
    if (!targetCourse) {
      targetCourse = availableCourses.find((c) => c.is_active) || availableCourses[0];
    }

    // 3. ตรวจสอบสถานะการเปิด/ปิด (is_active) ของหลักสูตรและรุ่น
    const activeBatches = (targetCourse.batches || []).filter((b: any) => b.is_active);

    if (activeBatches.length === 0) {
      return res.status(200).json({
        success: true,
        isActive: false,
        message: `หลักสูตร "${targetCourse.course_name}" ปิดใช้งาน หรือยังไม่มีรุ่นที่เปิดใช้งานอยู่ในขณะนี้`,
        course: {
          id: targetCourse.course_id,
          name: targetCourse.course_name,
          year: targetCourse.curriculum_year,
          isActive: false
        },
        availableCourses,
        data: null
      });
    }

    const activeBatchIds = activeBatches.map((b: any) => b.batch_id);

    // 4. ดึงรายวิชาและคะแนนสอบจริง (student_scores) ของรุ่นที่เปิดใช้งาน
    const scoreSql = `
      SELECT 
        s.id AS subject_id,
        s.subject_name,
        s.is_su,
        sg.id AS group_id,
        sg.group_name,
        sg.batch_id,
        cb.batch_name,
        COALESCE(sbs.max_score, 100) AS max_score,
        AVG(ss.raw_score) AS avg_raw_score,
        COUNT(ss.id) AS student_score_count
      FROM subjects s
      JOIN subject_groups sg ON s.group_id = sg.id
      JOIN course_batches cb ON sg.batch_id = cb.id
      LEFT JOIN subject_batch_settings sbs ON s.id = sbs.subject_id AND sbs.batch_id = sg.batch_id
      LEFT JOIN student_scores ss ON sbs.id = ss.setting_id
      WHERE sg.batch_id IN (?) AND cb.is_active = 1
      GROUP BY s.id, s.subject_name, s.is_su, sg.id, sg.group_name, sg.batch_id, cb.batch_name, sbs.max_score
      ORDER BY s.id ASC;
    `;

    const [scoreRows]: any = await conn.query(scoreSql, [activeBatchIds]);

    // 5. จัดกลุ่มรายวิชาและคะแนนตามชื่อวิชา
    const subjectMap: Record<string, any> = {};

    scoreRows.forEach((row: any) => {
      const name = row.subject_name;
      if (!subjectMap[name]) {
        subjectMap[name] = {
          id: row.subject_id,
          name: name,
          is_su: Boolean(row.is_su),
          batchScores: {} as Record<number, number | null>,
          batchScoreCounts: {} as Record<number, number>
        };
      }

      // คำนวณคะแนนเฉลี่ยเป็นมาตราส่วน 100
      let scoreVal: number | null = null;
      if (row.avg_raw_score !== null && row.student_score_count > 0) {
        const maxScore = Number(row.max_score) || 100;
        const avg = Number(row.avg_raw_score);
        scoreVal = maxScore > 0 ? Number(((avg / maxScore) * 100).toFixed(1)) : Number(avg.toFixed(1));
      }

      subjectMap[name].batchScores[row.batch_id] = scoreVal;
      subjectMap[name].batchScoreCounts[row.batch_id] = Number(row.student_score_count) || 0;
    });

    // แปลงเป็น Array รายวิชาสำหรับแสดงผล
    const subjectList = Object.values(subjectMap).map((subj: any, index: number) => {
      const scoresForAvg: number[] = [];
      activeBatches.forEach((b: any) => {
        const val = subj.batchScores[b.batch_id];
        if (val !== null && val !== undefined) {
          scoresForAvg.push(val);
        }
      });

      const avgScore = scoresForAvg.length > 0
        ? Number((scoresForAvg.reduce((a, b) => a + b, 0) / scoresForAvg.length).toFixed(1))
        : 0;

      // คำนวณผลต่าง (+/-) ถ้ามีอย่างน้อย 2 รุ่น
      let diff: number | null = null;
      if (activeBatches.length >= 2) {
        const b1Score = subj.batchScores[activeBatches[0].batch_id];
        const b2Score = subj.batchScores[activeBatches[1].batch_id];
        if (b1Score !== null && b1Score !== undefined && b2Score !== null && b2Score !== undefined) {
          diff = Number((b2Score - b1Score).toFixed(1));
        }
      }

      return {
        id: subj.id || index + 1,
        name: subj.name,
        is_su: subj.is_su,
        batchScores: subj.batchScores,
        avgScore,
        diff
      };
    });

    // 6. คำนวณคะแนนเฉลี่ยรวมทั้งหลักสูตร
    const subjectsWithScore = subjectList.filter((s) => s.avgScore > 0);
    const totalAvg = subjectsWithScore.length > 0
      ? Number((subjectsWithScore.reduce((acc, s) => acc + s.avgScore, 0) / subjectsWithScore.length).toFixed(1))
      : 0;

    // 7. อันดับ 3 สูงสุด / 3 ต่ำสุด
    const sortedDesc = [...subjectsWithScore].sort((a, b) => b.avgScore - a.avgScore);
    const top3 = sortedDesc.slice(0, 3).map((s) => ({ name: s.name, score: s.avgScore }));

    const sortedAsc = [...subjectsWithScore].sort((a, b) => a.avgScore - b.avgScore);
    const bottom3 = sortedAsc.slice(0, 3).map((s) => ({ name: s.name, score: s.avgScore }));

    // 8. พัฒนาการก้าวกระโดด & ประเด็นเฝ้าระวัง
    const subjectsWithDiff = subjectList.filter((s) => s.diff !== null);
    const topImproved = [...subjectsWithDiff].sort((a, b) => (b.diff || 0) - (a.diff || 0))[0] || null;
    const topDeclined = [...subjectsWithDiff].sort((a, b) => (a.diff || 0) - (b.diff || 0))[0] || null;

    // 9. ข้อเสนอแนะเชิงลึก (Action Plans)
    const actionPlans: string[] = [];
    if (top3.length > 0) {
      actionPlans.push(
        `กิจกรรมคลินิกการเรียนรู้ (Peer Tutoring): ส่งเสริมผู้เรียนที่มีคะแนนสูงในวิชา ${top3[0].name} มาร่วมเป็นพี่เลี้ยงถ่ายทอดประสบการณ์`
      );
    }
    if (topDeclined && topDeclined.diff && topDeclined.diff < 0) {
      actionPlans.push(
        `ทบทวนหลังการปฏิบัติ (AAR): จัดประชุม AAR เข้มข้นในวิชา ${topDeclined.name} (ผลต่าง ${topDeclined.diff} คะแนน) เพื่อปรับแผนการสอน`
      );
    }
    if (bottom3.length > 0) {
      actionPlans.push(
        `โครงการเสริมทักษะเชิงปฏิบัติการ: เพิ่มชั่วโมงฝึกฝนและการติวเข้มในวิชา ${bottom3[0].name} ก่อนการประเมินรอบถัดไป`
      );
    }
    if (actionPlans.length === 0) {
      actionPlans.push("จัดกิจกรรมส่งเสริมการเรียนรู้อย่างต่อเนื่อง และติดตามผลการเรียนรู้รายวิชาเป็นประจำ");
    }

    res.status(200).json({
      success: true,
      isActive: true,
      course: {
        id: targetCourse.course_id,
        name: targetCourse.course_name,
        year: targetCourse.curriculum_year,
        isActive: true
      },
      batches: activeBatches.map((b: any) => ({
        id: b.batch_id,
        name: b.batch_name,
        startDate: b.start_date,
        endDate: b.end_date
      })),
      totalAvg,
      subjects: subjectList,
      top3,
      bottom3,
      topImproved: topImproved && (topImproved.diff || 0) > 0 ? { name: topImproved.name, diff: topImproved.diff } : null,
      topDeclined: topDeclined && (topDeclined.diff || 0) < 0 ? { name: topDeclined.name, diff: topDeclined.diff } : null,
      actionPlans,
      availableCourses
    });
  } catch (error: any) {
    console.error("Error getTrainingSummary:", error);
    res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการดึงข้อมูลสรุปการฝึกอบรม" });
  }
};
