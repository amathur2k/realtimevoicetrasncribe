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
    
    // Set up a promise with timeout
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('OpenAI API request timed out')), 25000);
    });
    
    try {
      // Race the OpenAI call with a timeout
      const transcription = await Promise.race([
        openai.audio.transcriptions.create({
          file: fs.createReadStream(audioFilePath),
          model: "whisper-1",
          temperature: 0.0,  // Reduce temperature for more deterministic results
          language: "en",    // Default to English for better accuracy
          response_format: "verbose_json", // Get timestamps and other metadata
          timestamp_granularities: ["segment"], // Get segment timestamps
        }),
        timeoutPromise
      ]);
      
      console.log(`DEBUG: Transcription received with ${transcription.segments?.length || 0} segments`);
      
      // Process segments to identify different speakers
      const processedTranscription = processTranscriptionWithSpeakers(transcription);

      // Delete the file after transcription
      try {
        fs.unlinkSync(audioFilePath);
        console.log('DEBUG: Deleted audio file after transcription');
      } catch (deleteError) {
        console.error('DEBUG: Error deleting audio file:', deleteError);
      }

      // Return the processed transcription
      return res.json(processedTranscription);
    } catch (openaiError) {
      if (openaiError.message === 'OpenAI API request timed out') {
        console.error('DEBUG: OpenAI API request timed out after 25 seconds');
        // Try to clean up the file
        try {
          if (fs.existsSync(audioFilePath)) {
            fs.unlinkSync(audioFilePath);
            console.log('DEBUG: Deleted audio file after timeout');
          }
        } catch (e) {
          console.error('DEBUG: Error deleting file after timeout:', e);
        }
        return res.status(504).json({ error: 'OpenAI API request timed out', message: 'The transcription request took too long' });
      }
      
      console.error('DEBUG: OpenAI API error:', openaiError);
      
      // Check if it's an authentication error
      if (openaiError.message && openaiError.message.includes('API key')) {
        console.error('DEBUG: Authentication error - check your OpenAI API key');
        // Try to clean up the file
        try {
          if (fs.existsSync(audioFilePath)) {
            fs.unlinkSync(audioFilePath);
          }
        } catch (e) {
          console.error('DEBUG: Error deleting file after auth error:', e);
        }
        return res.status(401).json({ error: 'Authentication error', message: 'Check your OpenAI API key' });
      }
      
      throw openaiError;
    }
  } catch (error) {
    console.error('DEBUG: Transcription error:', error);
    
    // Remove the file if it exists
    try {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
        console.log('DEBUG: Deleted audio file after error');
      }
    } catch (deleteError) {
      console.error('DEBUG: Error deleting file in error handler:', deleteError);
    }
    
    res.status(500).json({ error: 'Failed to transcribe audio', message: error.message });
  }
});

// Process transcription to identify different speakers
function processTranscriptionWithSpeakers(transcription) {
  if (!transcription.segments || transcription.segments.length === 0) {
    return { 
      text: transcription.text?.trim() || '', 
      segments: [],
      complete: true 
    };
  }
  
  console.log(`DEBUG: Processing ${transcription.segments.length} segments for speaker detection`);
  
  // Simple diarization using audio features (pause detection and energy levels)
  let currentSpeakerId = 1;
  let lastEndTime = 0;
  let minimumPauseBetweenSpeakers = 1.0; // 1 second pause suggests new speaker
  
  const processedSegments = transcription.segments.map((segment, index) => {
    const startTime = segment.start;
    const endTime = segment.end;
    const text = segment.text;
    
    // If this is not the first segment and there's a significant pause
    // assume it's a new speaker
    if (index > 0 && startTime - lastEndTime > minimumPauseBetweenSpeakers) {
      currentSpeakerId = currentSpeakerId === 1 ? 2 : 1; // Toggle between speakers 1 and 2
    }
    
    // Check for question marks which often indicate a change in speaker
    if (index > 0 && transcription.segments[index-1].text.trim().endsWith('?')) {
      currentSpeakerId = currentSpeakerId === 1 ? 2 : 1;
    }
    
    lastEndTime = endTime;
    
    const formattedStartTime = formatTimestamp(startTime);
    
    return {
      text,
      start: startTime,
      end: endTime,
      formattedTime: formattedStartTime,
      speaker: `Speaker ${currentSpeakerId}`,
      speakerId: currentSpeakerId
    };
  });
  
  // Format the full text with speaker annotations and timestamps
  const formattedText = processedSegments.map(segment => 
    `[${segment.formattedTime}] ${segment.speaker}: ${segment.text}`
  ).join('\n');
  
  return {
    text: formattedText,
    rawText: transcription.text,
    segments: processedSegments,
    complete: true
  };
}

// Format timestamp as MM:SS
function formatTimestamp(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log('DEBUG: Server started and ready to accept connections');
}); 