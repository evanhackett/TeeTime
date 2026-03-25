/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Plus, 
  Minus, 
  Play, 
  Pause, 
  RotateCcw, 
  Trash2, 
  Settings, 
  Maximize2, 
  Minimize2, 
  Moon, 
  Sun, 
  Save, 
  Volume2, 
  ChevronDown, 
  ChevronUp,
  X,
  GripVertical,
  Sparkles,
  Clock,
  Share2,
  Bookmark
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Toaster, toast } from 'sonner';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// --- Types ---

type AlarmType = 'standard' | 'custom-tts' | 'auto-tts' | 'chime';
type StartAnnouncementType = 'none' | 'task-name' | 'timer-and-task';

interface Task {
  id: string;
  name: string;
  duration: number; // in seconds
  color: string;
  alarmType: AlarmType;
  pronunciation?: string;
  customTTS?: string;
  customAudio?: string; // Data URL for uploaded audio
}

interface TaskPreset {
  name: string;
  color: string;
  pronunciation?: string;
}

interface Timer {
  id: string;
  name: string;
  tasks: Task[];
  currentTaskIndex: number;
  remainingTime: number; // seconds left in current task
  isRunning: boolean;
  isPaused: boolean;
  isCompleted: boolean;
  showStars?: boolean;
  startAnnouncementType: StartAnnouncementType;
  speechRate: number;
  pronunciation?: string;
}

interface Workspace {
  id: string;
  name: string;
  description?: string;
  timers: Timer[];
}

interface AlarmItem {
  type: 'tts' | 'audio' | 'beep' | 'chime';
  text?: string;
  url?: string;
  timerId: string;
  timerName: string;
  taskName: string;
  speechRate?: number;
}

// --- Constants ---

const COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', 
  '#22c55e', '#10b981', '#06b6d4', '#0ea5e9', '#3b82f6', 
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e'
];

const DEFAULT_TASK_DURATION = 60; // 1 minute

// --- Components ---

const StarBurst = ({ onComplete }: { onComplete: () => void }) => {
  const stars = Array.from({ length: 20 }).map((_, i) => ({
    id: i,
    x: (Math.random() - 0.5) * 400,
    y: (Math.random() - 0.5) * 400,
    size: Math.random() * 20 + 10,
    delay: Math.random() * 0.5,
    duration: Math.random() * 1 + 1,
    rotation: Math.random() * 360
  }));

  return (
    <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-50">
      {stars.map((star) => (
        <motion.div
          key={star.id}
          initial={{ scale: 0, x: 0, y: 0, opacity: 1, rotate: 0 }}
          animate={{ 
            scale: [0, 1.5, 0], 
            x: star.x, 
            y: star.y, 
            opacity: [1, 1, 0],
            rotate: star.rotation 
          }}
          transition={{ 
            duration: star.duration, 
            delay: star.delay,
            ease: "easeOut"
          }}
          onAnimationComplete={() => star.id === stars.length - 1 && onComplete()}
          className="absolute text-yellow-400"
          style={{ fontSize: star.size }}
        >
          ★
        </motion.div>
      ))}
    </div>
  );
};

const VisualTimer = ({ 
  tasks, 
  currentTaskIndex, 
  remainingTime, 
  isRunning,
  timerName,
  isDisplayMode
}: { 
  tasks: Task[], 
  currentTaskIndex: number, 
  remainingTime: number,
  isRunning: boolean,
  timerName: string,
  isDisplayMode?: boolean
}) => {
  const radius = isDisplayMode ? 40 : 65;
  const strokeWidth = isDisplayMode ? 20 : 45; // Thinner blocks in display mode
  const center = 100;
  const totalDuration = tasks.reduce((acc, task) => acc + task.duration, 0);
  
  const getCoordinatesForPercent = (percent: number, r: number = radius) => {
    const x = Math.cos(2 * Math.PI * (percent - 0.25));
    const y = Math.sin(2 * Math.PI * (percent - 0.25));
    return [x, y];
  };

  let cumulativePercent = 0;

  return (
    <div className="relative flex flex-col items-center justify-center w-full max-w-md max-h-full aspect-square">
      <svg className="w-full h-full overflow-visible" viewBox="0 0 200 200">
        {/* Subtle background circle */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          className="stroke-gray-100 dark:stroke-gray-800/50 fill-none"
          strokeWidth={strokeWidth}
        />
        
        {tasks.map((task, index) => {
          const taskPercent = task.duration / totalDuration;
          const startPercent = cumulativePercent;
          const endPercent = cumulativePercent + taskPercent;
          
          const isPast = index < currentTaskIndex;
          const isCurrent = index === currentTaskIndex;
          const isFuture = index > currentTaskIndex;
          
          const [startX, startY] = getCoordinatesForPercent(startPercent);
          const [endX, endY] = getCoordinatesForPercent(endPercent);
          
          const largeArcFlag = taskPercent > 0.5 ? 1 : 0;
          
          const pathData = [
            `M ${center + radius * startX} ${center + radius * startY}`,
            `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${center + radius * endX} ${center + radius * endY}`
          ].join(' ');

          let brightPercent = 0;
          if (isFuture) brightPercent = taskPercent;
          if (isCurrent) brightPercent = (remainingTime / task.duration) * taskPercent;

          // Run out clockwise: The bright part starts at (end - bright) and ends at end
          const brightStartPercent = endPercent - brightPercent;
          const [brightStartX, brightStartY] = getCoordinatesForPercent(brightStartPercent);
          const brightLargeArcFlag = brightPercent > 0.5 ? 1 : 0;

          const brightPathData = brightPercent > 0 ? [
            `M ${center + radius * brightStartX} ${center + radius * brightStartY}`,
            `A ${radius} ${radius} 0 ${brightLargeArcFlag} 1 ${center + radius * endX} ${center + radius * endY}`
          ].join(' ') : "";

          cumulativePercent += taskPercent;

          const midPercent = startPercent + taskPercent / 2;
          
          return (
            <g key={task.id}>
              {/* Pale Background */}
              <path
                d={pathData}
                fill="none"
                stroke={task.color}
                strokeWidth={strokeWidth}
                className="opacity-15"
                strokeLinecap="butt"
              />
              
              {/* Bright Foreground */}
              {brightPathData && (
                <motion.path
                  initial={false}
                  animate={{ d: brightPathData }}
                  transition={{ duration: 1, ease: "linear" }}
                  fill="none"
                  stroke={task.color}
                  strokeWidth={strokeWidth}
                  strokeLinecap="butt"
                />
              )}
            </g>
          );
        })}

      </svg>
    </div>
  );
};

interface SortableTaskItemProps {
  task: Task;
  updateEditingTask: (id: string, updates: Partial<Task>) => void;
  saveTaskAsPreset: (task: Task) => void;
  removeTaskFromEditing: (id: string) => void;
}

const SortableTaskItem: React.FC<SortableTaskItemProps> = ({ 
  task, 
  updateEditingTask, 
  saveTaskAsPreset, 
  removeTaskFromEditing 
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 100 : 'auto',
    position: 'relative' as const,
  };

  return (
    <motion.div 
      ref={setNodeRef}
      style={style}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={`p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700/30 space-y-2 ${isDragging ? 'shadow-2xl ring-2 ring-blue-500/50 z-50' : ''}`}
    >
      <div className="flex gap-2 items-center">
        <button 
          {...attributes} 
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
        >
          <GripVertical className="w-4 h-4" />
        </button>
        <input 
          type="text"
          value={task.name}
          onChange={(e) => updateEditingTask(task.id, { name: e.target.value })}
          className="flex-1 bg-transparent border-none focus:ring-0 outline-none text-xs font-bold uppercase"
          placeholder="Task Name"
        />
        <input 
          type="text"
          value={task.pronunciation || ''}
          onChange={(e) => updateEditingTask(task.id, { pronunciation: e.target.value })}
          className="w-1/4 bg-white dark:bg-gray-900 p-1 rounded border border-gray-200 dark:border-gray-700 text-[8px] font-medium outline-none focus:border-blue-500"
          placeholder="Speak as..."
          title="How this task name should be spoken"
        />
        <input 
          type="color"
          value={task.color}
          onChange={(e) => updateEditingTask(task.id, { color: e.target.value })}
          className="w-4 h-4 rounded-full cursor-pointer border-none"
        />
        <button 
          onClick={() => saveTaskAsPreset(task)}
          className="text-gray-400 hover:text-amber-500 transition-colors"
          title="Save as preset"
        >
          <Save className="w-3 h-3" />
        </button>
        <button onClick={() => removeTaskFromEditing(task.id)} className="text-gray-400 hover:text-red-500">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
      
      <div className="flex gap-2 items-center">
        <div className="flex items-center bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 px-2 py-1">
          <button onClick={() => updateEditingTask(task.id, { duration: Math.max(1, task.duration - 60) })}><Minus className="w-3 h-3" /></button>
          <input 
            type="number"
            value={Math.floor(task.duration / 60)}
            onChange={(e) => updateEditingTask(task.id, { duration: Math.max(1, parseInt(e.target.value) || 0) * 60 })}
            className="w-12 bg-transparent border-none text-center text-[10px] font-bold focus:ring-0 outline-none"
          />
          <span className="text-[8px] font-bold opacity-40 mr-1">m</span>
          <button onClick={() => updateEditingTask(task.id, { duration: Math.min(3600, task.duration + 60) })}><Plus className="w-3 h-3" /></button>
        </div>
        
        <div className="flex items-center gap-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-1">
          <Volume2 className="w-3 h-3 opacity-40" />
          <input 
            type="file" 
            accept="audio/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                  updateEditingTask(task.id, { customAudio: ev.target?.result as string });
                };
                reader.readAsDataURL(file);
              }
            }}
            className="hidden"
            id={`audio-upload-${task.id}`}
          />
          <label 
            htmlFor={`audio-upload-${task.id}`}
            className={`text-[8px] font-bold cursor-pointer hover:text-blue-500 transition-colors ${task.customAudio ? 'text-green-500' : ''}`}
          >
            {task.customAudio ? 'Audio ON' : 'Upload'}
          </label>
          {task.customAudio && (
            <button onClick={() => updateEditingTask(task.id, { customAudio: undefined })} className="text-red-500 ml-1">
              <X className="w-2 h-2" />
            </button>
          )}
        </div>

        <select 
          value={task.alarmType}
          onChange={(e) => updateEditingTask(task.id, { alarmType: e.target.value as AlarmType })}
          className="flex-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-[8px] font-bold uppercase p-1 outline-none focus:border-blue-500"
        >
          <option value="standard">Standard Beep</option>
          <option value="chime">Gentle Chime</option>
          <option value="auto-tts">Auto-Speak Name</option>
          <option value="custom-tts">Custom Message</option>
        </select>
      </div>
      
      {task.alarmType === 'custom-tts' && (
        <input 
          type="text"
          value={task.customTTS || ''}
          onChange={(e) => updateEditingTask(task.id, { customTTS: e.target.value })}
          className="w-full bg-white dark:bg-gray-900 p-2 rounded-lg border border-gray-200 dark:border-gray-700 text-[9px] font-medium outline-none focus:border-blue-500"
          placeholder="Enter custom message to speak..."
        />
      )}
    </motion.div>
  );
};

// Capture share param at module load time, before any React effect can modify the URL
const initialShareParam = new URLSearchParams(window.location.search).get('share');

export default function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>('');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isVisualAlarmEnabled, setIsVisualAlarmEnabled] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(true);
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false);
  const [editingWorkspace, setEditingWorkspace] = useState<{ name: string, description: string, id?: string } | null>(null);
  
  const [fullscreenTimerId, setFullscreenTimerId] = useState<string | null>(null);
  const [editingTimerId, setEditingTimerId] = useState<string | null>(null);
  const [newTimerName, setNewTimerName] = useState('New Timer');
  const [newTimerPronunciation, setNewTimerPronunciation] = useState('');
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);
  const [editingTasks, setEditingTasks] = useState<Task[]>([]);
  const [isDisplayMode, setIsDisplayMode] = useState(false);
  const [taskPresets, setTaskPresets] = useState<TaskPreset[]>([]);
  const [timerNamePresets, setTimerNamePresets] = useState<string[]>([]);
  const [startAnnouncementType, setStartAnnouncementType] = useState<StartAnnouncementType>('task-name');
  const [speechRate, setSpeechRate] = useState(1.0);
  const [isAlarmPlaying, setIsAlarmPlaying] = useState(false);
  const [visualAlarmDuration, setVisualAlarmDuration] = useState(10);
  const [interAlarmDelay, setInterAlarmDelay] = useState(2);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setEditingTasks((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);

        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };
  const [currentAlarm, setCurrentAlarm] = useState<AlarmItem | null>(null);
  const alarmQueue = useRef<AlarmItem[]>([]);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const shareImportedRef = useRef(false);

  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId) || workspaces[0];
  const timers = activeWorkspace?.timers || [];

  const setTimers = useCallback((newTimers: Timer[] | ((prev: Timer[]) => Timer[])) => {
    setWorkspaces(prev => prev.map(w => {
      if (w.id === activeWorkspaceId) {
        const updatedTimers = typeof newTimers === 'function' ? newTimers(w.timers) : newTimers;
        return { ...w, timers: updatedTimers };
      }
      return w;
    }));
  }, [activeWorkspaceId]);

  // Load from local storage
  useEffect(() => {
    const savedWorkspaces = localStorage.getItem('visual-timer-workspaces');
    const savedTaskPresets = localStorage.getItem('visual-timer-task-presets');
    const savedNamePresets = localStorage.getItem('visual-timer-name-presets');

    if (savedTaskPresets) setTaskPresets(JSON.parse(savedTaskPresets));
    if (savedNamePresets) setTimerNamePresets(JSON.parse(savedNamePresets));

    if (savedWorkspaces) {
      try {
        const parsed = JSON.parse(savedWorkspaces);
        if (parsed.length > 0) {
          setWorkspaces(parsed.map((w: Workspace) => ({
            ...w,
            timers: w.timers.map(t => ({ ...t, isRunning: false, isPaused: false }))
          })));
          const savedActiveId = localStorage.getItem('visual-timer-active-workspace');
          const validId = parsed.find((w: Workspace) => w.id === savedActiveId) ? savedActiveId! : parsed[0].id;
          setActiveWorkspaceId(validId);
        } else if (!initialShareParam) {
          createInitialWorkspace();
        }
      } catch (e) {
        console.error("Failed to parse saved workspaces", e);
        if (!initialShareParam) createInitialWorkspace();
      }
    } else {
      // Migrate old timers if they exist
      const savedTimers = localStorage.getItem('visual-timers');
      if (savedTimers) {
        try {
          const parsedTimers = JSON.parse(savedTimers);
          const initialWorkspace: Workspace = {
            id: 'default',
            name: 'My Routine',
            description: 'Main routine timers',
            timers: parsedTimers.map((t: Timer) => ({ ...t, isRunning: false, isPaused: false }))
          };
          setWorkspaces([initialWorkspace]);
          setActiveWorkspaceId(initialWorkspace.id);
        } catch (e) {
          if (!initialShareParam) createInitialWorkspace();
        }
      } else if (!initialShareParam) {
        createInitialWorkspace();
      }
    }
    
    const savedPresets = localStorage.getItem('visual-timer-presets');
    if (savedPresets) {
      try {
        setTaskPresets(JSON.parse(savedPresets));
      } catch (e) {
        console.error("Failed to parse saved presets", e);
      }
    }

    const savedTemplate = localStorage.getItem('visual-timer-announcement-type');
    if (savedTemplate) setStartAnnouncementType(savedTemplate as StartAnnouncementType);

    const savedTheme = localStorage.getItem('visual-timer-theme');
    if (savedTheme === 'dark') setIsDarkMode(true);

    const savedVisualAlarm = localStorage.getItem('visual-timer-visual-alarm');
    if (savedVisualAlarm !== null) setIsVisualAlarmEnabled(JSON.parse(savedVisualAlarm));

    const savedVisualDuration = localStorage.getItem('visual-timer-visual-duration');
    if (savedVisualDuration) setVisualAlarmDuration(Number(savedVisualDuration));

    const savedInterDelay = localStorage.getItem('visual-timer-inter-delay');
    if (savedInterDelay) setInterAlarmDelay(Number(savedInterDelay));
  }, []);

  const createInitialWorkspace = () => {
    const initialWorkspace: Workspace = {
      id: 'default',
      name: 'My Routine',
      description: 'Main routine timers',
      timers: []
    };
    setWorkspaces([initialWorkspace]);
    setActiveWorkspaceId(initialWorkspace.id);
  };

  // Save to local storage
  useEffect(() => {
    if (workspaces.length > 0) {
      localStorage.setItem('visual-timer-workspaces', JSON.stringify(workspaces));
    }
    localStorage.setItem('visual-timer-task-presets', JSON.stringify(taskPresets));
    localStorage.setItem('visual-timer-name-presets', JSON.stringify(timerNamePresets));
  }, [workspaces, taskPresets, timerNamePresets]);

  useEffect(() => {
    if (activeWorkspaceId) {
      localStorage.setItem('visual-timer-active-workspace', activeWorkspaceId);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    localStorage.setItem('visual-timer-presets', JSON.stringify(taskPresets));
  }, [taskPresets]);

  useEffect(() => {
    localStorage.setItem('visual-timer-announcement-type', startAnnouncementType);
  }, [startAnnouncementType]);

  useEffect(() => {
    localStorage.setItem('visual-timer-theme', isDarkMode ? 'dark' : 'light');
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  useEffect(() => {
    localStorage.setItem('visual-timer-visual-alarm', JSON.stringify(isVisualAlarmEnabled));
  }, [isVisualAlarmEnabled]);

  useEffect(() => {
    localStorage.setItem('visual-timer-visual-duration', visualAlarmDuration.toString());
  }, [visualAlarmDuration]);

  useEffect(() => {
    localStorage.setItem('visual-timer-inter-delay', interAlarmDelay.toString());
  }, [interAlarmDelay]);

  // Timer Logic
  useEffect(() => {
    const interval = setInterval(() => {
      setTimers(prevTimers => {
        let updated = false;
        const nextTimers = prevTimers.map(timer => {
          if (timer.isRunning && !timer.isPaused && !timer.isCompleted) {
            updated = true;
            if (timer.remainingTime > 0) {
              return { ...timer, remainingTime: timer.remainingTime - 1 };
            } else {
              const nextIndex = timer.currentTaskIndex + 1;
              const currentTask = timer.tasks[timer.currentTaskIndex];
              
              triggerAlarm(timer, currentTask);

              if (nextIndex < timer.tasks.length) {
                const nextTask = timer.tasks[nextIndex];
                announceTaskStart(timer, nextTask);
                return {
                  ...timer,
                  currentTaskIndex: nextIndex,
                  remainingTime: nextTask.duration
                };
              } else {
                return { ...timer, isRunning: false, isCompleted: true, showStars: true };
              }
            }
          }
          return timer;
        });
        return updated ? nextTimers : prevTimers;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [setTimers]);

  const shareWorkspace = () => {
    navigator.clipboard.writeText(window.location.href);
    toast.success('Share link copied to clipboard!', {
      description: 'You can now share this set of timers with others.'
    });
  };

  // Keep URL in sync with all workspaces' setup (not running state)
  useEffect(() => {
    if (workspaces.length === 0 || workspaces.every(w => w.timers.length === 0)) return;
    const setupData = workspaces.map(w => ({
      id: w.id,
      name: w.name,
      description: w.description,
      timers: w.timers.map(t => ({
        id: t.id,
        name: t.name,
        tasks: t.tasks,
        startAnnouncementType: t.startAnnouncementType,
        speechRate: t.speechRate,
        pronunciation: t.pronunciation,
      }))
    }));
    const encoded = btoa(JSON.stringify(setupData));
    const newParam = `?share=${encodeURIComponent(encoded)}`;
    if (window.location.search !== newParam) {
      window.history.replaceState({}, document.title, window.location.pathname + newParam);
    }
  }, [workspaces]);

  // Import workspace from share URL on first load
  useEffect(() => {
    if (shareImportedRef.current || !initialShareParam) return;
    shareImportedRef.current = true;
    try {
        const decoded = JSON.parse(atob(initialShareParam));
        const sharedWorkspaces: Workspace[] = (Array.isArray(decoded) ? decoded : [decoded]).map((w: Workspace) => ({
          ...w,
          id: Math.random().toString(36).substr(2, 9),
          timers: (w.timers || []).map((t: Timer) => ({
            ...t,
            isRunning: false,
            isPaused: false,
            isCompleted: false,
            currentTaskIndex: 0,
            remainingTime: t.tasks[0]?.duration || 0,
          }))
        }));
        setWorkspaces(prev => [...prev, ...sharedWorkspaces]);
        setActiveWorkspaceId(sharedWorkspaces[0].id);
        toast.success(`Loaded ${sharedWorkspaces.length} shared workspace${sharedWorkspaces.length > 1 ? 's' : ''}`, {
          description: 'These workspaces have been added to your list.'
        });
    } catch (e) {
      console.error("Failed to import shared workspace", e);
    }
  }, []);

  const triggerAlarm = (timer: Timer, task: Task) => {
    // 1. Play the "Alarm" (Custom Audio, Chime, or Beep)
    if (task.customAudio) {
      queueAlarm({ 
        type: 'audio', 
        url: task.customAudio, 
        timerId: timer.id, 
        timerName: timer.name, 
        taskName: task.name 
      });
    } else if (task.alarmType === 'chime') {
      queueAlarm({ 
        type: 'chime', 
        timerId: timer.id, 
        timerName: timer.name, 
        taskName: task.name 
      });
    } else {
      queueAlarm({ 
        type: 'beep', 
        timerId: timer.id, 
        timerName: timer.name, 
        taskName: task.name 
      });
    }
    
    // 2. Play the "Stop" announcement
    const timerSpeakName = timer.pronunciation || timer.name;
    const taskSpeakName = task.pronunciation || task.name;
    const text = `${timerSpeakName} stop ${taskSpeakName}`;
    queueAlarm({ 
      type: 'tts', 
      text, 
      timerId: timer.id, 
      timerName: timer.name, 
      taskName: task.name,
      speechRate: timer.speechRate
    });
  };

  const queueAlarm = (alarm: AlarmItem) => {
    alarmQueue.current.push(alarm);
    processAlarmQueue();
  };

  const processAlarmQueue = async () => {
    if (isAlarmPlaying || alarmQueue.current.length === 0) return;
    
    setIsAlarmPlaying(true);
    const next = alarmQueue.current.shift();
    
    if (!next) {
      setIsAlarmPlaying(false);
      setCurrentAlarm(null);
      return;
    }

    setCurrentAlarm(next);

    const startTime = Date.now();

    try {
      if (next.type === 'beep') {
        playBeep();
        await new Promise(r => setTimeout(r, 600));
      } else if (next.type === 'chime') {
        playChime();
        await new Promise(r => setTimeout(r, 1500));
      } else if (next.type === 'tts' && next.text) {
        await speak(next.text, next.speechRate);
      } else if (next.type === 'audio' && next.url) {
        await playAudioFile(next.url);
      }

      // Ensure visual alarm lasts at least the specified duration
      if (isVisualAlarmEnabled) {
        const elapsed = (Date.now() - startTime) / 1000;
        const remaining = visualAlarmDuration - elapsed;
        if (remaining > 0) {
          await new Promise(r => setTimeout(r, remaining * 1000));
        }
      }
    } catch (e) {
      console.error("Alarm error", e);
    } finally {
      setIsAlarmPlaying(false);
      setCurrentAlarm(null);
      
      // If there are more alarms, wait for the inter-alarm delay
      if (alarmQueue.current.length > 0 && interAlarmDelay > 0) {
        setTimeout(() => {
          processAlarmQueue();
        }, interAlarmDelay * 1000);
      } else {
        processAlarmQueue();
      }
    }
  };

  const stopCurrentAlarm = () => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    window.speechSynthesis.cancel();
    // Clear the rest of the queue if user wants to stop everything?
    // User said "stop it completely or pause the timer"
    // Let's just stop the current one and the queue.
    alarmQueue.current = [];
    setIsAlarmPlaying(false);
    setCurrentAlarm(null);
  };

  const pauseTimerAndStopAlarm = (timerId: string) => {
    pauseTimer(timerId);
    stopCurrentAlarm();
  };

  const playAudioFile = (url: string) => {
    return new Promise<void>((resolve) => {
      const audio = new Audio(url);
      currentAudioRef.current = audio;
      
      // Limit to 15 seconds
      const timeout = setTimeout(() => {
        audio.pause();
        resolve();
      }, 15000);

      audio.onended = () => {
        clearTimeout(timeout);
        resolve();
      };
      audio.onerror = () => {
        clearTimeout(timeout);
        resolve();
      };
      audio.play().catch(() => {
        clearTimeout(timeout);
        resolve();
      });
    });
  };

  const playBeep = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = audioContextRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.1);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  };

  const playChime = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = audioContextRef.current;
    
    const playNote = (freq: number, startTime: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.4, startTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 1.5);
      osc.start(startTime);
      osc.stop(startTime + 1.5);
    };

    playNote(880, ctx.currentTime); // A5
    playNote(1108.73, ctx.currentTime + 0.1); // C#6
  };

  const speak = (text: string, rate: number = 1.0) => {
    return new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      
      // Find a clear, feminine voice
      const voices = window.speechSynthesis.getVoices();
      const feminineVoice = voices.find(v => 
        v.name.toLowerCase().includes('female') || 
        v.name.toLowerCase().includes('samantha') || 
        v.name.toLowerCase().includes('victoria') ||
        v.name.toLowerCase().includes('google uk english female')
      ) || voices[0];
      
      if (feminineVoice) utterance.voice = feminineVoice;
      utterance.pitch = 1.0; // Standard pitch for clarity
      utterance.rate = rate;  // Adjustable rate for clarity
      utterance.volume = 1.0; // Full volume
      
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.speak(utterance);
    });
  };

  const announceTaskStart = (timer: Timer, task: Task) => {
    const timerSpeakName = timer.pronunciation || timer.name;
    const taskSpeakName = task.pronunciation || task.name;
    const text = `${timerSpeakName} start ${taskSpeakName}`;
    queueAlarm({ 
      type: 'tts', 
      text, 
      timerId: timer.id, 
      timerName: timer.name, 
      taskName: task.name,
      speechRate: timer.speechRate
    });
  };

  const addTimer = () => {
    if (editingTasks.length === 0) return;
    
    if (editingTimerId) {
      setTimers(prevTimers => prevTimers.map(t => t.id === editingTimerId ? {
        ...t,
        name: newTimerName || 'Untitled Timer',
        pronunciation: newTimerPronunciation,
        tasks: [...editingTasks],
        remainingTime: t.isRunning ? t.remainingTime : editingTasks[0].duration,
        currentTaskIndex: Math.min(t.currentTaskIndex, editingTasks.length - 1),
        startAnnouncementType: startAnnouncementType,
        speechRate: speechRate
      } : t));
      setEditingTimerId(null);
    } else {
      const newTimer: Timer = {
        id: Math.random().toString(36).substr(2, 9),
        name: newTimerName || 'Untitled Timer',
        pronunciation: newTimerPronunciation,
        tasks: [...editingTasks],
        currentTaskIndex: 0,
        remainingTime: editingTasks[0].duration,
        isRunning: false,
        isPaused: false,
        isCompleted: false,
        startAnnouncementType: startAnnouncementType,
        speechRate: speechRate
      };
      setTimers(prevTimers => [...prevTimers, newTimer]);
    }
    
    // Auto-save presets (only if not already present)
    const newPresets = [...taskPresets];
    editingTasks.forEach(task => {
      if (!newPresets.some(p => p.name.toLowerCase() === task.name.toLowerCase())) {
        newPresets.push({ name: task.name, color: task.color, pronunciation: task.pronunciation });
      }
    });
    setTaskPresets(newPresets.slice(-30));

    // Save timer name preset
    if (newTimerName && !timerNamePresets.some(n => n.toLowerCase() === newTimerName.toLowerCase())) {
      setTimerNamePresets([newTimerName, ...timerNamePresets].slice(0, 20));
    }

    setEditingTasks([]);
    setNewTimerName('New Timer');
    setNewTimerPronunciation('');
  };

  const saveTaskAsPreset = (task: Task) => {
    if (!taskPresets.some(p => p.name.toLowerCase() === task.name.toLowerCase())) {
      setTaskPresets([{ name: task.name, color: task.color, pronunciation: task.pronunciation }, ...taskPresets].slice(0, 30));
    }
  };

  const deletePreset = (name: string) => {
    setTaskPresets(taskPresets.filter(p => p.name !== name));
  };

  const addTaskToEditing = () => {
    if (editingTasks.length >= 60) return;
    const newTask: Task = {
      id: Math.random().toString(36).substr(2, 9),
      name: `Task ${editingTasks.length + 1}`,
      pronunciation: '',
      duration: DEFAULT_TASK_DURATION,
      color: COLORS[editingTasks.length % COLORS.length],
      alarmType: 'standard'
    };
    setEditingTasks([...editingTasks, newTask]);
  };

  const removeTaskFromEditing = (id: string) => {
    setEditingTasks(editingTasks.filter(t => t.id !== id));
  };

  const updateEditingTask = (id: string, updates: Partial<Task>) => {
    setEditingTasks(editingTasks.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const startTimer = (id: string) => {
    setTimers(timers.map(t => {
      if (t.id === id) {
        if (!t.isRunning && !t.isPaused) {
          announceTaskStart(t, t.tasks[0]);
        }
        return { ...t, isRunning: true, isPaused: false, isCompleted: false };
      }
      return t;
    }));
  };

  const pauseTimer = (id: string) => {
    setTimers(timers.map(t => t.id === id ? { ...t, isPaused: !t.isPaused } : t));
  };

  const resetTimer = (id: string) => {
    setTimers(timers.map(t => t.id === id ? { 
      ...t, 
      isRunning: false, 
      isPaused: false, 
      isCompleted: false,
      currentTaskIndex: 0,
      remainingTime: t.tasks[0].duration 
    } : t));
  };

  const deleteTimer = (id: string) => {
    setTimers(timers.filter(t => t.id !== id));
    if (editingTimerId === id) {
      setEditingTimerId(null);
      setEditingTasks([]);
      setNewTimerName('New Timer');
    }
  };

  const startAllTimers = () => {
    setTimers(timers.map(t => ({ ...t, isRunning: true, isPaused: false, isCompleted: false })));
  };

  const stopAllTimers = () => {
    setTimers(timers.map(t => ({ ...t, isRunning: false, isPaused: false })));
    stopCurrentAlarm();
  };

  const resetAllTimers = () => {
    setTimers(timers.map(t => ({ 
      ...t, 
      isRunning: false, 
      isPaused: false, 
      isCompleted: false,
      currentTaskIndex: 0,
      remainingTime: t.tasks[0].duration 
    })));
    stopCurrentAlarm();
  };

  const toggleFullscreen = (id: string | null) => {
    setFullscreenTimerId(id);
    if (id) {
      setIsSettingsOpen(false);
    }
  };

  const toggleDisplayMode = () => {
    setIsDisplayMode(!isDisplayMode);
    if (!isDisplayMode) {
      setIsSettingsOpen(false);
    }
  };

  const enterEditFromDisplay = () => {
    setIsDisplayMode(false);
    setIsSettingsOpen(true);
  };

  const startEditingTimer = (timer: Timer) => {
    setEditingTimerId(timer.id);
    setNewTimerName(timer.name);
    setNewTimerPronunciation(timer.pronunciation || '');
    setEditingTasks([...timer.tasks]);
    setStartAnnouncementType(timer.startAnnouncementType || 'task-name');
    setSpeechRate(timer.speechRate || 1.0);
    setIsSettingsOpen(true);
    setIsDisplayMode(false);
    setFullscreenTimerId(null);
  };

  const cancelEditingTimer = () => {
    setEditingTimerId(null);
    setNewTimerName('New Timer');
    setNewTimerPronunciation('');
    setEditingTasks([]);
    setSpeechRate(1.0);
  };

  const createWorkspace = (name: string, description: string) => {
    const newWorkspace: Workspace = {
      id: Math.random().toString(36).substr(2, 9),
      name,
      description,
      timers: []
    };
    setWorkspaces([...workspaces, newWorkspace]);
    setActiveWorkspaceId(newWorkspace.id);
    setIsWorkspaceModalOpen(false);
  };

  const updateWorkspace = (id: string, name: string, description: string) => {
    setWorkspaces(workspaces.map(w => w.id === id ? { ...w, name, description } : w));
    setIsWorkspaceModalOpen(false);
  };

  const deleteWorkspace = (id: string) => {
    if (workspaces.length <= 1) return;
    const newWorkspaces = workspaces.filter(w => w.id !== id);
    setWorkspaces(newWorkspaces);
    if (activeWorkspaceId === id) {
      setActiveWorkspaceId(newWorkspaces[0].id);
    }
  };

  const getGridCols = (count: number) => {
    if (count <= 1) return 'grid-cols-1';
    if (count <= 2) return 'grid-cols-1 md:grid-cols-2';
    if (count <= 3) return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3';
    return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';
  };

  const getTimerScale = (count: number) => {
    if (count <= 1) return 'scale-100';
    if (count <= 2) return 'scale-[0.98]';
    if (count <= 4) return 'scale-[0.95]';
    if (count <= 8) return 'scale-[0.9]';
    if (count <= 12) return 'scale-[0.85]';
    return 'scale-[0.8]';
  };

  return (
    <div className={`min-h-screen transition-colors duration-500 ${isDarkMode ? 'bg-[#0a0a0a] text-white' : 'bg-[#f8f9fa] text-gray-900'}`}>
      <Toaster position="top-center" richColors />
      {/* Visual Alarm Rainbow Overlay */}
      <AnimatePresence>
        {isAlarmPlaying && isVisualAlarmEnabled && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.15 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[5] pointer-events-none animate-rainbow"
          />
        )}
      </AnimatePresence>
      {/* Workspace Modal */}
      <AnimatePresence>
        {isWorkspaceModalOpen && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-gray-900 rounded-[2rem] p-8 w-full max-w-md shadow-2xl border border-gray-100 dark:border-gray-800"
            >
              <h2 className="text-2xl font-black uppercase tracking-tighter mb-6">
                {editingWorkspace?.id ? 'Edit Desktop' : 'New Desktop'}
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest opacity-50 mb-1 block">Desktop Name</label>
                  <input 
                    type="text" 
                    value={editingWorkspace?.name || ''}
                    onChange={(e) => setEditingWorkspace(prev => ({ ...prev!, name: e.target.value }))}
                    className="w-full bg-gray-50 dark:bg-gray-800 p-4 rounded-2xl border border-transparent focus:border-blue-500 outline-none font-bold transition-all"
                    placeholder="Work, Morning, Gym..."
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest opacity-50 mb-1 block">Description (Optional)</label>
                  <textarea 
                    value={editingWorkspace?.description || ''}
                    onChange={(e) => setEditingWorkspace(prev => ({ ...prev!, description: e.target.value }))}
                    className="w-full bg-gray-50 dark:bg-gray-800 p-4 rounded-2xl border border-transparent focus:border-blue-500 outline-none font-medium transition-all h-24 resize-none"
                    placeholder="What is this desktop for?"
                  />
                </div>
                <div className="flex flex-col gap-3 pt-4">
                  <div className="flex gap-3">
                    <button 
                      onClick={() => setIsWorkspaceModalOpen(false)}
                      className="flex-1 py-4 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-2xl font-bold uppercase tracking-widest transition-all"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={() => {
                        if (editingWorkspace?.id) {
                          updateWorkspace(editingWorkspace.id, editingWorkspace.name, editingWorkspace.description);
                        } else {
                          createWorkspace(editingWorkspace?.name || 'New Desktop', editingWorkspace?.description || '');
                        }
                      }}
                      className="flex-1 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold uppercase tracking-widest transition-all shadow-lg shadow-blue-500/20"
                    >
                      Save
                    </button>
                  </div>
                  {editingWorkspace?.id && (
                    <button 
                      onClick={shareWorkspace}
                      className="w-full py-4 bg-purple-600 hover:bg-purple-700 text-white rounded-2xl font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                    >
                      <Share2 className="w-4 h-4" /> Copy Share Link
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Alarm Overlay */}
      <AnimatePresence>
        {isAlarmPlaying && currentAlarm && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] w-full max-w-sm px-4"
          >
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border-2 border-red-500 p-4 flex flex-col items-center gap-4">
              <div className="flex flex-col items-center text-center">
                <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mb-2 animate-pulse">
                  <Volume2 className="w-6 h-6 text-red-600" />
                </div>
                <h3 className="font-black uppercase tracking-tighter text-lg leading-none">{currentAlarm.timerName}</h3>
                <p className="text-xs font-bold text-red-500 uppercase tracking-widest mt-1">{currentAlarm.taskName} ENDED</p>
              </div>
              
              <div className="flex gap-2 w-full">
                <button 
                  onClick={stopCurrentAlarm}
                  className="flex-1 py-3 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-xl font-bold uppercase text-[10px] tracking-widest transition-all"
                >
                  Stop Alarm
                </button>
                <button 
                  onClick={() => pauseTimerAndStopAlarm(currentAlarm.timerId)}
                  className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold uppercase text-[10px] tracking-widest transition-all"
                >
                  Pause Timer
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mac-style Dock Navigation */}
      <div className="fixed bottom-6 left-0 right-0 z-[60] flex justify-center pointer-events-none">
        <motion.div 
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="bg-white/90 dark:bg-gray-900/90 backdrop-blur-3xl border border-white/40 dark:border-gray-700/50 p-3 rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.3)] flex items-center gap-3 pointer-events-auto"
        >
          {/* Main Screens Navigation */}
          <div className="flex items-center gap-2 px-3 border-r border-gray-200 dark:border-gray-800">
            <button 
              onClick={() => {
                setIsDisplayMode(false);
                setIsSettingsOpen(true);
              }}
              className={`flex flex-col items-center gap-1 p-2 rounded-2xl transition-all group relative ${isSettingsOpen && !isDisplayMode ? 'bg-blue-600 text-white' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}
            >
              <Settings className="w-6 h-6" />
              <span className="text-[8px] font-black uppercase tracking-tighter">Edit Timers</span>
            </button>
            <button 
              onClick={() => {
                setEditingWorkspace({ name: '', description: '' });
                setIsWorkspaceModalOpen(true);
              }}
              className="flex flex-col items-center gap-1 p-2 rounded-2xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-all group relative"
            >
              <Plus className="w-6 h-6" />
              <span className="text-[8px] font-black uppercase tracking-tighter">New Group</span>
            </button>
            <button 
              onClick={toggleDisplayMode}
              className={`flex flex-col items-center gap-1 p-2 rounded-2xl transition-all group relative ${isDisplayMode ? 'bg-blue-600 text-white' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}
            >
              {isDisplayMode ? <Minimize2 className="w-6 h-6" /> : <Maximize2 className="w-6 h-6" />}
              <span className="text-[8px] font-black uppercase tracking-tighter">Display Mode</span>
            </button>
            <button 
              onClick={() => setInterAlarmDelay(interAlarmDelay === 0 ? 10 : 0)}
              className={`flex flex-col items-center gap-1 p-2 rounded-2xl transition-all group relative ${interAlarmDelay > 0 ? 'bg-blue-600 text-white' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}
            >
              <Clock className="w-6 h-6" />
              <span className="text-[8px] font-black uppercase tracking-tighter">Delay: {interAlarmDelay}s</span>
            </button>
          </div>

          {/* Global Actions */}
          <div className="flex items-center gap-2 px-3 border-r border-gray-200 dark:border-gray-800">
            <button 
              onClick={startAllTimers}
              className="flex flex-col items-center gap-1 p-2 rounded-2xl hover:bg-green-100 dark:hover:bg-green-900/30 text-green-600 transition-all group relative"
            >
              <Play className="w-6 h-6 fill-current" />
              <span className="text-[8px] font-black uppercase tracking-tighter">Start All</span>
            </button>
            <button 
              onClick={stopAllTimers}
              className="flex flex-col items-center gap-1 p-2 rounded-2xl hover:bg-amber-100 dark:hover:bg-amber-900/30 text-amber-600 transition-all group relative"
            >
              <Pause className="w-6 h-6 fill-current" />
              <span className="text-[8px] font-black uppercase tracking-tighter">Stop All</span>
            </button>
            <button 
              onClick={resetAllTimers}
              className="flex flex-col items-center gap-1 p-2 rounded-2xl hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 transition-all group relative"
            >
              <RotateCcw className="w-6 h-6" />
              <span className="text-[8px] font-black uppercase tracking-tighter">Reset All</span>
            </button>
            <button 
              onClick={shareWorkspace}
              className="flex flex-col items-center gap-1 p-2 rounded-2xl hover:bg-blue-100 dark:hover:bg-blue-900/30 text-blue-600 transition-all group relative"
            >
              <Share2 className="w-6 h-6" />
              <span className="text-[8px] font-black uppercase tracking-tighter">Share</span>
            </button>
          </div>

          {/* Workspace Switcher (Saved Sets) */}
          <div className="flex items-center gap-2 px-3 max-w-[500px] overflow-x-auto custom-scrollbar no-scrollbar py-1">
            {workspaces.map(w => (
              <button
                key={w.id}
                onClick={() => setActiveWorkspaceId(w.id)}
                className={`px-5 py-3 rounded-2xl text-[9px] font-black uppercase tracking-[0.15em] transition-all whitespace-nowrap border-2 ${
                  activeWorkspaceId === w.id 
                    ? 'bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-500/20 scale-105' 
                    : 'bg-gray-50 dark:bg-gray-800 text-gray-400 border-transparent hover:border-gray-300'
                }`}
              >
                {w.name}
              </button>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Header */}
      {!isDisplayMode && (
        <header className="p-4 md:p-6 flex flex-col gap-4 border-b border-gray-200 dark:border-gray-800 sticky top-0 bg-inherit/80 backdrop-blur-md z-30">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-4">
              <div className="flex flex-col">
                <h1 className="text-2xl font-bold tracking-tight">TeeTime</h1>
                <span className="text-[10px] font-medium opacity-50 uppercase tracking-widest">360 Thinking Clock</span>
              </div>
              <button 
                onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                className={`p-2 rounded-lg transition-all ${isSettingsOpen ? 'bg-blue-600 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-800'}`}
              >
                <Settings className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex items-center gap-2">
              <button 
                onClick={shareWorkspace}
                className="hidden md:flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-sm transition-all shadow-lg shadow-blue-500/20"
                title="Share & Bookmark this Set"
              >
                <Bookmark className="w-4 h-4" /> Share & Save
              </button>
              <button 
                onClick={startAllTimers}
                className="hidden md:flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold text-sm transition-all"
              >
                <Play className="w-4 h-4 fill-current" /> Start All
              </button>
              <button 
                onClick={stopAllTimers}
                className="hidden md:flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold text-sm transition-all"
              >
                <Pause className="w-4 h-4 fill-current" /> Stop All
              </button>
              <button 
                onClick={resetAllTimers}
                className="hidden md:flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold text-sm transition-all"
              >
                <RotateCcw className="w-4 h-4" /> Reset All
              </button>
              <button 
                onClick={toggleDisplayMode}
                className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
              >
                <Maximize2 className="w-5 h-5" />
              </button>
              <button 
                onClick={() => setIsVisualAlarmEnabled(!isVisualAlarmEnabled)}
                className={`p-2 rounded-lg transition-all ${isVisualAlarmEnabled ? 'text-purple-500 bg-purple-50 dark:bg-purple-900/20' : 'text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800'}`}
                title="Visual Alarm (Rainbow Effect)"
              >
                <Sparkles className="w-5 h-5" />
              </button>
              <button 
                onClick={() => setInterAlarmDelay(interAlarmDelay === 0 ? 10 : 0)}
                className={`p-2 rounded-lg transition-all ${interAlarmDelay > 0 ? 'text-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800'}`}
                title={`Inter-Alarm Delay: ${interAlarmDelay}s`}
              >
                <Clock className="w-5 h-5" />
              </button>
              <button 
                onClick={() => setIsDarkMode(!isDarkMode)}
                className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
              >
                {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* Workspace Switcher */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2 custom-scrollbar">
            {workspaces.map(w => (
              <div key={w.id} className="flex shrink-0">
                <button
                  onClick={() => setActiveWorkspaceId(w.id)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all border ${
                    activeWorkspaceId === w.id 
                      ? 'bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-500/20' 
                      : 'bg-gray-50 dark:bg-gray-800 text-gray-400 border-transparent hover:border-gray-300'
                  }`}
                >
                  {w.name}
                </button>
                {activeWorkspaceId === w.id && (
                  <div className="flex gap-1 ml-1">
                    <button 
                      onClick={() => {
                        setEditingWorkspace({ name: w.name, description: w.description || '', id: w.id });
                        setIsWorkspaceModalOpen(true);
                      }}
                      className="p-2 text-gray-400 hover:text-blue-500 transition-colors"
                      title="Edit Desktop"
                    >
                      <Settings className="w-3.5 h-3.5" />
                    </button>
                    <button 
                      onClick={shareWorkspace}
                      className="p-2 text-gray-400 hover:text-blue-500 transition-colors"
                      title="Share Desktop"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                    </button>
                    {workspaces.length > 1 && (
                      <button 
                        onClick={() => deleteWorkspace(w.id)}
                        className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
            <button 
              onClick={() => {
                setEditingWorkspace({ name: '', description: '' });
                setIsWorkspaceModalOpen(true);
              }}
              className="p-2 bg-gray-100 dark:bg-gray-800 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors shrink-0"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          {activeWorkspace?.description && (
            <p className="text-[10px] opacity-40 italic px-1">{activeWorkspace.description}</p>
          )}
        </header>
      )}

      {(isDisplayMode || fullscreenTimerId) && (
        <div className="fixed top-6 left-6 z-50">
          <button 
            onClick={() => {
              setIsDisplayMode(false);
              setFullscreenTimerId(null);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-900 shadow-xl border border-gray-100 dark:border-gray-800 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-gray-50 dark:hover:bg-gray-800 transition-all"
          >
            <X className="w-4 h-4" /> Back to Dashboard
          </button>
        </div>
      )}

      {isDisplayMode && (
        <div className="fixed top-6 right-6 z-50 flex gap-4">
          {/* Redundant buttons removed - now in the Dock */}
        </div>
      )}

      <main className={`p-4 md:p-8 flex flex-col md:flex-row gap-8 ${isDisplayMode ? 'h-[calc(100dvh-160px)] overflow-hidden' : 'pb-32'}`}>
        {/* Settings / Creator Panel */}
        <AnimatePresence>
          {isSettingsOpen && !isDisplayMode && (
            <motion.aside 
              initial={{ x: -400, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -400, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="w-full md:w-[400px] shrink-0"
            >
              <div className="bg-white dark:bg-gray-900 p-6 rounded-3xl shadow-xl border border-gray-100 dark:border-gray-800 sticky top-24">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    {editingTimerId ? <Settings className="w-5 h-5 text-blue-600" /> : <Plus className="w-5 h-5 text-blue-600" />}
                    {editingTimerId ? 'Edit Timer' : 'New Timer'}
                  </h2>
                  {editingTimerId && (
                    <button 
                      onClick={cancelEditingTimer}
                      className="text-[10px] font-bold uppercase tracking-widest text-red-500 hover:text-red-600 transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                </div>
                
                <div className="space-y-4">
                  <div className="relative">
                    <label className="text-[10px] font-bold uppercase tracking-widest opacity-50 mb-1 block">Timer Name</label>
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        value={newTimerName}
                        onChange={(e) => {
                          setNewTimerName(e.target.value);
                          setShowNameSuggestions(true);
                        }}
                        onFocus={() => setShowNameSuggestions(true)}
                        onBlur={() => setTimeout(() => setShowNameSuggestions(false), 200)}
                        className="flex-1 bg-gray-50 dark:bg-gray-800 p-3 rounded-xl border border-transparent focus:border-blue-500 outline-none font-medium transition-all"
                        placeholder="Routine Name..."
                      />
                      <input 
                        type="text" 
                        value={newTimerPronunciation}
                        onChange={(e) => setNewTimerPronunciation(e.target.value)}
                        className="w-1/3 bg-gray-50 dark:bg-gray-800 p-3 rounded-xl border border-transparent focus:border-blue-500 outline-none font-medium transition-all text-[10px]"
                        placeholder="Pronunciation..."
                        title="How the name should be spoken"
                      />
                    </div>
                    <AnimatePresence>
                      {showNameSuggestions && timerNamePresets.filter(n => n.toLowerCase().includes(newTimerName.toLowerCase()) && n.toLowerCase() !== newTimerName.toLowerCase()).length > 0 && (
                        <motion.div 
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl shadow-2xl overflow-hidden max-h-48 overflow-y-auto custom-scrollbar"
                        >
                          {timerNamePresets
                            .filter(n => n.toLowerCase().includes(newTimerName.toLowerCase()) && n.toLowerCase() !== newTimerName.toLowerCase())
                            .map((name, i) => (
                              <button
                                key={i}
                                onClick={() => {
                                  setNewTimerName(name);
                                  setShowNameSuggestions(false);
                                }}
                                className="w-full text-left px-4 py-3 text-xs font-bold uppercase tracking-widest hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors flex items-center justify-between group"
                              >
                                <span>{name}</span>
                                <span className="text-[8px] opacity-0 group-hover:opacity-40 transition-opacity">Select</span>
                              </button>
                            ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest opacity-50 mb-1 block">Start Announcement</label>
                    <div className="flex gap-2">
                      {(['none', 'task-name', 'timer-and-task'] as StartAnnouncementType[]).map((type) => (
                        <button
                          key={type}
                          onClick={() => setStartAnnouncementType(type)}
                          className={`flex-1 py-2 px-1 rounded-lg text-[9px] font-bold uppercase transition-all border ${
                            startAnnouncementType === type 
                              ? 'bg-blue-600 text-white border-blue-600' 
                              : 'bg-gray-50 dark:bg-gray-800 text-gray-400 border-transparent hover:border-gray-300'
                          }`}
                        >
                          {type.replace('-', ' ')}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest opacity-50 mb-1 block">Visual Alarm Duration ({visualAlarmDuration}s)</label>
                    <input 
                      type="range" 
                      min="1" 
                      max="60" 
                      step="1"
                      value={visualAlarmDuration}
                      onChange={(e) => setVisualAlarmDuration(Number(e.target.value))}
                      className="w-full h-2 bg-gray-100 dark:bg-gray-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                    />
                    <div className="flex justify-between text-[8px] font-bold opacity-30 mt-1">
                      <span>1s</span>
                      <span>30s</span>
                      <span>60s</span>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest opacity-50 mb-1 block flex items-center gap-1">
                      <Clock className="w-3 h-3" /> Inter-Alarm Delay ({interAlarmDelay}s)
                    </label>
                    <input 
                      type="range" 
                      min="0" 
                      max="30" 
                      step="1"
                      value={interAlarmDelay}
                      onChange={(e) => setInterAlarmDelay(Number(e.target.value))}
                      className="w-full h-2 bg-gray-100 dark:bg-gray-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                    <div className="flex justify-between text-[8px] font-bold opacity-30 mt-1">
                      <span>0s</span>
                      <span>15s</span>
                      <span>30s</span>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest opacity-50 mb-1 block">Voice Speed</label>
                    <div className="flex gap-2">
                      {[
                        { label: 'Slow', value: 0.7 },
                        { label: 'Normal', value: 1.0 },
                        { label: 'Fast', value: 1.3 }
                      ].map((rate) => (
                        <button
                          key={rate.label}
                          onClick={() => setSpeechRate(rate.value)}
                          className={`flex-1 py-2 px-1 rounded-lg text-[9px] font-bold uppercase transition-all border ${
                            speechRate === rate.value 
                              ? 'bg-blue-600 text-white border-blue-600' 
                              : 'bg-gray-50 dark:bg-gray-800 text-gray-400 border-transparent hover:border-gray-300'
                          }`}
                        >
                          {rate.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <label className="text-[10px] font-bold uppercase tracking-widest opacity-50">Tasks ({editingTasks.length})</label>
                      <button 
                        onClick={addTaskToEditing}
                        className="text-blue-600 hover:text-blue-700 font-bold text-xs flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" /> Add Task
                      </button>
                    </div>
                    
                    {taskPresets.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {taskPresets.map((preset, i) => (
                          <div key={i} className="group relative">
                            <button
                              onClick={() => {
                                const newTask: Task = {
                                  id: Math.random().toString(36).substr(2, 9),
                                  name: preset.name,
                                  pronunciation: preset.pronunciation || '',
                                  duration: DEFAULT_TASK_DURATION,
                                  color: preset.color,
                                  alarmType: 'standard'
                                };
                                setEditingTasks([...editingTasks, newTask]);
                              }}
                              className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded-lg text-[9px] font-bold uppercase hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors border border-transparent hover:border-blue-200 flex items-center gap-1 pr-6"
                              style={{ color: preset.color }}
                            >
                              {preset.name}
                            </button>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                deletePreset(preset.name);
                              }}
                              className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    
                    <div className="max-h-[40vh] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                      <DndContext 
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                      >
                        <SortableContext 
                          items={editingTasks.map(t => t.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          <AnimatePresence initial={false}>
                            {editingTasks.map((task) => (
                              <SortableTaskItem 
                                key={task.id}
                                task={task}
                                updateEditingTask={updateEditingTask}
                                saveTaskAsPreset={saveTaskAsPreset}
                                removeTaskFromEditing={removeTaskFromEditing}
                              />
                            ))}
                          </AnimatePresence>
                        </SortableContext>
                      </DndContext>
                    </div>
                  </div>

                  <button 
                    onClick={addTimer}
                    disabled={editingTasks.length === 0}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-30 text-white rounded-xl font-bold uppercase tracking-widest transition-all"
                  >
                    {editingTimerId ? 'Update Timer' : 'Save Timer'}
                  </button>
                </div>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Timers Display */}
        <div className={`flex-1 grid ${getGridCols(timers.length)} gap-6 p-4 h-full w-full items-start justify-center overflow-y-auto custom-scrollbar`}>
          <AnimatePresence>
            {timers.map(timer => {
              const isFullscreen = fullscreenTimerId === timer.id;
              const isLarge = isDisplayMode || isFullscreen;

              return (
                <motion.div 
                  key={timer.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className={`relative bg-white dark:bg-gray-900 rounded-[2rem] p-6 shadow-xl border border-gray-100 dark:border-gray-800/50 flex flex-col items-center group min-h-0 min-w-0 transition-all duration-500 ${getTimerScale(timers.length)} ${isFullscreen ? 'fixed inset-0 z-50 overflow-hidden flex items-center justify-center bg-white/95 dark:bg-black/95 backdrop-blur-xl scale-100' : ''}`}
                >
                  <AnimatePresence>
                    {timer.showStars && (
                      <StarBurst onComplete={() => {
                        setTimers(prev => prev.map(t => t.id === timer.id ? { ...t, showStars: false } : t));
                      }} />
                    )}
                  </AnimatePresence>

                  {!isDisplayMode && (
                    <div className={`absolute top-6 right-6 flex gap-2 transition-all z-50 ${isFullscreen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                      <button 
                        onClick={() => toggleFullscreen(isFullscreen ? null : timer.id)}
                        className="p-3 bg-white dark:bg-gray-900 shadow-2xl border border-gray-100 dark:border-gray-800 rounded-2xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-all flex items-center gap-2"
                      >
                        {isFullscreen ? (
                          <><Minimize2 className="w-5 h-5" /> <span className="text-xs font-bold uppercase tracking-widest">Exit Fullscreen</span></>
                        ) : (
                          <Maximize2 className="w-4 h-4" />
                        )}
                      </button>
                      {!isFullscreen && (
                        <>
                          <button 
                            onClick={() => startEditingTimer(timer)}
                            className={`p-2 rounded-lg transition-colors ${editingTimerId === timer.id ? 'bg-blue-600 text-white' : 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 hover:bg-blue-100'}`}
                            title="Edit Timer"
                          >
                            <Settings className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => deleteTimer(timer.id)}
                            className="p-2 bg-red-50 dark:bg-red-900/20 text-red-600 rounded-lg hover:bg-red-100 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  <div className={`w-full flex flex-col items-center justify-center ${isFullscreen ? 'h-full max-h-screen p-4 md:p-8 gap-2 md:gap-4' : ''}`}>
                    {/* Timer Name */}
                    <h2 className={`font-black uppercase tracking-tighter text-center leading-none ${isFullscreen ? 'text-[4vh] md:text-[6vh]' : isDisplayMode ? 'text-4xl' : 'text-xl'}`}>{timer.name}</h2>
                    
                    {/* Past Tasks Bullets */}
                    <div className={`flex flex-wrap justify-center gap-2 min-h-[12px] ${isFullscreen ? 'scale-125' : isDisplayMode ? 'scale-110' : ''}`}>
                      {timer.tasks.map((task, idx) => {
                        if (idx < timer.currentTaskIndex) {
                          return (
                            <div 
                              key={task.id} 
                              className="w-2 h-2 md:w-3 md:h-3 rounded-full shadow-sm" 
                              style={{ backgroundColor: task.color }} 
                              title={task.name}
                            />
                          );
                        }
                        return null;
                      })}
                    </div>

                    {/* Current Task Name */}
                    <div className={`font-black uppercase tracking-tighter text-center leading-none ${isFullscreen ? 'text-[4vh] md:text-[6vh]' : isDisplayMode ? 'text-4xl' : 'text-xl'}`} style={{ color: timer.tasks[timer.currentTaskIndex]?.color }}>
                      {timer.tasks[timer.currentTaskIndex]?.name}
                    </div>

                    {/* Countdown Time */}
                    <div className={`font-black tracking-tighter tabular-nums leading-none ${isFullscreen ? 'text-[12vh] md:text-[18vh]' : isDisplayMode ? 'text-9xl' : 'text-6xl'}`}>
                      {Math.floor(timer.remainingTime / 60)}:{(timer.remainingTime % 60).toString().padStart(2, '0')}
                    </div>

                    {/* Visual Timer Circle */}
                    <div className={`relative flex items-center justify-center ${isFullscreen ? 'flex-1 min-h-0 w-full max-h-[35vh]' : isDisplayMode ? 'w-64 h-64' : 'w-full max-w-[240px]'}`}>
                      <div className={isFullscreen ? 'h-full aspect-square' : 'w-full h-full'}>
                        <VisualTimer 
                          tasks={timer.tasks}
                          currentTaskIndex={timer.currentTaskIndex}
                          remainingTime={timer.remainingTime}
                          isRunning={timer.isRunning}
                          timerName={timer.name}
                          isDisplayMode={isLarge}
                        />
                      </div>
                    </div>

                    {/* Future Tasks (Simple indicator) */}
                    {!isLarge && timer.currentTaskIndex < timer.tasks.length - 1 && (
                      <div className="mt-6 w-full space-y-1 opacity-40">
                         <div className="text-[10px] font-bold uppercase tracking-widest text-center">
                           Next: {timer.tasks[timer.currentTaskIndex + 1].name}
                         </div>
                      </div>
                    )}
                  </div>

                  {/* Controls */}
                  <div className={`flex gap-4 w-full justify-center max-w-xs ${isFullscreen ? 'mb-4 scale-125' : isDisplayMode ? 'mt-8 scale-125' : 'mt-8'}`}>
                    <button 
                      onClick={() => resetTimer(timer.id)}
                      className={`${isLarge ? 'p-3' : 'p-4'} bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-2xl transition-all`}
                    >
                      <RotateCcw className="w-6 h-6" />
                    </button>
                    <button 
                      onClick={() => timer.isRunning ? pauseTimer(timer.id) : startTimer(timer.id)}
                      className={`${isLarge ? 'px-8 py-3' : 'flex-1 py-4'} rounded-2xl font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
                        timer.isRunning 
                          ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600' 
                          : 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                      }`}
                    >
                      {timer.isRunning ? (
                        <><Pause className="w-6 h-6 fill-current" /> {isLarge ? '' : 'Pause'}</>
                      ) : (
                        <><Play className="w-6 h-6 fill-current" /> {isLarge ? '' : 'Start'}</>
                      )}
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
          
          {timers.length === 0 && !isDisplayMode && (
            <div className="col-span-full flex flex-col items-center justify-center py-32 opacity-10">
              <RotateCcw className="w-32 h-32 mb-6 animate-spin-slow" />
              <p className="text-4xl font-black uppercase italic tracking-[0.3em]">No Active Timers</p>
            </div>
          )}
        </div>
      </main>

      <style>{`
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .animate-spin-slow {
          animation: spin-slow 20s linear infinite;
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(156, 163, 175, 0.2);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(156, 163, 175, 0.4);
        }
      `}</style>
    </div>
  );
}
