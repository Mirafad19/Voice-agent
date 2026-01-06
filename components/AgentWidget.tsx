
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
    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/video/upload`, { method: 'POST', body: formData });
    if (!response.ok) throw new Error(`Cloudinary failed`);
    const result = await response.json();
    return result.secure_url;
}

const WaveformIcon = ({className = "h-9 w-9 text-white"}) => (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} xmlns="http://www.w3.org/2000/svg">
        <rect x="4" y="10" width="2" height="4" rx="1" fillOpacity="0.5" /><rect x="8" y="6" width="2" height="12" rx="1" fillOpacity="0.8" /><rect x="12" y="3" width="2" height="18" rx="1" /><rect x="16" y="6" width="2" height="12" rx="1" fillOpacity="0.8" /><rect x="20" y="10" width="2" height="4" rx="1" fillOpacity="0.5" />
    </svg>
);

const FabIcon = ({className = "h-9 w-9 text-white"}) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M4 13.5V12a8 8 0 1116 0v1.5" /><path d="M4 12a2 2 0 00-2 2v3a2 2 0 002 2h1" /><path d="M20 12a2 2 0 012 2v3a2 2 0 01-2 2h-1" /><path d="M9 12h.01" /><path d="M15 12h.01" /><path d="M9.5 16a3.5 3.5 0 005 0" /><path d="M5 14v1a2 2 0 002 2h2" /></svg>
);

const MicrophoneIcon = ({state}: {state: WidgetState}) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={`h-8 w-8 text-white transition-all`} viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M9 2m0 3a3 3 0 0 1 3 -3h0a3 3 0 0 1 3 3v5a3 3 0 0 1 -3 3h0a3 3 0 0 1 -3 -3z" /><path d="M5 10a7 7 0 0 0 14 0" /><path d="M8 21l8 0" /><path d="M12 17l0 4" /></svg>
);

const SendIcon = ({className = "h-5 w-5"}) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 20 20" fill="currentColor"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" /></svg>
);

const ChevronLeftIcon = ({className = "h-6 w-6 text-white"}) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" /></svg>
);

const LiveBadge = () => (
    <div className="flex items-center gap-2 px-3 py-1 bg-white/20 backdrop-blur-sm rounded-full border border-white/30 shadow-sm"><span className="relative flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white"></span></span><span className="text-[10px] font-black text-white uppercase tracking-widest">Live</span></div>
);

const NetworkWarning = () => (
  <div className="absolute inset-0 z-[100] flex items-center justify-center pointer-events-none p-4 animate-fade-in">
    <div className="bg-amber-600 text-white text-[12px] font-black uppercase tracking-tight px-4 py-3 rounded-2xl shadow-[0_15px_40px_rgba(0,0,0,0.7)] flex flex-col items-center gap-2 border-2 border-amber-300 backdrop-blur-xl animate-pulse text-center leading-none ring-4 ring-amber-600/30">
      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
      <span className="whitespace-nowrap tracking-[0.1em]">Network Not Stable</span>
    </div>
  </div>
);

const OfflineBanner = () => (
    <div className="bg-red-600 text-white text-[11px] font-black uppercase tracking-[0.2em] py-2 px-4 text-center animate-fade-in flex items-center justify-center gap-3 z-[100] w-full shadow-lg border-b border-red-400"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.828-2.828m-4.243 4.243a5 5 0 010-7.072m0 0L5.636 5.636M4.243 18.364a9 9 0 010-12.728" /></svg>Reconnecting... Check Internet</div>
);

export const AgentWidget: React.FC<AgentWidgetProps> = ({ agentProfile, apiKey, isWidgetMode, onSessionEnd }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<ViewState>('home');
  const [showCallout, setShowCallout] = useState(false);
  const [permissionRequested, setPermissionRequested] = useState(false);
  const [widgetState, _setWidgetState] = useState<WidgetState>(WidgetState.Idle);
  const widgetStateRef = useRef(widgetState);
  const setWidgetState = (state: WidgetState) => { widgetStateRef.current = state; _setWidgetState(state); };
  const [voiceReportingStatus, setVoiceReportingStatus] = useState<ReportingStatus>('idle');
  const fullTranscriptRef = useRef('');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isNetworkSlow, setIsNetworkSlow] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatTyping, setIsChatTyping] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const hO = () => setIsOnline(true);
    const hOff = () => setIsOnline(false);
    window.addEventListener('online', hO);
    window.addEventListener('offline', hOff);
    return () => { window.removeEventListener('online', hO); window.removeEventListener('offline', hOff); };
  }, []);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isChatTyping]);

  const analyzeAndSendReport = useCallback(async (recording: Omit<Recording, 'id' | 'url'>) => {
    const { emailConfig, fileUploadConfig } = agentProfile as AgentConfig;
    if (!(recording.transcript?.includes('User:')) || !emailConfig?.formspreeEndpoint) return;
    if (view === 'voice') setVoiceReportingStatus('analyzing');
    try {
        let audioLink = 'N/A';
        if (recording.blob && fileUploadConfig?.cloudinaryCloudName) {
            audioLink = await getCloudinaryShareableLink(fileUploadConfig.cloudinaryCloudName, fileUploadConfig.cloudinaryUploadPreset, recording).catch(() => 'Upload Failed');
        }
        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: { parts: [{ text: `Analyze session: ${recording.transcript}` }] },
            config: { responseMimeType: "application/json", responseSchema: { type: Type.OBJECT, properties: { summary: { type: Type.STRING }, sentiment: { type: Type.STRING }, actionItems: { type: Type.ARRAY, items: { type: Type.STRING } } } } }
        });
        const analysis = JSON.parse(response.text || '{}');
        await fetch(emailConfig.formspreeEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agent: agentProfile.name, ...analysis, audioLink, transcript: recording.transcript })
        });
        if (view === 'voice') setVoiceReportingStatus('sent');
    } catch (e) { if (view === 'voice') setVoiceReportingStatus('failed'); }
  }, [agentProfile, apiKey, view]);

  const initChat = async (msg?: string) => {
    const ai = new GoogleGenAI({ apiKey });
    chatSessionRef.current = ai.chats.create({ model: 'gemini-3-flash-preview', config: { systemInstruction: (agentProfile as AgentConfig).knowledgeBase } });
    setMessages([{ role: 'model', text: (agentProfile as AgentConfig).initialGreetingText || "Hello!", timestamp: new Date() }]);
    setView('chat');
    if (msg) handleChatMessage(msg);
  };

  const handleChatMessage = async (text: string) => {
    if (!text.trim() || !chatSessionRef.current || !isOnline) return;
    setMessages(prev => [...prev, { role: 'user', text, timestamp: new Date() }]);
    setChatInput('');
    setIsChatTyping(true);
    try {
        const result = await chatSessionRef.current.sendMessageStream({ message: text });
        setMessages(prev => [...prev, { role: 'model', text: "", timestamp: new Date() }]);
        let full = "";
        for await (const chunk of result) {
            full += chunk.text;
            setMessages(prev => { const upd = [...prev]; upd[upd.length - 1].text = full; return upd; });
        }
    } catch (e) { setMessages(prev => [...prev, { role: 'model', text: "Connection error.", timestamp: new Date() }]); }
    finally { setIsChatTyping(false); }
  };

  const resetSilenceTimer = useCallback(() => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = window.setTimeout(() => geminiServiceRef.current?.sendText("[[SILENCE_DETECTED]]"), 8000);
  }, []);

  const clearSilenceTimer = useCallback(() => { if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; } }, []);

  const handleInterruption = useCallback(() => {
    if (isGreetingProtectedRef.current) return;
    activeAudioSourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    activeAudioSourcesRef.current.clear();
    audioQueueRef.current = [];
    nextStartTimeRef.current = 0;
    if (widgetStateRef.current === WidgetState.Speaking) { setWidgetState(WidgetState.Listening); resetSilenceTimer(); }
  }, [resetSilenceTimer]);

  const startVoiceSession = useCallback(async () => {
    if (!isOnline) return;
    setView('voice');
    setWidgetState(WidgetState.Connecting);
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
      return;
    } finally { setPermissionRequested(false); }
    
    outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ latencyHint: 'playback' });
    masterGainNodeRef.current = outputAudioContextRef.current.createGain();
    masterGainNodeRef.current.gain.value = 2.0; 
    masterGainNodeRef.current.connect(outputAudioContextRef.current.destination);

    if (outputAudioContextRef.current.state === 'suspended') {
        await outputAudioContextRef.current.resume();
    }
    
    recordingServiceRef.current = new RecordingService(handleVoiceSessionEnd);
    await recordingServiceRef.current.start(stream);

    const greeting = (agentProfile as AgentConfig).initialGreeting;
    if (greeting) {
        isGreetingProtectedRef.current = true;
        fullTranscriptRef.current = `Agent: ${greeting}\n`;
        try {
            const ai = new GoogleGenAI({ apiKey });
            const resp = await ai.models.generateContent({ model: "gemini-2.5-flash-preview-tts", contents: [{ parts: [{ text: greeting }] }], config: { responseModalities: [Modality.AUDIO], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: (agentProfile as AgentConfig).voice } } } } });
            const base64 = resp.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (base64) {
                const bin = atob(base64);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                audioQueueRef.current.push(bytes);
                recordingServiceRef.current?.addAgentAudioChunk(bytes);
                playAudioQueue(true); 
            }
        } catch (e) { isGreetingProtectedRef.current = false; }
    }

    geminiServiceRef.current = new GeminiLiveService(apiKey, agentProfile as AgentConfig, {
      onStateChange: (state) => {
        if (state === 'connected') { if (widgetStateRef.current !== WidgetState.Speaking) { setWidgetState(WidgetState.Listening); resetSilenceTimer(); } }
        if (state === 'ended') { 
            if (widgetStateRef.current === WidgetState.Connecting) { setWidgetState(WidgetState.Error); setErrorMessage("NETWORK ERROR: CONNECTION FAILED."); }
            else setWidgetState(WidgetState.Ended);
            cleanupServices(); 
        }
      },
      onTranscriptUpdate: (isFinal, text, type) => {
         if (isFinal) fullTranscriptRef.current += `${type === 'input' ? 'User' : 'Agent'}: ${text}\n`;
         if (type === 'input' && text.trim()) resetSilenceTimer();
         if (isFinal && type === 'output') {
             const lower = text.toLowerCase();
             if (['goodbye', 'bye', 'farewell', 'take care'].some(k => lower.includes(k))) {
                 shouldEndAfterSpeakingRef.current = true;
                 if (activeAudioSourcesRef.current.size === 0 && audioQueueRef.current.length === 0) cleanupServices();
             }
         }
      },
      onAudioChunk: (chunk) => { 
        setIsNetworkSlow(false); // Reset lag warning when audio arrives
        audioQueueRef.current.push(chunk); 
        recordingServiceRef.current?.addAgentAudioChunk(chunk); 
        playAudioQueue(false); 
      },
      onInterruption: handleInterruption,
      onLocalInterruption: handleInterruption,
      onLatencyWarning: (isSlow) => setIsNetworkSlow(isSlow),
      onError: (err) => { setWidgetState(WidgetState.Error); setErrorMessage("NETWORK ERROR."); cleanupServices(); },
    });
    geminiServiceRef.current.connect(stream);
  }, [apiKey, agentProfile, isOnline, handleInterruption, resetSilenceTimer]);

  const cleanupServices = useCallback(() => {
    isGreetingProtectedRef.current = false;
    clearSilenceTimer();
    geminiServiceRef.current?.disconnect(); geminiServiceRef.current = null;
    recordingServiceRef.current?.stop(); recordingServiceRef.current = null;
    mediaStreamRef.current?.getTracks().forEach(t => t.stop()); mediaStreamRef.current = null;
    activeAudioSourcesRef.current.forEach(s => s.stop()); activeAudioSourcesRef.current.clear();
    outputAudioContextRef.current?.close().catch(() => {}); outputAudioContextRef.current = null;
    masterGainNodeRef.current = null;
    audioQueueRef.current = []; nextStartTimeRef.current = 0;
  }, [clearSilenceTimer]);

  const playAudioQueue = useCallback((isGreeting: boolean) => {
    clearSilenceTimer();
    if (audioQueueRef.current.length === 0 || !outputAudioContextRef.current || !masterGainNodeRef.current) return;
    if (widgetStateRef.current !== WidgetState.Speaking) setWidgetState(WidgetState.Speaking);
    const ctx = outputAudioContextRef.current;
    if (nextStartTimeRef.current < ctx.currentTime) nextStartTimeRef.current = ctx.currentTime + 0.05;
    while (audioQueueRef.current.length > 0) {
        const chunk = audioQueueRef.current.shift(); if (!chunk) continue;
        const buf = decodePcmChunk(chunk, ctx);
        const src = ctx.createBufferSource();
        src.buffer = buf; 
        src.connect(masterGainNodeRef.current); 
        src.start(nextStartTimeRef.current);
        nextStartTimeRef.current += buf.duration;
        activeAudioSourcesRef.current.add(src);
        src.onended = () => {
            activeAudioSourcesRef.current.delete(src);
            if (isGreeting) isGreetingProtectedRef.current = false;
            if (activeAudioSourcesRef.current.size === 0 && audioQueueRef.current.length === 0) {
                if (shouldEndAfterSpeakingRef.current) cleanupServices();
                else { setWidgetState(WidgetState.Listening); resetSilenceTimer(); }
            }
        };
    }
  }, [clearSilenceTimer, resetSilenceTimer, cleanupServices]);

  const handleVoiceSessionEnd = useCallback((blob: Blob, mime: string) => {
    const rec = { name: `Call ${new Date().toLocaleString()}`, blob, mimeType: mime, transcript: fullTranscriptRef.current };
    if (isWidgetMode) analyzeAndSendReport(rec);
    else onSessionEnd?.({ ...rec, id: `v-${Date.now()}`, url: URL.createObjectURL(blob) });
  }, [onSessionEnd, isWidgetMode, analyzeAndSendReport]);

  const toggle = () => {
    if (isOpen) {
        if (view === 'chat') setMessages([]);
        else if (view === 'voice') cleanupServices();
        setTimeout(() => setView('home'), 300);
    } else setShowCallout(false);
    setIsOpen(!isOpen);
  };

  useEffect(() => {
    if (!isWidgetMode) return;
    const w = isOpen ? 400 : (showCallout ? 250 : 80);
    const h = isOpen ? 600 : (showCallout ? 220 : 80);
    window.parent.postMessage({ type: 'agent-widget-resize', isOpen, width: w, height: h }, '*');
  }, [isOpen, isWidgetMode, showCallout]);

  useEffect(() => { if (!isOpen && agentProfile.calloutMessage && !sessionStorage.getItem('dismissed')) setShowCallout(true); }, [isOpen, agentProfile.calloutMessage]);

  const accent = agentProfile.accentColor;

  return (
    <div className={`${agentProfile.theme === 'dark' ? 'dark' : ''} ${isWidgetMode ? 'w-full h-full' : 'fixed bottom-0 right-0 md:bottom-24 md:right-6 w-full h-[100dvh] md:w-[400px] md:h-[600px] md:rounded-3xl z-[9999]'}`}>
        {!isOpen ? (
            <div className="flex flex-col items-end gap-4 p-4 h-full justify-end">
                {showCallout && (
                    <div className="bg-white dark:bg-gray-800 p-4 rounded-2xl shadow-xl animate-fade-in-up border border-gray-100 dark:border-gray-700 w-56 relative text-left">
                        <button onClick={() => { setShowCallout(false); sessionStorage.setItem('dismissed', 't'); }} className="absolute top-2 right-2 p-1 text-gray-400"><svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M6 18L18 6M6 6l12 12" /></svg></button>
                        <p className="font-bold uppercase tracking-tight text-[10px] pr-4">{agentProfile.calloutMessage}</p>
                        <div className="absolute -bottom-2 right-8 w-4 h-4 bg-white dark:bg-gray-800 rotate-45 border-b border-r border-gray-100 dark:border-gray-700"></div>
                    </div>
                )}
                <button onClick={toggle} className={`w-16 h-16 rounded-full bg-accent-${accent} shadow-2xl flex items-center justify-center text-white animate-pulse transform hover:scale-110 active:scale-95 transition-all`}><FabIcon /></button>
            </div>
        ) : (
            <div className={`w-full h-full md:w-[400px] md:h-[600px] bg-white dark:bg-gray-900 md:rounded-[2rem] overflow-hidden flex flex-col shadow-2xl animate-fade-in-up relative`}>
                {view === 'home' && (
                    <>
                        <button onClick={toggle} className="absolute top-5 right-5 z-50 p-2.5 rounded-full bg-white/10 text-white"><svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M6 18L18 6M6 6l12 12" /></svg></button>
                        <div className={`h-2/5 bg-gradient-to-br from-accent-${accent} to-gray-900 p-8 flex flex-col justify-end text-white`}><span className="text-[10px] font-black uppercase opacity-60 mb-2">{agentProfile.name}</span><h1 className="text-4xl font-black tracking-tighter">Hi 👋</h1><p className="font-bold opacity-80 mt-1">Ready to assist you today.</p></div>
                        <div className="flex-1 bg-gray-50 dark:bg-gray-900 rounded-t-[2rem] -mt-6 p-6 flex flex-col gap-4 shadow-2xl">
                            {!isOnline && <OfflineBanner />}
                            <form onSubmit={(e) => { e.preventDefault(); if(chatInput.trim()) initChat(chatInput); }} className="relative"><input type="text" placeholder="Type a message..." value={chatInput} onChange={e => setChatInput(e.target.value)} className="w-full p-5 rounded-2xl bg-white dark:bg-gray-800 shadow-sm font-bold focus:ring-2 focus:ring-accent-${accent}" /><button type="submit" className="absolute right-3 top-1/2 -translate-y-1/2 p-3 text-gray-400"><SendIcon /></button></form>
                            <button onClick={startVoiceSession} className={`w-full bg-gradient-to-br from-accent-${accent} to-gray-800 p-1 rounded-2xl shadow-xl hover:scale-[1.02] transition-transform`}><div className="bg-white/10 p-5 rounded-xl flex items-center gap-5 text-white"><div className="p-4 bg-white/20 rounded-2xl animate-pulse"><MicrophoneIcon state={WidgetState.Idle} /></div><div><h3 className="font-black text-xl leading-none">Voice AI</h3><p className="text-[10px] font-bold opacity-70 mt-1 uppercase tracking-widest">Instant Connection</p></div></div></button>
                        </div>
                    </>
                )}
                {view === 'chat' && (
                    <>
                        <div className={`p-5 bg-accent-${accent} text-white flex justify-between items-center shadow-lg`}><div className="flex items-center gap-4"><button onClick={() => setView('home')}><ChevronLeftIcon /></button><h3 className="font-black text-lg uppercase">{agentProfile.name}</h3></div><button onClick={() => setView('home')} className="bg-white text-red-500 text-[9px] font-black px-4 py-2 rounded-full uppercase">End</button></div>
                        <div className="flex-1 overflow-y-auto p-4 bg-gray-50 dark:bg-gray-900 space-y-4">
                            {!isOnline && <OfflineBanner />}
                            {messages.map((m, i) => (<div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}><div className={`p-4 rounded-2xl text-sm max-w-[80%] ${m.role === 'user' ? `bg-accent-${accent} text-white` : 'bg-white dark:bg-gray-800 font-bold shadow-sm'}`}>{m.text}</div></div>))}
                            {isChatTyping && <div className="flex gap-1 p-4"><div className="w-1 h-1 bg-gray-400 rounded-full animate-bounce"></div><div className="w-1 h-1 bg-gray-400 rounded-full animate-bounce [animation-delay:0.2s]"></div><div className="w-1 h-1 bg-gray-400 rounded-full animate-bounce [animation-delay:0.4s]"></div></div>}
                            <div ref={messagesEndRef} />
                        </div>
                        <form onSubmit={(e) => { e.preventDefault(); handleChatMessage(chatInput); }} className="p-4 bg-white dark:bg-gray-900 border-t"><div className="relative"><input value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Reply..." className="w-full p-4 rounded-2xl bg-gray-100 dark:bg-gray-800 font-bold focus:ring-2 focus:ring-accent-${accent}" /><button type="submit" className={`absolute right-2 top-1/2 -translate-y-1/2 p-3 rounded-xl bg-accent-${accent} text-white shadow-md`}><SendIcon /></button></div></form>
                    </>
                )}
                {view === 'voice' && (
                    <>
                        <div className={`p-5 bg-accent-${accent} text-white flex justify-between items-center shadow-lg`}><div className="flex items-center gap-4"><button onClick={() => { cleanupServices(); setView('home'); }}><ChevronLeftIcon /></button><h3 className="font-black text-lg uppercase">{agentProfile.name}</h3></div><LiveBadge /></div>
                        <div className="flex-1 flex flex-col items-center justify-center bg-white dark:bg-gray-900 relative">
                            {!isOnline && <OfflineBanner />}
                            <div className="relative w-64 h-64 flex items-center justify-center">
                                {widgetState === WidgetState.Speaking && <div className={`absolute inset-0 rounded-full border-4 border-accent-${accent} opacity-20 animate-sonar-ping`}></div>}
                                <div className={`relative w-52 h-52 rounded-full bg-gradient-to-br from-accent-${accent} to-gray-800 flex items-center justify-center shadow-2xl transition-transform duration-500 ${widgetState === WidgetState.Speaking ? 'scale-110' : ''}`}>
                                    <div className={`w-48 h-48 rounded-full bg-white dark:bg-gray-900 flex items-center justify-center shadow-inner relative overflow-hidden ${widgetState === WidgetState.Ended ? `!bg-accent-${accent}` : ''}`}>
                                        {widgetState === WidgetState.Connecting && <Spinner className={`w-16 h-16 text-accent-${accent}`} />}
                                        {(widgetState === WidgetState.Listening || widgetState === WidgetState.Speaking || widgetState === WidgetState.Idle) && <div className={widgetState === WidgetState.Speaking ? 'scale-125' : ''}><WaveformIcon className={`h-24 w-24 ${widgetState === WidgetState.Idle ? 'text-gray-200' : `text-accent-${accent}`}`} /></div>}
                                        {widgetState === WidgetState.Error && <div className="text-red-500 scale-150 animate-pulse">⚠️</div>}
                                        {widgetState === WidgetState.Ended && <div className="text-white scale-150">✔️</div>}
                                        {isNetworkSlow && (widgetState === WidgetState.Listening || widgetState === WidgetState.Speaking) && <NetworkWarning />}
                                    </div>
                                </div>
                            </div>
                            <h2 className={`mt-8 text-2xl font-black uppercase tracking-tighter ${widgetState === WidgetState.Error ? 'text-red-600' : 'text-gray-900 dark:text-white'}`}>{widgetState === WidgetState.Connecting ? 'Connecting...' : widgetState === WidgetState.Listening ? 'Listening...' : widgetState === WidgetState.Speaking ? 'Speaking...' : widgetState === WidgetState.Error ? (errorMessage || 'Error') : 'Ended'}</h2>
                            <div className="mt-10"><button onClick={() => { cleanupServices(); setWidgetState(WidgetState.Ended); }} className="w-16 h-16 rounded-full bg-red-500 text-white shadow-2xl hover:scale-110 active:scale-95 transition-transform flex items-center justify-center"><svg className="h-8 w-8 rotate-135" viewBox="0 0 20 20" fill="currentColor"><path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" /></svg></button></div>
                        </div>
                    </>
                )}
            </div>
        )}
    </div>
  );
};
