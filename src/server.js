require('dotenv').config();
const express = require('express');
const path = require('path');
const { OpenAI } = require('openai');
const multer = require('multer');
const fs = require('fs');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Check if OpenAI API key is set
if (!process.env.OPENAI_API_KEY) {
  console.error('DEBUG: OpenAI API key is not set in .env file');
} else {
  console.log('DEBUG: OpenAI API key is set');
}

const app = express();
const PORT = process.env.PORT || 3000;

// Set up storage for multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Create uploads directory if it doesn't exist
    const dir = './uploads';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
      console.log('DEBUG: Created uploads directory');
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const filename = 'audio-' + Date.now() + '.webm';
    console.log(`DEBUG: Generated filename for upload: ${filename}`);
    cb(null, filename);
  }
});

const upload = multer({ storage: storage });

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Main route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Transcription endpoint
app.post('/transcribe', upload.single('audio'), async (req, res) => {
  console.log('DEBUG: Received transcription request');
  
  try {
    if (!req.file) {
      console.error('DEBUG: No audio file in request');
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const audioFilePath = req.file.path;
    console.log(`DEBUG: Audio file saved to ${audioFilePath}`);
    
    const fileStats = fs.statSync(audioFilePath);
    const fileSizeInBytes = fileStats.size;
    console.log(`DEBUG: Audio file size: ${fileSizeInBytes} bytes`);
    
    // Skip very small files (likely noise or silence)
    if (fileSizeInBytes < 1000) {
      console.log('DEBUG: File too small, skipping transcription');
      fs.unlinkSync(audioFilePath);
      return res.json({ text: '' });
    }

    console.log('DEBUG: Calling OpenAI transcription API');
    // Call OpenAI transcription API
    try {
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(audioFilePath),
        model: "gpt-4o-transcribe",
        temperature: 0.0,  // Reduce temperature for more deterministic results
        language: "en",    // Default to English for better accuracy
      });
      
      console.log(`DEBUG: Transcription received: "${transcription.text}"`);

      // Delete the file after transcription
      fs.unlinkSync(audioFilePath);
      console.log('DEBUG: Deleted audio file after transcription');

      // Return the transcription
      return res.json({ 
        text: transcription.text.trim(),
        complete: true 
      });
    } catch (openaiError) {
      console.error('DEBUG: OpenAI API error:', openaiError);
      
      // Check if it's an authentication error
      if (openaiError.message && openaiError.message.includes('API key')) {
        console.error('DEBUG: Authentication error - check your OpenAI API key');
      }
      
      throw openaiError;
    }
  } catch (error) {
    console.error('DEBUG: Transcription error:', error);
    
    // Remove the file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
      console.log('DEBUG: Deleted audio file after error');
    }
    
    res.status(500).json({ error: 'Failed to transcribe audio', message: error.message });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log('DEBUG: Server started and ready to accept connections');
}); 