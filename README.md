# Voice Transcription App

A Node.js web application that captures voice input from a microphone and transcribes it using OpenAI's Whisper API.

## Features

- Real-time audio capture from the browser
- Audio visualization
- OpenAI Whisper API integration for accurate transcription
- Clean, responsive UI

## Prerequisites

- Node.js 14.x or higher
- An OpenAI API key

## Installation

1. Clone this repository
   ```
   git clone <repository-url>
   cd voice-transcription-app
   ```

2. Install dependencies
   ```
   npm install
   ```

3. Create a `.env` file in the root directory and add your OpenAI API key
   ```
   OPENAI_API_KEY=your_openai_api_key_here
   ```

## Usage

1. Start the server
   ```
   npm start
   ```

2. Open your browser and navigate to `http://localhost:3000`

3. Click "Start Recording" to begin capturing audio

4. Speak into your microphone

5. Click "Stop Recording" when finished

6. The application will send the audio to the OpenAI API and display the transcription result

## Development

For development with auto-restart:

```
npm run dev
```

## Dependencies

- Express - Web server framework
- OpenAI - Official OpenAI API client
- Multer - Middleware for handling multipart/form-data
- dotenv - Environment variable management

## License

ISC 