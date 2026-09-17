import express from "express";
import cors from "cors"; // 1. Import cors เข้ามา
import courseRoutes from "./routes/course.route";
import authRoutes from "./routes/auth.route"; // Import routes สำหรับ auth]
import scoreRoutes from "./routes/score.route"; // Import routes สำหรับ score
import dropdownRoutes from "./routes/dropdown.route"; // Import routes สำหรับ dropdown
import studentRoute from "./routes/student.route";
import evaluationRouter from "./routes/evaluation.route";
import profileEditRoutes from "./routes/profileEdit.route";
import newsRoutes from "./routes/news.route";
import securityTestRoutes from "./routes/security-test.route";
import adminUserRoutes from "./routes/admin-user.route";
import adminLogRoutes from "./routes/admin-log.route";
const app = express();

// 2. เรียกใช้ middleware cors ก่อนที่จะเรียก routes
// (อนุญาตให้ทุกโดเมนสามารถเรียก API นี้ได้)
app.use(cors());

// Middleware สำหรับอ่าน JSON
app.use(express.json());

// Serve static files from uploads folder
app.use("/uploads", express.static("uploads"));

// Routes
app.use("/api", courseRoutes);
app.use("/api", authRoutes); // ถ้าคุณมี route สำหรับ auth
app.use("/api", scoreRoutes); // เพิ่ม route สำหรับ score
app.use("/api", dropdownRoutes); // เพิ่ม route สำหรับ dropdown
app.use("/api", studentRoute);
app.use("/api", evaluationRouter);
app.use("/api", profileEditRoutes);
app.use("/api", newsRoutes);
app.use("/api", securityTestRoutes);
app.use("/api", adminUserRoutes);
app.use("/api", adminLogRoutes);

export default app;
