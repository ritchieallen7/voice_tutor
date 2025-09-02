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
  private listeners: Map<string, Array<(...args: any[]) => void>> = new Map();
  private playbackQueue: AudioBuffer[] = [];
  private isPlaying: boolean = false;
  private nextPlaybackTime: number = 0;
  private currentAudioSource: AudioBufferSourceNode | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 3;
  private reconnectDelay: number = 1000;

  constructor(config: RealtimeConfig = {}) {
    this.config = {
      model: 'gpt-realtime', // Using the GA model for better performance
      voice: 'alloy',
      ...config
    };
  }

  on(event: string, callback: (...args: any[]) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)?.push(callback);
  }

  emit(event: string, ...args: unknown[]) {
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
          sampleRate: 24000,
          channelCount: 1 // Mono audio for better compatibility
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
        // Attempt reconnection on error
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.attemptReconnect();
        }
      };

      this.ws.onclose = (event) => {
        console.log('WebSocket disconnected', event.code, event.reason);
        this.isConnected = false;
        this.emit('disconnected');
        
        // Attempt reconnection if not a normal closure
        if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.attemptReconnect();
        }
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
  private wordProgressionEnabled: boolean = false;
  private waitingForNextWord: boolean = false;
  private lastBlockedTime: number = 0;

  private createSession() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // Reset tracking
    this.currentWordIndex = 0;
    this.attemptCount = 0;
    
    // Define the function for getting next word (kept for reference)
    /* const getNextWordFunction = {
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
    }; */

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
        ? `${this.homeLanguage}: You need at least 3 words to practice. Please return to FlashAcademy to take lessons and learn new words. FlashAcademy will teach you many useful words and phrases!`
        : `You need at least 3 words to practice. Please return to FlashAcademy to take lessons and learn new words. FlashAcademy will teach you many useful words and phrases!`;
      
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
            threshold: 0.8,  // Optimized for clear pronunciation
            prefix_padding_ms: 500,
            silence_duration_ms: 800  // Natural speech timing
          },
          temperature: 0  // Set to 0 for deterministic responses
        }
      };
      this.ws.send(JSON.stringify(sessionConfig));
      return;
    }

    const wordsContext = this.practiceMode === 'pronunciation-test' 
      ? '' // In test mode, we handle words individually
      : '';

    const pronunciationInstructions = this.practiceMode === 'pronunciation' 
      ? `YOU ARE A PRONUNCIATION COACH. You MUST practice ONLY these words in this EXACT order:
         [${this.recentWords.map((w, i) => `${i+1}. "${w}"`).join(', ')}]
         
         CURRENT WORD #${this.currentWordIndex + 1}: "${this.recentWords[this.currentWordIndex]}"
         
         YOUR TEACHING PROTOCOL:
         1. Ask: "Can you pronounce '${this.recentWords[this.currentWordIndex]}' for me?"
         2. Listen carefully to their first attempt
         3. PROVIDE DETAILED FEEDBACK:
            - Identify any mispronounced sounds
            - Explain HOW to correct them (tongue position, mouth shape, etc.)
            - Example: "The 'sh' in fish needs your tongue pulled back"
            - Be specific: "Your 'i' sound was too long, make it shorter"
         4. Say: "Good effort! Let's try '${this.recentWords[this.currentWordIndex]}' once more, focusing on [specific issue]"
         5. Listen to their second attempt
         6. GIVE CONSTRUCTIVE FEEDBACK:
            - Note improvements: "Much better on the 'sh' sound!"
            - Point out remaining issues if any
            - Always be encouraging but honest
         
         AFTER 2 ATTEMPTS: Stop and wait. The system will automatically give you the next word.
         
         CRITICAL RULES:
         - ONLY practice word #${this.currentWordIndex + 1}: "${this.recentWords[this.currentWordIndex]}"
         - NEVER mention or suggest any other words
         - After 2 attempts, STOP and WAIT for the next word
         - If student says wrong word: "Let's focus on '${this.recentWords[this.currentWordIndex]}' please."`
      : this.practiceMode === 'pronunciation-test' && this.testWord
      ? `PRONUNCIATION TEST MODE - EXPERT EVALUATION:
         
         Testing word: "${this.testWord}"
         
         EVALUATION PROTOCOL:
         1. Say: "Please pronounce the word '${this.testWord}' as clearly as you can."
         2. Listen like a pronunciation expert for:
            - Individual phoneme accuracy (40% weight)
            - Word stress placement (20% weight)
            - Clarity and intelligibility (20% weight)
            - Natural rhythm/flow (20% weight)
         
         SPECIFIC FEEDBACK EXAMPLES:
         - Phonemes: "The 'th' sound needs your tongue between teeth, not behind them"
         - Vowels: "The 'a' in '${this.testWord}' should be more open - drop your jaw"
         - Consonants: "Add more aspiration to the 'p' - release more air"
         - Stress: "Put emphasis on the [first/second] syllable"
         
         SCORING GUIDE:
         - 90-100: Excellent, near-native pronunciation
         - 75-89: Good, minor issues not affecting comprehension
         - 60-74: Fair, noticeable errors but understandable
         - 40-59: Poor, significant issues affecting clarity
         - Below 40: Needs major improvement
         
         RESPONSE FORMAT:
         1. "I heard: [what you heard]"
         2. Specific issues: [list problems]
         3. How to improve: [concrete tips]
         4. "Score: [number]/100"
         
         Be HONEST but encouraging - accurate feedback helps improvement!`
      : '';

    const sessionConfig = {
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: `You are an expert pronunciation tutor. Your job is to help students improve their English pronunciation through detailed feedback and correction.
          
          ${languageInstructions}
          
          Current practice mode: ${this.practiceMode}
          
          MANDATORY WORD LIST (ONLY THESE WORDS, IN THIS EXACT ORDER):
          ${this.recentWords.map((w, i) => `${i+1}. "${w}"`).join('\n          ')}
          
          CRITICAL: You can ONLY practice the ${this.recentWords.length} words listed above. NEVER suggest or use any other words.
          
          YOUR ROLE AS A TUTOR:
          - Listen carefully to each pronunciation attempt
          - Identify specific pronunciation errors
          - Explain HOW to fix errors (tongue position, lip shape, breath control)
          - Give examples and demonstrations
          - Be patient, encouraging, but honest about mistakes
          - Celebrate improvements
          
          ${pronunciationInstructions}
          
          CRITICAL RULES:
          - You MUST practice ONLY the words from the numbered list above
          - NEVER make up or suggest any words not in the list
          - After 2 attempts at each word, STOP and WAIT
          - The system will tell you when to move to the next word
          - Give specific pronunciation feedback for each word
          - Stay focused on pronunciation practice`,
        voice: this.config.voice,
        tools: [], // Removed function calling - using direct word progression instead
        tool_choice: 'none',
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: {
          model: 'whisper-1'
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.8,  // Optimized for pronunciation practice
          prefix_padding_ms: 500,  // Capture full utterance
          silence_duration_ms: 800  // Allow natural speech pauses
        },
        temperature: 0  // Set to 0 for deterministic responses
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
            startInstructions = `${langReminder}YOU ARE A PRONUNCIATION TEACHER. 
            
            YOUR COMPLETE WORD LIST (${this.recentWords.length} words total):
            ${this.recentWords.map((w, i) => `Word #${i+1}: "${w}"`).join('\n            ')}
            
            CRITICAL: These are the ONLY ${this.recentWords.length} words you can use. NEVER use any other words like "beach", "thought", "world", etc.
            
            Start by saying: "Hello! I'm your pronunciation tutor. Today we'll practice these ${this.recentWords.length} specific words: ${this.recentWords.join(', ')}. I'll listen carefully to your pronunciation and help you improve. Let's start with word #1: '${this.recentWords[0]}'. Can you pronounce it for me?"
            
            CRITICAL RULES:
            1. Listen to their attempt at "${this.recentWords[0]}"
            2. Give specific feedback
            3. Say "Try '${this.recentWords[0]}' once more"
            4. Listen to second attempt
            5. Give final feedback
            6. STOP and WAIT - the system will give you the next word
            
            NEVER introduce words not in the numbered list above.
            After 2 attempts, WAIT for the system to continue.`;
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
        console.log('🔧 Function name:', data.name);
        console.log('🔧 Current words list:', this.recentWords);
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
        // Check full transcript for wrong words
        if (this.wordProgressionEnabled && this.recentWords.length > 0) {
          this.checkAndBlockWrongWords(data.transcript);
        }
        this.emit('assistant.transcript', data.transcript);
        break;
      
      case 'response.audio_transcript.delta':
        // Handle incremental transcript updates
        if (data.delta) {
          // Monitor for wrong words in pronunciation mode
          if (this.wordProgressionEnabled && this.recentWords.length > 0) {
            this.checkAndBlockWrongWords(data.delta);
          }
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
          
          // Track attempts and auto-progress after 2
          if (this.wordProgressionEnabled && transcript && this.recentWords.length > 0) {
            this.attemptCount++;
            console.log(`User attempt ${this.attemptCount} for word: ${this.recentWords[this.currentWordIndex]}`);
            
            // After 2 attempts, automatically move to next word
            if (this.attemptCount >= 2 && !this.waitingForNextWord) {
              this.waitingForNextWord = true;
              console.log(`✅ Completed 2 attempts for "${this.recentWords[this.currentWordIndex]}", moving to next word...`);
              setTimeout(() => this.forceNextWord(), 3000); // Give 3 seconds for feedback
            }
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
        console.error('Realtime API error:', data.error);
        this.emit('error', data.error);
        
        // Handle specific error types
        if (data.error?.type === 'invalid_request_error') {
          console.error('Invalid request - check API configuration');
        } else if (data.error?.type === 'server_error') {
          console.error('Server error - may need to retry');
        }
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
            text: `All words completed! Say: "Excellent work! You've practiced all the words. Your pronunciation is improving! Now return to FlashAcademy to take more lessons and learn many more words. FlashAcademy has thousands of words waiting for you to discover!"`
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

  private checkAndBlockWrongWords(text: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!this.wordProgressionEnabled || this.recentWords.length === 0) return;
    
    const currentWord = this.recentWords[this.currentWordIndex]?.toLowerCase() || '';
    const textLower = text.toLowerCase();
    
    // List of common wrong words the AI might use
    const wrongWords = ['beach', 'thought', 'world', 'through', 'light', 'water', 'tree', 'house', 'book', 'phone'];
    
    // Check if AI is trying to use a wrong word for practice
    for (const wrongWord of wrongWords) {
      if (textLower.includes(wrongWord) && !textLower.includes(currentWord)) {
        console.log(`🚫 BLOCKED: AI tried to use "${wrongWord}" instead of "${currentWord}"`);
        
        // Prevent rapid blocking
        const now = Date.now();
        if (now - this.lastBlockedTime < 1000) return;
        this.lastBlockedTime = now;
        
        // Cancel the current response
        this.ws.send(JSON.stringify({
          type: 'response.cancel'
        }));
        
        // Send correction
        setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
              type: 'conversation.item.create',
              item: {
                type: 'message',
                role: 'system',
                content: [{
                  type: 'text',
                  text: `STOP! You tried to use "${wrongWord}" but you MUST use "${this.recentWords[this.currentWordIndex]}". The current word is #${this.currentWordIndex + 1}: "${this.recentWords[this.currentWordIndex]}". Say: "Let's practice '${this.recentWords[this.currentWordIndex]}'. Can you pronounce it?"`
                }]
              }
            }));
            
            // Force correct response
            this.ws.send(JSON.stringify({
              type: 'response.create',
              response: {
                modalities: ['text', 'audio']
              }
            }));
          }
        }, 100);
        
        return;
      }
    }
    
    // Also check if AI mentions a word that's in our list but wrong position
    for (let i = 0; i < this.recentWords.length; i++) {
      if (i !== this.currentWordIndex) {
        const otherWord = this.recentWords[i].toLowerCase();
        if (textLower.includes(otherWord) && textLower.includes('practice')) {
          console.log(`🚫 BLOCKED: AI tried to skip to "${this.recentWords[i]}" (word #${i+1})`);
          
          // Cancel and correct
          this.ws.send(JSON.stringify({
            type: 'response.cancel'
          }));
          
          setTimeout(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.send(JSON.stringify({
                type: 'conversation.item.create',
                item: {
                  type: 'message',
                  role: 'system',
                  content: [{
                    type: 'text',
                    text: `STOP! Stay on word #${this.currentWordIndex + 1}: "${this.recentWords[this.currentWordIndex]}". Do not skip ahead. Say: "Let's focus on '${this.recentWords[this.currentWordIndex]}' first."`
                  }]
                }
              }));
              
              this.ws.send(JSON.stringify({
                type: 'response.create',
                response: {
                  modalities: ['text', 'audio']
                }
              }));
            }
          }, 100);
          
          return;
        }
      }
    }
  }
  
  private forceNextWord() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!this.wordProgressionEnabled) return;
    
    // Reset for next word
    this.attemptCount = 0;
    this.currentWordIndex++;
    this.waitingForNextWord = false;
    
    if (this.currentWordIndex >= this.recentWords.length) {
      // All words completed
      console.log('✅ All words completed!');
      this.ws.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'system',
          content: [{
            type: 'text',
            text: `All words completed! Say: "Excellent work! You've practiced all the words. Great job on your pronunciation! Now it's time to return to FlashAcademy to take more lessons and learn many more words. FlashAcademy will help you expand your vocabulary!"`
          }]
        }
      }));
    } else {
      // Force next word
      const nextWord = this.recentWords[this.currentWordIndex];
      console.log(`🎯 FORCING word #${this.currentWordIndex + 1}: "${nextWord}"`);
      
      // Clear any pending responses
      this.ws.send(JSON.stringify({
        type: 'response.cancel'
      }));
      
      // Add system message with next word
      this.ws.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'system',
          content: [{
            type: 'text',
            text: `Move to word #${this.currentWordIndex + 1} which is "${nextWord}". Say something like: "Good work on '${this.recentWords[this.currentWordIndex - 1]}'! Now let's practice word #${this.currentWordIndex + 1}: '${nextWord}'. Can you pronounce it for me?" Remember to listen carefully and provide detailed pronunciation feedback.`
          }]
        }
      }));
      
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
  }
  
  private handleMoveToNextWord(data: { call_id: string; arguments?: string | Record<string, unknown> }) {
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
        status: 'completed',
        next_word: null,
        exact_phrase_to_say: "Excellent work! You've completed all the words in today's practice session. Great job on your pronunciation! Now return to FlashAcademy to take more lessons and learn many more words. FlashAcademy has thousands of words and phrases waiting for you!",
        critical_instruction: "Practice session complete. Say the exact_phrase_to_say and remind them to return to FlashAcademy."
      };
    } else {
      // Get next word
      const nextWord = this.recentWords[this.currentWordIndex];
      console.log(`Next word is: ${nextWord} (${this.currentWordIndex + 1}/${this.recentWords.length})`);
      // Return a very explicit instruction that the AI must follow
      responseOutput = {
        status: 'continue',
        next_word: nextWord,
        word_number: this.currentWordIndex + 1,
        total_words: this.recentWords.length,
        exact_phrase_to_say: `Great! Now let's practice word #${this.currentWordIndex + 1}: '${nextWord}'. Can you pronounce it for me?`,
        critical_instruction: `You MUST say the exact_phrase_to_say above. The word is "${nextWord}" from position ${this.currentWordIndex + 1} in the list.`
      };
    }
    
    // Send function call output - OpenAI will automatically continue the response
    console.log('📤 Sending function output:', responseOutput);
    
    this.ws.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: data.call_id,
        output: JSON.stringify(responseOutput)
      }
    }));
    
    // Add a response.create with very strict instructions as a failsafe
    if (responseOutput.status === 'continue' && responseOutput.next_word) {
      setTimeout(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          console.log(`🎯 Forcing response for word: ${responseOutput.next_word}`);
          this.ws.send(JSON.stringify({
            type: 'response.create',
            response: {
              modalities: ['text', 'audio'],
              instructions: `The function returned word #${responseOutput.word_number}: "${responseOutput.next_word}". You MUST say EXACTLY: "${responseOutput.exact_phrase_to_say}" - DO NOT say any other word. The word is "${responseOutput.next_word}" NOT any other word.`
            }
          }));
        }
      }, 100);
    }
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
      ? `Excellent work! You've practiced all the words perfectly. Now it's time to return to FlashAcademy to take more lessons and learn many more words. FlashAcademy has thousands of words and phrases waiting for you to discover! (Remember: say "FlashAcademy" in English, rest in ${this.homeLanguage})`
      : 'Excellent work! You\'ve practiced all the words perfectly. Now it\'s time to return to FlashAcademy to take more lessons and learn many more words. FlashAcademy has thousands of words and phrases waiting for you to discover!';
    
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
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Silently drop audio if not connected
      return;
    }

    const base64Audio = btoa(String.fromCharCode(...new Uint8Array(audioData)));
    
    this.ws.send(JSON.stringify({
      type: 'input_audio_buffer.append',
      audio: base64Audio
    }));
  }

  private async playAudioChunk(base64Audio: string) {
    if (!this.audioContext) {
      console.warn('AudioContext not initialized');
      return;
    }

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
      } catch {
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
      } catch {
        // Ignore if already stopped
      }
    }
  }

  updateContext(words: WordEntry[], homeLanguage: string) {
    // Store context for session creation - use words as passed, already sorted/filtered
    this.recentWords = words.map(w => w.word);
    this.homeLanguage = homeLanguage;
    
    console.log('📚 Words set for practice:', this.recentWords);
    console.log('📚 Total words:', this.recentWords.length);

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
    this.wordProgressionEnabled = (mode === 'pronunciation');
    this.waitingForNextWord = false;

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

  private attemptReconnect() {
    this.reconnectAttempts++;
    console.log(`Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts}...`);
    
    setTimeout(async () => {
      try {
        await this.connect();
        this.reconnectAttempts = 0; // Reset on successful connection
        console.log('Reconnection successful');
        this.emit('reconnected');
      } catch (error) {
        console.error('Reconnection failed:', error);
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          this.emit('error', new Error('Maximum reconnection attempts reached'));
        }
      }
    }, this.reconnectDelay * this.reconnectAttempts);
  }

  disconnect() {
    // Prevent reconnection attempts
    this.reconnectAttempts = this.maxReconnectAttempts;
    
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