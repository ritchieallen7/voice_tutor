'use client';

import { useState } from 'react';
import { Plus, Clock, Hash, TrendingUp } from 'lucide-react';
import { useStore } from '@/lib/store';
import { format } from 'date-fns';

export function WordManager() {
  const [newWord, setNewWord] = useState('');
  const [bulkWords, setBulkWords] = useState('');
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  
  const { words, addWord, bulkAddWords, getRecentWords } = useStore();
  const recentWords = getRecentWords(10);

  const handleAddWord = (e: React.FormEvent) => {
    e.preventDefault();
    if (newWord.trim()) {
      addWord(newWord.trim());
      setNewWord('');
    }
  };

  const handleBulkAdd = () => {
    const wordsArray = bulkWords.split('\n').filter(w => w.trim());
    // Use the same timestamp for all bulk-added words to maintain proper order
    const currentTime = new Date();
    const wordsWithTimestamps = wordsArray.map((word) => ({
      word: word.trim(),
      timestamp: currentTime
    }));
    bulkAddWords(wordsWithTimestamps);
    setBulkWords('');
    setShowBulkAdd(false);
  };

  return (
    <div className="bg-white rounded-2xl shadow-xl p-6">
      <h2 className="text-2xl font-bold text-gray-800 mb-6">Word Management</h2>
      
      {/* Add Word Form */}
      <form onSubmit={handleAddWord} className="mb-6">
        <div className="flex space-x-2">
          <input
            type="text"
            value={newWord}
            onChange={(e) => setNewWord(e.target.value)}
            placeholder="Enter a new word..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center space-x-2"
          >
            <Plus className="w-4 h-4" />
            <span>Add Word</span>
          </button>
        </div>
      </form>

      {/* Bulk Add Toggle */}
      <button
        onClick={() => setShowBulkAdd(!showBulkAdd)}
        className="mb-4 text-sm text-blue-600 hover:text-blue-700 underline"
      >
        {showBulkAdd ? 'Hide' : 'Show'} Bulk Add (Simulate DB)
      </button>

      {/* Bulk Add Form */}
      {showBulkAdd && (
        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <textarea
            value={bulkWords}
            onChange={(e) => setBulkWords(e.target.value)}
            placeholder="Enter multiple words, one per line..."
            className="w-full h-32 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleBulkAdd}
            className="mt-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
          >
            Add All Words
          </button>
        </div>
      )}

      {/* Recent Words List */}
      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-gray-700 mb-3">Recent Words</h3>
        {recentWords.length === 0 ? (
          <p className="text-gray-500 text-center py-4">No words added yet</p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {recentWords.map((word) => (
              <div
                key={word.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="flex-1">
                  <p className="font-medium text-gray-800">{word.word}</p>
                  <div className="flex items-center space-x-4 mt-1 text-xs text-gray-500">
                    <span className="flex items-center space-x-1">
                      <Clock className="w-3 h-3" />
                      <span>{format(new Date(word.timestamp), 'MMM d, h:mm a')}</span>
                    </span>
                    <span className="flex items-center space-x-1">
                      <Hash className="w-3 h-3" />
                      <span>{word.practiceCount} practices</span>
                    </span>
                    <span className="flex items-center space-x-1">
                      <TrendingUp className="w-3 h-3" />
                      <span>{word.mastery}% mastery</span>
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="mt-6 pt-6 border-t border-gray-200">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-2xl font-bold text-blue-600">{words.length}</p>
            <p className="text-sm text-gray-600">Total Words</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-green-600">
              {words.filter(w => w.mastery >= 80).length}
            </p>
            <p className="text-sm text-gray-600">Mastered</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-orange-600">
              {words.filter(w => w.mastery < 80).length}
            </p>
            <p className="text-sm text-gray-600">Learning</p>
          </div>
        </div>
      </div>
    </div>
  );
}