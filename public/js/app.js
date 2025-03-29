document.addEventListener('DOMContentLoaded', () => {
  // DOM elements
  const startButton = document.getElementById('startButton');
  const stopButton = document.getElementById('stopButton');
  const recordingStatus = document.getElementById('recordingStatus');
  const visualizer = document.getElementById('audioVisualizer');
  const transcriptionOutput = document.getElementById('transcription-output');
  const speakingIndicator = document.getElementById('speaking-indicator');
  const transcriptionStatus = document.getElementById('transcription-status');
  
  // Canvas context for visualization
  const canvasCtx = visualizer.getContext('2d');
  
  // Variables to store recording state and data
  let mediaRecorder;
  let audioChunks = [];
  let audioStream;
  let audioContext;
  let analyser;
  let source;
  let dataArray;
  let animationFrame;
  let vadProcessor;
  let isSpeaking = false;
  let silenceTimeout;
  let isRecording = false;
  let transcriptionInProgress = false;
  
  // VAD settings - lower threshold for better sensitivity
  const VAD_THRESHOLD = 0.01;  // Lowered from 0.05 to 0.01 for better sensitivity
  const SILENCE_DURATION = 1500; // Duration of silence to trigger transcription in ms
  
  // Set up canvas size
  function setupCanvas() {
    visualizer.width = visualizer.parentNode.offsetWidth;
    visualizer.height = visualizer.parentNode.offsetHeight;
  }
  
  // Initialize the app
  function init() {
    setupCanvas();
    window.addEventListener('resize', setupCanvas);
    
    startButton.addEventListener('click', startRecording);
    stopButton.addEventListener('click', stopRecording);
    
    console.log('DEBUG: Initializing app, attempting to load VAD module');
    // Import VAD dynamically
    import('/node_modules/voice-activity-detection/voice-activity-detection.js')
      .then(module => {
        window.vad = module.default;
        console.log('DEBUG: VAD module loaded successfully');
      })
      .catch(err => {
        console.error('DEBUG: Error loading VAD module:', err);
      });
  }
  
  // Set up voice activity detection
  function setupVAD() {
    console.log('DEBUG: Setting up VAD processor');
    const bufferSize = 2048;
    vadProcessor = audioContext.createScriptProcessor(bufferSize, 1, 1);
    
    // Connect VAD processor
    source.connect(vadProcessor);
    vadProcessor.connect(audioContext.destination);
    
    let vadData = new Float32Array(bufferSize);
    
    vadProcessor.onaudioprocess = function(event) {
      const input = event.inputBuffer.getChannelData(0);
      
      // Copy input to vadData
      vadData.set(input);
      
      // Use the VAD module
      if (window.vad) {
        const activity = window.vad.detectVoiceActivity(vadData, {
          threshold: VAD_THRESHOLD,
          smoothing: 0.2 // Add smoothing to reduce jitter
        });
        
        // Debug audio levels periodically
        if (Math.random() < 0.01) { // Only log occasionally to avoid flooding console
          const energy = calculateEnergy(input);
          console.log(`DEBUG: Audio energy: ${energy.toFixed(6)}, threshold: ${VAD_THRESHOLD}, is speaking: ${activity}`);
        }
        
        handleVoiceActivity(activity);
      } else {
        // Fallback: simple energy-based detection
        const energy = calculateEnergy(input);
        const activity = energy > VAD_THRESHOLD;
        
        // Debug audio levels periodically
        if (Math.random() < 0.01) {
          console.log(`DEBUG: Fallback VAD - Audio energy: ${energy.toFixed(6)}, threshold: ${VAD_THRESHOLD}, is speaking: ${activity}`);
        }
        
        handleVoiceActivity(activity);
      }
    };
  }
  
  // Calculate energy of audio buffer (fallback VAD)
  function calculateEnergy(buffer) {
    let energy = 0;
    for (let i = 0; i < buffer.length; i++) {
      energy += buffer[i] * buffer[i];
    }
    return energy / buffer.length;
  }
  
  // Handle voice activity changes
  function handleVoiceActivity(isSpeakingNow) {
    // If speech state changed from not speaking to speaking
    if (!isSpeaking && isSpeakingNow) {
      isSpeaking = true;
      clearTimeout(silenceTimeout);
      
      console.log('DEBUG: Voice activity detected - Started speaking');
      
      // Update speaking indicator
      speakingIndicator.classList.add('active');
      
      // Start a new chunk if we're not already recording one
      if (audioChunks.length === 0 && isRecording) {
        console.log('DEBUG: Starting media recorder');
        mediaRecorder.start();
        transcriptionStatus.textContent = 'Listening';
        transcriptionStatus.classList.add('pulse');
      }
    } 
    // If speech state changed from speaking to not speaking
    else if (isSpeaking && !isSpeakingNow) {
      isSpeaking = false;
      
      console.log('DEBUG: Voice activity ended - Stopped speaking');
      
      // Update speaking indicator
      speakingIndicator.classList.remove('active');
      
      // Set a timeout to stop recording and process the audio if silence continues
      clearTimeout(silenceTimeout);
      silenceTimeout = setTimeout(() => {
        if (isRecording && mediaRecorder && mediaRecorder.state === 'recording' && !transcriptionInProgress) {
          console.log('DEBUG: Silence detected for ' + SILENCE_DURATION + 'ms, stopping recorder');
          mediaRecorder.stop();
          transcriptionStatus.textContent = 'Processing';
        }
      }, SILENCE_DURATION);
    }
  }
  
  // Start recording from the microphone
  async function startRecording() {
    try {
      console.log('DEBUG: Starting recording process');
      // Clear any previous recordings
      audioChunks = [];
      transcriptionOutput.textContent = '';
      transcriptionStatus.textContent = 'Starting...';
      isRecording = true;
      
      // Request microphone access
      console.log('DEBUG: Requesting microphone access');
      audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('DEBUG: Microphone access granted');
      
      // Create audio context for visualization and VAD
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      source = audioContext.createMediaStreamSource(audioStream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      
      source.connect(analyser);
      
      // Set up data array for visualization
      const bufferLength = analyser.frequencyBinCount;
      dataArray = new Uint8Array(bufferLength);
      
      // Set up VAD
      setupVAD();
      
      // Start visualization
      visualize();
      
      // Set up media recorder
      console.log('DEBUG: Setting up MediaRecorder');
      const options = { mimeType: 'audio/webm' };
      try {
        mediaRecorder = new MediaRecorder(audioStream, options);
        console.log('DEBUG: MediaRecorder created with mimeType:', options.mimeType);
      } catch (e) {
        console.error('DEBUG: Exception while creating MediaRecorder with mimeType', options.mimeType, e);
        console.log('DEBUG: Trying MediaRecorder without mimeType');
        mediaRecorder = new MediaRecorder(audioStream);
      }
      
      mediaRecorder.ondataavailable = (event) => {
        console.log(`DEBUG: Data available from media recorder, size: ${event.data.size} bytes`);
        if (event.data.size > 0) {
          audioChunks.push(event.data);
          console.log(`DEBUG: Audio chunk added, total chunks: ${audioChunks.length}`);
        }
      };
      
      mediaRecorder.onstop = async () => {
        console.log('DEBUG: MediaRecorder stopped');
        // Only process if we have audio chunks and are still recording
        if (audioChunks.length > 0 && isRecording && !transcriptionInProgress) {
          // Create audio blob from chunks
          const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
          console.log(`DEBUG: Audio blob created, size: ${audioBlob.size} bytes`);
          
          // Clear chunks for next segment
          audioChunks = [];
          
          // Send audio to server for transcription
          console.log('DEBUG: Sending audio for transcription');
          await transcribeAudio(audioBlob);
        } else {
          console.log(`DEBUG: Skipping transcription - chunks: ${audioChunks.length}, isRecording: ${isRecording}, transcriptionInProgress: ${transcriptionInProgress}`);
        }
      };
      
      // Start recording immediately (instead of waiting for VAD)
      console.log('DEBUG: Starting MediaRecorder immediately');
      mediaRecorder.start();
      transcriptionStatus.textContent = 'Recording';
      transcriptionStatus.classList.add('pulse');
      
      // Set up a timeout to stop the initial recording after 5 seconds
      setTimeout(() => {
        if (mediaRecorder && mediaRecorder.state === 'recording' && !isSpeaking) {
          console.log('DEBUG: Stopping initial recording segment after timeout');
          mediaRecorder.stop();
          transcriptionStatus.textContent = 'Processing';
        }
      }, 5000);
      
      // Update UI
      startButton.disabled = true;
      stopButton.disabled = false;
      recordingStatus.textContent = 'Listening for speech...';
      transcriptionStatus.textContent = 'Ready';
      
    } catch (error) {
      console.error('DEBUG: Error during recording setup:', error);
      recordingStatus.textContent = 'Error: Could not access microphone';
      transcriptionOutput.textContent = 'Error: Could not access microphone. Please check your permissions.';
      transcriptionStatus.textContent = 'Error';
      isRecording = false;
    }
  }
  
  // Stop recording
  function stopRecording() {
    console.log('DEBUG: Stopping recording');
    isRecording = false;
    recordingStatus.textContent = 'Stopping...';
    transcriptionStatus.textContent = 'Stopped';
    transcriptionStatus.classList.remove('pulse');
    
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      console.log('DEBUG: Stopping media recorder');
      mediaRecorder.stop();
    }
    
    // Clean up resources
    if (audioStream) {
      console.log('DEBUG: Stopping audio tracks');
      audioStream.getTracks().forEach(track => track.stop());
    }
    
    if (vadProcessor) {
      console.log('DEBUG: Disconnecting VAD processor');
      vadProcessor.disconnect();
    }
    
    // Stop visualization
    cancelAnimationFrame(animationFrame);
    
    // Update UI
    startButton.disabled = false;
    stopButton.disabled = true;
    recordingStatus.textContent = 'Recording stopped';
    speakingIndicator.classList.remove('active');
    
    // Clear visualization
    canvasCtx.clearRect(0, 0, visualizer.width, visualizer.height);
  }
  
  // Transcribe audio using OpenAI API
  async function transcribeAudio(audioBlob) {
    try {
      // Don't start another transcription if one is in progress
      if (transcriptionInProgress) {
        console.log('DEBUG: Transcription already in progress, skipping');
        return;
      }
      
      transcriptionInProgress = true;
      transcriptionStatus.textContent = 'Transcribing...';
      
      console.log('DEBUG: Creating FormData for audio upload');
      // Create form data for file upload
      const formData = new FormData();
      formData.append('audio', audioBlob);
      
      // Send to server
      console.log('DEBUG: Sending POST request to /transcribe');
      const response = await fetch('/transcribe', {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        console.error('DEBUG: Server responded with error', response.status, response.statusText);
        throw new Error('Transcription request failed');
      }
      
      console.log('DEBUG: Transcription response received');
      const result = await response.json();
      console.log('DEBUG: Transcription result:', result);
      
      // If we have text, append it to the output
      if (result.text && result.text.trim()) {
        console.log('DEBUG: Transcription text received:', result.text);
        const currentText = transcriptionOutput.textContent;
        
        // Check if current text is empty or just the placeholder
        if (!currentText || currentText === 'Start listening to see real-time transcription here.') {
          transcriptionOutput.textContent = result.text;
        } else {
          // Append new text with proper spacing and punctuation
          const lastChar = currentText.trim().slice(-1);
          const needsPunctuation = !['!', '.', '?', ',', ';', ':'].includes(lastChar);
          const needsSpace = currentText.trim().length > 0 && !currentText.endsWith(' ');
          
          if (needsPunctuation) {
            transcriptionOutput.textContent = `${currentText}${needsSpace ? ' ' : ''}${result.text}`;
          } else {
            transcriptionOutput.textContent = `${currentText}${needsSpace ? ' ' : ''}${result.text}`;
          }
        }
        
        // Update status
        recordingStatus.textContent = 'Listening for more speech...';
        transcriptionStatus.textContent = 'Ready';
      } else {
        console.log('DEBUG: No transcription text received or empty text');
        transcriptionStatus.textContent = 'Ready';
      }
      
      transcriptionInProgress = false;
      
    } catch (error) {
      console.error('DEBUG: Error during transcription:', error);
      recordingStatus.textContent = 'Error: Could not transcribe audio. Still listening...';
      transcriptionStatus.textContent = 'Error';
      transcriptionInProgress = false;
      
      // If still recording, we continue listening
      if (!isRecording) {
        startButton.disabled = false;
        stopButton.disabled = true;
      }
    }
  }
  
  // Visualize audio input
  function visualize() {
    // Set up the canvas size
    visualizer.width = visualizer.parentNode.offsetWidth;
    visualizer.height = visualizer.parentNode.offsetHeight;
    
    // Draw the visualization
    function draw() {
      animationFrame = requestAnimationFrame(draw);
      
      // Get frequency data
      analyser.getByteFrequencyData(dataArray);
      
      // Clear canvas
      canvasCtx.fillStyle = '#f5f5f5';
      canvasCtx.fillRect(0, 0, visualizer.width, visualizer.height);
      
      // Draw frequency bars
      const barWidth = (visualizer.width / dataArray.length) * 2.5;
      let barHeight;
      let x = 0;
      
      for (let i = 0; i < dataArray.length; i++) {
        barHeight = dataArray[i] / 2;
        
        // Use green when speaking, red otherwise
        const colorBase = isSpeaking ? 50 : barHeight + 100;
        canvasCtx.fillStyle = `rgb(${isSpeaking ? 50 : colorBase}, ${isSpeaking ? colorBase : 50}, 50)`;
        canvasCtx.fillRect(x, visualizer.height - barHeight, barWidth, barHeight);
        
        x += barWidth + 1;
      }
    }
    
    draw();
  }
  
  // Initialize the application
  init();
}); 