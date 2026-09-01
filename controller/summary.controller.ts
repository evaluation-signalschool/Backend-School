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
      if (avg >= 4.50) level = "มากที่สุด";
      else if (avg >= 3.50) level = "มาก";
      else if (avg >= 2.50) level = "ปานกลาง";
      else if (avg >= 1.50) level = "พอใช้";

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
    // D. Course Results (evaluation_type = 'course')
    // ==========================================
    const courseMap: any = {};
    const courseForms = forms.filter((f: any) => f.evaluation_type === 'course');

    courseForms.forEach((form: any) => {
      const key = `${form.form_id}`;
      if (!courseMap[key]) {
        courseMap[key] = {
          curriculumName: "หลักสูตรทั้งหมด",
          year: 2567, // you can fetch from courses table if needed
          courseName: form.form_name,
          scores: [],
          totalScore: 0,
          scoreCount: 0
        };
      }
      
      const formSubs = submissions.filter((s: any) => s.form_id === form.form_id);
      formSubs.forEach((sub: any) => {
        const subAnswers = answers.filter((a: any) => a.submission_id === sub.submission_id);
        subAnswers.forEach((a: any) => {
          courseMap[key].scores.push(Number(a.score_value));
          courseMap[key].totalScore += Number(a.score_value);
          courseMap[key].scoreCount += 1;
        });
      });
    });

    const courseResults = Object.values(courseMap).map((c: any) => {
      const avg = c.scoreCount > 0 ? (c.totalScore / c.scoreCount) : 0;
      let level = "ปรับปรุง";
      if (avg >= 4.51) level = "มากที่สุด";
      else if (avg >= 3.51) level = "มาก";
      else if (avg >= 2.51) level = "ปานกลาง";
      else if (avg >= 1.51) level = "พอใช้";

      return {
        ...c,
        averageScore: Number(avg.toFixed(2)),
        level
      };
    });

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
