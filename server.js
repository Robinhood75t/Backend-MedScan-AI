const express = require("express");
const multer = require("multer");
const fs = require("fs");
const pdfparse = require("pdf-parse");
const Tesseract = require("tesseract.js");
const dotenv = require("dotenv");
const fetch = require("node-fetch");
const cors = require("cors");

dotenv.config();
const app = express();
app.use(cors());
const port = 5000;

const upload = multer({
    dest: "uploads/",
    limits: {fileSize: 5 * 1024 * 1024}
})

async function getperplexityapisummary(prompt){
    const response = await fetch("https://api.perplexity.ai/chat/completions" ,{
        method: "POST",
        headers: {
            "Content-Type" : "application/json",
            Authorization : `Bearer ${process.env.PERPLEXITY_API_KEY}`
        },
        body: JSON.stringify({
            model: "sonar-pro",
            messages:[
                {role : "system" , content: "you are a helpful medical assistant."},
                {role: "user" , content: prompt}
            ]
        })
    })

    if(!response.ok){
        const errtext = await response.text();
        throw new Error (`perplexity api error : ${errtext}`)
    }
    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || "";
}

app.post("/api/summarize" , upload.single("file") , async function(req,res){
    if(!req.file) {
        return res.status(400).json({ error: "no files are uploaded"});
    }

    let extractedtext = "";
    if(req.file.mimetype === "application/pdf"){
        const databuffer = fs.readFileSync(req.file.path);
        const pdfdata = await pdfparse(databuffer);
        extractedtext = pdfdata.data;
    }
    else if(req.file.mimetype.startsWith("image/")){
        const result = await Tesseract.recognize(req.file.path , "eng");
        extractedtext = result.data.text;
    }
    else{
        fs.unlinkSync(req.file.path);
        return res.status(400).json({error: "supports pdf & images only."})
    }

    fs.unlinkSync(req.file.path);
    if(!extractedtext.trim()){
        return res.status(400).json({ error: "Extracted text is not readable."})
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
    - Bold markers (**like this**) should NOT be included, just plain text.
    - No markdown formatting.
    
    === REPORT START ===
    ${extractedtext}
    === REPORT END ===
    `;

    let aitext = await getperplexityapisummary(prompt);

    let summary;
    try{
        summary = JSON.parse(aitext);
    }catch{
        summary = { summary : aitext};
    }
    res.json({ result: summary});
});

app.listen(port , function(){
    console.log(`server is running at : http://localhost:${port}/api/summarize`);
})
