const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs").promises;
const pdfParse = require("pdf-parse");
const Tesseract = require("tesseract.js");
const fetch = require("node-fetch");
const dotenv = require("dotenv");

dotenv.config();
const app = express();
const port = 5000;
app.use(cors());

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

async function getperplexityapisummary(prompt) {
  const response = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
    },
    body: JSON.stringify({
      model: "sonar-pro",
      messages: [
        { role: "system", content: "you are a helpful medical assistant." },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    const errtext = await response.text();
    throw new Error(`perplexity api error : ${errtext}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

app.post("/api/summarize", upload.single("file"), async function (req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "file is not supported." });
    }

    let extractedText = "";

    if (req.file.mimetype === "application/pdf") {
      const databuffer = await fs.readFile(req.file.path);
      const pdfdata = await pdfParse(databuffer);
      extractedText = pdfdata.text;
    } else if (req.file.mimetype.startsWith("image/")) {
      const result = await Tesseract.recognize(req.file.path, "eng");
      extractedText = result.data.text;
    } else {
      await fs.unlink(req.file.path);
      return res.status(400).json({ error: "only images and pdf are supported." });
    }

    await fs.unlink(req.file.path);

    if (!extractedText.trim()) {
      return res.status(400).json({ error: "not readable data is found" });
    }

    const prompt = `
You are a medical report summarization assistant.

Your task is to analyze the following medical report and return a well-structured JSON object.
=== OUTPUT FORMAT RULES ===
✅ Return ONLY valid JSON (no explanation, no backticks)
✅ Keys must be exactly this (case-sensitive):
{
    "Patient_Name": "",
    "Hospital_Or_Clinic": "",
    "Doctor_Name": "",
    "English_Summary": "",
    "Hindi_Summary": "",
    "Diagnosis": "",
    "Prescription": "",
    "Follow_Up": ""
}
        
=== CONTENT RULES ===
- Extract the patient name, hospital/clinic name, and doctor name if available.
- These three fields should be single lines, concise, and clearly identified.
- Write "Not Found" if unavailable.
- English_Summary: ~100 words, clear, easy to understand.
- Hindi_Summary: ~100 words, easy Hindi (Hinglish NOT allowed).
- Diagnosis: bullet points (max 3)
- Prescription: bullet points (medication name, dosage, frequency)
- Follow_Up: bullet points (tests, visits, precautions)
        
=== STYLE RULES ===
- Do NOT include paragraph formatting before JSON.
- No additional commentary.
- Bold markers (like this) should NOT be included, just plain text.
- No markdown formatting.
        
=== REPORT START ===
${extractedText}
=== REPORT END ===
`;

    let aitext = await getperplexityapisummary(prompt);

    let summary;
    try {
      summary = JSON.parse(aitext);
    } catch (err) {
      console.error("Failed to parse JSON from AI response:", aitext);
      summary = { summary: aitext };
    }
    res.json({ result: summary });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Server error occurred while processing the document. Please try again later." });
  }
});

app.listen(port, function () {
  console.log(`http://localhost:${port}/api/summarize`);
});
