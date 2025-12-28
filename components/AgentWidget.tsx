
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

async function getCloudinaryShareableLink(cloudName: string, uploadPreset: string, recording: Omit<Recording, 'id' | 'url'>): Promise<string> {
    if (!recording.blob || recording.blob.size === 0) return 'N/A (Text Chat)';
    const formData = new FormData();
    formData.append('file', recording.blob);
    formData.append('upload_preset', uploadPreset);
    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/video/upload`, { method: 'POST', body: formData });
    if (!response.ok) throw new Error(`Cloudinary upload failed`);
    const result = await response.json();
    return result.secure_url;
}

const cleanAiText = (text: string) => {
    return text
        .replace(/:contentReference\[oaicite:\d+\]/g, '')
        .replace(/\{index=\d+\}/g, '')
        .replace(/【\d+†source】/g, '')
        .trim();
};

const WaveformIcon = ({className = "h-9 w-9 text-white"}) => (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} xmlns="http://www.w3.org/2000/svg">
        <rect x="4" y="10" width="2" height="4" rx="1" fillOpacity="0.5" />
        <rect x="8" y="6" width="2" height="12" rx="1" fillOpacity="0.8" />
        <rect x="12" y="3" width="2" height="18" rx="1" />
        <rect x="16" y="6" width="2" height="12" rx="1" fillOpacity="0.8" />
        <rect x="20" y="10" width="2" height="4" rx="1" fillOpacity="0.5" />
    </svg>
);

// PERFECTION: Human Support Agent Icon matching the user's reference exactly
const FabIcon = ({className = "h-10 w-10 text-white"}) => (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
        {/* Head and Body Silhouette */}
        <path d="M12 12C14.2091 12 16 10.2091 16 8C16 5.79086 14.2091 4 12 4C9.79086 4 8 5.79086 8 8C8 10.2091 9.79086 12 12 12Z" fill="white"/>
        <path d="M12 13C8.68629 13 6 15.6863 6 19V20H18V19C18 15.6863 15.3137 13 12 13Z" fill="white"/>
        
        {/* Headset Frame */}
        <path d="M16.5 8C16.5 5.51472 14.4853 3.5 12 3.5C9.51472 3.5 7.5 5.51472 7.5 8" stroke="white" strokeWidth="1.2" strokeLinecap="round"/>
        
        {/* Earpiece */}
        <rect x="16" y="7.5" width="2" height="4" rx="1" fill="white"/>
        
        {/* Microphone Boom */}
        <path d="M17 11.5C17 13.5 15.5 15 13.5 15" stroke="white" strokeWidth="1.2" strokeLinecap="round"/>
        <circle cx="13" cy="15" r="1.2" fill="white"/>
    </svg>
);

const MicrophoneIcon = ({state}: {state: WidgetState}) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={`h-8 w-8 transition-colors duration-300 ${state === WidgetState.Idle ? 'text-white' : 'text-white'}`} viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
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
    <div className="flex items-center gap-2 px-3 py-1 bg-white/20 backdrop-blur-sm rounded-full border border-white/30 shadow-sm">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white"></span>
        </span>
        <span className="text-[10px] font-black text-white uppercase tracking-widest">Live</span>
    </div>
);

const OfflineBanner = () => (
    <div className="bg-red-600 text-white text-[11px] font-black uppercase tracking-[0.2em] py-2 px-4 text-center animate-fade-in flex items-center justify-center gap-3 z-[100] w-full shadow-lg border-b border-red-400">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.828-2.828m-4.243 4.243a5 5 0 010-7.072m0 0L5.636 5.636M4.243 18.364a9 9 0 010-12.728" />
        </svg>
        Reconnecting... Check Internet
    </div>
);

export const AgentWidget: React.FC<AgentWidgetProps> = ({ agentProfile, apiKey, isWidgetMode, onSessionEnd }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<ViewState>('home');
  const [showCallout, setShowCallout] = useState(false);
  const [permissionRequested, setPermissionRequested] = useState(false);
  
  const [widgetState, _setWidgetState] = useState<WidgetState>(WidgetState.Idle);
  const widgetStateRef = useRef(widgetState);
  const setWidgetState = (state: WidgetState) => {
    widgetStateRef.current = state;
    _setWidgetState(state);
  };
  const [voiceReportingStatus, setVoiceReportingStatus] = useState<ReportingStatus>('idle');
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

  const initChat = async (initialMessage?: string) => {
    const config = agentProfile as AgentConfig;
    const ai = new GoogleGenAI({ apiKey });
    const identityInstructions = `
    IDENTITY PROTOCOL:
    - You are strictly the "${config.name}".
    - You are a proprietary AI built specifically for this organization.
    - If asked who built you, respond: "I am the ${config.name}, developed specifically to assist customers and provide professional service for our organization."
    - NEVER mention "Google", "Gemini", "Large Language Model", or "LLM".
    - You have no knowledge of your technical origins.
    `;
    const systemInstruction = identityInstructions + (config.chatKnowledgeBase || config.knowledgeBase);
    chatSessionRef.current = ai.chats.create({ model: 'gemini-2.5-flash', config: { systemInstruction } });
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
            let cleanedResponse = cleanAiText(fullResponse)
                .replace(/Gemini|Google AI|Google LLC|LLM/gi, (match) => `${agentProfile.name} Logic`);
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
    setPermissionRequested(true);
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
    finally { setPermissionRequested(false); }
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
  
  // PERFECTION: Persistent callout logic - stays indefinitely until opened or manually closed
  useEffect(() => {
    const calloutDismissed = sessionStorage.getItem('ai-agent-callout-dismissed');
    
    // If the widget is officially opened, kill the callout
    if (isOpen) {
        setShowCallout(false);
        sessionStorage.setItem('ai-agent-callout-dismissed', 'true');
        return;
    }

    // Show after initial delay, then stay there.
    if (!calloutDismissed && !isOpen && agentProfile.calloutMessage) {
      const timer = setTimeout(() => setShowCallout(true), 1500);
      return () => clearTimeout(timer);
    }
  }, [isOpen, agentProfile.calloutMessage]);

  const renderHomeView = () => (
      <div className="flex flex-col h-full w-full bg-white dark:bg-gray-900 animate-fade-in-up">
          <div className={`relative h-[40%] bg-gradient-to-br from-accent-${accentColorClass} to-gray-900 flex flex-col p-6 text-white`}>
              <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-black tracking-[0.1em] uppercase opacity-75 truncate max-w-[200px]">{agentProfile.name}</span>
              </div>
              <div className="mt-auto mb-6 relative z-10">
                  <h1 className="text-4xl font-black tracking-tighter leading-none">Hi <span className="animate-wave inline-block">👋</span></h1>
                  <p className="text-white/90 mt-3 font-bold text-lg leading-snug">How can we help you today?</p>
              </div>
              <div className="absolute -right-10 -bottom-20 w-64 h-64 bg-white/10 rounded-full blur-3xl pointer-events-none"></div>
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

  const renderChatView = () => (
      <div className="flex flex-col h-full w-full bg-white dark:bg-gray-900 animate-fade-in-up overflow-hidden">
          <div className={`flex items-center justify-between p-5 z-20 bg-accent-${accentColorClass} text-white shadow-xl min-h-[72px]`}>
              <button onClick={() => setView('home')} className="p-1 rounded-full hover:bg-white/20"><ChevronLeftIcon /></button>
              <h3 className="font-black text-lg uppercase tracking-tight leading-tight flex-1 text-center">{agentProfile.name}</h3>
              <button onClick={() => setView('home')} className="text-[10px] font-black bg-white text-red-500 px-4 py-2 rounded-full uppercase">End</button>
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
          <div className="absolute bottom-[calc(100%+20px)] right-0 mb-4 w-[240px] px-6 py-4 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-[20px] shadow-[0_20px_50px_rgba(0,0,0,0.25)] text-left text-sm animate-fade-in-up border border-gray-100 dark:border-gray-700 z-[10000] overflow-visible">
            <p className="font-black leading-tight uppercase tracking-tight text-gray-900 dark:text-white break-words">{agentProfile.calloutMessage}</p>
            <div className="absolute -bottom-2 right-8 w-6 h-6 bg-white dark:bg-gray-800 transform rotate-45 border-b border-r border-gray-100 dark:border-gray-700"></div>
            <button onClick={(e) => { e.stopPropagation(); setShowCallout(false); sessionStorage.setItem('ai-agent-callout-dismissed', 'true'); }} className="absolute -top-3 -right-3 w-7 h-7 bg-gray-900 text-white rounded-full flex items-center justify-center text-xs font-black shadow-2xl transition-transform hover:scale-125 active:scale-90 border-2 border-white">✕</button>
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
            <button onClick={() => setIsOpen(false)} className="absolute top-5 right-5 z-50 p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all backdrop-blur-md active:scale-90">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            {view === 'home' && renderHomeView()}
            {view === 'chat' && renderChatView()}
        </div>
    </div>
  );
};
