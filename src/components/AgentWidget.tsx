
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

// Helper function to upload and get a shareable link from Cloudinary
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

// --- Icons ---

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

const ChevronLeftIcon = ({className = "h-6 w-6"}) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
    </svg>
);

const NetworkIcon = ({ isOnline }: { isOnline: boolean }) => (
    <div className={`flex items-center gap-1.5 rounded-full px-2 py-1 border transition-colors bg-white/20 backdrop-blur-md border-white/10`} title={isOnline ? "Network Stable" : "Network Unstable"}>
        <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-400 animate-pulse' : 'bg-red-500'}`}></div>
        <span className={`text-[10px] font-medium uppercase tracking-wider text-white/90`}>
            {isOnline ? 'LIVE' : 'OFFLINE'}
        </span>
    </div>
);

export const AgentWidget: React.FC<AgentWidgetProps> = ({ agentProfile, apiKey, isWidgetMode, onSessionEnd }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<ViewState>('home');
  const [showCallout, setShowCallout] = useState(false);
  const [permissionRequested, setPermissionRequested] = useState(false);
  
  // Voice State
  const [widgetState, _setWidgetState] = useState<WidgetState>(WidgetState.Idle);
  const widgetStateRef = useRef(widgetState);
  const setWidgetState = (state: WidgetState) => {
    widgetStateRef.current = state;
    _setWidgetState(state);
  };
  const [voiceReportingStatus, setVoiceReportingStatus] = useState<ReportingStatus>('idle');
  const fullTranscriptRef = useRef('');
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Chat State
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatTyping, setIsChatTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [errorMessage, setErrorMessage] = useState('');

  // Services
  const geminiServiceRef = useRef<GeminiLiveService | null>(null);
  const recordingServiceRef = useRef<RecordingService | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioQueueRef = useRef<Uint8Array[]>([]);
  const isPlayingRef = useRef(false);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const activeAudioSourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const nextStartTimeRef = useRef(0);
  const shouldEndAfterSpeakingRef = useRef(false);
  const chatSessionRef = useRef<Chat | null>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  const accentColorClass = agentProfile.accentColor;

  // --- Effects ---
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

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
  useEffect(() => {
    scrollToBottom();
  }, [messages, isChatTyping]);

  // --- Analysis & Reporting ---
  const analyzeAndSendReport = useCallback(async (recording: Omit<Recording, 'id' | 'url'>) => {
    const { emailConfig, fileUploadConfig } = agentProfile as AgentConfig;
    if (!emailConfig?.formspreeEndpoint) {
        if (!isWidgetMode) {
             console.warn("Formspree endpoint not configured. Report skipped.");
        }
        return;
    }

    if (view === 'voice') setVoiceReportingStatus('analyzing');

    try {
        let audioLink = 'N/A';
        // Only upload if it's a voice recording with a valid blob
        if (recording.blob && recording.blob.size > 0 && fileUploadConfig?.cloudinaryCloudName && fileUploadConfig.cloudinaryUploadPreset) {
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
        // Prioritize Transcript for analysis
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
                model: "gemini-2.5-flash",
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
  }, [agentProfile, apiKey, isWidgetMode, view]);


  // --- Chat Logic ---
  const initChat = async (initialMessage?: string) => {
    const config = agentProfile as AgentConfig;
    const ai = new GoogleGenAI({ apiKey });
    
    // Use Chat specific instructions if available, otherwise fallback to general
    const systemInstruction = config.chatKnowledgeBase || config.knowledgeBase;
    
    chatSessionRef.current = ai.chats.create({
        model: 'gemini-2.5-flash',
        config: { systemInstruction }
    });

    const welcomeText = config.initialGreetingText || config.initialGreeting || "Hello! How can I help you?";
    
    setMessages([{ role: 'model', text: welcomeText, timestamp: new Date() }]);
    setView('chat');

    if (initialMessage) {
        await handleChatMessage(initialMessage);
    }
  };

  const handleChatMessage = async (text: string) => {
    if (!text.trim() || !chatSessionRef.current) return;

    const userMsg: Message = { role: 'user', text, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setIsChatTyping(true);

    try {
        const result = await chatSessionRef.current.sendMessageStream({ message: text });
        
        let fullResponse = "";
        setMessages(prev => [...prev, { role: 'model', text: "", timestamp: new Date() }]); // Placeholder

        for await (const chunk of result) {
            const chunkText = chunk.text;
            fullResponse += chunkText;
            setMessages(prev => {
                const newArr = [...prev];
                newArr[newArr.length - 1] = { role: 'model', text: fullResponse, timestamp: new Date() };
                return newArr;
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
    if (messages.length <= 1) { // Only welcome message
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
        blob: new Blob([], { type: 'text/plain' }), // Empty blob for chat
        mimeType: 'text/plain',
        transcript: transcript
    };

    // Fire and forget reporting
    analyzeAndSendReport(newRecording);
    
    // Reset and go home
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

  // --- Voice Logic ---
  
  const resetSilenceTimer = useCallback(() => {
      if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
      }
      silenceTimerRef.current = setTimeout(() => {
          console.log("User is silent, triggering nudge...");
          geminiServiceRef.current?.sendText("The user has been silent for 8 seconds. Gently check if they are still there or if they have a question.");
      }, 8000); // 8 seconds silence detection
  }, []);

  const clearSilenceTimer = useCallback(() => {
      if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
      }
  }, []);

  const startVoiceSession = useCallback(async () => {
    setView('voice');
    shouldEndAfterSpeakingRef.current = false;
    setWidgetState(WidgetState.Connecting);
    setVoiceReportingStatus('idle');
    setErrorMessage('');
    fullTranscriptRef.current = '';
    
    // Show visual guide for permission
    setPermissionRequested(true);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
    } catch (e) {
      setWidgetState(WidgetState.Error);
      setErrorMessage("Failed to get microphone access.");
      cleanupServices();
      return;
    } finally {
        setPermissionRequested(false);
    }
    
    outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    recordingServiceRef.current = new RecordingService(handleVoiceSessionEnd);
    await recordingServiceRef.current.start(stream);

    // Initial Greeting Audio
    const greeting = (agentProfile as AgentConfig).initialGreeting;
    if (greeting) {
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
                playAudioQueue();
            }
        } catch (error) {
            console.error("Failed to generate greeting audio:", error);
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
         
         // If user speaks, reset silence timer
         if (type === 'input' && text.trim().length > 0) {
             resetSilenceTimer();
         }
         
        if (isFinal && type === 'output') {
          const lowerCaseText = text.toLowerCase();
          const endKeywords = ['goodbye', 'farewell', 'take care', 'talk to you later', 'bye bye', 'bye'];
          if (endKeywords.some(keyword => lowerCaseText.includes(keyword))) {
            shouldEndAfterSpeakingRef.current = true;
          }
        }
      },
      onAudioChunk: (chunk) => {
        audioQueueRef.current.push(chunk);
        recordingServiceRef.current?.addAgentAudioChunk(chunk);
        playAudioQueue();
      },
      onInterruption: handleInterruption,
      onError: (error) => {
        setWidgetState(WidgetState.Error);
        setErrorMessage(error);
        cleanupServices();
      },
    });
    geminiServiceRef.current.connect(stream);
  }, [apiKey, agentProfile, resetSilenceTimer]);

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
    isPlayingRef.current = false;
    nextStartTimeRef.current = 0;
  }, [clearSilenceTimer]);

  const playAudioQueue = useCallback(() => {
    // Agent is starting to speak, pause silence timer
    clearSilenceTimer();
    
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;
    
    isPlayingRef.current = true;
    if (widgetStateRef.current !== WidgetState.Speaking && widgetStateRef.current !== WidgetState.Error) {
        setWidgetState(WidgetState.Speaking);
    }
    
    const audioContext = outputAudioContextRef.current;
    if (!audioContext) {
      isPlayingRef.current = false;
      return;
    }

    const processNextChunk = () => {
        if(audioQueueRef.current.length === 0) {
            isPlayingRef.current = false;
            if (shouldEndAfterSpeakingRef.current) {
                endVoiceSession();
                return;
            }
            if(widgetStateRef.current === WidgetState.Speaking) {
                setWidgetState(WidgetState.Listening);
                // Agent finished speaking, resume silence timer
                resetSilenceTimer();
            }
            return;
        }

        const chunk = audioQueueRef.current.shift()!;
        const audioBuffer = decodePcmChunk(chunk, audioContext);

        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);

        activeAudioSourcesRef.current.add(source);
        source.addEventListener('ended', () => {
            activeAudioSourcesRef.current.delete(source);
        });

        const startTime = Math.max(nextStartTimeRef.current, audioContext.currentTime);
        source.start(startTime);
        nextStartTimeRef.current = startTime + audioBuffer.duration;
        source.onended = processNextChunk;
    }

    processNextChunk();
  }, [endVoiceSession, clearSilenceTimer, resetSilenceTimer]);

  const handleInterruption = useCallback(() => {
    activeAudioSourcesRef.current.forEach(source => source.stop());
    activeAudioSourcesRef.current.clear();
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    nextStartTimeRef.current = 0;
    if (widgetStateRef.current === WidgetState.Speaking) {
        setWidgetState(WidgetState.Listening);
        // Interruption implies user is speaking/interacting, reset timer
        resetSilenceTimer();
    }
  }, [resetSilenceTimer]);

  // --- UI Triggers ---
  
  const toggleWidget = () => {
    if (isOpen) {
      if (view === 'chat' && messages.length > 1) {
          endChatSession();
      } else if (view === 'voice' && widgetState !== WidgetState.Idle && widgetState !== WidgetState.Ended) {
          endVoiceSession();
      }
      setTimeout(() => setView('home'), 300);
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

  const handleHomeInputSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if(chatInput.trim()) {
          initChat(chatInput);
      }
  };

  // --- Effects ---
  useEffect(() => {
    if (!isWidgetMode) return;
    if (isOpen) {
      window.parent.postMessage({ type: 'agent-widget-resize', isOpen: true, width: 400, height: 600 }, '*');
    } else {
      window.parent.postMessage({ type: 'agent-widget-resize', isOpen: false, width: 300, height: 140 }, '*');
    }
  }, [isOpen, isWidgetMode]);
  
  // Callout logic
  useEffect(() => {
    const calloutShown = sessionStorage.getItem('ai-agent-callout-shown');
    let showTimer: number;
    let hideTimer: number;

    if (!isOpen && !calloutShown && agentProfile.calloutMessage) {
      showTimer = window.setTimeout(() => {
        setShowCallout(true);
        sessionStorage.setItem('ai-agent-callout-shown', 'true');
        // Increased callout duration to 15 seconds
        hideTimer = window.setTimeout(() => setShowCallout(false), 15000);
      }, 1500);
    }
    if (isOpen) setShowCallout(false);
    return () => { clearTimeout(showTimer); clearTimeout(hideTimer); };
  }, [isOpen, agentProfile.calloutMessage]);

  const themeClass = agentProfile.theme === 'dark' ? 'dark' : '';

  // --- Render Views ---

  // 1. Home / Selection View (Restored Premium Design)
  const renderHomeView = () => (
      <div className="flex flex-col h-full w-full bg-white dark:bg-gray-900 animate-fade-in-up">
          {/* Hero Header */}
          <div className={`relative h-[40%] bg-gradient-to-br from-accent-${accentColorClass} to-gray-900 flex flex-col p-6 text-white`}>
              <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-bold tracking-widest uppercase opacity-80">{agentProfile.name}</span>
              </div>
              <div className="mt-auto mb-6 relative z-10">
                  <h1 className="text-4xl font-bold">Hi <span className="animate-wave inline-block">👋</span></h1>
                  <p className="text-white/80 mt-2 font-medium">How can we help you today?</p>
              </div>
              {/* Decorative Glow */}
              <div className="absolute -right-10 -bottom-20 w-64 h-64 bg-white/10 rounded-full blur-2xl pointer-events-none"></div>
          </div>

          {/* Action Body (Curved Overlap) */}
          <div className="flex-1 bg-gray-50 dark:bg-gray-900 relative -mt-6 rounded-t-3xl px-6 pt-8 flex flex-col gap-4 shadow-lg z-20">
              
              {/* Fake Search Bar -> Chat */}
              <form onSubmit={handleHomeInputSubmit} className="relative w-full">
                  <input 
                    type="text" 
                    placeholder="Ask a question..." 
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    className="w-full pl-5 pr-12 py-4 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-accent-${accentColorClass} text-gray-900 dark:text-white transition-all text-left"
                  />
                  <button type="submit" className={`absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-400 group-hover:text-accent-${accentColorClass} hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors`}>
                      <SendIcon className="h-4 w-4" />
                  </button>
              </form>

              {/* Voice Card */}
              <button
                  onClick={startVoiceSession}
                  className={`w-full bg-gradient-to-r from-accent-${accentColorClass} to-gray-800 rounded-xl p-1 shadow-md hover:scale-[1.02] transition-transform group text-left`}
              >
                  <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 flex items-center gap-4 h-full">
                      <div className="p-3 bg-white/20 rounded-full animate-pulse">
                          <MicrophoneIcon state={WidgetState.Idle} />
                      </div>
                      <div className="text-left text-white">
                          <h3 className="font-bold text-lg">Talk to AI Assistant</h3>
                          <p className="text-xs opacity-90">Skip typing, we're listening.</p>
                      </div>
                  </div>
              </button>
          </div>
      </div>
  );

  const renderChatView = () => (
      <div className="flex flex-col h-full w-full bg-white dark:bg-gray-900 animate-fade-in-up">
          {/* Header */}
          <div className={`flex items-center justify-between p-4 flex-shrink-0 z-20 border-b border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md`}>
              <div className="flex items-center gap-2">
                  <button onClick={handleBack} className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors" title="Back">
                      <ChevronLeftIcon />
                  </button>
                  <h3 className="font-bold text-lg truncate max-w-[180px]">{agentProfile.name}</h3>
              </div>
              <button onClick={endChatSession} className="text-xs font-medium text-red-500 hover:bg-red-50 px-3 py-1 rounded-full border border-red-100 transition-colors">
                  End Chat
              </button>
          </div>

          {/* Chat Messages */}
          <div className="flex-grow overflow-y-auto p-4 space-y-4 scroll-smooth bg-gray-50 dark:bg-gray-900">
              {messages.map((msg, idx) => {
                  const isUser = msg.role === 'user';
                  return (
                    <div key={idx} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] rounded-2xl p-3 text-sm shadow-sm relative group whitespace-pre-wrap leading-relaxed ${
                            isUser
                            ? `bg-accent-${accentColorClass} text-white rounded-br-none` 
                            : 'bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 text-gray-800 dark:text-gray-200 rounded-bl-none'
                        }`}>
                            {msg.text}
                            <span className={`text-[10px] block text-right mt-1 opacity-70 ${isUser ? 'text-white/80' : 'text-gray-400'}`}>
                                {msg.timestamp ? msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                            </span>
                        </div>
                    </div>
                  );
              })}
              {isChatTyping && (
                   <div className="flex justify-start">
                      <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl rounded-bl-none p-4 shadow-sm flex gap-1 items-center">
                          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                      </div>
                   </div>
              )}
              <div ref={messagesEndRef} />
          </div>

          {/* Chat Input */}
          <form onSubmit={handleHomeInputSubmit} className="p-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
              <div className="relative">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Type a message..."
                    className="w-full pl-4 pr-12 py-3 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-300 dark:focus:ring-gray-600 dark:text-white transition-shadow"
                  />
                  <button 
                    type="submit"
                    disabled={!chatInput.trim()}
                    className={`absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full text-white bg-accent-${accentColorClass} hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-all`}
                  >
                      <SendIcon className="h-4 w-4" />
                  </button>
              </div>
          </form>
      </div>
  );

  const renderVoiceView = () => (
    <div className="flex-grow flex flex-col items-center justify-center p-6 text-center relative overflow-hidden animate-fade-in-up bg-white dark:bg-gray-900 h-full w-full">
        {/* Permission Overlay - Premium Frosted Glass */}
        {permissionRequested && (
            <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center p-8 text-center animate-fade-in backdrop-blur-md bg-black/20 text-white/90">
                <div className="mb-6 p-4 rounded-full bg-white/10 animate-bounce shadow-xl border border-white/20">
                     <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white drop-shadow-md" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                        <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                        <path d="M5 10a7 7 0 0 0 14 0" />
                        <path d="M8 21l8 0" />
                        <path d="M12 17l0 4" />
                        <path d="M9 2m0 3a3 3 0 0 1 3 -3h0a3 3 0 0 1 3 3v5a3 3 0 0 1 -3 3h0a3 3 0 0 1 -3 -3z" />
                    </svg>
                </div>
                <h3 className="text-2xl font-bold mb-2 drop-shadow-md">Microphone Access</h3>
                <p className="text-lg font-medium drop-shadow-sm">Tap "Allow" to start talking.</p>
            </div>
        )}

        {/* Header with Back Button and Name */}
        <div className="absolute top-0 left-0 w-full z-50 p-4 flex items-center justify-between">
             <button onClick={handleBack} className="p-2 rounded-full bg-gray-100/50 dark:bg-gray-800/50 backdrop-blur-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
                <ChevronLeftIcon />
            </button>
            <div className="absolute left-1/2 -translate-x-1/2 font-bold text-gray-800 dark:text-white text-sm uppercase tracking-wide truncate max-w-[150px] drop-shadow-sm bg-white/50 dark:bg-black/50 px-2 py-1 rounded-md backdrop-blur-sm">
                {agentProfile.name}
            </div>
            <NetworkIcon isOnline={isOnline} />
        </div>

        <div className="relative w-full flex items-center justify-center mb-8 min-h-[200px]">
            <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-accent-${accentColorClass} opacity-10 blur-[60px] rounded-full`}></div>

            {(widgetState === WidgetState.Speaking) && (
                <>
                    <div className={`absolute w-64 h-64 rounded-full border-2 border-accent-${accentColorClass} opacity-20 animate-sonar-ping`}></div>
                    <div className={`absolute w-64 h-64 rounded-full border-2 border-accent-${accentColorClass} opacity-20 animate-sonar-ping [animation-delay:1s]`}></div>
                </>
            )}

            <div className={`relative w-48 h-48 rounded-full bg-gradient-to-br from-accent-${accentColorClass} to-gray-300 dark:to-gray-800 shadow-[0_20px_50px_rgba(0,0,0,0.15)] flex items-center justify-center transition-all duration-500 ${widgetState === WidgetState.Speaking ? 'scale-105' : 'scale-100'}`}>
                <div className="absolute top-0 left-0 w-full h-full rounded-full bg-gradient-to-b from-white/20 to-transparent pointer-events-none"></div>
                <div className="relative w-44 h-44 rounded-full bg-white dark:bg-gray-900 flex items-center justify-center shadow-inner z-10 overflow-hidden">
                    {widgetState === WidgetState.Connecting && <Spinner className={`w-20 h-20 text-accent-${accentColorClass}`} />}
                    {(widgetState === WidgetState.Idle || widgetState === WidgetState.Listening || widgetState === WidgetState.Speaking) && (
                        <div className={`transition-transform duration-300 ${widgetState === WidgetState.Speaking ? 'scale-110' : 'scale-100'}`}>
                            <WaveformIcon className={`h-24 w-24 ${widgetState === WidgetState.Idle ? 'text-gray-300 dark:text-gray-600' : `text-accent-${accentColorClass}`}`} />
                        </div>
                    )}
                    {widgetState === WidgetState.Error && <div className="text-red-500 animate-pulse"><svg xmlns="http://www.w3.org/2000/svg" className="h-20 w-20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></div>}
                    {widgetState === WidgetState.Ended && (voiceReportingStatus === 'analyzing' || voiceReportingStatus === 'sending') && <Spinner className={`w-20 h-20 text-accent-${accentColorClass}`} />}
                    {widgetState === WidgetState.Ended && voiceReportingStatus === 'sent' && <div className="text-green-500"><svg xmlns="http://www.w3.org/2000/svg" className="h-20 w-20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></div>}
                    {widgetState === WidgetState.Ended && voiceReportingStatus === 'failed' && <div className="text-red-500"><svg xmlns="http://www.w3.org/2000/svg" className="h-20 w-20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></div>}
                </div>
            </div>
        </div>

        <p className="text-lg font-medium text-gray-700 dark:text-gray-200 h-8 mb-2 break-words max-w-full px-2">
            {widgetState === WidgetState.Connecting && "Connecting..."}
            {widgetState === WidgetState.Listening && "Listening..."}
            {widgetState === WidgetState.Speaking && "Speaking..."}
            {widgetState === WidgetState.Error && (errorMessage || "Connection Error")}
            {widgetState === WidgetState.Ended && (
                    voiceReportingStatus === 'analyzing' ? 'Analyzing Session...' :
                    voiceReportingStatus === 'sending' ? 'Sending Report...' :
                    voiceReportingStatus === 'sent' ? 'Session Report Sent' : 
                    voiceReportingStatus === 'failed' ? 'Report Generation Failed' : 'Session Ended'
            )}
        </p>
        
        <div className="h-10 mb-4 flex items-center justify-center">
            {(widgetState === WidgetState.Idle) && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 transition-opacity duration-500">
                    Click the call button to start.
                </p>
            )}
            {(widgetState === WidgetState.Ended && (voiceReportingStatus === 'sent' || voiceReportingStatus === 'failed')) && (
                <p className="text-sm text-gray-500 dark:text-gray-400 transition-opacity duration-500">
                You may now close the widget.
                </p>
            )}
        </div>

        <div className="h-20 flex items-center justify-center">
            {(widgetState === WidgetState.Connecting || widgetState === WidgetState.Listening || widgetState === WidgetState.Speaking) ? (
                <button onClick={endVoiceSession} className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-lg transition-transform transform hover:scale-105 focus:outline-none focus:ring-4 focus:ring-red-300 dark:focus:ring-red-900" aria-label="End Call">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 rotate-135" viewBox="0 0 20 20" fill="currentColor"><path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" /></svg>
                </button>
            ) : (
                !(widgetState === WidgetState.Ended && (voiceReportingStatus === 'analyzing' || voiceReportingStatus === 'sending' || voiceReportingStatus === 'sent')) && (
                    <button onClick={startVoiceSession} className={`w-16 h-16 rounded-full bg-accent-${accentColorClass} hover:brightness-110 text-white flex items-center justify-center shadow-lg transition-transform transform hover:scale-105 focus:outline-none focus:ring-4 focus:ring-offset-2`} aria-label={widgetState === WidgetState.Error || (widgetState === WidgetState.Ended && voiceReportingStatus === 'failed') ? "Retry" : "Start Call"}>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 20 20" fill="currentColor"><path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" /></svg>
                    </button>
                )
            )}
        </div>
    </div>
  );

  // --- Main Render ---

  if (!isOpen) {
    const fabContent = (
      <div className={`${themeClass} relative group`}>
        {showCallout && agentProfile.calloutMessage && (
          <div className="absolute bottom-full right-0 mb-3 w-max max-w-[200px] px-4 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-xl shadow-xl text-left text-sm animate-fade-in-up border border-gray-100 dark:border-gray-700">
            <p>{agentProfile.calloutMessage}</p>
            <div className="absolute -bottom-2 right-6 w-4 h-4 bg-white dark:bg-gray-800 transform rotate-45 border-b border-r border-gray-100 dark:border-gray-700"></div>
          </div>
        )}
        <button onClick={toggleWidget} className={`w-16 h-16 rounded-full bg-accent-${accentColorClass} shadow-lg flex items-center justify-center text-white transform hover:scale-110 transition-transform animate-pulse`}>
          <FabIcon />
        </button>
      </div>
    );
    return isWidgetMode ? <div className="w-full h-full p-2 flex items-end justify-end bg-transparent">{fabContent}</div> : <div className="fixed bottom-5 right-5 z-[9999]">{fabContent}</div>;
  }

  // CONTAINER LOGIC: 
  // Mobile: fixed full screen (h-100dvh). 
  // Desktop: Fixed bottom-right card.
  const containerClasses = isWidgetMode 
    ? 'w-full h-full' 
    : 'fixed bottom-0 right-0 md:bottom-24 md:right-5 w-full h-[100dvh] md:w-96 md:h-[600px] md:rounded-2xl shadow-2xl z-[9999] transition-all duration-300';

  return (
    <div className={`${themeClass} ${containerClasses}`}>
        <div className={`flex flex-col w-full h-full bg-white dark:bg-gray-900 text-black dark:text-white md:rounded-2xl overflow-hidden border-0 md:border border-gray-200 dark:border-gray-700 shadow-2xl`}>
            {/* Header / Close Button (Only visible on Home view or handled within views) */}
            {view === 'home' && (
                <button onClick={toggleWidget} className="absolute top-4 right-4 z-50 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            )}

            {/* View Switcher */}
            {view === 'home' && renderHomeView()}
            {view === 'chat' && renderChatView()}
            {view === 'voice' && renderVoiceView()}
        </div>
    </div>
  );
};
