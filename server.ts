import app from "./app";
import { checkConnection } from "./dbconn";

// กำหนด Port (จะดึงจาก .env ก็ได้ หรือใช้ 3000 เป็นค่าตั้งต้น)
const PORT = process.env.PORT || 3000;

// 🛡️ ตรวจสอบตัวแปรความปลอดภัยที่จำเป็น
if (!process.env.JWT_SECRET) {
  console.warn("⚠️ [Security Warning] ไม่พบ JWT_SECRET ใน .env กำลังใช้ค่าเริ่มต้น กรุณาตั้งค่าเพื่อความปลอดภัยสูงสุด");
} else {
  console.log("🔒 [Security] โหลด JWT_SECRET จาก .env เรียบร้อย");
}

checkConnection().then(() => {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
});
