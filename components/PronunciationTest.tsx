'use client';

import { useState, useEffect, useRef } from 'react';
import { Phone, PhoneOff, Volume2, Check, X, ChevronRight, Award, RotateCcw } from 'lucide-react';
import { useStore } from '@/lib/store';
import { RealtimeClient } from '@/lib/openai-realtime';

interface PronunciationScore {
  wordId: string;
  word: string;
  score: number;
  attempts: number;
  feedback: string;
  passed: boolean;
}

export function PronunciationTest() {
  const [isTestActive, setIsTestActive] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [currentAttempt, setCurrentAttempt] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [userTranscript, setUserTranscript] = useState('');
  const [tutorTranscript, setTutorTranscript] = useState('');
  const [scores, setScores] = useState<PronunciationScore[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [waitingForPronunciation, setWaitingForPronunciation] = useState(false);
  const clientRef = useRef<RealtimeClient | null>(null);
  
  const {
    words,
    homeLanguage,
    updateWordMastery,
    incrementPracticeCount,
    startSession,
    endSession,
    addWordToSession
  } = useStore();

  // Get words to test (recent words or all if less than 10)
  const testWords = words.slice(-10);
  const currentWord = testWords[currentWordIndex];

  useEffect(() => {
    return () => {
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }
    };
  }, []);

  const startTest = async () => {
    setIsTestActive(true);
    setCurrentWordIndex(0);
    setCurrentAttempt(0);
    setScores([]);
    setShowResults(false);
    setUserTranscript('');
    setTutorTranscript('');
    startSession('pronunciation');
    
    // Initialize scores for all test words
    const initialScores = testWords.map(word => ({
      wordId: word.id,
      word: word.word,
      score: 0,
      attempts: 0,
      feedback: '',
      passed: false
    }));
    setScores(initialScores);

    // Start the conversational test
    await connectToTutor();
  };

  const connectToTutor = async () => {
    if (!testWords[0]) return;
    
    try {
      setUserTranscript('');
      setTutorTranscript('');
      
      const client = new RealtimeClient();
      
      client.on('connected', () => {
        setIsConnected(true);
        console.log('Connected for pronunciation test');
      });

      client.on('user.speaking.start', () => {
        setIsListening(true);
      });

      client.on('user.speaking.stop', () => {
        setIsListening(false);
      });

      client.on('user.transcript', (text: string) => {
        setUserTranscript(text);
        
        // If we're waiting for pronunciation and user speaks
        if (waitingForPronunciation && text.trim()) {
          setWaitingForPronunciation(false);
          setCurrentAttempt(prev => prev + 1);
        }
      });

      client.on('assistant.transcript', (text: string) => {
        setTutorTranscript(text);
        
        // Check if tutor is asking for pronunciation
        if (text.includes('pronounce') || text.includes('say') || text.includes('repeat')) {
          setWaitingForPronunciation(true);
        }
        
        // Parse feedback for score
        const scoreMatch = text.match(/Score:\s*(\d+)/i);
        if (scoreMatch) {
          const score = parseInt(scoreMatch[1]);
          evaluatePronunciation(score, text);
        }
      });

      client.on('assistant.transcript.delta', (delta: string) => {
        setTutorTranscript(prev => prev + delta);
      });

      client.on('disconnected', () => {
        setIsConnected(false);
      });

      // Configure for pronunciation testing with first word
      (client as any).setTestWord(testWords[0].word);
      (client as any).setPracticeMode('pronunciation-test');
      client.updateContext([], homeLanguage);
      
      await client.connect();
      
      clientRef.current = client;
      
    } catch (error) {
      console.error('Failed to start pronunciation test:', error);
      setIsConnected(false);
    }
  };

  const evaluatePronunciation = (score: number, feedback: string) => {
    if (!currentWord) return;
    
    // Update scores
    setScores(prev => prev.map((s, idx) => {
      if (idx === currentWordIndex) {
        return {
          ...s,
          score: Math.max(s.score, score),
          attempts: currentAttempt,
          feedback: feedback,
          passed: score >= 70
        };
      }
      return s;
    }));
    
    // Update word mastery if passed
    if (score >= 70) {
      updateWordMastery(currentWord.id, Math.min(100, currentWord.mastery + 10));
      incrementPracticeCount(currentWord.id);
      addWordToSession(currentWord.id);
    }

    // Automatically move to next word after a short delay
    setTimeout(() => {
      if (score >= 70 || currentAttempt >= 3) {
        moveToNextWord();
      }
    }, 3000);
  };

  const moveToNextWord = () => {
    if (currentWordIndex < testWords.length - 1) {
      const nextIndex = currentWordIndex + 1;
      setCurrentWordIndex(nextIndex);
      setCurrentAttempt(0);
      setUserTranscript('');
      setWaitingForPronunciation(false);
      
      // Update the test word for the AI
      if (clientRef.current && testWords[nextIndex]) {
        (clientRef.current as any).setTestWord(testWords[nextIndex].word);
        
        // Send instruction to test next word
        if ((clientRef.current as any).ws && (clientRef.current as any).ws.readyState === WebSocket.OPEN) {
          (clientRef.current as any).ws.send(JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'system',
              content: [{
                type: 'text',
                text: `NEXT WORD TEST: "${testWords[nextIndex].word}"
                       
                       Remember to:
                       1. Ask the student to pronounce this word clearly
                       2. Listen carefully and evaluate critically
                       3. Give specific feedback on any pronunciation issues
                       4. Provide a score from 0-100 based on accuracy
                       5. End your feedback with "Score: [number]/100"
                       
                       Be honest but encouraging. Students need real feedback to improve!`
              }]
            }
          }));
          
          // Trigger response
          (clientRef.current as any).ws.send(JSON.stringify({
            type: 'response.create',
            response: {
              modalities: ['text', 'audio'],
              instructions: `Now test the word "${testWords[nextIndex].word}". Be critical but constructive in your evaluation.`
            }
          }));
        }
      }
    } else {
      // Test complete
      endTest();
    }
  };

  const endTest = () => {
    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
    }
    setIsConnected(false);
    setShowResults(true);
    endSession();
  };

  const stopTest = () => {
    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
    }
    setIsConnected(false);
    setIsTestActive(false);
    setShowResults(false);
    endSession();
  };

  const playWordAudio = () => {
    if (currentWord && 'speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(currentWord.word);
      utterance.lang = 'en-US';
      utterance.rate = 0.8;
      speechSynthesis.speak(utterance);
    }
  };

  const retryWord = () => {
    setUserTranscript('');
    setWaitingForPronunciation(true);
    
    // Ask AI to retry the current word
    if (clientRef.current && currentWord) {
      if ((clientRef.current as any).ws && (clientRef.current as any).ws.readyState === WebSocket.OPEN) {
        (clientRef.current as any).ws.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'system',
            content: [{
              type: 'text',
              text: `The student wants to try pronouncing "${currentWord.word}" again.
                     
                     IMPORTANT: Continue being CRITICAL in your evaluation!
                     - Listen carefully to this new attempt
                     - Compare it to their previous attempt
                     - Note any improvements or continuing issues
                     - Give a fair score based on this attempt
                     - End with "Score: [number]/100"
                     
                     Be encouraging about improvements but honest about what still needs work.`
            }]
          }
        }));
        
        (clientRef.current as any).ws.send(JSON.stringify({
          type: 'response.create',
          response: {
            modalities: ['text', 'audio'],
            instructions: `Ask them to try "${currentWord.word}" again. Evaluate critically but note any improvements.`
          }
        }));
      }
    }
  };

  if (showResults) {
    const totalScore = scores.reduce((acc, s) => acc + s.score, 0) / scores.length;
    const passedCount = scores.filter(s => s.passed).length;
    
    return (
      <div className="bg-white rounded-2xl shadow-xl p-8">
        <div className="text-center mb-8">
          <Award className="w-16 h-16 text-yellow-500 mx-auto mb-4" />
          <h2 className="text-3xl font-bold text-gray-800 mb-2">Test Complete!</h2>
          <p className="text-xl text-gray-600">
            Overall Score: <span className="font-bold text-blue-600">{totalScore.toFixed(0)}%</span>
          </p>
          <p className="text-lg text-gray-600 mt-2">
            Passed: {passedCount} / {scores.length} words
          </p>
        </div>
        
        <div className="space-y-4 mb-8">
          {scores.map((score, idx) => (
            <div key={idx} className={`p-4 rounded-lg border-2 ${
              score.passed ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-lg">{score.word}</span>
                <div className="flex items-center space-x-2">
                  <span className={`font-bold ${
                    score.passed ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {score.score}%
                  </span>
                  {score.passed ? (
                    <Check className="w-5 h-5 text-green-600" />
                  ) : (
                    <X className="w-5 h-5 text-red-600" />
                  )}
                </div>
              </div>
              <p className="text-sm text-gray-600">Attempts: {score.attempts}</p>
            </div>
          ))}
        </div>
        
        <button
          onClick={() => {
            setShowResults(false);
            setIsTestActive(false);
          }}
          className="w-full py-3 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg transition-colors"
        >
          Finish
        </button>
      </div>
    );
  }

  if (!isTestActive) {
    return (
      <div className="bg-white rounded-2xl shadow-xl p-8">
        <div className="text-center">
          <Phone className="w-16 h-16 text-blue-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-800 mb-4">Pronunciation Test</h2>
          <p className="text-gray-600 mb-6">
            Connect with your AI tutor for a conversational pronunciation test. 
            Your tutor will guide you through testing your pronunciation skills.
          </p>
          
          {testWords.length === 0 ? (
            <p className="text-amber-600 mb-6">
              Please add some words to your vocabulary first!
            </p>
          ) : (
            <>
              <div className="bg-blue-50 rounded-lg p-4 mb-6">
                <p className="text-sm text-blue-800">
                  <strong>How it works:</strong> Your AI tutor will test your pronunciation one word at a time.
                  Just speak naturally when prompted. You can interrupt anytime, and the tutor will 
                  provide detailed feedback. Words scoring 70% or higher pass.
                </p>
              </div>
              
              <button
                onClick={startTest}
                className="px-8 py-3 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg transition-colors inline-flex items-center space-x-2"
              >
                <Phone className="w-5 h-5" />
                <span>Start Conversation Test</span>
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-xl p-8">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-gray-800">Pronunciation Test</h2>
          <div className="flex items-center space-x-4">
            <span className="text-sm text-gray-600">
              Word {currentWordIndex + 1} of {testWords.length}
            </span>
            <div className={`flex items-center space-x-2 ${isConnected ? 'text-green-600' : 'text-gray-500'}`}>
              <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-300'} ${isListening ? 'animate-pulse' : ''}`} />
              <span className="text-sm">
                {isConnected ? (isListening ? 'Listening...' : 'Connected') : 'Connecting...'}
              </span>
            </div>
          </div>
        </div>
        
        <div className="bg-gray-200 rounded-full h-2 mb-4">
          <div 
            className="bg-blue-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${((currentWordIndex + 1) / testWords.length) * 100}%` }}
          />
        </div>
      </div>

      {currentWord && (
        <div className="space-y-6">
          <div className="bg-blue-50 rounded-xl p-6 text-center">
            <p className="text-sm text-gray-600 mb-2">Current word:</p>
            <h3 className="text-4xl font-bold text-blue-600 mb-4">{currentWord.word}</h3>
            
            <div className="flex justify-center space-x-4">
              <button
                onClick={playWordAudio}
                className="inline-flex items-center space-x-2 px-4 py-2 bg-white rounded-lg hover:bg-gray-50 transition-colors"
              >
                <Volume2 className="w-5 h-5 text-gray-600" />
                <span className="text-sm text-gray-600">Hear it</span>
              </button>
              
              {currentAttempt > 0 && currentAttempt < 3 && scores[currentWordIndex]?.score < 70 && (
                <button
                  onClick={retryWord}
                  className="inline-flex items-center space-x-2 px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
                >
                  <RotateCcw className="w-5 h-5" />
                  <span className="text-sm">Try Again</span>
                </button>
              )}
            </div>

            {currentAttempt > 0 && (
              <p className="text-sm text-gray-600 mt-3">
                Attempt {currentAttempt} / 3
              </p>
            )}
          </div>

          {/* Conversation Area */}
          <div className="space-y-4">
            {tutorTranscript && (
              <div className="bg-green-50 rounded-lg p-4">
                <div className="flex items-center space-x-2 mb-2">
                  <Volume2 className="w-4 h-4 text-green-600" />
                  <span className="text-sm font-medium text-green-600">Tutor</span>
                </div>
                <p className="text-gray-800 whitespace-pre-wrap">{tutorTranscript}</p>
              </div>
            )}
            
            {userTranscript && (
              <div className="bg-blue-50 rounded-lg p-4">
                <div className="flex items-center space-x-2 mb-2">
                  <div className="w-4 h-4 rounded-full bg-blue-600" />
                  <span className="text-sm font-medium text-blue-600">You</span>
                </div>
                <p className="text-gray-800">{userTranscript}</p>
              </div>
            )}
          </div>

          {/* Control Button */}
          <div className="flex justify-center">
            <button
              onClick={stopTest}
              className="px-8 py-4 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-lg transition-colors inline-flex items-center space-x-2"
            >
              <PhoneOff className="w-5 h-5" />
              <span>End Test</span>
            </button>
          </div>

          {scores[currentWordIndex]?.score > 0 && (
            <div className="bg-yellow-50 rounded-lg p-4">
              <p className="text-sm font-semibold text-yellow-800 mb-1">
                Score: {scores[currentWordIndex].score}%
              </p>
              {scores[currentWordIndex].score >= 70 && (
                <p className="text-green-600 font-medium">Great job! Moving to next word...</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}