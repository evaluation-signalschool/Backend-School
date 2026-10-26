-- ========================================================
-- Database Schema for Backend-School
-- Exported on: 2026-10-26T10:01:57.920Z
-- Database: defaultdb
-- ========================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = 'ANSI_QUOTES';

-- --------------------------------------------------------
-- Table structure for table `admin`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `admin`;
CREATE TABLE "admin" (
  "id" int NOT NULL AUTO_INCREMENT COMMENT 'รหัสลำดับ',
  "email" varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  "password" varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'รหัสผ่าน (เข้ารหัสด้วย bcrypt)',
  "created_at" timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'วันที่สร้างข้อมูล',
  "updated_at" timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'วันที่แก้ไขข้อมูลล่าสุด',
  "name" varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ผู้ดูแลระบบ',
  "role" varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'admin',
  "status" varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  "last_login_at" timestamp NULL DEFAULT NULL,
  "username" varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE KEY "uq_admin_username" ("username")
);

-- --------------------------------------------------------
-- Table structure for table `admin_activity_logs`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `admin_activity_logs`;
CREATE TABLE "admin_activity_logs" (
  "id" int NOT NULL AUTO_INCREMENT,
  "admin_id" int NOT NULL,
  "admin_name" varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  "admin_email" varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  "action" varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  "action_category" varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  "details" text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  "ip_address" varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  "created_at" timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  "admin_username" varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY ("id"),
  KEY "idx_logs_created_at" ("created_at"),
  KEY "idx_logs_admin_id" ("admin_id"),
  KEY "idx_logs_category" ("action_category")
);

-- --------------------------------------------------------
-- Table structure for table `course_batches`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `course_batches`;
CREATE TABLE "course_batches" (
  "id" int NOT NULL AUTO_INCREMENT COMMENT 'รหัสลำดับ',
  "course_id" int NOT NULL COMMENT 'รหัสอ้างอิงหลักสูตร (เชื่อมกับตาราง courses)',
  "batch_name" varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'ชื่อรุ่น เช่น รุ่นที่ 1',
  "start_date" date DEFAULT NULL COMMENT 'วันที่เริ่มต้นหลักสูตร',
  "end_date" date DEFAULT NULL COMMENT 'วันที่สิ้นสุดหลักสูตร',
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'วันที่สร้างข้อมูล',
  "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'วันที่แก้ไขข้อมูลล่าสุด',
  "is_active" tinyint(1) DEFAULT '1',
  "is_registration_open" tinyint(1) DEFAULT '0',
  PRIMARY KEY ("id"),
  KEY "course_id" ("course_id"),
  CONSTRAINT "course_batches_ibfk_1" FOREIGN KEY ("course_id") REFERENCES "courses" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- --------------------------------------------------------
-- Table structure for table `courses`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `courses`;
CREATE TABLE "courses" (
  "id" int NOT NULL AUTO_INCREMENT COMMENT 'รหัสลำดับ',
  "course_name" varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'ชื่อหลักสูตร',
  "curriculum_year" int NOT NULL COMMENT 'ปีหลักสูตร เช่น 2567, 2568, 2569',
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'วันที่สร้างข้อมูล',
  "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'วันที่แก้ไขข้อมูลล่าสุด',
  PRIMARY KEY ("id"),
  UNIQUE KEY "unique_course_year" ("course_name","curriculum_year")
);

-- --------------------------------------------------------
-- Table structure for table `evaluation_answers`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `evaluation_answers`;
CREATE TABLE "evaluation_answers" (
  "id" int NOT NULL AUTO_INCREMENT,
  "submission_id" int NOT NULL,
  "question_id" int NOT NULL,
  "score_value" int DEFAULT NULL,
  "comment" text,
  PRIMARY KEY ("id"),
  KEY "submission_id" ("submission_id"),
  KEY "question_id" ("question_id"),
  CONSTRAINT "evaluation_answers_ibfk_1" FOREIGN KEY ("submission_id") REFERENCES "evaluation_submissions" ("id") ON DELETE CASCADE,
  CONSTRAINT "evaluation_answers_ibfk_2" FOREIGN KEY ("question_id") REFERENCES "evaluation_questions" ("id")
);

-- --------------------------------------------------------
-- Table structure for table `evaluation_choices`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `evaluation_choices`;
CREATE TABLE "evaluation_choices" (
  "id" int NOT NULL AUTO_INCREMENT,
  "question_id" int NOT NULL,
  "choice_text" text NOT NULL,
  "score_value" int NOT NULL,
  "order_num" int NOT NULL,
  PRIMARY KEY ("id"),
  KEY "question_id" ("question_id"),
  CONSTRAINT "evaluation_choices_ibfk_1" FOREIGN KEY ("question_id") REFERENCES "evaluation_questions" ("id") ON DELETE CASCADE
);

-- --------------------------------------------------------
-- Table structure for table `evaluation_forms`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `evaluation_forms`;
CREATE TABLE "evaluation_forms" (
  "id" int NOT NULL AUTO_INCREMENT COMMENT 'รหัสลำดับ',
  "batch_id" int NOT NULL COMMENT 'เชื่อมกับตาราง course_batches (บอกว่าเป็นของรุ่นไหน)',
  "subject_id" int DEFAULT NULL COMMENT 'เชื่อมกับตาราง subjects (ใช้เฉพาะตอนประเมินรายวิชา ถ้าประเมินหลักสูตร/คณะกำกับฯ ให้ปล่อยเป็น NULL)',
  "target_group" varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'student',
  "evaluation_type" varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  "form_url" text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  "form_name" varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  "is_active" tinyint(1) DEFAULT '1' COMMENT 'สถานะ: 1 = เปิดใช้งาน, 0 = ปิดใช้งาน (เผื่อแอดมินซ่อนฟอร์ม)',
  "created_at" timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'วันที่สร้างข้อมูล',
  "updated_at" timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'วันที่แก้ไขข้อมูลล่าสุด',
  "form_description" text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY ("id"),
  KEY "batch_id" ("batch_id"),
  KEY "subject_id" ("subject_id"),
  CONSTRAINT "evaluation_forms_ibfk_1" FOREIGN KEY ("batch_id") REFERENCES "course_batches" ("id") ON DELETE CASCADE,
  CONSTRAINT "evaluation_forms_ibfk_2" FOREIGN KEY ("subject_id") REFERENCES "subjects" ("id") ON DELETE CASCADE
);

-- --------------------------------------------------------
-- Table structure for table `evaluation_questions`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `evaluation_questions`;
CREATE TABLE "evaluation_questions" (
  "id" int NOT NULL AUTO_INCREMENT,
  "form_id" int NOT NULL,
  "question_text" text NOT NULL,
  "question_type" varchar(50) DEFAULT 'choice',
  "order_num" int NOT NULL,
  "subject_for" int DEFAULT NULL,
  PRIMARY KEY ("id"),
  KEY "form_id" ("form_id"),
  CONSTRAINT "evaluation_questions_ibfk_1" FOREIGN KEY ("form_id") REFERENCES "evaluation_forms" ("id") ON DELETE CASCADE
);

-- --------------------------------------------------------
-- Table structure for table `evaluation_submissions`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `evaluation_submissions`;
CREATE TABLE "evaluation_submissions" (
  "id" int NOT NULL AUTO_INCREMENT,
  "student_id" varchar(50) DEFAULT NULL,
  "form_id" int NOT NULL,
  "instructor_name" text,
  "created_at" timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  "subject_id" int DEFAULT NULL,
  PRIMARY KEY ("id"),
  UNIQUE KEY "uniq_submission" ("student_id","form_id","subject_id"),
  KEY "form_id" ("form_id"),
  KEY "subject_id" ("subject_id"),
  CONSTRAINT "evaluation_submissions_ibfk_1" FOREIGN KEY ("form_id") REFERENCES "evaluation_forms" ("id"),
  CONSTRAINT "evaluation_submissions_ibfk_2" FOREIGN KEY ("subject_id") REFERENCES "subjects" ("id")
);

-- --------------------------------------------------------
-- Table structure for table `news`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `news`;
CREATE TABLE "news" (
  "id" int NOT NULL AUTO_INCREMENT,
  "title" varchar(255) NOT NULL,
  "description" text NOT NULL,
  "type" varchar(50) NOT NULL,
  "news_date" date DEFAULT NULL,
  "file_url" text,
  "file_name" varchar(500) DEFAULT NULL,
  "created_at" timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

-- --------------------------------------------------------
-- Table structure for table `profile_edit_requests`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `profile_edit_requests`;
CREATE TABLE "profile_edit_requests" (
  "id" int NOT NULL AUTO_INCREMENT,
  "student_id" int NOT NULL,
  "original_rank" varchar(255) DEFAULT NULL,
  "original_first_name" varchar(255) DEFAULT NULL,
  "original_last_name" varchar(255) DEFAULT NULL,
  "new_rank" varchar(255) DEFAULT NULL,
  "new_first_name" varchar(255) DEFAULT NULL,
  "new_last_name" varchar(255) DEFAULT NULL,
  "document_path" varchar(255) DEFAULT NULL,
  "status" enum('pending','approved','rejected') DEFAULT 'pending',
  "created_at" timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY ("id"),
  KEY "profile_edit_requests_ibfk_1" ("student_id"),
  CONSTRAINT "profile_edit_requests_ibfk_1" FOREIGN KEY ("student_id") REFERENCES "students" ("id") ON DELETE CASCADE
);

-- --------------------------------------------------------
-- Table structure for table `student_scores`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `student_scores`;
CREATE TABLE "student_scores" (
  "id" int NOT NULL AUTO_INCREMENT,
  "student_id" int NOT NULL,
  "setting_id" int NOT NULL COMMENT 'เชื่อมกับ subject_batch_settings',
  "raw_score" decimal(5,2) NOT NULL,
  "updated_at" timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY ("id"),
  UNIQUE KEY "unique_student_setting" ("student_id","setting_id"),
  KEY "setting_id" ("setting_id"),
  CONSTRAINT "student_scores_ibfk_1" FOREIGN KEY ("student_id") REFERENCES "students" ("id") ON DELETE CASCADE,
  CONSTRAINT "student_scores_ibfk_2" FOREIGN KEY ("setting_id") REFERENCES "subject_batch_settings" ("id") ON DELETE CASCADE
);

-- --------------------------------------------------------
-- Table structure for table `student_summary_scores`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `student_summary_scores`;
CREATE TABLE "student_summary_scores" (
  "id" int NOT NULL AUTO_INCREMENT COMMENT 'รหัสลำดับ',
  "batch_id" int NOT NULL COMMENT 'รหัสรุ่น (เชื่อมกับ course_batches)',
  "student_id" int NOT NULL COMMENT 'รหัสนักเรียน (เชื่อมกับ students)',
  "training_time_score" decimal(5,2) DEFAULT '0.00' COMMENT 'คะแนนเวลาการฝึก/เวลาเรียน',
  "exam_time_score" decimal(5,2) DEFAULT '0.00' COMMENT 'คะแนนเวลาการสอบ',
  "behavior_score" decimal(5,2) DEFAULT '0.00' COMMENT 'คะแนนความประพฤติ/ลักษณะทหาร',
  "created_at" timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'วันที่บันทึกคะแนน',
  "updated_at" timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'วันที่แก้ไขคะแนนล่าสุด',
  PRIMARY KEY ("id"),
  UNIQUE KEY "unique_student_batch" ("student_id","batch_id"),
  KEY "batch_id" ("batch_id"),
  CONSTRAINT "student_summary_scores_ibfk_1" FOREIGN KEY ("batch_id") REFERENCES "course_batches" ("id") ON DELETE CASCADE,
  CONSTRAINT "student_summary_scores_ibfk_2" FOREIGN KEY ("student_id") REFERENCES "students" ("id") ON DELETE CASCADE
);

-- --------------------------------------------------------
-- Table structure for table `students`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `students`;
CREATE TABLE "students" (
  "id" int NOT NULL AUTO_INCREMENT,
  "batch_id" int NOT NULL COMMENT 'เชื่อมกับตาราง course_batches (เรียนรุ่นไหน)',
  "student_code" varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'รหัสประจำตัวทหาร',
  "password" varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  "rank_name" varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'ยศ ',
  "first_name" varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'ชื่อจริง',
  "last_name" varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'นามสกุล',
  "affiliation" varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'สังกัด',
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "email" varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  "google_id" varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  "phone" varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  "profile_completed" tinyint(1) DEFAULT '0',
  "picture" varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY ("id"),
  KEY "batch_id" ("batch_id"),
  KEY "idx_students_google_id" ("google_id"),
  KEY "idx_students_email_batch" ("email","batch_id"),
  CONSTRAINT "students_ibfk_1" FOREIGN KEY ("batch_id") REFERENCES "course_batches" ("id") ON DELETE CASCADE
);

-- --------------------------------------------------------
-- Table structure for table `subject_batch_settings`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `subject_batch_settings`;
CREATE TABLE "subject_batch_settings" (
  "id" int NOT NULL AUTO_INCREMENT,
  "batch_id" int NOT NULL,
  "subject_id" int NOT NULL,
  "max_score" decimal(5,2) NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE KEY "unique_batch_subject" ("batch_id","subject_id"),
  KEY "subject_id" ("subject_id"),
  CONSTRAINT "subject_batch_settings_ibfk_1" FOREIGN KEY ("batch_id") REFERENCES "course_batches" ("id") ON DELETE CASCADE,
  CONSTRAINT "subject_batch_settings_ibfk_2" FOREIGN KEY ("subject_id") REFERENCES "subjects" ("id") ON DELETE CASCADE
);

-- --------------------------------------------------------
-- Table structure for table `subject_groups`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `subject_groups`;
CREATE TABLE "subject_groups" (
  "id" int NOT NULL AUTO_INCREMENT,
  "batch_id" int NOT NULL COMMENT 'เชื่อมกับตาราง course_batches (รุ่น)',
  "group_name" varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'ชื่อหมวดวิชา หรือ ชื่อวิชาหลัก',
  "credits" decimal(3,1) NOT NULL COMMENT 'จำนวนหน่วยกิตรวม',
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id"),
  KEY "batch_id" ("batch_id"),
  CONSTRAINT "subject_groups_ibfk_1" FOREIGN KEY ("batch_id") REFERENCES "course_batches" ("id") ON DELETE CASCADE
);

-- --------------------------------------------------------
-- Table structure for table `subject_score_submissions`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `subject_score_submissions`;
CREATE TABLE "subject_score_submissions" (
  "id" int NOT NULL AUTO_INCREMENT COMMENT 'รหัสลำดับ',
  "batch_id" int NOT NULL COMMENT 'รหัสอ้างอิงรุ่น (เชื่อมกับตาราง course_batches)',
  "subject_id" int NOT NULL COMMENT 'รหัสอ้างอิงรายวิชา (เชื่อมกับตาราง subjects)',
  "is_submitted" tinyint(1) DEFAULT '0' COMMENT 'สถานะการส่ง: 1 = ส่งแล้ว, 0 = ยังไม่ส่ง',
  "submitted_at" datetime DEFAULT NULL COMMENT 'วันและเวลาที่ติ๊กส่ง (อัปเดตเมื่อติ๊กถูก)',
  "note" text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT 'หมายเหตุเพิ่มเติม (เช่น ตรวจสอบเรียบร้อย, รอยืนยัน)',
  "created_at" timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'วันที่สร้างข้อมูล',
  "updated_at" timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'วันที่แก้ไขข้อมูลล่าสุด',
  PRIMARY KEY ("id"),
  UNIQUE KEY "uniq_batch_subject_submission" ("batch_id","subject_id"),
  KEY "subject_id" ("subject_id"),
  CONSTRAINT "subject_score_submissions_ibfk_1" FOREIGN KEY ("batch_id") REFERENCES "course_batches" ("id") ON DELETE CASCADE,
  CONSTRAINT "subject_score_submissions_ibfk_2" FOREIGN KEY ("subject_id") REFERENCES "subjects" ("id") ON DELETE CASCADE
);

-- --------------------------------------------------------
-- Table structure for table `subjects`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `subjects`;
CREATE TABLE "subjects" (
  "id" int NOT NULL AUTO_INCREMENT,
  "group_id" int NOT NULL COMMENT 'เชื่อมกับตาราง subject_groups',
  "subject_name" varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'ชื่อรายวิชาย่อย',
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "is_su" tinyint(1) DEFAULT '0',
  PRIMARY KEY ("id"),
  KEY "group_id" ("group_id"),
  CONSTRAINT "subjects_ibfk_1" FOREIGN KEY ("group_id") REFERENCES "subject_groups" ("id") ON DELETE CASCADE
);

-- --------------------------------------------------------
-- Table structure for table `training_summaries`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `training_summaries`;
CREATE TABLE "training_summaries" (
  "id" int NOT NULL AUTO_INCREMENT,
  "course_name" varchar(255) NOT NULL,
  "cohort_key" varchar(100) NOT NULL,
  "executive_summary" text,
  "action_plan" text,
  "updated_by" varchar(100) DEFAULT 'Admin',
  "created_at" timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY ("id"),
  UNIQUE KEY "uq_course_cohort" ("course_name","cohort_key")
);

SET FOREIGN_KEY_CHECKS = 1;
