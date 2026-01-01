
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
  <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[80] animate-bounce">
    <div className="bg-amber-500 text-white text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-full shadow-2xl flex items-center gap-2 border-2 border-amber-300/50 backdrop-blur-md">
      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      Unstable Connection
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
  const activeAudioSourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const nextStartTimeRef = useRef(0);
  const shouldEndAfterSpeakingRef = useRef(false);
  const chatSessionRef = useRef<Chat | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  
  const isGreetingProtectedRef = useRef(false);

  const accentColorClass = agentProfile.accentColor;

  // Monitor network quality for the "unstable" indicator
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const conn = (navigator as any).connection;
    if (conn) {
      const checkNetwork = () => {
        // threshold: 2g/3g OR high latency OR very low speed
        const isSlow = conn.effectiveType === '2g' || 
                       conn.effectiveType === '3g' || 
                       conn.rtt > 800 || 
                       conn.downlink < 1.0;
        setIsNetworkSlow(isSlow);
      };
      conn.addEventListener('change', checkNetwork);
      checkNetwork();
      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
        conn.removeEventListener('change', checkNetwork);
      };
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
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

    if (!hasUserInteracted) {
        if (view === 'voice') setVoiceReportingStatus('idle');
        return; 
    }

    if (!emailConfig?.formspreeEndpoint) {
        return;
    }

    if (view === 'voice') setVoiceReportingStatus('analyzing');

    try {
        let audioLink = 'N/A';
        if (recording.blob && recording.blob.size === 0 && fileUploadConfig?.cloudinaryCloudName && fileUploadConfig.cloudinaryUploadPreset) {
            try {
                audioLink = await getCloudinaryShareableLink(fileUploadConfig.cloudinaryCloudName, fileUploadConfig.cloudinaryUploadPreset, recording);
            } catch (uploadError) {
                console.error("Audio upload failed:", uploadError);
                audioLink = 'Upload Failed';
            }
        } else if (!recording.blob) {
            audioLink = 'Text Chat Session';
        }

        const ai = new GoogleGenAI({ apiKey });
        
        let contents;
        if (recording.transcript) {
            contents = { parts: [
                { text: `Analyze this session transcript. Provide a concise summary, sentiment ('Positive', 'Neutral', 'Negative'), and action items. Return JSON.` },
                { text: `TRANSCRIPT:\n${recording.transcript}` }
            ] };
        } else if (recording.blob) {
            const audioBase64 = await blobToBase64(recording.blob);
            contents = { parts: [
                { text: `Analyze this call audio. Provide a concise summary, sentiment ('Positive', 'Neutral', 'Negative'), and action items. Return JSON.` },
                { inlineData: { mimeType: recording.mimeType, data: audioBase64 } },
            ] };
        } else {
             contents = { parts: [{ text: "This was a short session with no content. Return neutral sentiment." }] };
        }

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
            if (response.text) {
                analysis = JSON.parse(response.text);
            }
        } catch (geminiError) {
             console.error("Analysis failed, sending raw report:", geminiError);
        }

        const reportData = {
          _subject: `Session Insight Report: ${recording.name}`,
          agent: agentProfile.name,
          sentiment: analysis.sentiment || 'N/A',
          summary: analysis.summary || 'No summary available.',
          actionItems: (analysis.actionItems && analysis.actionItems.length > 0) ? analysis.actionItems.map((item:string) => `- ${item}`).join('\n') : 'None',
          transcript: recording.transcript || 'No transcript available',
          audioLink: audioLink,
        };

        if (view === 'voice') setVoiceReportingStatus('sending');

        await fetch(emailConfig.formspreeEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(reportData)
        });

        if (view === 'voice') setVoiceReportingStatus('sent');
        
    } catch (error) {
        console.error("Failed to process report:", error);
        if (view === 'voice') setVoiceReportingStatus('failed');
    }
  }, [agentProfile, apiKey, view]);


  const initChat = async (initialMessage?: string) => {
    const config = agentProfile as AgentConfig;
    const ai = new GoogleGenAI({ apiKey });
    
    const systemInstruction = config.chatKnowledgeBase || config.knowledgeBase;
    
    chatSessionRef.current = ai.chats.create({
        model: 'gemini-3-flash-preview',
        config: { systemInstruction }
    });

    const welcomeText = config.initialGreetingText || config.initialGreeting || "Hello! How can I help you?";
    
    // Ensure we reset properly when starting from Home view
    const welcomeMsg: Message = { role: 'model', text: welcomeText, timestamp: new Date() };
    setMessages([welcomeMsg]);
    setView('chat');

    if (initialMessage) {
        // Pass the already initialized chat state
        await handleChatMessage(initialMessage, true);
    }
  };

  const handleChatMessage = async (text: string, isFirstMessage: boolean = false) => {
    if (!text.trim() || !chatSessionRef.current || !isOnline) return;

    const userMsg: Message = { role: 'user', text, timestamp: new Date() };
    
    // If it's the first message, we already have the welcome message in state from initChat
    // otherwise we append to existing history
    setMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setIsChatTyping(true);

    try {
        const result = await chatSessionRef.current.sendMessageStream({ message: text });
        
        let fullResponse = "";
        // Placeholder for model response
        setMessages(prev => [...prev, { role: 'model', text: "", timestamp: new Date() }]);

        for await (const chunk of result) {
            const chunkText = chunk.text;
            fullResponse += chunkText;
            
            setMessages(prev => {
                const updatedHistory = [...prev];
                const lastIndex = updatedHistory.length - 1;
                if (lastIndex >= 0 && updatedHistory[lastIndex].role === 'model') {
                    // Update the last placeholder message with growing text
                    updatedHistory[lastIndex] = { ...updatedHistory[lastIndex], text: fullResponse };
                }
                return updatedHistory;
            });
        }
    } catch (e) {
        console.error("Chat error:", e);
        setMessages(prev => [...prev, { role: 'model', text: "I'm having trouble connecting right now. Please try again.", timestamp: new Date() }]);
    } finally {
        setIsChatTyping(false);
    }
  };

  const endChatSession = useCallback(() => {
    if (messages.length <= 1) {
        setView('home');
        setMessages([]);
        return;
    }

    const transcript = messages.map(m => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.text}`).join('\n\n');
    const now = new Date();
    const dateString = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const newRecording: Omit<Recording, 'id' | 'url'> = {
        name: `Chat Session - ${dateString}, ${timeString}`,
        blob: new Blob([], { type: 'text/plain' }),
        mimeType: 'text/plain',
        transcript: transcript
    };

    analyzeAndSendReport(newRecording);
    
    setMessages([]);
    chatSessionRef.current = null;
    setView('home');
    
    if (isWidgetMode) {
       if (onSessionEnd) {
           onSessionEnd({
               ...newRecording,
               id: `chat-${now.getTime()}`,
               url: '',
           });
       }
    }
  }, [messages, analyzeAndSendReport, isWidgetMode, onSessionEnd]);

  
  const resetSilenceTimer = useCallback(() => {
      if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
      }
      silenceTimerRef.current = window.setTimeout(() => {
          geminiServiceRef.current?.sendText("[[SILENCE_DETECTED]]");
      }, 8000);
  }, []);

  const clearSilenceTimer = useCallback(() => {
      if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
      }
  }, []);

  const handleInterruption = useCallback(() => {
    if (isGreetingProtectedRef.current) {
        console.debug("Interruption ignored: Agent is delivering forced greeting.");
        return;
    }

    activeAudioSourcesRef.current.forEach(source => {
        try { source.stop(); } catch(e) {}
    });
    activeAudioSourcesRef.current.clear();
    audioQueueRef.current = [];
    nextStartTimeRef.current = 0;
    
    if (widgetStateRef.current === WidgetState.Speaking) {
        setWidgetState(WidgetState.Listening);
        resetSilenceTimer();
    }
  }, [resetSilenceTimer]);

  const startVoiceSession = useCallback(async () => {
    if (!isOnline) return;
    setView('voice');
    shouldEndAfterSpeakingRef.current = false;
    setWidgetState(WidgetState.Connecting);
    setVoiceReportingStatus('idle');
    setErrorMessage('');
    fullTranscriptRef.current = '';
    
    setPermissionRequested(true);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 16000,
            channelCount: 1
        } 
      });
      mediaStreamRef.current = stream;
    } catch (e) {
      setWidgetState(WidgetState.Error);
      setErrorMessage("Failed to get microphone access. Please ensure permission is granted.");
      cleanupServices();
      return;
    } finally {
        setPermissionRequested(false);
    }
    
    const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
    outputAudioContextRef.current = new AudioContextClass();
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
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash-preview-tts",
                contents: [{ parts: [{ text: greeting }] }],
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: (agentProfile as AgentConfig).voice },
                        },
                    },
                },
            });
            const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
                const binaryString = atob(base64Audio);
                const len = binaryString.length;
                const bytes = new Uint8Array(len);
                for (let i = 0; i < len; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                audioQueueRef.current.push(bytes);
                recordingServiceRef.current?.addAgentAudioChunk(bytes);
                playAudioQueue(true); 
            }
        } catch (error) {
            console.error("Failed to generate greeting audio:", error);
            isGreetingProtectedRef.current = false;
        }
    }

    geminiServiceRef.current = new GeminiLiveService(apiKey, agentProfile as AgentConfig, {
      onStateChange: (state) => {
        if (state === 'connected') {
            if (widgetStateRef.current !== WidgetState.Speaking) {
                setWidgetState(WidgetState.Listening);
                resetSilenceTimer();
            }
        }
        if (state === 'ended') {
            setWidgetState(WidgetState.Ended);
            cleanupServices();
        }
      },
      onTranscriptUpdate: (isFinal, text, type) => {
         if (isFinal) {
             const speaker = type === 'input' ? 'User' : 'Agent';
             fullTranscriptRef.current += `${speaker}: ${text}\n`;
         }
         
         if (type === 'input' && text.trim().length > 0) {
             resetSilenceTimer();
         }
         
        if (isFinal && type === 'output') {
          const lowerCaseText = text.toLowerCase();
          const endKeywords = [
            'goodbye', 'farewell', 'take care', 'talk to you later', 
            'bye bye', 'bye', 'o dabo', 'oda bo', 'ese pupo'
          ];
          if (endKeywords.some(keyword => lowerCaseText.includes(keyword))) {
            shouldEndAfterSpeakingRef.current = true;
            if (activeAudioSourcesRef.current.size === 0 && audioQueueRef.current.length === 0) {
                endVoiceSession();
            }
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
      onError: (error) => {
        if (!navigator.onLine) {
            setIsOnline(false);
        } else {
            setErrorMessage(error);
        }
        setWidgetState(WidgetState.Error);
        cleanupServices();
      },
    });
    geminiServiceRef.current.connect(stream);
  }, [apiKey, agentProfile, resetSilenceTimer, handleInterruption, isOnline]);

  const endVoiceSession = useCallback(() => {
    cleanupServices();
    setWidgetState(WidgetState.Ended);
  }, []);

  const handleVoiceSessionEnd = useCallback((blob: Blob, mimeType: string) => {
    if (blob.size === 0) return;
    const now = new Date();
    const dateString = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const newRecording: Omit<Recording, 'id' | 'url'> = {
        name: `Voice Call - ${dateString}, ${timeString}`,
        blob,
        mimeType,
        transcript: fullTranscriptRef.current
    };
    
    if (isWidgetMode) {
      analyzeAndSendReport(newRecording);
    } else if(onSessionEnd) {
        onSessionEnd({
            ...newRecording,
            id: `rec-${now.getTime()}`,
            url: URL.createObjectURL(blob),
        });
    }
  }, [onSessionEnd, isWidgetMode, analyzeAndSendReport]);

  const cleanupServices = useCallback(() => {
    isGreetingProtectedRef.current = false;
    clearSilenceTimer();
    geminiServiceRef.current?.disconnect();
    geminiServiceRef.current = null;
    recordingServiceRef.current?.stop();
    recordingServiceRef.current = null;
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    mediaStreamRef.current = null;
    activeAudioSourcesRef.current.forEach(source => source.stop());
    activeAudioSourcesRef.current.clear();
    outputAudioContextRef.current?.close().catch(console.error);
    outputAudioContextRef.current = null;
    audioQueueRef.current = [];
    nextStartTimeRef.current = 0;
  }, [clearSilenceTimer]);

  const playAudioQueue = useCallback((isInitialGreeting: boolean = false) => {
    clearSilenceTimer();
    
    if (audioQueueRef.current.length === 0) return;
    
    const audioContext = outputAudioContextRef.current;
    if (!audioContext) return;

    if (widgetStateRef.current !== WidgetState.Speaking && widgetStateRef.current !== WidgetState.Error) {
        setWidgetState(WidgetState.Speaking);
    }
    
    const currentTime = audioContext.currentTime;
    if (nextStartTimeRef.current < currentTime) {
        nextStartTimeRef.current = currentTime + 0.05;
    }

    while (audioQueueRef.current.length > 0) {
        const chunk = audioQueueRef.current.shift();
        if (!chunk) continue;

        try {
            const audioBuffer = decodePcmChunk(chunk, audioContext);
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);

            source.start(nextStartTimeRef.current);
            nextStartTimeRef.current += audioBuffer.duration;

            activeAudioSourcesRef.current.add(source);
            
            source.onended = () => {
                activeAudioSourcesRef.current.delete(source);
                
                if (isInitialGreeting && activeAudioSourcesRef.current.size === 0 && audioQueueRef.current.length === 0) {
                    isGreetingProtectedRef.current = false;
                }

                if (activeAudioSourcesRef.current.size === 0 && audioQueueRef.current.length === 0) {
                     if (shouldEndAfterSpeakingRef.current) {
                        endVoiceSession();
                    } else if (widgetStateRef.current === WidgetState.Speaking) {
                        setWidgetState(WidgetState.Listening);
                        resetSilenceTimer();
                    }
                }
            };
        } catch (e) {
            console.error("Error decoding/scheduling chunk", e);
            if (isInitialGreeting) isGreetingProtectedRef.current = false;
        }
    }
  }, [endVoiceSession, clearSilenceTimer, resetSilenceTimer]);

  const toggleWidget = () => {
    if (isOpen) {
      if (view === 'chat' && messages.length > 1) {
          endChatSession();
      } else if (view === 'voice' && widgetState !== WidgetState.Idle && widgetState !== WidgetState.Ended) {
          endVoiceSession();
      }
      setTimeout(() => setView('home'), 300);
    } else {
      // Opening the widget: Permanently dismiss callout for this session
      sessionStorage.setItem('ai-agent-callout-dismissed', 'true');
      setShowCallout(false);
    }
    setIsOpen(!isOpen);
  };

  const handleBack = () => {
      if (view === 'chat') {
          endChatSession();
      } else if (view === 'voice') {
          if (widgetState !== WidgetState.Idle && widgetState !== WidgetState.Ended) {
              endVoiceSession();
          }
          setView('home');
      }
  };

  const handleHomeFormSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if(chatInput.trim()) {
          initChat(chatInput);
      }
  };

  const handleChatFormSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if(chatInput.trim()) {
          handleChatMessage(chatInput);
      }
  };

  const handleDismissCallout = (e: React.MouseEvent) => {
      e.stopPropagation();
      sessionStorage.setItem('ai-agent-callout-dismissed', 'true');
      setShowCallout(false);
  };

  // Improved resize logic for widget mode to prevent callout clipping
  useEffect(() => {
    if (!isWidgetMode) return;
    
    let width = 80;
    let height = 80;
    
    if (isOpen) {
        width = 400;
        height = 600;
    } else if (showCallout) {
        // Broaden width and increase height to accommodate callout bubble + pointer
        width = 250;
        height = 220; 
    }
    
    window.parent.postMessage({ type: 'agent-widget-resize', isOpen, width, height }, '*');
  }, [isOpen, isWidgetMode, showCallout]);
  
  useEffect(() => {
    // Check if dismissed in this session
    const calloutDismissed = sessionStorage.getItem('ai-agent-callout-dismissed');

    if (!isOpen && !calloutDismissed && agentProfile.calloutMessage) {
        setShowCallout(true);
    } else {
        setShowCallout(false);
    }
  }, [isOpen, agentProfile.calloutMessage]);

  const themeClass = agentProfile.theme === 'dark' ? 'dark' : '';

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
              {!isOnline && <OfflineBanner />}
              <form onSubmit={handleHomeFormSubmit} className="relative w-full">
                  <input 
                    type="text" 
                    placeholder="Ask a question..." 
                    value={chatInput}
                    disabled={!isOnline}
                    onChange={(e) => setChatInput(e.target.value)}
                    className={`w-full pl-6 pr-14 py-4 rounded-2xl shadow-sm border-2 border-transparent dark:border-gray-700 bg-white dark:bg-gray-800 focus:outline-none focus:border-accent-${accentColorClass} text-gray-900 dark:text-white transition-all text-left font-semibold disabled:opacity-50`}
                  />
                  <button 
                    type="submit" 
                    disabled={!isOnline}
                    className={`absolute right-3 top-1/2 -translate-y-1/2 p-3 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-500 hover:text-accent-${accentColorClass} transition-colors disabled:opacity-50`}
                  >
                      <SendIcon className="h-5 w-5" />
                  </button>
              </form>

              <button
                  onClick={startVoiceSession}
                  disabled={!isOnline}
                  className={`w-full bg-gradient-to-r from-accent-${accentColorClass} to-gray-800 rounded-2xl p-1 shadow-xl hover:scale-[1.03] transition-transform group text-left disabled:opacity-50 disabled:grayscale`}
              >
                  <div className="bg-white/10 backdrop-blur-md rounded-xl p-5 flex items-center gap-5 h-full">
                      <div className="p-4 bg-white/20 rounded-2xl shadow-inner animate-pulse">
                          <MicrophoneIcon state={WidgetState.Idle} />
                      </div>
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
      <div className="flex flex-col h-full w-full bg-white dark:bg-gray-900 animate-fade-in-up">
          <div className={`flex items-center justify-between p-5 flex-shrink-0 z-20 bg-accent-${accentColorClass} text-white shadow-xl transition-colors duration-300`}>
              <div className="flex items-center gap-4 min-w-0">
                  <button onClick={handleBack} className="p-1 rounded-full hover:bg-white/20 transition-all active:scale-90 flex-shrink-0" title="Back">
                      <ChevronLeftIcon />
                  </button>
                  <h3 className="font-black text-lg uppercase tracking-tight leading-tight text-white whitespace-normal break-words">{agentProfile.name}</h3>
              </div>
              <button onClick={endChatSession} className="text-[10px] font-black bg-white text-red-500 hover:bg-red-50 px-4 py-2 rounded-full shadow-lg transition-all uppercase tracking-widest active:scale-95 flex-shrink-0 ml-2">
                  End Chat
              </button>
          </div>

          <div className="flex-grow overflow-y-auto p-4 space-y-4 scroll-smooth bg-gray-50 dark:bg-gray-900">
              {!isOnline && <OfflineBanner />}
              {messages.map((msg, idx) => {
                  const isUser = msg.role === 'user';
                  return (
                    <div key={idx} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] rounded-2xl p-4 text-[15px] shadow-sm relative group whitespace-pre-wrap leading-relaxed ${
                            isUser
                            ? `bg-accent-${accentColorClass} text-white rounded-br-none font-bold` 
                            : 'bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 text-gray-800 dark:text-gray-200 rounded-bl-none font-semibold'
                        }`}>
                            {msg.text}
                            <span className={`text-[10px] block text-right mt-1 opacity-70 font-black ${isUser ? 'text-white/80' : 'text-gray-400'}`}>
                                {msg.timestamp ? msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                            </span>
                        </div>
                    </div>
                  );
              })}
              {isChatTyping && (
                   <div className="flex justify-start">
                      <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl rounded-bl-none p-4 shadow-sm flex gap-2 items-center">
                          <div className="w-2.5 h-2.5 bg-gray-400 rounded-full animate-bounce"></div>
                          <div className="w-2.5 h-2.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                          <div className="w-2.5 h-2.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                      </div>
                   </div>
              )}
              <div ref={messagesEndRef} />
          </div>

          <form onSubmit={handleChatFormSubmit} className="p-5 border-t border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-900">
              <div className="relative">
                  <input
                    type="text"
                    value={chatInput}
                    disabled={!isOnline}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Type a message..."
                    className={`w-full pl-5 pr-14 py-4 rounded-2xl border-2 border-transparent bg-gray-100 dark:bg-gray-800 focus:outline-none focus:border-accent-${accentColorClass} dark:text-white transition-all font-semibold disabled:opacity-50`}
                  />
                  <button 
                    type="submit"
                    disabled={!chatInput.trim() || !isOnline}
                    className={`absolute right-2 top-1/2 -translate-y-1/2 p-3 rounded-xl text-white bg-accent-${accentColorClass} hover:brightness-110 disabled:opacity-50 transition-all shadow-md`}
                  >
                      <SendIcon className="h-5 w-5" />
                  </button>
              </div>
          </form>
      </div>
  );

  const renderVoiceView = () => (
    <div className="flex flex-col h-full w-full bg-white dark:bg-gray-900 animate-fade-in-up">
        {permissionRequested && (
            <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center p-8 text-center animate-fade-in backdrop-blur-xl bg-black/40 text-white/90">
                <div className="mb-6 p-6 rounded-3xl bg-white/10 animate-bounce shadow-2xl border border-white/20">
                     <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-white drop-shadow-lg" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 10a7 7 0 0 0 14 0" />
                        <path d="M8 21l8 0" />
                        <path d="M12 17l0 4" />
                        <path d="M9 2m0 3a3 3 0 0 1 3 -3h0a3 3 0 0 1 3 3v5a3 3 0 0 1 -3 3h0a3 3 0 0 1 -3 -3z" />
                    </svg>
                </div>
                <h3 className="text-2xl font-black mb-2 uppercase tracking-tight">Mic Permission</h3>
                <p className="text-lg font-bold opacity-80">Tap "Allow" to connect.</p>
            </div>
        )}

        <div className={`flex items-center justify-between p-5 flex-shrink-0 z-20 bg-accent-${accentColorClass} text-white shadow-xl transition-colors duration-300`}>
            <div className="flex items-center gap-4 min-w-0">
                 <button onClick={handleBack} className="p-1 rounded-full hover:bg-white/20 transition-all active:scale-90 flex-shrink-0" title="Back">
                    <ChevronLeftIcon />
                </button>
                <h3 className="font-black text-lg uppercase tracking-tight leading-tight text-white whitespace-normal break-words">{agentProfile.name}</h3>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                <LiveBadge />
            </div>
        </div>

        <div className="flex-grow flex flex-col items-center justify-center relative overflow-hidden bg-white dark:bg-gray-900">
            {!isOnline && <OfflineBanner />}
            {isOnline && isNetworkSlow && (widgetState === WidgetState.Speaking || widgetState === WidgetState.Listening) && <NetworkWarning />}
            
            <div className="relative w-full flex items-center justify-center mb-10 min-h-[220px]">
                
                {(widgetState === WidgetState.Speaking) && (
                    <>
                        <div className={`absolute w-72 h-72 rounded-full border-4 border-accent-${accentColorClass} opacity-20 animate-sonar-ping`}></div>
                        <div className={`absolute w-72 h-72 rounded-full border-4 border-accent-${accentColorClass} opacity-20 animate-sonar-ping [animation-delay:1s]`}></div>
                    </>
                )}

                <div className={`relative w-56 h-56 rounded-full bg-gradient-to-br from-accent-${accentColorClass} to-gray-400 dark:to-gray-800 shadow-[0_30px_60px_rgba(0,0,0,0.2)] flex items-center justify-center transition-all duration-700 ${widgetState === WidgetState.Speaking ? 'scale-110' : 'scale-100'}`}>
                    <div className="absolute top-0 left-0 w-full h-full rounded-full bg-gradient-to-b from-white/30 to-transparent pointer-events-none"></div>
                    <div className={`relative w-52 h-52 rounded-full flex items-center justify-center shadow-inner z-10 overflow-hidden transition-colors duration-500 ${widgetState === WidgetState.Ended ? `bg-accent-${accentColorClass}` : 'bg-white dark:bg-gray-900'}`}>
                        {widgetState === WidgetState.Connecting && <Spinner className={`w-24 h-24 text-accent-${accentColorClass}`} />}
                        {(widgetState === WidgetState.Idle || widgetState === WidgetState.Listening || widgetState === WidgetState.Speaking) && (
                            <div className={`transition-transform duration-500 ${widgetState === WidgetState.Speaking ? 'scale-115' : 'scale-100'}`}>
                                <WaveformIcon className={`h-28 w-28 ${widgetState === WidgetState.Idle ? 'text-gray-200 dark:text-gray-700' : `text-accent-${accentColorClass}`}`} />
                            </div>
                        )}
                        {widgetState === WidgetState.Error && (
                            <div className="text-red-500 animate-pulse">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-24 w-24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            </div>
                        )}
                        
                        {widgetState === WidgetState.Ended && (voiceReportingStatus === 'analyzing' || voiceReportingStatus === 'sending') && <Spinner className="w-24 h-24 text-white" />}
                        {widgetState === WidgetState.Ended && voiceReportingStatus === 'sent' && <div className="text-white"><svg xmlns="http://www.w3.org/2000/svg" className="h-24 w-24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg></div>}
                        {widgetState === WidgetState.Ended && voiceReportingStatus === 'failed' && <div className="text-white"><svg xmlns="http://www.w3.org/2000/svg" className="h-24 w-24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></div>}
                        {widgetState === WidgetState.Ended && voiceReportingStatus === 'idle' && (
                            <div className="p-8 transform scale-110 animate-fade-in">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-20 w-20 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <path d="M18.36 6.64a9 9 0 11-12.73 0M12 2v10" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <p className={`text-xl font-black h-10 mb-2 break-words max-w-full px-6 text-center uppercase tracking-tight ${!isOnline && widgetState === WidgetState.Error ? 'text-red-600' : 'text-gray-900 dark:text-white'}`}>
                {widgetState === WidgetState.Connecting && "Connecting..."}
                {widgetState === WidgetState.Listening && "Listening..."}
                {widgetState === WidgetState.Speaking && "Speaking..."}
                {widgetState === WidgetState.Error && (errorMessage || "Connection Error")}
                {widgetState === WidgetState.Ended && (
                        voiceReportingStatus === 'analyzing' ? 'Analyzing...' :
                        voiceReportingStatus === 'sending' ? 'Sending Report...' :
                        voiceReportingStatus === 'sent' ? 'Report Sent' : 
                        voiceReportingStatus === 'failed' ? 'Failed' : 'Session Ended'
                )}
            </p>
            
            <div className="h-10 mb-6 flex items-center justify-center px-8 text-center">
                {(widgetState === WidgetState.Idle) && (
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-widest opacity-60">
                        Tap call to start
                    </p>
                )}
                {(widgetState === WidgetState.Ended && (voiceReportingStatus === 'sent' || voiceReportingStatus === 'failed' || voiceReportingStatus === 'idle')) && (
                    <p className="text-xs font-black text-gray-400 uppercase tracking-widest animate-pulse">
                        Ready to close
                    </p>
                )}
            </div>

            <div className="h-24 flex items-center justify-center">
                {(widgetState === WidgetState.Connecting || widgetState === WidgetState.Listening || widgetState === WidgetState.Speaking) ? (
                    <button onClick={endVoiceSession} className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-2xl transition-all transform hover:scale-110 active:scale-90 focus:outline-none" aria-label="End Call">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 rotate-135" viewBox="0 0 20 20" fill="currentColor"><path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 011.059.54V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" /></svg>
                    </button>
                ) : (
                    !(widgetState === WidgetState.Ended && (voiceReportingStatus === 'analyzing' || voiceReportingStatus === 'sending' || voiceReportingStatus === 'sent')) && (
                        <button 
                            disabled={!isOnline}
                            onClick={startVoiceSession} 
                            className={`w-16 h-16 rounded-full bg-accent-${accentColorClass} hover:brightness-110 text-white flex items-center justify-center shadow-2xl transition-all transform hover:scale-110 active:scale-95 focus:outline-none disabled:grayscale disabled:opacity-50`} 
                            aria-label="Start Call"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 20 20" fill="currentColor"><path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" /></svg>
                        </button>
                    )
                )}
            </div>
        </div>
    </div>
  );

  if (!isOpen) {
    const fabContent = (
      <div className={`${themeClass} relative group`}>
        {showCallout && agentProfile.calloutMessage && (
          <div className="absolute bottom-[calc(100%+16px)] right-0 md:right-4 mb-4 w-[220px] px-5 py-3 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.15)] text-left text-sm animate-fade-in-up border border-gray-100 dark:border-gray-700 z-[10000]">
            <button 
              onClick={handleDismissCallout} 
              className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors p-1"
              aria-label="Dismiss callout"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <p className="font-bold leading-tight uppercase tracking-tight pr-4">{agentProfile.calloutMessage}</p>
            <div className="absolute -bottom-2 right-8 w-4 h-4 bg-white dark:bg-gray-800 transform rotate-45 border-b border-r border-gray-100 dark:border-gray-700"></div>
          </div>
        )}
        <button onClick={toggleWidget} className={`w-16 h-16 rounded-full bg-accent-${accentColorClass} shadow-2xl flex items-center justify-center text-white transform hover:scale-110 transition-all animate-pulse active:scale-95`}>
          <FabIcon />
        </button>
      </div>
    );
    return isWidgetMode ? <div className="w-full h-full p-2 flex items-end justify-end bg-transparent">{fabContent}</div> : <div className="fixed bottom-6 right-6 z-[9999]">{fabContent}</div>;
  }

  const containerClasses = isWidgetMode 
    ? 'w-full h-full' 
    : 'fixed bottom-0 right-0 md:bottom-24 md:right-6 w-full h-[100dvh] md:w-[400px] md:h-[600px] md:rounded-3xl shadow-[0_35px_60px_-15px_rgba(0,0,0,0.3)] z-[9999] transition-all duration-500 ease-out';

  return (
    <div className={`${themeClass} ${containerClasses}`}>
        <div className={`flex flex-col w-full h-full bg-white dark:bg-gray-900 text-black dark:text-white md:rounded-[2rem] overflow-hidden border-0 ${!isWidgetMode ? 'shadow-2xl' : ''}`}>
            {view === 'home' && (
                <button onClick={toggleWidget} className="absolute top-5 right-5 z-50 p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all backdrop-blur-md active:scale-90">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            )}

            {view === 'home' && renderHomeView()}
            {view === 'chat' && renderChatView()}
            {view === 'voice' && renderVoiceView()}
        </div>
    </div>
  );
};
