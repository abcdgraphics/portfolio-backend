import dotenv from "dotenv";
import express from "express";
import nodemailer from "nodemailer";
import bodyParser from "body-parser";
import { z } from "zod";
import morgan, { compile } from "morgan";
import helmet from "helmet";
import cors from "cors";
import fs from "fs/promises";
import db from "./db/dbconfig.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(bodyParser.json());
app.use(morgan("combined"));
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);
app.use(express.static(path.join(__dirname, "public")));
dotenv.config();

app.use(
  cors({
    origin: "http://localhost:5173",
    // methods: ["POST", "GET"],
    // allowedHeaders: ["Content-Type", "Authorization"],
  })
);

const formSchema = z.object({
  fullName: z.string().min(1, "Full Name is required"),
  contact: z
    .string()
    .min(1, "Email Address or Phone Number is required")
    .email("Invalid email format"),
  message: z.string().min(1, "Message is required"),
});

const transporter = nodemailer.createTransport({
  host: "srv571856.hstgr.cloud",
  port: 465,
  auth: {
    user: "hello@abcd.graphics",
    pass: `0k$I]NRN}LJU`,
  },
});

app.post("/api/send-mail", async (req, res) => {
  try {
    const formData = formSchema.parse(req.body);

    let emailTemplate = await fs.readFile("email/mail.html", "utf-8");
    emailTemplate = emailTemplate.replace("{{name}}", formData.fullName);

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: formData.contact,
      subject: "Thank you for your message!",
      html: emailTemplate,
    };

    await transporter.sendMail(mailOptions);

    res
      .status(200)
      .json({ status: "success", message: "Email sent successfully!" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        status: "fail",
        errors: error.errors.map((err) => ({
          field: err.path[0],
          message: err.message,
        })),
      });
    }

    if (error.response) {
      console.error("Error sending email:", error.response);
      return res.status(500).json({
        status: "error",
        message: "Failed to send email due to an external service error",
      });
    }

    console.error("Unexpected error:", error);
    res
      .status(500)
      .json({ status: "error", message: "An unexpected error occurred" });
  }
});

const loginSchema = z.object({
  email: z.string().min(1, "Email is required"),
  password: z.string().min(1, "Password is required"),
});

app.post("/api/login", async (req, res) => {
  console.log(process.env.NODE_ENV);
  try {
    const formData = loginSchema.parse(req.body);
    const [rows] = await db.query("SELECT * FROM users WHERE email = ?", [
      formData.email,
    ]);
    const user = rows[0];

    if (!user) {
      return res.status(400).json({
        status: "fail",
        errors: [{ field: "email", message: "User does not exist" }],
      });
    }

    const isPasswordValid = await bcrypt.compare(
      formData.password,
      user.password
    );

    if (!isPasswordValid) {
      return res.status(400).json({
        status: "fail",
        errors: [{ field: "password", message: "Incorrect password" }],
      });
    }

    const userData = {
      id: user.id,
      email: user.email,
    };

    const token = jwt.sign(userData, process.env.SECRET_KEY, {
      expiresIn: "1h",
    });

    res.status(200).json({
      status: "success",
      message: "Successfully Logged In!",
      token,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        status: "fail",
        errors: error.errors.map((err) => ({
          field: err.path[0],
          message: err.message,
        })),
      });
    }

    if (error.response) {
      console.error("Error Logging in:", error.response);
      return res.status(500).json({
        status: "error",
        message: "Failed to Login",
      });
    }

    console.error("Unexpected error:", error);
    res
      .status(500)
      .json({ status: "error", message: "An unexpected error occurred" });
  }
});

const upload = multer({
  dest: "public/",
});

const schema = z.object({
  title: z.string().min(1, "Title is required"),
  content: z.string().min(1, "Content is required"),
  link: z.string().url("Link must be a valid URL"),
  category: z.enum(["d-only", "d-and-d"], "Category is required"),
  image: z.string().min(1, "Image path is required"),
});

app.post("/api/apps", upload.single("image"), async (req, res) => {
  const { title, content, link, category, table } = req.body;
  const imageFile = req.file;
  try {
    const validatedData = schema.parse({
      title,
      content,
      link,
      category,
      image: imageFile ? `${imageFile.filename}` : "",
    });

    db.query(
      `INSERT INTO ?? (title, content, link, category, image) VALUES (?, ?, ?, ?, ?)`,
      [
        table,
        validatedData.title,
        validatedData.content,
        validatedData.link,
        validatedData.category,
        validatedData.image,
      ],
      (err, results) => {
        if (err) {
          console.error("Database insertion failed:", err.message);
          return res.status(500).json({ error: "Database insertion failed" });
        }
      }
    );

    res.status(200).json({
      status: "success",
      message: "Project submitted successfully!",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        status: "fail",
        errors: error.errors.map((err) => ({
          field: err.path[0],
          message: err.message,
        })),
      });
    }

    if (error.response) {
      console.error("Error Fetching Apps:", error.response);
      return res.status(500).json({
        status: "error",
        message: "Failed to Login",
      });
    }

    console.error("Unexpected error:", error);
    res
      .status(500)
      .json({ status: "error", message: "An unexpected error occurred" });
  }
});

app.get("/api/apps", async (req, res) => {
  const tableName = req.query.db;

  try {
    if (!tableName) {
      return res
        .status(400)
        .json({ status: "fail", error: "Table name is required" });
    }
    const [results] = await db.query(`SELECT * FROM ??`, [tableName]);
    res.status(200).json({ status: "success", results });
  } catch (error) {
    res.status(500).json({ status: "fail", error: "Database query failed" });
  }
});

const projectSchema = z.object({
  image: z.string().min(1, "Image path is required"),
});

app.post("/api/projects", upload.single("image"), async (req, res) => {
  const { table } = req.body;
  const imageFile = req.file;

  try {
    const validatedData = projectSchema.parse({
      image: imageFile ? `${imageFile.filename}` : "",
    });

    db.query(
      `INSERT INTO ?? (image) VALUES (?)`,
      [table, validatedData.image],
      (err, results) => {
        if (err) {
          console.error("Database insertion failed:", err);
          return res.status(500).json({ error: "Database insertion failed" });
        }
      }
    );

    res.status(200).json({
      status: "success",
      message: "Project submitted successfully!",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        status: "fail",
        errors: error.errors.map((err) => ({
          field: err.path[0],
          message: err.message,
        })),
      });
    }

    if (error.response) {
      console.error("Error Fetching Projects:", error.response);
      return res.status(500).json({
        status: "error",
        message: "Failed to Login",
      });
    }

    console.error("Unexpected error:", error);
    res
      .status(500)
      .json({ status: "error", message: "An unexpected error occurred" });
  }
});

app.get("/api/projects", async (req, res) => {
  const tableName = req.query.db;

  try {
    if (!tableName) {
      return res
        .status(400)
        .json({ status: "fail", error: "Table name is required" });
    }
    const [results] = await db.query(`SELECT * FROM ??`, [tableName]);
    res.status(200).json({ status: "success", results });
  } catch (error) {
    res.status(500).json({ status: "fail", error: "Database query failed" });
  }
});

app.all("*", (req, res) => {
  res.status(404).json({
    status: "fail",
    message: `Cannot find ${req.originalUrl} on this server`,
  });
});

app.use((err, req, res, next) => {
  console.error("Global error handler:", err);
  res.status(500).json({ status: "error", message: "Internal Server Error" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
