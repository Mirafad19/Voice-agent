
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

// PERFECTION: Human silhouette with professional headset, mirroring the user's reference
const FabIcon = ({className = "h-11 w-11 text-white"}) => (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
        {/* Human Head */}
        <circle cx="12" cy="7.5" r="3.5" fill="white" />
        {/* Human Body/Shoulders */}
        <path d="M5 19.5C5 16.4624 7.46243 14 10.5 14H13.5C16.5376 14 19 16.4624 19 19.5V20.5H5V19.5Z" fill="white" />
        {/* Headset Arc */}
        <path d="M16 7.5C16 5.29086 14.2091 3.5 12 3.5C9.79086 3.5 8 5.29086 8 7.5" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
        {/* Headset Earpiece */}
        <rect x="15.8" y="7" width="1.8" height="3.5" rx="0.9" fill="white" />
        {/* Mic Boom */}
        <path d="M17 11C17 13.2 15.5 14.5 13.5 14.5" stroke="white" strokeWidth="1" strokeLinecap="round" />
        {/* Mic Tip */}
        <circle cx="13" cy="14.5" r="1.2" fill="white" />
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

  const initChat = async (initialMessage?: string) => {
    const config = agentProfile as AgentConfig;
    const ai = new GoogleGenAI({ apiKey });
    const identityInstructions = `
    IDENTITY PROTOCOL:
    - You are strictly the "${config.name}".
    - You are a proprietary AI built specifically for this organization.
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
              <div className="flex items-center justify-between mb-4">
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

  const renderChatView = () => (
      <div className="flex flex-col h-full w-full bg-white dark:bg-gray-900 animate-fade-in-up overflow-hidden">
          <div className={`flex items-center justify-between p-5 z-20 bg-accent-${accentColorClass} text-white shadow-xl min-h-[72px] relative`}>
              <button onClick={() => setView('home')} className="p-1 rounded-full hover:bg-white/20"><ChevronLeftIcon /></button>
              <h3 className="font-black text-lg uppercase tracking-tight leading-tight flex-1 text-center truncate px-2">{agentProfile.name}</h3>
              {/* PERFECTION: Close button matching screenshot (white circle with accent-colored cross) */}
              <button 
                onClick={() => setIsOpen(false)} 
                className="w-9 h-9 rounded-full bg-white flex items-center justify-center text-accent-${accentColorClass} shadow-md hover:scale-110 active:scale-95 transition-all"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
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
            {/* Callout Close Button: Dark circle badge exactly like the screenshot */}
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
            {/* PERFECTION: Sharp Speech Tail pointing exactly at the button */}
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
        </div>
    </div>
  );
};
