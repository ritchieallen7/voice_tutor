'use client';

import { useState } from 'react';
import { VoiceInterface } from '@/components/VoiceInterface';
import { WordManager } from '@/components/WordManager';
import { PracticeModes } from '@/components/PracticeModes';
import { PronunciationTest } from '@/components/PronunciationTest';
import { LanguageSelector } from '@/components/LanguageSelector';
import { Dashboard } from '@/components/Dashboard';
import { Headphones, BookOpen, BarChart3, Settings, Mic } from 'lucide-react';

export default function Home() {
  const [activeTab, setActiveTab] = useState<'practice' | 'test' | 'words' | 'dashboard' | 'settings'>('practice');

  const tabs = [
    { id: 'practice' as const, label: 'Practice', icon: Headphones },
    { id: 'test' as const, label: 'Test', icon: Mic },
    { id: 'words' as const, label: 'Words', icon: BookOpen },
    { id: 'dashboard' as const, label: 'Dashboard', icon: BarChart3 },
    { id: 'settings' as const, label: 'Settings', icon: Settings }
  ];

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Voice Tutor</h1>
              <p className="text-sm text-gray-600 mt-1">AI-powered language learning assistant</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-500">Powered by</p>
              <p className="text-sm font-semibold text-gray-700">FlashAcademy & OpenAI</p>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-8">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center space-x-2 py-4 px-2 border-b-2 transition-colors ${
                    activeTab === tab.id
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="font-medium">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'practice' && (
          <div className="space-y-6">
            <PracticeModes />
            <VoiceInterface />
          </div>
        )}
        
        {activeTab === 'test' && (
          <PronunciationTest />
        )}
        
        {activeTab === 'words' && (
          <WordManager />
        )}
        
        {activeTab === 'dashboard' && (
          <Dashboard />
        )}
        
        {activeTab === 'settings' && (
          <div className="space-y-6">
            <LanguageSelector />
            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h2 className="text-xl font-bold text-gray-800 mb-4">About</h2>
              <div className="space-y-3 text-sm text-gray-600">
                <p>
                  Voice Tutor uses OpenAI's Realtime API to provide conversational language practice.
                </p>
                <p>
                  The system observes words you've learned on the FlashAcademy platform and helps you practice pronunciation, vocabulary, and conversation skills.
                </p>
                <div className="pt-4 border-t border-gray-200">
                  <p className="font-semibold text-gray-700 mb-2">Features:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Continuous conversation flow - no need to press record for each word</li>
                    <li>Three practice modes tailored to different learning goals</li>
                    <li>Multi-language support for instructions (15+ languages)</li>
                    <li>Real-time pronunciation feedback</li>
                    <li>Progress tracking and analytics</li>
                    <li>Word management with timestamp tracking</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
