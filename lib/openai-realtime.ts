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

  private practiceMode: 'pronunciation' | 'vocabulary' | 'conversation' = 'conversation';
  private homeLanguage: string = 'English';
  private recentWords: string[] = [];

  private createSession() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // Create mode-specific instructions
    const modeInstructions = {
      pronunciation: `Focus on pronunciation practice with THE UPLOADED WORDS. Listen carefully to how the student pronounces these specific words. 
        Provide gentle, constructive feedback on their pronunciation. Help them with difficult sounds in these words. 
        Practice the uploaded words in context rather than isolation. Create sentences using these words.`,
      vocabulary: `Focus on vocabulary building using THE UPLOADED WORDS. Test understanding of these specific word meanings. 
        Use each uploaded word in different contexts. Ask questions that require using these vocabulary words. 
        Create scenarios where they need to use these specific words naturally.`,
      conversation: `Engage in natural conversation that incorporates ALL THE UPLOADED WORDS. 
        Build the conversation around topics that naturally use these words. 
        Keep weaving these words into the discussion. Gently correct errors but prioritize using all the uploaded vocabulary.`
    };

    // Build language-aware instructions
    const languageInstructions = this.homeLanguage.toLowerCase() !== 'english' 
      ? `IMPORTANT: The student's native language is ${this.homeLanguage}. 
         Give ALL instructions, greetings, encouragement, and explanations in ${this.homeLanguage}.
         However, the English content being taught (words, phrases, example sentences) must remain in English.
         Be bilingual - speak to them in ${this.homeLanguage} but teach them English.
         For example: greet in ${this.homeLanguage}, explain in ${this.homeLanguage}, but practice English words.`
      : `The student is a native English speaker learning to improve their English skills.
         Use clear, simple English for all communication.`;

    const wordsContext = this.recentWords.length > 0 
      ? `IMPORTANT: The student has uploaded these specific words to practice: ${this.recentWords.join(', ')}. 
         These are THE WORDS you must focus on. Don't ask what to practice - use THESE WORDS.
         Incorporate all of these words naturally throughout the session.`
      : `The student hasn't added any specific words yet. Help them get started by suggesting they add words to practice, 
         or practice general English conversation.`;

    const sessionConfig = {
      type: 'session.create',
      session: {
        model: this.config.model,
        voice: this.config.voice,
        instructions: `You are an expert language tutor specialized in teaching English through conversational practice.
          
          ${languageInstructions}
          
          Current practice mode: ${this.practiceMode.toUpperCase()}
          ${modeInstructions[this.practiceMode]}
          
          ${wordsContext}
          
          IMPORTANT BEHAVIORS:
          1. START the conversation immediately with a friendly greeting in ${this.homeLanguage}
          2. If words were uploaded, immediately start practicing THOSE SPECIFIC WORDS - don't ask what to focus on
          3. If no words uploaded, suggest adding words or start general practice
          4. Be encouraging and patient - learning a language is challenging
          5. Keep responses concise - this is a conversation, not a lecture
          6. For pronunciation mode: Practice each uploaded word's pronunciation in sentences
          7. For vocabulary mode: Test understanding of each uploaded word with examples
          8. For conversation mode: Create natural dialogue using all the uploaded words
          
          Remember: The uploaded words are the curriculum. Use them all. Don't ask what to practice if words are provided.`,
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500
        }
      }
    };

    this.ws.send(JSON.stringify(sessionConfig));

    // Send initial response request to make the tutor start talking
    setTimeout(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const startInstructions = this.recentWords.length > 0
          ? `Start with a warm greeting, then immediately begin practicing these words: ${this.recentWords.join(', ')}. 
             Don't ask what to practice - jump right into using these words in ${this.practiceMode} mode.`
          : `Start with a warm greeting and ask what words they'd like to practice today, or suggest they add some words to their vocabulary list.`;
        
        this.ws.send(JSON.stringify({
          type: 'response.create',
          response: {
            modalities: ['text', 'audio'],
            instructions: startInstructions
          }
        }));
      }
    }, 500);
  }

  private handleMessage(data: any) {
    switch (data.type) {
      case 'session.created':
        this.sessionId = data.session_id;
        this.emit('session.created', data);
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
        this.emit('user.speaking.start');
        break;
      
      case 'input_audio_buffer.speech_stopped':
        this.emit('user.speaking.stop');
        break;
      
      case 'conversation.item.created':
        if (data.item.type === 'message' && data.item.role === 'user') {
          this.emit('user.transcript', data.item.content?.[0]?.transcript || '');
        }
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

    // Schedule playback
    const now = this.audioContext.currentTime;
    const playTime = Math.max(now, this.nextPlaybackTime);
    source.start(playTime);
    
    // Update next playback time
    this.nextPlaybackTime = playTime + audioBuffer.duration;

    // Process next chunk when this one finishes
    source.onended = () => {
      this.processPlaybackQueue();
    };
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

  setPracticeMode(mode: 'pronunciation' | 'vocabulary' | 'conversation') {
    // Store the practice mode
    this.practiceMode = mode;

    // If already connected, update the mode
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const modeInstructions = {
        pronunciation: `Switch to PRONUNCIATION mode. Focus on helping with pronunciation, sounds, rhythm, and intonation. 
          Practice words in context. Give specific feedback on pronunciation issues.`,
        vocabulary: `Switch to VOCABULARY mode. Test understanding of word meanings. 
          Use words in different contexts. Create scenarios for natural usage.`,
        conversation: `Switch to CONVERSATION mode. Engage in natural, flowing conversation. 
          Incorporate learned words naturally. Prioritize fluency over perfect accuracy.`
      };

      this.ws.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'system',
          content: [{
            type: 'text',
            text: modeInstructions[mode]
          }]
        }
      }));
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