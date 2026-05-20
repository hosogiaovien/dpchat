import express from "express";
import path from "path";
import multer from "multer";
import { google } from "googleapis";
import fs from "fs";
import os from "os";
import { createServer as createViteServer } from "vite";
import "dotenv/config";


// --- Configuration & Types ---
const PORT = 3000;
const IS_PROD = process.env.NODE_ENV === "production";

// --- Google Apps Script Helper ---
async function uploadToDrive(file: Express.Multer.File) {
  const appScriptUrl = process.env.APPS_SCRIPT_URL;

  if (!appScriptUrl) {
    console.warn("APPS_SCRIPT_URL not configured. Uploading might fail.");
    return null;
  }

  try {
    const base64 = file.buffer ? file.buffer.toString("base64") : fs.readFileSync(file.path).toString("base64");
    
    // Node.js fetch will automatically follow the 302 redirect 
    // that Google Apps Script Web Apps trigger structure.
    const response = await fetch(appScriptUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      redirect: "follow",
      body: JSON.stringify({
        base64: base64,
        mimeType: file.mimetype,
        fileName: file.originalname,
        folderId: process.env.DRIVE_FOLDER_ID
      }),
    });
    
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch(e) {
      throw new Error("Lỗi phản hồi từ Apps Script không phải format JSON. Chi tiết mã lỗi: " + text.substring(0, 500));
    }
    
    if (data.error) {
      throw new Error("Lỗi từ Google Drive: " + data.error);
    }
    
    let processedUrl = data.url;
    console.log("Original Drive URL:", processedUrl);
    
    // Attempt to convert Google Drive URL to an embeddable tag
    const match = processedUrl.match(/\/d\/(.+?)\//);
    if (match && match[1]) {
      processedUrl = `https://drive.google.com/uc?export=view&id=${match[1]}`;
    } else if (processedUrl.includes('id=')) {
      try {
        const urlObj = new URL(processedUrl);
        const fileId = urlObj.searchParams.get('id');
        if (fileId) {
          processedUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;
        }
      } catch(e) {}
    }
    
    console.log("Processed embeddable URL:", processedUrl);
    return processedUrl;
  } catch (error) {
    console.error("Error uploading via Apps Script:", error);
    throw error;
  }
}

// --- Express App Setup ---
async function startServer() {
  const app = express();

  const storage = multer.memoryStorage();

  const upload = multer({ storage: storage });

  app.use(express.json());
  
  // Remove static serving of uploads since we use memory storage

  // API: Get health
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // API: Proxy image from Drive
  app.get("/api/image", async (req, res) => {
    try {
      let fileId = req.query.id as string;
      const url = req.query.url as string;
      
      if (!fileId && url) {
        const match = url.match(/\/d\/(.+?)\//);
        if (match && match[1]) {
          fileId = match[1];
        } else if (url.includes('id=')) {
          try {
            const urlObj = new URL(url);
            fileId = urlObj.searchParams.get('id') || "";
          } catch(e) {}
        }
      }

      if (!fileId) {
        return res.status(400).send("No file ID provided");
      }

      const driveUrl = `https://drive.google.com/uc?export=download&confirm=t&id=${fileId}`;
      const response = await fetch(driveUrl);

      if (!response.ok) {
        return res.status(response.status).send('Error loading image from Drive');
      }

      const contentType = response.headers.get('content-type');
      if (contentType) {
        res.setHeader('Content-Type', contentType);
      }
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      
      if (response.body) {
        const { Readable } = require('stream');
        // @ts-ignore
        Readable.fromWeb(response.body).pipe(res);
      } else {
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        res.send(buffer);
      }
    } catch (error) {
      console.error("Image proxy error:", error);
      res.status(500).send('Error proxying image');
    }
  });

  // API: Upload image
  app.post("/api/upload", upload.single("image"), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    try {
      const driveUrl = await uploadToDrive(req.file);
      
      if (!driveUrl) {
        // Mock URL if Drive is not configured
        const mockUrl = "https://placehold.co/600x400?text=Drive+Not+Configured";
        return res.json({ url: mockUrl });
      }

      res.json({ url: driveUrl });
    } catch (error: any) {
      console.error("Upload route error:", error);
      res.status(500).json({ error: error.message || "Failed to upload image" });
    }
  });

  // API: Delete image/video
  app.post("/api/delete", async (req, res) => {
    try {
      const url = req.body.url;
      if (!url) return res.status(400).send("No URL");

      let fileId = "";
      const matchD = url.match(/\/d\/(.+?)\//);
      if (matchD && matchD[1]) fileId = matchD[1];
      else {
        const matchId = url.match(/id=([^&]+)/);
        if (matchId) fileId = matchId[1];
      }

      console.log("Attempting to delete Drive file:", fileId);
      
      const appScriptUrl = process.env.APPS_SCRIPT_URL;
      if (appScriptUrl && fileId) {
        // We tell Apps Script to delete the file
        const r = await fetch(appScriptUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          redirect: "follow",
          body: JSON.stringify({ action: "delete", fileId })
        });
        const result = await r.text();
        console.log("Delete response from script:", result.substring(0, 200));
        try {
          const jsonResponse = JSON.parse(result);
          if (jsonResponse.error) {
            console.error("Apps Script Error:", jsonResponse.error);
            return res.status(500).json({ success: false, error: jsonResponse.error });
          }
        } catch(e) {}
      }
      res.json({ success: true });
    } catch(err) {
      console.error("Delete proxy error:", err);
      res.status(500).send("Delete proxy error");
    }
  });

  // Vite / Static Assets
  if (!IS_PROD) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Only serve static files if not on Vercel serverless (where Vercel handles static routing via vercel.json)
    if (!process.env.VERCEL) {
      const distPath = path.join(process.cwd(), "dist");
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }
  }

  if (process.env.NODE_ENV !== "test" && !process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }

  return app;
}

const appPromise = startServer();
// For Vercel Serverless
export default async (req: any, res: any) => {
  const app = await appPromise;
  app(req, res);
};
