import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import { z } from "zod";
import morgan, { compile } from "morgan";
import helmet from "helmet";
import cors from "cors";
import fs from "fs/promises";
import pool from "./db/dbconfig.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import transporter from "./email/emailConfig.js";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const env = process.env.NODE_ENV || "dev";
const envPath = path.resolve(__dirname, `.env.${env}`);

dotenv.config({ path: envPath });

app.use(bodyParser.json());
app.use(morgan("combined"));
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);
app.use(express.static(path.join(__dirname, "public")));

app.use(
  cors({
    origin: process.env.ORIGIN,
    // methods: "GET,POST",
    // allowedHeaders: "Content-Type",
  })
);

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", process.env.ORIGIN);
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  next();
});

const formSchema = z.object({
  fullName: z.string().min(1, "Full Name is required"),
  contact: z
    .string()
    .min(1, "Email Address or Phone Number is required")
    .email("Invalid email format"),
  message: z.string().min(1, "Message is required"),
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
  const query = "SELECT * FROM users WHERE email = ?";

  try {
    const connection = await pool.getConnection();
    try {
      const formData = loginSchema.parse(req.body);
      const [rows] = await connection.query(query, [formData.email]);
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
    } finally {
      connection.release();
    }
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

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "public/");
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}_${file.originalname}`);
  },
});

const fileFilter = (req, file, cb) => {
  const filetypes = /jpeg|jpg|png|gif|pdf/;
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = filetypes.test(file.mimetype);
  if (extname && mimetype) {
    return cb(null, true);
  } else {
    cb(new Error("Only images and PDFs are allowed"));
  }
};

const upload = multer({ storage, fileFilter }).fields([
  { name: "image", maxCount: 1 },
  { name: "pdfFile", maxCount: 1 },
]);

const uploadImageOnly = multer({ storage, fileFilter }).single("image");

const checkImageType = (req, res, next) => {
  if (typeof req.body.image === "string") {
    return next();
  }
  uploadImageOnly(req, res, next);
};

const schema = z.object({
  title: z.string().min(1, "Title is required"),
  content: z.string().min(1, "Content is required"),
  link: z.string().url("Link must be a valid URL"),
  category: z.enum(["d-only", "d-and-d"], "Category is required"),
  image: z.string().min(1, "Image path is required"),
});

const editSchema = z.object({
  title: z.string().min(1, "Title is required"),
  content: z.string().min(1, "Content is required"),
  link: z.string().url("Link must be a valid URL"),
  category: z.enum(["d-only", "d-and-d"], "Category is required"),
  image: z.string().min(1, "Image path is required"),
  id: z.string().min(1, "ID is required"),
});

app.post("/api/apps", uploadImageOnly, async (req, res) => {
  const query =
    "INSERT INTO ?? (title, content, link, category, image) VALUES (?, ?, ?, ?, ?)";

  try {
    const connection = await pool.getConnection();
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

      await connection.query(
        query,
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
    } finally {
      connection.release();
    }
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

app.post("/api/edit/apps", checkImageType, async (req, res) => {
  const query =
    "UPDATE ?? SET title = ?, content = ?, link = ?, category = ?, image = ? WHERE id = ?";
  try {
    const connection = await pool.getConnection();
    const { title, content, link, image, category, table, id } = req.body;
    const imageFile = req.file;

    try {
      const validatedData = editSchema.parse({
        title,
        content,
        link,
        category,
        image: imageFile ? `${imageFile.filename}` : image,
        id,
      });

      await connection.query(
        query,
        [
          table,
          validatedData.title,
          validatedData.content,
          validatedData.link,
          validatedData.category,
          validatedData.image,
          validatedData.id,
        ],
        (err, results) => {
          if (err) {
            console.error("Database update failed:", err.message);
            return res.status(500).json({ error: "Database update failed" });
          }

          if (results.affectedRows === 0) {
            return res.status(404).json({ error: "Record not found" });
          }

          res.json({ message: "Record updated successfully" });
        }
      );

      res.status(200).json({
        status: "success",
        message: "Project updated successfully!",
      });
    } finally {
      connection.release();
    }
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
  const query = "SELECT * FROM ??";
  try {
    const connection = await pool.getConnection();
    const tableName = req.query.db;
    try {
      if (!tableName) {
        return res
          .status(400)
          .json({ status: "fail", error: "Table name is required" });
      }
      const [results] = await connection.query(query, [tableName]);
      res.status(200).json({ status: "success", results });
    } finally {
      connection.release();
    }
  } catch (error) {
    res.status(500).json({ status: "fail", error: "Database query failed" });
  }
});

app.get("/api/edit/apps", async (req, res) => {
  const query = "SELECT * FROM ?? WHERE id = ?";
  try {
    const connection = await pool.getConnection();
    const tableName = req.query.db;
    const id = req.query.id;

    try {
      if (!tableName || !id) {
        return res
          .status(400)
          .json({ status: "fail", error: "Table or ID name is required" });
      }
      const [results] = await connection.query(query, [tableName, id]);
      res.status(200).json({ status: "success", results });
    } finally {
      connection.release();
    }
  } catch (error) {
    res.status(500).json({ status: "fail", error: "Database query failed" });
  }
});

const projectSchema = z.object({
  pdfFile: z.string().optional(),
  image: z.string().min(1, "Image path is required"),
});

const projectEditSchema = z.object({
  pdfFile: z.string().optional(),
  image: z.string().min(1, "Image path is required"),
  id: z.string().min(1, "ID is required"),
});

app.post("/api/projects", upload, async (req, res) => {
  const query = "INSERT INTO ?? (pdf, image) VALUES (?, ?)";
  try {
    const connection = await pool.getConnection();
    const { table } = req.body;
    const imageFile = req.files["image"] ? req.files["image"][0] : "";
    const pdfFile = req.files["pdfFile"] ? req.files["pdfFile"][0] : "";

    try {
      const validatedData = projectSchema.parse({
        pdfFile: pdfFile ? `${pdfFile.filename}` : "",
        image: imageFile ? `${imageFile.filename}` : "",
      });

      await connection.query(
        query,
        [table, validatedData.pdfFile, validatedData.image],
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
    } finally {
      connection.release();
    }
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

const checkFiles = (req, res, next) => {
  const { image, pdfFile } = req.body;

  if (typeof image === "string") {
    req.skipImage = true;
  }

  if (typeof pdfFile === "string") {
    req.skipPdf = true;
  }

  next();
};

const handleUpload = (req, res, next) => {
  checkFiles(req, res, () => {
    upload(req, res, (err) => {
      if (err) {
        return next(err);
      }
      next();
    });
  });
};

app.post("/api/edit/projects", handleUpload, async (req, res) => {
  const query = "UPDATE ?? SET pdf = ?, image = ? WHERE id = ?";
  try {
    const connection = await pool.getConnection();
    const { table, image, pdfFile, id } = req.body;
    const imageFile = req.files["image"]
      ? req.files["image"][0]
      : image
      ? image
      : "";
    const pdfFile2 = req.files["pdfFile"]
      ? req.files["pdfFile"][0]
      : pdfFile
      ? pdfFile
      : "";

    try {
      const validatedData = projectEditSchema.parse({
        pdfFile:
          typeof pdfFile2 !== "string" ? `${pdfFile2.filename}` : pdfFile2,
        image:
          typeof imageFile !== "string" ? `${imageFile.filename}` : imageFile,
        id,
      });

      await connection.query(
        query,
        [table, validatedData.pdfFile, validatedData.image, validatedData.id],
        (err, results) => {
          if (err) {
            console.error("Database update failed:", err);
            return res.status(500).json({ error: "Database update failed" });
          }

          if (results.affectedRows === 0) {
            return res.status(404).json({ error: "Record not found" });
          }

          res.json({ message: "Record updated successfully" });
        }
      );

      res.status(200).json({
        status: "success",
        message: "Project submitted successfully!",
      });
    } finally {
      connection.release();
    }
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
  const query = "SELECT * FROM ??";
  try {
    const connection = await pool.getConnection();
    const tableName = req.query.db;

    try {
      if (!tableName) {
        return res
          .status(400)
          .json({ status: "fail", error: "Table name is required" });
      }
      const [results] = await connection.query(query, [tableName]);
      res.status(200).json({ status: "success", results });
    } finally {
      connection.release();
    }
  } catch (error) {
    res.status(500).json({ status: "fail", error: "Database query failed" });
  }
});

app.get("/api/edit/projects", async (req, res) => {
  const query = "SELECT * FROM ?? WHERE id = ?";
  try {
    const connection = await pool.getConnection();
    const tableName = req.query.db;
    const id = req.query.id;

    try {
      if (!tableName) {
        return res
          .status(400)
          .json({ status: "fail", error: "Table name is required" });
      }
      const [results] = await connection.query(query, [tableName, id]);
      res.status(200).json({ status: "success", results });
    } finally {
      connection.release();
    }
  } catch (error) {
    res.status(500).json({ status: "fail", error: "Database query failed" });
  }
});

app.get("/api/projects/delete", async (req, res) => {
  const query = "DELETE FROM ?? WHERE id = ?";
  try {
    const connection = await pool.getConnection();
    const tableName = req.query.type;
    const id = req.query.id;

    try {
      if (!tableName) {
        return res
          .status(400)
          .json({ status: "fail", error: "Table name is required" });
      }
      const [results] = await connection.query(query, [tableName, id]);
      res.status(200).json({ status: "success", results });
    } finally {
      connection.release();
    }
  } catch (error) {
    res.status(500).json({ status: "fail", error: "Database query failed" });
  }
});

app.get("/", async (req, res) => {
  res.status(200).json({ status: "success", results });
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
