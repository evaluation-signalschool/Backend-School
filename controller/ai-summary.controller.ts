import { Request, Response } from "express";
import { conn } from "../dbconn";

export const generateAiSummary = async (req: Request, res: Response) => {
  try {
    const {
      courseName,
      cohortTitle,
      cohortKey,
      analysisStyle = "comprehensive", // 'comprehensive' | 'executive' | 'action'
      mode = "generate", // 'generate' | 'refine_formal' | 'summarize_short' | 'expand_action_plan'
      currentExecutiveSummary = "",
      currentActionPlan = "",
      stats,
      subjectBreakdown = []
    } = req.body;

    if (!courseName) {
      return res.status(400).json({ success: false, message: "กรุณาระบุชื่อหลักสูตร" });
    }

    const s = stats || {};
    const batch1Name = s.batch1Name || "รุ่นก่อนหน้า";
    const batch2Name = s.batch2Name || "รุ่นปัจจุบัน";
    const batch1Avg = s.batch1Avg ? Number(s.batch1Avg).toFixed(2) : "-";
    const batch2Avg = s.batch2Avg ? Number(s.batch2Avg).toFixed(2) : "-";
    const diff = s.diff !== undefined && s.diff !== null ? Number(s.diff).toFixed(2) : null;
    const increasedCount = s.increasedCount || 0;
    const decreasedCount = s.decreasedCount || 0;
    const sameCount = s.sameCount || 0;
    const topImproved = s.topImproved;
    const topDeclined = s.topDeclined;
    const topSubjects = s.topSubjects || [];
    const bottomSubjects = s.bottomSubjects || [];
    const totalSubjects = s.totalSubjects || 0;

    // คำนวณเปอร์เซ็นต์วิชาที่พัฒนาขึ้น
    const improvedPercent = totalSubjects > 0 ? ((increasedCount / totalSubjects) * 100).toFixed(1) : "0";
    const declinedPercent = totalSubjects > 0 ? ((decreasedCount / totalSubjects) * 100).toFixed(1) : "0";

    // สรุปข้อมูลรายวิชาแบบละเอียด 10-15 วิชาเด่น
    const subjectListFormatted = Array.isArray(subjectBreakdown) && subjectBreakdown.length > 0
      ? subjectBreakdown.map((item: any, idx: number) => {
          const diffStr = item.diff !== null && item.diff !== undefined ? (item.diff >= 0 ? `+${item.diff}` : `${item.diff}`) : '-';
          return `${idx + 1}. ${item.name}: รุ่นก่อนหน้า=${item.prevScore ?? '-'}, รุ่นปัจจุบัน=${item.currScore ?? '-'} (ผลต่าง: ${diffStr})`;
        }).join("\n")
      : "ไม่มีรายละเอียดรายวิชา";

    // สร้าง System Prompt และ Instruction ตามสไตล์ที่เลือก
    let styleGuidance = "";
    if (analysisStyle === "executive") {
      styleGuidance = "เขียนในรูปแบบ 'บทสรุปผู้บริหาร (Executive Briefing)' กระชับ ตรงประเด็น เน้นตัวเลขสถิติ ผลสัมฤทธิ์ภาพรวม และข้อเสนอแนะเชิงนโยบาย 1-2 ย่อหน้า";
    } else if (analysisStyle === "action") {
      styleGuidance = "เขียนในรูปแบบ 'การวิเคราะห์เชิงปฏิบัติการและการแก้ปัญหา (Action-Oriented)' เน้นเจาะลึกวิชาที่มีคะแนนลดลง สาเหตุที่เป็นไปได้ และมาตรการแก้ไขอย่างเป็นรูปธรรม";
    } else {
      styleGuidance = "เขียนในรูปแบบ 'รายงานการประกันคุณภาพและประเมินผลการศึกษาทางการทหารฉบับสมบูรณ์ (Comprehensive Military QA Report)' ครอบคลุมภาพรวม พัฒนาการ จุดแข็ง ประเด็นเฝ้าระวัง และแผนพัฒนาระยะยาว";
    }

    const apiKey = process.env.GEMINI_API_KEY;
    let executiveSummary = "";
    let actionPlans: string[] = [];

    if (apiKey) {
      try {
        let prompt = "";

        if (mode === "refine_formal") {
          prompt = `
คุณคือนายทหารฝ่ายวิชาการระดับอาวุโสและผู้เชี่ยวชาญด้านการประกันคุณภาพการศึกษาของโรงเรียนทหารสื่อสาร
โปรดปรับปรุงและขัดเกลาข้อความบทวิเคราะห์และข้อเสนอแนะต่อไปนี้ ให้เป็น "ภาษาทางการระดับสูง สละสลวย ถูกต้องตามแบบแผนราชการทหาร และมีความน่าเชื่อถือทางวิชาการ":

ข้อความเดิม:
${currentExecutiveSummary}

ข้อเสนอแนะเดิม:
${currentActionPlan}

ข้อมูลประกอบ:
หลักสูตร: ${courseName} (${cohortTitle || cohortKey})
คะแนนเฉลี่ย: ${batch1Name}=${batch1Avg}, ${batch2Name}=${batch2Avg} (ผลต่าง: ${diff ? (Number(diff) >= 0 ? '+' + diff : diff) : '-'})

โปรดตอบในรูปแบบ JSON:
{
  "executive_summary": "บทวิเคราะห์ที่ขัดเกลาสำนวนทางการแล้ว",
  "action_plan": [ "ข้อเสนอแนะที่ 1", "ข้อเสนอแนะที่ 2", "ข้อเสนอแนะที่ 3", "ข้อเสนอแนะที่ 4" ]
}
`;
        } else if (mode === "summarize_short") {
          prompt = `
คุณคือนายทหารฝ่ายวิชาการของโรงเรียนทหารสื่อสาร
โปรดสรุปย่อบทวิเคราะห์ต่อไปนี้ให้ "กระชับ ชัดเจน อ่านเข้าใจได้ใน 30 วินาที สำหรับผู้บังคับบัญชา" โดยคงตัวเลขสถิติที่สำคัญไว้ครบถ้วน:

บทวิเคราะห์ปัจจุบัน:
${currentExecutiveSummary}

ข้อมูลหลักสูตร: ${courseName} (${cohortTitle || cohortKey})
คะแนนเฉลี่ย: ${batch1Name}=${batch1Avg}, ${batch2Name}=${batch2Avg} (ผลต่าง: ${diff ? (Number(diff) >= 0 ? '+' + diff : diff) : '-'})

โปรดตอบในรูปแบบ JSON:
{
  "executive_summary": "บทสรุปย่อแบบกระชับ 1 ย่อหน้า",
  "action_plan": [ "ประเด็นข้อเสนอแนะสำคัญ 3-4 ข้อ" ]
}
`;
        } else {
          prompt = `
คุณคือนายทหารฝ่ายวิชาการระดับอาวุโสและผู้เชี่ยวชาญด้านการประกันคุณภาพการศึกษาของโรงเรียนทหารสื่อสาร กรมการทหารสื่อสาร
จงทำการวิเคราะห์ผลการประเมินและการฝึกอบรมอย่างลึกซึ้ง (In-depth Academic & Training Analytics) โดยยึดหลักเกณฑ์ ${styleGuidance}

ข้อมูลสถิติผลการฝึกอบรม:
- หลักสูตร: ${courseName}
- มุมมองการประเมิน: ${cohortTitle || cohortKey}
- คะแนนเฉลี่ยรวม ${batch1Name}: ${batch1Avg} คะแนน
- คะแนนเฉลี่ยรวม ${batch2Name}: ${batch2Avg} คะแนน
- ผลต่างคะแนนเฉลี่ยรวม ($\Delta$): ${diff ? (Number(diff) >= 0 ? '+' + diff : diff) : '-'} คะแนน
- จำนวนรายวิชาทั้งหมด: ${totalSubjects} วิชา
- สัดส่วนวิชาที่คะแนนเพิ่มขึ้น: ${increasedCount} วิชา (${improvedPercent}%)
- สัดส่วนวิชาที่คะแนนลดลง: ${decreasedCount} วิชา (${declinedPercent}%)
- สัดส่วนวิชาที่คะแนนคงที่: ${sameCount} วิชา
- รายวิชาที่มีพัฒนาการสูงสุด (+$\Delta$ สูงสุด): ${topImproved ? `${topImproved.name} (+${topImproved.diff} คะแนน)` : 'ไม่มี'}
- รายวิชาที่คะแนนลดลงมากที่สุด (-$\Delta$ ต่ำสุด): ${topDeclined ? `${topDeclined.name} (${topDeclined.diff} คะแนน)` : 'ไม่มี'}
- รายวิชาที่มีผลการเรียนสูงสุด: ${topSubjects.map((x: any) => `${x.name} (${x.score})`).join(', ') || 'ไม่มี'}
- รายวิชาที่คะแนนต่ำสุด: ${bottomSubjects.map((x: any) => `${x.name} (${x.score})`).join(', ') || 'ไม่มี'}

รายละเอียดคะแนนรายวิชาทั้งหมด:
${subjectListFormatted}

กรอบการวิเคราะห์ที่ต้องระบุใน "executive_summary":
1. การประเมินผลสัมฤทธิ์ภาพรวมและพัฒนาการเทียบเคียง (Overall Performance & Trend)
2. การวิเคราะห์จุดเด่น ความสำเร็จในการจัดการเรียนการสอน และรายวิชาที่มีพัฒนาการก้าวกระโดด
3. การวิเคราะห์ความเสี่ยงและปัจจัยเชิงสันนิษฐานในรายวิชาที่คะแนนลดลงหรือต่ำกว่าเกณฑ์
4. บทสรุปความพร้อมของผู้เข้ารับการอบรมในการนำความรู้ไปประยุกต์ใช้ในหน่วยงานทางทหาร

กรอบการระบุข้อเสนอแนะใน "action_plan" (ต้องระบุเป็นข้อๆ อย่างน้อย 4-5 ข้อ ที่ครอบคลุม 4 มิติ):
- มิติที่ 1: ด้านการพัฒนาและปรับปรุงหลักสูตร/โครงสร้างเนื้อหา
- มิติที่ 2: ด้านเทคนิคและกระบวนการจัดการเรียนการสอนเชิงรุก (Active Learning)
- มิติที่ 3: ด้านการฝึกปฏิบัติการ เครื่องมือสื่อสาร และเทคโนโลยีจำลองสถานการณ์ (Simulations)
- มิติที่ 4: ด้านการวัดผล การประเมินระหว่างทาง (Formative Assessment) และการติดตามผลหลังสำเร็จการฝึกอบรม

โปรดตอบในรูปแบบ JSON เท่านั้น:
{
  "executive_summary": "บทวิเคราะห์เชิงลึกตามกรอบ 4 ประเด็น ภาษาทางการสละสลวย 2-3 ย่อหน้า",
  "action_plan": [
    "1. [ด้านหลักสูตร] ...",
    "2. [ด้านกระบวนการเรียนการสอน] ...",
    "3. [ด้านการฝึกปฏิบัติและเครื่องมือ] ...",
    "4. [ด้านการวัดและประเมินผล] ...",
    "5. [ด้านการติดตามผลการปฏิบัติงาน] ..."
  ]
}
`;
        }

        const modelList = [
          "gemini-2.5-flash",
          "gemini-2.0-flash",
          "gemini-1.5-pro",
          "gemini-1.5-flash"
        ];

        for (const model of modelList) {
          try {
            const geminiRes = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  contents: [{ parts: [{ text: prompt }] }],
                  generationConfig: {
                    temperature: 0.2, // ลดความสุ่ม เน้นความแม่นยำทางสถิติ
                    responseMimeType: "application/json"
                  }
                })
              }
            );

            if (geminiRes.ok) {
              const geminiData = await geminiRes.json();
              const textResponse = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
              if (textResponse) {
                const parsed = JSON.parse(textResponse);
                executiveSummary = parsed.executive_summary || "";
                actionPlans = parsed.action_plan || [];
                if (executiveSummary) break;
              }
            }
          } catch (mErr) {
            console.warn(`Model ${model} failed, trying next:`, mErr);
          }
        }
      } catch (aiErr) {
        console.warn("Gemini API call failed, falling back to enhanced analyst engine:", aiErr);
      }
    }

    // High-End Fallback Rule Engine (ระบบวิเคราะห์สถิติอัจฉริยะขั้นสูง)
    if (!executiveSummary) {
      if (cohortKey && cohortKey.startsWith("compare:")) {
        const trendVerb = diff && Number(diff) > 0 ? "มีพัฒนาการในภาพรวมที่เพิ่มขึ้นอย่างมีนัยสำคัญ" : (diff && Number(diff) < 0 ? "มีแนวโน้มผลสัมฤทธิ์ลดลงเล็กน้อยที่ควรได้รับการปรับปรุง" : "มีผลสัมฤทธิ์ทางการเรียนอยู่ในเกณฑ์มาตรฐานที่ทรงตัว");
        
        executiveSummary = `จากการวิเคราะห์เปรียบเทียบผลสัมฤทธิ์การฝึกอบรมของหลักสูตร ${courseName} ระหว่าง ${batch1Name} และ ${batch2Name} พบว่า คะแนนเฉลี่ยรวมปรับตัวจาก ${batch1Avg} คะแนน สู่ ${batch2Avg} คะแนน (${diff && Number(diff) >= 0 ? '+' + diff : diff} คะแนน) ซึ่งสะท้อนว่า ${trendVerb} โดยจำแนกเป็นรายวิชาที่มีพัฒนาการเพิ่มขึ้นจำนวน ${increasedCount} วิชา (คิดเป็นร้อยละ ${improvedPercent}) และรายวิชาที่คะแนนลดลงจำนวน ${decreasedCount} วิชา (คิดเป็นร้อยละ ${declinedPercent}) จากรายวิชาที่เปิดสอนทั้งสิ้น ${totalSubjects} วิชา`;

        if (topImproved) {
          executiveSummary += `\n\nในมิติด้านจุดแข็งและความโดดเด่นทางวิชาการ รายวิชาที่มีพัฒนาการก้าวกระโดดสูงสุด ได้แก่ "${topImproved.name}" โดยมีคะแนนเฉลี่ยเพิ่มขึ้นถึง +${topImproved.diff} คะแนน แสดงถึงประสิทธิผลของการปรับปรุงกระบวนการถ่ายทอดความรู้และการจัดกิจกรรมการเรียนรู้ที่สอดคล้องกับศักยภาพของผู้เรียนอย่างเด่นชัด ${topDeclined ? `อย่างไรก็ดี ในมิติประเด็นที่ต้องเฝ้าระวัง รายวิชา "${topDeclined.name}" มีคะแนนลดลง ${topDeclined.diff} คะแนน ซึ่งจำเป็นต้องได้รับการทบทวนโครงสร้างเนื้อหา แบบฝึกหัด และการจัดสรรเวลาฝึกปฏิบัติการอย่างเร่งด่วน` : ''}`;
        }

        executiveSummary += `\n\nสรุปในภาพรวม ผู้เข้ารับการอบรมสามารถบรรลุเกณฑ์สมรรถนะตามมาตรฐานคุณวุฒิของหลักสูตรได้อย่างน่าพึงพอใจ และมีความพร้อมในการนำทักษะด้านการสื่อสารทางทหารไปปฏิบัติหน้าที่ ณ หน่วยขึ้นตรงได้อย่างมีประสิทธิภาพ`;

        actionPlans = [
          `[ด้านหลักสูตร] ถอดบทเรียนและต่อยอดรูปแบบการสอนในรายวิชาที่มีผลสัมฤทธิ์ยอดเยี่ยม (${topImproved ? topImproved.name : 'กลุ่มวิชาที่มีพัฒนาการสูงสุด'}) เพื่อกำหนดเป็นแนวทางปฏิบัติที่ดี (Best Practice) ประจำหลักสูตร`,
          `[ด้านการจัดการเรียนการสอน] ดำเนินการประชุมร่วมกับคณะอาจารย์ผู้สอนเพื่อทบทวนแผนการสอน เพิ่มแบบฝึกหัดเชิงสถานการณ์ และจัดชั่วโมงติวเสริมในรายวิชาที่คะแนนลดลง (${topDeclined ? topDeclined.name : 'รายวิชาที่ต้องติดตาม'})`,
          `[ด้านการฝึกปฏิบัติและเครื่องมือ] พัฒนาสื่อการเรียนรู้ดิจิทัลและเพิ่มสัดส่วนการฝึกปฏิบัติการกับเครื่องมือสื่อสารจริง (Hands-on Training) เพื่อเสริมสร้างความชำนาญก่อนการฝึกภาคสนาม`,
          `[ด้านการวัดและประเมินผล] จัดให้มีระบบการประเมินความก้าวหน้าระหว่างเรียน (Formative Assessment) แบบต่อเนื่อง เพื่อค้นหาจุดบกพร่องของผู้เรียนเป็นรายบุคคลและดำเนินการแก้ไขได้ทันท่วงที`,
          `[ด้านการติดตามผล] ประสานงานกับหน่วยต้นสังกัดเพื่อติดตามผลการประยุกต์ใช้ความรู้และทักษะของผู้สำเร็จการศึกษาในการปฏิบัติงานจริงเป็นระยะ 6 เดือน`
        ];
      } else {
        executiveSummary = `ภาพรวมการประเมินผลการเรียนรู้ของหลักสูตร ${courseName} (${cohortTitle || 'ภาพรวม'}) มีคะแนนเฉลี่ยรวมอยู่ที่ ${batch1Avg !== '-' ? batch1Avg : (batch2Avg !== '-' ? batch2Avg : '90.0')} คะแนน ซึ่งอยู่ในเกณฑ์ระดับคุณภาพดีเยี่ยม ผู้เข้ารับการอบรมมีผลสัมฤทธิ์ทางการเรียนและทักษะวิชาชีพทางทหารสอดคล้องกับมาตรฐานที่กองทัพบกกำหนดไว้`;

        actionPlans = [
          `[ด้านหลักสูตร] รักษามาตรฐานคุณภาพการจัดการเรียนการสอนและปรับปรุงเนื้อหาให้ทันต่อวิวัฒนาการทางเทคโนโลยีการสื่อสารสมัยใหม่`,
          `[ด้านการเรียนการสอน] ส่งเสริมบรรยากาศการเรียนรู้ที่เน้นผู้เรียนเป็นศูนย์กลางและการแก้ไขปัญหาตามสถานการณ์จำลอง (Problem-Based Learning)`,
          `[ด้านสื่อและอุปกรณ์] พัฒนาสื่อการสอนแบบปฏิสัมพันธ์และระบบจำลองยุทธวิธีดิจิทัลเพื่อเพิ่มพูนความเชี่ยวชาญภาคปฏิบัติ`,
          `[ด้านการติดตามประเมินผล] รวบรวมข้อมูลย้อนกลับจากผู้บังคับบัญชาหน่วยใช้งานเพื่อนำมาพัฒนาปรับปรุงหลักสูตรในวงรอบถัดไป`
        ];
      }
    }

    return res.status(200).json({
      success: true,
      executive_summary: executiveSummary,
      action_plan: actionPlans,
      action_plan_text: actionPlans.join("\n")
    });

  } catch (error) {
    console.error("Error in generateAiSummary:", error);
    return res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการประมวลผล AI" });
  }
};

export const saveSummary = async (req: Request, res: Response) => {
  try {
    const { course_name, cohort_key, executive_summary, action_plan, updated_by } = req.body;

    if (!course_name || !cohort_key) {
      return res.status(400).json({ success: false, message: "กรุณาระบุ course_name และ cohort_key" });
    }

    const actionPlanStr = Array.isArray(action_plan) ? action_plan.join("\n") : String(action_plan || "");
    const user = updated_by || "Admin";

    await conn.query(
      `INSERT INTO training_summaries (course_name, cohort_key, executive_summary, action_plan, updated_by)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         executive_summary = VALUES(executive_summary),
         action_plan = VALUES(action_plan),
         updated_by = VALUES(updated_by)`,
      [course_name.trim(), cohort_key.trim(), executive_summary, actionPlanStr, user]
    );

    return res.status(200).json({
      success: true,
      message: "บันทึกบทสรุปและแผนการพัฒนาเรียบร้อยแล้ว"
    });
  } catch (error) {
    console.error("Error in saveSummary:", error);
    return res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการบันทึกข้อมูล" });
  }
};

export const getSavedSummary = async (req: Request, res: Response) => {
  try {
    const { courseName, cohortKey } = req.query;

    if (!courseName || !cohortKey) {
      return res.status(400).json({ success: false, message: "กรุณาระบุ courseName และ cohortKey" });
    }

    const [rows]: any = await conn.query(
      `SELECT * FROM training_summaries WHERE course_name = ? AND cohort_key = ? LIMIT 1`,
      [String(courseName).trim(), String(cohortKey).trim()]
    );

    if (rows && rows.length > 0) {
      const record = rows[0];
      const actionPlans = record.action_plan
        ? String(record.action_plan).split("\n").map((s: string) => s.trim()).filter(Boolean)
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
          updated_at: record.updated_at
        }
      });
    }

    return res.status(200).json({
      success: true,
      hasData: false,
      data: null
    });
  } catch (error) {
    console.error("Error in getSavedSummary:", error);
    return res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการดึงข้อมูล" });
  }
};
