'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, Phone, PhoneOff, Volume2 } from 'lucide-react';
import { useStore } from '@/lib/store';
import { RealtimeClient } from '@/lib/openai-realtime';

export function VoiceInterface() {
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [assistantTranscript, setAssistantTranscript] = useState('');
  const clientRef = useRef<RealtimeClient | null>(null);
  
  const {
    isRecording,
    setIsRecording,
    practiceMode,
    homeLanguage,
    getRecentWords,
    getWordsForPractice,
    getAllWords,
    currentSession,
    startSession,
    endSession
  } = useStore();

  useEffect(() => {
    return () => {
      if (clientRef.current) {
        clientRef.current.disconnect();
      }
    };
  }, []);

  const startConversation = async () => {
    try {
      // Clear previous transcripts
      setTranscript('');
      setAssistantTranscript('');
      
      if (!currentSession) {
        startSession(practiceMode);
      }

      const client = new RealtimeClient();

      client.on('connected', () => {
        setIsConnected(true);
        setIsRecording(true);
        console.log('Connected to OpenAI Realtime');
      });

      client.on('user.speaking.start', () => {
        setIsListening(true);
      });

      client.on('user.speaking.stop', () => {
        setIsListening(false);
      });

      client.on('user.transcript', (text: string) => {
        setTranscript(text);
      });

      client.on('assistant.transcript', (text: string) => {
        // Full transcript replacement (not a delta)
        setAssistantTranscript(text);
      });

      client.on('assistant.transcript.delta', (delta: string) => {
        // Incremental update only
        setAssistantTranscript(prev => prev + delta);
      });
      
      client.on('response.complete', () => {
        // Response finished, could update UI state here if needed
      });

      client.on('error', (error: unknown) => {
        console.error('Realtime error:', error);
      });

      // Set context BEFORE connecting so it's available during session creation
      // For pronunciation mode, use ALL words in their original order
      const wordsToUse = practiceMode === 'pronunciation' 
        ? getAllWords().slice(0, 10)  // Get first 10 words in original order
        : getRecentWords(20);
      
      console.log('🎯 Practice mode:', practiceMode);
      console.log('🎯 Words being sent:', wordsToUse.map(w => w.word));
      
      client.updateContext(wordsToUse, homeLanguage);
      client.setPracticeMode(practiceMode);
      
      // Now connect with the context already set
      await client.connect();
      
      clientRef.current = client;
    } catch (error) {
      console.error('Failed to start conversation:', error);
      setIsRecording(false);
    }
  };

  const stopConversation = () => {
    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
    }
    setIsConnected(false);
    setIsRecording(false);
    setIsListening(false);
    endSession();
  };

  return (
    <div className="bg-white rounded-2xl shadow-xl p-8">
      <div className="flex flex-col items-center space-y-6">
        {/* Status Indicator */}
        <div className="flex items-center space-x-2">
          <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-300'} ${isListening ? 'animate-pulse' : ''}`} />
          <span className="text-sm text-gray-600">
            {isConnected ? (isListening ? 'Listening...' : 'Connected') : 'Not connected'}
          </span>
        </div>

        {/* Main Control Button */}
        <button
          onClick={isRecording ? stopConversation : startConversation}
          className={`relative p-8 rounded-full transition-all duration-300 ${
            isRecording 
              ? 'bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/30' 
              : 'bg-blue-500 hover:bg-blue-600 shadow-lg shadow-blue-500/30'
          }`}
        >
          {isRecording ? (
            <PhoneOff className="w-12 h-12 text-white" />
          ) : (
            <Phone className="w-12 h-12 text-white" />
          )}
          
          {/* Pulse animation when listening */}
          {isListening && (
            <>
              <span className="absolute inset-0 rounded-full bg-blue-400 animate-ping opacity-30" />
              <span className="absolute inset-0 rounded-full bg-blue-400 animate-ping animation-delay-200 opacity-20" />
            </>
          )}
        </button>

        <p className="text-gray-600 text-center">
          {isRecording 
            ? 'Tap to end conversation' 
            : 'Tap to start practicing'}
        </p>

        {/* Transcripts */}
        {(transcript || assistantTranscript) && (
          <div className="w-full space-y-4 mt-6">
            {assistantTranscript && (
              <div className="bg-green-50 rounded-lg p-4">
                <div className="flex items-center space-x-2 mb-2">
                  <Volume2 className="w-4 h-4 text-green-600" />
                  <span className="text-sm font-medium text-green-600">Tutor</span>
                </div>
                <p className="text-gray-800 whitespace-pre-wrap">{assistantTranscript}</p>
              </div>
            )}
            
            {transcript && (
              <div className="bg-blue-50 rounded-lg p-4">
                <div className="flex items-center space-x-2 mb-2">
                  <Mic className="w-4 h-4 text-blue-600" />
                  <span className="text-sm font-medium text-blue-600">You</span>
                </div>
                <p className="text-gray-800">{transcript}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}