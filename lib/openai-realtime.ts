export interface RealtimeConfig {
  model?: string;
  voice?: string;
}

export interface WordEntry {
  id: string;
  word: string;
  timestamp: Date;
  language: string;
  mastery: number;
  practiceCount: number;
}

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private config: RealtimeConfig;
  private sessionId: string | null = null;
  private isConnected: boolean = false;
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private audioProcessor: ScriptProcessorNode | null = null;
  private listeners: Map<string, Function[]> = new Map();
  private playbackQueue: AudioBuffer[] = [];
  private isPlaying: boolean = false;
  private nextPlaybackTime: number = 0;
  private currentAudioSource: AudioBufferSourceNode | null = null;

  constructor(config: RealtimeConfig = {}) {
    this.config = {
      model: 'gpt-4o-realtime-preview-2024-12-17',
      voice: 'alloy',
      ...config
    };
  }

  on(event: string, callback: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)?.push(callback);
  }

  emit(event: string, ...args: any[]) {
    const callbacks = this.listeners.get(event) || [];
    callbacks.forEach(callback => callback(...args));
  }

  async connect(): Promise<void> {
    try {
      // Get user media
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 24000
        } 
      });

      // Connect to our WebSocket proxy that handles authentication
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/realtime/ws`;
      
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('WebSocket connected via proxy');
        this.isConnected = true;
        this.emit('connected');
        this.setupAudioCapture();
        // Create session after connection
        this.createSession();
      };

      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        this.handleMessage(data);
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.emit('error', error);
      };

      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
        this.isConnected = false;
        this.emit('disconnected');
      };

    } catch (error) {
      console.error('Connection error:', error);
      this.emit('error', error);
      throw error;
    }
  }

  private practiceMode: 'pronunciation' | 'vocabulary' | 'conversation' | 'pronunciation-test' = 'conversation';
  private homeLanguage: string = 'English';
  private recentWords: string[] = [];
  private currentWordIndex: number = 0;
  private attemptCount: number = 0;
  private testWord: string = '';  // For pronunciation test mode

  private createSession() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // Reset tracking
    this.currentWordIndex = 0;
    this.attemptCount = 0;
    
    // Define the function for getting next word
    const getNextWordFunction = {
      type: 'function',
      name: 'get_next_word',
      description: 'Get the next word to practice when ready to move on',
      parameters: {
        type: 'object',
        properties: {
          current_word: {
            type: 'string',
            description: 'The word that was just practiced'
          },
          feedback_given: {
            type: 'boolean',
            description: 'Whether feedback was provided for the current word'
          }
        },
        required: ['current_word', 'feedback_given']
      }
    };

    // Build language-aware instructions
    const languageInstructions = this.homeLanguage.toLowerCase() !== 'english' 
      ? `CRITICAL LANGUAGE REQUIREMENT: The student's native language is ${this.homeLanguage}. 
         YOU MUST speak ${this.homeLanguage} for ALL communication except the English words being taught.
         - Greet the student in ${this.homeLanguage}
         - Give ALL instructions in ${this.homeLanguage}
         - Provide ALL feedback in ${this.homeLanguage}
         - Give ALL encouragement in ${this.homeLanguage}
         - Explain everything in ${this.homeLanguage}
         Only the English vocabulary words themselves should be in English.
         Example: If ${this.homeLanguage} is French, say "Bonjour! Aujourd'hui nous allons pratiquer le mot 'hello'."`
      : `The student is a native English speaker learning to improve their English skills.
         Use clear, simple English for all communication.`;

    // Check if we have enough words
    if (this.recentWords.length < 3) {
      const notEnoughWordsMsg = this.homeLanguage.toLowerCase() !== 'english'
        ? `${this.homeLanguage}: You need at least 3 words to practice. Please go to FlashAcademy to complete some lessons and add more words.`
        : `You need at least 3 words to practice. Please go to FlashAcademy to complete some lessons and add more words.`;
      
      const sessionConfig = {
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions: `IMPORTANT: The student has fewer than 3 words. 
            Tell them: "${notEnoughWordsMsg}"
            FlashAcademy is a language learning platform. Always say "FlashAcademy" in English.
            ${languageInstructions}`,
          voice: this.config.voice,
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          input_audio_transcription: {
            model: 'whisper-1'
          },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.7,  // Increased to reduce false triggers
            prefix_padding_ms: 300,
            silence_duration_ms: 500  // Increased to require longer silence
          },
          temperature: 0.8
        }
      };
      this.ws.send(JSON.stringify(sessionConfig));
      return;
    }

    const wordsContext = this.practiceMode === 'pronunciation-test' 
      ? '' // In test mode, we handle words individually
      : '';

    const pronunciationInstructions = this.practiceMode === 'pronunciation' 
      ? `YOU ARE A STRICT PRONUNCIATION TEACHER. Your ONLY job is to teach pronunciation.
         
         CRITICAL: You have a function 'move_to_next_word' that you MUST CALL after each word.
         
         CURRENT WORD TO TEACH: "${this.recentWords[this.currentWordIndex]}"
         
         YOUR EXACT PROTOCOL (FOLLOW PRECISELY):
         1. Ask: "Can you pronounce '${this.recentWords[this.currentWordIndex]}' for me?"
         2. Listen to their first attempt
         3. Give SPECIFIC feedback (e.g., "The 'th' needs your tongue between your teeth")
         4. Say: "Let's try once more"
         5. Listen to their second attempt
         6. Give final feedback
         7. ⚠️ CRITICAL: You MUST call the function move_to_next_word with:
            {
              "current_word": "${this.recentWords[this.currentWordIndex]}",
              "attempts_made": 2
            }
         
         The function will return the next word. If there is one, teach it the same way.
         If no more words, the function will tell you the session is complete.
         
         NEVER skip calling the function. ALWAYS call it after 2 attempts.
         
         If student goes off-topic: "Let's focus on pronunciation."`
      : this.practiceMode === 'pronunciation-test' && this.testWord
      ? `PRONUNCIATION TEST MODE - BE AN EXPERT PRONUNCIATION COACH:
         
         You are testing the word: "${this.testWord}"
         
         YOUR JOB AS AN EXPERT:
         1. Ask the student to pronounce "${this.testWord}" clearly
         2. Listen with the ear of a pronunciation expert
         3. Identify EVERY issue, no matter how small:
            - Wrong phonemes (e.g., 'th' pronounced as 's' or 'd')
            - Vowel quality issues (e.g., 'a' in apple should be /æ/ not /a/)
            - Consonant problems (e.g., not aspirating 'p' in 'apple')
            - Stress placement errors
            - Intonation issues
         
         GIVE SPECIFIC CORRECTIONS:
         - "Your 'l' sound is too light - make it darker by pulling your tongue back"
         - "The 'w' in world needs more lip rounding - pucker your lips more"
         - "The stress is on the wrong syllable - emphasize the FIRST part"
         
         Score from 0-100:
         - 90-100: Near-native, only tiny issues
         - 70-89: Good, minor issues that don't affect understanding
         - 50-69: Understandable but noticeable errors
         - Below 50: Major issues affecting comprehension
         
         ALWAYS end with "Score: [number]/100"
         
         Be encouraging but HONEST - they need real feedback to improve!`
      : '';

    const sessionConfig = {
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: `You are a friendly language tutor helping students practice English pronunciation.
          
          ${languageInstructions}
          
          Current practice mode: ${this.practiceMode}
          ${wordsContext}
          ${pronunciationInstructions}
          
          REMEMBER:
          - Stay focused as a pronunciation teacher
          - Use the move_to_next_word function after each word (2 attempts)
          - Give specific pronunciation feedback
          - Don't engage in off-topic conversation`,
        voice: this.config.voice,
        tools: this.practiceMode === 'pronunciation' ? [{
          type: 'function',
          name: 'move_to_next_word',
          description: 'Move to the next word in the practice list after completing the current word',
          parameters: {
            type: 'object',
            properties: {
              current_word: {
                type: 'string',
                description: 'The word that was just practiced'
              },
              attempts_made: {
                type: 'number',
                description: 'Number of attempts made for this word'
              }
            },
            required: ['current_word']
          }
        }] : [],
        tool_choice: 'auto',
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: {
          model: 'whisper-1'
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.7,  // Increased from 0.5 to reduce sensitivity
          prefix_padding_ms: 300,
          silence_duration_ms: 500  // Increased from 200ms to require longer silence
        },
        temperature: 0.8
      }
    };

    this.ws.send(JSON.stringify(sessionConfig));

    // Send initial response request to make the tutor start talking
    setTimeout(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const langReminder = this.homeLanguage.toLowerCase() !== 'english' 
          ? `REMEMBER: You MUST speak in ${this.homeLanguage}! Greet in ${this.homeLanguage}, give instructions in ${this.homeLanguage}. Only the English words being practiced should be in English. ` 
          : '';
        
        let startInstructions = '';
        if (this.recentWords.length >= 3) {
          if (this.practiceMode === 'pronunciation') {
            startInstructions = `${langReminder}YOU ARE A PRONUNCIATION TEACHER. You MUST use the move_to_next_word function.
            
            Say: "Hello! I'm your pronunciation teacher. Let's work on your English pronunciation. Can you say '${this.recentWords[0]}' for me?"
            
            CRITICAL SEQUENCE (YOU MUST FOLLOW):
            1. Listen to their first attempt
            2. Give SPECIFIC feedback (e.g., "The 'th' needs your tongue between your teeth")
            3. Say "Try once more"
            4. Listen to second attempt
            5. Give final feedback
            6. ⚠️ MANDATORY: Call move_to_next_word({"current_word": "${this.recentWords[0]}", "attempts_made": 2})
            7. The function returns the next word - teach it the same way
            
            YOU MUST CALL THE FUNCTION. This is NOT optional.
            If student goes off-topic: "Let's focus on pronunciation practice."`;
          } else {
            startInstructions = `${langReminder}Greet briefly, then immediately start practicing with "${this.recentWords[0]}". 
            DO NOT mention other words.`;
          }
        }
        
        if (startInstructions) {
          this.ws.send(JSON.stringify({
            type: 'response.create',
            response: {
              modalities: ['text', 'audio'],
              instructions: startInstructions
            }
          }));
        }
      }
    }, 500);
  }

  private handleMessage(data: any) {
    // Log ALL events for debugging
    if (data.type && !data.type.includes('audio')) {
      console.log(`[EVENT] ${data.type}:`, data);
    }
    
    switch (data.type) {
      case 'session.created':
        this.sessionId = data.session_id;
        this.emit('session.created', data);
        break;
      
      case 'response.function_call.started':
        console.log('🔧 Function call STARTED:', data);
        break;
      
      case 'response.function_call_arguments.started':
        console.log('🔧 Function arguments STARTED:', data);
        break;
        
      case 'response.function_call_arguments.delta':
        console.log('🔧 Function arguments DELTA:', data);
        break;
      
      case 'response.function_call_arguments.done':
        // Handle function call for moving to next word
        console.log('🔧 Function call DONE:', data);
        if (data.name === 'move_to_next_word') {
          this.handleMoveToNextWord(data);
        }
        break;
      
      case 'response.audio.delta':
        // Handle audio chunks from the assistant
        if (data.delta) {
          this.playAudioChunk(data.delta);
        }
        break;
      
      case 'response.audio.transcript':
        this.emit('assistant.transcript', data.transcript);
        break;
      
      case 'response.audio_transcript.delta':
        // Handle incremental transcript updates
        if (data.delta) {
          this.emit('assistant.transcript.delta', data.delta);
        }
        break;
      
      case 'input_audio_buffer.speech_started':
        console.log('Speech detected - user started speaking');
        this.handleUserInterruption();
        this.emit('user.speaking.start');
        break;
      
      case 'input_audio_buffer.speech_stopped':
        console.log('Speech stopped - waiting for transcription');
        this.emit('user.speaking.stop');
        break;
      
      case 'conversation.item.created':
        if (data.item.type === 'message' && data.item.role === 'user') {
          const transcript = data.item.content?.[0]?.transcript || '';
          this.emit('user.transcript', transcript);
          
          // Just log attempts for debugging
          if (this.practiceMode === 'pronunciation' && transcript) {
            this.attemptCount++;
            console.log(`User attempt ${this.attemptCount} for word: ${this.recentWords[this.currentWordIndex]}`);
          }
        }
        break;
      
      case 'response.cancelled':
        // Response was cancelled due to interruption
        this.clearAudioQueue();
        this.emit('assistant.interrupted');
        break;
      
      case 'response.done':
        this.emit('response.complete', data);
        break;
      
      case 'error':
        this.emit('error', data.error);
        break;
      
      default:
        this.emit('message', data);
    }
  }

  private progressToNextWord() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log('Cannot progress - WebSocket not open');
      return;
    }
    
    console.log(`Progressing from word ${this.currentWordIndex} (${this.recentWords[this.currentWordIndex]}) to next word`);
    
    // Reset attempt counter and move to next word
    this.attemptCount = 0;
    this.currentWordIndex++;
    
    if (this.currentWordIndex >= this.recentWords.length) {
      console.log('All words completed!');
      // All words completed
      this.ws.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'system',
          content: [{
            type: 'text',
            text: `All words completed! Say: "Excellent work! You've practiced all the words. Your pronunciation is improving!"`
          }]
        }
      }));
    } else {
      // Send instruction for next word
      const nextWord = this.recentWords[this.currentWordIndex];
      console.log(`Moving to word ${this.currentWordIndex + 1}/${this.recentWords.length}: "${nextWord}"`);
      
      this.ws.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'system',
          content: [{
            type: 'text',
            text: `NEXT WORD: "${nextWord}"
            
            You are still the pronunciation teacher. 
            Say EXACTLY: "Now let's work on '${nextWord}'. Can you pronounce it for me?"
            
            Then follow the same teaching protocol:
            1. Listen to their pronunciation
            2. Give specific feedback on sounds, stress, etc.
            3. Ask them to try once more
            4. Give final feedback
            5. Say "Good effort with '${nextWord}'"
            
            STAY FOCUSED on pronunciation teaching only.`
          }]
        }
      }));
    }
    
    // Trigger response
    setTimeout(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'response.create',
          response: {
            modalities: ['text', 'audio']
          }
        }));
      }
    }, 100);
  }

  private handleMoveToNextWord(data: any) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log('Cannot move to next word - WebSocket not open');
      return;
    }
    
    console.log('📝 Function call data:', data);
    console.log('📝 Current word index:', this.currentWordIndex);
    console.log('📝 Recent words:', this.recentWords);
    console.log(`📝 Moving from word: ${this.recentWords[this.currentWordIndex]}`);
    
    // Parse arguments if they're a string
    let args = {};
    if (data.arguments) {
      try {
        args = typeof data.arguments === 'string' ? JSON.parse(data.arguments) : data.arguments;
        console.log('📝 Parsed arguments:', args);
      } catch (e) {
        console.error('Failed to parse arguments:', e);
      }
    }
    
    // Move to next word
    this.currentWordIndex++;
    this.attemptCount = 0;
    
    let responseOutput;
    if (this.currentWordIndex >= this.recentWords.length) {
      // All words completed
      console.log('All words completed!');
      responseOutput = {
        has_next_word: false,
        message: "All words completed! Great job on your pronunciation practice!",
        next_word: null
      };
    } else {
      // Get next word
      const nextWord = this.recentWords[this.currentWordIndex];
      console.log(`Next word is: ${nextWord} (${this.currentWordIndex + 1}/${this.recentWords.length})`);
      responseOutput = {
        has_next_word: true,
        next_word: nextWord,
        message: `Now let's practice: ${nextWord}`
      };
    }
    
    // Send function call output
    this.ws.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: data.call_id,
        output: JSON.stringify(responseOutput)
      }
    }));
    
    // Continue the response
    setTimeout(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'response.create',
          response: {
            modalities: ['text', 'audio']
          }
        }));
      }
    }, 100);
  }

  private moveToNextWord() {
    this.attemptCount = 0;
    this.currentWordIndex++;
    
    if (this.currentWordIndex >= this.recentWords.length) {
      // All words completed
      this.sendCompletionMessage();
    } else {
      // Move to next word
      this.sendNextWordInstruction();
    }
  }

  private sendNextWordInstruction() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    const nextWord = this.recentWords[this.currentWordIndex];
    const langInstruction = this.homeLanguage.toLowerCase() !== 'english'
      ? `Speaking in ${this.homeLanguage}, `
      : '';
    
    this.ws.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'system',
        content: [{
          type: 'text',
          text: `${langInstruction}Transition naturally to the next word: "${nextWord}". 
              Say something like: "Good effort! Now let's try '${nextWord}'." 
              Remember to be CRITICAL - listen for even small pronunciation issues and explain HOW to fix them with specific mouth/tongue positioning guidance.`
        }]
      }
    }));
    
    // Trigger response
    this.ws.send(JSON.stringify({
      type: 'response.create',
      response: {
        modalities: ['text', 'audio']
      }
    }));
  }

  private sendCompletionMessage() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    const completionMsg = this.homeLanguage.toLowerCase() !== 'english'
      ? `Great job! You've practiced all the words. To learn more words, please go to FlashAcademy and complete some lessons. (Remember: say "FlashAcademy" in English, rest in ${this.homeLanguage})`
      : 'Great job! You\'ve practiced all the words. To learn more words, please go to FlashAcademy and complete some lessons.';
    
    this.ws.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'system',
        content: [{
          type: 'text',
          text: completionMsg
        }]
      }
    }));
    
    // Trigger response
    this.ws.send(JSON.stringify({
      type: 'response.create',
      response: {
        modalities: ['text', 'audio']
      }
    }));
  }

  private setupAudioCapture() {
    if (!this.mediaStream) return;

    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
      sampleRate: 24000
    });

    const source = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.audioProcessor = this.audioContext.createScriptProcessor(2048, 1, 1);

    this.audioProcessor.onaudioprocess = (e) => {
      if (!this.isConnected) return;

      const inputData = e.inputBuffer.getChannelData(0);
      const pcm16 = this.convertFloat32ToPCM16(inputData);
      this.sendAudioChunk(pcm16);
    };

    source.connect(this.audioProcessor);
    this.audioProcessor.connect(this.audioContext.destination);
  }

  private convertFloat32ToPCM16(float32Array: Float32Array): ArrayBuffer {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    let offset = 0;
    for (let i = 0; i < float32Array.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return buffer;
  }

  private sendAudioChunk(audioData: ArrayBuffer) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const base64Audio = btoa(String.fromCharCode(...new Uint8Array(audioData)));
    
    this.ws.send(JSON.stringify({
      type: 'input_audio_buffer.append',
      audio: base64Audio
    }));
  }

  private async playAudioChunk(base64Audio: string) {
    if (!this.audioContext) return;

    try {
      // Decode base64 to binary
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Convert PCM16 to Float32
      const float32Array = new Float32Array(bytes.length / 2);
      const dataView = new DataView(bytes.buffer);
      for (let i = 0; i < float32Array.length; i++) {
        const int16 = dataView.getInt16(i * 2, true);
        float32Array[i] = int16 / 32768.0;
      }

      // Create audio buffer
      const audioBuffer = this.audioContext.createBuffer(1, float32Array.length, 24000);
      audioBuffer.copyToChannel(float32Array, 0);

      // Queue the buffer for playback
      this.playbackQueue.push(audioBuffer);
      
      // Start playback if not already playing
      if (!this.isPlaying) {
        this.processPlaybackQueue();
      }
    } catch (error) {
      console.error('Error playing audio chunk:', error);
    }
  }

  private async processPlaybackQueue() {
    if (this.playbackQueue.length === 0 || !this.audioContext) {
      this.isPlaying = false;
      return;
    }

    this.isPlaying = true;
    const audioBuffer = this.playbackQueue.shift()!;

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);

    // Store the current source so we can stop it if interrupted
    this.currentAudioSource = source;

    // Schedule playback
    const now = this.audioContext.currentTime;
    const playTime = Math.max(now, this.nextPlaybackTime);
    source.start(playTime);
    
    // Update next playback time
    this.nextPlaybackTime = playTime + audioBuffer.duration;

    // Process next chunk when this one finishes
    source.onended = () => {
      this.currentAudioSource = null;
      this.processPlaybackQueue();
    };
  }

  private handleUserInterruption() {
    // Stop current audio playback immediately
    if (this.currentAudioSource) {
      try {
        this.currentAudioSource.stop();
        this.currentAudioSource = null;
      } catch (e) {
        // Ignore if already stopped
      }
    }
    
    // Clear the audio queue
    this.clearAudioQueue();
  }

  private clearAudioQueue() {
    this.playbackQueue = [];
    this.isPlaying = false;
    this.nextPlaybackTime = 0;
    if (this.currentAudioSource) {
      try {
        this.currentAudioSource.stop();
        this.currentAudioSource = null;
      } catch (e) {
        // Ignore if already stopped
      }
    }
  }

  updateContext(words: WordEntry[], homeLanguage: string) {
    // Store context for session creation
    this.recentWords = words.slice(-10).map(w => w.word);
    this.homeLanguage = homeLanguage;

    // If already connected, update the conversation context
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const languageContext = homeLanguage.toLowerCase() !== 'english'
        ? `Remember: Speak to the student in ${homeLanguage} for instructions and explanations, but teach English content.`
        : 'Continue in English for all communication.';

      const context = {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'system',
          content: [{
            type: 'text',
            text: `Context update: The student's native language is ${homeLanguage}. 
                   They recently learned these words: ${this.recentWords.join(', ')}.
                   ${languageContext}
                   Current practice mode: ${this.practiceMode}`
          }]
        }
      };

      this.ws.send(JSON.stringify(context));
    }
  }

  setTestWord(word: string) {
    this.testWord = word;
  }

  setPracticeMode(mode: 'pronunciation' | 'vocabulary' | 'conversation' | 'pronunciation-test') {
    // Store the practice mode and reset counters
    this.practiceMode = mode;
    this.currentWordIndex = 0;
    this.attemptCount = 0;

    // If already connected, update the mode
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      let modeInstructions = '';
      
      if (mode === 'pronunciation' && this.recentWords.length > 0) {
        modeInstructions = `Switch to PRONUNCIATION mode. 
          Practice these exact words: ${this.recentWords.join(', ')}.
          Start with "${this.recentWords[0]}".
          Give 2 attempts per word, then move to the next.
          Focus on pronunciation feedback.`;
      } else if (mode === 'pronunciation-test' && this.testWord) {
        modeInstructions = `CRITICAL: You are now a STRICT PRONUNCIATION EVALUATOR for the word "${this.testWord}".
          
          YOUR ROLE:
          - Be a helpful but CRITICAL teacher who wants the student to improve
          - Listen VERY carefully to how they pronounce "${this.testWord}"
          - Evaluate their pronunciation honestly and provide a score from 0-100
          
          EVALUATION CRITERIA:
          1. Individual sound accuracy (40%): Are all phonemes pronounced correctly?
          2. Word stress (20%): Is the stress on the correct syllable?
          3. Clarity (20%): Is the word clear and understandable?
          4. Intonation/rhythm (20%): Does it sound natural?
          
          SCORING GUIDELINES:
          - 90-100: Excellent, near-native pronunciation
          - 70-89: Good, minor issues that don't affect understanding
          - 50-69: Fair, noticeable errors but still understandable
          - 30-49: Poor, difficult to understand, major errors
          - 0-29: Very poor, incomprehensible or completely wrong
          
          REQUIRED RESPONSE FORMAT:
          1. First, acknowledge what you heard
          2. Point out SPECIFIC pronunciation issues (be honest but encouraging)
          3. Give constructive feedback on how to improve
          4. End with "Score: [number]/100" on a new line
          
          Example responses:
          - If perfect: "Excellent! Your pronunciation of '${this.testWord}' was clear and accurate. Score: 95/100"
          - If good: "Good attempt! The word was mostly clear, but watch the [specific sound]. Try to [specific tip]. Score: 75/100"
          - If poor: "I heard something like '[what you heard]'. Let's work on [specific issues]. Remember to [specific tips]. Score: 45/100"
          
          BE HONEST - students need real feedback to improve, not just encouragement!`;
      } else {
        const generalInstructions = {
          pronunciation: `Switch to PRONUNCIATION mode. Focus on helping with pronunciation, sounds, rhythm, and intonation. 
            Practice words in context. Give specific feedback on pronunciation issues.`,
          vocabulary: `Switch to VOCABULARY mode. Test understanding of word meanings. 
            Use words in different contexts. Create scenarios for natural usage.`,
          conversation: `Switch to CONVERSATION mode. Engage in natural, flowing conversation. 
            Incorporate learned words naturally. Prioritize fluency over perfect accuracy.`,
          'pronunciation-test': `Switch to PRONUNCIATION TEST mode. Be METICULOUS in evaluating pronunciation.
            Listen carefully and provide numerical scores with detailed feedback.`
        };
        modeInstructions = generalInstructions[mode];
      }

      this.ws.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'system',
          content: [{
            type: 'text',
            text: modeInstructions
          }]
        }
      }));

      // If switching to pronunciation mode, start with first word
      if (mode === 'pronunciation' && this.recentWords.length > 0) {
        setTimeout(() => {
          this.ws?.send(JSON.stringify({
            type: 'response.create',
            response: {
              modalities: ['text', 'audio'],
              instructions: `Now ask the student to pronounce the word "${this.recentWords[0]}".`
            }
          }));
        }, 100);
      }
    }
  }

  disconnect() {
    // Clear playback queue
    this.playbackQueue = [];
    this.isPlaying = false;
    this.nextPlaybackTime = 0;
    
    if (this.audioProcessor) {
      this.audioProcessor.disconnect();
      this.audioProcessor = null;
    }
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.isConnected = false;
    this.emit('disconnected');
  }
}