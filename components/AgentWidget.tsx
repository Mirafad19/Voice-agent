
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AgentProfile, AgentConfig, WidgetTheme, WidgetState, Recording, ReportingStatus } from '../types';
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

    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/video/upload`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Cloudinary upload failed: ${errorData.error.message}`);
    }

    const result = await response.json();
    return result.secure_url;
}

const WaveformIcon = ({className = "h-9 w-9 text-white"}) => (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} xmlns="http://www.w3.org/2000/svg">
        <rect x="4" y="10" width="2" height="4" rx="1" fillOpacity="0.5" />
        <rect x="8" y="6" width="2" height="12" rx="1" fillOpacity="0.8" />
        <rect x="12" y="3" width="2" height="18" rx="1" />
        <rect x="16" y="6" width="2" height="12" rx="1" fillOpacity="0.8" />
        <rect x="20" y="10" width="2" height="4" rx="1" fillOpacity="0.5" />
    </svg>
);

const FabIcon = ({className = "h-9 w-9 text-white"}) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 13.5V12a8 8 0 1116 0v1.5" />
        <path d="M4 12a2 2 0 00-2 2v3a2 2 0 002 2h1" />
        <path d="M20 12a2 2 0 012 2v3a2 2 0 01-2 2h-1" />
        <path d="M9 12h.01" />
        <path d="M15 12h.01" />
        <path d="M9.5 16a3.5 3.5 0 005 0" />
        <path d="M5 14v1a2 2 0 002 2h2" />
    </svg>
);

const MicrophoneIcon = ({state}: {state: WidgetState}) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={`h-8 w-8 transition-colors duration-300 ${state === WidgetState.Idle ? 'text-white' : 'text-white'}`} viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
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

const NetworkWarning = () => (
  <div className="absolute inset-0 z-[100] flex items-center justify-center pointer-events-none p-4">
    <div className="bg-amber-600 text-white text-[12px] font-black uppercase tracking-tight px-3 py-2 rounded-xl shadow-[0_10px_30px_rgba(0,0,0,0.5)] flex flex-col items-center gap-1 border-2 border-amber-400 backdrop-blur-md animate-pulse text-center leading-none">
      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      <span className="whitespace-nowrap">Network Not Stable</span>
    </div>
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
  const [isNetworkSlow, setIsNetworkSlow] = useState(false);

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
  const masterGainNodeRef = useRef<GainNode | null>(null);
  const activeAudioSourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const nextStartTimeRef = useRef(0);
  const shouldEndAfterSpeakingRef = useRef(false);
  const chatSessionRef = useRef<Chat | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  
  const isGreetingProtectedRef = useRef(false);

  const accentColorClass = agentProfile.accentColor;

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const conn = (navigator as any).connection;
    const checkNetwork = () => {
      if (!conn) return;
      const isSlow = conn.effectiveType === '2g' || 
                     conn.effectiveType === '3g' || 
                     (conn.rtt && conn.rtt > 600) || 
                     (conn.downlink && conn.downlink < 1.0);
      setIsNetworkSlow(isSlow);
    };

    if (conn) {
      conn.addEventListener('change', checkNetwork);
      checkNetwork();
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (conn) conn.removeEventListener('change', checkNetwork);
    };
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
  useEffect(() => {
    scrollToBottom();
  }, [messages, isChatTyping]);

  const analyzeAndSendReport = useCallback(async (recording: Omit<Recording, 'id' | 'url'>) => {
    const { emailConfig, fileUploadConfig } = agentProfile as AgentConfig;
    const hasUserInteracted = recording.transcript && recording.transcript.includes('User:');
    if (!hasUserInteracted || !emailConfig?.formspreeEndpoint) {
        if (view === 'voice') setVoiceReportingStatus('idle');
        return; 
    }
    if (view === 'voice') setVoiceReportingStatus('analyzing');
    try {
        let audioLink = 'N/A';
        if (recording.blob && fileUploadConfig?.cloudinaryCloudName) {
            audioLink = await getCloudinaryShareableLink(fileUploadConfig.cloudinaryCloudName, fileUploadConfig.cloudinaryUploadPreset, recording).catch(() => 'Upload Failed');
        }
        const ai = new GoogleGenAI({ apiKey });
        const contents = { parts: [
            { text: `Analyze session. Summary, sentiment, action items. JSON.` },
            { text: `TRANSCRIPT:\n${recording.transcript}` }
        ] };
        let analysis = { summary: 'Analysis unavailable', sentiment: 'Neutral', actionItems: [] };
        try {
            const response = await ai.models.generateContent({
                model: "gemini-3-flash-preview",
                contents: contents,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT, properties: {
                            summary: { type: Type.STRING },
                            sentiment: { type: Type.STRING },
                            actionItems: { type: Type.ARRAY, items: { type: Type.STRING } }
                        }, required: ["summary", "sentiment", "actionItems"]
                    }
                },
            });
            if (response.text) analysis = JSON.parse(response.text);
        } catch (e) {}
        const reportData = {
          _subject: `Session Report: ${recording.name}`,
          agent: agentProfile.name,
          sentiment: analysis.sentiment,
          summary: analysis.summary,
          actionItems: analysis.actionItems.map((i:string) => `- ${i}`).join('\n'),
          transcript: recording.transcript,
          audioLink
        };
        if (view === 'voice') setVoiceReportingStatus('sending');
        await fetch(emailConfig.formspreeEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reportData) });
        if (view === 'voice') setVoiceReportingStatus('sent');
    } catch (e) { if (view === 'voice') setVoiceReportingStatus('failed'); }
  }, [agentProfile, apiKey, view]);

  const initChat = async (initialMessage?: string) => {
    const ai = new GoogleGenAI({ apiKey });
    chatSessionRef.current = ai.chats.create({
        model: 'gemini-3-flash-preview',
        config: { systemInstruction: (agentProfile as AgentConfig).chatKnowledgeBase || (agentProfile as AgentConfig).knowledgeBase }
    });
    setMessages([{ role: 'model', text: (agentProfile as AgentConfig).initialGreetingText || (agentProfile as AgentConfig).initialGreeting || "Hello!", timestamp: new Date() }]);
    setView('chat');
    if (initialMessage) await handleChatMessage(initialMessage);
  };

  const handleChatMessage = async (text: string) => {
    if (!text.trim() || !chatSessionRef.current || !isOnline) return;
    setMessages(prev => [...prev, { role: 'user', text, timestamp: new Date() }]);
    setChatInput('');
    setIsChatTyping(true);
    try {
        const result = await chatSessionRef.current.sendMessageStream({ message: text });
        let full = "";
        setMessages(prev => [...prev, { role: 'model', text: "", timestamp: new Date() }]);
        for await (const chunk of result) {
            full += chunk.text;
            setMessages(prev => {
                const upd = [...prev];
                upd[upd.length - 1].text = full;
                return upd;
            });
        }
    } catch (e) { setMessages(prev => [...prev, { role: 'model', text: "Connection error.", timestamp: new Date() }]); }
    finally { setIsChatTyping(false); }
  };

  const endChatSession = useCallback(() => {
    if (messages.length <= 1) { setView('home'); setMessages([]); return; }
    const transcript = messages.map(m => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.text}`).join('\n\n');
    const now = new Date();
    const newRecording: Omit<Recording, 'id' | 'url'> = {
        name: `Chat Session - ${now.toLocaleString()}`,
        blob: new Blob([], { type: 'text/plain' }),
        mimeType: 'text/plain',
        transcript
    };
    analyzeAndSendReport(newRecording);
    setMessages([]); chatSessionRef.current = null; setView('home');
    if (isWidgetMode && onSessionEnd) onSessionEnd({ ...newRecording, id: `chat-${now.getTime()}`, url: '' });
  }, [messages, analyzeAndSendReport, isWidgetMode, onSessionEnd]);

  const resetSilenceTimer = useCallback(() => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = window.setTimeout(() => geminiServiceRef.current?.sendText("[[SILENCE_DETECTED]]"), 8000);
  }, []);

  const clearSilenceTimer = useCallback(() => { if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; } }, []);

  const handleInterruption = useCallback(() => {
    if (isGreetingProtectedRef.current) return;
    activeAudioSourcesRef.current.forEach(source => { try { source.stop(); } catch(e) {} });
    activeAudioSourcesRef.current.clear();
    audioQueueRef.current = [];
    nextStartTimeRef.current = 0;
    if (widgetStateRef.current === WidgetState.Speaking) { setWidgetState(WidgetState.Listening); resetSilenceTimer(); }
  }, [resetSilenceTimer]);

  const startVoiceSession = useCallback(async () => {
    if (!isOnline) return;
    setView('voice');
    setWidgetState(WidgetState.Connecting);
    setVoiceReportingStatus('idle');
    setErrorMessage('');
    fullTranscriptRef.current = '';
    setPermissionRequested(true);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 16000, channelCount: 1 } });
      mediaStreamRef.current = stream;
    } catch (e) {
      setWidgetState(WidgetState.Error);
      setErrorMessage("Mic Denied.");
      cleanupServices();
      return;
    } finally { setPermissionRequested(false); }
    
    outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ latencyHint: 'playback' });
    masterGainNodeRef.current = outputAudioContextRef.current.createGain();
    masterGainNodeRef.current.gain.value = 2.0; 
    masterGainNodeRef.current.connect(outputAudioContextRef.current.destination);

    if (outputAudioContextRef.current.state === 'suspended') await outputAudioContextRef.current.resume();
    
    recordingServiceRef.current = new RecordingService(handleVoiceSessionEnd);
    await recordingServiceRef.current.start(stream);

    const greeting = (agentProfile as AgentConfig).initialGreeting;
    if (greeting) {
        isGreetingProtectedRef.current = true;
        fullTranscriptRef.current = `Agent: ${greeting}\n`;
        try {
            const ai = new GoogleGenAI({ apiKey });
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash-preview-tts",
                contents: [{ parts: [{ text: greeting }] }],
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: (agentProfile as AgentConfig).voice } } },
                },
            });
            const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
                const bin = atob(base64Audio);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                audioQueueRef.current.push(bytes);
                recordingServiceRef.current?.addAgentAudioChunk(bytes);
                playAudioQueue(true); 
            } else { isGreetingProtectedRef.current = false; }
        } catch (error) { isGreetingProtectedRef.current = false; }
    }

    geminiServiceRef.current = new GeminiLiveService(apiKey, agentProfile as AgentConfig, {
      onStateChange: (state) => {
        if (state === 'connected') { if (widgetStateRef.current !== WidgetState.Speaking) { setWidgetState(WidgetState.Listening); resetSilenceTimer(); } }
        if (state === 'ended') { 
            if (widgetStateRef.current === WidgetState.Connecting) { setWidgetState(WidgetState.Error); setErrorMessage("NETWORK ERROR."); }
            else setWidgetState(WidgetState.Ended);
            cleanupServices();
        }
      },
      onTranscriptUpdate: (isFinal, text, type) => {
         if (isFinal) fullTranscriptRef.current += `${type === 'input' ? 'User' : 'Agent'}: ${text}\n`;
         if (type === 'input' && text.trim().length > 0) resetSilenceTimer();
         if (isFinal && type === 'output') {
          const lower = text.toLowerCase();
          if (['goodbye', 'bye', 'farewell', 'take care'].some(k => lower.includes(k))) {
            shouldEndAfterSpeakingRef.current = true;
            if (activeAudioSourcesRef.current.size === 0 && audioQueueRef.current.length === 0) endVoiceSession();
          }
        }
      },
      onAudioChunk: (chunk) => {
        audioQueueRef.current.push(chunk);
        recordingServiceRef.current?.addAgentAudioChunk(chunk);
        playAudioQueue();
      },
      onInterruption: handleInterruption,
      onLocalInterruption: handleInterruption,
      onError: (error) => { setWidgetState(WidgetState.Error); cleanupServices(); },
    });
    geminiServiceRef.current.connect(stream);
  }, [apiKey, agentProfile, resetSilenceTimer, handleInterruption, isOnline]);

  const endVoiceSession = useCallback(() => { cleanupServices(); setWidgetState(WidgetState.Ended); }, []);

  const handleVoiceSessionEnd = useCallback((blob: Blob, mimeType: string) => {
    if (blob.size === 0) return;
    const now = new Date();
    const newRecording: Omit<Recording, 'id' | 'url'> = { name: `Voice Call - ${now.toLocaleString()}`, blob, mimeType, transcript: fullTranscriptRef.current };
    if (isWidgetMode) analyzeAndSendReport(newRecording);
    else if(onSessionEnd) onSessionEnd({ ...newRecording, id: `rec-${now.getTime()}`, url: URL.createObjectURL(blob) });
  }, [onSessionEnd, isWidgetMode, analyzeAndSendReport]);

  const cleanupServices = useCallback(() => {
    isGreetingProtectedRef.current = false;
    clearSilenceTimer();
    geminiServiceRef.current?.disconnect(); geminiServiceRef.current = null;
    recordingServiceRef.current?.stop(); recordingServiceRef.current = null;
    mediaStreamRef.current?.getTracks().forEach(track => track.stop()); mediaStreamRef.current = null;
    activeAudioSourcesRef.current.forEach(source => source.stop()); activeAudioSourcesRef.current.clear();
    outputAudioContextRef.current?.close().catch(() => {}); outputAudioContextRef.current = null;
    masterGainNodeRef.current = null; audioQueueRef.current = []; nextStartTimeRef.current = 0;
  }, [clearSilenceTimer]);

  const playAudioQueue = useCallback((isInitialGreeting: boolean = false) => {
    clearSilenceTimer();
    if (audioQueueRef.current.length === 0 || !outputAudioContextRef.current || !masterGainNodeRef.current) return;
    if (widgetStateRef.current !== WidgetState.Speaking && widgetStateRef.current !== WidgetState.Error) setWidgetState(WidgetState.Speaking);
    const audioContext = outputAudioContextRef.current;
    if (nextStartTimeRef.current < audioContext.currentTime) nextStartTimeRef.current = audioContext.currentTime + 0.05;
    while (audioQueueRef.current.length > 0) {
        const chunk = audioQueueRef.current.shift(); if (!chunk) continue;
        const audioBuffer = decodePcmChunk(chunk, audioContext);
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(masterGainNodeRef.current);
        source.start(nextStartTimeRef.current);
        nextStartTimeRef.current += audioBuffer.duration;
        activeAudioSourcesRef.current.add(source);
        source.onended = () => {
            activeAudioSourcesRef.current.delete(source);
            if (isInitialGreeting && activeAudioSourcesRef.current.size === 0 && audioQueueRef.current.length === 0) isGreetingProtectedRef.current = false;
            if (activeAudioSourcesRef.current.size === 0 && audioQueueRef.current.length === 0) {
                 if (shouldEndAfterSpeakingRef.current) endVoiceSession();
                 else if (widgetStateRef.current === WidgetState.Speaking) { setWidgetState(WidgetState.Listening); resetSilenceTimer(); }
            }
        };
    }
  }, [endVoiceSession, clearSilenceTimer, resetSilenceTimer]);

  const toggleWidget = () => {
    if (isOpen) {
      if (view === 'chat' && messages.length > 1) endChatSession();
      else if (view === 'voice' && widgetState !== WidgetState.Idle && widgetState !== WidgetState.Ended) endVoiceSession();
      setTimeout(() => setView('home'), 300);
    } else { sessionStorage.setItem('ai-agent-callout-dismissed', 'true'); setShowCallout(false); }
    setIsOpen(!isOpen);
  };

  const handleBack = () => {
      if (view === 'chat') endChatSession();
      else if (view === 'voice') { if (widgetState !== WidgetState.Idle && widgetState !== WidgetState.Ended) endVoiceSession(); setView('home'); }
  };

  useEffect(() => {
    if (!isWidgetMode) return;
    let width = isOpen ? 400 : (showCallout ? 250 : 80);
    let height = isOpen ? 600 : (showCallout ? 220 : 80);
    window.parent.postMessage({ type: 'agent-widget-resize', isOpen, width, height }, '*');
  }, [isOpen, isWidgetMode, showCallout]);
  
  useEffect(() => {
    if (!isOpen && !sessionStorage.getItem('ai-agent-callout-dismissed') && agentProfile.calloutMessage) setShowCallout(true);
    else setShowCallout(false);
  }, [isOpen, agentProfile.calloutMessage]);

  const themeClass = agentProfile.theme === 'dark' ? 'dark' : '';

  return (
    <div className={`${themeClass} ${isWidgetMode ? 'w-full h-full' : 'fixed bottom-0 right-0 md:bottom-24 md:right-6 w-full h-[100dvh] md:w-[400px] md:h-[600px] md:rounded-3xl z-[9999]'}`}>
        {!isOpen ? (
            <div className="relative group flex items-end justify-end h-full p-4">
                {showCallout && agentProfile.calloutMessage && (
                  <div className="absolute bottom-[calc(100%+16px)] right-0 md:right-4 mb-4 w-[220px] px-5 py-3 bg-white dark:bg-gray-800 rounded-2xl shadow-xl animate-fade-in-up border border-gray-100 dark:border-gray-700 z-[10000]">
                    <button onClick={(e) => { e.stopPropagation(); sessionStorage.setItem('ai-agent-callout-dismissed', 'true'); setShowCallout(false); }} className="absolute top-2 right-2 text-gray-400 p-1"><svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path d="M6 18L18 6M6 6l12 12" /></svg></button>
                    <p className="font-bold uppercase tracking-tight pr-4 text-xs">{agentProfile.calloutMessage}</p>
                    <div className="absolute -bottom-2 right-8 w-4 h-4 bg-white dark:bg-gray-800 rotate-45 border-b border-r border-gray-100 dark:border-gray-700"></div>
                  </div>
                )}
                <button onClick={toggleWidget} className={`w-16 h-16 rounded-full bg-accent-${accentColorClass} shadow-2xl flex items-center justify-center text-white transform hover:scale-110 animate-pulse active:scale-95`}><FabIcon /></button>
            </div>
        ) : (
            <div className={`flex flex-col w-full h-full bg-white dark:bg-gray-900 md:rounded-[2rem] overflow-hidden shadow-2xl relative`}>
                {view === 'home' && (
                    <div className="flex flex-col h-full w-full animate-fade-in-up">
                        <button onClick={toggleWidget} className="absolute top-5 right-5 z-50 p-2.5 rounded-full bg-white/10 text-white backdrop-blur-md active:scale-90"><svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path d="M6 18L18 6M6 6l12 12" /></svg></button>
                        <div className={`h-[40%] bg-gradient-to-br from-accent-${accentColorClass} to-gray-900 flex flex-col p-6 text-white`}>
                            <span className="text-xs font-black uppercase opacity-75">{agentProfile.name}</span>
                            <div className="mt-auto mb-6"><h1 className="text-4xl font-black tracking-tighter">Hi 👋</h1><p className="font-bold text-lg mt-2">How can we help today?</p></div>
                        </div>
                        <div className="flex-1 bg-gray-50 dark:bg-gray-900 relative -mt-6 rounded-t-[2rem] px-6 pt-8 flex flex-col gap-4 shadow-2xl">
                            {!isOnline && <OfflineBanner />}
                            <form onSubmit={(e) => { e.preventDefault(); if(chatInput.trim()) initChat(chatInput); }} className="relative"><input type="text" placeholder="Ask a question..." value={chatInput} onChange={e => setChatInput(e.target.value)} className={`w-full pl-6 pr-14 py-4 rounded-2xl bg-white dark:bg-gray-800 shadow-sm border-2 border-transparent focus:border-accent-${accentColorClass} font-semibold`} /><button type="submit" className="absolute right-3 top-1/2 -translate-y-1/2 p-3 text-gray-500"><SendIcon /></button></form>
                            <button onClick={startVoiceSession} className={`w-full bg-gradient-to-r from-accent-${accentColorClass} to-gray-800 rounded-2xl p-1 shadow-xl hover:scale-[1.03] transition-transform`}><div className="bg-white/10 backdrop-blur-md rounded-xl p-5 flex items-center gap-5 text-white"><div className="p-4 bg-white/20 rounded-2xl animate-pulse"><MicrophoneIcon state={WidgetState.Idle} /></div><div><h3 className="font-black text-xl uppercase leading-none text-left">Talk to AI</h3><p className="text-[10px] font-bold opacity-80 mt-1 uppercase tracking-widest text-left">Voice Assistant Ready</p></div></div></button>
                        </div>
                    </div>
                )}
                {view === 'chat' && (
                    <div className="flex flex-col h-full w-full animate-fade-in-up">
                        <div className={`flex items-center justify-between p-5 bg-accent-${accentColorClass} text-white shadow-xl`}><div className="flex items-center gap-4"><button onClick={handleBack}><ChevronLeftIcon /></button><h3 className="font-black text-lg uppercase">{agentProfile.name}</h3></div><button onClick={endChatSession} className="text-[10px] font-black bg-white text-red-500 px-4 py-2 rounded-full uppercase">End</button></div>
                        <div className="flex-grow overflow-y-auto p-4 space-y-4 bg-gray-50 dark:bg-gray-900">
                            {!isOnline && <OfflineBanner />}
                            {messages.map((m, i) => (<div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[85%] rounded-2xl p-4 text-[15px] shadow-sm ${m.role === 'user' ? `bg-accent-${accentColorClass} text-white font-bold` : 'bg-white dark:bg-gray-800 font-semibold'}`}>{m.text}</div></div>))}
                            {isChatTyping && <div className="flex gap-2 p-4 animate-pulse"><div className="w-2 h-2 bg-gray-400 rounded-full"></div><div className="w-2 h-2 bg-gray-400 rounded-full"></div><div className="w-2 h-2 bg-gray-400 rounded-full"></div></div>}
                            <div ref={messagesEndRef} />
                        </div>
                        <form onSubmit={(e) => { e.preventDefault(); handleChatMessage(chatInput); }} className="p-5 border-t bg-white dark:bg-gray-900"><div className="relative"><input value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Type a message..." className={`w-full pl-5 pr-14 py-4 rounded-2xl bg-gray-100 dark:bg-gray-800 focus:border-accent-${accentColorClass} font-semibold`} /><button type="submit" className={`absolute right-2 top-1/2 -translate-y-1/2 p-3 text-white bg-accent-${accentColorClass} rounded-xl shadow-md`}><SendIcon /></button></div></form>
                    </div>
                )}
                {view === 'voice' && (
                    <div className="flex flex-col h-full w-full animate-fade-in-up">
                        <div className={`flex items-center justify-between p-5 bg-accent-${accentColorClass} text-white shadow-xl`}><div className="flex items-center gap-4"><button onClick={handleBack}><ChevronLeftIcon /></button><h3 className="font-black text-lg uppercase">{agentProfile.name}</h3></div><LiveBadge /></div>
                        <div className="flex-grow flex flex-col items-center justify-center relative bg-white dark:bg-gray-900">
                            {!isOnline && <OfflineBanner />}
                            <div className="relative w-full flex items-center justify-center mb-10 min-h-[220px]">
                                {widgetState === WidgetState.Speaking && <><div className={`absolute w-72 h-72 rounded-full border-4 border-accent-${accentColorClass} opacity-20 animate-sonar-ping`}></div><div className={`absolute w-72 h-72 rounded-full border-4 border-accent-${accentColorClass} opacity-20 animate-sonar-ping [animation-delay:1s]`}></div></>}
                                <div className={`relative w-56 h-56 rounded-full bg-gradient-to-br from-accent-${accentColorClass} to-gray-800 shadow-2xl flex items-center justify-center transition-transform duration-700 ${widgetState === WidgetState.Speaking ? 'scale-110' : ''}`}>
                                    <div className={`w-52 h-52 rounded-full flex items-center justify-center shadow-inner z-10 overflow-hidden bg-white dark:bg-gray-900 ${widgetState === WidgetState.Ended ? `!bg-accent-${accentColorClass}` : ''}`}>
                                        {widgetState === WidgetState.Connecting && <Spinner className={`w-24 h-24 text-accent-${accentColorClass}`} />}
                                        {(widgetState === WidgetState.Listening || widgetState === WidgetState.Speaking || widgetState === WidgetState.Idle) && <div className={widgetState === WidgetState.Speaking ? 'scale-125' : ''}><WaveformIcon className={`h-28 w-28 ${widgetState === WidgetState.Idle ? 'text-gray-200' : `text-accent-${accentColorClass}`}`} /></div>}
                                        {widgetState === WidgetState.Error && <div className="text-red-500 scale-150 animate-pulse">⚠️</div>}
                                        {widgetState === WidgetState.Ended && <div className="text-white scale-125 animate-fade-in"><svg className="h-20 w-20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path d="M18.36 6.64a9 9 0 11-12.73 0M12 2v10" strokeLinecap="round" strokeLinejoin="round" /></svg></div>}
                                        {isOnline && isNetworkSlow && (widgetState === WidgetState.Speaking || widgetState === WidgetState.Listening) && <NetworkWarning />}
                                    </div>
                                </div>
                            </div>
                            <h2 className={`text-xl font-black uppercase tracking-tight ${widgetState === WidgetState.Error ? 'text-red-600' : 'text-gray-900 dark:text-white'}`}>{widgetState === WidgetState.Connecting ? "Connecting..." : widgetState === WidgetState.Listening ? "Listening..." : widgetState === WidgetState.Speaking ? "Speaking..." : widgetState === WidgetState.Error ? (errorMessage || "ERROR") : "Session Ended"}</h2>
                            <div className="mt-8 flex items-center justify-center h-24">
                                {(widgetState === WidgetState.Connecting || widgetState === WidgetState.Listening || widgetState === WidgetState.Speaking) ? (
                                    <button onClick={endVoiceSession} className="w-16 h-16 rounded-full bg-red-500 text-white flex items-center justify-center shadow-2xl transform hover:scale-110 active:scale-90 transition-all"><svg className="h-8 w-8 rotate-135" viewBox="0 0 20 20" fill="currentColor"><path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" /></svg></button>
                                ) : (
                                    !(widgetState === WidgetState.Ended) && <button onClick={startVoiceSession} className={`w-16 h-16 rounded-full bg-accent-${accentColorClass} text-white flex items-center justify-center shadow-2xl hover:scale-110 active:scale-95 transition-all`}><svg className="h-8 w-8" viewBox="0 0 20 20" fill="currentColor"><path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" /></svg></button>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        )}
    </div>
  );
};
