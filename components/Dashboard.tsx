'use client';

import { TrendingUp, Target, Clock, Award } from 'lucide-react';
import { useStore } from '@/lib/store';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format, startOfWeek, eachDayOfInterval } from 'date-fns';

export function Dashboard() {
  const { words, sessions, getTotalWords, getMasteredWords, getTodaysPractice } = useStore();
  
  // Calculate practice data for the last 7 days
  const weekStart = startOfWeek(new Date());
  const weekDays = eachDayOfInterval({
    start: weekStart,
    end: new Date()
  });
  
  const practiceData = weekDays.map(day => {
    const dayStr = format(day, 'EEE');
    const sessionsOnDay = sessions.filter(s => 
      format(new Date(s.startTime), 'yyyy-MM-dd') === format(day, 'yyyy-MM-dd')
    );
    return {
      day: dayStr,
      sessions: sessionsOnDay.length,
      words: sessionsOnDay.reduce((acc, s) => acc + s.wordsReviewed.length, 0)
    };
  });
  
  // Calculate mastery distribution
  const masteryData = [
    { level: 'Beginner', count: words.filter(w => w.mastery < 30).length },
    { level: 'Learning', count: words.filter(w => w.mastery >= 30 && w.mastery < 60).length },
    { level: 'Proficient', count: words.filter(w => w.mastery >= 60 && w.mastery < 80).length },
    { level: 'Mastered', count: words.filter(w => w.mastery >= 80).length }
  ];

  const stats = [
    {
      label: 'Total Words',
      value: getTotalWords(),
      icon: Target,
      color: 'text-blue-600',
      bgColor: 'bg-blue-100'
    },
    {
      label: 'Mastered',
      value: getMasteredWords(),
      icon: Award,
      color: 'text-green-600',
      bgColor: 'bg-green-100'
    },
    {
      label: "Today's Practice",
      value: getTodaysPractice(),
      icon: Clock,
      color: 'text-purple-600',
      bgColor: 'bg-purple-100'
    },
    {
      label: 'Streak',
      value: calculateStreak(),
      icon: TrendingUp,
      color: 'text-orange-600',
      bgColor: 'bg-orange-100'
    }
  ];
  
  function calculateStreak() {
    if (sessions.length === 0) return 0;
    
    let streak = 0;
    const today = new Date();
    const dates = new Set(sessions.map(s => format(new Date(s.startTime), 'yyyy-MM-dd')));
    
    for (let i = 0; i < 30; i++) {
      const checkDate = new Date(today);
      checkDate.setDate(checkDate.getDate() - i);
      const dateStr = format(checkDate, 'yyyy-MM-dd');
      
      if (dates.has(dateStr)) {
        streak++;
      } else if (i > 0) {
        break;
      }
    }
    
    return streak;
  }

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="bg-white rounded-xl shadow-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <div className={`p-2 rounded-lg ${stat.bgColor}`}>
                  <Icon className={`w-5 h-5 ${stat.color}`} />
                </div>
              </div>
              <p className="text-2xl font-bold text-gray-800">{stat.value}</p>
              <p className="text-sm text-gray-600">{stat.label}</p>
            </div>
          );
        })}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Practice Trend */}
        <div className="bg-white rounded-xl shadow-lg p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Weekly Practice</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={practiceData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" />
              <YAxis />
              <Tooltip />
              <Line 
                type="monotone" 
                dataKey="sessions" 
                stroke="#3B82F6" 
                strokeWidth={2}
                name="Sessions"
              />
              <Line 
                type="monotone" 
                dataKey="words" 
                stroke="#10B981" 
                strokeWidth={2}
                name="Words Practiced"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Mastery Distribution */}
        <div className="bg-white rounded-xl shadow-lg p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Mastery Levels</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={masteryData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="level" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count" fill="#8B5CF6" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent Sessions */}
      <div className="bg-white rounded-xl shadow-lg p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Recent Sessions</h3>
        <div className="space-y-3">
          {sessions.slice(-5).reverse().map((session) => (
            <div key={session.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div>
                <p className="font-medium text-gray-800 capitalize">{session.mode} Practice</p>
                <p className="text-sm text-gray-600">
                  {format(new Date(session.startTime), 'MMM d, h:mm a')}
                </p>
              </div>
              <div className="text-right">
                <p className="font-medium text-gray-800">{session.wordsReviewed.length} words</p>
                <p className="text-sm text-gray-600">
                  {session.duration ? `${Math.round(session.duration / 60000)} min` : 'In progress'}
                </p>
              </div>
            </div>
          ))}
          {sessions.length === 0 && (
            <p className="text-center text-gray-500 py-4">No practice sessions yet</p>
          )}
        </div>
      </div>
    </div>
  );
}