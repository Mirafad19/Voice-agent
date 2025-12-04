
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
    <svg xmlns="http://www.w3.org/2000/svg" className={`h-12 w-12 transition-colors duration-300 ${state === WidgetState.Idle ? 'text-gray-800 dark:text-white' : 'text-white'}`} viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
        <path d="M9 2m0 3a3 3 0 0 1 3 -3h0a3 3 0 0 1 3 3v5a3 3 0 0 1 -3 3h0a3 3 0 0 1 -3 -3z" />
        <path d="M5 10a7 7 0 0 0 14 0" />
        <path d="M8 21l8 0" />
        <path d="M12 17l0 4" />
    </svg>
);

const SendIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
        <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
    </svg>
);

export const AgentWidget: React.FC<AgentWidgetProps> = ({ agentProfile, apiKey, isWidgetMode, onSessionEnd }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<ViewState>('home');
  const [showCallout, setShowCallout] = useState(false);
  
  // Voice State
  const [widgetState, _setWidgetState] = useState<WidgetState>(WidgetState.Idle);
  const widgetStateRef = useRef(widgetState);
  const setWidgetState = (state: WidgetState) => {
    widgetStateRef.current = state;
    _setWidgetState(state);
  };
  const [voiceReportingStatus, setVoiceReportingStatus] = useState<ReportingStatus>('idle');
  const fullTranscriptRef = useRef('');

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
  
  const accentColorClass = agentProfile.accentColor;

  // --- Scrolling ---
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
             // Fallback for empty chat
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
    
    setMessages([{ role: 'model', text: welcomeText }]);
    setView('chat');

    if (initialMessage) {
        await handleChatMessage(initialMessage);
    }
  };

  const handleChatMessage = async (text: string) => {
    if (!text.trim() || !chatSessionRef.current) return;

    const userMsg: Message = { role: 'user', text };
    setMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setIsChatTyping(true);

    try {
        const result = await chatSessionRef.current.sendMessageStream({ message: text });
        
        let fullResponse = "";
        setMessages(prev => [...prev, { role: 'model', text: "" }]); // Placeholder

        for await (const chunk of result) {
            const chunkText = chunk.text;
            fullResponse += chunkText;
            setMessages(prev => {
                const newArr = [...prev];
                newArr[newArr.length - 1] = { role: 'model', text: fullResponse };
                return newArr;
            });
        }
    } catch (e) {
        console.error("Chat error:", e);
        setMessages(prev => [...prev, { role: 'model', text: "I'm having trouble connecting right now. Please try again." }]);
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
  const startVoiceSession = useCallback(async () => {
    setView('voice');
    shouldEndAfterSpeakingRef.current = false;
    setWidgetState(WidgetState.Connecting);
    setVoiceReportingStatus('idle');
    setErrorMessage('');
    fullTranscriptRef.current = '';

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
    } catch (e) {
      setWidgetState(WidgetState.Error);
      setErrorMessage("Failed to get microphone access.");
      cleanupServices();
      return;
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
  }, [apiKey, agentProfile]);

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
  }, []);

  const playAudioQueue = useCallback(() => {
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
  }, [endVoiceSession]);

  const handleInterruption = useCallback(() => {
    activeAudioSourcesRef.current.forEach(source => source.stop());
    activeAudioSourcesRef.current.clear();
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    nextStartTimeRef.current = 0;
    if (widgetStateRef.current === WidgetState.Speaking) {
        setWidgetState(WidgetState.Listening);
    }
  }, []);

  // --- UI Triggers ---
  
  const toggleWidget = () => {
    if (isOpen) {
      // Logic: If user closes widget while in a session, end it and report.
      if (view === 'chat' && messages.length > 1) {
          endChatSession();
      } else if (view === 'voice' && widgetState !== WidgetState.Idle && widgetState !== WidgetState.Ended) {
          endVoiceSession();
      }
      // Reset view to home after closing
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
        hideTimer = window.setTimeout(() => setShowCallout(false), 5000);
      }, 1500);
    }
    if (isOpen) setShowCallout(false);
    return () => { clearTimeout(showTimer); clearTimeout(hideTimer); };
  }, [isOpen, agentProfile.calloutMessage]);

  const themeClass = agentProfile.theme === 'dark' ? 'dark' : '';

  // --- Render Functions ---

  const renderHomeView = () => (
      <div className="flex flex-col h-full bg-white dark:bg-gray-900 w-full">
          {/* Hero Section */}
          <div className={`relative h-[40%] min-h-[220px] bg-gradient-to-br from-accent-${accentColorClass} to-gray-900 p-6 flex flex-col justify-between text-white overflow-hidden`}>
               {/* Decorative Background Elements */}
               <div className="absolute top-0 right-0 p-4 opacity-20 transform translate-x-1/4 -translate-y-1/4">
                   <div className="w-32 h-32 rounded-full bg-white blur-3xl"></div>
               </div>
               
               {/* Header Top */}
               <div className="relative z-10">
                   <span className="text-xs font-bold tracking-widest uppercase opacity-80">{agentProfile.name}</span>
               </div>

               {/* Greeting */}
               <div className="relative z-10 mb-8">
                   <h1 className="text-4xl font-bold mb-2">Hi <span className="animate-wave inline-block">👋</span></h1>
                   <p className="text-white/90 font-medium text-lg">How can we help you today?</p>
               </div>
          </div>

          {/* Action Area (Overlapping Card) */}
          <div className="flex-1 bg-gray-50 dark:bg-gray-900 relative -mt-8 rounded-t-[2rem] px-6 pt-8 flex flex-col gap-4 shadow-[0_-4px_20px_rgba(0,0,0,0.1)] z-20">
              
               {/* Chat Input Trigger */}
              <form onSubmit={handleHomeInputSubmit} className="relative">
                  <input 
                    type="text" 
                    placeholder="Ask a question..." 
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    className="w-full pl-5 pr-12 py-4 rounded-2xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-accent-${accentColorClass} focus:outline-none shadow-sm transition-all"
                  />
                  <button type="submit" className={`absolute right-3 top-1/2 transform -translate-y-1/2 p-2 bg-gray-100 dark:bg-gray-700 rounded-xl text-gray-400 hover:text-accent-${accentColorClass} transition-colors`}>
                      <SendIcon />
                  </button>
              </form>

              {/* Voice Card Trigger */}
              <button 
                onClick={startVoiceSession}
                className={`w-full text-left p-1 rounded-2xl bg-gradient-to-r from-accent-${accentColorClass} to-gray-800 shadow-lg hover:shadow-xl transform hover:-translate-y-1 transition-all group`}
              >
                  <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 flex items-center gap-4 h-full">
                      <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-md group-hover:scale-110 transition-transform">
                         <MicrophoneIcon state={WidgetState.Idle} />
                      </div>
                      <div className="text-white">
                          <h4 className="font-bold text-lg">Talk to AI Assistant</h4>
                          <p className="text-sm opacity-90">Skip typing, we're listening.</p>
                      </div>
                  </div>
              </button>

          </div>
      </div>
  );

  const renderChatView = () => (
      <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900 w-full">
          {/* Header */}
          <div className={`bg-white dark:bg-gray-800 p-4 shadow-sm border-b border-gray-200 dark:border-gray-700 flex items-center justify-between z-10`}>
              <div className="flex items-center gap-3">
                  <button onClick={handleBack} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                  </button>
                  <div className="flex flex-col">
                      <span className="font-bold text-gray-900 dark:text-white leading-tight">{agentProfile.name}</span>
                      <span className="text-xs text-green-500 font-medium flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span> Online
                      </span>
                  </div>
              </div>
              <button onClick={endChatSession} className="text-xs bg-red-50 text-red-600 hover:bg-red-100 px-3 py-1.5 rounded-full font-medium transition-colors border border-red-100">
                  End Chat
              </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((msg, idx) => (
                  <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm text-sm whitespace-pre-wrap leading-relaxed ${
                          msg.role === 'user' 
                          ? `bg-accent-${accentColorClass} text-white rounded-br-none` 
                          : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 rounded-bl-none border border-gray-100 dark:border-gray-700'
                      }`}>
                          {msg.text}
                      </div>
                  </div>
              ))}
              {isChatTyping && (
                  <div className="flex justify-start">
                      <div className="bg-white dark:bg-gray-800 rounded-2xl rounded-bl-none px-4 py-3 shadow-sm border border-gray-100 dark:border-gray-700">
                          <div className="flex space-x-1">
                              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                          </div>
                      </div>
                  </div>
              )}
              <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-4 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
              <form onSubmit={handleHomeInputSubmit} className="flex gap-2">
                  <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Type a message..."
                      className="flex-1 p-3 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent-${accentColorClass} dark:text-white"
                  />
                  <button type="submit" disabled={!chatInput.trim()} className={`p-3 bg-accent-${accentColorClass} text-white rounded-xl hover:opacity-90 disabled:opacity-50 transition-opacity`}>
                      <SendIcon />
                  </button>
              </form>
          </div>
      </div>
  );

  const renderVoiceView = () => (
      <div className="flex flex-col h-full bg-white dark:bg-gray-900 relative w-full">
          <button onClick={handleBack} className="absolute top-4 left-4 z-50 p-2 bg-gray-100/50 dark:bg-gray-800/50 backdrop-blur-md rounded-full text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
               <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          
          <div className="flex-grow flex flex-col items-center justify-center p-6 text-center relative overflow-hidden">
               {/* Background Ambient Effect */}
               <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-accent-${accentColorClass} opacity-5 rounded-full blur-3xl pointer-events-none`}></div>

                <div className="relative w-48 h-48 flex items-center justify-center mb-8">
                    {widgetState === WidgetState.Connecting && <Spinner className={`w-24 h-24 text-accent-${accentColorClass}`} />}
                    
                    {(widgetState === WidgetState.Listening || widgetState === WidgetState.Speaking) && (
                        <div className="relative w-36 h-36 flex items-center justify-center">
                            <div className={`absolute w-full h-full rounded-full bg-accent-${accentColorClass} animate-sonar-ping opacity-20`}></div>
                            <div className={`absolute w-full h-full rounded-full bg-accent-${accentColorClass} animate-sonar-ping [animation-delay:0.5s] opacity-20`}></div>
                            <div className={`relative w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300 shadow-2xl bg-gradient-to-br from-accent-${accentColorClass} to-gray-800 scale-110`}>
                                {widgetState === WidgetState.Speaking && <div className="absolute inset-0 rounded-full bg-white opacity-30 animate-ping"></div>}
                                <MicrophoneIcon state={widgetState} />
                            </div>
                        </div>
                    )}

                    {widgetState === WidgetState.Error && <div className="text-red-500"><svg xmlns="http://www.w3.org/2000/svg" className="h-20 w-20 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></div>}
                    {widgetState === WidgetState.Ended && (voiceReportingStatus === 'analyzing' || voiceReportingStatus === 'sending') && <Spinner className={`w-24 h-24 text-accent-${accentColorClass}`} />}
                    {widgetState === WidgetState.Ended && voiceReportingStatus === 'sent' && <div className="text-green-500"><svg xmlns="http://www.w3.org/2000/svg" className="h-20 w-20 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></div>}
                    {widgetState === WidgetState.Ended && voiceReportingStatus === 'failed' && <div className="text-red-500"><svg xmlns="http://www.w3.org/2000/svg" className="h-20 w-20 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></div>}
                </div>

                <div className="h-12 flex flex-col justify-center">
                    <p className="text-lg font-medium text-gray-700 dark:text-gray-200">
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
                </div>
                
                 {/* Controls */}
                <div className="mt-8">
                     {(widgetState === WidgetState.Connecting || widgetState === WidgetState.Listening || widgetState === WidgetState.Speaking) && (
                        <button onClick={endVoiceSession} className="px-8 py-3 rounded-full bg-red-100 text-red-600 hover:bg-red-200 font-semibold transition-colors flex items-center gap-2">
                           <span className="w-3 h-3 bg-red-600 rounded-full animate-pulse"></span> End Call
                        </button>
                    )}
                     {(widgetState === WidgetState.Error || widgetState === WidgetState.Ended) && (
                         <div className="flex gap-4">
                             <button onClick={() => setView('home')} className="px-6 py-2 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-white font-medium">Close</button>
                             <button onClick={startVoiceSession} className="px-6 py-2 rounded-lg bg-accent-${accentColorClass} text-white font-medium">Try Again</button>
                         </div>
                    )}
                </div>
          </div>
      </div>
  );

  // --- Main Render ---

  if (!isOpen) {
    const fabContent = (
      <div className={`${themeClass} relative`}>
        {showCallout && agentProfile.calloutMessage && (
          <div className="absolute top-1/2 right-full mr-4 w-max max-w-[200px] transform -translate-y-1/2 px-4 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg shadow-lg text-left text-sm animate-fade-in-up border border-gray-100 dark:border-gray-700">
            <p>{agentProfile.calloutMessage}</p>
            <div className="absolute top-1/2 -right-2 w-0 h-0 transform -translate-y-1/2 border-y-8 border-y-transparent border-l-8 border-l-white dark:border-l-gray-800"></div>
          </div>
        )}
        <button onClick={toggleWidget} className={`w-14 h-14 md:w-16 md:h-16 rounded-full bg-gradient-to-br from-accent-${accentColorClass} to-gray-800 shadow-lg shadow-accent-${accentColorClass}/30 flex items-center justify-center text-white transform hover:scale-105 transition-all duration-300`}>
          <FabIcon className="w-7 h-7 md:w-9 md:h-9" />
        </button>
      </div>
    );
    return isWidgetMode ? <div className="w-full h-full p-2 flex items-end justify-end bg-transparent">{fabContent}</div> : <div className="fixed bottom-5 right-5 z-[9999]">{fabContent}</div>;
  }

  // Mobile check is handled via CSS queries mostly, but for layout we treat widget mode container specially
  const containerClasses = isWidgetMode 
    ? 'w-full h-full' 
    : 'fixed bottom-0 right-0 md:bottom-24 md:right-5 w-full h-[100dvh] md:w-[400px] md:h-[650px] md:rounded-2xl shadow-2xl z-[9999] transition-all duration-300';

  return (
    <div className={`${themeClass} ${containerClasses}`}>
        <div className={`flex flex-col w-full h-full bg-white dark:bg-gray-900 text-black dark:text-white md:rounded-2xl overflow-hidden border-0 md:border border-gray-200 dark:border-gray-700 shadow-2xl`}>
            {/* Header / Close Button (Only visible on Home view or handled within views) */}
            {view === 'home' && (
                <button onClick={toggleWidget} className="absolute top-4 right-4 z-50 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
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
