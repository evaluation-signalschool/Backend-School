import { Request, Response } from "express";
import { conn } from "../dbconn";

export const generateAiSummary = async (req: Request, res: Response) => {
  try {
    const {
      courseName,
      cohortTitle,
      cohortKey,
      analysisStyle = "comprehensive",
      mode = "generate",
      currentExecutiveSummary = "",
      currentActionPlan = "",
      userApiKey = "",
      stats,
      subjectBreakdown = [],
    } = req.body;

    if (!courseName) {
      return res
        .status(400)
        .json({ success: false, message: "กรุณาระบุชื่อหลักสูตร" });
    }

    const s = stats || {};
    const batch1Name = s.batch1Name || "รุ่นก่อนหน้า";
    const batch2Name = s.batch2Name || "รุ่นปัจจุบัน";
    const batch1Avg = s.batch1Avg ? Number(s.batch1Avg).toFixed(2) : "-";
    const batch2Avg = s.batch2Avg ? Number(s.batch2Avg).toFixed(2) : "-";
    const diff =
      s.diff !== undefined && s.diff !== null
        ? Number(s.diff).toFixed(2)
        : null;
    const increasedCount = Number(s.increasedCount) || 0;
    const decreasedCount = Number(s.decreasedCount) || 0;
    const sameCount = Number(s.sameCount) || 0;
    const topImproved = s.topImproved;
    const topDeclined = s.topDeclined;
    const topSubjects = s.topSubjects || [];
    const bottomSubjects = s.bottomSubjects || [];
    const totalSubjects = Number(s.totalSubjects) || 0;

    const improvedPercent =
      totalSubjects > 0
        ? ((increasedCount / totalSubjects) * 100).toFixed(1)
        : "0";
    const declinedPercent =
      totalSubjects > 0
        ? ((decreasedCount / totalSubjects) * 100).toFixed(1)
        : "0";

    let executiveSummary = "";
    let actionPlans: string[] = [];

    const isCompare = cohortKey && cohortKey.startsWith("compare:");
      const trendVerb =
        diff && Number(diff) > 0
          ? "มีพัฒนาการในภาพรวมที่เพิ่มขึ้นอย่างชัดเจน"
          : diff && Number(diff) < 0
            ? "มีแนวโน้มผลสัมฤทธิ์ลดลงเล็กน้อยที่ควรได้รับการทบทวน"
            : "มีผลสัมฤทธิ์ทางการเรียนอยู่ในเกณฑ์มาตรฐานที่ทรงตัว";

      let breakdownDesc = "";
      if (isCompare) {
        if (increasedCount === 0 && decreasedCount === 0 && totalSubjects > 0) {
          breakdownDesc = `ทั้งนี้ เนื่องจาก ${batch2Name} มีการปรับปรุงโครงสร้างรายวิชาใหม่ จึงมีการประเมินผลสัมฤทธิ์บนเกณฑ์ของรายวิชาตามหลักสูตรปัจจุบัน`;
        } else {
          breakdownDesc = `โดยจำแนกเป็นรายวิชาที่มีพัฒนาการเพิ่มขึ้นจำนวน ${increasedCount} วิชา (${improvedPercent}%) และรายวิชาที่คะแนนลดลงจำนวน ${decreasedCount} วิชา (${declinedPercent}%) จากรายวิชาทั้งหมด ${totalSubjects} วิชา`;
        }
      }

      if (mode === "summarize_short" || analysisStyle === "executive") {
        if (isCompare) {
          executiveSummary = `บทสรุปผู้บริหาร: ผลการเปรียบเทียบการฝึกอบรมหลักสูตร ${courseName} ระหว่าง ${batch1Name} (${batch1Avg} คะแนน) และ ${batch2Name} (${batch2Avg} คะแนน) มีผลต่างคะแนนเฉลี่ยรวมอยู่ที่ ${diff && Number(diff) >= 0 ? "+" + diff : diff} คะแนน ซึ่งสะท้อนว่า ${trendVerb} ${breakdownDesc} ผู้เข้ารับการอบรมมีความพร้อมในการปฏิบัติภารกิจทางทหารตามมาตรฐานหลักสูตร`;
        } else {
          executiveSummary = `บทสรุปผู้บริหาร: ภาพรวมผลการประเมินการฝึกอบรมหลักสูตร ${courseName} (${cohortTitle || "ภาพรวม"}) มีคะแนนเฉลี่ยรวม ${batch1Avg !== "-" ? batch1Avg : batch2Avg !== "-" ? batch2Avg : "90.0"} คะแนน บรรลุเกณฑ์มาตรฐานคุณภาพการศึกษาทางทหารในระดับดีเยี่ยม`;
        }

        actionPlans = [
          `รักษามาตรฐานและถอดบทเรียนความสำเร็จเพื่อถ่ายทอดเป็นแนวทางปฏิบัติที่ดี (Best Practice)`,
          `ติดตามประเมินผลสัมฤทธิ์และการประยุกต์ใช้ทักษะของกำลังพลในการปฏิบัติหน้าที่ ณ หน่วยต้นสังกัด`,
          `ประสานงานปรับปรุงสื่อการสอนและเครื่องมือสื่อสารให้พร้อมรองรับเทคโนโลยีทางทหารยุคใหม่`,
        ];
      } else if (analysisStyle === "action") {
        if (isCompare) {
          executiveSummary = `รายงานการวิเคราะห์เชิงปฏิบัติการและการแก้ปัญหา (Action Analysis): จากการประเมินเปรียบเทียบผลการฝึกอบรมหลักสูตร ${courseName} ระหว่าง ${batch1Name} และ ${batch2Name} พบผลต่างคะแนนเฉลี่ยรวม ${diff && Number(diff) >= 0 ? "+" + diff : diff} คะแนน (ปรับตัวจาก ${batch1Avg} สู่ ${batch2Avg} คะแนน) ${breakdownDesc}\n\nเพื่อยกระดับผลสัมฤทธิ์ทางการศึกษา ฝ่ายวิชาการจึงได้กำหนดมาตรการเชิงรุกในการติดตามและปรับปรุงกระบวนการเรียนรู้ ${topDeclined ? `โดยเฉพาะในรายวิชา "${topDeclined.name}" (${topDeclined.diff} คะแนน) ที่ต้องได้รับการจัดสรรเวลาฝึกปฏิบัติเพิ่มเติม` : "ในกลุ่มวิชาที่ต้องการการส่งเสริม"}`;
        } else {
          executiveSummary = `รายงานการวิเคราะห์เชิงปฏิบัติการ: หลักสูตร ${courseName} มีคะแนนเฉลี่ยรวม ${batch1Avg !== "-" ? batch1Avg : "90.0"} คะแนน ฝ่ายวิชาการได้มุ่งเน้นการพัฒนาระบบการเรียนรู้เชิงรุก (Active Learning) เพื่อเสริมสร้างทักษะการปฏิบัติงานจริงของกำลังพลสื่อสาร`;
        }

        actionPlans = [
          `[มาตรการเร่งด่วน] จัดการประชุมเชิงปฏิบัติการร่วมกับอาจารย์ผู้สอนเพื่อปรับปรุงแผนการสอนและเพิ่มแบบฝึกหัดเชิงสถานการณ์`,
          `[การเสริมทักษะ] จัดชั่วโมงติวเสริม (Remedial Classes) และเพิ่มการฝึกปฏิบัติการจริงกับยุทโธปกรณ์สื่อสาร`,
          `[การประเมินระหว่างทาง] นำระบบ Formative Assessment มาใช้ทดสอบย่อยเพื่อค้นหาจุดบกพร่องของผู้เรียนรายบุคคล`,
          `[การกำกับดูแล] ติดตามผลการเรียนรู้รายสัปดาห์และรายงานต่อผู้บังคับบัญชาเพื่อปรับแผนการฝึกได้อย่างทันท่วงที`,
        ];
      } else {
        if (isCompare) {
          executiveSummary = `จากการวิเคราะห์เปรียบเทียบผลสัมฤทธิ์การฝึกอบรมของหลักสูตร ${courseName} ระหว่าง ${batch1Name} และ ${batch2Name} พบว่า คะแนนเฉลี่ยรวมปรับตัวจาก ${batch1Avg} คะแนน สู่ ${batch2Avg} คะแนน (${diff && Number(diff) >= 0 ? "+" + diff : diff} คะแนน) ซึ่งสะท้อนว่า ${trendVerb} ${breakdownDesc}`;

          if (topImproved) {
            executiveSummary += `\n\nในมิติด้านจุดแข็งและความโดดเด่นทางวิชาการ รายวิชาที่มีพัฒนาการก้าวกระโดดสูงสุด ได้แก่ "${topImproved.name}" โดยมีคะแนนเฉลี่ยเพิ่มขึ้นถึง +${topImproved.diff} คะแนน แสดงถึงประสิทธิผลของการปรับปรุงกระบวนการถ่ายทอดความรู้และการจัดกิจกรรมการเรียนรู้ที่สอดคล้องกับศักยภาพของผู้เรียนอย่างเด่นชัด ${topDeclined ? `ขณะเดียวกัน ในมิติประเด็นที่ต้องเฝ้าระวัง รายวิชา "${topDeclined.name}" (${topDeclined.diff} คะแนน) จำเป็นต้องได้รับการทบทวนโครงสร้างเนื้อหาและการจัดสรรเวลาฝึกปฏิบัติการเพิ่มเติม` : ""}`;
          }

          executiveSummary += `\n\nสรุปในภาพรวม ผู้เข้ารับการอบรมสามารถบรรลุเกณฑ์สมรรถนะตามมาตรฐานคุณวุฒิของหลักสูตรได้อย่างน่าพึงพอใจ และมีความพร้อมในการนำทักษะด้านการสื่อสารทางทหารไปปฏิบัติหน้าที่ ณ หน่วยขึ้นตรงได้อย่างมีประสิทธิภาพ`;
        } else {
          executiveSummary = `ภาพรวมการประเมินผลการเรียนรู้ของหลักสูตร ${courseName} (${cohortTitle || "ภาพรวม"}) มีคะแนนเฉลี่ยรวมอยู่ที่ ${batch1Avg !== "-" ? batch1Avg : batch2Avg !== "-" ? batch2Avg : "90.0"} คะแนน ซึ่งอยู่ในเกณฑ์ระดับคุณภาพดีเยี่ยม ผู้เข้ารับการอบรมมีผลสัมฤทธิ์ทางการเรียนและทักษะวิชาชีพทางทหารสอดคล้องกับมาตรฐานที่กองทัพบกกำหนดไว้`;
        }

        actionPlans = [
          `[ด้านหลักสูตร] ถอดบทเรียนและต่อยอดรูปแบบการสอนในรายวิชาที่มีผลสัมฤทธิ์ยอดเยี่ยม (${topImproved ? topImproved.name : "กลุ่มวิชาที่มีพัฒนาการสูงสุด"}) เพื่อกำหนดเป็นแนวทางปฏิบัติที่ดี (Best Practice)`,
          `[ด้านการจัดการเรียนการสอน] ดำเนินการประชุมร่วมกับคณะอาจารย์ผู้สอนเพื่อทบทวนแผนการสอน เพิ่มแบบฝึกหัดเชิงสถานการณ์ และจัดชั่วโมงฝึกปฏิบัติเข้มข้น`,
          `[ด้านการฝึกปฏิบัติและเครื่องมือ] พัฒนาสื่อการเรียนรู้ดิจิทัลและเพิ่มสัดส่วนการฝึกปฏิบัติการกับเครื่องมือสื่อสารจริง (Hands-on Training)`,
          `[ด้านการวัดและประเมินผล] จัดให้มีระบบการประเมินความก้าวหน้าระหว่างเรียน (Formative Assessment) แบบต่อเนื่องเพื่อแก้ไขจุดบกพร่องได้ทันท่วงที`,
          `[ด้านการติดตามผล] ประสานงานกับหน่วยต้นสังกัดเพื่อติดตามผลการปฏิบัติงานจริงของกำลังพลในระยะ 6 เดือน`,
        ];
      }

    return res.status(200).json({
      success: true,
      executive_summary: executiveSummary,
      action_plan: actionPlans,
      action_plan_text: actionPlans.join("\n"),
    });
  } catch (error) {
    console.error("Error in generateAiSummary:", error);
    return res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการประมวลผลบทสรุป" });
  }
};

export const saveSummary = async (req: Request, res: Response) => {
  try {
    const {
      course_name,
      cohort_key,
      executive_summary,
      action_plan,
      updated_by,
    } = req.body;

    if (!course_name || !cohort_key) {
      return res
        .status(400)
        .json({
          success: false,
          message: "กรุณาระบุ course_name และ cohort_key",
        });
    }

    const actionPlanStr = Array.isArray(action_plan)
      ? action_plan.join("\n")
      : String(action_plan || "");
    const user = updated_by || "Admin";

    await conn.query(
      `INSERT INTO training_summaries (course_name, cohort_key, executive_summary, action_plan, updated_by)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         executive_summary = VALUES(executive_summary),
         action_plan = VALUES(action_plan),
         updated_by = VALUES(updated_by)`,
      [
        course_name.trim(),
        cohort_key.trim(),
        executive_summary,
        actionPlanStr,
        user,
      ],
    );

    return res.status(200).json({
      success: true,
      message: "บันทึกบทสรุปและแผนการพัฒนาเรียบร้อยแล้ว",
    });
  } catch (error) {
    console.error("Error in saveSummary:", error);
    return res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการบันทึกข้อมูล" });
  }
};

export const getSavedSummary = async (req: Request, res: Response) => {
  try {
    const { courseName, cohortKey } = req.query;

    if (!courseName || !cohortKey) {
      return res
        .status(400)
        .json({
          success: false,
          message: "กรุณาระบุ courseName และ cohortKey",
        });
    }

    const [rows]: any = await conn.query(
      `SELECT * FROM training_summaries WHERE course_name = ? AND cohort_key = ? LIMIT 1`,
      [String(courseName).trim(), String(cohortKey).trim()],
    );

    if (rows && rows.length > 0) {
      const record = rows[0];
      const actionPlans = record.action_plan
        ? String(record.action_plan)
            .split("\n")
            .map((s: string) => s.trim())
            .filter(Boolean)
        : [];

      return res.status(200).json({
        success: true,
        hasData: true,
        data: {
          id: record.id,
          course_name: record.course_name,
          cohort_key: record.cohort_key,
          executive_summary: record.executive_summary,
          action_plan: actionPlans,
          action_plan_text: record.action_plan,
          updated_by: record.updated_by,
          updated_at: record.updated_at,
        },
      });
    }

    return res.status(200).json({
      success: true,
      hasData: false,
      data: null,
    });
  } catch (error) {
    console.error("Error in getSavedSummary:", error);
    return res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการดึงข้อมูล" });
  }
};
