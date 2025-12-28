
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AgentProfile, AgentConfig, WidgetState, Recording, ReportingStatus } from '../types';
import { GeminiLiveService } from '../services/geminiLiveService';
import { RecordingService } from '../services/recordingService';
import { Spinner } from './ui/Spinner';
import { GoogleGenAI, Type, Modality, Chat } from '@google/genai';
import { blobToBase64 } from '../utils';
import { decodePcmChunk } from '../utils/audio';

interface AgentWidgetProps {
  agentProfile: AgentProfile | AgentConfig;
  apiKey: string;
  isWidgetMode: boolean;
  onSessionEnd?: (recording: Recording) => void;
}

interface Message {
    role: 'user' | 'model';
    text: string;
    timestamp: Date;
}

type ViewState = 'home' | 'voice' | 'chat';

const cleanAiText = (text: string) => {
    return text
        .replace(/:contentReference\[oaicite:\d+\]/g, '')
        .replace(/\{index=\d+\}/g, '')
        .replace(/【\d+†source】/g, '')
        .trim();
};

// PERFECTION: High-fidelity Headset & Speech Bubble Icon
const FabIcon = ({className = "h-11 w-11 text-white"}) => (
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className={className} fill="none">
        <path d="M40 100 C 40 40, 160 40, 160 100" stroke="white" strokeWidth="14" strokeLinecap="round" />
        <rect x="25" y="90" width="20" height="45" rx="10" fill="white" />
        <rect x="155" y="90" width="20" height="45" rx="10" fill="white" />
        <circle cx="100" cy="100" r="50" fill="transparent" stroke="white" strokeWidth="12" />
        <path d="M75 100 A 25 25 0 1 1 115 120 L 125 135 L 105 125 A 25 25 0 0 1 75 100" fill="white" />
        <circle cx="88" cy="100" r="4.5" fill="black" opacity="0.6" />
        <circle cx="100" cy="100" r="4.5" fill="black" opacity="0.6" />
        <circle cx="112" cy="100" r="4.5" fill="black" opacity="0.6" />
        <path d="M45 135 Q 45 165, 100 165" stroke="white" strokeWidth="10" strokeLinecap="round" />
        <circle cx="105" cy="165" r="8" fill="white" />
    </svg>
);

const MicrophoneIcon = ({state}: {state: WidgetState}) => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 2m0 3a3 3 0 0 1 3 -3h0a3 3 0 0 1 3 3v5a3 3 0 0 1 -3 3h0a3 3 0 0 1 -3 -3z" />
        <path d="M5 10a7 7 0 0 0 14 0" />
        <path d="M8 21l8 0" />
        <path d="M12 17l0 4" />
    </svg>
);

const SendIcon = ({className = "h-5 w-5"}) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 20 20" fill="currentColor">
    <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
  </svg>
);

const ChevronLeftIcon = ({className = "h-6 w-6 text-white"}) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" />
    </svg>
);

const LiveBadge = () => (
    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white/20 backdrop-blur-sm rounded-full border border-white/30 shadow-sm animate-fade-in">
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white"></span>
        </span>
        <span className="text-[9px] font-black text-white uppercase tracking-[0.15em]">Live</span>
    </div>
);

export const AgentWidget: React.FC<AgentWidgetProps> = ({ agentProfile, apiKey, isWidgetMode, onSessionEnd }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<ViewState>('home');
  const [showCallout, setShowCallout] = useState(false);
  
  const [widgetState, _setWidgetState] = useState<WidgetState>(WidgetState.Idle);
  const widgetStateRef = useRef(widgetState);
  const setWidgetState = (state: WidgetState) => {
    widgetStateRef.current = state;
    _setWidgetState(state);
  };
  const fullTranscriptRef = useRef('');
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatTyping, setIsChatTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [errorMessage, setErrorMessage] = useState('');

  const geminiServiceRef = useRef<GeminiLiveService | null>(null);
  const recordingServiceRef = useRef<RecordingService | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioQueueRef = useRef<Uint8Array[]>([]);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const activeAudioSourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const nextStartTimeRef = useRef(0);
  const chatSessionRef = useRef<Chat | null>(null);
  
  const accentColorClass = agentProfile.accentColor;

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  useEffect(() => { scrollToBottom(); }, [messages, isChatTyping]);

  const endSession = useCallback(() => {
      geminiServiceRef.current?.disconnect();
      recordingServiceRef.current?.stop();
      if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach(track => track.stop());
      }
      activeAudioSourcesRef.current.forEach(s => s.stop());
      activeAudioSourcesRef.current.clear();
      audioQueueRef.current = [];
      setWidgetState(WidgetState.Idle);
      setView('home');
  }, []);

  const initChat = async (initialMessage?: string) => {
    const config = agentProfile as AgentConfig;
    const ai = new GoogleGenAI({ apiKey });
    const identityInstructions = `
    IDENTITY PROTOCOL:
    - You are strictly the "${config.name}".
    - NEVER mention Google or Gemini.
    `;
    const systemInstruction = identityInstructions + (config.chatKnowledgeBase || config.knowledgeBase);
    chatSessionRef.current = ai.chats.create({ model: 'gemini-3-flash-preview', config: { systemInstruction } });
    const welcomeText = config.initialGreetingText || config.initialGreeting || "Hello! How can I help you?";
    setMessages([{ role: 'model', text: welcomeText, timestamp: new Date() }]);
    setView('chat');
    if (initialMessage) { await handleChatMessage(initialMessage); }
  };

  const handleChatMessage = async (text: string) => {
    if (!text.trim() || !chatSessionRef.current || !isOnline) return;
    setMessages(prev => [...prev, { role: 'user', text, timestamp: new Date() }]);
    setChatInput('');
    setIsChatTyping(true);
    try {
        const result = await chatSessionRef.current.sendMessageStream({ message: text });
        let fullResponse = "";
        setMessages(prev => [...prev, { role: 'model', text: "", timestamp: new Date() }]);
        for await (const chunk of result) {
            fullResponse += chunk.text;
            let cleanedResponse = cleanAiText(fullResponse);
            setMessages(prev => {
                const updated = [...prev];
                const lastIdx = updated.length - 1;
                if (lastIdx >= 0 && updated[lastIdx].role === 'model') { updated[lastIdx] = { ...updated[lastIdx], text: cleanedResponse }; }
                return updated;
            });
        }
    } catch (e) {
        setMessages(prev => [...prev, { role: 'model', text: "Error. Try again.", timestamp: new Date() }]);
    } finally { setIsChatTyping(false); }
  };

  const startVoiceSession = useCallback(async () => {
    if (!isOnline) return;
    setView('voice');
    setWidgetState(WidgetState.Connecting);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
      outputAudioContextRef.current = new AudioContextClass();
      recordingServiceRef.current = new RecordingService((blob, mime) => {});
      await recordingServiceRef.current.start(stream);
      geminiServiceRef.current = new GeminiLiveService(apiKey, agentProfile as AgentConfig, {
        onStateChange: (s) => setWidgetState(s === 'connected' ? WidgetState.Listening : WidgetState.Idle),
        onTranscriptUpdate: (f, t, type) => { if (f) fullTranscriptRef.current += `${type}: ${t}\n`; },
        onAudioChunk: (c) => { audioQueueRef.current.push(c); playAudioQueue(); },
        onInterruption: () => { activeAudioSourcesRef.current.forEach(s => s.stop()); activeAudioSourcesRef.current.clear(); audioQueueRef.current = []; },
        onError: (e) => setErrorMessage(e),
      });
      geminiServiceRef.current.connect(stream);
    } catch (e) { setWidgetState(WidgetState.Error); }
  }, [apiKey, agentProfile, isOnline]);

  const playAudioQueue = useCallback(() => {
    if (audioQueueRef.current.length === 0 || !outputAudioContextRef.current) return;
    setWidgetState(WidgetState.Speaking);
    const ctx = outputAudioContextRef.current;
    if (nextStartTimeRef.current < ctx.currentTime) { nextStartTimeRef.current = ctx.currentTime + 0.05; }
    while (audioQueueRef.current.length > 0) {
        const chunk = audioQueueRef.current.shift();
        if (!chunk) continue;
        const buf = decodePcmChunk(chunk, ctx);
        const source = ctx.createBufferSource();
        source.buffer = buf;
        source.connect(ctx.destination);
        source.start(nextStartTimeRef.current);
        nextStartTimeRef.current += buf.duration;
        activeAudioSourcesRef.current.add(source);
        source.onended = () => {
            activeAudioSourcesRef.current.delete(source);
            if (activeAudioSourcesRef.current.size === 0 && audioQueueRef.current.length === 0) { setWidgetState(WidgetState.Listening); }
        };
    }
  }, []);

  useEffect(() => {
    if (!isWidgetMode) return;
    let width = 80;
    let height = 80;
    if (isOpen) {
        width = 400; height = 600;
    } else if (showCallout) {
        width = 300; height = 220;
    }
    window.parent.postMessage({ type: 'agent-widget-resize', isOpen, width, height }, '*');
  }, [isOpen, isWidgetMode, showCallout]);
  
  useEffect(() => {
    const calloutDismissed = sessionStorage.getItem('ai-agent-callout-dismissed');
    if (isOpen) {
        setShowCallout(false);
        sessionStorage.setItem('ai-agent-callout-dismissed', 'true');
        return;
    }
    if (!calloutDismissed && !isOpen && agentProfile.calloutMessage) {
      const timer = setTimeout(() => setShowCallout(true), 1500);
      return () => clearTimeout(timer);
    }
  }, [isOpen, agentProfile.calloutMessage]);

  const renderHomeView = () => (
      <div className="flex flex-col h-full w-full bg-white dark:bg-gray-900 animate-fade-in-up">
          <div className={`relative h-[40%] bg-gradient-to-br from-accent-${accentColorClass} to-gray-900 flex flex-col p-6 text-white`}>
              <button onClick={() => setIsOpen(false)} className="absolute top-4 right-4 p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all backdrop-blur-md active:scale-90 z-50">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
              <div className="flex items-center justify-between mb-4 mt-4">
                  <span className="text-xs font-black tracking-[0.1em] uppercase opacity-75 truncate max-w-[200px]">{agentProfile.name}</span>
              </div>
              <div className="mt-auto mb-6 relative z-10">
                  <h1 className="text-4xl font-black tracking-tighter leading-none">Hi <span className="animate-wave inline-block">👋</span></h1>
                  <p className="text-white/90 mt-3 font-bold text-lg leading-snug">How can we help you today?</p>
              </div>
          </div>
          <div className="flex-1 bg-gray-50 dark:bg-gray-900 relative -mt-6 rounded-t-[2rem] px-6 pt-8 flex flex-col gap-4 shadow-2xl z-20">
              <form onSubmit={(e) => { e.preventDefault(); initChat(chatInput); }} className="relative w-full">
                  <input type="text" placeholder="Ask a question..." value={chatInput} onChange={(e) => setChatInput(e.target.value)} className="w-full pl-6 pr-14 py-4 rounded-2xl shadow-sm border-2 border-transparent bg-white dark:bg-gray-800 focus:outline-none focus:border-accent-${accentColorClass} text-gray-900 dark:text-white transition-all text-left font-semibold" />
                  <button type="submit" className={`absolute right-3 top-1/2 -translate-y-1/2 p-3 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-500 hover:text-accent-${accentColorClass}`}><SendIcon /></button>
              </form>
              <button onClick={startVoiceSession} className={`w-full bg-gradient-to-r from-accent-${accentColorClass} to-gray-800 rounded-2xl p-1 shadow-xl hover:scale-[1.03] transition-transform group text-left`}>
                  <div className="bg-white/10 backdrop-blur-md rounded-xl p-5 flex items-center gap-5 h-full">
                      <div className="p-4 bg-white/20 rounded-2xl animate-pulse"><MicrophoneIcon state={WidgetState.Idle} /></div>
                      <div className="text-left text-white">
                          <h3 className="font-black text-xl tracking-tighter uppercase leading-none">Talk to AI Assistant</h3>
                          <p className="text-xs font-bold opacity-80 mt-1 uppercase tracking-widest">Skip typing, we're listening.</p>
                      </div>
                  </div>
              </button>
          </div>
      </div>
  );

  const renderVoiceView = () => (
      <div className="flex flex-col h-full w-full bg-gray-900 animate-fade-in-up overflow-hidden relative">
          <div className={`flex items-center justify-between p-5 z-20 bg-accent-${accentColorClass} text-white shadow-xl min-h-[72px] relative`}>
              <div className="w-9" />
              <div className="flex flex-col items-center flex-1 truncate">
                <h3 className="font-black text-lg uppercase tracking-tight leading-none text-center">{agentProfile.name}</h3>
                <div className="mt-1"><LiveBadge /></div>
              </div>
              <button onClick={endSession} className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all active:scale-90">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-10">
              <div className="relative">
                  <div className={`absolute inset-0 bg-accent-${accentColorClass} rounded-full blur-3xl opacity-20 scale-150 animate-pulse`}></div>
                  <div className="w-48 h-48 rounded-full bg-gradient-to-br from-accent-${accentColorClass} to-black flex items-center justify-center shadow-2xl relative z-10 border-4 border-white/10">
                      <div className="flex items-end gap-2 h-20">
                          {[1, 2, 3, 4, 5, 6].map((i) => (
                              <div key={i} className={`w-2.5 bg-white rounded-full transition-all duration-300 ${widgetState === WidgetState.Speaking ? 'animate-bounce' : 'h-5 opacity-40'}`} style={{ height: widgetState === WidgetState.Speaking ? `${30 + Math.random() * 70}%` : '20px', animationDelay: `${i * 0.12}s` }}></div>
                          ))}
                      </div>
                  </div>
              </div>
              <div className="text-center space-y-3">
                  <p className="text-white text-3xl font-black uppercase tracking-tighter">
                      {widgetState === WidgetState.Connecting ? 'Connecting...' : widgetState === WidgetState.Speaking ? 'AI Speaking...' : 'Listening...'}
                  </p>
                  <p className="text-white/50 text-xs font-bold uppercase tracking-[0.2em] animate-pulse">Session Active</p>
              </div>
          </div>
          <div className="p-10 flex justify-center pb-12">
               <button onClick={endSession} className="bg-red-600 hover:bg-red-700 text-white px-10 py-4 rounded-full font-black uppercase tracking-widest shadow-[0_10px_30px_rgba(220,38,38,0.4)] active:scale-95 transition-all">End Call</button>
          </div>
      </div>
  );

  const renderChatView = () => (
      <div className="flex flex-col h-full w-full bg-white dark:bg-gray-900 animate-fade-in-up overflow-hidden">
          <div className={`flex items-center justify-between p-5 z-20 bg-accent-${accentColorClass} text-white shadow-xl min-h-[72px] relative`}>
              <button onClick={() => setView('home')} className="p-1 rounded-full hover:bg-white/20"><ChevronLeftIcon /></button>
              <div className="flex flex-col items-center flex-1 truncate">
                <h3 className="font-black text-lg uppercase tracking-tight leading-none text-center">{agentProfile.name}</h3>
                <div className="mt-1"><LiveBadge /></div>
              </div>
              <button onClick={() => { endSession(); setIsOpen(false); }} className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all active:scale-90">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
          </div>
          <div className="flex-grow overflow-y-auto p-4 space-y-4 bg-gray-50 dark:bg-gray-900">
              {messages.map((msg, idx) => (
                  <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] rounded-2xl p-4 text-[15px] shadow-sm ${msg.role === 'user' ? `bg-accent-${accentColorClass} text-white rounded-br-none` : 'bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 text-gray-800 dark:text-gray-200 rounded-bl-none'}`}>{msg.text}</div>
                  </div>
              ))}
              {isChatTyping && <div className="flex justify-start"><div className="bg-white dark:bg-gray-800 p-4 rounded-2xl rounded-bl-none shadow-sm flex gap-2"><div className="w-2.5 h-2.5 bg-gray-400 rounded-full animate-bounce"></div><div className="w-2.5 h-2.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0.2s]"></div><div className="w-2.5 h-2.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0.4s]"></div></div></div>}
              <div ref={messagesEndRef} />
          </div>
          <form onSubmit={(e) => { e.preventDefault(); handleChatMessage(chatInput); }} className="p-5 border-t border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-900 flex gap-2">
              <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Type..." className="flex-1 px-5 py-4 rounded-2xl bg-gray-100 dark:bg-gray-800 focus:outline-none" />
              <button type="submit" className={`p-3 rounded-xl text-white bg-accent-${accentColorClass}`}><SendIcon /></button>
          </form>
      </div>
  );

  const fabContent = (
      <div className={`${agentProfile.theme === 'dark' ? 'dark' : ''} relative`}>
        {showCallout && agentProfile.calloutMessage && (
          <div className="absolute bottom-[calc(100%+28px)] right-0 mb-4 w-[280px] bg-white dark:bg-gray-800 rounded-[24px] shadow-[0_15px_50px_rgba(0,0,0,0.3)] text-left animate-fade-in-up border border-gray-100 dark:border-gray-700 z-[10000] overflow-visible">
            <button 
              onClick={(e) => { e.stopPropagation(); setShowCallout(false); sessionStorage.setItem('ai-agent-callout-dismissed', 'true'); }} 
              className="absolute -top-3 -right-3 w-8 h-8 bg-gray-900 text-white rounded-full flex items-center justify-center text-xs font-bold shadow-xl border-2 border-white transition-transform hover:scale-110 active:scale-90"
            >
                ✕
            </button>
            <div className="p-6">
                <p className="font-black text-[18px] leading-[1.2] uppercase tracking-tighter text-gray-900 dark:text-white break-words">
                    {agentProfile.calloutMessage}
                </p>
            </div>
            <div className="absolute -bottom-3 right-8 w-6 h-6 bg-white dark:bg-gray-800 transform rotate-45 border-b border-r border-gray-100 dark:border-gray-700"></div>
          </div>
        )}
        <button onClick={() => setIsOpen(!isOpen)} className={`w-16 h-16 rounded-full bg-accent-${accentColorClass} shadow-2xl flex items-center justify-center text-white transform hover:scale-110 transition-all active:scale-95 group relative`}>
          <FabIcon />
          <div className="absolute inset-0 rounded-full bg-white opacity-0 group-hover:opacity-10 transition-opacity"></div>
        </button>
      </div>
  );

  if (!isOpen) {
    return isWidgetMode ? <div className="w-full h-full p-2 flex items-end justify-end bg-transparent overflow-visible">{fabContent}</div> : <div className="fixed bottom-6 right-6 z-[9999] overflow-visible">{fabContent}</div>;
  }

  return (
    <div className={`${agentProfile.theme === 'dark' ? 'dark' : ''} fixed bottom-0 right-0 md:bottom-24 md:right-6 w-full h-[100dvh] md:w-[400px] md:h-[600px] md:rounded-[2rem] shadow-2xl z-[9999] overflow-hidden`}>
        <div className="flex flex-col w-full h-full bg-white dark:bg-gray-900">
            {view === 'home' && renderHomeView()}
            {view === 'chat' && renderChatView()}
            {view === 'voice' && renderVoiceView()}
        </div>
    </div>
  );
};
