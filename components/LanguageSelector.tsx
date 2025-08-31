'use client';

import { Globe } from 'lucide-react';
import { useStore } from '@/lib/store';

const languages = [
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'it', name: 'Italian', native: 'Italiano' },
  { code: 'pt', name: 'Portuguese', native: 'Português' },
  { code: 'ru', name: 'Russian', native: 'Русский' },
  { code: 'zh', name: 'Chinese', native: '中文' },
  { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'ko', name: 'Korean', native: '한국어' },
  { code: 'ar', name: 'Arabic', native: 'العربية' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe' },
  { code: 'pl', name: 'Polish', native: 'Polski' },
  { code: 'nl', name: 'Dutch', native: 'Nederlands' },
  { code: 'sv', name: 'Swedish', native: 'Svenska' }
];

export function LanguageSelector() {
  const { homeLanguage, setHomeLanguage, isRecording } = useStore();

  return (
    <div className="bg-white rounded-2xl shadow-xl p-6">
      <div className="flex items-center space-x-2 mb-4">
        <Globe className="w-5 h-5 text-blue-600" />
        <h2 className="text-xl font-bold text-gray-800">Home Language</h2>
      </div>
      
      <p className="text-sm text-gray-600 mb-4">
        Instructions and support will be provided in this language
      </p>
      
      <select
        value={homeLanguage}
        onChange={(e) => setHomeLanguage(e.target.value)}
        disabled={isRecording}
        className={`w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          isRecording ? 'opacity-50 cursor-not-allowed bg-gray-50' : 'bg-white'
        }`}
      >
        {languages.map((lang) => (
          <option key={lang.code} value={lang.name}>
            {lang.name} ({lang.native})
          </option>
        ))}
      </select>
      
      {isRecording && (
        <p className="text-xs text-gray-500 mt-2">
          Language cannot be changed during an active session
        </p>
      )}
    </div>
  );
}