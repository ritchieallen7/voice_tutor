'use client';

import { Mic, BookOpen, MessageCircle } from 'lucide-react';
import { useStore } from '@/lib/store';

const modes = [
  {
    id: 'pronunciation' as const,
    name: 'Pronunciation',
    icon: Mic,
    description: 'Focus on speaking words clearly and correctly',
    color: 'blue'
  },
  {
    id: 'vocabulary' as const,
    name: 'Vocabulary',
    icon: BookOpen,
    description: 'Learn word meanings and usage in context',
    color: 'green'
  },
  {
    id: 'conversation' as const,
    name: 'Conversation',
    icon: MessageCircle,
    description: 'Practice natural conversation with learned words',
    color: 'purple'
  }
];

export function PracticeModes() {
  const { practiceMode, setPracticeMode, isRecording } = useStore();

  return (
    <div className="bg-white rounded-2xl shadow-xl p-6">
      <h2 className="text-2xl font-bold text-gray-800 mb-6">Practice Mode</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {modes.map((mode) => {
          const Icon = mode.icon;
          const isActive = practiceMode === mode.id;
          const colorClasses = {
            blue: 'bg-blue-500 border-blue-500 text-blue-600 bg-blue-50',
            green: 'bg-green-500 border-green-500 text-green-600 bg-green-50',
            purple: 'bg-purple-500 border-purple-500 text-purple-600 bg-purple-50'
          };
          const colors = colorClasses[mode.color as keyof typeof colorClasses];
          
          return (
            <button
              key={mode.id}
              onClick={() => !isRecording && setPracticeMode(mode.id)}
              disabled={isRecording}
              className={`p-4 rounded-xl border-2 transition-all duration-200 ${
                isActive
                  ? `${colors.split(' ')[1]} ${colors.split(' ')[3]}`
                  : 'border-gray-200 hover:border-gray-300 bg-white'
              } ${isRecording ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <div className="flex flex-col items-center space-y-3">
                <div className={`p-3 rounded-full ${
                  isActive ? colors.split(' ')[0] : 'bg-gray-100'
                }`}>
                  <Icon className={`w-6 h-6 ${
                    isActive ? 'text-white' : 'text-gray-600'
                  }`} />
                </div>
                <div className="text-center">
                  <h3 className={`font-semibold ${
                    isActive ? colors.split(' ')[2] : 'text-gray-800'
                  }`}>
                    {mode.name}
                  </h3>
                  <p className="text-xs text-gray-600 mt-1">
                    {mode.description}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      
      {isRecording && (
        <p className="text-sm text-gray-500 text-center mt-4">
          Mode cannot be changed during an active session
        </p>
      )}
    </div>
  );
}