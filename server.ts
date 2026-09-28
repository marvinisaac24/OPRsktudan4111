import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import mammoth from "mammoth";

async function parseUploadedDocument(fileData: string, fileName: string = "", mimeType: string = ""): Promise<{ text?: string; inlinePart?: { inlineData: { data: string; mimeType: string } } }> {
  const lowerName = fileName.toLowerCase();
  const isDocx = lowerName.endsWith(".docx") || lowerName.endsWith(".doc") || mimeType.includes("wordprocessingml") || mimeType.includes("msword");

  if (isDocx) {
    try {
      const buffer = Buffer.from(fileData, "base64");
      const result = await (mammoth as any).extractRawText({ buffer });
      if (result && result.value) {
        return { text: result.value };
      }
    } catch (e) {
      console.warn("Mammoth extraction warning:", e);
    }
  }

  const isPdf = lowerName.endsWith(".pdf") || mimeType === "application/pdf";
  if (isPdf) {
    return {
      inlinePart: {
        inlineData: {
          data: fileData,
          mimeType: "application/pdf",
        },
      },
    };
  }

  const isImage = mimeType.startsWith("image/") || lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg") || lowerName.endsWith(".png") || lowerName.endsWith(".webp");
  if (isImage) {
    return {
      inlinePart: {
        inlineData: {
          data: fileData,
          mimeType: mimeType || "image/jpeg",
        },
      },
    };
  }

  // Plain text fallback
  try {
    const text = Buffer.from(fileData, "base64").toString("utf-8");
    return { text };
  } catch {
    return { text: "" };
  }
}

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Kunci API Gemini tidak dijumpai dalam persekitaran (GEMINI_API_KEY missing).");
  }
  return new GoogleGenAI({ apiKey });
}

async function generateContentWithRetry(ai: GoogleGenAI, params: any) {
  const modelsToTry = ["gemini-3.8-flash", "gemini-2.5-flash-lite", "gemini-2.5-flash"];
  let lastError: any = null;

  for (const model of modelsToTry) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await ai.models.generateContent({
          ...params,
          model,
        });
        if (res && res.text) return res;
      } catch (err: any) {
        lastError = err;
        const msg = String(err?.message || "");
        const status = err?.status || "";
        const isQuotaOrDemand = msg.includes("429") || msg.includes("503") || status === "RESOURCE_EXHAUSTED" || status === "UNAVAILABLE" || msg.includes("quota") || msg.includes("high demand");

        if (isQuotaOrDemand && attempt === 0) {
          await new Promise(r => setTimeout(r, 1200));
          continue;
        }
        break; // try next model
      }
    }
  }
  throw lastError;
}

async function startServer() {
  const app = express();
  const defaultPort = 3000;
  const envPort = process.env.PORT ? parseInt(process.env.PORT, 10) : null;

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // 1. Analyze image for report
  app.post("/api/gemini/analyze-image", async (req, res) => {
    try {
      const { base64Image, mimeType } = req.body;
      if (!base64Image || !mimeType) {
        return res.status(400).json({ error: "base64Image dan mimeType diperlukan." });
      }

      const ai = getGeminiClient();
      const response = await generateContentWithRetry(ai, {
        contents: {
          parts: [
            {
              inlineData: {
                data: base64Image,
                mimeType: mimeType,
              },
            },
            {
              text: "Analyze this photo from a school event/program. Suggest content for a school report. Provide the response as a single valid JSON object with the following string keys: namaProgram, sasaran, objektif, anjuran, kekuatan, perkaraPerluPenambahbaikan, cadanganPenambahbaikan. Keep the suggestions concise and in Malay language. IMPORTANT: Do NOT use any line breaks or newlines within the string values. Format list items as '1. point. 2. point.' on a single continuous line. DO NOT include any base64 image data or extra text outside the JSON structure.",
            },
          ],
        },
        config: {
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              namaProgram: { type: Type.STRING, description: "Suggested name of the program" },
              sasaran: { type: Type.STRING, description: "Suggested target audience" },
              objektif: { type: Type.STRING, description: "Suggested objective of the program" },
              anjuran: { type: Type.STRING, description: "Suggested organizer" },
              kekuatan: { type: Type.STRING, description: "Suggested strengths of the program based on the photo" },
              perkaraPerluPenambahbaikan: { type: Type.STRING, description: "Suggested areas for improvement based on the photo" },
              cadanganPenambahbaikan: { type: Type.STRING, description: "Suggested recommendations for improvement" },
            },
          },
        },
      });

      if (response.text) {
        let jsonText = response.text;
        const match = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (match) {
          jsonText = match[1];
        }
        jsonText = jsonText.replace(/[\n\r\t]+/g, " ").trim();

        if (!jsonText.endsWith("}")) {
          const lastQuote = jsonText.lastIndexOf('"');
          if (lastQuote > 0 && jsonText.substring(lastQuote - 1, lastQuote) !== "\\") {
            jsonText = jsonText.substring(0, lastQuote) + '"}';
          } else {
            jsonText += '"}';
          }
        }

        try {
          const parsed = JSON.parse(jsonText);
          return res.json(parsed);
        } catch (e) {
          const namaProgramMatch = response.text.match(/"namaProgram"\s*:\s*"([^"]+)"/);
          const sasaranMatch = response.text.match(/"sasaran"\s*:\s*"([^"]+)"/);
          const objektifMatch = response.text.match(/"objektif"\s*:\s*"([^"]+)"/);
          if (namaProgramMatch || sasaranMatch || objektifMatch) {
            return res.json({
              namaProgram: namaProgramMatch ? namaProgramMatch[1] : "",
              sasaran: sasaranMatch ? sasaranMatch[1] : "",
              objektif: objektifMatch ? objektifMatch[1] : "",
              anjuran: "",
              kekuatan: "",
              perkaraPerluPenambahbaikan: "",
              cadanganPenambahbaikan: "",
            });
          }
          throw new Error("Gagal menghuraikan maklum balas AI.");
        }
      }

      res.status(500).json({ error: "Tiada respons daripada Gemini AI." });
    } catch (error: any) {
      console.error("Error in /api/gemini/analyze-image:", error);
      res.status(500).json({ error: error.message || "Ralat memproses gambar." });
    }
  });

  // 2. Generate single image description
  app.post("/api/gemini/image-description", async (req, res) => {
    try {
      const { base64Image, mimeType } = req.body;
      if (!base64Image || !mimeType) {
        return res.status(400).json({ error: "base64Image dan mimeType diperlukan." });
      }

      const ai = getGeminiClient();
      try {
        const response = await generateContentWithRetry(ai, {
          contents: {
            parts: [
              {
                inlineData: {
                  data: base64Image,
                  mimeType: mimeType,
                },
              },
              {
                text: "Beri SATU ayat ringkas (maksimum 12 patah perkataan) untuk menjelaskan tentang gambar aktiviti sekolah ini.",
              },
            ],
          },
        });

        if (response && response.text) {
          return res.json({ description: response.text.trim() });
        }
      } catch (geminiError: any) {
        console.warn("AI description fallback active:", geminiError?.message || geminiError);
        return res.json({ description: "Aktiviti murid dan warga sekolah semasa program dijalankan." });
      }

      return res.json({ description: "Aktiviti murid dan warga sekolah semasa program dijalankan." });
    } catch (error: any) {
      console.error("Error in /api/gemini/image-description:", error);
      return res.json({ description: "Aktiviti murid dan warga sekolah semasa program dijalankan." });
    }
  });

  // 3. Generate text suggestions for report fields
  app.post("/api/gemini/suggest-text", async (req, res) => {
    try {
      const { reportData, field } = req.body;
      const ai = getGeminiClient();

      const reportContext = `
Maklumat Program:
1. Nama Program: ${reportData?.namaProgram || "Belum diisi"}
2. Tarikh Pelaksanaan: ${reportData?.tarikhPelaksanaan || "Belum diisi"}
3. Sasaran: ${reportData?.sasaran || "Belum diisi"}
4. Anjuran: ${reportData?.anjuran || "Belum diisi"}
5. Objektif: ${reportData?.objektif || "Belum diisi"}
6. Penilaian Keberkesanan: ${reportData?.penilaianKeberkesanan || "Belum diisi"}
7. Kehadiran: ${reportData?.kehadiran || "Belum diisi"}
8. Kekuatan: ${reportData?.kekuatan || "Belum diisi"}
9. Perkara Perlu Penambahbaikan: ${reportData?.perkaraPerluPenambahbaikan || "Belum diisi"}
10. Cadangan Penambahbaikan: ${reportData?.cadanganPenambahbaikan || "Belum diisi"}
`;

      let prompt = `Berdasarkan maklumat penuh program sekolah berikut:\n${reportContext}\nSila jana isi penting bersesuaian dengan program ini sahaja. Kembalikan jawapan terus dalam bentuk senarai bernombor (1. [Poin pertama]\n2. [Poin kedua]\n3. [Poin ketiga]). PASTIKAN setiap poin dijana dalam bentuk SATU BARIS sahaja secara berterusan, tanpa sebarang pemisah baris (line break/enter) di tengah-tengah poin. Jangan masukkan sebarang teks pengenalan atau penutup.\n\nTugas: `;

      if (field === "objektif") {
        prompt += "Jana 3 objektif utama program ini dalam bentuk poin dan setiap poin adalah ayat yang pendek (maksimum 12 patah perkataan) dalam SATU BARIS sahaja.";
      } else if (field === "kekuatan") {
        prompt += "Jana 4 kekuatan utama program ini dalam bentuk ayat yang pendek (maksimum 12 patah perkataan) dalam SATU BARIS sahaja dalam bentuk poin.";
      } else if (field === "perkaraPerluPenambahbaikan" || field === "kelemahan") {
        prompt += "Jana 4 perkara yang perlu penambahbaikan pada masa akan datang dalam bentuk ayat yang pendek (maksimum 12 patah perkataan) dalam SATU BARIS sahaja dalam bentuk poin.";
      } else if (field === "cadanganPenambahbaikan") {
        prompt += "Jana 3 cadangan penambahbaikan untuk program ini dalam bentuk ayat yang pendek (maksimum 12 patah perkataan) dalam SATU BARIS sahaja dalam bentuk poin.";
      } else if (field === "penilaianKeberkesanan") {
        prompt += "Jana rumusan penilaian keberkesanan program ini dalam bentuk ayat padat atau peratusan penilaian (contohnya: 95% peserta menyatakan objektif tercapai, tahap kepuasan sangat tinggi, dan impak aktiviti amat berkesan).";
      }

      const response = await generateContentWithRetry(ai, {
        contents: prompt,
      });

      if (response.text) {
        return res.json({ suggestion: response.text.trim() });
      }

      res.status(500).json({ error: "Tiada respons cadangan daripada Gemini AI." });
    } catch (error: any) {
      console.error("Error in /api/gemini/suggest-text:", error);
      res.status(500).json({ error: error.message || "Ralat menjana cadangan teks." });
    }
  });

  // 4. Generate image
  app.post("/api/gemini/generate-image", async (req, res) => {
    try {
      const { prompt, aspectRatio, imageSize, isStudioQuality } = req.body;
      const ai = getGeminiClient();
      const modelName = isStudioQuality ? "gemini-3.1-flash-image" : "gemini-3.1-flash-lite-image";

      const response = await ai.models.generateContent({
        model: modelName,
        contents: {
          parts: [{ text: prompt }],
        },
        config: {
          imageConfig: {
            aspectRatio: aspectRatio || "1:1",
            imageSize: imageSize || "1K",
          },
        },
      });

      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          return res.json({ imageBase64: part.inlineData.data });
        }
      }

      res.status(500).json({ error: "Tiada gambar dijana." });
    } catch (error: any) {
      console.error("Error in /api/gemini/generate-image:", error);
      res.status(500).json({ error: error.message || "Ralat menjana gambar." });
    }
  });

  // 5. Edit image
  app.post("/api/gemini/edit-image", async (req, res) => {
    try {
      const { base64Image, mimeType, prompt, isStudioQuality } = req.body;
      const ai = getGeminiClient();
      const modelName = isStudioQuality ? "gemini-3.1-flash-image" : "gemini-3.1-flash-lite-image";

      const response = await ai.models.generateContent({
        model: modelName,
        contents: {
          parts: [
            {
              inlineData: {
                data: base64Image,
                mimeType: mimeType,
              },
            },
            { text: prompt },
          ],
        },
      });

      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          return res.json({ imageBase64: part.inlineData.data });
        }
      }

      res.status(500).json({ error: "Tiada gambar disunting." });
    } catch (error: any) {
      console.error("Error in /api/gemini/edit-image:", error);
      res.status(500).json({ error: error.message || "Ralat menyunting gambar." });
    }
  });

  // 6. Extract info from Program Working Paper (Kertas Kerja Program - PDF, Word, Image, Text)
  app.post("/api/gemini/extract-kertas-kerja", async (req, res) => {
    try {
      const { fileData, fileName, mimeType, textContent } = req.body;
      if (!fileData && !textContent) {
        return res.status(400).json({ error: "Fail kertas kerja atau teks diperlukan." });
      }

      const ai = getGeminiClient();
      const parts: any[] = [];

      if (fileData) {
        const parsed = await parseUploadedDocument(fileData, fileName || "", mimeType || "");
        if (parsed.inlinePart) {
          parts.push(parsed.inlinePart);
        } else if (parsed.text) {
          parts.push({ text: `Kandungan Dokumen Kertas Kerja:\n${parsed.text}` });
        }
      }

      if (textContent) {
        parts.push({ text: `Kandungan Tambahan / Teks Kertas Kerja:\n${textContent}` });
      }

      const prompt = `Anda adalah pembantu pengurusan program sekolah yang pakar.
Sila analisis dokumen Kertas Kerja Program / Cadangan Program ini dan ekstrak maklumat penting untuk Borang One Page Report (OPR) sekolah dalam Bahasa Melayu.

Sila kembalikan jawapan dalam format JSON dengan medan berikut (tiada medan lain, gunakan nilai kosong jika tiada):
{
  "namaProgram": "Nama penuh rasmi program (cth: Program Kem Kecemerlangan Akademik Tahun 6 2026)",
  "singkatanProgram": "Singkatan atau tajuk ringkas program (cth: KEM KECEMERLANGAN TAHUN 6)",
  "tarikhPelaksanaan": "Tarikh program dijalankan (cth: 15 Mac 2026 atau 15 - 17 Mac 2026)",
  "tempat": "Lokasi atau tempat program berlangsung (cth: Dewan Sri Tudan, SK Tudan)",
  "sasaran": "Kumpulan sasaran dan anggaran bilangan peserta (cth: Semua murid Tahun 6 seramai 120 orang)",
  "anjuran": "Pihak atau unit penganjur (cth: Unit Kurikulum dan Panitia Bahasa Melayu)",
  "objektif": "Objektif-objektif program dalam bentuk senarai bernombor (1. ... 2. ... 3. ...), ringkas dan padat setiap satu pada baris baharu.",
  "kekuatan": "Anggaran atau jangkaan kekuatan program yang dikenal pasti dalam kertas kerja (1. ... 2. ...)",
  "cadanganPenambahbaikan": "Cadangan penambahbaikan atau perhatian khas yang dirancang (1. ... 2. ...)"
}`;

      parts.push({ text: prompt });

      const response = await generateContentWithRetry(ai, {
        contents: { parts },
        config: {
          responseMimeType: "application/json",
        },
      });

      if (response.text) {
        try {
          const parsedJson = JSON.parse(response.text.trim());
          return res.json(parsedJson);
        } catch (parseErr) {
          console.warn("JSON parse retry on text:", response.text);
          let clean = response.text.trim();
          if (clean.startsWith("```json")) clean = clean.replace(/```json/g, "").replace(/```/g, "").trim();
          return res.json(JSON.parse(clean));
        }
      }

      res.status(500).json({ error: "Tiada data berjaya diekstrak daripada kertas kerja." });
    } catch (error: any) {
      console.error("Error in /api/gemini/extract-kertas-kerja:", error);
      res.status(500).json({ error: error.message || "Ralat memproses kertas kerja program." });
    }
  });

  // 7. Analyze Feedback Form (Borang Maklum Balas / Penilaian Peserta - PDF, Word, Image, Text)
  app.post("/api/gemini/analyze-feedback", async (req, res) => {
    try {
      const { fileData, fileName, mimeType, textContent, programContext } = req.body;
      if (!fileData && !textContent) {
        return res.status(400).json({ error: "Fail borang maklum balas atau teks diperlukan." });
      }

      const ai = getGeminiClient();
      const parts: any[] = [];

      if (fileData) {
        const parsed = await parseUploadedDocument(fileData, fileName || "", mimeType || "");
        if (parsed.inlinePart) {
          parts.push(parsed.inlinePart);
        } else if (parsed.text) {
          parts.push({ text: `Kandungan Borang Maklum Balas / Penilaian:\n${parsed.text}` });
        }
      }

      if (textContent) {
        parts.push({ text: `Kandungan Teks Maklum Balas:\n${textContent}` });
      }

      if (programContext) {
        parts.push({ text: `Konteks Maklumat Program:\n${programContext}` });
      }

      const prompt = `Anda adalah pegawai penilai kualiti dan penganalisis program sekolah yang pakar.
Sila analisis dokumen/fail Borang Maklum Balas, Rumusan Penilaian Peserta, atau Soal Selidik yang dimuat naik ini.

Tugas anda:
1. Jana 'penilaianKeberkesanan': Ringkasan tepat & komprehensif tentang penilaian keberkesanan program ini. Nyatakan peratusan kepuasan peserta (contoh: 94% atau 95%), tahap pencapaian objektif, maklum balas terhadap pengisian/penceramah/kemudahan, dan impak kepada peserta.
2. Jana 'cadanganPenambahbaikan': Daripada hasil penilaian keberkesanan dan kelemahan yang dikesan, jana cadangan penambahbaikan yang sangat sesuai, spesifik, dan praktikal untuk program ini pada masa akan datang. Formatkan sebagai senarai bernombor (1. ... 2. ... 3. ...).
3. Jana 'kekuatan': Kenal pasti aspek-aspek kekuatan program berdasarkan maklum balas positif dan skor tinggi peserta. Formatkan sebagai senarai bernombor (1. ... 2. ...).
4. Jana 'perkaraPerluPenambahbaikan': Kenal pasti aspek yang dikritik atau perlu diperbaiki berdasarkan maklum balas negatif atau skor rendah peserta. Formatkan sebagai senarai bernombor (1. ... 2. ...).

Kembalikan jawapan dalam format JSON sahaja:
{
  "penilaianKeberkesanan": "Sebanyak 95% peserta menilai program ini sebagai sangat berjaya dan mencapai objektif...",
  "cadanganPenambahbaikan": "1. Memanjangkan masa sesi bengkel praktikal.\\n2. Menyediakan modul bercetak lebih awal...",
  "kekuatan": "1. Penceramah jemputan sangat berpengalaman dan interaktif.\\n2. Penglibatan aktif semua peserta...",
  "perkaraPerluPenambahbaikan": "1. Tempoh masa aktiviti kumpulan agak terhad.\\n2. Sistem audio di dewan perlu dinaik taraf..."
}`;

      parts.push({ text: prompt });

      const response = await generateContentWithRetry(ai, {
        contents: { parts },
        config: {
          responseMimeType: "application/json",
        },
      });

      if (response.text) {
        try {
          const parsedJson = JSON.parse(response.text.trim());
          return res.json(parsedJson);
        } catch (parseErr) {
          let clean = response.text.trim();
          if (clean.startsWith("```json")) clean = clean.replace(/```json/g, "").replace(/```/g, "").trim();
          return res.json(JSON.parse(clean));
        }
      }

      res.status(500).json({ error: "Tiada data berjaya dianalisis daripada borang maklum balas." });
    } catch (error: any) {
      console.error("Error in /api/gemini/analyze-feedback:", error);
      res.status(500).json({ error: error.message || "Ralat menganalisis borang maklum balas." });
    }
  });

  // Vite middleware for development vs static files for production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(defaultPort, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${defaultPort}`);
  });

  if (envPort && envPort !== defaultPort && !isNaN(envPort)) {
    app.listen(envPort, "0.0.0.0", () => {
      console.log(`Server also running on http://0.0.0.0:${envPort}`);
    });
  }
}

startServer();
