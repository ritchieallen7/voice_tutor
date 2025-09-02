import { create } from 'zustand';

export interface Word {
  id: string;
  word: string;
  timestamp: Date;
  language: string;
  mastery: number;
  practiceCount: number;
  lastPracticed?: Date;
  orderIndex?: number; // For maintaining order of words
}

export interface Session {
  id: string;
  startTime: Date;
  endTime?: Date;
  mode: 'pronunciation' | 'vocabulary' | 'conversation';
  wordsReviewed: string[];
  duration?: number;
}

export interface AppState {
  // User settings
  homeLanguage: string;
  setHomeLanguage: (language: string) => void;
  
  // Words management
  words: Word[];
  addWord: (word: string, language?: string) => void;
  updateWordMastery: (id: string, mastery: number) => void;
  incrementPracticeCount: (id: string) => void;
  bulkAddWords: (words: { word: string; timestamp: Date }[]) => void;
  
  // Session management
  currentSession: Session | null;
  sessions: Session[];
  startSession: (mode: 'pronunciation' | 'vocabulary' | 'conversation') => void;
  endSession: () => void;
  addWordToSession: (wordId: string) => void;
  
  // Practice mode
  practiceMode: 'pronunciation' | 'vocabulary' | 'conversation';
  setPracticeMode: (mode: 'pronunciation' | 'vocabulary' | 'conversation') => void;
  
  // Voice session
  isRecording: boolean;
  setIsRecording: (recording: boolean) => void;
  
  // Analytics
  getTotalWords: () => number;
  getMasteredWords: () => number;
  getRecentWords: (limit?: number) => Word[];
  getTodaysPractice: () => number;
  getWordsForPractice: (limit?: number) => Word[];
  getAllWords: () => Word[];
}

export const useStore = create<AppState>((set, get) => ({
      // Initial state
      homeLanguage: 'English',
      words: [],
      currentSession: null,
      sessions: [],
      practiceMode: 'conversation',
      isRecording: false,
      
      // User settings
      setHomeLanguage: (language) => set({ homeLanguage: language }),
      
      // Words management
      addWord: (word, language = 'en') => {
        const state = get();
        const newWord: Word = {
          id: Date.now().toString(),
          word,
          timestamp: new Date(),
          language,
          mastery: 0,
          practiceCount: 0,
          orderIndex: state.words.length // Maintain insertion order
        };
        set((state) => ({ words: [...state.words, newWord] }));
      },
      
      updateWordMastery: (id, mastery) => {
        set((state) => ({
          words: state.words.map(w => 
            w.id === id ? { ...w, mastery, lastPracticed: new Date() } : w
          )
        }));
      },
      
      incrementPracticeCount: (id) => {
        set((state) => ({
          words: state.words.map(w => 
            w.id === id ? { ...w, practiceCount: w.practiceCount + 1, lastPracticed: new Date() } : w
          )
        }));
      },
      
      bulkAddWords: (newWords) => {
        const state = get();
        const currentMaxIndex = state.words.length;
        const words = newWords.map((w, index) => ({
          id: `${Date.now()}-${index}`,
          word: w.word,
          timestamp: w.timestamp,
          language: 'en',
          mastery: 0,
          practiceCount: 0,
          orderIndex: currentMaxIndex + index // Maintain insertion order
        }));
        set((state) => ({ words: [...state.words, ...words] }));
      },
      
      // Session management
      startSession: (mode) => {
        const session: Session = {
          id: Date.now().toString(),
          startTime: new Date(),
          mode,
          wordsReviewed: []
        };
        set({ currentSession: session, practiceMode: mode });
      },
      
      endSession: () => {
        const { currentSession, sessions } = get();
        if (currentSession) {
          const endedSession = {
            ...currentSession,
            endTime: new Date(),
            duration: Date.now() - currentSession.startTime.getTime()
          };
          set({
            currentSession: null,
            sessions: [...sessions, endedSession]
          });
        }
      },
      
      addWordToSession: (wordId) => {
        set((state) => {
          if (!state.currentSession) return state;
          return {
            currentSession: {
              ...state.currentSession,
              wordsReviewed: [...state.currentSession.wordsReviewed, wordId]
            }
          };
        });
      },
      
      // Practice mode
      setPracticeMode: (mode) => set({ practiceMode: mode }),
      
      // Voice session
      setIsRecording: (recording) => set({ isRecording: recording }),
      
      // Analytics
      getTotalWords: () => get().words.length,
      
      getMasteredWords: () => get().words.filter(w => w.mastery >= 80).length,
      
      getRecentWords: (limit = 10) => {
        const words = get().words;
        // Sort by orderIndex first (if available), then by timestamp
        return [...words]
          .sort((a, b) => {
            if (a.orderIndex !== undefined && b.orderIndex !== undefined) {
              return b.orderIndex - a.orderIndex; // Most recent (highest index) first
            }
            return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
          })
          .slice(0, limit);
      },
      
      getTodaysPractice: () => {
        const today = new Date().toDateString();
        return get().sessions.filter(s => 
          new Date(s.startTime).toDateString() === today
        ).length;
      },
      
      // Get words for practice - prioritizes least practiced and lowest mastery
      getWordsForPractice: (limit = 10) => {
        const words = get().words;
        if (words.length === 0) return [];
        
        // Sort by practice priority: least practiced first, then by mastery (lowest first)
        return [...words]
          .sort((a, b) => {
            // First priority: practice count (lower is better)
            if (a.practiceCount !== b.practiceCount) {
              return a.practiceCount - b.practiceCount;
            }
            // Second priority: mastery level (lower is better)
            if (a.mastery !== b.mastery) {
              return a.mastery - b.mastery;
            }
            // Third priority: most recently added (higher orderIndex)
            if (a.orderIndex !== undefined && b.orderIndex !== undefined) {
              return b.orderIndex - a.orderIndex;
            }
            // Fallback to timestamp
            return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
          })
          .slice(0, Math.min(limit, words.length));
      },
      
      // Get all words in the order they were added
      getAllWords: () => {
        const words = get().words;
        return [...words].sort((a, b) => {
          if (a.orderIndex !== undefined && b.orderIndex !== undefined) {
            return a.orderIndex - b.orderIndex; // Original order
          }
          return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
        });
      }
    })
);